const { createHash } = require('node:crypto');
const { ACTIVE_MEMBER_QUERY_ROLES, membershipPlan, creationKey } = require('./membershipCore');
const { stableStringify } = require('./loadingOptimizationCore');
const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const fingerprint = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');

function createMembershipBackend({ firestore, FieldValue, HttpsError }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  async function manage(request) {
    const uid = request.auth?.uid, data = request.data || {}, { teamId, operationId } = data;
    if (!uid) fail('unauthenticated', 'ログインが必要です。');
    if (!validId(teamId) || !validId(operationId) || !['preview', 'commit'].includes(data.phase)) fail('invalid-argument', '処理を確認してください。');
    const team = firestore.collection('teams').doc(teamId), job = team.collection('membershipOperations').doc(operationId);
    return firestore.runTransaction(async (tx) => {
      const [teamSnap, caller, previous] = await Promise.all([tx.get(team), tx.get(team.collection('members').doc(uid)), tx.get(job)]);
      if (!teamSnap.exists || !caller.exists || !['owner', 'admin', 'staff'].includes(caller.data().role)) fail('permission-denied', '監督・スタッフのみ操作できます。');
      const input = { action: data.action, group: data.group || '', name: data.name || '', memberUids: data.memberUids || [], fiscalYear: data.fiscalYear ?? null, guardianPolicy: data.guardianPolicy || 'keep' };
      if (input.action === 'restore' && (!Array.isArray(input.memberUids) || input.memberUids.length !== 1 || !validId(input.memberUids[0]))) fail('invalid-argument', '戻す卒業者を1名選んでください。');
      const requestHash = fingerprint(input);
      if (previous.exists) {
        if (previous.data().actorUid !== uid || previous.data().requestHash !== requestHash) fail('already-exists', '別の処理に使われた操作番号です。');
        return { operationId, status: previous.data().status, replay: true };
      }
      if (teamSnap.data().membershipBatchPending) fail('failed-precondition', '前の一括処理が完了するまでお待ちください。');
      // Restoration needs only the explicitly selected archive, never the full archive or roster.
      const roster = input.action === 'restore'
        ? { docs: [await tx.get(team.collection('members').doc(input.memberUids[0]))].filter(s => s.exists) }
        : await tx.get(team.collection('members').where('role', 'in', ACTIVE_MEMBER_QUERY_ROLES));
      const members = roster.docs.map((s) => ({ ...s.data(), role: s.data().role || 'member', uid: s.id }));
      let plan;
      try { plan = membershipPlan(teamSnap.data(), members, input); } catch (error) { fail('invalid-argument', error.message); }
      // A single atomic commit has a conservative document/request-size budget.
      // Reject before any writes; the user can select a smaller set of graduates.
      if (plan.changes.length * 3 + plan.removals.length * 5 + 3 > 430) fail('resource-exhausted', '対象が多いため、対象者を分けて実行してください。');
      const token = fingerprint({ input, plan, roster: roster.docs.map((s) => [s.id, creationKey(s), s.data()]) });
      const summary = { changedCount: plan.changes.length, graduateCount: input.action === 'graduate' ? input.memberUids.length : 0,
        restoredCount: input.action === 'restore' ? plan.changes.length : 0, removedGroups: plan.removedGroups,
        leavingGuardians: plan.removals.map((id) => ({ uid: id, name: members.find((m) => m.uid === id)?.name || '保護者' })),
        keptGuardians: plan.changes.filter((c) => c.data.childUids).map((c) => ({ uid: c.uid, name: members.find((m) => m.uid === c.uid)?.name || '保護者' })) };
      if (data.phase === 'preview') return { operationId, fingerprint: token, ...summary };
      if (data.fingerprint !== token) fail('failed-precondition', '対象情報が更新されました。内容を再確認してください。');
      const users = await Promise.all(plan.removals.map((id) => tx.get(firestore.collection('users').doc(id))));
      const participants = [...new Set([uid, ...plan.changes.map((c) => c.uid), ...plan.removals])];
      for (const id of participants) tx.set(firestore.collection('users').doc(id).collection('membershipArchiveTeams').doc(teamId), { teamId });
      for (const change of plan.changes) {
        tx.create(job.collection('beforeMembers').doc(change.uid), { member: roster.docs.find((s) => s.id === change.uid).data() });
        tx.update(team.collection('members').doc(change.uid), { ...change.data,
          ...(input.action === 'restore' ? { graduationFiscalYear: FieldValue.delete() } : {}), membershipOperationId: operationId });
      }
      plan.removals.forEach((id, i) => {
        const snap = roster.docs.find((s) => s.id === id), user = users[i].data() || {};
        const teamIds = [...new Set([...(user.teamIds || []), ...(user.activeTeamId ? [user.activeTeamId] : [])])].filter((t) => t !== teamId);
        tx.create(job.collection('beforeMembers').doc(id), { member: snap.data(), userMembership: { teamIds: user.teamIds || [], activeTeamId: user.activeTeamId || '' } });
        tx.set(team.collection('membershipRemovals').doc(id), { creationKey: creationKey(snap), operationId });
        tx.delete(team.collection('members').doc(id));
        if (users[i].exists) tx.update(users[i].ref, { teamIds, activeTeamId: user.activeTeamId === teamId ? teamIds[0] || '' : user.activeTeamId || '', updatedAt: FieldValue.serverTimestamp() });
      });
      tx.update(team, { ...plan.teamChanges, membershipOperationId: operationId, membershipBatchPending: true });
      tx.create(job, { actorUid: uid, participantUids: participants, requestHash, action: input.action, status: 'queued', beforeTeam: Object.fromEntries(['grades', 'channels'].filter((key) => teamSnap.data()[key] !== undefined).map((key) => [key, teamSnap.data()[key]])), createdAt: FieldValue.serverTimestamp(), ...summary });
      return { operationId, status: 'queued', ...summary };
    });
  }
  async function listAlumni(request) {
    const uid = request.auth?.uid, { teamId, fiscalYear, cursor } = request.data || {};
    if (!uid) fail('unauthenticated', 'ログインが必要です。');
    if (!validId(teamId) || !Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200 ||
      (cursor && (!validId(cursor.uid) || typeof cursor.name !== 'string' || cursor.name.length > 1000))) fail('invalid-argument', '年度を確認してください。');
    const team = firestore.collection('teams').doc(teamId), caller = await team.collection('members').doc(uid).get();
    if (!caller.exists || !['owner', 'admin', 'staff'].includes(caller.data().role)) fail('permission-denied', '監督・スタッフのみ表示できます。');
    let query = team.collection('members').where('role', '==', 'alumni').where('graduationFiscalYear', '==', fiscalYear).orderBy('name').orderBy('__name__').limit(30);
    if (cursor) query = query.startAfter(cursor.name, cursor.uid);
    const page = await query.get(), last = page.docs.at(-1);
    // Return only fields used by the archive view, never internal operation data.
    return { members: page.docs.map((s) => { const m = s.data(); return { uid: s.id, name: m.name || '名称未設定', role: 'alumni', graduationFiscalYear: m.graduationFiscalYear }; }),
      hasMore: page.size === 30, cursor: last ? { uid: last.id, name: last.data().name } : null };
  }
  async function relatedTeamIds(uid) {
    return (await firestore.collection('users').doc(uid).collection('membershipArchiveTeams').get()).docs.map((s) => s.id);
  }
  async function anonymizeTeam(team, uid) {
    const jobs = await team.collection('membershipOperations').where('participantUids', 'array-contains', uid).get();
    for (const job of jobs.docs) await firestore.runTransaction(async (tx) => {
      const current = await tx.get(job.ref);
      if (!current.exists) return;
      const data = current.data();
      tx.delete(job.ref.collection('beforeMembers').doc(uid));
      tx.update(job.ref, { participantUids: (data.participantUids || []).filter((id) => id !== uid),
        ...(data.actorUid === uid ? { actorUid: 'deleted_user' } : {}), beforeTeam: FieldValue.delete(),
        leavingGuardians: (data.leavingGuardians || []).filter((m) => m.uid !== uid), keptGuardians: (data.keptGuardians || []).filter((m) => m.uid !== uid) });
    });
    await team.collection('membershipRemovals').doc(uid).delete();
    return jobs.size;
  }
  return { manage, listAlumni, relatedTeamIds, anonymizeTeam };
}
module.exports = { createMembershipBackend };
