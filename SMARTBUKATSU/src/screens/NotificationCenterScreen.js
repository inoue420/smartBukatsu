import React from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNotifications } from "../NotificationContext";
import { getNotificationCategory } from "../notifications/notificationConfig";

function formatNotificationTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function NotificationCenterScreen({ navigation }) {
  const {
    notifications,
    unreadTotal,
    openNotification,
    dismissNotification,
  } = useNotifications();

  const confirmDismiss = (notification) => {
    Alert.alert("通知を削除", "この通知を通知センターから削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () =>
          dismissNotification(notification.id).catch((error) => {
            Alert.alert(
              "削除できませんでした",
              error?.message || "通信状態を確認してください。",
            );
          }),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={navigation.goBack}>
          <Text style={styles.backButtonText}>‹ 戻る</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleBox}>
          <Text style={styles.headerTitle}>通知センター</Text>
          <Text style={styles.headerSubtitle}>未読 {unreadTotal}件</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate("NotificationSettings")}
        >
          <Text style={styles.settingsButtonText}>設定</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {notifications.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyTitle}>通知はありません</Text>
            <Text style={styles.emptyText}>
              お知らせ、予定、返信などがここに表示されます。
            </Text>
          </View>
        ) : (
          notifications.map((notification) => {
            const category = getNotificationCategory(notification.category);
            const isUnread = !notification.readAt;
            return (
              <View
                key={notification.id}
                style={[styles.card, isUnread && styles.cardUnread]}
              >
                <TouchableOpacity
                  style={styles.cardMain}
                  activeOpacity={0.75}
                  onPress={() => openNotification(notification)}
                >
                  <View style={styles.iconBox}>
                    <Text style={styles.iconText}>{category.icon}</Text>
                    {isUnread && <View style={styles.unreadDot} />}
                  </View>
                  <View style={styles.cardTextBox}>
                    <View style={styles.metaRow}>
                      <Text style={styles.categoryText}>{category.label}</Text>
                      <Text style={styles.timeText}>
                        {formatNotificationTime(notification.createdAt)}
                      </Text>
                    </View>
                    <Text style={styles.titleText}>{notification.title}</Text>
                    <Text style={styles.bodyText} numberOfLines={2}>
                      {notification.body}
                    </Text>
                    {!!notification.teamName && (
                      <Text style={styles.teamText}>🏢 {notification.teamName}</Text>
                    )}
                  </View>
                </TouchableOpacity>
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.openButton}
                    onPress={() => openNotification(notification)}
                  >
                    <Text style={styles.openButtonText}>対象を開く</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => confirmDismiss(notification)}
                  >
                    <Text style={styles.deleteButtonText}>削除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f4f7f6" },
  header: {
    minHeight: 64,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backButton: { width: 72, paddingVertical: 10 },
  backButtonText: { color: "#0077cc", fontWeight: "bold", fontSize: 15 },
  headerTitleBox: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "bold", color: "#222" },
  headerSubtitle: { marginTop: 2, fontSize: 11, color: "#777" },
  settingsButton: { width: 72, alignItems: "flex-end", paddingVertical: 10 },
  settingsButtonText: { color: "#0077cc", fontWeight: "bold", fontSize: 14 },
  content: { padding: 14, paddingBottom: 40 },
  emptyCard: {
    marginTop: 60,
    padding: 28,
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
  },
  emptyIcon: { fontSize: 38 },
  emptyTitle: { marginTop: 12, fontSize: 17, fontWeight: "bold", color: "#333" },
  emptyText: { marginTop: 8, color: "#777", textAlign: "center", lineHeight: 20 },
  card: {
    marginBottom: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  cardUnread: { borderColor: "#8ecdf2", backgroundColor: "#f4fbff" },
  cardMain: { padding: 14, flexDirection: "row" },
  iconBox: { width: 42, alignItems: "center" },
  iconText: { fontSize: 24 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e74c3c",
    marginTop: 7,
  },
  cardTextBox: { flex: 1, marginLeft: 8 },
  metaRow: { flexDirection: "row", alignItems: "center" },
  categoryText: { flex: 1, color: "#0077cc", fontSize: 11, fontWeight: "bold" },
  timeText: { color: "#999", fontSize: 10 },
  titleText: { marginTop: 5, color: "#222", fontSize: 15, fontWeight: "bold" },
  bodyText: { marginTop: 5, color: "#555", fontSize: 13, lineHeight: 19 },
  teamText: { marginTop: 7, color: "#777", fontSize: 11 },
  actionRow: {
    borderTopWidth: 1,
    borderTopColor: "#edf1f4",
    flexDirection: "row",
  },
  openButton: { flex: 1, padding: 11, alignItems: "center" },
  openButtonText: { color: "#0077cc", fontWeight: "bold", fontSize: 13 },
  deleteButton: { paddingHorizontal: 20, paddingVertical: 11 },
  deleteButtonText: { color: "#999", fontSize: 13 },
});
