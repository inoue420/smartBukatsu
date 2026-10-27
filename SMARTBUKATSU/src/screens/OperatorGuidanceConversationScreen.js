import React, { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { openGuideUrl } from "../utils/openGuide";
import { SMARTBUKATSU_GUIDE_URL } from "../constants/helpLinks";
import OperatorGuidanceContent from "../components/OperatorGuidanceContent";
import { createGuidanceRequestId, getOperatorGuidanceConversation, replyOperatorGuidance } from "../services/operatorGuidanceService";

const date = (value) => value ? new Date(value).toLocaleString("ja-JP") : "日時不明";
export default function OperatorGuidanceConversationScreen({ navigation, route }) {
  const { user } = useAuth(), uid = user?.uid;
  const historyId = route.params?.historyId, asOperator = route.params?.asOperator === true;
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [text, setText] = useState(""), [pending, setPending] = useState(null), [busy, setBusy] = useState(false);
  const epoch = useRef(0), locked = useRef(false);
  const visible = data?.uid === uid && data?.historyId === historyId && data?.asOperator === asOperator;
  useFocusEffect(useCallback(() => {
    const token = ++epoch.current;
    setData(null); setError(""); setNotice(""); setText(""); setPending(null); setBusy(true);
    getOperatorGuidanceConversation(uid, historyId, asOperator).then((page) => { if (token === epoch.current) setData({ uid, historyId, asOperator, ...page }); })
      .catch((e) => { if (token === epoch.current) setError(e?.message || "会話を取得できませんでした。"); })
      .finally(() => { if (token === epoch.current) setBusy(false); });
    return () => { epoch.current += 1; };
  }, [uid, historyId, asOperator]));
  function failure(e) {
    setError(e?.message || "通信状態を確認してください。");
    if (String(e?.code).includes("permission-denied")) { setData(null); setText(""); setPending(null); }
  }
  async function load(older = false) {
    if (locked.current || busy) return;
    const token = epoch.current;
    locked.current = true; setBusy(true); setError("");
    try {
      const page = await getOperatorGuidanceConversation(uid, historyId, asOperator, older ? data.cursor : null);
      if (token === epoch.current) setData((old) => ({ uid, historyId, asOperator, ...page,
        items: older ? [...new Map([...page.items, ...old.items].map((item) => [item.id, item])).values()] : page.items }));
    } catch (e) { if (token === epoch.current) failure(e); }
    finally { locked.current = false; if (token === epoch.current) setBusy(false); }
  }
  async function send(request = null) {
    if (!visible || locked.current || busy || !data.thread.canReply || (!request && (pending || !text.trim()))) return;
    const input = request || { requestId: createGuidanceRequestId(), historyId, asOperator, text: text.trim() };
    const token = epoch.current;
    locked.current = true; setBusy(true); setError(""); setNotice(""); setPending(input);
    try {
      const result = await replyOperatorGuidance(uid, input);
      if (token !== epoch.current) return;
      setText(""); setPending(null);
      setNotice(result.notificationStatus === "accepted" ? "返信を保存しました。プッシュ通知は配信受付済みです。" : "返信を保存しました。プッシュ通知の配信受付は確認できていませんが、会話には保存されています。");
      const page = await getOperatorGuidanceConversation(uid, historyId, asOperator);
      if (token === epoch.current) setData({ uid, historyId, asOperator, ...page });
    } catch (e) { if (token === epoch.current) failure(e); }
    finally { locked.current = false; if (token === epoch.current) setBusy(false); }
  }
  const button = (label, onPress, disabled = false) => <TouchableOpacity accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.button, disabled && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}><TouchableOpacity accessibilityRole="button" onPress={navigation.goBack}><Text style={styles.link}>‹ 戻る</Text></TouchableOpacity><Text style={styles.heading}>運営とのやり取り</Text></View>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.note}>{asOperator ? "運営として確認・返信しています。" : "この会話はご本人と運営だけが確認できます。"} プッシュ通知をOFFにしても内容を確認できます。</Text>
        {button("会話を更新", () => load(), busy || Boolean(pending))}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!!notice && <Text accessibilityRole="alert" style={styles.note}>{notice}</Text>}
        {visible && <>
          <View style={styles.card}><Text style={styles.title}>{data.thread.mode === "test" ? "【テスト】" : ""}{data.thread.title}</Text>
            <Text style={styles.note}>{date(data.thread.createdAt)} / {data.thread.teamName}</Text><OperatorGuidanceContent body={data.thread.body} content={data.thread.content} />
            {button("操作ガイドを見る", () => openGuideUrl(SMARTBUKATSU_GUIDE_URL).catch(() => Alert.alert("開けませんでした", "通信状態を確認してください。")))}
          </View>
          {!!data.cursor && button("過去のやり取りを30件読み込む", () => load(true), busy || Boolean(pending))}
          {data.items.map((item) => <View key={item.id} style={[styles.card, item.senderRole === "operator" && styles.operator]}>
            <Text style={styles.title}>{item.senderRole === "operator" ? "運営" : asOperator ? "受信者" : "あなた"}</Text>
            <Text style={styles.note}>{date(item.createdAt)}</Text><Text selectable style={styles.text}>{item.body}</Text>
          </View>)}
          {data.thread.canReply ? <View style={styles.card}>
            <Text style={styles.title}>{asOperator ? "運営から返信" : "運営に返信"}</Text>
            <TextInput accessibilityLabel="返信内容" multiline maxLength={2000} textAlignVertical="top" style={styles.input}
              value={text} onChangeText={setText} editable={!busy && !pending} placeholder="返信内容を入力してください" />
            <Text style={styles.note}>{text.length}/2000文字</Text>
            {pending ? button("同じ返信の送信結果を確認", () => send(pending), busy) : button("返信を送信", () => send(), busy || !text.trim())}
          </View> : <Text style={styles.note}>このご案内には返信できません。</Text>}
        </>}
        {busy && <ActivityIndicator color="#0077cc" />}
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  flex: { flex: 1 }, container: { flex: 1, backgroundColor: "#f4f7f6" }, header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: "#fff" },
  heading: { fontSize: 18, fontWeight: "bold", marginLeft: 20 }, content: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: "#fff", padding: 16, borderWidth: 1, borderColor: "#dbe3eb", borderRadius: 12, marginVertical: 6 }, operator: { backgroundColor: "#edf8ff" },
  title: { color: "#18334b", fontSize: 15, fontWeight: "bold" }, text: { fontSize: 14, lineHeight: 23, color: "#334155" },
  note: { fontSize: 12, lineHeight: 20, marginVertical: 8, color: "#64748b" }, error: { color: "#b42318", marginVertical: 8 }, link: { color: "#0077cc" },
  input: { minHeight: 110, borderWidth: 1, borderColor: "#94a3b8", borderRadius: 8, padding: 12, fontSize: 16, marginTop: 12, color: "#18334b" },
  button: { padding: 12, marginVertical: 6, borderRadius: 8, backgroundColor: "#0077cc" }, buttonText: { color: "#fff", textAlign: "center", fontWeight: "bold" }, disabled: { opacity: 0.45 },
});
