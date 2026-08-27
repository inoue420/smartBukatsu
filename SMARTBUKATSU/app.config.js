// app.config.js（CJS版・.env.local対応）
const path = require("path");
const dotenvFlow = require("dotenv-flow");
const dotenvExpand = require("dotenv-expand");
const appJson = require("./app.json");

const ADMOB_SAMPLE_ANDROID_APP_ID =
  "ca-app-pub-3940256099942544~3347511713";
const ADMOB_SAMPLE_IOS_APP_ID =
  "ca-app-pub-3940256099942544~1458002511";
const CONSENT_SDK_PROGUARD_RULE =
  "-keep class com.google.android.gms.internal.consent_sdk.** { *; }";

dotenvExpand.expand(
  dotenvFlow.config({
    path: path.resolve(__dirname),
    default_node_env: "development",
  })
);

module.exports = ({ config }) => {
  const androidMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const iosMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  const locationPermissionMessage =
    "場所検索とピン調整のために位置情報の利用を許可してください。";
  const expoPlugins = [...(appJson.expo.plugins || [])];
  const appVariant = process.env.APP_VARIANT || "production";
  const isDevelopmentBuild = appVariant === "development";
  const isProductionBuild = appVariant === "production";
  const androidAdMobAppId =
    process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ||
    (!isProductionBuild ? ADMOB_SAMPLE_ANDROID_APP_ID : null);
  const iosAdMobAppId =
    process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID ||
    (!isProductionBuild ? ADMOB_SAMPLE_IOS_APP_ID : null);

  if (!androidAdMobAppId || !iosAdMobAppId) {
    throw new Error(
      "Production builds require EXPO_PUBLIC_ADMOB_ANDROID_APP_ID and EXPO_PUBLIC_ADMOB_IOS_APP_ID.",
    );
  }

  expoPlugins.push([
    "react-native-google-mobile-ads",
    {
      androidAppId: androidAdMobAppId,
      iosAppId: iosAdMobAppId,
      delayAppMeasurementInit: true,
    },
  ]);
  expoPlugins.push([
    "expo-build-properties",
    {
      android: {
        extraProguardRules: CONSENT_SDK_PROGUARD_RULE,
      },
    },
  ]);
  if (
    !expoPlugins.some((plugin) =>
      Array.isArray(plugin)
        ? plugin[0] === "expo-image-picker"
        : plugin === "expo-image-picker",
    )
  ) {
    expoPlugins.push([
      "expo-image-picker",
      {
        photosPermission:
          "日誌や予定に添付する画像を選択するため、写真へのアクセスを許可してください。",
        cameraPermission: false,
        microphonePermission: false,
      },
    ]);
  }
  if (
    !expoPlugins.some((plugin) =>
      Array.isArray(plugin) ? plugin[0] === "expo-av" : plugin === "expo-av",
    )
  ) {
    expoPlugins.push([
      "expo-av",
      {
        microphonePermission: false,
      },
    ]);
  }
  if (
    !expoPlugins.some((plugin) =>
      Array.isArray(plugin) ? plugin[0] === "expo-location" : plugin === "expo-location",
    )
  ) {
    expoPlugins.push([
      "expo-location",
      { locationWhenInUsePermission: locationPermissionMessage },
    ]);
  }
  const iosConfig = {
    ...(appJson.expo.ios?.config || {}),
  };
  if (iosMapsApiKey) {
    iosConfig.googleMapsApiKey = iosMapsApiKey;
  }

  const androidConfig = {
    ...(appJson.expo.android?.config || {}),
  };
  if (androidMapsApiKey) {
    androidConfig.googleMaps = {
      ...(androidConfig.googleMaps || {}),
      apiKey: androidMapsApiKey,
    };
  }

  return {
    ...config,
    ...appJson.expo,

    name: isDevelopmentBuild ? "SMARTBUKATSU Dev" : appJson.expo.name,
    scheme: isDevelopmentBuild ? "smartbukatsu-dev" : appJson.expo.scheme,
    plugins: expoPlugins,
    ios: {
      ...(appJson.expo.ios || {}),
      icon: isDevelopmentBuild
        ? "./assets/icon_ios_dev.png"
        : appJson.expo.ios?.icon,
      bundleIdentifier: isDevelopmentBuild
        ? "com.sharprise.smartbukatsu.dev"
        : appJson.expo.ios?.bundleIdentifier,
      config: iosConfig,
      infoPlist: {
        ...(appJson.expo.ios?.infoPlist || {}),
        NSLocationWhenInUseUsageDescription: locationPermissionMessage,
      },
    },
    android: {
      ...(appJson.expo.android || {}),
      icon: isDevelopmentBuild
        ? "./assets/icon_android_dev.png"
        : appJson.expo.android?.icon,
      adaptiveIcon: {
        ...(appJson.expo.android?.adaptiveIcon || {}),
        foregroundImage: isDevelopmentBuild
          ? "./assets/icon_android_dev.png"
          : appJson.expo.android?.adaptiveIcon?.foregroundImage,
      },
      package: isDevelopmentBuild
        ? "com.sharprise.smartbukatsu.dev"
        : appJson.expo.android?.package,
      config: androidConfig,
    },

    extra: {
      ...(config.extra || {}),
      ...(appJson.expo.extra || {}),

      firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,

      eas: {
        projectId: "e741f7bd-7361-4112-aa43-06b192f2be13",
      },
    },
  };
};
