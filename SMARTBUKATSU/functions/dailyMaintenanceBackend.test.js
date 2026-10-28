const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { parse } = require("@babel/parser");
const { createDailyMaintenanceHandler } = require("./dailyMaintenanceBackend");

const scheduleTime = "2026-10-27T18:45:00.000Z"; // October 28, 03:45 JST.
const cutoffMillis = Date.parse("2026-10-27T18:30:00.000Z");

// Execute production cleanup code, replacing only external Firebase interfaces.
function environment(options = {}) {
  const documents = new Map(), deletedCases = [], queries = [], logs = [];
  let clock = Date.parse(scheduleTime);
  class Timestamp {
    constructor(millis) { this.millis = millis; }
    toMillis() { return this.millis; }
    static fromMillis(millis) { return new Timestamp(millis); }
    static now() { return new Timestamp(clock); }
  }
  const millis = value => value?.toMillis ? value.toMillis() : value;
  const snapshot = ref => ({ ref, id: ref.id, exists: documents.has(ref.path), data: () => documents.get(ref.path) });
  function reference(location, filters = [], max = Infinity) {
    return { path: location, id: location.split("/").at(-1),
      get parent() { return location.includes("/") ? reference(location.slice(0, location.lastIndexOf("/"))) : null; },
      doc: id => reference(`${location}/${id}`), collection: name => reference(`${location}/${name}`),
      where: (field, operator, value) => reference(location, [...filters, [field, operator, value]], max),
      limit: count => reference(location, filters, count),
      async get() {
        if (options.failCollection === location) throw new Error("Synthetic private failure body");
        if (location.split("/").length % 2 === 0) return snapshot(this);
        queries.push({ location, filters, max });
        const docs = [...documents.keys()].filter(key => key.startsWith(`${location}/`)
          && key.split("/").length === location.split("/").length + 1
          && filters.every(([field, operator, value]) => operator === "=="
            ? documents.get(key)[field] === value : documents.get(key)[field] != null
              && millis(documents.get(key)[field]) <= millis(value)))
          .slice(0, max).map(key => snapshot(reference(key)));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }
  const firestore = { collection: reference,
    async recursiveDelete(ref) {
      if (options.failDelete === ref.id) throw new Error("Synthetic private failure body");
      deletedCases.push(ref.id);
      for (const key of documents.keys()) if (key === ref.path || key.startsWith(`${ref.path}/`)) documents.delete(key);
    },
    async runTransaction(work) {
      const writes = [];
      const result = await work({
        async get(ref) { assert.equal(writes.length, 0, "Reads must precede writes"); return ref.get(); },
        set: (ref, value) => writes.push(() => documents.set(ref.path, value)),
        delete: ref => writes.push(() => documents.delete(ref.path)),
      });
      writes.forEach(write => write());
      return result;
    },
  };
  const logger = Object.fromEntries(["info", "error", "warn"].map(level => [level,
    (message, fields) => logs.push({ level, message, ...fields })]));
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "notifications.js"), "utf8"), {
    module,
    require(name) {
      if (name === "firebase-admin/firestore") return { getFirestore: () => firestore, Timestamp };
      if (name === "firebase-functions/v2/https") return { onCall: (_options, fn) => fn, HttpsError: Error };
      if (name === "firebase-functions/v2/firestore") return { onDocumentWritten: (_options, fn) => fn };
      if (name === "firebase-functions/logger") return logger;
      if (["./notificationCore", "./workspaceAudience", "node:crypto"].includes(name)) return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    fetch() { assert.fail("Cleanup must not send notifications or access the network"); },
  });
  const dependencies = { firestore, Timestamp, logger, now: () => clock,
    cleanupNotifications: options.cleanupNotifications || module.exports.deleteExpiredNotifications };
  const run = createDailyMaintenanceHandler(dependencies);
  function addCase(id, values = {}) {
    documents.set(`supportCases/${id}`, { deleteAfter: Timestamp.fromMillis(cutoffMillis), status: "resolved", legalHold: false, ...values });
    documents.set(`supportCases/${id}/evidence/one`, { synthetic: true });
  }
  function addNotification(uid, id, values = {}) {
    documents.set(`users/${uid}`, {});
    documents.set(`users/${uid}/notifications/${id}`, { category: "notice", teamId: "team",
      readAt: null, dismissedAt: null, expiresAt: Timestamp.fromMillis(clock - 1), ...values });
  }
  return { run, dependencies, documents, deletedCases, queries, logs, Timestamp, addCase, addNotification,
    advance: millis => { clock += millis; } };
}

test("JST cutoff preserves the old boundary, legal holds and unresolved cases; removes child data", async () => {
  const e = environment();
  e.addCase("before", { deleteAfter: e.Timestamp.fromMillis(cutoffMillis - 1) });
  e.addCase("boundary");
  e.addCase("after", { deleteAfter: e.Timestamp.fromMillis(cutoffMillis + 1) });
  e.addCase("held", { legalHold: true });
  for (const status of ["received", "reviewing"]) e.addCase(status, { status });
  e.addCase("no-expiry", { deleteAfter: null });
  await e.run({ scheduleTime });
  assert.deepEqual(e.deletedCases, ["before", "boundary"]);
  for (const id of ["before", "boundary"]) assert.equal(e.documents.has(`supportCases/${id}/evidence/one`), false);
  for (const id of ["after", "held", "received", "reviewing", "no-expiry"]) assert.equal(e.documents.has(`supportCases/${id}`), true);
  assert.equal(e.queries.find(q => q.location === "supportCases").filters[0][2].toMillis(), cutoffMillis);
});

test("late delivery and a repeated delivery keep the original cutoff and do not repeat completed deletes", async () => {
  const e = environment(); e.addCase("expired");
  e.addCase("not-in-original-run", { deleteAfter: e.Timestamp.fromMillis(cutoffMillis + 1) });
  e.advance(26 * 60 * 60 * 1000);
  await e.run({ scheduleTime }); await e.run({ scheduleTime });
  assert.deepEqual(e.deletedCases, ["expired"]);
  assert.ok(e.queries.filter(q => q.location === "supportCases").every(q => q.filters[0][2].toMillis() === cutoffMillis));
});

test("notification failure still completes support cleanup and exposes no private error body", async () => {
  const e = environment({ failCollection: "users" }); e.addCase("expired");
  await assert.rejects(e.run({ scheduleTime }), /Daily maintenance failed: notifications/);
  assert.deepEqual(e.deletedCases, ["expired"]);
  assert.ok(e.logs.some(log => log.task === "supportCases" && log.level === "info"));
  assert.equal(JSON.stringify(e.logs).includes("private"), false);
});

test("support failure still expires notifications and adjusts unread counts exactly once", async () => {
  const e = environment({ failDelete: "failed" }); e.addCase("failed");
  e.addNotification("one", "expired");
  e.addNotification("one", "kept", { expiresAt: e.Timestamp.fromMillis(Date.parse(scheduleTime) + 1) });
  e.addNotification("one", "dismissed", { dismissedAt: e.Timestamp.now() });
  await assert.rejects(e.run({ scheduleTime }), /Daily maintenance failed: supportCases/);
  assert.equal(e.documents.has("users/one/notifications/expired"), false);
  assert.equal(e.documents.has("users/one/notifications/dismissed"), false);
  assert.equal(e.documents.has("users/one/notifications/kept"), true);
  assert.equal(e.documents.get("users/one/notificationState/summary").unreadTotal, 1);
  await assert.rejects(e.run({ scheduleTime }), /supportCases/);
  assert.equal(e.documents.get("users/one/notificationState/summary").unreadTotal, 1);
});

test("synchronous failure does not prevent the other branch from starting", async () => {
  const e = environment({ cleanupNotifications() { throw new Error("Synthetic failure"); } }); e.addCase("expired");
  await assert.rejects(e.run({ scheduleTime }), /notifications/);
  assert.deepEqual(e.deletedCases, ["expired"]);
});

test("both branches start before either completes and failures are reported only after both settle", async () => {
  let started = false, finish;
  const e = environment({ failDelete: "expired",
    cleanupNotifications: () => { started = true; return new Promise(resolve => { finish = resolve; }); } });
  e.addCase("expired");
  const pending = e.run({ scheduleTime });
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true); assert.equal(settled, false);
  assert.ok(e.logs.some(log => log.task === "supportCases" && log.level === "error"));
  finish(); await assert.rejects(pending, /supportCases/);
});

test("large batches preserve the global 400-notification cap and support pagination", async () => {
  const e = environment();
  for (let i = 0; i < 1005; i++) e.addCase(`case-${i}`);
  for (const uid of ["first", "second", "third"]) {
    for (let i = 0; i < 250; i++) e.addNotification(uid, `notification-${i}`);
  }
  await e.run({ scheduleTime });
  assert.equal(e.deletedCases.length, 1005);
  assert.equal([...e.documents.keys()].filter(key => key.includes("/notifications/")).length, 350);
  assert.equal(e.queries.filter(q => q.location === "supportCases").length, 11);
  assert.equal(e.documents.get("users/first/notificationState/summary").unreadTotal, 0);
  assert.equal(e.documents.get("users/second/notificationState/summary").unreadTotal, 100);
  assert.equal(e.documents.has("users/third/notificationState/summary"), false);
});

test("a full page containing only protected cases terminates without looping", async () => {
  const e = environment();
  for (let i = 0; i < 100; i++) e.addCase(`held-${i}`, { legalHold: true });
  await e.run({ scheduleTime });
  assert.equal(e.deletedCases.length, 0);
  assert.equal(e.queries.filter(q => q.location === "supportCases").length, 1);
});

test("invalid scheduleTime performs no cleanup; a future cutoff never exceeds the execution clock", async () => {
  const e = environment();
  for (const event of [undefined, {}, { scheduleTime: "invalid" }]) await assert.rejects(e.run(event), /valid scheduleTime/);
  assert.equal(e.queries.length, 0);
  await e.run({ scheduleTime: "2026-10-29T18:45:00Z" });
  assert.equal(e.queries.find(q => q.location === "supportCases").filters[0][2].toMillis(), Date.parse(scheduleTime));
});

test("production entry point exports three schedules, keeps the public notification name and disables retries", async () => {
  const e = environment();
  const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  const nodes = parse(source).program.body.filter(node => node.type === "ExpressionStatement"
    && node.expression.type === "AssignmentExpression" && node.expression.right.type === "CallExpression"
    && node.expression.right.callee.name === "onSchedule");
  const exported = {};
  vm.runInNewContext(nodes.map(node => source.slice(node.start, node.end)).join("\n"), {
    exports: exported, onSchedule: (options, run) => ({ options, run }),
    tacticalNotes: { cleanupExpiredUploads() {} }, attachmentExpiry: { cleanupExpired() {} },
    createDailyMaintenanceHandler, ...e.dependencies, SUPPORT_CASE_COLLECTION: "supportCases",
    runExpiredNotificationCleanup: e.dependencies.cleanupNotifications,
  });
  assert.deepEqual(Object.keys(exported).sort(), ["cleanupExpiredTacticalNoteUploads", "deleteExpiredCalendarAttachments", "deleteExpiredNotifications"].sort());
  const options = JSON.parse(JSON.stringify(exported.deleteExpiredNotifications.options));
  assert.deepEqual(options, { region: "asia-northeast1", schedule: "45 3 * * *", timeZone: "Asia/Tokyo",
    timeoutSeconds: 540, memory: "1GiB", cpu: 1, minInstances: 0, retryCount: 0, maxRetrySeconds: 0 });
  assert.equal(exported.cleanupExpiredTacticalNoteUploads.options.schedule, "30 3 * * *");
  assert.equal(exported.cleanupExpiredTacticalNoteUploads.options.retryCount, 3);
  assert.equal(exported.deleteExpiredCalendarAttachments.options.schedule, "0 3 * * *");
  e.addCase("expired");
  await exported.deleteExpiredNotifications.run({ scheduleTime });
  assert.deepEqual(e.deletedCases, ["expired"]);
});

test("installed Firebase SDK discovers only the three intended scheduled functions", () => {
  const script = `
    const assert = require("node:assert/strict");
    const functions = require("./index.js");
    const scheduled = Object.entries(functions).filter(([, fn]) => fn.__endpoint?.scheduleTrigger);
    assert.deepEqual(scheduled.map(([name]) => name).sort(),
      ["cleanupExpiredTacticalNoteUploads", "deleteExpiredCalendarAttachments", "deleteExpiredNotifications"].sort());
    assert.equal(Object.hasOwn(functions, "deleteExpiredSupportCases"), false);
    const endpoint = functions.deleteExpiredNotifications.__endpoint;
    assert.equal(endpoint.availableMemoryMb, 1024);
    assert.equal(endpoint.cpu, 1);
    assert.equal(endpoint.minInstances, 0);
    assert.equal(endpoint.timeoutSeconds, 540);
    assert.equal(endpoint.scheduleTrigger.schedule, "45 3 * * *");
    assert.equal(endpoint.scheduleTrigger.timeZone, "Asia/Tokyo");
    assert.equal(endpoint.scheduleTrigger.retryConfig.retryCount, 0);
    assert.equal(endpoint.scheduleTrigger.retryConfig.maxRetrySeconds, 0);
    require("firebase-admin/app").deleteApp(require("firebase-admin/app").getApp());
  `;
  execFileSync(process.execPath, ["-e", script], { cwd: __dirname,
    env: { ...process.env, GCLOUD_PROJECT: "demo-daily-maintenance", METADATA_SERVER_DETECTION: "none",
      FIREBASE_CONFIG: JSON.stringify({ projectId: "demo-daily-maintenance", storageBucket: "demo-daily-maintenance.appspot.com" }),
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:18599" },
    timeout: 15000, stdio: "pipe" });
});
