const test = require("node:test"), assert = require("node:assert/strict");
const { createAdAgeProfileBackend } = require("./adAgeProfileBackend");
function environment(data = {}) {
  const docs = new Map([["users/user", { teamIds: ["a", "b"], ...data }],
    ["teams/a", {}], ["teams/b", {}], ["teams/a/members/user", { role: "member" }],
    ["teams/b/members/user", { role: "guardian" }]]), reads = [], writes = [];
  let created = 1;
  const snapshot = path => ({ exists: docs.has(path), data: () => docs.get(path),
    createTime: { seconds: created, nanoseconds: 0 } });
  const firestore = { doc: path => ({ path }), runTransaction: fn => fn({
    get: async ref => { reads.push(ref.path); return snapshot(ref.path); },
    set(ref, value) { writes.push([ref.path, value]); docs.set(ref.path, value); },
    delete(ref) { writes.push([ref.path, null]); docs.delete(ref.path); },
  }) };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const api = createAdAgeProfileBackend({ firestore, HttpsError, FieldValue: { serverTimestamp: () => "server-time" } });
  const request = (uid = "user", data = {}) => ({ auth: { uid, token: { email_verified: true } }, data: { expectedUid: uid, ...data } });
  const event = (before, after) => ({ params: { uid: "user", teamId: "b" }, data: {
    before: { exists: Boolean(before), data: () => before }, after: { exists: Boolean(after), data: () => after },
  } });
  return { api, docs, reads, writes, request, event, recreate() { created++; }, profile: () => docs.get("users/user/adAge/profile") };
}

test("initial verification finds a guardian in a non-active team and records a persistent server proof", async () => {
  const e = environment({ activeTeamId: "a" });
  const result = await e.api.ensure(e.request());
  assert.equal(result.adultConfirmed, true); assert.equal(result.minimumAgeConfirmed, false);
  assert.equal(result.audience, "adult"); assert.equal(result.uid, "user");
  assert.equal(e.profile().adultSourceTeamId, "b"); assert.equal(e.profile().adultConfirmedAt, "server-time");
  assert.equal(e.profile().adultConfirmedBy, "guardian"); assert.equal(e.profile().userCreatedAt, "1:0");
});

test("confirmed adulthood survives role changes, leaving teams and repeated initializations without writes", async () => {
  const e = environment(); await e.api.ensure(e.request());
  e.docs.delete("teams/b/members/user"); e.docs.set("users/user", { teamIds: ["a"], activeTeamId: "a" });
  await e.api.membershipChanged(e.event({ role: "guardian" }, null));
  await e.api.userChanged(e.event({ teamIds: ["a", "b"] }, { teamIds: ["a"] }));
  await e.api.ensure(e.request());
  assert.equal(e.profile().adultConfirmed, true); assert.equal(e.writes.length, 1);
});

test("only actual guardian membership counts; owners, admins, staff, members and orphaned members do not", async () => {
  for (const role of ["owner", "admin", "staff", "member", "captain", "alumni", undefined]) {
    const e = environment({ legalConsent: { minimumAgeConfirmed: true, minimumAge: 13 } });
    e.docs.set("teams/b/members/user", { role });
    const result = await e.api.ensure(e.request());
    assert.equal(result.adultConfirmed, false); assert.equal(result.audience, "teen");
  }
  const e = environment(); e.docs.delete("teams/b");
  assert.equal((await e.api.ensure(e.request())).audience, "unknown");
});

test("unconfirmed or malformed age is not upgraded; valid integer 13+ confirmation is preserved", async () => {
  for (const legalConsent of [{}, { minimumAge: 13 }, { minimumAgeConfirmed: false, minimumAge: 13 },
    { minimumAgeConfirmed: true, minimumAge: 12 }, { minimumAgeConfirmed: true, minimumAge: "13" },
    { minimumAgeConfirmed: true, minimumAge: 13.5 }, { minimumAgeConfirmed: true, minimumAge: 13 }]) {
    const e = environment({ legalConsent }); e.docs.delete("teams/b/members/user");
    const result = await e.api.ensure(e.request());
    assert.equal(result.audience, legalConsent.minimumAge === 13 && legalConsent.minimumAgeConfirmed === true ? "teen" : "unknown");
    assert.deepEqual(e.docs.get("users/user").legalConsent, legalConsent);
  }
});

test("membership trigger verifies current data, promotes a guardian even before the team list catches up, and ignores replay", async () => {
  const e = environment({ teamIds: ["a"] }); e.docs.set("teams/b/members/user", { role: "member" });
  await e.api.ensure(e.request()); assert.equal(e.profile().audience, "unknown");
  await e.api.membershipChanged(e.event({ role: "member" }, { role: "guardian" }));
  assert.equal(e.profile().audience, "unknown");
  e.docs.set("teams/b/members/user", { role: "guardian" });
  await e.api.membershipChanged(e.event({ role: "member" }, { role: "guardian" }));
  assert.equal(e.profile().audience, "adult"); const count = e.writes.length;
  await e.api.membershipChanged(e.event({ role: "member" }, { role: "guardian" }));
  assert.equal(e.writes.length, count);
});

test("user confirmation changes update the protected profile; unrelated edits do no work", async () => {
  const e = environment(); e.docs.delete("teams/b/members/user"); await e.api.ensure(e.request());
  const before = e.docs.get("users/user"), after = { ...before, legalConsent: { minimumAge: 13, minimumAgeConfirmed: true } };
  e.docs.set("users/user", after); await e.api.userChanged(e.event(before, after));
  assert.equal(e.profile().audience, "teen");
  const reads = e.reads.length; await e.api.userChanged(e.event(after, { ...after, name: "Renamed" }));
  assert.equal(e.reads.length, reads);
  e.docs.set("users/user", before); await e.api.userChanged(e.event(after, before));
  assert.equal(e.profile().audience, "unknown");
});

test("a recreated user does not inherit an earlier account's adult proof, and deleted users are not recreated", async () => {
  const e = environment(); await e.api.ensure(e.request());
  e.recreate(); e.docs.delete("teams/b/members/user");
  assert.equal((await e.api.ensure(e.request())).adultConfirmed, false);
  e.docs.delete("users/user"); await e.api.userChanged(e.event({}, null));
  assert.equal(e.profile(), undefined); await e.api.membershipChanged(e.event(null, { role: "guardian" }));
  assert.equal(e.profile(), undefined);
});

test("authentication and matching account are mandatory; a client cannot submit an adult claim", async () => {
  const e = environment();
  for (const auth of [null, { uid: "" }, { uid: "invalid/user" }]) {
    await assert.rejects(e.api.ensure({ ...e.request(), auth }), { code: "unauthenticated" });
  }
  await assert.rejects(e.api.ensure(e.request("user", { expectedUid: "other" })), { code: "failed-precondition" });
  await assert.rejects(e.api.ensure(e.request("user", { adultConfirmed: true })), { code: "invalid-argument" });
  assert.equal(e.reads.length, 0); assert.equal(e.writes.length, 0);
});

test("existing authenticated accounts keep their age verification without a new email prerequisite", async () => {
  const e = environment(); const request = e.request(); request.auth.token = {};
  assert.equal((await e.api.ensure(request)).adultConfirmed, true);
});

test("legacy active-team-only profiles work and excessive team lists fail before any writes", async () => {
  const e = environment({ teamIds: [], activeTeamId: "b" });
  assert.equal((await e.api.ensure(e.request())).adultConfirmed, true);
  const other = environment({ teamIds: Array.from({ length: 101 }, (_, i) => `team-${i}`) });
  await assert.rejects(other.api.ensure(other.request()), { code: "resource-exhausted" });
  assert.equal(other.writes.length, 0);
});

test("switching between already known teams and reordering the same IDs does not rescan memberships", async () => {
  const e = environment();
  await e.api.userChanged(e.event({ teamIds: ["a", "b"], activeTeamId: "a" },
    { teamIds: ["b", "a"], activeTeamId: "b" }));
  assert.equal(e.reads.length, 0); assert.equal(e.writes.length, 0);
});
