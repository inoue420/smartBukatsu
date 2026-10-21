const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");

const code = transformSync(fs.readFileSync(path.join(__dirname, "AppBannerAd.native.js"), "utf8"), {
  configFile: false, babelrc: false,
  plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
}).code;
const flush = () => new Promise(setImmediate);

// Execute the real component; replace only React/native/SDK boundaries. Commit
// refs before effects, including automatic native requests on keyboard remounts.
function mountBanner(options = {}) {
  const slots = [], timers = new Map(), appListeners = new Set(), networkListeners = new Set();
  const keyboardListeners = new Map(), diagnostics = [], failures = [];
  let cursor = 0, dirty = true, effects = [], tree, bannerNode = null, instance = null;
  let clock = 100000, timerId = 0, keyboardVisible = Boolean(options.keyboardVisible);
  let automaticLoads = 0, manualLoads = 0, consentChecks = 0;
  let network = { isConnected: true, isInternetReachable: true };
  let consent = async () => ({ canRequestAds: true });
  const ads = { adsInitialized: true, bannerAdUnitId: "synthetic-banner",
    recordDiagnostic: (...args) => diagnostics.push(args), ...options.ads };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      if (!slots[i].set) slots[i].set = (value) => {
        const next = typeof value === "function" ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      };
      return [slots[i].value, slots[i].set];
    },
    useRef(value) { const i = cursor++; return slots[i] || (slots[i] = { current: value }); },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i]; slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const appState = { currentState: options.appState || "active",
    addEventListener(_event, callback) {
      appListeners.add(callback); return { remove: () => appListeners.delete(callback) };
    } };
  const os = options.os || "ios";
  const modules = {
    react: { __esModule: true, default: react, ...react },
    "react-native": {
      AppState: appState, Platform: { OS: os }, StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
      View: "View", KeyboardAvoidingView: "KeyboardAvoidingView",
      Keyboard: { isVisible: () => keyboardVisible, addListener(event, callback) {
        if (!keyboardListeners.has(event)) keyboardListeners.set(event, new Set());
        keyboardListeners.get(event).add(callback);
        return { remove: () => keyboardListeners.get(event).delete(callback) };
      } },
    },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener(callback) {
      networkListeners.add(callback); callback(network); return () => networkListeners.delete(callback);
    }, refresh() {
      for (const callback of [...networkListeners]) callback(network);
      return Promise.resolve(network);
    } } },
    "react-native-google-mobile-ads": {
      BannerAd: "BannerAd", BannerAdSize: { ANCHORED_ADAPTIVE_BANNER: "adaptive" },
      AdsConsent: { getConsentInfo() { consentChecks++; return consent(); } },
    },
    "./AdManager": { useAds: () => ads, logAdFailure: (...args) => failures.push(args) },
    "./adSettings": { NON_PERSONALIZED_AD_REQUEST_OPTIONS: { requestNonPersonalizedAdsOnly: true } },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) {
    assert.ok(modules[name], `Unexpected import: ${name}`); return modules[name];
  }, Date: class extends Date { static now() { return clock; } },
  setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; },
  clearTimeout: (id) => timers.delete(id), console });
  const findBanner = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "BannerAd") return node;
    for (const child of node.children || []) { const found = findBanner(child); if (found) return found; }
    return null;
  };
  const render = () => {
    let passes = 0;
    while (dirty) {
      assert.ok(++passes < 12, "banner render/effects must settle");
      dirty = false; cursor = 0; effects = [];
      tree = module.exports.default();
      const next = findBanner(tree);
      if (bannerNode && (!next || next.props.unitId !== bannerNode.props.unitId)) {
        bannerNode.props.ref(null); instance = null;
      }
      if (next && !instance) {
        instance = { load() { manualLoads++; if (options.throwOnLoad) throw new Error("synthetic-load-failure"); } };
        automaticLoads++; next.props.ref(instance);
      }
      bannerNode = next;
      effects.forEach((run) => run());
    }
  };
  const h = {
    render, timers, diagnostics, failures, ads, appListeners, networkListeners, keyboardListeners,
    get banner() { return bannerNode; },
    get automaticLoads() { return automaticLoads; },
    get manualLoads() { return manualLoads; },
    get consentChecks() { return consentChecks; },
    setConsent(fn) { consent = fn; },
    async settle() { await flush(); render(); },
    loaded() { assert.ok(bannerNode); bannerNode.props.onAdLoaded(); render(); },
    failed() { assert.ok(bannerNode); bannerNode.props.onAdFailedToLoad({ code: "network-error" }); render(); },
    state(value) { appState.currentState = value; for (const callback of [...appListeners]) callback(value); render(); },
    network(connected, reachable = connected) {
      network = { isConnected: connected, isInternetReachable: reachable };
      for (const callback of [...networkListeners]) callback(network);
      render();
    },
    setNativeNetwork(connected, reachable = connected) {
      network = { isConnected: connected, isInternetReachable: reachable };
    },
    keyboard(visible) {
      if (os === "ios") h.keyboardEvent(`keyboardWill${visible ? "Show" : "Hide"}`);
      h.keyboardEvent(`keyboardDid${visible ? "Show" : "Hide"}`);
    },
    keyboardEvent(event) {
      // RN updates Keyboard.isVisible on Did events, after the Will events.
      if (event === "keyboardDidShow") keyboardVisible = true;
      if (event === "keyboardDidHide") keyboardVisible = false;
      for (const callback of keyboardListeners.get(event) || []) callback();
      render();
    },
    setKnownKeyboard(visible) { keyboardVisible = visible; },
    updateAds(changes) { Object.assign(ads, changes); dirty = true; render(); },
    advance(milliseconds) {
      const end = clock + milliseconds;
      let steps = 0;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++steps < 20, "recovery must not poll or refresh periodically");
        clock = next[1].at; timers.delete(next[0]); next[1].callback(); render();
      }
      clock = end;
    },
    unmount() {
      bannerNode?.props.ref(null); bannerNode = null; instance = null;
      slots.forEach((slot) => slot?.cleanup?.());
    },
  };
  render(); return h;
}

for (const states of [["background", "active"], ["inactive", "background", "inactive", "active"]]) {
  test(`iOS: ${states.join(" -> ")} reloads the existing banner once`, async () => {
    const h = mountBanner(); h.loaded(); h.advance(30000);
    const originalRef = h.banner.props.ref;
    states.forEach((state) => h.state(state)); await h.settle();
    assert.equal(h.manualLoads, 1); assert.equal(h.automaticLoads, 1);
    assert.equal(h.banner.props.ref, originalRef);
    assert.equal(h.banner.props.requestOptions.requestNonPersonalizedAdsOnly, true);
    assert.equal(h.banner.props.size, "adaptive");
    h.state("active"); await h.settle(); assert.equal(h.manualLoads, 1);
    h.unmount();
  });
}

test("iOS: inactive-only transitions do not request ads", async () => {
  const h = mountBanner(); h.loaded(); h.advance(30000);
  h.state("inactive"); h.state("active"); await h.settle();
  assert.equal(h.manualLoads, 0); assert.equal(h.consentChecks, 0); assert.equal(h.timers.size, 0);
});

test("iOS: rapid returns coalesce into one deferred recovery and no periodic refresh", async () => {
  const h = mountBanner(); h.loaded();
  for (let i = 0; i < 3; i++) { h.advance(1000); h.state("background"); h.state("active"); }
  assert.equal(h.timers.size, 1); assert.equal(h.manualLoads, 0);
  h.advance(26999); await h.settle(); assert.equal(h.manualLoads, 0);
  h.advance(1); await h.settle(); assert.equal(h.manualLoads, 1);
  h.loaded(); h.advance(3600000); await h.settle();
  assert.equal(h.manualLoads, 1); assert.equal(h.timers.size, 0);
});

test("iOS: initial and manual loads suppress overlapping foreground requests", async () => {
  const h = mountBanner(); h.advance(30000); h.state("background"); h.state("active");
  await h.settle(); assert.equal(h.manualLoads, 0);
  h.loaded(); h.advance(30000); h.state("background"); h.state("active"); await h.settle();
  assert.equal(h.manualLoads, 1);
  h.advance(30000); h.state("background"); h.state("active"); await h.settle();
  assert.equal(h.manualLoads, 1); assert.equal(h.timers.size, 0);
  h.loaded(); h.advance(30000); await h.settle(); assert.equal(h.manualLoads, 1);
});

test("iOS: a successful SDK refresh satisfies pending foreground recovery", async () => {
  const h = mountBanner(); h.loaded(); h.state("background"); h.state("active");
  assert.equal(h.timers.size, 1); h.advance(1000); h.loaded();
  h.advance(60000); await h.settle(); assert.equal(h.manualLoads, 0); assert.equal(h.timers.size, 0);
});

test("iOS: offline return waits for reachable network; duplicate network events do not reload", async () => {
  const h = mountBanner(); h.loaded(); h.advance(30000); h.network(false);
  h.state("background"); h.state("active"); await h.settle();
  assert.equal(h.manualLoads, 0); assert.equal(h.timers.size, 0);
  h.network(true, false); await h.settle(); assert.equal(h.manualLoads, 0);
  h.network(true); h.network(true); await h.settle(); assert.equal(h.manualLoads, 1);
});

test("iOS: a failed ad recovers once on reconnect, while a healthy ad stays unchanged", async () => {
  const h = mountBanner(); h.network(false); h.failed(); h.advance(30000);
  h.network(true); await h.settle(); assert.equal(h.manualLoads, 1);
  h.loaded(); h.network(false); h.advance(30000); h.network(true); await h.settle();
  assert.equal(h.manualLoads, 1);
});

test("iOS: foreground refreshes stale offline status after an unreported background network change", async () => {
  const h = mountBanner(); h.loaded(); h.network(false); h.state("background"); h.advance(60000);
  h.setNativeNetwork(true); h.state("active"); await h.settle();
  assert.equal(h.manualLoads, 1);
});

test("iOS: a reconnect in background does not load until foreground", async () => {
  const h = mountBanner(); h.failed(); h.network(false); h.state("background"); h.advance(30000);
  h.network(true); await h.settle(); assert.equal(h.manualLoads, 0);
  h.state("active"); await h.settle(); assert.equal(h.manualLoads, 1);
});

test("iOS: a failed initial request after foreground gets one recovery; recovery failures do not loop", async () => {
  const h = mountBanner(); h.state("background"); h.state("active"); h.failed();
  assert.equal(h.timers.size, 1); h.advance(30000); await h.settle(); assert.equal(h.manualLoads, 1);
  h.failed(); h.advance(3600000); await h.settle(); assert.equal(h.manualLoads, 1); assert.equal(h.timers.size, 0);
});

test("iOS: consent denial blocks recovery, then a later return can use updated consent", async () => {
  const h = mountBanner(); h.loaded(); h.advance(30000);
  h.setConsent(async () => ({ canRequestAds: false })); h.state("background"); h.state("active"); await h.settle();
  assert.equal(h.manualLoads, 0); assert.equal(h.timers.size, 0);
  assert.ok(h.diagnostics.some(([event]) => event === "consent-blocked"));
  h.setConsent(async () => ({ canRequestAds: true })); h.state("background"); h.state("active"); await h.settle();
  assert.equal(h.manualLoads, 1);
  assert.equal(h.diagnostics.filter(([event]) => event.startsWith("consent-")).at(-1)[0], "consent-allowed");
});

test("iOS: consent errors and synchronous native load errors settle without retry loops", async () => {
  for (const throwOnLoad of [false, true]) {
    const h = mountBanner({ throwOnLoad }); h.loaded(); h.advance(30000);
    if (!throwOnLoad) h.setConsent(async () => { throw new Error("synthetic-consent-failure"); });
    h.state("background"); h.state("active"); await h.settle();
    assert.equal(h.manualLoads, throwOnLoad ? 1 : 0); assert.equal(h.failures.length, 1);
    assert.ok(h.diagnostics.some(([event]) => event === (throwOnLoad ? "banner-error" : "consent-cache-error")));
    h.advance(3600000); await h.settle(); assert.equal(h.timers.size, 0); assert.equal(h.failures.length, 1);
  }
});

test("iOS: consent checks are serialized and a late success from an SDK refresh prevents a manual load", async () => {
  const h = mountBanner(); h.loaded(); h.advance(30000);
  let resolveConsent; h.setConsent(() => new Promise((resolve) => { resolveConsent = resolve; }));
  h.state("background"); h.state("active"); h.network(false); h.network(true);
  assert.equal(h.consentChecks, 1); h.loaded(); resolveConsent({ canRequestAds: true }); await h.settle();
  assert.equal(h.manualLoads, 0);
});

test("iOS: a native failure during consent checking defers pending recovery instead of losing it", async () => {
  const h = mountBanner(); h.loaded(); h.advance(30000);
  let resolveConsent;
  const consent = new Promise((resolve) => { resolveConsent = resolve; });
  h.setConsent(() => consent); h.state("background"); h.state("active"); h.failed();
  resolveConsent({ canRequestAds: true }); await h.settle();
  assert.equal(h.manualLoads, 0); assert.equal(h.timers.size, 1);
  h.advance(30000); await h.settle(); assert.equal(h.manualLoads, 1);
});

for (const action of ["unmount", "background", "keyboard", "sdk-disabled", "unit-removed"]) {
  test(`iOS: pending async consent cannot load after ${action}`, async () => {
    const h = mountBanner(); h.loaded(); h.advance(30000);
    let resolveConsent; h.setConsent(() => new Promise((resolve) => { resolveConsent = resolve; }));
    h.state("background"); h.state("active");
    if (action === "unmount") h.unmount();
    if (action === "background") h.state("background");
    if (action === "keyboard") h.keyboard(true);
    if (action === "sdk-disabled") h.updateAds({ adsInitialized: false });
    if (action === "unit-removed") h.updateAds({ bannerAdUnitId: null });
    resolveConsent({ canRequestAds: true }); await h.settle(); assert.equal(h.manualLoads, 0);
  });
}

for (const os of ["ios", "android"]) {
  test(`${os}: keyboard hides the banner and closing it makes only one automatic request`, async () => {
    const h = mountBanner({ os }); h.loaded(); h.keyboard(true); assert.equal(h.banner, null);
    h.advance(60000); h.state("background"); h.state("active"); await h.settle(); assert.equal(h.manualLoads, 0);
    h.keyboard(false); assert.ok(h.banner); assert.equal(h.automaticLoads, 2);
    h.loaded(); h.advance(60000); await h.settle(); assert.equal(h.manualLoads, 0);
  });
  for (const ads of [{ adsInitialized: false }, { bannerAdUnitId: null }]) {
    test(`${os}: missing SDK initialization or unit ID suppresses the banner and recovery`, async () => {
      const h = mountBanner({ os, ads }); h.advance(60000); h.state("background"); h.state("active"); await h.settle();
      assert.equal(h.banner, null); assert.equal(h.automaticLoads, 0); assert.equal(h.manualLoads, 0);
      assert.equal(h.consentChecks, 0); assert.equal(h.timers.size, 0);
    });
  }
}

test("iOS: closing the keyboard in background is reconciled on return without a duplicate request", async () => {
  const h = mountBanner(); h.loaded(); h.keyboard(true); h.state("background"); h.advance(60000);
  h.setKnownKeyboard(false); h.state("active"); await h.settle();
  assert.ok(h.banner); assert.equal(h.automaticLoads, 2); assert.equal(h.manualLoads, 0);
});

test("iOS: returning while the keyboard opens keeps the banner hidden until the keyboard closes", async () => {
  const h = mountBanner(); h.loaded(); h.advance(30000);
  h.keyboardEvent("keyboardWillShow"); assert.equal(h.banner, null);
  h.state("background"); h.state("active"); await h.settle();
  assert.equal(h.banner, null); assert.equal(h.automaticLoads, 1);
  h.keyboardEvent("keyboardDidShow"); assert.equal(h.banner, null);
  h.keyboard(false); assert.ok(h.banner); assert.equal(h.automaticLoads, 2);
  assert.equal(h.manualLoads, 0);
});

test("iOS: returning while the keyboard closes preserves the one new banner mount", async () => {
  const h = mountBanner({ keyboardVisible: true }); assert.equal(h.banner, null);
  h.keyboardEvent("keyboardWillHide"); assert.ok(h.banner);
  h.state("background"); h.state("active"); await h.settle();
  h.keyboardEvent("keyboardDidHide"); assert.ok(h.banner);
  assert.equal(h.automaticLoads, 1); assert.equal(h.manualLoads, 0);
});

test("iOS: a keyboard DidHide without WillHide still restores the banner", () => {
  const h = mountBanner({ keyboardVisible: true });
  h.keyboardEvent("keyboardDidHide"); assert.ok(h.banner);
  assert.equal(h.automaticLoads, 1); assert.equal(h.manualLoads, 0);
});

test("iOS: SDK initialization after return uses the first mount, not another foreground load", async () => {
  const h = mountBanner({ ads: { adsInitialized: false } }); h.state("background"); h.state("active");
  h.updateAds({ adsInitialized: true }); h.loaded(); h.advance(60000); await h.settle();
  assert.equal(h.automaticLoads, 1); assert.equal(h.manualLoads, 0);
});

test("Android: background and reconnect events add no manual ad requests", async () => {
  const h = mountBanner({ os: "android" }); h.failed(); h.network(false); h.advance(60000);
  h.state("background"); h.state("active"); h.network(true); await h.settle();
  assert.equal(h.manualLoads, 0); assert.equal(h.consentChecks, 0);
  assert.equal(h.appListeners.size, 0); assert.equal(h.networkListeners.size, 0);
});

test("iOS: unmount removes listeners and a queued recovery timer", async () => {
  const h = mountBanner(); h.loaded(); h.state("background"); h.state("active");
  assert.equal(h.timers.size, 1); h.unmount();
  assert.equal(h.timers.size, 0); assert.equal(h.appListeners.size, 0); assert.equal(h.networkListeners.size, 0);
  for (const listeners of h.keyboardListeners.values()) assert.equal(listeners.size, 0);
  h.advance(60000); await h.settle(); assert.equal(h.manualLoads, 0);
});
