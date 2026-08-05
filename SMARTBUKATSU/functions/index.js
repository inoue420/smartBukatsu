const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();

const firestore = getFirestore();
const MAX_TEAMS_PER_USER = 5;

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
