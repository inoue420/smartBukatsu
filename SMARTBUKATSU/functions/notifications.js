const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const logger = require("firebase-functions/logger");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");
const {
  NOTIFICATION_CATEGORIES,
  DEFAULT_CATEGORY_PREFERENCES,
  normalizePreferences,
  shouldSendPush,
  getAddedItems,
  getScheduleFingerprint,
  getScheduleNotificationWindowDays,
  addDaysToIsoDate,
  scheduleOverlapsDateWindow,
  getNoticeFingerprint,
} = require("./notificationCore");

const firestore = getFirestore();
const REGION = "asia-northeast1";
const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_PUSH_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

function requireAuthenticatedUid(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "ログインが必要です。");
  return uid;
}

function safeDocumentId(value) {
  return String(value || "notification")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 500);
}

function truncate(value, maxLength) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function uniqueUids(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value)),
    ),
  ];
}

function getPushTokenRegistryRef(token) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return firestore.collection("notificationPushTokens").doc(tokenHash);
}

async function deletePushTokenDocument(tokenDocument) {
  const uid = tokenDocument.ref.parent.parent?.id;
  const deviceId = tokenDocument.id;
  if (!uid) {
    await tokenDocument.ref.delete();
    return;
  }
  await firestore.runTransaction(async (transaction) => {
    const currentTokenSnapshot = await transaction.get(tokenDocument.ref);
    if (!currentTokenSnapshot.exists) return;
    const token = String(currentTokenSnapshot.data()?.token || "");
    const registryRef = token ? getPushTokenRegistryRef(token) : null;
    const registrySnapshot = registryRef
      ? await transaction.get(registryRef)
      : null;
    transaction.delete(tokenDocument.ref);
    const registryData = registrySnapshot?.data() || {};
    if (registryData.uid === uid && registryData.deviceId === deviceId) {
      transaction.delete(registryRef);
    }
  });
}

async function getTeamContext(teamId) {
  const teamRef = firestore.collection("teams").doc(teamId);
  const [teamSnapshot, membersSnapshot] = await Promise.all([
    teamRef.get(),
    teamRef.collection("members").get(),
  ]);
  return {
    teamName: teamSnapshot.data()?.name || "所属チーム",
    members: membersSnapshot.docs.map((memberDocument) => ({
      uid: memberDocument.id,
      ...(memberDocument.data() || {}),
    })),
  };
}

async function sendExpoPushForUser({
  uid,
  notification,
  unreadTotal,
  preferences,
}) {
  if (
    !shouldSendPush(
      preferences,
      notification.category,
      notification.teamId,
    )
  ) {
    return;
  }

  const tokensSnapshot = await firestore
    .collection("users")
    .doc(uid)
    .collection("pushTokens")
    .get();
  const tokenDocuments = tokensSnapshot.docs.filter((tokenDocument) =>
    EXPO_PUSH_TOKEN_PATTERN.test(tokenDocument.data()?.token || ""),
  );
  if (tokenDocuments.length === 0) return;

  const messages = tokenDocuments.map((tokenDocument) => ({
    to: tokenDocument.data().token,
    sound: "default",
    title: notification.title,
    body: notification.body,
    badge: Math.max(0, unreadTotal),
    channelId: "smartbukatsu-notifications",
    data: {
      notificationId: notification.id,
      category: notification.category,
      teamId: notification.teamId || "",
      screen: notification.target?.screen || "WorkspaceHome",
      targetParams: JSON.stringify(notification.target?.params || {}),
    },
  }));

  try {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      throw new Error(`Expo push request failed: ${response.status}`);
    }
    const responseBody = await response.json();
    const tickets = Array.isArray(responseBody?.data)
      ? responseBody.data
      : [responseBody?.data];
    const invalidTokenDeletes = [];
    tickets.forEach((ticket, index) => {
      if (
        ticket?.status === "error" &&
        ticket?.details?.error === "DeviceNotRegistered" &&
        tokenDocuments[index]
      ) {
        invalidTokenDeletes.push(deletePushTokenDocument(tokenDocuments[index]));
      }
    });
    await Promise.all(invalidTokenDeletes);
  } catch (error) {
    logger.warn("Expo push delivery failed.", {
      uid,
      notificationId: notification.id,
      message: error?.message,
    });
  }
}

async function createNotificationForUser(uid, payload) {
  const notificationId = safeDocumentId(payload.id);
  const userRef = firestore.collection("users").doc(uid);
  const notificationRef = userRef.collection("notifications").doc(notificationId);
  const summaryRef = userRef.collection("notificationState").doc("summary");
  const preferencesRef = userRef
    .collection("notificationPreferences")
    .doc("default");
  const now = Timestamp.now();
  const notification = {
    id: notificationId,
    category: payload.category,
    teamId: payload.teamId || "",
    teamName: truncate(payload.teamName || "", 120),
    title: truncate(payload.title, 120),
    body: truncate(payload.body, 300),
    target: payload.target || { screen: "WorkspaceHome", params: {} },
    source: payload.source || {},
    createdAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + NOTIFICATION_RETENTION_MS),
    readAt: null,
    dismissedAt: null,
  };

  const transactionResult = await firestore.runTransaction(async (transaction) => {
    const userSnapshot = payload.actorUid
      ? await transaction.get(userRef)
      : null;
    const blockedUserUids = Array.isArray(userSnapshot?.data()?.blockedUserUids)
      ? userSnapshot.data().blockedUserUids
      : [];
    if (payload.actorUid && blockedUserUids.includes(payload.actorUid)) {
      return { created: false, unreadTotal: 0 };
    }
    if (payload.teamId) {
      const membershipSnapshot = await transaction.get(
        firestore
          .collection("teams")
          .doc(payload.teamId)
          .collection("members")
          .doc(uid),
      );
      if (!membershipSnapshot.exists) {
        return { created: false, unreadTotal: 0 };
      }
    }
    const existingSnapshot = await transaction.get(notificationRef);
    if (existingSnapshot.exists) return { created: false, unreadTotal: 0 };

    const summarySnapshot = await transaction.get(summaryRef);
    const summaryData = summarySnapshot.data() || {};
    const unreadByTeam = { ...(summaryData.unreadByTeam || {}) };
    if (notification.teamId) {
      unreadByTeam[notification.teamId] =
        Math.max(0, Number(unreadByTeam[notification.teamId]) || 0) + 1;
    }
    const unreadTotal = Math.max(0, Number(summaryData.unreadTotal) || 0) + 1;

    transaction.create(notificationRef, notification);
    transaction.set(
      summaryRef,
      { unreadTotal, unreadByTeam, updatedAt: now },
      { merge: true },
    );
    return { created: true, unreadTotal };
  });

  if (!transactionResult.created) return false;
  const preferencesSnapshot = await preferencesRef.get();
  await sendExpoPushForUser({
    uid,
    notification,
    unreadTotal: transactionResult.unreadTotal,
    preferences: preferencesSnapshot.data() || {},
  });
  return true;
}

async function fanOutToUids(uids, payload) {
  const results = await Promise.allSettled(
    uniqueUids(uids).map((uid) => createNotificationForUser(uid, payload)),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error("Notification fan-out failed.", {
        uid: uniqueUids(uids)[index],
        notificationId: payload.id,
        message: result.reason?.message,
      });
    }
  });
}

async function fanOutToTeam({
  teamId,
  payload,
  excludeUids = [],
  excludeRoles = [],
}) {
  const { teamName, members } = await getTeamContext(teamId);
  const excludedUidSet = new Set(uniqueUids(excludeUids));
  const excludedRoleSet = new Set(excludeRoles);
  const recipients = members
    .filter(
      (member) =>
        !excludedUidSet.has(member.uid) && !excludedRoleSet.has(member.role),
    )
    .map((member) => member.uid);
  await fanOutToUids(recipients, { ...payload, teamId, teamName });
}

function notificationTarget(screen, params) {
  return { screen, params: params || {} };
}

function actorUid(data = {}) {
  return (
    data.authorUid ||
    data.createdByUid ||
    data.updatedByUid ||
    data.uid ||
    data.createdBy ||
    ""
  );
}

function actorName(data = {}) {
  return data.user || data.author || data.displayName || "チームメンバー";
}

const notifyNoticeWritten = onDocumentWritten(
  {
    document: "teams/{teamId}/notices/{noticeId}",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const beforeData = event.data?.before.exists ? event.data.before.data() : null;
    const afterData = event.data?.after.exists ? event.data.after.data() : null;
    if (!afterData || afterData.status === "deleted") return;
    if (
      beforeData &&
      getNoticeFingerprint(beforeData) === getNoticeFingerprint(afterData)
    ) {
      return;
    }

    const { teamId, noticeId } = event.params;
    const isUpdate = Boolean(beforeData);
    await fanOutToTeam({
      teamId,
      excludeUids: [actorUid(afterData)],
      excludeRoles: ["guardian"],
      payload: {
        id: `notice_${event.id}`,
        category: NOTIFICATION_CATEGORIES.NOTICE,
        title: isUpdate ? "お知らせが更新されました" : "新しいお知らせ",
        body: afterData.title || afterData.content || "お知らせを確認してください。",
        target: notificationTarget("NoticeBoard", { noticeId }),
        source: { collection: "notices", documentId: noticeId },
      },
    });
  },
);

const notifyClubEventWritten = onDocumentWritten(
  {
    document: "teams/{teamId}/clubEvents/{eventId}",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const beforeData = event.data?.before.exists ? event.data.before.data() : null;
    const afterData = event.data?.after.exists ? event.data.after.data() : null;
    if (!afterData) return;
    if (
      beforeData &&
      getScheduleFingerprint(beforeData) === getScheduleFingerprint(afterData)
    ) {
      return;
    }

    const { teamId, eventId } = event.params;
    const teamSnapshot = await firestore.collection("teams").doc(teamId).get();
    const notificationWindowDays = getScheduleNotificationWindowDays(
      teamSnapshot.data()?.absenceDeadlineDaysBefore,
    );
    const windowStart = getJstDateString(new Date());
    const windowEnd = addDaysToIsoDate(windowStart, notificationWindowDays);
    if (
      !scheduleOverlapsDateWindow(beforeData || {}, windowStart, windowEnd) &&
      !scheduleOverlapsDateWindow(afterData, windowStart, windowEnd)
    ) {
      return;
    }

    const isDeleted = afterData.status === "deleted";
    const isUpdate = Boolean(beforeData);
    await fanOutToTeam({
      teamId,
      excludeUids: [actorUid(afterData)],
      payload: {
        id: `schedule_${event.id}`,
        category: NOTIFICATION_CATEGORIES.SCHEDULE,
        title: isDeleted
          ? "予定が中止されました"
          : isUpdate
            ? "予定が変更されました"
            : "新しい予定が追加されました",
        body: afterData.title || "チーム予定を確認してください。",
        target: notificationTarget("Calendar", {
          eventId,
          date: afterData.date || "",
        }),
        source: { collection: "clubEvents", documentId: eventId },
      },
    });
  },
);

const notifyWorkspacePostWritten = onDocumentWritten(
  {
    document: "teams/{teamId}/workspacePosts/{postId}",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const beforeData = event.data?.before.exists ? event.data.before.data() : {};
    const afterData = event.data?.after.exists ? event.data.after.data() : null;
    if (!afterData || afterData.status === "deleted") return;

    const { teamId, postId } = event.params;
    const teamSnapshot = await firestore.collection("teams").doc(teamId).get();
    const teamName = teamSnapshot.data()?.name || "所属チーム";
    const visibleUidSet = new Set(uniqueUids(afterData.visibleToUids));
    const beforeMentions = new Set(uniqueUids(beforeData.mentionedUids));
    const addedPostMentions = uniqueUids(afterData.mentionedUids).filter(
      (uid) =>
        !beforeMentions.has(uid) &&
        uid !== actorUid(afterData) &&
        (visibleUidSet.size === 0 || visibleUidSet.has(uid)),
    );
    if (addedPostMentions.length > 0) {
      await fanOutToUids(addedPostMentions, {
        id: `mention_${event.id}`,
        category: NOTIFICATION_CATEGORIES.MENTION,
        teamId,
        teamName,
        actorUid: actorUid(afterData),
        title: `${actorName(afterData)}さんがあなたをメンションしました`,
        body: afterData.content || "投稿を確認してください。",
        target: notificationTarget("WorkspaceHome", { postId }),
        source: { collection: "workspacePosts", documentId: postId },
      });
    }

    const addedReplies = getAddedItems(beforeData.replies, afterData.replies);
    for (const reply of addedReplies) {
      const senderUid = actorUid(reply);
      const mentionedUids = uniqueUids(reply.mentionedUids).filter(
        (uid) =>
          uid !== senderUid &&
          (visibleUidSet.size === 0 || visibleUidSet.has(uid)),
      );
      if (mentionedUids.length > 0) {
        await fanOutToUids(mentionedUids, {
          id: `reply_mention_${teamId}_${postId}_${reply.id}`,
          category: NOTIFICATION_CATEGORIES.MENTION,
          teamId,
          teamName,
          actorUid: senderUid,
          title: `${actorName(reply)}さんが返信であなたをメンションしました`,
          body: reply.content || "返信を確認してください。",
          target: notificationTarget("WorkspaceHome", {
            postId,
            replyId: reply.id,
          }),
          source: { collection: "workspacePosts", documentId: postId },
        });
      }

      const postAuthorUid = actorUid(afterData);
      if (
        postAuthorUid &&
        postAuthorUid !== senderUid &&
        !mentionedUids.includes(postAuthorUid)
      ) {
        await fanOutToUids([postAuthorUid], {
          id: `workspace_reply_${teamId}_${postId}_${reply.id}`,
          category: NOTIFICATION_CATEGORIES.WORKSPACE_REPLY,
          teamId,
          teamName,
          actorUid: senderUid,
          title: `${actorName(reply)}さんがあなたの投稿に返信しました`,
          body: reply.content || "返信を確認してください。",
          target: notificationTarget("WorkspaceHome", {
            postId,
            replyId: reply.id,
          }),
          source: { collection: "workspacePosts", documentId: postId },
        });
      }
    }
  },
);

const notifyDailyReportWritten = onDocumentWritten(
  {
    document: "teams/{teamId}/dailyReports/{reportId}",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const beforeData = event.data?.before.exists ? event.data.before.data() : {};
    const afterData = event.data?.after.exists ? event.data.after.data() : null;
    if (!afterData || afterData.status === "deleted") return;
    const addedComments = getAddedItems(beforeData.comments, afterData.comments);
    if (addedComments.length === 0) return;

    const { teamId, reportId } = event.params;
    const teamSnapshot = await firestore.collection("teams").doc(teamId).get();
    const teamName = teamSnapshot.data()?.name || "所属チーム";
    for (const comment of addedComments) {
      const senderUid = actorUid(comment);
      const recipientUids = uniqueUids([
        actorUid(afterData),
        ...(Array.isArray(beforeData.comments)
          ? beforeData.comments.map((item) => actorUid(item))
          : []),
      ]).filter((uid) => uid !== senderUid);
      if (recipientUids.length === 0) continue;
      await fanOutToUids(recipientUids, {
        id: `diary_reply_${teamId}_${reportId}_${comment.id}`,
        category: NOTIFICATION_CATEGORIES.DIARY_REPLY,
        teamId,
        teamName,
        actorUid: senderUid,
        title: `${actorName(comment)}さんから日誌への返信`,
        body: comment.text || "日誌の返信を確認してください。",
        target: notificationTarget("Diary", { reportId }),
        source: { collection: "dailyReports", documentId: reportId },
      });
    }
  },
);

function getJstDateString(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const sendScheduledEventReminders = onSchedule(
  {
    region: REGION,
    schedule: "0 18 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const targetDate = getJstDateString(tomorrow);
    const teamsSnapshot = await firestore.collection("teams").get();
    for (const teamDocument of teamsSnapshot.docs) {
      const eventsRef = teamDocument.ref.collection("clubEvents");
      const [startingEventsSnapshot, multiDayEventsSnapshot] = await Promise.all([
        eventsRef.where("date", "==", targetDate).get(),
        eventsRef.where("selectedDates", "array-contains", targetDate).get(),
      ]);
      const eventDocuments = new Map();
      [...startingEventsSnapshot.docs, ...multiDayEventsSnapshot.docs].forEach(
        (document) => eventDocuments.set(document.id, document),
      );

      for (const eventDocument of eventDocuments.values()) {
        const eventData = eventDocument.data() || {};
        if (eventData.status === "deleted") continue;
        await fanOutToTeam({
          teamId: teamDocument.id,
          payload: {
            id: `schedule_reminder_${teamDocument.id}_${eventDocument.id}_${targetDate}`,
            category: NOTIFICATION_CATEGORIES.SCHEDULE_REMINDER,
            title: "明日のチーム予定",
            body: eventData.title || "明日の予定を確認してください。",
            target: notificationTarget("Calendar", {
              eventId: eventDocument.id,
              date: targetDate,
            }),
            source: { collection: "clubEvents", documentId: eventDocument.id },
          },
        });
      }
    }
  },
);

async function updateNotificationState(uid, notificationId, action) {
  const userRef = firestore.collection("users").doc(uid);
  const notificationRef = userRef
    .collection("notifications")
    .doc(safeDocumentId(notificationId));
  const summaryRef = userRef.collection("notificationState").doc("summary");
  const now = Timestamp.now();

  return firestore.runTransaction(async (transaction) => {
    const notificationSnapshot = await transaction.get(notificationRef);
    if (!notificationSnapshot.exists) {
      throw new HttpsError("not-found", "通知が見つかりません。");
    }
    const notificationData = notificationSnapshot.data() || {};
    const wasUnread = !notificationData.readAt;
    const updateData = { updatedAt: now };
    if (action === "read") updateData.readAt = notificationData.readAt || now;
    if (action === "dismiss") {
      updateData.readAt = notificationData.readAt || now;
      updateData.dismissedAt = now;
    }

    if (wasUnread) {
      const summarySnapshot = await transaction.get(summaryRef);
      const summaryData = summarySnapshot.data() || {};
      const unreadByTeam = { ...(summaryData.unreadByTeam || {}) };
      if (notificationData.teamId) {
        unreadByTeam[notificationData.teamId] = Math.max(
          0,
          (Number(unreadByTeam[notificationData.teamId]) || 0) - 1,
        );
      }
      transaction.set(
        summaryRef,
        {
          unreadTotal: Math.max(
            0,
            (Number(summaryData.unreadTotal) || 0) - 1,
          ),
          unreadByTeam,
          updatedAt: now,
        },
        { merge: true },
      );
    }
    transaction.update(notificationRef, updateData);
    return { updated: true };
  });
}

const registerPushToken = onCall(
  { region: REGION, timeoutSeconds: 30, memory: "256MiB" },
  async (request) => {
    const uid = requireAuthenticatedUid(request);
    const token = String(request.data?.token || "").trim();
    const deviceId = String(request.data?.deviceId || "").trim();
    const platform = String(request.data?.platform || "").trim();
    if (!EXPO_PUSH_TOKEN_PATTERN.test(token)) {
      throw new HttpsError("invalid-argument", "無効なプッシュトークンです。");
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(deviceId)) {
      throw new HttpsError("invalid-argument", "無効な端末IDです。");
    }
    if (!new Set(["android", "ios"]).has(platform)) {
      throw new HttpsError("invalid-argument", "未対応の端末です。");
    }

    const userRef = firestore.collection("users").doc(uid);
    const tokenRef = userRef.collection("pushTokens").doc(deviceId);
    const registryRef = getPushTokenRegistryRef(token);
    const preferencesRef = userRef
      .collection("notificationPreferences")
      .doc("default");
    const now = Timestamp.now();
    await firestore.runTransaction(async (transaction) => {
      const currentTokenSnapshot = await transaction.get(tokenRef);
      const currentToken = String(currentTokenSnapshot.data()?.token || "");
      const previousRegistryRef =
        currentToken && currentToken !== token
          ? getPushTokenRegistryRef(currentToken)
          : null;
      const [registrySnapshot, previousRegistrySnapshot] = await Promise.all([
        transaction.get(registryRef),
        previousRegistryRef ? transaction.get(previousRegistryRef) : null,
      ]);
      const registryData = registrySnapshot.data() || {};
      const previousTokenRef =
        registrySnapshot.exists &&
        (registryData.uid !== uid || registryData.deviceId !== deviceId) &&
        registryData.uid &&
        registryData.deviceId
          ? firestore
              .collection("users")
              .doc(registryData.uid)
              .collection("pushTokens")
              .doc(registryData.deviceId)
          : null;
      const previousTokenSnapshot = previousTokenRef
        ? await transaction.get(previousTokenRef)
        : null;
      const previousRegistryData = previousRegistrySnapshot?.data() || {};
      if (
        previousRegistryRef &&
        previousRegistryData.uid === uid &&
        previousRegistryData.deviceId === deviceId
      ) {
        transaction.delete(previousRegistryRef);
      }
      if (
        previousTokenRef &&
        previousTokenSnapshot.exists &&
        previousTokenSnapshot.data()?.token === token
      ) {
        transaction.delete(previousTokenRef);
      }
      transaction.set(tokenRef, { token, platform, updatedAt: now });
      transaction.set(registryRef, { uid, deviceId, updatedAt: now });
    });
    const preferencesSnapshot = await preferencesRef.get();
    if (!preferencesSnapshot.exists) {
      await preferencesRef.set({
        masterEnabled: true,
        categories: DEFAULT_CATEGORY_PREFERENCES,
        teamEnabled: {},
        updatedAt: now,
      });
    }
    return { registered: true };
  },
);

const unregisterPushToken = onCall(
  { region: REGION, timeoutSeconds: 15, memory: "256MiB" },
  async (request) => {
    const uid = requireAuthenticatedUid(request);
    const deviceId = String(request.data?.deviceId || "").trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(deviceId)) {
      throw new HttpsError("invalid-argument", "無効な端末IDです。");
    }
    const tokenRef = firestore
      .collection("users")
      .doc(uid)
      .collection("pushTokens")
      .doc(deviceId);
    await firestore.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef);
      if (!tokenSnapshot.exists) return;
      const token = String(tokenSnapshot.data()?.token || "");
      const registryRef = token ? getPushTokenRegistryRef(token) : null;
      const registrySnapshot = registryRef
        ? await transaction.get(registryRef)
        : null;
      transaction.delete(tokenRef);
      const registryData = registrySnapshot?.data() || {};
      if (registryData.uid === uid && registryData.deviceId === deviceId) {
        transaction.delete(registryRef);
      }
    });
    return { unregistered: true };
  },
);

const updateNotificationPreferences = onCall(
  { region: REGION, timeoutSeconds: 15, memory: "256MiB" },
  async (request) => {
    const uid = requireAuthenticatedUid(request);
    const preferences = normalizePreferences(request.data?.preferences || {});
    await firestore
      .collection("users")
      .doc(uid)
      .collection("notificationPreferences")
      .doc("default")
      .set({ ...preferences, updatedAt: Timestamp.now() }, { merge: true });
    return { preferences };
  },
);

const markNotificationRead = onCall(
  { region: REGION, timeoutSeconds: 15, memory: "256MiB" },
  async (request) => {
    const uid = requireAuthenticatedUid(request);
    return updateNotificationState(uid, request.data?.notificationId, "read");
  },
);

const dismissNotification = onCall(
  { region: REGION, timeoutSeconds: 15, memory: "256MiB" },
  async (request) => {
    const uid = requireAuthenticatedUid(request);
    return updateNotificationState(uid, request.data?.notificationId, "dismiss");
  },
);

async function deleteExpiredNotification(documentReference) {
  const userRef = documentReference.parent.parent;
  if (!userRef) return;
  const summaryRef = userRef.collection("notificationState").doc("summary");
  await firestore.runTransaction(async (transaction) => {
    const notificationSnapshot = await transaction.get(documentReference);
    if (!notificationSnapshot.exists) return;
    const notificationData = notificationSnapshot.data() || {};
    if (!notificationData.readAt) {
      const summarySnapshot = await transaction.get(summaryRef);
      const summaryData = summarySnapshot.data() || {};
      const unreadByTeam = { ...(summaryData.unreadByTeam || {}) };
      if (notificationData.teamId) {
        unreadByTeam[notificationData.teamId] = Math.max(
          0,
          (Number(unreadByTeam[notificationData.teamId]) || 0) - 1,
        );
      }
      transaction.set(
        summaryRef,
        {
          unreadTotal: Math.max(
            0,
            (Number(summaryData.unreadTotal) || 0) - 1,
          ),
          unreadByTeam,
          updatedAt: Timestamp.now(),
        },
        { merge: true },
      );
    }
    transaction.delete(documentReference);
  });
}

const deleteExpiredNotifications = onSchedule(
  {
    region: REGION,
    schedule: "45 3 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const usersSnapshot = await firestore.collection("users").get();
    let remainingLimit = 400;
    for (const userDocument of usersSnapshot.docs) {
      if (remainingLimit <= 0) break;
      const expiredSnapshot = await userDocument.ref
        .collection("notifications")
        .where("expiresAt", "<=", Timestamp.now())
        .limit(remainingLimit)
        .get();
      for (const document of expiredSnapshot.docs) {
        await deleteExpiredNotification(document.ref);
        remainingLimit -= 1;
      }
    }
  },
);

module.exports = {
  notifyNoticeWritten,
  notifyClubEventWritten,
  notifyWorkspacePostWritten,
  notifyDailyReportWritten,
  sendScheduledEventReminders,
  registerPushToken,
  unregisterPushToken,
  updateNotificationPreferences,
  markNotificationRead,
  dismissNotification,
  deleteExpiredNotifications,
};
