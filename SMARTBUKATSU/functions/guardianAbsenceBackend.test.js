const test = require("node:test"), assert = require("node:assert/strict");
const { createGuardianAbsenceBackend, eventDates, absenceDeadline } = require("./guardianAbsenceBackend");
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }

test("calendar dates preserve explicit nonconsecutive days and legacy slash formats", () => {
  assert.deepEqual(eventDates({ selectedDates: ["2099/1/2", "2099-01-04", "2099-01-02"] }), ["2099-01-02", "2099-01-04"]);
  assert.deepEqual(eventDates({ date: "2099/1/30", endDate: "2099/2/2" }), ["2099-01-30", "2099-01-31", "2099-02-01", "2099-02-02"]);
  assert.deepEqual(eventDates({ date: "2099-02-30" }), []);
});
test("deadlines use JST midnight and validate the configured day count", () => {
  assert.equal(absenceDeadline({}, "2099-01-10", 3), Date.parse("2099-01-07T00:00:00+09:00"));
  for (const value of [-1, 366, "invalid"]) assert.equal(absenceDeadline({}, "2099-01-10", value), Date.parse("2099-01-07T00:00:00+09:00"));
});
test("same-day deadline uses the selected day's schedule, including all-day overrides", () => {
  const event = { startTime: "08:00", timeSchedules: { "2099-01-10": { start: "16:30" } } };
  assert.equal(absenceDeadline(event, "2099-01-10", 0), Date.parse("2099-01-10T16:30:00+09:00"));
  event.timeSchedules["2099-01-10"].isAllDay = true;
  assert.equal(absenceDeadline(event, "2099-01-10", 0), Date.parse("2099-01-10T00:00:00+09:00"));
});
test("invalid or unauthenticated requests fail before any database operation", async () => {
  const backend = createGuardianAbsenceBackend({ firestore: {}, FieldValue: {}, HttpsError });
  for (const method of ["setChildren", "submit", "cancel"]) {
    await assert.rejects(backend[method]({ data: { teamId: "team" } }), (error) => error.code === "unauthenticated");
    await assert.rejects(backend[method]({ auth: { uid: "a" }, data: { teamId: "bad/id" } }), (error) => error.code === "invalid-argument");
  }
  for (const childUids of [["a", "a"], ["guardian"], ["bad/id"], Array(101).fill("x"), null]) {
    await assert.rejects(backend.setChildren({ auth: { uid: "staff" }, data: { teamId: "team", guardianUid: "guardian", childUids } }), (error) => error.code === "invalid-argument");
  }
  for (const extra of [{ manualChildIds: ["a", "a"] }, { manualChildIds: null },
    { manualChildIds: ["x"], newManualChildren: [{ id: "x", name: " " }] },
    { manualChildIds: ["x"], newManualChildren: [{ id: "x", name: "x".repeat(101) }] },
    { manualChildIds: [], newManualChildren: [{ id: "x", name: "Synthetic" }] }]) {
    await assert.rejects(backend.setChildren({ auth: { uid: "staff" }, data: { teamId: "team", guardianUid: "guardian", childUids: [], ...extra } }), (error) => error.code === "invalid-argument");
  }
  for (const data of [{ date: "2099-02-30", text: "reason" }, { date: "2099-01-10", text: " " }, { date: "2099-01-10", text: "x".repeat(2001) }]) {
    await assert.rejects(backend.submit({ auth: { uid: "member" }, data: { teamId: "team", eventId: "event", ...data } }), (error) => error.code === "invalid-argument");
  }
});

test("account deletion includes historical proxy teams after leaving a team", async () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const source = fs.readFileSync(require("node:path").join(__dirname, "index.js"), "utf8");
  const node = require("@babel/parser").parse(source).program.body.find((item) => item.declarations?.[0]?.id?.name === "getAccountDeletionContext");
  const teamRef = { get: async () => ({ exists: true, data: () => ({ name: "Synthetic departed team" }) }),
    collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
  const getContext = vm.runInNewContext(`(${source.slice(node.declarations[0].init.start, node.declarations[0].init.end)})`, {
    firestore: { collection: (name) => name === "users" ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ teamIds: [] }) }) }) }
      : { where: () => ({ get: async () => ({ docs: [] }) }), doc: () => teamRef } },
    normalizeTeamIds: () => [], tacticalNotes: { relatedTeamIds: async () => [] }, loadingOptimization: { relatedTeamIds: async () => [] },
    workspaceReactions: { relatedTeamIds: async () => [] }, guardianAbsences: { relatedTeamIds: async () => ["departed"] },
  });
  const context = await getContext("synthetic-person");
  assert.deepEqual(Array.from(context.teamIds), ["departed"]); assert.equal(context.teamEntries[0].teamId, "departed");
});

test("account anonymization preserves a manual child's identity even when its name or ID matches the deleted parent", () => {
  const fs = require("node:fs"), vm = require("node:vm");
  const source = fs.readFileSync(require("node:path").join(__dirname, "index.js"), "utf8");
  const names = new Set(["DELETED_USER_UID", "DELETED_USER_LABEL", "UID_IDENTITY_FIELDS", "DISPLAY_NAME_FIELDS", "LEGACY_DISPLAY_IDENTITY_FIELDS",
    "PROFILE_NAME_IDENTITY_FIELDS", "NAME_ARRAY_FIELDS", "NAME_SCALAR_FIELDS", "isPlainObject", "anonymizeAccountValue", "getAccountDocumentUpdates"]);
  const declarations = require("@babel/parser").parse(source).program.body.filter((node) => names.has(node.declarations?.[0]?.id?.name))
    .map((node) => source.slice(node.start, node.end)).join("\n");
  const update = vm.runInThisContext(`(function() { ${declarations}; return getAccountDocumentUpdates; })`)();
  const context = { uid: "same-id", uniqueDisplayNames: new Set(["Same name"]) };
  const manual = { id: "report", uid: "", childId: "same-id", user: "Same name", submittedBy: { uid: "same-id", user: "Same name" } };
  const result = update({ absenceComments: [manual, { id: "member", uid: "same-id", user: "Same name" }], manualChildren: [{ id: "same-id", name: "Same name" }] }, context);
  assert.equal(result.absenceComments[0].childId, "same-id"); assert.equal(result.absenceComments[0].user, "Same name");
  assert.deepEqual(result.absenceComments[0].submittedBy, { uid: "deleted_user", user: "削除済みユーザー" });
  assert.equal(result.absenceComments[1].uid, "deleted_user"); assert.equal(result.absenceComments[1].user, "削除済みユーザー");
  assert.equal(Object.hasOwn(result, "manualChildren"), false);
});
