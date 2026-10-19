const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core"), { parse } = require("@babel/parser");
const root = path.join(__dirname, "../.."), idle = () => {};
const audience = require("../../functions/workspaceAudience");

// Render the actual screens and invoke their handlers. Firebase/native modules
// are replaced; this suite never starts an app or connects to a service.
function screenHarness(screen, options = {}) {
  const slots = [], writes = [], alerts = [], migrations = [];
  let cursor = 0, effects = [], dirty = true, tree, Component;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    Fragment: "Fragment", createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (change) => { const next = typeof change === "function" ? change(slots[i].value) : change;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) {
      slots[i] = { deps }; if (screen === "WorkspaceHomeScreen") effects.push(fn); } },
  };
  const profiles = {
    Coach: { uid: "coach", name: "Coach", role: "staff" },
    Member: { uid: "member", name: "Member", role: "member", grade: "1年生", position: "GK" },
    Captain: { uid: "captain", name: "Captain", role: "captain", grade: "2年生" },
  };
  const uid = options.uid || "coach";
  const props = { currentUser: Object.values(profiles).find((p) => p.uid === uid).name, currentUserUid: uid,
    isAdmin: false, grades: options.grades || ["1年生", "2年生"], positions: ["GK", "CB"], userProfiles: profiles,
    clubMembers: Object.keys(profiles), posts: [], notices: [], setPosts: idle, setNotices: idle,
    setUserProfiles: idle, alertThresholds: {}, setAlertThresholds: idle, navigation: { navigate: idle, goBack: idle }, optimize: true };
  const file = path.join(root, "src/screens", screen + ".js"), source = fs.readFileSync(file, "utf8"), modules = {};
  for (const declaration of parse(source, { sourceType: "module", plugins: ["jsx"] }).program.body.filter((node) => node.type === "ImportDeclaration")) {
    modules[declaration.source.value] = { __esModule: true, default: declaration.source.value };
    for (const specifier of declaration.specifiers) if (specifier.imported) modules[declaration.source.value][specifier.imported.name] = idle;
  }
  const native = new Proxy({ StyleSheet: { create: (value) => value }, Platform: { OS: "android" },
    Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss: idle } }, { get: (target, key) => target[key] || key });
  Object.assign(modules, {
    react: { __esModule: true, default: react, ...react }, "react-native": native,
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "@react-navigation/native": { useFocusEffect: idle },
    "../AuthContext": { useAuth: () => ({ activeTeamId: "team", user: { uid }, teamIds: [] }) },
    "../NotificationContext": { useNotifications: () => ({ unreadTotal: 0 }) },
    "../firebase": { db: "demo", auth: { currentUser: { uid } } },
    "firebase/firestore": { doc: (...args) => args, updateDoc: async (ref, data) => { writes.push({ ref, data }); } },
    "../ads/AdManager": { useAds: () => ({ diagnostics: {} }) },
    "../ads/adDiagnostics": { formatAdDiagnostics: () => "" },
    "../ads/adSettings": { DEFAULT_INTERSTITIAL_SETTINGS: {}, normalizeInterstitialSettings: (value) => value },
    "../constants/sportsCategories": { CUSTOM_SPORT_OPTIONS: [], SPORT_CATEGORIES: [], getCategoryLabel: () => "", getSportsForCategory: () => [] },
    "../hooks/useWorkspaceReactions": { useWorkspaceReactions: () => ({}) },
    "../utils/workspaceReactions": require("../utils/workspaceReactions"),
    "../../functions/workspaceAudience": audience,
    "../services/firestoreSubscription": { firestoreDiagnosticsEnabled: () => false,
      measuredOnSnapshot: (_name, _ref, next) => { next({ exists: () => true, data: () => ({ channels: options.channels || [] }) }); return idle; } },
  });
  Object.assign(modules["../services/firestoreService"], {
    ensureGeneralChannelMemberAudience: async (team) => { migrations.push(team); return false; },
    updateMemberRoleConfig: async (team, memberUid, data) => {
      if (options.failSave) throw new Error("Synthetic save failure"); writes.push({ team, uid: memberUid, data });
    }, updateMemberProfile: async (...args) => writes.push({ profile: args }),
  });
  const module = { exports: {} }, code = transformSync(source, { cwd: root, configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => { assert.ok(name in modules, name); return modules[name]; },
    global: {}, console, setInterval: () => 1, clearInterval: idle, setTimeout: () => 1, clearTimeout: idle });
  Component = module.exports.default;
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (node.type === "Modal" && !node.props.visible) return null;
    if (typeof node.type === "function") return expand(node.type({ ...node.props, children: node.children }));
    return { ...node, children: node.children.map(expand) };
  };
  const render = () => { let passes = 0; do { assert.ok(++passes < 30); dirty = false; cursor = 0; effects = [];
    tree = expand(Component(props)); effects.forEach((fn) => fn()); } while (dirty); return tree; };
  const collect = (predicate, node) => {
    if (!node || typeof node !== "object") return [];
    return [...(predicate(node) ? [node] : []), ...(Array.isArray(node) ? node : node.children || []).flatMap((child) => collect(predicate, child))];
  };
  const all = (predicate) => collect(predicate, tree);
  const textOf = (node) => Array.isArray(node) ? node.map(textOf).join("") : node && typeof node === "object"
    ? (node.children || []).map(textOf).join("") : typeof node === "string" || typeof node === "number" ? String(node) : "";
  const text = (node = tree) => textOf(node);
  const button = (label) => { const result = all((node) => node.type === "TouchableOpacity" && text(node).startsWith(label))[0]; assert.ok(result, `Missing button: ${label}`); return result; };
  render();
  return { writes, alerts, migrations, props, render, all, text, button,
    async press(label) { const result = button(label); assert.ok(!result.props.disabled, `Disabled: ${label}`); await result.props.onPress(); render(); },
    change(placeholder, value) { const input = all((node) => node.type === "TextInput" && node.props.placeholder === placeholder)[0]; assert.ok(input); input.props.onChangeText(value); render(); } };
}

test("member profile shows assigned grade without a grade selector and preserves the position argument", async () => {
  const h = screenHarness("SettingsScreen", { uid: "member" });
  await h.press("👤 プロフィール設定");
  assert.match(h.text(), /学年：1年生（変更は管理者へ依頼してください）/);
  assert.equal(h.all((node) => node.type === "TouchableOpacity" && ["1年生", "2年生"].includes(h.text(node))).length, 0);
  await h.press("プロフィールを保存");
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes)), [{ profile: ["team", "member", "Member", "GK"] }]);
});

test("staff assign and clear grades from member management for members and captains", async () => {
  const h = screenHarness("SettingsScreen");
  await h.press("👥 部員リスト・権限・担当管理");
  const gradeButton = h.all((node) => node.props?.accessibilityLabel === "Memberの学年を設定")[0];
  gradeButton.props.onPress(); h.render();
  await h.press("2年生"); await h.press("学年を保存");
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[0])), { team: "team", uid: "member", data: { grade: "2年生" } });
  h.all((node) => node.props?.accessibilityLabel === "Captainの学年を設定")[0].props.onPress(); h.render();
  await h.press("学年を未設定にする"); await h.press("学年を保存");
  assert.deepEqual(JSON.parse(JSON.stringify(h.writes[1])), { team: "team", uid: "captain", data: { grade: "" } });
});

test("failed grade saves keep the modal open for retry", async () => {
  const h = screenHarness("SettingsScreen", { failSave: true });
  await h.press("👥 部員リスト・権限・担当管理");
  h.all((node) => node.props?.accessibilityLabel === "Memberの学年を設定")[0].props.onPress(); h.render();
  await h.press("2年生"); await h.press("学年を保存");
  assert.equal(h.writes.length, 0); assert.ok(h.button("学年を保存"));
  assert.equal(h.alerts.at(-1)[0], "保存できませんでした");
});

test("new channel saves selected grades and staff notification choices without legacy member roles", async () => {
  const h = screenHarness("WorkspaceHomeScreen");
  await h.press("＋ 追加"); h.change("例: 1年生専用", "First grade");
  assert.equal(h.all((node) => node.type === "TouchableOpacity" && h.text(node).startsWith("一般部員")).length, 0);
  await h.press("学年ごと");
  await h.press("2年生"); await h.press("Coach"); await h.press("作成する");
  const channel = h.writes[0].data.channels.at(-1);
  assert.equal(channel.shareScope, "grades");
  assert.deepEqual(Array.from(channel.allowedGrades), ["1年生"]);
  assert.deepEqual(Array.from(channel.allowedRoleGroups), ["staff"]);
  assert.deepEqual(Array.from(channel.notificationRecipientUids), ["coach"]);
});

test("opening or cancelling a legacy editor does not migrate it; saving explicitly selects all members", async () => {
  const channel = { id: "old", name: "Legacy", allowedRoleGroups: ["captain"], notificationRecipientUids: [] };
  const h = screenHarness("WorkspaceHomeScreen", { channels: [channel] });
  h.button("🔐 Legacy").props.onLongPress(); h.render();
  assert.equal(h.writes.length, 0); assert.match(h.text(), /保存するまでは現在の公開範囲を維持/);
  await h.press("キャンセル"); assert.equal(h.writes.length, 0);
  h.button("🔐 Legacy").props.onLongPress(); h.render();
  await h.press("保存する");
  assert.equal(h.writes[0].data.channels[0].memberAudience, "all");
  assert.deepEqual(Array.from(h.writes[0].data.channels[0].allowedRoleGroups), ["captain", "member"]);
  assert.deepEqual(Array.from(channel.allowedRoleGroups), ["captain"]);
});

test("the rendered channel tabs follow the assigned grade for members and captains, including unset grades", () => {
  const channel = { id: "grade", name: "First only", shareScope: "grades", allowedRoleGroups: [], allowedGrades: ["1年生"] };
  const h = screenHarness("WorkspaceHomeScreen", { uid: "member", channels: [channel] });
  assert.match(h.text(), /First only/);
  h.props.currentUserUid = "captain"; h.props.currentUser = "Captain"; h.render();
  assert.doesNotMatch(h.text(), /First only/);
  h.props.userProfiles = { ...h.props.userProfiles, Captain: { ...h.props.userProfiles.Captain, grade: "1年生" } }; h.render();
  assert.match(h.text(), /First only/);
  h.props.userProfiles = { ...h.props.userProfiles, Captain: { ...h.props.userProfiles.Captain, grade: "" } }; h.render();
  assert.doesNotMatch(h.text(), /First only/);
});

test("the editor refuses an empty audience and disables staff notification selection when staff are not public", async () => {
  const h = screenHarness("WorkspaceHomeScreen");
  await h.press("＋ 追加"); h.change("例: 1年生専用", "Empty audience");
  await h.press("スタッフ"); await h.press("部員");
  assert.equal(h.button("Coach").props.disabled, true);
  await h.press("作成する");
  assert.equal(h.writes.length, 0); assert.equal(h.alerts.at(-1)[0], "共有範囲");
});

test("a team with no grade list can save all members as the default and may still select staff-only", async () => {
  const h = screenHarness("WorkspaceHomeScreen", { grades: [] });
  await h.press("＋ 追加"); h.change("例: 1年生専用", "All members");
  assert.equal(h.button("部員全体").props.accessibilityState.checked, true);
  await h.press("作成する");
  assert.equal(h.writes[0].data.channels.at(-1).memberAudience, "all");
  assert.deepEqual(Array.from(h.writes[0].data.channels.at(-1).allowedRoleGroups), ["staff", "captain", "member"]);
  await h.press("＋ 追加"); h.change("例: 1年生専用", "Staff only");
  await h.press("部員"); await h.press("作成する");
  assert.equal(h.writes[1].data.channels.at(-1).memberAudience, "none");
  assert.deepEqual(Array.from(h.writes[1].data.channels.at(-1).allowedRoleGroups), ["staff"]);
});

test("staff opening the unmarked system General requests its one-time upgrade; members do not", () => {
  const channels = [{ id: "ch_1", name: "全体連絡", shareScope: "grades", allowedRoleGroups: ["staff"], allowedGrades: [] }];
  const staff = screenHarness("WorkspaceHomeScreen", { channels });
  assert.deepEqual(staff.migrations, ["team"]);
  staff.render(); assert.deepEqual(staff.migrations, ["team"]);
  const member = screenHarness("WorkspaceHomeScreen", { channels, uid: "member" });
  assert.match(member.text(), /全体連絡/); assert.equal(member.migrations.length, 0);
  const explicit = screenHarness("WorkspaceHomeScreen", { channels: [{ ...channels[0], memberAudience: "grades" }] });
  assert.equal(explicit.migrations.length, 0);
});
