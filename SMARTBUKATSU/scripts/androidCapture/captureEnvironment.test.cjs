"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");
const guard = require("../../src/config/captureEnvironment");
const root = path.resolve(__dirname, "../..");
const extra = () => ({ ...guard.captureFirebaseConfig(), captureMode: true });
const env = () => ({ SMARTBUKATSU_CAPTURE: "1", APP_VARIANT: "development", EXPO_NO_DOTENV: "1" });

test("capture requires explicit local development, dotenv isolation, and no EAS", () => {
  assert.equal(guard.captureConfigEnabled(env()), true);
  assert.equal(guard.captureConfigEnabled({}), false);
  for (const patch of [{ SMARTBUKATSU_CAPTURE: "true" }, { APP_VARIANT: "production" }, { APP_VARIANT: "preview" },
    { EXPO_NO_DOTENV: "0" }, { EAS_BUILD: "true" }]) assert.throws(() => guard.captureConfigEnabled({ ...env(), ...patch }));
});

test("runtime refuses release builds, regular package, malformed mode, or any live Firebase configuration", () => {
  assert.equal(guard.resolveCaptureEnvironment(extra(), true, guard.CAPTURE_PACKAGE).host, "127.0.0.1");
  assert.equal(guard.resolveCaptureEnvironment({ projectId: "regular-project" }, false, "regular.app"), null);
  assert.throws(() => guard.resolveCaptureEnvironment(extra(), false, guard.CAPTURE_PACKAGE));
  assert.throws(() => guard.resolveCaptureEnvironment(extra(), true, "com.sharprise.smartbukatsu"));
  for (const key of ["projectId", "firebaseApiKey", "authDomain", "storageBucket", "appId"]) {
    assert.throws(() => guard.resolveCaptureEnvironment({ ...extra(), [key]: "unexpected-live-setting" }, true, guard.CAPTURE_PACKAGE));
  }
  for (const mode of ["true", 1, null]) assert.throws(() => guard.resolveCaptureEnvironment({ ...extra(), captureMode: mode }, true, guard.CAPTURE_PACKAGE));
  assert.throws(() => guard.resolveCaptureEnvironment(guard.captureFirebaseConfig(), true, guard.CAPTURE_PACKAGE));
});

test("backend rejects real project, remote hosts, and missing emulator services", () => {
  const local = { GCLOUD_PROJECT: guard.CAPTURE_PROJECT, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8185",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9098", FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9198" };
  guard.assertLocalBackend(local);
  for (const key of Object.keys(local)) assert.throws(() => guard.assertLocalBackend({ ...local, [key]: "wrong" }));
});

test("capture app config never reads dotenv or retains real Firebase/Maps/AdMob values", () => {
  const source = fs.readFileSync(path.join(root, "app.config.js"), "utf8");
  let dotenvCalls = 0;
  const module = { exports: {} };
  const environment = { ...env(), EXPO_PUBLIC_FIREBASE_PROJECT_ID: "live-must-not-survive",
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: "live-must-not-survive", EXPO_PUBLIC_ADMOB_ANDROID_APP_ID: "live-must-not-survive" };
  const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json")));
  vm.runInNewContext(source, { module, process: { env: environment }, __dirname: root, require(name) {
    if (name === "path") return path;
    if (name === "dotenv-flow") return { config() { dotenvCalls++; throw new Error("dotenv accessed"); } };
    if (name === "dotenv-expand") return { expand() { throw new Error("dotenv accessed"); } };
    if (name === "./app.json") return appJson;
    if (name === "./src/config/captureEnvironment") return guard;
    throw new Error(`Unexpected module ${name}`);
  } });
  const config = module.exports({ config: {} });
  assert.equal(dotenvCalls, 0);
  assert.equal(config.android.package, guard.CAPTURE_PACKAGE);
  assert.equal(config.extra.projectId, guard.CAPTURE_PROJECT);
  assert.equal(config.extra.captureMode, true);
  assert(!JSON.stringify(config).includes("live-must-not-survive"));
});

test("capture push paths return before accessing notification, storage, or remote APIs", async () => {
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync(path.join(root, "src/services/notificationService.js"), "utf8"), {
    configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
  }).code;
  const blocked = new Proxy({}, { get() { throw new Error("external API accessed"); } });
  vm.runInNewContext(code, { module, exports: module.exports, Map, Set, require(name) {
    if (name === "../firebase") return { isCaptureEnvironment: true };
    if (name === "react-native") return { Platform: blocked };
    if (name === "../notifications/notificationConfig") return {};
    if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: blocked };
    if (name === "expo-notifications") return { getExpoPushTokenAsync: () => { throw new Error("external API accessed"); } };
    if (name === "firebase/functions") return { httpsCallable: () => { throw new Error("external API accessed"); } };
    return {};
  } });
  assert.equal((await module.exports.registerPushToken({ requestPermission: true })).reason, "capture-local-only");
  assert.equal((await module.exports.ensurePushTokenOwnership()).reason, "capture-local-only");
  await module.exports.unregisterPushTokenForCurrentDevice();
});

test("Firebase wires all four emulators before exporting a usable capture app; Fast Refresh reuses it", () => {
  const source = transformSync(fs.readFileSync(path.join(root, "src/firebase.js"), "utf8"), {
    configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
  }).code;
  const apps = [], calls = [], globalState = {};
  const load = () => {
    const module = { exports: {} };
    const services = Object.fromEntries(["firestore", "functions", "storage", "auth"].map((name) => [name, {}]));
    const modules = {
      "firebase/app": { getApps: () => apps, initializeApp: (config, name) => { const app = { name, options: config }; apps.push(app); return app; } },
      "firebase/auth": { initializeAuth: () => services.auth, getAuth: () => services.auth, getReactNativePersistence: () => ({}), connectAuthEmulator: () => calls.push("auth") },
      "firebase/firestore": { getFirestore: () => services.firestore, connectFirestoreEmulator: () => calls.push("firestore") },
      "firebase/functions": { getFunctions: () => services.functions, connectFunctionsEmulator: () => calls.push("functions") },
      "firebase/storage": { getStorage: () => services.storage, connectStorageEmulator: () => calls.push("storage") },
      "expo-constants": { __esModule: true, default: { expoConfig: { extra: extra() } } },
      "expo-application": { applicationId: guard.CAPTURE_PACKAGE },
      "@react-native-async-storage/async-storage": {}, "./config/captureEnvironment": guard,
    };
    vm.runInNewContext(source, { module, exports: module.exports, __DEV__: true, globalThis: globalState, WeakSet, require: (name) => modules[name] });
    return module.exports;
  };
  assert.equal(load().isCaptureEnvironment, true);
  assert.deepEqual(calls, ["auth", "firestore", "functions", "storage"]);
  load(); assert.equal(apps.length, 1); assert.equal(calls.length, 4);
  globalState.__smartbukatsuCaptureConnections = new WeakSet();
  assert.throws(load, /初期化が未完了/);
});

test("capture AdProvider does not initialize consent, ads, or native network requests", () => {
  const module = { exports: {} };
  const forbidden = () => { throw new Error("Advertising API called during capture"); };
  const react = { createContext: () => ({ Provider: "provider" }), createElement: () => null,
    useState: (value) => [typeof value === "function" ? value() : value, () => {}],
    useRef: (value) => ({ current: value }), useCallback: (value) => value, useMemo: (fn) => fn(),
    useEffect: (fn) => fn(), useContext: () => ({}) };
  const source = transformSync(fs.readFileSync(path.join(root, "src/ads/AdManager.native.js"), "utf8"), {
    configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
  }).code;
  vm.runInNewContext(source, { module, exports: module.exports, __DEV__: true, process: { env: {} },
    Date, console, require(name) {
      if (name === "react") return { __esModule: true, default: react, ...react };
      if (name === "../firebase") return { isCaptureEnvironment: true };
      if (name === "react-native") return { Platform: { OS: "android", select: (value) => value.android }, StatusBar: {} };
      if (name === "react-native-google-mobile-ads") return { __esModule: true, default: forbidden,
        TestIds: { BANNER: "test", INTERSTITIAL: "test" }, InterstitialAd: { createForAdRequest: forbidden }, AdsConsent: { gatherConsent: forbidden } };
      if (name === "./adSettings") return { INTERSTITIAL_ADS_ENABLED: true, DEFAULT_INTERSTITIAL_SETTINGS: {} };
      if (name === "./adDiagnostics") return { createAdDiagnostics: () => ({}) };
      if (name === "@react-native-async-storage/async-storage") return { __esModule: true, default: { getItem: forbidden } };
      throw new Error(name);
    } });
  module.exports.AdsProvider({ children: null });
});
