import React from "react";

const webAds = {
  adsInitialized: false,
  bannerAdUnitId: null,
  recordScreenTransition: async () => false,
  showAfterDiarySubmission: async () => false,
  configureInterstitial: () => {},
};

export const AdsProvider = ({ children }) => children;

export const useAds = () => webAds;
