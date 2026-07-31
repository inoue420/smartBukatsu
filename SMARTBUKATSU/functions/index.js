const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

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
