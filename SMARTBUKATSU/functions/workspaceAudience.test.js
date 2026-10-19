const test = require("node:test");
const assert = require("node:assert/strict");
const { canViewChannel, audienceForChannel, channelRoleGroups, channelMemberAudience, needsGeneralAudienceUpgrade } = require("./workspaceAudience");
const { audienceFor } = require("./loadingOptimizationCore");

const members = [
  { uid: "staff", role: "staff", grade: "1年生" },
  { uid: "captain", role: "captain", grade: "1年生" },
  { uid: "first", role: "member", grade: "1年生" },
  { uid: "second", role: "member", grade: "2年生" },
  { uid: "unset", role: "member", grade: "" },
  { uid: "guardian", role: "guardian", grade: "1年生" },
];
const channel = { id: "grade", shareScope: "grades", allowedRoleGroups: [], allowedGrades: ["1年生"] };

test("grade audiences include captains and exclude unset/other grades and unselected roles", () => {
  assert.deepEqual(audienceForChannel(channel, members).visibleToUids, ["captain", "first"]);
  assert.equal(canViewChannel(channel, members.find((member) => member.uid === "staff"), members), false);
  assert.deepEqual(audienceForChannel({ ...channel, allowedGrades: [] }, members).visibleToUids, []);
});

test("staff/guardian choices are independent of grade, and guardians are not read targets", () => {
  const result = audienceForChannel({ ...channel, allowedRoleGroups: ["staff", "guardian"] }, members);
  assert.deepEqual(result.visibleToUids, ["captain", "first", "guardian", "staff"]);
  assert.deepEqual(result.readTargetUids, ["captain", "first", "staff"]);
});

test("legacy role scopes remain unchanged until a manager saves the channel", () => {
  for (const legacy of [{ allowedRoleGroups: ["captain"] }, { shareScope: "coach" },
    { shareScope: "group", allowedMemberUids: ["guardian"] }, {}]) {
    const before = JSON.stringify(legacy), groups = channelRoleGroups(legacy, members);
    assert.ok(groups.length > 0);
    if (legacy.allowedRoleGroups) assert.deepEqual(audienceForChannel(legacy, members).visibleToUids, ["captain"]);
    if (!Object.keys(legacy).length) assert.ok(audienceForChannel(legacy, members).visibleToUids.includes("unset"));
    assert.equal(JSON.stringify(legacy), before);
  }
});

test("the app and server repair use the same audience, retaining author access", () => {
  for (const authorUid of ["", "second", "guardian"]) {
    const result = audienceForChannel(channel, members, authorUid);
    assert.deepEqual(audienceFor({ channelId: "grade", authorUid }, [channel], members), result);
    if (authorUid) assert.ok(result.visibleToUids.includes(authorUid));
    assert.ok(!result.readTargetUids.includes("guardian"));
  }
});

test("arbitrary grade names cannot collide with staff/guardian role selections", () => {
  const roster = [{ uid: "member", role: "member", grade: "staff" }, { uid: "coach", role: "staff" }];
  assert.deepEqual(audienceForChannel({ ...channel, allowedGrades: ["staff"] }, roster).visibleToUids, ["member"]);
  assert.deepEqual(audienceForChannel({ ...channel, allowedRoleGroups: ["staff"], allowedGrades: [] }, roster).visibleToUids, ["coach"]);
});

test("all-member mode includes unset grades and captains without granting staff/guardian access", () => {
  const all = { ...channel, memberAudience: "all", allowedGrades: [] };
  assert.deepEqual(audienceForChannel(all, members).visibleToUids, ["captain", "first", "second", "unset"]);
  assert.equal(audienceForChannel(all, members).shareScope, "roles");
  assert.deepEqual(audienceForChannel({ ...all, memberAudience: "none" }, members).visibleToUids, []);
});

test("existing system General defaults to all, but subsequent explicit grade/none choices are respected", () => {
  const general = { ...channel, id: "ch_1", name: "全体連絡" };
  assert.equal(needsGeneralAudienceUpgrade(general), true);
  assert.equal(channelMemberAudience(general), "all");
  assert.ok(audienceForChannel(general, members).visibleToUids.includes("unset"));
  assert.deepEqual(audienceForChannel({ ...general, memberAudience: "grades" }, members).visibleToUids, ["captain", "first"]);
  assert.equal(needsGeneralAudienceUpgrade({ ...general, memberAudience: "none" }), false);
  assert.deepEqual(audienceForChannel({ ...general, memberAudience: "none" }, members).visibleToUids, []);
  assert.equal(needsGeneralAudienceUpgrade({ name: "全体連絡" }), true);
  assert.equal(needsGeneralAudienceUpgrade({ ...general, id: "custom" }), false);
});
