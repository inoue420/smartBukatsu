const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), Module = require("node:module");
const { transformSync } = require("@babel/core");
const { createMeasuredOnSnapshot, createFirestoreDiagnostics } = require("./firestoreDiagnostics");
const historyUtils = require("../utils/historyLoading");
const root = path.join(__dirname, "../..");
const idle = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function load(file, modules, extra = "", timers = { setTimeout: () => 1, clearTimeout: idle }) {
  const code = transformSync(fs.readFileSync(file, "utf8") + extra, { cwd: root, configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { assert.ok(name in modules, name); return modules[name]; },
    // Keep synthetic cross-realm Errors out of node:test's IPC log serializer.
    console: { log: idle, warn: idle, error: idle }, Map, Set, ...timers });
  return module.exports;
}
function componentHarness() {
  const slots = [];
  let cursor, dirty = true, effects, component, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }), createContext: () => ({ Provider: "Provider" }),
    useState(initial) { const index = cursor++; slots[index] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[index].set ||= update => { const next = typeof update === "function" ? update(slots[index].value) : update; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }; return [slots[index].value, slots[index].set]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { value: fn(), deps }; return slots[index].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const render = () => { let passes = 0; while (dirty) { assert.ok(++passes < 40, "component did not settle"); dirty = false; cursor = 0; effects = []; tree = component({ children: null }); effects.forEach(fn => fn()); } return tree; };
  const find = (predicate, node = tree) => { if (!node || typeof node !== "object") return null; if (predicate(node)) return node;
    for (const child of Array.isArray(node) ? node : node.children || []) { const result = find(predicate, child); if (result) return result; } return null; };
  return { react: { __esModule: true, default: react, ...react }, render, find,
    mount(fn) { component = fn; return render(); }, update() { dirty = true; return render(); }, unmount() { slots.forEach(slot => slot.cleanup?.()); } };
}

// Exercise the installed SDK's event filtering, including the metadata-only
// cache -> server transition. No Firestore instance or network is created.
let sdkInternals;
function gateEnvironment(enabled = false) {
  if (!sdkInternals) {
    const filename = require.resolve("@firebase/firestore"), module = new Module(filename);
    module.filename = filename; module.paths = Module._nodeModulePaths(path.dirname(filename));
    module._compile(fs.readFileSync(filename, "utf8") + "\nexports.teamSwitchTest = { QueryListener, ViewSnapshot, DocumentSet, documentKeySet };", filename);
    sdkInternals = module.exports.teamSwitchTest;
  }
  const { QueryListener, ViewSnapshot, DocumentSet, documentKeySet } = sdkInternals, calls = [];
  const measuredOnSnapshot = createMeasuredOnSnapshot((reference, options, next, error) => {
    if (typeof options === "function") { error = next; next = options; options = {}; }
    const listener = new QueryListener({}, { next(snap) { next({ exists: () => false, data: () => undefined, metadata: { fromCache: snap.fromCache } }); }, error }, options);
    const sub = { reference, options, stops: 0, listener, emit(fromCache, hasCachedResults = true) {
      const docs = new DocumentSet(); listener.onViewSnapshot(new ViewSnapshot({}, docs, docs, [], documentKeySet(), fromCache, true, false, hasCachedResults));
    } };
    calls.push(sub); return () => sub.stops++;
  }, createFirestoreDiagnostics({ enabled }));
  const service = load(path.join(__dirname, "historyDataService.js"), { "firebase/firestore": { doc: (...args) => args }, "../firebase": { db: "demo" },
    "../utils/historyLoading": historyUtils, "./firestoreSubscription": { measuredOnSnapshot } });
  return { calls, service };
}
for (const enabled of [false, true]) {
  test(`missing cached setting resolves on server metadata confirmation (diagnostics=${enabled})`, () => {
    const env = gateEnvironment(enabled), values = [], stop = env.service.subscribeLoadingState("a", value => values.push(value), idle);
    const sub = env.calls[0]; assert.equal(sub.options.includeMetadataChanges, true);
    sub.emit(true); assert.equal(values.length, 0);
    sub.emit(false); assert.equal(values.length, 1); assert.equal(Object.keys(values[0]).length, 0);
    stop(); assert.equal(sub.stops, 1);
  });
}
test("offline empty setting resolves after reconnection without starting legacy history early", () => {
  const env = gateEnvironment(), values = [];
  env.service.subscribeLoadingState("a", value => values.push(value), idle);
  const sub = env.calls[0]; sub.listener.applyOnlineStateChange("Offline"); sub.emit(true, false);
  assert.equal(values.length, 0); sub.listener.applyOnlineStateChange("Online"); sub.emit(false);
  assert.equal(values.length, 1);
});

function appHarness() {
  const h = componentHarness(), calls = [], gate = gateEnvironment();
  let auth = { user: { uid: "member" }, userName: "User", activeTeamId: "a", selectTeam: idle };
  const watch = name => (...args) => { const sub = { name, args, stops: 0 }; calls.push(sub); return () => sub.stops++; };
  const legacyNames = ["Projects", "HighlightProjects", "DailyReports", "Notices", "WorkspacePosts", "PersonalEvents", "ClubEvents", "TagGroups"];
  const hook = load(path.join(root, "src/hooks/useHistoryData.js"), { react: h.react, "../utils/historyLoading": historyUtils,
    "../services/historyDataService": { subscribeHistory: watch("History"), readHistoryPage: async () => ({ items: [], hasMore: false }), subscribeHistoryDocument: watch("Document") } });
  const modules = {
    react: h.react, "@react-navigation/native": { NavigationContainer: "NavigationContainer", useNavigationContainerRef: () => ({ getCurrentRoute: () => ({ name: "WorkspaceHome" }) }) },
    "./src/hooks/useTeamInvitation": { useTeamInvitation: () => ({ invitationReady: true, pendingInvitation: null }) },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({ Screen: "Screen", Navigator: "Navigator" }) },
    "react-native": { LogBox: { ignoreLogs: idle }, AppState: { currentState: "active", addEventListener: () => ({ remove: idle }) },
      Alert: { alert: idle }, Platform: { OS: "android" }, View: "View", Text: "Text", ActivityIndicator: "ActivityIndicator" },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: () => idle } },
    "./src/ads/AdManager": { useAds: () => ({ configureInterstitial: idle, recordScreenTransition: idle }) },
    "./src/ads/adSettings": { DEFAULT_INTERSTITIAL_SETTINGS: {}, getInterstitialSettingsFromTeamData: () => ({}) },
    "./src/utils/medicalScale": { DEFAULT_ALERT_THRESHOLDS: {} }, "./src/utils/historyLoading": historyUtils, "./src/hooks/useHistoryData": hook,
    "./src/utils/dailyReportScope": require("../utils/dailyReportScope"),
    // This test stays on home; diary history has its own hook/integration tests.
    "./src/hooks/useDailyReportHistory": { useDailyReportHistory: () => ({ include: idle }) },
    "./src/hooks/useAppReview": { useAppReview: () => ({ cancelReview: idle, completeInteraction: idle, reviewNavigationChanged: idle }) },
    "./src/services/dailyReportReadService": { subscribeUnreviewedReports: watch("Alerts"), subscribeRosterLatestReports: watch("RosterReports") },
    "./src/services/firestoreService": Object.fromEntries([...legacyNames, "TeamData", "TeamMembers"].map(name => ["subscribe" + name, watch(name)])),
    "./src/services/historyDataService": { ...Object.fromEntries(["LoadingSummary", "LatestReports", "PostReadStates", "PinnedPosts"].map(name => ["subscribe" + name, watch(name)])), subscribeLoadingState: gate.service.subscribeLoadingState },
    "./src/AuthContext": { useAuth: () => auth }, "./src/NotificationContext": { useNotifications: () => ({ setNavigationHandler: () => idle }) },
  };
  const file = path.join(root, "App.js");
  for (const match of fs.readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) modules[match[1]] ||= { __esModule: true, default: match[1] };
  const { AppContent } = load(file, modules, "\nexport { AppContent };\n"); h.mount(AppContent);
  const props = name => h.find(node => node.type === "Screen" && node.props.name === name).children[0]({}).props;
  return { h, calls, gate, home: () => props("WorkspaceHome"), roster: () => props("Roster"), update(values) { auth = { ...auth, ...values }; h.update(); } };
}
test("A -> B -> A resumes legacy data for absent settings and ignores old team callbacks", () => {
  const a = appHarness(), { h, calls, gate } = a;
  const teamA = calls.find(sub => sub.name === "TeamData"), membersA = calls.find(sub => sub.name === "TeamMembers");
  teamA.args[1]({ name: "A", grades: ["A grade"], positions: ["A position"] });
  membersA.args[1]([{ uid: "member", name: "Member A", role: "admin" }]); h.render();
  assert.equal(a.home().teamName, "A"); assert.equal(a.home().clubMembers.length, 1);
  assert.ok(h.find(node => node.props?.accessibilityRole === "progressbar"));
  assert.equal(calls.filter(sub => sub.name === "WorkspacePosts").length, 0);
  gate.calls[0].emit(true, false); gate.calls[0].emit(false); h.render();
  assert.equal(h.find(node => node.props?.accessibilityRole === "progressbar"), null);
  const postsA = calls.find(sub => sub.name === "WorkspacePosts"), reportsA = calls.find(sub => sub.name === "Alerts");
  postsA.args[2]([{ id: "a-post" }]); reportsA.args[2]([{ id: "a-report" }]); h.render();
  assert.equal(a.home().posts.length, 1);
  a.update({ activeTeamId: "b" });
  assert.ok(h.find(node => node.props?.accessibilityRole === "progressbar"));
  assert.equal(a.home().posts.length, 0); assert.equal(a.home().dailyReports.length, 0); assert.equal(a.home().clubMembers.length, 0);
  assert.notEqual(a.home().teamName, "A");
  assert.equal(a.roster().grades[0], "1年生"); assert.equal(a.roster().positions[0], "GK");
  teamA.args[1]({ name: "late A" }); membersA.args[1]([{ uid: "a", name: "Late A" }]);
  postsA.args[2]([{ id: "late-a-post" }]); reportsA.args[2]([{ id: "late-a-report" }]); h.render();
  assert.notEqual(a.home().teamName, "late A"); assert.equal(a.home().posts.length, 0); assert.equal(a.home().clubMembers.length, 0);
  calls.findLast(sub => sub.name === "TeamData").args[1]({ name: "B" }); h.render();
  gate.calls.at(-1).emit(true); gate.calls.at(-1).emit(false); h.render();
  assert.ok(calls.some(sub => sub.name === "WorkspacePosts" && sub.args[0] === "b"));
  assert.equal(a.home().teamName, "B");
  assert.equal(h.find(node => node.props?.accessibilityRole === "progressbar"), null);
  a.update({ activeTeamId: "a" }); gate.calls.at(-1).emit(true); gate.calls.at(-1).emit(false); h.render();
  assert.equal(calls.filter(sub => sub.name === "WorkspacePosts" && sub.args[0] === "a").length, 2);
  h.unmount(); assert.ok(calls.every(sub => sub.stops === 1)); assert.ok(gate.calls.every(sub => sub.stops === 1));
});

async function authHarness() {
  const h = componentHarness(), calls = [], switches = [], savedOperations = []; let authCallback;
  const auth = { currentUser: null };
  const sdk = { doc: (...args) => args, getDoc: async () => ({ exists: () => true, data: () => ({}) }), setDoc: async () => {}, serverTimestamp: idle };
  const { AuthProvider } = load(path.join(root, "src/AuthContext.js"), { react: h.react,
    "firebase/auth": { onAuthStateChanged: (_auth, fn) => { authCallback = u => { auth.currentUser = u; return fn(u); }; return idle; } }, "firebase/firestore": sdk,
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => null } },
    "./utils/pendingRegistration": require("../utils/pendingRegistration"),
    "./firebase": { auth, db: "demo" }, "./services/notificationService": { unregisterPushTokenForCurrentDevice: idle, setPushRegistrationSession: idle },
    "./services/firestoreSubscription": { measuredOnSnapshot: (name, ref, next, error) => { const sub = { name, ref, next, error }; calls.push(sub); return idle; } },
    "./services/firestoreService": { switchActiveTeam: (uid, teamId) => { const result = deferred(); switches.push({ uid, teamId, ...result }); return result.promise; },
      ...Object.fromEntries(["createTeam", "joinTeamWithInvite"].map(name => [name, (...args) => { const result = deferred(); savedOperations.push({ name, args, ...result }); return result.promise; }])) },
  });
  h.mount(AuthProvider); await authCallback({ uid: "member", emailVerified: true }); h.render();
  const user = calls.find(sub => sub.name === "authUser");
  user.next({ exists: () => true, data: () => ({ activeTeamId: "a", teamIds: ["a", "b", "c"] }) }); h.render();
  return { h, calls, switches, savedOperations, user, value: () => h.render().props.value, changeUser: authCallback };
}
test("AuthProvider rejects concurrent switches before another write starts and reflects only successful saves", async () => {
  const a = await authHarness(), initial = a.value(), selecting = initial.selectTeam("b");
  assert.equal(a.value().isTeamSwitching, true);
  await assert.rejects(initial.selectTeam("c"), /切り替え中/); assert.equal(a.switches.length, 1);
  a.switches[0].resolve(); await selecting;
  assert.equal(a.value().activeTeamId, "b"); assert.equal(a.value().isTeamSwitching, false);
  const retry = a.value().selectTeam("c"); a.switches[1].reject(new Error("save failed")); await assert.rejects(retry, /save failed/);
  assert.equal(a.value().activeTeamId, "b"); assert.equal(a.value().isTeamSwitching, false);
  const final = a.value().selectTeam("c"); a.switches[2].resolve(); await final; assert.equal(a.value().activeTeamId, "c"); a.h.unmount();
});
test("logout and old membership callbacks cannot restore an obsolete selection", async () => {
  const a = await authHarness(), oldMembership = a.calls.find(sub => sub.name === "authMembership");
  const selecting = a.value().selectTeam("b"); a.switches[0].resolve(); await selecting; a.h.render();
  oldMembership.error({ code: "permission-denied" }); oldMembership.next({ exists: () => false });
  assert.equal(a.value().activeTeamId, "b");
  const afterLogout = a.value().selectTeam("c"); await a.changeUser(null); a.h.render(); a.switches[1].resolve(); await assert.rejects(afterLogout, /ログイン状態/);
  a.user.next({ exists: () => true, data: () => ({ activeTeamId: "a" }) });
  assert.equal(a.value().activeTeamId, null); assert.equal(a.value().isTeamSwitching, false); a.h.unmount();
});

async function screenHarness(os = "android", canGoBack = true) {
  const h = componentHarness(), pending = [], savedOperations = [], alerts = [], timers = new Map(), navigations = [];
  let timerId = 0, auth = { user: { uid: "member" }, userName: "User", activeTeamId: "a", teamIds: ["a", "b", "c"] };
  auth.selectTeam = teamId => { const result = deferred(); pending.push({ teamId, ...result }); return result.promise; };
  for (const name of ["createAndSelectTeam", "joinAndSelectTeam"]) auth[name] = (...args) => {
    const result = deferred(); savedOperations.push({ name, args, ...result }); return result.promise;
  };
  const navigation = { canGoBack: () => canGoBack, goBack: () => navigations.push(auth.activeTeamId),
    reset: value => navigations.push({ teamId: auth.activeTeamId, route: value.routes[0].name }), getState: () => ({ routeNames: ["WorkspaceHome"] }) };
  const modules = {
    react: h.react, "react-native": { ActivityIndicator: "ActivityIndicator", Alert: { alert: (...args) => alerts.push(args) }, KeyboardAvoidingView: "KeyboardAvoidingView", Modal: "Modal", Platform: { OS: os }, ScrollView: "ScrollView", StyleSheet: { create: value => value }, Text: "Text", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity", View: "View" },
    "../hooks/useTeamInvitation": { useTeamInvitation: () => ({ pendingInvitation: null }) },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "@react-navigation/native": { useFocusEffect: fn => h.react.useEffect(fn, [fn]) },
    "@react-native-async-storage/async-storage": { __esModule: true, default: {} }, "firebase/auth": {}, "../firebase": { auth: {} },
    "../AuthContext": { useAuth: () => auth }, "../NotificationContext": { useNotifications: () => ({ unreadByTeam: {} }) },
    "../constants/sportsCategories": { CUSTOM_SPORT_OPTIONS: new Set(), SPORT_CATEGORIES: [{ id: "sports", label: "Sports" }], getSportsForCategory: () => ["Soccer"] },
    "../services/firestoreService": { getMaxTeamsForMemberships: () => 5, SHARP_RISE_MAX_TEAMS_PER_USER: 100,
      getUserTeams: async () => ["a", "b", "c"].map(id => ({ id, name: id.toUpperCase() })) },
  };
  const { default: Screen } = load(path.join(root, "src/screens/TeamSelectScreen.js"), modules, "", {
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
  });
  h.mount(() => Screen({ navigation })); await tick(); h.render();
  return { h, pending, savedOperations, alerts, timers, navigations,
    input: placeholder => h.find(node => node.type === "TextInput" && node.props.placeholder.startsWith(placeholder)),
    action: text => h.find(node => node.type === "TouchableOpacity" && node.children.some(child => child?.type === "Text" && child.children.includes(text))),
    button: id => h.find(node => node.type === "TouchableOpacity" && node.props.key === id),
    update(values) { auth = { ...auth, ...values }; h.update(); }, flush() { for (const [id, fn] of timers) { timers.delete(id); fn(); } h.render(); } };
}
for (const os of ["android", "ios"]) {
  test(`${os}: repeated taps are blocked through target reflection; home waits for the requested team`, async () => {
    const s = await screenHarness(os), originalB = s.button("b"), originalC = s.button("c");
    const selecting = originalB.props.onPress(); await originalC.props.onPress(); assert.equal(s.pending.length, 1);
    s.h.render(); assert.equal(s.button("a").props.disabled, true); assert.equal(s.button("c").props.disabled, true);
    s.pending[0].resolve(); await selecting; s.h.render(); s.flush(); assert.equal(s.navigations.length, 0);
    await originalC.props.onPress(); assert.equal(s.pending.length, 1);
    s.update({ activeTeamId: "b", isTeamSwitching: true }); s.flush(); assert.equal(s.navigations.length, 0);
    s.update({ isTeamSwitching: false }); s.flush(); assert.deepEqual(s.navigations, ["b"]); s.h.unmount();
  });
}
test("failed team selection remains on the selection screen and permits retry", async () => {
  const s = await screenHarness(), failed = s.button("b").props.onPress();
  s.pending[0].reject(new Error("所属確認に失敗")); await failed; s.h.render(); s.flush();
  assert.equal(s.navigations.length, 0); assert.equal(s.button("c").props.disabled, false); assert.equal(s.alerts.length, 1);
  const retry = s.button("c").props.onPress(); assert.equal(s.pending.length, 2);
  s.pending[1].resolve(); await retry; s.update({ activeTeamId: "c" }); s.flush(); assert.deepEqual(s.navigations, ["c"]); s.h.unmount();
});
test("initial team selection resets to home only after the requested team is reflected", async () => {
  const s = await screenHarness("android", false), selecting = s.button("b").props.onPress();
  s.pending[0].resolve(); await selecting; s.h.render(); s.flush(); assert.equal(s.navigations.length, 0);
  s.update({ activeTeamId: "b" }); s.flush(); assert.deepEqual(s.navigations, [{ teamId: "b", route: "WorkspaceHome" }]); s.h.unmount();
});

for (const operation of ["create", "join"]) {
  test(`${operation}: saved membership selects locally without another switch, and overlapping actions stay blocked`, async () => {
    const a = await authHarness(), api = a.value();
    const selecting = operation === "create" ? api.createAndSelectTeam("Synthetic team", "User", { category: "sports", name: "soccer" })
      : api.joinAndSelectTeam("Ab12Cd", "User");
    assert.equal(a.value().isTeamSwitching, true);
    await assert.rejects(api.selectTeam("c"), /切り替え中/);
    assert.equal(a.switches.length, 0); assert.equal(a.savedOperations.length, 1);
    assert.equal(a.savedOperations[0].args[0], "member");
    a.savedOperations[0].resolve({ teamId: "new-team", type: operation }); await selecting;
    assert.equal(a.value().activeTeamId, "new-team"); assert.equal(a.value().teamSelectionRequired, false);
    assert.equal(a.value().isTeamSwitching, false); assert.equal(a.switches.length, 0); a.h.unmount();
  });
}

test("failed joins can retry, and a late creation cannot select a team for another account", async () => {
  const a = await authHarness(), oldApi = a.value();
  const joining = oldApi.joinAndSelectTeam("Ab12Cd", "User");
  a.savedOperations[0].reject(new Error("synthetic join failure")); await assert.rejects(joining, /join failure/);
  assert.equal(a.value().activeTeamId, "a"); assert.equal(a.value().isTeamSwitching, false);
  const creating = a.value().createAndSelectTeam("Synthetic team", "User", {});
  await a.changeUser({ uid: "other", emailVerified: true }); a.h.render();
  a.savedOperations[1].resolve({ teamId: "obsolete" }); await assert.rejects(creating, /ログイン状態/);
  assert.equal(a.value().activeTeamId, null);
  await assert.rejects(oldApi.joinAndSelectTeam("Ab12Cd", "User"), /ユーザー情報/);
  assert.equal(a.savedOperations.length, 2); a.h.unmount();
});

function membershipHarness(saved, memberExists = true, metadata = { fromCache: false, hasPendingWrites: false }) {
  let value = saved; const reads = [], writes = [];
  const file = path.join(root, "src/services/firestoreService.js"), modules = {};
  for (const match of fs.readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) modules[match[1]] = {};
  modules["../firebase"] = { db: "db" };
  modules["firebase/firestore"] = {
    doc: (_db, ...parts) => parts.join("/"),
    getDoc: async ref => { reads.push(ref); return { exists: () => ref.includes("/members/") ? memberExists : Boolean(value), data: () => value, metadata }; },
    setDoc: async (ref, next) => { writes.push({ ref, next }); value = { ...value, ...next }; },
  };
  return { service: load(file, modules), reads, writes, value: () => value };
}

test("normal switches still verify membership; an already-saved selection skips only its write", async () => {
  const h = membershipHarness({ activeTeamId: "a", teamIds: ["a", "b"] });
  await h.service.switchActiveTeam("member", "a"); assert.equal(h.reads.length, 2); assert.equal(h.writes.length, 0);
  await h.service.switchActiveTeam("member", "b"); assert.equal(h.writes.length, 1); assert.equal(h.value().activeTeamId, "b");
  const denied = membershipHarness({ activeTeamId: "a", teamIds: ["a"] }, false);
  await assert.rejects(denied.service.switchActiveTeam("member", "a"), /所属/); assert.equal(denied.writes.length, 0);
});

test("membership normalization is still saved when activeTeamId matches but stored teamIds are incomplete", async () => {
  const h = membershipHarness({ activeTeamId: "a", teamIds: ["b"] });
  await h.service.switchActiveTeam("member", "a"); assert.equal(h.writes.length, 1);
  assert.deepEqual(Array.from(h.value().teamIds), ["b", "a"]);
});

test("cached or pending selection snapshots never suppress the selection write", async () => {
  for (const metadata of [{ fromCache: true, hasPendingWrites: false }, { fromCache: false, hasPendingWrites: true }]) {
    const h = membershipHarness({ activeTeamId: "a", teamIds: ["a"] }, true, metadata);
    await h.service.switchActiveTeam("member", "a"); assert.equal(h.writes.length, 1);
  }
});

for (const os of ["android", "ios"]) for (const kind of ["create", "join"]) {
  test(`${os}: ${kind} screen uses the saved selection and navigates after reflection without another selectTeam`, async () => {
    const s = await screenHarness(os);
    if (kind === "create") {
      s.input("チーム名").props.onChangeText("Synthetic team"); s.h.render();
      s.button("sports").props.onPress(); s.h.render(); s.button("Soccer").props.onPress(); s.h.render();
    } else { s.input("例:").props.onChangeText("Ab12Cd"); s.h.render(); }
    const clicked = s.action(kind === "create" ? "作成する" : "参加する").props.onPress();
    assert.equal(s.savedOperations.length, 1); assert.equal(s.pending.length, 0);
    s.savedOperations[0].resolve({ teamId: "saved-team", inviteCode: "Ab12Cd" });
    await clicked; s.h.render(); s.flush(); assert.equal(s.navigations.length, 0);
    s.update({ activeTeamId: "saved-team" }); s.flush(); assert.deepEqual(s.navigations, ["saved-team"]);
    assert.equal(s.pending.length, 0); s.h.unmount();
  });
}
