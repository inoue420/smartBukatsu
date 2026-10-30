const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { loadCalendarSettingsService } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const projectId = "demo-loading-optimization", host = "127.0.0.1:8189";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== projectId) {
  throw new Error("These tests require the dedicated local demo emulator.");
}

test("real rules: supervisor-only boolean, team isolation, shared reads, OFF/default compatibility", async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, { method: "PUT",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [
      { name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId }, "calendar-week-start"), db = admin.getFirestore(serverApp), clients = [];
  const a = db.collection("teams").doc("calendar-team-a"), b = db.collection("teams").doc("calendar-team-b");
  const client = uid => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `calendar-${uid}`);
    const value = sdk.getFirestore(app); sdk.connectFirestoreEmulator(value, "127.0.0.1", 8189, { mockUserToken: { sub: uid, email_verified: true } });
    clients.push({ app, db: value }); return value;
  };
  const denied = promise => assert.rejects(promise, error => error.code === "permission-denied");
  const doc = value => sdk.doc(value, "teams", a.id);
  try {
    await a.set({ name: "Synthetic A", createdBy: "owner", absenceDeadlineDaysBefore: 3 });
    await b.set({ name: "Synthetic B", createdBy: "other-owner" });
    const roles = ["owner", "admin", "staff", "captain", "member", "guardian"], users = {};
    for (const role of roles) {
      await a.collection("members").doc(role).set({ role, name: role });
      await db.collection("users").doc(role).set({ activeTeamId: a.id }); users[role] = client(role);
    }
    const outsider = client("outsider");
    assert.equal((await sdk.getDoc(doc(users.member))).data().calendarWeekStartsOnMonday, undefined);
    await loadCalendarSettingsService(users.owner, sdk)(a.id, true);
    for (const role of roles) assert.equal((await sdk.getDoc(doc(users[role]))).data().calendarWeekStartsOnMonday, true, role);
    for (const role of ["staff", "captain", "member", "guardian"]) {
      await denied(sdk.updateDoc(doc(users[role]), { calendarWeekStartsOnMonday: false }));
      await denied(sdk.updateDoc(doc(users[role]), { calendarWeekStartsOnMonday: sdk.deleteField() }));
    }
    await denied(sdk.updateDoc(doc(outsider), { calendarWeekStartsOnMonday: false }));
    await denied(loadCalendarSettingsService(users.owner, sdk)(b.id, true));
    assert.equal((await b.get()).data().calendarWeekStartsOnMonday, undefined);
    for (const value of ["true", 1, 0, null, [], {}]) {
      await denied(sdk.updateDoc(doc(users.admin), { calendarWeekStartsOnMonday: value }));
    }
    await loadCalendarSettingsService(users.admin, sdk)(a.id, false);
    assert.equal((await sdk.getDoc(doc(users.guardian))).data().calendarWeekStartsOnMonday, false);
    assert.equal((await a.get()).data().absenceDeadlineDaysBefore, 3);
    await sdk.updateDoc(doc(users.staff), { name: "Synthetic renamed A" });
    assert.equal((await a.get()).data().calendarWeekStartsOnMonday, false);
    await sdk.updateDoc(doc(users.owner), { calendarWeekStartsOnMonday: sdk.deleteField() });
    assert.equal((await sdk.getDoc(doc(users.member))).data().calendarWeekStartsOnMonday, undefined);
    for (const [suffix, fields] of [["legacy", {}], ["monday", { calendarWeekStartsOnMonday: true }]]) {
      await sdk.setDoc(sdk.doc(users.owner, "teams", `calendar-create-${suffix}`), { createdBy: "owner", ...fields });
    }
    await denied(sdk.setDoc(sdk.doc(users.owner, "teams", "calendar-create-invalid"), {
      createdBy: "owner", calendarWeekStartsOnMonday: "true",
    }));
  } finally {
    for (const entry of clients) { await sdk.terminate(entry.db); await deleteApp(entry.app); }
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
