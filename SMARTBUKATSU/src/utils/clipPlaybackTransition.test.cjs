const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parse } = require("@babel/parser");
const { createClipPlaybackTransition } = require("./clipPlaybackTransition");

const clip = { projectId: "video", id: "tag", start: 10, end: 18 };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(setImmediate);

test("backward selection rejects the old position until the seek is confirmed", () => {
  const transition = createClipPlaybackTransition();
  const token = transition.begin("earlier", clip);
  assert.equal(transition.consumeEnd(token, 80), false);
  assert.equal(transition.confirm(token, 10), false);
  transition.markSeekIssued(token);
  assert.equal(transition.confirm(token, 80), false);
  assert.equal(transition.consumeEnd(token, 80), false);
  assert.equal(transition.confirm(token, 10), true);
  assert.equal(transition.consumeEnd(token, 17.9), false);
  assert.equal(transition.consumeEnd(token, 18), true);
  assert.equal(transition.consumeEnd(token, 18.5), false);
});

test("rapid selections and stale cleanup cannot override the last selection", () => {
  const transition = createClipPlaybackTransition();
  const first = transition.begin("first", clip);
  transition.markSeekIssued(first);
  transition.cancel();
  const last = transition.begin("last", { ...clip, start: 30, end: 38 });
  transition.markSeekIssued(last);
  transition.cancel(first);
  assert.equal(transition.confirm(first, 10), false);
  assert.equal(transition.consumeEnd(first, 100), false);
  assert.equal(transition.confirm(last, 30), true);
  assert.equal(transition.matches("last"), true);
});

test("forward selection, physical video end, and replay retain one end per selection", () => {
  const transition = createClipPlaybackTransition();
  for (let replay = 0; replay < 2; replay += 1) {
    const token = transition.begin("same-tag", { ...clip, start: 100, end: 110 });
    transition.markSeekIssued(token);
    assert.equal(transition.confirm(token, 10), false);
    assert.equal(transition.confirm(token, 100), true);
    assert.equal(transition.consumeEnd(token, 105, true), true);
    assert.equal(transition.consumeEnd(token, 110, true), false);
  }
});

test("invalid position samples and cancelled transitions never enable playback", () => {
  const transition = createClipPlaybackTransition();
  const token = transition.begin("tag", clip);
  transition.markSeekIssued(token);
  for (const value of [NaN, Infinity, undefined, "10", -1]) {
    assert.equal(transition.confirm(token, value), false);
    assert.equal(transition.consumeEnd(token, value), false);
  }
  transition.cancel();
  assert.equal(transition.confirm(token, 10), false);
  assert.equal(transition.canObserve(token), false);
});

test("native commands serialize and skip intermediate selections", async () => {
  const transition = createClipPlaybackTransition();
  const oldSeek = deferred();
  const calls = [];
  const first = transition.begin("first", clip);
  const firstResult = transition.runNative(first, async () => {
    calls.push("first-start");
    await oldSeek.promise;
    calls.push("first-finish");
  });
  await flush();
  const second = transition.begin("second", clip);
  const secondResult = transition.runNative(second, () => calls.push("second"));
  const last = transition.begin("last", clip);
  const lastResult = transition.runNative(last, () => calls.push("last"));
  assert.deepEqual(calls, ["first-start"]);
  oldSeek.resolve();
  await Promise.all([firstResult, secondResult, lastResult]);
  assert.deepEqual(calls, ["first-start", "first-finish", "last"]);
});

test("a rejected native command does not block a later selection", async () => {
  const transition = createClipPlaybackTransition();
  const first = transition.begin("first", clip);
  await assert.rejects(transition.runNative(first, () => Promise.reject(new Error("seek"))));
  const last = transition.begin("last", clip);
  assert.equal(await transition.runNative(last, () => "played"), "played");
});

// Exercise the screen's actual handlers/effects, without a device or a new test
// dependency. Babel locates the functions; vm supplies only player/React state
// boundaries. No duplicate implementation of the screen's playback logic.
const source = fs.readFileSync(path.join(__dirname, "../screens/ProjectListScreen.js"), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
const screen = ast.program.body.find((node) => node.type === "VariableDeclaration" &&
  node.declarations.some((declaration) => declaration.id.name === "ProjectListScreen"));
const statements = screen.declarations[0].init.body.body;
function functionSource(name) {
  const declaration = statements.flatMap((node) => node.declarations || [])
    .find((node) => node.id.name === name);
  const fn = declaration.init.type === "CallExpression"
    ? declaration.init.arguments[0] : declaration.init;
  return source.slice(fn.start, fn.end);
}
function effectSource(dependency) {
  const call = statements.map((node) => node.expression).find((node) =>
    node?.type === "CallExpression" && node.callee.name === "useEffect" &&
    node.arguments[1]?.elements.some((item) => item.name === dependency));
  return source.slice(call.arguments[0].start, call.arguments[0].end);
}
function harness(overrides = {}) {
  const events = { playing: [], times: [], indexes: [], alerts: [], intervals: [], timeouts: [] };
  const context = vm.createContext({
    playbackModeRef: { current: "stop" }, setPlaybackMode: () => {},
    transition: createClipPlaybackTransition(), currentClip: clip,
    clipPlaybackKey: "tag", currentClipIndex: 0, currentClips: [clip, clip, clip],
    isClipEditing: false, isClipEditingRef: { current: false },
    hasReachedPlaylistEnd: false, hasReachedPlaylistEndRef: { current: false },
    activeTab: "summary", selectedHighlightProjectId: "project", ytId: null,
    isPlaying: false, isYoutubeReady: false, videoRef: { current: null },
    youtubeRef: { current: null }, youtubeTimeRequestRef: { current: null },
    setIsPlaying: (value) => events.playing.push(value),
    setVideoTime: (value) => events.times.push(value),
    setCurrentClipIndex: (value) => events.indexes.push(value),
    setClipSelectionVersion: () => {}, setIsClipEditing: () => {},
    setHasReachedPlaylistEnd: () => {}, Keyboard: { dismiss() {} },
    Alert: { alert: (...args) => events.alerts.push(args) },
    setTimeout: (callback) => { events.timeouts.push(callback); return callback; },
    clearTimeout() {},
    setInterval: (callback) => { events.intervals.push(callback); return callback; },
    clearInterval() {}, console: { log() {} },
    ...overrides,
  });
  for (const name of ["handleCyclePlaybackMode", "requestClipTransition", "stopAtClipEnd", "playNextClip",
    "handleSelectClip", "handlePlaybackStatusUpdate", "onYoutubeStateChange"]) {
    context[name] = vm.runInContext(`(${functionSource(name)})`, context);
  }
  return {
    context, events,
    start: () => vm.runInContext(`(${effectSource("nativeLoadVersion")})`, context)(),
    poll: () => vm.runInContext(`(${effectSource("isPlaying")})`, context)(),
  };
}

test("native screen ignores old status during seek, then seeks before playing", async () => {
  const h = harness();
  const seeking = deferred();
  const calls = [];
  h.context.videoRef.current = {
    getStatusAsync: async () => ({ isLoaded: true, positionMillis: 80000 }),
    setStatusAsync: (status) => { calls.push(["seek", status.positionMillis]); return seeking.promise; },
    playAsync: async () => { calls.push(["play"]); return { isLoaded: true }; },
  };
  h.start();
  await flush();
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 80000, isPlaying: true });
  assert.deepEqual(h.events.indexes, []);
  assert.deepEqual(calls, [["seek", 10000]]);
  seeking.resolve({ isLoaded: true, positionMillis: 10000 });
  await flush();
  assert.deepEqual(calls, [["seek", 10000], ["play"]]);
  assert.equal(h.events.playing.at(-1), true);
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 18000, isPlaying: true });
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 19000, isPlaying: true });
  assert.deepEqual(h.events.indexes, [1]);
});

test("native screen discards an in-flight seek when the user selects another tag", async () => {
  const h = harness();
  const seeking = deferred();
  let plays = 0;
  h.context.videoRef.current = {
    getStatusAsync: async () => ({ isLoaded: true }),
    setStatusAsync: () => seeking.promise,
    playAsync: async () => { plays += 1; return { isLoaded: true }; },
  };
  h.start();
  await flush();
  h.context.handleSelectClip(2);
  seeking.resolve({ isLoaded: true, positionMillis: 10000 });
  await flush();
  assert.equal(plays, 0);
  assert.deepEqual(h.events.indexes, [2]);
  assert.equal(h.context.transition.current(), null);
});

test("native load readiness retries and seek failure remains blocked", async () => {
  const h = harness();
  let loaded = false;
  h.context.videoRef.current = {
    getStatusAsync: async () => ({ isLoaded: loaded }),
    setStatusAsync: async () => { throw new Error("seek failed"); },
  };
  const cleanup = h.start();
  await flush();
  assert.equal(h.events.alerts.length, 0);
  cleanup();
  loaded = true;
  h.start();
  await flush();
  assert.equal(h.events.alerts.length, 1);
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 80000 });
  assert.deepEqual(h.events.indexes, []);
  assert.equal(h.events.playing.at(-1), false);
});

test("YouTube screen confirms the selected start before enabling auto-advance", async () => {
  let time = 80;
  const seeks = [];
  const h = harness({ ytId: "youtube", isYoutubeReady: true });
  h.context.youtubeRef.current = {
    seekTo: (seconds) => seeks.push(seconds), getCurrentTime: async () => time,
  };
  h.context.youtubeReadyPlayer = h.context.youtubeRef.current;
  h.start();
  h.poll();
  const tick = h.events.intervals.at(-1);
  await tick();
  assert.deepEqual(seeks, [10]);
  assert.deepEqual(h.events.indexes, []);
  h.context.onYoutubeStateChange("ended");
  assert.deepEqual(h.events.indexes, []);
  time = 10;
  await tick();
  assert.equal(h.events.playing.at(-1), true);
  h.context.isPlaying = true;
  time = 18;
  await tick();
  await tick();
  assert.deepEqual(h.events.indexes, [1]);
});

test("YouTube screen drops old async time results and avoids overlapping requests", async () => {
  const pending = deferred();
  let reads = 0;
  const h = harness({ ytId: "youtube", isYoutubeReady: true });
  h.context.youtubeRef.current = {
    seekTo() {}, getCurrentTime: () => { reads += 1; return pending.promise; },
  };
  h.context.youtubeReadyPlayer = h.context.youtubeRef.current;
  const cleanupStart = h.start();
  const cleanupPoll = h.poll();
  const oldTick = h.events.intervals.at(-1)();
  await h.events.intervals.at(-1)();
  assert.equal(reads, 1);
  h.context.handleSelectClip(2);
  cleanupStart();
  cleanupPoll();
  h.context.clipPlaybackKey = "last";
  h.start();
  h.poll();
  await h.events.intervals.at(-1)();
  assert.equal(reads, 1);
  pending.resolve(80);
  await oldTick;
  assert.deepEqual(h.events.indexes, [2]);
  assert.deepEqual(h.events.times, []);
  assert.equal(h.context.transition.current().phase, "seeking");
});

test("last clip stops once and same-tag selection starts a new transition", async () => {
  const h = harness({ ytId: "youtube", currentClipIndex: 2 });
  const token = h.context.transition.begin("tag", clip);
  h.context.transition.markSeekIssued(token);
  h.context.transition.confirm(token, 10);
  h.context.onYoutubeStateChange("ended");
  h.context.onYoutubeStateChange("ended");
  assert.equal(h.context.hasReachedPlaylistEndRef.current, true);
  assert.deepEqual(h.events.indexes, []);
  h.context.handleSelectClip(2);
  assert.equal(h.context.hasReachedPlaylistEndRef.current, false);
  assert.deepEqual(h.events.indexes, [2]);
  assert.equal(h.context.transition.current(), null);
});

test("unconfirmed seek timeout stops safely instead of advancing", () => {
  const h = harness({ ytId: "youtube", isYoutubeReady: true });
  h.context.youtubeRef.current = { seekTo() {} };
  h.context.youtubeReadyPlayer = h.context.youtubeRef.current;
  h.start();
  h.events.timeouts.at(-1)();
  assert.equal(h.events.alerts.length, 1);
  assert.equal(h.context.transition.current(), null);
  assert.deepEqual(h.events.indexes, []);
});

test("switching YouTube sources waits for the new player even if old readiness was true", () => {
  let seeks = 0;
  const h = harness({ ytId: "new-video", isYoutubeReady: true, youtubeReadyPlayer: {} });
  h.context.youtubeRef.current = { seekTo() { seeks += 1; } };
  const cleanup = h.start();
  assert.equal(seeks, 0);
  assert.equal(h.context.transition.current().seekIssued, false);
  cleanup();
  h.context.youtubeReadyPlayer = h.context.youtubeRef.current;
  h.start();
  assert.equal(seeks, 1);
});


for (const player of ["native", "youtube"]) {
  for (const scenario of [
    { mode: "single", index: 1, count: 3, next: 1 },
    { mode: "single", index: 0, count: 1, next: 0 },
    { mode: "all", index: 0, count: 3, next: 1 },
    { mode: "all", index: 2, count: 3, next: 0 },
    { mode: "all", index: 0, count: 1, next: 0 },
    { mode: "stop", index: 2, count: 3, next: null },
  ]) {
    test(player + " end applies " + JSON.stringify(scenario) + " exactly once", () => {
      const h = harness({
        ytId: player === "youtube" ? "youtube" : null,
        playbackModeRef: { current: scenario.mode },
        currentClipIndex: scenario.index,
        currentClips: Array(scenario.count).fill(clip),
      });
      const token = h.context.transition.begin("tag", clip);
      h.context.transition.markSeekIssued(token);
      h.context.transition.confirm(token, 10);
      const end = () => player === "youtube"
        ? h.context.onYoutubeStateChange("ended")
        : h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 15000, didJustFinish: true });
      end(); end();
      assert.deepEqual(h.events.indexes, scenario.next === null ? [] : [scenario.next]);
      assert.equal(h.context.hasReachedPlaylistEndRef.current, scenario.next === null);
      if (scenario.next !== null) assert.equal(h.context.transition.current(), null);
    });
  }
}

test("mode cycling preserves position, pause state and transition until the next end", () => {
  const modes = [];
  const h = harness({ setPlaybackMode: (mode) => modes.push(mode) });
  const token = h.context.transition.begin("tag", clip);
  h.context.transition.markSeekIssued(token);
  h.context.transition.confirm(token, 10);
  for (let i = 0; i < 4; i++) h.context.handleCyclePlaybackMode();
  assert.deepEqual(modes, ["single", "all", "stop", "single"]);
  assert.equal(h.context.transition.current(), token);
  assert.deepEqual(h.events.playing, []);
  assert.deepEqual(h.events.times, []);
  assert.deepEqual(h.events.indexes, []);
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 18000 });
  assert.deepEqual(h.events.indexes, [0]);
});

test("changing mode after completion does not restart; selecting a tag does", () => {
  const h = harness({ ytId: "youtube", currentClipIndex: 2 });
  const token = h.context.transition.begin("tag", clip);
  h.context.transition.markSeekIssued(token);
  h.context.transition.confirm(token, 10);
  h.context.onYoutubeStateChange("ended");
  h.context.handleCyclePlaybackMode();
  h.context.onYoutubeStateChange("ended");
  assert.equal(h.context.hasReachedPlaylistEndRef.current, true);
  assert.deepEqual(h.events.indexes, []);
  h.context.handleSelectClip(1);
  assert.equal(h.context.hasReachedPlaylistEndRef.current, false);
  assert.deepEqual(h.events.indexes, [1]);
});

test("single repeat issues another seek before playback, and a manual selection wins", async () => {
  const h = harness({ playbackModeRef: { current: "single" } });
  const seeks = [];
  h.context.videoRef.current = {
    getStatusAsync: async () => ({ isLoaded: true }),
    setStatusAsync: async (status) => { seeks.push(status.positionMillis); return { isLoaded: true, positionMillis: status.positionMillis }; },
    playAsync: async () => ({ isLoaded: true }),
  };
  h.start(); await flush();
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 18000 });
  h.start(); await flush();
  assert.deepEqual(seeks, [10000, 10000]);
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 18000 });
  h.context.handleSelectClip(2);
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 19000 });
  assert.deepEqual(h.events.indexes, [0, 0, 2]);
});


test("all repeat uses the filtered playlist bounds", () => {
  const h = harness({ playbackModeRef: { current: "all" }, currentClipIndex: 1,
    currentClips: [clip, { ...clip, id: "filtered-last" }] });
  const token = h.context.transition.begin("tag", clip);
  h.context.transition.markSeekIssued(token);
  h.context.transition.confirm(token, 10);
  h.context.handlePlaybackStatusUpdate({ isLoaded: true, positionMillis: 18000 });
  assert.deepEqual(h.events.indexes, [0]);
});

test("editing blocks repeat until a tag is explicitly selected on return", () => {
  const h = harness({ playbackModeRef: { current: "all" },
    isClipEditingRef: { current: true }, ytId: "youtube" });
  h.context.onYoutubeStateChange("ended");
  h.context.handleCyclePlaybackMode();
  assert.deepEqual(h.events.indexes, []);
  h.context.handleSelectClip(1);
  assert.equal(h.context.isClipEditingRef.current, false);
  assert.deepEqual(h.events.indexes, [1]);
});
