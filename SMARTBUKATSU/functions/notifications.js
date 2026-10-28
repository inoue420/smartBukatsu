const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { createHash } = require("node:crypto");
const { audienceForChannel } = require("./workspaceAudience");
const {
  NOTIFICATION_CATEGORIES,
  DEFAULT_CATEGORY_PREFERENCES,
  normalizePreferences,
  shouldSendPush,
  adjustUnreadSummary,
  summarizeUnreadNotifications,
  getVisibleUnreadSummary,
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
const PUSH_REGISTRATION_REFRESH_MS = 24 * 60 * 60 * 1000;
const EXPO_PUSH_BATCH_SIZE = 100;
const EXPO_PUSH_MAX_ATTEMPTS = 3;
const EXPO_PUSH_TIMEOUT_MS = 10000;
const EXPO_PUSH_BATCH_INTERVAL_MS = 200;
const EXPO_PUSH_SEND_BUDGET_MS = 30000;
const STAFF_NOTIFICATION_ROLES = new Set(["owner", "admin", "staff"]);

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

async function deletePushTokenDocument(tokenDocument, expectedToken) {
  const uid = tokenDocument.ref.parent.parent?.id;
  const deviceId = tokenDocument.id;
  if (!uid) return;
  await firestore.runTransaction(async (transaction) => {
    const currentTokenSnapshot = await transaction.get(tokenDocument.ref);
    if (!currentTokenSnapshot.exists) return;
    const token = String(currentTokenSnapshot.data()?.token || "");
    // A response for an old token must not remove a newly registered token.
    if (token !== expectedToken) return;
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

async function getTeamContext(teamId, onMembersRead) {
  const teamRef = firestore.collection("teams").doc(teamId);
  // Wait for both reads so invocation metrics also include a member query that
  // finishes after the team-document read fails.
  const results = await Promise.allSettled([
    teamRef.get(),
    teamRef.collection("members").get().then((snapshot) => {
      onMembersRead?.(snapshot.docs.length);
      return snapshot;
    }),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
  const [teamSnapshot, membersSnapshot] = results.map((result) => result.value);
  return {
    teamName: teamSnapshot.data()?.name || "所属チーム",
    channels: Array.isArray(teamSnapshot.data()?.channels)
      ? teamSnapshot.data().channels
      : [],
    members: membersSnapshot.docs.map((memberDocument) => ({
      uid: memberDocument.id,
      ...(memberDocument.data() || {}),
    })),
  };
}

async function collectExpoPushForUser({
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
    return [];
  }

  let tokensQuery = firestore
    .collection("users")
    .doc(uid)
    .collection("pushTokens");
  if (notification.category === "operatorGuidance") tokensQuery = tokensQuery.limit(10);
  const tokensSnapshot = await tokensQuery.get();
  const documentsByToken = new Map();
  for (const tokenDocument of tokensSnapshot.docs) {
    const token = tokenDocument.data()?.token || "";
    if (!EXPO_PUSH_TOKEN_PATTERN.test(token)) continue;
    // Retain all matching documents for invalid-token cleanup, but send once
    // when an older registration left the same token on multiple devices.
    const documents = documentsByToken.get(token) || [];
    documents.push(tokenDocument);
    documentsByToken.set(token, documents);
  }
  return [...documentsByToken].map(([token, tokenDocuments]) => ({
    tokenDocuments,
    message: {
      to: token,
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
    },
  }));
}

function waitForPushRetry(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function warnPushBatch(reason, count, httpStatus) {
  // Never log API bodies, tokens, user IDs, notification content or errors
  // whose messages might contain a token supplied by the push provider.
  logger.warn("Expo push batch incomplete.", {
    reason,
    count,
    ...(httpStatus ? { httpStatus } : {}),
  });
}

async function sendExpoPushBatch(entries, deadline, report = () => {}) {
  let pending = entries;
  for (let attempt = 1; attempt <= EXPO_PUSH_MAX_ATTEMPTS; attempt += 1) {
    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) {
      warnPushBatch("send_budget_exhausted", pending.length);
      report(pending, "failed", "send_budget_exhausted");
      return;
    }
    let response;
    try {
      response = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pending.map((entry) => entry.message)),
        signal: AbortSignal.timeout(Math.min(EXPO_PUSH_TIMEOUT_MS, remainingTime)),
      });
    } catch {
      // Expo may have accepted the request before the response was lost.
      // Replaying it could duplicate pushes; leave the in-app notification.
      warnPushBatch("unknown_response", pending.length);
      report(pending, "unknown", "response_unknown");
      return;
    }
    if (!response.ok) {
      if (response.status !== 429 && !(response.status >= 500 && response.status < 600)) {
        warnPushBatch("http_rejected", pending.length, response.status);
        report(pending, "failed", "http_rejected");
        return;
      }
    } else {
      let responseBody;
      try {
        responseBody = await response.json();
      } catch {
        warnPushBatch("unknown_response", pending.length);
        report(pending, "unknown", "response_unknown");
        return;
      }
      const requestErrors = responseBody?.errors;
      if (Array.isArray(requestErrors) && requestErrors.length > 0) {
        // Retry only an explicit whole-request rate rejection, without tickets.
        if (responseBody?.data != null || !requestErrors.every((error) => error?.code === "TOO_MANY_REQUESTS")) {
          warnPushBatch("api_rejected", pending.length);
          report(pending, "failed", "api_rejected");
          return;
        }
      } else {
        const tickets = Array.isArray(responseBody?.data)
          ? responseBody.data
          : [responseBody?.data];
        if (tickets.length !== pending.length) {
          // An incomplete or extra result cannot safely be mapped to tokens.
          warnPushBatch("invalid_ticket_count", pending.length);
          report(pending, "unknown", "invalid_ticket_count");
          return;
        }
        const retryEntries = [];
        const invalidTokenDeletes = [];
        let rejectedCount = 0;
        let unknownCount = 0;
        tickets.forEach((ticket, index) => {
          const entry = pending[index];
          if (ticket?.status === "ok" && typeof ticket.id === "string" && ticket.id) {
            report([entry], "accepted", ""); return;
          }
          if (ticket?.status !== "error") {
            unknownCount += 1;
            report([entry], "unknown", "unknown_ticket");
          } else if (ticket?.details?.error === "DeviceNotRegistered") {
            report([entry], "unavailable", "device_not_registered");
            for (const document of entry.tokenDocuments) {
              invalidTokenDeletes.push(deletePushTokenDocument(document, entry.message.to));
            }
          } else if (ticket?.details?.error === "MessageRateExceeded") {
            retryEntries.push(entry);
          } else {
            rejectedCount += 1;
            report([entry], "failed", "ticket_rejected");
          }
        });
        const cleanupResults = await Promise.allSettled(invalidTokenDeletes);
        const cleanupFailures = cleanupResults.filter((result) => result.status === "rejected").length;
        if (cleanupFailures) warnPushBatch("token_cleanup_failed", cleanupFailures);
        if (rejectedCount) warnPushBatch("ticket_rejected", rejectedCount);
        if (unknownCount) warnPushBatch("unknown_ticket", unknownCount);
        pending = retryEntries;
      }
    }
    if (pending.length === 0) return;
    if (attempt === EXPO_PUSH_MAX_ATTEMPTS) {
      warnPushBatch("retry_exhausted", pending.length);
      report(pending, "failed", "retry_exhausted");
      return;
    }
    const retryDelay = 1000 * 2 ** (attempt - 1);
    if (Date.now() + retryDelay >= deadline) {
      warnPushBatch("send_budget_exhausted", pending.length);
      report(pending, "failed", "send_budget_exhausted");
      return;
    }
    await waitForPushRetry(retryDelay);
  }
}

async function sendExpoPushBatches(entries) {
  const results = [];
  const report = (items, status, reason) => items.forEach(() => results.push({ status, reason }));
  // Sequential batches also bound concurrent HTTP requests within an event.
  const deadline = Date.now() + EXPO_PUSH_SEND_BUDGET_MS;
  for (let start = 0; start < entries.length; start += EXPO_PUSH_BATCH_SIZE) {
    if (start > 0) await waitForPushRetry(EXPO_PUSH_BATCH_INTERVAL_MS);
    if (Date.now() >= deadline) {
      warnPushBatch("send_budget_exhausted", entries.length - start);
      report(entries.slice(start), "failed", "send_budget_exhausted");
      return results;
    }
    await sendExpoPushBatch(entries.slice(start, start + EXPO_PUSH_BATCH_SIZE), deadline, report);
  }
  return results;
}

function dailyReportCommentEventAllowed(teamData, eventTime) {
  if (teamData?.dailyReportCommentsEnabled !== true) return false;
  const changedAt = teamData.dailyReportCommentsUpdatedAt;
  const millis = Date.parse(eventTime);
  if (!changedAt || !Number.isFinite(millis)) return true;
  const seconds = Math.floor(millis / 1000);
  const fraction = String(eventTime).match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1] || "";
  const nanos = Number(fraction.padEnd(9, "0").slice(0, 9));
  return seconds > changedAt.seconds || (seconds === changedAt.seconds && nanos >= changedAt.nanoseconds);
}

async function readNotificationSummary(transaction, userRef, summarySnapshot, maxUnread = 0) {
  const summary = summarySnapshot.data() || {};
  if (summary.unreadBucketsVersion === 1) return summary;
  // Every notification mutation also writes the summary, so a concurrent change
  // makes this transaction retry rather than publishing a stale repair.
  let query = userRef.collection("notifications").where("readAt", "==", null);
  if (maxUnread) query = query.limit(maxUnread + 1);
  const unread = await transaction.get(query);
  if (maxUnread && unread.docs.length > maxUnread) {
    throw new HttpsError("resource-exhausted", "通知集計の準備が必要です。", { reason: "guidance-summary-not-ready" });
  }
  return summarizeUnreadNotifications(unread.docs.map((document) => document.data()));
}

const ensureNotificationSummary = onCall(
  { region: REGION, timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    const uid = requireAuthenticatedUid(request);
    const userRef = firestore.collection("users").doc(uid);
    const summaryRef = userRef.collection("notificationState").doc("summary");
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(summaryRef);
      if (snapshot.data()?.unreadBucketsVersion === 1) return;
      const summary = await readNotificationSummary(transaction, userRef, snapshot);
      // Replace aggregate maps so obsolete legacy team counters cannot survive.
      transaction.set(summaryRef, { ...summary, updatedAt: Timestamp.now() });
    });
    return { ready: true };
  },
);

async function createNotificationForUser(uid, payload, { validate, report = false } = {}) {
  if (payload.category === "scheduleReminder") return [];
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
    if (validate) await validate(transaction);
    if (payload.category === NOTIFICATION_CATEGORIES.DIARY_REPLY) {
      const teamSnapshot = await transaction.get(firestore.collection("teams").doc(payload.teamId));
      if (!dailyReportCommentEventAllowed(teamSnapshot.data(), payload.sourceEventTime)) {
        return { created: false, unreadTotal: 0 };
      }
    }
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
    const summaryData = await readNotificationSummary(transaction, userRef, summarySnapshot, report ? 250 : 0);
    const preferencesSnapshot = await transaction.get(preferencesRef);
    const preferences = preferencesSnapshot.data() || {};
    const nextSummary = adjustUnreadSummary(summaryData, notification, 1);

    transaction.create(notificationRef, notification);
    transaction.set(
      summaryRef,
      { ...nextSummary, updatedAt: now },
    );
    return {
      created: true,
      unreadTotal: getVisibleUnreadSummary(nextSummary, preferences).unreadTotal,
      preferences,
    };
  });

  if (!transactionResult.created) return report ? { created: false, entries: [] } : [];
  let entries;
  try {
    entries = await collectExpoPushForUser({ uid, notification,
      unreadTotal: transactionResult.unreadTotal, preferences: transactionResult.preferences });
  } catch (error) {
    if (report) return { created: true, entries: [], preferences: transactionResult.preferences, preparationFailed: true };
    throw error;
  }
  return report ? { created: true, entries, preferences: transactionResult.preferences } : entries;
}

// Internal transport adapter; excluded from the exported Cloud Functions.
async function sendOperatorGuidanceNotification(uid, payload, validate) {
  let prepared;
  try { prepared = await createNotificationForUser(uid, payload, { validate, report: true }); }
  catch (error) {
    if (error.details?.reason === "guidance-summary-not-ready") return { status: "unavailable", reason: "summary_not_ready", notificationSaved: false };
    throw error;
  }
  if (!prepared.created) return { status: "unavailable", reason: "notification_exists_or_membership_changed", notificationSaved: false };
  if (prepared.preparationFailed) return { status: "failed", reason: "push_failed", notificationSaved: true };
  if (!shouldSendPush(prepared.preferences, payload.category, payload.teamId)) {
    return { status: "unavailable", reason: "notifications_off", notificationSaved: true };
  }
  if (!prepared.entries.length) return { status: "unavailable", reason: "no_device", notificationSaved: true };
  const results = await sendExpoPushBatches(prepared.entries);
  const counts = { accepted: 0, unavailable: 0, failed: 0, unknown: 0 };
  results.forEach((result) => { counts[result.status] += 1; });
  return { status: counts.accepted ? "accepted" : counts.failed || counts.unknown ? "failed" : "unavailable",
    reason: counts.unknown ? "response_unknown" : counts.failed ? "push_failed" : counts.unavailable ? "device_not_registered" : "",
    notificationSaved: true, deviceResults: counts };
}

async function fanOutToUids(uids, payload, retryFailures = false) {
  const results = await Promise.allSettled(
    uniqueUids(uids).map((uid) => createNotificationForUser(uid, payload)),
  );
  const failures = results.filter((result) => result.status === "rejected").length;
  if (failures) logger.error("Notification fan-out failed.", { count: failures });
  await sendExpoPushBatches(results.flatMap((result) => result.status === "fulfilled" ? result.value : []));
  if (failures && retryFailures) throw new Error("Daily report notification recipients failed");
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

const notifyTeamMemberCreated = onDocumentWritten(
  {
    document: "teams/{teamId}/members/{memberUid}",
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    if (event.data?.before.exists || !event.data?.after.exists) return;

    const { teamId, memberUid } = event.params;
    const member = event.data.after.data() || {};
    const { teamName, members } = await getTeamContext(teamId);
    const recipientUids = members
      .filter((teamMember) => STAFF_NOTIFICATION_ROLES.has(teamMember.role))
      .map((teamMember) => teamMember.uid);

    await fanOutToUids(recipientUids, {
      id: `member_join_${teamId}_${memberUid}`,
      category: NOTIFICATION_CATEGORIES.MEMBER_JOIN,
      teamId,
      teamName,
      actorUid: memberUid,
      title: "メンバーが追加されました",
      body: `${truncate(member.name || "新しいメンバー", 100)}さんがチームに参加しました。`,
      target: notificationTarget("Roster"),
      source: { collection: "members", documentId: memberUid },
    });
  },
);

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
    // One aggregate record per invocation, without user or document identifiers.
    // This counts collection results, not membership checks during fan-out.
    const metrics = {
      invocations: 1,
      memberFetchSkipped: 1,
      memberDocumentsFetched: 0,
    };
    try {
      const beforeData = event.data?.before.exists ? event.data.before.data() : {};
      const afterData = event.data?.after.exists ? event.data.after.data() : null;
      if (!afterData || afterData.status === "deleted" || afterData.moderationStatus === "hidden") return;

      const isNewPost = !event.data?.before.exists;
      const visibleUidSet = new Set(uniqueUids(afterData.visibleToUids));
      const beforeMentions = new Set(uniqueUids(beforeData.mentionedUids));
      const addedPostMentions = uniqueUids(afterData.mentionedUids).filter(
        (uid) =>
          !beforeMentions.has(uid) &&
          uid !== actorUid(afterData) &&
          (visibleUidSet.size === 0 || visibleUidSet.has(uid)),
      );
      const addedReplies = getAddedItems(beforeData.replies, afterData.replies);
      const hasNotifiableReply = addedReplies.some((reply) => {
        const senderUid = actorUid(reply);
        return (
          (actorUid(afterData) && actorUid(afterData) !== senderUid) ||
          uniqueUids(reply.mentionedUids).some(
            (uid) => uid !== senderUid &&
              (visibleUidSet.size === 0 || visibleUidSet.has(uid)),
          )
        );
      });
      // Inspect notification-producing differences, not read/reaction fields:
      // a single write can contain both kinds of changes.
      if (!isNewPost && addedPostMentions.length === 0 && !hasNotifiableReply) {
        return;
      }

      const { teamId, postId } = event.params;
      metrics.memberFetchSkipped = 0;
      const { teamName, channels, members } = await getTeamContext(teamId, (count) => {
        metrics.memberDocumentsFetched = count;
      });
      const channel = channels.find(
        (item) =>
          item?.id === afterData.channelId ||
          (item?.name && item.name === afterData.channel),
      ) || (channels.length === 0 && (afterData.channelId === "ch_1" || afterData.channel === "全体連絡")
        ? { id: "ch_1", name: "全体連絡" } : null);
      const channelUidSet = new Set(channel
        ? audienceForChannel(channel, members, actorUid(afterData)).visibleToUids
        : afterData.shareScope === "grades" ? [] : members.map((member) => member.uid));
      // Intersect the saved audience with current membership/grade settings.
      // A missing legacy array falls back to the channel; an explicit empty one does not.
      const isVisibleRecipient = (uid) => channelUidSet.has(uid) &&
        (!Array.isArray(afterData.visibleToUids) || visibleUidSet.has(uid));
      const postMentionUids = addedPostMentions.filter(isVisibleRecipient);
      if (isNewPost && channel) {
        const selectedStaffUids = new Set(uniqueUids(channel.notificationRecipientUids));
        const recipientUids = members.filter((member) =>
          !STAFF_NOTIFICATION_ROLES.has(member.role) || selectedStaffUids.has(member.uid))
          .map((member) => member.uid).filter((uid) =>
            uid !== actorUid(afterData) && isVisibleRecipient(uid) && !postMentionUids.includes(uid));
        if (recipientUids.length > 0) {
          await fanOutToUids(recipientUids, {
            id: `workspace_post_${teamId}_${postId}`,
            category: NOTIFICATION_CATEGORIES.WORKSPACE_POST,
            teamId,
            teamName,
            actorUid: actorUid(afterData),
            title: `${channel.name || "チャンネル"}に新しい投稿があります`,
            body: afterData.content || "投稿を確認してください。",
            target: notificationTarget("WorkspaceHome", { postId }),
            source: { collection: "workspacePosts", documentId: postId },
          });
        }
      }
      if (postMentionUids.length > 0) {
        await fanOutToUids(postMentionUids, {
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

      for (const reply of addedReplies) {
        const senderUid = actorUid(reply);
        const mentionedUids = uniqueUids(reply.mentionedUids).filter(
          (uid) =>
            uid !== senderUid &&
            isVisibleRecipient(uid),
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
          isVisibleRecipient(postAuthorUid) &&
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
    } finally {
      logger.info("workspace_post_notification_metrics", metrics);
    }
  },
);

const handleDailyReportWritten = async (event) => {
    const beforeData = event.data?.before.exists ? event.data.before.data() : {};
    const afterData = event.data?.after.exists ? event.data.after.data() : null;
    if (!afterData || afterData.status === "deleted") return;
    const addedComments = getAddedItems(beforeData.comments, afterData.comments);
    if (addedComments.length === 0) return;

    const { teamId, reportId } = event.params;
    const teamSnapshot = await firestore.collection("teams").doc(teamId).get();
    if (!dailyReportCommentEventAllowed(teamSnapshot.data(), event.time)) return;
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
        sourceEventTime: event.time,
        teamId,
        teamName,
        actorUid: senderUid,
        title: `${actorName(comment)}さんから日誌への返信`,
        body: comment.text || "日誌の返信を確認してください。",
        target: notificationTarget("Diary", { reportId }),
        source: { collection: "dailyReports", documentId: reportId },
      }, true);
    }
};

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
    const wasUnread = !notificationData.readAt && !notificationData.dismissedAt;
    const updateData = { updatedAt: now };
    if (action === "read") updateData.readAt = notificationData.readAt || now;
    if (action === "dismiss") {
      updateData.readAt = notificationData.readAt || now;
      updateData.dismissedAt = now;
    }

    if (wasUnread) {
      const summarySnapshot = await transaction.get(summaryRef);
      const summaryData = await readNotificationSummary(transaction, userRef, summarySnapshot);
      transaction.set(
        summaryRef,
        {
          ...adjustUnreadSummary(summaryData, notificationData, -1),
          updatedAt: now,
        },
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
    if (request.data?.expectedUid && request.data.expectedUid !== uid) {
      throw new HttpsError("failed-precondition", "ログイン状態が変わりました。");
    }
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
      const preferencesSnapshot = await transaction.get(preferencesRef);
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
      const currentData = currentTokenSnapshot.data() || {};
      const needsRefresh = (value) => {
        const updatedAt = value?.updatedAt?.toMillis?.();
        const age = now.toMillis() - updatedAt;
        return !Number.isFinite(updatedAt) || age < 0 || age >= PUSH_REGISTRATION_REFRESH_MS;
      };
      if (currentData.token !== token || currentData.platform !== platform ||
          needsRefresh(currentData)) {
        transaction.set(tokenRef, { token, platform, updatedAt: now });
      }
      if (registryData.uid !== uid || registryData.deviceId !== deviceId ||
          needsRefresh(registryData)) {
        transaction.set(registryRef, { uid, deviceId, updatedAt: now });
      }
      if (!preferencesSnapshot.exists) {
        transaction.create(preferencesRef, {
          masterEnabled: request.data?.initializePreferencesEnabled !== false,
          categories: DEFAULT_CATEGORY_PREFERENCES,
          teamEnabled: {},
          updatedAt: now,
        });
      }
    });
    return { registered: true };
  },
);

const unregisterPushToken = onCall(
  { region: REGION, timeoutSeconds: 15, memory: "256MiB" },
  async (request) => {
    const uid = requireAuthenticatedUid(request);
    if (request.data?.expectedUid && request.data.expectedUid !== uid) {
      throw new HttpsError("failed-precondition", "ログイン状態が変わりました。");
    }
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
    if (!notificationData.readAt && !notificationData.dismissedAt) {
      const summarySnapshot = await transaction.get(summaryRef);
      const summaryData = await readNotificationSummary(transaction, userRef, summarySnapshot);
      transaction.set(
        summaryRef,
        {
          ...adjustUnreadSummary(summaryData, notificationData, -1),
          updatedAt: Timestamp.now(),
        },
      );
    }
    transaction.delete(documentReference);
  });
}

async function deleteExpiredNotifications() {
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
}

module.exports = {
  sendOperatorGuidanceNotification,
  ensureNotificationSummary,
  notifyTeamMemberCreated,
  notifyNoticeWritten,
  notifyClubEventWritten,
  notifyWorkspacePostWritten,
  handleDailyReportWritten,
  registerPushToken,
  unregisterPushToken,
  updateNotificationPreferences,
  markNotificationRead,
  dismissNotification,
  deleteExpiredNotifications,
};
