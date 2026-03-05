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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ProjectListScreen = ({ navigation, isAdmin, projects, setProjects }) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("試合");

  let filteredProjects = projects.filter((p) => p.title.includes(searchQuery));

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
      participants: "team",
    };

    setProjects([newProject, ...projects]);
    setIsCreateModalVisible(false);
    setNewTitle("");
    Keyboard.dismiss();
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
        <Text style={styles.headerTitle}>📁 プロジェクト一覧</Text>
        <View style={{ width: 60 }} />
      </View>

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
      >
        {filteredProjects.length === 0 ? (
          <Text style={styles.emptyText}>プロジェクトがありません。</Text>
        ) : (
          filteredProjects.map((project) => (
            <TouchableOpacity
              key={project.id}
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => navigation.navigate("ProjectDetail", { project })}
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
              <Text style={styles.projectTitle}>{project.title}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.footerText}>
                  👥 共有: {project.participants === "team" ? "全体" : "限定"}
                </Text>
                <Text style={styles.footerText}>💬 チャット進行中</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* 管理者のみ新規作成ボタンを表示 */}
      {isAdmin && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setIsCreateModalVisible(true)}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      {/* 新規作成モーダル */}
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

  typeContainer: { flexDirection: "row", marginBottom: 30 },
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
  typeBtnText: { fontSize: 15, color: "#555", fontWeight: "bold" },
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
