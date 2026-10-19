const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");
const { monthWindow, mergeReadState, medicalDangerCount } = require("../utils/historyLoading");
function load(file, modules, extra = "", timers = {}) {
  const code = transformSync(fs.readFileSync(file, "utf8") + extra, { configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => { assert.ok(name in modules, name); return modules[name]; }, console, Map, Set, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, ...timers });
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
test("calendar grid includes adjacent dates", () => {
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
test("calendar reports retain their complete month range without a 50-report cap", () => {
  const h = hookHarness(); h.change({ name: "dailyReports", options: { start: "2026-09-01", end: "2026-09-30" } });
  const first = h.subscriptions.at(-1); assert.equal(first.options.count, null);
  first.next({ items: Array.from({ length: 900 }, (_, id) => ({ id: String(id) })), hasMore: false }); h.render();
  assert.equal(h.results.at(-1).length, 900); assert.equal(h.api.hasMore, false);
  assert.equal(first.options.start, "2026-09-01"); assert.equal(first.options.end, "2026-09-30");
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
  assert.throws(() => service.subscribeHistory("team", "dailyReports", { start: "2026-10-12", end: "2026-10-18" }, () => {}), /本人と期間/);
  assert.throws(() => service.subscribeHistory("team", "dailyReports", { authorUid: "member", author: "M" }, () => {}), /本人と期間/);
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
  const reportModules = { subscribeDailyReportHistory: (team, options, next, error) => watch("history")(team, "dailyReports", options, next, error), subscribeDailyReportDocument: watch("document") };
  const dailyHook = load(path.join(__dirname, "../hooks/useDailyReportHistory.js"), { react, "../services/dailyReportReadService": reportModules, "../utils/historyLoading": require("../utils/historyLoading"),
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } } });
  const modules = {
    react, "@react-navigation/native": { NavigationContainer: "NavigationContainer", useNavigationContainerRef: () => navigation },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({ Screen: "Screen", Navigator: "Navigator" }) },
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) }, LogBox: { ignoreLogs() {} }, Platform: { OS: "android" }, View: "View", Text: "Text", ActivityIndicator: "ActivityIndicator" },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: () => () => {} } },
    "./src/ads/AdManager": { useAds: () => ({ configureInterstitial: idle, recordScreenTransition: idle }) },
    "./src/ads/adSettings": { DEFAULT_INTERSTITIAL_SETTINGS: {}, getInterstitialSettingsFromTeamData: () => ({}) },
    "./src/utils/medicalScale": { DEFAULT_ALERT_THRESHOLDS: {} }, "./src/utils/historyLoading": require("../utils/historyLoading"),
    "./src/hooks/useHistoryData": hook, "./src/services/firestoreService": legacy,
    "./src/hooks/useDailyReportHistory": dailyHook,
    "./src/utils/dailyReportScope": require("../utils/dailyReportScope"),
    "./src/services/dailyReportReadService": { subscribeUnreviewedReports: watch("unreviewed"), subscribeRosterLatestReports: watch("rosterFallback") },
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
  calls.find((item) => item.name === "legacyTeamMembers").args[1]([{ uid: "member", name: "M", role: "member" }]); h.render();
  const gate = calls.find((item) => item.name === "LoadingState");
  gate.args[1]({ ready: false, enabled: false, status: "preparing", schemaVersion: 1 }); h.render();
  route = { name: "Diary" }; h.find((node) => node.type === "NavigationContainer").props.onStateChange(); h.render();
  const beforePreparation = calls.findLast((item) => item.name === "history" && item.args[1] === "dailyReports");
  assert.ok(beforePreparation.args[2].start); assert.equal(beforePreparation.args[2].scope.canSearchAll, false);
  const calendar = h.find((node) => node.type === "Screen" && node.props.name === "Calendar").children[0]({}).props;
  assert.equal(calendar.reportReadsReady, true); assert.equal(calendar.optimize, false);
  assert.equal(calls.filter((item) => item.name === "legacyDailyReports").length, 0);
  route = { name: "WorkspaceHome" }; h.find((node) => node.type === "NavigationContainer").props.onStateChange(); h.render();
  gate.args[1]({ ready: true, enabled: true, separateReads: true, schemaVersion: 1 }); h.render();
  assert.equal(calls.filter((item) => !item.stops && legacyNames.some((name) => item.name === "legacy" + name)).length, 0);
  const home = () => h.find((node) => node.type === "Screen" && node.props.name === "WorkspaceHome").children[0]({}).props;
  home().onChannelChange("General"); h.render();
  const post = calls.find((item) => item.name === "history" && item.args[1] === "workspacePosts");
  assert.equal(post.args[2].count, 50); assert.equal(post.args[2].channel, "General");
  route = { name: "Diary" }; h.find((node) => node.type === "NavigationContainer").props.onStateChange(); h.render();
  assert.equal(post.stops, 1);
  const report = calls.findLast((item) => item.name === "history" && item.args[1] === "dailyReports");
  assert.ok(report.args[2].start); assert.ok(report.args[2].end); assert.equal(report.args[2].count, null);
  gate.args[1]({ ready: true, enabled: false, separateReads: false, schemaVersion: 1 }); h.render();
  assert.equal(report.stops, 0, "the seven-day report subscription must survive optimization being disabled");
  assert.equal(calls.filter((item) => item.name === "legacyDailyReports").length, 0);
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

test("daily seven-day windows load old weeks only when opened, reuse listeners, and ignore late scope callbacks", () => {
  const h = componentHarness(), calls = [], results = []; let active = false, team = "a", day = "2026-10-17", foreground;
  const receive = (items) => results.push(items);
  const watch = (teamId, _name, options, next, error) => { const sub = { teamId, options, next, error, stops: 0 }; calls.push(sub); return () => sub.stops++; };
  const { useDailyReportHistory } = load(path.join(__dirname, "../hooks/useDailyReportHistory.js"), { react: h.react,
    "../utils/historyLoading": { ...require("../utils/historyLoading"), jstDay: () => day },
    "../services/dailyReportReadService": { subscribeDailyReportHistory: (teamId, options, next, error) => watch(teamId, "dailyReports", options, next, error), subscribeDailyReportDocument: (teamId, name, id, next, error) => watch(teamId, name, { id }, next, error) },
    "react-native": { AppState: { addEventListener: (_event, callback) => { foreground = callback; return { remove() {} }; } } } });
  let api; h.mount(() => { api = useDailyReportHistory(team, active, receive, { ready: true, canSearchAll: true }); return null; });
  assert.equal(calls.length, 0); assert.equal(results.length, 0, "inactive hook must preserve fallback data");
  active = true; h.update(); assert.equal(calls.length, 1);
  assert.equal(calls[0].options.start, "2026-10-11"); assert.equal(calls[0].options.end, "2026-10-17"); assert.equal(calls[0].options.count, null);
  calls[0].next({ items: [], fromCache: true }); h.render(); assert.equal(api.isDateLoaded(day), false); assert.equal(api.busy, true);
  const recent = Array.from({ length: 80 }, (_, id) => ({ id: String(id), date: day })); calls[0].next({ items: recent }); h.render(); assert.equal(results.at(-1).length, 80);
  api.loadMore(); h.render(); assert.equal(calls.length, 1, "collapsed week must not fetch");
  api.toggleWeek(1); h.render(); assert.equal(calls.length, 2); assert.equal(calls[1].options.end, "2026-10-10");
  calls[1].next({ items: [{ id: "old", date: "2026-10-09" }] }); h.render(); assert.equal(results.at(-1).length, 81);
  api.toggleWeek(1); h.render(); assert.equal(results.at(-1).length, 80); api.toggleWeek(1); h.render(); assert.equal(calls.length, 2);
  api.include("outside"); h.render(); calls.at(-1).next({ id: "outside", date: "2020-01-01" }); h.render(); assert.ok(results.at(-1).some(item => item.id === "outside"));
  calls.at(-1).next(null); h.render(); assert.equal(results.at(-1).find(item => item.id === "outside").status, "deleted");
  team = "b"; h.update(); assert.equal(calls.filter(call => call.teamId === "b").length, 1);
  calls[0].next({ items: [{ id: "late-old-team" }] }); h.render(); assert.equal(results.at(-1).length, 0);
  day = "2026-10-18"; foreground("active"); h.render(); assert.equal(calls.at(-1).options.start, "2026-10-12");
  foreground("background"); h.render(); assert.ok(calls.every(call => call.stops === 1));
  active = false; h.update(); assert.ok(calls.every(call => call.stops === 1)); h.unmount();
});

test("only owners may search all history, full search releases week listeners and demotion clears old data", () => {
  const h = componentHarness(), calls = [], results = [];
  let scope = { ready: true, role: "owner", canSearchAll: true };
  const watch = (teamId, options, next) => { const call = { options, next, stops: 0 }; calls.push(call); return () => call.stops++; };
  const { useDailyReportHistory } = load(path.join(__dirname, "../hooks/useDailyReportHistory.js"), { react: h.react,
    "../utils/historyLoading": require("../utils/historyLoading"), "../services/dailyReportReadService": { subscribeDailyReportHistory: watch },
    "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } } });
  let api; const receive = (items) => results.push(items);
  h.mount(() => { api = useDailyReportHistory("team", true, receive, scope); return null; });
  assert.ok(calls[0].options.start);
  calls[0].next({ items: [{ id: "recent" }] }); h.render();
  api.searchAll(); h.render(); assert.equal(calls[0].stops, 1);
  assert.equal(calls.at(-1).options.start, undefined); const all = calls.at(-1);
  all.next({ items: [{ id: "old-private" }] }); h.render(); assert.equal(results.at(-1)[0].id, "old-private");
  for (const role of ["admin", "staff", "member", "guardian"]) {
    scope = { ready: true, role, canSearchAll: false }; h.update();
    assert.equal(api.all, false); assert.equal(api.canSearchAll, false); assert.ok(calls.at(-1).options.start);
    const count = calls.length; api.searchAll(); h.render(); assert.equal(calls.length, count);
    all.next({ items: [{ id: "late-private" }] }); h.render(); assert.equal(results.at(-1).length, 0);
  }
  h.unmount(); assert.ok(calls.every((call) => call.stops === 1));
});

test("report dates normalize slash legacy format and seven days follow JST at UTC boundaries", () => {
  const { jstDay, reportDay, reportWeek } = require("../utils/historyLoading");
  assert.equal(jstDay(new Date("2026-10-16T14:59:59Z")), "2026-10-16");
  assert.equal(jstDay(new Date("2026-10-16T15:00:00Z")), "2026-10-17");
  assert.equal(reportDay("2026/10/17"), "2026-10-17");
  assert.deepEqual(reportWeek("2026-01-02"), { start: "2025-12-27", end: "2026-01-02" });
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
    ensurePushTokenOwnership: async () => ({ status: "undetermined" }), setApplicationBadge: idle,
    registerPushToken: async () => ({}), ensureNotificationSummary: async () => {},
  };
  for (const name of ["Summary", "Preferences", "s"]) service["subscribeNotification" + name] = (...args) => { const item = { name, args, stops: 0 }; calls.push(item); return () => item.stops++; };
  const config = load(path.join(__dirname, "../notifications/notificationConfig.js"), {});
  const { NotificationProvider } = load(path.join(__dirname, "../NotificationContext.js"), { react: { __esModule: true, default: h.react, ...h.react },
    "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove: idle }) }, Platform: { OS: "android" } },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: () => idle } },
    "./AuthContext": { useAuth: () => auth }, "./services/notificationService": { ...service, Notifications: { ...service.Notifications, addPushTokenListener: () => ({ remove: idle }) } }, "./notifications/notificationConfig": config });
  h.mount(NotificationProvider); assert.equal(calls.length, 2);
  calls[1].args[1](config.normalizeNotificationPreferences({ masterEnabled: true }));
  const oldSummary = calls[0]; oldSummary.args[1]({ unreadTotal: 7, unreadByTeam: {}, unreadBucketsVersion: 1, unreadBuckets: { '["notice","a"]': 7 } }); assert.equal(h.render().props.value.unreadTotal, 7);
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

function notificationProviderHarness(overrides = {}) {
  const h = componentHarness(), calls = [], badges = [], pushListeners = [], appListeners = [], networkListeners = [];
  const timers = new Map(); let timerId = 0;
  let user = { uid: "a" }, handler;
  const config = load(path.join(__dirname, "../notifications/notificationConfig.js"), {});
  const service = {
    Notifications: {
      setNotificationHandler: value => { handler = value.handleNotification; },
      addNotificationResponseReceivedListener: () => ({ remove() {} }), getLastNotificationResponseAsync: async () => null,
      addPushTokenListener: fn => { const sub = { fn, stopped: false }; pushListeners.push(sub); return { remove: () => { sub.stopped = true; } }; },
    },
    ensurePushTokenOwnership: async () => ({ status: "granted" }), setApplicationBadge: count => badges.push(count),
    registerPushToken: async () => ({ granted: true, status: "granted" }), ensureNotificationSummary: async () => {},
    saveNotificationPreferences: async value => value,
    ...overrides,
  };
  for (const name of ["Summary", "Preferences", "s"]) service["subscribeNotification" + name] = (...args) => {
    const call = { name, args, stops: 0 }; calls.push(call); return () => call.stops++;
  };
  const { NotificationProvider } = load(path.join(__dirname, "../NotificationContext.js"), {
    react: { __esModule: true, default: h.react, ...h.react }, "./AuthContext": { useAuth: () => ({ user }) },
    "react-native": { AppState: { currentState: "active", addEventListener: (_name, fn) => { const sub = { fn, stopped: false }; appListeners.push(sub); return { remove: () => { sub.stopped = true; } }; } }, Platform: { OS: "android" } },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: fn => { const sub = { fn, stopped: false }; networkListeners.push(sub); return () => { sub.stopped = true; }; } } },
    "./services/notificationService": service, "./notifications/notificationConfig": config,
  }, "", { setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id) });
  h.mount(NotificationProvider);
  const api = () => h.render().props.value;
  const preferences = value => { calls.findLast(call => call.name === "Preferences").args[1](config.normalizeNotificationPreferences(value)); h.render(); };
  return { ...h, api, calls, badges, preferences, pushListeners, appListeners, networkListeners, timers,
    fireTimer(ms) { const entry = [...timers].find(([_id, timer]) => timer.ms === ms); assert.ok(entry, `no ${ms}ms timer`); timers.delete(entry[0]); entry[1].fn(); },
    foreground: category => handler({ request: { content: { data: { category, teamId: "a" } } } }),
    account(value) { user = value ? { uid: value } : null; h.update(); } };
}

test("provider filters list and badge together, restores history and suppresses foreground delivery", async () => {
  const h = notificationProviderHarness();
  h.preferences({ masterEnabled: true });
  const stop = h.api().startNotificationList();
  const list = h.calls.at(-1);
  list.args[1]([{ id: "notice", category: "notice", teamId: "a" },
    { id: "reply", category: "workspaceReply", teamId: "b" },
    { id: "reminder", category: "scheduleReminder", teamId: "a" }], true);
  h.calls[0].args[1]({ unreadBucketsVersion: 1, unreadBuckets: {
    '["notice","a"]': 4, '["workspaceReply","b"]': 6, '["scheduleReminder","a"]': 9,
  } });
  assert.equal(h.api().notifications.length, 2); assert.equal(h.api().unreadTotal, 10);
  assert.equal(h.badges.at(-1), 10);
  h.preferences({ masterEnabled: true, categories: { notice: false } });
  assert.equal(h.api().notifications[0].id, "reply"); assert.equal(h.api().unreadTotal, 6);
  assert.equal((await h.foreground("notice")).shouldShowBanner, false);
  assert.equal((await h.foreground("scheduleReminder")).shouldSetBadge, false);
  h.preferences({ masterEnabled: true, teamEnabled: { b: false } });
  assert.equal(h.api().notifications[0].id, "notice"); assert.equal(h.api().unreadTotal, 4);
  h.preferences({ masterEnabled: false });
  assert.equal(h.api().notifications.length, 0); assert.equal(h.api().unreadTotal, 0);
  assert.equal(h.api().notificationListHasMore, false); assert.equal(h.badges.at(-1), 0);
  const count = h.calls.length; h.api().startNotificationList()(); assert.equal(h.calls.length, count);
  h.preferences({ masterEnabled: true });
  assert.equal(h.api().notifications.length, 2); assert.equal(h.api().unreadTotal, 10);
  assert.equal((await h.foreground("notice")).shouldShowBanner, true);
  stop(); h.unmount();
});

test("failed preference saves restore the previous visible list and badge", async () => {
  const h = notificationProviderHarness({ saveNotificationPreferences: async () => { throw new Error("Synthetic save failure"); } });
  h.preferences({ masterEnabled: true });
  h.calls[0].args[1]({ unreadBucketsVersion: 1, unreadBuckets: { '["notice","a"]': 3 } });
  const pending = h.api().updatePreferences({ masterEnabled: false });
  assert.equal(h.api().unreadTotal, 0);
  await assert.rejects(pending, /Synthetic save failure/);
  assert.equal(h.api().preferences.masterEnabled, true); assert.equal(h.api().unreadTotal, 3);
  h.unmount();
});

test("failed repair can be retried and late failures cannot affect a new account", async () => {
  let fail = true, calls = 0, rejectLate;
  const h = notificationProviderHarness({ ensureNotificationSummary: async () => {
    calls++; if (fail) throw new Error("Synthetic offline");
  } });
  await new Promise(setImmediate);
  assert.ok(h.api().notificationSummaryError);
  const oldSummary = h.calls[0];
  fail = false; await h.api().refreshNotificationSummary();
  assert.equal(h.api().notificationSummaryError, ""); assert.equal(calls, 2);
  assert.equal(oldSummary.stops, 1);
  oldSummary.args[1]({ unreadBucketsVersion: 1, unreadBuckets: { '["notice","a"]': 99 } });
  assert.equal(h.api().unreadTotal, 0);
  h.unmount();
  const late = notificationProviderHarness({ ensureNotificationSummary: () => new Promise((_resolve, reject) => { rejectLate = reject; }) });
  const oldReject = rejectLate; late.account("b"); oldReject(new Error("Late old-account failure"));
  await new Promise(setImmediate);
  assert.equal(late.api().notificationSummaryError, ""); late.unmount();
});

test("push lifecycle waits for preferences, refreshes on foreground/reconnect/native changes and removes listeners", async () => {
  const registrations = [];
  const h = notificationProviderHarness({ registerPushToken: async options => {
    registrations.push(options); return { granted: true, status: "granted", nextRefreshInMs: 86400000 };
  } });
  await new Promise(setImmediate); assert.equal(registrations.length, 0);
  h.preferences({ masterEnabled: true }); await new Promise(setImmediate); assert.equal(registrations.length, 1);
  const app = h.appListeners.at(-1), network = h.networkListeners.at(-1), token = h.pushListeners.at(-1);
  network.fn({ isConnected: true }); await new Promise(setImmediate); assert.equal(registrations.length, 1);
  network.fn({ isConnected: false }); network.fn({ isConnected: true }); await new Promise(setImmediate);
  assert.equal(registrations.length, 2);
  app.fn("active"); await new Promise(setImmediate); assert.equal(registrations.length, 3);
  token.fn({ type: "android", data: "synthetic-native" }); await new Promise(setImmediate);
  assert.equal(registrations.at(-1).devicePushToken.data, "synthetic-native");
  h.preferences({ masterEnabled: false }); await new Promise(setImmediate);
  assert.ok(app.stopped && network.stopped && token.stopped);
  const count = registrations.length; token.fn({ data: "obsolete" }); app.fn("active"); network.fn({ isConnected: true });
  await new Promise(setImmediate); assert.equal(registrations.length, count);
  h.unmount(); assert.ok(h.appListeners.every(sub => sub.stopped));
});

test("explicit notification enable consumes its successful registration without a second observer call", async () => {
  let registrations = 0;
  const h = notificationProviderHarness({ registerPushToken: async () => {
    registrations++; return { granted: true, status: "granted", nextRefreshInMs: 86400000 };
  } });
  h.preferences({ masterEnabled: false }); await new Promise(setImmediate);
  await h.api().enablePushNotifications(); h.render(); await new Promise(setImmediate);
  assert.equal(h.api().preferences.masterEnabled, true); assert.equal(registrations, 1);
  h.preferences({ masterEnabled: true }); await new Promise(setImmediate); assert.equal(registrations, 1);
  h.unmount();
});

test("reading the current native token does not cause a second registration from its listener event", async () => {
  let registrations = 0;
  const token = { data: "synthetic-native", type: "android" };
  const h = notificationProviderHarness({ registerPushToken: async () => {
    registrations++; await Promise.resolve(); h.pushListeners.at(-1).fn(token);
    return { granted: true, status: "granted", nextRefreshInMs: 86400000, nativeTokenKey: JSON.stringify([token.type, token.data]) };
  } });
  h.preferences({ masterEnabled: true }); await new Promise(setImmediate);
  assert.equal(registrations, 1); h.unmount();
});

test("a previous account's push response cannot overwrite the new account's permission state", async () => {
  let resolve;
  const h = notificationProviderHarness({ registerPushToken: () => new Promise(done => { resolve = done; }) });
  h.preferences({ masterEnabled: true }); await new Promise(setImmediate);
  h.account("b"); resolve({ granted: true, status: "obsolete", nextRefreshInMs: 86400000 });
  await new Promise(setImmediate); assert.notEqual(h.api().permissionStatus, "obsolete");
  h.unmount();
});

test("push failures use bounded retries, then renew at the returned heartbeat interval", async () => {
  let fail = true, registrations = 0;
  const h = notificationProviderHarness({ registerPushToken: async () => {
    registrations++; if (fail) throw new Error("synthetic offline");
    return { granted: true, status: "granted", nextRefreshInMs: 86400000 };
  } });
  h.preferences({ masterEnabled: true }); await new Promise(setImmediate);
  for (const delay of [30000, 120000, 600000]) { h.fireTimer(delay); await new Promise(setImmediate); }
  assert.equal(registrations, 4); assert.equal(h.timers.size, 0);
  fail = false; h.appListeners.at(-1).fn("active"); await new Promise(setImmediate);
  assert.equal(registrations, 5); h.fireTimer(86400000); await new Promise(setImmediate);
  assert.equal(registrations, 6); h.unmount(); assert.equal(h.timers.size, 0);
});

test("same-UID re-login discards an old enable result and registers the new session", async () => {
  let save, registrations = 0;
  const h = notificationProviderHarness({ registerPushToken: async () => {
    registrations++; return { granted: true, status: "granted", nextRefreshInMs: 86400000 };
  }, saveNotificationPreferences: value => new Promise(resolve => { save = () => resolve(value); }) });
  h.preferences({ masterEnabled: false });
  const enabling = h.api().enablePushNotifications(); await new Promise(setImmediate);
  h.account("a"); save(); await enabling; h.render();
  h.preferences({ masterEnabled: true }); await new Promise(setImmediate);
  assert.equal(registrations, 2); h.unmount();
});

test("notification OFF still retries former-owner cleanup after network recovery without normal registration", async () => {
  let repairs = 0, registrations = 0, fail = true;
  const h = notificationProviderHarness({ ensurePushTokenOwnership: async () => {
    repairs++; if (fail) throw new Error("synthetic offline"); return { status: "granted" };
  }, registerPushToken: async () => { registrations++; return {}; } });
  h.preferences({ masterEnabled: false }); await new Promise(setImmediate);
  const network = h.networkListeners.at(-1); network.fn({ isConnected: false });
  fail = false; network.fn({ isConnected: true }); await new Promise(setImmediate);
  assert.equal(repairs, 2); assert.equal(registrations, 0);
  assert.equal(h.api().preferences.masterEnabled, false); assert.equal(h.timers.size, 0);
  h.unmount();
});
