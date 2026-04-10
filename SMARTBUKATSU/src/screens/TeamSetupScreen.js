import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const TeamSetupScreen = ({ navigation }) => {
  const [teamId, setTeamId] = useState("");
  const [selectedRole, setSelectedRole] = useState("member");
  const [adminCode, setAdminCode] = useState("");

  const handleNext = () => {
    if (!teamId.trim()) {
      Alert.alert("エラー", "チームIDを入力してください。");
      return;
    }

    if (selectedRole === "admin") {
      if (adminCode !== "KIT2026") {
        Alert.alert("エラー", "管理者コードが間違っています。");
        return;
      }

      // ★ 魔法のコード：アプリ全体に「この人は管理者(owner)だ！」と記憶させる
      global.TEST_ROLE = "owner";

      Alert.alert("認証成功", "管理者としてログインします！");
      navigation.replace("WorkspaceHome");
    } else {
      // ★ 魔法のコード：アプリ全体に「この人は部員(member)だ！」と記憶させる
      global.TEST_ROLE = "member";

      Alert.alert("参加成功", "部員としてログインします！");
      navigation.replace("WorkspaceHome");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.inner}
      >
        <View style={styles.header}>
          <Text style={styles.appTitle}>📱 スマート部活</Text>
          <Text style={styles.subTitle}>チームへの参加</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>チームIDを入力してください</Text>
            <TextInput
              style={styles.input}
              placeholder="例: kit2026"
              value={teamId}
              onChangeText={setTeamId}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>あなたの役割</Text>
            <View style={styles.roleContainer}>
              <TouchableOpacity
                style={[
                  styles.roleBtn,
                  selectedRole === "admin" && styles.roleBtnActive,
                ]}
                onPress={() => setSelectedRole("admin")}
              >
                <Text
                  style={[
                    styles.roleBtnText,
                    selectedRole === "admin" && styles.roleBtnTextActive,
                  ]}
                >
                  👑 管理者
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.roleBtn,
                  selectedRole === "member" && styles.roleBtnActive,
                ]}
                onPress={() => setSelectedRole("member")}
              >
                <Text
                  style={[
                    styles.roleBtnText,
                    selectedRole === "member" && styles.roleBtnTextActive,
                  ]}
                >
                  👤 部員
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {selectedRole === "admin" && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>管理者コード</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                placeholder="コードを入力"
                value={adminCode}
                onChangeText={setAdminCode}
              />
            </View>
          )}

          <TouchableOpacity style={styles.btnPrimary} onPress={handleNext}>
            <Text style={styles.btnPrimaryText}>チームに入る</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5", justifyContent: "center" },
  inner: { padding: 20, width: "100%", maxWidth: 400, alignSelf: "center" },
  header: { alignItems: "center", marginBottom: 30 },
  appTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#0077cc",
    marginBottom: 5,
  },
  subTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  card: {
    backgroundColor: "#fff",
    padding: 25,
    borderRadius: 12,
    elevation: 3,
  },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: "bold", color: "#555", marginBottom: 8 },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  roleContainer: { flexDirection: "row", justifyContent: "space-between" },
  roleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginHorizontal: 4,
    backgroundColor: "#f9f9f9",
  },
  roleBtnActive: { backgroundColor: "#e6f2ff", borderColor: "#0077cc" },
  roleBtnText: { fontSize: 14, color: "#666", fontWeight: "bold" },
  roleBtnTextActive: { color: "#0077cc" },
  btnPrimary: {
    backgroundColor: "#0077cc",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});

export default TeamSetupScreen;
