import React, { useEffect, useState } from "react";
import { Alert, Keyboard, ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused, usePreventRemove } from "@react-navigation/native";
import { useAuth } from "../AuthContext";
import { subscribeTacticalNotes, saveTacticalNote, deleteTacticalNote, updateTacticalNoteDescription } from "../services/firestoreService";
import { canReadNotes, canPostNotes, canManageNote, noteClipKey, mergeNoteClips } from "../utils/tacticalNotes";
import TacticalClipPlayer from "../components/TacticalClipPlayer";

const emptyDraft = () => ({ title: "", description: "", assigneeUids: [], clips: [], sourceProjectId: "" });
const dateText = (date) => date?.toDate?.().toLocaleString("ja-JP") || "保存中";
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
  const [notes, setNotes] = useState([]), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null), [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [commentEdit, setCommentEdit] = useState(null);
  const [sourceId, setSourceId] = useState(""), [tags, setTags] = useState([]), [mode, setMode] = useState("OR");
  const selected = notes.find((n) => n.id === selectedId);
  const commentDirty = Boolean(commentEdit && commentEdit.value !== commentEdit.original);
  useEffect(() => {
    setCommentEdit(null);
  }, [activeTeamId, selectedId, readable, selected?.id]);
  const members = Object.values(userProfiles).filter(canReadNotes);
  const allAssigned = (uids = []) => members.length > 0 && uids.length === members.length && members.every((p) => uids.includes(p.uid));
  const names = (uids) => allAssigned(uids) ? "全員" : (uids || []).map((uid) => members.find((p) => p.uid === uid)?.name || "退会・所属変更済み").join("、") || "指定なし";
  useEffect(() => {
    setNotes([]); setSelectedId(null); setDraft(null);  setError("");
    if (!activeTeamId || !readable) { setLoading(false); return; }
    setLoading(true);
    return subscribeTacticalNotes(activeTeamId, (items) => { setNotes(items); setLoading(false); }, () => {
      setNotes([]); setLoading(false); setError("読み込みに失敗しました。接続と権限を確認して、画面を開き直してください。");
    });
  }, [activeTeamId, readable]);

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
  usePreventRemove((Boolean(draft) || commentDirty || Boolean(commentEdit && busy)) && readable, ({ data }) => {
    if (busy) return;
    Alert.alert("編集を破棄", "保存していない内容を破棄しますか？", [{ text: "続ける", style: "cancel" },
      { text: "破棄", style: "destructive", onPress: () => navigation.dispatch(data.action) }]);
  });
  const update = (changes) => setDraft((prev) => ({ ...prev, ...changes }));
  const leaveCommentEdit = (after = () => {}) => {
    if (busy) return;
    const finish = () => { setCommentEdit(null); Keyboard.dismiss(); after(); };
    if (!commentDirty) { finish(); return; }
    Alert.alert("編集を破棄", "保存していない全体コメントを破棄しますか？", [
      { text: "続ける", style: "cancel" }, { text: "破棄", style: "destructive", onPress: finish },
    ]);
  };
  const saveComment = async () => {
    if (busy || !commentEdit || !selected || !canManageNote(profile, currentUserUid, selected)) return;
    setBusy(true);
    try {
      await updateTacticalNoteDescription(activeTeamId, selected.id, commentEdit.value);
      setCommentEdit(null); Keyboard.dismiss();
    } catch (e) {
      Alert.alert("保存できません", e.code ? "通信状態または編集権限を確認してください。入力内容は保持されています。" : e.message);
    } finally { setBusy(false); }
  };
  const discard = () => Alert.alert("編集を破棄", "保存していない内容を破棄しますか？", [
    { text: "続ける", style: "cancel" }, { text: "破棄", style: "destructive", onPress: () => setDraft(null) },
  ]);
  const save = async () => {
    if (busy || (editingId ? !canManageNote(profile, currentUserUid, notes.find((n) => n.id === editingId)) : !writable)) return;
    setBusy(true);
    try { await saveTacticalNote(activeTeamId, editingId, draft, currentUser); setDraft(null); }
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
  if (selected && !draft) return focused ? <TacticalClipPlayer
    key={selected.id} note={selected} projects={projects} userProfiles={userProfiles}
    currentUserUid={currentUserUid} currentUser={currentUser} navigation={navigation}
    onClose={() => leaveCommentEdit(() => setSelectedId(null))}
    noteHeader={commentEdit ? <View>
      <Text style={s.label}>全体コメント編集</Text>
      <TextInput accessibilityLabel="全体コメント" style={[s.input, { height: 76, textAlignVertical: "top" }]}
        autoFocus multiline maxLength={5000} value={commentEdit.value}
        editable={!busy && canManageNote(profile, currentUserUid, selected)}
        onChangeText={(value) => setCommentEdit((prev) => prev ? { ...prev, value } : prev)} />
      <View style={s.row}>
        <Button title={busy ? "保存中…" : "保存"} disabled={busy || !canManageNote(profile, currentUserUid, selected)} onPress={saveComment} />
        <Button title="キャンセル" disabled={busy} onPress={() => leaveCommentEdit()} />
      </View>
    </View> : <View>
      <Text style={s.heading}>{selected.title}</Text>
      <Text>{selected.authorName} · {dateText(selected.createdAt)}</Text>
      <Text style={s.info}>担当者：{names(selected.assigneeUids)}</Text>
      <Text>{selected.description}</Text>
      {canManageNote(profile, currentUserUid, selected) && <View style={s.row}>
        <Button title="編集" disabled={busy} onPress={() => {
          setEditingId(selected.id);
          setDraft({ title: selected.title, description: selected.description,
            assigneeUids: [...selected.assigneeUids], clips: selected.clips.map((c) => ({ ...c })), sourceProjectId: selected.sourceProjectId });
          setSourceId(selected.sourceProjectId); setTags([]); setMode("OR");
        }} />
        <Button title="削除" disabled={busy} onPress={remove} />
        <Button title="全体コメント編集" disabled={busy} onPress={() => setCommentEdit({ value: selected.description || "", original: selected.description || "" })} />
      </View>}
    </View>}
  /> : <View style={s.page} />;
  return <SafeAreaView style={s.page}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Button title="◁ 前の画面へ戻る" variant="primary" disabled={busy} onPress={() => navigation.goBack()} />
    <Text style={s.heading}>戦術ノート</Text>
    <Text style={s.info}>保護者以外のチーム全員に公開されます。担当者の指定は閲覧範囲を制限しません。</Text>
    {!!error && <Text style={s.error}>{error}</Text>}
    {draft ? <View>
      <Text style={s.heading}>{editingId ? "ノートを編集" : "ノートを作成"}</Text>
      <Text>タイトル</Text><TextInput accessibilityLabel="タイトル" style={s.input} maxLength={120} value={draft.title} editable={!busy} onChangeText={(title) => update({ title })} />
      <Text>全体説明</Text><TextInput accessibilityLabel="全体説明" style={s.input} multiline maxLength={5000} value={draft.description} editable={!busy} onChangeText={(description) => update({ description })} />
      <Text style={s.label}>担当者（複数選択可）</Text>
      <View style={s.row}>
        <Button title="全員" disabled={busy || !members.length} selected={allAssigned(draft.assigneeUids)} onPress={() => update({ assigneeUids: allAssigned(draft.assigneeUids) ? [] : members.map((p) => p.uid) })} />
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
      <Button title={busy ? "保存中…" : "投稿を保存"} variant="primary" onPress={save} disabled={busy || loading || !!error || (editingId ? !canManageNote(profile, currentUserUid, notes.find((n) => n.id === editingId)) : !writable)} />
      <Button title="キャンセル" onPress={discard} disabled={busy} />
    </View> : <View>
      {writable && <Button title="＋ ノートを作成" variant="primary" disabled={loading || !!error} onPress={() => { setDraft(emptyDraft()); setEditingId(null); setSourceId(""); setTags([]); setMode("OR"); }} />}
      {loading ? <Text>読み込み中…</Text> : !notes.length && !error ? <Text style={s.info}>戦術ノートはまだありません。</Text> : null}
      {notes.map((note) => <TouchableOpacity accessibilityRole="button" key={note.id} style={s.card} onPress={() => { setSelectedId(note.id);  }}>
        <Text style={s.label}>{note.title}</Text><Text>{note.authorName} · {dateText(note.createdAt)}</Text>
        <Text numberOfLines={3} style={s.info}>{note.description || "説明なし"}</Text><Text>担当者：{names(note.assigneeUids)}</Text><Text>場面 {note.clips.length}件</Text>
      </TouchableOpacity>)}
    </View>}
  </ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#f0f2f5" }, content: { padding: 15, paddingBottom: 40 },
  heading: { fontSize: 20, fontWeight: "bold", color: "#333", marginVertical: 10 },
  info: { color: "#666", marginVertical: 8, lineHeight: 22 }, error: { color: "#b42318", marginVertical: 12 },
  label: { fontSize: 15, fontWeight: "bold", color: "#333", marginVertical: 8 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: {
    backgroundColor: "#fff", padding: 15, borderRadius: 12, marginBottom: 15,
    elevation: 2, borderLeftWidth: 4, borderLeftColor: "#3498db",
  },
  input: {
    backgroundColor: "#f0f2f5", borderWidth: 1, borderColor: "#e2e8f0",
    borderRadius: 8, padding: 10, marginVertical: 8, color: "#333", fontSize: 15,
  },
  button: { padding: 12, marginVertical: 5, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#bdc9d4" },
  primaryButton: { alignSelf: "flex-start", backgroundColor: "#0077cc", paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, borderWidth: 0 },
  primaryButtonText: { color: "#fff", fontSize: 13, fontWeight: "bold" },
  selected: { backgroundColor: "#e8f2fa", borderColor: "#0077cc" }, buttonText: { color: "#16446c", fontSize: 14, fontWeight: "bold" },
});
