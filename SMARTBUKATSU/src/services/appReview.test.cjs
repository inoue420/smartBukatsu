const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");
const { DAY_MS, createReviewHistory } = require("./appReviewPolicy");
const { createPresentationGate } = require("./reviewPresentationGate");
const root = path.join(__dirname, "../..");
const flush = () => new Promise(setImmediate);

function environment() {
  const stored = new Map();
  let clock = new Date(2026, 9, 1, 12).getTime(), calls = 0;
  const start = clock;
  const storage = { getItem: async key => stored.get(key), setItem: async (key, value) => stored.set(key, value) };
  const history = createReviewHistory({ storage, now: () => clock });
  return { stored, storage, history, get calls() { return calls; },
    day(day) { clock = start + day * DAY_MS; },
    use: (uid = "synthetic-user") => history.recordUse(uid),
    attempt: (safe = () => true, available = async () => true, request = async () => { calls++; }) =>
      history.attempt("synthetic-user", safe, request, available),
    async ready() { for (const day of [0, 1, 7]) { this.day(day); await this.use(); } },
  };
}

test("requires seven full days and three distinct use days, with same-day opens deduplicated", async () => {
  const e = environment();
  await e.use(); await e.use(); e.day(6); await e.use();
  assert.equal(await e.attempt(), false);
  e.day(7); assert.equal(await e.attempt(), false);
  await e.use(); assert.equal(await e.attempt(), true);
  assert.equal(e.calls, 1);
});

test("120-day cooldown and rolling 365-day cap survive controller recreation", async () => {
  const e = environment(); await e.ready(); assert.equal(await e.attempt(), true);
  e.day(126); await e.use(); assert.equal(await e.attempt(), false);
  e.day(127); await e.use(); assert.equal(await e.attempt(), true);
  e.day(247); await e.use(); assert.equal(await e.attempt(), true);
  e.day(367); await e.use(); assert.equal(await e.attempt(), false);
  e.day(372); await e.use();
  const reloaded = createReviewHistory({ storage: e.storage,
    now: () => new Date(2026, 9, 1, 12).getTime() + 372 * DAY_MS });
  assert.equal(await reloaded.attempt("synthetic-user", () => true, async () => {}, async () => true), true);
});

test("a successful no-display result and a thrown native error both consume the attempt", async () => {
  const e = environment(); await e.ready();
  assert.equal(await e.attempt(), true);
  assert.equal(await e.attempt(), false);
  e.day(127); await e.use();
  await assert.rejects(e.attempt(() => true, async () => true, async () => { throw new Error("synthetic failure"); }));
  assert.equal(await e.attempt(), false);
});

test("concurrent completion events make at most one native request", async () => {
  const e = environment(); await e.ready();
  assert.deepEqual(await Promise.all([e.attempt(), e.attempt(), e.attempt()]), [true, false, false]);
  assert.equal(e.calls, 1);
});

test("unsupported API and unsafe state do not consume the quota", async () => {
  const e = environment(); await e.ready();
  assert.equal(await e.attempt(() => true, async () => false), false);
  assert.equal(await e.attempt(() => false), false);
  let safe = true;
  assert.equal(await e.attempt(() => safe, async () => { safe = false; return true; }), false);
  assert.equal(await e.attempt(), true);
});

test("storage failures prevent native requests and corrupt history restarts the waiting period", async () => {
  const e = environment(); await e.ready();
  const setItem = e.storage.setItem;
  e.storage.setItem = async () => { throw new Error("synthetic storage failure"); };
  await assert.rejects(e.attempt()); assert.equal(e.calls, 0);
  e.storage.setItem = setItem;
  e.stored.set("smartbukatsu_review_v1:synthetic-user", "broken-json");
  await e.use(); assert.equal(await e.attempt(), false);
});

test("use history is scoped to the signed-in account without a server request", async () => {
  const e = environment(); await e.ready(); await e.use("other-synthetic-user");
  assert.equal(await e.history.attempt("other-synthetic-user", () => true, async () => {}, async () => true), false);
  assert.equal(await e.attempt(), true);
});

test("native presentation gate excludes updates, simultaneous ads and their surrounding minute", () => {
  let clock = 100000; const gate = createPresentationGate(() => clock);
  assert.equal(gate.acquire("review"), null);
  gate.setBlocked("app-update", false);
  const ad = gate.acquire("ad"); assert.ok(ad);
  assert.equal(gate.acquire("review"), null); ad();
  clock += 59999; assert.equal(gate.acquire("review"), null);
  clock++; const review = gate.acquire("review"); assert.ok(review);
  assert.equal(gate.acquire("ad"), null); review();
  assert.equal(gate.acquire("ad"), null); clock += 60000;
  assert.ok(gate.acquire("ad"));
});

function load(file, modules, globals = {}) {
  const { code } = transformSync(fs.readFileSync(path.join(root, file), "utf8"), {
    configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
  });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console,
    require(name) { assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name]; },
    ...globals });
  return module.exports;
}

function serviceEnvironment(os, appId = "com.sharprise.smartbukatsu") {
  const gate = createPresentationGate(); gate.setBlocked("app-update", false);
  const opened = [], requests = [];
  const service = load("src/services/appReviewService.js", {
    "@react-native-async-storage/async-storage": {},
    "expo-application": { applicationId: appId },
    "react-native": { Platform: { OS: os }, Linking: { openURL: async url => opened.push(url) } },
    "./appReviewPolicy": { createReviewHistory: () => ({ recordUse: async () => {},
      attempt: async (_uid, safe, request, available) => {
        if (!safe() || !await available()) return false; await request(); return true;
      } }) },
    "./reviewPresentationGate": { reviewPresentationGate: gate },
    "expo-store-review": { isAvailableAsync: async () => true, requestReview: async () => requests.push(true) },
  });
  return { service, opened, requests, gate };
}

for (const os of ["android", "ios"]) test(`${os}: manual route opens the verified listing without calling the automatic API`, async () => {
  const e = serviceEnvironment(os);
  await e.service.openAppReviewStore();
  assert.match(e.opened[0], os === "ios" ? /id6764191653\?action=write-review/ : /id=com\.sharprise\.smartbukatsu&showAllReviews=true/);
  assert.equal(e.requests.length, 0);
  assert.equal(await e.service.requestAppReview("synthetic", () => true), true);
  assert.equal(e.requests.length, 1);
});

test("web and development app IDs cannot trigger a production review", async () => {
  for (const [os, id] of [["web", "com.sharprise.smartbukatsu"], ["ios", "com.sharprise.smartbukatsu.dev"]]) {
    const e = serviceEnvironment(os, id);
    assert.equal(await e.service.requestAppReview("synthetic", () => true), false);
    assert.equal(e.requests.length, 0);
  }
  const e = serviceEnvironment("web");
  assert.equal(await e.service.openAppReviewStore(), false); assert.equal(e.opened.length, 0);
});

function hookEnvironment() {
  let args = { uid: "synthetic", enabled: true, screen: "Diary" }, cursor = 0, api;
  const slots = [], pendingEffects = [], timers = new Map(), events = new Map(), calls = [];
  let nextId = 0, keyboardVisible = false, clock = 100000;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] || (slots[i] = { current: initial }); },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn }; return slots[i].value; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps };
        pendingEffects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); }
    },
  };
  const add = (name, fn) => { events.set(name, fn); return { remove: () => events.delete(name) }; };
  const hook = load("src/hooks/useAppReview.js", {
    react, "react-native": {
      AppState: { currentState: "active", addEventListener: add },
      Keyboard: { isVisible: () => keyboardVisible, addListener: add },
    },
    "../services/appReviewService": { recordReviewUsage: async () => {},
      requestAppReview: async (uid, safe) => { if (safe()) calls.push(uid); } },
  }, { Date: { now: () => clock }, setTimeout: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id) });
  const render = () => { cursor = 0; api = hook.useAppReview(args); pendingEffects.splice(0).forEach(fn => fn()); };
  render();
  clock += 60000;
  return { calls, timers, events, get api() { return api; },
    advance(ms) { clock += ms; },
    update(patch) { args = { ...args, ...patch }; render(); },
    fire() { for (const [id, { fn }] of [...timers]) { timers.delete(id); fn(); } },
    keyboard() { keyboardVisible = true; events.get("keyboardDidShow")(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test("hook never requests on launch or foreground, then waits two idle seconds after completion", async () => {
  const e = hookEnvironment(); assert.equal(e.timers.size, 0);
  e.events.get("change")("active"); assert.equal(e.timers.size, 0);
  await e.api.completeInteraction("Diary");
  assert.equal(e.calls.length, 0); assert.equal([...e.timers.values()][0].ms, 2000);
  e.fire(); assert.deepEqual(e.calls, ["synthetic"]); e.unmount();
});

test("the first foreground minute cannot prompt, including immediately after app return", async () => {
  const e = hookEnvironment(); e.advance(-60000);
  await e.api.completeInteraction("Diary"); assert.equal(e.timers.size, 0);
  e.advance(60000); e.events.get("change")("background"); e.events.get("change")("active");
  await e.api.completeInteraction("Diary"); assert.equal(e.timers.size, 0);
  e.advance(60000); await e.api.completeInteraction("Diary"); e.fire();
  assert.equal(e.calls.length, 1); e.unmount();
});

for (const event of ["touch", "keyboard", "background", "navigation", "account", "switching", "unmount"]) {
  test(`hook cancels a pending request on ${event}`, async () => {
    const e = hookEnvironment(); await e.api.completeInteraction("Diary");
    if (event === "touch") e.api.cancelReview();
    if (event === "keyboard") e.keyboard();
    if (event === "background") e.events.get("change")("background");
    if (event === "navigation") e.api.reviewNavigationChanged("Settings");
    if (event === "account") e.update({ uid: "another-synthetic" });
    if (event === "switching") e.update({ enabled: false });
    if (event === "unmount") e.unmount();
    e.fire(); assert.equal(e.calls.length, 0); e.unmount();
  });
}

// Exercise the real App callback with only its React/navigation boundaries mocked.
function navigationEnvironment() {
  const source = fs.readFileSync(path.join(root, "App.js"), "utf8");
  const { ast } = transformSync(source, { configFile: false, babelrc: false, code: false, ast: true,
    parserOpts: { plugins: ["jsx"] } });
  let handler;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id.name === "handleNavigationStateChange") handler = node.init;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  let clock = 100000, route = "WorkspaceHome", adResult = false;
  const calls = [], currentRouteNameRef = { current: "Calendar" }, routeVisitRef = { current: { at: 70000, version: 0 } };
  const fn = vm.runInNewContext(`(${source.slice(handler.start, handler.end)})`, {
    currentRouteNameRef, routeVisitRef, navigationRef: { getCurrentRoute: () => ({ name: route }) },
    REVIEW_COMPLETION_SCREENS: new Set(["Calendar", "Roster", "ProjectList", "TacticalNotes", "NoticeBoard"]),
    Date: { now: () => clock }, user: {}, activeTeamId: "synthetic", emailVerificationPending: false,
    reviewNavigationChanged: () => {}, recordScreenTransition: () => adResult,
    completeInteraction: screen => calls.push(screen), setCurrentScreen: () => {}, setCurrentParams: () => {},
  });
  return { calls, fn, currentRouteNameRef, routeVisitRef,
    setAd(result) { adResult = result; }, route(name) { route = name; }, clock(value) { clock = value; } };
}

test("read-only feature return qualifies after 30 seconds; short visits and ads do not", async () => {
  const e = navigationEnvironment(); e.fn(); await flush();
  assert.deepEqual(e.calls, ["WorkspaceHome"]);
  for (const { elapsed, ad } of [{ elapsed: 29999, ad: false }, { elapsed: 30000, ad: true }]) {
    const n = navigationEnvironment(); n.clock(70000 + elapsed); n.setAd(ad);
    n.fn(); await flush(); assert.equal(n.calls.length, 0);
  }
});

test("late advertising completion cannot request on a later navigation", async () => {
  const e = navigationEnvironment(); let resolve;
  e.setAd(new Promise(done => { resolve = done; }));
  e.fn(); e.route("Settings"); e.fn(); resolve(false); await flush();
  assert.equal(e.calls.length, 0);
});
