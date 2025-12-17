// src/firebase.js
import { initializeApp } from 'firebase/app';
import { initializeFirestore } from 'firebase/firestore';
import Constants from 'expo-constants';

const extra =
  (Constants.expoConfig && Constants.expoConfig.extra) ||
  (Constants.manifest && Constants.manifest.extra) ||
  {};

const firebaseConfig = {
  apiKey: extra.firebaseApiKey,
  authDomain: extra.authDomain,
  projectId: extra.projectId,
  storageBucket: extra.storageBucket,
  messagingSenderId: extra.messagingSenderId,
  appId: extra.appId,
  measurementId: extra.measurementId,
};

const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  // まだ WARN が出続ける場合は下も試すと改善することがあります
  // useFetchStreams: false,
});