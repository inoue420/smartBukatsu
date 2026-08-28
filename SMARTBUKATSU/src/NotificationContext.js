import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";
import {
  Notifications,
  dismissNotification as dismissNotificationRemote,
  getNotificationPermissionStatus,
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
  const [summary, setSummary] = useState({
    unreadTotal: 0,
    unreadByTeam: {},
  });
  const [preferences, setPreferences] = useState(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [permissionStatus, setPermissionStatus] = useState("undetermined");
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const navigationHandlerRef = useRef(null);
  const pendingNotificationRef = useRef(null);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }, []);

  useEffect(() => {
    getNotificationPermissionStatus()
      .then(setPermissionStatus)
      .catch(() => setPermissionStatus("undetermined"));
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setNotifications([]);
      setSummary({ unreadTotal: 0, unreadByTeam: {} });
      setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      return undefined;
    }

    const handleSubscriptionError = (label) => (error) => {
      if (error?.code !== "permission-denied") {
        console.log(`${label}購読エラー:`, error?.message);
      }
    };
    const unsubscribeNotifications = subscribeNotifications(
      user.uid,
      setNotifications,
      handleSubscriptionError("通知"),
    );
    const unsubscribeSummary = subscribeNotificationSummary(
      user.uid,
      setSummary,
      handleSubscriptionError("通知集計"),
    );
    const unsubscribePreferences = subscribeNotificationPreferences(
      user.uid,
      setPreferences,
      handleSubscriptionError("通知設定"),
    );
    return () => {
      unsubscribeNotifications();
      unsubscribeSummary();
      unsubscribePreferences();
    };
  }, [user?.uid]);

  useEffect(() => {
    setApplicationBadge(summary.unreadTotal);
  }, [summary.unreadTotal]);

  useEffect(() => {
    if (!user?.uid || !preferences.masterEnabled) return;
    registerPushToken({ requestPermission: false })
      .then((result) => {
        if (result?.status) setPermissionStatus(result.status);
      })
      .catch((error) => {
        console.log("プッシュトークン更新エラー:", error?.message);
      });
  }, [preferences.masterEnabled, user?.uid]);

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
    try {
      const normalized = normalizeNotificationPreferences(nextPreferences);
      setPreferences(normalized);
      const saved = await saveNotificationPreferences(normalized);
      setPreferences(saved);
      return saved;
    } finally {
      setIsSavingPreferences(false);
    }
  }, []);

  const enablePushNotifications = useCallback(async () => {
    setIsSavingPreferences(true);
    try {
      const result = await registerPushToken({ requestPermission: true });
      setPermissionStatus(result?.status || result?.reason || "undetermined");
      if (!result?.granted) return result;
      const saved = await saveNotificationPreferences({
        ...preferences,
        masterEnabled: true,
      });
      setPreferences(saved);
      return result;
    } finally {
      setIsSavingPreferences(false);
    }
  }, [preferences]);

  const dismissNotification = useCallback(async (notificationId) => {
    await dismissNotificationRemote(notificationId);
  }, []);

  const value = useMemo(
    () => ({
      notifications,
      unreadTotal: summary.unreadTotal,
      unreadByTeam: summary.unreadByTeam,
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
      notifications,
      summary,
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
