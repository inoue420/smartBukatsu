const test = require("node:test");
const assert = require("node:assert/strict");
const { loadAdSdkBridge } = require("../../scripts/adMobAgeTestHarness.cjs");
const { load, renderHarness, screenHarness, fillImports } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const { resolveAdAgePolicy, createAdTaskQueue } = require("./adAgePolicy");
const { createAdDiagnostics, recordAdDiagnostic, getAdErrorCode } = require("./adDiagnostics");
const idle = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("only a resolved guardian membership proves adulthood; no other role does", () => {
  const base = { uid: "synthetic", profileResolved: true, minimumAgeConfirmed: true };
  assert.equal(resolveAdAgePolicy({ ...base, membershipRole: "guardian" }).audience, "adult");
  for (const role of ["member", "captain", "staff", "admin", "owner", "alumni", undefined]) {
    const value = resolveAdAgePolicy({ ...base, membershipRole: role });
    assert.equal(value.audience, "teen");
    assert.equal(value.requestConfiguration.ageRestrictedTreatment, "teen");
    assert.equal(value.requestConfiguration.maxAdContentRating, "T");
    assert.equal(value.requestOptions.requestNonPersonalizedAdsOnly, true);
    assert.equal(value.consentOptions.tagForUnderAgeOfConsent, true);
  }
});

test("missing/false age confirmation and unresolved or signed-out profiles stay child/G/NPA", () => {
  for (const input of [{}, { uid: "a", membershipRole: "guardian" },
    { uid: "a", profileResolved: true }, { uid: "a", profileResolved: true, minimumAgeConfirmed: false },
    { profileResolved: true, minimumAgeConfirmed: true, membershipRole: "guardian" }]) {
    const value = resolveAdAgePolicy(input);
    assert.equal(value.audience, "unknown");
    assert.equal(value.requestConfiguration.ageRestrictedTreatment, "child");
    assert.equal(value.requestConfiguration.maxAdContentRating, "G");
    assert.equal(value.requestOptions.requestNonPersonalizedAdsOnly, true);
  }
});

test("adult uses T, clears legacy child flags and delegates personalization to SDK consent", () => {
  const value = resolveAdAgePolicy({ uid: "a", profileResolved: true, membershipRole: "guardian" });
  assert.deepEqual(value.requestConfiguration, { ageRestrictedTreatment: "unspecified",
    tagForChildDirectedTreatment: false, tagForUnderAgeOfConsent: false, maxAdContentRating: "T" });
  assert.deepEqual(value.requestOptions, {});
  assert.equal(value.consentOptions.tagForUnderAgeOfConsent, false);
});

test("the installed advertising SDK validates and retains the age treatment of every policy", () => {
  const { validateAdRequestConfiguration } = loadAdSdkBridge();
  for (const input of [{}, { uid: "a", profileResolved: true, minimumAgeConfirmed: true },
    { uid: "a", profileResolved: true, membershipRole: "guardian" }]) {
    const expected = resolveAdAgePolicy(input).requestConfiguration;
    const actual = validateAdRequestConfiguration(expected);
    assert.equal(JSON.stringify(actual), JSON.stringify({ maxAdContentRating: expected.maxAdContentRating,
      ageRestrictedTreatment: expected.ageRestrictedTreatment, tagForChildDirectedTreatment: false, tagForUnderAgeOfConsent: false }));
  }
});

test("global SDK tasks never overlap, and a rejected task does not block the next policy", async () => {
  const run = createAdTaskQueue(), slow = deferred(), events = [];
  const a = run(async () => { events.push("adult-start"); await slow.promise; events.push("adult-end"); throw new Error("synthetic"); });
  const b = run(async () => { events.push("teen"); });
  await tick(); assert.deepEqual(events, ["adult-start"]);
  slow.resolve(); await assert.rejects(a); await b;
  assert.deepEqual(events, ["adult-start", "adult-end", "teen"]);
});

test("the app places advertising inside authentication so SDK setup can read the signed-in profile", () => {
  const h = renderHarness();
  const modules = { react: h.react,
    "react-native": { Platform: { OS: "android" }, LogBox: { ignoreLogs: idle } },
    "react-native-gesture-handler": { GestureHandlerRootView: "Root" },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({}) },
    "./src/AuthContext": { AuthProvider: "AuthProvider" },
    "./src/ads/AdManager": { AdsProvider: "AdsProvider" },
  };
  fillImports("App.js", modules);
  const App = load("App.js", modules).default;
  const tree = h.mount(App);
  assert.equal(tree.children[0].type, "AuthProvider");
  assert.equal(tree.children[0].children[0].type, "AdsProvider"); h.unmount();
});

function managerHarness(overrides = {}, options = {}) {
  const h = renderHarness(), calls = [], timers = new Map(); let timerId = 0;
  let clock = 100000, networkRefreshes = 0;
  const appListeners = new Set(), networkListeners = new Set();
  const appState = { currentState: "active", addEventListener(_event, fn) {
    appListeners.add(fn); return { remove: () => appListeners.delete(fn) };
  } };
  let network = { isConnected: true, isInternetReachable: true };
  let auth = { user: { uid: "synthetic-adult" }, activeTeamId: "a", loading: false,
    adProfileResolved: true, adMinimumAgeConfirmed: true, currentMemberProfile: { role: "guardian" }, ...overrides };
  const sdk = { async setRequestConfiguration(value) { calls.push(["config", value]); if (options.configuration) await options.configuration(value); },
    async initialize() { calls.push(["initialize"]); if (options.initialize) await options.initialize(); } };
  const consent = {
    async gatherConsent(value) { calls.push(["consent", value]); return options.gather ? options.gather(value) :
      { canRequestAds: true, privacyOptionsRequirementStatus: "REQUIRED" }; },
    async getConsentInfo() { calls.push(["cached"]); return options.cached ? options.cached() : { canRequestAds: true, privacyOptionsRequirementStatus: "REQUIRED" }; },
    async showPrivacyOptionsForm() { calls.push(["privacy"]); if (options.privacy) await options.privacy(); },
  };
  const { AdsProvider } = load("src/ads/AdManager.native.js", {
    react: h.react,
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => null, setItem: async () => {} } },
    "react-native": { AppState: appState, Platform: { OS: options.os || "android", select: value => value.android }, StatusBar: { setHidden: idle } },
    "@react-native-community/netinfo": { __esModule: true, default: {
      addEventListener(fn) { networkListeners.add(fn); fn(network); return () => networkListeners.delete(fn); },
      async refresh() { networkRefreshes++; for (const fn of networkListeners) fn(network); return network; },
    } },
    "../firebase": { isCaptureEnvironment: false }, "../AuthContext": { useAuth: () => auth },
    "../services/reviewPresentationGate": { reviewPresentationGate: { acquire: () => idle } },
    "react-native-google-mobile-ads": { __esModule: true, default: () => sdk,
      AgeRestrictedTreatment: options.missingApi ? undefined : { TEEN: "teen" }, AdsConsent: consent,
      TestIds: { BANNER: "synthetic-banner" }, AdEventType: {}, InterstitialAd: {} },
    "./adSettings": require("./adSettings"), "./adAgePolicy": { resolveAdAgePolicy, createAdTaskQueue },
    "./adInitializationRecovery": require("./adInitializationRecovery"),
    "./adDiagnostics": { createAdDiagnostics, recordAdDiagnostic, getAdErrorCode },
  }, "", { __DEV__: !options.production, process: { env: {} }, console: { warn: idle },
    Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: clock + delay, fn }); return id; }, clearTimeout: id => timers.delete(id) });
  h.mount(() => AdsProvider({ children: null }));
  const advance = ms => {
    const end = clock + ms; let count = 0;
    while (true) {
      const next = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++count < 20); timers.delete(next[0]); clock = next[1].at; next[1].fn(); h.render();
    }
    clock = end;
  };
  return { h, calls, timers, appListeners, networkListeners, value: () => h.render().props.value,
    get networkRefreshes() { return networkRefreshes; },
    state(value) { appState.currentState = value; for (const fn of [...appListeners]) fn(value); h.render(); },
    network(value) { network = { isConnected: value, isInternetReachable: value }; for (const fn of [...networkListeners]) fn(network); h.render(); },
    advance,
    change(values) { auth = { ...auth, ...values }; h.update(); },
    async settle() { for (let i = 0; i < 5; i++) { await tick(); h.render(); } },
    retry() { if (timers.size) advance(Math.max(0, Math.min(...[...timers.values()].map(t => t.at)) - clock)); } };
}

for (const role of ["guardian", "member"]) test(`${role}: applies configuration before consent and exposes matching request options`, async () => {
  const a = managerHarness({ currentMemberProfile: { role } });
  assert.equal(a.value().adsInitialized, false); await a.settle();
  assert.equal(a.value().adsInitialized, true);
  assert.equal(a.calls[0][0], "config"); assert.equal(a.calls[1][0], "consent");
  assert.equal(a.calls[0][1].ageRestrictedTreatment, role === "guardian" ? "unspecified" : "teen");
  assert.equal(a.value().requestOptions.requestNonPersonalizedAdsOnly, role === "guardian" ? undefined : true);
  assert.equal(a.value().privacyOptionsRequired, role === "guardian"); a.h.unmount();
});

test("a slow adult consent result cannot enable ads for a teen account", async () => {
  const slow = deferred(); let first = true;
  const a = managerHarness({}, { gather: async () => { if (first) { first = false; return slow.promise; } return { canRequestAds: true }; } });
  await a.settle();
  a.change({ user: { uid: "synthetic-teen" }, currentMemberProfile: { role: "member" } });
  assert.equal(a.value().adsInitialized, false);
  await a.settle(); assert.equal(a.calls.filter(call => call[0] === "config").length, 1);
  slow.resolve({ canRequestAds: true }); await a.settle();
  assert.equal(a.value().adsInitialized, true);
  assert.equal(a.value().requestOptions.requestNonPersonalizedAdsOnly, true);
  assert.equal(a.calls.filter(call => call[0] === "initialize").length, 1);
  assert.equal(a.calls.filter(call => call[0] === "config").at(-1)[1].ageRestrictedTreatment, "teen"); a.h.unmount();
});

test("a pending SDK initialization cannot publish the previous adult's ready state", async () => {
  const slow = deferred(); let first = true;
  const a = managerHarness({}, { initialize: async () => { if (first) { first = false; await slow.promise; } } });
  await a.settle(); a.change({ user: { uid: "synthetic-teen" }, currentMemberProfile: { role: "member" } });
  assert.equal(a.value().adsInitialized, false); slow.resolve(); await a.settle();
  assert.equal(a.value().adsInitialized, true);
  assert.equal(a.value().requestOptions.requestNonPersonalizedAdsOnly, true); a.h.unmount();
});

test("adult -> team switching -> unknown/teen removes readiness immediately and reconfigures", async () => {
  const a = managerHarness(); await a.settle(); assert.equal(a.value().adsInitialized, true);
  a.change({ isTeamSwitching: true }); assert.equal(a.value().adsInitialized, false); await a.settle();
  a.change({ isTeamSwitching: false, activeTeamId: "b", currentMemberProfile: null, adMinimumAgeConfirmed: false });
  await a.settle(); assert.equal(a.calls.filter(call => call[0] === "config").at(-1)[1].maxAdContentRating, "G");
  a.change({ adMinimumAgeConfirmed: true }); assert.equal(a.value().adsInitialized, false);
  await a.settle(); assert.equal(a.value().requestOptions.requestNonPersonalizedAdsOnly, true);
  a.change({ user: null, adProfileResolved: false }); assert.equal(a.value().adsInitialized, false); await a.settle();
  a.h.unmount();
});

test("cached adult consent fallback forces NPA and consent refusal suppresses all ads", async () => {
  const a = managerHarness({}, { gather: async () => { throw new Error("synthetic offline"); } });
  await a.settle(); assert.equal(a.value().adsInitialized, true);
  assert.equal(a.value().requestOptions.requestNonPersonalizedAdsOnly, true); a.h.unmount();
  const b = managerHarness({}, { gather: async () => ({ canRequestAds: false }) }); await b.settle();
  assert.equal(b.value().adsInitialized, false); assert.equal(b.timers.size, 0);
  assert.equal(b.value().diagnostics.retry, "同意確認待ち");
  assert.equal(b.calls.filter(call => call[0] === "initialize").length, 0); b.h.unmount();
});

test("missing age API and invalid configuration fail closed without recovery retries", async () => {
  for (const options of [{ missingApi: true }, { configuration: async () => { throw new Error("synthetic"); } }]) {
    const a = managerHarness({}, options); await a.settle();
    a.retry(); await a.settle(); a.retry(); await a.settle();
    assert.equal(a.value().adsInitialized, false); assert.equal(a.timers.size, 0);
    a.state("background"); a.state("active"); a.network(false); a.network(true); await a.settle();
    assert.equal(a.value().diagnostics.initialAttempts, 1);
    assert.equal(a.calls.filter(call => call[0] === "initialize").length, 0); a.h.unmount();
  }
});

test("privacy form hides ads, ignores duplicate taps and recreates requests after changing consent", async () => {
  const slow = deferred(), a = managerHarness({}, { privacy: () => slow.promise }); await a.settle();
  const key = a.value().adSessionKey, opening = a.value().showPrivacyOptions();
  assert.equal(a.value().adsInitialized, false);
  assert.equal(await a.value().showPrivacyOptions(), false); await a.settle();
  slow.resolve(); assert.equal(await opening, true); await a.settle();
  assert.equal(a.value().adsInitialized, true); assert.notEqual(a.value().adSessionKey, key);
  assert.equal(a.calls.filter(call => call[0] === "privacy").length, 1); a.h.unmount();
});

const networkError = () => Object.assign(new Error("synthetic network failure"), { code: "network-error" });
const countCalls = (a, kind) => a.calls.filter(call => call[0] === kind).length;
async function exhaustInitialization(a) {
  await a.settle(); a.advance(30000); await a.settle(); a.advance(60000); await a.settle();
  assert.equal(a.value().diagnostics.initialAttempts, 3); assert.equal(a.timers.size, 0);
}

for (const os of ["android", "ios"]) test(`${os}: failed initialization resumes once on overlapping network/foreground events`, async () => {
  let attempts = 0;
  const a = managerHarness({}, { os, initialize: async () => { if (++attempts <= 3) throw networkError(); } });
  await exhaustInitialization(a); assert.equal(countCalls(a, "initialize"), 3);
  a.network(false); a.state("background"); a.network(true); a.state("active"); await a.settle();
  assert.equal(a.timers.size, 1); a.advance(59999); await a.settle(); assert.equal(attempts, 3);
  a.advance(1); await a.settle(); assert.equal(a.value().adsInitialized, true); assert.equal(attempts, 4);
  assert.equal(a.value().diagnostics.initialAttempts, 3); assert.equal(a.value().diagnostics.recoveryAttempts, 1);
  a.state("background"); a.state("active"); a.network(false); a.network(true); a.advance(3600000); await a.settle();
  assert.equal(attempts, 4); assert.equal(a.timers.size, 0);
  a.h.unmount(); assert.equal(a.appListeners.size, 0); assert.equal(a.networkListeners.size, 0);
});

test("a recovery failure waits for a new external event rather than restarting startup retries", async () => {
  const a = managerHarness({}, { initialize: async () => { throw networkError(); } });
  await exhaustInitialization(a); a.advance(60000); a.network(false); a.network(true); await a.settle();
  assert.equal(countCalls(a, "initialize"), 4); assert.equal(a.timers.size, 0);
  a.advance(3600000); await a.settle(); assert.equal(countCalls(a, "initialize"), 4); a.h.unmount();
});

test("missing ad IDs and unsupported native SDK errors do not retry on restoration", async () => {
  for (const options of [{ production: true }, { initialize: async () => {
    throw Object.assign(new Error("synthetic unsupported"), { code: "os-version-too-low" });
  } }]) {
    const a = managerHarness({}, options); await a.settle(); const calls = a.calls.length;
    a.advance(3600000); a.network(false); a.network(true); a.state("background"); a.state("active"); await a.settle();
    assert.equal(a.calls.length, calls); assert.equal(a.value().adsInitialized, false); assert.equal(a.timers.size, 0);
    assert.equal(a.value().diagnostics.initialAttempts, 1); a.h.unmount();
  }
});

test("consent blocking only checks on foreground, then resumes SDK initialization when allowed", async () => {
  let allowed = false;
  const a = managerHarness({}, { gather: async () => ({ canRequestAds: allowed }), cached: async () => ({ canRequestAds: allowed }) });
  await a.settle(); assert.equal(a.timers.size, 0); assert.equal(countCalls(a, "config"), 1);
  a.network(false); a.network(true); a.advance(60000); await a.settle(); assert.equal(countCalls(a, "cached"), 0);
  a.state("background"); a.state("active"); await a.settle();
  assert.equal(countCalls(a, "cached"), 1); assert.equal(countCalls(a, "config"), 1);
  allowed = true; a.advance(60000); a.state("background"); a.state("active"); await a.settle();
  assert.equal(a.value().adsInitialized, true); assert.equal(countCalls(a, "initialize"), 1); a.h.unmount();
});

test("network failure during consent retrieval with no usable cache remains recoverable", async () => {
  const a = managerHarness({}, { gather: async () => { throw networkError(); }, cached: async () => ({ canRequestAds: false }) });
  await exhaustInitialization(a); a.network(false); a.network(true); a.advance(60000); await a.settle();
  assert.equal(countCalls(a, "consent"), 4); assert.equal(a.value().diagnostics.recoveryAttempts, 1);
  assert.equal(countCalls(a, "initialize"), 0); a.h.unmount();
});

test("logout and team switching cancel an exhausted session's pending recovery", async () => {
  for (const change of [{ user: null }, { isTeamSwitching: true }]) {
    const a = managerHarness({}, { initialize: async () => { throw networkError(); } });
    await exhaustInitialization(a); a.network(false); a.network(true); assert.equal(a.timers.size, 1);
    a.change(change); await a.settle(); const calls = a.calls.length;
    a.advance(3600000); a.state("background"); a.state("active"); await a.settle();
    assert.equal(a.calls.length, calls); assert.equal(a.timers.size, 0); assert.equal(a.value().adsInitialized, false);
    a.h.unmount();
  }
});

test("banner consent revocation invalidates readiness, and a stale session cannot revoke its replacement", async () => {
  let allowed = true;
  const a = managerHarness({}, { gather: async () => ({ canRequestAds: allowed }) }); await a.settle();
  const oldCallback = a.value().onAdRequestsBlocked; a.change({ activeTeamId: "b" }); await a.settle();
  const key = a.value().adSessionKey; oldCallback(); await a.settle();
  assert.equal(a.value().adSessionKey, key); assert.equal(a.value().adsInitialized, true);
  allowed = false; a.value().onAdRequestsBlocked(); assert.equal(a.value().adsInitialized, false); await a.settle();
  assert.equal(a.value().adsInitialized, false); assert.notEqual(a.value().adSessionKey, key); a.h.unmount();
});

test("unresolved profile, email verification and signed-out state never initialize ads", async () => {
  for (const state of [{ adProfileResolved: false }, { loading: true }, { emailVerificationPending: true }, { user: null }]) {
    const a = managerHarness(state); await a.settle(); assert.equal(a.value().adsInitialized, false);
    assert.equal(a.calls.length, 0); a.h.unmount();
  }
});

test("Settings exposes required privacy choices to ordinary users and reports form failures", async () => {
  let openings = 0;
  const a = screenHarness("SettingsScreen", {}, {}, "ios", { privacyOptionsRequired: true,
    showPrivacyOptions: async () => { openings++; throw new Error("synthetic"); } });
  const button = a.h.find(node => node.type === "TouchableOpacity" && a.h.text(node).includes("広告のプライバシー設定"));
  assert.ok(button); button.props.onPress(); await tick();
  assert.equal(openings, 1); assert.equal(a.alerts.at(-1)[0], "広告のプライバシー設定"); a.h.unmount();
  const b = screenHarness("SettingsScreen", {}, {}, "android", { privacyOptionsRequired: false });
  assert.equal(b.h.find(node => node.type === "TouchableOpacity" && b.h.text(node).includes("広告のプライバシー設定")), undefined);
  b.h.unmount();
});
