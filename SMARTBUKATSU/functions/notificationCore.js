const NOTIFICATION_CATEGORIES = Object.freeze({
  NOTICE: "notice",
  SCHEDULE: "schedule",
  SCHEDULE_REMINDER: "scheduleReminder",
  DIARY_REPLY: "diaryReply",
  WORKSPACE_REPLY: "workspaceReply",
  MENTION: "mention",
  SYSTEM: "system",
});

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
  if (!normalized.masterEnabled) return false;
  if (normalized.categories[category] === false) return false;
  if (teamId && normalized.teamEnabled[teamId] === false) return false;
  return true;
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
  getAddedItems,
  getScheduleFingerprint,
  getNoticeFingerprint,
};
