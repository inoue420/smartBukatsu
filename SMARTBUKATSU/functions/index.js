const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

const googleMapsServerApiKey = defineSecret("GOOGLE_MAPS_SERVER_API_KEY");

const JAPAN_LOCATION_BIAS = {
  rectangle: {
    low: { latitude: 24.0, longitude: 122.0 },
    high: { latitude: 46.0, longitude: 154.0 },
  },
};

const normalizeQuery = (value) => String(value || "").trim().replace(/\s+/g, " ");

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

const hasReportedEvidence = (value) =>
  Array.isArray(value?.reported) && value.reported.length > 0;

const anonymizeAccountValue = (
  value,
  { uid, uniqueDisplayNames, evidenceHoldUntil, fieldName = "" },
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
        evidenceHoldUntil,
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
  if (identityMatches && hasReportedEvidence(value)) {
    const alreadyHidden =
      value.status === "deleted" && value.evidenceHold === true;
    return {
      value: alreadyHidden
        ? value
        : {
            ...value,
            status: "deleted",
            evidenceHold: true,
            evidenceHoldUntil,
          },
      changed: !alreadyHidden,
    };
  }

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
      evidenceHoldUntil,
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
  if (identityMatches && hasReportedEvidence(data)) {
    if (data.status === "deleted" && data.evidenceHold === true) return {};
    return {
      status: "deleted",
      evidenceHold: true,
      evidenceHoldUntil: context.evidenceHoldUntil,
    };
  }

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
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() || {} : {};
  const teamIds = normalizeTeamIds(userData);
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

const anonymizeAccountDataInTeam = async ({ uid, teamEntry, evidenceHoldUntil }) => {
  if (!teamEntry.teamSnap.exists) return 0;

  const uniqueDisplayNames = await getUniqueDisplayNames(teamEntry);
  const context = { uid, uniqueDisplayNames, evidenceHoldUntil };
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
  const [files] = await bucket.getFiles({
    prefix: `calendarAttachments/${teamId}/`,
  });
  let updatedFileCount = 0;

  for (const file of files) {
    const [metadata] = await file.getMetadata();
    const customMetadata = metadata?.metadata || {};
    if (customMetadata.uploadedBy !== uid) continue;
    await file.setMetadata({
      metadata: {
        ...customMetadata,
        uploadedBy: DELETED_USER_UID,
      },
    });
    updatedFileCount += 1;
  }

  return updatedFileCount;
};

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

    const evidenceHoldUntil = Timestamp.fromMillis(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    );
    let anonymizedDocumentCount = 0;
    let anonymizedStorageFileCount = 0;

    try {
      for (const teamEntry of context.teamEntries) {
        anonymizedDocumentCount += await anonymizeAccountDataInTeam({
          uid,
          teamEntry,
          evidenceHoldUntil,
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
      const [attachmentFiles] = await bucket.getFiles({
        prefix: `calendarAttachments/${teamId}/`,
      });
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
    const [files] = await bucket.getFiles({
      prefix: "calendarAttachments/",
    });
    const now = Date.now();
    const expiredFiles = [];

    for (const file of files) {
      const [metadata] = await file.getMetadata();
      const customMetadata = metadata.metadata || {};
      const expiresAt = Date.parse(customMetadata.expiresAt || "");
      if (!Number.isFinite(expiresAt) || expiresAt > now) continue;

      const pathParts = file.name.split("/");
      const teamId = customMetadata.teamId || pathParts[1] || "";
      expiredFiles.push({ file, storagePath: file.name, teamId });
    }

    if (expiredFiles.length === 0) {
      logger.info("No expired calendar attachments found.");
      return;
    }

    const expiredPathsByTeam = new Map();
    for (const expiredFile of expiredFiles) {
      await expiredFile.file.delete({ ignoreNotFound: true });
      if (!expiredFile.teamId) continue;
      const teamPaths = expiredPathsByTeam.get(expiredFile.teamId) || new Set();
      teamPaths.add(expiredFile.storagePath);
      expiredPathsByTeam.set(expiredFile.teamId, teamPaths);
    }

    let updatedEventCount = 0;
    for (const [teamId, expiredPaths] of expiredPathsByTeam.entries()) {
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

    logger.info("Expired calendar attachments deleted.", {
      deletedFileCount: expiredFiles.length,
      updatedEventCount,
    });
  },
);
