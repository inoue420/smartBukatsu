const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const assert = require("node:assert/strict");
const { transformSync } = require("@babel/core"), { parse } = require("@babel/parser");
const root = path.join(__dirname, ".."), idle = () => {};

function load(file, modules, extra = "") {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const code = transformSync(source + extra, { configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, global: {}, console, Map, Set,
    setTimeout: () => 1, clearTimeout: idle, setInterval: () => 1, clearInterval: idle,
    require(name) { assert.ok(name in modules, `Unexpected dependency: ${name}`); return modules[name]; } });
  return module.exports;
}

function loadCalendarSettingsService(db, sdk) {
  const source = fs.readFileSync(path.join(root, "src/services/firestoreService.js"), "utf8");
  const node = parse(source, { sourceType: "module" }).program.body.find(item =>
    item.type === "ExportNamedDeclaration" && item.declaration?.id?.name === "updateCalendarWeekStartSettings").declaration;
  return new Function("db", "doc", "updateDoc", source.slice(node.start, node.end) + "\nreturn updateCalendarWeekStartSettings;")(
    db, sdk.doc, sdk.updateDoc);
}

function renderHarness() {
  const slots = []; let cursor, dirty = true, effects, component, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    createContext: () => ({ Provider: "Provider" }),
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[i].set ||= update => { const next = typeof update === "function" ? update(slots[i].value) : update;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }; return [slots[i].value, slots[i].set]; },
    useRef(value) { return slots[cursor++] ||= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  function render() { let passes = 0; while (dirty) { assert.ok(++passes < 40, "Render did not settle");
    dirty = false; cursor = 0; effects = []; tree = component(); effects.forEach(fn => fn()); } return tree; }
  function all(predicate, node = tree) {
    if (!node || typeof node !== "object" || (node.type === "Modal" && node.props.visible === false)) return [];
    return [...(predicate(node) ? [node] : []), ...(Array.isArray(node) ? node : node.children || []).flatMap(child => all(predicate, child ?? null))];
  }
  function text(node) { if (node == null || typeof node === "boolean") return "";
    if (typeof node !== "object") return typeof node === "function" ? "" : String(node);
    return (Array.isArray(node) ? node : node.children || []).map(text).join(""); }
  return { react: { __esModule: true, default: react, ...react }, render, all, text,
    find: predicate => all(predicate)[0], mount(fn) { component = fn; return render(); },
    update() { dirty = true; return render(); }, unmount() { slots.forEach(slot => slot.cleanup?.()); } };
}

function fillImports(file, modules) {
  modules["../utils/teamInvitation"] ||= require("../src/utils/teamInvitation");
  modules["./src/hooks/useTeamInvitation"] ||= { useTeamInvitation: () => ({ invitationReady: true, pendingInvitation: null }) };
  for (const match of fs.readFileSync(path.join(root, file), "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
    modules[match[1]] ||= { __esModule: true, default: match[1] };
  }
}

function screenHarness(screen, changes = {}, overrides = {}, os = "android") {
  const h = renderHarness(), alerts = [], writes = [], histories = [];
  let auth = { activeTeamId: "a", teamIds: ["a", "b"], user: { uid: "coach" }, role: "admin" };
  let props = { currentUser: "Coach", currentUserUid: "coach", isAdmin: false,
    userProfiles: { Coach: { uid: "coach", role: "admin" } }, grades: [], positions: [], clubMembers: [],
    alertThresholds: {}, clubEvents: [], personalEvents: [], dailyReports: [], reportReadsReady: true,
    calendarSettingsReady: true, calendarWeekStartsOnMonday: false,
    navigation: { setParams: idle }, route: { params: {} }, ...changes };
  const services = { getUserTeams: async () => [], getTeamInviteCode: async () => "synthetic", subscribeTeamData: () => idle,
    updateCalendarWeekStartSettings: async (...args) => { writes.push(args); }, ...overrides };
  const native = Object.fromEntries(["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Modal", "KeyboardAvoidingView", "ActivityIndicator", "Image", "Switch"].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: value => value }, Platform: { OS: os },
    Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss: idle }, Linking: {} });
  const modules = { react: h.react, "react-native": native, "../AuthContext": { useAuth: () => auth },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useIsFocused: () => true, useFocusEffect: fn => h.react.useEffect(fn, [fn]) },
    "react-native-calendars": { Calendar: "Calendar", LocaleConfig: { locales: {} } }, "react-native-maps": { default: null },
    "../hooks/useHistoryData": { useHistoryData: (...args) => { histories.push(args); return { busy: false }; } },
    "../utils/historyLoading": require("../src/utils/historyLoading"), "../utils/medicalScale": require("../src/utils/medicalScale"),
    "../../functions/workspaceAudience": require("../functions/workspaceAudience"),
    "../services/firestoreService": services, "../services/calendarAttachmentService": { getActiveCalendarAttachments: () => [] },
    "../services/dailyReportAttachmentService": { getActiveDailyReportAttachments: () => [] },
    "../firebase": { auth: { currentUser: { uid: "coach" } }, db: "synthetic" },
    "firebase/firestore": { doc: (...args) => args, getDoc: async () => ({ exists: () => false }) },
    "../ads/AdManager": { useAds: () => ({ diagnostics: {} }) }, "../ads/adSettings": require("../src/ads/adSettings"),
    "../ads/adDiagnostics": { formatAdDiagnostics: () => "" },
    "../services/firestoreSubscription": { firestoreDiagnosticsEnabled: false },
    "../constants/sportsCategories": require("../src/constants/sportsCategories"),
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => null, setItem: async () => {} } } };
  const file = `src/screens/${screen}.js`; fillImports(file, modules);
  const Component = load(file, modules).default; h.mount(() => Component(props));
  return { h, alerts, writes, histories,
    change(values, authValues = {}) { props = { ...props, ...values }; auth = { ...auth, ...authValues }; h.update(); },
    button(label) { return h.find(node => node.type === "TouchableOpacity" && h.text(node) === label); },
    byLabel(label) { return h.find(node => node.props?.accessibilityLabel === label); } };
}

function appHarness(invitation = { invitationReady: true, pendingInvitation: null }) {
  const h = renderHarness(), subscriptions = [], histories = [];
  let auth = { user: { uid: "coach" }, userName: "Coach", activeTeamId: "a", selectTeam: idle }, route = { name: "WorkspaceHome" };
  const navigation = { getCurrentRoute: () => route }, setNavigationHandler = () => idle;
  const watch = name => (...args) => { const sub = { name, args, stops: 0 }; subscriptions.push(sub); return () => sub.stops++; };
  const services = Object.fromEntries(["Projects", "HighlightProjects", "Notices", "WorkspacePosts", "PersonalEvents", "TeamData", "TeamMembers", "ClubEvents", "TagGroups"].map(name => ["subscribe" + name, watch(name)]));
  const modules = { react: h.react, "@react-navigation/native": { NavigationContainer: "NavigationContainer", useNavigationContainerRef: () => navigation },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({ Screen: "Screen", Navigator: "Navigator" }) },
    "react-native": { View: "View", Text: "Text", ActivityIndicator: "ActivityIndicator", Platform: { OS: "android" }, LogBox: { ignoreLogs: idle }, AppState: { addEventListener: () => ({ remove: idle }) } },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: () => idle } },
    "./src/ads/AdManager": { useAds: () => ({ configureInterstitial: idle, recordScreenTransition: idle }) },
    "./src/ads/adSettings": require("../src/ads/adSettings"), "./src/utils/medicalScale": require("../src/utils/medicalScale"),
    "./src/utils/historyLoading": require("../src/utils/historyLoading"), "./src/utils/dailyReportScope": require("../src/utils/dailyReportScope"),
    "./src/services/firestoreService": services,
    "./src/hooks/useHistoryData": { useHistoryData: (...args) => { histories.push(args); return { include: idle }; } },
    "./src/hooks/useDailyReportHistory": { useDailyReportHistory: () => ({ include: idle }) },
    "./src/hooks/useAppReview": { useAppReview: () => ({ cancelReview: idle, completeInteraction: idle, reviewNavigationChanged: idle }) },
    "./src/services/dailyReportReadService": { subscribeUnreviewedReports: watch("Unreviewed"), subscribeRosterLatestReports: watch("RosterFallback") },
    "./src/services/historyDataService": Object.fromEntries(["LoadingState", "LoadingSummary", "LatestReports", "PostReadStates", "PinnedPosts"].map(name => ["subscribe" + name, watch(name)])),
    "./src/AuthContext": { useAuth: () => auth }, "./src/NotificationContext": { useNotifications: () => ({ setNavigationHandler }) } };
  modules["./src/hooks/useTeamInvitation"] = { useTeamInvitation: () => invitation };
  fillImports("App.js", modules); const { AppContent } = load("App.js", modules, "\nexport { AppContent };"); h.mount(AppContent);
  return { h, subscriptions, histories, latest: name => subscriptions.findLast(sub => sub.name === name && !sub.stops),
    screen: name => h.find(node => node.type === "Screen" && node.props.name === name).children[0]({}).props,
    change(value) { auth = { ...auth, ...value }; h.update(); },
    changeInvitation(value) { invitation = { ...invitation, ...value }; h.update(); },
    navigate(name) { route = { name }; h.find(node => node.type === "NavigationContainer").props.onStateChange(); h.render(); } };
}

module.exports = { load, loadCalendarSettingsService, screenHarness, appHarness, renderHarness, fillImports };
