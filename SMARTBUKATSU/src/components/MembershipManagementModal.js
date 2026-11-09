import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { memberGrades } from '../../functions/workspaceAudience';
import { previewMembershipOperation, commitMembershipOperation, subscribeMembershipOperation, getAlumniPage } from '../services/firestoreService';

const currentFiscalYear = () => { const d = new Date(); return d.getFullYear() - (d.getMonth() < 3 ? 1 : 0); };
const Button = ({ children, description, onPress, disabled = false, selected, kind = 'option', menu, accessibilityRole }) => (
  <TouchableOpacity accessibilityRole={accessibilityRole || (selected === undefined ? 'button' : 'radio')}
    accessibilityState={selected === undefined ? { disabled } : { checked: selected, disabled }}
    disabled={disabled} onPress={onPress}
    style={[kind === 'primary' ? menu.saveBtn : kind === 'cancel' ? menu.cancelBtn : menu.roleSelectBtn,
      selected && menu.roleSelectBtnActive, disabled && { opacity: 0.45 }]}>
    <Text style={kind === 'primary' ? menu.saveBtnText : kind === 'cancel' ? menu.cancelBtnText : menu.roleSelectTitle}>{children}</Text>
    {!!description && <Text style={menu.roleSelectDesc}>{description}</Text>}
  </TouchableOpacity>
);

export default function MembershipManagementModal({ teamId, group, memberUid, profiles, onClose, menuStyles, restoreMember, onCommitted }) {
  const menu = { ...fallbackMenu, ...menuStyles };
  const candidates = restoreMember ? [restoreMember] : Object.values(profiles).filter((p) => ['member', 'captain'].includes(p.role) && (memberUid ? p.uid === memberUid : memberGrades(p).includes(group)));
  const [action, setAction] = useState(restoreMember ? 'restore' : memberUid ? 'graduate' : 'rename');
  const [name, setName] = useState(group || '');
  const [year, setYear] = useState(String(currentFiscalYear()));
  const [selected, setSelected] = useState(candidates.map((p) => p.uid));
  const [policy, setPolicy] = useState('keep');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [operationId, setOperationId] = useState('');
  const [status, setStatus] = useState('');
  const scope = useRef({});
  useEffect(() => () => { scope.current = null; }, []);
  const input = action === 'restore' ? { action, memberUids: selected }
    : { action, group: memberUid ? '' : group, name, memberUids: selected, fiscalYear: Number(year), guardianPolicy: policy };
  useEffect(() => {
    if (!operationId || status === 'complete') return undefined;
    return subscribeMembershipOperation(teamId, operationId, (job) => { if (scope.current && job) setStatus(job.status); }, () => {
      if (scope.current) Alert.alert('状況を取得できません', '通信状態を確認してください。閉じてもサーバー側の処理は継続します。');
    });
  }, [teamId, operationId, status === 'complete']);
  const run = async () => {
    if (busy || operationId) return;
    const visit = scope.current;
    setBusy(true);
    try {
      if (!preview) {
        const value = await previewMembershipOperation(teamId, input);
        if (scope.current === visit) setPreview(value);
      } else {
        const value = await commitMembershipOperation(teamId, input, preview);
        if (scope.current === visit) {
          setOperationId(value.operationId); setStatus(value.status); onCommitted?.();
          if (action === 'rename') Alert.alert('掲示板名の確認', '掲示板名に学年名を使用している場合は、掲示板名を変更してください');
        }
      }
    } catch (error) {
      if (scope.current === visit) {
        Alert.alert('処理できませんでした', error.message || '通信状態を確認してください。');
        // Keep the operation ID on transport errors so an acknowledged-but-lost
        // commit is retried idempotently. Stale previews must be rebuilt.
        if (error.code === 'functions/failed-precondition') setPreview(null);
      }
    } finally { if (scope.current === visit) setBusy(false); }
  };
  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={menu.modalOverlay}>
      <View style={[menu.modalContent, s.panel]}>
        <Text style={menu.modalTitle}>{restoreMember ? '一般部員へ戻す' : memberUid ? 'OB・OGへ変更' : `${group} の編集`}</Text>
        <ScrollView style={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {!preview && !operationId && <>
            {!memberUid && !restoreMember && <>
              <Button menu={menu} selected={action === 'rename'} onPress={() => setAction('rename')}
                description="所属と掲示板の公開条件を合わせて変更します。">名前変更</Button>
              <Button menu={menu} selected={action === 'graduate'} onPress={() => setAction('graduate')}
                description="対象者・卒業年度・保護者の扱いを確認します。">卒業</Button>
            </>}
            {action === 'restore' ? <>
              <Text style={s.label}>{restoreMember.name} を一般部員へ戻します。</Text>
              <Text style={s.hint}>学年・グループは未設定になり、卒業年度を解除します。個別の編集権限はOFFになります。</Text>
              <Text style={s.hint}>保護者の紐づけ・退会状態は自動では戻りません。必要に応じて設定してください。</Text>
            </> : action === 'rename' ? <>
              <Text style={s.label}>変更後の名前</Text>
              <TextInput accessibilityLabel="変更後のグループ名" style={menu.input} value={name} onChangeText={setName} maxLength={60} />
            </> : <>
              <Text style={s.label}>卒業年度</Text>
              <Text style={menu.roleSelectDesc}>例：2027年3月卒業は2026年度</Text>
              <TextInput accessibilityLabel="卒業年度" keyboardType="number-pad" maxLength={4} style={menu.input} value={year} onChangeText={setYear} />
              <Text style={s.label}>卒業する対象者：{selected.length}名</Text>
              <Text style={s.hint}>複数所属でも本人の役割が変わります。</Text>
              <Text style={s.hint}>所属者がいなくなる学年・グループは一覧から除去します。所属者が残る場合は維持します。</Text>
              {candidates.map((p) => <TouchableOpacity key={p.uid} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(p.uid) }}
                style={[menu.roleSelectBtn, selected.includes(p.uid) && menu.roleSelectBtnActive]}
                onPress={() => setSelected((v) => v.includes(p.uid) ? v.filter((id) => id !== p.uid) : [...v, p.uid])}>
                <Text style={menu.roleSelectTitle}>{selected.includes(p.uid) ? '☑' : '☐'} {p.name}</Text>
              </TouchableOpacity>)}
              {!candidates.length && <Text style={s.hint}>卒業対象の部員・キャプテンがいません。</Text>}
              <Text style={s.label}>卒業者だけに紐づく保護者の扱い</Text>
              <Button menu={menu} selected={policy === 'keep'} onPress={() => setPolicy('keep')}>保護者として残す</Button>
              <Button menu={menu} selected={policy === 'leave'} onPress={() => setPolicy('leave')}>対象チームから退会</Button>
              <Text style={s.hint}>在籍する兄弟や未登録の子供との紐づけが残る保護者は、在籍を維持します。卒業した子供の紐づけだけ解除します。</Text>
            </>}
          </>}
          {preview && !operationId && <>
            <Text style={s.label}>実行前の確認</Text>
            <View style={menu.roleSelectBtn}>
              <Text style={menu.roleSelectTitle}>{action === 'restore' ? `${restoreMember.name}：OB・OG → 一般部員` : action === 'rename' ? `「${group}」→「${name.trim()}」` : `${year}年度卒業：${preview.graduateCount}名`}</Text>
              {action === 'graduate' && <Text style={s.summary}>対象者：{candidates.filter((p) => selected.includes(p.uid)).map((p) => p.name).join('、')}</Text>}
              {action !== 'restore' && <>
                <Text style={s.summary}>保護者の退会：{preview.leavingGuardians.length}名{preview.leavingGuardians.length ? `（${preview.leavingGuardians.map((p) => p.name).join('、')}）` : ''}</Text>
                <Text style={s.summary}>紐づけを更新して在籍を維持する保護者：{preview.keptGuardians.length}名{preview.keptGuardians.length ? `（${preview.keptGuardians.map((p) => p.name).join('、')}）` : ''}</Text>
              </>}
              {!!preview.removedGroups?.length && <Text style={s.summary}>学年・グループ一覧から除去：{preview.removedGroups.join('、')}</Text>}
            </View>
            <Text style={s.hint}>{action === 'restore'
              ? '一般部員として通常の名簿に戻ります。学年・グループは未設定、卒業年度は解除、個別の編集権限はOFFになります。削除した学年や保護者の紐づけ・退会状態は自動では戻りません。'
              : action === 'rename' ? 'グループ名・所属・掲示板の公開条件を合わせて変更します。掲示板名に学年名を使用している場合は、掲示板名を変更してください'
              : '卒業者は通常の名簿から外れ、動画追加・タグ編集はできなくなります。卒業前の掲示板閲覧権限は引き継ぎません。退会してもアカウントと他チームの所属は残ります。'}</Text>
            <Button menu={menu} disabled={busy} onPress={() => setPreview(null)}>内容を修正</Button>
          </>}
          {!!operationId && <Text style={s.summary}>{status === 'complete' ? '一括処理が完了しました' : '所属情報を保存済みです。掲示板・集計を更新中…'}</Text>}
          {!!operationId && action === 'rename' && <Text style={s.hint} accessibilityRole="alert">掲示板名に学年名を使用している場合は、掲示板名を変更してください</Text>}
        </ScrollView>
        {!operationId && <Button menu={menu} kind="primary" onPress={run} disabled={busy || (action === 'graduate' && (!selected.length || !/^\d{4}$/.test(year)))}>{busy ? '確認中…' : preview ? '確認した内容で実行する' : '変更内容を確認する'}</Button>}
        <Button menu={menu} kind="cancel" onPress={onClose} disabled={busy}>{operationId ? '閉じる' : 'キャンセル'}</Button>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

export function AlumniArchiveModal({ teamId, onClose, menuStyles }) {
  const menu = { ...fallbackMenu, ...menuStyles };
  const [year, setYear] = useState(String(currentFiscalYear()));
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [restoreMember, setRestoreMember] = useState(null);
  const generation = useRef(0);
  const load = async (more = false) => {
    const version = ++generation.current;
    setBusy(true); setError('');
    try { const result = await getAlumniPage(teamId, Number(year), more ? page.cursor : null);
      if (version === generation.current) setPage({ ...result, members: more ? [...page.members, ...result.members] : result.members });
    } catch (e) { if (version === generation.current) setError(e.message || '取得に失敗しました。'); }
    finally { if (version === generation.current) setBusy(false); }
  };
  // This component mounts only after the user taps the OB/OG entry.
  useEffect(() => { void load(false); return () => { generation.current++; }; }, []);
  if (restoreMember) return <MembershipManagementModal teamId={teamId} restoreMember={restoreMember} menuStyles={menuStyles}
    onCommitted={() => setPage(current => current && ({ ...current, members: current.members.filter(p => p.uid !== restoreMember.uid) }))}
    onClose={() => setRestoreMember(null)} />;
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={menu.modalOverlay}>
      <View style={[menu.modalContent, s.panel]}>
        <Text style={menu.modalTitle}>OB・OG一覧</Text>
        <ScrollView style={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={s.label}>卒業年度</Text>
          <TextInput accessibilityLabel="表示する卒業年度" keyboardType="number-pad" maxLength={4} value={year} style={menu.input} editable={!busy} onChangeText={(v) => { generation.current++; setYear(v); setPage(null); }} />
          <Button menu={menu} disabled={busy || !/^\d{4}$/.test(year)} onPress={() => load(false)}>この年度の卒業生を表示</Button>
          {busy && <Text style={s.hint}>読み込み中…</Text>}
          {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
          {page?.members.map((p) => <View key={p.uid} style={menu.roleSelectBtn}>
            <Text style={menu.roleSelectTitle}>{p.name}</Text><Text style={s.hint}>{p.graduationFiscalYear}年度／OB・OG</Text>
            <Button menu={menu} disabled={busy} onPress={() => setRestoreMember(p)}>一般部員へ戻す</Button>
          </View>)}
          {page && !page.members.length && <Text style={s.hint}>この年度の卒業生はいません。</Text>}
          {page?.hasMore && <Button menu={menu} disabled={busy} onPress={() => load(true)}>さらに読み込む</Button>}
        </ScrollView>
        <Button menu={menu} kind="cancel" onPress={onClose}>閉じる</Button>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
// Settings passes its own styles so these dialogs stay aligned with its menus.
const fallbackMenu = StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '90%', backgroundColor: '#fff', padding: 20, borderRadius: 12 },
  modalTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 20, color: '#333', textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 15, fontSize: 16, backgroundColor: '#fff' },
  roleSelectBtn: { padding: 15, backgroundColor: '#f9f9f9', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginBottom: 10 },
  roleSelectBtnActive: { backgroundColor: '#ebf5fb', borderColor: '#3498db' },
  roleSelectTitle: { fontSize: 15, fontWeight: 'bold', color: '#333', marginBottom: 6 },
  roleSelectDesc: { fontSize: 12, color: '#666', lineHeight: 18 },
  saveBtn: { backgroundColor: '#2ecc71', paddingVertical: 15, borderRadius: 8, alignItems: 'center', marginTop: 15 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cancelBtn: { marginTop: 10, paddingVertical: 12, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, fontWeight: 'bold', color: '#888' },
});
const s = StyleSheet.create({
  panel: { maxHeight: '90%' }, body: { flexShrink: 1 },
  label: { fontSize: 14, fontWeight: 'bold', color: '#333', marginTop: 10, marginBottom: 10 },
  hint: { fontSize: 12, color: '#666', lineHeight: 18, marginBottom: 12 },
  summary: { fontSize: 14, color: '#333', lineHeight: 22 }, error: { color: '#e74c3c', marginBottom: 10 },
});
