import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  collection,
  doc,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { measuredOnSnapshot } from "./firestoreSubscription";
import { auth, cloudFunctions, db, isCaptureEnvironment } from "../firebase";
import { normalizeNotificationPreferences } from "../notifications/notificationConfig";

const EAS_PROJECT_ID = "e741f7bd-7361-4112-aa43-06b192f2be13";
const DEVICE_ID_STORAGE_KEY = "smartbukatsu_notification_device_id";
const NOTIFICATION_CHANNEL_ID = "smartbukatsu-notifications";
const PUSH_REGISTRATION_STORAGE_KEY = "smartbukatsu_push_registration_v1";
const PUSH_OWNER_STORAGE_KEY = "smartbukatsu_push_owner_v1";
const PUSH_OWNER_PENDING_STORAGE_KEY = "smartbukatsu_push_owner_pending_v1";
const PUSH_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
let pushSession = null;
let pushWork = Promise.resolve();
let registrationCacheInvalid = false;
const pendingRegistrations = new Map();
let notificationPreparation = null;
let permissionRequest = null;

function enqueuePushWork(work) {
  const result = pushWork.then(work);
  pushWork = result.catch(() => {});
  return result;
}

async function clearPushRegistration() {
  registrationCacheInvalid = true;
  // Storage failures must never cause a successful registration to be assumed.
  try { await AsyncStorage.removeItem(PUSH_REGISTRATION_STORAGE_KEY); } catch {}
}

export function setPushRegistrationSession(uid) {
  const previous = pushSession;
  pushSession = { uid: uid || null, signingOut: false };
  if (!uid || (previous && previous.uid !== uid)) {
    enqueuePushWork(clearPushRegistration);
  }
}

function isCurrentPushSession(session) {
  return session && session === pushSession && !session.signingOut &&
    session.uid && auth.currentUser?.uid === session.uid;
}

function permissionFingerprint(permission) {
  return JSON.stringify({ status: permission.status,
    ios: permission.ios || null, android: permission.android || null });
}

function timestampToMillis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  return 0;
}

async function getDeviceId() {
  const stored = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (stored) return stored;
  const generated = `device_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
  return generated;
}

export function subscribeNotifications(uid, onValue, onError, count = 100) {
  if (!uid) return () => {};
  const notificationsQuery = query(
    collection(db, "users", uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(count),
  );
  return measuredOnSnapshot(
    "notifications",
    notificationsQuery,
    (snapshot) => {
      onValue(
        snapshot.docs
          .map((notificationDocument) => ({
            id: notificationDocument.id,
            ...notificationDocument.data(),
            createdAt: timestampToMillis(
              notificationDocument.data().createdAt,
            ),
            readAt: timestampToMillis(notificationDocument.data().readAt),
            dismissedAt: timestampToMillis(
              notificationDocument.data().dismissedAt,
            ),
          }))
          .filter((notification) => !notification.dismissedAt),
        snapshot.size === count,
      );
    },
    onError,
  );
}

export function subscribeNotificationSummary(uid, onValue, onError) {
  if (!uid) return () => {};
  return measuredOnSnapshot(
    "notificationSummary",
    doc(db, "users", uid, "notificationState", "summary"),
    (snapshot) => {
      const data = snapshot.data() || {};
      onValue({
        unreadTotal: Math.max(0, Number(data.unreadTotal) || 0),
        unreadByTeam: data.unreadByTeam || {},
        unreadBucketsVersion: data.unreadBucketsVersion,
        unreadBuckets: data.unreadBuckets || {},
      });
    },
    onError,
  );
}

export function ensureNotificationSummary(expectedUid = auth.currentUser?.uid) {
  if (!expectedUid || auth.currentUser?.uid !== expectedUid) {
    return Promise.reject(new Error("ログイン状態が変わりました。"));
  }
  const session = pushSession;
  if (notificationPreparation?.uid === expectedUid && notificationPreparation.session === session) {
    return notificationPreparation.promise;
  }
  const promise = (async () => {
    const initializePreferences = ["android", "ios"].includes(Platform.OS);
    const ensure = httpsCallable(cloudFunctions, "ensureNotificationSummary");
    const response = await ensure({ expectedUid, initializePreferences });
    if (auth.currentUser?.uid !== expectedUid || pushSession !== session) {
      throw new Error("ログイン状態が変わりました。");
    }
    if (initializePreferences && response.data?.preferencesInitialized !== true) {
      throw new Error("通知設定の準備を確認できませんでした。");
    }
  })();
  const entry = { uid: expectedUid, session, promise };
  notificationPreparation = entry;
  const cleanup = () => { if (notificationPreparation === entry) notificationPreparation = null; };
  promise.then(cleanup, cleanup);
  return promise;
}

export function subscribeNotificationPreferences(uid, onValue, onError) {
  if (!uid) return () => {};
  return measuredOnSnapshot(
    "notificationPreferences",
    doc(db, "users", uid, "notificationPreferences", "default"),
    (snapshot) => {
      // Missing/cache-only documents are not an explicit OFF choice. The
      // authenticated preparation transaction creates defaults before publishing.
      if (!snapshot.exists() && ["android", "ios"].includes(Platform.OS)) return;
      onValue(normalizeNotificationPreferences(snapshot.data() || {}));
    },
    onError,
  );
}

export async function configureAndroidNotificationChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
    name: "SMARTBUKATSU通知",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#0077cc",
    showBadge: true,
  });
}

export function registerPushToken({ requestPermission = false, requestPermissionIfUndetermined = false, devicePushToken,
  initializePreferencesEnabled = true } = {}) {
  if (isCaptureEnvironment) return Promise.resolve({ granted: false, reason: "capture-local-only" });
  if (!new Set(["android", "ios"]).has(Platform.OS)) {
    return Promise.resolve({ granted: false, reason: "unsupported" });
  }
  const session = pushSession;
  if (!isCurrentPushSession(session)) {
    return Promise.resolve({ granted: false, reason: "session-changed" });
  }
  // Token acquisition must not block logout when Expo is unreachable.
  // Coalesce equal triggers; serialize server registration with logout/cleanup.
  const key = JSON.stringify([requestPermission, requestPermissionIfUndetermined, devicePushToken?.type,
    devicePushToken?.data, initializePreferencesEnabled]);
  const pending = pendingRegistrations.get(key);
  if (pending?.session === session) return pending.promise;
  const promise = (async () => {
    if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
    await configureAndroidNotificationChannel();
    let permission = await Notifications.getPermissionsAsync();
    if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
    if (permission.status !== "granted" && (requestPermission ||
        (requestPermissionIfUndetermined && permission.status === "undetermined"))) {
      if (!permissionRequest) {
        permissionRequest = Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: true, allowSound: true },
        });
        const pendingPermission = permissionRequest;
        const cleanup = () => { if (permissionRequest === pendingPermission) permissionRequest = null; };
        pendingPermission.then(cleanup, cleanup);
      }
      permission = await permissionRequest;
    }
    if (permission.status !== "granted") {
      await enqueuePushWork(clearPushRegistration);
      return { granted: false, status: permission.status, reason: permission.status };
    }
    if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
    // Supplying the native token avoids recursively firing its change listener.
    const nativeToken = devicePushToken || await Notifications.getDevicePushTokenAsync();
    if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId: EAS_PROJECT_ID, devicePushToken: nativeToken,
    });
    return enqueuePushWork(async () => {
      if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
      const deviceId = await getDeviceId();
      let saved;
      try { saved = JSON.parse(await AsyncStorage.getItem(PUSH_REGISTRATION_STORAGE_KEY)); } catch {}
      const pendingOwner = await AsyncStorage.getItem(PUSH_OWNER_PENDING_STORAGE_KEY);
      if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
      const identity = { uid: session.uid, deviceId, token: tokenResult.data,
        nativeTokenKey: JSON.stringify([nativeToken.type, nativeToken.data]), platform: Platform.OS,
        permission: permissionFingerprint(permission) };
      const age = Date.now() - saved?.registeredAt;
      if (!pendingOwner && !registrationCacheInvalid && saved && Object.keys(identity).every((field) => identity[field] === saved[field]) &&
          age >= 0 && age < PUSH_REFRESH_INTERVAL_MS) {
        return { granted: true, status: permission.status, registered: false, nativeTokenKey: identity.nativeTokenKey,
          nextRefreshInMs: PUSH_REFRESH_INTERVAL_MS - age };
      }
      // Persist the attempted owner before the remote write. It also covers
      // termination after server success but before the success cache is saved.
      await AsyncStorage.setItem(PUSH_OWNER_PENDING_STORAGE_KEY, session.uid);
      await AsyncStorage.setItem(PUSH_OWNER_STORAGE_KEY, session.uid);
      if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
      const register = httpsCallable(cloudFunctions, "registerPushToken");
      const response = await register({ token: identity.token, deviceId,
        platform: Platform.OS, expectedUid: session.uid, initializePreferencesEnabled });
      if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
      if (response.data?.registered !== true) throw new Error("プッシュ通知の登録結果を確認できませんでした。");
      await AsyncStorage.removeItem(PUSH_OWNER_PENDING_STORAGE_KEY);
      try {
        await AsyncStorage.setItem(PUSH_REGISTRATION_STORAGE_KEY,
          JSON.stringify({ ...identity, registeredAt: Date.now() }));
        registrationCacheInvalid = false;
      } catch { /* Retry registration next time when persistence is unavailable. */ }
      if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
      return { granted: true, status: permission.status, registered: true, nativeTokenKey: identity.nativeTokenKey,
        nextRefreshInMs: PUSH_REFRESH_INTERVAL_MS };
    });
  })();
  const entry = { session, promise };
  pendingRegistrations.set(key, entry);
  const cleanup = () => { if (pendingRegistrations.get(key) === entry) pendingRegistrations.delete(key); };
  promise.then(cleanup, cleanup);
  return promise;
}

export async function ensurePushTokenOwnership() {
  if (isCaptureEnvironment) return { granted: false, reason: "capture-local-only" };
  const session = pushSession;
  if (!isCurrentPushSession(session) || !["android", "ios"].includes(Platform.OS)) {
    return { granted: false, reason: "unsupported" };
  }
  const [previousOwner, pendingOwner, saved] = await enqueuePushWork(() => Promise.all([
    AsyncStorage.getItem(PUSH_OWNER_STORAGE_KEY),
    AsyncStorage.getItem(PUSH_OWNER_PENDING_STORAGE_KEY),
    AsyncStorage.getItem(PUSH_REGISTRATION_STORAGE_KEY),
  ]));
  if (!isCurrentPushSession(session)) return { granted: false, reason: "session-changed" };
  let confirmed;
  try { confirmed = JSON.parse(saved); } catch {}
  if (pendingOwner || (previousOwner && (previousOwner !== session.uid ||
      registrationCacheInvalid || confirmed?.uid !== session.uid))) {
    // Claim a former account's lingering registration without opting this user in.
    return registerPushToken({ initializePreferencesEnabled: false });
  }
  return { status: await getNotificationPermissionStatus() };
}

export function unregisterPushTokenForCurrentDevice() {
  if (isCaptureEnvironment) return Promise.resolve();
  const uid = auth.currentUser?.uid;
  // Invalidate immediately, so no queued/in-flight registration can restore it.
  pushSession = { uid, signingOut: true };
  return enqueuePushWork(async () => {
    await clearPushRegistration();
    if (!uid || auth.currentUser?.uid !== uid ||
        !new Set(["android", "ios"]).has(Platform.OS)) return;
    const previousOwner = await AsyncStorage.getItem(PUSH_OWNER_STORAGE_KEY);
    const pendingOwner = await AsyncStorage.getItem(PUSH_OWNER_PENDING_STORAGE_KEY);
    // An unconfirmed claim may still belong to a former account remotely.
    // Unregistering the current account cannot prove that former token is gone.
    const needsRecovery = Boolean(pendingOwner || (previousOwner && previousOwner !== uid));
    await AsyncStorage.setItem(PUSH_OWNER_PENDING_STORAGE_KEY, pendingOwner || previousOwner || uid);
    if (!previousOwner) await AsyncStorage.setItem(PUSH_OWNER_STORAGE_KEY, uid);
    const deviceId = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (!deviceId || auth.currentUser?.uid !== uid) return;
    const unregister = httpsCallable(cloudFunctions, "unregisterPushToken");
    await unregister({ deviceId, expectedUid: uid });
    if (!needsRecovery) {
      await AsyncStorage.removeItem(PUSH_OWNER_STORAGE_KEY);
      await AsyncStorage.removeItem(PUSH_OWNER_PENDING_STORAGE_KEY);
    }
  });
}

export async function saveNotificationPreferences(preferences) {
  const updatePreferences = httpsCallable(
    cloudFunctions,
    "updateNotificationPreferences",
  );
  const normalized = normalizeNotificationPreferences(preferences);
  const response = await updatePreferences({ preferences: normalized });
  return normalizeNotificationPreferences(response.data?.preferences || normalized);
}

export async function markNotificationRead(notificationId) {
  const markRead = httpsCallable(cloudFunctions, "markNotificationRead");
  await markRead({ notificationId });
}

export async function dismissNotification(notificationId) {
  const dismiss = httpsCallable(cloudFunctions, "dismissNotification");
  await dismiss({ notificationId });
}

export async function getNotificationPermissionStatus() {
  if (!new Set(["android", "ios"]).has(Platform.OS)) return "unsupported";
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted") await enqueuePushWork(clearPushRegistration);
  return permission.status;
}

export async function setApplicationBadge(count) {
  if (!new Set(["android", "ios"]).has(Platform.OS)) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Number(count) || 0));
  } catch (error) {
    console.log("通知バッジ更新エラー:", error?.message);
  }
}

export { Notifications };
