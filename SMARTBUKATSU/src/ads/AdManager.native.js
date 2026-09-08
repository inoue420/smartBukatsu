import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StatusBar } from "react-native";
import mobileAds, {
  AdEventType,
  AdsConsent,
  InterstitialAd,
  MaxAdContentRating,
  TestIds,
} from "react-native-google-mobile-ads";

import {
  ADS_REQUEST_CONFIGURATION,
  DEFAULT_INTERSTITIAL_SETTINGS,
  INTERSTITIAL_ADS_ENABLED,
  NON_PERSONALIZED_AD_REQUEST_OPTIONS,
  normalizeInterstitialSettings,
} from "./adSettings";
import {
  createAdDiagnostics,
  getAdErrorCode,
  recordAdDiagnostic,
} from "./adDiagnostics";
const DAILY_COUNT_STORAGE_KEY = "admob_interstitial_daily_count_v1";
const INITIALIZATION_RETRY_DELAYS = [30000, 60000];

// Only known SDK codes are logged; messages can contain IDs or request details.
export const logAdFailure = (stage, error) => {
  console.warn("[AdMob]", stage, getAdErrorCode(error));
};

const getLocalDateKey = () => {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
};

const getProductionUnitId = (androidId, iosId) =>
  Platform.select({ android: androidId, ios: iosId }) || null;

const useTestAds =
  __DEV__ || process.env.EXPO_PUBLIC_ADMOB_USE_TEST_ADS === "true";

const bannerAdUnitId = useTestAds
  ? TestIds.BANNER
  : getProductionUnitId(
      process.env.EXPO_PUBLIC_ADMOB_ANDROID_BANNER_UNIT_ID,
      process.env.EXPO_PUBLIC_ADMOB_IOS_BANNER_UNIT_ID,
    );

const interstitialAdUnitId = INTERSTITIAL_ADS_ENABLED
  ? useTestAds
    ? TestIds.INTERSTITIAL
    : getProductionUnitId(
        process.env.EXPO_PUBLIC_ADMOB_ANDROID_INTERSTITIAL_UNIT_ID,
        process.env.EXPO_PUBLIC_ADMOB_IOS_INTERSTITIAL_UNIT_ID,
      )
  : null;

const defaultAdsContext = {
  adsInitialized: false,
  bannerAdUnitId: null,
  diagnostics: null,
  recordDiagnostic: () => {},
  recordScreenTransition: () => {},
  showAfterDiarySubmission: () => {},
  configureInterstitial: () => {},
};

const AdsContext = createContext(defaultAdsContext);

export const AdsProvider = ({ children }) => {
  const [adsInitialized, setAdsInitialized] = useState(false);
  const [diagnostics, setDiagnostics] = useState(() =>
    createAdDiagnostics(useTestAds, bannerAdUnitId),
  );
  const recordDiagnostic = useCallback((event, error) => {
    setDiagnostics((previous) => recordAdDiagnostic(previous, event, error));
  }, []);
  const adsInitializedRef = useRef(false);
  const dailyStateRef = useRef({ date: getLocalDateKey(), count: 0 });
  const dailyStateLoadedRef = useRef(false);
  const navigationCountRef = useRef(0);
  const interstitialRef = useRef(null);
  const interstitialLoadedRef = useRef(false);
  const interstitialLoadingRef = useRef(false);
  const interstitialShowingRef = useRef(false);
  const loadInterstitialRef = useRef(() => {});
  const interstitialSettingsRef = useRef({
    ...DEFAULT_INTERSTITIAL_SETTINGS,
  });

  const persistDailyState = useCallback(async () => {
    try {
      await AsyncStorage.setItem(
        DAILY_COUNT_STORAGE_KEY,
        JSON.stringify(dailyStateRef.current),
      );
    } catch (error) {
      if (__DEV__) {
        console.warn(
          "インタースティシャル広告の表示回数を保存できませんでした。",
          error,
        );
      }
    }
  }, []);

  const refreshDailyState = useCallback(() => {
    const today = getLocalDateKey();
    if (dailyStateRef.current.date !== today) {
      dailyStateRef.current = { date: today, count: 0 };
      void persistDailyState();
    }
  }, [persistDailyState]);

  const tryShowInterstitial = useCallback(async () => {
    if (
      !INTERSTITIAL_ADS_ENABLED ||
      !dailyStateLoadedRef.current ||
      interstitialShowingRef.current
    ) {
      return false;
    }

    refreshDailyState();
    if (
      interstitialSettingsRef.current.dailyLimit === 0 ||
      dailyStateRef.current.count >= interstitialSettingsRef.current.dailyLimit
    ) {
      return false;
    }

    const interstitial = interstitialRef.current;
    if (!interstitial || !interstitialLoadedRef.current) {
      loadInterstitialRef.current();
      return false;
    }

    interstitialShowingRef.current = true;
    interstitialLoadedRef.current = false;

    try {
      await interstitial.show();
      dailyStateRef.current = {
        date: getLocalDateKey(),
        count: dailyStateRef.current.count + 1,
      };
      navigationCountRef.current = 0;
      void persistDailyState();
      return true;
    } catch (error) {
      interstitialShowingRef.current = false;
      if (__DEV__) {
        console.warn("インタースティシャル広告を表示できませんでした。", error);
      }
      loadInterstitialRef.current();
      return false;
    }
  }, [persistDailyState, refreshDailyState]);

  const configureInterstitial = useCallback((settings) => {
    interstitialSettingsRef.current = normalizeInterstitialSettings(settings);
    if (interstitialSettingsRef.current.dailyLimit === 0) {
      navigationCountRef.current = 0;
    }
  }, []);

  const recordScreenTransition = useCallback(() => {
    if (
      !INTERSTITIAL_ADS_ENABLED ||
      interstitialSettingsRef.current.dailyLimit === 0
    ) {
      navigationCountRef.current = 0;
      return;
    }

    navigationCountRef.current += 1;
    if (
      navigationCountRef.current >=
        interstitialSettingsRef.current.navigationInterval
    ) {
      void tryShowInterstitial();
    }
  }, [tryShowInterstitial]);

  const showAfterDiarySubmission = useCallback(() => {
    if (!INTERSTITIAL_ADS_ENABLED) return;
    void tryShowInterstitial();
  }, [tryShowInterstitial]);

  useEffect(() => {
    let active = true;
    let retryTimer = null;
    let initializationRetryTimer = null;
    let initializationAttempts = 0;
    const subscriptions = [];

    const loadDailyState = async () => {
      try {
        const savedState = await AsyncStorage.getItem(
          DAILY_COUNT_STORAGE_KEY,
        );
        if (savedState) {
          const parsedState = JSON.parse(savedState);
          if (
            parsedState?.date === getLocalDateKey() &&
            Number.isFinite(parsedState?.count)
          ) {
            dailyStateRef.current = {
              date: parsedState.date,
              count: Math.max(0, parsedState.count),
            };
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.warn(
            "インタースティシャル広告の表示回数を読み込めませんでした。",
            error,
          );
        }
      } finally {
        dailyStateLoadedRef.current = true;
      }
    };

    const scheduleReload = (delay = 1000) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (active) loadInterstitialRef.current();
      }, delay);
    };

    if (interstitialAdUnitId) {
      const interstitial = InterstitialAd.createForAdRequest(
        interstitialAdUnitId,
        NON_PERSONALIZED_AD_REQUEST_OPTIONS,
      );
      interstitialRef.current = interstitial;

      loadInterstitialRef.current = () => {
        if (
          !active ||
          !adsInitializedRef.current ||
          interstitialLoadingRef.current ||
          interstitialLoadedRef.current ||
          interstitialShowingRef.current
        ) {
          return;
        }
        interstitialLoadingRef.current = true;
        interstitial.load();
      };

      subscriptions.push(
        interstitial.addAdEventListener(AdEventType.LOADED, () => {
          interstitialLoadingRef.current = false;
          interstitialLoadedRef.current = true;
        }),
        interstitial.addAdEventListener(AdEventType.OPENED, () => {
          if (Platform.OS === "ios") StatusBar.setHidden(true);
        }),
        interstitial.addAdEventListener(AdEventType.CLOSED, () => {
          interstitialLoadingRef.current = false;
          interstitialLoadedRef.current = false;
          interstitialShowingRef.current = false;
          if (Platform.OS === "ios") StatusBar.setHidden(false);
          scheduleReload();
        }),
        interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
          interstitialLoadingRef.current = false;
          interstitialLoadedRef.current = false;
          interstitialShowingRef.current = false;
          if (__DEV__) {
            console.warn(
              "インタースティシャル広告の読み込みに失敗しました。",
              error,
            );
          }
          scheduleReload(30000);
        }),
      );
    }

    void loadDailyState();

    const getConsentInfo = async () => {
      try {
        return await AdsConsent.gatherConsent({
          tagForUnderAgeOfConsent:
            ADS_REQUEST_CONFIGURATION.tagForUnderAgeOfConsent,
        });
      } catch (error) {
        if (!active) return null;
        logAdFailure("consent-update", error);
        recordDiagnostic("consent-error", error);

        try {
          return await AdsConsent.getConsentInfo();
        } catch (fallbackError) {
          if (active) {
            logAdFailure("consent-cache", fallbackError);
            recordDiagnostic("consent-cache-error", fallbackError);
          }
          return null;
        }
      }
    };

    const scheduleInitializationRetry = () => {
      const delay = INITIALIZATION_RETRY_DELAYS[initializationAttempts - 1];
      if (!active) return;
      if (delay === undefined) {
        recordDiagnostic("retry-exhausted");
        return;
      }
      recordDiagnostic("retry-scheduled");
      initializationRetryTimer = setTimeout(() => {
        initializationRetryTimer = null;
        void initializeAds();
      }, delay);
    };

    const initializeAds = async () => {
      if (!active || adsInitializedRef.current) return;
      if (!bannerAdUnitId && !interstitialAdUnitId) {
        console.warn("[AdMob] configuration: missing-ad-unit-id");
        recordDiagnostic("missing-id");
        return;
      }
      initializationAttempts += 1;
      recordDiagnostic("consent-start");
      const consentInfo = await getConsentInfo();
      if (!active) return;
      if (!consentInfo?.canRequestAds) {
        console.warn("[AdMob] consent: cannot-request-ads");
        recordDiagnostic("consent-blocked");
        scheduleInitializationRetry();
        return;
      }

      try {
        recordDiagnostic("consent-allowed");
        recordDiagnostic("sdk-start");
        await mobileAds().setRequestConfiguration({
          ...ADS_REQUEST_CONFIGURATION,
          maxAdContentRating: MaxAdContentRating.G,
        });
        if (!active) return;

        await mobileAds().initialize();
        if (!active) return;

        adsInitializedRef.current = true;
        setAdsInitialized(true);
        recordDiagnostic("sdk-ready");
        loadInterstitialRef.current();
      } catch (error) {
        if (!active) return;
        logAdFailure("sdk-initialization", error);
        recordDiagnostic("sdk-error", error);
        scheduleInitializationRetry();
      }
    };

    void initializeAds();

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (initializationRetryTimer) clearTimeout(initializationRetryTimer);
      subscriptions.forEach((unsubscribe) => unsubscribe());
      loadInterstitialRef.current = () => {};
      interstitialRef.current = null;
      if (Platform.OS === "ios") StatusBar.setHidden(false);
    };
  }, [recordDiagnostic]);

  const contextValue = useMemo(
    () => ({
      adsInitialized,
      bannerAdUnitId,
      diagnostics,
      recordDiagnostic,
      recordScreenTransition,
      showAfterDiarySubmission,
      configureInterstitial,
    }),
    [
      adsInitialized,
      diagnostics,
      recordDiagnostic,
      configureInterstitial,
      recordScreenTransition,
      showAfterDiarySubmission,
    ],
  );

  return (
    <AdsContext.Provider value={contextValue}>{children}</AdsContext.Provider>
  );
};

export const useAds = () => useContext(AdsContext);
