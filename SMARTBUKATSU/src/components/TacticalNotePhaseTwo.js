import React, { useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Image, Alert, StyleSheet } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { prepareTacticalNoteImage } from "../services/tacticalNoteAttachmentService";
import { recordTacticalNoteResponse, replyTacticalNoteQuestion, recordTacticalTaskProgress,
  getTacticalNoteQuestions, getTacticalNoteReplies, resolveTacticalNoteQuestion, getTacticalNoteHistory } from "../services/firestoreService";
import { summaryFromIndex, localDate, noteClipKey, noteAcknowledgementId, hasNoteAcknowledgement } from "../utils/tacticalNotes";

function Action({ title, onPress, disabled, selected }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!selected }}
    disabled={disabled} onPress={onPress} style={[s.button, selected && s.selected, disabled && { opacity: 0.4 }]}><Text>{title}</Text></TouchableOpacity>;
}
const stamp = (value) => value?.toDate?.().toLocaleString("ja-JP") || "保存中";
const statuses = { read: "確認しました", understood: "理解しました", question: "質問があります", done: "完了", pending: "未完了", returned: "差し戻し" };
const confirmationStatus = (status) => status === "question" ? "質問を送信済み" : statuses[status];
export function PhaseTwoSummary({ index, uid, today = localDate() }) {
  if (!index) return <Text>確認・タスク状況を更新中…</Text>;
  const summary = summaryFromIndex(index, uid, today);
  return <View style={s.section}><Text>確認 {summary.confirmed}/{(index.assigneeUids || []).length}人 · 質問 {summary.questions.length}人</Text>
    <Text>{summary.taskCount ? `タスク ${summary.taskCount}件 · 完了 ${summary.done}/${summary.total}人分 · 未完了 ${summary.total - summary.done} · 期限超過 ${summary.overdue}` : "タスクなし"}</Text>
    {!!summary.taskCount && <Text>期限：{summary.dueDates.join("、")}</Text>}
  </View>;
}

function NoteImage({ image }) {
  const [visible, setVisible] = useState(false);
  const local = Boolean(image.localUri);
  return <View style={s.section}>
    <Text>{image.name || "指導画像"}</Text>
    {!local && <Action title={visible ? "画像を閉じる" : "画像を見る"} onPress={() => setVisible((value) => !value)} />}
    {(local || visible) && <Image source={{ uri: image.localUri || image.downloadUrl }} style={s.image} resizeMode="contain" accessibilityLabel={image.name || "指導画像"} />}
  </View>;
}

export function PhaseTwoEditor({ draft, update, members, busy, onBusyChange }) {
  const [picking, setPicking] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusyChange(false); }; }, [onBusyChange]);
  const tasks = draft.tasks || {}, images = draft.images || [];
  const change = (id, patch) => update({ tasks: { ...tasks, [id]: { ...tasks[id], ...patch } } });
  const pick = async () => {
    if (picking || busy) return;
    setPicking(true); onBusyChange(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 6 - images.length, quality: 1 });
      if (!result.canceled) {
        if (result.assets.length + images.length > 6) throw new Error("画像は6枚までです。");
        const prepared = [];
        for (const asset of result.assets) {
          if (!mounted.current) return;
          prepared.push(await prepareTacticalNoteImage(asset));
        }
        if (mounted.current) update({ images: [...images, ...prepared] });
      }
    } catch (error) { if (mounted.current) Alert.alert("画像を追加できません", error.message); }
    finally { if (mounted.current) { setPicking(false); onBusyChange(false); } }
  };
  return <View>
    <Text style={s.heading}>指導画像（6枚まで）</Text>
    <Text>動画場面がなくても、画像を添付して投稿できます。画像は添付・ノート削除まで保存します。</Text>
    <Action title={picking ? "画像を準備中…" : "画像を選ぶ"} disabled={busy || picking || images.length >= 6} onPress={pick} />
    {images.map((image) => <View key={image.id} style={s.section}><NoteImage image={image} />
      <Action title="画像を取り外す" disabled={busy || picking} onPress={() => update({ images: images.filter((item) => item.id !== image.id) })} /></View>)}
    <Text style={s.heading}>行動タスク（任意）</Text>
    <Text>タスク内容・担当者・期限・対象場面を変更すると、そのタスクは再度完了報告が必要になります。</Text>
    {Object.entries(tasks).map(([id, task], index) => <View key={id} style={s.card}>
      <Text style={s.heading}>タスク {index + 1}</Text>
      <TextInput accessibilityLabel={`タスク${index + 1}の実施内容`} style={s.input} multiline maxLength={2000} placeholder="実施内容" value={task.text} editable={!busy} onChangeText={(text) => change(id, { text })} />
      <Text>担当者（進捗は個人別）</Text><View style={s.row}>
        <Action title="全員" disabled={busy} selected={members.length > 0 && members.every((member) => task.assigneeUids.includes(member.uid))} onPress={() => change(id, { assigneeUids: members.every((member) => task.assigneeUids.includes(member.uid)) ? [] : members.map((member) => member.uid) })} />
        {members.map((member) => <Action key={member.uid} title={member.name || "メンバー"} disabled={busy} selected={task.assigneeUids.includes(member.uid)} onPress={() => change(id, { assigneeUids: task.assigneeUids.includes(member.uid) ? task.assigneeUids.filter((uid) => uid !== member.uid) : [...task.assigneeUids, member.uid] })} />)}</View>
      <Text>期限（日付指定：YYYY-MM-DD）</Text><View style={s.row}>
        <Action title="今日" disabled={busy} onPress={() => change(id, { dueDate: localDate() })} />
        <Action title="明日" disabled={busy} onPress={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); change(id, { dueDate: localDate(tomorrow) }); }} /></View>
      <TextInput accessibilityLabel={`タスク${index + 1}の期限`} style={s.input} value={task.dueDate} maxLength={10} placeholder="YYYY-MM-DD" editable={!busy} onChangeText={(dueDate) => change(id, { dueDate })} />
      <Text>対象</Text><View style={s.row}><Action title="ノート全体" disabled={busy} selected={!task.clipKey} onPress={() => change(id, { clipKey: "" })} />
        {draft.clips.map((clip, clipIndex) => <Action key={noteClipKey(clip)} title={`場面${clipIndex + 1}：${clip.label}`} disabled={busy} selected={task.clipKey === noteClipKey(clip)} onPress={() => change(id, { clipKey: noteClipKey(clip) })} />)}</View>
      {!!task.clipKey && !draft.clips.some((clip) => noteClipKey(clip) === task.clipKey) && <Text style={s.error}>対象場面が外されています。対象を選び直してください。</Text>}
      <Action title="タスクを削除" disabled={busy} onPress={() => update({ tasks: Object.fromEntries(Object.entries(tasks).filter(([key]) => key !== id)) })} />
    </View>)}
    <Action title="＋ タスクを追加" disabled={busy || Object.keys(tasks).length >= 30} onPress={() => { const id = `task${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
      update({ tasks: { ...tasks, [id]: { text: "", assigneeUids: [], dueDate: localDate(), clipKey: "", revision: 1 } } }); }} />
  </View>;
}

export function PhaseTwoDetail({ teamId, note, summaryIndex, activity = {}, uid, names, editable, disabled,
  confirmationDisabled = false, taskDisabled = false, onBusyChange, onDirtyChange }) {
  const [question, setQuestion] = useState(""), [replies, setReplies] = useState({}), [comments, setComments] = useState({});
  const [working, setWorking] = useState(false), [acknowledged, setAcknowledged] = useState({});
  const [resolved, setResolved] = useState({});
  const [questionsPage, setQuestionsPage] = useState({ open: false, items: [], cursor: null, hasMore: false, loading: false, error: "" });
  const [replyPages, setReplyPages] = useState({});
  const [history, setHistory] = useState({ open: false, responses: [], progressHistory: [], loading: false, error: "" });
  const mounted = useRef(true), operationInFlight = useRef(false);
  const dirty = !!question || Object.values(replies).some(Boolean) || Object.values(comments).some(Boolean);
  useEffect(() => { onBusyChange(working); }, [working, onBusyChange]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusyChange(false); onDirtyChange(false); }; }, [onBusyChange, onDirtyChange]);
  const busy = disabled || working;
  const confirmationBusy = busy || confirmationDisabled || !summaryIndex;
  const summary = summaryIndex ? summaryFromIndex(summaryIndex, uid) : null;
  const progressByPerson = new Map((activity.progress || []).map((item) => [`${item.taskId}_${item.uid}`, item]));
  const mergeItems = (previous, next) => [...new Map([...previous, ...next].map((item) => [item.id, item])).values()];
  const execute = async (operation, after = () => {}) => {
    if (busy || operationInFlight.current) return;
    operationInFlight.current = true; setWorking(true);
    try { await operation(); if (mounted.current) await after(); }
    catch (error) { if (mounted.current) Alert.alert("保存できません", error.code ? "接続・権限を確認してください。内容が更新された場合は開き直してください。" : error.message); }
    finally { operationInFlight.current = false; if (mounted.current) setWorking(false); }
  };
  const loadQuestions = async (more = false) => {
    if (questionsPage.loading) return;
    setQuestionsPage((previous) => ({ ...previous, open: true, loading: true, error: "" }));
    try {
      const page = await getTacticalNoteQuestions(teamId, note.id, more ? questionsPage.cursor : null);
      if (mounted.current) setQuestionsPage((previous) => ({ ...page, open: true, loading: false, error: "", items: more ? mergeItems(previous.items, page.items) : page.items }));
    } catch { if (mounted.current) setQuestionsPage((previous) => ({ ...previous, loading: false, error: "質問を読み込めません。再試行してください。" })); }
  };
  const loadReplies = async (responseId, more = false) => {
    if (replyPages[responseId]?.loading) return;
    const cursor = more ? replyPages[responseId]?.cursor : null;
    setReplyPages((previous) => ({ ...previous, [responseId]: { ...(previous[responseId] || {}), open: true, loading: true, error: "" } }));
    try {
      const page = await getTacticalNoteReplies(teamId, note.id, responseId, cursor);
      if (mounted.current) setReplyPages((previous) => ({ ...previous, [responseId]: { ...page, open: true, loading: false, error: "",
        items: more ? mergeItems(previous[responseId]?.items || [], page.items) : page.items } }));
    } catch { if (mounted.current) setReplyPages((previous) => ({ ...previous, [responseId]: { ...previous[responseId], loading: false, error: "返信を読み込めません。再試行してください。" } })); }
  };
  const loadHistory = async (more = false) => {
    if (history.loading) return;
    setHistory((previous) => ({ ...previous, open: true, loading: true, error: "" }));
    try {
      const cursors = more ? { responseCursor: history.hasMoreResponses ? history.responseCursor : false,
        progressCursor: history.hasMoreProgress ? history.progressCursor : false } : {};
      const page = await getTacticalNoteHistory(teamId, note.id, cursors);
      if (mounted.current) setHistory((previous) => ({ ...page, open: true, loading: false, error: "",
        responses: more ? mergeItems(previous.responses, page.responses) : page.responses,
        progressHistory: more ? mergeItems(previous.progressHistory, page.progressHistory) : page.progressHistory }));
    } catch { if (mounted.current) setHistory((previous) => ({ ...previous, loading: false, error: "履歴を読み込めません。再試行してください。" })); }
  };
  return <View>
    {!!(note.images || []).length && <Text style={s.heading}>指導画像</Text>}
    {(note.images || []).map((image) => <NoteImage key={image.id} image={image} />)}
    <PhaseTwoSummary index={summaryIndex} uid={uid} />
    <Text style={s.heading}>確認状態</Text>
    {summary ? <View><Text>未確認：{names(summary.pending)}</Text><Text>未解決の質問あり：{names(summary.questions)}</Text>
      {(note.assigneeUids || []).map((person) => <Text key={person}>{names([person])}：{confirmationStatus(summary.latest[person]?.status) || "未確認"}</Text>)}</View> : <Text>最新の確認状態を反映中…</Text>}
    {(note.assigneeUids || []).includes(uid) && <View style={s.section}>
      <Text>自分の状態：{summary ? confirmationStatus(summary.latest[uid]?.status) || "未確認（内容変更後は再確認が必要です）" : "反映待ち"}</Text>
      <Text>確認・理解は、この内容の版でそれぞれ1回ずつ登録できます。質問の解決は本人が登録します。</Text>
      <View style={s.row}>{["read", "understood"].map((status) => <Action key={status} title={statuses[status]}
        disabled={confirmationBusy || Boolean(acknowledged[noteAcknowledgementId(note, uid, status)]) ||
          (status === "read" ? summaryIndex?.readUids : summaryIndex?.understoodUids)?.includes(uid) || hasNoteAcknowledgement(note, activity.responses, uid, status)}
        onPress={() => execute(() => recordTacticalNoteResponse(teamId, note, status),
          () => setAcknowledged((previous) => ({ ...previous, [noteAcknowledgementId(note, uid, status)]: true })))} />)}</View>
      <TextInput accessibilityLabel="質問本文" style={s.input} multiline maxLength={2000} placeholder="質問本文" value={question} editable={!busy} onChangeText={setQuestion} />
      <Action title="質問があります：送信" disabled={confirmationBusy || questionsPage.loading || !question.trim()} onPress={() => execute(() => recordTacticalNoteResponse(teamId, note, "question", question), async () => {
        setQuestion(""); if (questionsPage.open) await loadQuestions();
      })} />
    </View>}
    <Text style={s.heading}>質問と返信（過去の版を含む）</Text>
    <Action title={questionsPage.loading ? "質問を読み込み中…" : questionsPage.open ? "質問を更新" : "質問を表示"} disabled={busy || questionsPage.loading} onPress={() => loadQuestions()} />
    {!!questionsPage.error && <Text style={s.error}>{questionsPage.error}</Text>}
    {questionsPage.open && !questionsPage.loading && !questionsPage.items.length && !questionsPage.error && <Text>質問はありません。</Text>}
    {questionsPage.items.map((response) => {
      const page = replyPages[response.id], isResolved = response.resolved === true || resolved[response.id];
      return <View key={response.id} style={s.card}>
        <Text>{names([response.uid])} · 第{response.version}版 · {stamp(response.createdAt)}</Text><Text>{response.text}</Text>
        <Text>{isResolved ? "解決済み" : "未解決"}</Text>
        {response.uid === uid && !isResolved && <Action title="この質問は解決しました" disabled={busy} onPress={() => execute(() => resolveTacticalNoteQuestion(teamId, note.id, response.id),
          () => setResolved((previous) => ({ ...previous, [response.id]: true })))} />}
        <Action title={page?.loading ? "返信を読み込み中…" : page?.open ? "返信を更新" : "返信を表示"} disabled={busy || page?.loading} onPress={() => loadReplies(response.id)} />
        {!!page?.error && <Text style={s.error}>{page.error}</Text>}
        {page?.open && !page.loading && !page.items?.length && !page.error && <Text>返信はありません。</Text>}
        {[...(page?.items || [])].sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
          .map((reply) => <View key={reply.id} style={s.section}><Text>{names([reply.uid])} · {stamp(reply.createdAt)}</Text><Text>{reply.text}</Text></View>)}
        {page?.hasMore && <Action title="以前の返信をもっと表示" disabled={busy || page.loading} onPress={() => loadReplies(response.id, true)} />}
        {editable && <View><TextInput accessibilityLabel="質問への返信" style={s.input} multiline maxLength={2000} placeholder="返信" value={replies[response.id] || ""} editable={!busy} onChangeText={(text) => setReplies((previous) => ({ ...previous, [response.id]: text }))} />
          <Action title="返信を保存" disabled={busy || page?.loading || !replies[response.id]?.trim()} onPress={() => execute(() => replyTacticalNoteQuestion(teamId, note.id, response.id, replies[response.id]), async () => {
            setReplies((previous) => ({ ...previous, [response.id]: "" })); await loadReplies(response.id);
          })} /></View>}
      </View>;
    })}
    {questionsPage.hasMore && <Action title="以前の質問をもっと表示" disabled={busy || questionsPage.loading} onPress={() => loadQuestions(true)} />}
    <Text style={s.heading}>行動タスク</Text>
    {Object.entries(note.tasks || {}).map(([taskId, task]) => <View key={taskId} style={s.card}>
      <Text style={s.heading}>{task.text}</Text><Text>期限：{task.dueDate}</Text>
      <Text>対象：{task.clipKey ? `場面 ${note.clips.findIndex((clip) => noteClipKey(clip) === task.clipKey) + 1}` : "ノート全体"}</Text>
      {task.assigneeUids.map((person) => {
        const key = `${taskId}_${person}`, record = progressByPerson.get(key), progress = record?.taskRevision === task.revision ? record : null;
        const done = progress?.status === "done";
        return <View key={person} style={s.section}><Text>{names([person])}：{done ? "完了" : task.dueDate < localDate() ? "期限超過・未完了" : "未完了"}</Text>
          {done && <Text>完了日時：{stamp(progress.completedAt)}</Text>}
          {!!progress?.comment && <Text>{progress.status === "returned" ? "差し戻し理由" : "コメント"}：{progress.comment}</Text>}
          {(person === uid || (editable && done)) && <View>
            <TextInput accessibilityLabel={`${names([person])}の完了コメント・差し戻し理由`} style={s.input} multiline maxLength={2000} placeholder={person === uid ? "完了コメント（任意）／差し戻し理由" : "差し戻し理由（必須）"} value={comments[key] || ""} editable={!busy} onChangeText={(text) => setComments((previous) => ({ ...previous, [key]: text }))} />
            <View style={s.row}>{person === uid && <Action title={done ? "完了を取り消す" : "完了を報告"} disabled={busy || taskDisabled} onPress={() => execute(() => recordTacticalTaskProgress(teamId, note.id, taskId, person, done ? "pending" : "done", comments[key] || "", task.revision), () => setComments((previous) => ({ ...previous, [key]: "" })))} />}
              {editable && done && <Action title="理由付きで差し戻す" disabled={busy || taskDisabled || !comments[key]?.trim()} onPress={() => execute(() => recordTacticalTaskProgress(teamId, note.id, taskId, person, "returned", comments[key], task.revision), () => setComments((previous) => ({ ...previous, [key]: "" })))} />}</View>
          </View>}
        </View>;
      })}
    </View>)}
    <Text style={s.heading}>確認・完了の履歴</Text>
    <Action title={history.loading ? "履歴を読み込み中…" : history.open ? "履歴を更新" : "履歴を表示"} disabled={busy || history.loading} onPress={() => loadHistory()} />
    {!!history.error && <Text style={s.error}>{history.error}</Text>}
    {[...history.responses.map((item) => ({ ...item, eventAt: item.createdAt, label: `第${item.version}版：${statuses[item.status]}` })),
      ...history.progressHistory.map((item) => ({ ...item, eventAt: item.updatedAt, label: `${item.taskText || "当時の実施内容は記録なし"}（第${item.taskRevision}版）：${statuses[item.status]}` }))]
      .sort((a, b) => (b.eventAt?.toMillis?.() || 0) - (a.eventAt?.toMillis?.() || 0)).map((item) => <View key={`${item.taskId || "response"}_${item.id}`} style={s.section}>
        <Text>{names([item.uid])} · {stamp(item.eventAt)} · {item.label}</Text>{!!item.comment && <Text>{item.comment}</Text>}
        {item.status === "returned" && <Text>差し戻し：{names([item.updatedBy])}</Text>}
      </View>)}
    {(history.hasMoreResponses || history.hasMoreProgress) && <Action title="以前の履歴をもっと表示" disabled={busy || history.loading} onPress={() => loadHistory(true)} />}
  </View>;
}
const s = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: "bold", marginVertical: 10 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  section: { marginVertical: 8 }, card: { padding: 12, backgroundColor: "#fff", marginVertical: 8, borderRadius: 8 },
  button: { padding: 10, borderWidth: 1, borderColor: "#bdc9d4", borderRadius: 8, marginVertical: 5, backgroundColor: "#fff" },
  selected: { backgroundColor: "#e8f2fa", borderColor: "#0077cc" }, input: { padding: 10, marginVertical: 8, borderWidth: 1, borderColor: "#bdc9d4", borderRadius: 8, backgroundColor: "#fff", color: "#333" },
  image: { width: "100%", height: 220, marginVertical: 10 }, error: { color: "#b42318" },
});
