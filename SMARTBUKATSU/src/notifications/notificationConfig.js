export const NOTIFICATION_CATEGORIES = {
  notice: {
    label: "お知らせ",
    description: "新しいお知らせと重要な更新",
    icon: "📋",
  },
  schedule: {
    label: "予定の作成・変更",
    description: "予定の追加、変更、中止",
    icon: "📅",
  },
  scheduleReminder: {
    label: "予定リマインド",
    description: "予定開始前日の18:00",
    icon: "⏰",
  },
  diaryReply: {
    label: "日誌への返信",
    description: "日誌のコメントとやり取り",
    icon: "📝",
  },
  workspaceReply: {
    label: "共有投稿への返信",
    description: "自分の投稿に届いた返信",
    icon: "💬",
  },
  mention: {
    label: "メンション",
    description: "投稿や返信でのメンション",
    icon: "🗣️",
  },
  system: {
    label: "システム通知",
    description: "SMARTBUKATSUからの重要なお知らせ",
    icon: "🔔",
  },
};

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  masterEnabled: false,
  categories: Object.keys(NOTIFICATION_CATEGORIES).reduce((result, key) => {
    result[key] = true;
    return result;
  }, {}),
  teamEnabled: {},
};

export function normalizeNotificationPreferences(value = {}) {
  const categories = { ...DEFAULT_NOTIFICATION_PREFERENCES.categories };
  Object.keys(categories).forEach((key) => {
    if (typeof value.categories?.[key] === "boolean") {
      categories[key] = value.categories[key];
    }
  });

  const teamEnabled = {};
  if (value.teamEnabled && typeof value.teamEnabled === "object") {
    Object.entries(value.teamEnabled).forEach(([teamId, enabled]) => {
      if (typeof enabled === "boolean") teamEnabled[teamId] = enabled;
    });
  }

  return {
    masterEnabled: value.masterEnabled === true,
    categories,
    teamEnabled,
  };
}

export function getNotificationCategory(category) {
  return (
    NOTIFICATION_CATEGORIES[category] || NOTIFICATION_CATEGORIES.system
  );
}
