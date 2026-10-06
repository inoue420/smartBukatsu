const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { transformSync } = require("@babel/core");
const utils = require("../utils/workspaceReactions");
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function load(file, modules) {
  const code = transformSync(fs.readFileSync(file, "utf8"), { configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require(name) { assert.ok(name in modules, name); return modules[name]; }, Map, Set, console });
  return module.exports;
}
function harness(overrides = {}) {
  const slots = [], calls = { own: [], details: [], sends: [] };
  let cursor, dirty = true, effects, result;
  let props = { teamId: "team", uid: "staff", role: "staff", channelId: "general", isOffline: false,
    posts: [{ id: "post", authorUid: "author", visibleToUids: ["staff", "author", "other"] }] };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) { const index = cursor++; slots[index] ||= { value: initial }; return [slots[index].value, (update) => {
      const next = typeof update === "function" ? update(slots[index].value) : update;
      if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
    }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn(); }); } },
  };
  const service = {
    getOwnWorkspaceReaction: (...args) => { calls.own.push(args); return overrides.own?.(...args) || Promise.resolve(null); },
    getWorkspaceReactionDetails: (...args) => { calls.details.push(args); return overrides.details?.(...args) || Promise.resolve({ author: "👍" }); },
    sendWorkspaceReaction: (...args) => { calls.sends.push(args); return overrides.send?.(...args) || Promise.resolve({ added: true, emoji: args[2] }); },
  };
  const { useWorkspaceReactions } = load(path.join(__dirname, "../hooks/useWorkspaceReactions.js"),
    { react, "../services/workspaceReactionService": service, "../utils/workspaceReactions": utils });
  const render = () => { let passes = 0; while (dirty) { assert.ok(++passes < 30); dirty = false; cursor = 0; effects = []; result = useWorkspaceReactions(props); effects.forEach((fn) => fn()); } return result; };
  render();
  return { calls, get api() { return result; }, render,
    change(values) { props = { ...props, ...values }; dirty = true; return render(); },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); } };
}

test("viewing posts, expanding and updating counts add no reaction reads", () => {
  const h = harness();
  h.change({ posts: Array.from({ length: 100 }, (_, i) => ({ id: String(i), authorUid: "author", reactions: { "👍": i } })) });
  h.render(); assert.deepEqual(h.calls, { own: [], details: [], sends: [] }); h.unmount();
});
test("sender details fetch one document only on explicit tap and never fetch names", async () => {
  const h = harness(); await h.api.openDetails("post", "👍"); h.render();
  assert.equal(h.calls.details.length, 1); assert.equal(h.calls.own.length, 0);
  assert.equal(h.api.details.reactors.author, "👍");
  h.api.closeDetails(); h.render(); assert.equal(h.api.details, null); assert.equal(h.calls.details.length, 1); h.unmount();
});
test("rapid identical sender taps share one pending read", async () => {
  const request = deferred(), h = harness({ details: () => request.promise });
  const first = h.api.openDetails("post", "👍"), second = h.api.openDetails("post", "👍");
  assert.equal(h.calls.details.length, 1); request.resolve({ author: "👍" }); await Promise.all([first, second]); h.unmount();
});
for (const role of ["member", "guardian", "captain"]) {
  test(`${role}: a nonauthor cannot request sender details even with the same display name`, async () => {
    const h = harness(); h.change({ uid: "other", role }); await h.api.openDetails("post", "👍");
    assert.equal(h.calls.details.length, 0); assert.equal(h.api.details, null); h.unmount();
  });
  test(`${role}: the UID author can request sender details`, async () => {
    const h = harness(); h.change({ uid: "author", role }); await h.api.openDetails("post", "👍"); h.render();
    assert.equal(h.calls.details.length, 1); assert.equal(h.api.details.reactors.author, "👍"); h.unmount();
  });
}
test("legacy author names do not grant sender permission without an author UID", () => {
  assert.equal(utils.canViewWorkspaceReactionSenders({ user: "Same Name" }, "other", "member"), false);
});
test("own receipt is read once per post in the current screen context", async () => {
  const h = harness(); assert.equal(await h.api.prepareReaction("post"), true); h.render();
  assert.equal(await h.api.prepareReaction("post"), true); assert.equal(h.calls.own.length, 1);
  await h.api.submitReaction("post", "👍"); h.render();
  assert.equal(await h.api.prepareReaction("post"), false); assert.equal(h.calls.own.length, 1);
  assert.equal(h.api.ownReactions.post, "👍"); h.unmount();
});
test("an existing receipt disables repeat submission through the picker", async () => {
  const h = harness({ own: () => Promise.resolve("🔥") });
  assert.equal(await h.api.prepareReaction("post"), false); h.render();
  assert.equal(h.api.ownReactions.post, "🔥"); assert.equal(h.calls.sends.length, 0); h.unmount();
});
test("closing the modal discards a delayed sender response", async () => {
  const request = deferred(), h = harness({ details: () => request.promise });
  const reading = h.api.openDetails("post", "👍"); h.render(); h.api.closeDetails(); h.render();
  request.resolve({ private: "👍" }); await reading; h.render(); assert.equal(h.api.details, null); h.unmount();
});
test("changing team, account or channel discards private details and own receipts", async () => {
  for (const change of [{ teamId: "next" }, { uid: "other" }, { channelId: "next" }]) {
    const request = deferred(), h = harness({ details: () => request.promise });
    const reading = h.api.openDetails("post", "👍"); h.render(); h.change(change);
    assert.equal(h.api.details, null); request.resolve({ oldTeam: "👍" }); await reading; h.render();
    assert.equal(h.api.details, null); assert.equal(Object.keys(h.api.ownReactions).length, 0); h.unmount();
  }
});
test("role demotion or post removal hides both loaded and pending private details", async () => {
  for (const pending of [false, true]) {
    for (const change of [{ role: "member" }, { posts: [] }, { isOffline: true }]) {
      const request = deferred(), h = harness({ details: () => request.promise });
      const reading = h.api.openDetails("post", "👍"); h.render();
      if (!pending) { request.resolve({ author: "👍" }); await reading; h.render(); }
      h.change(change); assert.equal(h.api.details, null);
      if (pending) { request.resolve({ author: "👍" }); await reading; h.render(); assert.equal(h.api.details, null); }
      h.unmount();
    }
  }
});
test("failed reads expose a retry state and double sends share one pending operation", async () => {
  const send = deferred(), h = harness({ details: () => Promise.reject(new Error("permission-denied")), send: () => send.promise });
  await h.api.openDetails("post", "👍"); h.render(); assert.ok(h.api.details.error); assert.equal(Object.keys(h.api.details.reactors).length, 0);
  const first = h.api.submitReaction("post", "👍"), second = h.api.submitReaction("post", "🔥");
  assert.equal(h.calls.sends.length, 1); send.resolve({ added: true, emoji: "👍" }); await Promise.all([first, second]); h.unmount();
});
test("late receipt and send results cannot change the next team", async () => {
  const own = deferred(), send = deferred(), h = harness({ own: () => own.promise, send: () => send.promise });
  const reading = h.api.prepareReaction("post"); h.change({ teamId: "next" }); own.resolve("🔥");
  assert.equal(await reading, false); h.render(); assert.equal(Object.keys(h.api.ownReactions).length, 0);
  const sending = h.api.submitReaction("post", "👍"); h.change({ teamId: "last" }); send.resolve({ added: true, emoji: "👍" });
  assert.equal(await sending, null); h.render(); assert.equal(Object.keys(h.api.ownReactions).length, 0); h.unmount();
});
test("sender grouping uses existing UID profiles and keeps unnamed identities without guessing", () => {
  const senders = utils.workspaceReactionSenders({ a: "👍", b: "🔥", removed: "👍" }, "👍", { A: { uid: "a", name: "A" }, B: { uid: "b", name: "B" } });
  assert.equal(senders.length, 2); assert.equal(senders.find((item) => item.uid === "a").name, "A");
  assert.equal(senders.find((item) => item.uid === "removed").name, "退会済み・名称未設定");
  assert.notEqual(utils.workspaceReactionReceiptId("a:b", "c"), utils.workspaceReactionReceiptId("a", "b:c"));
});
test("the modal keeps its opening count when later public updates arrive, without rereading senders", async () => {
  const request = deferred(), h = harness({ details: () => request.promise });
  h.change({ posts: [{ id: "post", authorUid: "author", reactions: { "👍": 1 } }] });
  const reading = h.api.openDetails("post", "👍"); h.render();
  h.change({ posts: [{ id: "post", authorUid: "author", reactions: { "👍": 2 } }] });
  request.resolve({ author: "👍" }); await reading; h.render();
  assert.equal(h.api.details.count, 1); assert.equal(h.calls.details.length, 1); h.unmount();
});
test("migration CLI defaults to a bounded dry run and rejects mismatched or unbounded options", () => {
  const { parseOptions } = require("../../scripts/migrateWorkspaceReactions.cjs");
  const args = ["--project", "synthetic", "--team", "team", "--checkpoint", "synthetic.json"];
  assert.equal(parseOptions(args).apply, false); assert.equal(parseOptions(args).maxPages, 1);
  assert.equal(parseOptions([...args, "--apply"]).apply, true);
  assert.throws(() => parseOptions([...args, "--max-pages", "1000"]));
  assert.throws(() => parseOptions(["--project", "synthetic"]));
  assert.equal(utils.workspaceReactionReceiptId("a:b", "c/d"), require("../../functions/workspaceReactionBackend").receiptId("a:b", "c/d"));
});
test("the actual account deletion handler revokes membership before cleaning reaction identities", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
  const ast = require("@babel/parser").parse(source, { sourceType: "script" });
  const declaration = ast.program.body.find((node) => node.expression?.left?.object?.name === "exports" && node.expression.left.property?.name === "deleteUserAccount");
  const handler = declaration.expression.right.arguments[1];
  const events = [], entry = { teamId: "synthetic", teamRef: { id: "synthetic" }, memberRef: "member", memberSnap: { exists: true } };
  let memberExists = true;
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const remove = async (name) => { events.push(name); return 0; };
  const fn = vm.runInNewContext(`(${source.slice(handler.start, handler.end)})`, {
    HttpsError, assertRecentAuthentication() {}, assertAccountDeletionEligible() {},
    getAccountDeletionContext: async () => ({ teamEntries: [entry], userRef: "user" }),
    deleteNonSafetySupportCasesForAccount: () => remove("support"), removeAccountFromBlockLists: () => remove("blocks"),
    anonymizeAccountDataInTeam: () => remove("content"), anonymizeAccountStorageInTeam: () => remove("storage"),
    tacticalNotes: { anonymizeTeam: () => remove("notes") }, loadingOptimization: { anonymizeTeam: () => remove("reads") },
    workspaceReactions: { async anonymizeTeam() { assert.equal(memberExists, false, "reaction writes must be revoked before sender cleanup"); events.push("reactions"); return 1; } },
    firestore: { bulkWriter: () => ({ delete() { events.push("membershipQueued"); }, async close() { memberExists = false; events.push("membershipRevoked"); } }),
      recursiveDelete: () => remove("userData") },
    removeNotificationPushTokenRegistrations: () => remove("tokens"), getAuth: () => ({ deleteUser: () => remove("auth") }), logger: { error() {} },
  });
  const result = await fn({ auth: { uid: "synthetic-user" } });
  assert.equal(result.deleted, true); assert.ok(events.indexOf("membershipRevoked") < events.indexOf("reactions"));
  assert.ok(events.indexOf("reactions") < events.indexOf("userData"));
});
test("service reads an own receipt and a single server-checked detail document, with no list query", async () => {
  const reads = [], sends = [];
  const service = load(path.join(__dirname, "workspaceReactionService.js"), {
    "firebase/firestore": { doc: (...args) => args, getDoc: async (ref) => { reads.push(["own", ref]); return { exists: () => true, data: () => ({ emoji: "👍" }) }; },
      getDocFromServer: async (ref) => { reads.push(["details", ref]); return { exists: () => true, data: () => ({ reactors: { member: "👍" } }) }; } },
    "firebase/functions": { httpsCallable: (_app, name) => async (data) => { sends.push({ name, data }); return { data: { added: true, emoji: data.emoji } }; } },
    "../firebase": { db: "db", cloudFunctions: "functions", auth: { currentUser: { uid: "member" } } }, "../utils/workspaceReactions": utils,
  });
  assert.equal(await service.getOwnWorkspaceReaction("team", "post", "member"), "👍");
  await service.getWorkspaceReactionDetails("team", "post"); await service.sendWorkspaceReaction("team", "post", "👍");
  assert.equal(reads.length, 2); assert.equal(reads[0][1].at(-1), "team:post"); assert.equal(reads[1][0], "details");
  assert.equal(sends[0].name, "sendWorkspaceReaction"); assert.equal(Object.hasOwn(sends[0].data, "uid"), false);
  await assert.rejects(service.getOwnWorkspaceReaction("team", "post", "other")); assert.equal(reads.length, 2);
});
