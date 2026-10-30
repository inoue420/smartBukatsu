const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const fr = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = fr("firebase-admin/app"), admin = fr("firebase-admin/firestore");
const { loadTeamService, loadJoinHandler } = require("../../scripts/emailVerificationTestHarness.cjs");
const projectId = "demo-loading-optimization", host = "127.0.0.1:8189";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== projectId) throw new Error("Use the dedicated local demo emulator.");

test("email verification: real Rules, atomic team creation and existing participation transaction", async t => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, { method: "PUT",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [
      { name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId }, "email-verification"), db = admin.getFirestore(serverApp), clients = [];
  const client = (uid, verified) => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `verification-${uid}-${clients.length}`);
    const value = sdk.getFirestore(app), token = { sub: uid, ...(verified === undefined ? {} : { email_verified: verified }) };
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8189, { mockUserToken: token }); clients.push({ app, db: value }); return value;
  };
  const denied = promise => assert.rejects(promise, error => error.code === "permission-denied");
  const sport = { category: "sports", name: "soccer" }, identity = { teamId: "verification-created-team", teamInviteCode: "Ax12bc" };
  try {
    await db.doc("teams/verification-existing").set({ createdBy: "original-owner", name: "Synthetic existing" });
    await db.doc("invites/Ab12Cd").set({ teamId: "verification-existing", active: true, createdBy: "original-owner" });
    const unverified = client("unverified", false), verified = client("verified", true), missing = client("missing-claim");
    await t.test("unverified and missing-claim clients cannot create a team, invitation or direct membership", async () => {
      for (const [uid, value] of [["unverified", unverified], ["missing-claim", missing]]) {
        await sdk.setDoc(sdk.doc(value, "users", uid), { name: "Synthetic", emailVerificationRequired: false });
        await denied(sdk.setDoc(sdk.doc(value, "teams", `verification-denied-${uid}`), { createdBy: uid }));
        await denied(sdk.setDoc(sdk.doc(value, "invites", uid === "unverified" ? "Un12ab" : "Mi12ab"), { createdBy: uid, teamId: "verification-existing" }));
        await denied(sdk.setDoc(sdk.doc(value, "teams", "verification-existing", "members", uid), { role: "member", inviteCode: "Ab12Cd" }));
        assert.equal((await db.doc(`teams/verification-existing/members/${uid}`).get()).exists, false);
        assert.equal((await db.doc(`teams/verification-denied-${uid}`).get()).exists, false);
      }
    });
    await t.test("verified creation commits all four documents and preserves other membership IDs", async () => {
      await db.doc("users/verified").set({ teamIds: [], name: "Synthetic", legalConsent: { termsVersion: "synthetic" } });
      const service = loadTeamService(verified, sdk, { currentUser: { uid: "verified", emailVerified: true } });
      const result = await service.createTeam("verified", "Synthetic team", "Synthetic user", sport, identity);
      assert.equal(result.teamId, identity.teamId);
      assert.equal((await db.doc(`teams/${identity.teamId}/members/verified`).get()).data().role, "admin");
      assert.equal((await db.doc(`invites/${identity.teamInviteCode}`).get()).data().teamId, identity.teamId);
      const user = (await db.doc("users/verified").get()).data(); assert.deepEqual(user.teamIds, [identity.teamId]);
      assert.equal(user.legalConsent.termsVersion, "synthetic");
    });
    await t.test("retrying completed creation does not rewrite timestamps or add another team", async () => {
      const before = await db.doc(`teams/${identity.teamId}`).get();
      const service = loadTeamService(verified, sdk, { currentUser: { uid: "verified", emailVerified: true } });
      await service.createTeam("verified", "Synthetic team", "Synthetic user", sport, identity);
      const after = await db.doc(`teams/${identity.teamId}`).get(); assert.equal(before.updateTime.toMillis(), after.updateTime.toMillis());
      assert.equal((await db.doc("users/verified").get()).data().teamIds.length, 1);
    });
    await t.test("creation keeps legacy active-team-only memberships and incomplete arrays selectable", async () => {
      const value = client("legacy-owner", true);
      await db.doc("teams/verification-legacy").set({ createdBy: "legacy-owner", name: "Synthetic legacy" });
      await db.doc("teams/verification-legacy/members/legacy-owner").set({ role: "admin" });
      await db.doc("teams/verification-existing/members/legacy-owner").set({ role: "member" });
      const service = loadTeamService(value, sdk, { currentUser: { uid: "legacy-owner", emailVerified: true } });
      const cases = [undefined, [], ["verification-existing"]];
      for (let i = 0; i < cases.length; i++) {
        const teamIds = cases[i], teamId = `verification-legacy-created-${i}`;
        await db.doc("users/legacy-owner").set({ activeTeamId: "verification-legacy", ...(teamIds ? { teamIds } : {}) });
        await service.createTeam("legacy-owner", "Synthetic additional", "Synthetic owner", sport, { teamId, teamInviteCode: `Lg12a${i}` });
        assert.deepEqual((await db.doc("users/legacy-owner").get()).data().teamIds, [...(teamIds || []), "verification-legacy", teamId]);
        const teams = await service.getUserTeams("legacy-owner");
        assert.ok(teams.some(team => team.id === "verification-legacy"));
        assert.ok(teams.some(team => team.id === teamId));
      }
    });
    await t.test("a denied invite write aborts the entire creation batch without orphaned teams or membership", async () => {
      const service = loadTeamService(verified, sdk, { currentUser: { uid: "verified", emailVerified: true } });
      const before = (await db.doc("users/verified").get()).data();
      await denied(service.createTeam("verified", "Synthetic collision", "Synthetic user", sport,
        { teamId: "verification-aborted-team", teamInviteCode: "Ab12Cd" }));
      assert.equal((await db.doc("teams/verification-aborted-team").get()).exists, false);
      assert.equal((await db.doc("teams/verification-aborted-team/members/verified").get()).exists, false);
      assert.deepEqual((await db.doc("users/verified").get()).data(), before);
      assert.equal((await db.doc("invites/Ab12Cd").get()).data().teamId, "verification-existing");
    });
    const join = loadJoinHandler(db, admin.FieldValue);
    const request = (uid, emailVerified, code = "Ab12Cd") => ({ auth: { uid, token: { email_verified: emailVerified } }, data: { inviteCode: code, userName: "Synthetic participant" } });
    await t.test("unverified callable requests are rejected before all database operations", async () => {
      let operations = 0; const rejectOnly = loadJoinHandler({ runTransaction() { operations++; assert.fail("No transaction for unverified users"); } }, admin.FieldValue);
      await assert.rejects(rejectOnly(request("unverified", false)), { code: "failed-precondition" }); assert.equal(operations, 0);
      assert.equal((await db.doc("teams/verification-existing/members/unverified").get()).exists, false);
    });
    await t.test("verified participation preserves existing IDs and simultaneous/repeated requests create one membership", async () => {
      const results = await Promise.all([join(request("verified", true)), join(request("verified", true))]);
      assert.equal(results[0].teamId, "verification-existing"); assert.equal(results[1].teamId, "verification-existing");
      const member = await db.doc("teams/verification-existing/members/verified").get();
      await join(request("verified", true)); const after = await member.ref.get();
      assert.equal(member.updateTime.toMillis(), after.updateTime.toMillis());
      assert.deepEqual((await db.doc("users/verified").get()).data().teamIds, [identity.teamId, "verification-existing"]);
    });
    await t.test("invalid/disabled invitations leave no membership or user entry", async () => {
      await db.doc("invites/Of12ab").set({ teamId: "verification-existing", active: false });
      for (const code of ["No12ab", "Of12ab"]) await assert.rejects(join(request("no-member", true, code)), { code: "not-found" });
      assert.equal((await db.doc("users/no-member").get()).exists, false);
      assert.equal((await db.doc("teams/verification-existing/members/no-member").get()).exists, false);
    });
    await t.test("legacy unverified members retain existing reads and edits while new membership remains denied", async () => {
      await db.doc("teams/verification-existing/members/unverified").set({ role: "member", name: "Synthetic legacy" });
      assert.equal((await sdk.getDoc(sdk.doc(unverified, "teams", "verification-existing"))).exists(), true);
      await sdk.updateDoc(sdk.doc(unverified, "teams", "verification-existing", "members", "unverified"), { name: "Synthetic renamed" });
      await denied(sdk.setDoc(sdk.doc(unverified, "teams", identity.teamId, "members", "unverified"), { role: "member", inviteCode: identity.teamInviteCode }));
    });
  } finally {
    for (const value of clients) { await sdk.terminate(value.db); await deleteApp(value.app); }
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
