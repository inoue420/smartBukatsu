import React from "react";

const webAds = {
  adsInitialized: false,
  bannerAdUnitId: null,
  recordScreenTransition: () => {},
  showAfterDiarySubmission: () => {},
  configureInterstitial: () => {},
};

export const AdsProvider = ({ children }) => children;

export const useAds = () => webAds;
