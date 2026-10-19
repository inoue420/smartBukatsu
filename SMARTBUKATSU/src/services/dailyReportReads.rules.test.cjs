const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { transformSync } = require("@babel/core");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8189" || process.env.GCLOUD_PROJECT !== "demo-loading-optimization") throw new Error("Dedicated local emulator required");
test("real SDK: scoped seven-day reads, old links, unreviewed alerts and latest reports", async () => {
  const rules = await fetch("http://127.0.0.1:8189/emulator/v1/projects/demo-loading-optimization:securityRules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] } }) });
  assert.equal(rules.ok, true);
  const serverApp = adminApp.initializeApp({ projectId: "demo-loading-optimization" }, "scoped-test"), db = admin.getFirestore(serverApp);
  const team = "scope-" + Date.now(), clients = [];
  const client = (uid) => { const app = initializeApp({ projectId: "demo-loading-optimization", apiKey: "emulator-only", appId: "emulator-only" }, "scope-" + uid);
    const value = sdk.getFirestore(app); sdk.connectFirestoreEmulator(value, "127.0.0.1", 8189, { mockUserToken: { sub: uid } }); clients.push({ app, db: value }); return value; };
  const a = client("a");
  const modules = { "firebase/firestore": sdk, "../firebase": { db: a }, "./firestoreSubscription": { measuredOnSnapshot: (_name, target, next, error, options) => options ? sdk.onSnapshot(target, options, next, error) : sdk.onSnapshot(target, next, error) }, "../utils/historyLoading": require("../utils/historyLoading") };
  const firstSnapshot = (subscribe, label) => new Promise((resolve, reject) => {
    const timeout = new Error("Snapshot timed out: " + label); let stop;
    const timer = setTimeout(() => { stop?.(); reject(timeout); }, 30000);
    stop = subscribe((value) => { if (value.fromCache) return; clearTimeout(timer); stop?.(); resolve(value); }, (error) => { clearTimeout(timer); stop?.(); reject(error); });
  });
  try {

      const scopeTeam = team + "-scoped", target = db.collection("teams").doc(scopeTeam);
      const roster = { Coach: { uid: "owner", role: "owner" }, Admin: { uid: "admin", role: "admin" },
        Staff: { uid: "staff", role: "staff", staffScope: "assigned" }, A: { uid: "a", role: "member", assignedStaff: "Staff" }, B: { uid: "b", role: "member" } };
      await target.set({ name: "Synthetic scoped reads" });
      for (const p of Object.values(roster)) await target.collection("members").doc(p.uid).set(p);
      for (const item of [
        { id: "mine", authorUid: "a", author: "A", date: "2026-10-18", createdAt: 30 },
        { id: "legacy", author: "A", date: "2026/10/12", createdAt: 20 },
        { id: "other", authorUid: "b", author: "B", date: "2026-10-18", createdAt: 40 },
        { id: "same-name", authorUid: "b", author: "A", date: "2026-10-18", createdAt: 50 },
        { id: "public", authorUid: "b", author: "B", date: "2026/10/18", sharedWith: "all", createdAt: 60 },
        { id: "old-alert", authorUid: "a", author: "A", date: "2020-01-01", createdAt: 10, fatigue: 5 },
        { id: "deleted-head", authorUid: "a", author: "A", date: "2026-10-18", createdAt: 80, status: "deleted" },
      ]) await target.collection("dailyReports").doc(item.id).set({ isReviewed: false, ...item, createdAt: admin.Timestamp.fromMillis(item.createdAt) });
      const scopeTools = require("../utils/dailyReportScope");
      const compiled = transformSync(fs.readFileSync(path.join(__dirname, "dailyReportReadService.js"), "utf8"), { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"] }).code;
      const scopedModule = { exports: {} }, scopedModules = { ...modules, "../utils/dailyReportScope": scopeTools };
      vm.runInThisContext(`(function(require, module, exports) {${compiled}\n})`)((name) => scopedModules[name], scopedModule, scopedModule.exports);
      const scoped = scopedModule.exports, self = scopeTools.dailyReportScope("a", roster), coach = scopeTools.dailyReportScope("staff", roster);
      const range = { start: "2026-10-12", end: "2026-10-18" };
      const seven = await firstSnapshot((next, error) => scoped.subscribeDailyReportHistory(scopeTeam, { scope: self, ...range }, next, error), "scoped student seven days");
      assert.deepEqual(seven.items.map((r) => r.id).sort(), ["legacy", "mine", "public"]);
      const assigned = await firstSnapshot((next, error) => scoped.subscribeDailyReportHistory(scopeTeam, { scope: coach, ...range }, next, error), "assigned coach seven days");
      assert.deepEqual(assigned.items.map((r) => r.id).sort(), ["legacy", "mine", "public"]);
      for (const uid of ["admin", "staff", "a", "b"]) await assert.rejects(firstSnapshot((next, error) => scoped.subscribeDailyReportHistory(scopeTeam, { scope: scopeTools.dailyReportScope(uid, roster) }, next, error)), (error) => error.code === "permission-denied");
      const full = await firstSnapshot((next, error) => scoped.subscribeDailyReportHistory(scopeTeam, { scope: scopeTools.dailyReportScope("owner", roster) }, next, error), "owner full history");
      assert.ok(full.items.some((r) => r.id === "old-alert")); assert.equal(full.items.length, 6);
      const detail = await firstSnapshot((next, error) => scoped.subscribeDailyReportDocument(scopeTeam, "dailyReports", "old-alert", (item) => next({ item }), error, self), "old own notification");
      assert.equal(detail.item.id, "old-alert");
      const forbidden = await firstSnapshot((next, error) => scoped.subscribeDailyReportDocument(scopeTeam, "dailyReports", "other", (item) => next({ item }), error, self), "unrelated notification");
      assert.equal(forbidden.item, null);
      const alerts = await firstSnapshot((next, error) => scoped.subscribeUnreviewedReports(scopeTeam, coach, (items) => next({ items }), error), "old unreviewed alerts");
      assert.ok(alerts.items.some((r) => r.id === "old-alert")); assert.ok(alerts.items.every((r) => r.authorUid ? r.authorUid === "a" : r.author === "A"));
      const latest = await firstSnapshot((next, error) => scoped.subscribeRosterLatestReports(scopeTeam, { A: roster.A }, (items) => next({ items }), error), "roster latest deleted head");
      assert.equal(latest.items[0].id, "mine");
  } finally { await Promise.all(clients.map(async ({app,db}) => { await sdk.terminate(db); await deleteApp(app); })); await db.terminate(); await adminApp.deleteApp(serverApp); }
});
