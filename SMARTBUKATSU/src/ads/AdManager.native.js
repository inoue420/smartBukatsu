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
import { AppState, Platform, StatusBar } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { isCaptureEnvironment } from "../firebase";
import { useAuth } from "../AuthContext";
import { reviewPresentationGate } from "../services/reviewPresentationGate";
import mobileAds, {
  AdEventType,
  AdsConsent,
  InterstitialAd,
  AgeRestrictedTreatment,
  TestIds,
} from "react-native-google-mobile-ads";

import {
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
import { resolveAdAgePolicy, createAdTaskQueue } from "./adAgePolicy";
import { createInitializationRecovery, initializationFailureKind } from "./adInitializationRecovery";
const DAILY_COUNT_STORAGE_KEY = "admob_interstitial_daily_count_v1";
const runAdTask = createAdTaskQueue();

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
  requestOptions: NON_PERSONALIZED_AD_REQUEST_OPTIONS,
  adSessionKey: "",
  privacyOptionsRequired: false,
  showPrivacyOptions: async () => false,
  onAdRequestsBlocked: () => {},
};

const AdsContext = createContext(defaultAdsContext);

export const AdsProvider = ({ children }) => {
  const { user, loading, activeTeamId, isTeamSwitching, emailVerificationPending,
    currentMemberProfile, adProfileResolved, adMinimumAgeConfirmed } = useAuth();
  const agePolicy = resolveAdAgePolicy({
    uid: user?.uid, profileResolved: adProfileResolved,
    minimumAgeConfirmed: adMinimumAgeConfirmed, membershipRole: currentMemberProfile?.role,
  });
  const enabled = Boolean(user?.uid && adProfileResolved && !loading &&
    !isTeamSwitching && !emailVerificationPending);
  const [consentRevision, setConsentRevision] = useState(0);
  const sessionKey = JSON.stringify([user?.uid || "", activeTeamId || "", agePolicy.audience, enabled, consentRevision]);
  const latestSessionRef = useRef(sessionKey);
  latestSessionRef.current = sessionKey;
  const [readySession, setReadySession] = useState(null);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const privacyBusyRef = useRef(false);
  const adsInitialized = enabled && !privacyBusy && readySession?.key === sessionKey;
  const requestOptions = readySession?.key === sessionKey && readySession.freshConsent
    ? agePolicy.requestOptions : NON_PERSONALIZED_AD_REQUEST_OPTIONS;
  const privacyOptionsRequired = agePolicy.audience === "adult" &&
    readySession?.key === sessionKey && readySession.privacyOptionsRequired;
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
  const releasePresentationRef = useRef(null);
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
      !adsInitializedRef.current || privacyBusyRef.current ||
      readySession?.key !== latestSessionRef.current ||
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

    const releasePresentation = reviewPresentationGate.acquire("ad");
    if (!releasePresentation) return false;
    releasePresentationRef.current = releasePresentation;
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
      releasePresentationRef.current?.();
      releasePresentationRef.current = null;
      interstitialShowingRef.current = false;
      if (__DEV__) {
        console.warn("インタースティシャル広告を表示できませんでした。", error);
      }
      loadInterstitialRef.current();
      return false;
    }
  }, [persistDailyState, refreshDailyState, readySession]);

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
      return Promise.resolve(false);
    }

    navigationCountRef.current += 1;
    if (
      navigationCountRef.current >=
        interstitialSettingsRef.current.navigationInterval
    ) {
      return tryShowInterstitial();
    }
    return Promise.resolve(false);
  }, [tryShowInterstitial]);

  const showAfterDiarySubmission = useCallback(() => {
    if (!INTERSTITIAL_ADS_ENABLED) return Promise.resolve(false);
    return tryShowInterstitial();
  }, [tryShowInterstitial]);

  useEffect(() => {
    adsInitializedRef.current = false;
    interstitialLoadedRef.current = false;
    interstitialLoadingRef.current = false;
    navigationCountRef.current = 0;
    setReadySession(null);
    setDiagnostics(createAdDiagnostics(useTestAds, bannerAdUnitId));
    if (isCaptureEnvironment || !enabled) return;
    let active = true;
    const isCurrent = () => active && latestSessionRef.current === sessionKey;
    let retryTimer = null;
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
        if (isCurrent()) loadInterstitialRef.current();
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
          !isCurrent() || privacyBusyRef.current ||
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
          if (!isCurrent()) return;
          interstitialLoadingRef.current = false;
          interstitialLoadedRef.current = true;
        }),
        interstitial.addAdEventListener(AdEventType.OPENED, () => {
          if (!isCurrent()) return;
          if (Platform.OS === "ios") StatusBar.setHidden(true);
        }),
        interstitial.addAdEventListener(AdEventType.CLOSED, () => {
          if (!isCurrent()) return;
          releasePresentationRef.current?.();
          releasePresentationRef.current = null;
          interstitialLoadingRef.current = false;
          interstitialLoadedRef.current = false;
          interstitialShowingRef.current = false;
          if (Platform.OS === "ios") StatusBar.setHidden(false);
          scheduleReload();
        }),
        interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
          if (!isCurrent()) return;
          releasePresentationRef.current?.();
          releasePresentationRef.current = null;
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
        return { info: await AdsConsent.gatherConsent(agePolicy.consentOptions), fresh: true };
      } catch (error) {
        if (!isCurrent()) return null;
        logAdFailure("consent-update", error);
        recordDiagnostic("consent-error", error);

        try {
          // Cached device consent must not enable personalization for a new session.
          return { info: await AdsConsent.getConsentInfo(), fresh: false, error };
        } catch (fallbackError) {
          if (isCurrent()) {
            logAdFailure("consent-cache", fallbackError);
            recordDiagnostic("consent-cache-error", fallbackError);
          }
          return { info: null, fresh: false, error };
        }
      }
    };

    const initializeAds = async ({ consentOnly }) => {
      if (!isCurrent() || privacyBusyRef.current) return "transient";
      if (adsInitializedRef.current) return "ready";
      if (!bannerAdUnitId && !interstitialAdUnitId) {
        console.warn("[AdMob] configuration: missing-ad-unit-id");
        recordDiagnostic("missing-id");
        return "permanent";
      }
      let stage = "configuration";
      try {
        if (consentOnly) {
          stage = "consent-check";
          const info = await AdsConsent.getConsentInfo();
          if (!isCurrent()) return "transient";
          if (!info?.canRequestAds) {
            recordDiagnostic("consent-blocked");
            return "consent-blocked";
          }
        }
        stage = "configuration";
        recordDiagnostic("sdk-start");
        // Fail closed if JS is ever run without the required age-treatment API.
        if (!AgeRestrictedTreatment?.TEEN) throw new Error("age-treatment-unavailable");
        await mobileAds().setRequestConfiguration(agePolicy.requestConfiguration);
        if (!isCurrent()) return "transient";
        stage = "consent";
        recordDiagnostic("consent-start");
        const consent = await getConsentInfo();
        if (!isCurrent()) return "transient";
        if (!consent?.info?.canRequestAds) {
          recordDiagnostic("consent-blocked");
          return consent?.error ? initializationFailureKind(consent.error, stage) : "consent-blocked";
        }
        recordDiagnostic("consent-allowed");

        stage = "initialization";
        await mobileAds().initialize();
        if (!isCurrent()) return "transient";

        adsInitializedRef.current = true;
        setReadySession({ key: sessionKey, freshConsent: consent.fresh,
          privacyOptionsRequired: consent.info.privacyOptionsRequirementStatus === "REQUIRED" });
        recordDiagnostic("sdk-ready");
        loadInterstitialRef.current();
        return "ready";
      } catch (error) {
        if (!isCurrent()) return;
        logAdFailure("sdk-initialization", error);
        recordDiagnostic("sdk-error", error);
        const kind = initializationFailureKind(error, stage);
        return stage === "consent-check" && kind !== "permanent" ? "consent-check-failed" : kind;
      }
    };

    const recovery = createInitializationRecovery({
      initialize: initializeAds, enqueue: runAdTask, isCurrent, onEvent: recordDiagnostic,
      foreground: AppState.currentState === "active", now: Date.now,
      setTimer: setTimeout, clearTimer: clearTimeout,
    });
    let appState = AppState.currentState;
    const appSubscription = AppState.addEventListener("change", nextState => {
      if (!isCurrent()) return;
      const returned = nextState === "active" && appState !== "active";
      appState = nextState;
      recovery.setForeground(nextState === "active");
      if (returned && !adsInitializedRef.current) {
        // Suspended iOS apps may miss the offline -> online notification.
        void NetInfo.refresh().catch(() => {});
      }
    });
    subscriptions.push(() => appSubscription.remove());
    subscriptions.push(NetInfo.addEventListener(state => {
      if (!isCurrent()) return;
      recovery.setOnline(state.isConnected === false || state.isInternetReachable === false
        ? false : state.isConnected === true ? true : null);
    }));
    recovery.start();

    return () => {
      active = false;
      recovery.stop();
      adsInitializedRef.current = false;
      if (retryTimer) clearTimeout(retryTimer);
      subscriptions.forEach((unsubscribe) => unsubscribe());
      releasePresentationRef.current?.();
      releasePresentationRef.current = null;
      loadInterstitialRef.current = () => {};
      interstitialRef.current = null;
      if (Platform.OS === "ios") StatusBar.setHidden(false);
    };
  }, [recordDiagnostic, agePolicy, sessionKey, enabled]);

  const showPrivacyOptions = useCallback(async () => {
    if (!privacyOptionsRequired || privacyBusyRef.current || !enabled) return false;
    const key = sessionKey;
    privacyBusyRef.current = true;
    setPrivacyBusy(true);
    try {
      return await runAdTask(async () => {
        if (latestSessionRef.current !== key) return false;
        await AdsConsent.showPrivacyOptionsForm();
        return latestSessionRef.current === key;
      });
    } catch (error) {
      logAdFailure("privacy-options", error);
      throw error;
    } finally {
      privacyBusyRef.current = false;
      setPrivacyBusy(false);
      // Recreate ads after changes to consent, even if the form failed.
      setConsentRevision((value) => value + 1);
    }
  }, [privacyOptionsRequired, enabled, sessionKey]);

  const onAdRequestsBlocked = useCallback(() => {
    if (latestSessionRef.current !== sessionKey) return;
    adsInitializedRef.current = false;
    setReadySession(null);
    setConsentRevision(value => value + 1);
  }, [sessionKey]);

  const contextValue = useMemo(
    () => ({
      adsInitialized,
      bannerAdUnitId,
      requestOptions,
      adSessionKey: sessionKey,
      privacyOptionsRequired: Boolean(privacyOptionsRequired),
      showPrivacyOptions,
      onAdRequestsBlocked,
      diagnostics,
      recordDiagnostic,
      recordScreenTransition,
      showAfterDiarySubmission,
      configureInterstitial,
    }),
    [
      adsInitialized,
      requestOptions,
      sessionKey,
      privacyOptionsRequired,
      showPrivacyOptions,
      onAdRequestsBlocked,
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
