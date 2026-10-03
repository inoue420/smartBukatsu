const test = require("node:test");
const assert = require("node:assert/strict");
const { buildNoteClips, canReadNotes, canPostNotes, canManageNote, validateNote,
  noteClipKey, mergeNoteClips, toggleNoteClipSelection, buildNotePlaybackClips } = require("./tacticalNotes");

test("checkbox selection spans videos, excludes private/attached scenes and toggles independently", () => {
  const a = { projectId: "one", id: "same", url: "https://example.com/a", project: "A", originalLabel: "得点", start: 1, end: 4 };
  const b = { ...a, projectId: "two" };
  let selected = toggleNoteClipSelection([], a);
  selected = toggleNoteClipSelection(selected, b);
  assert.equal(selected.length, 2);
  assert.notEqual(noteClipKey(a), noteClipKey(b));
  assert.equal(toggleNoteClipSelection(selected, { ...a, id: "private", status: "private" }), selected);
  assert.equal(toggleNoteClipSelection(selected, { ...a, id: "attached" }, [noteClipKey({ ...a, id: "attached" })]), selected);
  selected = toggleNoteClipSelection(selected, a);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].projectId, "two");
  assert.equal(selected[0].sourceUrl, a.url);
});

test("note playback preserves saved order, intervals and comments independently of current tags", () => {
  const projects = fixture();
  const clips = buildNoteClips(projects, { videoIds: ["video"] }).reverse();
  clips[0].comment = "保存した指導";
  const note = { clips, authorName: "投稿者" };
  projects[0].tags = [];
  const playback = buildNotePlaybackClips(note, projects);
  assert.deepEqual(playback.map((c) => c.start), [38, 0]);
  assert.equal(playback[0].comment, "保存した指導");
  assert.equal(playback[0].url, projects[0].videoUrl);
  assert.equal(playback[0].originalLabel, "");
  assert.deepEqual(playback[0].labels, []);
  projects[0].videoUrl = "https://example.com/replaced";
  const unavailable = buildNotePlaybackClips(note, projects);
  assert.equal(unavailable[0].url, null);
  assert.equal(unavailable[0].comment, "保存した指導");
  assert.equal(unavailable.length, clips.length);
  assert.equal(buildNotePlaybackClips(note, [])[0].url, null);
});

test("adding selected scenes preserves existing order and comments and never mutates input", () => {
  const existing = [{ projectId: "one", tagId: "a", start: 1, end: 4, comment: "既存コメント" }];
  const next = { projectId: "two", tagId: "b", start: 5, end: 8, comment: "" };
  const result = mergeNoteClips(existing, [{ ...existing[0], start: 99 }, next, next]);
  assert.equal(result.length, 2);
  assert.equal(result[0], existing[0]);
  assert.equal(result[0].comment, "既存コメント");
  assert.equal(result[0].start, 1);
  assert.equal(existing.length, 1);
  assert.equal(result[1].tagId, "b");
  const full = Array.from({ length: 100 }, (_, i) => ({ ...next, tagId: String(i) }));
  assert.throws(() => mergeNoteClips(full, [next]), /100/);
  assert.throws(() => toggleNoteClipSelection([], next, full.map(noteClipKey)), /100/);
});

test("note permissions exclude guardians and default member posting to off", () => {
  for (const role of ["owner", "admin", "staff", "captain"]) {
    assert.equal(canReadNotes({ role }), true);
    assert.equal(canPostNotes({ role }), true);
  }
  assert.equal(canReadNotes({ role: "member" }), true);
  assert.equal(canPostNotes({ role: "member" }), false);
  assert.equal(canPostNotes({ role: "member", canPostTacticalNotes: true }), true);
  for (const role of ["guardian", "unknown", undefined]) {
    assert.equal(canReadNotes({ role }), false);
    assert.equal(canPostNotes({ role, canPostTacticalNotes: true }), false);
    assert.equal(canManageNote({ role }, "author", { authorUid: "author" }), false);
  }
  assert.equal(canManageNote({ role: "member" }, "author", { authorUid: "author" }), true);
  assert.equal(canManageNote({ role: "staff" }, "other", { authorUid: "author" }), false);
  assert.equal(canManageNote({ role: "admin" }, "other", { authorUid: "author" }), true);
});

const fixture = () => [{ id: "video", title: "試合", videoUrl: "https://example.com/video.mp4", clipPreSeconds: 5, clipPostSeconds: 3, tags: [
  { id: "a", label: "得点 + 速攻", videoTime: 2, status: "shared" },
  { id: "b", label: "得点", videoTime: 40, useCustomClipDuration: true, preSeconds: 2, postSeconds: 6 },
  { id: "c", label: "守備", videoTime: 60, status: "private", user: "author" },
] }];
test("OR/AND use public tags, preserve custom intervals and never mutate source", () => {
  const projects = fixture(), original = JSON.stringify(projects), source = { videoIds: ["video"] };
  const all = buildNoteClips(projects, source);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((c) => [c.start, c.end]), [[0, 5], [38, 46]]);
  assert.equal(buildNoteClips(projects, source, ["得点", "速攻"], "AND").length, 1);
  assert.equal(buildNoteClips(projects, source, ["得点", "速攻"], "OR").length, 2);
  assert.equal(buildNoteClips(projects, source, ["守備"]).length, 0);
  assert.equal(JSON.stringify(projects), original);
  all[0].comment = "指導";
  projects[0].tags[0].videoTime = 90;
  projects[0].tags = [];
  assert.equal(all[0].start, 0);
  assert.equal(all[0].comment, "指導");
  projects[0].videoUrl = "https://example.com/replaced.mp4";
  assert.equal(all[0].sourceUrl, "https://example.com/video.mp4");
});

// Execute screen callbacks with mocked navigation boundaries.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { parse } = require("@babel/parser");

test("inline comment save updates only the description and timestamp", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../services/firestoreService.js"), "utf8");
  const ast = parse(source, { sourceType: "module" });
  const fn = ast.program.body.find((n) => n.declaration?.id?.name === "updateTacticalNoteDescription").declaration;
  const calls = [];
  const save = vm.runInNewContext(`(${source.slice(fn.start, fn.end)})`, {
    db: {}, doc: (...args) => args.slice(1), serverTimestamp: () => "timestamp",
    updateDoc: async (ref, payload) => calls.push({ ref, payload }),
  });
  await save("team", "note", "動画を見ながら入力");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), {
    ref: ["teams", "team", "tacticalNotes", "note"],
    payload: { description: "動画を見ながら入力", updatedAt: "timestamp" },
  });
  await save("team", "note", "");
  assert.equal(calls[1].payload.description, "");
  assert.throws(() => save("team", "note", "a".repeat(5001)));
  assert.equal(calls.length, 2);
});

test("failed inline comment save retains the draft and restores the save button", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../screens/TacticalNotesScreen.js"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const body = ast.program.body.find((n) => n.type === "ExportDefaultDeclaration").declaration.body.body;
  const fn = body.flatMap((n) => n.declarations || []).find((n) => n.id.name === "saveComment").init;
  const busyStates = [], alerts = [];
  const save = vm.runInNewContext(`(${source.slice(fn.start, fn.end)})`, {
    busy: false, commentEdit: { value: "残す入力" }, selected: { id: "note" },
    profile: {}, currentUserUid: "author", activeTeamId: "team", canManageNote: () => true,
    updateTacticalNoteDescription: async () => { throw { code: "unavailable" }; },
    setBusy: (value) => busyStates.push(value), setCommentEdit: () => assert.fail("draft must survive failure"),
    Keyboard: { dismiss: () => assert.fail("keep editing on failure") }, Alert: { alert: (...args) => alerts.push(args) },
  });
  await save();
  assert.deepEqual(busyStates, [true, false]);
  assert.equal(alerts.length, 1);
});
test("missing/deleted videos and invalid intervals are not attachment candidates", () => {
  const projects = fixture();
  assert.deepEqual(buildNoteClips(projects, null), []);
  projects[0].status = "deleted";
  assert.deepEqual(buildNoteClips(projects, { videoIds: ["video"] }), []);
  delete projects[0].status;
  projects[0].tags = [{ id: "bad", label: "a", videoTime: NaN }];
  assert.deepEqual(buildNoteClips(projects, { videoIds: ["video"] }), []);
});
test("validation rejects empty notes, bad intervals and oversized content", () => {
  const data = { title: "指導", description: "説明", clips: buildNoteClips(fixture(), { videoIds: ["video"] }) };
  assert.doesNotThrow(() => validateNote(data));
  assert.throws(() => validateNote({ ...data, title: " " }));
  assert.throws(() => validateNote({ ...data, clips: [] }));
  assert.throws(() => validateNote({ ...data, clips: Array(101).fill(data.clips[0]) }));
  assert.throws(() => validateNote({ ...data, clips: [{ ...data.clips[0], end: 0 }] }));
  assert.throws(() => validateNote({ ...data, clips: [{ ...data.clips[0], comment: "a".repeat(2001) }] }));
});

test("returning from the picker appends scenes while preserving the actual editor draft", () => {
  const source = fs.readFileSync(path.join(__dirname, "../screens/TacticalNotesScreen.js"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const statements = ast.program.body.find((n) => n.type === "ExportDefaultDeclaration").declaration.body.body;
  const effect = statements.map((n) => n.expression).find((n) => n?.callee?.name === "useEffect" &&
    source.slice(n.start, n.end).includes("const result = route.params?.noteAttachmentResult"));
  const clip = buildNoteClips(fixture(), { videoIds: ["video"] })[0];
  const draft = { title: "入力中のタイトル", description: "説明", assigneeUids: ["member"], clips: [{ ...clip, comment: "保持する指導" }], sourceProjectId: "old" };
  const result = { teamId: "team", sourceId: "new", clips: [clip, { ...clip, tagId: "new" }] };
  let saved, cleared = false;
  const context = vm.createContext({
    route: { params: { noteAttachmentResult: result } }, draft, activeTeamId: "team", readable: true,
    sourceId: "old", mergeNoteClips, setDraft: (value) => { saved = value; }, setSourceId() {},
    navigation: { setParams: () => { cleared = true; } }, Alert: { alert: () => assert.fail("unexpected error") },
  });
  const run = () => vm.runInContext(`(${source.slice(effect.arguments[0].start, effect.arguments[0].end)})`, context)();
  run();
  assert.equal(cleared, true);
  assert.equal(saved.title, draft.title);
  assert.equal(saved.description, draft.description);
  assert.equal(saved.assigneeUids, draft.assigneeUids);
  assert.equal(saved.clips.length, 2);
  assert.equal(saved.clips[0].comment, "保持する指導");
  saved = undefined;
  context.activeTeamId = "different-team";
  run();
  assert.equal(saved, undefined);
  context.activeTeamId = "team";
  context.route.params.noteAttachmentResult = undefined;
  run();
  assert.equal(saved, undefined); // Cancellation returns without any draft changes.
});

test("picker confirmation targets the originating note and rejects newly private selections", () => {
  const source = fs.readFileSync(path.join(__dirname, "../screens/ProjectListScreen.js"), "utf8");
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const statements = ast.program.body.flatMap((n) => n.declarations || []).find((n) => n.id.name === "ProjectListScreen").init.body.body;
  const fn = statements.flatMap((n) => n.declarations || []).find((n) => n.id.name === "handleConfirmNoteSelection").init;
  const projects = fixture(), clips = buildNoteClips(projects, { videoIds: ["video"] });
  const calls = [];
  const context = vm.createContext({
    noteSelectionEnabled: true, noteSelection: clips, projects, buildNoteClips, noteClipKey,
    notePicker: { returnKey: "original-note-route" }, activeTeamId: "team", selectedHighlightProjectId: "project",
    requestClipTransition: () => calls.push("stop"), setIsPlaying() {}, setHasReachedPlaylistEnd() {},
    setNoteSelection: (items) => { context.noteSelection = items; },
    CommonActions: { setParams: (params) => ({ type: "SET_PARAMS", payload: { params } }) },
    navigation: { dispatch: (action) => calls.push(action), goBack: () => calls.push("back") },
    Alert: { alert: () => calls.push("alert") },
  });
  const run = () => vm.runInContext(`(${source.slice(fn.start, fn.end)})`, context)();
  run();
  assert.equal(calls[0], "stop");
  assert.equal(calls[1].source, "original-note-route");
  assert.equal(calls[1].payload.params.noteAttachmentResult.clips.length, 2);
  assert.equal(calls[2], "back");
  calls.length = 0;
  projects[0].tags[0].status = "private";
  run();
  assert.deepEqual(calls, ["alert"]);
  assert.equal(context.noteSelection.length, 1);
});
