import React, { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  BannerAd,
  BannerAdSize,
} from "react-native-google-mobile-ads";

import { useAds } from "./AdManager";

const BANNER_INPUT_GAP = 16;

const AppBannerAd = () => {
  const { adsInitialized, bannerAdUnitId } = useAds();
  const bannerContainerRef = useRef(null);
  const [focusedInputOffset, setFocusedInputOffset] = useState(0);

  useEffect(() => {
    let measurementFrame = null;

    const updateFocusedInputOffset = () => {
      const focusedInput = TextInput.State.currentlyFocusedInput();
      const bannerContainer = bannerContainerRef.current;

      if (
        !focusedInput?.measureInWindow ||
        !bannerContainer?.measureInWindow
      ) {
        setFocusedInputOffset(0);
        return;
      }

      if (measurementFrame !== null) {
        cancelAnimationFrame(measurementFrame);
      }

      measurementFrame = requestAnimationFrame(() => {
        focusedInput.measureInWindow((_x, inputTop) => {
          bannerContainer.measureInWindow(
            (_bannerX, bannerTop, _bannerWidth, bannerHeight) => {
              const bannerBottom = bannerTop + bannerHeight;
              const measuredOffset =
                bannerBottom - inputTop + BANNER_INPUT_GAP;

              setFocusedInputOffset(Math.max(0, measuredOffset));
            },
          );
        });
      });
    };

    const showSubscription = Keyboard.addListener(
      "keyboardDidShow",
      updateFocusedInputOffset,
    );
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setFocusedInputOffset(0);
    });

    return () => {
      if (measurementFrame !== null) {
        cancelAnimationFrame(measurementFrame);
      }
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (!adsInitialized || !bannerAdUnitId) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "position" : undefined}
      style={
        focusedInputOffset > 0
          ? { transform: [{ translateY: -focusedInputOffset }] }
          : undefined
      }
    >
    <SafeAreaView style={styles.safeArea}>
      <View ref={bannerContainerRef} style={styles.container}>
        <BannerAd
          unitId={bannerAdUnitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          onAdFailedToLoad={(error) => {
            if (__DEV__) {
              console.warn("バナー広告を読み込めませんでした。", error);
            }
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
