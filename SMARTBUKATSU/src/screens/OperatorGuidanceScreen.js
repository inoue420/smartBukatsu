import React, { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { openGuideUrl } from "../utils/openGuide";
import { SMARTBUKATSU_GUIDE_URL } from "../constants/helpLinks";
import OperatorGuidanceContent from "../components/OperatorGuidanceContent";
import { createGuidanceRequestId, getOperatorGuidanceAccess, listOperatorGuidanceTargets, listOperatorGuidanceHistory,
  sendOperatorGuidance, getOperatorGuidanceUsage, guidanceAge, guidanceDraft, guidanceDraftMessage, GUIDANCE_STATUS, GUIDANCE_REASON } from "../services/operatorGuidanceService";

const date = (value) => value ? new Date(value).toLocaleString("ja-JP") : "不明";
const reason = (value) => GUIDANCE_REASON[value] || value || "";

export default function OperatorGuidanceScreen({ navigation, route }) {
  const { user } = useAuth(), uid = user?.uid;
  const history = route.params?.mode === "history";
  const [data, setData] = useState(null), [error, setError] = useState("");
  const [selected, setSelected] = useState([]), [resend, setResend] = useState(false);
  const [pending, setPending] = useState(null), [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [templateStale, setTemplateStale] = useState(false);
  const [reload, setReload] = useState(0);
  const [usage, setUsage] = useState({}), [usageLoading, setUsageLoading] = useState(null);
  const usageLock = useRef(false);
  const epoch = useRef(0), locked = useRef(false);
  const fetchPage = history ? listOperatorGuidanceHistory : listOperatorGuidanceTargets;
  const visible = data?.uid === uid && data?.history === history;

  useFocusEffect(useCallback(() => {
    const token = ++epoch.current;
    setData(null); setError(""); setSelected([]); setResend(false); setResults([]); setPending(null); setDraft(null); setTemplateStale(false);
    setUsage({}); if (!usageLock.current) setUsageLoading(null);
    // Keep the in-flight lock until the old operation actually finishes.
    if (!locked.current) setBusy(false);
    (async () => {
      try {
        const access = await getOperatorGuidanceAccess(uid);
        const page = await fetchPage(uid);
        if (epoch.current === token) { setData({ uid, history, template: access.template, ...page }); setDraft(guidanceDraft(access.template)); }
      } catch (e) { if (epoch.current === token) setError(e?.message || "取得できませんでした。"); }
    })();
    return () => { epoch.current += 1; };
  }, [uid, history, fetchPage, reload]));

  async function fetchUsage(teamId) {
    if (!visible || usageLock.current) return;
    usageLock.current = true; setUsageLoading(teamId);
    const token = epoch.current;
    try {
      const result = await getOperatorGuidanceUsage(uid, teamId);
      if (token === epoch.current) setUsage((old) => ({ ...old, [teamId]: result }));
    } catch (e) {
      if (token === epoch.current) {
        setUsage((old) => ({ ...old, [teamId]: { ...old[teamId], error: e?.message || "集計できませんでした。再取得してください。" } }));
        if (String(e?.code).includes("permission-denied")) { setData(null); setUsage({}); setError(e.message); }
      }
    } finally { usageLock.current = false; setUsageLoading(null); }
  }

  async function loadMore(refresh = false) {
    if (locked.current || !visible) return;
    locked.current = true; setBusy(true); setError("");
    const token = epoch.current;
    try {
      const page = await fetchPage(uid, refresh ? null : data.cursor);
      if (token === epoch.current) {
        setData((old) => ({ ...old, ...page, items: refresh ? page.items : [...new Map([...old.items, ...page.items].map((item) => [item.id, item])).values()] }));
        if (refresh) setSelected([]);
      }
    } catch (e) {
      if (token === epoch.current) {
        setError(e?.message || "取得できませんでした。");
        if (String(e?.code).includes("permission-denied")) setData(null);
      }
    } finally { locked.current = false; setBusy(false); }
  }

  async function refreshTemplate(token) {
    const access = await getOperatorGuidanceAccess(uid);
    if (token !== epoch.current) return;
    const next = guidanceDraft(access.template);
    setData((old) => ({ ...old, template: access.template }));
    // Preserve manual text when the template still has the same five topics.
    setDraft((old) => old && next && old.features.length === next.features.length && old.features.every((item, i) => item.topic === next.features[i].topic) ? old : next);
    setTemplateStale(false);
  }
  async function retryTemplate() {
    if (locked.current || pending || !visible) return;
    const token = epoch.current;
    locked.current = true; setBusy(true); setError("");
    try { await refreshTemplate(token); }
    catch (e) { if (token === epoch.current) { setError(e?.message || "文面を再取得できませんでした。"); if (String(e?.code).includes("permission-denied")) setData(null); } }
    finally { locked.current = false; if (token === epoch.current) setBusy(false); }
  }
  async function execute(request, checking = false) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setPending(request); setError("");
    const token = epoch.current;
    try {
      const response = await sendOperatorGuidance(uid, request);
      if (token !== epoch.current) return;
      setResults(response.results); setPending(null); setSelected([]);
      const page = await listOperatorGuidanceTargets(uid);
      if (token === epoch.current) setData((old) => ({ ...old, ...page }));
    } catch (e) {
      if (token === epoch.current) {
        setError(e?.message || "結果を確認できませんでした。同じ操作IDで再確認できます。");
        if (String(e?.code).includes("permission-denied")) { setData(null); setPending(null); }
        else if (!checking && String(e?.code).split("/").at(-1) === "invalid-argument" && e?.details?.guidanceSendNotStarted === true) {
          setPending(null);
          if (e.details.refreshTemplate === true) {
            setTemplateStale(true);
            try { await refreshTemplate(token); }
            catch (refreshError) { if (token === epoch.current) {
              setError("送信は開始されていません。文面を再取得してください。");
              if (String(refreshError?.code).includes("permission-denied")) setData(null);
            } }
          }
        } else if (checking && e?.details?.guidanceSendNotStarted === true) {
          setError("先の送信結果は未確定です。送信履歴を確認してください。文面を変更して新たに送る操作は行っていません。");
        }
      }
    } finally { locked.current = false; setBusy(false); }
  }
  function confirm(test = false) {
    if (!visible || locked.current || pending || templateStale || (!test && !selected.length)) return;
    if (draftInvalid) { setError("タイトルと5項目を入力し、案内文の文字数を確認してください。"); return; }
    const message = draft ? guidanceDraftMessage(draft) : data.template;
    const request = { requestId: createGuidanceRequestId(), templateVersion: data.template.version,
      ...(draft ? { content: guidanceDraft({ content: draft }) } : {}),
      mode: test ? "test" : resend ? "resend" : "initial", teamIds: test ? [] : selected, confirmResend: !test && resend,
      expectedOwnerUids: test ? {} : Object.fromEntries(data.items.filter((item) => selected.includes(item.id)).map((item) => [item.id, item.ownerUid])) };
    const accounts = new Set(Object.values(request.expectedOwnerUids)).size;
    const token = epoch.current;
    Alert.alert(test ? "自分へのテスト送信" : resend ? "選択した所有者へ再送" : "初回案内を送信",
      `${test ? "自分だけ" : `現在のチーム所有者${accounts}アカウント`}に次の内容を送ります。${!test && resend ? "過去に案内した方への再送です。" : ""}\n\n${message.title}\n${message.body}\n\n${draft ? "各項目から操作ガイドの該当箇所を開けます。" : data.template.url}`,
      [{ text: "キャンセル", style: "cancel" }, { text: test ? "テスト送信" : resend ? "再送する" : "送信する", onPress: () => { if (epoch.current === token) execute(request); } }]);
  }
  const draftInvalid = draft && (!draft.title.trim() || draft.title.length > 120 || draft.introduction.length > 2000 || draft.closing.length > 3000 || draft.features.some((item) => !item.label.trim() || item.label.length > 200));
  const editDraft = (field, value) => { if (!locked.current && !pending) setDraft((old) => ({ ...old, [field]: value })); };
  function toggle(item) {
    if (busy || pending) return;
    setSelected((values) => values.includes(item.id) ? values.filter((id) => id !== item.id) : values.length < 10 ? [...values, item.id] : values);
  }
  const button = (label, action, disabled = false) => <TouchableOpacity accessibilityRole="button" disabled={disabled} style={[styles.button, disabled && styles.disabled]} onPress={action}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}>{button("‹ 戻る", navigation.goBack)}<Text style={styles.heading}>{history ? "送信履歴" : "ご案内を送信"}</Text></View>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.note}>配信受付はExpoが送信を受け付けた状態です。端末への到達・既読を意味しません。処理中・結果未確定は自動再送しません。10分以上未確定の場合は履歴を確認してから明示的に再送できます。</Text>
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!data && !!error && button("再読み込み", () => setReload((value) => value + 1), busy)}
      {!data && !error && <ActivityIndicator color="#0077cc" />}
      {visible && <>
        {button("一覧を更新", () => loadMore(true), busy || Boolean(pending))}
        {!history && <View style={styles.card}>
          {draft && <>
            <Text style={styles.title}>送信する文章を編集</Text>
            <Text style={styles.note}>この画面での編集内容を送信します。画面を開き直すと初回テンプレートに戻ります。項目名を編集しても説明のリンク先は変わりません。</Text>
            <Text style={styles.text}>タイトル（120文字まで）</Text>
            <TextInput accessibilityLabel="案内タイトル" value={draft.title} onChangeText={(value) => editDraft("title", value)} editable={!busy && !pending} maxLength={120} style={styles.input} />
            <Text style={styles.text}>案内の前文（2000文字まで）</Text>
            <TextInput accessibilityLabel="案内の前文" value={draft.introduction} onChangeText={(value) => editDraft("introduction", value)} editable={!busy && !pending} multiline maxLength={2000} textAlignVertical="top" style={[styles.input, styles.multiline]} />
            {draft.features.map((feature, i) => <View key={feature.topic}>
              <Text style={styles.text}>項目{i + 1}の表示文言（200文字まで）</Text>
              <TextInput accessibilityLabel={`項目${i + 1}の表示文言`} value={feature.label} onChangeText={(value) => editDraft("features", draft.features.map((item, index) => index === i ? { ...item, label: value } : item))} editable={!busy && !pending} multiline maxLength={200} textAlignVertical="top" style={styles.input} />
            </View>)}
            <Text style={styles.text}>案内の後文・署名（3000文字まで）</Text>
            <TextInput accessibilityLabel="案内の後文・署名" value={draft.closing} onChangeText={(value) => editDraft("closing", value)} editable={!busy && !pending} multiline maxLength={3000} textAlignVertical="top" style={[styles.input, styles.multiline]} />
            {draftInvalid && <Text style={styles.error}>タイトルと5項目の表示文言を入力してください。</Text>}
            <Text style={styles.title}>送信内容のプレビュー</Text>
          </>}
          <OperatorGuidanceContent {...(draft ? guidanceDraftMessage(draft) : data.template)} />
          {templateStale && button("文面を再取得", retryTemplate, busy || Boolean(pending))}
          {button("リンク先を確認", () => openGuideUrl(SMARTBUKATSU_GUIDE_URL).catch(() => Alert.alert("開けませんでした", "通信状態を確認してください。")))}
          <Text style={styles.note}>設立日時が新しい順に5チームずつ表示します。設立日時が未登録のチームは表示対象外です。72時間経過は参考情報です。所有者不明・未所属のチームは選択できません。最大10チーム、同じ所有者は1アカウントにまとめます。利用状況は取得ボタンを押したチームだけ集計します。</Text>
          <View style={styles.row}><Text style={styles.text}>送信済みの方への再送</Text><Switch value={resend} disabled={busy || Boolean(pending)} onValueChange={(value) => { setResend(value); setSelected([]); }} /></View>
          {button("自分へのテスト送信", () => confirm(true), busy || Boolean(pending) || templateStale || Boolean(draftInvalid))}
          {button(`${resend ? "再送" : "初回案内を送信"}（${selected.length}チーム選択）`, () => confirm(), busy || Boolean(pending) || templateStale || !selected.length || Boolean(draftInvalid))}
          {pending && button("同じ操作IDで送信結果を再確認", () => execute(pending, true), busy)}
        </View>}
        {results.map((item, index) => <View key={index} style={styles.card}><Text style={styles.title}>{GUIDANCE_STATUS[item.status] || item.status}</Text><Text style={styles.text}>{reason(item.reason)}</Text><Text style={styles.note}>チームID: {item.teamId || "自分へのテスト"}</Text></View>)}
        {!data.items.length && <Text style={styles.note}>対象はありません。</Text>}
        {data.items.map((item) => history ? <View key={item.id} style={styles.card}>
          <Text style={styles.title}>{item.teamName}・{GUIDANCE_STATUS[item.status] || item.status}</Text>
          <Text style={styles.text}>{date(item.createdAt)} / {item.mode === "test" ? "テスト" : item.mode === "resend" ? "再送" : "初回"}</Text>
          <Text selectable style={styles.note}>送信者: {item.senderUid}{"\n"}対象: {item.targetUid}</Text>
          <OperatorGuidanceContent title={item.title} body={item.body} content={item.content} />
          <Text style={styles.note}>{reason(item.reason)}{item.notificationSaved ? " / 通知センターに保存済み" : ""}</Text>
          <Text style={styles.note}>やり取り {item.messageCount || 0}件{item.lastMessageAt ? ` / 最終更新 ${date(item.lastMessageAt)} / ${item.lastMessageRole === "recipient" ? "受信者の返信" : "運営の返信"}` : ""}</Text>
          {button("会話を確認・返信", () => navigation.navigate("OperatorGuidanceConversation", { historyId: item.id, asOperator: true }), !item.notificationSaved || item.targetUid === "deleted_user")}
          {!!item.deviceResults && <Text style={styles.note}>端末別: 受付{item.deviceResults.accepted} / 送信不可{item.deviceResults.unavailable} / 失敗{item.deviceResults.failed} / 受付不明{item.deviceResults.unknown}</Text>}
        </View> : <View key={item.id} style={[styles.card, selected.includes(item.id) && styles.selected]}>
          <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(item.id), disabled: busy || !!pending || !item.selectable || (!resend && item.initialRecorded) }}
          disabled={busy || !!pending || !item.selectable || (!resend && item.initialRecorded)} onPress={() => toggle(item)}>
          <Text style={styles.title}>{selected.includes(item.id) ? "☑ " : "□ "}{item.name}</Text>
          <Text style={styles.text}>作成: {date(item.createdAt)}{"\n"}{guidanceAge(item.createdAt)}{"\n"}現在の所有者: {item.ownerName || item.unavailableReason || "名称未設定"}</Text>
          <Text style={styles.note}>{item.initialRecorded ? `案内の記録あり・${GUIDANCE_STATUS[item.initialStatus] || "結果未確定"}` : "初回案内の記録なし"} / {item.pushEnabled ? "通知設定ON" : "通知OFFまたは確認不可"}{item.unavailableReason ? ` / ${item.unavailableReason}` : ""}</Text>
          </TouchableOpacity>
          {usage[item.id]?.counts && <>
            <Text style={styles.text}>メンバー数: {usage[item.id].counts.members}{"\n"}予定作成数: {usage[item.id].counts.events}{"\n"}動画登録数: {usage[item.id].counts.videos}{"\n"}閲覧登録数: {usage[item.id].counts.viewingProjects}{"\n"}戦術ノート使用数: {usage[item.id].counts.tacticalNotes}</Text>
            <Text style={styles.note}>取得日時: {date(usage[item.id].fetchedAt)}{"\n"}削除済み・下書きを除く現在の登録数。閲覧登録＝閲覧用プロジェクト、戦術ノート＝公開済みノート。</Text>
          </>}
          {!!usage[item.id]?.error && <Text accessibilityRole="alert" style={styles.error}>{usage[item.id].error}</Text>}
          {button(usageLoading === item.id ? "利用状況を取得中…" : usage[item.id]?.counts ? "利用状況を再取得" : "利用状況を取得", () => fetchUsage(item.id), Boolean(usageLoading) || busy || Boolean(pending))}
        </View>)}
        {!!data.cursor && button(history ? "50件を追加読み込み" : "さらに5チーム読み込む", () => loadMore(), busy || Boolean(pending))}
      </>}
      {busy && <ActivityIndicator color="#0077cc" />}
    </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, input: { borderWidth: 1, borderColor: "#b9c9d6", backgroundColor: "#fff", borderRadius: 8, padding: 10, marginVertical: 6, fontSize: 14, lineHeight: 22, color: "#18334b" }, multiline: { minHeight: 120 },
  container: { flex: 1, backgroundColor: "#f4f7f6" }, header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, backgroundColor: "#fff" },
  heading: { fontSize: 18, fontWeight: "bold", marginLeft: 16 }, content: { padding: 16, paddingBottom: 40 },
  card: { padding: 16, backgroundColor: "#fff", borderWidth: 1, borderColor: "#dbe3eb", borderRadius: 12, marginVertical: 6 },
  selected: { borderColor: "#0077cc", backgroundColor: "#edf8ff" }, title: { fontSize: 15, fontWeight: "bold", color: "#18334b", marginBottom: 6 },
  text: { fontSize: 14, lineHeight: 22, color: "#334155" }, note: { fontSize: 12, lineHeight: 19, color: "#64748b", marginVertical: 6 },
  error: { color: "#b42318", paddingVertical: 12 }, link: { color: "#0077cc", marginVertical: 8 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  button: { backgroundColor: "#0077cc", padding: 12, marginVertical: 6, borderRadius: 8 }, buttonText: { color: "#fff", fontWeight: "bold", textAlign: "center" }, disabled: { opacity: 0.45 },
});
