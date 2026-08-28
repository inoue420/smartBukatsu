import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { cloudFunctions, db } from "../firebase";
import { normalizeNotificationPreferences } from "../notifications/notificationConfig";

const EAS_PROJECT_ID = "e741f7bd-7361-4112-aa43-06b192f2be13";
const DEVICE_ID_STORAGE_KEY = "smartbukatsu_notification_device_id";
const NOTIFICATION_CHANNEL_ID = "smartbukatsu-notifications";

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

export function subscribeNotifications(uid, onValue, onError) {
  if (!uid) return () => {};
  const notificationsQuery = query(
    collection(db, "users", uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(100),
  );
  return onSnapshot(
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
      );
    },
    onError,
  );
}

export function subscribeNotificationSummary(uid, onValue, onError) {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, "users", uid, "notificationState", "summary"),
    (snapshot) => {
      const data = snapshot.data() || {};
      onValue({
        unreadTotal: Math.max(0, Number(data.unreadTotal) || 0),
        unreadByTeam: data.unreadByTeam || {},
      });
    },
    onError,
  );
}

export function subscribeNotificationPreferences(uid, onValue, onError) {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, "users", uid, "notificationPreferences", "default"),
    (snapshot) => {
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

export async function registerPushToken({ requestPermission = false } = {}) {
  if (!new Set(["android", "ios"]).has(Platform.OS)) {
    return { granted: false, reason: "unsupported" };
  }
  await configureAndroidNotificationChannel();
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== "granted" && requestPermission) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  }
  if (permission.status !== "granted") {
    return { granted: false, reason: permission.status };
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync({
    projectId: EAS_PROJECT_ID,
  });
  const deviceId = await getDeviceId();
  const register = httpsCallable(cloudFunctions, "registerPushToken");
  await register({
    token: tokenResult.data,
    deviceId,
    platform: Platform.OS,
  });
  return { granted: true, status: permission.status };
}

export async function unregisterPushTokenForCurrentDevice() {
  if (!new Set(["android", "ios"]).has(Platform.OS)) return;
  const deviceId = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!deviceId) return;
  const unregister = httpsCallable(cloudFunctions, "unregisterPushToken");
  await unregister({ deviceId });
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
