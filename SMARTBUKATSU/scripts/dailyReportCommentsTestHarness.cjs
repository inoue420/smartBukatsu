const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { parse } = require("@babel/parser");

// Run the actual callable and trigger, replacing only external Firebase APIs.
function loadSafetyBackend(firestore, Timestamp) {
  const source = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
  const names = new Set(["SUPPORT_CASE_COLLECTION", "ACTIVE_SUPPORT_CASE_STATUSES", "SAFETY_REPORT_REASONS",
    "SAFETY_REPORT_SUBJECTS", "SAFETY_REPORT_TARGET_TYPES", "normalizeCaseText", "getEvidenceValue",
    "getReplyEvidence", "getWorkspacePostEvidence", "getDailyReportCommentEvidence",
    "getDailyReportEvidence", "getDailyReportDocumentFingerprint", "getAuthenticatedTeamMember", "dailyReportCommentEventAllowed", "createSupportCaseWithEvidence"]);
  const exports = {};
  const parts = parse(source).program.body.filter(node =>
    (node.type === "VariableDeclaration" && node.declarations.some(d => names.has(d.id.name))) ||
    (node.type === "ExpressionStatement" && node.expression.type === "AssignmentExpression" &&
      node.expression.left.type === "MemberExpression" &&
      ["submitSafetyReport", "trackReportedDailyReportChanges"].includes(node.expression.left.property.name)));
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  vm.runInNewContext(parts.map(node => source.slice(node.start, node.end)).join("\n"), {
    // Admin SDK checks Promise identity; adapt callbacks across the VM boundary.
    firestore: { collection: name => firestore.collection(name), batch: () => firestore.batch(),
      runTransaction: callback => firestore.runTransaction(async transaction => callback(transaction)) },
    Timestamp, exports, HttpsError, logger: { info() {} },
    onCall: (_options, fn) => fn, onDocumentWritten: (_options, fn) => fn,
  });
  return exports;
}

function memoryFirestore() {
  const documents = new Map(), stats = { reads: 0, queries: 0, writes: 0, retries: 0 };
  let nextId = 0, beforeCommit = null;
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const snap = ref => ({ ref, id: ref.id, exists: documents.has(ref.path), data: () => clone(documents.get(ref.path)) });
  function reference(location, filters = []) {
    return { path: location, id: location.split("/").at(-1), filters,
      collection: name => reference(`${location}/${name}`),
      doc: id => reference(`${location}/${id || `generated-${++nextId}`}`),
      where: (field, _operator, value) => reference(location, [...filters, [field, value]]),
      async get() {
        stats.reads++;
        if (!filters.length) return snap(this);
        stats.queries++;
        const docs = [...documents.keys()].filter(key => key.startsWith(`${location}/`) &&
          key.split("/").length === location.split("/").length + 1 &&
          filters.every(([field, value]) => documents.get(key)?.[field] === value)).map(key => snap(reference(key)));
        return { docs, size: docs.length };
      },
    };
  }
  const firestore = {
    collection: reference,
    batch() { const writes = []; return { set: (ref, value) => writes.push([ref.path, value]),
      async commit() { writes.forEach(([key, value]) => { documents.set(key, clone(value)); stats.writes++; }); } }; },
    async runTransaction(callback) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const reads = new Map(), writes = [];
        const result = await callback({
          async get(ref) { reads.set(ref.path, JSON.stringify(documents.get(ref.path))); return ref.get(); },
          set(ref, value) { writes.push([ref.path, value]); },
          create(ref, value) { writes.push([ref.path, value]); },
        });
        if (beforeCommit) { const hook = beforeCommit; beforeCommit = null; await hook(); }
        if ([...reads].some(([key, value]) => JSON.stringify(documents.get(key)) !== value)) { stats.retries++; continue; }
        writes.forEach(([key, value]) => { documents.set(key, clone(value)); stats.writes++; });
        return result;
      }
      throw new Error("Synthetic transaction did not settle");
    },
  };
  class Timestamp { constructor(value) { this.value = value; } toMillis() { return this.value; }
    static now() { return new Timestamp(1000); } static fromMillis(value) { return new Timestamp(value); } }
  return { firestore, documents, stats, Timestamp, reference,
    beforeCommit(fn) { beforeCommit = fn; }, snapshot: location => snap(reference(location)) };
}
function loadNotificationBackend(firestore, Timestamp) {
  const source = fs.readFileSync(path.join(__dirname, "../functions/notifications.js"), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, console,
    fetch: () => { throw new Error("Notification tests must not use the network"); },
    require(name) {
      if (name === "firebase-admin/firestore") return { getFirestore: () => firestore, Timestamp };
      if (name === "firebase-functions/v2/https") return { onCall: (_options, fn) => fn };
      if (name === "firebase-functions/v2/firestore") return { onDocumentWritten: (_options, fn) => fn };
      if (name === "firebase-functions/v2/scheduler") return { onSchedule: (_options, fn) => fn };
      if (name === "firebase-functions/logger") return { info() {}, warn() {}, error() {} };
      if (name === "./notificationCore") return require("../functions/notificationCore");
      if (name === "node:crypto") return require(name);
      throw new Error(`Unexpected notification dependency: ${name}`);
    },
  });
  return module.exports;
}
function loadCommentSettingsService(db, sdk) {
  const source = fs.readFileSync(path.join(__dirname, "../src/services/firestoreService.js"), "utf8");
  const node = parse(source, { sourceType: "module" }).program.body.find(item =>
    item.type === "ExportNamedDeclaration" && item.declaration?.id?.name === "updateDailyReportCommentSettings").declaration;
  return new Function("db", "doc", "runTransaction", "serverTimestamp",
    source.slice(node.start, node.end) + "\nreturn updateDailyReportCommentSettings;")(
      db, sdk.doc, sdk.runTransaction, sdk.serverTimestamp);
}
module.exports = { loadSafetyBackend, loadNotificationBackend, loadCommentSettingsService, memoryFirestore };
