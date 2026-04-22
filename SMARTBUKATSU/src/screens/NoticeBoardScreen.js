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

// ★ Firestore通信関数をインポート
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
  const { activeTeamId } = useAuth();

  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");

  const canManageNotices = ["owner", "admin", "staff", "captain"].includes(
    userRole,
  );

  const roleNameMap = {
    owner: "管理者(監督)",
    admin: "管理者",
    staff: "コーチ(スタッフ)",
    captain: `${currentUser}(キャプテン)`,
    member: currentUser,
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState(null);

  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  const [editingNoticeId, setEditingNoticeId] = useState(null);

  const [isSaving, setIsSaving] = useState(false);

  const [readByListVisible, setReadByListVisible] = useState(false);
  const [currentReadByList, setCurrentReadByList] = useState([]);

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
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });

  const handleOpenNotice = async (notice) => {
    setSelectedNotice(notice);
  };

  const handleConfirmNotice = async (notice) => {
    if (notice.readBy.includes(currentUser)) return;

    const newReadBy = [...notice.readBy, currentUser];

    const updatedNotices = notices.map((n) =>
      n.id === notice.id ? { ...n, readBy: newReadBy } : n,
    );
    setNotices(updatedNotices);

    if (selectedNotice && selectedNotice.id === notice.id) {
      setSelectedNotice({ ...selectedNotice, readBy: newReadBy });
    }

    try {
      if (activeTeamId) {
        await updateNotice(activeTeamId, notice.id, { readBy: newReadBy });
      }
    } catch (error) {
      console.log("Firestore更新エラー（確認ボタン）", error);
    }
  };

  const handleSaveNotice = async () => {
    if (newTitle.trim() === "" || newContent.trim() === "") {
      Alert.alert("エラー", "タイトルと本文を入力してください。");
      return;
    }

    setIsSaving(true);

    try {
      const safeTeamId = activeTeamId || "test_team";

      if (editingNoticeId) {
        const updatedNotices = notices.map((n) =>
          n.id === editingNoticeId
            ? {
                ...n,
                title: newTitle.trim(),
                content: newContent.trim(),
                isImportant,
              }
            : n,
        );
        setNotices(updatedNotices);

        await updateNotice(safeTeamId, editingNoticeId, {
          title: newTitle.trim(),
          content: newContent.trim(),
          isImportant: isImportant,
        });

        Alert.alert("修正完了", "お知らせを更新しました。");
      } else {
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

        setNotices([
          { ...newNotice, id: "notice_" + Date.now(), createdAt: Date.now() },
          ...notices,
        ]);

        await createNotice(safeTeamId, newNotice);
      }
    } catch (error) {
      console.log("Firestore保存エラー（新規/更新）", error);
    } finally {
      setIsCreateModalVisible(false);
      resetForm();
      setIsSaving(false);
      Keyboard.dismiss();
    }
  };

  const handleDeleteNotice = (noticeId) => {
    Alert.alert("削除の確認", "このお知らせを削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          const updatedNotices = notices.map((n) =>
            n.id === noticeId ? { ...n, status: "deleted" } : n,
          );
          setNotices(updatedNotices);
          setSelectedNotice(null);

          try {
            if (activeTeamId) {
              await updateNotice(activeTeamId, noticeId, {
                status: "deleted",
                deletedBy: displayUserName,
              });
            }
          } catch (error) {
            console.log("Firestore削除エラー", error);
          }
        },
      },
    ]);
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
            const isConfirmed = notice.readBy.includes(currentUser);
            const isPending = notice.status === "pending";

            return (
              <TouchableOpacity
                key={notice.id}
                style={[
                  styles.card,
                  notice.isImportant && styles.importantCard,
                  isPending && styles.pendingCard,
                  !isConfirmed && styles.unconfirmedCard,
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
                      style={[
                        styles.cardTitle,
                        !isConfirmed && styles.unreadText,
                      ]}
                      numberOfLines={1}
                    >
                      {notice.title}
                    </Text>
                  </View>
                  {!isConfirmed && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.cardContent} numberOfLines={2}>
                  {notice.content}
                </Text>

                <View style={styles.cardFooter}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardAuthor}>✍️ {notice.author}</Text>
                    <Text style={styles.cardDate}>{notice.date}</Text>
                  </View>

                  {isConfirmed ? (
                    <View style={styles.confirmedBadge}>
                      <Text style={styles.confirmedBadgeText}>✓ 確認済み</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={styles.confirmButtonSmall}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleConfirmNotice(notice);
                      }}
                    >
                      <Text style={styles.confirmButtonTextSmall}>
                        確認しました
                      </Text>
                    </TouchableOpacity>
                  )}
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
              <TouchableOpacity
                onPress={() => {
                  setSelectedNotice(null);
                  setReadByListVisible(false); // 詳細を閉じるときにリストも閉じる
                }}
              >
                <Text style={styles.closeBtn}>◁ 戻る</Text>
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
                    {selectedNotice.readBy.includes(currentUser) ? (
                      <View style={styles.confirmedBadgeLarge}>
                        <Text style={styles.confirmedBadgeTextLarge}>
                          ✅ 確認済み
                        </Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.confirmButtonLarge}
                        onPress={() => handleConfirmNotice(selectedNotice)}
                      >
                        <Text style={styles.confirmButtonTextLarge}>
                          確認しました
                        </Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.readByCountBtn}
                      disabled={selectedNotice.author !== displayUserName}
                      onPress={() => {
                        setCurrentReadByList(selectedNotice.readBy);
                        setReadByListVisible(true);
                      }}
                    >
                      <Text
                        style={[
                          styles.readByText,
                          selectedNotice.author === displayUserName &&
                            styles.readByTextClickable,
                        ]}
                      >
                        👁️ 確認済み: {selectedNotice.readBy.length}人{" "}
                        {selectedNotice.author === displayUserName
                          ? "(タップで詳細)"
                          : ""}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {(() => {
                  const isSharedPost =
                    selectedNotice.isSharedPost ||
                    (selectedNotice.title.includes("より】") &&
                      selectedNotice.title.includes("の投稿"));

                  const isStaffOrAbove = ["owner", "admin", "staff"].includes(
                    userRole,
                  );
                  const isAuthor = selectedNotice.author === displayUserName;

                  const canEdit =
                    !isSharedPost &&
                    (isStaffOrAbove || (canManageNotices && isAuthor));

                  const canDelete = isSharedPost
                    ? isStaffOrAbove
                    : isStaffOrAbove || (canManageNotices && isAuthor);

                  if (!canEdit && !canDelete) return null;

                  return (
                    <View style={styles.adminActionRow}>
                      {canEdit && (
                        <TouchableOpacity
                          style={styles.editBtn}
                          onPress={() => openEditModal(selectedNotice)}
                        >
                          <Text style={styles.editBtnText}>✏️ 修正する</Text>
                        </TouchableOpacity>
                      )}
                      {canDelete && (
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => handleDeleteNotice(selectedNotice.id)}
                        >
                          <Text style={styles.deleteBtnText}>🗑 削除する</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })()}
              </ScrollView>
            )}

            {/* ★ 修正：Modalを重ねるのではなく、内部での絶対配置レイヤー（オーバーレイ）としてリストを表示 */}
            {readByListVisible && (
              <View
                style={[StyleSheet.absoluteFill, styles.readByModalOverlay]}
              >
                <View style={styles.readByModalContent}>
                  <Text style={styles.readByModalTitle}>確認した人リスト</Text>
                  <ScrollView style={styles.readByListScroll}>
                    {currentReadByList.map((user, index) => (
                      <Text key={index} style={styles.readByListItem}>
                        ・ {user}
                      </Text>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={styles.readByModalCloseBtn}
                    onPress={() => setReadByListVisible(false)}
                  >
                    <Text style={styles.readByModalCloseText}>閉じる</Text>
                  </TouchableOpacity>
                </View>
              </View>
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
                  disabled={isSaving}
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
                    isSaving && { opacity: 0.7 },
                  ]}
                  onPress={handleSaveNotice}
                  disabled={isSaving}
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
  unconfirmedCard: {
    borderLeftWidth: 6,
    backgroundColor: "#f8f9fa",
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
  unreadText: { color: "#000", fontWeight: "900" },
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
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 10,
  },
  cardAuthor: { fontSize: 12, color: "#888", fontWeight: "bold" },
  cardDate: { fontSize: 12, color: "#aaa", marginTop: 2 },

  confirmButtonSmall: {
    backgroundColor: "#3498db",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  confirmButtonTextSmall: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  confirmedBadge: {
    backgroundColor: "#ecf0f1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
  },
  confirmedBadgeText: {
    color: "#7f8c8d",
    fontSize: 12,
    fontWeight: "bold",
  },

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
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    alignItems: "center",
  },
  confirmButtonLarge: {
    backgroundColor: "#3498db",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
    marginBottom: 15,
    width: "80%",
    alignItems: "center",
  },
  confirmButtonTextLarge: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  confirmedBadgeLarge: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 25,
    marginBottom: 15,
    width: "80%",
    alignItems: "center",
  },
  confirmedBadgeTextLarge: {
    color: "#27ae60",
    fontSize: 16,
    fontWeight: "bold",
  },
  readByCountBtn: {
    padding: 10,
  },
  readByText: { fontSize: 13, color: "#888", textAlign: "center" },
  readByTextClickable: { color: "#3498db", textDecorationLine: "underline" },

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

  // ★ 修正：モーダルの代わりに絶対配置するためのスタイル
  readByModalOverlay: {
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999, // 手前に表示
  },
  readByModalContent: {
    width: "80%",
    maxHeight: "70%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  readByModalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 10,
  },
  readByListScroll: {
    marginBottom: 15,
  },
  readByListItem: {
    fontSize: 16,
    color: "#555",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f9f9f9",
  },
  readByModalCloseBtn: {
    backgroundColor: "#3498db",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  readByModalCloseText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default NoticeBoardScreen;
