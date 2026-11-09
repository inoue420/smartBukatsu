const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { parse } = require('@babel/parser');
const { ACTIVE_MEMBER_QUERY_ROLES } = require('../../functions/membershipCore');
const { appHarness, screenHarness } = require('../../scripts/calendarWeekStartTestHarness.cjs');
function memberServices(watchers, serverReads) {
  const source = fs.readFileSync(path.join(__dirname, 'firestoreService.js'), 'utf8');
  const names = ['teamMemberQuery', 'teamMemberRows', 'subscribeTeamMembers', 'getTeamMembersFromServer'];
  const functions = parse(source, { sourceType: 'module' }).program.body.map(n => n.declaration || n).filter(n => names.includes(n.id?.name));
  return new Function('db', 'where', 'or', 'documentId', 'query', 'collection', 'subscribeToTeamData', 'ACTIVE_MEMBER_QUERY_ROLES', 'getDocsFromServer', 'doc', 'getDoc',
    functions.map(n => source.slice(n.start, n.end)).join('\n') + ';return {subscribeTeamMembers,getTeamMembersFromServer};')(
    'db', (field, op, value) => ({ field, op, value }), (...clauses) => ({ clauses }), () => '__name__',
    (collection, clause) => ({ collection, clause }), (...args) => args,
    (name, query, next) => { const w = { name, query, next, stops: 0 }; watchers.push(w); return () => w.stops++; }, ACTIVE_MEMBER_QUERY_ROLES,
    async query => { serverReads.push(query);return { docs: [{ id: 'canonical', data: () => ({ uid: 'stale', name: null, role: 'member' }) }] }; }, (...args) => args,
    async () => ({ exists: () => true, data: () => ({ name: 'Synthetic Fallback' }) }));
}
test('the actual member subscription uses one active query without the failing document-ID OR', async () => {
  const watchers = [], values = [], reads = [], services = memberServices(watchers, reads);
  const stop = services.subscribeTeamMembers('synthetic', result => values.push(result), 'self');
  assert.equal(watchers.length, 1);
  assert.deepEqual(watchers[0].query.clause, { field: 'role', op: 'in', value: ACTIVE_MEMBER_QUERY_ROLES });
  const docs = [{ id: 'legacy', data: () => ({ name: 'Synthetic', role: null }) }];
  await watchers[0].next({ docs }); assert.equal(values[0][0].uid, 'legacy');
  stop(); await watchers[0].next({ docs }); assert.equal(values.length, 1); assert.equal(watchers[0].stops, 1);
  assert.equal(reads.length, 0);
});
test('explicit refresh uses the same server query, preserves canonical UID and resolves legacy names', async () => {
  const watchers = [], reads = [], services = memberServices(watchers, reads);
  assert.equal(reads.length, 0);
  const rows = await services.getTeamMembersFromServer('synthetic', 'self');
  assert.equal(reads.length, 1);assert.equal(watchers.length, 0);
  assert.equal(reads[0].clause.value.includes('alumni'), false);
  assert.equal(rows[0].uid, 'canonical');assert.equal(rows[0].name, 'Synthetic Fallback');
});
test('legacy profile defaults stay members in the actual app without losing groups or guardian links', () => {
  const app = appHarness();
  app.latest('TeamMembers').args[1]([
    { uid: 'legacy', name: 'Synthetic Legacy', grade: 'Final', grades: ['Final', 'Other'], canEditTags: true },
    { uid: 'parent', name: 'Synthetic Parent', role: 'guardian', childUids: ['legacy'] },
  ]);
  app.h.update();
  const props = app.screen('Roster');
  assert.equal(props.userProfiles['Synthetic Legacy'].role, 'member');
  assert.deepEqual(props.userProfiles['Synthetic Legacy'].grades, ['Final', 'Other']);
  assert.equal(props.userProfiles['Synthetic Legacy'].canEditTags, true);
  assert.deepEqual(props.userProfiles['Synthetic Parent'].childUids, ['legacy']);
  app.h.unmount();
});
test('App reuses the existing auth identity for its own alumni profile without restarting member queries', () => {
  const app = appHarness();
  const count = () => app.subscriptions.filter(s => s.name === 'TeamMembers').length;
  const watches = count();
  app.change({ currentMemberProfile: { uid: 'coach', name: 'Synthetic Alumni', role: 'alumni', graduationFiscalYear: 2026, canEditTags: true } });
  app.latest('TeamMembers').args[1]([{ uid: 'active', name: 'Synthetic Active', role: 'member' }]);app.h.update();
  const profiles = app.screen('Roster').userProfiles;
  assert.equal(Object.keys(profiles).length, 2);assert.equal(profiles['Synthetic Alumni'].role, 'alumni');
  assert.equal(profiles['Synthetic Alumni'].canEditTags, true);assert.equal(count(), watches);
  app.change({ currentMemberProfile: { uid: 'coach', name: 'Synthetic Alumni', role: 'alumni', canEditTags: false } });
  assert.equal(app.screen('Roster').userProfiles['Synthetic Alumni'].canEditTags, false);assert.equal(count(), watches);
  app.change({ activeTeamId: 'b', currentMemberProfile: null });
  assert.equal(Object.keys(app.screen('Roster').userProfiles).length, 0);app.h.unmount();
});
test('Settings refresh replaces a partial list only on demand and prevents duplicate taps', async () => {
  let resolve;const calls = [], updatedNames = [], updatedProfiles = [];
  const s = screenHarness('SettingsScreen', { setClubMembers: x => updatedNames.push(x), setUserProfiles: x => updatedProfiles.push(x), clubMembers: ['Coach'] }, {
    getTeamMembersFromServer: (...args) => { calls.push(args);return new Promise(r => { resolve = r; }); },
  });
  assert.equal(calls.length, 0);
  const button = s.button('一覧を更新');assert.ok(button);
  const work = button.props.onPress();await button.props.onPress();s.h.update();
  assert.equal(calls.length, 1);assert.deepEqual(calls[0], ['a', 'coach']);
  resolve([{ uid: 'coach', name: 'Coach', role: 'admin' }, { uid: 'captain', name: 'Synthetic Captain', role: 'captain' }, { uid: 'member', name: 'Synthetic Member', grades: ['Final', 'Other'], childUids: [] }]);
  await work;s.h.update();
  assert.equal(updatedNames[0].length, 3);assert.equal(Object.keys(updatedProfiles[0]).length, 3);
  assert.equal(updatedProfiles[0]['Synthetic Member'].role, 'member');assert.deepEqual(updatedProfiles[0]['Synthetic Member'].grades, ['Final', 'Other']);
  assert.ok(s.h.text(s.h.render()).includes('3人分の最新情報を取得しました。'));s.h.unmount();
});
test('Settings drops a late refresh after switching teams and preserves the list on failure', async () => {
  let resolve;const writes = [];
  const s = screenHarness('SettingsScreen', { setClubMembers: x => writes.push(x), setUserProfiles: x => writes.push(x) }, {
    getTeamMembersFromServer: () => new Promise(r => { resolve = r; }),
  });
  const pending = s.button('一覧を更新').props.onPress();s.change({}, { activeTeamId: 'b' });resolve([{ uid: 'stale', name: 'Synthetic Old Team' }]);await pending;s.h.update();assert.equal(writes.length, 0);s.h.unmount();
  const failed = screenHarness('SettingsScreen', { setClubMembers: x => writes.push(x), setUserProfiles: x => writes.push(x), clubMembers: ['Coach'] }, {
    getTeamMembersFromServer: async () => { throw Error('synthetic offline'); },
  });
  await failed.button('一覧を更新').props.onPress();failed.h.update();assert.equal(writes.length, 0);
  assert.ok(failed.h.text(failed.h.render()).includes('一覧を更新できませんでした。'));failed.h.unmount();
});
