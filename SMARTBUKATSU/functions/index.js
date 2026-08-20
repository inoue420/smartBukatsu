const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

initializeApp();

const firestore = getFirestore();
const MAX_TEAMS_PER_USER = 5;
const MEMBER_MANAGER_ROLES = new Set(["owner", "admin", "staff"]);

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

    const inviteCode = String(request.data?.inviteCode || "")
      .trim()
      .toUpperCase();
    const userName = String(request.data?.userName || "ゲスト").trim() || "ゲスト";

    if (!/^[A-Z0-9]{6}$/.test(inviteCode)) {
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
      if (!isRemembered && teamIds.length >= MAX_TEAMS_PER_USER) {
        throw new HttpsError(
          "failed-precondition",
          `所属できるチームは最大${MAX_TEAMS_PER_USER}件までです。`,
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
