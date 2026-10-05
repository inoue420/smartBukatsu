const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { transformSync } = require("@babel/core"), { parse } = require("@babel/parser");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { createLoadingOptimizationBackend } = require("../../functions/loadingOptimizationBackend");
if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8189" || process.env.GCLOUD_PROJECT !== "demo-loading-optimization") throw new Error("These tests require the dedicated local demo emulator.");
const projectId = process.env.GCLOUD_PROJECT;
test("real emulator: preparation, idempotent summaries, old latest condition, overlap and read rules", async () => {
  const response = await fetch(`http://127.0.0.1:8189/emulator/v1/projects/${projectId}:securityRules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId }, "loading-test"), db = admin.getFirestore(serverApp);
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const backend = createLoadingOptimizationBackend({ firestore: db, FieldValue: admin.FieldValue, FieldPath: admin.FieldPath, HttpsError });
  const team = "test-" + Date.now(), ref = db.collection("teams").doc(team), clients = [];
  const client = (uid) => { const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `loading-${uid}`), value = sdk.getFirestore(app); sdk.connectFirestoreEmulator(value, "127.0.0.1", 8189, { mockUserToken: { sub: uid } }); clients.push({ app, db: value }); return value; };
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  try {
    await ref.set({ name: "Synthetic team", channels: [{ id: "general", name: "General", allowedRoleGroups: ["staff", "captain", "member", "guardian"] }] });
    for (const [uid, name, role] of [["owner", "Coach", "owner"], ["a", "A", "member"], ["b", "B", "member"], ["g", "G", "guardian"]]) { await ref.collection("members").doc(uid).set({ name, role }); await db.collection("users").doc(uid).set({ name }); }
    const a = client("a"), b = client("b"), guardian = client("g"), outsider = client("outsider");
    const writer = db.bulkWriter();
    for (let index = 0; index < 110; index++) writer.set(ref.collection("workspacePosts").doc(`p${String(index).padStart(3, "0")}`), { user: "B", authorUid: "b", content: `@A synthetic ${index}`, channel: "General", channelId: "general", readBy: ["B"], readByUids: ["b"], createdAt: admin.Timestamp.fromMillis(index + 1000), replies: [] });
    writer.set(ref.collection("notices").doc("old-notice"), { readBy: [], createdAt: admin.Timestamp.fromMillis(1) });
    writer.set(ref.collection("dailyReports").doc("old-report"), { author: "A", authorUid: "a", date: "2025-01-01", createdAt: admin.Timestamp.fromMillis(1), fatigue: 5, medicalScaleVersion: 2, isReviewed: false });
    writer.set(ref.collection("clubEvents").doc("overlap"), { date: "2026-09-30", endDate: "2026-10-02" });
    writer.set(db.collection("users").doc("a").collection("personalEvents").doc("personal"), { date: "2026-09-29", endDate: "2026-10-03" });
    await writer.close();
    await assert.rejects(backend.configureCallable({ auth: { uid: "owner" }, data: { teamId: team, enabled: true } }), { code: "failed-precondition" });
    await assert.rejects(backend.prepareCallable({ auth: { uid: "a" }, data: { teamId: team } }), { code: "permission-denied" });
    await backend.prepareCallable({ auth: { uid: "owner" }, data: { teamId: team } });
    const stateRef = ref.collection("loadingOptimization").doc("state"); let steps = 0;
    await stateRef.update({ lease: { token: "expired-test", expiresAt: 0 } });
    await backend.prepareCallable({ auth: { uid: "owner" }, data: { teamId: team } });
    assert.equal((await stateRef.get()).data().lease, null);
    while ((await stateRef.get()).data().status === "preparing") {
      assert.ok(++steps < 30, "preparation did not progress");
      await backend.handlePreparation({ params: { teamId: team }, data: { after: await stateRef.get() } });
    }
    const state = (await stateRef.get()).data(); assert.equal(state.ready, true); assert.equal(state.enabled, false); assert.equal(state.separateReads, false); assert.ok(steps >= 10);
    const summary = () => ref.collection("loadingSummaries").doc("a").get().then((item) => item.data());
    assert.equal((await summary()).workspaceNotificationUnreadCount, 110); assert.equal((await summary()).unreadNoticeCount, 1);
    assert.deepEqual((await summary()).medicalHistogram, { "0:0:5:0": 1 });
    assert.equal((await ref.collection("latestDailyReports").doc("a").get()).data().id, "old-report");
    await Promise.all([backend.process(team, "workspacePosts", "p000"), backend.process(team, "workspacePosts", "p000")]); assert.equal((await summary()).workspaceNotificationUnreadCount, 110);
    const stateDoc = (value, id = "p000") => sdk.doc(value, "teams", team, "workspacePostReadStates", id);
    const postRef = ref.collection("workspacePosts").doc("p000"), before = (await postRef.get()).data();
    const source = fs.readFileSync(path.join(__dirname, "firestoreService.js"), "utf8");
    const declarations = parse(source, { sourceType: "module" }).program.body.filter((item) => item.type === "ExportNamedDeclaration" && ["markWorkspacePostRead", "markWorkspaceNotificationState"].includes(item.declaration?.id?.name)).map((item) => source.slice(item.declaration.start, item.declaration.end)).join("\n");
    const writes = vm.runInThisContext("(function({ doc, setDoc, updateDoc, arrayUnion, serverTimestamp, db, auth }) {" + declarations + "\nreturn { markWorkspacePostRead, markWorkspaceNotificationState }; })")({ ...sdk, db: a, auth: { currentUser: { uid: "a" } } });
    await Promise.all([writes.markWorkspacePostRead(team, "p000", "a", "A", true), sdk.setDoc(stateDoc(b), { readers: { b: true }, updatedAt: sdk.serverTimestamp() }, { merge: true })]);
    assert.deepEqual((await sdk.getDoc(stateDoc(a))).data().readers, { a: true, b: true }); assert.deepEqual((await postRef.get()).data(), before);
    await denied(sdk.setDoc(stateDoc(a), { readers: { b: false }, updatedAt: sdk.serverTimestamp() }, { merge: true }));
    await denied(sdk.setDoc(stateDoc(guardian), { readers: { g: true }, updatedAt: sdk.serverTimestamp() }, { merge: true }));
    await denied(sdk.getDoc(stateDoc(outsider)));
    await denied(sdk.setDoc(sdk.doc(a, "teams", team, "loadingSummaries", "a"), { unreadNoticeCount: 999 }));
    await denied(sdk.getDoc(sdk.doc(a, "teams", team, "loadingSummaries", "b")));
    await writes.markWorkspaceNotificationState(team, "p000", "a", "post", "read");
    await backend.handleReadState({ params: { teamId: team, postId: "p000" } }); assert.equal((await summary()).workspaceNotificationUnreadCount, 109); assert.deepEqual((await postRef.get()).data(), before);
    await denied(sdk.updateDoc(stateDoc(a), { "notificationReads.b": ["post"], updatedAt: sdk.serverTimestamp() }));
    assert.ok((await backend.relatedTeamIds("a")).includes(team));
    await denied(sdk.getDoc(sdk.doc(a, "users", "a", "loadingReadTeams", team)));
    await writes.markWorkspacePostRead(team, "p001", "a", "A", false);
    assert.ok((await ref.collection("workspacePosts").doc("p001").get()).data().readByUids.includes("a"));
    const code = transformSync(fs.readFileSync(path.join(__dirname, "historyDataService.js"), "utf8"), { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"] }).code;
    const module = { exports: {} }, modules = { "firebase/firestore": sdk, "../firebase": { db: a }, "./firestoreSubscription": { measuredOnSnapshot: (_name, target, next, error) => sdk.onSnapshot(target, next, error) }, "../utils/historyLoading": require("../utils/historyLoading") };
    vm.runInThisContext(`(function(require, module, exports) {${code}\n})`)((name) => modules[name], module, module.exports);
    const service = module.exports;
    const firstSnapshot = (subscribe) => new Promise((resolve, reject) => { let stop; stop = subscribe((value) => { stop?.(); resolve(value); }, reject); });
    const page = await firstSnapshot((next, error) => service.subscribeHistory(team, "workspacePosts", { uid: "a", channel: "General", count: 50 }, next, error)); assert.equal(page.items.length, 50); assert.equal(page.hasMore, true);
    const events = await firstSnapshot((next, error) => service.subscribeHistory(team, "clubEvents", { start: "2026-10-01", end: "2026-10-31" }, next, error)); assert.equal(events.items[0].id, "overlap");
    const personal = await firstSnapshot((next, error) => service.subscribeHistory(team, "personalEvents", { uid: "a", start: "2026-10-01", end: "2026-10-31" }, next, error)); assert.equal(personal.items[0].id, "personal");
    const reports = await firstSnapshot((next, error) => service.subscribeHistory(team, "dailyReports", { start: "2025-01-01", end: "2025-01-31", authorUid: "a", author: "A" }, next, error)); assert.equal(reports.items[0].id, "old-report");
    await ref.collection("dailyReports").doc("new-report").set({ author: "A", authorUid: "a", date: "2026-10-05", createdAt: admin.Timestamp.fromMillis(5000), fatigue: 3, medicalScaleVersion: 2 });
    await backend.process(team, "dailyReports", "new-report"); assert.equal((await ref.collection("latestDailyReports").doc("a").get()).data().id, "new-report");
    await ref.collection("dailyReports").doc("new-report").update({ status: "deleted" }); await backend.process(team, "dailyReports", "new-report"); assert.equal((await ref.collection("latestDailyReports").doc("a").get()).data().id, "old-report");
    await backend.configureCallable({ auth: { uid: "owner" }, data: { teamId: team, enabled: true, separateReads: true } }); assert.equal((await stateRef.get()).data().enabled, true);
    const oldContext = await backend.context(team);
    const ownerRef = ref.collection("members").doc("owner"), ownerBefore = await ownerRef.get();
    await ownerRef.update({ name: "Coach renamed" });
    await backend.handleMembership({ params: { teamId: team }, data: { before: ownerBefore, after: await ownerRef.get() } });
    assert.equal((await stateRef.get()).data().ready, false);
    await postRef.update({ content: "no longer mentions anyone" });
    await backend.process(team, "workspacePosts", "p000", oldContext);
    assert.equal((await summary()).workspaceNotificationUnreadCount, 109, "stale preparation context must not overwrite a new revision");
    steps = 0;
    while ((await stateRef.get()).data().status === "preparing") {
      assert.ok(++steps < 30); await backend.handlePreparation({ params: { teamId: team }, data: { after: await stateRef.get() } });
    }
    assert.equal((await stateRef.get()).data().enabled, true); assert.equal((await stateRef.get()).data().separateReads, true);
    await ref.collection("notices").doc("old-notice").delete(); await backend.process(team, "notices", "old-notice");
    assert.equal((await summary()).unreadNoticeCount, 0);
    await backend.anonymizeTeam(ref, "a");
    const cleaned = (await ref.collection("workspacePostReadStates").doc("p000").get()).data();
    assert.deepEqual(cleaned.readers, { b: true }); assert.equal(cleaned.notificationReads?.a, undefined);
    assert.equal((await ref.collection("loadingSummaries").doc("a").get()).exists, false);
    assert.equal((await ref.collection("latestDailyReports").doc("a").get()).exists, false);
    assert.equal((await ref.collection("loadingEntries").where(new admin.FieldPath("contributions", "a"), "!=", null).get()).size, 0);
    assert.equal((await ref.collection("loadingEntries").where("authorUids", "array-contains", "a").get()).size, 0);
    await db.collection("users").doc("a").delete(); await ref.collection("members").doc("a").delete();
    await backend.process(team, "workspacePosts", "p001", await backend.context(team));
    assert.equal((await ref.collection("loadingSummaries").doc("a").get()).exists, false);
  } finally {
    await Promise.all(clients.map(async ({ app, db }) => { await sdk.terminate(db); await deleteApp(app); })); await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
