const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { transformSync } = require("@babel/core");
const DAY = 86400000;
const root = path.join(__dirname, "../..");
const source = fs.readFileSync(path.join(__dirname, "notificationService.js"), "utf8");
const tick = () => new Promise(setImmediate);
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function harness(options = {}) {
  const storage = options.storage || new Map(), calls = [], expoOptions = [];
  const auth = { currentUser: { uid: "synthetic-a" } };
  let now = 1800000000000, status = "granted", token = "ExpoPushToken[synthetic-a]", permissionRequests = 0;
  let fail = false, storedFailure = false, permissionExtra = {}, getTokenHook;
  class ClockDate extends Date { static now() { return now; } }
  const modules = {
    "@react-native-async-storage/async-storage": { __esModule: true, default: {
      getItem: async key => { if (storedFailure) throw new Error("synthetic storage failure"); return storage.get(key) ?? null; },
      setItem: async (key, value) => { if (storedFailure) throw new Error("synthetic storage failure"); storage.set(key, value); },
      removeItem: async key => { if (storedFailure) throw new Error("synthetic storage failure"); await options.beforeStorageRemove?.(key); storage.delete(key); },
    } },
    "react-native": { Platform: { OS: options.os || "android" } },
    "expo-notifications": {
      AndroidImportance: { HIGH: 4 }, setNotificationChannelAsync: async () => {},
      getDevicePushTokenAsync: async () => ({ type: options.os || "android", data: "synthetic-native" }),
      getPermissionsAsync: async () => ({ status, ...permissionExtra }),
      requestPermissionsAsync: async () => { permissionRequests++; status = "granted"; return { status, ...permissionExtra }; },
      getExpoPushTokenAsync: async value => { expoOptions.push(value); await getTokenHook?.(); return { data: token }; },
    },
    "firebase/firestore": {}, "./firestoreSubscription": {},
    "../notifications/notificationConfig": { normalizeNotificationPreferences: value => value },
    "../firebase": { auth, cloudFunctions: "synthetic", db: "synthetic" },
    "firebase/functions": { httpsCallable: (_functions, name) => async data => {
      calls.push({ name, data: JSON.parse(JSON.stringify(data)), uid: auth.currentUser?.uid });
      await options.beforeCall?.(name, data);
      if (fail) throw new Error("synthetic offline");
      return { data: { registered: true, unregistered: true } };
    } },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(options.source || source, { cwd: root, configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"] }).code, {
    module, exports: module.exports, Date: ClockDate, Map, Set,
    require(name) { assert.ok(name in modules, name); return modules[name]; },
  });
  const service = module.exports;
  const session = uid => { auth.currentUser = uid ? { uid } : null; service.setPushRegistrationSession?.(uid); };
  session("synthetic-a");
  return { service, calls, storage, expoOptions, auth, session,
    registrations: () => calls.filter(call => call.name === "registerPushToken"),
    advance: value => { now += value; }, permission: (value, extra = {}) => { status = value; permissionExtra = extra; },
    token: value => { token = value; }, fail: value => { fail = value; }, storageFailure: value => { storedFailure = value; },
    tokenHook: fn => { getTokenHook = fn; }, permissionRequests: () => permissionRequests };
}

for (const os of ["android", "ios"]) {
  test(`${os}: concurrent triggers and OFF -> ON observation register only once, then renew at 24 hours`, async () => {
    const h = harness({ os });
    await Promise.all([h.service.registerPushToken({ requestPermission: true }), h.service.registerPushToken(), h.service.registerPushToken()]);
    assert.equal(h.registrations().length, 1);
    h.advance(DAY - 1);
    const skipped = await h.service.registerPushToken();
    assert.equal(skipped.registered, false); assert.equal(skipped.nextRefreshInMs, 1);
    h.advance(1); await h.service.registerPushToken(); assert.equal(h.registrations().length, 2);
  });
}

test("successful state survives restart, but another installation or platform registers", async () => {
  const first = harness(); await first.service.registerPushToken();
  const restart = harness({ storage: first.storage }); await restart.service.registerPushToken();
  assert.equal(restart.registrations().length, 0);
  first.storage.delete("smartbukatsu_notification_device_id");
  restart.advance(1); await restart.service.registerPushToken(); assert.equal(restart.registrations().length, 1);
  const ios = harness({ os: "ios", storage: first.storage }); await ios.service.registerPushToken(); assert.equal(ios.registrations().length, 1);
  const reinstalled = harness(); await reinstalled.service.registerPushToken(); assert.equal(reinstalled.registrations().length, 1);
});

test("native token events use the supplied token; a changed Expo token bypasses the interval", async () => {
  const h = harness(); await h.service.registerPushToken();
  // Expo's getter and listener construct properties in different orders.
  await h.service.registerPushToken({ devicePushToken: { data: "synthetic-native", type: "android" } });
  assert.equal(h.registrations().length, 1);
  await h.service.registerPushToken({ devicePushToken: { type: "android", data: "synthetic-native-new" } });
  assert.equal(h.registrations().length, 2, "native changes must repair registration even when the Expo handle is unchanged");
  h.token("ExpoPushToken[synthetic-new]");
  await h.service.registerPushToken({ devicePushToken: { type: "android", data: "synthetic-native" } });
  assert.equal(h.registrations().length, 3);
  assert.equal(h.expoOptions.at(-1).devicePushToken.data, "synthetic-native");
});

test("denied -> granted, changed permission details and explicit permission requests register appropriately", async () => {
  const h = harness(); await h.service.registerPushToken();
  h.permission("denied"); assert.equal((await h.service.registerPushToken()).granted, false);
  assert.equal(h.registrations().length, 1); assert.equal(h.permissionRequests(), 0);
  await h.service.registerPushToken({ requestPermission: true });
  assert.equal(h.registrations().length, 2); assert.equal(h.permissionRequests(), 1);
  h.permission("granted", { ios: { allowsBadge: false } });
  await h.service.registerPushToken(); assert.equal(h.registrations().length, 3);
  h.permission("denied"); await h.service.getNotificationPermissionStatus();
  h.permission("granted", { ios: { allowsBadge: false } });
  await h.service.registerPushToken(); assert.equal(h.registrations().length, 4);
});

test("failed callable never creates success state, and a retry succeeds", async () => {
  const h = harness(); h.fail(true);
  await assert.rejects(h.service.registerPushToken(), /offline/);
  assert.equal(h.storage.has("smartbukatsu_push_registration_v1"), false);
  h.fail(false); await h.service.registerPushToken(); await h.service.registerPushToken();
  assert.equal(h.registrations().length, 2);
});

test("a malformed cache or backwards device clock cannot suppress registration", async () => {
  const h = harness(); h.storage.set("smartbukatsu_push_registration_v1", "invalid-json");
  await h.service.registerPushToken(); h.advance(-1); await h.service.registerPushToken();
  assert.equal(h.registrations().length, 2);
});

test("logout waits for an accepted in-flight registration before unregistering, and re-login re-registers", async () => {
  const waiting = deferred(); let hold = true;
  const h = harness({ beforeCall: name => name === "registerPushToken" && hold ? waiting.promise : undefined });
  const registering = h.service.registerPushToken(); await tick();
  const logout = h.service.unregisterPushTokenForCurrentDevice();
  assert.equal((await h.service.registerPushToken()).reason, "session-changed");
  waiting.resolve(); await registering; await logout;
  assert.deepEqual(h.calls.map(call => call.name), ["registerPushToken", "unregisterPushToken"]);
  assert.equal(h.storage.has("smartbukatsu_push_registration_v1"), false);
  h.session(null); h.session("synthetic-a"); hold = false;
  await h.service.registerPushToken(); assert.equal(h.registrations().length, 2);
});

test("account changes before token acquisition finishes never register the obsolete user", async () => {
  const waiting = deferred(), h = harness(); h.tokenHook(() => waiting.promise);
  const stale = h.service.registerPushToken(); await tick(); h.session("synthetic-b");
  waiting.resolve(); assert.equal((await stale).reason, "session-changed");
  h.tokenHook(null); await h.service.registerPushToken();
  assert.equal(h.registrations().length, 1); assert.equal(h.registrations()[0].data.expectedUid, "synthetic-b");
});

test("failed unregister still invalidates local success so re-login cannot skip registration", async () => {
  const h = harness(); await h.service.registerPushToken(); h.fail(true);
  await assert.rejects(h.service.unregisterPushTokenForCurrentDevice(), /offline/);
  h.session(null); h.session("synthetic-a"); h.fail(false); await h.service.registerPushToken();
  assert.equal(h.registrations().length, 2);
});

test("a lingering former owner is claimed even when the new account leaves notifications OFF", async () => {
  const h = harness(); await h.service.registerPushToken(); h.fail(true);
  await assert.rejects(h.service.unregisterPushTokenForCurrentDevice(), /offline/);
  assert.equal(h.storage.get("smartbukatsu_push_owner_v1"), "synthetic-a");
  h.session(null); h.session("synthetic-b"); h.fail(false);
  await h.service.ensurePushTokenOwnership();
  assert.equal(h.registrations().length, 2);
  assert.equal(h.registrations().at(-1).data.initializePreferencesEnabled, false);
  assert.equal(h.registrations().at(-1).data.expectedUid, "synthetic-b");
  await h.service.ensurePushTokenOwnership(); assert.equal(h.registrations().length, 2);
  await h.service.unregisterPushTokenForCurrentDevice(); assert.equal(h.storage.has("smartbukatsu_push_owner_v1"), false);
});

test("a failed registration persists attempted ownership for recovery after restart/account change", async () => {
  const first = harness(); first.fail(true); await assert.rejects(first.service.registerPushToken(), /offline/);
  assert.equal(first.storage.has("smartbukatsu_push_registration_v1"), false);
  const next = harness({ storage: first.storage }); next.session("synthetic-b");
  await next.service.ensurePushTokenOwnership(); assert.equal(next.registrations().length, 1);
  assert.equal(next.registrations()[0].data.initializePreferencesEnabled, false);
});

// Model only the remote owner and network boundary; the production client
// decides whether and when to retry. Server ownership transfers are separately
// exercised against the actual Callable in functions/pushTokenRegistration.test.js.
function ownershipScenario(os = "android") {
  let offline = false, owner = null;
  const beforeCall = async (name, data) => {
    if (offline) throw new Error("synthetic offline");
    if (name === "registerPushToken") owner = data.expectedUid;
    if (name === "unregisterPushToken" && owner === data.expectedUid) owner = null;
  };
  const client = (storage) => harness({ os, storage, beforeCall });
  return { client, offline: value => { offline = value; }, owner: () => owner };
}

for (const os of ["android", "ios"]) for (const restart of [false, true]) {
  test(`${os}: failed OFF-account ownership recovery retries after ${restart ? "restart" : "reconnection"}`, async () => {
    const remote = ownershipScenario(os); let h = remote.client();
    await h.service.registerPushToken(); remote.offline(true);
    await assert.rejects(h.service.unregisterPushTokenForCurrentDevice(), /offline/);
    h.session(null); h.session("synthetic-b");
    await assert.rejects(h.service.ensurePushTokenOwnership(), /offline/);
    assert.equal(remote.owner(), "synthetic-a");
    assert.equal(h.storage.get("smartbukatsu_push_owner_pending_v1"), "synthetic-b");
    if (restart) { h = remote.client(h.storage); h.session("synthetic-b"); }
    remote.offline(false);
    const previousCalls = h.registrations().length;
    await h.service.ensurePushTokenOwnership();
    assert.equal(h.registrations().length, previousCalls + 1);
    assert.equal(remote.owner(), "synthetic-b");
    assert.equal(h.registrations().at(-1).data.initializePreferencesEnabled, false);
    assert.equal(h.storage.has("smartbukatsu_push_owner_pending_v1"), false);
    await h.service.ensurePushTokenOwnership();
    assert.equal(h.registrations().length, previousCalls + 1);
  });
}

for (const attemptClaim of [false, true]) {
  test(`a second logout cannot discard a former owner's unresolved registration (claim attempted=${attemptClaim})`, async () => {
    const remote = ownershipScenario(), h = remote.client();
    await h.service.registerPushToken(); remote.offline(true);
    await assert.rejects(h.service.unregisterPushTokenForCurrentDevice(), /offline/);
    h.session(null); h.session("synthetic-b");
    if (attemptClaim) await assert.rejects(h.service.ensurePushTokenOwnership(), /offline/);
    remote.offline(false);
    await h.service.unregisterPushTokenForCurrentDevice();
    assert.equal(remote.owner(), "synthetic-a");
    assert.ok(h.storage.get("smartbukatsu_push_owner_pending_v1"));
    h.session(null); h.session("synthetic-c");
    await h.service.ensurePushTokenOwnership();
    assert.equal(remote.owner(), "synthetic-c");
    assert.equal(h.registrations().at(-1).data.initializePreferencesEnabled, false);
    assert.equal(h.storage.has("smartbukatsu_push_owner_pending_v1"), false);
  });
}

test("legacy attempted ownership without a success cache is retried even for the same UID", async () => {
  const storage = new Map([["smartbukatsu_push_owner_v1", "synthetic-a"]]);
  const h = harness({ storage });
  await h.service.ensurePushTokenOwnership();
  assert.equal(h.registrations().length, 1);
  assert.equal(h.registrations()[0].data.initializePreferencesEnabled, false);
  await h.service.ensurePushTokenOwnership();
  assert.equal(h.registrations().length, 1);
});

test("an unconfirmed ownership attempt cannot reuse an older successful cache", async () => {
  const h = harness(); await h.service.registerPushToken();
  h.storage.set("smartbukatsu_push_owner_pending_v1", "synthetic-a");
  await h.service.ensurePushTokenOwnership();
  assert.equal(h.registrations().length, 2);
  assert.equal(h.storage.has("smartbukatsu_push_owner_pending_v1"), false);
});

test("failure to clear pending ownership after server success remains retryable", async () => {
  let failClear = true;
  const h = harness({ beforeStorageRemove: key => {
    if (key === "smartbukatsu_push_owner_pending_v1" && failClear) throw new Error("synthetic cleanup failure");
  } });
  await assert.rejects(h.service.registerPushToken(), /cleanup failure/);
  assert.ok(h.storage.get("smartbukatsu_push_owner_pending_v1"));
  failClear = false;
  await h.service.ensurePushTokenOwnership();
  assert.equal(h.registrations().length, 2);
  assert.equal(h.storage.has("smartbukatsu_push_owner_pending_v1"), false);
});

test("logout is not held up by Expo token acquisition and its late result cannot restore registration", async () => {
  const h = harness(); await h.service.registerPushToken();
  const waiting = deferred(); h.tokenHook(() => waiting.promise);
  const preparing = h.service.registerPushToken(); await tick();
  await h.service.unregisterPushTokenForCurrentDevice();
  assert.equal(h.calls.at(-1).name, "unregisterPushToken");
  h.session(null); waiting.resolve(); assert.equal((await preparing).reason, "session-changed");
  assert.equal(h.registrations().length, 1);
});

test("storage failure fails open; no support on web or without a logged-in session", async () => {
  const h = harness(); await h.service.registerPushToken(); h.storageFailure(true);
  await assert.rejects(h.service.registerPushToken(), /storage/);
  h.storageFailure(false); h.session(null);
  assert.equal((await h.service.registerPushToken()).granted, false);
  const web = harness({ os: "web" }); assert.equal((await web.service.registerPushToken()).reason, "unsupported");
  assert.equal(web.calls.length, 0);
});

test("30 days, twice daily: production client makes 30 registrations versus baseline 60 per user", async () => {
  const original = execFileSync("git", ["show", "433109a:./src/services/notificationService.js"], { cwd: root, encoding: "utf8" });
  const before = harness({ source: original }), after = harness();
  for (let start = 0; start < 60; start++) {
    for (const h of [before, after]) { await h.service.registerPushToken(); h.advance(DAY / 2); }
  }
  assert.equal(before.registrations().length, 60); assert.equal(after.registrations().length, 30);
});
