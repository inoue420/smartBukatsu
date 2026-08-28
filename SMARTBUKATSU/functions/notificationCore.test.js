const test = require("node:test");
const assert = require("node:assert/strict");
const {
  NOTIFICATION_CATEGORIES,
  normalizePreferences,
  shouldSendPush,
  getAddedItems,
  getScheduleFingerprint,
  normalizeAbsenceDeadlineDaysBefore,
  getScheduleNotificationWindowDays,
  addDaysToIsoDate,
  scheduleOverlapsDateWindow,
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

test("schedule notification window uses absence deadline plus one day", () => {
  assert.equal(normalizeAbsenceDeadlineDaysBefore(3), 3);
  assert.equal(getScheduleNotificationWindowDays(3), 4);
  assert.equal(getScheduleNotificationWindowDays(0), 1);
  assert.equal(getScheduleNotificationWindowDays(undefined), 4);
  assert.equal(getScheduleNotificationWindowDays(366), 4);
});

test("addDaysToIsoDate handles month boundaries", () => {
  assert.equal(addDaysToIsoDate("2026-08-28", 4), "2026-09-01");
  assert.equal(addDaysToIsoDate("invalid", 4), "");
});

test("schedule overlap includes both notification window boundaries", () => {
  const windowStart = "2026-08-28";
  const windowEnd = "2026-09-01";
  assert.equal(
    scheduleOverlapsDateWindow({ date: "2026-08-28" }, windowStart, windowEnd),
    true,
  );
  assert.equal(
    scheduleOverlapsDateWindow({ date: "2026-09-01" }, windowStart, windowEnd),
    true,
  );
  assert.equal(
    scheduleOverlapsDateWindow({ date: "2026-09-02" }, windowStart, windowEnd),
    false,
  );
  assert.equal(
    scheduleOverlapsDateWindow({ date: "2026-08-27" }, windowStart, windowEnd),
    false,
  );
});

test("schedule overlap supports ranges and selected dates", () => {
  const windowStart = "2026-08-28";
  const windowEnd = "2026-09-01";
  assert.equal(
    scheduleOverlapsDateWindow(
      { date: "2026-08-25", endDate: "2026-08-29" },
      windowStart,
      windowEnd,
    ),
    true,
  );
  assert.equal(
    scheduleOverlapsDateWindow(
      {
        date: "2026-08-25",
        endDate: "2026-09-05",
        selectedDates: ["2026-08-27", "2026-09-02"],
      },
      windowStart,
      windowEnd,
    ),
    false,
  );
  assert.equal(
    scheduleOverlapsDateWindow(
      { selectedDates: ["2026-08-27", "2026-08-30"] },
      windowStart,
      windowEnd,
    ),
    true,
  );
});
