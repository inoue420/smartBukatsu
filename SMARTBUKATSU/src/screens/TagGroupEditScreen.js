import React, { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../AuthContext";
import {
  createTagGroup,
  deleteTagGroup,
  updateTagGroup,
} from "../services/firestoreService";

const DEFAULT_TAGS = ["得点", "罰則", "2min", "ナイス"];

const normalizeTags = (value) =>
  value
    .split(/[、,\n]/)
    .map((tag) => tag.trim())
    .filter((tag, index, tags) => tag && tags.indexOf(tag) === index);

export default function TagGroupEditScreen({
  navigation,
  currentUser,
  currentUserUid = "",
  isAdmin = false,
  userProfiles = {},
  tagGroups = [],
  setTagGroups,
}) {
  const { activeTeamId } = useAuth();
  const currentUserProfile =
    Object.values(userProfiles).find(
      (profile) => profile?.uid === currentUserUid,
    ) || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");
  const canEditTagGroups =
    ["owner", "admin", "staff"].includes(userRole) ||
    (userRole === "guardian" && Boolean(currentUserProfile.canEditTags));
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [name, setName] = useState("");
  const [tagsText, setTagsText] = useState(DEFAULT_TAGS.join("、"));
  const [isSaving, setIsSaving] = useState(false);

  const activeTagGroups = useMemo(
    () => tagGroups.filter((group) => group.status !== "deleted"),
    [tagGroups],
  );

  if (!canEditTagGroups) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.title}>権限がありません</Text>
        <Text style={styles.emptyText}>
          タグ編集権限がないため、この画面は利用できません。
        </Text>
      </SafeAreaView>
    );
  }

  const resetForm = () => {
    setEditingGroupId(null);
    setName("");
    setTagsText(DEFAULT_TAGS.join("、"));
  };

  const handleEdit = (group) => {
    setEditingGroupId(group.id);
    setName(group.name || "");
    setTagsText((group.tags || []).join("、"));
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const tags = normalizeTags(tagsText);

    if (!trimmedName) {
      return Alert.alert("未入力", "タグリスト名を入力してください。");
    }
    if (tags.length === 0) {
      return Alert.alert("未入力", "タグ内容を1件以上入力してください。");
    }
    if (!activeTeamId) {
      return Alert.alert("エラー", "チーム情報を確認できませんでした。");
    }

    setIsSaving(true);
    try {
      if (editingGroupId) {
        await updateTagGroup(activeTeamId, editingGroupId, {
          name: trimmedName,
          tags,
          updatedBy: currentUserUid || currentUser || "unknown",
        });
        setTagGroups?.((prev) =>
          prev.map((group) =>
            group.id === editingGroupId
              ? { ...group, name: trimmedName, tags }
              : group,
          ),
        );
      } else {
        const createdId = await createTagGroup(activeTeamId, {
          name: trimmedName,
          tags,
          createdBy: currentUserUid || currentUser || "unknown",
        });
        setTagGroups?.((prev) => {
          const createdGroup = {
            id: createdId,
            name: trimmedName,
            tags,
            status: "active",
          };
          return prev.some((group) => group.id === createdId)
            ? prev.map((group) =>
                group.id === createdId ? { ...group, ...createdGroup } : group,
              )
            : [...prev, createdGroup];
        });
      }
      resetForm();
      Alert.alert("保存しました", "タグリストを保存しました。");
    } catch (error) {
      Alert.alert("エラー", "タグリストの保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (group) => {
    Alert.alert(
      "タグリストの削除",
      `「${group.name}」を削除しますか？\n既存動画は保存済みのタグリスト名とタグ内容で表示を継続します。`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: async () => {
            if (!activeTeamId) return;
            try {
              await deleteTagGroup(activeTeamId, group.id);
              setTagGroups?.((prev) =>
                prev.map((item) =>
                  item.id === group.id ? { ...item, status: "deleted" } : item,
                ),
              );
              if (editingGroupId === group.id) resetForm();
            } catch (error) {
              Alert.alert("エラー", "タグリストの削除に失敗しました。");
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={navigation.goBack}>
          <Text style={styles.backButtonText}>＜ 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>タグ編集</Text>
        <View style={{ width: 70 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.body}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={styles.formPanel}>
            <Text style={styles.sectionTitle}>
              {editingGroupId ? "タグリストを編集" : "タグリストを作成"}
            </Text>

            <Text style={styles.label}>タグリスト名</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="例: 試合分析タグ"
            />

            <Text style={styles.label}>タグ内容</Text>
            <TextInput
              style={[styles.input, styles.tagsInput]}
              value={tagsText}
              onChangeText={setTagsText}
              placeholder="例: 得点、シュート、守備、ナイス"
              multiline
            />
            <Text style={styles.helpText}>読点・カンマ・改行で区切れます。</Text>

            <View style={styles.formActions}>
              {editingGroupId && (
                <TouchableOpacity style={styles.clearBtn} onPress={resetForm}>
                  <Text style={styles.clearBtnText}>新規作成へ</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.saveBtn, isSaving && { opacity: 0.7 }]}
                onPress={handleSave}
                disabled={isSaving}
              >
                <Text style={styles.saveBtnText}>
                  {isSaving ? "保存中..." : "保存する"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.listTitle}>登録済みタグリスト</Text>
          {activeTagGroups.length === 0 ? (
            <Text style={styles.emptyText}>タグリストはまだありません。</Text>
          ) : (
            activeTagGroups.map((group) => (
              <View key={group.id} style={styles.groupCard}>
                <View style={styles.groupInfo}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <Text style={styles.groupTags} numberOfLines={2}>
                    {(group.tags || []).join("、") || "タグ未設定"}
                  </Text>
                </View>
                <View style={styles.groupActions}>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => handleEdit(group)}
                  >
                    <Text style={styles.editBtnText}>編集</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(group)}
                  >
                    <Text style={styles.deleteBtnText}>削除</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#2c3e50",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backButton: { width: 70 },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  body: { flex: 1, padding: 15 },
  formPanel: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 15,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  sectionTitle: { fontSize: 17, fontWeight: "bold", color: "#333" },
  label: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginTop: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  tagsInput: { minHeight: 92, textAlignVertical: "top" },
  helpText: { color: "#888", fontSize: 12, marginTop: 6 },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 16,
  },
  clearBtn: { paddingVertical: 12, paddingHorizontal: 16, marginRight: 8 },
  clearBtnText: { color: "#666", fontWeight: "bold" },
  saveBtn: {
    backgroundColor: "#0077cc",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  saveBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  listTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
  },
  emptyText: { textAlign: "center", color: "#888", marginTop: 20 },
  groupCard: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#0077cc",
    flexDirection: "row",
    alignItems: "center",
  },
  groupInfo: { flex: 1, paddingRight: 10 },
  groupName: { fontSize: 15, fontWeight: "bold", color: "#333" },
  groupTags: { fontSize: 12, color: "#777", marginTop: 5, lineHeight: 18 },
  groupActions: { flexDirection: "row" },
  editBtn: {
    backgroundColor: "#e6f2ff",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 6,
  },
  editBtnText: { color: "#0077cc", fontWeight: "bold" },
  deleteBtn: {
    backgroundColor: "#fff5f5",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  deleteBtnText: { color: "#c0392b", fontWeight: "bold" },
});
