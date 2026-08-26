import React from "react";
import { StyleSheet, Text, View } from "react-native";

const NOTICE_CONTENT = {
  general: {
    title: "この機能について",
    body: "この機能は状態の記録・共有を補助するものであり、医療行為、診断または治療の代替ではありません。",
    emphasis:
      "強い痛み、意識障害、呼吸困難など緊急性が疑われる場合は、アプリの操作より安全確保と緊急連絡を優先してください。",
  },
  alert: {
    title: "「危険」「受診推奨」の表示について",
    body: "この表示を含む本機能は、医療行為、診断または治療の代替ではありません。「危険」「受診推奨」は、チーム内で状態の確認を促すための目安です。アプリの数値だけで判断せず、保護者、指導者または医療機関へ相談してください。",
    emphasis:
      "強い痛み、意識障害、呼吸困難など緊急性が疑われる場合は、アプリの操作より安全確保と緊急連絡を優先してください。",
  },
  threshold: {
    title: "アラート基準について",
    body: "ここで設定する数値は医療上の診断基準ではなく、チーム内で状態を確認し、フォローを検討するための目安です。",
    emphasis:
      "アラート表示だけで、練習可否や受診の要否を判断しないでください。",
  },
};

const MedicalSafetyNotice = ({ variant = "general", style }) => {
  const content = NOTICE_CONTENT[variant] || NOTICE_CONTENT.general;
  const isAlert = variant === "alert";

  return (
    <View
      style={[
        styles.container,
        isAlert && styles.alertContainer,
        variant === "threshold" && styles.thresholdContainer,
        style,
      ]}
    >
      <Text style={[styles.title, isAlert && styles.alertTitle]}>
        {isAlert ? "⚠️ " : "ℹ️ "}
        {content.title}
      </Text>
      <Text style={styles.body}>{content.body}</Text>
      <Text style={[styles.emphasis, isAlert && styles.alertEmphasis]}>
        {content.emphasis}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f3f8fc",
    borderColor: "#b8d8ef",
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 10,
    padding: 12,
  },
  alertContainer: {
    backgroundColor: "#fff8e8",
    borderColor: "#f0c36d",
  },
  thresholdContainer: {
    marginBottom: 15,
  },
  title: {
    color: "#245b7a",
    fontSize: 13,
    fontWeight: "bold",
    marginBottom: 6,
  },
  alertTitle: {
    color: "#9a5b00",
  },
  body: {
    color: "#34495e",
    fontSize: 12,
    lineHeight: 18,
  },
  emphasis: {
    color: "#245b7a",
    fontSize: 12,
    fontWeight: "bold",
    lineHeight: 18,
    marginTop: 6,
  },
  alertEmphasis: {
    color: "#9a3b00",
  },
});

export default MedicalSafetyNotice;
