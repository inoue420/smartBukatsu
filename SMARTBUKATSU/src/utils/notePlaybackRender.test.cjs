const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");

// Render the actual screen with state/effect boundaries, without native devices.
// Unlike isolated handler tests this catches effect -> state -> render loops.
function mountNote(os) {
  const slots = [], timers = new Map();
  let cursor = 0, dirty = true, effects = [], tree, renders = 0, timerId = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      if (!slots[i].set) slots[i].set = (value) => {
        const next = typeof value === "function" ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      };
      return [slots[i].value, slots[i].set];
    },
    useRef(value) { const i = cursor++; return slots[i] || (slots[i] = { current: value }); },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const previous = slots[i]; slots[i] = { deps };
        effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  const native = new Proxy({
    StyleSheet: { create: (v) => v, absoluteFillObject: {} }, Platform: { OS: os },
    useWindowDimensions: () => ({ width: 390, height: 844 }), Keyboard: { dismiss() {} },
    Alert: { alert() {} },
  }, { get: (target, name) => target[name] ?? name });
  const modules = {
    react: { __esModule: true, default: react, ...react }, "react-native": native,
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-av": { Video: "Video", ResizeMode: { CONTAIN: "contain" } },
    "react-native-youtube-iframe": { __esModule: true, default: "YoutubePlayer" },
    "expo-screen-orientation": { unlockAsync: async () => {}, lockAsync: async () => {}, OrientationLock: {} },
    "@react-navigation/native": { CommonActions: {} },
    "../AuthContext": { useAuth: () => ({ user: { uid: "member" }, activeTeamId: "team" }) },
    "../utils/recordedTagPermissions": require("./recordedTagPermissions"),
    "../utils/clipPlaybackTransition": require("./clipPlaybackTransition"),
    "../utils/tacticalNotes": require("./tacticalNotes"), "../services/firestoreService": {},
  };
  const source = fs.readFileSync(path.join(__dirname, "../screens/ProjectListScreen.js"), "utf8");
  const code = transformSync(source, { configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (name) => {
    assert.ok(modules[name], `Unexpected import: ${name}`); return modules[name];
  }, global: {}, console,
    setTimeout: () => ++timerId, clearTimeout() {},
    setInterval: (fn) => { const id = ++timerId; timers.set(id, fn); return id; },
    clearInterval: (id) => timers.delete(id),
  };
  vm.runInNewContext(code, context);
  const props = { navigation: {}, currentUser: "部員", currentUserUid: "member",
    userProfiles: { member: { uid: "member", role: "member" } },
    projects: [{ id: "video", videoUrl: "https://www.youtube.com/watch?v=abcdefghijk" }],
    notePlayback: { id: "note", title: "ノート", authorName: "投稿者", clips: [{ projectId: "video", tagId: "a", projectTitle: "試合", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", start: 10, end: 18, comment: "指導" }] },
  };
  const render = () => {
    let passes = 0;
    while (dirty) {
      assert.ok(++passes <= 12, "screen did not settle: repeated effect/state updates");
      dirty = false; cursor = 0; effects = []; renders++;
      tree = module.exports.default(props);
      effects.forEach((run) => run());
    }
  };
  const find = (predicate, node = tree) => {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const child of (Array.isArray(node) ? node : node.children || [])) {
      if (child == null) continue;
      const result = find(predicate, child); if (result) return result;
    }
    return null;
  };
  return { render, find, timers,
    editComment(value, saved = false) {
      props.noteHeader = { type: "TextInput", props: { value }, children: [] };
      if (saved) props.notePlayback = { ...props.notePlayback, description: value };
      dirty = true;
    },
    get renders() { return renders; } };
}

for (const os of ["ios", "android"]) {
  test(`${os}: note screen settles and YouTube clock advances to the saved end`, async () => {
    const screen = mountNote(os);
    screen.render();
    let time = 10;
    const video = screen.find((node) => node.type === "YoutubePlayer");
    assert.ok(video);
    let seeks = 0;
    const player = { seekTo() { seeks++; }, getCurrentTime: async () => time };
    video.props.ref.current = player;
    video.props.onReady();
    screen.render();
    for (const poll of [...screen.timers.values()]) await poll();
    screen.render();
    assert.equal(screen.find((node) => node.type === "YoutubePlayer").props.play, true);
    time = 13;
    for (const poll of [...screen.timers.values()]) await poll();
    screen.render();
    const clock = screen.find((node) => node.children?.includes("再生位置 "));
    assert.ok(clock?.children.includes("00:13"), "current time must be visible outside the player");
    assert.ok(clock.children.includes("00:10") && clock.children.includes("00:18"), "saved interval must be shown");
    const seeksBeforeEditing = seeks;
    for (const saved of [false, true]) {
      screen.editComment("再生中に入力・保存", saved);
      screen.render();
      const currentVideo = screen.find((node) => node.type === "YoutubePlayer");
      assert.equal(currentVideo.props.ref.current, player);
      assert.equal(currentVideo.props.play, true);
      assert.equal(seeks, seeksBeforeEditing, "comment changes must not restart playback");
    }
    time = 18;
    for (const poll of [...screen.timers.values()]) await poll();
    screen.render();
    assert.equal(screen.find((node) => node.type === "YoutubePlayer"), null);
    assert.ok(screen.find((node) => node.children?.includes("再生終了")));
    assert.ok(screen.renders < 20);
  });
}
