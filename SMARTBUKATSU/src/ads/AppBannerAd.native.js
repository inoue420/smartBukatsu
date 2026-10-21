import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  AdsConsent,
  BannerAd,
  BannerAdSize,
} from "react-native-google-mobile-ads";

import { logAdFailure, useAds } from "./AdManager";
import { NON_PERSONALIZED_AD_REQUEST_OPTIONS } from "./adSettings";

const RECOVERY_COOLDOWN_MS = 30000;

const AppBannerAd = () => {
  const { adsInitialized, bannerAdUnitId, recordDiagnostic } = useAds();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(() => Keyboard.isVisible());
  const bannerRef = useRef(null);
  const lifecycleRef = useRef(null);
  const attachBanner = useCallback((banner) => {
    bannerRef.current = banner;
    lifecycleRef.current?.attach(banner);
  }, []);

  useEffect(() => {
    let disposed = false;
    let appState = AppState.currentState;
    let backgrounded = appState === "background";
    let keyboardVisible = Keyboard.isVisible();
    let keyboardTransitioning = false;
    let online = null;
    let pending = false;
    let loading = Boolean(bannerRef.current);
    let failed = false;
    let checkingConsent = false;
    let generation = 0;
    let lastActivity = Date.now();
    let recoveryTimer = null;

    const cancelTimer = () => {
      if (recoveryTimer !== null) clearTimeout(recoveryTimer);
      recoveryTimer = null;
    };
    const canRecover = () => !disposed && Platform.OS === "ios" &&
      adsInitialized && bannerAdUnitId && pending && appState === "active" &&
      !keyboardVisible && online !== false && bannerRef.current && !loading;

    const recover = async () => {
      cancelTimer();
      if (!canRecover() || checkingConsent) return;
      const remaining = RECOVERY_COOLDOWN_MS - (Date.now() - lastActivity);
      if (remaining > 0) {
        // One deferred lifecycle recovery, never a periodic refresh loop.
        recoveryTimer = setTimeout(() => { void recover(); }, remaining);
        return;
      }

      const banner = bannerRef.current;
      const currentGeneration = generation;
      checkingConsent = true;
      let requestStarted = false;
      try {
        const consent = await AdsConsent.getConsentInfo();
        if (disposed || generation !== currentGeneration) return;
        if (!consent?.canRequestAds) {
          pending = false;
          recordDiagnostic("consent-blocked");
          return;
        }
        if (!canRecover() || bannerRef.current !== banner) return;
        // An SDK refresh may have finished while consent was being checked.
        if (Date.now() - lastActivity < RECOVERY_COOLDOWN_MS) return;
        pending = false;
        failed = false;
        loading = true;
        lastActivity = Date.now();
        recordDiagnostic("consent-allowed");
        recordDiagnostic("banner-loading");
        requestStarted = true;
        banner.load();
      } catch (error) {
        if (disposed || generation !== currentGeneration) return;
        pending = false;
        loading = false;
        failed = true;
        lastActivity = Date.now();
        logAdFailure("banner-recovery", error);
        recordDiagnostic(requestStarted ? "banner-error" : "consent-cache-error", error);
      } finally {
        if (generation === currentGeneration) {
          checkingConsent = false;
          // Preserve recovery if a native error changed the cooldown while awaiting consent.
          if (pending) void recover();
        }
      }
    };

    lifecycleRef.current = {
      attach(banner) {
        // A keyboard-driven remount already starts its own native ad request.
        generation += 1;
        checkingConsent = false;
        pending = false;
        loading = Boolean(banner);
        failed = false;
        lastActivity = Date.now();
        cancelTimer();
      },
      loaded() {
        loading = false;
        failed = false;
        pending = false;
        lastActivity = Date.now();
        cancelTimer();
      },
      failed() {
        loading = false;
        failed = true;
        lastActivity = Date.now();
        void recover();
      },
    };

    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const updateKeyboard = (visible, transitioning = false) => {
      keyboardVisible = visible;
      keyboardTransitioning = transitioning;
      if (visible) cancelTimer();
      setIsKeyboardVisible(visible);
    };
    const showSubscription = Keyboard.addListener(showEvent, () =>
      updateKeyboard(true, Platform.OS === "ios"));
    const hideSubscription = Keyboard.addListener(hideEvent, () =>
      updateKeyboard(false, Platform.OS === "ios"));
    const keyboardCompletionSubscriptions = Platform.OS === "ios" ? [
      Keyboard.addListener("keyboardDidShow", () => updateKeyboard(true)),
      Keyboard.addListener("keyboardDidHide", () => updateKeyboard(false)),
    ] : [];

    const appSubscription = Platform.OS === "ios" ? AppState.addEventListener("change", (nextState) => {
      appState = nextState;
      if (nextState !== "active") {
        if (nextState === "background") backgrounded = true;
        generation += 1;
        checkingConsent = false;
        cancelTimer();
        return;
      }
      // isVisible still describes the previous state between Will and Did events.
      if (!keyboardTransitioning) keyboardVisible = Keyboard.isVisible();
      setIsKeyboardVisible(keyboardVisible);
      if (backgrounded) {
        pending = true;
        if (adsInitialized && bannerAdUnitId) {
          // iOS can miss network-change events while the app is suspended.
          const currentGeneration = generation;
          void NetInfo.refresh().catch((error) => {
            if (!disposed && generation === currentGeneration) {
              logAdFailure("banner-network-state", error);
            }
          });
        }
      }
      backgrounded = false;
      void recover();
    }) : null;
    const unsubscribeNetwork = Platform.OS === "ios" && adsInitialized && bannerAdUnitId
      ? NetInfo.addEventListener((state) => {
          if (disposed) return;
          const wasOffline = online === false;
          online = state.isConnected === false || state.isInternetReachable === false
            ? false : state.isConnected === true ? true : null;
          if (online === false) cancelTimer();
          if (wasOffline && online === true && (failed || pending)) {
            pending = true;
            void recover();
          }
        })
      : null;

    return () => {
      disposed = true;
      lifecycleRef.current = null;
      cancelTimer();
      showSubscription.remove();
      hideSubscription.remove();
      keyboardCompletionSubscriptions.forEach((subscription) => subscription.remove());
      appSubscription?.remove();
      unsubscribeNetwork?.();
    };
  }, [adsInitialized, bannerAdUnitId, recordDiagnostic]);

  useEffect(() => {
    if (!adsInitialized || !bannerAdUnitId) return;
    recordDiagnostic(
      isKeyboardVisible ? "banner-keyboard-hidden" : "banner-loading",
    );
  }, [adsInitialized, bannerAdUnitId, isKeyboardVisible, recordDiagnostic]);

  if (!adsInitialized || !bannerAdUnitId || isKeyboardVisible) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "position" : undefined}
    >
    <SafeAreaView
      style={styles.safeArea}
      edges={Platform.OS === "ios" ? ["right", "bottom", "left"] : []}
    >
      <View style={styles.container}>
        <BannerAd
          ref={attachBanner}
          unitId={bannerAdUnitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={NON_PERSONALIZED_AD_REQUEST_OPTIONS}
          onAdLoaded={() => {
            lifecycleRef.current?.loaded();
            recordDiagnostic("banner-loaded");
          }}
          onAdFailedToLoad={(error) => {
            lifecycleRef.current?.failed();
            logAdFailure("banner-load", error);
            recordDiagnostic("banner-error", error);
          }}
        />
      </View>
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#f0f2f5",
    borderTopColor: "#d9dde3",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  container: {
    alignItems: "center",
    paddingTop: 6,
  },
});

export default AppBannerAd;
