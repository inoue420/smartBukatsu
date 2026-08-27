const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  onDocumentUpdated,
  onDocumentWritten,
} = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const {
  getFirestore,
  FieldValue,
  Timestamp,
} = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");

initializeApp();

const firestore = getFirestore();
const DEFAULT_MAX_TEAMS_PER_USER = 5;
const SHARP_RISE_MAX_TEAMS_PER_USER = 100;
const SHARP_RISE_INVITE_CODE = "AWUH95";
const MEMBER_MANAGER_ROLES = new Set(["owner", "admin", "staff"]);
const ACCOUNT_DELETION_REAUTH_MAX_AGE_SECONDS = 5 * 60;
const DELETED_USER_UID = "deleted_user";
const DELETED_USER_LABEL = "削除済みユーザー";
const ACCOUNT_DATA_COLLECTIONS = [
  "members",
  "projects",
  "tagGroups",
  "highlightProjects",
  "clubEvents",
  "notices",
  "workspacePosts",
  "dailyReports",
];
const UID_IDENTITY_FIELDS = new Set([
  "uid",
  "userUid",
  "authorUid",
  "createdBy",
  "updatedBy",
  "uploadedBy",
  "ownerId",
  "editedByUid",
  "deletedByUid",
  "moderatedByUid",
  "moderationRestoredByUid",
]);
const DISPLAY_NAME_FIELDS = new Set(["user", "author", "displayName"]);
const LEGACY_DISPLAY_IDENTITY_FIELDS = new Set([
  ...DISPLAY_NAME_FIELDS,
  "createdBy",
  "updatedBy",
  "uploadedBy",
]);
const LEGACY_DISPLAY_NAME_SUFFIXES = [
  "(監督)",
  "(管理者)",
  "(コーチ)",
  "(スタッフ)",
  "(キャプテン)",
  "(保護者)",
];
const PROFILE_NAME_IDENTITY_FIELDS = new Set(["uid", "userUid"]);
const NAME_ARRAY_FIELDS = new Set(["readBy", "allowedMembers"]);
const NAME_SCALAR_FIELDS = new Set(["assignedStaff"]);
const SUPPORT_CASE_COLLECTION = "supportCases";
const SUPPORT_CASE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const ACTIVE_SUPPORT_CASE_STATUSES = new Set(["received", "reviewing"]);
const SAFETY_REPORT_REASONS = new Set([
  "harassment_bullying",
  "threat_violence",
  "hate_discrimination",
  "sexual_inappropriate",
  "impersonation_privacy",
  "spam_fraud",
  "other",
]);
const SUPPORT_REQUEST_CATEGORIES = new Set([
  "bug_report",
  "feature_request",
  "safety_consultation",
]);
const SAFETY_REPORT_SUBJECTS = new Set(["content", "user"]);
const SAFETY_REPORT_TARGET_TYPES = new Set([
  "workspace_post",
  "workspace_reply",
  "daily_report_comment",
]);
const MODERATED_CONTENT_TYPES = new Set([
  "workspace_post",
  "workspace_reply",
  "daily_report_comment",
]);
const PROHIBITED_CONTENT_PATTERNS = [
  {
    label: "生命・身体への脅迫表現",
    pattern:
      /(?:死ね|消えろ|ぶっ殺す|(?:殺|ころ)してやる|(?:お前|てめえ|貴様|あいつ|こいつ|そいつ|あなた|君|きみ)(?:を|は|が|に|、|\s)*(?:殺す|ころす|しね)|(?:殺す|ころす)(?:ぞ|からな|からね)|(?:^|[\s、。！？!?])しね(?:$|[\s、。！？!?]))/u,
  },
  {
    label: "性的な強要・搾取を示す表現",
    pattern: /(?:レイプ|強姦|裸(?:の)?(?:写真|画像)(?:を)?送れ)/u,
  },
];
const ATTACK_WARNING_PATTERNS = [
  /(?:バカ|馬鹿|アホ|クズ|きもい|気持ち悪い|役立たず)/u,
  /(?:殴る|蹴る|痛い目にあわせる|殺す|ころす|殺して|ころして)/u,
];
const PERSONAL_INFORMATION_PATTERNS = [
  {
    label: "メールアドレス",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  },
  {
    label: "電話番号",
    pattern: /(?:\+?81[-\s]?)?0\d{1,4}[-\sー‐–—]?\d{1,4}[-\sー‐–—]?\d{3,4}/u,
  },
  {
    label: "郵便番号",
    pattern: /〒?\s*\d{3}[-ー‐–—]\d{4}/u,
  },
  {
    label: "外部連絡先ID",
    pattern: /(?:LINE|ライン|SNS)\s*(?:ID|ＩＤ|id)?\s*[:：]\s*\S+/iu,
  },
];

const googleMapsServerApiKey = defineSecret("GOOGLE_MAPS_SERVER_API_KEY");

const JAPAN_LOCATION_BIAS = {
  rectangle: {
    low: { latitude: 24.0, longitude: 122.0 },
    high: { latitude: 46.0, longitude: 154.0 },
  },
};

const normalizeQuery = (value) => String(value || "").trim().replace(/\s+/g, " ");

const normalizeCaseText = (value, maxLength) =>
  String(value || "").trim().slice(0, maxLength);

const inspectUserContent = (value) => {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  const blockedReasons = PROHIBITED_CONTENT_PATTERNS.filter(({ pattern }) =>
    pattern.test(normalized),
  ).map(({ label }) => label);
  const warnings = [
    ...(ATTACK_WARNING_PATTERNS.some((pattern) => pattern.test(normalized))
      ? ["攻撃的と受け取られる可能性のある表現"]
      : []),
    ...PERSONAL_INFORMATION_PATTERNS.filter(({ pattern }) =>
      pattern.test(normalized),
    ).map(({ label }) => `${label}などの個人情報である可能性`),
  ];
  return { normalized, blockedReasons, warnings };
};

const getEvidenceValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Timestamp) {
    return { timestampMillis: value.toMillis() };
  }
  if (Array.isArray(value)) return value.map(getEvidenceValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        getEvidenceValue(nestedValue),
      ]),
    );
  }
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return String(value);
};

const getReplyEvidence = (reply = {}) => ({
  id: normalizeCaseText(reply.id, 200),
  user: normalizeCaseText(reply.user, 200),
  authorUid: normalizeCaseText(reply.authorUid, 128),
  content: normalizeCaseText(reply.content, 10000),
  createdAt: getEvidenceValue(reply.createdAt),
  updatedAt: getEvidenceValue(reply.updatedAt),
  status: normalizeCaseText(reply.status, 50),
  deletedAt: getEvidenceValue(reply.deletedAt),
  deletedBy: normalizeCaseText(reply.deletedBy, 200),
  deletedByUid: normalizeCaseText(reply.deletedByUid, 128),
  editedAt: getEvidenceValue(reply.editedAt),
  editedByUid: normalizeCaseText(reply.editedByUid, 128),
  moderationStatus: normalizeCaseText(reply.moderationStatus, 50),
  moderationReason: normalizeCaseText(reply.moderationReason, 500),
  moderatedByUid: normalizeCaseText(reply.moderatedByUid, 128),
  moderatedAt: getEvidenceValue(reply.moderatedAt),
  moderationRestoredByUid: normalizeCaseText(
    reply.moderationRestoredByUid,
    128,
  ),
  moderationRestoredAt: getEvidenceValue(reply.moderationRestoredAt),
  attachments: getEvidenceValue(reply.attachments || []),
});

const getWorkspacePostEvidence = (
  postData,
  { postId = "", targetType = "workspace_post", replyId = "" } = {},
) => {
  if (!postData) return null;
  const baseEvidence = {
    postId,
    channelId: normalizeCaseText(postData.channelId, 200),
    channel: normalizeCaseText(postData.channel, 200),
    user: normalizeCaseText(postData.user, 200),
    authorUid: normalizeCaseText(postData.authorUid, 128),
    content: normalizeCaseText(postData.content, 10000),
    createdAt: getEvidenceValue(postData.createdAt),
    updatedAt: getEvidenceValue(postData.updatedAt),
    status: normalizeCaseText(postData.status, 50),
    deletedAt: getEvidenceValue(postData.deletedAt),
    deletedBy: normalizeCaseText(postData.deletedBy, 200),
    deletedByUid: normalizeCaseText(postData.deletedByUid, 128),
    editedAt: getEvidenceValue(postData.editedAt),
    editedByUid: normalizeCaseText(postData.editedByUid, 128),
    moderationStatus: normalizeCaseText(postData.moderationStatus, 50),
    moderationReason: normalizeCaseText(postData.moderationReason, 500),
    moderatedByUid: normalizeCaseText(postData.moderatedByUid, 128),
    moderatedAt: getEvidenceValue(postData.moderatedAt),
    moderationRestoredByUid: normalizeCaseText(
      postData.moderationRestoredByUid,
      128,
    ),
    moderationRestoredAt: getEvidenceValue(
      postData.moderationRestoredAt,
    ),
    attachments: getEvidenceValue(postData.attachments || []),
  };

  if (targetType === "workspace_reply") {
    const targetReply = (postData.replies || []).find(
      (reply) => String(reply?.id || "") === replyId,
    );
    return {
      ...baseEvidence,
      targetReply: targetReply ? getReplyEvidence(targetReply) : null,
    };
  }

  return {
    ...baseEvidence,
    replyCount: (postData.replies || []).length,
    repliesTruncated: (postData.replies || []).length > 100,
    replies: (postData.replies || []).slice(-100).map(getReplyEvidence),
  };
};

const getWorkspaceDocumentFingerprint = (postData, postId) => {
  const evidence = getWorkspacePostEvidence(postData, { postId });
  if (!evidence) return JSON.stringify(null);
  const { updatedAt, ...contentEvidence } = evidence;
  return JSON.stringify(contentEvidence);
};

const getDailyReportCommentEvidence = (comment = {}) => ({
  id: normalizeCaseText(comment.id, 200),
  user: normalizeCaseText(comment.user, 200),
  uid: normalizeCaseText(comment.uid, 128),
  text: normalizeCaseText(comment.text, 10000),
  time: normalizeCaseText(comment.time, 100),
  status: normalizeCaseText(comment.status, 50),
  createdAt: getEvidenceValue(comment.createdAt),
  updatedAt: getEvidenceValue(comment.updatedAt),
  deletedAt: getEvidenceValue(comment.deletedAt),
});

const getDailyReportEvidence = (
  reportData,
  { reportId = "", commentId = "" } = {},
) => {
  if (!reportData) return null;
  const comments = Array.isArray(reportData.comments) ? reportData.comments : [];
  const targetComment = comments.find(
    (comment) => String(comment?.id || "") === commentId,
  );
  return {
    reportId,
    date: normalizeCaseText(reportData.date, 100),
    author: normalizeCaseText(reportData.author, 200),
    authorUid: normalizeCaseText(reportData.authorUid, 128),
    status: normalizeCaseText(reportData.status, 50),
    createdAt: getEvidenceValue(reportData.createdAt),
    updatedAt: getEvidenceValue(reportData.updatedAt),
    targetComment: targetComment
      ? getDailyReportCommentEvidence(targetComment)
      : null,
    commentCount: comments.length,
    commentsTruncated: comments.length > 100,
    comments: comments.slice(-100).map(getDailyReportCommentEvidence),
  };
};

const getDailyReportDocumentFingerprint = (reportData, reportId) => {
  const evidence = getDailyReportEvidence(reportData, { reportId });
  if (!evidence) return JSON.stringify(null);
  const { updatedAt, ...contentEvidence } = evidence;
  return JSON.stringify(contentEvidence);
};

const getAuthenticatedTeamMember = async (teamId, uid) => {
  const normalizedTeamId = normalizeCaseText(teamId, 200);
  if (!normalizedTeamId) {
    throw new HttpsError("invalid-argument", "チームIDが不足しています。");
  }
  const teamRef = firestore.collection("teams").doc(normalizedTeamId);
  const [teamSnap, memberSnap] = await Promise.all([
    teamRef.get(),
    teamRef.collection("members").doc(uid).get(),
  ]);
  if (!teamSnap.exists || !memberSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "このチームの通報・相談を送信する権限がありません。",
    );
  }
  return {
    teamId: normalizedTeamId,
    teamRef,
    memberData: memberSnap.data() || {},
  };
};

const createSupportCaseWithEvidence = async ({ caseData, evidence }) => {
  const caseRef = firestore.collection(SUPPORT_CASE_COLLECTION).doc();
  const batch = firestore.batch();
  batch.set(caseRef, caseData);
  if (evidence) {
    batch.set(caseRef.collection("evidence").doc(), evidence);
  }
  await batch.commit();
  return caseRef.id;
};

const deleteNonSafetySupportCasesForAccount = async (uid) => {
  const casesSnapshot = await firestore
    .collection(SUPPORT_CASE_COLLECTION)
    .where("reporterUid", "==", uid)
    .get();
  let deletedCaseCount = 0;

  for (const caseSnapshot of casesSnapshot.docs) {
    const caseData = caseSnapshot.data() || {};
    const isSafetyCase =
      caseData.caseType === "safety_report" ||
      caseData.category === "safety_consultation";
    if (isSafetyCase) continue;
    await firestore.recursiveDelete(caseSnapshot.ref);
    deletedCaseCount += 1;
  }

  return deletedCaseCount;
};

const removeAccountFromBlockLists = async (uid) => {
  const usersSnapshot = await firestore
    .collection("users")
    .where("blockedUserUids", "array-contains", uid)
    .get();
  if (usersSnapshot.empty) return 0;

  const writer = firestore.bulkWriter();
  usersSnapshot.docs.forEach((userSnapshot) => {
    writer.update(userSnapshot.ref, {
      blockedUserUids: FieldValue.arrayRemove(uid),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await writer.close();
  return usersSnapshot.size;
};

const isValidCoordinate = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

const normalizeTeamIds = (data = {}) => {
  const teamIds = Array.isArray(data.teamIds)
    ? data.teamIds.filter((teamId) => typeof teamId === "string" && teamId)
    : [];
  const activeTeamId =
    typeof data.activeTeamId === "string" && data.activeTeamId
      ? data.activeTeamId
      : null;

  return [...new Set([...teamIds, ...(activeTeamId ? [activeTeamId] : [])])];
};

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  Object.getPrototypeOf(value) === Object.prototype;

const anonymizeAccountValue = (
  value,
  { uid, uniqueDisplayNames, fieldName = "" },
) => {
  if (Array.isArray(value)) {
    const nextValue = [];
    let changed = false;

    value.forEach((item) => {
      if (item === uid) {
        changed = true;
        return;
      }
      if (
        typeof item === "string" &&
        NAME_ARRAY_FIELDS.has(fieldName) &&
        uniqueDisplayNames.has(item)
      ) {
        changed = true;
        return;
      }

      const sanitized = anonymizeAccountValue(item, {
        uid,
        uniqueDisplayNames,
        fieldName,
      });
      nextValue.push(sanitized.value);
      changed = changed || sanitized.changed;
    });

    return { value: nextValue, changed };
  }

  if (!isPlainObject(value)) {
    if (value === uid) {
      return { value: DELETED_USER_UID, changed: true };
    }
    if (
      typeof value === "string" &&
      LEGACY_DISPLAY_IDENTITY_FIELDS.has(fieldName) &&
      uniqueDisplayNames.has(value)
    ) {
      return { value: DELETED_USER_UID, changed: true };
    }
    if (
      typeof value === "string" &&
      NAME_SCALAR_FIELDS.has(fieldName) &&
      uniqueDisplayNames.has(value)
    ) {
      return { value: null, changed: true };
    }
    return { value, changed: false };
  }

  const matchingUidIdentityFields = [...UID_IDENTITY_FIELDS].filter(
    (key) => value[key] === uid,
  );
  const matchingDisplayIdentityFields = [
    ...LEGACY_DISPLAY_IDENTITY_FIELDS,
  ].filter(
    (key) =>
      typeof value[key] === "string" && uniqueDisplayNames.has(value[key]),
  );
  const identityMatches =
    matchingUidIdentityFields.length > 0 ||
    matchingDisplayIdentityFields.length > 0;
  const nextValue = {};
  let changed = false;
  Object.entries(value).forEach(([key, nestedValue]) => {
    const isProfileName =
      key === "name" &&
      matchingUidIdentityFields.some((identityField) =>
        PROFILE_NAME_IDENTITY_FIELDS.has(identityField),
      );
    if (
      identityMatches &&
      (DISPLAY_NAME_FIELDS.has(key) || isProfileName) &&
      typeof nestedValue === "string"
    ) {
      nextValue[key] = DELETED_USER_LABEL;
      changed = changed || nestedValue !== DELETED_USER_LABEL;
      return;
    }

    const sanitized = anonymizeAccountValue(nestedValue, {
      uid,
      uniqueDisplayNames,
      fieldName: key,
    });
    nextValue[key] = sanitized.value;
    changed = changed || sanitized.changed;
  });

  return { value: nextValue, changed };
};

const getAccountDocumentUpdates = (data, context) => {
  const matchingUidIdentityFields = [...UID_IDENTITY_FIELDS].filter(
    (key) => data?.[key] === context.uid,
  );
  const matchingDisplayIdentityFields = [
    ...LEGACY_DISPLAY_IDENTITY_FIELDS,
  ].filter(
    (key) =>
      typeof data?.[key] === "string" &&
      context.uniqueDisplayNames.has(data[key]),
  );
  const identityMatches =
    matchingUidIdentityFields.length > 0 ||
    matchingDisplayIdentityFields.length > 0;
  const updates = {};
  Object.entries(data || {}).forEach(([key, value]) => {
    const isProfileName =
      key === "name" &&
      matchingUidIdentityFields.some((identityField) =>
        PROFILE_NAME_IDENTITY_FIELDS.has(identityField),
      );
    if (
      identityMatches &&
      (DISPLAY_NAME_FIELDS.has(key) || isProfileName) &&
      typeof value === "string"
    ) {
      if (value !== DELETED_USER_LABEL) updates[key] = DELETED_USER_LABEL;
      return;
    }

    const sanitized = anonymizeAccountValue(value, {
      ...context,
      fieldName: key,
    });
    if (sanitized.changed) updates[key] = sanitized.value;
  });
  return updates;
};

const getAccountDeletionContext = async (uid) => {
  const userRef = firestore.collection("users").doc(uid);
  const [userSnap, ownedTeamsSnapshot] = await Promise.all([
    userRef.get(),
    firestore.collection("teams").where("createdBy", "==", uid).get(),
  ]);
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const teamIds = [
    ...new Set([
      ...normalizeTeamIds(userData),
      ...ownedTeamsSnapshot.docs.map((teamSnapshot) => teamSnapshot.id),
    ]),
  ];
  const teamEntries = await Promise.all(
    teamIds.map(async (teamId) => {
      const teamRef = firestore.collection("teams").doc(teamId);
      const memberRef = teamRef.collection("members").doc(uid);
      const [teamSnap, memberSnap] = await Promise.all([
        teamRef.get(),
        memberRef.get(),
      ]);
      const teamData = teamSnap.exists ? teamSnap.data() || {} : {};
      const memberData = memberSnap.exists ? memberSnap.data() || {} : {};
      return {
        teamId,
        teamRef,
        teamSnap,
        memberRef,
        memberSnap,
        teamData,
        memberData,
      };
    }),
  );
  const blockingTeams = teamEntries
    .filter(({ teamSnap, teamData }) => teamSnap.exists && teamData.createdBy === uid)
    .map(({ teamId, teamData }) => ({
      teamId,
      teamName: String(teamData.teamName || teamData.name || "名称未設定"),
    }));

  return { userRef, userSnap, userData, teamIds, teamEntries, blockingTeams };
};

const assertAccountDeletionEligible = (context) => {
  if (context.blockingTeams.length === 0) return;
  throw new HttpsError(
    "failed-precondition",
    "作成者として残っているチームがあります。チーム削除または所有権移管を先に完了してください。",
    { blockingTeams: context.blockingTeams },
  );
};

const assertRecentAuthentication = (request) => {
  const authTime = Number(request.auth?.token?.auth_time);
  const currentTime = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(authTime) ||
    currentTime - authTime > ACCOUNT_DELETION_REAUTH_MAX_AGE_SECONDS
  ) {
    throw new HttpsError(
      "failed-precondition",
      "安全のため、パスワードを再入力して本人確認を行ってください。",
      { reason: "recent-auth-required" },
    );
  }
};

const getUniqueDisplayNames = async ({ teamRef, memberData }) => {
  const displayName = String(memberData.name || "").trim();
  if (!displayName) return new Set();
  const sameNameMembers = await teamRef
    .collection("members")
    .where("name", "==", displayName)
    .limit(2)
    .get();
  if (sameNameMembers.size !== 1) return new Set();
  return new Set([
    displayName,
    ...LEGACY_DISPLAY_NAME_SUFFIXES.map((suffix) => `${displayName}${suffix}`),
  ]);
};

const anonymizeAccountDataInTeam = async ({ uid, teamEntry }) => {
  if (!teamEntry.teamSnap.exists) return 0;

  const uniqueDisplayNames = await getUniqueDisplayNames(teamEntry);
  const context = { uid, uniqueDisplayNames };
  const writer = firestore.bulkWriter();
  let updatedDocumentCount = 0;

  const teamUpdates = getAccountDocumentUpdates(teamEntry.teamData, context);
  if (Object.keys(teamUpdates).length > 0) {
    writer.update(teamEntry.teamRef, teamUpdates);
    updatedDocumentCount += 1;
  }

  for (const collectionName of ACCOUNT_DATA_COLLECTIONS) {
    const snapshot = await teamEntry.teamRef.collection(collectionName).get();
    snapshot.docs.forEach((documentSnapshot) => {
      if (collectionName === "members" && documentSnapshot.id === uid) return;
      const updates = getAccountDocumentUpdates(documentSnapshot.data(), context);
      if (Object.keys(updates).length === 0) return;
      writer.update(documentSnapshot.ref, updates);
      updatedDocumentCount += 1;
    });
  }

  await writer.close();
  return updatedDocumentCount;
};

const anonymizeAccountStorageInTeam = async ({ uid, teamId }) => {
  const bucket = getStorage().bucket();
  const attachmentFileResults = await Promise.all(
    ["calendarAttachments", "dailyReportAttachments"].map((root) =>
      bucket.getFiles({ prefix: `${root}/${teamId}/` }),
    ),
  );
  const files = attachmentFileResults.flatMap(([rootFiles]) => rootFiles);
  let updatedFileCount = 0;

  for (const file of files) {
    const [metadata] = await file.getMetadata();
    const customMetadata = metadata?.metadata || {};
    if (customMetadata.uploadedBy !== uid) continue;
    await file.setMetadata({
      metadata: {
        ...customMetadata,
        uploadedBy: DELETED_USER_UID,
        ...(customMetadata.authorUid === uid
          ? { authorUid: DELETED_USER_UID }
          : {}),
      },
    });
    updatedFileCount += 1;
  }

  return updatedFileCount;
};

exports.submitSafetyReport = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const reporterUid = request.auth?.uid;
    if (!reporterUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const input = request.data || {};
    const targetType = normalizeCaseText(input.targetType, 50);
    const reportSubject = normalizeCaseText(input.reportSubject, 50);
    const reason = normalizeCaseText(input.reason, 100);
    const postId = normalizeCaseText(input.postId, 200);
    const replyId = normalizeCaseText(input.replyId, 200);
    const dailyReportId = normalizeCaseText(input.dailyReportId, 200);
    const commentId = normalizeCaseText(input.commentId, 200);
    const details = normalizeCaseText(input.details, 1000);
    const isWorkspaceReply = targetType === "workspace_reply";
    const isDailyReportComment = targetType === "daily_report_comment";

    if (
      !SAFETY_REPORT_TARGET_TYPES.has(targetType) ||
      !SAFETY_REPORT_SUBJECTS.has(reportSubject) ||
      !SAFETY_REPORT_REASONS.has(reason) ||
      (isDailyReportComment
        ? !dailyReportId || !commentId
        : !postId || (isWorkspaceReply && !replyId))
    ) {
      throw new HttpsError("invalid-argument", "通報内容が正しくありません。");
    }

    const { teamId, teamRef, memberData } = await getAuthenticatedTeamMember(
      input.teamId,
      reporterUid,
    );
    let targetUserUid = "";
    let targetUserDisplayName = "";
    let targetDocumentPath = "";
    let targetEvidence = null;

    if (isDailyReportComment) {
      const reportRef = teamRef.collection("dailyReports").doc(dailyReportId);
      const reportSnap = await reportRef.get();
      if (!reportSnap.exists) {
        throw new HttpsError("not-found", "通報対象の日報が見つかりません。");
      }
      const reportData = reportSnap.data() || {};
      const reportComments = Array.isArray(reportData.comments)
        ? reportData.comments
        : [];
      const targetComment = reportComments.find(
        (comment) => String(comment?.id || "") === commentId,
      );
      if (!targetComment) {
        throw new HttpsError("not-found", "通報対象のコメントが見つかりません。");
      }
      targetUserUid = normalizeCaseText(targetComment.uid, 128);
      targetUserDisplayName = normalizeCaseText(targetComment.user, 200);
      targetDocumentPath = reportRef.path;
      targetEvidence = getDailyReportEvidence(reportData, {
        reportId: dailyReportId,
        commentId,
      });
    } else {
      const postRef = teamRef.collection("workspacePosts").doc(postId);
      const postSnap = await postRef.get();
      if (!postSnap.exists) {
        throw new HttpsError("not-found", "通報対象の投稿が見つかりません。");
      }
      const postData = postSnap.data() || {};
      const targetReply = isWorkspaceReply
        ? (postData.replies || []).find(
            (reply) => String(reply?.id || "") === replyId,
          )
        : null;
      if (isWorkspaceReply && !targetReply) {
        throw new HttpsError("not-found", "通報対象の返信が見つかりません。");
      }
      targetUserUid = normalizeCaseText(
        isWorkspaceReply ? targetReply?.authorUid : postData.authorUid,
        128,
      );
      targetUserDisplayName = normalizeCaseText(
        isWorkspaceReply ? targetReply?.user : postData.user,
        200,
      );
      targetDocumentPath = postRef.path;
      targetEvidence = getWorkspacePostEvidence(postData, {
        postId,
        targetType,
        replyId,
      });
    }

    if (reportSubject === "user" && !targetUserUid) {
      throw new HttpsError(
        "failed-precondition",
        "この投稿はユーザー識別情報が不足しているため、内容を通報してください。",
      );
    }
    if (reportSubject === "user" && targetUserUid === reporterUid) {
      throw new HttpsError("invalid-argument", "自分自身は通報できません。");
    }

    const now = Timestamp.now();
    const caseId = await createSupportCaseWithEvidence({
      caseData: {
        caseType: "safety_report",
        reportSubject,
        reason,
        details,
        teamId,
        reporterUid,
        reporterDisplayName: normalizeCaseText(memberData.name, 200),
        targetType,
        targetDocumentPath,
        targetPostId: postId || null,
        targetReplyId: replyId || null,
        targetDailyReportId: dailyReportId || null,
        targetCommentId: commentId || null,
        targetUserUid: targetUserUid || null,
        targetUserDisplayName,
        status: "received",
        createdAt: now,
        statusUpdatedAt: now,
        resolvedAt: null,
        deleteAfter: null,
        legalHold: false,
        source: "app",
      },
      evidence: {
        eventType: "reported",
        capturedAt: now,
        snapshot: targetEvidence,
      },
    });

    logger.info("Safety report received.", {
      caseId,
      teamId,
      targetType,
      reportSubject,
    });
    return { accepted: true, caseId };
  },
);

exports.submitSupportRequest = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const reporterUid = request.auth?.uid;
    if (!reporterUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const input = request.data || {};
    const category = normalizeCaseText(input.category, 100);
    const details = normalizeCaseText(input.details, 2000);
    if (!SUPPORT_REQUEST_CATEGORIES.has(category) || !details) {
      throw new HttpsError("invalid-argument", "相談内容を入力してください。");
    }

    const { teamId, memberData } = await getAuthenticatedTeamMember(
      input.teamId,
      reporterUid,
    );
    const now = Timestamp.now();
    const caseId = await createSupportCaseWithEvidence({
      caseData: {
        caseType: "support_request",
        category,
        details,
        teamId,
        reporterUid,
        reporterDisplayName: normalizeCaseText(memberData.name, 200),
        status: "received",
        createdAt: now,
        statusUpdatedAt: now,
        resolvedAt: null,
        deleteAfter: null,
        legalHold: false,
        source: "app_settings",
      },
    });

    logger.info("Support request received.", { caseId, teamId, category });
    return { accepted: true, caseId };
  },
);

exports.setUserBlocked = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 15,
    memory: "256MiB",
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const targetUid = normalizeCaseText(request.data?.targetUid, 128);
    const shouldBlock = request.data?.blocked === true;
    if (!targetUid || targetUid.includes("/") || targetUid === callerUid) {
      throw new HttpsError("invalid-argument", "ブロック対象が正しくありません。");
    }

    if (shouldBlock) {
      const { teamRef } = await getAuthenticatedTeamMember(
        request.data?.teamId,
        callerUid,
      );
      const targetMemberSnap = await teamRef
        .collection("members")
        .doc(targetUid)
        .get();
      if (!targetMemberSnap.exists) {
        throw new HttpsError(
          "not-found",
          "同じチームに所属するユーザーを確認できませんでした。",
        );
      }
    }

    await firestore
      .collection("users")
      .doc(callerUid)
      .set(
        {
          blockedUserUids: shouldBlock
            ? FieldValue.arrayUnion(targetUid)
            : FieldValue.arrayRemove(targetUid),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    logger.info("User block preference updated.", {
      callerUid,
      targetUid,
      blocked: shouldBlock,
    });
    return { targetUid, blocked: shouldBlock };
  },
);

exports.validateUserContent = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 15,
    memory: "256MiB",
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const contentType = normalizeCaseText(request.data?.contentType, 50);
    const content = normalizeCaseText(request.data?.content, 5000);
    if (!MODERATED_CONTENT_TYPES.has(contentType) || !content) {
      throw new HttpsError("invalid-argument", "確認対象の内容が正しくありません。");
    }
    await getAuthenticatedTeamMember(request.data?.teamId, callerUid);

    const inspection = inspectUserContent(content);
    if (inspection.blockedReasons.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        "安全上の理由により、この内容は送信できません。",
        {
          reason: "content-blocked",
          blockedReasons: inspection.blockedReasons,
        },
      );
    }
    return { accepted: true, warnings: inspection.warnings };
  },
);

exports.manageOwnWorkspaceContent = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const input = request.data || {};
    const postId = normalizeCaseText(input.postId, 200);
    const replyId = normalizeCaseText(input.replyId, 200);
    const action = normalizeCaseText(input.action, 20);
    const rawContent =
      typeof input.content === "string" ? input.content.trim() : "";
    if (!postId || !new Set(["edit", "delete"]).has(action)) {
      throw new HttpsError("invalid-argument", "編集対象が正しくありません。");
    }
    if (action === "edit" && (!rawContent || rawContent.length > 5000)) {
      throw new HttpsError(
        "invalid-argument",
        "内容は1文字以上5000文字以内で入力してください。",
      );
    }

    const { teamId, teamRef } = await getAuthenticatedTeamMember(
      input.teamId,
      callerUid,
    );
    const inspection =
      action === "edit" ? inspectUserContent(rawContent) : null;
    if (inspection?.blockedReasons.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        "安全上の理由により、この内容は保存できません。",
        {
          reason: "content-blocked",
          blockedReasons: inspection.blockedReasons,
        },
      );
    }

    const postRef = teamRef.collection("workspacePosts").doc(postId);
    const now = Timestamp.now();
    const result = await firestore.runTransaction(async (transaction) => {
      const postSnapshot = await transaction.get(postRef);
      if (!postSnapshot.exists) {
        throw new HttpsError("not-found", "対象の投稿が見つかりません。");
      }
      const postData = postSnapshot.data() || {};

      if (replyId) {
        let targetFound = false;
        const replies = (postData.replies || []).map((reply) => {
          if (String(reply?.id || "") !== replyId) return reply;
          targetFound = true;
          if (reply.authorUid !== callerUid) {
            throw new HttpsError(
              "permission-denied",
              "自分の返信だけを編集・削除できます。",
            );
          }
          if (reply.status === "deleted") {
            throw new HttpsError(
              "failed-precondition",
              "削除済みの返信は変更できません。",
            );
          }
          return action === "edit"
            ? {
                ...reply,
                content: rawContent,
                editedAt: now,
                editedByUid: callerUid,
              }
            : {
                ...reply,
                status: "deleted",
                deletedAt: now,
                deletedByUid: callerUid,
              };
        });
        if (!targetFound) {
          throw new HttpsError("not-found", "対象の返信が見つかりません。");
        }
        transaction.update(postRef, {
          replies,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { teamId, postId, replyId, action, content: rawContent };
      }

      if (postData.authorUid !== callerUid) {
        throw new HttpsError(
          "permission-denied",
          "自分の投稿だけを編集・削除できます。",
        );
      }
      if (postData.status === "deleted") {
        throw new HttpsError(
          "failed-precondition",
          "削除済みの投稿は変更できません。",
        );
      }
      const updateData =
        action === "edit"
          ? {
              content: rawContent,
              editedAt: now,
              editedByUid: callerUid,
              updatedAt: FieldValue.serverTimestamp(),
            }
          : {
              status: "deleted",
              deletedAt: now,
              deletedByUid: callerUid,
              updatedAt: FieldValue.serverTimestamp(),
            };
      transaction.update(postRef, updateData);
      return { teamId, postId, replyId: null, action, content: rawContent };
    });

    logger.info("Workspace content owner action completed.", {
      teamId: result.teamId,
      postId: result.postId,
      replyId: result.replyId,
      action: result.action,
      callerUid,
    });
    return result;
  },
);

exports.moderateWorkspaceContent = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const input = request.data || {};
    const postId = normalizeCaseText(input.postId, 200);
    const replyId = normalizeCaseText(input.replyId, 200);
    const action = normalizeCaseText(input.action, 20);
    const reason =
      normalizeCaseText(input.reason, 500) || "チーム管理者による安全対応";
    if (!postId || !new Set(["hide", "restore"]).has(action)) {
      throw new HttpsError("invalid-argument", "非表示対象が正しくありません。");
    }

    const { teamId, teamRef, memberData } = await getAuthenticatedTeamMember(
      input.teamId,
      callerUid,
    );
    const callerRole = normalizeCaseText(memberData.role, 50) || "member";
    if (!MEMBER_MANAGER_ROLES.has(callerRole)) {
      throw new HttpsError(
        "permission-denied",
        "コンテンツを管理する権限がありません。",
      );
    }

    const membersSnapshot = await teamRef.collection("members").get();
    const managerUids = membersSnapshot.docs
      .filter((memberSnapshot) =>
        MEMBER_MANAGER_ROLES.has(memberSnapshot.data()?.role || "member"),
      )
      .map((memberSnapshot) => memberSnapshot.id);
    if (!managerUids.includes(callerUid)) managerUids.push(callerUid);

    const postRef = teamRef.collection("workspacePosts").doc(postId);
    const now = Timestamp.now();
    const result = await firestore.runTransaction(async (transaction) => {
      const postSnapshot = await transaction.get(postRef);
      if (!postSnapshot.exists) {
        throw new HttpsError("not-found", "対象の投稿が見つかりません。");
      }
      const postData = postSnapshot.data() || {};

      if (replyId) {
        let targetFound = false;
        const replies = (postData.replies || []).map((reply) => {
          if (String(reply?.id || "") !== replyId) return reply;
          targetFound = true;
          return action === "hide"
            ? {
                ...reply,
                moderationStatus: "hidden",
                moderationReason: reason,
                moderatedByUid: callerUid,
                moderatedAt: now,
              }
            : {
                ...reply,
                moderationStatus: "active",
                moderationRestoredByUid: callerUid,
                moderationRestoredAt: now,
              };
        });
        if (!targetFound) {
          throw new HttpsError("not-found", "対象の返信が見つかりません。");
        }
        transaction.update(postRef, {
          replies,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { teamId, postId, replyId, action };
      }

      if (action === "hide") {
        transaction.update(postRef, {
          moderationStatus: "hidden",
          moderationReason: reason,
          moderatedByUid: callerUid,
          moderatedAt: now,
          moderationOriginalVisibleToUids:
            postData.moderationOriginalVisibleToUids ||
            postData.visibleToUids ||
            [],
          moderationOriginalReadTargetUids:
            postData.moderationOriginalReadTargetUids ||
            postData.readTargetUids ||
            [],
          visibleToUids: [...new Set(managerUids)],
          readTargetUids: [...new Set(managerUids)],
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        transaction.update(postRef, {
          moderationStatus: "active",
          moderationRestoredByUid: callerUid,
          moderationRestoredAt: now,
          visibleToUids:
            postData.moderationOriginalVisibleToUids ||
            postData.visibleToUids ||
            [],
          readTargetUids:
            postData.moderationOriginalReadTargetUids ||
            postData.readTargetUids ||
            [],
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { teamId, postId, replyId: null, action };
    });

    logger.info("Workspace content moderation updated.", result);
    return result;
  },
);

exports.trackReportedWorkspacePostChanges = onDocumentWritten(
  {
    document: "teams/{teamId}/workspacePosts/{postId}",
    region: "asia-northeast1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const beforeData = event.data?.before.exists
      ? event.data.before.data() || {}
      : null;
    const afterData = event.data?.after.exists
      ? event.data.after.data() || {}
      : null;
    if (!beforeData) return;

    const { teamId, postId } = event.params;
    if (
      getWorkspaceDocumentFingerprint(beforeData, postId) ===
      getWorkspaceDocumentFingerprint(afterData, postId)
    ) {
      return;
    }

    const targetDocumentPath = `teams/${teamId}/workspacePosts/${postId}`;
    const casesSnapshot = await firestore
      .collection(SUPPORT_CASE_COLLECTION)
      .where("targetDocumentPath", "==", targetDocumentPath)
      .get();
    const activeCases = casesSnapshot.docs.filter((caseSnapshot) =>
      ACTIVE_SUPPORT_CASE_STATUSES.has(caseSnapshot.data()?.status),
    );
    if (activeCases.length === 0) return;

    const capturedAt = Timestamp.now();
    const writer = firestore.bulkWriter();
    activeCases.forEach((caseSnapshot) => {
      const caseData = caseSnapshot.data() || {};
      const evidenceOptions = {
        postId,
        targetType: caseData.targetType,
        replyId: caseData.targetReplyId || "",
      };
      const beforeSnapshot = getWorkspacePostEvidence(
        beforeData,
        evidenceOptions,
      );
      const afterSnapshot = getWorkspacePostEvidence(afterData, evidenceOptions);
      if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) return;
      writer.set(caseSnapshot.ref.collection("evidence").doc(), {
        eventType: afterData ? "updated" : "deleted",
        capturedAt,
        before: beforeSnapshot,
        after: afterSnapshot,
      });
    });
    await writer.close();
  },
);

exports.trackReportedDailyReportChanges = onDocumentWritten(
  {
    document: "teams/{teamId}/dailyReports/{reportId}",
    region: "asia-northeast1",
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (event) => {
    const beforeData = event.data?.before.exists
      ? event.data.before.data() || {}
      : null;
    const afterData = event.data?.after.exists
      ? event.data.after.data() || {}
      : null;
    if (!beforeData) return;

    const { teamId, reportId } = event.params;
    if (
      getDailyReportDocumentFingerprint(beforeData, reportId) ===
      getDailyReportDocumentFingerprint(afterData, reportId)
    ) {
      return;
    }

    const targetDocumentPath = `teams/${teamId}/dailyReports/${reportId}`;
    const casesSnapshot = await firestore
      .collection(SUPPORT_CASE_COLLECTION)
      .where("targetDocumentPath", "==", targetDocumentPath)
      .get();
    const activeCases = casesSnapshot.docs.filter((caseSnapshot) =>
      ACTIVE_SUPPORT_CASE_STATUSES.has(caseSnapshot.data()?.status),
    );
    if (activeCases.length === 0) return;

    const capturedAt = Timestamp.now();
    const writer = firestore.bulkWriter();
    activeCases.forEach((caseSnapshot) => {
      const caseData = caseSnapshot.data() || {};
      const evidenceOptions = {
        reportId,
        commentId: caseData.targetCommentId || "",
      };
      const beforeSnapshot = getDailyReportEvidence(
        beforeData,
        evidenceOptions,
      );
      const afterSnapshot = getDailyReportEvidence(afterData, evidenceOptions);
      if (JSON.stringify(beforeSnapshot) === JSON.stringify(afterSnapshot)) return;
      writer.set(caseSnapshot.ref.collection("evidence").doc(), {
        eventType: afterData ? "updated" : "deleted",
        capturedAt,
        before: beforeSnapshot,
        after: afterSnapshot,
      });
    });
    await writer.close();
  },
);

exports.applySupportCaseRetention = onDocumentUpdated(
  {
    document: `${SUPPORT_CASE_COLLECTION}/{caseId}`,
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (event) => {
    const beforeData = event.data.before.data() || {};
    const afterData = event.data.after.data() || {};
    const updates = {};

    if (beforeData.status !== afterData.status) {
      updates.statusUpdatedAt = Timestamp.now();
      if (afterData.status === "resolved") {
        const resolvedAt = Timestamp.now();
        updates.resolvedAt = resolvedAt;
        updates.deleteAfter = afterData.legalHold
          ? null
          : Timestamp.fromMillis(
              resolvedAt.toMillis() + SUPPORT_CASE_RETENTION_MS,
            );
      } else {
        updates.resolvedAt = null;
        updates.deleteAfter = null;
      }
    }

    if (beforeData.legalHold !== afterData.legalHold) {
      if (afterData.legalHold) {
        updates.deleteAfter = null;
      } else if (afterData.status === "resolved") {
        const resolvedAt =
          afterData.resolvedAt instanceof Timestamp
            ? afterData.resolvedAt
            : Timestamp.now();
        if (!(afterData.resolvedAt instanceof Timestamp)) {
          updates.resolvedAt = resolvedAt;
        }
        updates.deleteAfter = Timestamp.fromMillis(
          resolvedAt.toMillis() + SUPPORT_CASE_RETENTION_MS,
        );
      }
    }

    if (Object.keys(updates).length > 0) {
      await event.data.after.ref.set(updates, { merge: true });
    }
  },
);

exports.deleteExpiredSupportCases = onSchedule(
  {
    region: "asia-northeast1",
    schedule: "30 3 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const now = Timestamp.now();
    let deletedCaseCount = 0;

    while (true) {
      const expiredSnapshot = await firestore
        .collection(SUPPORT_CASE_COLLECTION)
        .where("deleteAfter", "<=", now)
        .limit(100)
        .get();
      if (expiredSnapshot.empty) break;

      let deletedInBatch = 0;
      for (const caseSnapshot of expiredSnapshot.docs) {
        const caseData = caseSnapshot.data() || {};
        if (caseData.legalHold || caseData.status !== "resolved") continue;
        await firestore.recursiveDelete(caseSnapshot.ref);
        deletedCaseCount += 1;
        deletedInBatch += 1;
      }
      if (deletedInBatch === 0 || expiredSnapshot.size < 100) break;
    }

    logger.info("Expired support cases deleted.", { deletedCaseCount });
  },
);

exports.joinTeamWithInvite = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 10,
    memory: "256MiB",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const inviteCode = String(request.data?.inviteCode || "").trim();
    const userName = String(request.data?.userName || "ゲスト").trim() || "ゲスト";

    if (!/^[A-Za-z0-9]{6}$/.test(inviteCode)) {
      throw new HttpsError("invalid-argument", "無効な招待コードです。");
    }
    if (userName.length > 100) {
      throw new HttpsError("invalid-argument", "表示名が長すぎます。");
    }

    const inviteRef = firestore.collection("invites").doc(inviteCode);

    return firestore.runTransaction(async (transaction) => {
      const inviteSnap = await transaction.get(inviteRef);
      const inviteData = inviteSnap.data();
      const teamId = inviteData?.teamId;

      if (
        !inviteSnap.exists ||
        inviteData?.active !== true ||
        typeof teamId !== "string" ||
        !teamId
      ) {
        throw new HttpsError("not-found", "無効な招待コードです。");
      }

      const teamRef = firestore.collection("teams").doc(teamId);
      const memberRef = teamRef.collection("members").doc(uid);
      const userRef = firestore.collection("users").doc(uid);
      const [teamSnap, memberSnap, userSnap] = await Promise.all([
        transaction.get(teamRef),
        transaction.get(memberRef),
        transaction.get(userRef),
      ]);

      if (!teamSnap.exists) {
        throw new HttpsError("not-found", "招待先のチームが見つかりません。");
      }

      const teamIds = userSnap.exists ? normalizeTeamIds(userSnap.data()) : [];
      const isRemembered = teamIds.includes(teamId);
      let maxTeamsPerUser = DEFAULT_MAX_TEAMS_PER_USER;

      if (!isRemembered && teamIds.length >= DEFAULT_MAX_TEAMS_PER_USER) {
        let isSharpRiseMember = inviteCode === SHARP_RISE_INVITE_CODE;

        if (!isSharpRiseMember) {
          const sharpRiseInviteSnap = await transaction.get(
            firestore.collection("invites").doc(SHARP_RISE_INVITE_CODE),
          );
          const sharpRiseTeamId = sharpRiseInviteSnap.data()?.teamId;

          if (typeof sharpRiseTeamId === "string" && sharpRiseTeamId) {
            const sharpRiseMemberSnap = await transaction.get(
              firestore
                .collection("teams")
                .doc(sharpRiseTeamId)
                .collection("members")
                .doc(uid),
            );
            isSharpRiseMember = sharpRiseMemberSnap.exists;
          }
        }

        if (isSharpRiseMember) {
          maxTeamsPerUser = SHARP_RISE_MAX_TEAMS_PER_USER;
        }
      }

      if (!isRemembered && teamIds.length >= maxTeamsPerUser) {
        throw new HttpsError(
          "failed-precondition",
          `所属できるチームは最大${maxTeamsPerUser}件までです。`,
        );
      }

      if (!memberSnap.exists) {
        transaction.create(memberRef, {
          name: userName,
          role: "member",
          inviteCode,
          joinedAt: FieldValue.serverTimestamp(),
        });
      }

      transaction.set(
        userRef,
        {
          activeTeamId: teamId,
          teamIds: [...new Set([...teamIds, teamId])],
        },
        { merge: true },
      );

      return { teamId, type: "join", alreadyMember: memberSnap.exists };
    });
  },
);

exports.removeTeamMember = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 10,
    memory: "256MiB",
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const teamId = String(request.data?.teamId || "").trim();
    const targetUid = String(request.data?.targetUid || "").trim();
    if (!teamId || !targetUid || teamId.length > 128 || targetUid.length > 128) {
      throw new HttpsError("invalid-argument", "Invalid team or member.");
    }

    const teamRef = firestore.collection("teams").doc(teamId);
    const callerMemberRef = teamRef.collection("members").doc(callerUid);
    const targetMemberRef = teamRef.collection("members").doc(targetUid);
    const targetUserRef = firestore.collection("users").doc(targetUid);

    return firestore.runTransaction(async (transaction) => {
      const [teamSnap, callerMemberSnap, targetMemberSnap, targetUserSnap] =
        await Promise.all([
          transaction.get(teamRef),
          transaction.get(callerMemberRef),
          transaction.get(targetMemberRef),
          transaction.get(targetUserRef),
        ]);

      if (!teamSnap.exists || !targetMemberSnap.exists) {
        throw new HttpsError("not-found", "The member was not found.");
      }
      if (!callerMemberSnap.exists) {
        throw new HttpsError(
          "permission-denied",
          "You are not a member of this team.",
        );
      }

      const teamData = teamSnap.data() || {};
      if (teamData.createdBy === targetUid) {
        throw new HttpsError(
          "failed-precondition",
          "チーム作成者は、所有権を移管するかチームを削除するまで退会・除外できません。",
          { reason: "team-owner-transfer-required" },
        );
      }

      const isSelfRemoval = callerUid === targetUid;
      const callerRole = callerMemberSnap.data()?.role || "member";
      if (!isSelfRemoval && !MEMBER_MANAGER_ROLES.has(callerRole)) {
        throw new HttpsError(
          "permission-denied",
          "You do not have permission to remove this member.",
        );
      }

      const targetUserData = targetUserSnap.exists ? targetUserSnap.data() : {};
      const remainingTeamIds = normalizeTeamIds(targetUserData).filter(
        (id) => id !== teamId,
      );
      const currentActiveTeamId =
        typeof targetUserData.activeTeamId === "string"
          ? targetUserData.activeTeamId
          : "";
      const nextActiveTeamId =
        currentActiveTeamId === teamId ||
        (currentActiveTeamId &&
          !remainingTeamIds.includes(currentActiveTeamId))
          ? remainingTeamIds[0] || ""
          : currentActiveTeamId;

      transaction.set(
        targetUserRef,
        {
          activeTeamId: nextActiveTeamId,
          teamIds: remainingTeamIds,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      transaction.delete(targetMemberRef);

      return {
        activeTeamId: nextActiveTeamId || null,
        teamIds: remainingTeamIds,
      };
    });
  },
);

exports.checkAccountDeletionEligibility = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const context = await getAccountDeletionContext(uid);
    return {
      eligible: context.blockingTeams.length === 0,
      blockingTeams: context.blockingTeams,
    };
  },
);

exports.deleteUserAccount = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    assertRecentAuthentication(request);
    const context = await getAccountDeletionContext(uid);
    assertAccountDeletionEligible(context);

    let anonymizedDocumentCount = 0;
    let anonymizedStorageFileCount = 0;
    let deletedSupportCaseCount = 0;
    let removedBlockReferenceCount = 0;

    try {
      deletedSupportCaseCount =
        await deleteNonSafetySupportCasesForAccount(uid);
      removedBlockReferenceCount = await removeAccountFromBlockLists(uid);
      for (const teamEntry of context.teamEntries) {
        anonymizedDocumentCount += await anonymizeAccountDataInTeam({
          uid,
          teamEntry,
        });
        anonymizedStorageFileCount += await anonymizeAccountStorageInTeam({
          uid,
          teamId: teamEntry.teamId,
        });
      }

      const membershipWriter = firestore.bulkWriter();
      context.teamEntries.forEach(({ memberRef, memberSnap }) => {
        if (memberSnap.exists) membershipWriter.delete(memberRef);
      });
      await membershipWriter.close();

      await firestore.recursiveDelete(context.userRef);

      await getAuth().deleteUser(uid);

      return {
        deleted: true,
        removedTeamCount: context.teamEntries.filter(
          ({ memberSnap }) => memberSnap.exists,
        ).length,
        anonymizedDocumentCount,
        anonymizedStorageFileCount,
        deletedSupportCaseCount,
        removedBlockReferenceCount,
      };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("Account deletion failed.", {
        code: String(error?.code || "unknown"),
      });
      throw new HttpsError(
        "internal",
        "アカウントを削除できませんでした。データは可能な範囲で保持されています。時間をおいて再度お試しください。",
      );
    }
  },
);

exports.transferTeamOwnership = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    assertRecentAuthentication(request);

    const teamId = String(request.data?.teamId || "").trim();
    const targetUid = String(request.data?.targetUid || "").trim();
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(teamId) ||
      !targetUid ||
      targetUid.length > 128
    ) {
      throw new HttpsError(
        "invalid-argument",
        "移管先のチームまたは管理者が正しくありません。",
      );
    }
    if (callerUid === targetUid) {
      throw new HttpsError(
        "invalid-argument",
        "自分自身を移管先に指定することはできません。",
      );
    }

    const teamRef = firestore.collection("teams").doc(teamId);
    const callerMemberRef = teamRef.collection("members").doc(callerUid);
    const targetMemberRef = teamRef.collection("members").doc(targetUid);

    return firestore.runTransaction(async (transaction) => {
      const [teamSnap, callerMemberSnap, targetMemberSnap] = await Promise.all([
        transaction.get(teamRef),
        transaction.get(callerMemberRef),
        transaction.get(targetMemberRef),
      ]);

      if (!teamSnap.exists || !callerMemberSnap.exists) {
        throw new HttpsError("not-found", "チームが見つかりません。");
      }
      if (!targetMemberSnap.exists) {
        throw new HttpsError(
          "failed-precondition",
          "移管先が同じチームに所属していません。",
          { reason: "target-not-team-member" },
        );
      }

      const teamData = teamSnap.data() || {};
      const callerRole = callerMemberSnap.data()?.role || "member";
      const targetRole = targetMemberSnap.data()?.role || "member";
      if (
        teamData.createdBy !== callerUid ||
        !["owner", "admin"].includes(callerRole)
      ) {
        throw new HttpsError(
          "permission-denied",
          "所有権を移管できるのはチーム作成者本人だけです。",
        );
      }
      if (!["owner", "admin"].includes(targetRole)) {
        throw new HttpsError(
          "failed-precondition",
          "移管先を先に管理者へ設定してください。",
          { reason: "target-admin-required" },
        );
      }

      const inviteCode =
        typeof teamData.inviteCode === "string" &&
        /^[A-Za-z0-9]{6}$/.test(teamData.inviteCode)
          ? teamData.inviteCode
          : "";
      const inviteRef = inviteCode
        ? firestore.collection("invites").doc(inviteCode)
        : null;
      const inviteSnap = inviteRef ? await transaction.get(inviteRef) : null;
      const inviteBelongsToTeam =
        inviteSnap?.exists && inviteSnap.data()?.teamId === teamId;

      transaction.update(teamRef, {
        createdBy: targetUid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (inviteBelongsToTeam) {
        transaction.update(inviteRef, {
          createdBy: targetUid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      return {
        transferred: true,
        teamId,
        previousOwnerUid: callerUid,
        ownerUid: targetUid,
      };
    });
  },
);

exports.deleteTeam = onCall(
  {
    region: "asia-northeast1",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }

    const teamId = String(request.data?.teamId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(teamId)) {
      throw new HttpsError("invalid-argument", "無効なチームIDです。");
    }

    const teamRef = firestore.collection("teams").doc(teamId);
    const callerMemberRef = teamRef.collection("members").doc(callerUid);
    const callerUserRef = firestore.collection("users").doc(callerUid);
    const [teamSnap, callerMemberSnap] = await Promise.all([
      teamRef.get(),
      callerMemberRef.get(),
    ]);

    if (!teamSnap.exists || !callerMemberSnap.exists) {
      throw new HttpsError("not-found", "チームが見つかりません。");
    }

    const teamData = teamSnap.data() || {};
    const callerRole = callerMemberSnap.data()?.role || "member";
    if (
      !["owner", "admin"].includes(callerRole) ||
      teamData.createdBy !== callerUid
    ) {
      throw new HttpsError(
        "permission-denied",
        "チームを削除できるのは監督かつチーム作成者本人だけです。",
      );
    }

    const inviteCode =
      typeof teamData.inviteCode === "string" &&
      /^[A-Za-z0-9]{6}$/.test(teamData.inviteCode)
        ? teamData.inviteCode
        : "";
    const inviteRef = inviteCode
      ? firestore.collection("invites").doc(inviteCode)
      : null;
    const inviteSnap = inviteRef ? await inviteRef.get() : null;
    const inviteBelongsToTeam =
      inviteSnap?.exists && inviteSnap.data()?.teamId === teamId;
    let inviteDisabled = false;
    let teamDeleted = false;

    try {
      if (inviteBelongsToTeam) {
        await inviteRef.set(
          {
            active: false,
            deletionRequestedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        inviteDisabled = true;
      }

      const membersSnap = await teamRef.collection("members").limit(2).get();
      if (
        membersSnap.size !== 1 ||
        membersSnap.docs[0]?.id !== callerUid
      ) {
        throw new HttpsError(
          "failed-precondition",
          "他のメンバーが所属しているチームは削除できません。",
        );
      }

      const bucket = getStorage().bucket();
      const attachmentFileResults = await Promise.all(
        ["calendarAttachments", "dailyReportAttachments"].map((root) =>
          bucket.getFiles({ prefix: `${root}/${teamId}/` }),
        ),
      );
      const attachmentFiles = attachmentFileResults.flatMap(
        ([rootFiles]) => rootFiles,
      );
      await Promise.all(
        attachmentFiles.map((file) => file.delete({ ignoreNotFound: true })),
      );

      await firestore.recursiveDelete(teamRef);
      teamDeleted = true;

      return firestore.runTransaction(async (transaction) => {
        const currentUserSnap = await transaction.get(callerUserRef);
        const callerUserData = currentUserSnap.exists
          ? currentUserSnap.data()
          : {};
        const remainingTeamIds = normalizeTeamIds(callerUserData).filter(
          (id) => id !== teamId,
        );
        const currentActiveTeamId =
          typeof callerUserData.activeTeamId === "string"
            ? callerUserData.activeTeamId
            : "";
        const nextActiveTeamId =
          currentActiveTeamId === teamId ||
          (currentActiveTeamId &&
            !remainingTeamIds.includes(currentActiveTeamId))
            ? remainingTeamIds[0] || ""
            : currentActiveTeamId;

        transaction.set(
          callerUserRef,
          {
            activeTeamId: nextActiveTeamId,
            teamIds: remainingTeamIds,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        if (inviteBelongsToTeam) {
          transaction.delete(inviteRef);
        }

        return {
          deletedTeamId: teamId,
          activeTeamId: nextActiveTeamId || null,
          teamIds: remainingTeamIds,
        };
      });
    } catch (error) {
      if (inviteDisabled && !teamDeleted) {
        try {
          const currentInviteSnap = await inviteRef.get();
          if (
            currentInviteSnap.exists &&
            currentInviteSnap.data()?.teamId === teamId
          ) {
            await inviteRef.set(
              {
                active: true,
                deletionRequestedAt: FieldValue.delete(),
              },
              { merge: true },
            );
          }
        } catch (restoreError) {
          logger.error("Failed to restore invite after team deletion error.", {
            teamId,
            error: restoreError,
          });
        }
      }

      if (error instanceof HttpsError) throw error;

      logger.error("Team deletion failed.", { teamId, callerUid, error });
      throw new HttpsError("internal", "チームを削除できませんでした。");
    }
  },
);

exports.searchPlaceLocation = onCall(
  {
    region: "asia-northeast1",
    secrets: [googleMapsServerApiKey],
    timeoutSeconds: 10,
    memory: "256MiB",
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication is required.");
    }

    const query = normalizeQuery(request.data?.query);
    if (query.length < 2 || query.length > 120) {
      throw new HttpsError(
        "invalid-argument",
        "Query must be between 2 and 120 characters.",
      );
    }

    const apiKey = googleMapsServerApiKey.value();
    if (!apiKey) {
      logger.error("GOOGLE_MAPS_SERVER_API_KEY is not configured.");
      throw new HttpsError("failed-precondition", "Maps API key is not configured.");
    }

    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.googleMapsUri",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "ja",
        regionCode: "JP",
        pageSize: 1,
        locationBias: JAPAN_LOCATION_BIAS,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn("Places Text Search failed", {
        status: response.status,
        body: body.slice(0, 500),
      });
      throw new HttpsError("unavailable", "Places search failed.");
    }

    const data = await response.json();
    const place = Array.isArray(data.places)
      ? data.places.find((candidate) =>
          isValidCoordinate(candidate?.location?.latitude, candidate?.location?.longitude),
        )
      : null;

    if (!place) {
      return { found: false };
    }

    return {
      found: true,
      place: {
        placeId: place.id || "",
        name: place.displayName?.text || query,
        address: place.formattedAddress || "",
        latitude: Number(place.location.latitude),
        longitude: Number(place.location.longitude),
        googleMapsUri: place.googleMapsUri || "",
        source: "google_places_text_search",
      },
    };
  },
);

exports.deleteExpiredCalendarAttachments = onSchedule(
  {
    region: "asia-northeast1",
    schedule: "0 3 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const bucket = getStorage().bucket();
    const [calendarFileResult, dailyReportFileResult] = await Promise.all([
      bucket.getFiles({ prefix: "calendarAttachments/" }),
      bucket.getFiles({ prefix: "dailyReportAttachments/" }),
    ]);
    const files = [
      ...calendarFileResult[0],
      ...dailyReportFileResult[0],
    ];
    const now = Date.now();
    const expiredFiles = [];

    for (const file of files) {
      const [metadata] = await file.getMetadata();
      const customMetadata = metadata.metadata || {};
      const expiresAt = Date.parse(customMetadata.expiresAt || "");
      if (!Number.isFinite(expiresAt) || expiresAt > now) continue;

      const pathParts = file.name.split("/");
      const teamId = customMetadata.teamId || pathParts[1] || "";
      const attachmentType = pathParts[0];
      const reportId = customMetadata.reportId || pathParts[3] || "";
      expiredFiles.push({
        file,
        storagePath: file.name,
        teamId,
        reportId,
        attachmentType,
      });
    }

    if (expiredFiles.length === 0) {
      logger.info("No expired attachments found.");
      return;
    }

    const calendarExpiredPathsByTeam = new Map();
    const dailyReportExpiredPathsByDocument = new Map();
    for (const expiredFile of expiredFiles) {
      await expiredFile.file.delete({ ignoreNotFound: true });
      if (!expiredFile.teamId) continue;
      if (
        expiredFile.attachmentType === "dailyReportAttachments" &&
        expiredFile.reportId
      ) {
        const documentKey = `${expiredFile.teamId}/${expiredFile.reportId}`;
        const reportPaths =
          dailyReportExpiredPathsByDocument.get(documentKey) || new Set();
        reportPaths.add(expiredFile.storagePath);
        dailyReportExpiredPathsByDocument.set(documentKey, reportPaths);
      } else {
        const teamPaths =
          calendarExpiredPathsByTeam.get(expiredFile.teamId) || new Set();
        teamPaths.add(expiredFile.storagePath);
        calendarExpiredPathsByTeam.set(expiredFile.teamId, teamPaths);
      }
    }

    let updatedEventCount = 0;
    for (const [teamId, expiredPaths] of calendarExpiredPathsByTeam.entries()) {
      const eventsSnapshot = await firestore
        .collection("teams")
        .doc(teamId)
        .collection("clubEvents")
        .get();

      for (const eventSnapshot of eventsSnapshot.docs) {
        const attachmentsByDate = eventSnapshot.data().attachmentsByDate;
        if (!attachmentsByDate || typeof attachmentsByDate !== "object") {
          continue;
        }

        const containsExpiredPath = Object.values(attachmentsByDate).some(
          (attachments) =>
            Array.isArray(attachments) &&
            attachments.some((attachment) =>
              expiredPaths.has(attachment?.storagePath),
            ),
        );
        if (!containsExpiredPath) continue;

        await firestore.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(eventSnapshot.ref);
          if (!currentSnapshot.exists) return;

          const currentAttachments =
            currentSnapshot.data().attachmentsByDate || {};
          const nextAttachments = Object.entries(currentAttachments).reduce(
            (nextByDate, [date, attachments]) => {
              if (!Array.isArray(attachments)) return nextByDate;
              const activeAttachments = attachments.filter(
                (attachment) => !expiredPaths.has(attachment?.storagePath),
              );
              if (activeAttachments.length > 0) {
                nextByDate[date] = activeAttachments;
              }
              return nextByDate;
            },
            {},
          );

          transaction.update(eventSnapshot.ref, {
            attachmentsByDate: nextAttachments,
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
        updatedEventCount += 1;
      }
    }

    let updatedDailyReportCount = 0;
    for (const [documentKey, expiredPaths] of
      dailyReportExpiredPathsByDocument.entries()) {
      const separatorIndex = documentKey.indexOf("/");
      const teamId = documentKey.slice(0, separatorIndex);
      const reportId = documentKey.slice(separatorIndex + 1);
      const reportRef = firestore
        .collection("teams")
        .doc(teamId)
        .collection("dailyReports")
        .doc(reportId);

      const reportUpdated = await firestore.runTransaction(
        async (transaction) => {
          const reportSnapshot = await transaction.get(reportRef);
          if (!reportSnapshot.exists) return false;

          const attachments = reportSnapshot.data().attachments;
          if (!Array.isArray(attachments)) return false;
          const activeAttachments = attachments.filter(
            (attachment) => !expiredPaths.has(attachment?.storagePath),
          );
          if (activeAttachments.length === attachments.length) return false;

          transaction.update(reportRef, {
            attachments: activeAttachments,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return true;
        },
      );
      if (reportUpdated) updatedDailyReportCount += 1;
    }

    logger.info("Expired attachments deleted.", {
      deletedFileCount: expiredFiles.length,
      updatedEventCount,
      updatedDailyReportCount,
    });
  },
);
