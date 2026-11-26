const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { transformSync } = require("@babel/core");
const { transferVideo } = require("./youtubeUploadProtocol");

const code = transformSync(fs.readFileSync(require.resolve("./youtubeUploadService"), "utf8"), {
  babelrc: false, configFile: false, plugins: ["@babel/plugin-transform-modules-commonjs"],
}).code;
const owner = { uid: "self", teamId: "team" };
const grant = { channelId: "channel", connection: "wrapped-test-credential" };

function fixture() {
  const local = new Map(), projects = new Map(), calls = [], chunks = [];
  const state = { received: false, failResult: true, failSave: true, allowed: true };
  const storage = {
    async getItem(k) { return local.get(k) || null; },
    async setItem(k, v) {
      if (state.failResult && JSON.parse(v).videoId) { state.failResult = false; throw new Error("local disk"); }
      local.set(k, v);
    },
    async removeItem(k) { local.delete(k); },
  };
  const modules = {
    "@react-native-async-storage/async-storage": storage, "expo-constants": {}, "expo-web-browser": {},
    "../firebase": { auth: { currentUser: { uid: owner.uid } }, db: {}, cloudFunctions: {} },
    "firebase/functions": { httpsCallable: (_functions, name) => async data => {
      calls.push(data.action || name);
      if (name === "getYoutubeUploadAccess") return { data: { allowed: state.allowed } };
      if (data.action === "start") return { data: { session: "wrapped-test-session" } };
      if (data.action === "resume") return { data: { location: "https://example.test/upload", accessToken: "ephemeral" } };
      throw new Error("unexpected action");
    } },
    "firebase/firestore": {
      doc: (_ref, ...parts) => ({ id: parts.at(-1) || "fixed-id" }), collection: () => ({}), serverTimestamp: () => "now",
      runTransaction: async (_db, work) => {
        if (state.failSave) { state.failSave = false; throw new Error("offline"); }
        return work({ get: async ref => ({ exists: () => projects.has(ref.id), data: () => projects.get(ref.id) }),
          set: (ref, data) => projects.set(ref.id, data) });
      },
    },
    expo: { requireNativeModule: () => ({ FileSystemFile: class {
      exists = true; size = 4; modificationTime = 123;
      open() { return { readBytes(n) { return new Uint8Array(n); }, close() {} }; }
    } }) },
    "expo/fetch": { async fetch(_url, init) {
      const range = init.headers["Content-Range"];
      chunks.push(range);
      if (!state.received && range === "bytes */4") return new Response(null, { status: 308 });
      state.received = true;
      return Response.json({ id: "abcdefghijk" }, { status: 201 });
    } },
    "./youtubeUploadProtocol": { transferVideo },
  };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(name in modules, name); return modules[name];
  }, setTimeout, URL });
  return { api: module.exports, state, projects, local, calls, chunks };
}

test("native client persists the session before transfer and recovers a lost local result and failed Firestore save", async () => {
  const f = fixture(), api = f.api;
  const source = api.inspectVideo({ uri: "file:///video.mp4", duration: 900, mimeType: "video/mp4" });
  await api.startUpload(owner, grant, source, { title: "試合", privacy: "unlisted" },
    { title: "登録名", participants: "team", type: "試合", tagGroupId: null });
  const pending = await api.loadUpload(owner, "job");
  const send = () => api.sendUpload(owner, grant, pending, new AbortController().signal, () => {}, () => {});
  await assert.rejects(send(), /local disk/);
  const done = await send();
  assert.equal(f.calls.filter(action => action === "start").length, 1);
  assert.deepEqual(f.chunks, ["bytes */4", "bytes 0-3/4", "bytes */4"]);
  assert.equal(done.videoId, "abcdefghijk");
  assert.ok(!JSON.stringify([...f.local.values()]).includes("ephemeral"));
  const draft = { title: "監督用の練習記録", participants: "coach", type: "練習", tagGroupId: "practice" };
  const project = { ...draft, id: done.projectId, videoUrl: "https://www.youtube.com/watch?v=abcdefghijk", createdBy: owner.uid };
  await assert.rejects(api.saveUploadedProject(owner, project), /offline/);
  const restored = await api.loadUpload(owner, "job");
  assert.deepEqual({ ...restored.draft }, draft);
  assert.equal(restored.videoId, done.videoId);
  assert.equal(restored.projectId, done.projectId);
  assert.equal(restored.title, "試合");
  await api.saveUploadedProject(owner, { ...project, ...restored.draft });
  assert.equal(f.projects.get(project.id).participants, "coach");
  assert.equal(f.projects.get(project.id).title, draft.title);
  f.projects.get(project.id).tags = ["existing tag"];
  await api.saveUploadedProject(owner, project);
  assert.equal(f.projects.size, 1);
  assert.deepEqual(f.projects.get(project.id).tags, ["existing tag"]);
  assert.equal(await api.loadUpload(owner, "job"), null);
});

test("a different signed-in user or revoked permission cannot save a recovered result", async () => {
  const f = fixture();
  f.state.allowed = false;
  await assert.rejects(f.api.saveUploadedProject(owner, {}), /投稿権限/);
  await assert.rejects(f.api.canUpload({ ...owner, uid: "other" }), /ログイン状態/);
  assert.equal(f.projects.size, 0);
});
