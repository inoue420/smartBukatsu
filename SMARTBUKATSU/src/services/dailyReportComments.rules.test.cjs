const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { loadSafetyBackend, loadCommentSettingsService } = require("../../scripts/dailyReportCommentsTestHarness.cjs");
const projectId = "demo-daily-report-comments", host = "127.0.0.1:8187";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error("These tests require the dedicated local demo emulator.");
}

test("real Firestore rules and backend: default OFF, owner/admin gate, comments, evidence and safe resumption", async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, { method: "PUT",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [
      { name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId }, "daily-comments-server"), db = admin.getFirestore(serverApp), clients = [];
  const team = "synthetic-team", teamRef = db.collection("teams").doc(team), reportRef = teamRef.collection("dailyReports").doc("report");
  const client = uid => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `daily-comments-${uid}`);
    const value = sdk.getFirestore(app); sdk.connectFirestoreEmulator(value, "127.0.0.1", 8187, { mockUserToken: { sub: uid } });
    clients.push({ app, db: value }); return value;
  };
  const denied = promise => assert.rejects(promise, error => error.code === "permission-denied");
  try {
    await teamRef.set({ name: "Synthetic team", createdBy: "owner" });
    for (const [uid, role] of [["owner", "owner"], ["admin", "admin"], ["staff", "staff"], ["member", "member"]]) {
      await teamRef.collection("members").doc(uid).set({ name: uid, role });
      await db.collection("users").doc(uid).set({ activeTeamId: team });
    }
    const owner = client("owner"), manager = client("admin"), staff = client("staff"), member = client("member"), outsider = client("outsider");
    const saveSettings = value => loadCommentSettingsService(value, sdk);
    const teamDoc = value => sdk.doc(value, "teams", team), reportDoc = value => sdk.doc(value, "teams", team, "dailyReports", "report");
    const oldComment = { id: "old", uid: "owner", user: "Synthetic coach", text: "Synthetic original comment" };
    await reportRef.set({ authorUid: "member", author: "member", date: "2026-10-06", comments: [oldComment],
      reflection: "Synthetic private reflection", painDetails: { treatment: "Synthetic private treatment" } });
    assert.equal((await sdk.getDoc(reportDoc(member))).data().comments.length, 1);
    await denied(sdk.updateDoc(reportDoc(member), { comments: [oldComment, { id: "new", text: "Synthetic reply" }] }));
    await denied(sdk.setDoc(sdk.doc(member, "teams", team, "dailyReports", "new-with-comment"), { comments: [oldComment] }));
    await sdk.setDoc(sdk.doc(member, "teams", team, "dailyReports", "empty"), { comments: [], reflection: "Synthetic diary" });
    await sdk.updateDoc(reportDoc(member), { isReviewed: true, isStarred: true, reflection: "Synthetic revised diary" });
    for (const value of [member, staff, outsider]) await denied(sdk.updateDoc(teamDoc(value), { dailyReportCommentsEnabled: true }));
    await denied(sdk.updateDoc(teamDoc(owner), { dailyReportCommentsEnabled: "true" }));
    await sdk.updateDoc(teamDoc(staff), { name: "Synthetic renamed team" });
    await saveSettings(owner)(team, true);
    await sdk.updateDoc(reportDoc(member), { comments: [oldComment, { id: "reply", uid: "member", user: "member", text: "Synthetic reply" }] });
    const batch = sdk.writeBatch(owner);
    batch.update(teamDoc(owner), { dailyReportCommentsEnabled: false, dailyReportCommentsUpdatedAt: sdk.serverTimestamp() });
    batch.update(reportDoc(owner), { comments: [oldComment] });
    await denied(batch.commit());
    assert.equal((await teamRef.get()).data().dailyReportCommentsEnabled, true);
    await saveSettings(manager)(team, false);
    await denied(sdk.updateDoc(reportDoc(member), { comments: [] }));
    await denied(sdk.updateDoc(teamDoc(staff), { dailyReportCommentsEnabled: sdk.deleteField() }));

    const backend = loadSafetyBackend(db, admin.Timestamp);
    const request = { auth: { uid: "member" }, data: { teamId: team, targetType: "daily_report_comment", reportSubject: "content",
      reason: "other", details: "Synthetic reason", dailyReportId: "report", commentId: "old" } };
    const result = await backend.submitSafetyReport(request), caseRef = db.collection("supportCases").doc(result.caseId);
    assert.equal((await caseRef.get()).data().commentEvidenceEnabledAtReport, false);
    assert.equal((await caseRef.collection("evidence").get()).size, 0);
    await denied(sdk.getDoc(sdk.doc(member, "supportCases", result.caseId)));
    await denied(sdk.setDoc(sdk.doc(member, "supportCases", "forged"), { status: "received" }));
    await saveSettings(owner)(team, true);
    assert.equal((await caseRef.collection("evidence").get()).size, 0, "ON is not a backfill");
    const before = await reportRef.get();
    await sdk.updateDoc(reportDoc(member), { comments: [...before.data().comments, { id: "resumed", text: "Synthetic resumed reply" }] });
    const after = await reportRef.get(), event = { time: new Date(after.updateTime.seconds * 1000).toISOString()
      .replace(".000Z", `.${String(after.updateTime.nanoseconds).padStart(9, "0")}Z`),
      params: { teamId: team, reportId: "report" }, data: { before, after } };
    await backend.trackReportedDailyReportChanges(event);
    const evidence = await caseRef.collection("evidence").get(); assert.equal(evidence.size, 1);
    const preserved = JSON.stringify(evidence.docs[0].data());
    assert.equal(preserved.includes("Synthetic private treatment"), false);
    assert.equal(preserved.includes("Synthetic revised diary"), false);
    await saveSettings(owner)(team, false);
    await backend.trackReportedDailyReportChanges(event);
    assert.equal((await caseRef.collection("evidence").get()).size, 1);
    assert.equal(JSON.stringify((await caseRef.collection("evidence").get()).docs[0].data()), preserved);

    // An event that passed the initial ON check is delayed until OFF before its actual transaction.
    await saveSettings(owner)(team, true);
    await backend.trackReportedDailyReportChanges(event);
    assert.equal((await caseRef.collection("evidence").get()).size, 1, "an old event must not be saved after re-enabling");
    let changed = false;
    const delayed = { collection: name => db.collection(name), runTransaction: async callback => {
      if (!changed) { changed = true; await teamRef.update({ dailyReportCommentsEnabled: false }); }
      return db.runTransaction(callback);
    } };
    await loadSafetyBackend(delayed, admin.Timestamp).trackReportedDailyReportChanges({ ...event, time: undefined });
    assert.equal((await caseRef.collection("evidence").get()).size, 1);
    await sdk.updateDoc(teamDoc(owner), { dailyReportCommentsEnabled: sdk.deleteField(), dailyReportCommentsUpdatedAt: sdk.serverTimestamp() });
    await denied(sdk.updateDoc(reportDoc(member), { comments: [] }));
  } finally {
    await Promise.all(clients.map(async entry => { await sdk.terminate(entry.db); await deleteApp(entry.app); }));
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
