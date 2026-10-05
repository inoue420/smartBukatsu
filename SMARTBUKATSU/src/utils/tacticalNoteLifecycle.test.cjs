const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("@babel/core");

function hooksRuntime() {
  let current;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const owner = current, index = owner.cursor++;
      if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial;
      return [owner.slots[index], (change) => {
        const value = typeof change === "function" ? change(owner.slots[index]) : change;
        if (!Object.is(value, owner.slots[index])) { owner.slots[index] = value; owner.changed = true; }
      }];
    },
    useRef(initial) {
      const owner = current, index = owner.cursor++;
      if (!(index in owner.slots)) owner.slots[index] = { current: initial };
      return owner.slots[index];
    },
    useEffect(effect, dependencies) {
      const owner = current, index = owner.cursor++, previous = owner.slots[index];
      if (!previous || !dependencies || dependencies.some((value, item) => !Object.is(value, previous.dependencies[item]))) {
        owner.slots[index] = { dependencies, cleanup: previous?.cleanup };
        owner.effects.push(() => {
          previous?.cleanup?.();
          owner.slots[index].cleanup = effect();
        });
      }
    },
  };
  return { react, mount(component, props) {
    const owner = { cursor: 0, slots: [], effects: [], changed: true, tree: null };
    const render = () => {
      let rounds = 0;
      do {
        assert.ok(rounds++ < 30, "Hook render did not settle");
        owner.changed = false; owner.cursor = 0; owner.effects = [];
        const previous = current; current = owner;
        owner.tree = component(props); current = previous;
        owner.effects.forEach((effect) => effect());
      } while (owner.changed);
      return owner.tree;
    };
    return { props, render, get tree() { return owner.tree; }, async settle() {
      await new Promise(setImmediate); render();
    }, unmount() { owner.slots.forEach((slot) => slot?.cleanup?.()); } };
  } };
}

const walk = (node, predicate) => {
  if (!node || typeof node !== "object") return [];
  const found = !Array.isArray(node) && predicate(node) ? [node] : [];
  const children = Array.isArray(node) ? node : [...(node.children || []), node.props?.noteHeader];
  return found.concat(children.flatMap((child) => walk(child, predicate)));
};
const button = (harness, title) => {
  const node = walk(harness.tree, (item) => item.props.title === title)[0];
  assert.ok(node, `Button not found: ${title}`);
  return node.props;
};
const cards = (harness) => walk(harness.tree, (item) => item.type === "TouchableOpacity" && item.props.key).map((item) => item.props.key);
const textOf = (node) => node == null || typeof node === "boolean" ? "" : typeof node !== "object" ? String(node) :
  (Array.isArray(node) ? node : node.children || []).map(textOf).join("");
const texts = (harness) => walk(harness.tree, (item) => item.type === "Text").map(textOf);
const deferred = () => { let resolve; return { promise: new Promise((done) => { resolve = done; }), resolve: (value) => resolve(value) }; };
const time = (value) => ({ toMillis: () => value, toDate: () => new Date(value) });
function loadSource(relative, modules, timers = []) {
  const source = fs.readFileSync(path.join(__dirname, relative), "utf8");
  const code = babel.transformSync(source, { filename: relative, configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, setInterval: () => 1, clearInterval() {}, setTimeout(fn, ms) { const timer = {fn, ms}; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cancelled = true; }, require(name) {
    assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name];
  } });
  return module.exports;
}
const native = { View: "View", Text: "Text", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity", Image: "Image",
  ScrollView: "ScrollView", KeyboardAvoidingView: "KeyboardAvoidingView", Keyboard: { dismiss() {} },
  Platform: { OS: "ios" }, Alert: { alert() {} }, StyleSheet: { create: (value) => value } };
function screenHarness() {
  const runtime = hooksRuntime(), environment = { teamId: "team-a", focused: true };
  const listeners = [], preparation = [], pages = [], timers = [];
  const subscribe = (type, teamId, args, callback, onError) => {
    const listener = { type, teamId, args, callback, onError, stopped: false };
    listeners.push(listener); return () => { listener.stopped = true; };
  };
  const services = {
    ensureTacticalNoteSummaries(teamId) { const request = deferred(); preparation.push({ ...request, teamId }); return request.promise; },
    subscribeTacticalNoteSummaries: (team, filter, uid, cb, err) => subscribe("list", team, { filter, uid }, cb, err),
    subscribeTacticalNote: (team, id, cb, err) => subscribe("note", team, { id }, cb, err),
    subscribeTacticalNoteSummary: (team, id, cb, err) => subscribe("summary", team, { id }, cb, err),
    subscribeTacticalNoteActivity: (team, note, uid, cb, err) => subscribe("activity", team, { note, uid }, cb, err),
    getTacticalNoteSummaryPage: async (team, filter, uid, cursor) => {
      const next = pages.shift(); assert.ok(next, "No page fixture");
      next.request = { team, filter, uid, cursor }; return next.result;
    },
    saveTacticalNote() {}, deleteTacticalNote() {}, updateTacticalNoteDescription() {},
  };
  const component = loadSource("../screens/TacticalNotesScreen.js", {
    react: { __esModule: true, default: runtime.react, ...runtime.react }, "react-native": native,
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "@react-navigation/native": { useIsFocused: () => environment.focused, usePreventRemove() {} },
    "../AuthContext": { useAuth: () => ({ activeTeamId: environment.teamId }) },
    "../services/firestoreService": services, "../utils/tacticalNotes": require("./tacticalNotes"),
    "../components/TacticalClipPlayer": { __esModule: true, default: "Player" },
    "../components/TacticalNotePhaseTwo": { PhaseTwoSummary: "Summary", PhaseTwoEditor: "Editor", PhaseTwoDetail: "Detail" },
  }, timers).default;
  const harness = runtime.mount(component, { route: { key: "screen", params: {} }, navigation: { setParams() {}, goBack() {}, dispatch() {} },
    currentUserUid: "owner", currentUser: "Owner", userProfiles: { Owner: { uid: "owner", name: "Owner", role: "owner" } } });
  const active = (type) => listeners.filter((item) => !item.stopped && (!type || item.type === type));
  return { harness, environment, listeners, preparation, pages, timers, active, async ready() {
    harness.render(); preparation.at(-1).resolve({ ready: true, processed: 1 }); await harness.settle();
  } };
}

test("tactical list listens to compact summaries only and pauses all streams off focus", async () => {
  const screen = screenHarness(); await screen.ready();
  assert.deepEqual(screen.active().map((item) => item.type), ["list"]);
  screen.environment.focused = false; screen.harness.render(); assert.equal(screen.active().length, 0);
  screen.environment.focused = true; screen.harness.render();
  assert.deepEqual(screen.active().map((item) => item.type), ["list"]); assert.equal(screen.preparation.length, 1);
  screen.harness.unmount(); assert.equal(screen.active().length, 0);
});

test("selected note listens individually; task activity starts only when detail opens", async () => {
  const screen = screenHarness(); await screen.ready();
  const note = { id: "note", title: "Tactics", description: "Body", authorUid: "owner", assigneeUids: ["owner"],
    contentVersion: 1, updatedAt: time(5), createdAt: time(1), clips: [{ projectId: "video", tagId: "tag", start: 0, end: 5 }], tasks: {}, images: [] };
  screen.active("list")[0].callback({ items: [{ ...note, descriptionPreview: "Body", hasClips: true, imageCount: 0 }], cursor: null, hasMore: false });
  screen.harness.render();
  walk(screen.harness.tree, (item) => item.type === "TouchableOpacity" && item.props.key === "note")[0].props.onPress();
  screen.harness.render(); assert.deepEqual(screen.active().map((item) => item.type).sort(), ["note", "summary"]);
  screen.active("note")[0].callback(note);
  screen.active("summary")[0].callback({ id: "note", schemaVersion: 1, contentVersion: 1, noteUpdatedAt: note.updatedAt });
  screen.harness.render(); assert.equal(screen.active("activity").length, 0);
  const state = { clipKey: "clip", positionSeconds: 3, isPlaying: true };
  walk(screen.harness.tree, (item) => item.type === "Player")[0].props.onNotePlaybackStateChange(state);
  button(screen.harness, "確認・質問・タスクを開く").onPress(); screen.harness.render();
  assert.equal(screen.active("activity").length, 1);
  screen.active("activity")[0].callback({ responses: [], progress: [] }); screen.harness.render();
  button(screen.harness, "◁ 動画へ戻る").onPress(); screen.harness.render();
  assert.equal(screen.active("activity").length, 0);
  assert.equal(walk(screen.harness.tree, (item) => item.type === "Player")[0].props.notePlaybackState, state);
  screen.environment.focused = false; screen.harness.render(); assert.equal(screen.active().length, 0);
});

test("team switch ignores old preparation results and starts a fresh team index", async () => {
  const screen = screenHarness(); screen.harness.render(); assert.equal(screen.preparation[0].teamId, "team-a");
  screen.environment.teamId = "team-b"; screen.harness.render(); assert.equal(screen.preparation.length, 2);
  screen.preparation[0].resolve({ ready: true }); await screen.harness.settle(); assert.equal(screen.active().length, 0);
  screen.preparation[1].resolve({ ready: true }); await screen.harness.settle();
  assert.deepEqual(screen.active().map((item) => [item.type, item.teamId]), [["list", "team-b"]]);
});

test("moving the live page boundary invalidates older pages and restarts from the new cursor", async () => {
  const screen = screenHarness(); await screen.ready();
  const item = (number) => ({ id: `n${number}`, title: `Note ${number}`, createdAt: time(number), assigneeUids: [] });
  const latest = Array.from({ length: 30 }, (_, index) => item(60 - index));
  const oldCursor = { id: "n31" }, newCursor = { id: "n32" };
  screen.active("list")[0].callback({ items: latest, cursor: oldCursor, hasMore: true }); screen.harness.render();
  const older = { result: { items: Array.from({ length: 30 }, (_, index) => item(30 - index)), cursor: { id: "n1" }, hasMore: false } };
  screen.pages.push(older); await button(screen.harness, "以前のノートをもっと表示").onPress(); await screen.harness.settle();
  assert.equal(cards(screen.harness).length, 60); assert.equal(older.request.cursor, oldCursor);
  screen.active("list")[0].callback({ items: [item(61), ...latest.slice(0, 29)], cursor: newCursor, hasMore: true }); screen.harness.render();
  assert.equal(cards(screen.harness).length, 30);
  const restarted = { result: { items: [item(31), item(30)], cursor: { id: "n30" }, hasMore: false } };
  screen.pages.push(restarted); await button(screen.harness, "以前のノートをもっと表示").onPress(); await screen.harness.settle();
  assert.equal(restarted.request.cursor, newCursor); assert.ok(cards(screen.harness).includes("n31"));
});

function phaseHarness(services = {}, attachments = {}, picker = {}) {
  const runtime = hooksRuntime();
  const exports = loadSource("../components/TacticalNotePhaseTwo.js", {
    react: { __esModule: true, default: runtime.react, ...runtime.react }, "react-native": native,
    "expo-image-picker": picker, "../services/tacticalNoteAttachmentService": attachments,
    "../services/firestoreService": services, "../utils/tacticalNotes": require("./tacticalNotes"),
  });
  return { runtime, exports };
}

test("remote images in editor and detail mount only after explicit viewing; local selections preview immediately", () => {
  const { runtime, exports } = phaseHarness();
  const note = { id: "note", title: "Title", description: "", assigneeUids: [], clips: [], tasks: {}, images: [{ id: "remote", downloadUrl: "https://example.invalid/image.jpg" }] };
  const common = { onBusyChange() {}, onDirtyChange() {}, update() {}, members: [], names: () => "", uid: "owner" };
  for (const [component, props] of [[exports.PhaseTwoEditor, { ...common, draft: note }], [exports.PhaseTwoDetail, { ...common, note, teamId: "team" }]]) {
    const harness = runtime.mount(component, props); harness.render();
    const imageNode = walk(harness.tree, (item) => item.props.image?.id === "remote")[0];
    const imageHarness = runtime.mount(imageNode.type, imageNode.props); imageHarness.render();
    assert.equal(walk(imageHarness.tree, (item) => item.type === "Image").length, 0);
    button(imageHarness, "画像を見る").onPress(); imageHarness.render();
    assert.equal(walk(imageHarness.tree, (item) => item.type === "Image").length, 1);
    button(imageHarness, "画像を閉じる").onPress(); imageHarness.render();
    assert.equal(walk(imageHarness.tree, (item) => item.type === "Image").length, 0);
    const localHarness = runtime.mount(imageNode.type, { image: { id: "local", localUri: "file:///synthetic.jpg" } }); localHarness.render();
    assert.equal(walk(localHarness.tree, (item) => item.type === "Image").length, 1);
  }
});

test("preparing six selected images runs sequentially and does not update an unmounted editor", async () => {
  const pending = [], prepared = [];
  const { runtime, exports } = phaseHarness({}, { prepareTacticalNoteImage(asset) {
    const request = deferred(); pending.push(request); prepared.push(asset.id); return request.promise;
  } }, { launchImageLibraryAsync: async () => ({ canceled: false, assets: Array.from({ length: 6 }, (_, index) => ({ id: index })) }) });
  const changes = [];
  const harness = runtime.mount(exports.PhaseTwoEditor, { draft: { images: [], tasks: {}, clips: [] }, update: (value) => changes.push(value), members: [], onBusyChange() {} });
  harness.render(); const selection = button(harness, "画像を選ぶ").onPress(); await new Promise(setImmediate);
  assert.deepEqual(prepared, [0]);
  pending[0].resolve({ id: "image0", localUri: "file:///0.jpg" }); await new Promise(setImmediate); assert.deepEqual(prepared, [0, 1]);
  harness.unmount(); pending[1].resolve({ id: "image1", localUri: "file:///1.jpg" }); await selection;
  assert.deepEqual(prepared, [0, 1]); assert.deepEqual(changes, []);
});

test("questions and replies load on demand; a successful own resolution stays visible before the index catches up", async () => {
  const calls = [];
  const response = { id: "question", uid: "owner", version: 1, status: "question", text: "Help", createdAt: time(1), resolved: false };
  const { runtime, exports } = phaseHarness({
    getTacticalNoteQuestions: async (...args) => { calls.push(["questions", args]); return { items: [response], cursor: null, hasMore: false }; },
    getTacticalNoteReplies: async (...args) => { calls.push(["replies", args]); return { items: [
      { id: "new", uid: "owner", text: "Newest reply", createdAt: time(3) }, { id: "old", uid: "owner", text: "Older reply", createdAt: time(2) },
    ], cursor: null, hasMore: false }; },
    resolveTacticalNoteQuestion: async (...args) => { calls.push(["resolve", args]); },
  });
  const harness = runtime.mount(exports.PhaseTwoDetail, { teamId: "team", uid: "owner", names: (uids) => uids.join(","),
    note: { id: "note", contentVersion: 1, assigneeUids: ["owner"], tasks: {}, clips: [], images: [] },
    summaryIndex: { contentVersion: 1, assigneeUids: ["owner"], confirmedUids: ["owner"], questionUids: ["owner"] },
    onBusyChange() {}, onDirtyChange() {} });
  harness.render(); assert.deepEqual(calls, []);
  assert.ok(texts(harness).some((value) => value === "自分の状態：質問を送信済み"));
  await button(harness, "質問を表示").onPress(); await harness.settle(); assert.equal(calls.length, 1);
  await button(harness, "返信を表示").onPress(); await harness.settle();
  const rendered = texts(harness); assert.ok(rendered.indexOf("Older reply") < rendered.indexOf("Newest reply"));
  await button(harness, "この質問は解決しました").onPress(); await harness.settle();
  assert.equal(calls.at(-1)[0], "resolve"); assert.ok(texts(harness).includes("解決済み"));
  assert.equal(walk(harness.tree, (item) => item.props.title === "この質問は解決しました").length, 0);
  await button(harness, "質問を更新").onPress(); await harness.settle();
  assert.ok(texts(harness).includes("解決済み"), "An old query snapshot must not undo a successful local resolution");
});

test("history uses captured task text and exhausted streams are skipped on later pages", async () => {
  const calls = [], cursor = { id: "progress-page" };
  const { runtime, exports } = phaseHarness({ getTacticalNoteHistory: async (_team, _note, cursors) => {
    calls.push(cursors);
    return calls.length === 1 ? { responses: [], progressHistory: [
      { id: "saved", taskId: "task", taskRevision: 1, taskText: "Original task", uid: "owner", status: "done", updatedAt: time(2) },
      { id: "legacy", taskId: "task", taskRevision: 1, uid: "owner", status: "done", updatedAt: time(1) },
    ], responseCursor: null, progressCursor: cursor, hasMoreResponses: false, hasMoreProgress: true } :
      { responses: [], progressHistory: [], responseCursor: false, progressCursor: false, hasMoreResponses: false, hasMoreProgress: false };
  } });
  const harness = runtime.mount(exports.PhaseTwoDetail, { teamId: "team", uid: "owner", names: (uids) => uids.join(","),
    note: { id: "note", assigneeUids: [], clips: [], images: [], tasks: { task: { text: "CURRENT TASK", revision: 2, dueDate: "2026-10-03", assigneeUids: [] } } },
    onBusyChange() {}, onDirtyChange() {} });
  harness.render(); assert.equal(calls.length, 0);
  await button(harness, "履歴を表示").onPress(); await harness.settle();
  const labels = texts(harness).filter((value) => value.includes("（第1版）"));
  assert.ok(labels.some((value) => value.includes("Original task（第1版）")));
  assert.ok(labels.some((value) => value.includes("当時の実施内容は記録なし（第1版）")));
  assert.ok(labels.every((value) => !value.includes("CURRENT TASK")));
  await button(harness, "以前の履歴をもっと表示").onPress(); await harness.settle();
  assert.equal(calls[1].responseCursor, false); assert.equal(calls[1].progressCursor, cursor);
  assert.equal(walk(harness.tree, (item) => item.props.title === "以前の履歴をもっと表示").length, 0);
});


test("initial preparation continues automatically, waits for a busy lease and stops when off focus", async () => {
  const screen = screenHarness(); screen.harness.render();
  screen.preparation[0].resolve({ready: false, processed: 30}); await screen.harness.settle();
  const first = screen.timers.at(-1); assert.equal(first.ms, 250); first.fn(); screen.harness.render();
  assert.equal(screen.preparation.length, 2);
  screen.preparation[1].resolve({ready: false, busy: true, retryAfterMs: 1500}); await screen.harness.settle();
  const busy = screen.timers.at(-1); assert.equal(busy.ms, 1500);
  screen.environment.focused = false; screen.harness.render(); assert.equal(busy.cancelled, true);
  screen.environment.focused = true; screen.harness.render(); screen.timers.at(-1).fn(); screen.harness.render();
  screen.preparation[2].resolve({ready: true, processed: 31}); await screen.harness.settle();
  assert.equal(screen.active('list').length, 1); screen.harness.unmount();
});

const monthHeaders = (harness) => walk(harness.tree, (item) => item.type === "TouchableOpacity" && typeof item.props.accessibilityState?.expanded === "boolean");
const monthNote = (id, month, day = 1) => ({ id, title: id, assigneeUids: [], createdAt: time(new Date(2026, month - 1, day, 12).getTime()) });
test("note months match video defaults, preserve manual toggles through detail and reset on team switch", async () => {
  const screen = screenHarness(); await screen.ready();
  const items = [monthNote("oct", 10), monthNote("sep-old", 9, 1), monthNote("sep-new", 9, 30), {id: "unknown", title: "Unknown", assigneeUids: []}];
  const page = {items, cursor: null, hasMore: false};
  screen.active("list")[0].callback(page); screen.harness.render();
  let headers = monthHeaders(screen.harness);
  assert.deepEqual(headers.map((item) => item.props.accessibilityState.expanded), [true, false, false]);
  assert.deepEqual(cards(screen.harness), ["oct"]);
  assert.ok(textOf(headers[0]).includes("2026年10月"));
  assert.ok(textOf(headers[2]).includes("作成月不明"));
  assert.equal(headers[0].props.style.backgroundColor, "#fff");
  assert.equal(headers[0].props.style.paddingVertical, 10);
  headers[1].props.onPress(); screen.harness.render();
  assert.deepEqual(cards(screen.harness), ["oct", "sep-new", "sep-old"]);
  walk(screen.harness.tree, (item) => item.type === "TouchableOpacity" && item.props.key === "sep-new")[0].props.onPress();
  screen.harness.render(); button(screen.harness, "◁ 一覧へ戻る").onPress(); screen.harness.render();
  screen.active("list")[0].callback(page); screen.harness.render();
  assert.equal(monthHeaders(screen.harness)[1].props.accessibilityState.expanded, true);
  screen.environment.teamId = "team-b"; screen.harness.render();
  screen.preparation.at(-1).resolve({ready: true}); await screen.harness.settle();
  screen.active("list")[0].callback(page); screen.harness.render();
  assert.deepEqual(monthHeaders(screen.harness).map((item) => item.props.accessibilityState.expanded), [true, false, false]);
  screen.harness.unmount();
});
test("loading older note pages updates month counts without expanding past months; filters use their newest month", async () => {
  const screen = screenHarness(); await screen.ready();
  screen.active("list")[0].callback({items: [monthNote("oct", 10), monthNote("sep", 9, 30)], cursor: {id: "sep"}, hasMore: true});
  screen.harness.render();
  screen.pages.push({result: {items: [monthNote("sep-older", 9), monthNote("aug", 8)], cursor: null, hasMore: false}});
  await button(screen.harness, "以前のノートをもっと表示").onPress(); await screen.harness.settle();
  assert.deepEqual(monthHeaders(screen.harness).map((item) => item.props.accessibilityState.expanded), [true, false, false]);
  assert.ok(textOf(monthHeaders(screen.harness)[1]).includes("2件"));
  assert.deepEqual(cards(screen.harness), ["oct"]);
  monthHeaders(screen.harness)[1].props.onPress(); screen.harness.render();
  assert.deepEqual(cards(screen.harness), ["oct", "sep", "sep-older"]);
  button(screen.harness, "未確認").onPress(); screen.harness.render();
  assert.equal(screen.active("list")[0].args.filter, "unconfirmed");
  screen.active("list")[0].callback({items: [monthNote("aug", 8), monthNote("july", 7)], cursor: null, hasMore: false});
  screen.harness.render();
  assert.deepEqual(monthHeaders(screen.harness).map((item) => item.props.accessibilityState.expanded), [true, false]);
  assert.deepEqual(cards(screen.harness), ["aug"]);
  screen.harness.unmount();
});
