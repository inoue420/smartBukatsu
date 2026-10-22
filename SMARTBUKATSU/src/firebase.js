import { initializeApp, getApps } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  connectAuthEmulator,
} from "firebase/auth";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Application from "expo-application";
import { resolveCaptureEnvironment } from "./config/captureEnvironment";

const capture = resolveCaptureEnvironment(Constants.expoConfig?.extra, typeof __DEV__ !== "undefined" && __DEV__, Application.applicationId);
export const isCaptureEnvironment = Boolean(capture);

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
const appName = capture ? capture.appName : "[DEFAULT]";
const existingApp = getApps().find((item) => item.name === appName);
const app = existingApp || (capture ? initializeApp(firebaseConfig, appName) : initializeApp(firebaseConfig));
// A failed partial initialization must never silently reuse unconnected services.
const captureConnections = globalThis.__smartbukatsuCaptureConnections || (globalThis.__smartbukatsuCaptureConnections = new WeakSet());
if (capture && existingApp && !captureConnections.has(app)) {
  throw new Error("撮影環境の初期化が未完了です。開発版を完全に終了して再起動してください。");
}

// 各サービスをエクスポート

let auth;

try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
} catch (error) {
  auth = getAuth(app);
}

export { auth };

export const db = getFirestore(app);
export const cloudFunctions = getFunctions(app, "asia-northeast1");
export const storage = getStorage(app);

if (capture && !existingApp) {
  connectAuthEmulator(auth, `http://${capture.host}:${capture.ports.auth}`, { disableWarnings: true });
  connectFirestoreEmulator(db, capture.host, capture.ports.firestore);
  connectFunctionsEmulator(cloudFunctions, capture.host, capture.ports.functions);
  connectStorageEmulator(storage, capture.host, capture.ports.storage);
  captureConnections.add(app);
}
