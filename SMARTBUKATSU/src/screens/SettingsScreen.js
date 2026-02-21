import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

const SettingsScreen = ({
  navigation,
  adminPassword,
  setAdminPassword,
  memberPassword,
  setMemberPassword,
  clubMembers,
  setClubMembers,
  grades,
  setGrades, // ★追加
  positions,
  setPositions, // ★追加
}) => {
  const [newAdminPass, setNewAdminPass] = useState(adminPassword);
  const [newMemberPass, setNewMemberPass] = useState(memberPassword);
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [showMemberPass, setShowMemberPass] = useState(false);

  const [newMemberName, setNewMemberName] = useState("");
  const [newGradeName, setNewGradeName] = useState(""); // ★追加
  const [newPositionName, setNewPositionName] = useState(""); // ★追加

  const handleSavePasswords = () => {
    if (newAdminPass.trim() === "" || newMemberPass.trim() === "") {
      Alert.alert("エラー", "パスワードは空にできません。");
      return;
    }
    setAdminPassword(newAdminPass);
    setMemberPassword(newMemberPass);
    Alert.alert("保存完了", "パスワードを更新しました。");
  };

  // 汎用的な追加・削除関数
  const handleAddItem = (itemName, list, setList, setNewItemName, label) => {
    const trimmed = itemName.trim();
    if (trimmed === "") return;
    if (list.includes(trimmed)) {
      Alert.alert("エラー", `その${label}は既に登録されています。`);
      return;
    }
    setList([...list, trimmed]);
    setNewItemName("");
  };

  const handleDeleteItem = (itemName, list, setList, label) => {
    Alert.alert(`${label}の削除`, `${itemName} をリストから削除しますか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => setList(list.filter((item) => item !== itemName)),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backBtnText}>◁ 戻る</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>⚙️ チーム設定</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionDescription}>
            ※この画面は管理者のみアクセス可能です。
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>🔑 パスワード設定</Text>
            <Text style={styles.label}>管理者パスワード</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                value={newAdminPass}
                onChangeText={setNewAdminPass}
                secureTextEntry={!showAdminPass}
              />
              <TouchableOpacity
                style={styles.toggleBtn}
                onPress={() => setShowAdminPass(!showAdminPass)}
              >
                <Text style={styles.toggleBtnText}>
                  {showAdminPass ? "隠す" : "表示"}
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>部員用共通パスワード</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                value={newMemberPass}
                onChangeText={setNewMemberPass}
                secureTextEntry={!showMemberPass}
              />
              <TouchableOpacity
                style={styles.toggleBtn}
                onPress={() => setShowMemberPass(!showMemberPass)}
              >
                <Text style={styles.toggleBtnText}>
                  {showMemberPass ? "隠す" : "表示"}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSavePasswords}
            >
              <Text style={styles.saveBtnText}>パスワードを保存</Text>
            </TouchableOpacity>
          </View>

          {/* 部員リスト管理 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>👥 部員リスト管理</Text>
            <View style={styles.addMemberRow}>
              <TextInput
                style={styles.addMemberInput}
                placeholder="新しい部員の名前"
                value={newMemberName}
                onChangeText={setNewMemberName}
              />
              <TouchableOpacity
                style={styles.addMemberBtn}
                onPress={() =>
                  handleAddItem(
                    newMemberName,
                    clubMembers,
                    setClubMembers,
                    setNewMemberName,
                    "部員",
                  )
                }
              >
                <Text style={styles.addMemberBtnText}>追加</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.memberList}>
              {clubMembers.map((name) => (
                <View key={name} style={styles.memberItem}>
                  <Text style={styles.memberName}>{name}</Text>
                  <TouchableOpacity
                    onPress={() =>
                      handleDeleteItem(
                        name,
                        clubMembers,
                        setClubMembers,
                        "部員",
                      )
                    }
                  >
                    <Text style={styles.deleteText}>削除</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {clubMembers.length === 0 && (
                <Text style={styles.emptyText}>
                  登録されている部員がいません。
                </Text>
              )}
            </View>
          </View>

          {/* ★追加：学年リスト管理 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🎓 学年リスト管理 (フィルタ用)</Text>
            <View style={styles.addMemberRow}>
              <TextInput
                style={styles.addMemberInput}
                placeholder="例: 1年生、OB など"
                value={newGradeName}
                onChangeText={setNewGradeName}
              />
              <TouchableOpacity
                style={[styles.addMemberBtn, { backgroundColor: "#f39c12" }]}
                onPress={() =>
                  handleAddItem(
                    newGradeName,
                    grades,
                    setGrades,
                    setNewGradeName,
                    "学年",
                  )
                }
              >
                <Text style={styles.addMemberBtnText}>追加</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.memberList}>
              {grades.map((g) => (
                <View key={g} style={styles.memberItem}>
                  <Text style={styles.memberName}>{g}</Text>
                  <TouchableOpacity
                    onPress={() =>
                      handleDeleteItem(g, grades, setGrades, "学年")
                    }
                  >
                    <Text style={styles.deleteText}>削除</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>

          {/* ★追加：ポジションリスト管理 */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              ⚾ ポジション・役割管理 (フィルタ用)
            </Text>
            <View style={styles.addMemberRow}>
              <TextInput
                style={styles.addMemberInput}
                placeholder="例: FW、センター など"
                value={newPositionName}
                onChangeText={setNewPositionName}
              />
              <TouchableOpacity
                style={[styles.addMemberBtn, { backgroundColor: "#e67e22" }]}
                onPress={() =>
                  handleAddItem(
                    newPositionName,
                    positions,
                    setPositions,
                    setNewPositionName,
                    "ポジション",
                  )
                }
              >
                <Text style={styles.addMemberBtnText}>追加</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.memberList}>
              {positions.map((p) => (
                <View key={p} style={styles.memberItem}>
                  <Text style={styles.memberName}>{p}</Text>
                  <TouchableOpacity
                    onPress={() =>
                      handleDeleteItem(p, positions, setPositions, "ポジション")
                    }
                  >
                    <Text style={styles.deleteText}>削除</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#f39c12",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backBtn: { width: 60 },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  content: { padding: 15 },
  sectionDescription: {
    color: "#666",
    fontSize: 12,
    marginBottom: 15,
    textAlign: "center",
  },
  card: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 10,
  },
  label: { fontSize: 14, fontWeight: "bold", color: "#555", marginBottom: 5 },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 15,
  },
  passwordInput: { flex: 1, padding: 12, fontSize: 16 },
  toggleBtn: {
    paddingHorizontal: 15,
    paddingVertical: 12,
    justifyContent: "center",
  },
  toggleBtnText: { color: "#0077cc", fontWeight: "bold", fontSize: 14 },
  saveBtn: {
    backgroundColor: "#2ecc71",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 5,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  addMemberRow: { flexDirection: "row", marginBottom: 15 },
  addMemberInput: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  addMemberBtn: {
    backgroundColor: "#0077cc",
    paddingHorizontal: 20,
    justifyContent: "center",
    borderRadius: 8,
    marginLeft: 10,
  },
  addMemberBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  memberList: { borderWidth: 1, borderColor: "#eee", borderRadius: 8 },
  memberItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
  },
  memberName: { fontSize: 16, color: "#333", fontWeight: "bold" },
  deleteText: { color: "#e74c3c", fontWeight: "bold" },
  emptyText: { padding: 15, textAlign: "center", color: "#888" },
});

export default SettingsScreen;
