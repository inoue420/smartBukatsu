const test = require("node:test"), assert = require("node:assert/strict");
const { load } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const tick = () => new Promise(setImmediate);
const profile = adultConfirmed => ({ schemaVersion: 1, adultConfirmed, minimumAgeConfirmed: true,
  audience: adultConfirmed ? "adult" : "teen" });
const deferred = () => { let resolve, reject; return { promise: new Promise((r, j) => { resolve = r; reject = j; }),
  resolve: value => resolve(value), reject: error => reject(error) }; };
function environment(options = {}) {
  const account = { uid: "a" }, auth = { currentUser: account }, calls = [], values = [], subscriptions = [];
  const appListeners = new Set(), networkListeners = new Set(), timers = new Map();
  let time = 100000, id = 0, callable = options.callable || (async () => ({ data: { uid: "a", ...profile(true) } }));
  const app = { currentState: "active", addEventListener(_name, fn) { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } };
  const { subscribeAdAgeProfile } = load("src/services/adAgeProfileService.js", {
    "react-native": { AppState: app, Platform: { OS: options.os || "android" } },
    "@react-native-community/netinfo": { __esModule: true, default: {
      addEventListener(fn) { networkListeners.add(fn); return () => networkListeners.delete(fn); },
      refresh: async () => ({ isConnected: true }),
    } },
    "firebase/firestore": { doc: (...args) => args }, "firebase/functions": { httpsCallable: (_functions, name) => async data => {
      calls.push({ name, data }); return callable();
    } }, "../firebase": { auth, db: "db", cloudFunctions: "functions", isCaptureEnvironment: options.capture },
    "./firestoreSubscription": { measuredOnSnapshot(name, ref, next, error, config) {
      const sub = { name, ref, next, error, config, stopped: false };
      subscriptions.push(sub); return () => { sub.stopped = true; };
    } },
  }, "", { Date: { now: () => time }, setTimeout(fn, delay) { const key = ++id; timers.set(key, { fn, at: time + delay }); return key; }, clearTimeout: key => timers.delete(key) });
  const stop = subscribeAdAgeProfile("a", value => values.push(value));
  return { auth, calls, values, subscriptions, stop, timers, appListeners, networkListeners,
    setCallable(fn) { callable = fn; },
    async settle() { await tick(); },
    snapshot(value, metadata = {}, sub = subscriptions.at(-1)) { sub.next({ exists: () => Boolean(value), data: () => value, metadata }); },
    state(state) { app.currentState = state; for (const fn of appListeners) fn(state); },
    network(online) { for (const fn of networkListeners) fn({ isConnected: online }); },
    advance(ms) { time += ms; for (const [key, timer] of [...timers]) if (timer.at <= time) { timers.delete(key); timer.fn(); } },
  };
}

test("first ad age resolution waits for the verified handshake and server snapshot, ignoring cached adulthood", async () => {
  const slow = deferred(), e = environment({ callable: () => slow.promise });
  assert.equal(e.subscriptions.length, 0); assert.equal(e.values.length, 0);
  slow.resolve({ data: { uid: "a", ...profile(false) } }); await e.settle();
  assert.equal(e.subscriptions[0].config.includeMetadataChanges, true);
  assert.equal(e.calls[0].name, "ensureAdAgeProfile"); assert.equal(e.calls[0].data.expectedUid, "a");
  e.snapshot(profile(true), { fromCache: true }); assert.equal(e.values.length, 0);
  e.snapshot(profile(false), { hasPendingWrites: true }); assert.equal(e.values.length, 0);
  e.snapshot(profile(false), { fromCache: false }); assert.equal(e.values[0].adultConfirmed, false);
  e.snapshot(profile(false), { fromCache: false }); assert.equal(e.values.length, 1); e.stop();
});

test("server promotion and age revocation publish correct conditions without more handshake requests", async () => {
  const e = environment(); await e.settle();
  e.snapshot(profile(false)); e.snapshot(profile(true));
  assert.equal(e.values.at(-1).adultConfirmed, true);
  e.state("background"); e.state("active"); e.network(false); e.network(true); await e.settle();
  assert.equal(e.calls.length, 1); assert.equal(e.subscriptions.length, 1); e.stop();
});

test("late handshake or snapshot callbacks cannot publish after logout, account replacement or disposal", async () => {
  const slow = deferred(), e = environment({ callable: () => slow.promise });
  e.auth.currentUser = { uid: "b" }; slow.resolve({ data: { uid: "a", ...profile(true) } }); await e.settle();
  assert.equal(e.subscriptions.length, 0); assert.equal(e.values.length, 0); e.stop();
  for (const replace of [true, false]) {
    const a = environment(); await a.settle(); const sub = a.subscriptions[0];
    if (replace) a.auth.currentUser = { uid: "a" }; else a.stop();
    a.snapshot(profile(true), {}, sub); assert.equal(a.values.length, 0); if (replace) a.stop();
  }
});

test("failed initialization resumes only on external events with a 60-second cooldown and cleans up", async () => {
  const e = environment({ callable: async () => { throw Error("offline"); } }); await e.settle();
  assert.equal(e.values.at(-1), null); assert.equal(e.timers.size, 0);
  e.network(false); e.network(true); e.state("background"); e.state("active");
  assert.equal(e.timers.size, 1); e.advance(59999); await e.settle(); assert.equal(e.calls.length, 1);
  e.setCallable(async () => ({ data: { uid: "a", ...profile(true) } })); e.advance(1); await e.settle();
  e.snapshot(profile(true)); assert.equal(e.values.at(-1).adultConfirmed, true);
  assert.equal(e.calls.length, 2); assert.equal(e.timers.size, 0); e.stop();
  assert.equal(e.appListeners.size, 0); assert.equal(e.networkListeners.size, 0); assert.equal(e.subscriptions.at(-1).stopped, true);
});

test("wrong-account results, malformed profiles, missing documents and listener errors never enable adulthood", async () => {
  const wrong = environment({ callable: async () => ({ data: { uid: "b", ...profile(true) } }) });
  await wrong.settle(); assert.equal(wrong.subscriptions.length, 0); assert.equal(wrong.values.at(-1), null); wrong.stop();
  for (const value of [null, { ...profile(true), audience: "unknown" }, { ...profile(true), adultConfirmed: "true" }]) {
    const e = environment(); await e.settle(); e.snapshot(value); assert.equal(e.values.at(-1), null); e.stop();
  }
  const e = environment(); await e.settle(); e.snapshot(profile(true)); e.subscriptions[0].error();
  assert.equal(e.values.at(-1), null); assert.equal(e.subscriptions[0].stopped, true); e.stop();
});

test("foreground recovery refreshes an offline network state missed during iOS suspension", async () => {
  const e = environment({ os: "ios", callable: async () => { throw Error("offline"); } });
  await e.settle(); e.network(false); e.state("background"); e.advance(60000);
  e.setCallable(async () => ({ data: { uid: "a", ...profile(false) } }));
  e.state("active"); await e.settle();
  assert.equal(e.calls.length, 2); e.snapshot(profile(false));
  assert.equal(e.values.at(-1).adultConfirmed, false); e.stop();
});

test("Web and capture mode never connect, call a backend or start recovery listeners", async () => {
  for (const options of [{ os: "web" }, { capture: true }]) {
    const e = environment(options); await e.settle(); assert.equal(e.calls.length, 0);
    assert.equal(e.subscriptions.length, 0); assert.equal(e.appListeners.size, 0); e.stop();
  }
});

test("a stopped snapshot's late success or failure cannot replace or revoke a recovered profile", async () => {
  const e = environment(); await e.settle(); const old = e.subscriptions[0];
  old.error(); e.advance(60000); e.network(true); await e.settle();
  assert.equal(e.subscriptions.length, 2); e.snapshot(profile(false));
  const count = e.values.length; old.next({ exists: () => true, data: () => profile(true), metadata: {} }); old.error();
  assert.equal(e.values.length, count); assert.equal(e.values.at(-1).adultConfirmed, false); e.stop();
});

for (const os of ["android", "ios"]) {
  test(`${os}: reconnect during the first request is replayed once after failure and the remaining cooldown`, async () => {
    const first = deferred(), e = environment({ os, callable: () => first.promise });
    e.setCallable(async () => ({ data: { uid: "a", ...profile(false) } }));
    for (let i = 0; i < 3; i++) { e.network(false); e.network(true); }
    e.advance(10000); first.reject(Error("synthetic-offline")); await e.settle();
    assert.equal(e.calls.length, 1); assert.equal(e.timers.size, 1);
    e.advance(49999); await e.settle(); assert.equal(e.calls.length, 1);
    e.advance(1); await e.settle(); assert.equal(e.calls.length, 2);
    e.snapshot(profile(false)); assert.equal(e.values.at(-1).adultConfirmed, false);
    e.advance(120000); await e.settle(); assert.equal(e.calls.length, 2); assert.equal(e.timers.size, 0); e.stop();
  });

  test(`${os}: a slow failed request replays reconnect immediately when its start-time cooldown already elapsed`, async () => {
    const first = deferred(), e = environment({ os, callable: () => first.promise });
    e.setCallable(async () => ({ data: { uid: "a", ...profile(false) } }));
    e.network(false); e.network(true); e.advance(70000);
    assert.equal(e.calls.length, 1); assert.equal(e.timers.size, 0);
    first.reject(Error("synthetic-timeout")); await e.settle();
    assert.equal(e.calls.length, 2); assert.equal(e.timers.size, 0); e.snapshot(profile(false)); e.stop();
  });

  test(`${os}: successful in-flight recovery waits for the existing listener without a duplicate handshake`, async () => {
    const first = deferred(), e = environment({ os, callable: () => first.promise });
    e.network(false); e.network(true);
    first.resolve({ data: { uid: "a", ...profile(true) } }); await e.settle();
    e.advance(120000); e.network(false); e.network(true); await e.settle();
    assert.equal(e.calls.length, 1); assert.equal(e.subscriptions.length, 1); assert.equal(e.timers.size, 0);
    e.snapshot(profile(true)); assert.equal(e.values.at(-1).adultConfirmed, true);
    e.advance(120000); await e.settle(); assert.equal(e.calls.length, 1); e.stop();
  });

  test(`${os}: a queued recovery is consumed once, so another failure cannot start a polling loop`, async () => {
    const first = deferred(), e = environment({ os, callable: () => first.promise });
    e.setCallable(async () => { throw Error("synthetic-offline"); });
    e.network(false); e.network(true); first.reject(Error("synthetic-offline")); await e.settle();
    e.advance(60000); await e.settle(); assert.equal(e.calls.length, 2); assert.equal(e.timers.size, 0);
    e.advance(120000); await e.settle(); assert.equal(e.calls.length, 2); e.stop();
  });

  test(`${os}: reconnect observed during the first snapshot wait is preserved if that listener fails`, async () => {
    const e = environment({ os }); await e.settle();
    e.network(false); e.network(true); assert.equal(e.calls.length, 1);
    e.subscriptions[0].error(); assert.equal(e.timers.size, 1);
    e.advance(60000); await e.settle(); assert.equal(e.calls.length, 2);
    e.snapshot(profile(false)); assert.equal(e.values.at(-1).adultConfirmed, false); e.stop();
  });

  test(`${os}: recovery is deferred in background or offline and resumes at a safe external event`, async () => {
    for (const blocked of ["background", "offline"]) {
      const first = deferred(), e = environment({ os, callable: () => first.promise });
      e.setCallable(async () => ({ data: { uid: "a", ...profile(false) } }));
      e.network(false); e.network(true);
      if (blocked === "background") e.state("background"); else e.network(false);
      first.reject(Error("synthetic-offline")); await e.settle(); e.advance(120000); await e.settle();
      assert.equal(e.calls.length, 1); assert.equal(e.timers.size, 0);
      if (blocked === "background") e.state("active"); else e.network(true);
      await e.settle(); assert.equal(e.calls.length, 2); e.snapshot(profile(false)); e.stop();
    }
  });

  test(`${os}: a foreground network refresh is retained even while the original request is pending`, async () => {
    const first = deferred(), e = environment({ os, callable: () => first.promise });
    e.network(false); e.state("background"); e.state("active"); await e.settle();
    assert.equal(e.calls.length, 1);
    e.setCallable(async () => ({ data: { uid: "a", ...profile(false) } }));
    first.reject(Error("synthetic-offline")); await e.settle(); assert.equal(e.timers.size, 1);
    e.advance(60000); await e.settle(); assert.equal(e.calls.length, 2); e.snapshot(profile(false)); e.stop();
  });

  test(`${os}: account changes and disposal cancel an in-flight event's deferred recovery`, async () => {
    for (const action of ["logout", "same-uid-login", "other-user", "dispose"]) {
      const first = deferred(), e = environment({ os, callable: () => first.promise });
      e.network(false); e.network(true); first.reject(Error("synthetic-offline")); await e.settle();
      assert.equal(e.timers.size, 1);
      if (action === "dispose") e.stop();
      else e.auth.currentUser = action === "logout" ? null : { uid: action === "same-uid-login" ? "a" : "b" };
      e.advance(120000); await e.settle();
      assert.equal(e.calls.length, 1); assert.equal(e.timers.size, 0);
      if (action !== "dispose") e.stop();
    }
  });
}
