import React from "react";

const webAds = {
  adsInitialized: false,
  bannerAdUnitId: null,
  recordScreenTransition: async () => false,
  showAfterDiarySubmission: async () => false,
  configureInterstitial: () => {},
  privacyOptionsRequired: false,
  showPrivacyOptions: async () => false,
  onAdRequestsBlocked: () => {},
};

export const AdsProvider = ({ children }) => children;

export const useAds = () => webAds;
