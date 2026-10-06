const test = require("node:test"), assert = require("node:assert/strict");
const { lastEventDate, contributions, adjustSummary, audienceFor, contentChanges, latestReportData, validLatest, compareReports, stableStringify } = require("./loadingOptimizationCore");
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

test("post and reply stamps, attachments and timestamps do not require aggregate reads", () => {
  const before = { authorUid: "b", user: "B", content: "@A", visibleToUids: ["a"], channel: "General", replies: [{ id: "r", user: "B", content: "@A" }] };
  const after = { ...before, stamps: { a: "good" }, attachments: [{ storagePath: "synthetic" }], updatedAt: { toMillis: () => 5000 }, replies: [{ ...before.replies[0], stamps: { a: "good" }, attachments: [{ storagePath: "synthetic" }], updatedAt: 5000 }] };
  assert.deepEqual(contentChanges("workspacePosts", before, after), { aggregate: false, latest: false });
  assert.deepEqual(contributions("workspacePosts", after, members), contributions("workspacePosts", before, members));
});

test("canonical comparison ignores object, recipient and reply ordering", () => {
  const before = { user: "B", content: "@A", visibleToUids: ["a", "b"], readNotifs: ["A", "B"], replies: [{ id: "r1", user: "A", content: "first" }, { id: "r2", user: "B", content: "second" }] };
  const after = { ...before, visibleToUids: ["b", "a", "a"], readNotifs: ["B", "A"], replies: [{ content: "second", user: "B", id: "r2" }, { content: "first", id: "r1", user: "A" }] };
  assert.deepEqual(contentChanges("workspacePosts", before, after), { aggregate: false, latest: false });
  assert.equal(stableStringify({ z: [{ y: 2, x: 1 }], a: { toMillis: () => 1000, seconds: 1, nanoseconds: 0 } }), stableStringify({ a: { nanoseconds: 0, seconds: 1, toMillis: () => 1000 }, z: [{ x: 1, y: 2 }] }));
  assert.equal(stableStringify({ createdAt: { seconds: 1, nanoseconds: 3 } }), stableStringify({ createdAt: { _nanoseconds: 3, _seconds: 1, toMillis: () => 1000 } }));
});

test("post visibility, moderation, authorship, mentions and legacy notification reads remain relevant", () => {
  const post = { user: "B", authorUid: "b", content: "@A", visibleToUids: ["a"], replies: [{ id: "r", user: "B", content: "@A" }] };
  for (const change of [{ visibleToUids: [] }, { moderationStatus: "hidden" }, { status: "deleted" }, { authorUid: "a" }, { user: "A" }, { content: "changed" }, { readNotifs: ["A"] }, { dismissedNotifs: ["A"] }, { channel: "Other" }, { shareScope: "coach" }, { readTargetUids: ["a"] }, { replies: [{ ...post.replies[0], id: "different" }] }, { replies: [{ ...post.replies[0], author: "A" }] }, { replies: [{ ...post.replies[0], readNotifs: ["A"] }] }, { replies: [{ ...post.replies[0], moderationStatus: "hidden" }] }]) {
    assert.equal(contentChanges("workspacePosts", post, { ...post, ...change }).aggregate, true, JSON.stringify(change));
  }
});

test("staff comments that confirm a report update medical counts but not the latest projection", () => {
  const before = { authorUid: "a", author: "A", fatigue: 5, medicalScaleVersion: 2, isReviewed: false };
  const commentsOnly = { ...before, comments: [{ id: "comment", text: "synthetic" }], attachments: [], updatedAt: 5000 };
  assert.deepEqual(contentChanges("dailyReports", before, commentsOnly), { aggregate: false, latest: false });
  const reviewed = { ...commentsOnly, isReviewed: true };
  assert.deepEqual(contentChanges("dailyReports", before, reviewed), { aggregate: true, latest: false });
  assert.deepEqual(contributions("dailyReports", reviewed, members), {});
});

test("daily report changes distinguish medical aggregates from roster display", () => {
  const before = { authorUid: "a", author: "A", createdAt: 5000, date: "2026-10-06", condition: "普通", fatigue: 4, medicalScaleVersion: 2, hasPain: true, painDetails: { part: "knee", level: 3, treatment: "rest", sinceWhen: "yesterday" } };
  assert.deepEqual(contentChanges("dailyReports", before, { ...before, date: "2026-10-05", sleep: "8", painDetails: { ...before.painDetails, treatment: "ice" } }), { aggregate: false, latest: true });
  assert.deepEqual(contentChanges("dailyReports", before, { ...before, painDetails: { treatment: "rest", level: 3, part: "knee", sinceWhen: "today" }, reflection: "edit", isStarred: true }), { aggregate: false, latest: false });
  for (const change of [{ fatigue: 5 }, { medicalScaleVersion: 1 }, { condition: "不良" }, { isParticipating: "不可" }, { hasPain: false }, { painDetails: { ...before.painDetails, level: 5 } }, { authorUid: "b", author: "B" }, { status: "deleted" }]) {
    assert.deepEqual(contentChanges("dailyReports", before, { ...before, ...change }), { aggregate: true, latest: true }, JSON.stringify(change));
  }
  assert.deepEqual(contentChanges("dailyReports", before, { ...before, sharedWith: "all" }), { aggregate: true, latest: false });
  assert.deepEqual(contentChanges("dailyReports", null, before), { aggregate: true, latest: true });
  assert.deepEqual(contentChanges("dailyReports", before, null), { aggregate: true, latest: true });
});

test("notice body edits skip recalculation while read, publication, visibility and deletion changes do not", () => {
  const before = { title: "notice", content: "body", readBy: ["A", "B"], status: "active" };
  assert.deepEqual(contentChanges("notices", before, { ...before, title: "edit", content: "edit", updatedAt: 5000, readBy: ["B", "A", "A"] }), { aggregate: false, latest: false });
  for (const change of [{ readBy: ["A"] }, { status: "deleted" }, { moderationStatus: "hidden" }, { sharedWith: "all" }, { shareScope: "coach" }, { visibleToUids: ["a"] }, { readTargetUids: ["a"] }]) assert.equal(contentChanges("notices", before, { ...before, ...change }).aggregate, true);
  assert.deepEqual(contentChanges("notices", null, before), { aggregate: true, latest: false });
});

test("latest report projection contains only roster fields and honors explicit UID over legacy name", () => {
  const report = { id: "source-id", authorUid: "a", author: "old name", createdAt: 5000, status: "sent", date: "2026-10-06", condition: "普通", fatigue: 4, medicalScaleVersion: 2, sleep: "8", isParticipating: "通常", hasPain: true, painDetails: { part: "knee", level: 3, treatment: "rest", sinceWhen: "yesterday", attachments: ["synthetic"] }, attachments: ["expired"], comments: ["comment"], reflection: "body", updatedAt: 6000 };
  const projected = latestReportData(report, "real-id", members[2]);
  assert.deepEqual(projected, { id: "real-id", authorUid: "a", author: "A", createdAt: 5000, status: "sent", date: "2026-10-06", condition: "普通", fatigue: 4, medicalScaleVersion: 2, sleep: "8", isParticipating: "通常", hasPain: true, painDetails: { part: "knee", level: 3, treatment: "rest" } });
  assert.equal(validLatest({ ...report, author: "B" }, members[3]), false);
  assert.equal(latestReportData({ ...report, status: "deleted" }, "deleted", members[2]), null);
  assert.equal(validLatest({ author: "A" }, members[2]), true);
  assert.equal(validLatest(null, members[2]), false);
});

test("latest ordering matches descending Firestore timestamp and document ID including nanosecond ties", () => {
  const timestamp = (seconds, nanoseconds) => ({ seconds, nanoseconds, toMillis: () => seconds * 1000 + nanoseconds / 1000000 });
  const records = [{ id: "a", createdAt: timestamp(5, 1) }, { id: "z", createdAt: timestamp(5, 1) }, { id: "b", createdAt: timestamp(5, 2) }, { id: "older", createdAt: 4000 }];
  assert.deepEqual(records.sort(compareReports).map((item) => item.id), ["b", "z", "a", "older"]);
  assert.equal(compareReports({ id: "z", data: () => ({ createdAt: timestamp(5, 1) }) }, { id: "a", createdAt: timestamp(5, 1) }), -1);
  assert.deepEqual([{ id: "\uE000", createdAt: 1 }, { id: "\u{10000}", createdAt: 1 }].sort(compareReports).map((item) => item.id), ["\u{10000}", "\uE000"]);
});
