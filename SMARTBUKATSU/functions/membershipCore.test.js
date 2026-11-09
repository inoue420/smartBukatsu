const test = require('node:test'), assert = require('node:assert/strict');
const { membershipPlan, isGuardianLike, batchMembershipChange } = require('./membershipCore');
const { audienceForChannel, canViewChannel } = require('./workspaceAudience');
const team = { createdBy: 'owner', grades: ['3年', 'A'], channels: [{ id: 'g', shareScope: 'grades', allowedGrades: ['3年'], allowedRoleGroups: ['staff'] }] };
const students = [{ uid: 's1', name: 'Synthetic 1', role: 'member', grade: '3年', grades: ['3年', 'A'] }, { uid: 's2', role: 'captain', grades: ['3年'] }, { uid: 's3', role: 'member', grades: ['A'] }];
const input = { action: 'graduate', group: '3年', memberUids: ['s1', 's2'], fiscalYear: 2026, guardianPolicy: 'leave' };
test('rename keeps UID audiences and every secondary membership intact', () => {
  const plan = membershipPlan(team, students, { action: 'rename', group: '3年', name: '卒業前' });
  const changed = students.map((m) => ({ ...m, ...plan.changes.find((c) => c.uid === m.uid)?.data }));
  assert.deepEqual(audienceForChannel(team.channels[0], students), audienceForChannel(plan.teamChanges.channels[0], changed));
  assert.deepEqual(changed[0].grades, ['卒業前', 'A']);
  for (const name of ['', ' ', 'A', '3年', 'a'.repeat(61)]) assert.throws(() => membershipPlan(team, students, { action: 'rename', group: '3年', name }));
});
test('siblings, manual children, unknown children and owner links always prevent automatic removal', () => {
  const parents = [
    { uid: 'only', role: 'guardian', childUids: ['s1', 's2'] },
    { uid: 'sibling', role: 'guardian', childUids: ['s1', 's3'], childMemberships: { s1: 'old', s3: 'keep' } },
    { uid: 'manual', role: 'guardian', childUids: ['s2'], manualChildren: [{ id: 'manual-child' }] },
    { uid: 'unknown', role: 'guardian', childUids: ['s1', 'unknown-child'] },
    { uid: 'owner', role: 'guardian', childUids: ['s1'] },
  ];
  const p = membershipPlan(team, [...students, ...parents], input);
  assert.deepEqual(p.removals, ['only']);
  assert.deepEqual(p.changes.find((c) => c.uid === 'sibling').data, { childUids: ['s3'], childMemberships: { s3: 'keep' } });
  assert.deepEqual(p.changes.find((c) => c.uid === 'manual').data.childUids, []);
  const keep = membershipPlan(team, [...students, ...parents], { ...input, guardianPolicy: 'keep' });
  assert.deepEqual(keep.removals, []);
});
test('graduation clears active groups, persists fiscal year and revokes legacy and authored board access', () => {
  const original = students.map(m => ({ ...m, canUploadVideos: true, canEditTags: true }));
  const p = membershipPlan(team, original, input), alumni = { ...original[0], ...p.changes[0].data };
  assert.equal(alumni.graduationFiscalYear, 2026); assert.equal(alumni.archived, true); assert.deepEqual(alumni.grades, []);
  assert.equal(alumni.canUploadVideos, false); assert.equal(alumni.canEditTags, false);
  assert.equal(original[0].canUploadVideos, true);
  assert.equal(isGuardianLike(alumni.role), true);
  for (const channel of [{ allowedRoleGroups: ['guardian'] }, { allowedRoleGroups: ['member'] }, team.channels[0]]) assert.equal(canViewChannel(channel, alumni), false);
  assert.deepEqual(audienceForChannel(team.channels[0], [alumni], alumni.uid).visibleToUids, []);
});
test('graduation removes only affected groups that become empty and clears their board conditions atomically', () => {
  const source = { ...team, grades: [...team.grades, '新年度'] };
  const partial = membershipPlan(source, students, { ...input, memberUids: ['s1'] });
  assert.deepEqual(partial.removedGroups, []); assert.deepEqual(partial.teamChanges, {});
  const all = membershipPlan(source, students, input);
  assert.deepEqual(all.removedGroups, ['3年']); assert.deepEqual(all.teamChanges.grades, ['A', '新年度']);
  assert.deepEqual(all.teamChanges.channels[0].allowedGrades, []);
  assert.deepEqual(team.channels[0].allowedGrades, ['3年']);
});
test('individual graduations also remove empty secondary groups while preserving every remaining membership', () => {
  const parent = { uid: 'parent', role: 'guardian', grade: 'A', childUids: ['s1'] };
  const args = { ...input, group: '', memberUids: students.map(m => m.uid) };
  const keep = membershipPlan(team, [...students, parent], { ...args, guardianPolicy: 'keep' });
  assert.deepEqual(keep.teamChanges.grades, ['A']); assert.deepEqual(keep.removedGroups, ['3年']);
  const leave = membershipPlan(team, [...students, parent], args);
  assert.deepEqual(leave.teamChanges.grades, []); assert.deepEqual(leave.removedGroups, ['3年', 'A']);
  assert.deepEqual(leave.removals, ['parent']);
});
test('legacy missing catalogs use the same defaults as App; an explicit empty catalog stays empty', () => {
  const member = { uid: 'legacy', role: 'member', grade: '3年生' };
  const args = { ...input, memberUids: ['legacy'], group: '3年生' };
  const legacy = membershipPlan({ createdBy: 'owner' }, [member], args);
  assert.deepEqual(legacy.teamChanges.grades, ['1年生', '2年生']);
  assert.deepEqual(legacy.removedGroups, ['3年生']);
  assert.deepEqual(membershipPlan({ createdBy: 'owner', grades: [] }, [member], args).teamChanges, {});
});
test('invalid targets and fiscal years are rejected without a partial plan', () => {
  for (const changes of [{ memberUids: [] }, { memberUids: ['s1', 's1'] }, { memberUids: ['missing'] }, { fiscalYear: '2026' }, { fiscalYear: 0 }, { guardianPolicy: 'delete-account' }]) assert.throws(() => membershipPlan(team, students, { ...input, ...changes }));
  for (const role of ['owner', 'admin', 'staff', 'guardian', 'alumni']) assert.throws(() => membershipPlan(team, [{ ...students[0], role }], { ...input, memberUids: ['s1'] }));
});
test('only a new server operation stamp suppresses membership triggers', () => {
  assert.equal(batchMembershipChange({}, { membershipOperationId: 'one' }), true);
  assert.equal(batchMembershipChange({ membershipOperationId: 'one' }, { membershipOperationId: 'one', name: 'Changed' }), false);
  assert.equal(batchMembershipChange({}, null), false);
});
test('restoring an alumni returns a plain member without groups, fiscal year or individual edit permissions', () => {
  const alumni = { uid: 'old', name: 'Synthetic Graduate', role: 'alumni', archived: true, graduationFiscalYear: 2026,
    grade: '3年', grades: ['3年', 'A'], canUploadVideos: true, canEditTags: true, canEditCalendar: true, canPostTacticalNotes: true };
  const restore = { action: 'restore', memberUids: ['old'] };
  const result = membershipPlan(team, [alumni, ...students], restore);
  assert.deepEqual(result.changes, [{ uid: 'old', data: { role: 'member', archived: false, graduationFiscalYear: null,
    grade: '', grades: [], canEditCalendar: false, canPostTacticalNotes: false, canUploadVideos: false, canEditTags: false } }]);
  assert.deepEqual(result.teamChanges, {}); assert.deepEqual(result.removals, []); assert.deepEqual(result.removedGroups, []);
  assert.equal(alumni.role, 'alumni'); assert.equal(alumni.graduationFiscalYear, 2026);
  for (const memberUids of [[], ['old', 'old'], ['old', 's1'], ['s1'], ['missing']]) assert.throws(() => membershipPlan(team, [alumni, ...students], { ...restore, memberUids }));
  assert.throws(() => membershipPlan(team, [{ ...alumni, role: 'guardian' }], restore));
});
