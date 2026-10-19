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
    "../firebase": { db: "db", cloudFunctions: "functions" },
    "../notifications/notificationConfig": client,
  });
  let summary;
  const stop = service.subscribeNotificationSummary("synthetic", value => { summary = value; });
  receive({ data: () => ({ unreadTotal: 5, unreadBucketsVersion: 1, unreadBuckets: { '["notice","a"]': 5 } }) });
  assert.equal(summary.unreadBucketsVersion, 1);
  assert.equal(summary.unreadBuckets['["notice","a"]'], 5);
  await service.ensureNotificationSummary();
  assert.deepEqual(plain(called), { name: "ensureNotificationSummary", data: {} });
  stop(); assert.equal(stopped, true);
});
