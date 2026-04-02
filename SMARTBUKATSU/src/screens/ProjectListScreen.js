import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ProjectListScreen = ({
  navigation,
  isAdmin,
  currentUser,
  projects,
  setProjects,
  userProfiles = {},
}) => {
  // ★追加：タブ切り替え用のステート ("summary" = まとめ, "tagging" = タグ付け)
  const [activeTab, setActiveTab] = useState("tagging");

  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("試合");
  const [newParticipants, setNewParticipants] = useState("team");

  const [activeLongPressProjectId, setActiveLongPressProjectId] =
    useState(null);

  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole = isAdmin ? "owner" : currentUserProfile.role || "member";
  const displayUserName = isAdmin ? "管理者(監督)" : currentUser;

  const canCreateProject = ["owner", "staff", "captain"].includes(userRole);
  const canDeleteProject = ["owner", "staff", "captain"].includes(userRole);
  const canPinProject = ["owner", "staff", "captain"].includes(userRole);

  let filteredProjects = projects.filter((p) => {
    if (p.status === "deleted") return false;
    if (!p.title.includes(searchQuery)) return false;
    if (userRole === "member" || userRole === "captain") {
      if (p.participants === "coach") return false;
    }
    return true;
  });

  filteredProjects.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  const handleCreateProject = () => {
    if (newTitle.trim() === "") return;
    const today = new Date();
    const dateString = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

    const newProject = {
      id: "p_" + Date.now().toString(),
      title: newTitle,
      date: dateString,
      type: newType,
      status: "active",
      participants: newParticipants,
      pinned: false,
    };

    setProjects([newProject, ...projects]);
    setIsCreateModalVisible(false);
    setNewTitle("");
    setNewParticipants("team");
    Keyboard.dismiss();
  };

  const handleTogglePin = (projectId) => {
    setProjects(
      projects.map((p) =>
        p.id === projectId ? { ...p, pinned: !p.pinned } : p,
      ),
    );
    setActiveLongPressProjectId(null);
  };

  const confirmDeleteProject = (projectId) => {
    Alert.alert(
      "プロジェクトの消去",
      "本当にこのプロジェクトを消去しますか？（データはゴミ箱に保持されます）",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "消去",
          style: "destructive",
          onPress: () => {
            setProjects(
              projects.map((p) =>
                p.id === projectId
                  ? {
                      ...p,
                      status: "deleted",
                      deletedBy: displayUserName,
                      deletedAt: new Date().toISOString(),
                    }
                  : p,
              ),
            );
            setActiveLongPressProjectId(null);
          },
        },
      ],
    );
  };

  const getParticipantsLabel = (val) => {
    if (val === "team") return "全体";
    if (val === "coach") return "指導者のみ";
    return "限定";
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>◁ ホーム</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📁 プロジェクト</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* ★追加：画面上部のタブ切り替え */}
      <View style={styles.topTabContainer}>
        <TouchableOpacity
          style={[
            styles.topTabBtn,
            activeTab === "summary" && styles.topTabBtnActive,
          ]}
          onPress={() => setActiveTab("summary")}
        >
          <Text
            style={[
              styles.topTabText,
              activeTab === "summary" && styles.topTabTextActive,
            ]}
          >
            📊 まとめ
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.topTabBtn,
            activeTab === "tagging" && styles.topTabBtnActive,
          ]}
          onPress={() => setActiveTab("tagging")}
        >
          <Text
            style={[
              styles.topTabText,
              activeTab === "tagging" && styles.topTabTextActive,
            ]}
          >
            🏷️ タグ付け
          </Text>
        </TouchableOpacity>
      </View>

      {/* ★追加：タブに応じた表示の出し分け */}
      {activeTab === "summary" ? (
        <View style={styles.summaryContainer}>
          <Text style={styles.summaryIcon}>🚧</Text>
          <Text style={styles.summaryTitle}>次に実装！</Text>
          <Text style={styles.summaryDesc}>
            ここにチームの強み・弱みの集計や、全体的なスタッツをまとめたダッシュボードが入ります。
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="プロジェクトを検索..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <ScrollView
            style={styles.listContainer}
            contentContainerStyle={{ paddingBottom: 100 }}
            onScrollBeginDrag={() => setActiveLongPressProjectId(null)}
          >
            {filteredProjects.length === 0 ? (
              <Text style={styles.emptyText}>
                該当するプロジェクトがありません。
              </Text>
            ) : (
              filteredProjects.map((project) => (
                <TouchableOpacity
                  key={project.id}
                  style={[
                    styles.card,
                    project.pinned && styles.cardPinned,
                    activeLongPressProjectId === project.id && { zIndex: 10 },
                  ]}
                  activeOpacity={0.9}
                  onLongPress={() => {
                    if (canPinProject || canDeleteProject) {
                      setActiveLongPressProjectId(project.id);
                    }
                  }}
                  delayLongPress={300}
                  onPress={() => {
                    if (activeLongPressProjectId === project.id) {
                      setActiveLongPressProjectId(null);
                    } else {
                      navigation.navigate("ProjectDetail", {
                        project,
                        userRole,
                      });
                    }
                  }}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.dateText}>{project.date}</Text>
                    <View
                      style={[
                        styles.badge,
                        project.type === "試合"
                          ? styles.badgeMatch
                          : styles.badgePractice,
                      ]}
                    >
                      <Text style={styles.badgeText}>{project.type}</Text>
                    </View>
                  </View>

                  <Text style={styles.projectTitle}>
                    {project.pinned ? "📌 " : ""}
                    {project.title}
                  </Text>

                  <View style={styles.cardFooter}>
                    <Text style={styles.footerText}>
                      👥 共有: {getParticipantsLabel(project.participants)}
                    </Text>
                    <Text style={styles.footerText}>💬 チャット進行中</Text>
                  </View>

                  {activeLongPressProjectId === project.id && (
                    <View style={styles.longPressMenu}>
                      {canPinProject && (
                        <TouchableOpacity
                          style={styles.longPressMenuItem}
                          onPress={() => handleTogglePin(project.id)}
                        >
                          <Text style={styles.longPressMenuText}>
                            {project.pinned ? "📌 固定を解除" : "📌 固定する"}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {canDeleteProject && (
                        <TouchableOpacity
                          style={styles.longPressMenuItem}
                          onPress={() => confirmDeleteProject(project.id)}
                        >
                          <Text
                            style={[
                              styles.longPressMenuText,
                              { color: "#d9534f" },
                            ]}
                          >
                            🗑 消去する
                          </Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={[
                          styles.longPressMenuItem,
                          { borderBottomWidth: 0 },
                        ]}
                        onPress={() => setActiveLongPressProjectId(null)}
                      >
                        <Text
                          style={[styles.longPressMenuText, { color: "#888" }]}
                        >
                          ✕ キャンセル
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>

          {canCreateProject && (
            <TouchableOpacity
              style={styles.fab}
              onPress={() => setIsCreateModalVisible(true)}
            >
              <Text style={styles.fabIcon}>＋</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      <Modal
        visible={isCreateModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>新規プロジェクト作成</Text>

            <Text style={styles.label}>プロジェクト名</Text>
            <TextInput
              style={styles.input}
              placeholder="例: 春季大会 1回戦"
              value={newTitle}
              onChangeText={setNewTitle}
              autoFocus
            />

            <Text style={styles.label}>種類</Text>
            <View style={styles.typeContainer}>
              <TouchableOpacity
                style={[
                  styles.typeBtn,
                  newType === "試合" && styles.typeBtnActive,
                ]}
                onPress={() => setNewType("試合")}
              >
                <Text
                  style={[
                    styles.typeBtnText,
                    newType === "試合" && styles.typeBtnTextActive,
                  ]}
                >
                  試合
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeBtn,
                  newType === "練習" && styles.typeBtnActive,
                ]}
                onPress={() => setNewType("練習")}
              >
                <Text
                  style={[
                    styles.typeBtnText,
                    newType === "練習" && styles.typeBtnTextActive,
                  ]}
                >
                  練習
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>共有範囲</Text>
            <View style={styles.typeContainer}>
              <TouchableOpacity
                style={[
                  styles.typeBtn,
                  newParticipants === "team" && styles.typeBtnActive,
                ]}
                onPress={() => setNewParticipants("team")}
              >
                <Text
                  style={[
                    styles.typeBtnText,
                    newParticipants === "team" && styles.typeBtnTextActive,
                  ]}
                >
                  全体
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeBtn,
                  newParticipants === "group" && styles.typeBtnActive,
                ]}
                onPress={() => setNewParticipants("group")}
              >
                <Text
                  style={[
                    styles.typeBtnText,
                    newParticipants === "group" && styles.typeBtnTextActive,
                  ]}
                >
                  限定
                </Text>
              </TouchableOpacity>
              {["owner", "staff"].includes(userRole) && (
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    newParticipants === "coach" && styles.typeBtnActive,
                  ]}
                  onPress={() => setNewParticipants("coach")}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      newParticipants === "coach" && styles.typeBtnTextActive,
                    ]}
                  >
                    指導者のみ
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsCreateModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleCreateProject}
              >
                <Text style={styles.submitBtnText}>作成する</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#2c3e50",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backButton: { width: 60 },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },

  // ★追加：上部タブのスタイル
  topTabContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  topTabBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: "center",
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  topTabBtnActive: {
    borderBottomColor: "#2c3e50",
  },
  topTabText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#888",
  },
  topTabTextActive: {
    color: "#2c3e50",
  },

  // ★追加：まとめタブ専用のスタイル
  summaryContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  summaryIcon: {
    fontSize: 60,
    marginBottom: 20,
  },
  summaryTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
  },
  summaryDesc: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
  },

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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    position: "relative",
  },
  cardPinned: {
    borderWidth: 2,
    borderColor: "#e6f2ff",
    backgroundColor: "#fafcff",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  dateText: { fontSize: 13, color: "#888", fontWeight: "bold" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeMatch: { backgroundColor: "#ffeaa7" },
  badgePractice: { backgroundColor: "#dff9fb" },
  badgeText: { fontSize: 11, fontWeight: "bold", color: "#333" },
  projectTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 10,
  },
  footerText: { fontSize: 12, color: "#666", fontWeight: "bold" },

  longPressMenu: {
    position: "absolute",
    top: 40,
    right: 15,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 5,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 20,
    minWidth: 140,
  },
  longPressMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  longPressMenuText: { fontSize: 14, fontWeight: "bold", color: "#0077cc" },

  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    backgroundColor: "#2c3e50",
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
  },
  fabIcon: { fontSize: 30, color: "#fff", fontWeight: "bold" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: { backgroundColor: "#fff", borderRadius: 12, padding: 20 },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#333",
    textAlign: "center",
  },
  label: { fontSize: 14, fontWeight: "bold", color: "#555", marginBottom: 8 },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },

  typeContainer: { flexDirection: "row", marginBottom: 20 },
  typeBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginRight: 10,
  },
  typeBtnActive: { backgroundColor: "#e6f2ff", borderColor: "#0077cc" },
  typeBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  typeBtnTextActive: { color: "#0077cc" },

  modalButtons: { flexDirection: "row", justifyContent: "flex-end" },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 20, marginRight: 10 },
  cancelBtnText: { color: "#888", fontWeight: "bold", fontSize: 15 },
  submitBtn: {
    backgroundColor: "#2c3e50",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  submitBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
});

export default ProjectListScreen;
