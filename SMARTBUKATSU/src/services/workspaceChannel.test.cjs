const test = require('node:test'), assert = require('node:assert/strict');
const { loadWorkspaceChannelService } = require('../../scripts/calendarWeekStartTestHarness.cjs');
const { channelDisplayName } = require('../../functions/workspaceAudience');
const board = { id: 'board', name: '1年生', shareScope: 'grades', allowedGrades: ['1年生'], allowedRoleGroups: ['staff'], notificationRecipientUids: ['coach'] };
function harness(team = { channels: [board] }) {
  const writes = [], reads = [];let current = team;
  const save = loadWorkspaceChannelService('synthetic', { doc: (_db,...path) => path.join('/'), runTransaction: async (_db, run) => {
    const pending = [];
    const result = await run({ get: async ref => { reads.push(ref);return { exists: () => current != null, data: () => current }; }, update: (ref,data) => pending.push({ref,data}) });
    for (const write of pending) { writes.push(write);current = {...current,...write.data}; }return result;
  } });
  return { save, writes, reads, get team() { return current; } };
}
test('renaming reads and updates one team document while preserving the exact post key, audiences and other channels', async () => {
  const other = { id:'other', name:'Other', custom:'a concurrent addition' }, s = harness({channels:[board,other], grades:['1年生'], metadata:'keep'});
  const next = {...board,displayName:'2年生'};await s.save('team',next,board);
  assert.deepEqual(s.reads,['teams/team']);assert.equal(s.writes.length,1);assert.deepEqual(s.team.channels,[next,other]);
  assert.equal(s.team.channels[0].name,'1年生');assert.equal(channelDisplayName(s.team.channels[0]),'2年生');assert.equal(s.team.metadata,'keep');
  await s.save('team',next,next);assert.equal(s.writes.length,1);
});
test('a concurrent audience change, rename, deletion or pending graduation refuses the whole save', async () => {
  const next = {...board,displayName:'2年生'};
  for (const team of [ {channels:[{...board,allowedGrades:['3年生']}]}, {channels:[{...board,displayName:'Other label'}]},
    {channels:[{id:'other',name:'Other'}]}, {channels:[board],membershipBatchPending:true} ]) {
    const s = harness(team);await assert.rejects(s.save('team',next,board));assert.equal(s.writes.length,0);
  }
  await assert.rejects(harness(null).save('missing',next,board));
});
test('board IDs and legacy routing names cannot be changed; empty and duplicate labels are rejected', async () => {
  for (const next of [{...board,id:'different'}, {...board,name:'2年生'}, {...board,displayName:'x'.repeat(101)}]) {
    const s = harness();await assert.rejects(s.save('team',next,board));assert.equal(s.reads.length,0);
  }
  const second = {id:'other',name:'Reserved old name',displayName:'Used label'}, s = harness({channels:[board,second]});
  await assert.rejects(s.save('team',{...board,displayName:'Used label'},board),/同じ名前/);
  await assert.rejects(s.save('team',{id:'new',name:'Reserved old name'}),/以前/);assert.equal(s.writes.length,0);
});
test('legacy teams without stored channels keep the default board when its displayed name changes', async () => {
  const general = {id:'ch_1',name:'全体連絡',memberAudience:'all',allowedRoleGroups:['staff','captain','member']}, s = harness({grades:['1年生']});
  await s.save('team',{...general,displayName:'チーム連絡'},general,[general]);
  assert.equal(s.team.channels[0].name,'全体連絡');assert.equal(s.team.channels[0].displayName,'チーム連絡');assert.deepEqual(s.team.grades,['1年生']);
});
