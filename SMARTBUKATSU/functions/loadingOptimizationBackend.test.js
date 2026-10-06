const test = require("node:test");
const assert = require("node:assert/strict");
const { createLoadingOptimizationBackend } = require("./loadingOptimizationBackend");
const { stableStringify } = require("./loadingOptimizationCore");

const TEAM = "synthetic-team";
const base = `teams/${TEAM}`;
const statePath = `${base}/loadingOptimization/state`;
const summaryPath = (uid) => `${base}/loadingSummaries/${uid}`;
const entryPath = (kind, id) => `${base}/loadingEntries/${kind}_${id}`;
class SyntheticTimestamp {
  constructor(value) { this.value = value; }
  toMillis() { return this.value; }
}
class SyntheticFieldPath {
  constructor(...parts) { this.parts = parts; }
  static documentId() { return new SyntheticFieldPath("__name__"); }
}
class SyntheticHttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const copy = (value) => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(copy);
  return Object.assign(Object.create(Object.getPrototypeOf(value)), Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])));
};
const fieldValue = (value, field, id) => {
  const parts = field instanceof SyntheticFieldPath ? field.parts : String(field).split(".");
  return parts[0] === "__name__" ? id : parts.reduce((current, part) => current?.[part], value);
};

// This harness counts the SDK operations made by the actual backend. The real
// Emulator suite owns Firestore's retry, indexing, and security-rule behavior.
function harness(options = {}) {
  const documents = new Map(), trace = [], logs = [];
  let transactionTail = Promise.resolve();
  const write = (ref, operation, data, settings) => {
    trace.push({ type: "write", path: ref.path, operation });
    if (operation === "delete") documents.delete(ref.path);
    else documents.set(ref.path, settings?.merge || operation === "update" ? { ...copy(documents.get(ref.path) || {}), ...copy(data) } : copy(data));
  };
  const snapshot = (ref) => {
    const value = copy(documents.get(ref.path));
    return { id: ref.id, ref, exists: value !== undefined, data: () => copy(value), get: (field) => fieldValue(value, field, ref.id) };
  };
  const readDocument = async (ref) => {
    trace.push({ type: "read", path: ref.path });
    await options.onRead?.(ref.path, documents);
    return snapshot(ref);
  };
  class DocumentReference {
    constructor(path) { this.path = path; this.id = path.split("/").at(-1); }
    collection(name) { return new Query(`${this.path}/${name}`); }
    get() { return readDocument(this); }
    async set(data, settings) { write(this, "set", data, settings); }
    async update(data) { write(this, "update", data); }
    async delete() { write(this, "delete"); }
  }
  class Query {
    constructor(path, filters = [], orders = [], pageLimit = Infinity, cursor = null) {
      Object.assign(this, { path, filters, orders, pageLimit, cursor });
    }
    doc(id) { return new DocumentReference(`${this.path}/${id}`); }
    where(field, operation, value) { return new Query(this.path, [...this.filters, [field, operation, value]], this.orders, this.pageLimit, this.cursor); }
    orderBy(field, direction = "asc") { return new Query(this.path, this.filters, [...this.orders, [field, direction]], this.pageLimit, this.cursor); }
    limit(count) { return new Query(this.path, this.filters, this.orders, count, this.cursor); }
    startAfter(cursor) { return new Query(this.path, this.filters, this.orders, this.pageLimit, cursor); }
    async get() {
      let items = [...documents.keys()].filter((path) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes("/")).map((path) => snapshot(new DocumentReference(path)));
      items = items.filter((item) => this.filters.every(([field, operation, value]) => {
        const actual = fieldValue(item.data(), field, item.id);
        if (operation === "==") return actual === value;
        if (operation === "!=") return actual !== undefined && actual !== value;
        if (operation === "array-contains") return (actual || []).includes(value);
        throw new Error(`Unsupported synthetic query operator: ${operation}`);
      }));
      const comparable = (value) => value?.toMillis?.() ?? value;
      items.sort((left, right) => {
        for (const [field, direction] of this.orders) {
          const a = comparable(fieldValue(left.data(), field, left.id)), b = comparable(fieldValue(right.data(), field, right.id));
          if (a !== b) return (a < b ? -1 : 1) * (direction === "desc" ? -1 : 1);
        }
        return left.id.localeCompare(right.id);
      });
      if (this.cursor) {
        const cursorId = typeof this.cursor === "string" ? this.cursor : this.cursor.id;
        const position = items.findIndex((item) => item.id === cursorId);
        items = items.slice(position + 1);
      }
      items = items.slice(0, this.pageLimit);
      trace.push({ type: "query", path: this.path, count: Math.max(1, items.length), filters: this.filters });
      return { docs: items, size: items.length, empty: items.length === 0 };
    }
  }
  const firestore = {
    collection: (name) => new Query(name),
    async getAll(...refs) { trace.push({ type: "getAll", count: refs.length }); return Promise.all(refs.map(readDocument)); },
    async runTransaction(callback) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      const pending = [];
      const transaction = {
        get: (target) => target instanceof Query ? target.get() : readDocument(target),
        getAll: (...refs) => Promise.all(refs.map(readDocument)),
        set: (ref, data, settings) => { pending.push([ref, "set", data, settings]); return transaction; },
        update: (ref, data) => { pending.push([ref, "update", data]); return transaction; },
        delete: (ref) => { pending.push([ref, "delete"]); return transaction; },
      };
      try {
        const result = await callback(transaction);
        pending.forEach((args) => write(...args));
        return result;
      } finally { release(); }
    },
  };
  const backend = createLoadingOptimizationBackend({ firestore,
    FieldValue: { serverTimestamp: () => new SyntheticTimestamp(999) },
    FieldPath: SyntheticFieldPath, HttpsError: SyntheticHttpsError,
    logger: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  });
  const seed = (path, data) => { documents.set(path, copy(data)); };
  const members = options.members || [{ uid: "a", name: "A", profileKey: "A", role: "member", blockedUserUids: [] }];
  seed(base, { name: "Synthetic team", channels: [] });
  seed(statePath, { ready: true, enabled: true, separateReads: false, schemaVersion: 1, status: "ready", preparationId: "revision-1", contextVersion: 1, contextRevision: "revision-1", contextShardCount: 1 });
  seed(`${base}/system/loadingContext_0`, { revision: "revision-1", payload: JSON.stringify({ members, channels: [] }) });
  for (const member of members) { seed(`${base}/members/${member.uid}`, { name: member.name, role: member.role }); seed(`users/${member.uid}`, { name: member.name }); }
  const eventSnapshot = (data) => ({ exists: data !== null, data: () => copy(data) });
  const event = (id, before, after) => ({ params: { teamId: TEAM, documentId: id }, data: { before: eventSnapshot(before), after: eventSnapshot(after) } });
  const counts = () => ({ reads: trace.filter((item) => item.type === "read").length,
    writes: trace.filter((item) => item.type === "write").length,
    queries: trace.filter((item) => item.type === "query").length,
    getAll: trace.filter((item) => item.type === "getAll").length });
  return { backend, documents, trace, logs, seed, event, members, counts, reset: () => { trace.length = 0; logs.length = 0; } };
}

test("disabled summaries read only their state and never load a roster or users", async () => {
  for (const state of [{ ready: true, enabled: false, status: "ready" }, { ready: false, enabled: true, status: "waiting" }]) {
    const h = harness(); h.seed(statePath, state);
    await h.backend.handleContent("notices", h.event("notice", null, { readBy: [] }));
    assert.deepEqual(h.counts(), { reads: 1, writes: 0, queries: 0, getAll: 0 });
    assert.deepEqual(h.trace.map((item) => item.path), [statePath]);
    const metric = h.logs.find(([message]) => message === "loading_optimization_metrics")?.[1];
    assert.ok(metric);
    assert.equal(metric.reads, 1); assert.equal(metric.writes, 0); assert.equal(metric.queries, 0);
    assert.deepEqual(Object.keys(metric).sort(), ["operation", "reads", "writes", "queries", "retries", "skipped", "contextRebuilds", "latestSearches", "durationMs"].sort());
    for (const [name, value] of Object.entries(metric)) if (name !== "operation") assert.equal(typeof value, "number", name);
  }
});

test("cached context has a constant two-document cost and is isolated by revision", async () => {
  const h = harness({ members: Array.from({ length: 50 }, (_, index) => ({ uid: `m${index}`, name: `Member ${index}`, profileKey: `Member ${index}`, role: "member", blockedUserUids: [] })) });
  const context = await h.backend.context(TEAM);
  assert.equal(context.members.length, 50);
  assert.deepEqual(h.counts(), { reads: 2, writes: 0, queries: 0, getAll: 0 });
  assert.deepEqual(h.trace.map((item) => item.path), [statePath, `${base}/system/loadingContext_0`]);
});

test("notice body and report comments or attachments do not perform Firestore work", async () => {
  const cases = [
    ["notices", { readBy: ["A"], title: "old" }, { readBy: ["A"], title: "new" }],
    ["dailyReports", { authorUid: "a", fatigue: 3, comments: [] }, { authorUid: "a", fatigue: 3, comments: [{ content: "Synthetic comment" }], attachments: [{ storagePath: "synthetic" }] }],
    ["workspacePosts", { authorUid: "a", content: "Synthetic", visibleToUids: ["a"], readByUids: [], replies: [{ id: "r", authorUid: "a", content: "Reply", stamps: [] }] },
      { authorUid: "a", content: "Synthetic", visibleToUids: ["a"], readByUids: ["a"], stamps: ["Synthetic"], replies: [{ id: "r", authorUid: "a", content: "Reply", stamps: ["Synthetic"] }] }],
  ];
  for (const [kind, before, after] of cases) {
    const h = harness(); await h.backend.handleContent(kind, h.event("document", before, after));
    assert.deepEqual(h.counts(), { reads: 0, writes: 0, queries: 0, getAll: 0 }, kind);
  }
});

test("single notice change reads cached references and only the affected live identity", async () => {
  const members = Array.from({ length: 50 }, (_, index) => ({ uid: `m${index}`, name: `Member ${index}`, profileKey: `Member ${index}`, role: "member", blockedUserUids: [] }));
  const h = harness({ members }), readBy = members.slice(1).map((member) => member.profileKey);
  h.seed(`${base}/notices/notice`, { readBy });
  await h.backend.process(TEAM, "notices", "notice");
  assert.equal(h.documents.get(summaryPath("m0")).unreadNoticeCount, 1);
  assert.deepEqual(h.counts(), { reads: 8, writes: 2, queries: 0, getAll: 0 });
  assert.equal(h.trace.filter((item) => item.path.includes("/members/")).length, 1);
  assert.equal(h.trace.filter((item) => item.path.startsWith("users/")).length, 1);
  const metric = h.logs.find(([message]) => message === "loading_optimization_metrics")?.[1];
  assert.equal(metric.reads, 8); assert.equal(metric.writes, 2); assert.equal(metric.queries, 0);
  assert.equal(JSON.stringify(metric).includes(TEAM), false);
  h.reset(); await h.backend.process(TEAM, "notices", "notice");
  assert.equal(h.documents.get(summaryPath("m0")).unreadNoticeCount, 1);
  assert.equal(h.counts().writes, 0);
  assert.equal(h.counts().queries, 0);
});

test("missing membership or user prevents late cached context from recreating a summary", async () => {
  for (const removedPath of [`${base}/members/a`, "users/a"]) {
    const h = harness(); h.documents.delete(removedPath); h.seed(`${base}/notices/notice`, { readBy: [] });
    await h.backend.process(TEAM, "notices", "notice");
    assert.equal(h.documents.has(summaryPath("a")), false, removedPath);
    assert.equal(h.documents.get(entryPath("notices", "notice"))?.contributions?.a, undefined);
    assert.ok(h.trace.some((item) => item.type === "read" && item.path === removedPath));
  }
});

test("late notice events reread the source and duplicates do not double-count", async () => {
  const h = harness(); h.seed(`${base}/notices/notice`, { readBy: ["A"] });
  await h.backend.handleContent("notices", h.event("notice", null, { readBy: [] }));
  assert.equal(h.documents.get(summaryPath("a"))?.unreadNoticeCount || 0, 0);
  h.seed(`${base}/notices/notice`, { readBy: [] });
  await Promise.all([h.backend.process(TEAM, "notices", "notice"), h.backend.process(TEAM, "notices", "notice")]);
  assert.equal(h.documents.get(summaryPath("a")).unreadNoticeCount, 1);
  h.documents.delete(`${base}/notices/notice`);
  await h.backend.handleContent("notices", h.event("notice", { readBy: [] }, { readBy: ["A"] }));
  assert.equal(h.documents.get(summaryPath("a")).unreadNoticeCount, 0);
});

test("a supplied old preparation context cannot write a later revision", async () => {
  const h = harness(), context = await h.backend.context(TEAM);
  h.seed(statePath, { ...h.documents.get(statePath), preparationId: "revision-2", contextRevision: "revision-2" });
  h.seed(`${base}/notices/notice`, { readBy: [] }); h.reset();
  await h.backend.process(TEAM, "notices", "notice", context);
  assert.deepEqual(h.counts(), { reads: 1, writes: 0, queries: 0, getAll: 0 });
});

test("normal latest-report update performs no author query and omits heavy fields", async () => {
  const h = harness(), previous = { id: "old", authorUid: "a", author: "A", createdAt: new SyntheticTimestamp(100), fatigue: 2 };
  h.seed(`${base}/latestDailyReports/a`, previous);
  const report = { authorUid: "a", author: "A", createdAt: new SyntheticTimestamp(200), date: "2026-10-06", fatigue: 4,
    comments: [{ content: "Synthetic comment" }], attachments: [{ storagePath: "synthetic" }], content: "Synthetic body" };
  h.seed(`${base}/dailyReports/new`, report);
  await h.backend.handleContent("dailyReports", h.event("new", null, report));
  const latest = h.documents.get(`${base}/latestDailyReports/a`);
  assert.equal(latest.id, "new"); assert.equal(latest.fatigue, 4);
  assert.equal(latest.comments, undefined); assert.equal(latest.attachments, undefined); assert.equal(latest.content, undefined);
  assert.equal(h.counts().queries, 0);
  assert.equal(h.counts().getAll, 0);
});

test("deleting the latest report queries both author formats and keeps the remaining report", async () => {
  const h = harness(), older = { authorUid: "a", author: "A", createdAt: new SyntheticTimestamp(100), date: "2026-10-05", fatigue: 2 }, newest = { authorUid: "a", author: "A", createdAt: new SyntheticTimestamp(200), date: "2026-10-06", fatigue: 4 };
  h.seed(`${base}/dailyReports/old`, older); h.seed(`${base}/dailyReports/new`, newest);
  await h.backend.process(TEAM, "dailyReports", "new");
  h.documents.delete(`${base}/dailyReports/new`); h.reset();
  await h.backend.handleContent("dailyReports", h.event("new", newest, null));
  assert.equal(h.documents.get(`${base}/latestDailyReports/a`).id, "old");
  assert.equal(h.counts().queries, 2);
  assert.deepEqual(h.trace.filter((item) => item.type === "query").map((item) => item.filters[0][0]), ["authorUid", "author"]);
});

test("delayed older-report events cannot replace the latest report or start a search", async () => {
  const h = harness(), older = { authorUid: "a", author: "A", createdAt: new SyntheticTimestamp(100), fatigue: 2 }, newest = { id: "new", authorUid: "a", author: "A", createdAt: new SyntheticTimestamp(200), fatigue: 4 };
  h.seed(`${base}/latestDailyReports/a`, newest); h.seed(`${base}/dailyReports/old`, older);
  await h.backend.handleContent("dailyReports", h.event("old", null, older));
  assert.equal(h.documents.get(`${base}/latestDailyReports/a`).id, "new");
  assert.equal(h.counts().queries, 0);
  assert.equal(h.trace.some((item) => item.type === "write" && item.path === `${base}/latestDailyReports/a`), false);
});

test("latest fallback pages past deleted records and accepts legacy author names", async () => {
  const h = harness();
  for (let index = 0; index < 25; index++) h.seed(`${base}/dailyReports/deleted-${index}`, { author: "A", createdAt: new SyntheticTimestamp(200 + index), status: "deleted" });
  h.seed(`${base}/dailyReports/legacy`, { author: "A", createdAt: new SyntheticTimestamp(100), fatigue: 2, comments: [{ content: "Synthetic" }] });
  await h.backend.refreshLatest(TEAM, h.members[0], "revision-1");
  const latest = h.documents.get(`${base}/latestDailyReports/a`);
  assert.equal(latest.id, "legacy"); assert.equal(latest.authorUid, "a"); assert.equal(latest.comments, undefined);
  assert.equal(h.counts().queries, 3);
  const metric = h.logs.find(([message]) => message === "loading_optimization_metrics")?.[1];
  assert.equal(metric.reads, h.counts().reads + h.trace.filter((item) => item.type === "query").reduce((sum, item) => sum + item.count, 0));
  assert.equal(metric.writes, h.counts().writes); assert.equal(metric.queries, 3); assert.equal(metric.latestSearches, 1);
});

test("reader-only events maintain account-cleanup anchors without source or roster reads", async () => {
  const h = harness(), event = h.event("post", { readers: {} }, { readers: { a: true } });
  event.params.postId = "post";
  await h.backend.handleReadState(event);
  assert.deepEqual(h.documents.get(`users/a/loadingReadTeams/${TEAM}`), { teamId: TEAM });
  assert.deepEqual(h.counts(), { reads: 3, writes: 1, queries: 0, getAll: 0 });
  assert.equal(h.trace.some((item) => item.path.includes("workspacePosts") || item.path.includes("/members/") || item.path === statePath), false);
  h.reset(); await h.backend.handleReadState(event);
  assert.deepEqual(h.counts(), { reads: 3, writes: 0, queries: 0, getAll: 0 });
});

test("reader-only late events cannot recreate an anchor for a deleted user", async () => {
  const h = harness(); h.documents.delete("users/a");
  const event = h.event("post", { readers: {} }, { readers: { a: true } }); event.params.postId = "post";
  await h.backend.handleReadState(event);
  assert.equal(h.documents.has(`users/a/loadingReadTeams/${TEAM}`), false);
  assert.deepEqual(h.counts(), { reads: 3, writes: 0, queries: 0, getAll: 0 });
});

function nearLimitMembers(overLimit = false) {
  const members = Array.from({ length: 16 }, (_, index) => ({ uid: `large${index}`, name: "あ".repeat(43600) + index, role: index ? "member" : "owner" }));
  const projection = () => ({ members: members.map((member) => ({ ...member, profileKey: member.name, staffScope: null, assignedStaff: null, blockedUserUids: [] })), channels: [] });
  const max = 4 * 1024 * 1024, initial = Buffer.byteLength(stableStringify(projection()), "utf8");
  const target = max - ((max - initial) % 2), difference = target - initial;
  members.at(-1).name += "あ".repeat(Math.floor(difference / 6)) + "x".repeat((difference % 6) / 2);
  if (overLimit) members.at(-1).name += "overflow";
  for (const member of members) member.profileKey = member.name;
  return members;
}

test("near-four-MiB multi-byte references split safely and reuse all seventeen shards", async () => {
  const members = nearLimitMembers(), h = harness({ members });
  h.seed(`${base}/system/loadingContext_0`, { revision: "revision-1", payload: JSON.stringify({ members: [], channels: [] }) });
  h.seed(statePath, { ...h.documents.get(statePath), ready: false, enabled: false, status: "preparing", contextRevision: null });
  const context = await h.backend.context(TEAM), state = h.documents.get(statePath);
  assert.equal(state.contextShardCount, 17);
  const records = Array.from({ length: state.contextShardCount }, (_, index) => h.documents.get(`${base}/system/loadingContext_${index}`));
  for (const record of records) {
    assert.ok(Buffer.byteLength(record.payload, "utf8") <= 256 * 1024);
    assert.equal(record.payload.includes("\uFFFD"), false);
  }
  const payload = records.map((record) => record.payload).join("");
  assert.ok(Buffer.byteLength(payload, "utf8") <= 4 * 1024 * 1024);
  assert.ok(Buffer.byteLength(payload, "utf8") >= 4 * 1024 * 1024 - 1);
  assert.deepEqual(context.members.map((member) => [member.uid, member.name]), [...members].sort((a, b) => a.uid.localeCompare(b.uid)).map((member) => [member.uid, member.name]));
  h.reset(); const reused = await h.backend.context(TEAM);
  assert.deepEqual(reused, context);
  assert.deepEqual(h.counts(), { reads: 18, writes: 0, queries: 0, getAll: 0 });
  assert.equal(h.logs[0][1].contextRebuilds, 0);
});

test("over-limit preparation stays disabled and an enable request cannot skip preparation", async () => {
  const h = harness({ members: nearLimitMembers(true) });
  h.seed(`${base}/system/loadingContext_0`, { revision: "revision-1", payload: JSON.stringify({ members: [], channels: [] }) });
  h.seed(statePath, { ...h.documents.get(statePath), ready: false, enabled: false, status: "preparing", contextRevision: null, desiredEnabled: false });
  await assert.rejects(h.backend.context(TEAM), { code: "resource-exhausted" });
  assert.equal(h.documents.get(statePath).enabled, false);
  assert.equal(h.documents.get(statePath).contextRevision, null);
  const result = await h.backend.configureCallable({ auth: { uid: "large0" }, data: { teamId: TEAM, enabled: true } });
  assert.equal(result.enabled, false); assert.equal(result.status, "preparing");
  assert.equal(h.documents.get(statePath).enabled, false);
  assert.equal(h.documents.get(statePath).ready, false);
  await assert.rejects(h.backend.context(TEAM), { code: "resource-exhausted" });
});

test("over-limit live reference changes invalidate the old enabled context", async () => {
  const members = nearLimitMembers(true), h = harness({ members }), before = { name: "Previous synthetic name", role: "member" }, after = { name: members.at(-1).name, role: "member" };
  h.seed(`${base}/system/loadingContext_0`, { revision: "revision-1", payload: JSON.stringify({ members: [{ uid: "large0", name: "Previous synthetic name", profileKey: "Previous synthetic name", role: "owner" }], channels: [] }) });
  await assert.rejects(h.backend.handleMembership(h.event(members.at(-1).uid, before, after)), { code: "resource-exhausted" });
  const state = h.documents.get(statePath);
  assert.equal(state.enabled, false); assert.equal(state.ready, false); assert.equal(state.status, "preparing");
  assert.equal(state.contextRevision, null); assert.notEqual(state.preparationId, "revision-1");
  await assert.rejects(h.backend.context(TEAM), { code: "resource-exhausted" });
});

test("numeric UID-less legacy dates do not displace timestamp reports during updates or preparation", async () => {
  const h = harness(), typed = { authorUid: "a", createdAt: new SyntheticTimestamp(200), fatigue: 4 }, legacy = { author: "A", createdAt: 999999999999999, fatigue: 2 };
  h.seed(`${base}/dailyReports/typed`, typed); h.seed(`${base}/dailyReports/legacy`, legacy);
  h.seed(`${base}/latestDailyReports/a`, { ...typed, id: "typed", author: "A" });
  await h.backend.handleContent("dailyReports", h.event("legacy", null, legacy));
  assert.equal(h.documents.get(`${base}/latestDailyReports/a`).id, "typed");
  assert.equal(h.counts().queries, 2);
  h.reset(); await h.backend.refreshLatest(TEAM, h.members[0], "revision-1");
  assert.equal(h.documents.get(`${base}/latestDailyReports/a`).id, "typed");
  assert.equal(h.counts().queries, 2);
});

test("reports with missing creation dates are not promoted to latest", async () => {
  const h = harness(), old = { authorUid: "a", author: "A", createdAt: new SyntheticTimestamp(200), fatigue: 4 }, undated = { authorUid: "a", author: "A", fatigue: 2 };
  h.seed(`${base}/latestDailyReports/a`, { ...old, id: "typed" });
  h.seed(`${base}/dailyReports/undated`, undated);
  await h.backend.handleContent("dailyReports", h.event("undated", null, undated));
  assert.equal(h.documents.get(`${base}/latestDailyReports/a`).id, "typed");
  assert.equal(h.counts().queries, 0);
});
