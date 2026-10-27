import React, { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { listOperatorGuidanceInbox } from "../services/operatorGuidanceService";

const date = (value) => value ? new Date(value).toLocaleString("ja-JP") : "日時不明";
export default function OperatorGuidanceInboxScreen({ navigation }) {
  const { user } = useAuth(), uid = user?.uid;
  const [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const epoch = useRef(0), locked = useRef(false);
  const visible = data?.uid === uid;
  useFocusEffect(useCallback(() => {
    const token = ++epoch.current;
    setData(null); setError(""); setBusy(true);
    listOperatorGuidanceInbox(uid).then((page) => { if (token === epoch.current) setData({ uid, ...page }); })
      .catch((e) => { if (token === epoch.current) setError(e?.message || "取得できませんでした。"); })
      .finally(() => { if (token === epoch.current) setBusy(false); });
    return () => { epoch.current += 1; };
  }, [uid]));
  async function load(refresh = false) {
    if (locked.current || busy) return;
    const token = epoch.current;
    locked.current = true; setBusy(true); setError("");
    try {
      const page = await listOperatorGuidanceInbox(uid, refresh ? null : data?.cursor);
      if (token === epoch.current) setData((old) => ({ uid, ...page, items: refresh ? page.items : [...new Map([...(old?.items || []), ...page.items].map((item) => [item.id, item])).values()] }));
    } catch (e) {
      if (token === epoch.current) { setError(e?.message || "取得できませんでした。"); if (String(e?.code).includes("permission-denied")) setData(null); }
    } finally { locked.current = false; if (token === epoch.current) setBusy(false); }
  }
  const button = (label, onPress) => <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onPress} style={styles.button}><Text style={styles.buttonText}>{label}</Text></TouchableOpacity>;
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}><TouchableOpacity accessibilityRole="button" onPress={navigation.goBack}><Text style={styles.link}>‹ 戻る</Text></TouchableOpacity><Text style={styles.heading}>運営とのやり取り</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.note}>運営から届いたご案内と返信を確認できます。通知をOFFにしていても、ここから内容を確認できます。返信はご本人と運営だけが確認できます。</Text>
      {button("一覧を更新", () => load(true))}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {visible && !data.items.length && <Text style={styles.note}>届いているご案内はありません。</Text>}
      {visible && data.items.map((item) => <TouchableOpacity key={item.id} accessibilityRole="button" style={styles.card}
        onPress={() => navigation.navigate("OperatorGuidanceConversation", { historyId: item.id })}>
        <Text style={styles.title}>{item.mode === "test" ? "【テスト】" : ""}{item.title}</Text>
        <Text style={styles.note}>{date(item.createdAt)}{item.teamName ? ` / ${item.teamName}` : ""}</Text>
        <Text style={styles.text} numberOfLines={2}>{item.body}</Text>
        <Text style={styles.link}>内容を確認・返信する</Text>
        {item.messageCount > 0 && <Text style={styles.note}>やり取り {item.messageCount}件 / 最終更新 {date(item.lastMessageAt)} / {item.lastMessageRole === "operator" ? "運営からの返信" : "あなたの返信"}</Text>}
      </TouchableOpacity>)}
      {visible && !!data.cursor && button("過去のご案内を20件読み込む", () => load())}
      {busy && <ActivityIndicator color="#0077cc" />}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f4f7f6" }, header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: "#fff" },
  heading: { fontSize: 18, fontWeight: "bold", marginLeft: 20 }, content: { padding: 16, paddingBottom: 40 },
  card: { padding: 16, marginVertical: 6, borderRadius: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#dbe3eb" },
  title: { fontSize: 16, fontWeight: "bold", color: "#18334b" }, text: { fontSize: 14, lineHeight: 22, color: "#334155" },
  note: { fontSize: 12, lineHeight: 20, color: "#64748b", marginVertical: 8 }, link: { color: "#0077cc", marginVertical: 8 }, error: { color: "#b42318", marginVertical: 8 },
  button: { padding: 12, marginVertical: 6, borderRadius: 8, backgroundColor: "#0077cc" }, buttonText: { color: "#fff", fontWeight: "bold", textAlign: "center" },
});
