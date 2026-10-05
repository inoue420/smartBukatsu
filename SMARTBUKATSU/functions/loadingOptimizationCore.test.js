const test = require("node:test"), assert = require("node:assert/strict");
const { lastEventDate, contributions, adjustSummary, audienceFor } = require("./loadingOptimizationCore");
const members = [{ uid: "owner", name: "Coach", profileKey: "Coach", role: "owner" }, { uid: "staff", name: "Staff", profileKey: "Staff", role: "staff", staffScope: "assigned" }, { uid: "a", name: "A", profileKey: "A", role: "member", assignedStaff: "Staff" }, { uid: "b", name: "B", profileKey: "B", role: "member" }, { uid: "g", name: "G", profileKey: "G", role: "guardian" }];
test("legacy and selected multi-day schedules preserve overlapping dates", () => {
  assert.equal(lastEventDate({ date: "2026-09-30", endDate: "2026-10-02" }), "2026-10-02");
  assert.equal(lastEventDate({ date: "2026-09-30", selectedDates: ["2026-10-03", "2026-09-30"] }), "2026-10-03");
  assert.equal(lastEventDate({ date: "2026-10-01" }), "2026-10-01");
});
test("old medical reports remain counted with staff assigned-scope and all scale thresholds", () => {
  const data = { authorUid: "a", author: "A", fatigue: 8, medicalScaleVersion: 1, hasPain: false };
  const result = contributions("dailyReports", data, members);
  assert.deepEqual(result.staff.medicalHistogram, { "0:0:4:0": 1 });
  assert.equal(contributions("dailyReports", { ...data, authorUid: "b", author: "B" }, members).staff, undefined);
  assert.deepEqual(contributions("dailyReports", { ...data, isReviewed: true }, members), {});
});
test("notice read counts are independent of the limited list and deletion subtracts contributions", () => {
  const result = contributions("notices", { readBy: ["A"] }, members); assert.equal(result.a, undefined); assert.equal(result.b.unreadNoticeCount, 1);
  assert.equal(adjustSummary({ unreadNoticeCount: 10 }, result.b, {}).unreadNoticeCount, 9);
});
test("legacy and separated post/reply notification read state agree", () => {
  const post = { authorUid: "b", user: "B", content: "@A", visibleToUids: ["a"], replies: [{ id: "r", user: "B", content: "@A" }] };
  assert.equal(contributions("workspacePosts", post, members).a.workspaceNotificationUnreadCount, 2);
  const separated = { notificationReads: { a: ["post"] }, notificationDismissals: { a: ["reply:r"] } };
  assert.deepEqual(contributions("workspacePosts", post, members, separated), {});
  assert.deepEqual(contributions("workspacePosts", { ...post, readNotifs: ["A"], replies: [{ ...post.replies[0], dismissedNotifs: ["A"] }] }, members), {});
});
test("hidden, blocked and invisible posts never enter the notification badge", () => {
  const post = { authorUid: "b", user: "B", content: "@A", visibleToUids: ["a"] };
  assert.deepEqual(contributions("workspacePosts", { ...post, moderationStatus: "hidden" }, members), {});
  assert.deepEqual(contributions("workspacePosts", post, members.map((member) => ({ ...member, blockedUserUids: ["b"] }))), {});
  assert.deepEqual(contributions("workspacePosts", { ...post, visibleToUids: [] }, members), {});
});
test("contribution replay and changed category preserve exact counters", () => {
  const initial = { medicalHistogram: { "0:0:4:0": 7 }, unreadNoticeCount: 2 };
  const before = { medicalHistogram: { "0:0:4:0": 1 } }, after = { medicalHistogram: { "1:0:4:0": 1 } };
  const updated = adjustSummary(initial, before, after);
  assert.deepEqual(updated.medicalHistogram, { "0:0:4:0": 6, "1:0:4:0": 1 }); assert.deepEqual(adjustSummary(updated, after, after), updated);
});
test("audience repair keeps captain, guardian, coach-only and legacy group rules", () => {
  const post = { authorUid: "a", channelId: "channel" };
  const coach = audienceFor(post, [{ id: "channel", shareScope: "coach" }], members);
  assert.deepEqual(coach.visibleToUids, ["a", "owner", "staff"]); assert.ok(!coach.readTargetUids.includes("g"));
  const group = audienceFor(post, [{ id: "channel", shareScope: "group", allowedMembers: ["G"] }], members);
  assert.deepEqual(group.visibleToUids, ["a", "g", "owner", "staff"]);
});
