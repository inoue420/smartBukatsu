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
  workspacePost: {
    label: "チャンネルの新規投稿",
    description: "公開範囲とスタッフの通知先設定に応じた新しい投稿",
    icon: "📣",
  },
  mention: {
    label: "メンション",
    description: "投稿や返信でのメンション",
    icon: "🗣️",
  },
  memberJoin: {
    label: "メンバーの追加",
    description: "新しいメンバーがチームに参加したとき",
    icon: "👤",
  },
  system: {
    label: "システム通知",
    description: "SMARTBUKATSUからの重要なお知らせ",
    icon: "🔔",
  },
  operatorGuidance: {
    label: "運営からのご案内",
    description: "運営からのご案内とやり取りの返信",
    icon: "📖",
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

export function isNotificationVisible(preferences, notification = {}) {
  notification = notification || {};
  if (preferences?.masterEnabled !== true || notification.category === "scheduleReminder") {
    return false;
  }
  const category = Object.prototype.hasOwnProperty.call(NOTIFICATION_CATEGORIES, notification.category)
    ? notification.category
    : "system";
  return preferences.categories?.[category] !== false &&
    (!notification.teamId || preferences.teamEnabled?.[notification.teamId] !== false);
}

export function getVisibleUnreadSummary(summary = {}, preferences) {
  const result = { unreadTotal: 0, unreadByTeam: {} };
  // Legacy totals include hidden categories. Wait for the server's one-time repair.
  if (summary.unreadBucketsVersion !== 1) return result;
  Object.entries(summary.unreadBuckets || {}).forEach(([key, value]) => {
    let category, teamId;
    try {
      [category, teamId] = JSON.parse(key);
    } catch {
      return;
    }
    if (!isNotificationVisible(preferences, { category, teamId })) return;
    const count = Math.max(0, Number(value) || 0);
    result.unreadTotal += count;
    if (teamId) result.unreadByTeam[teamId] = (result.unreadByTeam[teamId] || 0) + count;
  });
  return result;
}
