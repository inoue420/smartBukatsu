import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ★追加：Firestore通信用の関数とAuth情報をインポート
import { useAuth } from "../AuthContext";
import { createNotice, updateNotice } from "../services/firestoreService";

const NoticeBoardScreen = ({
  navigation,
  isAdmin,
  currentUser,
  notices,
  setNotices,
  isOffline,
  userProfiles = {},
}) => {
  const { activeTeamId } = useAuth(); // ★追加：チームIDを取得

  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");

  const canManageNotices = ["owner", "staff", "captain"].includes(userRole);

  const roleNameMap = {
    owner: "管理者(監督)",
    staff: "コーチ(スタッフ)",
    captain: `${currentUser}(キャプテン)`,
    member: currentUser, // 純粋な名前のみ
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState(null);

  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState(null);

  // ★追加：非同期処理中のローディング状態を管理するステート
  const [isSaving, setIsSaving] = useState(false);

  let filteredNotices = notices.filter((n) => {
    if (n.status === "deleted") return false;
    if (searchQuery.trim() !== "") {
      return (
        n.title.includes(searchQuery) ||
        n.content.includes(searchQuery) ||
        n.author.includes(searchQuery)
      );
    }
    return true;
  });

  filteredNotices.sort((a, b) => {
    if (a.isImportant && !b.isImportant) return -1;
    if (!a.isImportant && b.isImportant) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // ★修正：既読をつける処理を非同期化（Firestore更新）
  const handleOpenNotice = async (notice) => {
    setSelectedNotice(notice);

    if (!notice.readBy.includes(currentUser)) {
      try {
        const safeTeamId = activeTeamId || "test_team";
        const newReadBy = [...notice.readBy, currentUser];

        // データベースに既読を記録
        await updateNotice(safeTeamId, notice.id, { readBy: newReadBy });

        // 画面の見た目も更新
        const updatedNotices = notices.map((n) =>
          n.id === notice.id ? { ...n, readBy: newReadBy } : n,
        );
        setNotices(updatedNotices);
      } catch (error) {
        console.log("既読の更新に失敗:", error);
      }
    }
  };

  // ★修正：非同期処理（async/await）とローディングUIの実装
  const handleSaveNotice = async () => {
    if (newTitle.trim() === "" || newContent.trim() === "") {
      Alert.alert("エラー", "タイトルと本文を入力してください。");
      return;
    }

    setIsSaving(true); // 通信開始（ボタンをローディング状態にする）
    try {
      const safeTeamId = activeTeamId || "test_team";

      if (editingNoticeId) {
        // ✏️ 編集の非同期処理
        await updateNotice(safeTeamId, editingNoticeId, {
          title: newTitle.trim(),
          content: newContent.trim(),
          isImportant: isImportant,
        });

        // 画面上のリストを更新（ステップ3で不要になります）
        const updatedNotices = notices.map((n) =>
          n.id === editingNoticeId
            ? { ...n, title: newTitle, content: newContent, isImportant }
            : n,
        );
        setNotices(updatedNotices);
        Alert.alert("修正完了", "お知らせを更新しました。");
      } else {
        // 🆕 新規作成の非同期処理
        const today = new Date();
        const dateString = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

        const newNotice = {
          title: newTitle.trim(),
          content: newContent.trim(),
          author: displayUserName,
          date: dateString,
          isImportant: isImportant,
          readBy: [currentUser],
          status: isOffline ? "pending" : "active",
        };

        // Firestoreへ保存
        await createNotice(safeTeamId, newNotice);

        // 画面上のリストを更新（ダミーID付与。ステップ3で不要になります）
        setNotices([
          { ...newNotice, id: "notice_" + Date.now(), createdAt: Date.now() },
          ...notices,
        ]);
      }

      setIsCreateModalVisible(false);
      resetForm();
    } catch (error) {
      console.error(error);
      Alert.alert("エラー", "保存に失敗しました。");
    } finally {
      setIsSaving(false); // 通信終了（ボタンを元の状態に戻す）
      Keyboard.dismiss();
    }
  };

  // ★修正：削除処理を非同期化（Firestore更新）
  const handleDeleteNotice = (noticeId) => {
    Alert.alert(
      "削除の確認",
      "このお知らせを削除しますか？\n（データはゴミ箱に保持されます）",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除",
          style: "destructive",
          onPress: async () => {
            try {
              const safeTeamId = activeTeamId || "test_team";
              // Firestoreのステータスをdeletedに更新
              await updateNotice(safeTeamId, noticeId, {
                status: "deleted",
                deletedBy: displayUserName,
              });

              // 画面上のリストを更新
              const updatedNotices = notices.map((n) =>
                n.id === noticeId ? { ...n, status: "deleted" } : n,
              );
              setNotices(updatedNotices);
              setSelectedNotice(null);
            } catch (error) {
              Alert.alert("エラー", "削除に失敗しました。");
            }
          },
        },
      ],
    );
  };

  const openEditModal = (notice) => {
    setEditingNoticeId(notice.id);
    setNewTitle(notice.title);
    setNewContent(notice.content);
    setIsImportant(notice.isImportant);
    setSelectedNotice(null);
    setIsCreateModalVisible(true);
  };

  const resetForm = () => {
    setEditingNoticeId(null);
    setNewTitle("");
    setNewContent("");
    setIsImportant(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, isOffline && styles.headerOffline]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>◁ ホーム</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isOffline ? "オフライン表示中" : "📋 掲示板"}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            現在オフラインです。投稿は通信復旧時に送信されます。
          </Text>
        </View>
      )}

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="お知らせを検索..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView
        style={styles.listContainer}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {filteredNotices.length === 0 ? (
          <Text style={styles.emptyText}>お知らせはありません。</Text>
        ) : (
          filteredNotices.map((notice) => {
            const isUnread = !notice.readBy.includes(currentUser);
            const isPending = notice.status === "pending";

            return (
              <TouchableOpacity
                key={notice.id}
                style={[
                  styles.card,
                  notice.isImportant && styles.importantCard,
                  isPending && styles.pendingCard,
                ]}
                activeOpacity={0.8}
                onPress={() => handleOpenNotice(notice)}
              >
                {isPending && (
                  <Text style={styles.pendingText}>🕒 送信待機中</Text>
                )}
                <View style={styles.cardHeader}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      flex: 1,
                    }}
                  >
                    {notice.isImportant && (
                      <Text style={styles.importantBadge}>重要</Text>
                    )}
                    <Text
                      style={[styles.cardTitle, isUnread && styles.unreadText]}
                      numberOfLines={1}
                    >
                      {notice.title}
                    </Text>
                  </View>
                  {isUnread && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.cardContent} numberOfLines={2}>
                  {notice.content}
                </Text>
                <View style={styles.cardFooter}>
                  <Text style={styles.cardAuthor}>✍️ {notice.author}</Text>
                  <Text style={styles.cardDate}>{notice.date}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {canManageNotices && (
        <TouchableOpacity
          style={[styles.fab, isOffline && { backgroundColor: "#f39c12" }]}
          onPress={() => {
            resetForm();
            setIsCreateModalVisible(true);
          }}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={selectedNotice !== null}
        transparent={true}
        animationType="fade"
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.detailContainer}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setSelectedNotice(null)}>
                <Text style={styles.closeBtn}>✕ 閉じる</Text>
              </TouchableOpacity>
              <Text style={styles.detailHeaderTitle}>お知らせ詳細</Text>
              <View style={{ width: 60 }} />
            </View>

            {selectedNotice && (
              <ScrollView style={styles.detailScroll}>
                <View style={styles.detailContentBox}>
                  {selectedNotice.isImportant && (
                    <Text style={styles.importantBadgeLarge}>
                      🚨 重要なお知らせ
                    </Text>
                  )}
                  <Text style={styles.detailTitle}>{selectedNotice.title}</Text>

                  <View style={styles.detailMetaRow}>
                    <Text style={styles.detailAuthor}>
                      ✍️ {selectedNotice.author}
                    </Text>
                    <Text style={styles.detailDate}>{selectedNotice.date}</Text>
                  </View>

                  <Text style={styles.detailBody}>
                    {selectedNotice.content}
                  </Text>

                  <View style={styles.readByContainer}>
                    <Text style={styles.readByText}>
                      👁️ 既読: {selectedNotice.readBy.length}人
                    </Text>
                  </View>
                </View>

                {canManageNotices &&
                  (selectedNotice.author === displayUserName ||
                    ["owner", "staff"].includes(userRole)) && (
                    <View style={styles.adminActionRow}>
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => openEditModal(selectedNotice)}
                      >
                        <Text style={styles.editBtnText}>✏️ 修正する</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => handleDeleteNotice(selectedNotice.id)}
                      >
                        <Text style={styles.deleteBtnText}>🗑 削除する</Text>
                      </TouchableOpacity>
                    </View>
                  )}
              </ScrollView>
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
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            <View style={styles.createContainer}>
              <View style={styles.detailHeader}>
                <TouchableOpacity
                  onPress={() => setIsCreateModalVisible(false)}
                  disabled={isSaving} // 通信中は閉じられないようにする
                >
                  <Text
                    style={[styles.closeBtn, isSaving && { color: "#aaa" }]}
                  >
                    キャンセル
                  </Text>
                </TouchableOpacity>
                <Text style={styles.detailHeaderTitle}>
                  {editingNoticeId ? "お知らせの修正" : "新規お知らせ作成"}
                </Text>
                <View style={{ width: 60 }} />
              </View>

              <ScrollView style={styles.createScroll}>
                <Text style={styles.inputLabel}>タイトル</Text>
                <TextInput
                  style={styles.inputSingle}
                  placeholder="例: 明日の練習時間について"
                  value={newTitle}
                  onChangeText={setNewTitle}
                  editable={!isSaving}
                />

                <Text style={styles.inputLabel}>本文</Text>
                <TextInput
                  style={styles.inputMulti}
                  placeholder="連絡事項を入力してください..."
                  value={newContent}
                  onChangeText={setNewContent}
                  multiline
                  editable={!isSaving}
                />

                <TouchableOpacity
                  style={[
                    styles.importantToggle,
                    isImportant && styles.importantToggleActive,
                  ]}
                  onPress={() => !isSaving && setIsImportant(!isImportant)}
                  disabled={isSaving}
                >
                  <Text
                    style={[
                      styles.importantToggleText,
                      isImportant && styles.importantToggleTextActive,
                    ]}
                  >
                    {isImportant
                      ? "🚨 重要なお知らせに設定中"
                      : "通常のお知らせとして投稿"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    isOffline && { backgroundColor: "#f39c12" },
                    isSaving && { opacity: 0.7 }, // 送信中は半透明に
                  ]}
                  onPress={handleSaveNotice}
                  disabled={isSaving} // 送信中は押せないようにする（連打防止）
                >
                  {isSaving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {editingNoticeId
                        ? "修正を保存"
                        : isOffline
                          ? "待機リストに保存"
                          : "チームに送信"}
                    </Text>
                  )}
                </TouchableOpacity>
                <View style={{ height: 50 }} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#2980b9",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  headerOffline: { backgroundColor: "#7f8c8d" },
  backButton: { width: 60 },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  headerRight: { width: 60 },

  offlineBanner: {
    backgroundColor: "#f39c12",
    padding: 8,
    alignItems: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },

  searchContainer: {
    padding: 15,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  searchInput: {
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },

  listContainer: { padding: 15 },
  emptyText: { textAlign: "center", color: "#888", marginTop: 50 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: "#3498db",
  },
  importantCard: { borderLeftColor: "#e74c3c", backgroundColor: "#fffafa" },
  pendingCard: {
    opacity: 0.7,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#f39c12",
  },
  pendingText: {
    color: "#f39c12",
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 8,
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  importantBadge: {
    backgroundColor: "#e74c3c",
    color: "#fff",
    fontSize: 10,
    fontWeight: "bold",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
    overflow: "hidden",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
    paddingRight: 10,
  },
  unreadText: { color: "#000" },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#e74c3c",
  },

  cardContent: {
    fontSize: 14,
    color: "#666",
    lineHeight: 20,
    marginBottom: 12,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardAuthor: { fontSize: 12, color: "#888", fontWeight: "bold" },
  cardDate: { fontSize: 12, color: "#aaa" },

  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    backgroundColor: "#2980b9",
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
  },
  fabIcon: { fontSize: 30, color: "#fff", fontWeight: "bold" },

  modalSafeArea: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  detailContainer: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    marginTop: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  createContainer: {
    flex: 1,
    backgroundColor: "#fff",
    marginTop: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  detailHeaderTitle: { fontSize: 16, fontWeight: "bold", color: "#333" },
  closeBtn: { fontSize: 16, color: "#2980b9", fontWeight: "bold" },

  detailScroll: { padding: 15 },
  detailContentBox: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 1,
  },
  importantBadgeLarge: {
    color: "#e74c3c",
    fontWeight: "bold",
    fontSize: 14,
    marginBottom: 10,
  },
  detailTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
  },
  detailMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 10,
    marginBottom: 15,
  },
  detailAuthor: { fontSize: 13, color: "#555", fontWeight: "bold" },
  detailDate: { fontSize: 13, color: "#888" },
  detailBody: { fontSize: 16, color: "#333", lineHeight: 26, minHeight: 150 },
  readByContainer: {
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  readByText: { fontSize: 12, color: "#888", textAlign: "right" },

  adminActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 30,
  },
  editBtn: {
    backgroundColor: "#f39c12",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginRight: 10,
  },
  editBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  deleteBtn: {
    backgroundColor: "#e74c3c",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  deleteBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },

  createScroll: { padding: 20 },
  inputLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
    marginTop: 10,
  },
  inputSingle: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  inputMulti: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 150,
    textAlignVertical: "top",
  },
  importantToggle: {
    marginTop: 20,
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
  },
  importantToggleActive: {
    backgroundColor: "#fff5f5",
    borderColor: "#e74c3c",
  },
  importantToggleText: { fontSize: 14, color: "#666", fontWeight: "bold" },
  importantToggleTextActive: { color: "#e74c3c" },

  submitButton: {
    backgroundColor: "#2980b9",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 30,
    height: 50,
  },
  submitButtonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});

export default NoticeBoardScreen;
