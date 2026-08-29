import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  dismissOptionalUpdate,
  fetchAppUpdatePolicy,
  openAppStore,
} from "../services/appUpdateService";

export default function AppUpdateGate() {
  const [policy, setPolicy] = useState(null);
  const [isOpeningStore, setIsOpeningStore] = useState(false);
  const policyRef = useRef(null);
  const isCheckingRef = useRef(false);
  const isMountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);

  const updatePolicy = useCallback((nextPolicy) => {
    policyRef.current = nextPolicy;
    if (isMountedRef.current) setPolicy(nextPolicy);
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (isCheckingRef.current) return;

    isCheckingRef.current = true;
    try {
      const nextPolicy = await fetchAppUpdatePolicy();
      updatePolicy(nextPolicy);
    } catch (error) {
      console.warn("アプリ更新設定を取得できませんでした。", error?.message || error);
    } finally {
      isCheckingRef.current = false;
    }
  }, [updatePolicy]);

  useEffect(() => {
    isMountedRef.current = true;
    checkForUpdate();

    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (previousState !== "active" && nextState === "active") {
        checkForUpdate();
      }
    });

    return () => {
      isMountedRef.current = false;
      subscription.remove();
    };
  }, [checkForUpdate]);

  const handleLater = useCallback(async () => {
    if (policyRef.current?.type !== "optional") return;

    const currentPolicy = policyRef.current;
    updatePolicy(null);
    try {
      await dismissOptionalUpdate(currentPolicy);
    } catch (error) {
      console.warn("更新案内の再表示時刻を保存できませんでした。", error?.message || error);
    }
  }, [updatePolicy]);

  const handleOpenStore = useCallback(async () => {
    const currentPolicy = policyRef.current;
    if (!currentPolicy || isOpeningStore) return;

    setIsOpeningStore(true);
    try {
      await openAppStore(currentPolicy.storeUrl);
    } catch (error) {
      Alert.alert(
        "ストアを開けませんでした",
        "通信状態を確認して、もう一度お試しください。",
      );
    } finally {
      if (isMountedRef.current) setIsOpeningStore(false);
    }
  }, [isOpeningStore]);

  if (!policy) return null;

  const isRequired = policy.type === "required";

  return (
    <Modal
      animationType="fade"
      transparent
      visible
      statusBarTranslucent
      onRequestClose={isRequired ? () => {} : handleLater}
    >
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>
            {policy.title}
          </Text>
          <Text style={styles.message}>{policy.message}</Text>
          <View style={styles.versionBox}>
            <Text style={styles.versionText}>現在：{policy.currentVersion}</Text>
            <Text style={styles.versionText}>最新：{policy.latestVersion}</Text>
          </View>

          <View style={styles.actions}>
            {!isRequired && (
              <Pressable
                accessibilityRole="button"
                disabled={isOpeningStore}
                onPress={handleLater}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondaryButton,
                  pressed && styles.pressedButton,
                ]}
              >
                <Text style={styles.secondaryButtonText}>後で</Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              disabled={isOpeningStore}
              onPress={handleOpenStore}
              style={({ pressed }) => [
                styles.button,
                styles.primaryButton,
                isRequired && styles.fullWidthButton,
                pressed && styles.pressedButton,
              ]}
            >
              {isOpeningStore ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>アップデート</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
  },
  dialog: {
    width: "100%",
    maxWidth: 420,
    padding: 24,
    borderRadius: 18,
    backgroundColor: "#ffffff",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  title: {
    color: "#1b1b1b",
    fontSize: 21,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    marginTop: 14,
    color: "#444444",
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  versionBox: {
    marginTop: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#f3f6f8",
  },
  versionText: {
    color: "#4d5961",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 22,
  },
  button: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  primaryButton: {
    backgroundColor: "#0077cc",
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#b8c3ca",
    backgroundColor: "#ffffff",
  },
  fullWidthButton: {
    flex: 1,
  },
  pressedButton: {
    opacity: 0.72,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButtonText: {
    color: "#35434c",
    fontSize: 15,
    fontWeight: "600",
  },
});
