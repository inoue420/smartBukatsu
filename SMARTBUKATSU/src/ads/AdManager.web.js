import React from "react";

const webAds = {
  adsInitialized: false,
  bannerAdUnitId: null,
  recordScreenTransition: async () => false,
  showAfterDiarySubmission: async () => false,
  configureInterstitial: () => {},
  cancelInterstitial: () => {},
  setInterstitialBlocked: () => {},
  showAfterTagPublication: async () => false,
  interstitialSettings: null,
  refreshInterstitialSettings: async () => false,
  saveGlobalInterstitialSettings: async () => { throw new Error("この環境では変更できません。"); },
  privacyOptionsRequired: false,
  showPrivacyOptions: async () => false,
  onAdRequestsBlocked: () => {},
};

export const AdsProvider = ({ children }) => children;

export const useAds = () => webAds;
