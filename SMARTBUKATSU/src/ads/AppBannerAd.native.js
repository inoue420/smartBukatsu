import React, { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  View,
} from "react-native";
import {
  BannerAd,
  BannerAdSize,
} from "react-native-google-mobile-ads";

import { logAdFailure, useAds } from "./AdManager";
import { NON_PERSONALIZED_AD_REQUEST_OPTIONS } from "./adSettings";

const AppBannerAd = () => {
  const { adsInitialized, bannerAdUnitId, recordDiagnostic } = useAds();
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => {
      setIsKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

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
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <BannerAd
          unitId={bannerAdUnitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={NON_PERSONALIZED_AD_REQUEST_OPTIONS}
          onAdLoaded={() => recordDiagnostic("banner-loaded")}
          onAdFailedToLoad={(error) => {
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
