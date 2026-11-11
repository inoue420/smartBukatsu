const test = require("node:test"), assert = require("node:assert/strict");
const { createInterstitialSettingsBackend } = require("./interstitialSettingsBackend");
function environment() {
  const docs = new Map([["invites/AWUH95", { teamId: "synthetic-debug" }],
    ["teams/synthetic-debug/members/operator", { role: "member" }]]), reads = [], writes = [];
  const snapshot = path => ({ exists: docs.has(path), data: () => docs.get(path) });
  const firestore = { doc: path => ({ path, get: async () => { reads.push(path); return snapshot(path); } }),
    runTransaction: fn => fn({ get: async ref => { reads.push(ref.path); return snapshot(ref.path); },
      set(ref, value) { writes.push([ref.path, value]); docs.set(ref.path, value); } }) };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const api = createInterstitialSettingsBackend({ firestore, HttpsError, FieldValue: { serverTimestamp: () => "server-time" } });
  const request = (uid = "operator", data = {}) => ({ auth: { uid, token: { email_verified: true } },
    data: { expectedUid: uid, audience: "debug", minimumUsageMinutes: 10, ...data } });
  return { api, docs, reads, writes, request };
}
test("a real operator membership of any role can save the global policy; team names are irrelevant", async () => {
  const e = environment(); assert.deepEqual(await e.api.access(e.request()), { allowed: true });
  for (const audience of ["off", "debug", "all"]) {
    assert.deepEqual(await e.api.save(e.request("operator", { audience })), { audience, minimumUsageMinutes: 10 });
  }
  assert.equal(e.writes.length, 3);
  assert.equal(e.writes[0][0], "appConfig/interstitialAds"); assert.equal(e.writes[0][1].updatedBy, "operator");
});
test("non-members and removed members cannot save, even if a client claims access", async () => {
  const e = environment(); assert.deepEqual(await e.api.access(e.request("outsider")), { allowed: false });
  await assert.rejects(e.api.save(e.request("outsider")), { code: "permission-denied" });
  e.docs.delete("teams/synthetic-debug/members/operator");
  await assert.rejects(e.api.save(e.request()), { code: "permission-denied" }); assert.equal(e.writes.length, 0);
});
test("requires verified authentication and an exact current account", async () => {
  const e = environment();
  for (const auth of [null, { uid: "operator", token: {} }]) await assert.rejects(e.api.save({ ...e.request(), auth }), { code: "unauthenticated" });
  await assert.rejects(e.api.save(e.request("operator", { expectedUid: "other" })), { code: "failed-precondition" });
  assert.equal(e.reads.length, 0);
});
test("rejects invalid ranges/types and unknown audiences before reading or writing", async () => {
  const e = environment();
  for (const value of [0, 31, 1.5, "10", null]) await assert.rejects(e.api.save(e.request("operator", { minimumUsageMinutes: value })), { code: "invalid-argument" });
  await assert.rejects(e.api.save(e.request("operator", { audience: "everyone" })), { code: "invalid-argument" });
  assert.equal(e.reads.length, 0); assert.equal(e.writes.length, 0);
});
