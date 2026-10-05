import React, { useEffect, useRef, useState } from "react";
import { Alert, Keyboard, KeyboardAvoidingView, Platform, ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused, usePreventRemove } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { subscribeTacticalNoteSummaries, getTacticalNoteSummaryPage, ensureTacticalNoteSummaries,
  subscribeTacticalNote, subscribeTacticalNoteSummary, subscribeTacticalNoteActivity,
  saveTacticalNote, deleteTacticalNote, updateTacticalNoteDescription } from "../services/firestoreService";
import { canReadNotes, canPostNotes, canManageNote, noteClipKey, mergeNoteClips, localDate, getNoteConfirmationSelection, isNoteSummaryCurrent } from "../utils/tacticalNotes";
import TacticalClipPlayer from "../components/TacticalClipPlayer";
import { PhaseTwoSummary, PhaseTwoEditor, PhaseTwoDetail } from "../components/TacticalNotePhaseTwo";

const emptyDraft = () => ({ title: "", description: "", assigneeUids: [], clips: [], sourceProjectId: "", images: [], tasks: {} });
const dateText = (date) => date?.toDate?.().toLocaleString("ja-JP") || "保存中";
// Match the video list's creation-month grouping and newest-month default.
function groupNotesByMonth(notes) {
  const months = new Map();
  for (const note of notes) {
    const value = note.createdAt;
    const millis = typeof value?.toMillis === "function" ? value.toMillis()
      : typeof value?.toDate === "function" ? value.toDate().getTime()
      : value instanceof Date ? value.getTime()
      : typeof value?.seconds === "number" ? value.seconds * 1000
      : typeof value === "number" ? (value < 1000000000000 ? value * 1000 : value)
      : typeof value === "string" ? new Date(value).getTime() : 0;
    const date = new Date(millis), known = Boolean(millis) && Number.isFinite(date.getTime());
    const year = date.getFullYear(), month = date.getMonth() + 1;
    const key = known ? `${year}-${String(month).padStart(2, "0")}` : "unknown";
    if (!months.has(key)) months.set(key, { key, label: known ? `${year}年${month}月` : "作成月不明",
      sortValue: known ? year * 100 + month : Number.MIN_SAFE_INTEGER, notes: [] });
    months.get(key).notes.push({ note, millis: known ? millis : 0 });
  }
  return [...months.values()].sort((a, b) => b.sortValue - a.sortValue)
    .map((month) => ({ ...month, notes: month.notes.sort((a, b) => b.millis - a.millis).map((item) => item.note) }));
}
function Button({ title, onPress, disabled, selected, variant }) {
  return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress}
    accessibilityState={{ disabled: Boolean(disabled), ...(selected !== undefined ? { selected } : {}) }}
    style={[s.button, variant === "primary" && s.primaryButton, selected && s.selected, disabled && { opacity: 0.4 }]}>
    <Text style={[s.buttonText, variant === "primary" && s.primaryButtonText]}>{title}</Text>
  </TouchableOpacity>;
}

export default function TacticalNotesScreen({ route, navigation, projects = [], highlightProjects = [], userProfiles = {}, currentUserUid, currentUser }) {
  const { activeTeamId } = useAuth();
  const focused = useIsFocused();
  const profile = Object.values(userProfiles).find((p) => p.uid === currentUserUid);
  const readable = canReadNotes(profile), writable = canPostNotes(profile);
  const [error, setError] = useState("");
  const [firstPage, setFirstPage] = useState({ items: [], cursor: null, hasMore: false });
  const [olderPage, setOlderPage] = useState({ items: [], cursor: null, hasMore: null });
  const [paging, setPaging] = useState(false), [refresh, setRefresh] = useState(0), [pageNotice, setPageNotice] = useState("");
  const [indexState, setIndexState] = useState({ teamId: activeTeamId, ready: false, loading: true, processed: 0, error: "" });
  const indexChecked = useRef(false), pageScope = useRef(0), teamScope = useRef(0), playbackStates = useRef({}), mounted = useRef(true);
  const firstBoundary = useRef(null), olderLoaded = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pageScope.current += 1; }; }, []);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false), [activityDirty, setActivityDirty] = useState(false);
  const [selectedId, setSelectedId] = useState(null), [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [commentEdit, setCommentEdit] = useState(null);
  const [selectedState, setSelectedState] = useState(null), [selectedSummary, setSelectedSummary] = useState(null);
  const [screenTeam, setScreenTeam] = useState(activeTeamId);
  const [selectedLoading, setSelectedLoading] = useState(false), [selectedError, setSelectedError] = useState("");
  const [activity, setActivity] = useState(null), [activityError, setActivityError] = useState("");
  const [activityView, setActivityView] = useState(false), [filter, setFilter] = useState("all");
  const [expandedMonths, setExpandedMonths] = useState({});
  const [today, setToday] = useState(localDate());
  useEffect(() => { const timer = setInterval(() => setToday(localDate()), 60000); return () => clearInterval(timer); }, []);
  const [sourceId, setSourceId] = useState(""), [tags, setTags] = useState([]), [mode, setMode] = useState("OR");
  const teamMatches = screenTeam === activeTeamId;
  const selected = teamMatches && selectedState?.id === selectedId ? selectedState : null;
  const indexReady = teamMatches && indexState.teamId === activeTeamId && indexState.ready;
  const summaryMatches = Boolean(selected && selectedSummary?.id === selected.id && isNoteSummaryCurrent(selected, selectedSummary));
  const detailOpen = Boolean(selected && !draft && (activityView || !selected.clips.length));
  const summaries = [...new Map((teamMatches ? [...olderPage.items, ...firstPage.items] : []).map((item) => [item.id, item])).values()]
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const months = groupNotesByMonth(summaries);
  const hasMore = olderPage.hasMore === null ? firstPage.hasMore : olderPage.hasMore;
  const commentDirty = Boolean(commentEdit && commentEdit.value !== commentEdit.original);
  useEffect(() => {
    setCommentEdit(null);
  }, [activeTeamId, selectedId, readable]);
  const members = Object.values(userProfiles).filter(canReadNotes);
  const confirmationSelection = getNoteConfirmationSelection(members, draft?.assigneeUids);
  const allAssigned = (uids = []) => members.length > 0 && uids.length === members.length && members.every((p) => uids.includes(p.uid));
  const names = (uids) => allAssigned(uids) ? "全員" : (uids || []).map((uid) => members.find((p) => p.uid === uid)?.name || "退会・所属変更済み").join("、") || "指定なし";
  useEffect(() => {
    teamScope.current += 1; indexChecked.current = false;
    setScreenTeam(activeTeamId);
    setIndexState({ teamId: activeTeamId, ready: false, loading: true, processed: 0, error: "" });
    setSelectedId(null); setSelectedState(null); setSelectedSummary(null); setDraft(null); setEditingId(null);
    setExpandedMonths({});
    setActivityView(false); setFilter("all"); setError(""); playbackStates.current = {};
  }, [activeTeamId, readable]);
  const indexPreparation = useRef(null);
  const prepareIndex = async () => {
    const scope = teamScope.current;
    if (indexPreparation.current?.scope === scope) return;
    const ticket = { scope }; indexPreparation.current = ticket;
    setIndexState((previous) => ({ ...previous, loading: true, error: "" }));
    try {
      const result = await ensureTacticalNoteSummaries(activeTeamId);
      if (mounted.current && scope === teamScope.current) setIndexState({ ...result, teamId: activeTeamId, ready: Boolean(result.ready), loading: false, error: "" });
    } catch {
      if (mounted.current && scope === teamScope.current) setIndexState((previous) => ({ ...previous, loading: false, error: "一覧を準備できません。接続と権限を確認して再試行してください。" }));
    } finally { if (indexPreparation.current === ticket) indexPreparation.current = null; }
  };
  useEffect(() => {
    if (!focused || !activeTeamId || !readable || indexChecked.current) return;
    indexChecked.current = true;
    prepareIndex();
  }, [activeTeamId, readable, focused]);
  useEffect(() => {
    if (!focused || !readable || indexState.teamId !== activeTeamId || indexState.loading || indexState.error || indexState.ready || !indexChecked.current) return;
    const timer = setTimeout(prepareIndex, indexState.busy ? Math.max(500, Math.min(indexState.retryAfterMs || 1500, 5000)) : 250);
    return () => clearTimeout(timer);
  }, [activeTeamId, readable, focused, indexState]);
  useEffect(() => {
    pageScope.current += 1;
    setFirstPage({ items: [], cursor: null, hasMore: false });
    setOlderPage({ items: [], cursor: null, hasMore: null });
    firstBoundary.current = null; olderLoaded.current = false;
    setError(""); setPaging(false); setPageNotice("");
    if (!focused || !activeTeamId || !readable || selectedId || draft || !indexReady) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const stop = subscribeTacticalNoteSummaries(activeTeamId, filter, currentUserUid, (page) => {
      if (cancelled) return;
      const boundary = page.items.at(-1)?.id || "";
      if (firstBoundary.current !== null && boundary !== firstBoundary.current) {
        pageScope.current += 1; setPaging(false);
        if (olderLoaded.current) {
          setOlderPage({ items: [], cursor: null, hasMore: null }); olderLoaded.current = false;
          setPageNotice("一覧の更新を反映しました。以前のノートは再度「もっと表示」で読み込めます。");
        }
      }
      firstBoundary.current = boundary;
      setFirstPage(page); setLoading(false); setError("");
    }, () => {
      if (cancelled) return;
      setLoading(false); setError("一覧を読み込めません。接続と権限を確認して再試行してください。");
    });
    return () => { cancelled = true; pageScope.current += 1; stop(); };
  }, [activeTeamId, readable, focused, selectedId, Boolean(draft), indexReady, filter, currentUserUid, refresh]);
  useEffect(() => {
    if (!focused || !activeTeamId || !readable || !teamMatches || !selectedId) return;
    let cancelled = false;
    setSelectedLoading(true); setSelectedError("");
    const stopNote = subscribeTacticalNote(activeTeamId, selectedId, (note) => {
      if (cancelled) return;
      setSelectedState(note); setSelectedLoading(false);
      setSelectedError(note ? "" : "ノートが削除されたか、利用できなくなりました。");
    }, () => { if (!cancelled) { setSelectedLoading(false); setSelectedError("ノートを読み込めません。入力内容は保持されています。接続と権限を確認してください。"); } });
    const stopSummary = subscribeTacticalNoteSummary(activeTeamId, selectedId, (item) => {
      if (!cancelled) setSelectedSummary(item);
    }, () => { if (!cancelled) setSelectedSummary(null); });
    return () => { cancelled = true; stopNote(); stopSummary(); };
  }, [activeTeamId, readable, focused, teamMatches, selectedId, refresh]);
  const activityKey = selected ? JSON.stringify([selected.id, selected.contentVersion || 1,
    Object.entries(selected.tasks || {}).map(([id, task]) => [id, task.revision])]) : "";
  useEffect(() => {
    setActivity(null); setActivityError("");
    if (!focused || !activeTeamId || !readable || !detailOpen) return;
    let cancelled = false;
    const stop = subscribeTacticalNoteActivity(activeTeamId, selected, currentUserUid, (items) => {
      if (!cancelled) { setActivity(items); setActivityError(""); }
    }, () => { if (!cancelled) setActivityError("確認・タスクを読み込めません。接続と権限を確認して再試行してください。"); });
    return () => { cancelled = true; stop(); };
  }, [activeTeamId, readable, focused, detailOpen, activityKey, currentUserUid, refresh]);
  const loadMore = async () => {
    if (paging || !hasMore) return;
    const scope = pageScope.current;
    setPaging(true);
    try {
      const page = await getTacticalNoteSummaryPage(activeTeamId, filter, currentUserUid, olderPage.cursor || firstPage.cursor);
      if (scope !== pageScope.current) return;
      olderLoaded.current = true;
      setOlderPage((previous) => ({ ...page, items: [...previous.items, ...page.items] })); setError("");
    } catch { if (scope === pageScope.current) setError("続きを読み込めません。接続を確認して再試行してください。"); }
    finally { if (scope === pageScope.current) setPaging(false); }
  };
  const editSelected = () => {
    setEditingId(selected.id);
    setDraft({ title: selected.title, description: selected.description, assigneeUids: [...selected.assigneeUids],
      clips: selected.clips.map((clip) => ({ ...clip })), sourceProjectId: selected.sourceProjectId,
      baseUpdatedAt: selected.updatedAt, baseContentVersion: selected.contentVersion || 1,
      images: [...(selected.images || [])], tasks: Object.fromEntries(Object.entries(selected.tasks || {}).map(([id, task]) => [id, { ...task, assigneeUids: [...task.assigneeUids] }])) });
    setSourceId(selected.sourceProjectId); setTags([]); setMode("OR");
  };
  useEffect(() => {
    const seed = route.params?.noteSeed;
    if (!seed || !writable || !readable) return;
    setDraft({ ...emptyDraft(), sourceProjectId: seed.sourceId, clips: seed.clips.map((c) => ({ ...c })) });
    setEditingId(null); setSelectedId(null); setSourceId(seed.sourceId); setTags(seed.tags); setMode(seed.mode);
    navigation.setParams({ noteSeed: undefined });
  }, [route.params?.noteSeed, writable, readable]);
  useEffect(() => {
    const result = route.params?.noteAttachmentResult;
    if (!result) return;
    navigation.setParams({ noteAttachmentResult: undefined });
    if (!draft || result.teamId !== activeTeamId || !readable) return;
    try {
      setDraft({ ...draft, clips: mergeNoteClips(draft.clips, result.clips),
        sourceProjectId: result.sourceId || draft.sourceProjectId });
      setSourceId(result.sourceId || sourceId);
    } catch (error) {
      Alert.alert("場面を追加できません", error.message);
    }
  }, [route.params?.noteAttachmentResult, activeTeamId, readable]);
  usePreventRemove((Boolean(draft) || commentDirty || activityDirty || activityBusy || imageBusy || Boolean(commentEdit && busy)) && readable, ({ data }) => {
    if (busy || imageBusy || activityBusy) return;
    Alert.alert("編集を破棄", "保存していない内容を破棄しますか？", [{ text: "続ける", style: "cancel" },
      { text: "破棄", style: "destructive", onPress: () => navigation.dispatch(data.action) }]);
  });
  const update = (changes) => setDraft((prev) => ({ ...prev, ...changes }));
  const leaveActivity = (after) => {
    if (busy || activityBusy) return;
    if (!activityDirty) { after(); return; }
    Alert.alert("入力を破棄", "送信していない質問・返信・コメントを破棄しますか？", [
      { text: "続ける", style: "cancel" }, { text: "破棄", style: "destructive", onPress: after },
    ]);
  };
  const leaveCommentEdit = (after = () => {}) => {
    if (busy) return;
    const finish = () => { setCommentEdit(null); Keyboard.dismiss(); after(); };
    if (!commentDirty) { finish(); return; }
    Alert.alert("編集を破棄", "保存していない全体コメントを破棄しますか？", [
      { text: "続ける", style: "cancel" }, { text: "破棄", style: "destructive", onPress: finish },
    ]);
  };
  const saveComment = async () => {
    if (busy || selectedLoading || selectedError || !commentEdit || !selected || !canManageNote(profile, currentUserUid, selected)) return;
    setBusy(true);
    try {
      await updateTacticalNoteDescription(activeTeamId, selected.id, commentEdit.value,
        { updatedAt: commentEdit.baseUpdatedAt, contentVersion: commentEdit.baseContentVersion });
      setCommentEdit(null); Keyboard.dismiss();
    } catch (e) {
      Alert.alert("保存できません", e.code ? "通信状態または編集権限を確認してください。入力内容は保持されています。" : e.message);
    } finally { setBusy(false); }
  };
  const discard = () => Alert.alert("編集を破棄", "保存していない内容を破棄しますか？", [
    { text: "続ける", style: "cancel" }, { text: "破棄", style: "destructive", onPress: () => { Keyboard.dismiss(); setDraft(null); } },
  ]);
  const save = async () => {
    if (busy || imageBusy || (editingId ? !selected || selected.id !== editingId || !canManageNote(profile, currentUserUid, selected) : !writable)) return;
    setBusy(true);
    try {
      const result = await saveTacticalNote(activeTeamId, editingId, draft, currentUser, members.map((member) => member.uid)); Keyboard.dismiss(); setDraft(null);
      if (result.cleanupPending) Alert.alert("保存しました", "取り外した画像の削除をサーバーで再試行します。");
    }
    catch (e) { Alert.alert("保存できません", e.code ? "通信状態または投稿権限を確認してください。" : e.message); }
    finally { setBusy(false); }
  };
  const remove = () => Alert.alert("ノートを削除", "このノートを削除します。元動画・タグは残ります。", [
    { text: "キャンセル", style: "cancel" }, { text: "削除", style: "destructive", onPress: async () => {
      setBusy(true);
      try { await deleteTacticalNote(activeTeamId, selected.id); setSelectedId(null);  }
      catch { Alert.alert("削除できません", "接続と権限を確認してください。"); }
      finally { setBusy(false); }
    } },
  ]);
  const move = (index, delta) => {
    const clips = [...draft.clips];
    [clips[index], clips[index + delta]] = [clips[index + delta], clips[index]];
    update({ clips });
  };
  if (!readable) return <SafeAreaView style={s.page}><Button title="戻る" onPress={() => navigation.goBack()} /><Text style={s.info}>戦術ノートの閲覧権限がありません。</Text></SafeAreaView>;
  if (selectedId && !selected && !draft) return <SafeAreaView style={s.page}>
    <Button title="◁ 一覧へ戻る" onPress={() => setSelectedId(null)} />
    <Text style={s.info}>{selectedError || "ノートを読み込み中…"}</Text>
    {!!selectedError && <Button title="再試行" onPress={() => setRefresh((value) => value + 1)} />}
  </SafeAreaView>;
  if (selected && !draft && (activityView || !selected.clips.length)) return <SafeAreaView style={s.page}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Button title={selected.clips.length ? "◁ 動画へ戻る" : "◁ 一覧へ戻る"} disabled={busy || activityBusy} onPress={() => leaveActivity(() => { if (selected.clips.length) setActivityView(false); else setSelectedId(null); })} />
    <Text style={s.heading}>{selected.title}</Text><Text>{selected.description}</Text>
    <Text style={s.info}>確認対象者：{names(selected.assigneeUids)} · 保護者以外に公開</Text>
    {canManageNote(profile, currentUserUid, selected) && <View style={s.row}><Button title="編集" disabled={busy || activityBusy || selectedLoading || !!selectedError} onPress={() => leaveActivity(editSelected)} /><Button title="削除" disabled={busy || activityBusy || selectedLoading || !!selectedError} onPress={() => leaveActivity(remove)} /></View>}
    {!!selectedError && <Text style={s.error}>{selectedError}</Text>}
    {!!activityError && <View><Text style={s.error}>{activityError}</Text><Button title="再試行" disabled={busy || activityBusy} onPress={() => setRefresh((value) => value + 1)} /></View>}
    {!activity && !activityError && <Text>確認・タスクを読み込み中…</Text>}
    <PhaseTwoDetail key={selected.id} teamId={activeTeamId} note={selected} summaryIndex={summaryMatches ? selectedSummary : null}
      activity={activity || {}} uid={currentUserUid} names={names} editable={canManageNote(profile, currentUserUid, selected)}
      disabled={busy || selectedLoading || Boolean(selectedError) || !focused}
      confirmationDisabled={!summaryMatches || !activity || Boolean(activityError)}
      taskDisabled={!activity || Boolean(activityError)}
      onBusyChange={setActivityBusy} onDirtyChange={setActivityDirty} />
  </ScrollView></SafeAreaView>;
  if (selected && !draft) return focused ? <TacticalClipPlayer
    key={selected.id} note={selected} projects={projects} userProfiles={userProfiles}
    notePlaybackState={playbackStates.current[selected.id]}
    onNotePlaybackStateChange={(state) => { playbackStates.current[selected.id] = state; }}
    currentUserUid={currentUserUid} currentUser={currentUser} navigation={navigation}
    onClose={() => leaveCommentEdit(() => setSelectedId(null))}
    noteHeader={commentEdit ? <View>
      <Text style={s.label}>全体コメント編集</Text>
      <TextInput accessibilityLabel="全体コメント" style={[s.input, { height: 76, textAlignVertical: "top" }]}
        autoFocus multiline maxLength={5000} value={commentEdit.value}
        editable={!busy && canManageNote(profile, currentUserUid, selected)}
        onChangeText={(value) => setCommentEdit((prev) => prev ? { ...prev, value } : prev)} />
      <View style={s.row}>
        <Button title={busy ? "保存中…" : "保存"} disabled={busy || selectedLoading || !!selectedError || !canManageNote(profile, currentUserUid, selected)} onPress={saveComment} />
        <Button title="キャンセル" disabled={busy} onPress={() => leaveCommentEdit()} />
      </View>
    </View> : <View>
      <Text style={s.heading}>{selected.title}</Text>
      <Text>{selected.authorName} · {dateText(selected.createdAt)}</Text>
      <Text style={s.info}>担当者：{names(selected.assigneeUids)}</Text>
      <Text>{selected.description}</Text>
      {summaryMatches ? <PhaseTwoSummary index={selectedSummary} uid={currentUserUid} today={today} /> : <Text style={s.info}>確認・タスク状況を更新中…</Text>}
      {!!selectedError && <Text style={s.error}>{selectedError}</Text>}
      <Button title={(selected.images || []).length ? `確認・質問・タスク・画像${selected.images.length}枚を開く` : "確認・質問・タスクを開く"} disabled={busy} onPress={() => setActivityView(true)} />
      {canManageNote(profile, currentUserUid, selected) && <View style={s.row}>
        <Button title="編集" disabled={busy || selectedLoading || !!selectedError} onPress={editSelected} />
        <Button title="削除" disabled={busy || selectedLoading || !!selectedError} onPress={remove} />
        <Button title="全体コメント編集" disabled={busy || selectedLoading || Boolean(selectedError)} onPress={() => setCommentEdit({ value: selected.description || "", original: selected.description || "",
          baseUpdatedAt: selected.updatedAt, baseContentVersion: selected.contentVersion || 1 })} />
      </View>}
    </View>}
  /> : <View style={s.page} />;
  return <SafeAreaView style={s.page}>
    <KeyboardAvoidingView style={s.body} enabled={Boolean(draft)} behavior={Platform.OS === "ios" ? "padding" : "height"}>
    <ScrollView style={s.body} keyboardShouldPersistTaps="handled"
      keyboardDismissMode={draft ? (Platform.OS === "ios" ? "interactive" : "on-drag") : undefined}
      contentContainerStyle={[s.content, draft && s.editorContent]}>
    <Button title="◁ 前の画面へ戻る" variant="primary" disabled={busy} onPress={() => navigation.goBack()} />
    <Text style={s.heading}>戦術ノート</Text>
    <Text style={s.info}>保護者以外のチーム全員に公開されます。担当者の指定は閲覧範囲を制限しません。</Text>
    {!!error && <Text style={s.error}>{error}</Text>}
    {!!selectedError && draft && <Text style={s.error}>{selectedError}</Text>}
    {draft ? <View>
      <Text style={s.heading}>{editingId ? "ノートを編集" : "ノートを作成"}</Text>
      <Text>タイトル</Text><TextInput accessibilityLabel="タイトル" style={s.input} maxLength={120} value={draft.title} editable={!busy} onChangeText={(title) => update({ title })} />
      <Text>全体説明</Text><TextInput accessibilityLabel="全体説明" style={s.input} multiline maxLength={5000} value={draft.description} editable={!busy} onChangeText={(description) => update({ description })} />
      <Text style={s.label}>確認対象者（001の担当者・複数選択可）</Text>
      <Text style={s.info}>指定なしの場合は確認義務なし。本文・場面・画像・確認対象者を変更すると再確認を求めます。</Text>
      <Text style={s.info}>「全員」はキャプテン・一般部員を選択します。スタッフ・監督・管理者は個別に選択できます。</Text>
      <View style={s.row}>
        <Button title="全員" disabled={busy || !confirmationSelection.allUids.length} selected={confirmationSelection.allSelected} onPress={() => update({ assigneeUids: confirmationSelection.allSelected ? [] : confirmationSelection.allUids })} />
        {members.map((p) => <Button key={p.uid} title={p.name || "メンバー"} disabled={busy} selected={draft.assigneeUids.includes(p.uid)} onPress={() => update({ assigneeUids: draft.assigneeUids.includes(p.uid) ? draft.assigneeUids.filter((id) => id !== p.uid) : [...draft.assigneeUids, p.uid] })} />)}
      </View>
      <Text style={s.label}>場面を追加</Text>
      <Button title="動画閲覧から場面を選ぶ" variant="primary" disabled={busy} onPress={() => {
        
        navigation.push("ProjectList", { notePicker: {
          returnKey: route.key, teamId: activeTeamId, sourceId,
          existingKeys: draft.clips.map(noteClipKey), tags, mode,
        } });
      }} />
      <Text style={s.info}>動画を再生して確認し、左のチェックで選んだ場面だけを追加できます。</Text>
      <Text style={s.label}>添付場面 {draft.clips.length}件</Text>
      {draft.clips.map((clip, index) => <View key={`${clip.projectId}/${clip.tagId}/${index}`} style={s.card}>
        <Text style={s.label}>{index + 1}. {clip.projectTitle} · {clip.label}</Text>
        <Text>{clip.start}〜{clip.end}秒</Text>
        <TextInput accessibilityLabel={`場面${index + 1}の指導コメント`} style={s.input} placeholder="場面ごとの指導コメント" multiline maxLength={2000} editable={!busy} value={clip.comment} onChangeText={(comment) => update({ clips: draft.clips.map((c, i) => i === index ? { ...c, comment } : c) })} />
        <View style={s.row}><Button title="上へ" disabled={busy || index === 0} onPress={() => move(index, -1)} /><Button title="下へ" disabled={busy || index === draft.clips.length - 1} onPress={() => move(index, 1)} /><Button title="取り外す" disabled={busy} onPress={() => update({ clips: draft.clips.filter((_, i) => i !== index) })} /></View>
      </View>)}
      <PhaseTwoEditor draft={draft} update={update} members={members} busy={busy} onBusyChange={setImageBusy} />
    </View> : <View>
      {writable && <Button title="＋ ノートを作成" variant="primary" disabled={loading || !!error} onPress={() => { setDraft(emptyDraft()); setEditingId(null); setSourceId(""); setTags([]); setMode("OR"); }} />}
      {!indexReady && <View><Text style={indexState.error ? s.error : s.info}>{indexState.error ||
        (indexState.loading ? "一覧を準備中…" : `一覧を準備中（${indexState.processed || 0}件を準備済み）。`)}</Text>
        {!indexState.loading && <Button title={indexState.error ? "一覧の準備を再試行" : "一覧の準備を続ける"} onPress={prepareIndex} />}</View>}
      {loading ? <Text>読み込み中…</Text> : indexReady && !summaries.length && !error ? <Text style={s.info}>{filter === "all" ? "戦術ノートはまだありません。" : "該当する戦術ノートはありません。"}</Text> : null}
      <View style={s.row}>{[["all", "すべて"], ["mine", "自分向け"], ["unconfirmed", "未確認"], ["tasks", "タスクあり"], ["unfinished", "未完了"], ["completed", "完了済み"]].map(([value, label]) => <Button key={value} title={label} selected={filter === value} onPress={() => setFilter(value)} />)}</View>
      <Text style={s.info}>「未確認」は自分の確認待ち、「未完了／完了済み」はノート全体のタスク進捗です。</Text>
      <Text style={s.info}>絞り込みはすべてのノートを対象に行い、新しい順に表示します。</Text>
      <Button title="一覧を更新" disabled={loading || paging || !indexReady} onPress={() => setRefresh((value) => value + 1)} />
      {!!pageNotice && <Text style={s.info}>{pageNotice}</Text>}
      {hasMore && <Text style={s.info}>月ごとの件数は読み込み済みの投稿数です。「もっと表示」で追加されます。</Text>}
      {months.map((month, monthIndex) => {
        const expanded = expandedMonths[month.key] !== undefined ? expandedMonths[month.key] : monthIndex === 0;
        return <View key={month.key}>
          <TouchableOpacity style={s.monthHeader} accessibilityRole="button" accessibilityState={{ expanded }}
            onPress={() => setExpandedMonths((previous) => ({ ...previous,
              [month.key]: !(previous[month.key] !== undefined ? previous[month.key] : monthIndex === 0) }))}>
            <Text style={s.monthHeaderText}>{expanded ? "▼" : "▶"} {month.label}</Text>
            <Text style={s.monthCount}>{month.notes.length}件</Text>
          </TouchableOpacity>
          {expanded && month.notes.map((note) => <TouchableOpacity accessibilityRole="button" key={note.id} style={s.card} onPress={() => { setSelectedState(null); setSelectedSummary(null); setSelectedId(note.id); setActivityView(false); }}>
            <Text style={s.label}>{note.title}</Text><Text>{note.authorName} · {dateText(note.createdAt)}</Text>
            <Text numberOfLines={3} style={s.info}>{note.descriptionPreview || "説明なし"}</Text><Text>担当者：{names(note.assigneeUids)}</Text><Text>{note.hasClips ? "動画場面あり" : "動画場面なし"} · 画像 {note.imageCount || 0}枚</Text>
            <PhaseTwoSummary index={note} uid={currentUserUid} today={today} />
          </TouchableOpacity>)}
        </View>;
      })}
      {hasMore && <Button title={paging ? "読み込み中…" : "以前のノートをもっと表示"} disabled={paging || loading} onPress={loadMore} />}
    </View>}
    </ScrollView>
    {draft && <View style={s.editorActions}>
      <Button title={busy ? "保存中…" : "投稿を保存"} variant="primary" onPress={save} disabled={busy || imageBusy || (editingId ? !selected || selected.id !== editingId || selectedLoading || !!selectedError || !canManageNote(profile, currentUserUid, selected) : !writable)} />
      <Button title="キャンセル" onPress={discard} disabled={busy || imageBusy} />
    </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f0f2f5" }, content: { padding: 15, paddingBottom: 40 },
  body: { flex: 1 }, editorContent: { flexGrow: 1, paddingBottom: 16 },
  editorActions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10,
    paddingHorizontal: 15, paddingVertical: 8, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  heading: { fontSize: 20, fontWeight: "bold", color: "#333", marginVertical: 10 },
  info: { color: "#666", marginVertical: 8, lineHeight: 22 }, error: { color: "#b42318", marginVertical: 12 },
  label: { fontSize: 15, fontWeight: "bold", color: "#333", marginVertical: 8 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    backgroundColor: "#fff", padding: 15, borderRadius: 12, marginBottom: 15,
    elevation: 2, borderLeftWidth: 4, borderLeftColor: "#3498db",
  },
  monthHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#fff", borderWidth: 1, borderColor: "#d9e2ec", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, marginLeft: 8, marginBottom: 8,
  },
  monthHeaderText: { color: "#334e68", fontSize: 14, fontWeight: "bold" },
  monthCount: { color: "#7b8794", fontSize: 12 },
  input: {
    backgroundColor: "#f0f2f5", borderWidth: 1, borderColor: "#e2e8f0",
    borderRadius: 8, padding: 10, marginVertical: 8, color: "#333", fontSize: 15,
  },
  button: { padding: 12, marginVertical: 5, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#bdc9d4" },
  primaryButton: { alignSelf: "flex-start", backgroundColor: "#0077cc", paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, borderWidth: 0 },
  primaryButtonText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  selected: { backgroundColor: "#e8f2fa", borderColor: "#0077cc" }, buttonText: { color: "#16446c", fontSize: 14, fontWeight: "bold" },
});
