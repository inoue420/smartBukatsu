// Shared, dependency-free validation for app config, runtime, and local tools.
const CAPTURE_PROJECT = "demo-smartbukatsu-capture";
const CAPTURE_PORTS = Object.freeze({ auth: 9098, firestore: 8185, functions: 5003, storage: 9198, metro: 8083, assets: 8766 });
const CAPTURE_PACKAGE = "com.sharprise.smartbukatsu.dev";

function captureConfigEnabled(env) {
  if (env.SMARTBUKATSU_CAPTURE !== undefined && !["0", "1"].includes(env.SMARTBUKATSU_CAPTURE)) {
    throw new Error("SMARTBUKATSU_CAPTURE must be 0 or 1.");
  }
  if (env.SMARTBUKATSU_CAPTURE !== "1") return false;
  if (env.APP_VARIANT !== "development" || env.EXPO_NO_DOTENV !== "1" || env.EAS_BUILD === "true") {
    throw new Error("Capture requires local development and EXPO_NO_DOTENV=1. EAS builds are not supported.");
  }
  return true;
}

function captureFirebaseConfig() {
  return { firebaseApiKey: "capture-emulator-only", authDomain: `${CAPTURE_PROJECT}.firebaseapp.com`,
    projectId: CAPTURE_PROJECT, storageBucket: `${CAPTURE_PROJECT}.appspot.com`,
    messagingSenderId: "000000000000", appId: "1:000000000000:android:capture", measurementId: undefined };
}

function resolveCaptureEnvironment(extra = {}, development = false, applicationId = "") {
  const marked = extra.captureMode !== undefined && extra.captureMode !== false;
  if (!marked) {
    if (String(extra.projectId || "").startsWith("demo-")) throw new Error("Demo project requires explicit capture mode.");
    return null;
  }
  const expected = captureFirebaseConfig();
  if (extra.captureMode !== true || !development || applicationId !== CAPTURE_PACKAGE ||
      Object.keys(expected).some((key) => key !== "measurementId" && extra[key] !== expected[key])) {
    throw new Error("撮影環境の設定が不正です。通常環境へは接続しません。開発版を再起動してください。");
  }
  return Object.freeze({ projectId: CAPTURE_PROJECT, host: "127.0.0.1", ports: CAPTURE_PORTS, appName: "smartbukatsu-capture" });
}

function assertLocalBackend(env) {
  if (env.GCLOUD_PROJECT !== CAPTURE_PROJECT || env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${CAPTURE_PORTS.firestore}` ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${CAPTURE_PORTS.auth}` ||
      env.FIREBASE_STORAGE_EMULATOR_HOST !== `127.0.0.1:${CAPTURE_PORTS.storage}`) {
    throw new Error("Capture backend requires the fixed local demo emulators.");
  }
}

module.exports = { CAPTURE_PROJECT, CAPTURE_PORTS, CAPTURE_PACKAGE, captureConfigEnabled,
  captureFirebaseConfig, resolveCaptureEnvironment, assertLocalBackend };
