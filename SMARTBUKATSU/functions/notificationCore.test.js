const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOTIFICATION_CATEGORIES,
  normalizePreferences,
  shouldSendPush,
  getAddedItems,
  getScheduleFingerprint,
} = require("./notificationCore");

test("push is disabled until the user opts in", () => {
  assert.equal(
    shouldSendPush({}, NOTIFICATION_CATEGORIES.NOTICE, "team-a"),
    false,
  );
});

test("category and team overrides only affect push delivery", () => {
  const preferences = normalizePreferences({
    masterEnabled: true,
    categories: { notice: false },
    teamEnabled: { "team-a": false, "team-b": true },
  });

  assert.equal(
    shouldSendPush(preferences, NOTIFICATION_CATEGORIES.NOTICE, "team-b"),
    false,
  );
  assert.equal(
    shouldSendPush(preferences, NOTIFICATION_CATEGORIES.MENTION, "team-a"),
    false,
  );
  assert.equal(
    shouldSendPush(preferences, NOTIFICATION_CATEGORIES.MENTION, "team-b"),
    true,
  );
});

test("added reply detection is idempotent", () => {
  const before = [{ id: "a" }];
  const after = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    getAddedItems(before, after).map((item) => item.id),
    ["b", "c"],
  );
});

test("schedule fingerprint ignores absence comments", () => {
  const base = { title: "練習", date: "2026-09-01", startTime: "18:00" };
  assert.equal(
    getScheduleFingerprint({ ...base, absenceComments: [{ id: "a" }] }),
    getScheduleFingerprint({ ...base, absenceComments: [{ id: "b" }] }),
  );
  assert.notEqual(
    getScheduleFingerprint(base),
    getScheduleFingerprint({ ...base, startTime: "19:00" }),
  );
});
