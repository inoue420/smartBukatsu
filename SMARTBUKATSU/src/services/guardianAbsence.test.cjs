const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");
const root = path.join(__dirname, "../.."), idle = () => {};
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function renderHarness() {
  const slots = []; let cursor, dirty = true, effects, component, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[i].set ||= (update) => { const next = typeof update === "function" ? update(slots[i].value) : update;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; } }; return [slots[i].value, slots[i].set]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  function render() { let passes = 0; while (dirty) { assert.ok(++passes < 40); dirty = false; cursor = 0; effects = []; tree = component(); effects.forEach((fn) => fn()); } return tree; }
  function find(predicate, node = tree) {
    if (!node || typeof node !== "object" || (node.type === "Modal" && node.props.visible === false)) return null;
    if (predicate(node)) return node;
    for (const child of Array.isArray(node) ? node : node.children || []) { if (child === undefined) continue; const found = find(predicate, child); if (found) return found; }
    return null;
  }
  function text(node) { if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node !== "object") return typeof node === "function" ? "" : String(node);
    return (Array.isArray(node) ? node : node.children || []).map(text).join(""); }
  return { react: { __esModule: true, default: react, ...react }, render, find, text,
    mount(fn) { component = fn; return render(); }, update() { dirty = true; return render(); }, unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}
function screenHarness(screen = "CalendarScreen", changes = {}, overrides = {}, os = "android") {
  const h = renderHarness(), alerts = [], writes = [];
  const profiles = { Parent: { uid: "parent", name: "Parent", role: "guardian", childUids: ["child", "sibling"] },
    Child: { uid: "child", name: "Same name", role: "member" }, Sibling: { uid: "sibling", name: "Same name", role: "captain" },
    Staff: { uid: "staff", name: "Staff", role: "staff" }, Owner: { uid: "owner", name: "Owner", role: "owner" },
    OtherParent: { uid: "parent2", name: "Parent2", role: "guardian", childUids: ["child"] } };
  let auth = { activeTeamId: "team", user: { uid: "parent" }, role: "guardian", teamIds: ["team"] };
  let props = { currentUser: "Parent", currentUserUid: "parent", isAdmin: false, isOffline: false, userProfiles: profiles,
    clubMembers: Object.keys(profiles), dailyReports: [], personalEvents: [], grades: [], positions: [], alertThresholds: {},
    setUserProfiles: idle, setPosts: idle, setDailyReports: idle, navigation: { setParams: idle }, route: { params: {} },
    clubEvents: [{ id: "event", date: "2099-01-10", endDate: "2099-01-10", status: "active", title: "Synthetic event", absenceComments: [] }],
    ...changes };
  auth = { ...auth, user: { uid: props.currentUserUid }, role: Object.values(props.userProfiles).find((profile) => profile.uid === props.currentUserUid)?.role };
  const services = { getUserTeams: async () => [], getTeamInviteCode: async () => "synthetic", subscribeTeamData: () => idle,
    submitClubEventAbsence: async (...args) => { writes.push(["send", ...args]); return { added: true, comment: { id: "sent", uid: args[5] ? "" : args[2], ...(args[5] ? { childId: args[5] } : {}), user: "Same name", text: args[4] } }; },
    removeClubEventAbsenceComment: async (...args) => { writes.push(["cancel", ...args]); return { removed: true }; },
    setGuardianChildren: async (...args) => { writes.push(["link", ...args]); return {}; }, ...overrides };
  services.createManualAbsenceChildId ||= () => "manual-draft";
  services.subscribeManualAbsenceChildren ||= (team, callback) => { callback([]); return idle; };
  const modules = { react: h.react, "../AuthContext": { useAuth: () => auth },
    "react-native": Object.fromEntries(["View", "Text", "TextInput", "TouchableOpacity", "ScrollView", "Modal", "KeyboardAvoidingView", "ActivityIndicator", "Image", "Switch"].map((name) => [name, name])),
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useIsFocused: () => true, useFocusEffect: (fn) => h.react.useEffect(fn, [fn]) },
    "react-native-calendars": { Calendar: "Calendar", LocaleConfig: { locales: {} } }, "react-native-maps": { default: null },
    "../hooks/useHistoryData": { useHistoryData: () => ({ items: [], busy: false }) },
    "../utils/historyLoading": require("../utils/historyLoading"), "../utils/medicalScale": require("../utils/medicalScale"),
    "../services/firestoreService": services,
    "../services/calendarAttachmentService": { getActiveCalendarAttachments: () => [] },
    "../services/dailyReportAttachmentService": { getActiveDailyReportAttachments: () => [] },
    "../firebase": { auth: { currentUser: { uid: props.currentUserUid } }, db: "synthetic" },
    "firebase/firestore": { doc: (...args) => args, getDoc: async () => ({ exists: () => false }) },
    "../ads/AdManager": { useAds: () => ({ diagnostics: {} }) }, "../ads/adSettings": require("../ads/adSettings"),
    "../ads/adDiagnostics": { formatAdDiagnostics: () => "" }, "../services/firestoreSubscription": { firestoreDiagnosticsEnabled: false },
    "../constants/sportsCategories": require("../constants/sportsCategories"),
    "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => null, setItem: async () => {} } } };
  Object.assign(modules["react-native"], { StyleSheet: { create: (value) => value }, Platform: { OS: os },
    Alert: { alert: (...args) => alerts.push(args) }, Keyboard: { dismiss: idle }, Linking: {} });
  const file = path.join(root, `src/screens/${screen}.js`), source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) modules[match[1]] ||= { __esModule: true, default: match[1] };
  const code = transformSync(source, { cwd: root, configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const exports = {};
  vm.runInNewContext(code, { exports, module: { exports }, global: {}, console, setTimeout: () => 1, clearTimeout: idle,
    require(name) { assert.ok(name in modules, name); return modules[name]; } });
  h.mount(() => exports.default(props));
  if (screen === "CalendarScreen") { h.find((node) => node.type === "Calendar").props.onDayPress({ dateString: "2099-01-10" }); h.render(); }
  return { h, alerts, writes, profiles, services,
    change(values, authValues = {}) { props = { ...props, ...values }; auth = { ...auth, ...authValues }; h.update(); },
    button(label) { return h.find((node) => node.type === "TouchableOpacity" && h.text(node) === label); },
    byLabel(label) { return h.find((node) => node.props?.accessibilityLabel === label); },
    input() { return h.find((node) => node.type === "TextInput" && node.props.placeholder === "例: 体調不良のため欠席します"); },
    open() { const button = this.button("不参加連絡"); assert.ok(button); button.props.onPress(); h.render(); } };
}

for (const os of ["android", "ios"]) test(`${os}: parent chooses a child by UID, sends once and sees proxy attribution`, async () => {
  const s = screenHarness("CalendarScreen", {}, {}, os); s.open();
  assert.equal(s.button("送信").props.disabled, true);
  const radios = [];
  for (const uid of ["child", "sibling"]) {
    const radio = s.h.find((node) => node.props?.accessibilityRole === "radio" && !radios.includes(node));
    assert.ok(radio); radios.push(radio);
  }
  radios[1].props.onPress(); s.h.render(); s.input().props.onChangeText("Synthetic sibling absence"); s.h.render();
  assert.equal(s.button("送信").props.disabled, false);
  await s.button("送信").props.onPress(); s.h.render();
  assert.equal(s.writes[0][3], "sibling"); assert.equal(s.writes[0][4], "2099-01-10");
  assert.equal(s.writes.length, 1); assert.equal(s.input().props.value, "");
  const comments = [{ id: "proxy", uid: "child", user: "Same name", text: "Synthetic reason", submittedBy: { uid: "parent2", user: "Parent2" } }];
  s.change({ clubEvents: [{ id: "event", date: "2099-01-10", status: "active", absenceComments: comments }] });
  assert.ok(s.h.text(s.h.render()).includes("保護者 Parent2 が代理登録")); s.h.unmount();
});
test("one linked child is automatically selected; no valid child hides the report entry point", () => {
  const s = screenHarness();
  s.change({ userProfiles: { ...s.profiles, Parent: { ...s.profiles.Parent, childUids: ["child"] } } }); s.open();
  assert.equal(s.byLabel("Same nameの不参加連絡").props.accessibilityState.checked, true);
  s.change({ userProfiles: { ...s.profiles, Parent: { ...s.profiles.Parent, childUids: [] } } });
  assert.equal(s.button("送信").props.disabled, true); assert.equal(s.button("不参加連絡"), null); s.h.unmount();
});
test("parent can cancel another linked parent's or child's report, even when details are hidden", async () => {
  const comments = [{ id: "child-report", uid: "child", user: "Same name", text: "Synthetic", submittedBy: { uid: "parent2", user: "Parent2" } }];
  const s = screenHarness("CalendarScreen", { absenceDetailsVisible: false,
    clubEvents: [{ id: "event", date: "2099-01-10", status: "active", absenceComments: comments }] });
  s.open(); assert.ok(s.button("取り消す")); s.button("取り消す").props.onPress();
  await s.alerts.at(-1)[2].find((button) => button.text === "取り消す").onPress();
  assert.equal(s.writes[0][0], "cancel"); assert.equal(s.writes[0][3].id, "child-report"); s.h.unmount();
});
test("member keeps self-reporting without child controls and can cancel a parent's report for them", async () => {
  const s = screenHarness("CalendarScreen", { currentUserUid: "child", currentUser: "Same name",
    clubEvents: [{ id: "event", date: "2099-01-10", status: "active", absenceComments: [{ id: "proxy", uid: "child", user: "Same name", text: "Synthetic" }] }] });
  s.open(); assert.equal(s.h.find((node) => node.props?.accessibilityRole === "radio"), null); assert.ok(s.button("取り消す"));
  s.input().props.onChangeText("Synthetic self absence"); s.h.render(); await s.button("送信").props.onPress();
  assert.equal(s.writes[0][3], "child"); s.h.unmount();
});
test("pending send blocks rapid duplicate taps and late completion cannot clear another team's draft", async () => {
  const pending = deferred(), calls = [], s = screenHarness("CalendarScreen", {}, { submitClubEventAbsence: (...args) => { calls.push(args); return pending.promise; } });
  s.open(); s.byLabel("Same nameの不参加連絡").props.onPress(); s.h.render();
  s.input().props.onChangeText("Synthetic"); s.h.render(); const button = s.button("送信");
  const request = button.props.onPress(); await button.props.onPress(); assert.equal(calls.length, 1);
  s.change({}, { activeTeamId: "other-team" });
  pending.resolve({ added: true, comment: { id: "late" } }); await request; s.h.render();
  assert.equal(s.alerts.length, 0); assert.equal(s.input(), null); s.h.unmount();
});
test("settings offer only valid child roles, preserve multiple selection and save the guardian UID", async () => {
  const s = screenHarness("SettingsScreen", { currentUserUid: "staff", currentUser: "Staff" });
  s.byLabel("Parentの子供を設定").props.onPress(); s.h.render();
  assert.ok(s.byLabel("Staffを子供に設定")); assert.equal(s.byLabel("Ownerを子供に設定"), null); assert.equal(s.byLabel("Parent2を子供に設定"), null);
  assert.equal(s.byLabel("Same nameを子供に設定").props.accessibilityState.checked, true);
  s.byLabel("Staffを子供に設定").props.onPress(); s.h.render(); await s.button("子供の設定を保存").props.onPress();
  assert.equal(s.writes[0][0], "link"); assert.equal(s.writes[0][2], "parent");
  assert.deepEqual(Array.from(s.writes[0][3]), ["child", "sibling", "staff"]); s.h.unmount();
});
test("settings save is ignored after a team switch, and ordinary guardians cannot open member management", async () => {
  const pending = deferred(), s = screenHarness("SettingsScreen", { currentUserUid: "staff" }, { setGuardianChildren: () => pending.promise });
  s.byLabel("Parentの子供を設定").props.onPress(); s.h.render(); const request = s.button("子供の設定を保存").props.onPress();
  s.change({}, { activeTeamId: "other-team" }); pending.resolve({}); await request;
  assert.equal(s.alerts.length, 0); s.h.unmount();
  const guardian = screenHarness("SettingsScreen"); assert.equal(guardian.byLabel("Parentの子供を設定"), null); guardian.h.unmount();
});

for (const os of ["android", "ios"]) test(`${os}: an unregistered child is selectable and another linked parent's report can be cancelled`, async () => {
  const s = screenHarness("CalendarScreen", {}, {}, os);
  s.change({ userProfiles: { ...s.profiles, Parent: { ...s.profiles.Parent, childUids: [], manualChildren: [{ id: "child", name: "Manual child" }] } },
    clubEvents: [{ id: "event", date: "2099-01-10", status: "active", absenceComments: [{ id: "manual-report", uid: "", childId: "child", user: "Manual child", text: "Synthetic", submittedBy: { uid: "parent2", user: "Parent2" } }] }] });
  s.open(); assert.equal(s.byLabel("Manual child（未登録）の不参加連絡").props.accessibilityState.checked, true);
  s.input().props.onChangeText("Synthetic manual absence"); s.h.render(); await s.button("送信").props.onPress(); s.h.render();
  assert.equal(s.writes[0][6], "child");
  s.button("取り消す").props.onPress(); await s.alerts.at(-1)[2].find((button) => button.text === "取り消す").onPress();
  assert.equal(s.writes[1][3].id, "manual-report");
  s.change({ userProfiles: { ...s.profiles, Parent: { ...s.profiles.Parent, childUids: [], manualChildren: [] } } });
  assert.equal(s.button("不参加連絡"), null); assert.equal(s.button("取り消す"), null); s.h.unmount();
});

test("member and manual child with the same name and ID remain distinct calendar targets", async () => {
  const s = screenHarness();
  s.change({ userProfiles: { ...s.profiles, Parent: { ...s.profiles.Parent, childUids: ["child"], manualChildren: [{ id: "child", name: "Same name" }] } } });
  s.open(); s.byLabel("Same name（未登録）の不参加連絡").props.onPress(); s.h.render();
  assert.equal(s.byLabel("Same nameの不参加連絡").props.accessibilityState.checked, false);
  s.input().props.onChangeText("Synthetic"); s.h.render(); await s.button("送信").props.onPress(); s.h.render();
  assert.equal(s.writes[0][6], "child");
  s.byLabel("Same nameの不参加連絡").props.onPress(); s.h.render(); s.input().props.onChangeText("Synthetic member"); s.h.render();
  await s.button("送信").props.onPress(); assert.equal(s.writes[1][3], "child"); assert.equal(s.writes[1][6], null); s.h.unmount();
});

test("manual names are drafts until save; cancellation discards them and failed saves reuse their IDs", async () => {
  const writes = []; let attempt = 0;
  const s = screenHarness("SettingsScreen", { currentUserUid: "staff" }, { setGuardianChildren: async (...args) => {
    writes.push(args); if (++attempt === 1) throw new Error("Synthetic network failure");
  } });
  const open = () => { s.byLabel("Parentの子供を設定").props.onPress(); s.h.render(); };
  open(); s.byLabel("未登録の子供の名前").props.onChangeText("  Manual draft  "); s.h.render();
  await s.button("子供の設定を保存").props.onPress(); assert.equal(writes.length, 0, "unadded input cannot silently disappear");
  s.button("名前を追加").props.onPress(); s.h.render(); assert.equal(writes.length, 0);
  s.button("キャンセル").props.onPress(); s.h.render(); open();
  assert.equal(s.byLabel("Manual draft（未登録）を子供に設定"), null);
  s.byLabel("未登録の子供の名前").props.onChangeText("  Manual draft  "); s.h.render(); s.button("名前を追加").props.onPress(); s.h.render();
  await s.button("子供の設定を保存").props.onPress(); s.h.render();
  await s.button("子供の設定を保存").props.onPress();
  assert.equal(writes.length, 2); assert.deepEqual(Array.from(writes[0][3]), ["manual-draft"]);
  assert.equal(writes[0][4][0].name, "Manual draft"); assert.equal(writes[1][4][0].id, writes[0][4][0].id); s.h.unmount();
});

test("settings reuse a shared manual child and discard late catalog responses after a team switch", async () => {
  const subscriptions = [];
  const s = screenHarness("SettingsScreen", { currentUserUid: "staff" }, { subscribeManualAbsenceChildren: (team, next, error) => {
    const subscription = { team, next, error, stopped: false }; subscriptions.push(subscription); return () => { subscription.stopped = true; };
  } });
  s.byLabel("Parentの子供を設定").props.onPress(); s.h.render();
  assert.equal(s.button("子供の設定を保存").props.disabled, true);
  subscriptions[0].error(new Error("Synthetic")); s.h.render(); assert.equal(s.button("子供の設定を保存").props.disabled, true);
  subscriptions[0].next([{ id: "shared", name: "Shared manual child" }]); s.h.render();
  s.byLabel("Shared manual child（未登録）を子供に設定").props.onPress(); s.h.render(); await s.button("子供の設定を保存").props.onPress(); s.h.render();
  assert.deepEqual(Array.from(s.writes[0][4]), ["shared"]); assert.equal(s.writes[0][5].length, 0);
  s.byLabel("Parentの子供を設定").props.onPress(); s.h.render(); const last = subscriptions.at(-1);
  s.change({}, { activeTeamId: "other-team" }); assert.equal(last.stopped, true);
  last.next([{ id: "private-late", name: "Late child" }]); s.h.render();
  assert.equal(s.byLabel("Late child（未登録）を子供に設定"), null); s.h.unmount();
});

test("actual service sends a separate manual target and keeps older registered-only request shapes", async () => {
  const source = fs.readFileSync(path.join(__dirname, "firestoreService.js"), "utf8");
  const names = new Set(["submitClubEventAbsence", "setGuardianChildren"]);
  const declarations = require("@babel/parser").parse(source, { sourceType: "module" }).program.body
    .filter((node) => names.has(node.declaration?.id?.name)).map((node) => source.slice(node.declaration.start, node.declaration.end)).join("\n");
  const calls = [], service = vm.runInThisContext(`(function(httpsCallable, cloudFunctions) { ${declarations}; return { submitClubEventAbsence, setGuardianChildren }; })`)(
    (region, name) => async (data) => { calls.push({ name, data }); return { data: { ok: true } }; }, "synthetic-functions");
  await service.submitClubEventAbsence("team", "event", "parent", "2099-01-10", "Synthetic", "manual-child");
  assert.equal(calls[0].data.targetChildId, "manual-child"); assert.equal(Object.hasOwn(calls[0].data, "targetUid"), false);
  await service.submitClubEventAbsence("team", "event", "child", "2099-01-10", "Synthetic");
  assert.equal(calls[1].data.targetUid, "child"); assert.equal(Object.hasOwn(calls[1].data, "targetChildId"), false);
  await service.setGuardianChildren("team", "parent", ["child"]);
  assert.equal(Object.hasOwn(calls[2].data, "manualChildIds"), false);
  await service.setGuardianChildren("team", "parent", [], ["manual-child"], [{ id: "manual-child", name: "Synthetic" }]);
  assert.deepEqual(calls[3].data.manualChildIds, ["manual-child"]); assert.equal(calls[3].data.newManualChildren[0].name, "Synthetic");
});
