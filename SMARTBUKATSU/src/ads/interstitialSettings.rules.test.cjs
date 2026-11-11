const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { createInterstitialSettingsBackend } = require("../../functions/interstitialSettingsBackend");
const projectId = "demo-loading-optimization", host = "127.0.0.1:8189";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== projectId) throw Error("Dedicated local emulator required.");
test("real rules and transaction: only verified clients read the single policy, only real operators update through backend", async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, { method: "PUT",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: { files: [
      { name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId }, "interstitial-settings"), db = admin.getFirestore(serverApp), clients = [];
  const client = (uid, verified = true) => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `interstitial-${uid}-${verified}`);
    const value = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8189, { mockUserToken: { sub: uid, email_verified: verified } });
    clients.push({ app, db: value }); return value;
  };
  const denied = promise => assert.rejects(promise, error => error.code === "permission-denied");
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const api = createInterstitialSettingsBackend({ firestore: db, FieldValue: admin.FieldValue, HttpsError });
  const request = uid => ({ auth: { uid, token: { email_verified: true } },
    data: { expectedUid: uid, audience: "debug", minimumUsageMinutes: 10 } });
  try {
    await db.doc("invites/AWUH95").set({ teamId: "synthetic-debug" });
    await db.doc("teams/synthetic-debug/members/operator").set({ role: "member" });
    await db.doc("appConfig/versionPolicy").set({ enabled: false });
    await api.save(request("operator"));
    const normal = client("normal"), operator = client("operator"), unverified = client("normal", false);
    for (const value of [normal, operator]) {
      assert.equal((await sdk.getDocFromServer(sdk.doc(value, "appConfig/interstitialAds"))).data().minimumUsageMinutes, 10);
      await denied(sdk.setDoc(sdk.doc(value, "appConfig/interstitialAds"), { audience: "all", minimumUsageMinutes: 1 }));
      await denied(sdk.deleteDoc(sdk.doc(value, "appConfig/interstitialAds")));
      await denied(sdk.getDocs(sdk.collection(value, "appConfig")));
      await denied(sdk.getDoc(sdk.doc(value, "appConfig/unrelated")));
    }
    await denied(sdk.getDocFromServer(sdk.doc(unverified, "appConfig/interstitialAds")));
    assert.equal((await sdk.getDocFromServer(sdk.doc(unverified, "appConfig/versionPolicy"))).exists(), true);
    // Claiming the operator's active team without an actual membership is insufficient.
    await db.doc("users/normal").set({ activeTeamId: "synthetic-debug" });
    assert.equal((await api.access(request("normal"))).allowed, false);
    await assert.rejects(api.save(request("normal")), { code: "permission-denied" });
    await db.doc("teams/synthetic-debug/members/operator").delete();
    await assert.rejects(api.save(request("operator")), { code: "permission-denied" });
  } finally {
    for (const entry of clients) { await sdk.terminate(entry.db); await deleteApp(entry.app); }
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
