import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import Constants from "expo-constants";

/**
 * app.config.js の extra で定義された名前と
 * ピッタリ一致させる必要があります。
 */
const firebaseConfig = {
  apiKey: Constants.expoConfig.extra.firebaseApiKey,
  authDomain: Constants.expoConfig.extra.authDomain,
  projectId: Constants.expoConfig.extra.projectId,
  storageBucket: Constants.expoConfig.extra.storageBucket,
  messagingSenderId: Constants.expoConfig.extra.messagingSenderId,
  appId: Constants.expoConfig.extra.appId,
  measurementId: Constants.expoConfig.extra.measurementId,
};

// Firebase アプリの初期化
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// 各サービスをエクスポート
export const db = getFirestore(app);
export const auth = getAuth(app);
