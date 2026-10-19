const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const functionRequire = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = functionRequire("firebase-admin/app"), admin = functionRequire("firebase-admin/firestore");
const { createLoadingOptimizationBackend } = require("../../functions/loadingOptimizationBackend");
const { needsGeneralAudienceUpgrade } = require("../../functions/workspaceAudience");
const project = "demo-loading-optimization", host = "127.0.0.1:8189";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== project) throw new Error("Use the dedicated local demo emulator.");

test("real rules: only staff can change grades, and profile saves preserve a concurrently assigned grade", async (t) => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${project}:securityRules`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }] } }) });
  assert.equal(response.ok, true, await response.text());
  const serverApp = adminApp.initializeApp({ projectId: project }, "grade-server"), db = admin.getFirestore(serverApp), clients = [];
  const team = "grade-synthetic", root = db.collection("teams").doc(team), members = root.collection("members");
  const client = (uid) => {
    const app = initializeApp({ projectId: project, apiKey: "emulator-only", appId: "emulator-only" }, `grade-${uid}`), value = sdk.getFirestore(app);
    sdk.connectFirestoreEmulator(value, "127.0.0.1", 8189, { mockUserToken: { sub: uid } }); clients.push({ app, db: value }); return value;
  };
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  const ref = (value, uid) => sdk.doc(value, "teams", team, "members", uid);
  try {
    await root.set({ name: "Synthetic team", createdBy: "owner", grades: ["1年生", "2年生"] });
    await db.collection("invites").doc("synthetic-grade").set({ teamId: team, active: true });
    const sessions = {};
    for (const role of ["owner", "admin", "staff", "captain", "member", "guardian"]) {
      await members.doc(role).set({ name: "Synthetic", role, grade: "1年生", position: "GK" });
      await db.collection("users").doc(role).set({ name: "Synthetic", activeTeamId: team });
      sessions[role] = client(role);
    }
    await t.test("members, captains and guardians cannot change or remove their own or another grade", async () => {
      for (const role of ["captain", "member", "guardian"]) {
        await denied(sdk.updateDoc(ref(sessions[role], role), { grade: "2年生" }));
        await denied(sdk.updateDoc(ref(sessions[role], role), { grade: sdk.deleteField() }));
        await denied(sdk.updateDoc(ref(sessions[role], "owner"), { grade: "2年生" }));
        await sdk.updateDoc(ref(sessions[role], role), { name: "Updated synthetic", position: "CB" });
      }
    });
    await t.test("owner/admin/staff can assign and clear member and captain grades", async () => {
      for (const role of ["owner", "admin", "staff"]) {
        await sdk.updateDoc(ref(sessions[role], "member"), { grade: "2年生" });
        await sdk.updateDoc(ref(sessions[role], "captain"), { grade: "2年生" });
        await sdk.updateDoc(ref(sessions[role], "member"), { grade: "" });
      }
    });
    await t.test("a profile save never overwrites the manager's grade, including a missing-grade legacy profile", async () => {
      const source = fs.readFileSync(path.join(__dirname, "firestoreService.js"), "utf8");
      const declaration = require("@babel/parser").parse(source, { sourceType: "module" }).program.body
        .find((item) => item.type === "ExportNamedDeclaration" && item.declaration?.id?.name === "updateMemberProfile").declaration;
      const save = vm.runInThisContext("(function({ doc, setDoc, db }) {" + source.slice(declaration.start, declaration.end) + "\nreturn updateMemberProfile; })")({ ...sdk, db: sessions.member });
      await sdk.updateDoc(ref(sessions.staff, "member"), { grade: "2年生" });
      await save(team, "member", "New synthetic name", "RW");
      let data = (await members.doc("member").get()).data();
      assert.equal(data.grade, "2年生"); assert.equal(data.position, "RW");
      await members.doc("member").update({ grade: admin.FieldValue.delete() });
      await save(team, "member", "Legacy synthetic name", "LW");
      data = (await members.doc("member").get()).data();
      assert.equal(Object.hasOwn(data, "grade"), false); assert.equal(data.position, "LW");
    });
    await t.test("an invitation cannot be used to self-assign a grade during membership creation", async () => {
      const newcomer = client("newcomer"), data = { name: "Synthetic newcomer", inviteCode: "synthetic-grade", role: "member" };
      await denied(sdk.setDoc(ref(newcomer, "newcomer"), { ...data, grade: "2年生" }));
      await sdk.setDoc(ref(newcomer, "newcomer"), data);
      await denied(sdk.updateDoc(ref(newcomer, "newcomer"), { grade: "1年生" }));
      await sdk.updateDoc(ref(sessions.staff, "newcomer"), { grade: "1年生" });
      assert.equal((await members.doc("newcomer").get()).data().grade, "1年生");
    });
    await t.test("real backend repairs grade audiences after an authorized membership change", async () => {
      class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
      const backend = createLoadingOptimizationBackend({ firestore: db, FieldValue: admin.FieldValue, FieldPath: admin.FieldPath, HttpsError });
      const stateRef = root.collection("loadingOptimization").doc("state"), postRef = root.collection("workspacePosts").doc("audience");
      await root.update({ channels: [{ id: "first", name: "First", shareScope: "grades", allowedRoleGroups: ["staff"], allowedGrades: ["1年生"] }] });
      await members.doc("member").update({ grade: "1年生" });
      await postRef.set({ authorUid: "staff", channelId: "first", channel: "First", content: "Synthetic grade post", createdAt: admin.Timestamp.now() });
      const finish = async () => {
        for (let step = 0; step < 40; step++) {
          const state = await stateRef.get();
          if (state.data()?.status !== "preparing") return;
          await backend.handlePreparation({ params: { teamId: team }, data: { after: state } });
        }
        assert.fail("Preparation did not finish");
      };
      await backend.prepareCallable({ auth: { uid: "owner" }, data: { teamId: team } }); await finish();
      await backend.configureCallable({ auth: { uid: "owner" }, data: { teamId: team, enabled: true } }); await finish();
      assert.ok((await postRef.get()).data().visibleToUids.includes("member"));
      const before = await members.doc("member").get();
      await sdk.updateDoc(ref(sessions.staff, "member"), { grade: "2年生" });
      await backend.handleMembership({ params: { teamId: team, uid: "member" }, data: { before, after: await members.doc("member").get() } });
      await finish();
      const data = (await postRef.get()).data();
      assert.equal(data.shareScope, "grades");
      assert.equal(data.visibleToUids.includes("member"), false);
      assert.equal(data.readTargetUids.includes("member"), false);
      assert.equal((await stateRef.get()).data().enabled, true);
    });
    await t.test("General migration is staff-only, idempotent, and preserves unrelated channel settings", async () => {
      const source = fs.readFileSync(path.join(__dirname, "firestoreService.js"), "utf8");
      const declaration = require("@babel/parser").parse(source, { sourceType: "module" }).program.body
        .find((item) => item.type === "ExportNamedDeclaration" && item.declaration?.id?.name === "ensureGeneralChannelMemberAudience").declaration;
      const load = (value, transaction = sdk.runTransaction) => vm.runInThisContext("(function({ doc, runTransaction, db, needsGeneralAudienceUpgrade }) {" +
        source.slice(declaration.start, declaration.end) + "\nreturn ensureGeneralChannelMemberAudience; })")({ ...sdk, runTransaction: transaction, db: value, needsGeneralAudienceUpgrade });
      const general = { id: "ch_1", name: "全体連絡", shareScope: "grades", allowedGrades: ["1年生"],
        allowedRoleGroups: ["staff", "guardian"], isReadOnly: true, notificationRecipientUids: ["staff"] };
      const other = { id: "private", name: "Staff", shareScope: "coach" };
      await root.update({ channels: [general, other] });
      await denied(load(sessions.member)(team));
      const migrate = load(sessions.staff), results = await Promise.all([migrate(team), migrate(team)]);
      assert.deepEqual(results.sort(), [false, true]);
      assert.deepEqual((await root.get()).data().channels, [{ ...general, memberAudience: "all" }, other]);
      assert.equal(await migrate(team), false);

      // Pause a real optimistic transaction after its first read, then commit
      // an explicit manager choice. The automatic retry must leave it intact.
      await root.update({ channels: [general, other] });
      let release, readReady, first = true;
      const paused = new Promise((resolve) => { release = resolve; }), ready = new Promise((resolve) => { readReady = resolve; });
      const delayed = load(sessions.staff, (value, callback) => sdk.runTransaction(value, (transaction) => callback({
        get: async (ref) => { const snapshot = await transaction.get(ref); if (first) { first = false; readReady(); await paused; } return snapshot; },
        update: (...args) => transaction.update(...args),
      })));
      const pending = delayed(team); await ready;
      await root.update({ channels: [{ ...general, memberAudience: "grades" }, other] }); release();
      assert.equal(await pending, false);
      assert.deepEqual((await root.get()).data().channels, [{ ...general, memberAudience: "grades" }, other]);
    });
  } finally {
    for (const { app, db: value } of clients) { await sdk.terminate(value); await deleteApp(app); }
    await db.terminate(); await adminApp.deleteApp(serverApp);
  }
});
