const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");
const screenSource = fs.readFileSync(path.join(__dirname, "../screens/ProjectListScreen.js"), "utf8");
const screenCode = transformSync(screenSource, { configFile: false, babelrc: false,
  plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
const rateCode = transformSync(fs.readFileSync(path.join(__dirname, "../hooks/useVideoPlaybackRate.js"), "utf8"), {
  configFile: false, babelrc: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
}).code;
const youtubePackage = path.dirname(require.resolve("react-native-youtube-iframe/package.json"));
const youtubeCode = transformSync(fs.readFileSync(path.join(youtubePackage, "src/YoutubeIframe.js"), "utf8"), {
  configFile: false, babelrc: false,
  plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"],
}).code;
const deployedIframeHtml = fs.readFileSync(path.join(__dirname, "fixtures/youtube-iframe-v2-20261118.html"), "utf8");

// Render the installed player's real wrapper as well as the app screen. A
// bounded outer frame alone does not prove the nested native WebView fits it.
function renderYoutubeLibrary(props, os, nativeBridge = null) {
  const effects = [], playerRef = { current: null };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: (value) => ({ current: value }), useState: (value) => [nativeBridge ? true : value, () => {}],
    useMemo: (fn) => fn(), useCallback: (fn) => fn,
    useEffect(fn) { if (nativeBridge) effects.push(fn); },
    useImperativeHandle(ref, factory) { ref.current = factory(); }, forwardRef: (fn) => fn,
  };
  const modules = {
    react: { __esModule: true, default: react, ...react }, events: require("node:events"),
    "react-native": { View: "View", StyleSheet: { create: (value) => value }, Platform: { OS: os }, Linking: {} },
    "./WebView": { WebView: "WebView" },
    "./constants": require(path.join(youtubePackage, "lib/commonjs/constants.js")),
    "./PlayerScripts": require(path.join(youtubePackage, "lib/commonjs/PlayerScripts.js")),
    "./utils": require(path.join(youtubePackage, "lib/commonjs/utils.js")),
  };
  const module = { exports: {} };
  vm.runInNewContext(youtubeCode, { module, exports: module.exports, require: (name) => {
    assert.ok(modules[name], `Unexpected player import: ${name}`); return modules[name];
  } });
  const tree = module.exports.default(props, playerRef);
  if (nativeBridge) {
    const webView = tree.children[0];
    nativeBridge.connect(webView.props);
    webView.props.ref.current = nativeBridge;
    effects.forEach((run) => run());
  }
  tree.playerRef = playerRef;
  return tree;
}

function iframeBridge(os, receiver = "deployed") {
  const listeners = { window: [], document: [] }, commands = [], calls = [], actions = [], errors = [];
  const listen = (target) => (type, callback, capture = false) => {
    if (type === "message") listeners[target].push({ callback, capture: capture === true || capture?.capture === true });
  };
  const { htmlString, urlEncodedJSON } = require(path.join(youtubePackage, "lib/commonjs/PlayerScripts.js")).MAIN_SCRIPT("abcdefghijk", undefined, {}, false, 1);
  const { DEFAULT_BASE_URL } = require(path.join(youtubePackage, "lib/commonjs/constants.js"));
  let webViewProps, rate = 1;
  const frame = { URL, location: { href: `${DEFAULT_BASE_URL}?data=${urlEncodedJSON}` },
    console: { error: (...args) => errors.push(args) }, document: {
    createElement: () => ({}), getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
    getElementById: () => ({}), querySelector: () => ({ setAttribute() {} }),
    addEventListener: listen("document"),
  }, addEventListener: listen("window"),
    ReactNativeWebView: { postMessage: (data) => queueMicrotask(() => webViewProps?.onMessage({ nativeEvent: { data } })) },
    YT: { Player: function (_id, options) { return {
      playVideo() { actions.push("playVideo"); }, pauseVideo() { actions.push("pauseVideo"); },
      mute() { actions.push("mute"); }, unMute() { actions.push("unMute"); },
      getPlaybackRate: () => rate, getAvailablePlaybackRates: () => [0.25, 0.5, 0.75, 1],
      setPlaybackRate(value) { calls.push(value); if (rate !== value) { rate = value; options.events.onPlaybackRateChange({ data: value }); } },
    }; } },
  };
  frame.window = frame;
  vm.createContext(frame);
  const html = receiver === "deployed" ? deployedIframeHtml : htmlString;
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], frame);
  frame.onYouTubeIframeAPIReady();
  const dispatch = (data) => {
    const event = { data, stopped: false, stopImmediatePropagation() { this.stopped = true; } };
    const deliver = (target) => {
      event.stopped = false;
      // At the event target, capture listeners precede non-capture listeners,
      // even when the extension was injected after the page registered its own.
      for (const capture of [true, false]) for (const listener of listeners[target]) {
        if (listener.capture === capture && !event.stopped) listener.callback(event);
      }
    };
    if (os === "android") deliver("document");
    deliver("window");
  };
  return { calls, actions, commands, errors, dispatch, get rate() { return rate; },
    connect(props) {
      webViewProps = props;
      if (props.injectedJavaScriptBeforeContentLoaded) vm.runInContext(props.injectedJavaScriptBeforeContentLoaded, frame);
      if (props.injectedJavaScript) vm.runInContext(props.injectedJavaScript, frame);
    },
    postMessage(data) { commands.push(JSON.parse(data)); dispatch(data); },
    injectJavaScript(code) { queueMicrotask(() => vm.runInContext(code, frame)); },
  };
}

// Render the actual screen with state/effect boundaries, without native devices.
// Unlike isolated handler tests this catches effect -> state -> render loops.
function mountNote(os, overrides = {}) {
  const slots = [], timers = new Map(), timeouts = new Map();
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
    useWindowDimensions: () => overrides.windowDimensions?.() || ({ width: 390, height: 844 }), Keyboard: { dismiss() {} },
    Alert: { alert() {} },
  }, { get: (target, name) => target[name] ?? name });
  const modules = {
    react: { __esModule: true, default: react, ...react }, "react-native": native,
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
    "expo-av": { Video: "Video", ResizeMode: { CONTAIN: "contain" } },
    "expo-clipboard": { getStringAsync: async () => "" },
    "react-native-youtube-iframe": { __esModule: true, default: "YoutubePlayer" },
    "expo-screen-orientation": { unlockAsync: async () => {}, lockAsync: async () => {}, OrientationLock: {}, ...overrides.orientationModule },
    "@react-navigation/native": { CommonActions: {}, useIsFocused: () => true },
    "../services/historyDataService": { subscribeHistoryDocument: overrides.highlightLoader || ((_team, _name, _id, next) => { next(null); return () => {}; }), subscribeProjectsByIds: overrides.referenceLoader || ((_team, _ids, next) => { next([]); return () => {}; }) },
    "../components/HistoryLoadingControls": { __esModule: true, default: "HistoryLoadingControls" },
    "../components/GuideHelpLink": { __esModule: true, default: "GuideHelpLink" },
    "../components/VideoViewingRegistrationModal": { __esModule: true, default: "ViewingModal", ViewingProjectPicker: "ViewingPicker" },
    "../utils/videoViewingGuidance": require("./videoViewingGuidance"),
    "../hooks/useVideoViewingRegistration": { useVideoViewingRegistration: (_team, _ids, enabled) => {
      assert.equal(enabled, overrides.registrationEnabled === true, "registration checks must match the viewing mode");
      return { status: "loading", byVideo: {}, retry() {} };
    } },
    "../AuthContext": { useAuth: () => ({ user: { uid: "member" }, activeTeamId: "team" }) },
    "../utils/recordedTagPermissions": require("./recordedTagPermissions"),
    "../utils/clipPlaybackTransition": require("./clipPlaybackTransition"),
    "../utils/youtubePlaybackRateBridge": require("./youtubePlaybackRateBridge"),
    "../utils/tacticalNotes": require("./tacticalNotes"), "../services/firestoreService": {},
  };
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: (name) => {
    assert.ok(modules[name], `Unexpected import: ${name}`); return modules[name];
  }, global: {}, console,
    setTimeout: (fn, delay) => { const id = ++timerId; timeouts.set(id, { fn, delay }); return id; }, clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn) => { const id = ++timerId; timers.set(id, fn); return id; },
    clearInterval: (id) => timers.delete(id),
  };
  const rateModule = { exports: {} };
  vm.runInNewContext(rateCode, { ...context, module: rateModule, exports: rateModule.exports });
  modules["../hooks/useVideoPlaybackRate"] = rateModule.exports;
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
  return { render, find, timers, timeouts, props,
    updateProps(changes) { Object.assign(props, changes); dirty = true; },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
    editComment(value, saved = false) {
      props.noteHeader = { type: "TextInput", props: { value }, children: [] };
      if (saved) props.notePlayback = { ...props.notePlayback, description: value };
      dirty = true;
    },
    get renders() { return renders; } };
}

for (const os of ["android", "ios"]) {
  test(`${os}: an older playlist stays selected while loading and yields to newer live page data`, () => {
    let receive;
    const screen = mountNote(os, { notePlayback: null, highlightProjects: [], route: { params: { notePicker: { sourceId: "older", teamId: "team" } } },
      highlightLoader: (_team, _name, _id, next) => { receive = next; return () => {}; } });
    screen.render(); receive({ id: "older", title: "Older playlist", videoIds: ["video"] }); screen.render();
    assert.ok(screen.find((node) => node.children?.includes("Older playlist")));
    screen.updateProps({ highlightProjects: [{ id: "older", title: "Updated playlist", videoIds: ["video"] }] }); screen.render();
    assert.ok(screen.find((node) => node.children?.includes("Updated playlist")));
    const pickerBack = screen.find((node) => node.type === "TouchableOpacity" &&
      screen.find((child) => child.type === "Text" && child.children.join("") === "一覧へ", node));
    assert.ok(pickerBack, "the note attachment picker has no viewing tab and must keep its list navigation");
    pickerBack.props.onPress(); screen.render();
    assert.ok(screen.find((node) => node.type === "Text" && node.children.join("") === "プロジェクト一覧"));
    screen.unmount();
  });
  test(`${os}: a lazily fetched older source does not overwrite the saved note position while loading`, () => {
    const fixture = playbackFixture("youtube"), second = fixture.notePlayback.clips[1], snapshots = [];
    let receive;
    const saved = { clipKey: noteClipKey(second), sourceUrl: second.sourceUrl, start: second.start, end: second.end,
      positionSeconds: 31.25, isPlaying: false, playbackMode: "stop", finished: false };
    const screen = mountNote(os, { ...fixture, projects: [], notePlaybackState: saved, onNotePlaybackStateChange: (state) => snapshots.push(state), referenceLoader: (_team, _ids, next) => { receive = next; return () => {}; } });
    screen.render(); assert.equal(snapshots.length, 0); assert.equal(screen.find((node) => node.type === "YoutubePlayer"), null);
    receive(fixture.projects); screen.render(); assert.equal(snapshots.at(-1).positionSeconds, 31.25); assert.equal(snapshots.at(-1).clipKey, saved.clipKey);
  });
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
async function connectPlayer(screen, kind, config = {}) {
  const control = { position: 0, seeks: [], plays: 0, rate: 1, rates: [0.25, 0.5, 0.75, 1], rateCalls: [], ...config };
  const video = screen.find((node) => node.type === (kind === "youtube" ? "YoutubePlayer" : "Video"));
  assert.ok(video);
  video.props.ref.current = kind === "youtube" ? {
    seekTo(seconds) { control.seeks.push(seconds); control.position = seconds; },
    getCurrentTime: async () => control.position,
    getAvailablePlaybackRates: config.getAvailablePlaybackRates || (async () => control.rates),
    getPlaybackRate: async () => control.rate,
  } : {
    getStatusAsync: async () => ({ isLoaded: true, positionMillis: control.position * 1000, rate: control.rate }),
    setRateAsync: async (rate, correctPitch) => {
      control.rateCalls.push([rate, correctPitch]);
      if (control.rateFailure && rate !== 1) throw new Error("Rate not supported");
      control.rate = rate;
      return { isLoaded: true, rate };
    },
    setStatusAsync: async (status) => {
      if (status.positionMillis !== undefined) { control.position = status.positionMillis / 1000; control.seeks.push(control.position); }
      return { isLoaded: true, positionMillis: control.position * 1000, isPlaying: status.shouldPlay === true, rate: control.rate };
    },
    playAsync: async () => { control.plays++; return { isLoaded: true, positionMillis: control.position * 1000, isPlaying: true }; },
  };
  if (kind === "youtube") video.props.onReady(); else video.props.onLoad();
  screen.render(); await poll(screen);
  return control;
}

async function fireRateTimeout(screen, delay) {
  const entry = [...screen.timeouts.entries()].find(([, item]) => item.delay === delay);
  assert.ok(entry, `Missing ${delay}ms rate timeout`);
  screen.timeouts.delete(entry[0]); entry[1].fn(); await flush(); screen.render();
}

test("YouTube: unsupported speeds are hidden and preferences survive changing sources and player types", async () => {
  const fixture = playbackFixture("youtube");
  const second = fixture.notePlayback.clips[1];
  Object.assign(second, { projectId: "second", sourceUrl: "https://youtu.be/lmnopqrstuv" });
  fixture.projects.push({ id: "second", videoUrl: second.sourceUrl });
  const screen = mountNote("android", fixture); screen.render();
  const original = await connectPlayer(screen, "youtube");
  await chooseSpeed(screen, "youtube", original, 0.5);
  screen.find((node) => node.type === "YoutubePlayer").props.ref.current = null;
  screen.find((node) => node.type === "TouchableOpacity" && node.props.key === "second_1:b").props.onPress(); screen.render();
  await connectPlayer(screen, "youtube", { rates: [1] });
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：1×");
  speedButton(screen).props.onPress(); screen.render();
  assert.ok(screen.find((node) => node.props?.accessibilityLabel === "再生速度 1倍"));
  assert.equal(screen.find((node) => node.props?.accessibilityLabel === "再生速度 0.5倍"), null);
  // Switch to an MP4 source: apply the original preference, not the fallback 1×.
  second.sourceUrl = "https://example.com/second.mp4";
  fixture.projects[1].videoUrl = second.sourceUrl;
  screen.updateProps({ projects: [...fixture.projects], notePlayback: { ...fixture.notePlayback, clips: [...fixture.notePlayback.clips] } });
  screen.render();
  const mp4 = await connectPlayer(screen, "native");
  assert.deepEqual(mp4.rateCalls, [[0.5, true]]);
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
  screen.find((node) => node.type === "Video").props.ref.current = null;
  screen.find((node) => node.type === "TouchableOpacity" && node.props.key === "video_0:a").props.onPress(); screen.render();
  const returned = await connectPlayer(screen, "youtube");
  const video = screen.find((node) => node.type === "YoutubePlayer");
  assert.equal(video.props.playbackRate, 0.5);
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：1×", "do not claim a rate before confirmation");
  returned.rate = 0.5; video.props.onPlaybackRateChange(0.5); screen.render();
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
  screen.unmount();
});

test("YouTube: an ignored speed request reads back the actual rate, reports failure and permits retry", async () => {
  const screen = mountNote("ios", playbackFixture("youtube")); screen.render();
  const control = await connectPlayer(screen, "youtube");
  speedButton(screen).props.onPress(); screen.render();
  screen.find((node) => node.props?.accessibilityLabel === "再生速度 0.5倍").props.onPress(); screen.render();
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：1×");
  assert.equal(speedButton(screen).props.disabled, true);
  await fireRateTimeout(screen, 2000);
  assert.equal(speedButton(screen).props.disabled, false);
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：1×");
  assert.equal(screen.find((node) => node.type === "YoutubePlayer").props.playbackRate, 1);
  assert.ok(screen.find((node) => node.children?.includes("この速度へ変更できませんでした。")));
  await chooseSpeed(screen, "youtube", control, 0.5);
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
  screen.unmount(); assert.equal(screen.timeouts.size, 0);
});

test("native: rejected speed changes show the confirmed rate and preserve playback", async () => {
  const screen = mountNote("android", playbackFixture("native")); screen.render();
  const control = await connectPlayer(screen, "native", { rateFailure: true });
  await chooseSpeed(screen, "native", control, 0.5);
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：1×");
  assert.ok(screen.find((node) => node.children?.includes("この速度へ変更できませんでした。")));
  assert.equal(screen.find((node) => node.type === "Video").props.shouldPlay, true);
  assert.deepEqual(control.seeks, [10]); screen.unmount();
});

test("YouTube: a missing rate API response times out safely without blocking playback", async () => {
  const screen = mountNote("ios", playbackFixture("youtube")); screen.render();
  await connectPlayer(screen, "youtube", { getAvailablePlaybackRates: () => new Promise(() => {}) });
  assert.equal(speedButton(screen).props.disabled, true);
  await fireRateTimeout(screen, 5000);
  assert.ok(screen.find((node) => node.children?.includes("再生速度を取得できません。動画を選び直してください。")));
  assert.equal(screen.find((node) => node.type === "YoutubePlayer").props.play, true);
  screen.unmount(); assert.equal(screen.timeouts.size, 0);
});

test("YouTube: delayed rates and callbacks from an old player cannot overwrite a new source", async () => {
  let resolve;
  const delayed = new Promise((done) => { resolve = done; });
  const fixture = playbackFixture("youtube");
  fixture.notePlayback.clips[1] = { ...fixture.notePlayback.clips[1], projectId: "second", sourceUrl: "https://youtu.be/lmnopqrstuv" };
  fixture.projects.push({ id: "second", videoUrl: "https://youtu.be/lmnopqrstuv" });
  const screen = mountNote("android", fixture); screen.render();
  await connectPlayer(screen, "youtube", { getAvailablePlaybackRates: () => delayed });
  const old = screen.find((node) => node.type === "YoutubePlayer"); old.props.ref.current = null;
  screen.find((node) => node.type === "TouchableOpacity" && node.props.key === "second_1:b").props.onPress(); screen.render();
  await connectPlayer(screen, "youtube", { rates: [1] });
  resolve([0.25, 0.5, 0.75, 1]); old.props.onPlaybackRateChange(0.25); await flush(); screen.render();
  assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：1×");
  speedButton(screen).props.onPress(); screen.render();
  assert.equal(screen.find((node) => node.props?.accessibilityLabel === "再生速度 0.25倍"), null);
  screen.unmount();
});

const speedButton = (screen) => screen.find((node) => node.props?.accessibilityLabel?.startsWith("再生速度："));
const byTestId = (screen, id) => screen.find((node) => node.props?.testID === id);
const flattenStyle = (value) => Object.assign({}, ...(Array.isArray(value) ? value : [value]).flat(Infinity).filter(Boolean));
function measurePlayer(screen, width, height) {
  byTestId(screen, "video-player-area").props.onLayout({ nativeEvent: { layout: { width, height } } });
  screen.render();
}
function viewingPlaybackFixture(kind) {
  const fixture = playbackFixture(kind);
  return { ...fixture, notePlayback: null, registrationEnabled: true,
    navigation: { setParams() {} }, route: { params: { viewingProjectId: "view", viewingTeamId: "team" } },
    projects: [{ ...fixture.projects[0], title: "試合", tags: [
      { id: "a", label: "得点", videoTime: 15, preSeconds: 5, postSeconds: 3, status: "shared" },
      { id: "b", label: "得点", videoTime: 35, preSeconds: 5, postSeconds: 3, status: "shared" },
    ] }], highlightProjects: [{ id: "view", title: "閲覧用", videoIds: ["video"] }],
  };
}
async function chooseSpeed(screen, kind, control, rate) {
  speedButton(screen).props.onPress(); screen.render();
  const option = screen.find((node) => node.props?.accessibilityLabel === `再生速度 ${rate}倍`);
  assert.ok(option); assert.equal(option.props.disabled, false);
  option.props.onPress(); screen.render();
  if (kind === "youtube") {
    const video = screen.find((node) => node.type === "YoutubePlayer");
    assert.equal(video.props.playbackRate, rate);
    control.rate = rate; video.props.onPlaybackRateChange(rate);
  }
  await flush(); screen.render();
}

for (const os of ["ios", "android"]) {
  for (const receiver of ["deployed", "local"]) {
    test(`${os} ${receiver}: player commands reach the iframe exactly once alongside speed changes`, async () => {
      const { YOUTUBE_PLAYBACK_RATE_BRIDGE } = require("./youtubePlaybackRateBridge");
      const iframe = iframeBridge(os, receiver);
      const props = { videoId: "abcdefghijk", play: true, mute: true, playbackRate: 0.5,
        useLocalHTML: receiver === "local", webViewProps: {
          injectedJavaScriptBeforeContentLoaded: YOUTUBE_PLAYBACK_RATE_BRIDGE,
          injectedJavaScript: YOUTUBE_PLAYBACK_RATE_BRIDGE,
        } };
      const playing = renderYoutubeLibrary(props, os, iframe);
      const source = playing.children[0].props.source;
      if (receiver === "deployed") {
        assert.equal(new URL(source.uri).pathname, "/react-native-youtube-iframe/iframe_v2.html");
      } else assert.ok(source.html.includes("switch (parsedData.eventName)"));
      await flush();
      assert.deepEqual(iframe.actions, ["playVideo", "mute"]);
      assert.equal(iframe.rate, 0.5);
      assert.ok(iframe.commands.some((command) => command.eventName === "playVideo"), "use the installed library's actual JSON command");
      renderYoutubeLibrary({ ...props, play: false, mute: false, playbackRate: 0.75 }, os, iframe);
      await flush();
      assert.deepEqual(iframe.actions, ["playVideo", "mute", "pauseVideo", "unMute"], "the extension must not double-execute commands already understood by an HTML receiver");
      assert.deepEqual(iframe.calls, [0.5, 0.75]);
      iframe.dispatch(JSON.stringify({ eventName: "unknown", meta: {} }));
      iframe.dispatch(JSON.stringify({ eventName: "setPlaybackRate", meta: { playbackRate: 0 } }));
      assert.deepEqual(iframe.actions, ["playVideo", "mute", "pauseVideo", "unMute"]);
      assert.deepEqual(iframe.calls, [0.5, 0.75]);
      if (receiver === "deployed") {
        iframe.dispatch("playVideo"); iframe.dispatch("pauseVideo");
        assert.deepEqual(iframe.actions.slice(-2), ["playVideo", "pauseVideo"], "legacy string commands must continue reaching the original receiver");
      }
    });
  }
  for (const mode of ["viewing", "note"]) {
    for (const landscape of [false, true]) {
      test(`${os} ${mode} ${landscape ? "fullscreen" : "portrait"}: selecting speed reaches the real iframe receiver and reports the actual changed rate`, async () => {
        const fixture = mode === "viewing" ? viewingPlaybackFixture("youtube") : playbackFixture("youtube");
        const screen = mountNote(os, { ...fixture, windowDimensions: () => landscape ? { width: 844, height: 390 } : { width: 390, height: 844 } }); screen.render();
        measurePlayer(screen, landscape ? 730 : 390, landscape ? 294 : 200);
        await connectPlayer(screen, "youtube");
        const iframe = iframeBridge(os);
        screen.find((node) => node.type === "YoutubePlayer").props.ref.current.getPlaybackRate = async () => iframe.rate;
        for (const rate of [0.5, 0.25, 0.75, 1]) {
          speedButton(screen).props.onPress(); screen.render();
          screen.find((node) => node.props?.accessibilityLabel === `再生速度 ${rate}倍`).props.onPress(); screen.render();
          const video = screen.find((node) => node.type === "YoutubePlayer");
          const library = renderYoutubeLibrary(video.props, os, iframe);
          await flush(); screen.render();
          assert.equal(iframe.rate, rate, "the iframe must receive the speed command, not just a React prop");
          assert.equal(await library.playerRef.current.getPlaybackRate(), rate);
          assert.deepEqual(Array.from(await library.playerRef.current.getAvailablePlaybackRates()), [0.25, 0.5, 0.75, 1]);
          assert.equal(speedButton(screen).props.accessibilityLabel, `再生速度：${rate}×`);
          assert.equal(speedButton(screen).props.disabled, false);
          assert.equal(iframe.calls.filter((value) => value === rate).length, 1, "document/window delivery and repeated injection must not duplicate a command");
        }
        assert.deepEqual(iframe.calls, [0.5, 0.25, 0.75, 1]);
        iframe.dispatch('bad json');
        iframe.dispatch(JSON.stringify({ eventName: "setPlaybackRate", meta: { playbackRate: "0.5" } }));
        iframe.dispatch(JSON.stringify({ eventName: "setPlaybackRate", meta: { playbackRate: 0 } }));
        assert.equal(iframe.rate, 1);
        assert.equal(iframe.calls.length, 4);
        assert.equal(iframe.errors.length, 0, "the deployed receiver and extension must safely ignore malformed messages");
        screen.unmount();
      });
    }
  }
}

for (const os of ["android", "ios"]) {
  for (const kind of ["youtube", "native"]) {
    for (const mode of ["viewing", "note"]) {
      test(`${os} ${kind} ${mode}: speed selector is available without note-posting permission and preserves speed, seeks and play state`, async () => {
        const fixture = playbackFixture(kind);
        let dimensions = { width: 390, height: 844 };
        const viewing = mode === "viewing" ? viewingPlaybackFixture(kind) : {};
        const screen = mountNote(os, { ...fixture, ...viewing, windowDimensions: () => dimensions });
        screen.render(); const control = await connectPlayer(screen, kind);
        assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：1×");
        assert.ok(screen.find((node) => node === speedButton(screen), byTestId(screen, "video-playback-controls")), "portrait speed is beside the time display, just like fullscreen");
        assert.equal(byTestId(screen, "video-top-toolbar"), null);
        assert.equal(screen.find((node) => node.children?.includes("戦術ノート ▸")), null);
        const originalSeeks = [...control.seeks];
        await chooseSpeed(screen, kind, control, 0.5);
        assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
        assert.equal(screen.find((node) => node.props?.accessibilityLabel === "再生速度を選択"), null);
        assert.deepEqual(control.seeks, originalSeeks, "changing speed must not seek/restart the clip");
        dimensions = { width: 844, height: 390 }; screen.updateProps({}); screen.render();
        assert.equal(byTestId(screen, "video-top-toolbar"), null);
        assert.ok(screen.find((node) => node === speedButton(screen), byTestId(screen, "video-playback-controls")), "fullscreen speed is beside the time display");
        assert.equal(flattenStyle(byTestId(screen, "video-player-area").props.style).overflow, "hidden");
        assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
        if (kind === "native") assert.deepEqual(control.rateCalls.at(-1), [0.5, true]);
        await sample(screen, kind, control, 18, true); await poll(screen);
        assert.equal(control.seeks.at(-1), 30, "end detection uses source time at any rate");
        assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
        await sample(screen, kind, control, 32, false);
        await chooseSpeed(screen, kind, control, 0.75);
        const video = screen.find((node) => node.type === (kind === "youtube" ? "YoutubePlayer" : "Video"));
        assert.equal(kind === "youtube" ? video.props.play : video.props.shouldPlay, false);
        assert.equal(control.position, 32, "changing speed while paused preserves position");
        screen.unmount();
      });
    }
  }
}

for (const os of ["android", "ios"]) {
  for (const kind of ["youtube", "native"]) {
    test(`${os} ${kind}: the viewing tab returns to the list and cancels playback before late player callbacks`, async () => {
      const screen = mountNote(os, viewingPlaybackFixture(kind)); screen.render();
      const control = await connectPlayer(screen, kind);
      const playerType = kind === "youtube" ? "YoutubePlayer" : "Video";
      const oldVideo = screen.find((node) => node.type === playerType);
      const tab = (label) => screen.find((node) => node.props?.accessibilityRole === "tab" && node.props.accessibilityLabel === label);
      const assertList = () => {
        assert.ok(screen.find((node) => node.type === "Text" && node.children.join("") === "プロジェクト一覧"));
        assert.equal(screen.find((node) => node.type === playerType), null);
        assert.equal(byTestId(screen, "video-playback-controls"), null);
        assert.equal(tab("動画閲覧").props.accessibilityState.selected, true);
      };
      assert.equal(screen.find((node) => node.type === "Text" && node.children.join("") === "一覧へ"), null);
      assert.equal(kind === "youtube" ? oldVideo.props.play : oldVideo.props.shouldPlay, true);
      speedButton(screen).props.onPress(); screen.render();
      let finishRead, pendingReads = [];
      if (kind === "youtube") {
        oldVideo.props.ref.current.getCurrentTime = () => new Promise((resolve) => { finishRead = resolve; });
        pendingReads = [...screen.timers.values()].map((callback) => callback());
        assert.equal(typeof finishRead, "function");
      }
      tab("動画閲覧").props.onPress();
      // Native/iframe notifications may arrive before React commits the list.
      if (kind === "youtube") {
        oldVideo.props.onChangeState("playing");
        oldVideo.props.onChangeState("ended");
      } else {
        oldVideo.props.onPlaybackStatusUpdate({ isLoaded: true, positionMillis: 18000, isPlaying: true, didJustFinish: true });
      }
      screen.render(); assertList();
      if (finishRead) { finishRead(18); await Promise.all(pendingReads); }
      await flush(); screen.render(); assertList();
      assert.deepEqual(control.seeks, [10], "returning to the list must not advance the old playlist");
      oldVideo.props.ref.current = null; // React clears this ref when the player unmounts.
      tab("動画閲覧").props.onPress(); screen.render(); assertList();
      const projects = screen.find((node) => node.type === "FlatList" && node.props.data?.some((item) => item.id === "view"));
      projects.props.renderItem({ item: screen.props.highlightProjects[0] }).props.onPress(); screen.render();
      const reopened = await connectPlayer(screen, kind);
      assert.deepEqual(reopened.seeks, [10], "opening a project from the list starts at its first scene");
      assert.equal(screen.find((node) => node.props?.accessibilityLabel === "再生速度を選択"), null);
      tab("動画編集（タグ付け）").props.onPress(); screen.render();
      tab("動画閲覧").props.onPress(); screen.render(); assertList();
      screen.unmount();
    });
    test(`${os} ${kind}: tag visibility survives rotation and scene changes without disturbing playback`, async () => {
      let dimensions = { width: 390, height: 844 };
      const screen = mountNote(os, { ...viewingPlaybackFixture(kind), windowDimensions: () => dimensions }); screen.render();
      const control = await connectPlayer(screen, kind);
      await chooseSpeed(screen, kind, control, 0.5);
      const toggle = () => screen.find((node) => node.props?.accessibilityLabel === "動画タグの表示");
      const playerType = kind === "youtube" ? "YoutubePlayer" : "Video";
      const player = screen.find((node) => node.type === playerType).props.ref.current;
      const seeks = [...control.seeks];
      assert.equal(toggle().props.accessibilityState.checked, true);
      assert.ok(byTestId(screen, "video-tag-overlay"));
      assert.ok(screen.find((node) => node === toggle(), byTestId(screen, "video-playback-controls")));
      toggle().props.onPress(); screen.render();
      assert.equal(byTestId(screen, "video-tag-overlay"), null);
      assert.ok(screen.find((node) => node.children?.includes("試合"), byTestId(screen, "video-player-area")), "hiding a tag must preserve the video title");
      dimensions = { width: 844, height: 390 }; screen.updateProps({}); screen.render();
      assert.equal(toggle().props.accessibilityState.checked, false);
      assert.ok(screen.find((node) => node === toggle(), byTestId(screen, "video-playback-controls")));
      for (const [label, measuredHeight] of [["プレイリストを表示", 68], ["プレイリストを隠す", 76]]) {
        const playlistToggle = screen.find((node) => node.props?.accessibilityLabel === label);
        playlistToggle.props.onLayout({ nativeEvent: { layout: { height: measuredHeight } } }); screen.render();
        if (!toggle().props.accessibilityState.checked) { toggle().props.onPress(); screen.render(); }
        const tag = byTestId(screen, "video-tag-overlay");
        const tagPosition = flattenStyle(tag.props.style), buttonPosition = flattenStyle(playlistToggle.props.style);
        assert.ok(tagPosition.top > buttonPosition.top + measuredHeight, "the tag must start below the complete playlist toggle, including larger text");
        assert.equal(tag.props.pointerEvents, "none");
        playlistToggle.props.onPress(); screen.render();
      }
      assert.deepEqual(control.seeks, seeks);
      assert.equal(screen.find((node) => node.type === playerType).props.ref.current, player);
      toggle().props.onPress(); screen.render();
      await sample(screen, kind, control, 18, true); await poll(screen);
      assert.equal(control.seeks.at(-1), 30);
      assert.equal(byTestId(screen, "video-tag-overlay"), null);
      assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
      dimensions = { width: 390, height: 844 }; screen.updateProps({}); screen.render();
      assert.equal(toggle().props.accessibilityState.checked, false);
      toggle().props.onPress(); screen.render(); assert.ok(byTestId(screen, "video-tag-overlay"));
      screen.unmount();
      const note = mountNote(os, playbackFixture(kind)); note.render();
      assert.equal(note.find((node) => node.props?.accessibilityLabel === "動画タグの表示"), null, "notes without a tag must not show an empty tag control");
      note.unmount();
    });
  }
  for (const mode of ["viewing", "note"]) {
    test(`${os} ${mode}: YouTube fits the measured viewport through rotation and playlist toggles without re-seeking`, async () => {
      let dimensions = { width: 390, height: 844 };
      const fixture = mode === "viewing" ? viewingPlaybackFixture("youtube") : playbackFixture("youtube");
      const screen = mountNote(os, { ...fixture, windowDimensions: () => dimensions }); screen.render();
      const control = await connectPlayer(screen, "youtube");
      measurePlayer(screen, 390, 200);
      assert.equal(screen.find((node) => node.type === "YoutubePlayer").props.height, 200);
      await chooseSpeed(screen, "youtube", control, 0.5);
      const seeks = [...control.seeks], player = screen.find((node) => node.type === "YoutubePlayer").props.ref.current;
      dimensions = { width: 844, height: 390 }; screen.updateProps({}); screen.render();
      // Insets and the banner leave less room than useWindowDimensions reports.
      for (const [width, height, toggle] of [[730, 294, null], [438, 294, "プレイリストを表示"], [730, 318, "プレイリストを隠す"]]) {
        if (toggle) { screen.find((node) => node.props?.accessibilityLabel === toggle).props.onPress(); screen.render(); }
        measurePlayer(screen, width, height);
        const video = screen.find((node) => node.type === "YoutubePlayer");
        assert.ok(video.props.width <= width && video.props.height <= height);
        assert.ok(Math.abs(video.props.width / video.props.height - 16 / 9) < 0.001);
        const library = renderYoutubeLibrary(video.props, os);
        const frame = flattenStyle(library.props.style), webView = library.children[0];
        const surface = flattenStyle(webView.props.style), webViewContainer = webView.props.containerStyle;
        for (const nested of [frame, surface, webViewContainer]) {
          assert.equal(nested.width, video.props.width, "native layers must share the complete iframe width");
          assert.equal(nested.height, video.props.height, "native layers must share the complete iframe height");
          assert.equal(nested.maxHeight, undefined, "percentage height limits must not clip a centered player");
        }
        assert.equal(surface.flex, 0); assert.equal(webViewContainer.flex, 0);
        assert.ok(frame.left >= 0 && frame.top >= 0);
        assert.ok(frame.left + frame.width <= width + 0.001 && frame.top + frame.height <= height + 0.001);
        assert.equal(webView.props.automaticallyAdjustContentInsets, false);
        assert.equal(webView.props.contentInsetAdjustmentBehavior, "never");
        assert.equal(webView.props.scrollEnabled, false);
        assert.equal(video.props.ref.current, player, "resizing must retain the player instance");
        assert.equal(video.props.playbackRate, 0.5);
        assert.equal(byTestId(screen, "video-top-toolbar"), null);
        assert.equal(flattenStyle(byTestId(screen, "video-player-area").props.style).height, undefined);
      }
      assert.deepEqual(control.seeks, seeks);
      assert.equal(screen.find((node) => node.type === "YoutubePlayer").props.play, true);
      dimensions = { width: 390, height: 844 }; screen.updateProps({}); screen.render();
      measurePlayer(screen, 390, 200);
      assert.equal(byTestId(screen, "video-top-toolbar"), null);
      assert.ok(screen.find((node) => node === speedButton(screen), byTestId(screen, "video-playback-controls")));
      assert.equal(screen.find((node) => node.type === "YoutubePlayer").props.height, 200);
      assert.equal(screen.find((node) => node.type === "YoutubePlayer").props.webViewStyle, undefined);
      const portraitWebView = screen.find((node) => node.type === "YoutubePlayer").props.webViewProps;
      assert.equal(portraitWebView.containerStyle, undefined);
      assert.equal(portraitWebView.automaticallyAdjustContentInsets, undefined);
      assert.equal(portraitWebView.contentInsetAdjustmentBehavior, undefined);
      assert.equal(speedButton(screen).props.accessibilityLabel, "再生速度：0.5×");
      screen.unmount();
    });
  }
  test(`${os}: viewing keeps search below the tabs while the note picker preserves scene selection`, async () => {
    let dimensions = { width: 390, height: 844 };
    const highlightHistory = { hasMore: true, loadMore() {} };
    const screen = mountNote(os, { ...viewingPlaybackFixture("native"),
      userProfiles: { member: { uid: "member", role: "owner" } }, highlightHistory, history: { hasMore: true }, windowDimensions: () => dimensions });
    screen.render(); await connectPlayer(screen, "native");
    for (dimensions of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
      screen.updateProps({}); screen.render();
      const showPlaylist = screen.find((node) => node.props?.accessibilityLabel === "プレイリストを表示");
      if (showPlaylist) { showPlaylist.props.onPress(); screen.render(); }
      assert.equal(byTestId(screen, "video-top-toolbar"), null);
      assert.equal(screen.find((node) => node.props?.accessibilityRole === "checkbox"), null);
      assert.equal(screen.find((node) => node.children?.some?.((child) => typeof child === "string" && child.includes("ノートを作成"))), null);
      assert.equal(screen.find((node) => node.type === "HistoryLoadingControls"), null, "the player must not reserve space for list pagination");
      const content = screen.find((node) => node.type === "View" && node.props.style?.[0]?.padding === 15 && node.props.style[0].flex === 1);
      assert.equal(flattenStyle(content.props.style).paddingTop, 0);
      assert.ok(screen.find((node) => node.type === "Text" && node.children.join("") === "検索条件:"));
      assert.ok(speedButton(screen));
    }
    screen.find((node) => node.props?.accessibilityRole === "tab" && node.props.accessibilityLabel === "動画閲覧").props.onPress(); screen.render();
    assert.equal(screen.find((node) => node.type === "HistoryLoadingControls").props.history, highlightHistory);
    screen.unmount();

    const picker = mountNote(os, { ...viewingPlaybackFixture("native"), registrationEnabled: false,
      route: { params: { notePicker: { sourceId: "view", teamId: "team" } } }, windowDimensions: () => dimensions });
    picker.render(); await connectPlayer(picker, "native");
    const checkbox = picker.find((node) => node.props?.accessibilityRole === "checkbox");
    assert.ok(checkbox); checkbox.props.onPress(); picker.render();
    dimensions = { width: 844, height: 390 }; picker.updateProps({}); picker.render();
    assert.ok(byTestId(picker, "video-top-toolbar"));
    assert.equal(picker.find((node) => node.props?.accessibilityRole === "checkbox").props.accessibilityState.checked, true);
    assert.ok(picker.find((node) => node.type === "Text" && node.children.join("") === "選択した1件を追加"));
    picker.unmount();
  });
  test(`${os}: entering fullscreen hides the remembered playlist before the orientation lock resolves`, async () => {
    let dimensions = { width: 844, height: 390 }, finishLock;
    const lock = new Promise((done) => { finishLock = done; });
    const screen = mountNote(os, { ...viewingPlaybackFixture("native"), windowDimensions: () => dimensions,
      orientationModule: { lockAsync: () => lock } });
    screen.render(); await connectPlayer(screen, "native");
    screen.find((node) => node.props?.accessibilityLabel === "プレイリストを表示").props.onPress(); screen.render();
    dimensions = { width: 390, height: 844 }; screen.updateProps({}); screen.render();
    const opening = screen.find((node) => node.props?.accessibilityLabel === "全画面にする").props.onPress();
    dimensions = { width: 844, height: 390 }; screen.updateProps({}); screen.render();
    assert.ok(screen.find((node) => node.props?.accessibilityLabel === "プレイリストを表示"));
    finishLock(); await opening; screen.render();
    assert.ok(screen.find((node) => node.props?.accessibilityLabel === "プレイリストを表示"));
    screen.unmount();
  });
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
