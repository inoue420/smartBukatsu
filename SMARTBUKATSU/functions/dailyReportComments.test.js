const test = require("node:test"), assert = require("node:assert/strict");
const { loadSafetyBackend, loadNotificationBackend, memoryFirestore } = require("../scripts/dailyReportCommentsTestHarness.cjs");

function setup(enabled) {
  const h = memoryFirestore();
  h.documents.set("teams/team", { name: "Synthetic team", ...(enabled === undefined ? {} : { dailyReportCommentsEnabled: enabled }) });
  h.documents.set("teams/team/members/reporter", { name: "Reporter", role: "member" });
  const report = { author: "Author", authorUid: "author", date: "2026-10-06", condition: "private condition",
    reflection: "private reflection", painDetails: { treatment: "private treatment" },
    comments: [{ id: "comment", uid: "author", user: "Author", text: "synthetic conversation", status: "sent" }] };
  h.documents.set("teams/team/dailyReports/report", report);
  h.backend = loadSafetyBackend(h.firestore, h.Timestamp);
  h.request = { auth: { uid: "reporter" }, data: { teamId: "team", targetType: "daily_report_comment",
    reportSubject: "content", reason: "other", details: "synthetic report reason", dailyReportId: "report", commentId: "comment" } };
  h.evidence = () => [...h.documents].filter(([key]) => key.includes("/evidence/"));
  h.event = after => ({ params: { teamId: "team", reportId: "report" }, data: {
    before: { exists: true, data: () => report }, after: { exists: Boolean(after), data: () => after } } });
  h.changed = { ...report, comments: [...report.comments, { id: "reply", text: "synthetic reply" }] };
  return h;
}

for (const enabled of [undefined, false, "true"]) test(`OFF/default keeps report metadata without evidence (setting=${enabled})`, async () => {
  const h = setup(enabled), result = await h.backend.submitSafetyReport(h.request);
  assert.equal(result.accepted, true);
  const stored = h.documents.get(`supportCases/${result.caseId}`);
  assert.equal(stored.details, "synthetic report reason");
  assert.equal(stored.targetCommentId, "comment");
  assert.equal(stored.commentEvidenceEnabledAtReport, false);
  assert.equal(h.evidence().length, 0);
  assert.equal(JSON.stringify(stored).includes("synthetic conversation"), false);
});

test("ON copies only existing conversation evidence; health/reflection fields are excluded", async () => {
  const h = setup(true); await h.backend.submitSafetyReport(h.request);
  assert.equal(h.evidence().length, 1);
  const evidence = h.evidence()[0][1];
  assert.equal(evidence.snapshot.targetComment.text, "synthetic conversation");
  for (const text of ["private condition", "private reflection", "private treatment"]) assert.equal(JSON.stringify(evidence).includes(text), false);
});

test("OFF stops tracking before case queries; unchanged report updates do not read the gate", async () => {
  const h = setup(false); await h.backend.submitSafetyReport(h.request);
  const queryCount = h.stats.queries;
  await h.backend.trackReportedDailyReportChanges(h.event(h.changed));
  assert.equal(h.stats.queries, queryCount); assert.equal(h.evidence().length, 0);
  const readCount = h.stats.reads;
  await h.backend.trackReportedDailyReportChanges(h.event({ ...h.documents.get("teams/team/dailyReports/report"), isReviewed: true }));
  assert.equal(h.stats.reads, readCount);
});

test("ON resumes tracking received/reviewing cases, keeps previous evidence, and skips resolved cases", async () => {
  const h = setup(true), result = await h.backend.submitSafetyReport(h.request);
  h.documents.set("supportCases/resolved", { targetDocumentPath: "teams/team/dailyReports/report", status: "resolved" });
  await h.backend.trackReportedDailyReportChanges(h.event(h.changed)); assert.equal(h.evidence().length, 2);
  h.documents.set("teams/team", { dailyReportCommentsEnabled: false });
  await h.backend.trackReportedDailyReportChanges(h.event(null)); assert.equal(h.evidence().length, 2);
  h.documents.set("teams/team", { dailyReportCommentsEnabled: true });
  assert.equal(h.evidence().length, 2, "switching ON must not run a backfill");
  await h.backend.trackReportedDailyReportChanges(h.event(null));
  assert.equal(h.evidence().length, 3);
  assert.ok(h.evidence().every(([key]) => key.startsWith(`supportCases/${result.caseId}/`)));
});

test("an ON -> OFF transaction conflict keeps case metadata and commits no initial evidence", async () => {
  const h = setup(true);
  h.beforeCommit(() => h.documents.set("teams/team", { dailyReportCommentsEnabled: false }));
  const result = await h.backend.submitSafetyReport(h.request);
  assert.equal(h.stats.retries, 1); assert.equal(h.evidence().length, 0);
  assert.equal(h.documents.get(`supportCases/${result.caseId}`).commentEvidenceEnabledAtReport, false);
});

test("an ON -> OFF conflict during tracking commits no new evidence", async () => {
  const h = setup(true); await h.backend.submitSafetyReport(h.request);
  h.beforeCommit(() => h.documents.set("teams/team", { dailyReportCommentsEnabled: false }));
  await h.backend.trackReportedDailyReportChanges(h.event(h.changed));
  assert.equal(h.stats.retries, 1); assert.equal(h.evidence().length, 1);
});

test("OFF still validates membership and the reported comment", async () => {
  const h = setup(false);
  await assert.rejects(h.backend.submitSafetyReport({ ...h.request, auth: { uid: "outsider" } }), { code: "permission-denied" });
  await assert.rejects(h.backend.submitSafetyReport({ ...h.request, data: { ...h.request.data, commentId: "missing" } }), { code: "not-found" });
  assert.equal(h.evidence().length, 0);
});

test("the diary switch leaves workspace report evidence unchanged", async () => {
  const h = setup(false);
  h.documents.set("teams/team/workspacePosts/post", { content: "Synthetic workspace post", authorUid: "author", user: "Author" });
  await h.backend.submitSafetyReport({ ...h.request, data: { ...h.request.data, targetType: "workspace_post", postId: "post" } });
  assert.equal(h.evidence().length, 1); assert.equal(h.evidence()[0][1].snapshot.content, "Synthetic workspace post");
});

function notificationSetup(enabled) {
  const h = setup(enabled);
  h.documents.set("users/author", {});
  h.documents.set("teams/team/members/author", { role: "member" });
  h.documents.set("users/author/notificationPreferences/default", { masterEnabled: false });
  h.notifications = loadNotificationBackend(h.firestore, h.Timestamp);
  h.notificationEvent = { params: { teamId: "team", reportId: "report" }, data: {
    before: { exists: true, data: () => ({ authorUid: "author", comments: [] }) },
    after: { exists: true, data: () => ({ authorUid: "author", comments: [{ id: "new", uid: "coach", user: "Coach", text: "Synthetic new comment" }] }) } } };
  return h;
}
test("OFF rejects a delayed diary notification before creating notification/summary documents", async () => {
  const h = notificationSetup(false);
  await h.notifications.notifyDailyReportWritten(h.notificationEvent);
  assert.equal(h.stats.writes, 0); assert.equal(h.stats.reads, 1);
});
test("ON creates the existing diary notification and summary, without a new backup", async () => {
  const h = notificationSetup(true);
  await h.notifications.notifyDailyReportWritten(h.notificationEvent);
  assert.equal(h.stats.writes, 2);
  assert.equal(h.documents.get("users/author/notifications/diary_reply_team_report_new").body, "Synthetic new comment");
  assert.equal(h.documents.get("users/author/notificationState/summary").unreadTotal, 1);
  assert.equal(h.evidence().length, 0);
});
test("OFF during notification transaction suppresses both notification and counter writes", async () => {
  const h = notificationSetup(true);
  h.beforeCommit(() => h.documents.set("teams/team", { dailyReportCommentsEnabled: false }));
  await h.notifications.notifyDailyReportWritten(h.notificationEvent);
  assert.equal(h.stats.retries, 1); assert.equal(h.stats.writes, 0);
});

test("events from before re-enabling are skipped with nanosecond precision; later changes are tracked", async () => {
  const h = setup(true); await h.backend.submitSafetyReport(h.request);
  h.documents.set("teams/team", { dailyReportCommentsEnabled: true, dailyReportCommentsUpdatedAt: { seconds: 10, nanoseconds: 200 } });
  await h.backend.trackReportedDailyReportChanges({ ...h.event(h.changed), time: "1970-01-01T00:00:10.000000100Z" });
  assert.equal(h.evidence().length, 1); assert.equal(h.stats.queries, 0);
  await h.backend.trackReportedDailyReportChanges({ ...h.event(h.changed), time: "1970-01-01T00:00:10.000000300Z" });
  assert.equal(h.evidence().length, 2);
});
test("a diary notification from before re-enabling is not saved later", async () => {
  const h = notificationSetup(true);
  h.documents.set("teams/team", { dailyReportCommentsEnabled: true, dailyReportCommentsUpdatedAt: { seconds: 10, nanoseconds: 200 } });
  await h.notifications.notifyDailyReportWritten({ ...h.notificationEvent, time: "1970-01-01T00:00:10.000000100Z" });
  assert.equal(h.stats.writes, 0);
  await h.notifications.notifyDailyReportWritten({ ...h.notificationEvent, time: "1970-01-01T00:00:10.000000300Z" });
  assert.equal(h.stats.writes, 2);
});
test("a second enable generation during notification processing suppresses an earlier event", async () => {
  const h = notificationSetup(true);
  h.beforeCommit(() => h.documents.set("teams/team", { dailyReportCommentsEnabled: true,
    dailyReportCommentsUpdatedAt: { seconds: 10, nanoseconds: 200 } }));
  await h.notifications.notifyDailyReportWritten({ ...h.notificationEvent, time: "1970-01-01T00:00:10.000000100Z" });
  assert.equal(h.stats.retries, 1); assert.equal(h.stats.writes, 0);
});
