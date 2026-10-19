const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const DAY = 86400000;
const registry = token => `notificationPushTokens/${createHash("sha256").update(token).digest("hex")}`;
const data = (uid = "synthetic-a", deviceId = "device_0001", token = "ExpoPushToken[synthetic-a]") =>
  ({ auth: { uid }, data: { deviceId, token, platform: "android", expectedUid: uid } });

function harness(source = fs.readFileSync(path.join(__dirname, "notifications.js"), "utf8")) {
  const documents = new Map(), stats = { reads: 0, writes: 0, retries: 0 };
  let now = 1800000000000, conflict, queue = Promise.resolve(), fail = false;
  const timestamp = millis => ({ toMillis: () => millis });
  const snap = ref => { const value = documents.get(ref.path); return { ref, exists: value !== undefined, data: () => value }; };
  const ref = location => ({ path: location, doc: id => ref(`${location}/${id}`), collection: name => ref(`${location}/${name}`),
    get: async () => { stats.reads++; return snap(ref(location)); },
    set: async value => { stats.writes++; documents.set(location, value); } });
  const firestore = { collection: ref, runTransaction(fn) {
    const pending = queue.then(async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const reads = new Map(), writes = [];
        const result = await fn({
          get: async reference => { assert.equal(writes.length, 0, "reads before writes"); const snapshot = await reference.get(); reads.set(reference.path, snapshot.data()); return snapshot; },
          set: (reference, value) => writes.push(() => documents.set(reference.path, value)),
          create: (reference, value) => writes.push(() => { assert.equal(documents.has(reference.path), false); documents.set(reference.path, value); }),
          delete: reference => writes.push(() => documents.delete(reference.path)),
        });
        if (conflict) { const hook = conflict; conflict = null; hook(); }
        if ([...reads].some(([key, value]) => documents.get(key) !== value)) { stats.retries++; continue; }
        if (fail) throw new Error("synthetic transaction failure");
        for (const write of writes) { write(); stats.writes++; }
        return result;
      }
      throw new Error("synthetic retries exhausted");
    }); queue = pending.catch(() => {}); return pending;
  } };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const module = { exports: {} };
  vm.runInNewContext(source, { module, Number,
    require(name) {
      if (name === "firebase-admin/firestore") return { getFirestore: () => firestore, Timestamp: { now: () => timestamp(now) } };
      if (name === "firebase-functions/v2/https") return { onCall: (_config, handler) => handler, HttpsError };
      if (name === "firebase-functions/v2/firestore") return { onDocumentWritten: (_config, handler) => handler };
      if (name === "firebase-functions/v2/scheduler") return { onSchedule: (_config, handler) => handler };
      if (name === "firebase-functions/logger") return { info() {}, warn() {}, error() {} };
      if (["./notificationCore", "./workspaceAudience", "node:crypto"].includes(name)) return require(name);
      throw new Error(name);
    }, fetch() { assert.fail("registration must not send a notification"); },
  });
  return { api: module.exports, documents, stats, timestamp,
    advance: ms => { now += ms; }, beforeCommit: fn => { conflict = fn; }, fail: value => { fail = value; } };
}

test("same identity: 3 reads and zero writes within 24 hours; daily heartbeat renews both documents", async () => {
  const h = harness(), request = data();
  await h.api.registerPushToken(request); assert.equal(h.stats.writes, 3);
  h.stats.reads = 0; h.stats.writes = 0;
  await h.api.registerPushToken(request); assert.equal(h.stats.reads, 3); assert.equal(h.stats.writes, 0);
  h.advance(DAY - 1); await h.api.registerPushToken(request); assert.equal(h.stats.writes, 0);
  h.advance(1); await h.api.registerPushToken(request); assert.equal(h.stats.writes, 2);
});

test("concurrent registrations create defaults once and preserve existing OFF preferences", async () => {
  const h = harness(); await Promise.all([h.api.registerPushToken(data()), h.api.registerPushToken(data())]);
  assert.equal(h.stats.writes, 3);
  const pref = "users/synthetic-a/notificationPreferences/default";
  const off = { masterEnabled: false, categories: { notice: false } };
  h.documents.set(pref, off); await h.api.registerPushToken(data()); assert.equal(h.documents.get(pref), off);
});

test("ownership recovery transfers the token and creates disabled preferences without opting the new account in", async () => {
  const h = harness(); await h.api.registerPushToken(data());
  const next = data("synthetic-b"); next.data.initializePreferencesEnabled = false;
  await h.api.registerPushToken(next);
  assert.equal(h.documents.has("users/synthetic-a/pushTokens/device_0001"), false);
  assert.equal(h.documents.get("users/synthetic-b/notificationPreferences/default").masterEnabled, false);
  await h.api.registerPushToken(data("synthetic-b"));
  assert.equal(h.documents.get("users/synthetic-b/notificationPreferences/default").masterEnabled, false);
});

test("preference creation retries instead of overwriting a concurrent OFF save", async () => {
  const h = harness(), pref = "users/synthetic-a/notificationPreferences/default";
  h.beforeCommit(() => h.documents.set(pref, { masterEnabled: false }));
  await h.api.registerPushToken(data()); assert.equal(h.stats.retries, 1);
  assert.equal(h.documents.get(pref).masterEnabled, false);
});

test("ownership moves to the authenticated user and retains their other device", async () => {
  const h = harness(), first = data(), other = data("synthetic-b", "device_0002", "ExpoPushToken[synthetic-other]");
  await h.api.registerPushToken(first); await h.api.registerPushToken(other);
  const next = data("synthetic-b"); await h.api.registerPushToken(next);
  assert.equal(h.documents.has("users/synthetic-a/pushTokens/device_0001"), false);
  assert.equal(h.documents.has("users/synthetic-b/pushTokens/device_0001"), true);
  assert.equal(h.documents.has("users/synthetic-b/pushTokens/device_0002"), true);
  assert.equal(h.documents.get(registry(first.data.token)).uid, "synthetic-b");
  await h.api.unregisterPushToken(first);
  assert.equal(h.documents.get(registry(first.data.token)).uid, "synthetic-b");
});

test("token rotation removes only the owned former index, and repairs a missing token or index", async () => {
  const h = harness(), first = data(), second = data("synthetic-a", "device_0001", "ExpoPushToken[synthetic-new]");
  await h.api.registerPushToken(first); await h.api.registerPushToken(second);
  assert.equal(h.documents.has(registry(first.data.token)), false);
  h.documents.delete(registry(second.data.token)); await h.api.registerPushToken(second);
  assert.equal(h.documents.get(registry(second.data.token)).deviceId, "device_0001");
  h.documents.delete("users/synthetic-a/pushTokens/device_0001"); await h.api.registerPushToken(second);
  assert.equal(h.documents.get("users/synthetic-a/pushTokens/device_0001").token, second.data.token);
});

test("changed platform or invalid timestamps are corrected; only stale documents receive heartbeats", async () => {
  const h = harness(), request = data(); await h.api.registerPushToken(request);
  request.data.platform = "ios"; h.stats.writes = 0; await h.api.registerPushToken(request); assert.equal(h.stats.writes, 1);
  const key = "users/synthetic-a/pushTokens/device_0001";
  h.documents.set(key, { ...h.documents.get(key), updatedAt: {} });
  h.stats.writes = 0; await h.api.registerPushToken(request); assert.equal(h.stats.writes, 1);
  h.advance(-1); h.stats.writes = 0; await h.api.registerPushToken(request); assert.equal(h.stats.writes, 2);
});

test("a queued old-account call cannot register or unregister under a new authenticated identity", async () => {
  const h = harness(), request = data(); request.auth.uid = "synthetic-b";
  await assert.rejects(h.api.registerPushToken(request), error => error.code === "failed-precondition");
  await assert.rejects(h.api.unregisterPushToken(request), error => error.code === "failed-precondition");
  assert.equal(h.stats.reads, 0); assert.equal(h.stats.writes, 0);
});

test("legacy clients remain supported; authentication and argument validation still apply", async () => {
  const h = harness(), request = data(); delete request.data.expectedUid;
  await h.api.registerPushToken(request);
  await assert.rejects(h.api.registerPushToken({ data: request.data }), error => error.code === "unauthenticated");
  for (const [field, value] of [["token", "invalid"], ["deviceId", "bad/id"], ["platform", "web"]]) {
    await assert.rejects(h.api.registerPushToken({ ...request, data: { ...request.data, [field]: value } }), error => error.code === "invalid-argument");
  }
});

test("transaction failure is atomic and a later retry can register and unregister one device", async () => {
  const h = harness(); h.fail(true); await assert.rejects(h.api.registerPushToken(data()), /transaction/);
  assert.equal(h.documents.size, 0); h.fail(false); await h.api.registerPushToken(data());
  await h.api.unregisterPushToken(data());
  assert.equal(h.documents.has("users/synthetic-a/pushTokens/device_0001"), false);
  assert.equal(h.documents.has(registry(data().data.token)), false);
  assert.equal(h.documents.get("users/synthetic-a/notificationPreferences/default").masterEnabled, true);
});

test("baseline comparison: duplicate registration reads remain 3; writes fall from 2 to 0", async () => {
  const original = execFileSync("git", ["show", "433109a:./notifications.js"], { cwd: __dirname, encoding: "utf8" });
  const before = harness(original), after = harness();
  for (const h of [before, after]) { await h.api.registerPushToken(data()); h.stats.reads = 0; h.stats.writes = 0; await h.api.registerPushToken(data()); }
  assert.equal(before.stats.reads, 3); assert.equal(after.stats.reads, 3);
  assert.equal(before.stats.writes, 2); assert.equal(after.stats.writes, 0);
});
