const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");
const { monthAgo, monthWindow, mergeReadState, medicalDangerCount } = require("../utils/historyLoading");
function load(file, modules, extra = "") {
  const code = transformSync(fs.readFileSync(file, "utf8") + extra, { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => { assert.ok(name in modules, name); return modules[name]; }, console, Map, Set, setTimeout: () => 1, clearTimeout() {} });
  return module.exports;
}
function hookHarness(pageReader = async () => ({ items: [], hasMore: false })) {
  const slots = [], subscriptions = [], results = [];
  let cursor, dirty = true, effects, api, props = { teamId: "a", name: "workspacePosts", active: true, options: { uid: "member" } };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial) { const index = cursor++; slots[index] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[index].set ||= (update) => { const value = typeof update === "function" ? update(slots[index].value) : update; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } };
      return [slots[index].value, slots[index].set]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const receive = (items) => results.push(JSON.parse(JSON.stringify(items)));
  const watch = (teamId, name, options, next, error) => { const sub = { teamId, name, options, next, error, stops: 0 }; subscriptions.push(sub); return () => sub.stops++; };
  const { useHistoryData } = load(path.join(__dirname, "../hooks/useHistoryData.js"), { react,
    "../services/historyDataService": { subscribeHistory: watch, readHistoryPage: pageReader, subscribeHistoryDocument: (team, name, id, next, error) => watch(team, name, { id }, next, error) },
    "../utils/historyLoading": require("../utils/historyLoading") });
  const render = () => { let passes = 0; while (dirty) { assert.ok(++passes < 30, "hook did not settle"); dirty = false; cursor = 0; effects = []; api = useHistoryData(props.teamId, props.name, props.active, props.options, receive); effects.forEach((fn) => fn()); } return api; };
  render();
  return { render, subscriptions, results, get api() { return api; }, change(value) { props = { ...props, ...value }; dirty = true; render(); }, unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}
test("rolling month clamps month ends and calendar grid includes adjacent dates", () => {
  assert.equal(monthAgo(new Date(2026, 2, 31)), "2026-02-28");
  assert.equal(monthAgo(new Date(2024, 2, 31)), "2024-02-29");
  assert.deepEqual(monthWindow("2026-10-05"), { start: "2026-09-27", end: "2026-10-31" });
});
test("separated read state merges legacy readers and reply notifications without changing source", () => {
  const post = { id: "p", readBy: ["old"], readByUids: ["oldUid"], replies: [{ id: "r" }] };
  const merged = mergeReadState(post, { readers: { a: true }, notificationReads: { a: ["reply:r"] } }, { member: { uid: "a" } });
  assert.deepEqual(merged.readByUids, ["oldUid", "a"]); assert.deepEqual(merged.replies[0].readNotifs, ["member"]);
  assert.deepEqual(post.readBy, ["old"]); assert.equal(post.replies[0].readNotifs, undefined);
});
test("medical badge keeps older unreviewed reports and reacts to local threshold changes", () => {
  assert.equal(medicalDangerCount({ "0:0:4:0": 2, "1:0:3:0": 1 }, { fatigueDanger: 5, painDanger: 5 }), 1);
  assert.equal(medicalDangerCount({ "0:0:4:0": 2, "1:0:3:0": 1 }, { fatigueDanger: 4, painDanger: 5 }), 3);
});
test("latest 50 is the initial window; explicit expansion stays live and replaces changed/deleted rows", () => {
  const h = hookHarness(), first = h.subscriptions.at(-1); assert.equal(first.options.count, 50);
  first.next({ items: [{ id: "old" }], hasMore: true }); h.render(); h.api.loadMore(); h.render();
  assert.equal(first.stops, 1); assert.equal(h.subscriptions.at(-1).options.count, 100);
  h.subscriptions.at(-1).next({ items: [{ id: "new" }], hasMore: false }); h.render();
  assert.deepEqual(h.results.at(-1), [{ id: "new" }]);
});
test("report expansion adds history without dropping the already visible month", () => {
  const h = hookHarness(); h.change({ name: "dailyReports", options: { since: "2026-09-05" } });
  const first = h.subscriptions.at(-1); assert.equal(first.options.count, null);
  first.next({ items: Array.from({ length: 900 }, (_, id) => ({ id: String(id) })), hasMore: false }); h.render(); h.api.loadMore(); h.render();
  assert.equal(h.subscriptions.at(-1).options.count, 950); assert.equal(h.subscriptions.at(-1).options.since, undefined); assert.equal(h.api.all, false);
});
test("full history search is explicit and paged, then attaches a live complete window", async () => {
  let reads = 0;
  const h = hookHarness(async (_team, _name, _opts, cursor) => { reads++; return cursor ? { items: [{ id: "older" }], hasMore: false } : { items: Array.from({ length: 50 }, (_, id) => ({ id: String(id) })), cursor: "cursor", hasMore: true }; });
  assert.equal(reads, 0); await h.api.searchAll(); h.render(); assert.equal(reads, 2); assert.equal(h.api.all, true); assert.equal(h.subscriptions.at(-1).options.count, 101);
});
test("team switches, blur, cancelled search, and late snapshots cannot mix data", async () => {
  let resolve;
  const h = hookHarness(() => new Promise((done) => { resolve = done; })), old = h.subscriptions.at(-1);
  const search = h.api.searchAll(); h.api.cancel(); resolve({ items: [{ id: "late" }], hasMore: false }); await search; h.render(); assert.equal(h.api.all, false);
  h.change({ teamId: "b" }); old.next({ items: [{ id: "wrong-team" }], hasMore: false }); h.render(); assert.ok(!h.results.flat().some((item) => item.id === "wrong-team"));
  h.change({ active: false }); assert.ok(h.subscriptions.every((sub) => sub.stops === 1)); assert.deepEqual(h.results.at(-1), []);
});
function searchRaceHarness() {
  const pending = [];
  const h = hookHarness(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  h.subscriptions.at(-1).next({ items: [], hasMore: true }); h.render();
  return { h, pending, begin() { const result = h.api.searchAll(); h.render(); return result; } };
}

test("cancel and restart: an old success cannot finish the new history search", async () => {
  const { h, pending, begin } = searchRaceHarness();
  const first = begin(); h.api.cancel(); h.render(); const second = begin();
  pending[0].resolve({ items: Array.from({ length: 50 }, (_, id) => ({ id: String(id) })), hasMore: false });
  await first; h.render();
  const oldResult = { all: h.api.all, searching: h.api.searching, count: h.subscriptions.at(-1).options.count };
  pending[1].resolve({ items: [{ id: "current" }], hasMore: false }); await second; h.render();
  const currentResult = { all: h.api.all, count: h.subscriptions.at(-1).options.count }; h.unmount();
  assert.deepEqual(oldResult, { all: false, searching: true, count: 50 });
  assert.deepEqual(currentResult, { all: true, count: 51 });
});

test("cancel and restart: an old failure cannot stop or report an error for the new search", async () => {
  const { h, pending, begin } = searchRaceHarness();
  const first = begin(); h.api.cancel(); h.render(); const second = begin();
  pending[0].reject(new Error("obsolete search")); await first; h.render();
  const oldResult = { error: h.api.error, searching: h.api.searching, busy: h.api.busy };
  pending[1].resolve({ items: [{ id: "current" }], hasMore: false }); await second; h.render();
  const all = h.api.all; h.unmount();
  assert.deepEqual(oldResult, { error: "", searching: true, busy: true }); assert.equal(all, true);
});

test("a previous team's search failure cannot suppress the new team's successful search", async () => {
  const { h, pending, begin } = searchRaceHarness();
  const first = begin(); h.change({ teamId: "b" });
  h.subscriptions.at(-1).next({ items: [], hasMore: true }); h.render(); const second = begin();
  pending[0].reject(new Error("obsolete team")); await first; h.render();
  pending[1].resolve({ items: [{ id: "new-team" }], hasMore: false }); await second; h.render();
  const all = h.api.all, error = h.api.error; h.unmount();
  assert.equal(all, true); assert.equal(error, "");
});

test("cancelling history search keeps the live list subscription usable", async () => {
  const { h, pending, begin } = searchRaceHarness(), sub = h.subscriptions.at(-1);
  const search = begin(); h.api.cancel(); h.render();
  sub.next({ items: [{ id: "live-edit" }], hasMore: false }); h.render();
  pending[0].resolve({ items: [{ id: "obsolete" }], hasMore: false }); await search; h.render();
  const items = h.results.at(-1), all = h.api.all; h.unmount();
  assert.deepEqual(items, [{ id: "live-edit" }]); assert.equal(all, false);
});

test("inactive history hooks leave the legacy subscription's data intact on option changes", () => {
  const h = hookHarness(); h.change({ active: false }); const calls = h.results.length;
  h.change({ options: { uid: "member", channel: "other" } });
  assert.equal(h.results.length, calls); h.unmount();
});
test("a notification can subscribe to an old document outside the initial page", () => {
  const h = hookHarness(); h.api.include("older"); h.render(); const detail = h.subscriptions.at(-1);
  detail.next({ id: "older", visibleToUids: ["member"] }); h.render(); assert.equal(h.results.at(-1).at(-1).id, "older");
  detail.next(null); h.render(); assert.ok(!h.results.at(-1).some((item) => item.id === "older")); h.unmount(); assert.equal(detail.stops, 1);
});
test("real queries keep post audience/channel constraints and calendar overlap", () => {
  const recorded = [];
  const sdk = Object.fromEntries(["and", "collection", "doc", "documentId", "limit", "or", "orderBy", "query", "startAfter", "where"].map((name) => [name, (...args) => ({ name, args })]));
  const service = load(path.join(__dirname, "historyDataService.js"), { "firebase/firestore": sdk, "../firebase": { db: "db" }, "./firestoreSubscription": { measuredOnSnapshot: (name, ref) => { recorded.push({ name, ref }); return () => {}; } }, "../utils/historyLoading": require("../utils/historyLoading") });
  service.subscribeHistory("team", "workspacePosts", { uid: "member", channel: "General", count: 50 }, () => {});
  const constraints = recorded.at(-1).ref.args.slice(1).map((item) => item.args);
  assert.ok(constraints.some((item) => item.join() === "visibleToUids,array-contains,member")); assert.ok(constraints.some((item) => item.join() === "channel,==,General"));
  service.subscribeHistory("team", "clubEvents", { start: "2026-09-27", end: "2026-10-31" }, () => {});
  assert.ok(recorded.at(-1).ref.args.some((item) => item.args?.join() === "lastEventDate,>=,2026-09-27"));
});

function componentHarness() {
  const slots = [];
  let cursor = 0, dirty = true, effects = [], component, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    createContext: () => ({ Provider: "Provider" }),
    useState(initial) { const index = cursor++; slots[index] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[index].set ||= (update) => { const next = typeof update === "function" ? update(slots[index].value) : update; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }; return [slots[index].value, slots[index].set]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const render = () => { let passes = 0; while (dirty) { assert.ok(++passes < 30, "component did not settle"); dirty = false; cursor = 0; effects = []; tree = component({ children: null, navigation: {} }); effects.forEach((fn) => fn()); } return tree; };
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of Array.isArray(node) ? node : node.children || []) { const result = find(predicate, child); if (result) return result; }
    return null;
  };
  return { react, render, find, mount(fn) { component = fn; return render(); }, update() { dirty = true; return render(); }, unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}
test("startup waits for the gate; navigation owns bounded listeners; rollback retains separated reads", () => {
  const h = componentHarness(), react = { __esModule: true, default: h.react, ...h.react }, calls = [];
  let auth = { user: { uid: "member" }, activeTeamId: "a", userName: "M", selectTeam() {} }, route = { name: "WorkspaceHome" };
  const navigation = { getCurrentRoute: () => route };
  const watch = (name) => (...args) => { const sub = { name, args, stops: 0 }; calls.push(sub); return () => sub.stops++; };
  const legacyNames = ["Projects", "HighlightProjects", "DailyReports", "Notices", "WorkspacePosts", "PersonalEvents", "ClubEvents", "TagGroups"];
  const legacy = Object.fromEntries([...legacyNames, "TeamData", "TeamMembers"].map((name) => ["subscribe" + name, watch("legacy" + name)]));
  const historyModules = { subscribeHistory: watch("history"), readHistoryPage: async () => ({ items: [], hasMore: false }), subscribeHistoryDocument: watch("document") };
  const hook = load(path.join(__dirname, "../hooks/useHistoryData.js"), { react, "../services/historyDataService": historyModules, "../utils/historyLoading": require("../utils/historyLoading") });
  const modules = {
    react, "@react-navigation/native": { NavigationContainer: "NavigationContainer", useNavigationContainerRef: () => navigation },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({ Screen: "Screen", Navigator: "Navigator" }) },
    "react-native": { LogBox: { ignoreLogs() {} }, Platform: { OS: "android" }, View: "View", Text: "Text", ActivityIndicator: "ActivityIndicator" },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: () => () => {} } },
    "./src/ads/AdManager": { useAds: () => ({ configureInterstitial: idle, recordScreenTransition: idle }) },
    "./src/ads/adSettings": { DEFAULT_INTERSTITIAL_SETTINGS: {}, getInterstitialSettingsFromTeamData: () => ({}) },
    "./src/utils/medicalScale": { DEFAULT_ALERT_THRESHOLDS: {} }, "./src/utils/historyLoading": require("../utils/historyLoading"),
    "./src/hooks/useHistoryData": hook, "./src/services/firestoreService": legacy,
    "./src/services/historyDataService": Object.fromEntries(["LoadingState", "LoadingSummary", "LatestReports", "PostReadStates", "PinnedPosts"].map((name) => ["subscribe" + name, watch(name)])),
    "./src/AuthContext": { useAuth: () => auth }, "./src/NotificationContext": { useNotifications: () => ({ setNavigationHandler: idle }) },
  };
  function idle() {}
  const appPath = path.join(__dirname, "../../App.js");
  for (const match of fs.readFileSync(appPath, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) modules[match[1]] ||= { __esModule: true, default: match[1] };
  const { AppContent } = load(appPath, modules, "\nexport { AppContent };\n");
  h.mount(AppContent);
  assert.equal(calls.filter((item) => legacyNames.some((name) => item.name === "legacy" + name) || item.name === "history").length, 0);
  assert.equal(calls.filter((item) => ["legacyTeamData", "legacyTeamMembers"].includes(item.name)).length, 2);
  const gate = calls.find((item) => item.name === "LoadingState");
  gate.args[1]({ ready: true, enabled: true, separateReads: true, schemaVersion: 1 }); h.render();
  assert.equal(calls.filter((item) => legacyNames.some((name) => item.name === "legacy" + name)).length, 0);
  const home = () => h.find((node) => node.type === "Screen" && node.props.name === "WorkspaceHome").children[0]({}).props;
  home().onChannelChange("General"); h.render();
  const post = calls.find((item) => item.name === "history" && item.args[1] === "workspacePosts");
  assert.equal(post.args[2].count, 50); assert.equal(post.args[2].channel, "General");
  route = { name: "Diary" }; h.find((node) => node.type === "NavigationContainer").props.onStateChange(); h.render();
  assert.equal(post.stops, 1);
  const report = calls.find((item) => item.name === "history" && item.args[1] === "dailyReports");
  assert.ok(report.args[2].since); assert.equal(report.args[2].count, null);
  gate.args[1]({ ready: true, enabled: false, separateReads: false, schemaVersion: 1 }); h.render();
  assert.equal(report.stops, 1);
  const legacyPosts = calls.findLast((item) => item.name === "legacyWorkspacePosts");
  legacyPosts.args[2]([{ id: "old", readBy: [] }]); h.render();
  route = { name: "WorkspaceHome" }; h.find((node) => node.type === "NavigationContainer").props.onStateChange(); h.render();
  home().onChannelChange("Other"); h.render(); assert.equal(home().posts[0].id, "old");
  const receipts = calls.findLast((item) => item.name === "PostReadStates");
  receipts.args[2]({ old: { readers: { member: true } } }); h.render();
  assert.ok(home().posts[0].readByUids.includes("member")); assert.equal(home().separateReads, false);
  auth = { ...auth, activeTeamId: "b" }; h.update();
  gate.args[1]({ ready: true, enabled: true, schemaVersion: 1 }); h.render();
  assert.equal(home().posts.length, 0); assert.equal(gate.stops, 1);
  h.unmount(); assert.ok(calls.every((item) => item.stops === 1));
});
test("an empty cached gate cannot start a legacy whole-history fetch", () => {
  let receive; const values = [];
  const service = load(path.join(__dirname, "historyDataService.js"), { "firebase/firestore": { doc: (...args) => args }, "../firebase": { db: "db" }, "../utils/historyLoading": require("../utils/historyLoading"), "./firestoreSubscription": { measuredOnSnapshot: (_name, _ref, next) => { receive = next; return () => {}; } } });
  service.subscribeLoadingState("team", (value) => values.push(value), () => {});
  receive({ exists: () => false, metadata: { fromCache: true }, data: () => undefined }); assert.equal(values.length, 0);
  receive({ exists: () => true, metadata: { fromCache: true }, data: () => ({ ready: true }) }); assert.equal(values[0].ready, true);
  receive({ exists: () => false, metadata: { fromCache: false }, data: () => undefined }); assert.equal(Object.keys(values.at(-1)).length, 0);
});
test("reference batches publish only after all chunks arrive, so a saved later clip is not considered missing", () => {
  const callbacks = [], values = [];
  const sdk = Object.fromEntries(["collection", "documentId", "where", "query"].map((name) => [name, (...args) => args]));
  const service = load(path.join(__dirname, "historyDataService.js"), { "firebase/firestore": sdk, "../firebase": { db: "db" }, "../utils/historyLoading": require("../utils/historyLoading"), "./firestoreSubscription": { measuredOnSnapshot: (_name, _ref, next) => { callbacks.push(next); return () => {}; } } });
  service.subscribeProjectsByIds("team", Array.from({ length: 31 }, (_, index) => String(index)), (value) => values.push(value));
  callbacks[0]({ docs: [{ id: "0", data: () => ({}) }] }); assert.equal(values.length, 0);
  callbacks[1]({ docs: [{ id: "30", data: () => ({}) }] }); assert.equal(values[0].length, 2);
});
test("notification provider keeps summaries at startup and subscribes to the list only when requested", () => {
  const h = componentHarness(), calls = [];
  let auth = { user: { uid: "a" } };
  const idle = () => {};
  const service = {
    Notifications: { setNotificationHandler: idle, addNotificationResponseReceivedListener: () => ({ remove: idle }), getLastNotificationResponseAsync: async () => null },
    getNotificationPermissionStatus: async () => "undetermined", setApplicationBadge: idle,
    registerPushToken: async () => ({}),
  };
  for (const name of ["Summary", "Preferences", "s"]) service["subscribeNotification" + name] = (...args) => { const item = { name, args, stops: 0 }; calls.push(item); return () => item.stops++; };
  const { NotificationProvider } = load(path.join(__dirname, "../NotificationContext.js"), { react: { __esModule: true, default: h.react, ...h.react }, "./AuthContext": { useAuth: () => auth }, "./services/notificationService": service, "./notifications/notificationConfig": { DEFAULT_NOTIFICATION_PREFERENCES: {}, normalizeNotificationPreferences: (value) => value } });
  h.mount(NotificationProvider); assert.equal(calls.length, 2);
  const oldSummary = calls[0]; oldSummary.args[1]({ unreadTotal: 7, unreadByTeam: {} }); assert.equal(h.render().props.value.unreadTotal, 7);
  const stop = h.render().props.value.startNotificationList(100);
  const list = calls.at(-1); assert.equal(list.name, "s"); assert.equal(list.args[3], 100);
  list.args[1]([{ id: "n" }], true); assert.equal(h.render().props.value.notifications.length, 1);
  stop(); list.args[1]([{ id: "late" }], true); assert.equal(h.render().props.value.notifications.length, 0);
  auth = { user: { uid: "b" } }; h.update();
  oldSummary.args[1]({ unreadTotal: 99 }); assert.equal(h.render().props.value.unreadTotal, 0); assert.equal(oldSummary.stops, 1);
  h.unmount(); assert.ok(calls.every((item) => item.stops === 1));
});
test("notification center stops its list on blur and renews it on focus", () => {
  const h = componentHarness(), calls = []; let focused = true;
  const value = { notifications: [], unreadTotal: 4, startNotificationList: (count) => { const item = { count, stops: 0 }; calls.push(item); return () => item.stops++; } };
  const { default: Screen } = load(path.join(__dirname, "../screens/NotificationCenterScreen.js"), { react: { __esModule: true, default: h.react, ...h.react }, "@react-navigation/native": { useFocusEffect: (fn) => h.react.useEffect(() => focused ? fn() : undefined, [focused, fn]) }, "react-native": { StyleSheet: { create: (value) => value }, TouchableOpacity: "TouchableOpacity", Text: "Text", View: "View", ScrollView: "ScrollView" }, "react-native-safe-area-context": {}, "../NotificationContext": { useNotifications: () => value }, "../notifications/notificationConfig": {} });
  h.mount(Screen); assert.equal(calls[0].count, 100);
  focused = false; h.update(); assert.equal(calls[0].stops, 1); assert.equal(calls.length, 1);
  focused = true; h.update(); assert.equal(calls.length, 2); h.unmount(); assert.equal(calls[1].stops, 1);
});
