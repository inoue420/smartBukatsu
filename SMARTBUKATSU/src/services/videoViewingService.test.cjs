const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { transformSync } = require("@babel/core");
const guidance = require("../utils/videoViewingGuidance");
const permissions = require("../utils/recordedTagPermissions");
const root = path.join(__dirname, "../..");
const idle = () => {};
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(setImmediate);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const viewer = { userRole: "owner", currentUserUid: "self", displayUserName: "監督", canUploadVideos: false };
const video = (id, patch = {}) => ({ id, title: id, videoUrl: "https://youtu.be/abcdefghijk", tags: [{ id: "t", label: "得点", videoTime: 10, status: "shared", uid: "self", user: "監督" }], ...patch });
const snap = (items) => ({ docs: items.map(({ id, ...value }) => ({ id, data: () => value })) });
function load(file, modules) {
  const code = transformSync(fs.readFileSync(path.join(root, file), "utf8"), {
    configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Map, Set, global: {}, console,
    setTimeout: () => 1, clearTimeout: idle, setInterval: () => 1, clearInterval: idle,
    require(name) { assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name]; } });
  return module.exports;
}
function hooks() {
  const slots = []; let cursor, effects, tree, component;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === "function" ? initial() : initial };
      slots[i].set ||= update => { slots[i].value = typeof update === "function" ? update(slots[i].value) : update; };
      return [slots[i].value, slots[i].set]; },
    useRef(value) { return slots[cursor++] ||= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const render = () => { cursor = 0; effects = []; tree = component(); effects.forEach(fn => fn()); return tree; };
  return { react: { __esModule: true, default: react, ...react }, render,
    mount(fn) { component = fn; render(); return render(); },
    unmount() { slots.forEach(slot => slot.cleanup?.()); }, get tree() { return tree; } };
}
const walk = (node, fn) => !node || typeof node !== "object" ? [] : [
  ...(!Array.isArray(node) && fn(node) ? [node] : []),
  ...(Array.isArray(node) ? node : [...(node.children || []), node.props?.ListHeaderComponent, node.props?.ListEmptyComponent]).flatMap(child => walk(child, fn)),
];
const textOf = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) : (Array.isArray(node) ? node : node.children || []).map(textOf).join("");
function button(h, label) {
  const found = walk(h.tree, (node) => node.type === "TouchableOpacity" && textOf(node) === label)[0];
  assert.ok(found, `Missing button ${label}`); return found.props;
}
const native = (os = "android", alerts = []) => new Proxy({ StyleSheet: { create: value => value, absoluteFillObject: {} },
  Platform: { OS: os }, useWindowDimensions: () => ({ width: 390, height: 844 }), Keyboard: { dismiss: idle }, Alert: { alert: (...args) => alerts.push(args) },
}, { get: (target, name) => target[name] ?? name });

test("guidance respects existing create/add roles and visible tags, including legacy ownership", () => {
  for (const role of ["owner", "admin", "staff", "captain", "member", "guardian", "unknown"]) {
    for (const allowed of [false, true]) {
      const result = guidance.viewingPermissions(role, allowed);
      assert.equal(result.canAdd, ["owner", "admin", "staff"].includes(role));
      assert.equal(result.canCreate, ["owner", "admin", "staff", "captain"].includes(role) || (["member", "guardian"].includes(role) && allowed));
    }
  }
  assert.equal(guidance.hasViewingTags(video("a"), viewer), true);
  for (const patch of [{ status: "deleted" }, { videoUrl: "" }, { tags: [] }, { tags: [{ uid: "other", user: "監督", status: "private" }] }]) {
    assert.equal(guidance.hasViewingTags(video("a", patch), viewer), false);
  }
  const privateVideo = video("a", { tags: [{ uid: "self", status: "private" }, { user: "監督", status: "private" }, { uid: "other", user: "監督", status: "private" }] });
  assert.equal(guidance.ownPrivateTagCount([privateVideo], viewer), 2);
  assert.equal(guidance.hasViewingTags(video("a", { participants: "coach" }), { ...viewer, userRole: "member" }), false);
});

function serviceEnvironment() {
  const calls = [], writes = [], records = new Map([["projects/a", video("a")]]);
  let read = async () => snap([]), failCommit = false;
  const sdk = {
    collection: (_db, ...parts) => parts.join("/"),
    doc: (base, ...parts) => parts.length ? { id: parts.at(-1), path: parts.slice(-2).join("/") } : { id: "new", path: "highlightProjects/new" },
    query: (ref, filter) => ({ ref, filter }), where: (...parts) => parts,
    getDocsFromServer: async q => { calls.push(q); return read(q); }, serverTimestamp: () => "server-time",
    runTransaction: async (_db, fn) => {
      const pending = [], result = await fn({
        get: async ref => ({ exists: () => records.has(ref.path), data: () => records.get(ref.path) }),
        set: (ref, data) => pending.push({ ref, data }), update: (ref, data) => pending.push({ ref, data }),
      });
      if (failCommit) throw new Error("offline");
      writes.push(...pending); return result;
    },
  };
  const service = load("src/services/videoViewingService.js", { "firebase/firestore": sdk, "../firebase": { db: "db" }, "../utils/videoViewingGuidance": guidance });
  return { service, calls, writes, records, setRead(fn) { read = fn; }, fail() { failCommit = true; } };
}
test("membership checks bypass the latest-50 list, chunk 30 IDs, and ignore deleted destinations", async () => {
  const e = serviceEnvironment();
  e.setRead(async () => snap([{ id: "old", title: "Older", videoIds: ["a", "v30"] }, { id: "deleted", status: "deleted", videoIds: ["a"] }]));
  const ids = ["a", ...Array.from({ length: 31 }, (_, i) => `v${i}`), "a"];
  const result = await e.service.findVideoViewingProjects("team", ids);
  assert.equal(e.calls.length, 2); assert.equal(e.calls[0].filter[2].length, 30);
  assert.equal(e.calls[1].filter[2].length, 2);
  assert.deepEqual(plain(result.a.map(item => item.id)), ["old"]);
  assert.deepEqual(plain(result.v30.map(item => item.id)), ["old"]);
  assert.deepEqual(plain(result.v0), []);
  assert.equal(e.writes.length, 0);
  const count = e.calls.length; await e.service.findVideoViewingProjects("team", []); assert.equal(e.calls.length, count);
});
test("offline membership fails rather than reporting unregistered videos", async () => {
  const e = serviceEnvironment(); e.setRead(async () => { throw new Error("offline"); });
  await assert.rejects(e.service.findVideoViewingProjects("team", ["a"]), /offline/);
});
test("creation returns the real saved ID without publishing tags; writes fail atomically", async () => {
  const e = serviceEnvironment(), source = video("a", { tags: [{ uid: "self", status: "private" }] }); e.records.set("projects/a", source);
  const created = await e.service.createVideoViewingProject("team", "  振り返り  ", ["a", "a"], viewer);
  assert.equal(created.id, "new"); assert.equal(created.title, "振り返り");
  assert.equal(e.writes.length, 1); assert.deepEqual(plain(e.writes[0].data.videoIds), ["a"]);
  assert.equal(e.writes[0].data.createdBy, "self"); assert.equal(e.writes[0].data.createdAt, "server-time");
  assert.equal(source.tags[0].status, "private");
  const offline = serviceEnvironment(); offline.fail();
  await assert.rejects(offline.service.createVideoViewingProject("team", "a", ["a"], viewer), /offline/);
  assert.equal(offline.writes.length, 0);
});
test("existing additions preserve other videos and recheck current deleted/hidden sources", async () => {
  const e = serviceEnvironment(); e.records.set("highlightProjects/h", { title: "既存", videoIds: ["b", "concurrent"] });
  const saved = await e.service.addVideosToViewingProject("team", "h", ["a", "a"], viewer);
  assert.deepEqual(plain(saved.videoIds), ["b", "concurrent", "a"]);
  for (const invalid of [undefined, { status: "deleted" }]) {
    if (invalid) e.records.set("highlightProjects/h", invalid); else e.records.delete("highlightProjects/h");
    await assert.rejects(e.service.addVideosToViewingProject("team", "h", ["a"], viewer), /削除/);
  }
  e.records.set("highlightProjects/h", { videoIds: [] }); e.records.set("projects/a", video("a", { status: "deleted" }));
  await assert.rejects(e.service.addVideosToViewingProject("team", "h", ["a"], viewer), /動画/);
  assert.equal(e.writes.length, 1);
});
test("unauthorized actions reject without reads/writes and creation rejects invisible tags", async () => {
  const e = serviceEnvironment();
  await assert.rejects(e.service.createVideoViewingProject("team", "a", ["a"], { ...viewer, userRole: "member" }), /権限/);
  await assert.rejects(e.service.addVideosToViewingProject("team", "h", ["a"], { ...viewer, userRole: "captain" }), /権限/);
  e.records.set("projects/a", video("a", { tags: [{ uid: "other", status: "private" }] }));
  await assert.rejects(e.service.createVideoViewingProject("team", "a", ["a"], viewer), /動画/);
  assert.equal(e.calls.length, 0); assert.equal(e.writes.length, 0);
});

test("registration hook never publishes stale team/ID results and requires a successful retry", async () => {
  const h = hooks(), requests = [];
  const { useVideoViewingRegistration } = load("src/hooks/useVideoViewingRegistration.js", { react: h.react,
    "../services/videoViewingService": { findVideoViewingProjects: (team, ids) => { const d = deferred(); requests.push({ team, ids, ...d }); return d.promise; } } });
  let team = "a", ids = ["a"], enabled = true, revision = "";
  h.mount(() => useVideoViewingRegistration(team, ids, enabled, revision));
  assert.equal(h.tree.status, "loading");
  team = "b"; h.render(); requests[0].resolve({ a: [{ id: "wrong-team" }] }); await tick(); h.render();
  assert.equal(h.tree.status, "loading"); assert.deepEqual(plain(h.tree.byVideo), {});
  requests[1].reject(new Error("offline")); await tick(); h.render(); assert.equal(h.tree.status, "error");
  h.tree.retry(); h.render(); assert.equal(h.tree.status, "loading");
  requests[2].resolve({ a: [] }); await tick(); h.render(); assert.equal(h.tree.status, "ready");
  ids = ["a", "a"]; h.render(); assert.equal(requests.length, 3);
  enabled = false; h.render(); h.render(); enabled = true; h.render();
  assert.equal(h.tree.status, "loading"); requests[3].resolve({ a: [] }); await tick(); h.render();
  revision = "changed"; h.render(); assert.equal(h.tree.status, "loading");
  h.unmount(); requests[4].resolve({ a: [] }); await tick();
});

function modalEnvironment(os, overrides = {}) {
  const h = hooks(), requests = [], completed = [], listCalls = [];
  const props = { teamId: "team", videos: [video("a")], viewer, onCompleted: value => completed.push(value), onClose: idle, ...overrides };
  const component = load("src/components/VideoViewingRegistrationModal.js", { react: h.react, "react-native": native(os),
    "../utils/videoViewingGuidance": guidance,
    "../services/videoViewingService": {
      listVideoViewingProjects: async () => { listCalls.push(true); return [{ id: "older", title: "過去のプロジェクト" }]; },
      createVideoViewingProject: (...args) => { const d = deferred(); requests.push({ args, ...d }); return d.promise; },
      addVideosToViewingProject: (...args) => { const d = deferred(); requests.push({ args, ...d }); return d.promise; },
    },
  }).default;
  h.mount(() => component(props)); return { h, props, requests, completed, listCalls };
}
for (const os of ["android", "ios"]) {
  test(`${os}: dialog preselects the source, keeps failed drafts, and opens only after save success`, async () => {
    const e = modalEnvironment(os), { h } = e;
    const input = walk(h.tree, node => node.type === "TextInput")[0]; assert.equal(input.props.value, "a");
    assert.equal(e.listCalls.length, 0);
    const save = button(h, "追加して閲覧を開く").onPress;
    const failed = save(); save(); h.render();
    assert.equal(e.requests.length, 1); assert.equal(e.completed.length, 0); assert.deepEqual(plain(e.requests[0].args[2]), ["a"]);
    e.requests[0].reject(new Error("保存できません")); await failed; h.render();
    assert.equal(walk(h.tree, node => node.type === "TextInput")[0].props.value, "a");
    assert.equal(e.completed.length, 0); assert.equal(button(h, "追加して閲覧を開く").disabled, false);
    const successful = button(h, "追加して閲覧を開く").onPress(); e.requests[1].resolve({ id: "saved" }); await successful; h.render();
    assert.equal(e.completed[0].id, "saved");
  });
  test(`${os}: destination loading is explicit and permission-dependent`, async () => {
    const e = modalEnvironment(os); button(e.h, "既存に追加").onPress(); e.h.render(); await tick(); e.h.render();
    assert.equal(e.listCalls.length, 1);
    button(e.h, "○ 過去のプロジェクト").onPress(); e.h.render();
    const saving = button(e.h, "追加して閲覧を開く").onPress(); assert.equal(e.requests[0].args[1], "older");
    e.requests[0].resolve({ id: "older" }); await saving;
    const captain = modalEnvironment(os, { viewer: { ...viewer, userRole: "captain" } });
    assert.equal(walk(captain.h.tree, node => node.type === "TouchableOpacity" && textOf(node) === "既存に追加").length, 0);
    assert.equal(captain.listCalls.length, 0);
    const member = modalEnvironment(os, { viewer: { ...viewer, userRole: "member" } });
    assert.equal(walk(member.h.tree, node => node.type === "TouchableOpacity" && textOf(node) === "追加して閲覧を開く").length, 0);
    assert.equal(member.listCalls.length, 0);
  });
}

function screenEnvironment(name, { role = "owner", registration = { status: "ready", byVideo: { a: [] }, retry: idle }, params = {}, os = "android" } = {}) {
  const h = hooks(), navigationCalls = [], alerts = [], writes = [], historyRequests = [];
  let focused = true;
  const v = video("a", { tags: [{ id: "t", label: "得点", videoTime: 10, status: "private", uid: "self", user: "監督" }] });
  const props = { route: { params: { project: v, userRole: role, ...params } }, navigation: {
    navigate: (...args) => navigationCalls.push(args), setParams: value => Object.assign(props.route.params, value), goBack: idle,
  }, currentUser: "監督", currentUserUid: "self", projects: [v], userProfiles: { self: { uid: "self", role } }, tagGroups: [], setProjects: idle };
  const modules = {
    react: h.react, "react-native": native(os, alerts), "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-av": { Video: "Video", ResizeMode: { CONTAIN: "contain" } }, "expo-clipboard": {},
    "react-native-youtube-iframe": { __esModule: true, default: "YoutubePlayer" },
    "expo-screen-orientation": { unlockAsync: async () => {}, lockAsync: async () => {}, OrientationLock: {} },
    "@react-navigation/native": { CommonActions: {}, useIsFocused: () => focused, usePreventRemove: idle },
    "../AuthContext": { useAuth: () => ({ activeTeamId: "team", user: { uid: "self" } }) }, "../firebase": { auth: { currentUser: { uid: "self" } } },
    "../utils/recordedTagPermissions": permissions, "../utils/videoViewingGuidance": guidance,
    "../utils/clipPlaybackTransition": require("../utils/clipPlaybackTransition"), "../utils/tacticalNotes": require("../utils/tacticalNotes"),
    "../hooks/useVideoViewingRegistration": { useVideoViewingRegistration: () => registration },
    "../services/historyDataService": { subscribeProjectsByIds: (_team, _ids, next) => { next([v]); return idle; }, subscribeHistoryDocument: (team, _name, id, next) => { historyRequests.push({ team, id, next }); return idle; } },
    "../components/HistoryLoadingControls": { __esModule: true, default: "HistoryLoadingControls" },
    "../components/GuideHelpLink": { __esModule: true, default: "GuideHelpLink" },
    "../components/VideoViewingRegistrationModal": { __esModule: true, default: "ViewingModal", ViewingProjectPicker: "ViewingPicker" },
    "../services/firestoreService": { updateProject: (...args) => { const d = deferred(); writes.push({ args, ...d }); return d.promise; } },
  };
  const component = load(`src/screens/${name}.js`, modules).default;
  h.mount(() => component(props)); return { h, props, navigationCalls, alerts, writes, historyRequests,
    setFocused(value) { focused = value; h.render(); h.render(); }, render() { h.render(); return h.render(); } };
}
test("video list shows scoped counts, opens registration with selected sources, and handles cross-screen viewing", () => {
  const e = screenEnvironment("ProjectListScreen"), { h } = e;
  assert.ok(walk(h.tree, node => node.type === "Text").some(node => textOf(node).includes("動画が1件")));
  button(h, "閲覧用プロジェクトに追加する").onPress(); e.render();
  const dialog = walk(h.tree, node => node.type === "ViewingModal")[0]; assert.equal(dialog.props.videos[0].id, "a");
  dialog.props.onCompleted({ id: "saved", title: "閲覧", videoIds: ["a"] }); e.render();
  assert.ok(walk(h.tree, node => node.type === "Text").some(node => textOf(node) === "閲覧"));
  const route = screenEnvironment("ProjectListScreen", { params: { viewingProjectId: "older", viewingTeamId: "team" } });
  assert.equal(route.props.route.params.viewingProjectId, undefined);
  assert.equal(route.historyRequests[0].id, "older");
  route.historyRequests[0].next({ id: "older", title: "過去の閲覧先", videoIds: ["a"] }); route.render();
  assert.ok(walk(route.h.tree, node => node.type === "Text").some(node => textOf(node) === "過去の閲覧先"));
  const wrong = screenEnvironment("ProjectListScreen", { params: { viewingProjectId: "foreign", viewingTeamId: "other" } });
  assert.equal(wrong.props.route.params.viewingProjectId, undefined); assert.equal(wrong.navigationCalls.length, 0);
  assert.equal(wrong.historyRequests.length, 0);
});
test("tagging opens existing projects, chooses multiple destinations, and offers registration without auto-publishing", async () => {
  const unregistered = screenEnvironment("ProjectDetailScreen");
  await button(unregistered.h, "タグ付けした場面を見返す").onPress(); unregistered.render();
  assert.ok(walk(unregistered.h.tree, node => node.type === "ViewingModal").length);
  assert.equal(unregistered.writes.length, 0);
  const registered = screenEnvironment("ProjectDetailScreen", { registration: { status: "ready", byVideo: { a: [{ id: "old" }] } } });
  await button(registered.h, "タグ付けした場面を見返す").onPress();
  assert.deepEqual(plain(registered.navigationCalls[0]), ["ProjectList", { viewingProjectId: "old", viewingTeamId: "team" }]);
  const multiple = screenEnvironment("ProjectDetailScreen", { registration: { status: "ready", byVideo: { a: [{ id: "x" }, { id: "y" }] } } });
  await button(multiple.h, "タグ付けした場面を見返す").onPress(); multiple.render();
  assert.equal(walk(multiple.h.tree, node => node.type === "ViewingPicker")[0].props.projects.length, 2);
});
test("failed/unfinished checks and insufficient permissions never offer an unregistered-video write", () => {
  for (const name of ["ProjectListScreen", "ProjectDetailScreen"]) {
    for (const status of ["loading", "error"]) {
      const e = screenEnvironment(name, { registration: { status, byVideo: {}, retry: idle } });
      assert.equal(walk(e.h.tree, node => node.type === "ViewingModal").length, 0);
      assert.equal(walk(e.h.tree, node => node.type === "TouchableOpacity" && /^(タグ付けした場面を見返す|閲覧用プロジェクトに追加する)$/.test(textOf(node))).length, 0);
    }
    const member = screenEnvironment(name, { role: "member" });
    assert.equal(walk(member.h.tree, node => node.type === "TouchableOpacity" && /^(タグ付けした場面を見返す|閲覧用プロジェクトに追加する)$/.test(textOf(node))).length, 0);
  }
});
test("failed tag publication keeps private tags and exposes a retry instead of claiming success", async () => {
  const e = screenEnvironment("ProjectDetailScreen");
  button(e.h, "📢 自分のみのタグ(1件)を一括公開").onPress();
  const publish = e.alerts[0][2].find(item => item.text === "公開する").onPress();
  e.render(); assert.equal(e.writes.length, 1);
  e.writes[0].reject(new Error("offline")); await publish; e.render();
  assert.ok(button(e.h, "📢 自分のみのタグ(1件)を一括公開"));
  assert.equal(e.alerts.at(-1)[0], "公開エラー");
});

test("repeat additions do not write; source deletions and removed tags prevent new creation", async () => {
  const e = serviceEnvironment(); e.records.set("highlightProjects/h", { title: "a", videoIds: ["a"] });
  await e.service.addVideosToViewingProject("team", "h", ["a"], viewer);
  assert.equal(e.writes.length, 0);
  for (const tags of [[], [{ status: "private", uid: "other" }]]) {
    e.records.set("projects/a", video("a", { tags }));
    await assert.rejects(e.service.createVideoViewingProject("team", "a", ["a"], viewer), /動画/);
  }
  e.records.delete("projects/a");
  await assert.rejects(e.service.createVideoViewingProject("team", "a", ["a"], viewer), /動画/);
  assert.equal(e.writes.length, 0);
});

test("closing a dialog during a save cannot navigate from its late completion", async () => {
  const e = modalEnvironment("android");
  const pending = button(e.h, "追加して閲覧を開く").onPress();
  e.h.unmount(); e.requests[0].resolve({ id: "late" }); await pending;
  assert.equal(e.completed.length, 0);
});

test("tagging saves dirty clip durations before leaving and stays put after a failed duration save", async () => {
  const e = screenEnvironment("ProjectDetailScreen");
  const duration = walk(e.h.tree, node => node.type === "TextInput" && node.props.value === "5")[0];
  duration.props.onChangeText("8"); e.render();
  const attempt = button(e.h, "タグ付けした場面を見返す").onPress();
  assert.equal(e.writes[0].args[2].clipPreSeconds, 8);
  assert.equal(walk(e.h.tree, node => node.type === "ViewingModal").length, 0);
  e.writes[0].reject(new Error("offline")); await attempt; e.render();
  assert.equal(walk(e.h.tree, node => node.type === "ViewingModal").length, 0);
  const retry = button(e.h, "タグ付けした場面を見返す").onPress(); e.writes[1].resolve(); await retry; e.render();
  assert.ok(walk(e.h.tree, node => node.type === "ViewingModal").length);
});

test("viewing preserves UID ownership after a name change and hides another user's private scene", () => {
  const e = screenEnvironment("ProjectListScreen");
  e.props.projects = [video("a", { tags: [
    { id: "mine", videoTime: 10, label: "自分の場面", status: "private", uid: "self", user: "旧氏名" },
    { id: "other", videoTime: 20, label: "他人の場面", status: "private", uid: "other", user: "監督(監督)" },
  ] })]; e.render();
  button(e.h, "閲覧用プロジェクトに追加する").onPress(); e.render();
  walk(e.h.tree, node => node.type === "ViewingModal")[0].props.onCompleted({ id: "h", title: "閲覧", videoIds: ["a"] }); e.render();
  const strings = walk(e.h.tree, node => node.type === "Text").map(textOf);
  assert.ok(strings.some(value => value.includes("自分の場面")));
  assert.equal(strings.some(value => value.includes("他人の場面")), false);
});

test("leaving the tagging screen during duration save prevents late dialogs or navigation", async () => {
  const e = screenEnvironment("ProjectDetailScreen");
  walk(e.h.tree, node => node.type === "TextInput" && node.props.value === "5")[0].props.onChangeText("8"); e.render();
  const attempt = button(e.h, "タグ付けした場面を見返す").onPress();
  e.setFocused(false); e.writes[0].resolve(); await attempt; e.render();
  assert.equal(walk(e.h.tree, node => node.type === "ViewingModal").length, 0);
  assert.equal(e.navigationCalls.length, 0);
});
