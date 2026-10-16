const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const vm = require("node:vm");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { createGuardianAbsenceBackend, membershipKey } = require("../../functions/guardianAbsenceBackend");
const project = "demo-guardian-absence", host = "127.0.0.1:8193";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== project) throw new Error("Use the dedicated local demo emulator.");

test("guardian linking, attendance, rules, lifecycle and concurrent writes on real Firestore", async (t) => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${project}:securityRules`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId: project }, "guardian-server"), db = admin.getFirestore(serverApp), clients = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  let clock = Date.parse("2099-01-01T00:00:00+09:00");
  const backend = createGuardianAbsenceBackend({ firestore: db, FieldValue: admin.FieldValue, HttpsError, now: () => clock });
  const root = db.collection("teams").doc("team"), members = root.collection("members"), events = root.collection("clubEvents");
  const call = (method, uid, data = {}) => backend[method]({ auth: { uid }, data: { teamId: "team", ...data } });
  const link = (uid, guardianUid = "parent", childUids = ["child", "sibling"]) => call("setChildren", uid, { guardianUid, childUids });
  const send = (uid, targetUid = "child", overrides = {}) => call("submit", uid, { eventId: "event", date: "2099-01-10", targetUid, text: "Synthetic absence", ...overrides });
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  const client = (uid) => {
    const app = initializeApp({ projectId: project, apiKey: "emulator-only", appId: "emulator-only" }, `guardian-${uid}`), value = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8193, { mockUserToken: { sub: uid } }); clients.push({ app, db: value }); return value;
  };
  const commentData = { date: "2099-01-10", endDate: "2099-01-10", status: "active", startTime: "09:00", absenceComments: [] };
  try {
    await root.set({ name: "Synthetic team", createdBy: "owner", absenceDeadlineDaysBefore: 3 });
    for (const [uid, role] of [["owner", "owner"], ["admin", "admin"], ["staff", "staff"], ["captain", "captain"],
      ["child", "member"], ["sibling", "member"], ["other", "member"], ["parent", "guardian"], ["parent2", "guardian"]]) {
      await members.doc(uid).set({ name: uid === "child" || uid === "sibling" ? "Same synthetic name" : uid, role });
      await db.collection("users").doc(uid).set({ activeTeamId: "team" });
    }
    await events.doc("event").set(commentData);
    const parent = client("parent"), child = client("child"), staff = client("staff"), captain = client("captain"), outsider = client("outsider");
    const m = (value, uid) => sdk.doc(value, "teams", "team", "members", uid), e = (value, id = "event") => sdk.doc(value, "teams", "team", "clubEvents", id);

    await t.test("only managers link same-team members, captains and staff; guardians and supervisors cannot be children", async () => {
      for (const uid of ["parent", "child", "captain", "outsider"]) await denied(link(uid));
      await denied(call("setChildren", "parent", { uid: "owner", guardianUid: "parent", childUids: ["child"] }));
      for (const target of ["owner", "admin", "parent2", "missing"]) await assert.rejects(link("owner", "parent", [target]), (error) => error.code === "failed-precondition");
      for (const uid of ["owner", "admin", "staff"]) await link(uid, "parent", ["child", "sibling", "captain", "staff"]);
      await link("owner"); await link("owner", "parent2", ["child"]);
      const data = (await members.doc("parent").get()).data();
      assert.deepEqual(data.childUids, ["child", "sibling"]);
      assert.equal(data.childMemberships.child, membershipKey(await members.doc("child").get()));
    });
    await t.test("client cannot forge links, elevate calendar permissions, bypass proxy checks or change the event", async () => {
      for (const value of [parent, child, staff]) await denied(sdk.updateDoc(m(value, "parent"), { childUids: ["other"] }));
      await denied(sdk.updateDoc(m(parent, "parent"), { childMemberships: {} }));
      await denied(sdk.updateDoc(m(child, "child"), { canEditCalendar: true }));
      for (const value of [parent, child]) {
        await denied(sdk.updateDoc(e(value), { absenceComments: [{ uid: "other" }] }));
        await denied(sdk.updateDoc(e(value), { title: "forged" }));
        await denied(sdk.deleteDoc(e(value)));
        await denied(sdk.setDoc(e(value, "forged"), { ...commentData, absenceComments: [] }));
      }
      await denied(sdk.getDoc(e(outsider)));
      await sdk.getDoc(e(parent)); await sdk.updateDoc(m(child, "child"), { name: "Same synthetic name" });
      await sdk.updateDoc(e(staff), { title: "Synthetic revised event" });
      await sdk.updateDoc(e(captain), { description: "Synthetic captain edit" });
      await members.doc("child").update({ canEditCalendar: true });
      await sdk.updateDoc(e(child), { description: "Synthetic explicitly allowed edit" });
      await members.doc("child").update({ canEditCalendar: false });
      await db.collection("invites").doc("ABC123").set({ teamId: "team", active: true });
      const joiner = client("joiner");
      await denied(sdk.setDoc(m(joiner, "joiner"), { role: "member", inviteCode: "ABC123", canEditCalendar: true }));
      await denied(sdk.setDoc(m(joiner, "joiner"), { role: "member", inviteCode: "ABC123", childUids: ["child"] }));
      await sdk.setDoc(m(joiner, "joiner"), { role: "member", inviteCode: "ABC123" });
    });
    await t.test("unlinked, different-team, nonmember and forged-actor requests fail", async () => {
      await denied(send("parent", "other")); await denied(send("child", "sibling")); await denied(send("outsider"));
      await denied(send("parent", "other", { uid: "owner" }));
      await db.collection("teams").doc("other-team").collection("members").doc("outside-child").set({ role: "member" });
      await assert.rejects(link("owner", "parent", ["outside-child"]), (error) => error.code === "failed-precondition");
      await denied(call("submit", "parent", { teamId: "other-team", eventId: "event", targetUid: "outside-child", date: "2099-01-10", text: "Synthetic" }));
    });
    await t.test("proxy records preserve target and authenticated sender; siblings with identical names stay distinct", async () => {
      const a = await send("parent"), b = await send("parent", "sibling");
      assert.equal(a.comment.uid, "child"); assert.equal(a.comment.submittedBy.uid, "parent"); assert.equal(b.comment.uid, "sibling");
      assert.equal((await events.doc("event").get()).data().absenceComments.length, 2);
      assert.deepEqual(new Set(await backend.relatedTeamIds("child")), new Set(["team"]));
    });
    await t.test("duplicate child/parent submissions retain one record, including simultaneous sends", async () => {
      assert.equal((await send("child", "child")).added, false);
      assert.equal((await send("parent2")).added, false);
      await events.doc("concurrent").set(commentData);
      const results = await Promise.all([send("parent", "child", { eventId: "concurrent" }), send("parent2", "child", { eventId: "concurrent" }), send("parent", "sibling", { eventId: "concurrent" })]);
      assert.equal(results.filter((result) => result.added).length, 2);
      assert.equal((await events.doc("concurrent").get()).data().absenceComments.length, 2);
    });
    await t.test("other linked parent and child can cancel each other's report; unrelated member cannot", async () => {
      let comments = (await events.doc("event").get()).data().absenceComments;
      const first = comments.find((item) => item.uid === "child");
      await denied(call("cancel", "other", { eventId: "event", commentId: first.id }));
      await call("cancel", "parent2", { eventId: "event", commentId: first.id });
      assert.equal((await events.doc("event").get()).data().absenceComments.length, 1);
      const again = await send("child", "child");
      await call("cancel", "parent", { eventId: "event", commentId: again.comment.id });
      const third = await send("parent");
      await call("cancel", "child", { eventId: "event", commentId: third.comment.id });
      assert.equal((await call("cancel", "child", { eventId: "event", commentId: third.comment.id })).removed, false);
    });
    await t.test("legacy self-reports are visible, deduplicated and cancellable by a linked guardian", async () => {
      await events.doc("legacy").set({ ...commentData, absenceComments: [{ id: "old", uid: "child", user: "Old synthetic name", text: "Synthetic old reason" }] });
      assert.equal((await send("parent", "child", { eventId: "legacy" })).added, false);
      await call("cancel", "parent2", { eventId: "legacy", commentId: "old" });
      assert.deepEqual((await events.doc("legacy").get()).data().absenceComments, []);
    });
    await t.test("multi-day reports are separate per selected day and invalid dates are rejected", async () => {
      await events.doc("multi").set({ ...commentData, date: "2099-01-10", endDate: "2099-01-12", selectedDates: ["2099-01-10", "2099-01-12"] });
      await send("parent", "child", { eventId: "multi" });
      await send("parent", "child", { eventId: "multi", date: "2099-01-12" });
      await assert.rejects(send("parent", "child", { eventId: "multi", date: "2099-01-11" }), (error) => error.code === "failed-precondition");
      assert.equal((await events.doc("multi").get()).data().absenceComments.length, 2);
    });
    await t.test("actual event service preserves new reports during edits and atomically moves reports when splitting a day", async () => {
      const source = fs.readFileSync(path.join(__dirname, "firestoreService.js"), "utf8");
      const ast = require("@babel/parser").parse(source, { sourceType: "module" });
      const names = new Set(["createClubEvent", "updateClubEvent"]);
      const declarations = ast.program.body.filter((node) => node.type === "ExportNamedDeclaration" && names.has(node.declaration?.id?.name))
        .map((node) => source.slice(node.declaration.start, node.declaration.end)).join("\n");
      const dateHelper = ast.program.body.find((node) => node.declarations?.[0]?.id?.name === "clubAbsenceDate");
      const services = vm.runInThisContext(`(function({ doc, collection, setDoc, updateDoc, runTransaction, serverTimestamp, db }) {
        const eventLastDate = (data) => [...(data.selectedDates || [])].sort().at(-1) || data.endDate || data.date;
        ${source.slice(dateHelper.start, dateHelper.end)}
        ${declarations}\nreturn { createClubEvent, updateClubEvent }; })`)({ ...sdk, db: staff });
      await events.doc("editing").set({ ...commentData, selectedDates: ["2099-01-10", "2099-01-12"], endDate: "2099-01-12" });
      await send("parent", "child", { eventId: "editing" });
      await send("parent", "sibling", { eventId: "editing", date: "2099-01-12" });
      await services.updateClubEvent("team", "editing", { title: "Synthetic changed title", absenceComments: [] });
      assert.equal((await events.doc("editing").get()).data().absenceComments.length, 2, "a stale form cannot overwrite reports");
      await services.createClubEvent("team", { ...commentData, absenceComments: [] }, "split", {
        eventId: "editing", date: "2099-01-10", remainingEventData: { date: "2099-01-12", endDate: "2099-01-12", selectedDates: null, absenceComments: [] },
      });
      assert.equal((await events.doc("split").get()).data().absenceComments[0].uid, "child");
      assert.equal((await events.doc("editing").get()).data().absenceComments[0].uid, "sibling");
      await send("parent", "child", { eventId: "editing", date: "2099-01-12" });
      assert.equal((await events.doc("editing").get()).data().absenceComments.length, 2);
      await services.updateClubEvent("team", "editing", { date: "2099-01-13", endDate: "2099-01-13", absenceComments: [] }, "2099-01-12");
      assert.deepEqual((await events.doc("editing").get()).data().absenceComments, []);
    });
    await t.test("server deadline closes exactly at JST cutoff, uses per-day time and still permits cancellation", async () => {
      await events.doc("deadline").set(commentData);
      clock = Date.parse("2099-01-07T00:00:00+09:00") - 1;
      const report = await send("parent", "child", { eventId: "deadline" });
      clock++;
      await assert.rejects(send("parent", "sibling", { eventId: "deadline" }), (error) => error.code === "failed-precondition");
      await call("cancel", "parent2", { eventId: "deadline", commentId: report.comment.id });
      await root.update({ absenceDeadlineDaysBefore: 0 });
      await events.doc("deadline").update({ timeSchedules: { "2099-01-10": { start: "18:00" } } });
      clock = Date.parse("2099-01-10T17:59:59+09:00"); await send("parent", "child", { eventId: "deadline" });
      clock = Date.parse("2099-01-10T18:00:00+09:00");
      await assert.rejects(send("parent", "sibling", { eventId: "deadline" }), (error) => error.code === "failed-precondition");
      clock = Date.parse("2099-01-01T00:00:00+09:00"); await root.update({ absenceDeadlineDaysBefore: 3 });
    });
    await t.test("unlinking immediately rejects new sends and cancellation even with stale UI data", async () => {
      const existing = await send("parent");
      await link("staff", "parent", []);
      await denied(send("parent")); await denied(call("cancel", "parent", { eventId: "event", commentId: existing.comment.id }));
      await link("owner");
    });
    await t.test("role changes and member removal invalidate links, and same-UID rejoin cannot resurrect them", async () => {
      const before = await members.doc("child").get();
      await members.doc("child").update({ role: "guardian" });
      await denied(send("parent"));
      await backend.membershipChanged({ params: { teamId: "team", uid: "child" }, data: { before, after: await members.doc("child").get() } });
      assert.equal((await members.doc("parent").get()).data().childUids.includes("child"), false);
      await members.doc("child").update({ role: "member" }); await link("owner");
      const old = await members.doc("child").get(); await members.doc("child").delete();
      await denied(send("parent"));
      await members.doc("child").set({ name: "Synthetic rejoined child", role: "member" });
      await denied(send("parent"));
      await link("owner");
      await backend.membershipChanged({ params: { teamId: "team", uid: "child" }, data: { before: old, after: { exists: false } } });
      assert.equal((await members.doc("parent").get()).data().childUids.includes("child"), true, "delayed cleanup must retain a newly approved membership link");
      await send("parent");
      const guardianBefore = await members.doc("parent").get(); await members.doc("parent").update({ role: "member" });
      await denied(send("parent", "sibling"));
      await backend.membershipChanged({ params: { teamId: "team", uid: "parent" }, data: { before: guardianBefore, after: await members.doc("parent").get() } });
      assert.deepEqual((await members.doc("parent").get()).data().childUids, []);
      await members.doc("parent").update({ role: "guardian" }); await link("owner");
    });
    await t.test("deleted/pending events reject registration; account cleanup removes both identities and link keys", async () => {
      for (const status of ["deleted", "pending"]) {
        await events.doc("unavailable").set({ ...commentData, status });
        await assert.rejects(send("parent", "child", { eventId: "unavailable" }), (error) => error.code === "failed-precondition");
      }
      await backend.anonymizeTeam(root, "parent");
      for (const item of (await events.get()).docs) for (const comment of item.data().absenceComments || []) assert.notEqual(comment.submittedBy?.uid, "parent");
      await backend.anonymizeTeam(root, "child");
      for (const uid of ["parent", "parent2"]) {
        const profile = (await members.doc(uid).get()).data();
        assert.equal(profile.childUids.includes("child"), false); assert.equal(Object.hasOwn(profile.childMemberships, "child"), false);
      }
      for (const item of (await events.get()).docs) for (const comment of item.data().absenceComments || []) assert.notEqual(comment.uid, "child");
    });
  } finally {
    await Promise.all(clients.map(async (value) => { await sdk.terminate(value.db); await deleteApp(value.app); }));
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});

test("legacy app self-report compatibility preserves schedule, peer reports and proxy restrictions", async (t) => {
  const serverApp = adminApp.initializeApp({ projectId: project }, "legacy-absence-server"), db = admin.getFirestore(serverApp), clients = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const backend = createGuardianAbsenceBackend({ firestore: db, FieldValue: admin.FieldValue, HttpsError });
  const teamId = "legacy-team", root = db.collection("teams").doc(teamId), members = root.collection("members"), events = root.collection("clubEvents");
  const date = "2099-01-10", base = { date, endDate: date, startTime: "09:00", status: "active", absenceComments: [] };
  let sequence = Date.now();
  const comment = (uid = "a", overrides = {}) => ({ id: `absence_${++sequence}`, uid, user: `Synthetic ${uid}`, text: "Synthetic legacy absence", date, time: new Date().toISOString(), ...overrides });
  const client = (uid) => {
    const app = initializeApp({ projectId: project, apiKey: "emulator-only", appId: "emulator-only" }, `legacy-absence-${uid || "anonymous"}`), value = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8193, uid ? { mockUserToken: { sub: uid } } : {}); clients.push({ app, db: value }); return value;
  };
  const eventDoc = (value, id) => sdk.doc(value, "teams", teamId, "clubEvents", id);
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  // The released app appends to its loaded array and cancels with arrayRemove.
  const legacyAdd = async (value, id, entry, loaded = null) => {
    const before = loaded ?? (await sdk.getDoc(eventDoc(value, id))).data().absenceComments ?? [];
    return sdk.updateDoc(eventDoc(value, id), { absenceComments: [...before, entry], updatedAt: sdk.serverTimestamp() });
  };
  const legacyCancel = (value, id, entry) => sdk.updateDoc(eventDoc(value, id), { absenceComments: sdk.arrayRemove(entry), updatedAt: sdk.serverTimestamp() });
  const invoke = (method, uid, data) => backend[method]({ auth: { uid }, data: { teamId, ...data } });
  try {
    await root.set({ name: "Synthetic compatibility team", createdBy: "owner", absenceDeadlineDaysBefore: 3 });
    for (const [uid, role] of [["a", "member"], ["b", "member"], ["parent", "guardian"], ["owner", "owner"], ["staff", "staff"]]) {
      await members.doc(uid).set({ name: `Synthetic ${uid}`, role });
      await db.collection("users").doc(uid).set({ activeTeamId: teamId });
    }
    const a = client("a"), b = client("b"), parent = client("parent"), outsider = client("outside"), anonymous = client(null);
    await db.collection("users").doc("outside").set({ activeTeamId: teamId });
    await invoke("setChildren", "owner", { guardianUid: "parent", childUids: ["a", "b"] });

    await t.test("old app registers and cancels its own report without calendar edit permission", async () => {
      const peer = comment("b"), own = comment(); await events.doc("own").set({ ...base, absenceComments: [peer] });
      await legacyAdd(a, "own", own);
      assert.deepEqual((await events.doc("own").get()).data().absenceComments, [peer, own]);
      await legacyCancel(a, "own", own);
      assert.deepEqual((await events.doc("own").get()).data().absenceComments, [peer]);
      await legacyCancel(a, "own", own); // Cancellation already completed on another device.
      assert.deepEqual((await events.doc("own").get()).data().absenceComments, [peer]);
      await events.doc("no-field").set({ date, status: "active" }); await legacyAdd(a, "no-field", comment());
      assert.equal((await events.doc("no-field").get()).data().absenceComments.length, 1);
    });
    await t.test("new parent API and old child app interoperate for duplicate checks and shared cancellation", async () => {
      const own = comment(); await events.doc("mixed").set(base); await legacyAdd(a, "mixed", own);
      assert.equal((await invoke("submit", "parent", { eventId: "mixed", targetUid: "a", date, text: "Synthetic proxy" })).added, false);
      await invoke("cancel", "parent", { eventId: "mixed", commentId: own.id });
      const proxy = await invoke("submit", "parent", { eventId: "mixed", targetUid: "a", date, text: "Synthetic proxy" });
      await legacyCancel(a, "mixed", proxy.comment);
      assert.deepEqual((await events.doc("mixed").get()).data().absenceComments, []);
      await invoke("submit", "parent", { eventId: "mixed", targetUid: "b", date, text: "Synthetic sibling proxy" });
      await legacyAdd(a, "mixed", comment());
      assert.equal((await events.doc("mixed").get()).data().absenceComments.length, 2);
    });
    await t.test("members cannot alter peer reports, rewrite their own existing report, or remove multiple reports", async () => {
      const peer = comment("b"), own = comment(); await events.doc("protected").set({ ...base, absenceComments: [peer, own] });
      await denied(legacyCancel(a, "protected", peer));
      for (const entries of [[{ ...peer, text: "forged" }, own], [peer, { ...own, text: "edited" }], [], [own, peer, comment()]]) {
        await denied(sdk.updateDoc(eventDoc(a, "protected"), { absenceComments: entries, updatedAt: sdk.serverTimestamp() }));
      }
      const second = comment(); await legacyAdd(a, "protected", second);
      await denied(sdk.updateDoc(eventDoc(a, "protected"), { absenceComments: [peer], updatedAt: sdk.serverTimestamp() }));
      assert.deepEqual((await events.doc("protected").get()).data().absenceComments, [peer, own, second]);
    });
    await t.test("legacy exception cannot change event fields, bypass membership, forge proxies or create/delete events", async () => {
      await events.doc("scope").set(base);
      for (const value of [parent, outsider, anonymous]) {
        await denied(sdk.updateDoc(eventDoc(value, "scope"), { absenceComments: [comment("a")], updatedAt: sdk.serverTimestamp() }));
      }
      await denied(legacyAdd(parent, "scope", comment("parent")));
      await denied(legacyAdd(a, "scope", comment("b")));
      await denied(legacyAdd(a, "scope", comment("a", { submittedBy: { uid: "parent", user: "Synthetic parent" } })));
      await denied(sdk.updateDoc(eventDoc(a, "scope"), { absenceComments: [comment()], title: "forged", updatedAt: sdk.serverTimestamp() }));
      await denied(sdk.updateDoc(eventDoc(a, "scope"), { absenceComments: [comment()], updatedAt: sdk.Timestamp.fromMillis(0) }));
      await denied(sdk.updateDoc(eventDoc(a, "scope"), { absenceComments: [comment()] }));
      await denied(sdk.setDoc(eventDoc(a, "created"), { ...base, absenceComments: [comment()], updatedAt: sdk.serverTimestamp() }));
      await denied(sdk.deleteDoc(eventDoc(a, "scope")));
      await members.doc("departed").set({ role: "member" }); const departed = client("departed");
      await db.collection("users").doc("departed").set({ activeTeamId: teamId }); await members.doc("departed").delete();
      await denied(legacyAdd(departed, "scope", comment("departed")));
    });
    await t.test("stale whole-array writes cannot drop a peer's new or proxy report; reload permits retry", async () => {
      const stale = [], peer = comment("b"), own = comment(); await events.doc("stale").set({ ...base, absenceComments: [peer] });
      await denied(legacyAdd(a, "stale", own, stale));
      assert.deepEqual((await events.doc("stale").get()).data().absenceComments, [peer]);
      await legacyAdd(a, "stale", own);
      assert.deepEqual((await events.doc("stale").get()).data().absenceComments, [peer, own]);
      await events.doc("concurrent-old").set(base);
      const first = comment("a"), second = comment("b");
      const results = await Promise.allSettled([legacyAdd(a, "concurrent-old", first, []), legacyAdd(b, "concurrent-old", second, [])]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await events.doc("concurrent-old").get()).data().absenceComments.length, 1);
      const failed = results[0].status === "rejected" ? [a, first] : [b, second];
      await legacyAdd(failed[0], "concurrent-old", failed[1]);
      assert.equal((await events.doc("concurrent-old").get()).data().absenceComments.length, 2);
    });
    await t.test("legacy registration validates the comment shape, event status and actual selected dates", async () => {
      await events.doc("validation").set(base);
      for (const entry of [comment("a", { id: "forged" }), comment("a", { date: "2099-02-30" }), comment("a", { text: " " }),
        comment("a", { text: "x".repeat(2001) }), comment("a", { user: 7 }), comment("a", { time: {} }), comment("a", { extra: true })]) {
        await denied(legacyAdd(a, "validation", entry));
      }
      for (const status of ["deleted", "pending"]) {
        await events.doc(`status-${status}`).set({ ...base, status }); await denied(legacyAdd(a, `status-${status}`, comment()));
      }
      await events.doc("selected").set({ ...base, selectedDates: ["2099-01-10", "2099-01-12"], endDate: "2099-01-12" });
      await denied(legacyAdd(a, "selected", comment("a", { date: "2099-01-11" })));
      await legacyAdd(a, "selected", comment("a", { date: "2099-01-12" }));
      await events.doc("slash-selected").set({ ...base, selectedDates: ["2099/1/10", "2099/1/12"] });
      await legacyAdd(a, "slash-selected", comment());
      await events.doc("range").set({ ...base, date: "2099/1/10", endDate: "2099/1/12", selectedDates: null, timeSchedules: null });
      await legacyAdd(a, "range", comment("a", { date: "2099-01-11" }));
      await denied(legacyAdd(a, "range", comment("a", { date: "2099-01-13" })));
    });
    await t.test("rules enforce the JST deadline and permit self-cancellation after it", async () => {
      const today = new Date(Date.now() + 9 * 3600000).toISOString().substring(0, 10);
      const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().substring(0, 10);
      const expired = comment("a", { date: yesterday });
      await events.doc("expired").set({ ...base, date: yesterday, endDate: yesterday, absenceComments: [expired] });
      await denied(legacyAdd(a, "expired", comment("a", { date: yesterday })));
      await legacyCancel(a, "expired", expired);
      await root.update({ absenceDeadlineDaysBefore: 0 });
      await events.doc("today-all-day").set({ ...base, date: today, endDate: today, isAllDay: true });
      await denied(legacyAdd(a, "today-all-day", comment("a", { date: today })));
      await events.doc("today-schedule").set({ ...base, date: today, endDate: today, startTime: "23:59", timeSchedules: { [today]: { start: "00:00", isAllDay: false } } });
      await denied(legacyAdd(a, "today-schedule", comment("a", { date: today })));
      if (Date.now() < Date.parse(`${today}T23:59:00+09:00`) - 60000) {
        await events.doc("today-schedule").update({ startTime: "00:00", timeSchedules: { [today]: { start: "23:59", isAllDay: false } } });
        await legacyAdd(a, "today-schedule", comment("a", { date: today }));
      }
      await root.update({ absenceDeadlineDaysBefore: 3 });
      const cutoffDay = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86400000).toISOString().substring(0, 10);
      await events.doc("three-day-cutoff").set({ ...base, date: cutoffDay, endDate: cutoffDay });
      await denied(legacyAdd(a, "three-day-cutoff", comment("a", { date: cutoffDay })));
    });
  } finally {
    await Promise.all(clients.map(async (value) => { await sdk.terminate(value.db); await deleteApp(value.app); }));
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});

test("manual children are team-owned absence targets, shared by guardians without member accounts", async (t) => {
  const serverApp = adminApp.initializeApp({ projectId: project }, "manual-absence-server"), db = admin.getFirestore(serverApp), clients = [];
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  let clock = Date.parse("2099-01-01T00:00:00+09:00");
  const backend = createGuardianAbsenceBackend({ firestore: db, FieldValue: admin.FieldValue, HttpsError, now: () => clock });
  const teamId = "manual-team", root = db.collection("teams").doc(teamId), members = root.collection("members"), events = root.collection("clubEvents"), children = root.collection("absenceChildren");
  const date = "2099-01-10", base = { date, endDate: date, startTime: "09:00", status: "active", absenceComments: [] };
  const invoke = (method, uid, data = {}) => backend[method]({ auth: { uid }, data: { teamId, ...data } });
  const link = (uid, guardianUid, manualChildIds, newManualChildren = [], childUids = ["child"]) => invoke("setChildren", uid, { guardianUid, childUids, manualChildIds, newManualChildren });
  const send = (uid, targetChildId = "child", extra = {}) => invoke("submit", uid, { eventId: "event", date, targetChildId, text: "Synthetic manual absence", ...extra });
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  const client = (uid) => {
    const app = initializeApp({ projectId: project, apiKey: "emulator-only", appId: "emulator-only" }, `manual-absence-${uid}`), value = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8193, { mockUserToken: { sub: uid } }); clients.push({ app, db: value }); return value;
  };
  try {
    await root.set({ name: "Synthetic manual team", createdBy: "manual-owner", absenceDeadlineDaysBefore: 3 });
    for (const [uid, role] of [["manual-owner", "owner"], ["manual-staff", "staff"], ["manual-captain", "captain"],
      ["child", "member"], ["manual-parent", "guardian"], ["manual-parent2", "guardian"], ["manual-unlinked", "guardian"]]) {
      await members.doc(uid).set({ name: "Same synthetic name", role });
      await db.collection("users").doc(uid).set({ activeTeamId: teamId });
    }
    await events.doc("event").set(base);
    const staff = client("manual-staff"), parent = client("manual-parent"), child = client("child"), captain = client("manual-captain"), outside = client("manual-outside");
    await db.collection("users").doc("manual-outside").set({ activeTeamId: teamId });
    const manualRef = (value, id = "child") => sdk.doc(value, "teams", teamId, "absenceChildren", id);
    const profile = (value, id = "manual-parent") => sdk.doc(value, "teams", teamId, "members", id);
    const eventRef = (value, id = "event") => sdk.doc(value, "teams", teamId, "clubEvents", id);

    await t.test("creation and linking require a manager, are atomic and retry without duplicate names or accounts", async () => {
      const additions = [{ id: "child", name: "Same synthetic name" }, { id: "manual-sibling", name: "Same synthetic name" }];
      for (const uid of ["manual-parent", "child", "manual-captain", "manual-outside"]) await denied(link(uid, "manual-parent", ["child"], additions.slice(0, 1)));
      await assert.rejects(link("manual-staff", "missing-guardian", ["child"], additions.slice(0, 1)), (error) => error.code === "failed-precondition");
      assert.equal((await children.get()).size, 0);
      await link("manual-staff", "manual-parent", ["child", "manual-sibling"], additions);
      await link("manual-staff", "manual-parent", ["child", "manual-sibling"], additions);
      assert.equal((await children.get()).size, 2); assert.equal((await members.get()).size, 7);
      assert.equal((await db.collection("users").doc("manual-sibling").get()).exists, false);
      const data = (await members.doc("manual-parent").get()).data();
      assert.deepEqual(data.manualChildren.map((item) => item.id), ["child", "manual-sibling"]);
      assert.deepEqual(data.childUids, ["child"]);
      await invoke("setChildren", "manual-staff", { guardianUid: "manual-parent", childUids: ["child"] });
      assert.equal((await members.doc("manual-parent").get()).data().manualChildren.length, 2, "older app link requests preserve manual children");
    });
    await t.test("only managers read the shared catalog; clients cannot write targets or forge guardian links", async () => {
      assert.equal((await sdk.getDocs(sdk.collection(staff, "teams", teamId, "absenceChildren"))).size, 2);
      for (const value of [parent, child, captain, outside]) {
        await denied(sdk.getDoc(manualRef(value))); await denied(sdk.getDocs(sdk.collection(value, "teams", teamId, "absenceChildren")));
      }
      for (const value of [staff, parent]) {
        await denied(sdk.setDoc(manualRef(value, "forged"), { name: "Forged child" }));
        await denied(sdk.updateDoc(manualRef(value), { name: "Forged name" })); await denied(sdk.deleteDoc(manualRef(value)));
        await denied(sdk.updateDoc(profile(value), { manualChildren: [{ id: "forged", name: "Forged" }] }));
      }
      assert.equal((await sdk.getDoc(profile(parent))).data().manualChildren.length, 2);
      await db.collection("invites").doc("MANUALJOIN").set({ teamId, active: true });
      const joiner = client("manual-joiner");
      await denied(sdk.setDoc(profile(joiner, "manual-joiner"), { role: "member", inviteCode: "MANUALJOIN", manualChildren: [] }));
    });
    await t.test("the same saved child can be linked to both parents; unknown or cross-team IDs and name overwrites fail", async () => {
      await link("manual-owner", "manual-parent2", ["child"]);
      await db.collection("teams").doc("manual-other-team").collection("absenceChildren").doc("foreign-child").set({ name: "Synthetic foreign" });
      await assert.rejects(link("manual-staff", "manual-parent2", ["foreign-child"]), (error) => error.code === "failed-precondition");
      await assert.rejects(link("manual-staff", "manual-parent2", ["child"], [{ id: "child", name: "Changed name" }]), (error) => error.code === "failed-precondition");
      await assert.rejects(link("manual-staff", "manual-parent2", ["not-created", "missing"], [{ id: "not-created", name: "Must not be saved" }]), (error) => error.code === "failed-precondition");
      assert.equal((await children.doc("not-created").get()).exists, false);
      assert.deepEqual((await members.doc("manual-parent2").get()).data().manualChildren.map((item) => item.id), ["child"]);
    });
    await t.test("shared parents deduplicate concurrent reports; same-named member and manual IDs stay distinct", async () => {
      const results = await Promise.all([send("manual-parent"), send("manual-parent2")]);
      assert.equal(results.filter((result) => result.added).length, 1);
      const report = results.find((result) => result.added).comment;
      assert.equal(report.uid, ""); assert.equal(report.childId, "child"); assert.equal(report.user, "Same synthetic name");
      assert.ok(["manual-parent", "manual-parent2"].includes(report.submittedBy.uid));
      await send("manual-parent", "manual-sibling");
      await invoke("submit", "child", { eventId: "event", targetUid: "child", date, text: "Synthetic member absence" });
      assert.equal((await events.doc("event").get()).data().absenceComments.length, 3);
      assert.equal((await db.collection("users").doc("manual-sibling").collection("guardianAbsenceTeams").doc(teamId).get()).exists, false);
      assert.deepEqual(await backend.relatedTeamIds("manual-parent2"), [teamId]);
      for (const uid of ["manual-unlinked", "child", "manual-staff", "manual-outside"]) await denied(send(uid));
    });
    await t.test("legacy self-reports coexist with manual reports and cannot remove or impersonate them", async () => {
      const before = (await events.doc("event").get()).data().absenceComments;
      const own = { id: "absence_123456789", uid: "child", user: "Synthetic legacy", text: "Synthetic reason", date, time: new Date().toISOString() };
      await sdk.updateDoc(eventRef(child), { absenceComments: [...before, own], updatedAt: sdk.serverTimestamp() });
      await sdk.updateDoc(eventRef(child), { absenceComments: sdk.arrayRemove(own), updatedAt: sdk.serverTimestamp() });
      const manual = before.find((item) => item.childId === "child");
      await denied(sdk.updateDoc(eventRef(child), { absenceComments: sdk.arrayRemove(manual), updatedAt: sdk.serverTimestamp() }));
      await denied(invoke("cancel", "child", { eventId: "event", commentId: manual.id }));
      await denied(invoke("cancel", "manual-unlinked", { eventId: "event", commentId: manual.id }));
      assert.equal((await events.doc("event").get()).data().absenceComments.length, 3);
    });
    await t.test("unlinking and role changes immediately revoke manual operations while the other parent keeps access", async () => {
      const report = (await events.doc("event").get()).data().absenceComments.find((item) => item.childId === "child");
      await link("manual-staff", "manual-parent", []);
      await denied(send("manual-parent")); await denied(invoke("cancel", "manual-parent", { eventId: "event", commentId: report.id }));
      await invoke("cancel", "manual-parent2", { eventId: "event", commentId: report.id });
      assert.equal((await send("manual-parent2")).added, true);
      const before = await members.doc("manual-parent2").get(); await members.doc("manual-parent2").update({ role: "member" });
      await denied(send("manual-parent2"));
      await backend.membershipChanged({ params: { teamId, uid: "manual-parent2" }, data: { before, after: await members.doc("manual-parent2").get() } });
      assert.deepEqual((await members.doc("manual-parent2").get()).data().manualChildren, []);
      await members.doc("manual-parent2").update({ role: "guardian" }); await link("manual-owner", "manual-parent2", ["child"]);
    });
    await t.test("manual reports honor per-day deadlines and anonymize a departed parent without removing the shared child's name", async () => {
      await events.doc("multi").set({ ...base, selectedDates: [date, "2099-01-12"], endDate: "2099-01-12" });
      await send("manual-parent2", "child", { eventId: "multi" });
      await send("manual-parent2", "child", { eventId: "multi", date: "2099-01-12" });
      await assert.rejects(send("manual-parent2", "child", { eventId: "multi", date: "2099-01-11" }), (error) => error.code === "failed-precondition");
      await root.update({ absenceDeadlineDaysBefore: 0 }); await events.doc("multi").update({ timeSchedules: { [date]: { start: "18:00" } } });
      clock = Date.parse(`${date}T18:00:00+09:00`);
      await assert.rejects(send("manual-parent2", "child", { eventId: "multi" }), (error) => error.code === "failed-precondition");
      const report = (await events.doc("multi").get()).data().absenceComments[0];
      await invoke("cancel", "manual-parent2", { eventId: "multi", commentId: report.id });
      await backend.anonymizeTeam(root, "manual-parent2");
      const remaining = (await events.doc("multi").get()).data().absenceComments[0];
      assert.equal(remaining.submittedBy.uid, "deleted_user"); assert.equal(remaining.user, "Same synthetic name"); assert.equal(remaining.childId, "child");
      assert.equal((await children.get()).size, 2);
      await members.doc("manual-parent2").delete(); await denied(send("manual-parent2", "child", { eventId: "multi", date: "2099-01-12" }));
    });
  } finally {
    await Promise.all(clients.map(async (value) => { await sdk.terminate(value.db); await deleteApp(value.app); }));
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
