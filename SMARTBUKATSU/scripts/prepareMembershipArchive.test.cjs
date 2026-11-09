const test = require('node:test'), assert = require('node:assert/strict');
const { inspectRoster, PAGE_SIZE } = require('./prepareMembershipArchive.cjs');
const { ACTIVE_MEMBER_ROLES, ACTIVE_MEMBER_QUERY_ROLES } = require('../functions/membershipCore');
const snap = (data, id = 'synthetic') => ({ id, data: () => data });
test('legacy repair matches the old default without promoting existing roles', () => {
  const legacy = [{}, { role: '' }, { role: null }, { role: false }, { role: 0 }].map((d, i) => snap(d, String(i)));
  const existing = [...ACTIVE_MEMBER_ROLES, 'alumni'].map(role => snap({ role }));
  const plan = inspectRoster([...legacy, ...existing]);
  assert.deepEqual(plan.pending, legacy); assert.equal(plan.unknownRoles, 0); assert.equal(plan.ambiguousArchives, 0);
  assert.ok(PAGE_SIZE * 3 + 2 <= 430);
});
test('ambiguous archive data and unknown roles are reported without repair targets', () => {
  const plan = inspectRoster([
    snap({ archived: true }), snap({ role: null, graduationFiscalYear: 2026 }), snap({ archived: null }),
    snap({ role: 'legacy-custom-role' }), snap({ role: ' ' }), snap({ role: {}, archived: false }),
  ]);
  assert.equal(plan.pending.length, 0); assert.equal(plan.ambiguousArchives, 3); assert.equal(plan.unknownRoles, 3);
});
test('the active query accepts legacy defaults while excluding the archive role', () => {
  for (const value of [...ACTIVE_MEMBER_ROLES, '', false, 0]) assert.ok(ACTIVE_MEMBER_QUERY_ROLES.includes(value));
  assert.equal(ACTIVE_MEMBER_QUERY_ROLES.includes(null), false);
  assert.equal(ACTIVE_MEMBER_QUERY_ROLES.includes('alumni'), false);
  assert.equal(ACTIVE_MEMBER_QUERY_ROLES.includes(undefined), false);
});
