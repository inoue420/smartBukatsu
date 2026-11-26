const test = require("node:test");
const assert = require("node:assert/strict");
const { createYoutubeUploadAccess, syncYoutubeUploadMember } = require("./youtubeUploadAccess");

const teamId = "debug-team";
const uid = "test-uploader";
const config = "appConfig/youtubeUpload";
const invite = "invites/AWUH95";
const team = `teams/${teamId}`;
const member = `${team}/members/${uid}`;
const user = `users/${uid}`;
const confirmation = `${config}/adultConfirmations/${uid}`;
const scoped = `${config}/teams/${teamId}/adultConfirmations/${uid}`;

function fixture() {
  const docs = new Map([
    [config, { teamId }], [invite, { teamId }], [team, {}],
    [member, { role: "guardian" }], [user, { activeTeamId: teamId }],
    [confirmation, { teamId, adultConfirmed: true }],
  ]);
  const reads = [];
  const writes = [];
  function read(path) {
    path = path.path ?? path;
    reads.push(path);
    return { exists: docs.has(path), data: () => docs.get(path) };
  }
  const firestore = {
    doc: (path) => path,
    runTransaction: (callback) => callback({
      get: read, getAll: (...paths) => paths.map(read),
      set: (path, value) => { writes.push(path); docs.set(path, value); },
      delete: (path) => { writes.push(path); docs.delete(path); },
    }),
  };
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const access = createYoutubeUploadAccess({ firestore, HttpsError });
  const request = { auth: { uid, token: { email_verified: true } }, data: { teamId, expectedUid: uid } };
  const memberRef = { id: uid, path: member, parent: { parent: { id: teamId, path: team } } };
  const sync = () => syncYoutubeUploadMember(firestore, memberRef);
  return { docs, reads, writes, sync, access, request };
}

test("only a current coach or guardian with a server-managed registration may upload", async () => {
  const { docs, access, request } = fixture();
  for (const role of ["owner", "admin", "guardian", "staff", "captain", "member", "alumni", "unknown"]) {
    docs.set(member, { role });
    assert.deepEqual(await access(request), { allowed: ["owner", "admin", "guardian"].includes(role) }, role);
  }
});

test("existing and newly assigned adult roles are registered once, without an active-team selection", async () => {
  for (const role of ["owner", "admin", "guardian"]) {
    const { docs, writes, sync, access, request } = fixture();
    docs.delete(confirmation);
    docs.set(member, { role });
    docs.set(user, { activeTeamId: "another-team" });
    await sync();
    await sync();
    assert.deepEqual(writes, [scoped, confirmation]);
    assert.deepEqual(docs.get(confirmation), { teamId, adultConfirmed: true, source: "teamMembership" });
    assert.deepEqual(await access(request), { allowed: false });
    docs.set(user, { activeTeamId: teamId });
    assert.deepEqual(await access(request), { allowed: true });
  }
});

test("demotion, graduation, archiving and leaving revoke access immediately and remove the registration", async () => {
  for (const replacement of [{ role: "member" }, { role: "staff" }, { role: "captain" }, { role: "alumni" }, { role: "admin", archived: true }, null]) {
    const { docs, writes, sync, access, request } = fixture();
    docs.set(scoped, { teamId, adultConfirmed: true });
    if (replacement) docs.set(member, replacement);
    else docs.delete(member);
    assert.deepEqual(await access(request), { allowed: false });
    await sync();
    await sync();
    assert.deepEqual(writes, [scoped, confirmation]);
    assert.equal(docs.has(confirmation), false);
  }
});

test("out-of-order membership events reconcile the latest roster and ignore unrelated teams", async () => {
  const { docs, writes, sync } = fixture();
  docs.delete(confirmation);
  docs.set(member, { role: "member" });
  await sync();
  docs.set(member, { role: "guardian" });
  docs.set(invite, { teamId: "other" });
  await sync();
  docs.set(invite, { teamId });
  docs.set(config, { teamId: "other" });
  await sync();
  assert.deepEqual(writes, []);
  docs.set(config, { teamId });
  await sync();
  assert.deepEqual(writes, [scoped, confirmation]);
});

test("the original pilot registration works during rollout; a scoped denial takes precedence", async () => {
  const { docs, access, request } = fixture();
  assert.deepEqual(await access(request), { allowed: true });
  docs.set(scoped, { teamId, adultConfirmed: false });
  assert.deepEqual(await access(request), { allowed: false });
  docs.delete(confirmation);
  docs.set(scoped, { teamId, adultConfirmed: true });
  assert.deepEqual(await access(request), { allowed: true });
});

test("another team's registration for the same UID cannot grant access and survives pilot revocation", async () => {
  const { docs, sync, access, request } = fixture();
  const other = `${config}/teams/other/adultConfirmations/${uid}`;
  docs.set(other, { teamId: "other", adultConfirmed: true });
  docs.delete(confirmation);
  assert.deepEqual(await access(request), { allowed: false });
  await sync();
  assert.deepEqual(await access(request), { allowed: true });
  docs.set(member, { role: "staff" });
  await sync();
  assert.deepEqual(await access(request), { allowed: false });
  assert.deepEqual(docs.get(other), { teamId: "other", adultConfirmed: true });
});

test("checks membership, current selection and confirmation again after access was granted", async () => {
  for (const [path, replacement] of [
    [invite, { teamId: "another-team" }], [invite, null], [config, null],
    [user, { activeTeamId: "another-team" }], [user, null],
    [team, null], [team, { membershipBatchPending: true }],
    [member, null], [member, { role: "admin", archived: true }], [member, { role: "member" }],
    [confirmation, null], [confirmation, { teamId, adultConfirmed: false }],
    [confirmation, { teamId, adultConfirmed: "true" }],
    [confirmation, { teamId: "another-team", adultConfirmed: true }],
  ]) {
    const { docs, access, request } = fixture();
    assert.deepEqual(await access(request), { allowed: true });
    if (replacement === null) docs.delete(path);
    else docs.set(path, replacement);
    assert.deepEqual(await access(request), { allowed: false }, path);
  }
});

test("a member of the debug team cannot use the feature for a different team", async () => {
  const { access, request, reads } = fixture();
  request.data.teamId = "another-team";
  assert.deepEqual(await access(request), { allowed: false });
  assert.deepEqual(reads, [config, invite]);
});

test("client claims, a writable user profile, and the advertising age flag cannot confer permission", async () => {
  const { docs, access, request } = fixture();
  docs.delete(confirmation);
  docs.set(user, { activeTeamId: teamId, adultConfirmed: true, role: "owner" });
  docs.set(`${user}/adAge/profile`, { adultConfirmed: true });
  Object.assign(request.data, { adultConfirmed: true, role: "owner", allowed: true });
  assert.deepEqual(await access(request), { allowed: false });
});

test("rejects missing authentication, account switches and malformed IDs before reading Firestore", async () => {
  const { access, request, reads } = fixture();
  for (const auth of [null, { uid, token: { email_verified: false } }]) {
    await assert.rejects(access({ ...request, auth }), { code: "unauthenticated" });
  }
  await assert.rejects(access({ ...request, data: { teamId, expectedUid: "old-user" } }), { code: "failed-precondition" });
  for (const invalidTeam of [null, "", "  ", {}, "other/team"]) {
    await assert.rejects(access({ ...request, data: { ...request.data, teamId: invalidTeam } }), { code: "invalid-argument" });
  }
  assert.deepEqual(reads, []);
});
