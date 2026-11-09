const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const sdk = require('firebase/firestore'), { initializeApp, deleteApp } = require('firebase/app');
const functionRequire = require('node:module').createRequire(path.join(__dirname, '../../functions/package.json'));
const adminApp = functionRequire('firebase-admin/app'), admin = functionRequire('firebase-admin/firestore');
const { createMembershipBackend } = require('../../functions/membershipBackend');
const { createLoadingOptimizationBackend } = require('../../functions/loadingOptimizationBackend');
const { createArchivePreparation } = require('../../scripts/prepareMembershipArchive.cjs');
const { ACTIVE_MEMBER_ROLES, ACTIVE_MEMBER_QUERY_ROLES } = require('../../functions/membershipCore');
const { mergeMemberIdentity } = require('../utils/memberProfiles');
const { loadGradeOrderService, loadWorkspaceChannelService } = require('../../scripts/calendarWeekStartTestHarness.cjs');
const project = 'demo-loading-optimization', host = '127.0.0.1:8189';
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== project) throw new Error('Use the dedicated demo emulator.');
sdk.setLogLevel('silent');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }

test('real Firestore: preview, atomic graduation, siblings, deduplication, archive queries and one reconciliation', { timeout: 60000 }, async (t) => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${project}:securityRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(process.env.MEMBERSHIP_RULES_PATH || path.join(__dirname, '../../firestore.rules'), 'utf8') }] } }) });
  assert.equal(response.ok, true, await response.text());
  const app = adminApp.initializeApp({ projectId: project }, 'membership-test');
  const db = admin.getFirestore(app), teamId = 'membership-synthetic', team = db.collection('teams').doc(teamId), members = team.collection('members'), logs = [], clients = [];
  const backend = createMembershipBackend({ firestore: db, FieldValue: admin.FieldValue, HttpsError });
  const loading = createLoadingOptimizationBackend({ firestore: db, FieldValue: admin.FieldValue, FieldPath: admin.FieldPath, HttpsError, logger: { info: (...args) => logs.push(args) } });
  const request = (data, uid = 'manager') => ({ auth: { uid }, data: { teamId, operationId: 'graduate-1', ...data } });
  const client = (uid) => { const app = initializeApp({ projectId: project, apiKey: 'emulator-only', appId: 'emulator-only' }, `membership-${uid}`), db = sdk.getFirestore(app); sdk.connectFirestoreEmulator(db, '127.0.0.1', 8189, { mockUserToken: { sub: uid, email_verified: true } }); clients.push(app); return db; };
  const denied = (promise) => assert.rejects(promise, (e) => e.code === 'permission-denied');
  const args = { action: 'graduate', group: 'Final', memberUids: ['s1', 's2'], fiscalYear: 2026, guardianPolicy: 'leave' };
  async function finish(operationId) {
    await loading.reconcileMembershipBatch(teamId, operationId);
    let steps = 0;
    while ((await team.collection('loadingOptimization').doc('state').get()).data().status === 'preparing') {
      assert.ok(++steps < 100);
      await loading.handlePreparation({ params: { teamId }, data: { after: await team.collection('loadingOptimization').doc('state').get() } });
    }
    assert.equal((await team.collection('membershipOperations').doc(operationId).get()).data().status, 'complete');
    assert.equal((await team.get()).data().membershipBatchPending, false);
  }
  t.after(async () => { await Promise.all(clients.map((app) => sdk.terminate(sdk.getFirestore(app)).catch(() => {}))); });
  try {
    await team.set({ name: 'Synthetic', createdBy: 'manager', grades: ['Final', 'Other'], channels: [{ id: 'g', shareScope: 'grades', allowedGrades: ['Final'], allowedRoleGroups: ['staff'] }] });
    const data = { manager: { role: 'admin' }, s1: { role: 'member', grades: ['Final', 'Other'], canUploadVideos: true, canEditTags: true }, s2: { role: 'captain', grades: ['Final'] }, s3: { role: 'member', grades: ['Other'] },
      only: { role: 'guardian', childUids: ['s1', 's2'] }, sibling: { role: 'guardian', childUids: ['s1', 's3'], childMemberships: { s1: 'before', s3: 'keep' } }, manual: { role: 'guardian', childUids: ['s2'], manualChildren: [{ id: 'manual-child', name: 'Synthetic manual' }] }, old: { role: 'alumni', archived: true, graduationFiscalYear: 2025, canUploadVideos: true, canEditTags: true } };
    for (const [uid, m] of Object.entries(data)) { await members.doc(uid).set({ name: `Synthetic ${uid}`, ...m }); await db.collection('users').doc(uid).set({ name: `Synthetic ${uid}`, activeTeamId: teamId, teamIds: [teamId, 'another-team'] }); }
    await team.collection('workspacePosts').doc('p').set({ authorUid: 's1', user: 'Synthetic s1', content: 'Synthetic content', channelId: 'g', visibleToUids: ['s1', 's2', 'manager'], readTargetUids: ['s1', 's2', 'manager'] });
    const managerDb = client('manager'), studentDb = client('s1'), parentDb = client('only');
    await t.test('no mutation on preview or unauthorized requests', async () => {
      await assert.rejects(backend.manage(request({ ...args, phase: 'preview' }, 's1')), (e) => e.code === 'permission-denied');
      const p = await backend.manage(request({ ...args, phase: 'preview' }));
      assert.deepEqual(p.leavingGuardians.map((p) => p.uid), ['only']); assert.equal(p.keptGuardians.length, 2);
      assert.deepEqual(p.removedGroups, ['Final']);assert.deepEqual((await team.get()).data().grades, ['Final', 'Other']);
      assert.equal((await members.doc('s1').get()).data().role, 'member'); assert.equal((await team.collection('membershipOperations').get()).size, 0);
    });
    await t.test('stale sibling preview cannot remove a parent and commit is idempotent', async () => {
      const p = await backend.manage(request({ ...args, phase: 'preview' }));
      await members.doc('only').update({ childUids: ['s1', 's2', 's3'] });
      await assert.rejects(backend.manage(request({ ...args, phase: 'commit', fingerprint: p.fingerprint })), (e) => e.code === 'failed-precondition');
      await members.doc('only').update({ childUids: ['s1', 's2'] });
      const fresh = await backend.manage(request({ ...args, phase: 'preview' }));
      await backend.manage(request({ ...args, phase: 'commit', fingerprint: fresh.fingerprint }));
      assert.equal((await backend.manage(request({ ...args, phase: 'commit', fingerprint: fresh.fingerprint }))).replay, true);
      await assert.rejects(backend.manage(request({ ...args, fiscalYear: 2027, phase: 'commit' })), (e) => e.code === 'already-exists');
      assert.equal((await members.doc('s1').get()).data().graduationFiscalYear, 2026);
      assert.equal((await members.doc('s1').get()).data().canUploadVideos, false);
      assert.equal((await members.doc('s1').get()).data().canEditTags, false);
      assert.deepEqual((await team.get()).data().grades, ['Other']);
      assert.deepEqual((await team.get()).data().channels[0].allowedGrades, []);
      assert.equal((await members.doc('only').get()).exists, false);
      assert.deepEqual((await db.collection('users').doc('only').get()).data().teamIds, ['another-team']);
      assert.deepEqual((await members.doc('sibling').get()).data().childUids, ['s3']);
      assert.equal((await members.doc('manual').get()).data().manualChildren.length, 1);
    });
    await t.test('pending batches lock edits and alumni cannot read their old board even before cleanup', async () => {
      await denied(sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId, 'members', 's3'), { grades: [] }));
      await denied(sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId), { grades: [] }));
      await denied(sdk.getDoc(sdk.doc(studentDb, 'teams', teamId, 'workspacePosts', 'p')));
      await denied(sdk.getDoc(sdk.doc(parentDb, 'teams', teamId)));
    });
    await t.test('duplicate events do not restart the batch; completion repairs audiences once', async () => {
      const after = await members.doc('s1').get();
      await loading.handleMembership({ params: { teamId, uid: 's1' }, data: { before: { exists: true, data: () => data.s1 }, after } });
      assert.equal(logs.length, 0);
      await finish('graduate-1');
      const beforeCount = logs.length; await loading.reconcileMembershipBatch(teamId, 'graduate-1');
      assert.equal(logs.slice(beforeCount).filter(([, m]) => m.writes > 0).length, 0);
      const post = (await team.collection('workspacePosts').doc('p').get()).data();
      assert.deepEqual(post.visibleToUids, ['manager']); assert.deepEqual(post.readTargetUids, ['manager']);
      const payload = JSON.parse((await team.collection('system').doc('loadingContext_0').get()).data().payload);
      assert.equal(payload.members.some((m) => ['s1', 's2', 'old', 'only'].includes(m.uid)), false);
    });
    await t.test('active query excludes archives, explicit fiscal-year query retrieves only that year', async () => {
      const query = sdk.query(sdk.collection(managerDb, 'teams', teamId, 'members'), sdk.where('role', 'in', ['admin', 'member', 'captain', 'guardian', 'staff', 'owner']));
      assert.deepEqual((await sdk.getDocs(query)).docs.map((d) => d.id).sort(), ['manager', 'manual', 's3', 'sibling']);
      const first = await backend.listAlumni({ auth: { uid: 'manager' }, data: { teamId, fiscalYear: 2026 } });
      assert.deepEqual(first.members.map((m) => m.uid), ['s1', 's2']);
      assert.equal(first.members.some((m) => 'membershipOperationId' in m), false);
      assert.equal(first.members.some((m) => 'canUploadVideos' in m || 'canEditTags' in m), false);
      const seed = db.batch();
      for (let i = 0; i < 31; i++) seed.set(members.doc(`synthetic-archive-${i}`), { role: 'alumni', name: `Synthetic Archive ${String(i).padStart(2, '0')}`, graduationFiscalYear: 2026 });
      await seed.commit();
      const page1 = await backend.listAlumni({ auth: { uid: 'manager' }, data: { teamId, fiscalYear: 2026 } });
      const page2 = await backend.listAlumni({ auth: { uid: 'manager' }, data: { teamId, fiscalYear: 2026, cursor: page1.cursor } });
      assert.equal(page1.members.length, 30); assert.equal(page1.hasMore, true);
      assert.equal(page2.members.length, 3); assert.equal(page2.hasMore, false);
      assert.equal(new Set([...page1.members, ...page2.members].map((m) => m.uid)).size, 33);
      await assert.rejects(backend.listAlumni({ auth: { uid: 's1' }, data: { teamId, fiscalYear: 2026 } }), (e) => e.code === 'permission-denied');

      const activeRows = (await sdk.getDocs(sdk.query(sdk.collection(studentDb, 'teams', teamId, 'members'), sdk.where('role', 'in', ACTIVE_MEMBER_QUERY_ROLES)))).docs.map(s => ({ ...s.data(), uid: s.id }));
      // In the app this document is already watched by AuthProvider.
      const identity = await sdk.getDoc(sdk.doc(studentDb, 'teams', teamId, 'members', 's1'));
      const ownAndActive = mergeMemberIdentity(activeRows, { ...identity.data(), uid: 's1' });
      assert.equal(ownAndActive.filter(s => s.role === 'alumni').length, 1);
      assert.deepEqual(ownAndActive.map(s => s.uid).sort(), ['manager', 'manual', 's1', 's3', 'sibling']);

    });
    await t.test('sensitive metadata and operation stamps are server-only; alumni permissions cannot be enabled', async () => {
      const own = sdk.doc(studentDb, 'teams', teamId, 'members', 's1');
      for (const change of [{ archived: false }, { graduationFiscalYear: 2000 }, { membershipOperationId: 'fake' }, { role: 'member' }, { canEditTags: true }]) await denied(sdk.updateDoc(own, change));
      await denied(sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId, 'members', 's3'), { role: 'alumni' }));
      await denied(sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId, 'members', 's1'), { canEditTags: true }));
      await denied(sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId, 'members', 's1'), { canUploadVideos: true }));
      await sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId, 'members', 's3'), { canEditTags: true, canUploadVideos: true });
      await denied(sdk.setDoc(sdk.doc(managerDb, 'teams', teamId, 'membershipOperations', 'fake'), { status: 'complete' }));
    });
    await t.test('alumni remain video readers even with old true flags but cannot write videos or tags', async () => {
      const paths = ['projects/video', 'projects/video/videos/clip', 'projects/video/videos/clip/events/event', 'highlightProjects/highlight', 'tagGroups/group', 'tags/tag'];
      for (const p of paths) await db.doc(`teams/${teamId}/${p}`).set({ title: 'Synthetic', tags: [] });
      for (const viewer of [studentDb, client('old')]) {
        for (const p of paths) {
          const ref = sdk.doc(viewer, 'teams', teamId, ...p.split('/'));
          assert.equal((await sdk.getDoc(ref)).exists(), true);
          await denied(sdk.updateDoc(ref, { tags: [{ id: 'not-allowed' }] }));
          await denied(sdk.deleteDoc(ref));
          await denied(sdk.setDoc(sdk.doc(viewer, 'teams', teamId, ...p.split('/').slice(0, -1), 'new-item'), { title: 'Not allowed' }));
        }
      }
      // A legacy alumni profile with old true flags can still change its name.
      await sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId, 'members', 'old'), { name: 'Synthetic Legacy Renamed' });
      await sdk.updateDoc(sdk.doc(managerDb, 'teams', teamId, 'members', 'old'), { canEditTags: false, canUploadVideos: false });
      // Existing active members, guardians and old memberships retain their paths.
      await members.doc('legacy-writer').set({ name: 'Synthetic Legacy' });
      await db.collection('users').doc('legacy-only').set({ activeTeamId: teamId });
      for (const uid of ['s3', 'sibling', 'legacy-writer', 'legacy-only']) {
        await sdk.setDoc(sdk.doc(client(uid), 'teams', teamId, 'projects', `allowed-${uid}`), { title: 'Synthetic' });
      }
    });
    await t.test('rename updates members and channel constraints atomically without losing access', async () => {
      const rename = { action: 'rename', group: 'Other', name: 'Renamed', operationId: 'rename-1' };
      const p = await backend.manage(request({ ...rename, phase: 'preview' }));
      await backend.manage(request({ ...rename, phase: 'commit', fingerprint: p.fingerprint }));
      await finish('rename-1');
      assert.deepEqual((await members.doc('s3').get()).data().grades, ['Renamed']);
      assert.deepEqual((await team.get()).data().grades, ['Renamed']);
    });
    await t.test('account deletion also forgets rollback snapshots and departed-team links', async () => {
      assert.deepEqual(await backend.relatedTeamIds('only'), [teamId]);
      await backend.anonymizeTeam(team, 'only');
      assert.equal((await team.collection('membershipOperations').doc('graduate-1').collection('beforeMembers').doc('only').get()).exists, false);
      const job = (await team.collection('membershipOperations').doc('graduate-1').get()).data();
      assert.equal(job.leavingGuardians.some((m) => m.uid === 'only'), false);
      assert.equal(job.participantUids.includes('only'), false);
    });
    await t.test('legacy roster repair restores absent roles without normal archive reads or lost profiles', async () => {
      const legacyId = 'legacy-roster-synthetic', legacyTeam = db.collection('teams').doc(legacyId), roster = legacyTeam.collection('members');
      const prepare = createArchivePreparation({ firestore: db, FieldValue: admin.FieldValue });
      const profiles = {
        manager: { role: 'admin', name: 'Synthetic Manager' },
        absent: { name: 'Synthetic Absent', grade: 'Final', grades: ['Final', 'Other'], position: 'GK', canEditTags: true },
        empty: { role: '', name: 'Synthetic Empty' }, nil: { role: null, name: 'Synthetic Null' },
        zero: { role: 0, name: 'Synthetic Zero' }, no: { role: false, name: 'Synthetic False' },
        guardian: { role: 'guardian', childUids: ['absent'], manualChildren: [{ id: 'manual', name: 'Synthetic Manual' }] },
        archived: { role: 'alumni', archived: true, graduationFiscalYear: 2025, name: 'Synthetic Archive' },
      };
      await legacyTeam.set({ name: 'Synthetic Legacy', createdBy: 'manager', grades: ['Final', 'Other'], channels: [{ id: 'ch_1', memberAudience: 'all', allowedRoleGroups: ['staff', 'member'] }] });
      for (const [uid, value] of Object.entries(profiles)) { await roster.doc(uid).set(value); await db.collection('users').doc(uid).set({ name: value.name || 'Synthetic', teamIds: [legacyId] }, { merge: true }); }
      const q = values => sdk.query(sdk.collection(managerDb, 'teams', legacyId, 'members'), sdk.where('role', 'in', values));
      const ids = async values => (await sdk.getDocs(q(values))).docs.map(d => d.id).sort();
      // Reproduce the regression with the former strict query in real Firestore.
      assert.deepEqual(await ids(ACTIVE_MEMBER_ROLES), ['guardian', 'manager']);
      assert.deepEqual(await ids(ACTIVE_MEMBER_QUERY_ROLES), ['empty', 'guardian', 'manager', 'no', 'zero']);
      const beforeAudit = await roster.get();
      assert.equal((await prepare(legacyId)).missingRoles, 5);
      assert.deepEqual((await roster.get()).docs.map(d => d.data()), beforeAudit.docs.map(d => d.data()));
      assert.equal((await legacyTeam.collection('membershipOperations').get()).size, 0);
      const repaired = await prepare(legacyId, 'apply');
      assert.equal(repaired.applied, 5); assert.equal(repaired.remaining, 0);
      assert.deepEqual(await ids(ACTIVE_MEMBER_ROLES), ['absent', 'empty', 'guardian', 'manager', 'nil', 'no', 'zero']);
      assert.deepEqual(await ids(ACTIVE_MEMBER_QUERY_ROLES), await ids(ACTIVE_MEMBER_ROLES));
      const jobId = (await legacyTeam.get()).data().membershipOperationId;
      for (const uid of ['absent', 'empty', 'nil', 'no', 'zero']) {
        const current = (await roster.doc(uid).get()).data();
        const { role, membershipOperationId, ...rest } = current;
        const { role: oldRole, ...old } = profiles[uid];
        assert.equal(role, 'member'); assert.equal(membershipOperationId, jobId); assert.deepEqual(rest, old);
        assert.deepEqual((await legacyTeam.collection('membershipOperations').doc(jobId).collection('beforeMembers').doc(uid).get()).data().member, profiles[uid]);
      }
      for (const uid of ['manager', 'guardian', 'archived']) assert.deepEqual((await roster.doc(uid).get()).data(), profiles[uid]);
      await assert.rejects(prepare(legacyId, 'apply'), /Review required/);
      await loading.reconcileMembershipBatch(legacyId, jobId);
      let steps = 0;
      while ((await legacyTeam.collection('loadingOptimization').doc('state').get()).data().status === 'preparing') {
        assert.ok(++steps < 100);
        await loading.handlePreparation({ params: { teamId: legacyId }, data: { after: await legacyTeam.collection('loadingOptimization').doc('state').get() } });
      }
      assert.equal((await legacyTeam.collection('membershipOperations').doc(jobId).get()).data().status, 'complete');
      const payload = JSON.parse((await legacyTeam.collection('system').doc('loadingContext_0').get()).data().payload);
      assert.ok(payload.members.some(m => m.uid === 'absent')); assert.equal(payload.members.some(m => m.uid === 'archived'), false);
      assert.equal((await prepare(legacyId, 'apply')).applied, 0);
      assert.equal((await legacyTeam.collection('membershipOperations').get()).size, 1);
      // Empty legacy members can also use the existing preview before repair.
      await roster.doc('nil').update({ role: '', grades: ['Final'] });
      const preview = await backend.manage({ auth: { uid: 'manager' }, data: { teamId: legacyId, operationId: 'legacy-preview', phase: 'preview', action: 'graduate', group: 'Final', memberUids: ['nil'], fiscalYear: 2026 } });
      assert.equal(preview.graduateCount, 1);
    });
    await t.test('repair refuses ambiguous archives, unknown roles and oversized pages safely', async () => {
      const prepare = createArchivePreparation({ firestore: db, FieldValue: admin.FieldValue });
      const blocked = db.collection('teams').doc('legacy-blocked-synthetic');
      await blocked.set({ name: 'Synthetic' });
      await blocked.collection('members').doc('missing').set({ name: 'Synthetic' });
      await blocked.collection('members').doc('ambiguous').set({ archived: true });
      await blocked.collection('members').doc('unknown').set({ role: 'custom' });
      const audit = await prepare(blocked.id);
      assert.equal(audit.missingRoles, 1); assert.equal(audit.ambiguousArchives, 1); assert.equal(audit.unknownRoles, 1);
      await assert.rejects(prepare(blocked.id, 'apply'), /Review required/);
      assert.equal(Object.hasOwn((await blocked.collection('members').doc('missing').get()).data(), 'role'), false);
      assert.equal((await blocked.collection('membershipOperations').get()).size, 0);
      const large = db.collection('teams').doc('legacy-page-synthetic'); await large.set({ name: 'Synthetic' });
      const batch = db.batch();
      for (let i = 0; i < 141; i++) batch.set(large.collection('members').doc(`synthetic-${i}`), { name: 'Synthetic' });
      await batch.commit();
      const page = await prepare(large.id, 'apply');
      assert.equal(page.applied, 140); assert.equal(page.remaining, 1);
      assert.equal((await large.collection('members').where('role', '==', 'member').get()).size, 140);
      assert.equal((await prepare(large.id)).missingRoles, 1);
      await assert.rejects(prepare(large.id, 'apply'), /Review required/);
    });
    await t.test('managers restore one explicit alumni atomically without recovering old groups, permissions or parent links', async () => {
      const restore = { action: 'restore', memberUids: ['s2'], operationId: 'restore-1' };
      await team.collection('dailyReports').doc('restore-uid-history').set({ authorUid: 's2', author: 'Synthetic s2', createdAt: admin.Timestamp.fromMillis(100), fatigue: 3 });
      await team.collection('dailyReports').doc('restore-legacy-history').set({ author: 'Synthetic Restored', createdAt: admin.Timestamp.fromMillis(200), fatigue: 4 });
      await team.collection('dailyReports').doc('restore-deleted-history').set({ authorUid: 's2', createdAt: admin.Timestamp.fromMillis(300), fatigue: 1, status: 'deleted' });
      await team.collection('latestDailyReports').doc('s2').delete();
      const untouchedLatest = team.collection('latestDailyReports').doc('s3');
      await untouchedLatest.set({ id: 'other-user-preserved', fatigue: 2 });
      const beforeParent = (await members.doc('sibling').get()).data();
      const beforeOther = (await members.doc('s3').get()).data();
      await members.doc('s2').update({ grades: ['Old'], grade: 'Old', canUploadVideos: true, canEditTags: true, canEditCalendar: true, canPostTacticalNotes: true });
      await assert.rejects(backend.manage(request({ ...restore, phase: 'preview' }, 's2')), e => e.code === 'permission-denied');
      for (const memberUids of [[], ['s1', 's2'], ['bad/path'], ['missing'], ['s3']]) {
        await assert.rejects(backend.manage(request({ ...restore, memberUids, phase: 'preview' })), e => e.code === 'invalid-argument');
      }
      const stale = await backend.manage(request({ ...restore, phase: 'preview' }));
      assert.equal(stale.restoredCount, 1);assert.equal((await members.doc('s2').get()).data().role, 'alumni');
      assert.equal((await team.collection('membershipOperations').doc('restore-1').get()).exists, false);
      await members.doc('s2').update({ name: 'Synthetic Restored' });
      await assert.rejects(backend.manage(request({ ...restore, phase: 'commit', fingerprint: stale.fingerprint })), e => e.code === 'failed-precondition');
      const preview = await backend.manage(request({ ...restore, phase: 'preview' }));
      const commit = { ...restore, phase: 'commit', fingerprint: preview.fingerprint };
      const results = await Promise.all([backend.manage(request(commit)), backend.manage(request(commit))]);
      assert.equal(results.filter(r => r.replay).length, 1);
      const restored = (await members.doc('s2').get()).data();
      assert.equal(restored.role, 'member');assert.equal(restored.archived, false);
      assert.equal(Object.hasOwn(restored, 'graduationFiscalYear'), false);
      assert.equal(restored.grade, '');assert.deepEqual(restored.grades, []);assert.equal(restored.name, 'Synthetic Restored');
      for (const field of ['canUploadVideos', 'canEditTags', 'canEditCalendar', 'canPostTacticalNotes']) assert.equal(restored[field], false);
      assert.deepEqual((await team.get()).data().grades, ['Renamed']);
      assert.deepEqual((await members.doc('sibling').get()).data(), beforeParent);
      assert.deepEqual((await members.doc('s3').get()).data(), beforeOther);
      assert.equal((await members.doc('only').get()).exists, false);
      assert.equal((await team.collection('membershipOperations').doc('restore-1').collection('beforeMembers').doc('s2').get()).data().member.role, 'alumni');
      logs.length = 0;
      await loading.reconcileMembershipBatch(teamId, 'restore-1');
      const stateRef = team.collection('loadingOptimization').doc('state');
      assert.deepEqual((await stateRef.get()).data().latestUids, ['s2']);
      while ((await stateRef.get()).data().preparationStages[(await stateRef.get()).data().stage] !== 'restoreLatest') {
        assert.notEqual((await team.collection('membershipOperations').doc('restore-1').get()).data().status, 'complete');
        await loading.handlePreparation({ params: { teamId }, data: { after: await stateRef.get() } });
      }
      assert.equal((await team.collection('latestDailyReports').doc('s2').get()).exists, false);
      const latestStep = await stateRef.get();
      let transactions = 0;
      const crashingLoading = createLoadingOptimizationBackend({ firestore: {
        collection: (...args) => db.collection(...args),
        runTransaction: async work => {
          if (++transactions === 3) throw new Error('synthetic failure after latest commit');
          return db.runTransaction(work);
        },
      }, FieldValue: admin.FieldValue, FieldPath: admin.FieldPath, HttpsError, logger: { info: (...args) => logs.push(args) } });
      await assert.rejects(crashingLoading.handlePreparation({ params: { teamId }, data: { after: latestStep } }), /synthetic failure after latest commit/);
      const latest = (await team.collection('latestDailyReports').doc('s2').get()).data();
      assert.equal(latest.id, 'restore-legacy-history'); assert.equal(latest.authorUid, 's2'); assert.equal(latest.fatigue, 4);
      const afterCrash = (await stateRef.get()).data();
      assert.equal(afterCrash.stage, latestStep.data().stage);
      assert.equal(afterCrash.restoredLatestRevision, latestStep.data().preparationId);
      assert.deepEqual((await untouchedLatest.get()).data(), { id: 'other-user-preserved', fatigue: 2 });
      assert.equal((await team.get()).data().membershipBatchPending, true);
      const queriesBeforeReplay = logs.reduce((sum, [, m]) => sum + m.latestSearches, 0);
      assert.equal(queriesBeforeReplay, 1);
      await loading.handlePreparation({ params: { teamId }, data: { after: latestStep } });
      await finish('restore-1');
      assert.equal(logs.reduce((sum, [, m]) => sum + m.latestSearches, 0), 1);
      const payload = JSON.parse((await team.collection('system').doc('loadingContext_0').get()).data().payload);
      assert.equal(payload.members.some(m => m.uid === 's2'), true);
      assert.equal((await backend.listAlumni({ auth: { uid: 'manager' }, data: { teamId, fiscalYear: 2026 } })).members.some(m => m.uid === 's2'), false);
      const active = await sdk.getDocs(sdk.query(sdk.collection(managerDb, 'teams', teamId, 'members'), sdk.where('role', 'in', ACTIVE_MEMBER_QUERY_ROLES)));
      assert.equal(active.docs.some(d => d.id === 's2'), true);
      await assert.rejects(backend.manage(request({ ...restore, operationId: 'restore-again', phase: 'preview' })), e => e.code === 'invalid-argument');
      assert.equal((await backend.manage(request(commit))).replay, true);
    });
    await t.test('grade reordering changes one team array without membership writes or audience recomputation', async () => {
      await team.update({ grades: ['Renamed', 'New A', 'New B'] });
      const before = await team.get(), memberBefore = (await members.doc('s3').get()).data();
      const reorder = loadGradeOrderService(managerDb, sdk);
      await reorder(teamId, ['Renamed','New A','New B'], ['New B','Renamed','New A']);
      const after = await team.get();
      assert.deepEqual(after.data().grades, ['New B','Renamed','New A']);
      assert.deepEqual({ ...after.data(), grades: before.data().grades }, before.data());
      assert.deepEqual((await members.doc('s3').get()).data(), memberBefore);
      const count = logs.length;await loading.handleTeam({ params: { teamId }, data: { before, after } });assert.equal(logs.length, count);
      await assert.rejects(reorder(teamId, ['Renamed','New A','New B'], ['New A','New B','Renamed']), /更新されました/);
      await denied(loadGradeOrderService(client('s2'), sdk)(teamId, after.data().grades, ['Renamed','New A','New B']));
      await team.update({ membershipBatchPending: true });
      await assert.rejects(reorder(teamId, after.data().grades, ['Renamed','New A','New B']), /一括処理/);
      await team.update({ membershipBatchPending: false });
    });
    await t.test('board labels can change without losing legacy or pinned posts, rights or membership data', async () => {
      const board = {id:'rename-board',name:'1年生専用',shareScope:'grades',memberAudience:'grades',allowedGrades:['Renamed'],allowedRoleGroups:['staff'],notificationRecipientUids:['manager']};
      const other = {id:'other-board',name:'Other board',allowedRoleGroups:['staff']};
      await team.update({channels:[board,other]});
      const post = team.collection('workspacePosts').doc('legacy-board-post');
      await post.set({channel:'1年生専用',content:'Synthetic historical post',visibleToUids:['manager'],readTargetUids:['manager'],isPinned:true,createdAt:1});
      const before = await team.get(), profile = (await members.doc('s3').get()).data();
      const saved = await loadWorkspaceChannelService(managerDb,sdk)(teamId,{...board,displayName:'2年生専用'},board);
      assert.equal(saved[0].name,'1年生専用');assert.deepEqual(saved[0].allowedGrades,['Renamed']);assert.deepEqual(saved[1],other);
      const after = await team.get();assert.deepEqual({...after.data(),channels:before.data().channels},before.data());
      assert.deepEqual((await members.doc('s3').get()).data(),profile);assert.equal((await post.get()).data().channel,'1年生専用');
      const query = sdk.query(sdk.collection(managerDb,'teams',teamId,'workspacePosts'),sdk.where('visibleToUids','array-contains','manager'),sdk.where('channel','==','1年生専用'),sdk.where('isPinned','==',true));
      assert.equal((await sdk.getDocs(query)).docs.some(item=>item.id==='legacy-board-post'),true);
      const count = logs.length;await loading.handleTeam({params:{teamId},data:{before,after}});assert.equal(logs.length,count);
      await members.doc('rename-staff').set({name:'Synthetic Rename Staff',role:'staff'});
      await loadWorkspaceChannelService(client('rename-staff'),sdk)(teamId,{...saved[0],displayName:'3年生専用'},saved[0]);
      const current = (await team.get()).data().channels[0];
      await denied(loadWorkspaceChannelService(studentDb,sdk)(teamId,{...current,displayName:'Denied'},current));
      await assert.rejects(loadWorkspaceChannelService(managerDb,sdk)(teamId,{...board,displayName:'Stale'},board),/更新されました/);
      await team.update({membershipBatchPending:true});
      await assert.rejects(loadWorkspaceChannelService(managerDb,sdk)(teamId,{...current,displayName:'Blocked'},current),/一括処理/);
      await team.update({membershipBatchPending:false});
    });
  } finally { await Promise.all(clients.map(deleteApp)); await adminApp.deleteApp(app); }
});
