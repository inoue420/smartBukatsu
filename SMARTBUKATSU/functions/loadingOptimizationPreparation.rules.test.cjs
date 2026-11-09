const test = require("node:test"), assert = require("node:assert/strict");
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath, Timestamp } = require("firebase-admin/firestore");
const { createLoadingOptimizationBackend } = require("./loadingOptimizationBackend");

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8189" || process.env.GCLOUD_PROJECT !== "demo-loading-optimization") {
  throw new Error("These tests require the dedicated local demo emulator.");
}

test('real emulator: crashed leases, duplicate deliveries, fenced old workers and operator recovery', { timeout: 120000 }, async () => {
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, 'lease-recovery'), db = getFirestore(app);
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const backend = createLoadingOptimizationBackend({ firestore: db, FieldValue, FieldPath, HttpsError });
  const teamId = 'lease-' + Date.now(), team = db.collection('teams').doc(teamId);
  const state = team.collection('loadingOptimization').doc('state'), job = team.collection('membershipOperations').doc('operation');
  const event = (after, before) => ({ params: { teamId }, data: { after, ...(before ? { before } : {}) } });
  const finish = async () => {
    for (let i = 0; i < 30; i++) {
      const snapshot = await state.get();
      if (snapshot.data().status !== 'preparing') return;
      await backend.handlePreparation(event(snapshot));
    }
    throw new Error('Synthetic operation did not finish');
  };
  try {
    await team.set({ membershipBatchPending: true, membershipOperationId: 'operation', channels: [] });
    await job.set({ status: 'queued', action: 'graduate' });
    await backend.reconcileMembershipBatch(teamId, 'operation');
    const original = await state.get(), generation = original.data().preparationId;
    await state.update({ lease: { token: 'crashed', expiresAt: Date.now() + 360000 } });
    const leased = await state.get();
    await assert.rejects(backend.handlePreparation(event(original)), { code: 'aborted' });
    await backend.handlePreparation(event(leased, original));
    assert.equal((await state.get()).data().stage, 0);
    assert.equal((await team.get()).data().membershipBatchPending, true);
    await assert.rejects(backend.recoverMembershipBatch(teamId, 'operation', generation, 'resume'), { code: 'failed-precondition' });
    await state.update({ lease: { token: 'crashed', expiresAt: 1 } });
    await backend.handlePreparation(event(original));
    assert.equal((await state.get()).data().stage, 1);
    await backend.handlePreparation(event(original));
    assert.equal((await state.get()).data().stage, 1, 'late original event cannot advance another page');
    const prior = await state.get();
    const outcomes = await Promise.allSettled([
      backend.recoverMembershipBatch(teamId, 'operation', generation, 'resume'),
      backend.recoverMembershipBatch(teamId, 'operation', 'wrong-generation', 'resume'),
    ]);
    assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
    const resumed = await state.get();
    assert.equal((await job.get()).data().status, 'processing');
    assert.equal((await team.get()).data().membershipBatchPending, true);
    await backend.handlePreparation(event(resumed, prior)); await finish();
    assert.equal((await job.get()).data().status, 'complete');
    assert.equal((await team.get()).data().membershipBatchPending, false);
    await backend.handlePreparation(event(original));
    await assert.rejects(backend.recoverMembershipBatch(teamId, 'operation', generation, 'resume'), { code: 'failed-precondition' });
    // Recreate work, then replace ownership while the old worker is between
    // claiming the page and updating its first source transaction.
    await team.update({ membershipBatchPending: true }); await job.set({ status: 'queued', action: 'graduate' });
    await backend.reconcileMembershipBatch(teamId, 'operation');
    await team.collection('workspacePosts').doc('post').set({ channel: 'General', visibleToUids: ['synthetic'] });
    const current = await state.get(); let transactions = 0;
    const oldWorker = createLoadingOptimizationBackend({ firestore: {
      collection: (...args) => db.collection(...args),
      runTransaction: async work => {
        if (++transactions === 2) await state.update({ lease: { token: 'new-owner', expiresAt: Date.now() + 360000 } });
        return db.runTransaction(work);
      },
    }, FieldValue, FieldPath, HttpsError });
    await assert.rejects(oldWorker.handlePreparation(event(current)), { code: 'aborted' });
    assert.equal((await state.get()).data().lease.token, 'new-owner');
    assert.equal((await team.get()).data().membershipBatchPending, true);
    await state.update({ lease: { token: 'new-owner', expiresAt: 1 } });
    await backend.handlePreparation(event(current)); await finish();
    assert.equal((await team.get()).data().membershipBatchPending, false);
  } finally { await db.terminate(); await deleteApp(app); }
});

test("real emulator: targeted blocks, disappearing-page cursors, legacy backfill, assignments and actor cleanup", { timeout: 180000 }, async () => {
  const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, "target-preparation"), db = getFirestore(app);
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const metrics = [], backend = createLoadingOptimizationBackend({ firestore: db, FieldValue, FieldPath, HttpsError,
    logger: { info: (_label, value) => metrics.push(value) } });
  const team = "target-" + Date.now(), ref = db.collection("teams").doc(team), stateRef = ref.collection("loadingOptimization").doc("state");
  const summary = async (uid) => (await ref.collection("loadingSummaries").doc(uid).get()).data() || {};
  const finish = async () => {
    for (let step = 0; step < 80; step++) {
      const snapshot = await stateRef.get();
      if (snapshot.data()?.status !== "preparing") return snapshot.data();
      await backend.handlePreparation({ params: { teamId: team }, data: { after: snapshot } });
    }
    throw new Error("Synthetic preparation did not complete");
  };
  const block = async (uids) => {
    const user = db.collection("users").doc("target-a"), before = await user.get(); await user.update({ blockedUserUids: uids });
    await backend.handleUser({ params: { uid: "target-a" }, data: { before, after: await user.get() } });
    return finish();
  };
  try {
    await ref.set({ name: "Synthetic target team", channels: [] });
    const writer = db.bulkWriter();
    for (const [uid, name, role, assignment] of [
      ["target-a", "A", "member"], ["target-b", "B", "member"], ["target-c", "C", "member"],
      ["target-s1", "S1", "member", "C1"], ["target-s2", "S2", "member", "C1"],
      ["target-c1", "C1", "staff"], ["target-c2", "C2", "staff"],
    ]) {
      writer.set(ref.collection("members").doc(uid), { name, role, ...(assignment ? { assignedStaff: assignment } : {}), ...(role === "staff" ? { staffScope: "assigned" } : {}) });
      writer.set(db.collection("users").doc(uid), { name, teamIds: [team] });
    }
    const visible = ["target-a", "target-b", "target-c"];
    for (let i = 0; i < 75; i++) writer.set(ref.collection("workspacePosts").doc(`p${String(i).padStart(3, "0")}`), { authorUid: "target-b", user: "B", content: "@A synthetic", visibleToUids: visible });
    for (let i = 0; i < 80; i++) writer.set(ref.collection("workspacePosts").doc(`quiet${i}`), { authorUid: "target-c", user: "C", content: "Unrelated", visibleToUids: visible });
    writer.set(ref.collection("workspacePosts").doc("reply"), { authorUid: "target-c", user: "C", visibleToUids: visible, replies: [{ id: "legacy", user: "B", content: "@A legacy" }] });
    for (const [id, uid, author] of [["s1", "target-s1", "S1"], ["legacy", null, "S1"], ["orphan", "target-s1", "S1"], ["s2", "target-s2", "S2"]]) {
      writer.set(ref.collection("dailyReports").doc(id), { ...(uid ? { authorUid: uid } : {}), author, condition: "不良", medicalScaleVersion: 2, fatigue: 5, isReviewed: false, createdAt: Timestamp.fromMillis(100) });
    }
    await writer.close();
    await backend.prepare(team, { enabled: true });
    assert.equal((await finish()).postActorIndexVersion, 1);
    assert.equal((await summary("target-a")).workspaceNotificationUnreadCount, 76);
    // Simulate ready entries written by the previous deployed backend.
    const oldEntries = await ref.collection("loadingEntries").get(), removeIndex = db.bulkWriter();
    for (const entry of oldEntries.docs) removeIndex.update(entry.ref, { postActorUids: FieldValue.delete(), referencePreparationId: FieldValue.delete() });
    await removeIndex.close(); await stateRef.update({ postActorIndexVersion: FieldValue.delete() });
    await block(["target-b"]);
    assert.equal((await summary("target-a")).workspaceNotificationUnreadCount, 0, "both pages must be processed after their result entries disappear");
    assert.equal((await block([])).postActorIndexVersion, 1, "unblocking old entries must build a complete actor index once");
    assert.equal((await summary("target-a")).workspaceNotificationUnreadCount, 76);
    await block(["target-b"]);
    assert.equal((await summary("target-a")).workspaceNotificationUnreadCount, 0);
    await block([]);
    assert.equal((await summary("target-a")).workspaceNotificationUnreadCount, 76);
    await ref.collection("dailyReports").doc("orphan").delete();
    const member = ref.collection("members").doc("target-s1"), before = await member.get(); await member.update({ assignedStaff: "C2" });
    metrics.length = 0;
    await backend.handleMembership({ params: { teamId: team, uid: "target-s1" }, data: { before, after: await member.get() } });
    await finish();
    assert.deepEqual((await summary("target-c1")).medicalHistogram, { "1:0:5:0": 1 });
    assert.deepEqual((await summary("target-c2")).medicalHistogram, { "1:0:5:0": 2 });
    assert.equal((await ref.collection("loadingEntries").doc("dailyReports_orphan").get()).exists, false);
    assert.equal(metrics.some((value) => value.latestSearches), false, "assignment changes must not rebuild latest reports");
    await backend.anonymizeTeam(ref, "target-b");
    assert.equal((await ref.collection("loadingEntries").where("postActorUids", "array-contains", "target-b").get()).size, 0);
    await finish();
    await backend.process(team, "workspacePosts", "p000");
    await backend.process(team, "workspacePosts", "reply");
    assert.equal((await ref.collection("loadingEntries").where("postActorUids", "array-contains", "target-b").get()).size, 0, "preparation and late events must not restore excluded actor UIDs");
  } finally {
    await db.terminate(); await deleteApp(app);
  }
});
