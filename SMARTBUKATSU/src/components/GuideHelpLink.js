import React from "react";
import { Alert, StyleSheet, Text, TouchableOpacity } from "react-native";
import { openGuideUrl } from "../utils/openGuide";
import {
  SMARTBUKATSU_GUIDE_TOPICS,
  SMARTBUKATSU_GUIDE_URL,
} from "../constants/helpLinks";

export default function GuideHelpLink({ topic, light = false, style }) {
  const title = SMARTBUKATSU_GUIDE_TOPICS[topic];
  const url = title
    ? `${SMARTBUKATSU_GUIDE_URL}#${topic}`
    : SMARTBUKATSU_GUIDE_URL;

  const openGuide = async () => {
    try {
      await openGuideUrl(url);
    } catch {
      Alert.alert(
        "操作ガイドを開けません",
        "通信環境をご確認のうえ、もう一度お試しください。",
      );
    }
  };

  return (
    <TouchableOpacity
      accessibilityRole="link"
      accessibilityLabel={`${title || "操作ガイド"}の使い方`}
      accessibilityHint="公式サイトの手順をブラウザーで開きます"
      style={[styles.link, light && styles.lightLink, style]}
      onPress={openGuide}
      activeOpacity={0.7}
    >
      <Text style={[styles.text, light && styles.lightText]}>？ 使い方</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  link: {
    alignSelf: "flex-end",
    minWidth: 64,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#b6d5ec",
    borderRadius: 8,
    backgroundColor: "#edf6fd",
  },
  lightLink: {
    alignSelf: "center",
    borderColor: "#a8bfce",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  text: { color: "#12558a", fontSize: 12, fontWeight: "bold" },
  lightText: { color: "#fff" },
});
