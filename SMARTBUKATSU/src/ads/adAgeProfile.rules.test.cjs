const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { createAdAgeProfileBackend } = require("../../functions/adAgeProfileBackend");
const projectId = "demo-loading-optimization", host = "127.0.0.1:8189";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== projectId) {
  throw Error("Dedicated local emulator required.");
}

test("real rules and transactions: private server-owned user age profile", async t => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [
      { name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") },
    ] } }),
  });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId }, "ad-age-profile"), db = admin.getFirestore(serverApp), clients = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const api = createAdAgeProfileBackend({ firestore: db, FieldValue: admin.FieldValue, HttpsError });
  const request = uid => ({ auth: { uid, token: {} }, data: { expectedUid: uid } });
  const client = uid => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `age-${uid}`);
    const value = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8189, { mockUserToken: { sub: uid } });
    clients.push({ app, db: value }); return value;
  };
  const denied = promise => assert.rejects(promise, error => error.code === "permission-denied");
  const profile = uid => db.doc(`users/${uid}/adAge/profile`);
  const event = (uid, teamId, before, after) => ({ params: { uid, teamId }, data: { before, after } });
  try {
    await db.doc("users/age-guardian").set({ activeTeamId: "age-a", teamIds: ["age-a", "age-b"] });
    await db.doc("users/age-member").set({ teamIds: ["age-a"], legalConsent: { minimumAge: 13, minimumAgeConfirmed: true } });
    await db.doc("users/age-unknown").set({ teamIds: ["age-a"] });
    await db.doc("teams/age-a").set({ createdBy: "synthetic-owner" });
    await db.doc("teams/age-b").set({ createdBy: "synthetic-owner" });
    await db.doc("teams/age-a/members/age-guardian").set({ role: "member" });
    await db.doc("teams/age-b/members/age-guardian").set({ role: "guardian" });
    await db.doc("teams/age-a/members/age-member").set({ role: "staff" });
    await db.doc("teams/age-a/members/age-unknown").set({ role: "admin" });
    const owner = client("age-guardian"), member = client("age-member"), unknown = client("age-unknown");

    await t.test("first resolution uses all actual memberships and preserves unconfirmed users", async () => {
      assert.equal((await api.ensure(request("age-guardian"))).audience, "adult");
      assert.equal((await api.ensure(request("age-member"))).audience, "teen");
      assert.equal((await api.ensure(request("age-unknown"))).audience, "unknown");
      const result = (await sdk.getDocFromServer(sdk.doc(owner, "users/age-guardian/adAge/profile"))).data();
      assert.equal(result.adultSourceTeamId, "age-b"); assert.ok(result.adultConfirmedAt.toMillis() > 0);
      assert.equal(result.minimumAgeConfirmed, false);
    });

    await t.test("owner reads one profile, while write/update/delete/list and other users' reads are rejected", async () => {
      for (const [value, uid] of [[owner, "age-guardian"], [member, "age-member"], [unknown, "age-unknown"]]) {
        const ref = sdk.doc(value, `users/${uid}/adAge/profile`);
        assert.equal((await sdk.getDocFromServer(ref)).exists(), true);
        await denied(sdk.setDoc(ref, { schemaVersion: 1, audience: "adult", adultConfirmed: true }));
        await denied(sdk.updateDoc(ref, { adultConfirmed: true })); await denied(sdk.deleteDoc(ref));
        await denied(sdk.setDoc(sdk.doc(value, `users/${uid}/adAge/forged`), { adultConfirmed: true }));
        await denied(sdk.getDocs(sdk.collection(value, `users/${uid}/adAge`)));
      }
      await denied(sdk.getDocFromServer(sdk.doc(member, "users/age-guardian/adAge/profile")));
      await denied(sdk.getDocFromServer(sdk.doc(owner, "users/age-member/adAge/profile")));
      // Existing profile editing is unaffected; claims in the public user document are ignored.
      await sdk.updateDoc(sdk.doc(member, "users/age-member"), {
        name: "Synthetic renamed", adAgeProfile: { adultConfirmed: true }, teamIds: ["age-a", "age-b"],
      });
      assert.equal((await api.ensure(request("age-member"))).adultConfirmed, false);
    });

    await t.test("concurrent bootstraps and guardian promotion converge without downgrading or rewriting proof time", async () => {
      await Promise.all([api.ensure(request("age-member")), api.ensure(request("age-member"))]);
      const memberRef = db.doc("teams/age-b/members/age-member"), before = await memberRef.get();
      await memberRef.set({ role: "guardian" }); const after = await memberRef.get();
      await Promise.all([api.ensure(request("age-member")), api.membershipChanged(event("age-member", "age-b", before, after))]);
      const first = await profile("age-member").get(); assert.equal(first.data().adultConfirmed, true);
      await memberRef.set({ role: "member" });
      await api.ensure(request("age-member"));
      await api.membershipChanged(event("age-member", "age-b", after, await memberRef.get()));
      const last = await profile("age-member").get();
      assert.equal(last.data().adultConfirmed, true);
      assert.equal(last.data().adultConfirmedAt.toMillis(), first.data().adultConfirmedAt.toMillis());
      assert.equal(last.updateTime.toMillis(), first.updateTime.toMillis());
    });

    await t.test("legal consent changes update only unconfirmed adulthood; deleting an account removes its protected document", async () => {
      const userRef = db.doc("users/age-unknown"), before = await userRef.get();
      await userRef.update({ legalConsent: { minimumAgeConfirmed: true, minimumAge: 13 } });
      await api.userChanged(event("age-unknown", null, before, await userRef.get()));
      assert.equal((await profile("age-unknown").get()).data().audience, "teen");
      const present = await userRef.get(); await userRef.delete();
      await api.userChanged(event("age-unknown", null, present, await userRef.get()));
      assert.equal((await profile("age-unknown").get()).exists, false);
      await assert.rejects(api.ensure(request("age-unknown")), { code: "failed-precondition" });
    });
  } finally {
    for (const entry of clients) { await sdk.terminate(entry.db); await deleteApp(entry.app); }
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
