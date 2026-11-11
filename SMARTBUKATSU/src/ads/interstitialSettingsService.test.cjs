const test = require("node:test"), assert = require("node:assert/strict");
const { load } = require("../../scripts/calendarWeekStartTestHarness.cjs");
function environment() {
  let value = { audience: "all", minimumUsageMinutes: 10 }, exists = true;
  const auth = { currentUser: { uid: "synthetic" } }, calls = [];
  const service = load("src/services/interstitialSettingsService.js", {
    "firebase/firestore": { doc: (_db, ...path) => path.join("/"), getDocFromServer: async path => {
      calls.push(["read", path]); return { exists: () => exists, data: () => value }; } },
    "firebase/functions": { httpsCallable: (_functions, name) => async data => {
      calls.push([name, data]); return { data: name === "getInterstitialAdAccess" ? { allowed: true } : data }; } },
    "../firebase": { auth, db: {}, cloudFunctions: {} }, "../ads/interstitialPolicy": require("./interstitialPolicy"),
  });
  return { service, calls, auth, settings(v) { value = v; }, missing() { exists = false; } };
}
test("all/off read exactly one document and never call a membership API", async () => {
  for (const audience of ["all", "off"]) {
    const e = environment(); e.settings({ audience, minimumUsageMinutes: 10 });
    assert.equal((await e.service.fetchInterstitialSettings("synthetic")).audience, audience);
    assert.equal(e.calls.length, 1); assert.equal(e.calls[0][1], "appConfig/interstitialAds");
  }
});
test("debug/missing policy require authoritative membership; invalid policy fails closed", async () => {
  const e = environment(); e.missing();
  const policy = await e.service.fetchInterstitialSettings("synthetic");
  assert.equal(policy.audience, "debug"); assert.equal(policy.isDebugMember, true); assert.equal(e.calls.length, 2);
  const invalid = environment(); invalid.settings({ audience: "all", minimumUsageMinutes: 0 });
  await assert.rejects(invalid.service.fetchInterstitialSettings("synthetic")); assert.equal(invalid.calls.length, 1);
});
test("save validates minutes locally and sends the current account to the protected callable", async () => {
  const e = environment(); await assert.rejects(e.service.saveInterstitialSettings("synthetic", { audience: "all", minimumUsageMinutes: 31 }));
  assert.equal(e.calls.length, 0);
  await e.service.saveInterstitialSettings("synthetic", { audience: "off", minimumUsageMinutes: 1 });
  assert.equal(e.calls[0][0], "setInterstitialAdSettings"); assert.equal(e.calls[0][1].expectedUid, "synthetic");
  e.auth.currentUser = { uid: "other" }; await assert.rejects(e.service.fetchInterstitialSettings("synthetic"));
});
