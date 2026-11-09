// Operator-only repair. No connection without explicit project/team arguments;
// default is a count-only audit. Never print names, UIDs or credential material.
const { ACTIVE_MEMBER_ROLES } = require('../functions/membershipCore');
const PAGE_SIZE = 140;
function inspectRoster(documents) {
  const pending = [];
  let unknownRoles = 0, ambiguousArchives = 0;
  for (const snap of documents) {
    const data = snap.data();
    if (data.role === 'alumni' || ACTIVE_MEMBER_ROLES.includes(data.role)) continue;
    if (data.role) { unknownRoles++; continue; }
    // Never turn an ambiguous archived record into an active member.
    if ((data.archived !== undefined && data.archived !== false) ||
        Object.hasOwn(data, 'graduationFiscalYear')) { ambiguousArchives++; continue; }
    pending.push(snap);
  }
  return { pending, unknownRoles, ambiguousArchives };
}
function createArchivePreparation({ firestore: db, FieldValue }) {
  return async function prepare(teamId, mode = 'audit') {
    if (!['audit', 'apply'].includes(mode) || !/^[A-Za-z0-9_-]{1,128}$/.test(teamId)) throw new Error('Invalid repair scope.');
    const team = db.collection('teams').doc(teamId);
    return db.runTransaction(async (tx) => {
      const [root, roster] = await Promise.all([tx.get(team), tx.get(team.collection('members'))]);
      if (!root.exists) throw new Error('Team unavailable.');
      const plan = inspectRoster(roster.docs);
      const result = { total: roster.size, missingRoles: plan.pending.length, unknownRoles: plan.unknownRoles,
        ambiguousArchives: plan.ambiguousArchives, pendingOperation: root.data().membershipBatchPending === true,
        applied: 0, remaining: plan.pending.length };
      if (mode === 'audit') return result;
      if (result.unknownRoles || result.ambiguousArchives || result.pendingOperation) throw new Error('Review required before repair.');
      if (!plan.pending.length) return result;
      const page = plan.pending.slice(0, PAGE_SIZE), job = team.collection('membershipOperations').doc();
      for (const snap of page) {
        tx.set(db.collection('users').doc(snap.id).collection('membershipArchiveTeams').doc(teamId), { teamId });
        tx.create(job.collection('beforeMembers').doc(snap.id), { member: snap.data() });
        tx.update(snap.ref, { role: 'member', membershipOperationId: job.id });
      }
      tx.update(team, { membershipOperationId: job.id, membershipBatchPending: true });
      tx.create(job, { participantUids: page.map((s) => s.id), status: 'queued', action: 'migration',
        actorUid: 'operator-migration', requestHash: 'operator-migration', migrationVersion: 2,
        createdAt: FieldValue.serverTimestamp() });
      return { ...result, applied: page.length, remaining: plan.pending.length - page.length, pendingOperation: true };
    });
  };
}
async function main() {
  const [project, scope, mode = 'audit'] = process.argv.slice(2);
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project || '') ||
      !scope || (scope !== '--all-teams' && !/^[A-Za-z0-9_-]{1,128}$/.test(scope)) || !['audit', 'apply'].includes(mode)) {
    throw new Error('Usage: node scripts/prepareMembershipArchive.cjs <explicit-project> <team-id|--all-teams> [audit|apply]');
  }
  const { createRequire } = require('node:module'), path = require('node:path');
  const dependencies = createRequire(path.join(__dirname, '../functions/package.json'));
  const { initializeApp, deleteApp } = dependencies('firebase-admin/app');
  const { getFirestore, FieldValue } = dependencies('firebase-admin/firestore');
  const app = initializeApp({ projectId: project });
  try {
    const db = getFirestore(app), prepare = createArchivePreparation({ firestore: db, FieldValue });
    const ids = scope === '--all-teams' ? (await db.collection('teams').select().get()).docs.map((s) => s.id) : [scope];
    const audits = [];
    for (const id of ids) audits.push(await prepare(id));
    const totals = (rows) => rows.reduce((sum, row) => {
      for (const key of ['total', 'missingRoles', 'unknownRoles', 'ambiguousArchives', 'applied', 'remaining']) sum[key] += row[key];
      sum.pendingTeams += Number(row.pendingOperation); return sum;
    }, { teams: ids.length, total: 0, missingRoles: 0, unknownRoles: 0, ambiguousArchives: 0, applied: 0, remaining: 0, pendingTeams: 0 });
    if (mode === 'audit') { process.stdout.write(JSON.stringify({ mode, ...totals(audits) }) + '\n'); return; }
    // Inspect every selected team before writing. Each apply transaction then
    // revalidates the data, including concurrent membership operations.
    if (audits.some((r) => r.unknownRoles || r.ambiguousArchives || r.pendingOperation)) throw new Error('Review required before repair.');
    const results = [];
    for (let i = 0; i < ids.length; i++) results.push(audits[i].missingRoles ? await prepare(ids[i], 'apply') : audits[i]);
    process.stdout.write(JSON.stringify({ mode, ...totals(results) }) + '\n');
  } finally { await deleteApp(app); }
}
module.exports = { inspectRoster, createArchivePreparation, PAGE_SIZE };
if (require.main === module) main().catch(() => {
  process.stderr.write('Archive preparation failed. Check scope, credentials, ambiguous records and pending operations before retrying.\n');
  process.exitCode = 1;
});
