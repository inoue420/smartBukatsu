const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");
const root = path.join(__dirname, "../..");
const { loadCommentSettingsService } = require("../../scripts/dailyReportCommentsTestHarness.cjs");
const idle = () => {}, tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function renderHarness() {
  const slots = []; let cursor, dirty = true, effects, component, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    createContext: () => ({ Provider: "Provider" }),
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[i].set ||= update => { const next = typeof update === "function" ? update(slots[i].value) : update;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }; return [slots[i].value, slots[i].set]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps };
      effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  function render() { let passes = 0; while (dirty) { assert.ok(++passes < 40, "render did not settle");
    dirty = false; cursor = 0; effects = []; tree = component(); effects.forEach(fn => fn()); } return tree; }
  function find(predicate, node = tree) { if (!node || typeof node !== "object") return null; if (predicate(node)) return node;
    for (const child of Array.isArray(node) ? node : node.children || []) { if (child === undefined) continue;
      const found = find(predicate, child); if (found) return found; } return null; }
  function text(node) { if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node !== "object") return typeof node === "function" ? "" : String(node);
    return (Array.isArray(node) ? node : node.children || []).map(text).join(""); }
  return { react: { __esModule: true, default: react, ...react }, render, find, text,
    mount(fn) { component = fn; return render(); }, update() { dirty = true; return render(); }, unmount() { slots.forEach(s => s.cleanup?.()); } };
}

function load(file, modules, extra = "") {
  const source = fs.readFileSync(file, "utf8");
  const code = transformSync(source + extra, { cwd: root, configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const exports = {};
  vm.runInNewContext(code, { exports, module: { exports }, global: {}, console,
    setTimeout: () => 1, clearTimeout: idle, require(name) { assert.ok(name in modules, name); return modules[name]; } });
  return exports;
}

function screenHarness(screen, overrides = {}, os = "android") {
  const h = renderHarness(), alerts = [], writes = [], services = {
    getUserTeams: async () => [], getTeamInviteCode: async () => "synthetic", subscribeTeamData: () => idle,
    getActiveDailyReportAttachments: () => [], validateUserContent: async (...args) => { writes.push(["validate", ...args]); return {}; },
    updateDailyReport: async (...args) => writes.push(["comment", ...args]),
    updateDailyReportCommentSettings: async (...args) => writes.push(["setting", ...args]),
    submitSafetyReport: async (...args) => writes.push(["report", ...args]), ...overrides,
  };
  let auth = { activeTeamId: "team", blockedUserUids: [], teamIds: ["team"], user: { uid: "coach" }, signOut: idle };
  const report = { id: "report", author: "Student", authorUid: "student", date: "2026-10-06", status: "active", reflection: "Synthetic reflection",
    condition: "良い", comments: [{ id: "old", uid: "student", user: "Student", text: "Synthetic old comment" }] };
  let props = { isAdmin: true, currentUser: "Coach", currentUserUid: "coach", isOffline: false,
    grades: [], positions: [], alertThresholds: {}, absenceDeadlineDaysBefore: 3,
    dailyReportCommentSettingsReady: true, dailyReportCommentsEnabled: true,
    userProfiles: { Coach: { uid: "coach", role: "owner" } }, clubMembers: [], dailyReports: [report],
    navigation: { setParams: idle }, route: { params: { reportId: "report" } }, setDailyReports: idle, setPosts: idle };
  const file = path.join(root, `src/screens/${screen}.js`);
  const modules = { react: h.react, "../AuthContext": { useAuth: () => auth },
    "react-native": Object.fromEntries(["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Modal", "KeyboardAvoidingView", "ActivityIndicator", "Image", "Switch"].map(name => [name, name])),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../services/firestoreService": services,
    "../services/dailyReportAttachmentService": { getActiveDailyReportAttachments: () => [] },
    "../utils/medicalScale": require("../utils/medicalScale"),
    "../utils/contentModeration": require("../utils/contentModeration"),
    "../ads/adSettings": require("../ads/adSettings"),
    "../ads/adDiagnostics": { formatAdDiagnostics: () => "" },
    "../constants/sportsCategories": require("../constants/sportsCategories"),
    "../firebase": { auth: { currentUser: { uid: "coach" } }, db: "synthetic" },
    "firebase/firestore": { doc: (...args) => args, getDoc: async () => ({ exists: () => false }) },
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
    "@react-navigation/native": { useFocusEffect: fn => h.react.useEffect(fn, [fn]) },
    "../ads/AdManager": { useAds: () => ({ diagnostics: {} }) },
    "../services/firestoreSubscription": { firestoreDiagnosticsEnabled: false },
    "expo-application": {},
  };
  Object.assign(modules["react-native"], { StyleSheet: { create: x => x }, Alert: { alert: (...args) => alerts.push(args) },
    Platform: { OS: os }, Keyboard: { dismiss: idle }, Linking: { openURL: async () => {} } });
  for (const match of fs.readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) modules[match[1]] ||= { __esModule: true, default: match[1] };
  const Component = load(file, modules).default;
  h.mount(() => Component(props));
  return { h, alerts, writes, services, report,
    change(changes, authChanges = {}) { props = { ...props, ...changes }; auth = { ...auth, ...authChanges }; return h.update(); },
    button(label) { return h.find(n => n.type === "TouchableOpacity" && h.text(n) === label); },
    input() { return h.find(n => n.type === "TextInput" && n.props.placeholder === "メッセージを入力..."); } };
}

for (const os of ["android", "ios"]) test(`${os}: OFF hides composer/needs-reply, keeps old comments and reporting; ON restores composer`, async () => {
  const s = screenHarness("DiaryScreen", {}, os);
  assert.ok(s.input()); assert.ok(s.h.find(n => n.type === "Text" && s.h.text(n).startsWith("要返信")));
  s.change({ dailyReportCommentsEnabled: false });
  assert.equal(s.input(), null); assert.equal(s.h.find(n => n.type === "Text" && s.h.text(n).startsWith("要返信")), null);
  const old = s.h.find(n => typeof n.props?.onLongPress === "function"); assert.ok(old);
  old.props.onLongPress(); s.h.render();
  assert.ok(s.h.text(s.h.render()).includes("コメント本文・会話の証拠コピーは保存しません"));
  const reason = s.h.find(n => typeof n.props?.onPress === "function" && s.h.text(n).includes("その他"));
  reason.props.onPress(); s.h.render(); await s.button("通報を送信").props.onPress();
  assert.equal(s.writes.filter(w => w[0] === "report").length, 1);
  s.change({ dailyReportCommentsEnabled: true }); assert.ok(s.input()); s.h.unmount();
});

test("ON sends a comment; OFF during validation prevents the write and keeps the draft", async () => {
  const pending = deferred(), s = screenHarness("DiaryScreen", { validateUserContent: () => pending.promise });
  s.input().props.onChangeText("Synthetic reply"); s.h.render();
  const request = s.button("送信").props.onPress();
  s.change({ dailyReportCommentsEnabled: false }); pending.resolve({}); await request;
  assert.equal(s.writes.filter(w => w[0] === "comment").length, 0);
  s.change({ dailyReportCommentsEnabled: true }); assert.equal(s.input().props.value, "Synthetic reply");
  // Create a second normal screen for successful sending after the race check.
  const on = screenHarness("DiaryScreen"); on.input().props.onChangeText("Synthetic reply"); on.h.render();
  await on.button("送信").props.onPress(); on.h.render();
  assert.equal(on.writes.filter(w => w[0] === "comment").length, 1);
  assert.equal(on.input().props.value, ""); s.h.unmount(); on.h.unmount();
});

test("team change while validation is pending cannot write the old team's comment", async () => {
  const pending = deferred(), s = screenHarness("DiaryScreen", { validateUserContent: () => pending.promise });
  s.input().props.onChangeText("Synthetic reply"); s.h.render(); const request = s.button("送信").props.onPress();
  s.change({}, { activeTeamId: "other-team" }); pending.resolve({}); await request;
  assert.equal(s.writes.filter(w => w[0] === "comment").length, 0); s.h.unmount();
});

test("settings gate is owner/admin-only, defaults OFF, and saves the selected team value", async () => {
  const s = screenHarness("SettingsScreen");
  let toggle = s.h.find(n => n.type === "Switch" && n.props.accessibilityLabel === "振り返りの直接コメントを有効にする"); assert.ok(toggle);
  toggle.props.onValueChange(false); s.h.render(); await s.button("直接コメント設定を保存").props.onPress();
  assert.deepEqual(s.writes.filter(w => w[0] === "setting"), [["setting", "team", false]]);
  s.change({ dailyReportCommentSettingsReady: false, dailyReportCommentsEnabled: false });
  assert.equal(s.button("直接コメント設定を保存").props.disabled, true);
  s.change({ isAdmin: false, userProfiles: { Coach: { uid: "coach", role: "staff" } } });
  assert.equal(s.button("直接コメント設定を保存"), null); s.h.unmount();
});

test("settings save completion after a team switch does not display an old success", async () => {
  const pending = deferred(), s = screenHarness("SettingsScreen", { updateDailyReportCommentSettings: () => pending.promise });
  const request = s.button("直接コメント設定を保存").props.onPress();
  s.change({ dailyReportCommentsEnabled: false }, { activeTeamId: "other-team" });
  pending.resolve(); await request; assert.equal(s.alerts.length, 0); s.h.unmount();
});

test("App reads the gate from the existing team listener, defaults OFF, and ignores old-team callbacks", () => {
  const h = renderHarness(), calls = []; let auth = { user: { uid: "member" }, userName: "Member", activeTeamId: "a" };
  const watch = name => (...args) => { calls.push({ name, args }); return idle; };
  const legacy = Object.fromEntries(["Projects", "HighlightProjects", "DailyReports", "Notices", "WorkspacePosts", "PersonalEvents", "ClubEvents", "TagGroups", "TeamData", "TeamMembers"].map(name => ["subscribe" + name, watch(name)]));
  const modules = { react: h.react, "./src/AuthContext": { useAuth: () => auth },
    "./src/NotificationContext": { useNotifications: () => ({ setNavigationHandler: idle }) },
    "./src/services/firestoreService": legacy, "./src/services/historyDataService": { subscribeLoadingState: watch("LoadingState") },
    "./src/hooks/useHistoryData": { useHistoryData: () => ({ include: idle }) },
    "./src/utils/historyLoading": require("../utils/historyLoading"), "./src/utils/medicalScale": require("../utils/medicalScale"),
    "./src/ads/AdManager": { useAds: () => ({ configureInterstitial: idle }) }, "./src/ads/adSettings": require("../ads/adSettings"),
    "@react-navigation/native": { useNavigationContainerRef: () => ({}) },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({ Screen: "Screen", Navigator: "Navigator" }) },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: () => idle } },
    "react-native": { LogBox: { ignoreLogs: idle }, Platform: { OS: "android" } } };
  const file = path.join(root, "App.js");
  for (const match of fs.readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) modules[match[1]] ||= { __esModule: true, default: match[1] };
  const { AppContent } = load(file, modules, "\nexport { AppContent };\n"); h.mount(AppContent);
  const diary = () => h.find(n => n.type === "Screen" && n.props.name === "Diary").children[0]({}).props;
  assert.equal(diary().dailyReportCommentsEnabled, false);
  const old = calls.find(c => c.name === "TeamData"); old.args[1]({ dailyReportCommentsEnabled: true }); h.render();
  assert.equal(diary().dailyReportCommentsEnabled, true);
  auth = { ...auth, activeTeamId: "b" }; h.update(); assert.equal(diary().dailyReportCommentsEnabled, false);
  old.args[1]({ dailyReportCommentsEnabled: true }); h.render(); assert.equal(diary().dailyReportCommentsEnabled, false);
  calls.findLast(c => c.name === "TeamData").args[1]({}); h.render(); assert.equal(diary().dailyReportCommentsEnabled, false);
  assert.equal(calls.filter(c => c.name === "TeamData").length, 2); h.unmount();
});

test("leaving the diary during validation prevents writes and old-screen alerts", async () => {
  const pending = deferred(), s = screenHarness("DiaryScreen", { validateUserContent: () => pending.promise });
  s.input().props.onChangeText("Synthetic reply"); s.h.render();
  const request = s.button("送信").props.onPress(); s.h.unmount(); pending.resolve({}); await request;
  assert.equal(s.writes.filter(w => w[0] === "comment").length, 0); assert.equal(s.alerts.length, 0);
});

test("saving an unchanged ON setting preserves the enable time and performs no write", async () => {
  const writes = [], db = {}, sdk = { doc: () => "team-ref", serverTimestamp: () => "server-time",
    runTransaction: async (_db, fn) => fn({ get: async () => ({ exists: () => true,
      data: () => ({ dailyReportCommentsEnabled: true, dailyReportCommentsUpdatedAt: "old-time" }) }), update: (...args) => writes.push(args) }) };
  await loadCommentSettingsService(db, sdk)("team", true); assert.equal(writes.length, 0);
});
test("saving a changed setting stamps its server time; invalid values cannot start a transaction", async () => {
  const writes = []; let transactions = 0;
  const sdk = { doc: (...args) => args, serverTimestamp: () => "server-time", runTransaction: async (_db, fn) => {
    transactions++; return fn({ get: async () => ({ exists: () => true, data: () => ({}) }), update: (...args) => writes.push(args) }); } };
  const save = loadCommentSettingsService("db", sdk); await save("team", true);
  assert.deepEqual(writes[0][1], { dailyReportCommentsEnabled: true, dailyReportCommentsUpdatedAt: "server-time" });
  await assert.rejects(save("team", "true")); assert.equal(transactions, 1);
});
