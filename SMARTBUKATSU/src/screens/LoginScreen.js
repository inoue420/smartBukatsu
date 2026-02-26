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

const LoginScreen = ({
  navigation,
  setIsAdmin,
  setCurrentUser,
  adminPassword,
  memberPassword,
  clubMembers,
  setClubMembers,
  userProfiles,
}) => {
  const [selectedRole, setSelectedRole] = useState("member");
  const [selectedMember, setSelectedMember] = useState("");
  const [password, setPassword] = useState("");

  const [isRegistering, setIsRegistering] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");

  const handleLogin = () => {
    if (selectedRole === "admin") {
      if (password === adminPassword) {
        setIsAdmin(true);
        setCurrentUser("管理者");
        navigation.replace("WorkspaceHome");
      } else {
        Alert.alert("エラー", "管理者のパスワードが間違っています。");
      }
    } else {
      if (!selectedMember && !isRegistering) {
        Alert.alert("エラー", "名前を選択するか、新規登録してください。");
        return;
      }

      const personalPass =
        userProfiles && userProfiles[selectedMember]?.password;
      const expectedPass = personalPass ? personalPass : memberPassword;

      if (password === expectedPass) {
        setIsAdmin(false);
        setCurrentUser(selectedMember);
        navigation.replace("WorkspaceHome");
      } else {
        Alert.alert("エラー", "パスワードが間違っています。");
      }
    }
  };

  const handleRegister = () => {
    const trimmed = newMemberName.trim();
    if (!trimmed) {
      Alert.alert("エラー", "名前を入力してください。");
      return;
    }
    if (clubMembers.includes(trimmed)) {
      Alert.alert(
        "エラー",
        "その名前は既に登録されています。リストから選択してください。",
      );
      return;
    }
    setClubMembers([...clubMembers, trimmed]);
    setSelectedMember(trimmed);
    setIsRegistering(false);
    setNewMemberName("");
    Alert.alert(
      "登録完了",
      "新しい部員として登録しました。初期パスワードを入力してログインしてください。",
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.inner}
      >
        <View style={styles.header}>
          <Text style={styles.appTitle}>📱 スマート部活</Text>
          <Text style={styles.subTitle}>ログイン</Text>
        </View>

        <View style={styles.roleContainer}>
          <TouchableOpacity
            style={[
              styles.roleBtn,
              selectedRole === "member" && styles.roleBtnActive,
            ]}
            onPress={() => {
              setSelectedRole("member");
              setPassword("");
            }}
          >
            <Text
              style={[
                styles.roleBtnText,
                selectedRole === "member" && styles.roleBtnTextActive,
              ]}
            >
              部員
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleBtn,
              selectedRole === "admin" && styles.roleBtnActive,
            ]}
            onPress={() => {
              setSelectedRole("admin");
              setPassword("");
            }}
          >
            <Text
              style={[
                styles.roleBtnText,
                selectedRole === "admin" && styles.roleBtnTextActive,
              ]}
            >
              管理者 (監督)
            </Text>
          </TouchableOpacity>
        </View>

        {/* 既存の部員リスト選択UI */}
        {selectedRole === "member" && !isRegistering && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>名前を選択</Text>
            <View style={styles.memberList}>
              {clubMembers.map((name) => (
                <TouchableOpacity
                  key={name}
                  style={[
                    styles.memberBadge,
                    selectedMember === name && styles.memberBadgeActive,
                  ]}
                  onPress={() => setSelectedMember(name)}
                >
                  <Text
                    style={[
                      styles.memberBadgeText,
                      selectedMember === name && styles.memberBadgeTextActive,
                    ]}
                  >
                    {name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* ★修正：ダサかったボタンを消し、スマートなテキストリンクにしました */}
            <TouchableOpacity
              style={styles.registerLink}
              onPress={() => setIsRegistering(true)}
            >
              <Text style={styles.registerLinkText}>
                ＋ 自分の名前がない場合はこちら (新規登録)
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 新規登録入力UI */}
        {selectedRole === "member" && isRegistering && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>新しい部員の名前を登録</Text>
            <View style={styles.registerInputRow}>
              <TextInput
                style={styles.registerInput}
                placeholder="名前を入力"
                value={newMemberName}
                onChangeText={setNewMemberName}
              />
              <TouchableOpacity
                style={styles.registerAddBtn}
                onPress={handleRegister}
              >
                <Text style={styles.registerAddBtnText}>追加</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.registerLink}
              onPress={() => setIsRegistering(false)}
            >
              <Text style={styles.cancelLinkText}>◁ リスト選択に戻る</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>パスワード</Text>
          <TextInput
            style={styles.input}
            secureTextEntry
            placeholder="パスワードを入力"
            value={password}
            onChangeText={setPassword}
          />

          {selectedRole === "member" && (
            <Text style={styles.hintText}>
              ※個人パスワード未設定の場合は初期パスワード「{memberPassword}
              」を使用してください
            </Text>
          )}
          {selectedRole === "admin" && (
            <Text style={styles.hintText}>
              ※管理者の初期パスワードは「{adminPassword}」です
            </Text>
          )}
        </View>

        <TouchableOpacity style={styles.loginBtn} onPress={handleLogin}>
          <Text style={styles.loginBtnText}>ログイン</Text>
        </TouchableOpacity>
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
  subTitle: { fontSize: 16, color: "#666" },
  roleContainer: {
    flexDirection: "row",
    marginBottom: 20,
    backgroundColor: "#e0e0e0",
    borderRadius: 8,
    padding: 4,
  },
  roleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 6,
  },
  roleBtnActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  roleBtnText: { fontSize: 16, fontWeight: "bold", color: "#888" },
  roleBtnTextActive: { color: "#0077cc" },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: "bold", color: "#555", marginBottom: 8 },
  memberList: { flexDirection: "row", flexWrap: "wrap" },
  memberBadge: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
  },
  memberBadgeActive: { backgroundColor: "#0077cc", borderColor: "#0077cc" },
  memberBadgeText: { fontSize: 14, color: "#555", fontWeight: "bold" },
  memberBadgeTextActive: { color: "#fff" },

  // ★修正：新規登録UIをログイン画面に馴染むように調整
  registerLink: { marginTop: 5, paddingVertical: 5 },
  registerLinkText: { color: "#0077cc", fontSize: 13, fontWeight: "bold" },
  cancelLinkText: { color: "#888", fontSize: 13, fontWeight: "bold" },
  registerInputRow: { flexDirection: "row", alignItems: "center" },
  registerInput: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  registerAddBtn: {
    backgroundColor: "#0077cc",
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 8,
    marginLeft: 10,
    justifyContent: "center",
  },
  registerAddBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },

  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  hintText: {
    fontSize: 12,
    color: "#e67e22",
    marginTop: 5,
    fontWeight: "bold",
  },
  loginBtn: {
    backgroundColor: "#0077cc",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
    elevation: 3,
  },
  loginBtnText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});

export default LoginScreen;
