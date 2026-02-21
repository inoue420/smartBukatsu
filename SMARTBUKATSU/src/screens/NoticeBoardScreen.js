import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Modal,
  Alert,
} from "react-native";

// ★修正：clubMembers を受け取る
const NoticeBoardScreen = ({
  navigation,
  isAdmin,
  currentUser,
  notices,
  setNotices,
  isOffline,
  toggleNetworkStatus,
  clubMembers,
}) => {
  const [selectedNotice, setSelectedNotice] = useState(null);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");

  const handleCreateNotice = () => {
    if (newTitle.trim() === "" || newContent.trim() === "") {
      Alert.alert("エラー", "タイトルと本文を入力してください。");
      return;
    }
    const newNotice = {
      id: Date.now().toString(),
      title: newTitle,
      content: newContent,
      author: isAdmin ? "管理者(監督)" : `${currentUser}(あなた)`,
      date: "たった今",
      readBy: [],
      status: isOffline ? "pending" : "sent",
    };
    setNotices([newNotice, ...notices]);
    setIsCreateModalVisible(false);
    setNewTitle("");
    setNewContent("");
  };

  const handleDeleteNotice = (id) => {
    Alert.alert("削除の確認", "この連絡を削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除する",
        style: "destructive",
        onPress: () => {
          setNotices(notices.filter((n) => n.id !== id));
          setSelectedNotice(null);
        },
      },
    ]);
  };

  const handleConfirmRead = (noticeId) => {
    if (isOffline) {
      Alert.alert(
        "通信エラー",
        "現在オフラインのため、確認操作を送信できません。オンラインになってから再度お試しください。",
      );
      return;
    }
    const updatedNotices = notices.map((notice) => {
      if (notice.id === noticeId) {
        return { ...notice, readBy: [...notice.readBy, currentUser] };
      }
      return notice;
    });
    setNotices(updatedNotices);
    setSelectedNotice(updatedNotices.find((n) => n.id === noticeId));
  };

  const totalMembers = clubMembers.length; // ★修正：全メンバー数を計算

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, isOffline && styles.headerOffline]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>◁ 戻る</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>
          {isOffline ? "オフライン表示中" : "重要連絡 (掲示板)"}
        </Text>

        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.navBtn} onPress={toggleNetworkStatus}>
            <Text style={styles.navIcon}>{isOffline ? "🚫" : "🌐"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={() =>
              navigation.reset({ index: 0, routes: [{ name: "Login" }] })
            }
          >
            <Text style={styles.logoutBtnText}>ログアウト</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            現在オフラインです。一部の操作が制限されます。
          </Text>
        </View>
      )}

      <ScrollView style={styles.content}>
        {notices.map((notice) => {
          const readCount = notice.readBy.length;
          // 全メンバー数が0の場合は100%にする等のエラー回避
          const progressPercent =
            totalMembers === 0 ? 0 : (readCount / totalMembers) * 100;
          const isReadByMe = notice.readBy.includes(currentUser);
          const isPending = notice.status === "pending";

          return (
            <TouchableOpacity
              key={notice.id}
              style={[styles.card, isPending && styles.pendingCard]}
              activeOpacity={0.8}
              onPress={() => setSelectedNotice(notice)}
            >
              {isPending && (
                <View style={styles.pendingHeader}>
                  <Text style={styles.pendingHeaderText}>
                    🕒 送信待機中（オフライン）
                  </Text>
                </View>
              )}

              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{notice.title}</Text>
                {!isAdmin && !isPending && (
                  <View
                    style={[
                      styles.statusBadge,
                      isReadByMe ? styles.badgeRead : styles.badgeUnread,
                    ]}
                  >
                    <Text style={styles.statusBadgeText}>
                      {isReadByMe ? "✅ 既読" : "🔴 未読"}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.cardMeta}>
                {isPending ? "待機中..." : notice.date} • {notice.author}
              </Text>

              {!isPending && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressText}>確認状況</Text>
                    <Text style={styles.progressText}>
                      {readCount} / {totalMembers}人
                    </Text>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${progressPercent}%` },
                        progressPercent === 100 && {
                          backgroundColor: "#5cb85c",
                        },
                      ]}
                    />
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {isAdmin && (
        <TouchableOpacity
          style={[styles.fab, isOffline && { backgroundColor: "#f39c12" }]}
          onPress={() => setIsCreateModalVisible(true)}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={selectedNotice !== null}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.detailContainer}>
            {selectedNotice && (
              <>
                <View style={styles.detailHeader}>
                  <TouchableOpacity onPress={() => setSelectedNotice(null)}>
                    <Text style={styles.closeBtn}>✕ 閉じる</Text>
                  </TouchableOpacity>
                  {isAdmin && (
                    <TouchableOpacity
                      onPress={() => handleDeleteNotice(selectedNotice.id)}
                    >
                      <Text style={styles.deleteBtn}>🗑 削除</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <ScrollView style={styles.detailScroll}>
                  {selectedNotice.status === "pending" && (
                    <Text
                      style={[styles.pendingHeaderText, { marginBottom: 10 }]}
                    >
                      🕒 この連絡は送信待機中です
                    </Text>
                  )}
                  <Text style={styles.detailTitle}>{selectedNotice.title}</Text>
                  <Text style={styles.detailMeta}>
                    {selectedNotice.status === "pending"
                      ? "待機中..."
                      : selectedNotice.date}{" "}
                    • {selectedNotice.author}
                  </Text>
                  <View style={styles.detailContentBox}>
                    <Text style={styles.detailContent}>
                      {selectedNotice.content}
                    </Text>
                  </View>

                  {isAdmin ? (
                    <View style={styles.adminStatusArea}>
                      <Text style={styles.adminStatusTitle}>
                        📊 確認状況詳細 ({selectedNotice.readBy.length}/
                        {totalMembers})
                      </Text>
                      <View style={styles.statusListRow}>
                        <View style={styles.statusColumn}>
                          <Text
                            style={[
                              styles.statusListHeader,
                              { color: "#d9534f" },
                            ]}
                          >
                            🔴 未読者
                          </Text>
                          {/* ★修正：clubMembersを使用 */}
                          {clubMembers
                            .filter((m) => !selectedNotice.readBy.includes(m))
                            .map((m) => (
                              <Text key={m} style={styles.statusName}>
                                ・{m}
                              </Text>
                            ))}
                          {clubMembers.filter(
                            (m) => !selectedNotice.readBy.includes(m),
                          ).length === 0 && (
                            <Text style={styles.statusNameEmpty}>
                              全員確認済みです🎉
                            </Text>
                          )}
                        </View>
                        <View style={styles.statusColumn}>
                          <Text
                            style={[
                              styles.statusListHeader,
                              { color: "#5cb85c" },
                            ]}
                          >
                            ✅ 確認済み
                          </Text>
                          {selectedNotice.readBy.map((m) => (
                            <Text key={m} style={styles.statusName}>
                              ・{m}
                            </Text>
                          ))}
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.memberActionArea}>
                      {selectedNotice.readBy.includes(currentUser) ? (
                        <View style={styles.confirmedBox}>
                          <Text style={styles.confirmedText}>
                            ✅ 内容を確認しました
                          </Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.confirmButton,
                            isOffline && { backgroundColor: "#aaa" },
                          ]}
                          onPress={() => handleConfirmRead(selectedNotice.id)}
                        >
                          <Text style={styles.confirmButtonText}>
                            ✅ 確認しました
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={isCreateModalVisible}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.createContainer}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setIsCreateModalVisible(false)}>
                <Text style={styles.closeBtn}>✕ キャンセル</Text>
              </TouchableOpacity>
              <Text style={styles.createHeaderTitle}>
                {isOffline ? "新規連絡(待機)" : "新規連絡の作成"}
              </Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView style={styles.createScroll}>
              <Text style={styles.inputLabel}>タイトル</Text>
              <TextInput
                style={styles.titleInput}
                placeholder="例: 夏季合宿のスケジュール"
                value={newTitle}
                onChangeText={setNewTitle}
              />
              <Text style={styles.inputLabel}>本文</Text>
              <TextInput
                style={styles.contentInput}
                placeholder="連絡事項を詳しく入力してください"
                value={newContent}
                onChangeText={setNewContent}
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity
                style={[
                  styles.submitButton,
                  isOffline && { backgroundColor: "#f39c12" },
                ]}
                onPress={handleCreateNotice}
              >
                <Text style={styles.submitButtonText}>
                  {isOffline ? "待機リストに入れる" : "掲示板に投稿する"}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#34495e",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  headerOffline: { backgroundColor: "#7f8c8d" },
  backButton: { position: "absolute", left: 15, zIndex: 10 },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  headerRight: { flexDirection: "row", alignItems: "center" },
  navBtn: { marginRight: 15 },
  navIcon: { fontSize: 20 },
  logoutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: "#e74c3c",
  },
  logoutBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  offlineBanner: {
    backgroundColor: "#f39c12",
    padding: 8,
    alignItems: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  content: { padding: 15 },
  card: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    elevation: 2,
  },
  pendingCard: {
    opacity: 0.6,
    backgroundColor: "#fdfdfd",
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#ccc",
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  pendingHeaderText: { color: "#e67e22", fontSize: 12, fontWeight: "bold" },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 5,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
    marginRight: 10,
  },
  statusBadge: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12 },
  badgeUnread: { backgroundColor: "#ffebee" },
  badgeRead: { backgroundColor: "#e8f5e9" },
  statusBadgeText: { fontSize: 12, fontWeight: "bold", color: "#333" },
  cardMeta: { fontSize: 12, color: "#888", marginBottom: 15 },
  progressContainer: {
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  progressText: { fontSize: 12, color: "#555", fontWeight: "bold" },
  progressBarBg: {
    height: 8,
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#0077cc",
    borderRadius: 4,
  },
  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    backgroundColor: "#e67e22",
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
  },
  fabIcon: { fontSize: 30, color: "#fff", fontWeight: "bold" },
  modalSafeArea: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  detailContainer: {
    flex: 1,
    backgroundColor: "#fff",
    marginTop: 50,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
  },
  closeBtn: { fontSize: 16, color: "#0077cc", fontWeight: "bold" },
  deleteBtn: { fontSize: 16, color: "#d9534f", fontWeight: "bold" },
  detailScroll: { padding: 20 },
  detailTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
  },
  detailMeta: { fontSize: 14, color: "#888", marginBottom: 20 },
  detailContentBox: {
    backgroundColor: "#f9f9f9",
    padding: 15,
    borderRadius: 10,
    marginBottom: 30,
  },
  detailContent: { fontSize: 16, color: "#444", lineHeight: 24 },
  adminStatusArea: { marginTop: 10, paddingBottom: 50 },
  adminStatusTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
  },
  statusListRow: { flexDirection: "row", justifyContent: "space-between" },
  statusColumn: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    padding: 10,
    marginHorizontal: 5,
  },
  statusListHeader: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 5,
  },
  statusName: { fontSize: 14, color: "#555", marginBottom: 5 },
  statusNameEmpty: {
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 10,
  },
  memberActionArea: { marginTop: 10, paddingBottom: 50 },
  confirmButton: {
    backgroundColor: "#e67e22",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    elevation: 2,
  },
  confirmButtonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  confirmedBox: {
    backgroundColor: "#e8f5e9",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#5cb85c",
  },
  confirmedText: { color: "#5cb85c", fontSize: 16, fontWeight: "bold" },
  createContainer: {
    flex: 1,
    backgroundColor: "#fff",
    marginTop: 50,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  createHeaderTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  createScroll: { padding: 20 },
  inputLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 8,
  },
  titleInput: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  contentInput: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    height: 200,
    marginBottom: 30,
  },
  submitButton: {
    backgroundColor: "#e67e22",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});

export default NoticeBoardScreen;
