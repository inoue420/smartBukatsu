const test = require("node:test"), assert = require("node:assert/strict");
const { load, fillImports } = require("../../scripts/calendarWeekStartTestHarness.cjs");
const idle = () => {};
const general = { id: "ch_1", name: "全体連絡", shareScope: "roles", memberAudience: "all", allowedRoleGroups: ["staff", "captain", "member"] };
const other = { ...general, id: "other", name: "練習連絡" };

// Render the real App, Home and history hook with separate hook slots. Commit
// child effects before parent effects, as the installed native renderer does.
// Only the navigation/native/Firebase boundaries are replaced; no network/files
// are written. Snapshot delivery can be synchronous, delayed or deliberately late.
function harness({ os = "android", optimized = true, channels = [general], role = "member", synchronous = false,
  params = {}, initialAuth = {}, channelsByTeam = {} } = {}) {
  let owner, dirty = true, parent, child, childKey, parentTree, childTree, routeParams = params;
  let auth = { user: { uid: "member" }, userName: "Member", activeTeamId: "a", selectTeam: idle, ...initialAuth };
  const calls = [], reactionCalls = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    createContext: () => ({ Provider: "Provider" }),
    useState(initial) {
      const fiber = owner, i = fiber.cursor++;
      const slot = fiber.slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      slot.set ||= value => { const next = typeof value === "function" ? value(slot.value) : value;
        if (!Object.is(slot.value, next)) { slot.value = next; dirty = true; } };
      return [slot.value, slot.set];
    },
    useRef(initial) { return owner.slots[owner.cursor++] ||= { current: initial }; },
    useMemo(fn, deps) { const i = owner.cursor++; if (!same(owner.slots[i]?.deps, deps)) owner.slots[i] = { deps, value: fn() }; return owner.slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const fiber = owner, i = fiber.cursor++, old = fiber.slots[i];
      if (!same(old?.deps, deps)) {
        const slot = fiber.slots[i] = { deps };
        fiber.effects.push(() => { old?.cleanup?.(); slot.cleanup = fn(); });
      }
    },
  };
  const reactModule = { __esModule: true, default: react, ...react };
  const fiber = () => ({ slots: [], effects: [], cursor: 0 });
  const unmount = f => f?.slots.forEach(slot => slot.cleanup?.());
  const find = (predicate, node) => {
    if (!node || typeof node !== "object" || (node.type === "Modal" && !node.props.visible)) return null;
    if (predicate(node)) return node;
    for (const entry of Array.isArray(node) ? node : node.children || []) { const found = find(predicate, entry); if (found) return found; }
    return null;
  };
  const textOf = node => node == null || typeof node === "boolean" ? "" : typeof node !== "object"
    ? (typeof node === "function" ? "" : String(node)) : (Array.isArray(node) ? node : node.children || []).map(textOf).join("");
  const seed = sub => {
    if (!synchronous) return;
    if (sub.name === "LoadingState") sub.args[1]({ ready: true, enabled: optimized, schemaVersion: 1 });
    if (sub.name === "TeamMembers") sub.args[1]([{ uid: auth.user.uid, name: "Member", role }]);
    if (sub.name === "workspaceTeam") sub.args[2]({ exists: () => true, data: () => ({ channels: channelsByTeam[sub.args[1].at(-1)] || channels }) });
  };
  const watch = name => (...args) => {
    const sub = { name, args, stops: 0 }; calls.push(sub); seed(sub); return () => sub.stops++;
  };
  const historyModules = { subscribeHistory: watch("history"), subscribeHistoryDocument: watch("document"), readHistoryPage: async () => ({ items: [], hasMore: false }) };
  const historyHook = load("src/hooks/useHistoryData.js", { react: reactModule,
    "../services/historyDataService": historyModules, "../utils/historyLoading": require("../utils/historyLoading") });
  const native = Object.fromEntries(["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Modal", "KeyboardAvoidingView", "ActivityIndicator", "Switch"].map(name => [name, name]));
  Object.assign(native, { StyleSheet: { create: value => value }, Platform: { OS: os }, Keyboard: { dismiss: idle },
    LogBox: { ignoreLogs: idle }, AppState: { currentState: "active", addEventListener: () => ({ remove: idle }) }, Alert: { alert: idle } });
  const homeModules = {
    react: reactModule, "react-native": native, "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "../AuthContext": { useAuth: () => auth }, "../NotificationContext": { useNotifications: () => ({ unreadTotal: 0 }) },
    "../firebase": { db: "synthetic" }, "firebase/firestore": { doc: (...args) => args },
    "../services/firestoreSubscription": { measuredOnSnapshot: watch("workspaceTeam") },
    "../services/firestoreService": { ensureGeneralChannelMemberAudience: async () => false },
    "../hooks/useWorkspaceReactions": { useWorkspaceReactions: value => { reactionCalls.push(value); return { ownReactions: {} }; } },
    "../utils/workspaceReactions": require("../utils/workspaceReactions"),
    "../utils/historyLoading": require("../utils/historyLoading"),
    "../utils/medicalScale": require("../utils/medicalScale"),
    "../../functions/workspaceAudience": require("../../functions/workspaceAudience"),
  };
  fillImports("src/screens/WorkspaceHomeScreen.js", homeModules);
  const Home = load("src/screens/WorkspaceHomeScreen.js", homeModules).default;
  const navigation = { setParams(value) { routeParams = { ...routeParams, ...value }; dirty = true; },
    getCurrentRoute: () => ({ name: "WorkspaceHome", params: routeParams }) };
  const appModules = {
    react: reactModule, "react-native": native,
    "@react-navigation/native": { NavigationContainer: "NavigationContainer", useNavigationContainerRef: () => navigation },
    "@react-navigation/native-stack": { createNativeStackNavigator: () => ({ Screen: "Screen", Navigator: "Navigator" }) },
    "@react-native-community/netinfo": { __esModule: true, default: { addEventListener: () => idle } },
    "./src/ads/AdManager": { useAds: () => ({ configureInterstitial: idle, recordScreenTransition: idle }) },
    "./src/ads/adSettings": { DEFAULT_INTERSTITIAL_SETTINGS: {}, getInterstitialSettingsFromTeamData: () => ({}) },
    "./src/utils/medicalScale": { DEFAULT_ALERT_THRESHOLDS: {} }, "./src/utils/historyLoading": require("../utils/historyLoading"),
    "./src/utils/dailyReportScope": require("../utils/dailyReportScope"),
    "./src/hooks/useHistoryData": historyHook, "./src/hooks/useDailyReportHistory": { useDailyReportHistory: () => ({ include: idle }) },
    "./src/hooks/useAppReview": { useAppReview: () => ({ cancelReview: idle, completeInteraction: idle, reviewNavigationChanged: idle }) },
    "./src/services/dailyReportReadService": { subscribeUnreviewedReports: watch("alerts") },
    "./src/services/historyDataService": Object.fromEntries(["LoadingState", "LoadingSummary", "PinnedPosts", "PostReadStates"].map(name => ["subscribe" + name, watch(name)])),
    "./src/services/firestoreService": Object.fromEntries(["Projects", "HighlightProjects", "Notices", "WorkspacePosts", "PersonalEvents", "ClubEvents", "TagGroups", "TeamMembers", "TeamData"].map(name => ["subscribe" + name, watch(name)])),
    "./src/AuthContext": { useAuth: () => auth }, "./src/NotificationContext": { useNotifications: () => ({ setNavigationHandler: () => idle }) },
    "./src/screens/WorkspaceHomeScreen": { __esModule: true, default: Home },
  };
  fillImports("App.js", appModules);
  const { AppContent } = load("App.js", appModules, "\nexport { AppContent };\n");
  parent = fiber();
  function render() {
    let passes = 0;
    while (dirty) {
      assert.ok(++passes < 50, "App/Home did not settle"); dirty = false;
      owner = parent; parent.cursor = 0; parent.effects = []; parentTree = AppContent();
      const screen = find(node => node.type === "Screen" && node.props.name === "WorkspaceHome", parentTree);
      if (screen) {
        const element = screen.children[0]({ route: { params: routeParams }, navigation });
        if (childKey !== element.props.key || !child) { unmount(child); child = fiber(); childKey = element.props.key; }
        owner = child; child.cursor = 0; child.effects = []; childTree = Home(element.props);
        child.effects.forEach(effect => effect());
      } else { unmount(child); child = null; childKey = null; childTree = null; }
      parent.effects.forEach(effect => effect());
    }
  }
  const last = name => calls.findLast(sub => sub.name === name && !sub.stops);
  const postSubscription = () => calls.findLast(sub => sub.name === "history" && sub.args[1] === "workspacePosts" && !sub.stops);
  const homeProps = () => find(node => node.type === "Screen" && node.props.name === "WorkspaceHome", parentTree).children[0]({ route: { params: routeParams }, navigation }).props;
  render();
  find(node => node.type === "NavigationContainer", parentTree)?.props.onReady(); render();
  return { calls, last, postSubscription, homeProps, reactionCalls, render,
    text: () => textOf(childTree), params: () => routeParams,
    updateAuth(value) { auth = { ...auth, ...value }; dirty = true; render(); },
    emitSettings(value = channels) { last("workspaceTeam").args[2]({ exists: () => true, data: () => ({ channels: value }) }); render(); },
    emitMembers(value = [{ uid: auth.user.uid, name: "Member", role }]) { last("TeamMembers").args[1](value); render(); },
    emitGate(value = optimized) { last("LoadingState").args[1]({ ready: true, enabled: value, schemaVersion: 1 }); render(); },
    page(items) { postSubscription().args[3]({ items, hasMore: false }); render(); },
    press(name) {
      const tab = find(node => node.type === "TouchableOpacity" && textOf(node).includes(name), childTree);
      assert.ok(tab, name); tab.props.onPress(); render();
    },
    unmount() { unmount(child); unmount(parent); },
  };
}

for (const os of ["android", "ios"]) {
  test(`${os}: child-first startup reads General without a manual tab change`, () => {
    const h = harness({ os, synchronous: true });
    assert.equal(h.postSubscription().args[2].channel, general.name);
    assert.equal(h.last("PinnedPosts").args[2], general.name);
    assert.match(h.text(), /投稿を読み込み中/);
    h.page([{ id: "first", channel: general.name, content: "Startup post", user: "Author", createdAt: 1 }]);
    assert.match(h.text(), /Startup post/); assert.equal(h.homeProps().postsLoading, false);
    h.unmount(); assert.ok(h.calls.every(sub => sub.stops === 1));
  });
}

test("settings and members must both resolve; the configured leftmost board wins over ch_1", () => {
  const h = harness({ channels: [other, general] });
  h.emitGate(); h.emitSettings();
  assert.equal(h.postSubscription(), undefined); assert.match(h.text(), /掲示板を読み込み中/);
  h.emitMembers(); assert.equal(h.postSubscription().args[2].channel, other.name);
  assert.equal(h.reactionCalls.at(-1).channelId, other.id);
  h.press(general.name); assert.equal(h.postSubscription().args[2].channel, general.name);
  h.emitSettings([other, general]); assert.equal(h.postSubscription().args[2].channel, general.name, "updates preserve a user's selection");
  h.unmount();
});

test("members arriving before settings do not start a default General query", () => {
  const h = harness({ channels: [other, general] }); h.emitMembers(); h.emitGate();
  assert.equal(h.postSubscription(), undefined); h.emitSettings();
  assert.equal(h.postSubscription().args[2].channel, other.name); h.unmount();
});

test("an empty cached team document cannot select a default board before server settings arrive", () => {
  const h = harness({ channels: [other, general] }); h.emitMembers(); h.emitGate();
  const settings = h.last("workspaceTeam");
  assert.equal(settings.args[4].includeMetadataChanges, true);
  settings.args[2]({ exists: () => false, metadata: { fromCache: true } }); h.render();
  assert.equal(h.postSubscription(), undefined);
  h.emitSettings(); assert.equal(h.postSubscription().args[2].channel, other.name); h.unmount();
});

test("confirmed missing channel configuration uses General; later reorder preserves the current board", () => {
  const h = harness(); h.emitMembers(); h.emitGate();
  h.last("workspaceTeam").args[2]({ exists: () => false, metadata: { fromCache: false } }); h.render();
  assert.equal(h.postSubscription().args[2].channel, general.name);
  h.emitSettings([other, general]); assert.equal(h.postSubscription().args[2].channel, general.name); h.unmount();
});

test("a permission error stops the board query and displays a permission message", () => {
  const h = harness({ synchronous: true });
  h.last("workspaceTeam").args[3]({ code: "permission-denied" }); h.render();
  assert.equal(h.postSubscription(), undefined); assert.match(h.text(), /閲覧権限を確認/); h.unmount();
});

test("leftmost is chosen after applying role visibility; no visible board starts no optimized query", () => {
  const staffOnly = { ...other, memberAudience: "none", allowedRoleGroups: ["staff"] };
  const h = harness({ channels: [staffOnly, general], synchronous: true });
  assert.equal(h.postSubscription().args[2].channel, general.name);
  h.emitSettings([staffOnly]); assert.equal(h.postSubscription(), undefined);
  assert.equal(h.last("PinnedPosts"), undefined); assert.match(h.text(), /表示できる掲示板がありません/);
  h.unmount();
});

test("A -> B -> A starts each team's leftmost board and ignores old snapshots and selection callbacks", () => {
  const h = harness({ synchronous: true, channelsByTeam: { b: [other, general] } });
  const oldNotify = h.homeProps().onChannelChange, oldTeam = h.last("workspaceTeam"), oldPosts = h.postSubscription();
  h.updateAuth({ activeTeamId: "b" }); h.emitSettings([other, general]);
  assert.equal(h.postSubscription().args[0], "b"); assert.equal(h.postSubscription().args[2].channel, other.name);
  oldNotify("Old team"); oldTeam.args[2]({ exists: () => true, data: () => ({ channels: [{ ...other, name: "Late" }] }) });
  oldPosts.args[3]({ items: [{ id: "late", channel: other.name, content: "Stale post" }] }); h.render();
  assert.equal(h.postSubscription().args[2].channel, other.name); assert.doesNotMatch(h.text(), /Stale post|Late/);
  h.updateAuth({ activeTeamId: "a" }); oldNotify("Old visit"); h.render();
  assert.equal(h.postSubscription().args[2].channel, general.name); h.unmount();
});

test("switching accounts with the same team waits for the new member's permissions", () => {
  const h = harness(); h.emitSettings([other, general]); h.emitMembers(); h.emitGate();
  const oldNotify = h.homeProps().onChannelChange;
  h.updateAuth({ user: { uid: "new-member" } }); h.emitGate();
  oldNotify(general.name); h.render(); assert.equal(h.postSubscription(), undefined);
  h.emitMembers(); h.emitSettings([other, general]); assert.equal(h.postSubscription().args[2].uid, "new-member");
  assert.equal(h.postSubscription().args[2].channel, other.name); h.unmount();
});

test("a notification outside the first page opens its board and retains selected state after clearing route params", () => {
  const h = harness({ synchronous: true, channels: [general, other], params: { postId: "old-target" } });
  const detail = h.last("document"); assert.equal(detail.args[2], "old-target");
  detail.args[3]({ id: "old-target", channelId: other.id, channel: other.name, content: "Notification target", user: "Author", visibleToUids: ["member"], createdAt: 1 });
  h.render(); assert.equal(h.postSubscription().args[2].channel, other.name);
  assert.equal(h.params().postId, undefined); assert.match(h.text(), /Notification target/);
  assert.equal(h.reactionCalls.at(-1).channelId, other.id); h.unmount();
});

test("loading optimization disabled retains legacy posts and marks empty snapshots as loaded", () => {
  const h = harness({ optimized: false, synchronous: true, channels: [other, general] });
  assert.equal(h.postSubscription(), undefined); assert.match(h.text(), /投稿を読み込み中/);
  h.last("WorkspacePosts").args[2]([]); h.render(); assert.match(h.text(), /まだ投稿がありません/);
  h.last("WorkspacePosts").args[2]([{ id: "legacy", channel: other.name, content: "Legacy post", user: "Author", createdAt: 1 }]); h.render();
  assert.match(h.text(), /Legacy post/); h.emitGate(true);
  assert.equal(h.postSubscription().args[2].channel, other.name); h.unmount();
});

test("auth loading may finish after the parent reset without losing the startup selection", () => {
  const h = harness({ synchronous: true, initialAuth: { loading: true } });
  assert.equal(h.postSubscription(), undefined);
  h.updateAuth({ loading: false }); assert.equal(h.postSubscription().args[2].channel, general.name); h.unmount();
});
