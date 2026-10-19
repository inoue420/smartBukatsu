import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { useAuth } from "./AuthContext";
import {
  Notifications,
  dismissNotification as dismissNotificationRemote,
  ensureNotificationSummary,
  ensurePushTokenOwnership,
  markNotificationRead,
  registerPushToken,
  saveNotificationPreferences,
  setApplicationBadge,
  subscribeNotificationPreferences,
  subscribeNotificationSummary,
  subscribeNotifications,
} from "./services/notificationService";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
  isNotificationVisible,
  getVisibleUnreadSummary,
} from "./notifications/notificationConfig";

const NotificationContext = createContext(null);

function getPushNotificationTarget(data = {}) {
  let params = {};
  if (typeof data.targetParams === "string") {
    try {
      params = JSON.parse(data.targetParams);
    } catch {
      params = {};
    }
  }
  return {
    id: data.notificationId || "",
    teamId: data.teamId || "",
    category: data.category || "system",
    target: {
      screen: data.screen || "WorkspaceHome",
      params,
    },
  };
}

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [notificationListLoading, setNotificationListLoading] = useState(false);
  const [notificationListError, setNotificationListError] = useState("");
  const [notificationListHasMore, setNotificationListHasMore] = useState(false);
  const [notificationSummaryError, setNotificationSummaryError] = useState("");
  const [summary, setSummary] = useState({
    unreadTotal: 0,
    unreadByTeam: {},
  });
  const [preferences, setPreferences] = useState(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [permissionStatus, setPermissionStatus] = useState("undetermined");
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [preferencesUser, setPreferencesUser] = useState(null);
  const pushEnableResultRef = useRef(null);
  const currentUserRef = useRef(user);
  currentUserRef.current = user;
  const navigationHandlerRef = useRef(null);
  const pendingNotificationRef = useRef(null);
  const summaryRetryRef = useRef(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const sessionUidRef = useRef(user?.uid);
  sessionUidRef.current = user?.uid;
  const visibleNotifications = useMemo(
    () => notifications.filter((notification) => isNotificationVisible(preferences, notification)),
    [notifications, preferences],
  );
  const visibleSummary = useMemo(
    () => getVisibleUnreadSummary(summary, preferences),
    [summary, preferences],
  );
  const refreshNotificationSummary = useCallback(async (resubscribe = true) => {
    const uid = user?.uid;
    if (!uid) return;
    if (resubscribe) summaryRetryRef.current?.();
    try {
      await ensureNotificationSummary();
      if (sessionUidRef.current === uid) setNotificationSummaryError("");
    } catch {
      if (sessionUidRef.current === uid) {
        setNotificationSummaryError("通知の未読件数を更新できませんでした。タップして再試行");
      }
    }
  }, [user?.uid]);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const visible = isNotificationVisible(
          preferencesRef.current,
          notification.request.content.data,
        );
        return {
          shouldPlaySound: visible,
          shouldSetBadge: visible,
          shouldShowBanner: visible,
          shouldShowList: visible,
        };
      },
    });
  }, []);

  useEffect(() => {
    pushEnableResultRef.current = null;
    setIsSavingPreferences(false);
    if (!user?.uid) {
      setPreferencesUser(null);
      setNotifications([]);
      setSummary({ unreadTotal: 0, unreadByTeam: {} });
      setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      setNotificationSummaryError("");
      return undefined;
    }

    const handleSubscriptionError = (label) => (error) => {
      if (error?.code !== "permission-denied") {
        console.log(`${label}購読エラー:`, error?.message);
      }
    };
    let active = true;
    setNotifications([]); setNotificationListHasMore(false);
    setSummary({ unreadTotal: 0, unreadByTeam: {} });
    setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
    setPreferencesUser(null);
    setNotificationSummaryError("");
    let unsubscribeSummary = () => {};
    let summaryGeneration = 0;
    const restartSummary = () => {
      const generation = ++summaryGeneration;
      unsubscribeSummary();
      unsubscribeSummary = subscribeNotificationSummary(
        user.uid,
        (value) => {
          if (!active || generation !== summaryGeneration) return;
          setSummary(value);
          if (value.unreadBucketsVersion === 1) setNotificationSummaryError("");
        },
        (error) => {
          if (!active || generation !== summaryGeneration) return;
          handleSubscriptionError("通知集計")(error);
          setNotificationSummaryError("通知の未読件数を更新できませんでした。タップして再試行");
        },
      );
    };
    restartSummary();
    summaryRetryRef.current = restartSummary;
    const unsubscribePreferences = subscribeNotificationPreferences(
      user.uid,
      (value) => { if (active) { setPreferences(value); setPreferencesUser(user); } },
      handleSubscriptionError("通知設定"),
    );
    refreshNotificationSummary(false);
    return () => {
      active = false;
      if (summaryRetryRef.current === restartSummary) summaryRetryRef.current = null;
      unsubscribeSummary();
      unsubscribePreferences();
    };
  }, [user, refreshNotificationSummary]);
  const startNotificationList = useCallback((count = 100) => {
    if (!user?.uid || !preferences.masterEnabled) return () => {};
    let active = true;
    setNotificationListLoading(true); setNotificationListError("");
    const stop = subscribeNotifications(user.uid, (items, hasMore) => {
      if (!active) return;
      setNotifications(items); setNotificationListHasMore(hasMore); setNotificationListLoading(false);
    }, () => {
      if (active) { setNotificationListError("通知を読み込めませんでした。通信状態とログイン状態を確認してください。"); setNotificationListLoading(false); }
    }, count);
    return () => { active = false; stop(); setNotifications([]); setNotificationListLoading(false); };
  }, [user?.uid, preferences.masterEnabled]);

  useEffect(() => {
    setApplicationBadge(visibleSummary.unreadTotal);
  }, [visibleSummary.unreadTotal]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || preferencesUser !== user) return undefined;
    let active = true, timer, checking = false, pendingNativeToken;
    let retries = 0;
    const enabled = preferences.masterEnabled;
    const foreground = () => !["background", "inactive"].includes(AppState.currentState);
    const schedule = (milliseconds) => {
      clearTimeout(timer);
      if (active && foreground()) timer = setTimeout(() => refresh(), milliseconds);
    };
    const refresh = async (devicePushToken) => {
      if (!active || !foreground()) return;
      if (checking) { if (devicePushToken) pendingNativeToken = devicePushToken; return; }
      checking = true;
      clearTimeout(timer);
      try {
        const result = enabled
          ? await registerPushToken({ requestPermission: false, devicePushToken })
          : await ensurePushTokenOwnership();
        if (!active || sessionUidRef.current !== uid) return;
        // Reading the native token can emit its existing value. Do not treat
        // that event as a second change after this registration completes.
        if (pendingNativeToken && JSON.stringify([pendingNativeToken.type, pendingNativeToken.data]) === result.nativeTokenKey) {
          pendingNativeToken = null;
        }
        setPermissionStatus(result.status || result.reason || "undetermined");
        retries = 0;
        if (enabled && result.granted && result.nextRefreshInMs) schedule(result.nextRefreshInMs);
      } catch {
        if (active && sessionUidRef.current === uid) {
          console.log("プッシュトークン更新に失敗しました。通信復旧後に再試行します。");
          if (retries < 3) schedule([30000, 120000, 600000][retries++]);
        }
      } finally {
        checking = false;
        if (pendingNativeToken && active) {
          const token = pendingNativeToken;
          pendingNativeToken = null;
          refresh(token);
        }
      }
    };
    const enabledResult = pushEnableResultRef.current;
    if (enabled && enabledResult?.user === user) {
      pushEnableResultRef.current = null;
      setPermissionStatus(enabledResult.result.status);
      schedule(enabledResult.result.nextRefreshInMs || 24 * 60 * 60 * 1000);
    } else {
      refresh();
    }
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") { retries = 0; refresh(); }
      else clearTimeout(timer);
    });
    let connected;
    const unsubscribeNetwork = NetInfo.addEventListener((state) => {
      const next = state.isConnected === true && state.isInternetReachable !== false;
      if (next && connected === false) { retries = 0; refresh(); }
      connected = next;
    });
    const tokenSubscription = enabled && ["android", "ios"].includes(Platform.OS)
      ? Notifications.addPushTokenListener((token) => refresh(token)) : null;
    return () => {
      active = false;
      clearTimeout(timer);
      appStateSubscription.remove();
      unsubscribeNetwork();
      tokenSubscription?.remove();
    };
  }, [preferences.masterEnabled, preferencesUser, user]);

  const dispatchNotification = useCallback((notification) => {
    if (navigationHandlerRef.current) {
      navigationHandlerRef.current(notification);
    } else {
      pendingNotificationRef.current = notification;
    }
  }, []);

  const openNotification = useCallback(
    async (notification) => {
      if (!notification) return;
      if (notification.id && !notification.readAt) {
        try {
          await markNotificationRead(notification.id);
        } catch (error) {
          console.log("通知既読エラー:", error?.message);
        }
      }
      dispatchNotification(notification);
    },
    [dispatchNotification],
  );

  useEffect(() => {
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        openNotification(
          getPushNotificationTarget(response.notification.request.content.data),
        );
      });
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) {
          openNotification(
            getPushNotificationTarget(response.notification.request.content.data),
          );
        }
      })
      .catch(() => {});
    return () => responseSubscription.remove();
  }, [openNotification]);

  const setNavigationHandler = useCallback((handler) => {
    navigationHandlerRef.current = handler;
    if (handler && pendingNotificationRef.current) {
      const pending = pendingNotificationRef.current;
      pendingNotificationRef.current = null;
      handler(pending);
    }
    return () => {
      if (navigationHandlerRef.current === handler) {
        navigationHandlerRef.current = null;
      }
    };
  }, []);

  const updatePreferences = useCallback(async (nextPreferences) => {
    setIsSavingPreferences(true);
    const previous = preferencesRef.current;
    const uid = sessionUidRef.current;
    try {
      const normalized = normalizeNotificationPreferences(nextPreferences);
      setPreferences(normalized);
      const saved = await saveNotificationPreferences(normalized);
      if (sessionUidRef.current === uid) setPreferences(saved);
      return saved;
    } catch (error) {
      if (sessionUidRef.current === uid) setPreferences(previous);
      throw error;
    } finally {
      setIsSavingPreferences(false);
    }
  }, []);

  const enablePushNotifications = useCallback(async () => {
    setIsSavingPreferences(true);
    try {
      const result = await registerPushToken({ requestPermission: true });
      if (currentUserRef.current !== user) return result;
      setPermissionStatus(result?.status || result?.reason || "undetermined");
      if (!result?.granted) return result;
      pushEnableResultRef.current = { user, result };
      const saved = await saveNotificationPreferences({
        ...preferences,
        masterEnabled: true,
      });
      if (currentUserRef.current === user) setPreferences(saved);
      return result;
    } catch (error) {
      if (pushEnableResultRef.current?.user === user) pushEnableResultRef.current = null;
      throw error;
    } finally {
      if (currentUserRef.current === user) setIsSavingPreferences(false);
    }
  }, [preferences, user]);

  const dismissNotification = useCallback(async (notificationId) => {
    await dismissNotificationRemote(notificationId);
  }, []);

  const value = useMemo(
    () => ({
      notifications: visibleNotifications,
      startNotificationList,
      notificationListLoading,
      notificationListError,
      notificationListHasMore: preferences.masterEnabled && notificationListHasMore,
      notificationSummaryError,
      refreshNotificationSummary,
      unreadTotal: visibleSummary.unreadTotal,
      unreadByTeam: visibleSummary.unreadByTeam,
      preferences,
      permissionStatus,
      isSavingPreferences,
      openNotification,
      dismissNotification,
      updatePreferences,
      enablePushNotifications,
      setNavigationHandler,
    }),
    [
      visibleNotifications,
      startNotificationList,
      notificationListLoading,
      notificationListError,
      notificationListHasMore,
      visibleSummary,
      notificationSummaryError,
      refreshNotificationSummary,
      preferences,
      permissionStatus,
      isSavingPreferences,
      openNotification,
      dismissNotification,
      updatePreferences,
      enablePushNotifications,
      setNavigationHandler,
    ],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationProvider");
  }
  return context;
}
