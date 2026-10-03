const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");
const screenSource = fs.readFileSync(path.join(__dirname, "../screens/ProjectListScreen.js"), "utf8");
const screenCode = transformSync(screenSource, { configFile: false, babelrc: false,
  plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;

// Render the actual screen with state/effect boundaries, without native devices.
// Unlike isolated handler tests this catches effect -> state -> render loops.
function mountNote(os, overrides = {}) {
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
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (name) => {
    assert.ok(modules[name], `Unexpected import: ${name}`); return modules[name];
  }, global: {}, console,
    setTimeout: () => ++timerId, clearTimeout() {},
    setInterval: (fn) => { const id = ++timerId; timers.set(id, fn); return id; },
    clearInterval: (id) => timers.delete(id),
  };
  vm.runInNewContext(screenCode, context);
  const props = { navigation: {}, currentUser: "部員", currentUserUid: "member",
    userProfiles: { member: { uid: "member", role: "member" } },
    projects: [{ id: "video", videoUrl: "https://www.youtube.com/watch?v=abcdefghijk" }],
    notePlayback: { id: "note", title: "ノート", authorName: "投稿者", clips: [{ projectId: "video", tagId: "a", projectTitle: "試合", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", start: 10, end: 18, comment: "指導" }] },
    ...overrides,
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
  return { render, find, timers, props,
    updateProps(changes) { Object.assign(props, changes); dirty = true; },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
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
    assert.equal(clock, null, "note playback must leave the time display space for comments and actions");
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

const flush = () => new Promise(setImmediate);
const { noteClipKey } = require("./tacticalNotes");
function playbackFixture(kind) {
  const url = kind === "youtube" ? "https://www.youtube.com/watch?v=abcdefghijk" : "https://example.com/video.mp4";
  const clips = ["a", "b"].map((tagId, index) => ({ projectId: "video", tagId, projectTitle: "試合",
    sourceUrl: url, start: 10 + index * 20, end: 18 + index * 20, comment: "指導" }));
  return { projects: [{ id: "video", videoUrl: url }], notePlayback: { id: "note", title: "ノート", authorName: "投稿者", clips } };
}
async function poll(screen) {
  for (const callback of [...screen.timers.values()]) await callback();
  await flush(); screen.render();
}
async function connectPlayer(screen, kind) {
  const control = { position: 0, seeks: [], plays: 0 };
  const video = screen.find((node) => node.type === (kind === "youtube" ? "YoutubePlayer" : "Video"));
  assert.ok(video);
  video.props.ref.current = kind === "youtube" ? {
    seekTo(seconds) { control.seeks.push(seconds); control.position = seconds; },
    getCurrentTime: async () => control.position,
  } : {
    getStatusAsync: async () => ({ isLoaded: true, positionMillis: control.position * 1000 }),
    setStatusAsync: async (status) => {
      if (status.positionMillis !== undefined) { control.position = status.positionMillis / 1000; control.seeks.push(control.position); }
      return { isLoaded: true, positionMillis: control.position * 1000, isPlaying: status.shouldPlay === true };
    },
    playAsync: async () => { control.plays++; return { isLoaded: true, positionMillis: control.position * 1000, isPlaying: true }; },
  };
  if (kind === "youtube") video.props.onReady(); else video.props.onLoad();
  screen.render(); await poll(screen);
  return control;
}
async function sample(screen, kind, control, seconds, playing) {
  control.position = seconds;
  if (kind === "native") {
    screen.find((node) => node.type === "Video").props.onPlaybackStatusUpdate({ isLoaded: true, positionMillis: seconds * 1000, isPlaying: playing });
    await flush(); screen.render();
  } else {
    await poll(screen);
    if (!playing) { screen.find((node) => node.type === "YoutubePlayer").props.onChangeState("paused"); screen.render(); }
  }
}

for (const os of ["ios", "android"]) {
  for (const kind of ["youtube", "native"]) {
    for (const playing of [true, false]) {
      test(`${os} ${kind}: detail round trip restores the second scene, precise position, mode and ${playing ? "playing" : "paused"} state`, async () => {
        const fixture = playbackFixture(kind), snapshots = [];
        const original = mountNote(os, { ...fixture, onNotePlaybackStateChange: (state) => snapshots.push(state) });
        original.render(); const firstPlayer = await connectPlayer(original, kind);
        original.find((node) => node.type === "TouchableOpacity" && node.props.key === "video_1:b").props.onPress();
        original.render(); await poll(original);
        await sample(original, kind, firstPlayer, 31.25, playing);
        original.find((node) => node.props.accessibilityLabel === "再生モード：最後で終了").props.onPress();
        original.render();
        const saved = snapshots.at(-1);
        assert.equal(saved.clipKey, noteClipKey(fixture.notePlayback.clips[1]));
        assert.equal(saved.positionSeconds, 31.25); assert.equal(saved.isPlaying, playing);
        assert.equal(saved.playbackMode, "single"); assert.equal(saved.finished, false);
        original.unmount();
        const restoredSnapshots = [];
        const restored = mountNote(os, { ...fixture, notePlaybackState: saved, onNotePlaybackStateChange: (state) => restoredSnapshots.push(state) });
        restored.render();
        const beforeReady = restored.find((node) => node.type === (kind === "youtube" ? "YoutubePlayer" : "Video"));
        assert.equal(kind === "youtube" ? beforeReady.props.play : beforeReady.props.shouldPlay, false, "restoring must seek before playback");
        const player = await connectPlayer(restored, kind);
        assert.deepEqual(player.seeks, [31.25], "return must not seek the first scene or the second scene's beginning");
        const current = restoredSnapshots.at(-1);
        assert.equal(current.clipKey, saved.clipKey); assert.equal(current.positionSeconds, 31.25);
        assert.equal(current.isPlaying, playing); assert.equal(current.playbackMode, "single");
        if (kind === "native") assert.equal(player.plays, playing ? 1 : 0, "paused restoration must not issue playAsync");
        restored.updateProps({ onNotePlaybackStateChange: (state) => restoredSnapshots.push(state), notePlaybackState: { ...saved, positionSeconds: 10 } });
        restored.render(); await poll(restored);
        assert.deepEqual(player.seeks, [31.25], "callback changes and updated cache props must not trigger another seek");
        assert.ok(restored.renders < 12);
      });
    }

    test(`${os} ${kind}: reordered scenes restore by identity and finish at the original interval end`, async () => {
      const fixture = playbackFixture(kind), second = fixture.notePlayback.clips[1], snapshots = [];
      const saved = { clipKey: noteClipKey(second), sourceUrl: second.sourceUrl, start: 30, end: 38,
        positionSeconds: 35.5, isPlaying: true, playbackMode: "stop", finished: false };
      const screen = mountNote(os, { ...fixture, notePlayback: { ...fixture.notePlayback, clips: [...fixture.notePlayback.clips].reverse() },
        notePlaybackState: saved, onNotePlaybackStateChange: (state) => snapshots.push(state) });
      screen.render(); const control = await connectPlayer(screen, kind);
      assert.deepEqual(control.seeks, [35.5]); assert.equal(snapshots.at(-1).clipKey, saved.clipKey);
      // The second scene now appears first, so its interval end advances to scene a.
      await sample(screen, kind, control, 38, true); await poll(screen);
      assert.equal(snapshots.at(-1).clipKey, noteClipKey(fixture.notePlayback.clips[0]));
      assert.equal(control.seeks.at(-1), 10);
    });

    test(`${os} ${kind}: finished state stays finished on return and explicit selection starts at the scene beginning`, async () => {
      const fixture = playbackFixture(kind), second = fixture.notePlayback.clips[1], snapshots = [];
      const screen = mountNote(os, { ...fixture, notePlaybackState: { clipKey: noteClipKey(second), sourceUrl: second.sourceUrl,
        start: 30, end: 38, positionSeconds: 38, isPlaying: false, playbackMode: "stop", finished: true },
        onNotePlaybackStateChange: (state) => snapshots.push(state) });
      screen.render();
      assert.equal(screen.find((node) => ["YoutubePlayer", "Video"].includes(node.type)), null);
      assert.ok(screen.find((node) => node.children?.includes("再生終了")));
      assert.equal(snapshots.at(-1).finished, true); assert.equal(snapshots.at(-1).positionSeconds, 38);
      screen.find((node) => node.type === "TouchableOpacity" && node.props.key === "video_1:b").props.onPress();
      screen.render(); const control = await connectPlayer(screen, kind);
      assert.deepEqual(control.seeks, [30]); assert.equal(snapshots.at(-1).finished, false);
      assert.equal(snapshots.at(-1).isPlaying, true);
      await sample(screen, kind, control, 38, true);
      assert.equal(snapshots.at(-1).finished, true);
    });

    for (const scenario of ["out-of-range", "changed-interval", "changed-source", "removed-scene", "missing-video"]) {
      test(`${os} ${kind}: ${scenario} restoration falls back safely without autoplay`, async () => {
        const fixture = playbackFixture(kind), second = fixture.notePlayback.clips[1], snapshots = [];
        const saved = { clipKey: noteClipKey(second), sourceUrl: second.sourceUrl, start: 30, end: 38,
          positionSeconds: 31.25, isPlaying: true, playbackMode: "stop", finished: false };
        let expected = 30;
        if (scenario === "out-of-range") saved.positionSeconds = 80;
        if (scenario === "changed-interval") { second.start = 40; second.end = 48; expected = 40; }
        if (scenario === "changed-source") {
          second.sourceUrl = kind === "youtube" ? "https://www.youtube.com/watch?v=lmnopqrstuv" : "https://example.com/changed.mp4";
          fixture.projects[0].videoUrl = second.sourceUrl;
        }
        if (scenario === "removed-scene") { fixture.notePlayback.clips = [fixture.notePlayback.clips[0]]; expected = 10; }
        if (scenario === "missing-video") fixture.projects = [];
        const screen = mountNote(os, { ...fixture, notePlaybackState: saved, onNotePlaybackStateChange: (state) => snapshots.push(state) });
        screen.render();
        if (scenario === "missing-video") assert.equal(screen.find((node) => ["YoutubePlayer", "Video"].includes(node.type)), null);
        else { const control = await connectPlayer(screen, kind); assert.deepEqual(control.seeks, [expected]); assert.equal(control.plays, 0); }
        assert.equal(snapshots.at(-1).positionSeconds, expected);
        assert.equal(snapshots.at(-1).isPlaying, false); assert.equal(snapshots.at(-1).finished, false);
      });
    }
  }
}
