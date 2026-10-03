const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const utilities = require("./tacticalNotes");
const plain = (value) => JSON.parse(JSON.stringify(value));
function load(file, modules, extra = {}) {
  const code = require("@babel/core").transformSync(fs.readFileSync(path.join(__dirname, "../services", file), "utf8"), {
    configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => {
    assert.ok(modules[name], name); return modules[name];
  }, ...extra });
  return module.exports;
}
const ref = (...args) => args.filter((part) => typeof part === "string").join("/");
function services(overrides = {}) {
  const firestore = { doc: ref, collection: ref, query: (reference, ...clauses) => ({ reference, clauses }),
    where: (...args) => ["where", ...args], orderBy: (...args) => ["orderBy", ...args], limit: (...args) => ["limit", ...args], startAfter: (...args) => ["startAfter", ...args], ...overrides };
  return load("firestoreService.js", { "firebase/firestore": firestore, "firebase/functions": {},
    "./firestoreSubscription": overrides, "../firebase": { db: {}, auth: { currentUser: { uid: "me" } } },
    "../legal": {}, "../utils/tacticalNotes": utilities, "./tacticalNoteAttachmentService": overrides });
}
test("list filters and continuation read only bounded compact pages, detail streams exclude replies and histories", async () => {
  const queries = [], subscriptions = [], stopped = [];
  const docs = Array.from({ length: 30 }, (_, index) => ({ id: String(index), data: () => ({ title: "指導" }) }));
  const sdk = services({ measuredOnSnapshot: (name, query, callback) => {
    subscriptions.push({ name, query }); callback({ docs: [], size: 0 }); return () => stopped.push(name);
  }, getDocs: async (query) => { queries.push(query); return { docs, size: docs.length }; } });
  let page;
  const stopList = sdk.subscribeTacticalNoteSummaries("team", "unconfirmed", "me", (value) => { page = value; });
  assert.equal(page.hasMore, false);
  assert.deepEqual(plain(subscriptions[0].query.clauses), [["where", "draft", "==", false], ["where", "pendingUids", "array-contains", "me"], ["orderBy", "createdAt", "desc"], ["limit", 30]]);
  const older = await sdk.getTacticalNoteSummaryPage("team", "mine", "me", "cursor");
  assert.equal(older.items.length, 30); assert.equal(older.cursor, docs.at(-1)); assert.equal(older.hasMore, true);
  assert.deepEqual(plain(queries[0].clauses).at(-2), ["startAfter", "cursor"]);
  const stopDetail = sdk.subscribeTacticalNoteActivity("team", { id: "note", contentVersion: 2, tasks: { current: {} } }, "me", () => {});
  assert.deepEqual(subscriptions.map((item) => item.name), ["tacticalNoteSummaries", "tacticalNote-responses", "tacticalNote-progress"]);
  assert.deepEqual(plain(subscriptions[2].query.clauses), [["where", "taskId", "in", ["current"]]]);
  stopList(); stopDetail(); assert.equal(stopped.length, 3);
});
test("history exhaustion skips that query and deleting a note touches only its parent", async () => {
  const reads = [], deletes = [];
  const sdk = services({ getDocs: async (query) => { reads.push(query); return { docs: [], size: 0 }; }, deleteDoc: async (target) => deletes.push(target) });
  const history = await sdk.getTacticalNoteHistory("team", "note", { responseCursor: false });
  assert.equal(history.responses.length, 0); assert.equal(reads.length, 1);
  assert.ok(reads[0].reference.endsWith("progressHistory")); assert.deepEqual(plain(reads[0].clauses).at(-1), ["limit", 20]);
  await sdk.deleteTacticalNote("team", "note"); assert.deepEqual(deletes, ["teams/team/tacticalNotes/note"]); assert.equal(reads.length, 1);
});
test("only a question's author can resolve it, repeated resolution never rewrites history", async () => {
  let response = { uid: "other", status: "question", text: "元の質問", resolved: false };
  const writes = [];
  const sdk = services({ serverTimestamp: () => "time", runTransaction: async (_db, operation) => operation({
    get: async () => ({ data: () => response }), update: (target, data) => writes.push({ target, data }),
  }) });
  await assert.rejects(sdk.resolveTacticalNoteQuestion("team", "note", "question"), /本人/);
  response.uid = "me"; await sdk.resolveTacticalNoteQuestion("team", "note", "question");
  assert.deepEqual(plain(writes[0].data), { resolved: true, resolvedAt: "time", resolvedBy: "me" });
  response.resolved = true; await sdk.resolveTacticalNoteQuestion("team", "note", "question"); assert.equal(writes.length, 1);
});
test("interrupted image URL retrieval keeps registration and retries the same object without uploading again", async () => {
  let registration, metadata, failURL = true, uploads = 0;
  const storage = { ref: (_storage, target) => target, getMetadata: async () => { if (!metadata) throw { code: "storage/object-not-found" }; return metadata; },
    uploadBytes: async (_target, blob, options) => { uploads++; metadata = { size: blob.size, customMetadata: options.customMetadata }; },
    getDownloadURL: async () => { if (failURL) throw new Error("offline"); return "image-url"; } };
  const sdk = load("tacticalNoteAttachmentService.js", { "firebase/storage": storage, "firebase/firestore": {
    doc: ref, serverTimestamp: () => "time", runTransaction: async (_db, operation) => operation({ get: async () => ({ data: () => registration }), set: (_ref, data) => { registration = data; } }),
  }, "../firebase": { db: {}, storage: {}, auth: { currentUser: { uid: "me" } } }, "./dailyReportAttachmentService": {} }, {
    XMLHttpRequest: class { open() {} send() { this.response = { size: 100, close() {} }; this.onload(); } },
  });
  const image = { id: "image", name: "指導", localUri: "local", width: 100, height: 100 };
  await assert.rejects(sdk.uploadTacticalNoteImage("team", "note", image), /offline/);
  assert.equal(registration.size, 100); assert.equal(uploads, 1);
  failURL = false; const saved = await sdk.uploadTacticalNoteImage("team", "note", image);
  assert.equal(uploads, 1); assert.equal(saved.storagePath, "tacticalNoteAttachments/team/note/image.jpg"); assert.equal(saved.size, 100);
});


test("a new note committed before a lost acknowledgement is never deleted by failure cleanup", async () => {
  let current, transactions = 0, deleted = 0;
  const parent = { id: "note", path: "parent" };
  const sdk = services({ doc: (...args) => args.includes("attachmentUploads") ? {path: "upload"} : parent,
    serverTimestamp: () => "time", getDoc: async () => ({exists: () => false, data: () => undefined}),
    setDoc: async (_target, data) => {current = data;}, uploadTacticalNoteImage: async () => ({id: "image", storagePath: "path", downloadUrl: "url"}),
    runTransaction: async (_db, work) => {
      const index = transactions++;
      const result = await work({get: async (target) => ({exists: () => true, data: () => target.path === "upload" ? {} : current}),
        update: (_target, data) => {current = {...current, ...data};}, delete: () => {deleted++;}});
      if (index === 0) throw new Error("lost acknowledgement");
      return result;
    },
  });
  await assert.rejects(sdk.saveTacticalNote("team", null, {title: "指導", description: "", assigneeUids: [], clips: [], tasks: {}, sourceProjectId: "", images: [{id: "image", pending: true}]}, "投稿者", []), /lost acknowledgement/);
  assert.equal(current.draft, false); assert.equal(current.images.length, 1); assert.equal(deleted, 0);
});
test("reclamation claims block a pending-image commit, and sub-millisecond edits are detected", async () => {
  const {timestampsEqual} = utilities;
  assert.equal(timestampsEqual({seconds: 1, nanoseconds: 10}, {seconds: 1, nanoseconds: 20}), false);
  let writes = 0;
  const note = {title: "指導", description: "", assigneeUids: [], clips: [], tasks: {}, sourceProjectId: "", images: [{id: "old"}], contentVersion: 1};
  const sdk = services({doc: (...args) => ({id: "note", path: args.includes("attachmentUploads") ? "upload" : "parent"}),
    getDoc: async () => ({exists: () => true, data: () => note}),
    uploadTacticalNoteImage: async () => ({id: "image", storagePath: "path", downloadUrl: "url"}),
    runTransaction: async (_db, work) => work({get: async (ref) => ({exists: () => true, data: () => ref.path === "upload" ? {cleanupClaimedAt: "time"} : note}), update: () => {writes++;}}),
  });
  await assert.rejects(sdk.saveTacticalNote("team", "note", {...note, images: [{id: "image", pending: true}]}, "投稿者", []), /期限切れ/);
  assert.equal(writes, 0);
});
