const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");
const backend = require("../../functions/notificationCore");

function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync(path.join(__dirname, file), "utf8"), {
    configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  }).code;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  } });
  return module.exports;
}
const client = load("../notifications/notificationConfig.js");
const plain = value => JSON.parse(JSON.stringify(value));

test("master/category/team OFF hide history without modifying it; re-ON restores it", () => {
  const history = [{ id: "notice", category: "notice", teamId: "a" },
    { id: "reply", category: "workspaceReply", teamId: "b" },
    { id: "reminder", category: "scheduleReminder", teamId: "a" }];
  const original = JSON.stringify(history);
  const shown = preferences => history.filter(item => client.isNotificationVisible(
    client.normalizeNotificationPreferences(preferences), item)).map(item => item.id);
  assert.deepEqual(shown({}), []);
  assert.deepEqual(shown({ masterEnabled: true }), ["notice", "reply"]);
  assert.deepEqual(shown({ masterEnabled: true, categories: { notice: false } }), ["reply"]);
  assert.deepEqual(shown({ masterEnabled: true, teamEnabled: { b: false } }), ["notice"]);
  assert.deepEqual(shown({ masterEnabled: true }), ["notice", "reply"]);
  assert.equal(JSON.stringify(history), original);
  assert.equal(Object.hasOwn(client.NOTIFICATION_CATEGORIES, "scheduleReminder"), false);
  assert.equal(Object.hasOwn(client.normalizeNotificationPreferences({ categories: { scheduleReminder: true } }).categories, "scheduleReminder"), false);
});

test("client and push badge count the same visible unread items across every switch", () => {
  const items = [
    { category: "notice", teamId: "a" }, { category: "notice", teamId: "b" },
    { category: "workspaceReply", teamId: "a" }, { category: "system" },
    { category: "scheduleReminder", teamId: "a" }, { category: "legacyKind", teamId: "b" },
    { category: "notice", teamId: "a", readAt: 100 },
    { category: "notice", teamId: "a", dismissedAt: 100 },
  ];
  const summary = backend.summarizeUnreadNotifications(items);
  for (const masterEnabled of [false, true]) for (const notice of [false, true])
    for (const system of [false, true]) for (const a of [false, true]) {
      const preferences = { masterEnabled, categories: { notice, system }, teamEnabled: { a } };
      const normalized = client.normalizeNotificationPreferences(preferences);
      const visible = items.filter(item => !item.readAt && !item.dismissedAt && client.isNotificationVisible(normalized, item));
      const expected = { unreadTotal: visible.length, unreadByTeam: {} };
      for (const item of visible) if (item.teamId) expected.unreadByTeam[item.teamId] = (expected.unreadByTeam[item.teamId] || 0) + 1;
      assert.deepEqual(plain(client.getVisibleUnreadSummary(summary, normalized)), expected);
      assert.deepEqual(backend.getVisibleUnreadSummary(summary, preferences), expected);
    }
});

test("legacy totals never expose hidden counts while the server repair is pending", () => {
  const preferences = client.normalizeNotificationPreferences({ masterEnabled: true });
  assert.equal(client.getVisibleUnreadSummary({ unreadTotal: 99, unreadByTeam: { a: 99 } }, preferences).unreadTotal, 0);
  assert.equal(backend.shouldSendPush({ masterEnabled: true }, "scheduleReminder", "a"), false);
});

test("summary listener preserves buckets; authenticated repair calls only the existing user's endpoint", async () => {
  let receive, called, stopped = false;
  const service = load("notificationService.js", {
    "@react-native-async-storage/async-storage": {}, "react-native": { Platform: { OS: "web" } },
    "expo-notifications": {}, "firebase/firestore": { doc: (...args) => args },
    "firebase/functions": { httpsCallable: (_functions, name) => async data => { called = { name, data }; } },
    "./firestoreSubscription": { measuredOnSnapshot: (_name, _ref, next) => { receive = next; return () => { stopped = true; }; } },
    "../firebase": { db: "db", cloudFunctions: "functions", auth: { currentUser: { uid: "synthetic" } } },
    "../notifications/notificationConfig": client,
  });
  let summary;
  const stop = service.subscribeNotificationSummary("synthetic", value => { summary = value; });
  receive({ data: () => ({ unreadTotal: 5, unreadBucketsVersion: 1, unreadBuckets: { '["notice","a"]': 5 } }) });
  assert.equal(summary.unreadBucketsVersion, 1);
  assert.equal(summary.unreadBuckets['["notice","a"]'], 5);
  await service.ensureNotificationSummary();
  assert.deepEqual(plain(called), { name: "ensureNotificationSummary", data: { expectedUid: "synthetic", initializePreferences: false } });
  stop(); assert.equal(stopped, true);
});

for (const os of ["android", "ios"]) {
  test(`${os}: preparation is authenticated, coalesced, and waits for server support`, async () => {
    const auth = { currentUser: { uid: "synthetic" } }, calls = [];
    let finish;
    const service = load("notificationService.js", {
      "@react-native-async-storage/async-storage": {}, "react-native": { Platform: { OS: os } },
      "expo-notifications": {}, "firebase/firestore": {}, "./firestoreSubscription": {},
      "../firebase": { auth, db: "db", cloudFunctions: "functions" },
      "../notifications/notificationConfig": client,
      "firebase/functions": { httpsCallable: (_functions, name) => data => {
        calls.push({ name, data }); return new Promise(resolve => { finish = resolve; });
      } },
    });
    const first = service.ensureNotificationSummary("synthetic");
    assert.equal(service.ensureNotificationSummary("synthetic"), first);
    assert.equal(calls.length, 1);
    assert.deepEqual(plain(calls[0].data), { expectedUid: "synthetic", initializePreferences: true });
    finish({ data: { ready: true } });
    await assert.rejects(first, /準備を確認/);
    const retry = service.ensureNotificationSummary("synthetic");
    finish({ data: { ready: true, preferencesInitialized: true } }); await retry;
    const late = service.ensureNotificationSummary("synthetic");
    auth.currentUser = { uid: "other" };
    finish({ data: { preferencesInitialized: true } }); await assert.rejects(late, /ログイン状態/);
    await assert.rejects(service.ensureNotificationSummary("synthetic"), /ログイン状態/);
    assert.equal(calls.length, 3);
  });

  test(`${os}: absent settings never publish OFF; saved ON/OFF and restrictions are preserved`, () => {
    let receive;
    const seen = [];
    const service = load("notificationService.js", {
      "@react-native-async-storage/async-storage": {}, "react-native": { Platform: { OS: os } },
      "expo-notifications": {}, "firebase/firestore": { doc: (...args) => args },
      "firebase/functions": {}, "../firebase": { db: "db" },
      "../notifications/notificationConfig": client,
      "./firestoreSubscription": { measuredOnSnapshot: (_name, _ref, next) => { receive = next; return () => {}; } },
    });
    service.subscribeNotificationPreferences("synthetic", value => seen.push(plain(value)));
    for (const fromCache of [true, false]) receive({ exists: () => false, data: () => undefined, metadata: { fromCache } });
    assert.equal(seen.length, 0);
    const saved = { masterEnabled: false, categories: { operatorGuidance: false }, teamEnabled: { a: false } };
    receive({ exists: () => true, data: () => saved });
    assert.equal(seen.at(-1).masterEnabled, false);
    saved.masterEnabled = true;
    receive({ exists: () => true, data: () => saved });
    assert.equal(seen.at(-1).masterEnabled, true);
    assert.equal(seen.at(-1).categories.operatorGuidance, false);
    assert.equal(seen.at(-1).teamEnabled.a, false);
    receive({ exists: () => true, data: () => ({}) });
    assert.equal(seen.at(-1).masterEnabled, false, "existing incomplete settings are not unset");
  });
}
