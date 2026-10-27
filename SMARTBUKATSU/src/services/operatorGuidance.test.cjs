const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");
const root = path.join(__dirname, "../..");
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function load(file, modules) {
  const { code } = transformSync(fs.readFileSync(path.join(root, file), "utf8"), { configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] });
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set,
    require(name) { assert.ok(name in modules, name); return modules[name]; } });
  return module.exports;
}
function serviceEnvironment() {
  const auth = { currentUser: { uid: "op" } }, calls = [];
  let response = async () => ({ data: { allowed: true } });
  const service = load("src/services/operatorGuidanceService.js", {
    "../firebase": { auth, db: "db", cloudFunctions: "functions" },
    "firebase/firestore": { collection: (...args) => args, doc: () => ({ id: "synthetic_request_id" }) },
    "firebase/functions": { httpsCallable: (_functions, name) => async (data) => { calls.push({ name, data }); return response(); } },
  });
  return { service, auth, calls, respond(value) { response = value; } };
}
test("client APIs bind requests and late responses to the same logged-in account", async () => {
  const e = serviceEnvironment(); await e.service.getOperatorGuidanceAccess("op");
  assert.equal(e.calls[0].data.expectedUid, "op");
  await assert.rejects(e.service.getOperatorGuidanceAccess("other"), /ログイン状態/); assert.equal(e.calls.length, 1);
  const pending = deferred(); e.respond(() => pending.promise);
  const result = e.service.listOperatorGuidanceTargets("op", "page001"); e.auth.currentUser = { uid: "other" };
  pending.resolve({ data: { items: ["private"] } }); await assert.rejects(result, /ログイン状態/);
  assert.equal(e.calls[1].data.cursor, "page001");
});
test("usage API binds a single selected team to the authenticated account", async () => {
  const e = serviceEnvironment(); await e.service.getOperatorGuidanceUsage("op", "a");
  assert.equal(e.calls[0].name, "getOperatorGuidanceUsage");
  assert.equal(e.calls[0].data.teamId, "a"); assert.equal(e.calls[0].data.expectedUid, "op");
});
test("elapsed days use the exact 72-hour boundary and unknown dates remain unknown", () => {
  const { service } = serviceEnvironment(), now = Date.UTC(2026, 9, 23);
  assert.match(service.guidanceAge(now - 72 * 3600000, now), /3日経過・72時間経過/);
  assert.match(service.guidanceAge(now - 72 * 3600000 + 1, now), /72時間未満/);
  assert.equal(service.guidanceAge(0, now), "作成日時不明");
});
function renderHarness() {
  const slots = []; let cursor, dirty = true, effects, component, tree;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => typeof type === "function" ? type({ ...props, children }) : ({ type, props: props || {}, children }),
    useState(initial) { const index = cursor++; slots[index] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[index].set ||= (update) => { const next = typeof update === "function" ? update(slots[index].value) : update; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }; return [slots[index].value, slots[index].set]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useCallback(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { value: fn, deps }; return slots[index].value; },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  function render() { let passes = 0; while (dirty) { assert.ok(++passes < 30); dirty = false; cursor = 0; effects = []; tree = component(); effects.forEach((fn) => fn()); } return tree; }
  function all(predicate, node = tree) { if (!node || typeof node !== "object") return []; const list = predicate(node) ? [node] : [];
    return list.concat(...(Array.isArray(node) ? node : node.children || []).map((child) => child == null ? [] : all(predicate, child))); }
  const text = (node) => typeof node === "string" || typeof node === "number" ? String(node) : (Array.isArray(node) ? node : node?.children || []).map(text).join("");
  return { react: { __esModule: true, default: react, ...react }, render, all, text,
    mount(fn) { component = fn; render(); }, update() { dirty = true; render(); },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}
async function screenEnvironment(os = "android", mode = "send", templateOverride = null) {
  const h = renderHarness(), alerts = [], calls = [], pages = [], sent = [], links = [], usages = [];
  let usageResponse = async (teamId) => ({ teamId, counts: { members: 3, events: 4, videos: 5, viewingProjects: 6, tacticalNotes: 7 }, fetchedAt: Date.now() });
  let uid = "op", sendResponse = async () => ({ results: [{ status: "accepted", teamId: "a" }] });
  const template = templateOverride || JSON.parse(JSON.stringify(require("../../functions/operatorGuidanceBackend").GUIDANCE_TEMPLATE));
  let accessResponse = async () => ({ template });
  const items = [
    { id: "a", name: "Synthetic A", ownerUid: "owner", selectable: true, createdAt: Date.now() - 3600000 },
    { id: "legacy", name: "Synthetic Legacy", selectable: false, unavailableReason: "作成者不明" },
    { id: "sent", name: "Synthetic Sent", ownerUid: "sent-owner", selectable: true, initialRecorded: true },
    { id: "fourth", name: "Synthetic Fourth", ownerUid: "fourth-owner", selectable: true },
    { id: "fifth", name: "Synthetic Fifth", ownerUid: "fifth-owner", selectable: true },
  ];
  const nextCursor = { version: 1, id: "fifth", createdAt: { seconds: 1792700000, nanoseconds: 123456789 } };
  let pageResponse = async (cursor) => ({ items: cursor ? Array.from({ length: 5 }, (_, i) => ({ id: `next${i}`, name: `Synthetic Next ${i}`, selectable: true, ownerUid: `next-owner-${i}` })) : items, cursor: cursor ? null : nextCursor });
  const service = serviceEnvironment().service;
  const modules = {
    react: h.react, "@react-navigation/native": { useFocusEffect: (fn) => h.react.useEffect(fn, [fn]) },
    "react-native": { Platform: { OS: os }, ActivityIndicator: "Spinner", Text: "Text", TextInput: "Input", KeyboardAvoidingView: "Keyboard", View: "View", ScrollView: "ScrollView", Switch: "Switch", TouchableOpacity: "Button",
      Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: (styles) => styles } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "../AuthContext": { useAuth: () => ({ user: { uid } }) },
    "../utils/openGuide": { openGuideUrl: async (url) => links.push(url) }, "../constants/helpLinks": { SMARTBUKATSU_GUIDE_URL: template.url },
    "../services/operatorGuidanceService": { ...service, createGuidanceRequestId: () => `synthetic_request_${sent.length}`,
      getOperatorGuidanceAccess: async (uid) => { calls.push(uid); return accessResponse(uid); },
      listOperatorGuidanceTargets: async (_uid, cursor) => { pages.push(cursor); return pageResponse(cursor); },
      listOperatorGuidanceHistory: async () => ({ items: [{ id: "h", teamName: "Synthetic team", mode: "initial", status: "accepted", senderUid: "op", targetUid: "owner" }], cursor: null }),
      sendOperatorGuidance: async (uid, request) => { sent.push({ uid, request }); return sendResponse(); },
      getOperatorGuidanceUsage: async (uid, teamId) => { usages.push({ uid, teamId }); return usageResponse(teamId); },
    },
  };
  modules["../components/OperatorGuidanceContent"] = load("src/components/OperatorGuidanceContent.js", modules);
  const Screen = load("src/screens/OperatorGuidanceScreen.js", modules).default;
  h.mount(() => Screen({ navigation: { goBack() {} }, route: { params: { mode } } })); await tick(); h.render();
  const button = (label) => h.all((node) => node.type === "Button" && h.text(node).includes(label))[0];
  return { h, alerts, sent, pages, links, button, items, usages, nextCursor, template, calls, accessRespond(fn) { accessResponse = fn; }, input: (label) => h.all((node) => node.type === "Input" && node.props.accessibilityLabel === label)[0], pageRespond(fn) { pageResponse = fn; }, usageRespond(fn) { usageResponse = fn; },
    respond(fn) { sendResponse = fn; }, updateUser(value) { uid = value; h.update(); },
    confirm() { alerts.at(-1)[2].at(-1).onPress(); } };
}
for (const os of ["android", "ios"]) test(`${os}: load five more preserves selections, uses the returned cursor once and does not fetch usage`, async () => {
  const e = await screenEnvironment(os);
  const checkboxes = () => e.h.all((node) => node.props?.accessibilityRole === "checkbox");
  assert.equal(checkboxes().length, 5); assert.equal(e.pages.length, 1);
  assert.equal(e.button("50件を追加読み込み"), undefined);
  e.button("Synthetic A").props.onPress(); e.h.render();
  const pending = deferred(); e.pageRespond(() => pending.promise);
  const more = e.button("さらに5チーム読み込む"); more.props.onPress(); more.props.onPress();
  assert.equal(e.pages.length, 2); assert.equal(e.pages[1].createdAt.nanoseconds, 123456789); assert.equal(e.pages[1].id, "fifth");
  pending.resolve({ items: Array.from({ length: 5 }, (_, i) => ({ id: `next${i}`, name: `Synthetic Next ${i}`, selectable: true, ownerUid: `next-owner-${i}` })), cursor: null });
  await tick(); e.h.render(); assert.equal(checkboxes().length, 10);
  assert.equal(e.button("Synthetic A").props.accessibilityState.checked, true);
  assert.equal(e.button("さらに5チーム読み込む"), undefined); assert.equal(e.usages.length, 0);
  e.pageRespond(async () => ({ items: e.items, cursor: e.nextCursor }));
  e.button("Synthetic Next 0").props.onPress(); e.h.render();
  e.button("初回案内を送信").props.onPress(); e.confirm(); await tick(); e.h.render();
  assert.equal(e.sent[0].request.teamIds.length, 2); assert.equal(e.sent[0].request.expectedOwnerUids.next0, "next-owner-0");
  assert.equal(checkboxes().length, 5); e.h.unmount();
});
test("failed page requests keep the existing five and retry the same cursor", async () => {
  const e = await screenEnvironment(); e.pageRespond(async () => { throw new Error("synthetic page failure"); });
  await e.button("さらに5チーム読み込む").props.onPress(); e.h.render();
  assert.equal(e.h.all((node) => node.props?.accessibilityRole === "checkbox").length, 5);
  assert.match(e.h.text(e.h.render()), /synthetic page failure/);
  e.pageRespond(async () => ({ items: [], cursor: null }));
  await e.button("さらに5チーム読み込む").props.onPress(); e.h.render();
  assert.equal(e.pages[1].id, e.pages[2].id); assert.equal(e.button("さらに5チーム読み込む"), undefined);
  assert.equal(e.usages.length, 0); e.h.unmount();
});
for (const os of ["android", "ios"]) {
  test(`${os}: new team selected, unknown/sent creators disabled, confirmation required, and history mode separated`, async () => {
    const e = await screenEnvironment(os);
    assert.equal(e.button("Synthetic Legacy").props.disabled, true); assert.equal(e.button("Synthetic Sent").props.disabled, true);
    e.button("Synthetic A").props.onPress(); e.h.render(); e.button("初回案内を送信").props.onPress(); assert.equal(e.sent.length, 0);
    assert.match(e.alerts.at(-1)[1], /1アカウント/); e.confirm(); await tick(); e.h.render(); assert.equal(e.sent.length, 1); assert.equal(e.sent[0].request.mode, "initial");
    assert.equal(e.sent[0].request.expectedOwnerUids.a, "owner");
    e.h.all((node) => node.type === "Switch")[0].props.onValueChange(true); e.h.render(); assert.equal(e.button("Synthetic Sent").props.disabled, false);
    e.button("リンク先を確認").props.onPress(); await tick(); assert.equal(e.links[0], "https://sharprise.jp/smartbukatsu/guide/");
    e.h.unmount(); const history = await screenEnvironment(os, "history"); assert.equal(history.button("自分へのテスト送信"), undefined); assert.match(history.h.text(history.h.render()), /配信受付/); history.h.unmount();
  });
}
for (const os of ["android", "ios"]) test(`${os}: usage only fetches the pressed team; unavailable checkbox leaves usage accessible, errors allow retry`, async () => {
  const e = await screenEnvironment(os); assert.equal(e.usages.length, 0);
  const statsButtons = () => e.h.all((node) => node.type === "Button" && e.h.text(node) === "利用状況を取得");
  assert.equal(statsButtons()[1].props.disabled, false);
  const pending = deferred(); e.usageRespond(() => pending.promise);
  statsButtons()[1].props.onPress(); statsButtons()[1].props.onPress(); assert.equal(e.usages.length, 1); assert.equal(e.usages[0].teamId, "legacy");
  pending.reject(new Error("synthetic count failure")); await tick(); e.h.render();
  assert.match(e.h.text(e.h.render()), /synthetic count failure/); assert.ok(!e.h.text(e.h.render()).includes("メンバー数: 0"));
  e.usageRespond(async (teamId) => ({ teamId, counts: { members: 3, events: 4, videos: 5, viewingProjects: 6, tacticalNotes: 7 }, fetchedAt: Date.now() }));
  statsButtons()[1].props.onPress(); await tick(); e.h.render(); assert.equal(e.usages.length, 2);
  assert.match(e.h.text(e.h.render()), /メンバー数: 3\s*予定作成数: 4\s*動画登録数: 5\s*閲覧登録数: 6\s*戦術ノート使用数: 7/);
  await e.button("一覧を更新").props.onPress(); e.h.render(); assert.equal(e.usages.length, 2); e.h.unmount();
});
test("late usage results are discarded on account change", async () => {
  const e = await screenEnvironment(), pending = deferred(); e.usageRespond(() => pending.promise);
  e.button("利用状況を取得").props.onPress(); e.updateUser("new-user");
  pending.resolve({ counts: { members: "private-old-count" }, fetchedAt: Date.now() }); await tick(); e.h.render();
  assert.ok(!e.h.text(e.h.render()).includes("private-old-count")); e.h.unmount();
});
test("screen preserves the request ID after uncertain network errors and locks double taps", async () => {
  const e = await screenEnvironment(), pending = deferred(); e.respond(() => pending.promise);
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); e.confirm(); assert.equal(e.sent.length, 1);
  pending.reject(new Error("Synthetic network loss")); await tick(); e.h.render();
  e.respond(async () => ({ results: [] })); await e.button("同じ操作IDで送信結果を再確認").props.onPress();
  assert.equal(e.sent[0].request.requestId, e.sent[1].request.requestId); e.h.unmount();
});
test("screen discards private data/results when account changes during send", async () => {
  const e = await screenEnvironment(), pending = deferred(); e.respond(() => pending.promise);
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); e.updateUser("new-user");
  pending.resolve({ results: [{ status: "failed", reason: "private-old-result" }] }); await tick(); e.h.render();
  assert.ok(!e.h.text(e.h.render()).includes("private-old-result")); e.h.unmount();
});
test("notification entry opens the private conversation or inbox, ignores payload URLs and does not switch teams", async () => {
  const source = fs.readFileSync(path.join(root, "App.js"), "utf8");
  const { ast } = transformSync(source, { configFile: false, babelrc: false, ast: true, code: false, parserOpts: { plugins: ["jsx"] } });
  let callback;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee.name === "setNavigationHandler") callback = node.arguments[0];
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast); assert.ok(callback);
  const calls = [], service = serviceEnvironment().service;
  const handler = vm.runInNewContext(`(${source.slice(callback.start, callback.end)})`, {
    active: true, guidanceConversationTarget: service.guidanceConversationTarget,
    navigationRef: { isReady: () => true, getRootState: () => ({ routeNames: ["OperatorGuidanceInbox", "OperatorGuidanceConversation"] }), navigate: (...args) => calls.push(args) },
    selectTeam: () => assert.fail("Guide must not switch teams"), Alert: { alert: () => assert.fail("Unexpected error") },
  });
  await handler({ category: "operatorGuidance", teamId: "other-team", target: { screen: "Untrusted", params: { url: "https://example.invalid" } } });
  assert.equal(calls[0][0], "OperatorGuidanceInbox");
  await handler({ id: "guidance_legacy-history", category: "operatorGuidance" });
  assert.equal(calls[1][0], "OperatorGuidanceConversation"); assert.equal(calls[1][1].historyId, "legacy-history");
  await handler({ category: "operatorGuidance", target: { params: { historyId: "new-history", asOperator: true } } });
  assert.equal(calls[2][1].asOperator, true);
});
test("Settings shares verified membership for its menu, without a new API; stale, denied, failed and Web states stay hidden", async () => {
  const source = fs.readFileSync(path.join(root, "src/screens/SettingsScreen.js"), "utf8");
  const { ast } = transformSync(source, { configFile: false, babelrc: false, ast: true, code: false, parserOpts: { plugins: ["jsx"] } });
  const declarations = {}; let membershipEffect;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") declarations[node.id.name] = node.init;
    if (node.type === "CallExpression" && node.callee.name === "useFocusEffect") {
      const fn = node.arguments[0].arguments[0];
      if (source.slice(fn.start, fn.end).includes("getUserTeams")) membershipEffect = fn;
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast); assert.ok(membershipEffect);
  assert.ok(!source.includes("getOperatorGuidanceAccess"));
  for (const [os, joined, failed] of [["android", true, false], ["ios", true, false], ["android", false, false], ["ios", true, true], ["web", true, false]]) {
    const pending = deferred(), key = JSON.stringify(["op", ["team"]]); let reads = 0;
    const context = vm.createContext({ user: { uid: "op" }, adMembershipKey: key, adDiagnosticsAccess: null,
      Platform: { OS: os }, SHARP_RISE_INVITE_CODE: "synthetic-debug-code",
      setAdDiagnosticsAccess: (value) => { context.adDiagnosticsAccess = value; }, setIsAdDiagnosticsExpanded() {},
      getUserTeams: () => { reads++; return pending.promise; }, getOperatorGuidanceAccess: () => assert.fail("No additional access API") });
    const expression = (name) => { const node = declarations[name]; return source.slice(node.start, node.end); };
    const visible = () => { context.canViewAdDiagnostics = vm.runInContext(expression("canViewAdDiagnostics"), context); return vm.runInContext(expression("canSendGuidance"), context); };
    const cleanup = vm.runInContext(`(${source.slice(membershipEffect.start, membershipEffect.end)})()`, context);
    assert.equal(visible(), false);
    if (failed) pending.reject(new Error("Synthetic read failure"));
    else pending.resolve(joined ? [{ inviteCode: "synthetic-debug-code" }] : []);
    await tick(); assert.equal(visible(), os !== "web" && joined && !failed);
    assert.equal(reads, os === "web" ? 0 : 1);
    context.adMembershipKey = "changed-membership"; assert.equal(visible(), false);
    cleanup?.();
  }
});

async function conversationEnvironment(os = "android", asOperator = false) {
  const h = renderHarness(), reads = [], replies = [], links = [];
  let uid = "recipient", response = async () => ({ saved: true, notificationStatus: "accepted" });
  const initial = { thread: { id: "history", title: "Synthetic guide", body: "Private initial guide", createdAt: Date.now(), canReply: true, asOperator },
    items: [{ id: "history_000000000002", body: "Recent reply", senderRole: "operator" }], cursor: "history_000000000002" };
  let pageResponse = async (cursor) => cursor ? { ...initial, items: [{ id: "history_000000000001", body: "Older reply", senderRole: "recipient" }], cursor: null } : initial;
  const modules = {
    react: h.react, "@react-navigation/native": { useFocusEffect: (fn) => h.react.useEffect(fn, [fn]) },
    "react-native": { Platform: { OS: os }, ActivityIndicator: "Spinner", Text: "Text", View: "View", ScrollView: "ScrollView", KeyboardAvoidingView: "Keyboard", TextInput: "Input", TouchableOpacity: "Button",
      Alert: { alert() {} }, StyleSheet: { create: (value) => value } },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "../AuthContext": { useAuth: () => ({ user: { uid } }) },
    "../utils/openGuide": { openGuideUrl: async (url) => links.push(url) }, "../constants/helpLinks": { SMARTBUKATSU_GUIDE_URL: "https://sharprise.jp/smartbukatsu/guide/" },
    "../services/operatorGuidanceService": { createGuidanceRequestId: () => `synthetic_reply_${replies.length}`,
      getOperatorGuidanceConversation: async (...args) => { reads.push(args); return pageResponse(args[3], args[0]); },
      replyOperatorGuidance: async (uid, request) => { replies.push({ uid, request }); return response(); } },
  };
  modules["../components/OperatorGuidanceContent"] = load("src/components/OperatorGuidanceContent.js", modules);
  const Screen = load("src/screens/OperatorGuidanceConversationScreen.js", modules).default;
  h.mount(() => Screen({ navigation: { goBack() {} }, route: { params: { historyId: "history", asOperator } } })); await tick(); h.render();
  const button = (label) => h.all((node) => node.type === "Button" && h.text(node).includes(label))[0];
  return { h, reads, replies, links, button, input: () => h.all((node) => node.type === "Input")[0],
    respond(fn) { response = fn; }, pageRespond(fn) { pageResponse = fn; }, updateUser(value) { uid = value; h.update(); } };
}
for (const os of ["android", "ios"]) test(`${os}: recipient reads the private conversation and sends a reply once, including with push OFF`, async () => {
  const e = await conversationEnvironment(os); assert.match(e.h.text(e.h.render()), /Private initial guide/);
  await e.button("過去のやり取りを30件読み込む").props.onPress(); e.h.render();
  assert.equal(e.reads[1][3], "history_000000000002"); assert.match(e.h.text(e.h.render()), /Older reply.*Recent reply/);
  const pending = deferred(); e.respond(() => pending.promise);
  e.input().props.onChangeText("Synthetic question"); e.h.render();
  const sendButton = e.button("返信を送信"); sendButton.props.onPress(); sendButton.props.onPress(); e.h.render();
  assert.equal(e.replies.length, 1); assert.equal(e.input().props.editable, false); assert.equal(e.replies[0].request.asOperator, false);
  pending.resolve({ saved: true, notificationStatus: "unavailable" }); await tick(); e.h.render();
  assert.match(e.h.text(e.h.render()), /返信を保存しました/); assert.equal(e.input().props.value, "");
  await e.button("操作ガイドを見る").props.onPress(); assert.equal(e.links[0], "https://sharprise.jp/smartbukatsu/guide/"); e.h.unmount();
});
test("uncertain replies keep their operation and text until explicitly checked again", async () => {
  const e = await conversationEnvironment("ios", true);
  e.input().props.onChangeText("Synthetic operator answer"); e.h.render(); e.respond(async () => { throw new Error("Synthetic lost response"); });
  await e.button("返信を送信").props.onPress(); e.h.render();
  assert.equal(e.input().props.editable, false); assert.equal(e.input().props.value, "Synthetic operator answer");
  assert.equal(e.replies[0].request.asOperator, true);
  e.respond(async () => ({ saved: true, notificationStatus: "processing" }));
  await e.button("同じ返信の送信結果を確認").props.onPress(); e.h.render();
  assert.equal(e.replies[0].request.requestId, e.replies[1].request.requestId); assert.equal(e.input().props.value, ""); e.h.unmount();
});
test("account changes discard late conversation data and private drafts; denial clears previously loaded messages", async () => {
  const e = await conversationEnvironment(), pending = deferred();
  e.input().props.onChangeText("Private draft"); e.h.render(); e.pageRespond((_cursor, requestedUid) => requestedUid === "recipient" ? pending.promise
    : Promise.resolve({ thread: { title: "New account", canReply: false }, items: [], cursor: null }));
  e.button("会話を更新").props.onPress(); e.updateUser("other-user");
  pending.resolve({ thread: { title: "Late private result" }, items: [], cursor: null }); await tick(); e.h.render();
  // The real service rejects an old-account response; screen also discards its old invocation.
  assert.ok(!e.h.text(e.h.render()).includes("Private draft")); assert.ok(!e.h.text(e.h.render()).includes("Late private result")); e.h.unmount();
  const denied = await conversationEnvironment(); denied.pageRespond(async () => { throw Object.assign(new Error("Synthetic denied"), { code: "functions/permission-denied" }); });
  await denied.button("会話を更新").props.onPress(); denied.h.render();
  assert.ok(!denied.h.text(denied.h.render()).includes("Private initial guide")); assert.equal(denied.input(), undefined); denied.h.unmount();
});
test("inbox is independently reachable and only loads another page on request", async () => {
  const h = renderHarness(), calls = [], navigations = [];
  const modules = { react: h.react, "@react-navigation/native": { useFocusEffect: (fn) => h.react.useEffect(fn, [fn]) },
    "react-native": { ActivityIndicator: "Spinner", ScrollView: "ScrollView", StyleSheet: { create: (value) => value }, Text: "Text", TouchableOpacity: "Button", View: "View" },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" }, "../AuthContext": { useAuth: () => ({ user: { uid: "recipient" } }) },
    "../services/operatorGuidanceService": { listOperatorGuidanceInbox: async (uid, cursor) => { calls.push({ uid, cursor }); return { items: [{ id: cursor ? "older" : "recent", title: "Synthetic inbox guide" }], cursor: cursor ? null : "next" }; } } };
  const Screen = load("src/screens/OperatorGuidanceInboxScreen.js", modules).default;
  h.mount(() => Screen({ navigation: { goBack() {}, navigate: (...args) => navigations.push(args) } })); await tick(); h.render();
  assert.equal(calls.length, 1); assert.match(h.text(h.render()), /通知をOFFにしていても/);
  const button = (label) => h.all((node) => node.type === "Button" && h.text(node).includes(label))[0];
  await button("過去のご案内を20件読み込む").props.onPress(); h.render(); assert.equal(calls[1].cursor, "next");
  button("Synthetic inbox guide").props.onPress(); assert.equal(navigations[0][0], "OperatorGuidanceConversation"); h.unmount();
  const source = fs.readFileSync(path.join(root, "src/screens/SettingsScreen.js"), "utf8");
  assert.ok(source.indexOf('navigation.navigate("OperatorGuidanceInbox")') < source.indexOf("{canSendGuidance && <View>"));
});
test("conversation services preserve authenticated identity, and legacy notification sources resolve without trusting URLs", async () => {
  const e = serviceEnvironment(); await e.service.listOperatorGuidanceInbox("op", "older");
  await e.service.getOperatorGuidanceConversation("op", "history", true, "page");
  await e.service.replyOperatorGuidance("op", { historyId: "history", text: "Synthetic", requestId: "synthetic_reply_id" });
  assert.equal(e.calls[1].data.expectedUid, "op"); assert.equal(e.calls[1].data.asOperator, true); assert.equal(e.calls[1].data.cursor, "page");
  assert.equal(e.calls[2].name, "replyOperatorGuidance");
  assert.equal(e.service.guidanceConversationTarget({ source: { historyId: "legacy" } }).params.historyId, "legacy");
  assert.equal(e.service.guidanceConversationTarget({ target: { params: { historyId: "bad/id", url: "https://example.invalid" } } }).screen, "OperatorGuidanceInbox");
});

for (const os of ["android", "ios"]) test(`${os}: editable guidance previews and confirms the exact title, paragraphs and five linked labels`, async () => {
  const e = await screenEnvironment(os);
  assert.match(e.input("案内の前文").props.value, /弊社アプリのインストール/);
  assert.match(e.input("案内の後文・署名").props.value, /まずはメンバーとの連絡手段として活用いただき、慣れてきたら動画タグ付け/);
  e.input("案内タイトル").props.onChangeText("調整した案内");
  e.input("案内の前文").props.onChangeText("チーム名を添えた前文\n2行目"); e.h.render();
  e.input("項目1の表示文言").props.onChangeText("招待と役割の設定を始める");
  e.input("案内の後文・署名").props.onChangeText("調整した後文と署名"); e.h.render();
  const featureLinks = e.h.all((node) => node.props?.accessibilityRole === "link"); assert.equal(featureLinks.length, 6);
  for (const link of featureLinks) await link.props.onPress();
  assert.deepEqual(e.links, ["members", "permissions", "calendar", "communication", "video-clip", "tactics"].map((topic) => `${e.template.url}#${topic}`));
  e.button("自分へのテスト送信").props.onPress();
  assert.match(e.alerts.at(-1)[1], /調整した案内\nチーム名を添えた前文\n2行目/);
  assert.match(e.alerts.at(-1)[1], /・招待と役割の設定を始める/);
  assert.match(e.alerts.at(-1)[1], /調整した後文と署名/);
  e.confirm(); await tick(); e.h.render();
  assert.equal(e.sent[0].request.content.title, "調整した案内"); assert.equal(e.sent[0].request.content.features[0].topic, "members");
  assert.equal(e.sent[0].request.content.features[0].url, undefined); e.h.unmount();
});

test("uncertain edited sends retain an immutable snapshot and prevent changing or resubmitting a different draft", async () => {
  const e = await screenEnvironment(), pending = deferred();
  e.input("案内の前文").props.onChangeText("確認対象の本文"); e.h.render(); e.respond(() => pending.promise);
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); e.confirm(); e.h.render();
  assert.equal(e.sent.length, 1); assert.equal(e.input("案内の前文").props.editable, false);
  pending.reject(new Error("Synthetic timeout")); await tick(); e.h.render();
  e.input("案内の前文").props.onChangeText("結果未確認で書き換え"); e.h.render();
  assert.equal(e.input("案内の前文").props.value, "確認対象の本文");
  e.respond(async () => ({ results: [] })); await e.button("同じ操作IDで送信結果を再確認").props.onPress();
  assert.equal(e.sent[1].request.content.introduction, "確認対象の本文"); assert.equal(e.sent[0].request, e.sent[1].request); e.h.unmount();
});

test("empty editable fields cannot send and account changes clear old drafts before loading new data", async () => {
  const e = await screenEnvironment();
  e.input("項目2の表示文言").props.onChangeText(" "); e.h.render();
  assert.equal(e.button("自分へのテスト送信").props.disabled, true);
  e.button("自分へのテスト送信").props.onPress(); assert.equal(e.alerts.length, 0);
  e.input("案内の前文").props.onChangeText("前アカウントの私的な下書き"); e.h.render(); e.updateUser("new-user");
  assert.equal(e.input("案内の前文"), undefined);
  await tick(); e.h.render(); assert.match(e.input("案内の前文").props.value, /弊社アプリ/);
  assert.ok(!e.h.text(e.h.render()).includes("前アカウントの私的な下書き")); e.h.unmount();
});

test("saved guidance renders six allowed topic links; arbitrary URLs are ignored and legacy text stays readable", async () => {
  const h = renderHarness(), links = [], base = "https://sharprise.jp/smartbukatsu/guide/";
  const template = require("../../functions/operatorGuidanceBackend").GUIDANCE_TEMPLATE;
  const content = JSON.parse(JSON.stringify(template.content)); content.features[0].url = "https://example.invalid/";
  const Component = load("src/components/OperatorGuidanceContent.js", { react: h.react,
    "react-native": { Alert: { alert() {} }, Text: "Text", View: "View", StyleSheet: { create: (value) => value } },
    "../constants/helpLinks": { SMARTBUKATSU_GUIDE_URL: base }, "../utils/openGuide": { openGuideUrl: async (url) => links.push(url) } }).default;
  let saved = { content, body: template.body };
  h.mount(() => Component(saved)); assert.match(h.text(h.render()), /弊社アプリ/);
  const rendered = h.all((node) => node.props?.accessibilityRole === "link"); assert.equal(rendered.length, 6);
  await rendered[0].props.onPress(); assert.equal(links[0], `${base}#members`);
  saved = { body: "変更しない旧案内" }; h.update(); assert.equal(h.text(h.render()), "変更しない旧案内");
  saved = { body: "未知の形式の案内", content: { ...content, features: [{ topic: "untrusted", label: "Bad" }] } }; h.update();
  assert.equal(h.text(h.render()), "未知の形式の案内"); assert.equal(h.all((node) => node.props?.accessibilityRole === "link").length, 0); h.unmount();
});

test("before the template API update, the sender keeps the old fixed message and guide link without promising unavailable editing", async () => {
  const e = await screenEnvironment("android", "send", { version: "guide-v1", title: "旧案内", body: "旧固定文", url: "https://sharprise.jp/smartbukatsu/guide/" });
  assert.equal(e.input("案内タイトル"), undefined); assert.match(e.h.text(e.h.render()), /旧固定文/);
  e.button("自分へのテスト送信").props.onPress(); assert.match(e.alerts.at(-1)[1], /https:\/\/sharprise.jp\/smartbukatsu\/guide\//);
  assert.ok(!e.alerts.at(-1)[1].includes("各項目から")); e.confirm(); await tick();
  assert.equal(e.sent[0].request.templateVersion, "guide-v1"); assert.equal(e.sent[0].request.content, undefined); e.h.unmount();
});

for (const os of ["android", "ios"]) test(`${os}: a first attempt rejected before sending unlocks the draft and permits a corrected new operation`, async () => {
  const e = await screenEnvironment(os);
  e.respond(async () => { throw Object.assign(new Error("Synthetic rejected draft"), { code: "functions/invalid-argument", details: { guidanceSendNotStarted: true, refreshTemplate: false } }); });
  e.input("案内の前文").props.onChangeText("未送信の下書き"); e.h.render();
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); await tick(); e.h.render();
  assert.equal(e.input("案内の前文").props.editable, true); assert.equal(e.button("一覧を更新").props.disabled, false);
  assert.equal(e.button("同じ操作IDで送信結果を再確認"), undefined);
  e.input("案内の前文").props.onChangeText("修正した本文"); e.h.render(); e.respond(async () => ({ results: [] }));
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); await tick(); e.h.render();
  assert.equal(e.sent[1].request.content.introduction, "修正した本文"); assert.notEqual(e.sent[0].request.requestId, e.sent[1].request.requestId); e.h.unmount();
});

test("a stale first attempt refreshes the template without sending again and preserves compatible manual edits", async () => {
  for (const oldTemplate of [null, { version: "guide-v1", title: "旧案内", body: "旧本文", url: "https://sharprise.jp/smartbukatsu/guide/" }]) {
    const e = await screenEnvironment("android", "send", oldTemplate);
    if (!oldTemplate) { e.input("案内の前文").props.onChangeText("保持する手動調整"); e.h.render(); }
    const current = JSON.parse(JSON.stringify(require("../../functions/operatorGuidanceBackend").GUIDANCE_TEMPLATE)); current.version = "synthetic-next-version";
    e.accessRespond(async () => ({ template: current }));
    e.respond(async () => { throw Object.assign(new Error("Template changed"), { code: "functions/invalid-argument", details: { guidanceSendNotStarted: true, refreshTemplate: true } }); });
    e.button("自分へのテスト送信").props.onPress(); e.confirm(); await tick(); e.h.render();
    assert.equal(e.sent.length, 1); assert.equal(e.calls.length, 2); assert.equal(e.input("案内の前文").props.editable, true);
    assert.equal(e.input("案内の前文").props.value, oldTemplate ? current.content.introduction : "保持する手動調整");
    e.respond(async () => ({ results: [] })); e.button("自分へのテスト送信").props.onPress(); e.confirm(); await tick(); e.h.render();
    assert.equal(e.sent[1].request.templateVersion, "synthetic-next-version"); e.h.unmount();
  }
});

test("a failed template refresh leaves an explicit retry and blocks stale sends until refreshed", async () => {
  const e = await screenEnvironment();
  e.accessRespond(async () => { throw new Error("Synthetic refresh failure"); });
  e.respond(async () => { throw Object.assign(new Error("Template changed"), { code: "functions/invalid-argument", details: { guidanceSendNotStarted: true, refreshTemplate: true } }); });
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); await tick(); e.h.render();
  assert.equal(e.input("案内タイトル").props.editable, true); assert.equal(e.button("文面を再取得").props.disabled, false);
  assert.equal(e.button("自分へのテスト送信").props.disabled, true); assert.equal(e.sent.length, 1);
  e.accessRespond(async () => ({ template: e.template })); await e.button("文面を再取得").props.onPress(); e.h.render();
  assert.equal(e.button("文面を再取得"), undefined); assert.equal(e.button("自分へのテスト送信").props.disabled, false); e.h.unmount();
});

test("a rejection of a later check cannot erase an earlier uncertain send or change its operation", async () => {
  const e = await screenEnvironment();
  e.respond(async () => { throw new Error("Synthetic lost response"); });
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); await tick(); e.h.render();
  e.respond(async () => { throw Object.assign(new Error("New version rejects this check"), { code: "functions/invalid-argument", details: { guidanceSendNotStarted: true, refreshTemplate: true } }); });
  await e.button("同じ操作IDで送信結果を再確認").props.onPress(); e.h.render();
  assert.equal(e.input("案内タイトル").props.editable, false); assert.equal(e.button("一覧を更新").props.disabled, true);
  assert.equal(e.calls.length, 1); assert.equal(e.sent[0].request, e.sent[1].request); assert.match(e.h.text(e.h.render()), /先の送信結果は未確定/);
  e.respond(async () => ({ results: [] })); await e.button("同じ操作IDで送信結果を再確認").props.onPress(); e.h.render();
  assert.equal(e.sent[0].request, e.sent[2].request); assert.equal(e.input("案内タイトル").props.editable, true); e.h.unmount();
});

test("an unmarked validation error remains uncertain and does not unlock the sender", async () => {
  const e = await screenEnvironment();
  e.respond(async () => { throw Object.assign(new Error("Potential earlier operation conflict"), { code: "functions/invalid-argument" }); });
  e.button("自分へのテスト送信").props.onPress(); e.confirm(); await tick(); e.h.render();
  assert.equal(e.input("案内タイトル").props.editable, false); assert.ok(e.button("同じ操作IDで送信結果を再確認")); e.h.unmount();
});
