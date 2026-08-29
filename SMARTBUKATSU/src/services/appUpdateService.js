import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import { Linking, Platform } from "react-native";
import { doc, getDocFromServer } from "firebase/firestore";

import { db } from "../firebase";

const VERSION_POLICY_COLLECTION = "appConfig";
const VERSION_POLICY_DOCUMENT = "versionPolicy";
const OPTIONAL_DISMISSAL_KEY_PREFIX = "smartbukatsu_update_dismissed";
const DEFAULT_OPTIONAL_COOLDOWN_HOURS = 24;
const MAX_OPTIONAL_COOLDOWN_HOURS = 24 * 30;

const SUPPORTED_PLATFORMS = new Set(["android", "ios"]);
const VERSION_PATTERN = /^\d+(?:\.\d+)*$/;

const DEFAULT_MESSAGES = {
  optionalTitle: "新しいバージョンがあります",
  optionalMessage:
    "SMARTBUKATSUの新しいバージョンが利用できます。アップデートしてご利用ください。",
  requiredTitle: "アップデートが必要です",
  requiredMessage:
    "このバージョンのサポートは終了しました。引き続き利用するにはアップデートしてください。",
};

function parseVersion(value) {
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/^v/i, "");
  if (!VERSION_PATTERN.test(normalized)) return null;

  const segments = normalized.split(".").map(Number);
  if (segments.some((segment) => !Number.isSafeInteger(segment))) return null;

  while (segments.length > 1 && segments.at(-1) === 0) {
    segments.pop();
  }

  return { normalized, segments };
}

export function compareAppVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  if (!left || !right) return null;

  const length = Math.max(left.segments.length, right.segments.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left.segments[index] ?? 0;
    const rightSegment = right.segments[index] ?? 0;
    if (leftSegment < rightSegment) return -1;
    if (leftSegment > rightSegment) return 1;
  }

  return 0;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeCooldownHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_OPTIONAL_COOLDOWN_HOURS;
  }

  return Math.min(parsed, MAX_OPTIONAL_COOLDOWN_HOURS);
}

function normalizePolicy(data, platform, currentVersion) {
  if (data?.enabled !== true) return null;

  const platformPolicy = data?.[platform];
  if (!platformPolicy || typeof platformPolicy !== "object") return null;

  const latestVersion = normalizeString(platformPolicy.latestVersion);
  const minimumVersion = normalizeString(platformPolicy.minimumVersion);
  const storeUrl = normalizeString(platformPolicy.storeUrl);

  const currentToLatest = compareAppVersions(currentVersion, latestVersion);
  const currentToMinimum = compareAppVersions(currentVersion, minimumVersion);
  const minimumToLatest = compareAppVersions(minimumVersion, latestVersion);

  if (
    currentToLatest === null ||
    currentToMinimum === null ||
    minimumToLatest === null ||
    minimumToLatest > 0 ||
    !/^https:\/\//i.test(storeUrl)
  ) {
    return null;
  }

  const messages = data.messages || {};
  const common = {
    platform,
    currentVersion,
    latestVersion,
    minimumVersion,
    storeUrl,
  };

  if (currentToMinimum < 0) {
    return {
      ...common,
      type: "required",
      title: normalizeString(
        messages.requiredTitle,
        DEFAULT_MESSAGES.requiredTitle,
      ),
      message: normalizeString(
        messages.requiredMessage,
        DEFAULT_MESSAGES.requiredMessage,
      ),
    };
  }

  if (currentToLatest < 0) {
    return {
      ...common,
      type: "optional",
      title: normalizeString(
        messages.optionalTitle,
        DEFAULT_MESSAGES.optionalTitle,
      ),
      message: normalizeString(
        messages.optionalMessage,
        DEFAULT_MESSAGES.optionalMessage,
      ),
      cooldownHours: normalizeCooldownHours(data.optionalPromptCooldownHours),
    };
  }

  return null;
}

function getOptionalDismissalKey(policy) {
  return `${OPTIONAL_DISMISSAL_KEY_PREFIX}_${policy.platform}_${policy.latestVersion}`;
}

async function wasOptionalUpdateRecentlyDismissed(policy) {
  const rawTimestamp = await AsyncStorage.getItem(getOptionalDismissalKey(policy));
  if (!rawTimestamp) return false;

  const dismissedAt = Number(rawTimestamp);
  if (!Number.isFinite(dismissedAt)) return false;

  const cooldownMilliseconds = policy.cooldownHours * 60 * 60 * 1000;
  return Date.now() - dismissedAt < cooldownMilliseconds;
}

export async function fetchAppUpdatePolicy() {
  const platform = Platform.OS;
  if (!SUPPORTED_PLATFORMS.has(platform)) return null;

  const currentVersion = Application.nativeApplicationVersion;
  if (!parseVersion(currentVersion)) return null;

  const snapshot = await getDocFromServer(
    doc(db, VERSION_POLICY_COLLECTION, VERSION_POLICY_DOCUMENT),
  );
  if (!snapshot.exists()) return null;

  const policy = normalizePolicy(snapshot.data(), platform, currentVersion);
  if (!policy) return null;

  if (
    policy.type === "optional" &&
    (await wasOptionalUpdateRecentlyDismissed(policy))
  ) {
    return null;
  }

  return policy;
}

export async function dismissOptionalUpdate(policy) {
  if (policy?.type !== "optional") return;
  await AsyncStorage.setItem(getOptionalDismissalKey(policy), String(Date.now()));
}

export async function openAppStore(storeUrl) {
  await Linking.openURL(storeUrl);
}
