import React from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { SMARTBUKATSU_GUIDE_URL } from "../constants/helpLinks";
import { openGuideUrl } from "../utils/openGuide";

const topics = new Set(["members", "calendar", "communication", "video-clip", "tactics"]);
export default function OperatorGuidanceContent({ title, body, content }) {
  const linked = content && typeof content.introduction === "string" && typeof content.closing === "string" &&
    Array.isArray(content.features) && content.features.length === 5 && content.features.every((feature) => topics.has(feature.topic) && typeof feature.label === "string");
  const open = (topic) => openGuideUrl(`${SMARTBUKATSU_GUIDE_URL}#${topic}`).catch(() => Alert.alert("開けませんでした", "通信状態を確認してください。"));
  return <View>
    {!!title && <Text style={styles.title}>{title}</Text>}
    {linked ? <>
      {!!content.introduction && <Text selectable style={styles.text}>{content.introduction}</Text>}
      <View style={styles.features}>{content.features.map((feature) => <View key={feature.topic}>
        <Text accessibilityRole="link" accessibilityHint="公式サイトの操作説明を開きます" onPress={() => open(feature.topic)} style={styles.link}>・{feature.label}</Text>
        {feature.topic === "members" && <Text accessibilityRole="link" onPress={() => open("permissions")} style={styles.related}>権限設定の説明</Text>}
      </View>)}</View>
      {!!content.closing && <Text selectable style={styles.text}>{content.closing}</Text>}
    </> : <Text selectable style={styles.text}>{body}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "bold", color: "#18334b", marginBottom: 6 }, text: { fontSize: 14, lineHeight: 22, color: "#334155" },
  features: { marginVertical: 12 }, link: { color: "#0077cc", textDecorationLine: "underline", fontSize: 14, lineHeight: 22, paddingVertical: 8 },
  related: { color: "#0077cc", textDecorationLine: "underline", fontSize: 13, paddingLeft: 14, paddingVertical: 8 },
});
