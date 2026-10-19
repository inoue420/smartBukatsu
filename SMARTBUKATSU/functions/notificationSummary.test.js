const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { getVisibleUnreadSummary } = require("./notificationCore");

// Run the production callables and expiry handler with synthetic data only.
function harness() {
  const documents = new Map(), stats = { queries: 0, writes: 0, retries: 0 };
  let conflict, queue = Promise.resolve();
  const snapshot = ref => ({ ref, id: ref.id, exists: documents.has(ref.path), data: () => documents.get(ref.path) });
  function reference(location, filters = [], limit = Infinity) {
    return { path: location, id: location.split("/").at(-1),
      get parent() { return location.includes("/") ? reference(location.slice(0, location.lastIndexOf("/"))) : null; },
      doc: id => reference(`${location}/${id}`), collection: name => reference(`${location}/${name}`),
      where: (field, operator, value) => reference(location, [...filters, [field, operator, value]], limit),
      limit: count => reference(location, filters, count),
      async get() {
        if (location.split("/").length % 2 === 0) return snapshot(this);
        stats.queries++;
        return { docs: [...documents.keys()].filter(key => key.startsWith(`${location}/`) &&
          key.split("/").length === location.split("/").length + 1 &&
          filters.every(([field, operator, value]) => operator === "==" ? documents.get(key)[field] === value :
            documents.get(key)[field] <= value.toMillis())).slice(0, limit).map(key => snapshot(reference(key))) };
      },
    };
  }
  const firestore = { collection: reference,
    runTransaction(callback) {
      const result = queue.then(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const reads = new Map(), writes = [];
          const result = await callback({
            async get(ref) { assert.equal(writes.length, 0); reads.set(ref.path, JSON.stringify(documents.get(ref.path))); return ref.get(); },
            set: (ref, value) => writes.push(() => documents.set(ref.path, value)),
            create: (ref, value) => writes.push(() => documents.set(ref.path, value)),
            update: (ref, value) => writes.push(() => documents.set(ref.path, { ...documents.get(ref.path), ...value })),
            delete: ref => writes.push(() => documents.delete(ref.path)),
          });
          if (conflict) { const hook = conflict; conflict = null; hook(); }
          if ([...reads].some(([key, value]) => JSON.stringify(documents.get(key)) !== value)) { stats.retries++; continue; }
          writes.forEach(write => { write(); stats.writes++; });
          return result;
        }
        throw new Error("Synthetic retry exhausted");
      });
      queue = result.catch(() => {});
      return result;
    },
  };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const timestamp = value => ({ toMillis: () => value });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "notifications.js"), "utf8"), {
    module,
    require(name) {
      if (name === "firebase-admin/firestore") return { getFirestore: () => firestore, Timestamp: { now: () => timestamp(1000), fromMillis: timestamp } };
      if (name === "firebase-functions/v2/https") return { onCall: (_options, fn) => fn, HttpsError };
      if (name === "firebase-functions/v2/firestore") return { onDocumentWritten: (_options, fn) => fn };
      if (name === "firebase-functions/v2/scheduler") return { onSchedule: (_options, fn) => fn };
      if (name === "firebase-functions/logger") return { warn() {}, error() {}, info() {} };
      if (name === "./notificationCore" || name === "./workspaceAudience" || name === "node:crypto") return require(name);
      throw new Error(name);
    },
    fetch() { assert.fail("Summary tests must not send pushes"); },
  });
  const request = (notificationId, uid = "a") => ({ auth: { uid }, data: { notificationId } });
  const add = (id, data = {}, uid = "a") => documents.set(`users/${uid}/notifications/${id}`,
    { category: "notice", teamId: "team", readAt: null, dismissedAt: null, ...data });
  const summary = (uid = "a") => documents.get(`users/${uid}/notificationState/summary`);
  return { documents, stats, add, summary, request, api: module.exports, beforeCommit: hook => { conflict = hook; } };
}

test("repair derives all unread buckets from history, preserves documents and runs once", async () => {
  const h = harness();
  h.documents.set("users/a/notificationState/summary", { unreadTotal: 99, unreadByTeam: { stale: 99 } });
  h.add("notice"); h.add("reply", { category: "workspaceReply", teamId: "other" });
  h.add("reminder", { category: "scheduleReminder" });
  h.add("read", { readAt: 500 }); h.add("dismissed", { dismissedAt: 500 }); h.add("otherUser", {}, "b");
  const original = [...h.documents].filter(([key]) => key.includes("/notifications/"));
  await h.api.ensureNotificationSummary(h.request());
  assert.equal(h.summary().unreadTotal, 3);
  assert.equal(h.summary().unreadByTeam.stale, undefined);
  assert.equal(getVisibleUnreadSummary(h.summary(), { masterEnabled: true }).unreadTotal, 2);
  assert.equal(h.summary("b"), undefined);
  const queries = h.stats.queries, writes = h.stats.writes;
  await h.api.ensureNotificationSummary(h.request());
  assert.equal(h.stats.queries, queries); assert.equal(h.stats.writes, writes);
  assert.deepEqual([...h.documents].filter(([key]) => key.includes("/notifications/")), original);
});

test("repair is authenticated and cannot choose a different user via request data", async () => {
  const h = harness(); h.add("private", {}, "b");
  await assert.rejects(h.api.ensureNotificationSummary({ data: {} }), { code: "unauthenticated" });
  await h.api.ensureNotificationSummary({ auth: { uid: "a" }, data: { uid: "b" } });
  assert.equal(h.summary().unreadTotal, 0); assert.equal(h.summary("b"), undefined);
});

for (const action of ["markNotificationRead", "dismissNotification"]) {
  test(`${action} repairs legacy counts and decrements once, including hidden history`, async () => {
    const h = harness(); h.add("hidden", { category: "workspaceReply" }); h.add("visible");
    await h.api[action](h.request("hidden"));
    assert.equal(h.summary().unreadTotal, 1);
    assert.equal(h.summary().unreadBuckets['["workspaceReply","team"]'], 0);
    await h.api[action](h.request("hidden"));
    assert.equal(h.summary().unreadTotal, 1);
    assert.equal(h.summary().unreadBuckets['["notice","team"]'], 1);
  });
}

test("a concurrent summary update forces repair to retry with the latest history", async () => {
  const h = harness(); h.add("first");
  h.beforeCommit(() => {
    h.add("arrived", { category: "workspaceReply" });
    h.documents.set("users/a/notificationState/summary", { unreadTotal: 2 });
  });
  await h.api.ensureNotificationSummary(h.request());
  assert.equal(h.stats.retries, 1); assert.equal(h.summary().unreadTotal, 2);
});

test("simultaneous read/dismiss on the same notification cannot decrement twice", async () => {
  const h = harness(); h.add("first"); h.add("second");
  await Promise.all([h.api.markNotificationRead(h.request("first")), h.api.dismissNotification(h.request("first"))]);
  assert.equal(h.summary().unreadTotal, 1);
});

test("expiry removes unread buckets once and does not decrement already dismissed records", async () => {
  const h = harness(); h.documents.set("users/a", {});
  h.add("expired", { expiresAt: 900 }); h.add("kept", { expiresAt: 2000 });
  h.add("dismissed", { expiresAt: 900, dismissedAt: 500 });
  await h.api.ensureNotificationSummary(h.request());
  await h.api.deleteExpiredNotifications();
  assert.equal(h.summary().unreadTotal, 1);
  assert.equal(h.summary().unreadBuckets['["notice","team"]'], 1);
  assert.equal(h.documents.has("users/a/notifications/expired"), false);
  assert.equal(h.documents.has("users/a/notifications/dismissed"), false);
});
