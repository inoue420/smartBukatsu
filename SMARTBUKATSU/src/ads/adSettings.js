export const INTERSTITIAL_ADS_ENABLED = false;

export const ADS_REQUEST_CONFIGURATION = Object.freeze({
  tagForChildDirectedTreatment: true,
  tagForUnderAgeOfConsent: true,
});

export const NON_PERSONALIZED_AD_REQUEST_OPTIONS = Object.freeze({
  requestNonPersonalizedAdsOnly: true,
});

export const DEFAULT_INTERSTITIAL_SETTINGS = Object.freeze({
  navigationInterval: 30,
  dailyLimit: 1,
});

export const INTERSTITIAL_NAVIGATION_INTERVAL_MIN = 5;
export const INTERSTITIAL_NAVIGATION_INTERVAL_MAX = 30;
export const INTERSTITIAL_DAILY_LIMIT_MIN = 1;
export const INTERSTITIAL_DAILY_LIMIT_MAX = 10;

const clampInteger = (value, fallback, min, max) => {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsedValue)));
};

export const normalizeInterstitialSettings = (settings = {}) => ({
  navigationInterval: clampInteger(
    settings.navigationInterval,
    DEFAULT_INTERSTITIAL_SETTINGS.navigationInterval,
    INTERSTITIAL_NAVIGATION_INTERVAL_MIN,
    INTERSTITIAL_NAVIGATION_INTERVAL_MAX,
  ),
  dailyLimit: clampInteger(
    settings.dailyLimit,
    DEFAULT_INTERSTITIAL_SETTINGS.dailyLimit,
    INTERSTITIAL_DAILY_LIMIT_MIN,
    INTERSTITIAL_DAILY_LIMIT_MAX,
  ),
});

export const getInterstitialSettingsFromTeamData = (teamAdSettings) =>
  normalizeInterstitialSettings({
    navigationInterval: teamAdSettings?.interstitialNavigationInterval,
    dailyLimit: teamAdSettings?.interstitialDailyLimit,
  });

export const getTeamAdSettingsForSave = (settings) => {
  const normalizedSettings = normalizeInterstitialSettings(settings);
  return {
    interstitialNavigationInterval: normalizedSettings.navigationInterval,
    interstitialDailyLimit: normalizedSettings.dailyLimit,
  };
};
