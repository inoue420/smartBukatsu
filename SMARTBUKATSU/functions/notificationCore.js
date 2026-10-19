const NOTIFICATION_CATEGORIES = Object.freeze({
  NOTICE: "notice",
  SCHEDULE: "schedule",
  DIARY_REPLY: "diaryReply",
  WORKSPACE_REPLY: "workspaceReply",
  WORKSPACE_POST: "workspacePost",
  MENTION: "mention",
  MEMBER_JOIN: "memberJoin",
  SYSTEM: "system",
});

const DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE = 3;
const MAX_ABSENCE_DEADLINE_DAYS_BEFORE = 365;

const DEFAULT_CATEGORY_PREFERENCES = Object.freeze(
  Object.values(NOTIFICATION_CATEGORIES).reduce((result, category) => {
    result[category] = true;
    return result;
  }, {}),
);

function normalizeBooleanMap(value, allowedKeys, defaultValue = true) {
  const source = value && typeof value === "object" ? value : {};
  return allowedKeys.reduce((result, key) => {
    result[key] =
      typeof source[key] === "boolean" ? source[key] : defaultValue;
    return result;
  }, {});
}

function normalizePreferences(value = {}) {
  const teamEnabled = {};
  if (value.teamEnabled && typeof value.teamEnabled === "object") {
    Object.entries(value.teamEnabled)
      .slice(0, 100)
      .forEach(([teamId, enabled]) => {
        if (/^[A-Za-z0-9_-]{1,128}$/.test(teamId) && typeof enabled === "boolean") {
          teamEnabled[teamId] = enabled;
        }
      });
  }

  return {
    masterEnabled: value.masterEnabled === true,
    categories: normalizeBooleanMap(
      value.categories,
      Object.values(NOTIFICATION_CATEGORIES),
      true,
    ),
    teamEnabled,
  };
}

function shouldSendPush(preferences, category, teamId) {
  const normalized = normalizePreferences(preferences);
  if (category === "scheduleReminder") return false;
  if (!Object.values(NOTIFICATION_CATEGORIES).includes(category)) category = "system";
  if (!normalized.masterEnabled) return false;
  if (normalized.categories[category] === false) return false;
  if (teamId && normalized.teamEnabled[teamId] === false) return false;
  return true;
}

function adjustUnreadSummary(summary, notification, delta) {
  const teamId = notification.teamId || "";
  const key = JSON.stringify([notification.category || "system", teamId]);
  const unreadByTeam = { ...(summary.unreadByTeam || {}) };
  if (teamId) unreadByTeam[teamId] = Math.max(0, (Number(unreadByTeam[teamId]) || 0) + delta);
  return {
    unreadTotal: Math.max(0, (Number(summary.unreadTotal) || 0) + delta),
    unreadByTeam,
    unreadBucketsVersion: 1,
    unreadBuckets: {
      ...(summary.unreadBuckets || {}),
      [key]: Math.max(0, (Number(summary.unreadBuckets?.[key]) || 0) + delta),
    },
  };
}

function summarizeUnreadNotifications(notifications) {
  return notifications.reduce((summary, notification) =>
    notification.readAt || notification.dismissedAt
      ? summary
      : adjustUnreadSummary(summary, notification, 1),
  { unreadTotal: 0, unreadByTeam: {}, unreadBucketsVersion: 1, unreadBuckets: {} });
}

function getVisibleUnreadSummary(summary = {}, preferences) {
  const result = { unreadTotal: 0, unreadByTeam: {} };
  if (summary.unreadBucketsVersion !== 1) return result;
  Object.entries(summary.unreadBuckets || {}).forEach(([key, value]) => {
    let category, teamId;
    try {
      [category, teamId] = JSON.parse(key);
    } catch {
      return;
    }
    if (!shouldSendPush(preferences, category, teamId)) return;
    const count = Math.max(0, Number(value) || 0);
    result.unreadTotal += count;
    if (teamId) result.unreadByTeam[teamId] = (result.unreadByTeam[teamId] || 0) + count;
  });
  return result;
}

function getAddedItems(beforeItems, afterItems) {
  const beforeIds = new Set(
    (Array.isArray(beforeItems) ? beforeItems : [])
      .map((item) => item?.id)
      .filter(Boolean),
  );
  return (Array.isArray(afterItems) ? afterItems : []).filter(
    (item) => item?.id && !beforeIds.has(item.id),
  );
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value ?? null;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function getScheduleFingerprint(event = {}) {
  return JSON.stringify(
    stableValue({
      title: event.title || "",
      description: event.description || "",
      date: event.date || "",
      endDate: event.endDate || "",
      selectedDates: event.selectedDates || [],
      startTime: event.startTime || "",
      endTime: event.endTime || "",
      isAllDay: event.isAllDay === true,
      isMultiDay: event.isMultiDay === true,
      timeSchedules: event.timeSchedules || {},
      location: event.location || event.locationName || "",
      locationAddress: event.locationAddress || "",
      status: event.status || "active",
    }),
  );
}

function normalizeAbsenceDeadlineDaysBefore(value) {
  const daysBefore = Number(value);
  return Number.isInteger(daysBefore) &&
    daysBefore >= 0 &&
    daysBefore <= MAX_ABSENCE_DEADLINE_DAYS_BEFORE
    ? daysBefore
    : DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE;
}

function getScheduleNotificationWindowDays(absenceDeadlineDaysBefore) {
  return normalizeAbsenceDeadlineDaysBefore(absenceDeadlineDaysBefore) + 1;
}

function parseIsoDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function addDaysToIsoDate(dateString, days) {
  const date = parseIsoDateString(dateString);
  if (!date || !Number.isInteger(days)) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function scheduleOverlapsDateWindow(event = {}, windowStart, windowEnd) {
  if (!parseIsoDateString(windowStart) || !parseIsoDateString(windowEnd)) {
    return false;
  }
  if (windowStart > windowEnd) return false;

  const selectedDates = (Array.isArray(event.selectedDates)
    ? event.selectedDates
    : []
  ).filter((date) => parseIsoDateString(date));
  if (selectedDates.length > 0) {
    return selectedDates.some(
      (date) => date >= windowStart && date <= windowEnd,
    );
  }

  const eventStart = parseIsoDateString(event.date) ? event.date : "";
  if (!eventStart) return false;
  const configuredEnd = parseIsoDateString(event.endDate)
    ? event.endDate
    : eventStart;
  const eventEnd = configuredEnd >= eventStart ? configuredEnd : eventStart;
  return eventStart <= windowEnd && eventEnd >= windowStart;
}

function getNoticeFingerprint(notice = {}) {
  return JSON.stringify({
    title: notice.title || "",
    content: notice.content || "",
    isImportant: notice.isImportant === true,
    status: notice.status || "active",
  });
}

module.exports = {
  NOTIFICATION_CATEGORIES,
  DEFAULT_CATEGORY_PREFERENCES,
  normalizePreferences,
  shouldSendPush,
  adjustUnreadSummary,
  summarizeUnreadNotifications,
  getVisibleUnreadSummary,
  getAddedItems,
  getScheduleFingerprint,
  normalizeAbsenceDeadlineDaysBefore,
  getScheduleNotificationWindowDays,
  addDaysToIsoDate,
  scheduleOverlapsDateWindow,
  getNoticeFingerprint,
};
