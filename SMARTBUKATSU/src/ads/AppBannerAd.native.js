import React, { useEffect, useState } from "react";
import { Keyboard, SafeAreaView, StyleSheet, View } from "react-native";
import {
  BannerAd,
  BannerAdSize,
} from "react-native-google-mobile-ads";

import { useAds } from "./AdManager";

const AppBannerAd = () => {
  const { adsInitialized, bannerAdUnitId } = useAds();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  if (!adsInitialized || !bannerAdUnitId || keyboardVisible) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
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
