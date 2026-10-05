import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";

export default function HistoryLoadingControls({ history, search = false, label = "過去の履歴を追加読み込み" }) {
  if (!history) return null;
  return <View style={{ padding: 12, alignItems: "center", gap: 8 }}>
    {!!history.error && <Text accessibilityRole="alert" style={{ color: "#b42318" }}>{history.error}</Text>}
    {history.busy && <ActivityIndicator color="#0077cc" />}
    {history.scanned > 0 && history.busy && <Text>過去履歴を確認中：{history.scanned}件</Text>}
    {!history.all && search && <TouchableOpacity disabled={history.busy} onPress={history.searchAll}><Text style={{ color: "#0077cc", padding: 8 }}>過去の履歴も検索する</Text></TouchableOpacity>}
    {!history.busy && history.hasMore && <TouchableOpacity onPress={history.loadMore}><Text style={{ color: "#0077cc", padding: 8 }}>{label}</Text></TouchableOpacity>}
    {history.searching && <TouchableOpacity onPress={history.cancel}><Text style={{ color: "#666", padding: 8 }}>検索を中止</Text></TouchableOpacity>}
    {!!history.error && <TouchableOpacity onPress={history.retry}><Text style={{ color: "#0077cc", padding: 8 }}>再試行</Text></TouchableOpacity>}
    {history.all && !history.busy && <TouchableOpacity onPress={history.reset}><Text style={{ color: "#666", padding: 8 }}>最近の表示に戻る</Text></TouchableOpacity>}
  </View>;
}
