const test = require('node:test'), assert = require('node:assert/strict');
const { load, renderHarness, screenHarness } = require('../../scripts/calendarWeekStartTestHarness.cjs');
function harness(name, overrides = {}, extraProps = {}) {
  const h = renderHarness(), calls = [], watches = [], alerts = [];
  const services = {
    previewMembershipOperation: async (team, input) => { calls.push({ type: 'preview', team, input }); return { operationId: 'operation', fingerprint: 'verified', graduateCount: input.memberUids.length, leavingGuardians: [{ uid: 'p', name: 'Synthetic Parent' }], keptGuardians: [], removedGroups: input.action === 'graduate' ? ['Final'] : [] }; },
    commitMembershipOperation: async (team, input, preview) => { calls.push({ type: 'commit', team, input, preview }); return { operationId: 'operation', status: 'queued' }; },
    subscribeMembershipOperation: (team, operationId, next) => { const w = { team, operationId, next, stops: 0 }; watches.push(w); return () => w.stops++; },
    getAlumniPage: async (team, year, cursor) => { calls.push({ type: 'archive', team, year, cursor }); return { members: [{ uid: cursor ? 'second' : 'first', name: 'Synthetic Graduate', graduationFiscalYear: year, canUploadVideos: true, canEditTags: true }], cursor: { uid: 'first', name: 'Synthetic Graduate' }, hasMore: !cursor }; },
    ...overrides,
  };
  const native = { Platform: { OS: 'ios' }, KeyboardAvoidingView: 'KeyboardAvoidingView', StyleSheet: { create: (s) => s }, Alert: { alert: (...args) => alerts.push(args) } };
  for (const key of ['View', 'Text', 'TextInput', 'TouchableOpacity', 'ScrollView', 'Modal']) native[key] = key;
  const modules = { react: h.react, 'react-native': native, '../../functions/workspaceAudience': require('../../functions/workspaceAudience'), '../services/firestoreService': services };
  const components = load('src/components/MembershipManagementModal.js', modules);
  const Component = name === 'archive' ? components.AlumniArchiveModal : components.default;
  const props = { teamId: 'team', group: 'Final', profiles: { one: { uid: 's1', name: 'Synthetic One', role: 'member', grades: ['Final'] }, two: { uid: 's2', name: 'Synthetic Two', role: 'captain', grades: ['Final'] } }, onClose: () => {}, ...extraProps };
  h.mount(() => Component(props));
  const button = (text) => h.find((n) => (typeof n.type === 'function' || n.type === 'TouchableOpacity') && h.text(n).startsWith(text));
  return { h, calls, watches, alerts, props, button,
    async press(text) { const b = button(text); assert.ok(b, `Missing ${text}`); assert.ok(!b.props.disabled); await b.props.onPress(); h.update(); },
    change(label, value) { const input = h.find((n) => n.props?.accessibilityLabel === label); assert.ok(input); input.props.onChangeText(value); h.update(); } };
}
test('graduation selection, fiscal year and guardian decision require a preview before committing', async () => {
  const s = harness();
  assert.equal(s.calls.length, 0);
  await s.press('卒業'); s.change('卒業年度', '2026');
  const other = s.h.find((n) => n.props?.accessibilityRole === 'checkbox' && s.h.text(n).includes('Synthetic Two'));
  other.props.onPress(); s.h.update(); await s.press('対象チームから退会');
  await s.press('変更内容を確認する');
  assert.equal(s.calls.length, 1); assert.equal(s.calls[0].type, 'preview');
  assert.deepEqual(Array.from(s.calls[0].input.memberUids), ['s1']); assert.equal(s.calls[0].input.fiscalYear, 2026); assert.equal(s.calls[0].input.guardianPolicy, 'leave');
  assert.equal(s.watches.length, 0);
  assert.ok(s.h.text(s.h.render()).includes('学年・グループ一覧から除去：Final'));
  await s.press('確認した内容で実行する');
  assert.equal(s.calls[1].type, 'commit'); assert.equal(s.watches.length, 1);
  s.watches[0].next({ status: 'complete' }); s.h.update();
  assert.equal(s.watches[0].stops, 1); assert.ok(s.h.text(s.h.render()).includes('一括処理が完了しました'));
  s.h.unmount();
});
test('opening the archive loads the current fiscal year once, then paginates and explicitly switches years', async () => {
  const s = harness('archive'); assert.equal(s.calls.length, 1);
  await new Promise(setImmediate);s.h.update();
  const now = new Date(), fiscalYear = now.getFullYear() - (now.getMonth() < 3 ? 1 : 0);
  assert.equal(s.calls[0].year, fiscalYear); assert.equal(s.calls[0].cursor, null);
  assert.equal(s.h.text(s.h.render()).includes('動画追加'), false);
  assert.equal(s.h.text(s.h.render()).includes('タグ編集'), false);
  await s.press('さらに読み込む'); assert.equal(s.calls[1].cursor.uid, 'first');
  assert.equal(s.watches.length, 0);
  s.change('表示する卒業年度', '2025'); assert.ok(!s.h.text(s.h.render()).includes('Synthetic Graduate'));
  assert.equal(s.calls.length, 2);
  await s.press('この年度の卒業生を表示');assert.equal(s.calls[2].year, 2025);assert.equal(s.calls[2].cursor, null);
  s.h.unmount();
});
test('the OB/OG entry lives inside the Settings member list and is manager-only without background loading', () => {
  let reads = 0;
  const s = screenHarness('SettingsScreen', {}, { getAlumniPage: async () => { reads++; } });
  const members = s.h.find(n => n.props?.title === '👥 部員リスト・権限・担当管理');
  const grades = s.h.find(n => n.props?.title === '🎓 学年・グループ管理');
  const entry = n => n.props?.accessibilityLabel === 'OB・OG一覧を開く';
  assert.equal(s.h.all(entry, members).length, 1);assert.equal(s.h.all(entry, grades).length, 0);assert.equal(reads, 0);
  const archive = n => n.props?.teamId === 'a' && n.props?.menuStyles && n.props?.onClose && !n.props?.profiles;
  assert.equal(s.h.all(archive).length, 0);
  s.byLabel('OB・OG一覧を開く').props.onPress();s.h.update();assert.equal(s.h.all(archive).length, 1);
  s.h.find(archive).props.onClose();s.h.update();assert.equal(s.h.all(archive).length, 0);s.h.unmount();
  const guardian = screenHarness('SettingsScreen', { userProfiles: { Coach: { uid: 'coach', role: 'guardian' } } });
  assert.equal(guardian.byLabel('OB・OG一覧を開く'), undefined);guardian.h.unmount();
});
test('a stale preview returns to confirmation while an uncertain commit retries the same operation ID', async () => {
  let stale = true;
  const s = harness('manage', { commitMembershipOperation: async (team, input, preview) => { s.calls.push({ type: 'commit', preview }); if (stale) { stale = false; throw Object.assign(new Error('changed'), { code: 'functions/failed-precondition' }); } throw Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }); } });
  s.change('変更後のグループ名', 'Renamed'); await s.press('変更内容を確認する'); await s.press('確認した内容で実行する');
  assert.ok(s.button('変更内容を確認する'));
  await s.press('変更内容を確認する'); await s.press('確認した内容で実行する'); await s.press('確認した内容で実行する');
  assert.equal(s.calls.filter((c) => c.type === 'preview').length, 2);
  assert.equal(s.calls.filter((c) => c.type === 'commit').every((c) => c.preview.operationId === 'operation'), true);
  s.h.unmount();
});
test('the archive opens a restore confirmation and removes only the acknowledged member without rereading', async () => {
  const s = harness('archive'); await new Promise(setImmediate);s.h.update();
  await s.press('さらに読み込む');
  await s.press('一般部員へ戻す');
  const dialog = s.h.find(n => n.props?.restoreMember);
  assert.equal(dialog.props.restoreMember.uid, 'first');
  assert.equal(s.calls.filter(c => c.type === 'preview' || c.type === 'commit').length, 0);
  dialog.props.onClose();s.h.update();assert.ok(s.button('一般部員へ戻す'));
  await s.press('一般部員へ戻す');
  const next = s.h.find(n => n.props?.restoreMember);next.props.onCommitted();next.props.onClose();s.h.update();
  const rows = s.h.all(n => n.type === 'View' && n.props?.key === 'first');
  assert.equal(rows.length, 0);
  assert.equal(s.h.all(n => typeof n.type === 'function' && s.h.text(n) === '一般部員へ戻す').length, 1);
  assert.equal(s.calls.length, 2);s.h.unmount();
});
test('restoration previews the exact target before committing and releases its temporary watcher on completion', async () => {
  let committed = 0;
  const s = harness('restore', {}, { restoreMember: { uid: 'old', name: 'Synthetic Graduate', graduationFiscalYear: 2026 }, onCommitted: () => committed++ });
  assert.equal(s.calls.length, 0);assert.equal(s.watches.length, 0);
  assert.match(s.h.text(s.h.render()), /学年・グループは未設定/);
  assert.match(s.h.text(s.h.render()), /保護者の紐づけ・退会状態は自動では戻りません/);
  await s.press('変更内容を確認する');
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0].input)), { action: 'restore', memberUids: ['old'] });
  assert.equal(committed, 0);assert.match(s.h.text(s.h.render()), /OB・OG → 一般部員/);
  await s.press('確認した内容で実行する');
  assert.equal(committed, 1);assert.equal(s.calls[1].preview.fingerprint, 'verified');assert.equal(s.watches.length, 1);
  s.watches[0].next({ status: 'complete' });s.h.update();
  assert.equal(s.watches[0].stops, 1);s.h.unmount();
});
test('an uncertain restoration retries its existing operation without prematurely hiding the archive row', async () => {
  let committed = 0, attempts = 0;
  const s = harness('restore', { commitMembershipOperation: async (_team, _input, preview) => {
    s.calls.push({ type: 'commit', preview });
    if (++attempts === 1) throw Object.assign(new Error('offline'), { code: 'functions/unavailable' });
    return { operationId: preview.operationId, status: 'complete', replay: true };
  } }, { restoreMember: { uid: 'old', name: 'Synthetic Graduate' }, onCommitted: () => committed++ });
  await s.press('変更内容を確認する');await s.press('確認した内容で実行する');
  assert.equal(committed, 0);assert.equal(s.alerts.length, 1);
  await s.press('確認した内容で実行する');
  assert.equal(committed, 1);assert.equal(s.calls.filter(c => c.type === 'preview').length, 1);
  assert.equal(s.calls.filter(c => c.type === 'commit').every(c => c.preview.operationId === 'operation'), true);
  assert.equal(s.watches.length, 0);s.h.unmount();
});
test('group renaming shows the board name reminder after an acknowledged save, never on preview or failure', async () => {
  const reminder = '掲示板名に学年名を使用している場合は、掲示板名を変更してください';
  const s = harness();s.change('変更後のグループ名','Renamed');await s.press('変更内容を確認する');
  assert.equal(s.alerts.length, 0);assert.doesNotMatch(s.h.text(s.h.render()), /卒業者は通常の名簿から外れ/);
  await s.press('確認した内容で実行する');assert.equal(s.alerts.length, 1);assert.equal(s.alerts[0][1], reminder);
  assert.ok(s.h.text(s.h.render()).includes(reminder));s.watches[0].next({ status: 'complete' });s.h.update();assert.equal(s.alerts.length, 1);s.h.unmount();
  const failed = harness('manage', { commitMembershipOperation: async () => { throw new Error('offline'); } });
  failed.change('変更後のグループ名','Renamed');await failed.press('変更内容を確認する');await failed.press('確認した内容で実行する');
  assert.equal(failed.alerts.some(alert => alert[1] === reminder), false);failed.h.unmount();
});
