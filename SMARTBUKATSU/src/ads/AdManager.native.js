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
import { AppState, Platform, StatusBar, Keyboard, InteractionManager } from "react-native";
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
  INTERSTITIAL_ADS_ENABLED,
  NON_PERSONALIZED_AD_REQUEST_OPTIONS,
} from "./adSettings";
import {
  createAdDiagnostics,
  getAdErrorCode,
  recordAdDiagnostic,
} from "./adDiagnostics";
import { resolveAdAgePolicy, createAdTaskQueue } from "./adAgePolicy";
import { createInitializationRecovery, initializationFailureKind } from "./adInitializationRecovery";
import { createInterstitialController } from "./interstitialPolicy";
import { fetchInterstitialSettings, saveInterstitialSettings } from "../services/interstitialSettingsService";
const runAdTask = createAdTaskQueue();

// Only known SDK codes are logged; messages can contain IDs or request details.
export const logAdFailure = (stage, error) => {
  console.warn("[AdMob]", stage, getAdErrorCode(error));
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
  cancelInterstitial: () => {},
  setInterstitialBlocked: () => {},
  showAfterTagPublication: async () => false,
  interstitialSettings: null,
  refreshInterstitialSettings: async () => false,
  saveGlobalInterstitialSettings: async () => { throw new Error("広告設定を変更できません。"); },
  requestOptions: NON_PERSONALIZED_AD_REQUEST_OPTIONS,
  adSessionKey: "",
  privacyOptionsRequired: false,
  showPrivacyOptions: async () => false,
  onAdRequestsBlocked: () => {},
};

const AdsContext = createContext(defaultAdsContext);

export const AdsProvider = ({ children }) => {
  const { user, loading, activeTeamId, isTeamSwitching, emailVerificationPending,
    adAdultConfirmed, adProfileResolved, adMinimumAgeConfirmed } = useAuth();
  const agePolicy = resolveAdAgePolicy({
    uid: user?.uid, profileResolved: adProfileResolved,
    minimumAgeConfirmed: adMinimumAgeConfirmed, adultConfirmed: adAdultConfirmed,
  });
  const enabled = Boolean(user?.uid && adProfileResolved && !loading &&
    !emailVerificationPending);
  const [consentRevision, setConsentRevision] = useState(0);
  const sessionKey = JSON.stringify([user?.uid || "", agePolicy.audience, enabled, consentRevision]);
  // Keep account-wide inventory while invalidating each team's old opportunity.
  const teamScopeRef = useRef({ key: null, revision: 0 });
  const teamKey = JSON.stringify([user?.uid || "", activeTeamId || "", Boolean(isTeamSwitching)]);
  if (teamScopeRef.current.key !== teamKey) {
    teamScopeRef.current = { key: teamKey, revision: teamScopeRef.current.revision + 1 };
  }
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
  const readySessionKeyRef = useRef(null);
  readySessionKeyRef.current = adsInitialized ? sessionKey : null;
  const [interstitialSettings, setInterstitialSettings] = useState(null);
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const controllerRef = useRef(null);
  if (!controllerRef.current) controllerRef.current = createInterstitialController({
    storage: AsyncStorage, fetchPolicy: fetchInterstitialSettings, onPolicy: setInterstitialSettings,
  });
  const controller = controllerRef.current;
  const enabledRef = useRef(false);
  enabledRef.current = enabled && !privacyBusy && !isTeamSwitching;
  const opportunityRef = useRef(0);
  const reservationRef = useRef(null);
  const loadedAtRef = useRef(0);
  const loadedEpochRef = useRef(0);
  const interstitialRef = useRef(null);
  const interstitialLoadedRef = useRef(false);
  const interstitialLoadingRef = useRef(false);
  const interstitialShowingRef = useRef(false);
  const releasePresentationRef = useRef(null);
  const loadInterstitialRef = useRef(() => {});
  const cancelInterstitial = useCallback(() => { opportunityRef.current++; }, []);
  const setInterstitialBlocked = useCallback((key, value) => reviewPresentationGate.setBlocked(key, value), []);
  const refreshInterstitialSettings = useCallback(() => controller.refresh(true), [controller]);
  const saveGlobalInterstitialSettings = useCallback(async settings => {
    const key = latestSessionRef.current;
    const saved = await saveInterstitialSettings(user?.uid, settings);
    if (key !== latestSessionRef.current) throw new Error("ログイン状態が変わりました。");
    controller.applySaved(saved);
    return saved;
  }, [controller, user?.uid]);

  useEffect(() => {
    if (!INTERSTITIAL_ADS_ENABLED || isCaptureEnvironment) return;
    controller.setUser(user?.uid && !emailVerificationPending ? user.uid : null);
    void controller.initialize().then(() => controller.refresh());
  }, [controller, user?.uid, emailVerificationPending]);
  useEffect(() => {
    if (!INTERSTITIAL_ADS_ENABLED || isCaptureEnvironment) return;
    controller.setActive(enabled && !privacyBusy && !isTeamSwitching && AppState.currentState === "active" && !interstitialShowingRef.current);
  }, [controller, enabled, privacyBusy, isTeamSwitching]);
  useEffect(() => {
    if (!INTERSTITIAL_ADS_ENABLED || isCaptureEnvironment) return;
    const app = AppState.addEventListener("change", state => {
      cancelInterstitial();
      controller.setActive(state === "active" && enabledRef.current && !interstitialShowingRef.current);
      void controller.checkpoint();
      if (state === "active") { void controller.refresh(); loadInterstitialRef.current(); }
    });
    const keyboard = Keyboard?.addListener?.("keyboardDidShow", cancelInterstitial);
    // Local checkpoints only: this timer never reads Firebase or presents ads.
    const timer = setInterval(() => { void controller.checkpoint(); }, 30000);
    return () => { app.remove(); keyboard?.remove(); clearInterval(timer);
      controller.setActive(false); void controller.checkpoint(); };
  }, [controller, cancelInterstitial]);
  useEffect(() => { loadInterstitialRef.current(); }, [interstitialSettings]);

  const showAtOpportunity = useCallback((isCurrent = () => true, transition = null) => new Promise(resolve => {
    const blocked = transition && reviewPresentationGate.isBlockedExcept
      ? reviewPresentationGate.isBlockedExcept(transition.blockKey) : reviewPresentationGate.isBlocked?.();
    if (!INTERSTITIAL_ADS_ENABLED || blocked || !enabledRef.current || !adsInitializedRef.current ||
        readySessionKeyRef.current !== latestSessionRef.current || interstitialShowingRef.current ||
        AppState.currentState !== "active" || privacyBusyRef.current || Keyboard?.isVisible?.() || !isCurrent()) return resolve(false);
    // Freeze readiness at the operation itself. A later load or settings fetch
    // may prepare the NEXT operation, never this one.
    const opportunity = controller.snapshot();
    if (!opportunity.healthy || opportunity.busy || opportunity.count >= 1) return resolve(false);
    if (!opportunity.fresh) { void controller.refresh(); return resolve(false); }
    const interstitial = interstitialRef.current, loadedEpoch = loadedEpochRef.current;
    if (interstitialLoadedRef.current && Date.now() - loadedAtRef.current >= 3600000) {
      interstitialLoadedRef.current = false; setInventoryRevision(value => value + 1); return resolve(false);
    }
    if (!interstitial || !interstitialLoadedRef.current) { loadInterstitialRef.current(); return resolve(false); }
    const usageAtOpportunity = opportunity.usageMs;
    const key = latestSessionRef.current, version = ++opportunityRef.current;
    const teamRevision = teamScopeRef.current.revision;
    const safe = () => version === opportunityRef.current && key === latestSessionRef.current &&
      teamRevision === teamScopeRef.current.revision &&
      readySessionKeyRef.current === key &&
      interstitialRef.current === interstitial && interstitialLoadedRef.current && loadedEpochRef.current === loadedEpoch &&
      controller.snapshot().date === opportunity.date && controller.snapshot().policyRevision === opportunity.policyRevision &&
      Date.now() - loadedAtRef.current < 3600000 &&
      enabledRef.current && AppState.currentState === "active" && !Keyboard?.isVisible?.() &&
      !privacyBusyRef.current && adsInitializedRef.current && !reviewPresentationGate.isBlocked?.() && isCurrent();
    let done = false;
    const finish = result => { if (!done) { done = true; clearTimeout(timeout); resolve(result); } };
    const timeout = setTimeout(() => { cancelInterstitial(); finish(false); }, 2000);
    const attempt = async () => {
      if (done || !INTERSTITIAL_ADS_ENABLED || !safe() || interstitialShowingRef.current) return finish(false);
      if (!controller.snapshot().fresh) { void controller.refresh(); return finish(false); }
      const reservation = await controller.reserve(safe, usageAtOpportunity);
      if (!reservation) return finish(false);
      const release = safe() && reviewPresentationGate.acquire("ad");
      if (!release) { await reservation.finish(); return finish(false); }
      clearTimeout(timeout);
      releasePresentationRef.current = release;
      reservationRef.current = { reservation, finish };
      interstitialShowingRef.current = true;
      interstitialLoadedRef.current = false;
      controller.setActive(false);
      try { await interstitial.show(); }
      catch (error) {
        if (reservationRef.current?.reservation !== reservation) return;
        logAdFailure("interstitial-show", error);
        reservationRef.current = null; releasePresentationRef.current?.(); releasePresentationRef.current = null;
        interstitialShowingRef.current = false;
        if (Platform.OS === "ios") StatusBar.setHidden(false);
        controller.setActive(enabledRef.current && AppState.currentState === "active");
        await reservation.finish(); finish(false); loadInterstitialRef.current();
      }
    };
    if (transition) void Promise.resolve().then(transition.wait).then(ended => {
      if (ended === true) return attempt();
      finish(false);
    }).catch(() => finish(false));
    else if (InteractionManager?.runAfterInteractions) InteractionManager.runAfterInteractions(() => { void attempt().catch(() => finish(false)); });
    else void attempt().catch(() => finish(false));
  }), [controller, cancelInterstitial]);
  // Only explicit task boundaries enter this API; arbitrary navigation does not.
  const recordScreenTransition = useCallback((event = {}) => {
    const allowed = (event.to === "WorkspaceHome" && ["Calendar", "Roster", "ProjectList", "TacticalNotes", "NoticeBoard"].includes(event.from)) ||
      (event.to === "ProjectList" && event.from === "ProjectDetail");
    return allowed && !event.fromNotification && !event.opensPlayback && typeof event.waitForTransition === "function"
      ? showAtOpportunity(event.isCurrent, { wait: event.waitForTransition, blockKey: event.navigationBlockKey }) : Promise.resolve(false);
  }, [showAtOpportunity]);
  const showAfterDiarySubmission = showAtOpportunity;
  const showAfterTagPublication = showAtOpportunity;

  useEffect(() => {
    adsInitializedRef.current = false;
    interstitialLoadedRef.current = false;
    interstitialLoadingRef.current = false;
    setReadySession(null);
    setDiagnostics(createAdDiagnostics(useTestAds, bannerAdUnitId));
    if (isCaptureEnvironment || !enabled) return;
    let active = true;
    const isCurrent = () => active && latestSessionRef.current === sessionKey;
    let retryTimer = null;
    const subscriptions = [];

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
          !adsInitializedRef.current || !controller.canPreload() ||
          interstitialLoadingRef.current ||
          interstitialLoadedRef.current ||
          interstitialShowingRef.current
        ) {
          return;
        }
        interstitialLoadingRef.current = true;
        try { interstitial.load(); }
        catch (error) {
          interstitialLoadingRef.current = false;
          logAdFailure("interstitial-load", error); scheduleReload(30000);
        }
      };

      subscriptions.push(
        interstitial.addAdEventListener(AdEventType.LOADED, () => {
          if (!isCurrent()) return;
          interstitialLoadingRef.current = false;
          interstitialLoadedRef.current = true; loadedAtRef.current = Date.now(); loadedEpochRef.current++;
        }),
        interstitial.addAdEventListener(AdEventType.OPENED, () => {
          if (!isCurrent()) return;
          reservationRef.current?.reservation.opened();
          if (Platform.OS === "ios") StatusBar.setHidden(true);
        }),
        interstitial.addAdEventListener(AdEventType.CLOSED, () => {
          if (!isCurrent()) return;
          const pending = reservationRef.current; reservationRef.current = null;
          // A close event also proves presentation if OPENED was not delivered.
          pending?.reservation.opened();
          void pending?.reservation.finish(); pending?.finish(true);
          controller.setActive(enabledRef.current && AppState.currentState === "active");
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
          const pending = reservationRef.current; reservationRef.current = null;
          void pending?.reservation.finish(); pending?.finish(false);
          controller.setActive(enabledRef.current && AppState.currentState === "active");
          if (Platform.OS === "ios") StatusBar.setHidden(false);
          releasePresentationRef.current?.();
          releasePresentationRef.current = null;
          interstitialLoadingRef.current = false;
          interstitialLoadedRef.current = false;
          interstitialShowingRef.current = false;
          logAdFailure("interstitial-load", error);
          scheduleReload(30000);
        }),
      );
    }


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
      cancelInterstitial();
      const pending = reservationRef.current; reservationRef.current = null;
      // An in-progress native presentation cannot be cancelled by changing JS
      // sessions. Conservatively retain the cap even before its OPENED event.
      if (interstitialShowingRef.current) pending?.reservation.opened();
      void pending?.reservation.finish(); pending?.finish(false);
      interstitialShowingRef.current = false;
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
  }, [recordDiagnostic, agePolicy, sessionKey, enabled, inventoryRevision]);

  const showPrivacyOptions = useCallback(async () => {
    if (!privacyOptionsRequired || privacyBusyRef.current || interstitialShowingRef.current || !enabled) return false;
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
      interstitialSettings,
      refreshInterstitialSettings,
      saveGlobalInterstitialSettings,
      cancelInterstitial,
      setInterstitialBlocked,
      showAfterTagPublication,
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
      interstitialSettings,
      refreshInterstitialSettings,
      saveGlobalInterstitialSettings,
      cancelInterstitial,
      setInterstitialBlocked,
      showAfterTagPublication,
      recordScreenTransition,
      showAfterDiarySubmission,
    ],
  );

  return (
    <AdsContext.Provider value={contextValue}>{children}</AdsContext.Provider>
  );
};

export const useAds = () => useContext(AdsContext);
