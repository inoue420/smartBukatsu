const test = require("node:test"), assert = require("node:assert/strict");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8190" || process.env.GCLOUD_PROJECT !== "demo-attachment-expiry") throw new Error("Run with the dedicated demo attachment expiry emulator.");
process.env.METADATA_SERVER_DETECTION = "none";
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const { createAttachmentExpiryBackend } = require("./attachmentExpiryBackend");
const { backfillAttachmentExpiryPage } = require("./attachmentExpiryMigration");
const { expiryRecord, expiryId } = require("./attachmentExpiryCore");
const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, "attachment-tests");
const db = getFirestore(app);
const fixedNow = Date.parse("2026-10-05T00:00:00Z");
test.after(async () => { await db.terminate(); await deleteApp(app); });

function environment() {
  const team = db.collection("teams").doc(), files = new Map(), metrics = { metadata: 0, deletes: 0, lists: 0, groups: 0 };
  let clock = fixedNow, failDelete = null, failTransaction = false, failAfterDelete = false, replacement = null, afterDelete = null;
  const file = (name, options = {}) => ({
    name, metadata: files.get(name),
    getMetadata: async () => { metrics.metadata++; if (!files.has(name)) throw { code: 404 }; return [{ ...files.get(name) }]; },
    delete: async () => {
      metrics.deletes++;
      if (failDelete && (!failDelete.name || failDelete.name === name)) { const error = failDelete.error; failDelete = null; throw error; }
      if (replacement) { files.set(name, replacement); replacement = null; }
      const current = files.get(name), preconditions = options.preconditionOpts;
      if (current && (preconditions?.ifGenerationMatch !== current.generation || preconditions?.ifMetagenerationMatch !== current.metageneration)) throw { code: 412 };
      files.delete(name);
      if (afterDelete) { const action = afterDelete; afterDelete = null; await action(name); }
      if (failAfterDelete) { failAfterDelete = false; failTransaction = true; }
    },
  });
  const bucket = { name: "demo-bucket", file, getFiles: async ({ prefix, maxResults, pageToken, autoPaginate }) => {
    metrics.lists++; assert.equal(autoPaginate, false);
    const names = [...files.keys()].filter((name) => name.startsWith(prefix)).sort(), start = Number(pageToken || 0);
    const selected = names.slice(start, start + maxResults).map((name) => file(name));
    return [selected, start + maxResults < names.length ? { pageToken: String(start + maxResults) } : null];
  } };
  const firestore = {
    doc: (...args) => db.doc(...args), collection: (...args) => db.collection(...args),
    collectionGroup: (...args) => { metrics.groups++; return db.collectionGroup(...args); },
    runTransaction: async (operation) => {
      if (failTransaction) { failTransaction = false; throw new Error("transaction interrupted"); }
      return db.runTransaction(operation);
    },
  };
  const backend = createAttachmentExpiryBackend({ firestore, getStorage: () => ({ bucket: () => bucket }), FieldValue, now: () => clock });
  const createObject = async (type = "calendarAttachments", id = "event", options = {}) => {
    const name = type === "calendarAttachments" ? type + "/" + team.id + "/" + id + "/2026-07-05/image.jpg" : type + "/" + team.id + "/user/" + id + "/image.jpg";
    const metadata = { bucket: bucket.name, name, generation: "12345678901234567", metageneration: "1",
      timeCreated: "2025-01-01T00:00:00Z", metadata: { expiresAt: "2026-10-05T00:00:00Z" }, ...options };
    files.set(name, metadata);
    await backend.handleFinalize({ data: metadata });
    const record = expiryRecord(metadata), ref = db.collection("attachmentExpirations").doc(expiryId(record));
    return { name, metadata, record, ref, document: db.doc(record.documentPaths[0]) };
  };
  return { team, files, metrics, backend, bucket, firestore, createObject,
    advance(ms) { clock += ms; }, failDelete(error = { code: 503 }, name = null) { failDelete = { error, name }; },
    failAfterDelete() { failAfterDelete = true; }, replaceOnDelete(value) { replacement = value; }, afterDelete(action) { afterDelete = action; } };
}
const attachment = (object) => ({ storagePath: object.name, storageGeneration: object.metadata.generation, expiresAt: object.metadata.metadata.expiresAt, downloadUrl: "synthetic" });
const calendarEvent = async (e, ref, before = null) => e.backend.handleCalendarWrite({ data: { before: { data: () => before }, after: await ref.get() } });

test("finalize is idempotent and ignores other roots or buckets", async () => {
  const e = environment(), object = await e.createObject();
  await e.backend.handleFinalize({ data: object.metadata });
  await object.ref.update({ attempts: 2, nextAttemptAt: fixedNow + 3600000 });
  await e.backend.handleFinalize({ data: object.metadata });
  assert.equal((await object.ref.get()).data().attempts, 2);
  assert.equal((await object.ref.get()).data().nextAttemptAt, fixedNow + 3600000);
  assert.equal(await e.backend.registerObject({ ...object.metadata, bucket: "other-bucket" }), false);
  assert.equal(await e.backend.registerObject({ ...object.metadata, name: "tacticalNoteAttachments/team/note/image.jpg" }), false);
  assert.equal(e.metrics.metadata, 0);
  await object.ref.delete();
});

test("scheduler fetches only due rows, directly updates parents and preserves future files and content", async () => {
  const e = environment(), calendar = await e.createObject(), diary = await e.createObject("dailyReportAttachments", "report");
  const future = await e.createObject("calendarAttachments", "future", { metadata: { expiresAt: "2027-01-01T00:00:00Z" } });
  await calendar.document.set({ title: "body", comments: ["comment"], attachmentsByDate: { a: [attachment(calendar)], b: [{ storagePath: future.name }] } });
  await diary.document.set({ reflection: "body", comments: ["comment"], attachments: [attachment(diary)] });
  const result = await e.backend.cleanupExpired();
  assert.equal(result.completed, 2);
  assert.equal(e.metrics.metadata, 2); assert.equal(e.metrics.lists, 0); assert.equal(e.metrics.groups, 0);
  assert.deepEqual((await calendar.document.get()).data().attachmentsByDate, { b: [{ storagePath: future.name }] });
  assert.deepEqual((await diary.document.get()).data().attachments, []);
  assert.deepEqual((await diary.document.get()).data().comments, ["comment"]);
  assert.ok(e.files.has(future.name));
  await future.ref.delete();
});

test("expiry boundary retains files beforehand and removes them exactly at expiry", async () => {
  const e = environment(), object = await e.createObject("dailyReportAttachments", "boundary");
  assert.deepEqual(await e.backend.processExpiry(object.ref, fixedNow - 1), { skipped: 1 });
  assert.ok(e.files.has(object.name));
  assert.equal((await e.backend.processExpiry(object.ref, fixedNow)).completed, 1);
});

test("Storage failure retains registration, does not block other due rows and retries later", async () => {
  const e = environment(), first = await e.createObject("dailyReportAttachments", "a"), second = await e.createObject("dailyReportAttachments", "b");
  await first.document.set({ attachments: [attachment(first)], comments: ["keep"] });
  e.failDelete({ code: 503 }, first.name);
  await assert.rejects(e.backend.cleanupExpired({ concurrency: 1, batchSize: 1 }), /pending failures/);
  assert.ok(e.files.has(first.name)); assert.equal((await first.ref.get()).data().attempts, 1);
  assert.equal((await second.ref.get()).exists, false);
  assert.equal((await first.document.get()).data().attachments.length, 1);
  e.advance(3600000);
  assert.equal((await e.backend.cleanupExpired()).completed, 1);
  assert.equal((await first.document.get()).data().attachments.length, 0);
});

test("Firestore failure after object deletion retries reference cleanup despite the missing object", async () => {
  const e = environment(), object = await e.createObject("dailyReportAttachments", "retry");
  await object.document.set({ attachments: [attachment(object)], reflection: "keep" });
  e.failAfterDelete();
  await assert.rejects(e.backend.processExpiry(object.ref, fixedNow), /transaction interrupted/);
  assert.equal(e.files.has(object.name), false); assert.equal((await object.ref.get()).exists, true);
  assert.equal((await e.backend.processExpiry(object.ref, fixedNow)).completed, 1);
  assert.equal((await object.document.get()).data().reflection, "keep");
  assert.equal((await object.document.get()).data().attachments.length, 0);
});

test("replacement before inspection or during deletion is never removed", async () => {
  const e = environment(), old = await e.createObject();
  const replacement = { ...old.metadata, generation: "12345678901234568", metadata: { expiresAt: "2027-01-01T00:00:00Z" } };
  await old.document.set({ attachmentsByDate: { a: [{ storagePath: old.name, expiresAt: replacement.metadata.expiresAt }] } });
  e.files.set(old.name, replacement);
  assert.equal((await e.backend.processExpiry(old.ref, fixedNow)).replaced, 1);
  assert.ok(e.files.has(old.name)); assert.equal((await old.document.get()).data().attachmentsByDate.a.length, 1);
  const raced = await e.createObject("calendarAttachments", "race");
  e.replaceOnDelete({ ...raced.metadata, generation: "999" });
  await assert.rejects(e.backend.processExpiry(raced.ref, fixedNow), (error) => error.code === 412);
  assert.equal(e.files.get(raced.name).generation, "999");
  await raced.ref.delete();
});

test("metadata expiry extension is rescheduled; premature references remain", async () => {
  const e = environment(), object = await e.createObject();
  e.files.set(object.name, { ...object.metadata, metageneration: "2", metadata: { expiresAt: "2027-01-01T00:00:00Z" } });
  assert.equal((await e.backend.processExpiry(object.ref, fixedNow)).postponed, 1);
  assert.equal((await object.ref.get()).data().nextAttemptAt, Date.parse("2027-01-01T00:00:00Z"));
  assert.equal(e.metrics.deletes, 0);
  await object.ref.delete();
});

test("split event references and delayed transfer cleanup preserve other dates and comments", async () => {
  const e = environment(), object = await e.createObject(), split = e.team.collection("clubEvents").doc("split");
  await object.document.set({ attachmentsByDate: { a: [attachment(object)] } });
  await split.set({ attachmentsByDate: { a: [attachment(object)], b: [] }, comments: ["keep"] });
  await calendarEvent(e, split);
  await e.backend.handleFinalize({ data: object.metadata });
  assert.deepEqual((await object.ref.get()).data().documentPaths.sort(), [object.document.path, split.path].sort());
  await e.backend.processExpiry(object.ref, fixedNow);
  assert.deepEqual((await split.get()).data().attachmentsByDate, { b: [] });
  assert.deepEqual((await split.get()).data().comments, ["keep"]);
  const late = e.team.collection("clubEvents").doc("late");
  await late.set({ attachmentsByDate: { a: [attachment(object)] }, title: "keep" });
  await calendarEvent(e, late);
  assert.deepEqual((await late.get()).data().attachmentsByDate, {});
});

test("calendar unchanged references do not perform Storage reads and cannot target another team", async () => {
  const e = environment(), object = await e.createObject(), data = { attachmentsByDate: { a: [attachment(object)] } };
  await object.document.set(data);
  await calendarEvent(e, object.document, data);
  const other = db.collection("teams").doc().collection("clubEvents").doc("foreign");
  await other.set(data); await calendarEvent(e, other);
  assert.equal(e.metrics.metadata, 0);
  assert.deepEqual((await object.ref.get()).data().documentPaths, [object.document.path]);
  await object.ref.delete();
});

test("migration is paged, idempotent, dry-run safe and recovers split references", async () => {
  const e = environment();
  const objects = [await e.createObject("calendarAttachments", "migrate-a"), await e.createObject("calendarAttachments", "migrate-b")];
  for (const object of objects) await object.ref.delete();
  const split = e.team.collection("clubEvents").doc("migration-split");
  await split.set({ attachmentsByDate: { a: [attachment(objects[0])] } });
  const page = (state, apply) => backfillAttachmentExpiryPage({ firestore: e.firestore, bucket: e.bucket, backend: e.backend, FieldPath, state, apply, pageSize: 1 });
  const dry = await page({}, false);
  assert.equal(dry.totals.registered, 0); assert.ok(dry.state.pageToken);
  assert.equal((await objects[0].ref.get()).exists, false);
  let state = {}, steps = 0;
  while (state.phase !== "complete") { assert.ok(++steps < 200); state = (await page(state, true)).state; }
  assert.ok((await objects[0].ref.get()).data().documentPaths.includes(split.path));
  const first = await page({}, true);
  assert.ok(first.state.pageToken);
  assert.equal(e.metrics.deletes, 0);
  for (const object of objects) await object.ref.delete();
});

test("bounded cleanup leaves excess work for the next run", async () => {
  const e = environment(), objects = [];
  for (let index = 0; index < 3; index++) objects.push(await e.createObject("dailyReportAttachments", "bounded-" + index));
  assert.equal((await e.backend.cleanupExpired({ batchSize: 1, maxBatches: 2, concurrency: 1 })).completed, 2);
  assert.equal((await e.backend.cleanupExpired()).completed, 1);
});

test("expiry registrations are denied to authenticated and unauthenticated app clients", async () => {
  const fs = require("node:fs"), path = require("node:path"), { createRequire } = require("node:module");
  const clientRequire = createRequire(path.join(__dirname, "../package.json"));
  const clientApp = clientRequire("firebase/app"), sdk = clientRequire("firebase/firestore");
  const response = await fetch("http://127.0.0.1:8190/emulator/v1/projects/demo-attachment-expiry:securityRules", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../firestore.rules"), "utf8") }] } }),
  });
  assert.equal(response.ok, true, await response.text());
  const e = environment(), object = await e.createObject("dailyReportAttachments", "protected");
  await e.team.collection("members").doc("owner").set({ role: "owner" });
  for (const uid of ["owner", null]) {
    const app = clientApp.initializeApp({ projectId: "demo-attachment-expiry", apiKey: "demo-only", appId: "demo-only" }, "expiry-rules-" + uid);
    const client = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(client, "127.0.0.1", 8190, uid ? { mockUserToken: { sub: uid } } : {});
    try {
      const ref = sdk.doc(client, object.ref.path);
      await assert.rejects(sdk.getDoc(ref), (error) => error.code === "permission-denied");
      await assert.rejects(sdk.setDoc(ref, { storagePath: "synthetic", nextAttemptAt: 0 }), (error) => error.code === "permission-denied");
      await assert.rejects(sdk.deleteDoc(ref), (error) => error.code === "permission-denied");
    } finally { await sdk.terminate(client); await clientApp.deleteApp(app); }
  }
  await object.ref.delete();
});

test("new references created after object deletion survive old registration completion", async () => {
  const e = environment(), old = await e.createObject();
  const next = { ...old.metadata, generation: "12345678901234568", metadata: { expiresAt: "2027-01-01T00:00:00Z" } };
  await old.document.set({ attachmentsByDate: { a: [attachment(old)] } });
  e.afterDelete(async (name) => {
    e.files.set(name, next);
    // An old app has no storageGeneration, but its future expiry still protects the new reference.
    await old.document.update({ attachmentsByDate: { a: [{ storagePath: name, expiresAt: next.metadata.expiresAt }] } });
    await e.backend.handleFinalize({ data: next });
  });
  assert.equal((await e.backend.processExpiry(old.ref, fixedNow)).completed, 1);
  assert.equal(e.files.get(old.name).generation, next.generation);
  assert.equal((await old.document.get()).data().attachmentsByDate.a.length, 1);
  await db.collection("attachmentExpirations").doc(expiryId(expiryRecord(next))).delete();
});

test("interrupted migration replays the page without duplicate registration or lost transfer targets", async () => {
  const e = environment(), objects = [await e.createObject("calendarAttachments", "interrupted-a"), await e.createObject("calendarAttachments", "interrupted-b")];
  for (const object of objects) await object.ref.delete();
  let calls = 0;
  const broken = { ...e.backend, registerObject: async (...args) => {
    if (++calls === 2) throw new Error("migration interrupted");
    return e.backend.registerObject(...args);
  } };
  const options = { firestore: e.firestore, bucket: e.bucket, FieldPath, state: {}, apply: true };
  await assert.rejects(backfillAttachmentExpiryPage({ ...options, backend: broken }), /migration interrupted/);
  const retried = await backfillAttachmentExpiryPage({ ...options, backend: e.backend });
  assert.equal(retried.state.phase, "dailyReportAttachments");
  for (const object of objects) { assert.equal((await object.ref.get()).exists, true); await object.ref.delete(); }
});
