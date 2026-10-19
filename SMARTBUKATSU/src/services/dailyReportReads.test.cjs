const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { transformSync } = require("@babel/core");
const { dailyReportScope, canReadDailyReport } = require("../utils/dailyReportScope");
const profiles = { Coach: { uid: "owner", role: "owner" }, Admin: { uid: "admin", role: "admin" },
  Staff: { uid: "staff", role: "staff", staffScope: "assigned" }, A: { uid: "a", role: "member", assignedStaff: "Staff" },
  B: { uid: "b", role: "captain", assignedStaff: "Other" }, Parent: { uid: "g", role: "guardian" } };
function serviceHarness() {
  const calls = [];
  const sdk = Object.fromEntries(["collection", "documentId", "limit", "orderBy", "query", "where"].map((name) => [name, (...args) => ({ name, args })]));
  const code = transformSync(fs.readFileSync(path.join(__dirname, "dailyReportReadService.js"), "utf8"), { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"] }).code;
  const modules = { "firebase/firestore": sdk, "../firebase": { db: "synthetic" }, "../utils/dailyReportScope": { canReadDailyReport }, "../utils/historyLoading": require("../utils/historyLoading"),
    "./firestoreSubscription": { measuredOnSnapshot: (name, ref, next, error, options) => { const call = { name, ref, next, error, options, stops: 0 }; calls.push(call); return () => call.stops++; } } };
  const module = { exports: {} }; vm.runInNewContext(code, { exports: module.exports, module, require: (name) => modules[name], Map, Set, queueMicrotask });
  return { calls, service: module.exports, snapshot(call, rows, cached = false) { call.next({ docs: rows.map((row) => ({ id: row.id, data: () => row })), size: rows.length, metadata: { fromCache: cached } }); } };
}
const constraints = (call) => call.ref.args.slice(1).map((c) => [c.name, ...c.args]);
test("only owners can load the full history; roles retain bounded audiences and fail closed before membership resolves", () => {
  for (const uid of ["owner", "admin", "staff", "a", "b", "g"]) assert.equal(dailyReportScope(uid, profiles).canSearchAll, uid === "owner");
  assert.equal(dailyReportScope("unknown", profiles).ready, false);
  assert.deepEqual(dailyReportScope("staff", profiles).authors, [{ uid: "a", name: "A" }]);
  const own = dailyReportScope("a", profiles);
  assert.equal(canReadDailyReport(own, { authorUid: "b", author: "A" }), false, "UID must override a coincident legacy name");
  assert.equal(canReadDailyReport(own, { author: "A" }), true);
  assert.equal(canReadDailyReport(own, { authorUid: "b", sharedWith: "all" }), true);
  assert.equal(canReadDailyReport(own, { authorUid: "a", status: "deleted" }), false);
});
test("each student query has both a date bound and an own/public audience; dates from both formats merge once", () => {
  const h = serviceHarness(), results = [];
  const stop = h.service.subscribeDailyReportHistory("team", { scope: dailyReportScope("a", profiles), start: "2026-10-12", end: "2026-10-18" }, (p) => results.push(p));
  assert.equal(h.calls.length, 6);
  for (const call of h.calls) {
    const filters = constraints(call).filter((c) => c[0] === "where");
    assert.equal(filters.filter((c) => c[1] === "date").length, 2);
    assert.equal(filters.filter((c) => ["authorUid", "author", "sharedWith"].includes(c[1])).length, 1);
    h.snapshot(call, [{ id: "mine", authorUid: "a", date: "2026/10/12" }, { id: "wrong", authorUid: "b", author: "A" }, { id: "public", authorUid: "b", sharedWith: "all", date: "2026-10-18" }]);
  }
  assert.deepEqual(Array.from(results.at(-1).items, (r) => r.id), ["public", "mine"]);
  stop(); assert.ok(h.calls.every((c) => c.stops === 1));
});
test("unbounded queries reject admins, coaches, students and guardians before starting any listener", () => {
  for (const uid of ["admin", "staff", "a", "b", "g"]) {
    const h = serviceHarness(); let error;
    h.service.subscribeDailyReportHistory("team", { scope: dailyReportScope(uid, profiles) }, () => {}, (e) => { error = e; });
    assert.equal(h.calls.length, 0); assert.equal(error.code, "permission-denied");
  }
  const h = serviceHarness(); h.service.subscribeDailyReportHistory("team", { scope: dailyReportScope("owner", profiles) }, () => {}); assert.equal(h.calls.length, 1);
});
test("assigned-coach queries batch more than 30 authors without widening the audience", () => {
  const many = { ...profiles };
  for (let i = 0; i < 65; i++) many["S" + i] = { uid: "s" + i, role: "member", assignedStaff: "Staff" };
  const h = serviceHarness(); h.service.subscribeDailyReportHistory("team", { scope: dailyReportScope("staff", many), start: "2026-10-12", end: "2026-10-18" }, () => {});
  assert.equal(h.calls.length, 14);
  for (const call of h.calls) for (const [, field, op, values] of constraints(call)) if (op === "in") { assert.ok(values.length <= 30); assert.ok(!values.includes(field === "authorUid" ? "b" : "B")); }
});
test("old notification links use document-ID plus audience constraints and cannot expose another student's report", () => {
  const h = serviceHarness(), results = [];
  h.service.subscribeDailyReportDocument("team", "dailyReports", "old", (item) => results.push(item), () => {}, dailyReportScope("a", profiles));
  assert.equal(h.calls.length, 3);
  for (const call of h.calls) {
    assert.ok(constraints(call).some((c) => c[0] === "where" && c[1]?.name === "documentId" && c[3] === "old"));
    h.snapshot(call, [{ id: "old", authorUid: "b", author: "B", date: "2020-01-01" }]);
  }
  assert.equal(results.at(-1), null);
});
test("fallback alerts filter unreviewed reports and assigned authors without fetching public reports", () => {
  const h = serviceHarness(); h.service.subscribeUnreviewedReports("team", dailyReportScope("staff", profiles), () => {});
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) {
    assert.ok(constraints(call).some((c) => c.join() === "where,isReviewed,==,false"));
    assert.ok(!constraints(call).some((c) => c[1] === "sharedWith"));
  }
});
test("roster fallback gets only latest records, skips deleted heads and ignores late callbacks after unsubscribe", async () => {
  const h = serviceHarness(), results = [];
  const stop = h.service.subscribeRosterLatestReports("team", { A: profiles.A }, (items) => results.push(items));
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) { assert.ok(constraints(call).some((c) => c.join() === "limit,1")); assert.equal(call.options.includeMetadataChanges, true); }
  h.snapshot(h.calls[0], [{ id: "removed", authorUid: "a", status: "deleted", createdAt: 20 }]);
  h.snapshot(h.calls[1], []); await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(h.calls[0].stops, 1); assert.equal(h.calls.length, 3);
  h.snapshot(h.calls[2], [{ id: "removed", authorUid: "a", status: "deleted", createdAt: 20 }, { id: "older", authorUid: "a", createdAt: 10 }]);
  assert.equal(results.at(-1)[0].id, "older");
  stop(); const count = results.length; h.snapshot(h.calls[2], []); assert.equal(results.length, count);
});
