const test = require("node:test");
const assert = require("node:assert/strict");
const { noteSummary, contentFingerprint, validateTasks, validateNote, canReadNotes,
  getNoteConfirmationSelection, noteAcknowledgementId, hasNoteAcknowledgement, isNoteSummaryCurrent, summaryFromIndex } = require("./tacticalNotes");
const time = (n) => ({ toMillis: () => n });
const task = { text: "練習する", assigneeUids: ["a", "b"], dueDate: "2026-10-02", clipKey: "", revision: 2 };
const note = { title: "指導", description: "説明", assigneeUids: ["a", "b"], contentVersion: 2, clips: [], images: [{ id: "image" }], tasks: { task } };
test("reconfirmation excludes earlier versions while preserving question history", () => {
  const responses = [{ uid: "a", version: 1, status: "question", createdAt: time(3) },
    { uid: "a", version: 2, status: "read", createdAt: time(4) }, { uid: "a", version: 2, status: "understood", createdAt: time(5) }];
  const summary = noteSummary(note, responses, [], "a", "2026-10-03");
  assert.equal(summary.confirmed, 1); assert.deepEqual(summary.pending, ["b"]);
  assert.equal(summary.latest.a.status, "understood"); assert.deepEqual(summary.questions, []);
  assert.equal(noteSummary({ ...note, contentVersion: 3 }, responses, [], "a").confirmed, 0);
  assert.equal(responses.length, 3);
});
test("multiple assignees remain independent without deadlines and task revisions reset progress", () => {
  const progress = [{ taskId: "task", uid: "a", taskRevision: 2, status: "done" }, { taskId: "task", uid: "b", taskRevision: 1, status: "done" }];
  const summary = noteSummary(note, [], progress, "a", "2026-10-03");
  assert.equal(summary.items[0].done, true); assert.equal(summary.items[1].done, false);
  assert.equal(summary.unfinished, true); assert.equal(summary.completed, false);
  assert.equal("overdue" in summary.items[1], false);
  progress[1] = { ...progress[1], taskRevision: 2 };
  assert.equal(noteSummary(note, [], progress, "a").completed, true);
  progress[0].status = "returned";
  assert.equal(noteSummary(note, [], progress, "a").completed, false);
});
test("unassigned notes have no confirmation obligation; task assignment still makes a note personal", () => {
  const summary = noteSummary({ ...note, assigneeUids: [] }, [], [], "a");
  assert.equal(summary.unconfirmed, false); assert.equal(summary.mine, true);
  assert.equal(noteSummary({ ...note, tasks: {} }, [], [], "other").completed, false);
});
test("content fingerprint ignores task-only edits and detects image, scene, target and description changes", () => {
  assert.equal(contentFingerprint(note), contentFingerprint({ ...note, tasks: {} }));
  for (const patch of [{ description: "変更" }, { images: [] }, { assigneeUids: [] }, { clips: [{ projectId: "v", tagId: "t" }] }]) {
    assert.notEqual(contentFingerprint(note), contentFingerprint({ ...note, ...patch }));
  }
});
test("image-only notes and optional tasks are valid; legacy deadline and scene fields are ignored while foreign assignees are rejected", () => {
  assert.doesNotThrow(() => validateNote(note)); assert.doesNotThrow(() => validateTasks({}, [], []));
  assert.doesNotThrow(() => validateTasks({ task }, [], ["a", "b"]));
  assert.doesNotThrow(() => validateTasks({ task: { text: task.text, assigneeUids: task.assigneeUids } }, [], ["a", "b"]));
  assert.doesNotThrow(() => validateTasks({ task: { ...task, dueDate: "invalid", clipKey: "removed" } }, [], ["a", "b"]));
  for (const patch of [{ assigneeUids: ["outsider"] }, { assigneeUids: [] }, { text: " " }]) {
    assert.throws(() => validateTasks({ task: { ...task, ...patch } }, [], ["a", "b"]));
  }
});
test("confirmation bulk selection includes only captains and members, while guardians are hidden from candidates", () => {
  const profiles = ["owner", "admin", "staff", "captain", "member", "guardian"].map((role) => ({ uid: role, role }));
  const candidates = profiles.filter(canReadNotes);
  assert.deepEqual(candidates.map((person) => person.uid), ["owner", "admin", "staff", "captain", "member"]);
  const selection = getNoteConfirmationSelection(candidates, ["member", "captain"]);
  assert.deepEqual(selection, { allUids: ["captain", "member"], allSelected: true });
  for (const selected of [[], ["captain"], ["captain", "member", "staff"], ["captain", "member", "owner", "admin"]]) {
    assert.equal(getNoteConfirmationSelection(candidates, selected).allSelected, false);
  }
  assert.deepEqual(getNoteConfirmationSelection(profiles.filter((person) => !["captain", "member"].includes(person.role))), { allUids: [], allSelected: false });
});
test("each acknowledgement is once per person and content version, even after a later question", () => {
  const responses = [{ uid: "a", version: 2, status: "read", createdAt: time(1) },
    { uid: "a", version: 2, status: "question", createdAt: time(3) },
    { uid: "a", version: 1, status: "understood" }, { uid: "b", version: 2, status: "understood" }];
  assert.equal(hasNoteAcknowledgement(note, responses, "a", "read"), true);
  assert.equal(hasNoteAcknowledgement(note, responses, "a", "understood"), false);
  assert.equal(hasNoteAcknowledgement(note, responses, "b", "read"), false);
  assert.equal(hasNoteAcknowledgement(note, responses, "b", "understood"), true);
  assert.equal(hasNoteAcknowledgement(note, responses, "a", "question"), false);
  assert.equal(hasNoteAcknowledgement({ ...note, contentVersion: 3 }, responses, "a", "read"), false);
  assert.equal(hasNoteAcknowledgement({ ...note, contentVersion: undefined }, responses, "a", "understood"), true);
  assert.equal(hasNoteAcknowledgement(note, undefined, "a", "read"), false);
  const ids = [noteAcknowledgementId(note, "a", "read"), noteAcknowledgementId(note, "a", "understood"),
    noteAcknowledgementId(note, "b", "read"), noteAcknowledgementId({ ...note, contentVersion: 3 }, "a", "read")];
  assert.equal(new Set(ids).size, 4);
});

const fs = require("node:fs"), vm = require("node:vm"), { parse } = require("@babel/parser");
const serviceSource = fs.readFileSync(require("node:path").join(__dirname, "../services/firestoreService.js"), "utf8");
const serviceAst = parse(serviceSource, { sourceType: "module" });
const serviceFunction = (name, context) => {
  const fn = serviceAst.program.body.find((node) => node.declaration?.id?.name === name).declaration;
  return vm.runInNewContext(`(${serviceSource.slice(fn.start, fn.end)})`, {timestampsEqual: require("./tacticalNotes").timestampsEqual, ...context});
};
test("acknowledgement transactions reject stale versions and removed targets, and do not overwrite existing records", async () => {
  let current = { ...note, contentVersion: 3 }, exists = false;
  const writes = [];
  const save = serviceFunction("recordTacticalNoteResponse", { db: {}, auth: { currentUser: { uid: "a" } },
    noteAcknowledgementId, hasNoteAcknowledgement, isNoteSummaryCurrent, limit: (...args) => args,
    doc: (...args) => args.includes("tacticalNoteSummaries") ? "index" : args.at(-1), collection: (...args) => args, query: (...args) => args, where: (...args) => args,
    getDocs: async () => ({ docs: [] }), serverTimestamp: () => "timestamp",
    runTransaction: async (_db, operation) => operation({
      get: async (ref) => ref === "note" ? { data: () => current } : ref === "index" ? { data: () => ({ schemaVersion: 1, contentVersion: current?.contentVersion }) } : { exists: () => exists },
      set: (ref, data) => writes.push({ ref, data }),
    }),
  });
  const viewed = { ...note, id: "note" };
  await assert.rejects(save("team", viewed, "read"), /変更/);
  current = { ...note, assigneeUids: ["b"] };
  await assert.rejects(save("team", viewed, "read"), /変更/);
  current = undefined;
  await assert.rejects(save("team", viewed, "read"), /変更/);
  assert.equal(writes.length, 0);
  current = note; exists = true;
  await save("team", viewed, "read"); assert.equal(writes.length, 0);
  exists = false;
  await save("team", viewed, "read");
  assert.equal(writes.length, 1); assert.equal(writes[0].ref, noteAcknowledgementId(note, "a", "read"));
  assert.equal(writes[0].data.uid, "a"); assert.equal(writes[0].data.version, 2);
  assert.equal(writes[0].data.status, "read"); assert.equal(writes[0].data.createdAt, "timestamp");
});

function mountConfirmationDetail(saveResponse) {
  const slots = []; let cursor = 0, tree;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useEffect() {},
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
  };
  const alerts = [], modules = {
    react: { __esModule: true, default: react, ...react },
    "react-native": { View: "View", Text: "Text", TextInput: "TextInput", TouchableOpacity: "TouchableOpacity", Image: "Image",
      StyleSheet: { create: (value) => value }, Alert: { alert: (...args) => alerts.push(args) } },
    "expo-image-picker": {}, "../services/tacticalNoteAttachmentService": {},
    "../services/firestoreService": { recordTacticalNoteResponse: saveResponse },
    "../utils/tacticalNotes": require("./tacticalNotes"),
  };
  const source = fs.readFileSync(require("node:path").join(__dirname, "../components/TacticalNotePhaseTwo.js"), "utf8");
  const code = require("@babel/core").transformSync(source, { configFile: false, babelrc: false,
    plugins: ["@babel/plugin-transform-react-jsx", "@babel/plugin-transform-modules-commonjs"] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => {
    assert.ok(modules[name], `Unexpected import: ${name}`); return modules[name];
  } });
  const props = { summaryIndex: {schemaVersion: 1, contentVersion: 2, readUids: [], understoodUids: []}, teamId: "team", note: { ...note, id: "note", tasks: {}, images: [] }, activity: {}, uid: "a",
    names: (uids) => uids.join(","), onBusyChange() {}, onDirtyChange() {} };
  const find = (title, node = tree) => {
    if (!node || typeof node !== "object") return null;
    if (node.props?.title === title) return node.type(node.props);
    for (const child of (Array.isArray(node) ? node : node.children || [])) { const found = find(title, child); if (found) return found; }
    return null;
  };
  return { props, alerts, button: find, render() { cursor = 0; tree = module.exports.PhaseTwoDetail(props); } };
}
test("confirmation buttons stay disabled before subscription catches up, and a new version re-enables both", async () => {
  let resolve, calls = 0;
  const detail = mountConfirmationDetail(() => { calls++; return new Promise((done) => { resolve = done; }); });
  detail.render(); assert.equal(detail.button("確認しました").props.disabled, false);
  const saving = detail.button("確認しました").props.onPress();
  detail.render(); assert.equal(detail.button("確認しました").props.disabled, true);
  assert.equal(detail.button("理解しました").props.disabled, true);
  resolve(); await saving; detail.render();
  assert.equal(detail.button("確認しました").props.disabled, true);
  assert.equal(detail.button("理解しました").props.disabled, false);
  const understanding = detail.button("理解しました").props.onPress(); resolve(); await understanding; detail.render();
  assert.equal(detail.button("理解しました").props.disabled, true); assert.equal(calls, 2);
  detail.props.note = { ...detail.props.note, contentVersion: 3 }; detail.render();
  assert.equal(detail.button("確認しました").props.disabled, false);
  assert.equal(detail.button("理解しました").props.disabled, false);
});
test("confirmation buttons use all history for the same version and keep question sending available", () => {
  const detail = mountConfirmationDetail(async () => {});
  detail.props.activity.responses = [{ uid: "a", version: 2, status: "read" }, { uid: "a", version: 2, status: "question" }, { uid: "a", version: 1, status: "understood" }];
  detail.render(); assert.equal(detail.button("確認しました").props.disabled, true);
  assert.equal(detail.button("理解しました").props.disabled, false);
  detail.props.uid = "b"; detail.render();
  assert.equal(detail.button("確認しました").props.disabled, false);
  assert.ok(detail.button("質問があります：送信"));
});
test("failed confirmation saves leave the button available for retry", async () => {
  let fail = true;
  const detail = mountConfirmationDetail(async () => { if (fail) throw new Error("通信失敗"); });
  detail.render(); await detail.button("確認しました").props.onPress(); detail.render();
  assert.equal(detail.alerts.length, 1); assert.equal(detail.button("確認しました").props.disabled, false);
  fail = false; await detail.button("確認しました").props.onPress(); detail.render();
  assert.equal(detail.button("確認しました").props.disabled, true);
});
test("stale task screen cannot complete a revised task, and valid completion writes individual state and history atomically", async () => {
  const writes = [];
  const save = serviceFunction("recordTacticalTaskProgress", { db: {}, auth: { currentUser: { uid: "a" } },
    doc: (...args) => args, collection: (...args) => args, serverTimestamp: () => "timestamp",
    runTransaction: async (_db, operation) => operation({ get: async () => ({ data: () => note }), set: (ref, data) => writes.push({ ref, data }) }),
  });
  await assert.rejects(save("team", "note", "task", "a", "done", "", 1), /変更/); assert.equal(writes.length, 0);
  await save("team", "note", "task", "a", "done", "完了コメント", 2);
  assert.equal(writes.length, 2); assert.equal(writes[0].data.uid, "a");
  assert.equal(writes[0].data.completedAt, "timestamp"); assert.equal(writes[0].data.comment, "完了コメント");
  assert.deepEqual(JSON.parse(JSON.stringify(writes[1].data)), { ...writes[0].data, taskText: task.text });
});
test("note save increments task revisions independently and rejects stale editor content", async () => {
  let current = { ...note, updatedAt: time(10), authorUid: "author" }, writes = [];
  const save = serviceFunction("saveTacticalNote", { db: {}, auth: { currentUser: { uid: "author" } }, validateNote, validateTasks, contentFingerprint,
    doc: (...args) => ({ id: "note", args }), collection: (...args) => args, serverTimestamp: () => "timestamp",
    getDoc: async () => ({ data: () => current, exists: () => true }),
    runTransaction: async (_db, operation) => operation({ get: async () => ({ data: () => current, exists: () => true }), update: (_ref, data) => writes.push(data) }),
    deleteTacticalNoteImages: async () => {},
  });
  await save("team", "note", { ...note, sourceProjectId: "" }, "投稿者", ["a", "b"]);
  assert.equal(writes[0].tasks.task.revision, 2);
  assert.equal("dueDate" in writes[0].tasks.task, false);
  assert.equal("clipKey" in writes[0].tasks.task, false);
  writes = [];
  const draft = { ...note, sourceProjectId: "", baseUpdatedAt: time(10), tasks: { task: { ...task, text: "変更した練習" } } };
  await save("team", "note", draft, "投稿者", ["a", "b"]);
  assert.equal(writes[0].contentVersion, 2); assert.equal(writes[0].tasks.task.revision, 3);
  writes = []; current = { ...current, updatedAt: time(20) };
  await assert.rejects(save("team", "note", draft, "投稿者", ["a", "b"]), /変更/); assert.equal(writes.length, 0);
});

