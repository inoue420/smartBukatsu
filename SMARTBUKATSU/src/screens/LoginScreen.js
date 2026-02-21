import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";

// ★修正：固定の CLUB_MEMBERS を削除し、propsで clubMembers を受け取る
const LoginScreen = ({
  navigation,
  setIsAdmin,
  setCurrentUser,
  adminPassword,
  memberPassword,
  clubMembers,
}) => {
  const [step, setStep] = useState("initial");
  const [teamId, setTeamId] = useState("");
  const [inputPassword, setInputPassword] = useState("");

  const handleSelectRole = (role) => {
    if (teamId.trim() === "") {
      Alert.alert("エラー", "チームIDを入力してください。");
      return;
    }
    setStep(role === "admin" ? "admin_pass" : "member_pass");
  };

  const handleAdminLogin = () => {
    if (inputPassword === adminPassword) {
      setIsAdmin(true);
      setCurrentUser("管理者");
      navigation.reset({ index: 0, routes: [{ name: "WorkspaceHome" }] });
    } else {
      Alert.alert("認証失敗", "パスワードが間違っています。");
    }
  };

  const handleMemberPasswordCheck = () => {
    if (inputPassword === memberPassword) {
      setStep("member_select");
      setInputPassword("");
    } else {
      Alert.alert("認証失敗", "パスワードが間違っています。");
    }
  };

  const handleMemberLogin = (name) => {
    setIsAdmin(false);
    setCurrentUser(name);
    navigation.reset({ index: 0, routes: [{ name: "WorkspaceHome" }] });
  };

  const goBack = () => {
    if (step === "member_select") setStep("member_pass");
    else {
      setStep("initial");
      setInputPassword("");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.headerBox}>
            <Text style={styles.appTitle}>SMART BUKATSU</Text>
            <Text style={styles.appSubTitle}>
              チームコミュニケーションアプリ
            </Text>
          </View>

          {step === "initial" && (
            <View style={styles.formBox}>
              <Text style={styles.label}>チームID</Text>
              <TextInput
                style={styles.input}
                placeholder="例: nonoichi-baseball"
                value={teamId}
                onChangeText={setTeamId}
                autoCapitalize="none"
              />
              <Text style={styles.sectionTitle}>ログインする権限を選択</Text>
              <TouchableOpacity
                style={styles.memberBtn}
                onPress={() => handleSelectRole("member")}
              >
                <Text style={styles.btnText}>👦 部員としてログイン</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.adminBtn}
                onPress={() => handleSelectRole("admin")}
              >
                <Text style={styles.btnText}>👨‍🏫 管理者としてログイン</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === "admin_pass" && (
            <View style={styles.formBox}>
              <Text style={styles.stepTitle}>👨‍🏫 管理者ログイン</Text>
              <Text style={styles.label}>管理者パスワード</Text>
              <TextInput
                style={styles.input}
                placeholder="パスワードを入力"
                secureTextEntry={true}
                value={inputPassword}
                onChangeText={setInputPassword}
                autoFocus
              />
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleAdminLogin}
              >
                <Text style={styles.btnText}>ログイン</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.backBtn} onPress={goBack}>
                <Text style={styles.backBtnText}>戻る</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === "member_pass" && (
            <View style={styles.formBox}>
              <Text style={styles.stepTitle}>👦 部員ログイン</Text>
              <Text style={styles.label}>チーム共通パスワード</Text>
              <TextInput
                style={styles.input}
                placeholder="監督から教えられたパスワード"
                secureTextEntry={true}
                value={inputPassword}
                onChangeText={setInputPassword}
                autoFocus
              />
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleMemberPasswordCheck}
              >
                <Text style={styles.btnText}>次へ (名前の選択)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.backBtn} onPress={goBack}>
                <Text style={styles.backBtnText}>戻る</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === "member_select" && (
            <View style={styles.formBox}>
              <Text style={styles.stepTitle}>あなたの名前を選んでください</Text>
              <ScrollView style={styles.memberList}>
                {/* ★修正：propsで受け取った clubMembers をマッピング */}
                {clubMembers.map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={styles.memberListItem}
                    onPress={() => handleMemberLogin(name)}
                  >
                    <Text style={styles.memberListName}>{name}</Text>
                    <Text style={styles.memberListArrow}>→</Text>
                  </TouchableOpacity>
                ))}
                {clubMembers.length === 0 && (
                  <Text style={{ padding: 15, textAlign: "center" }}>
                    登録されている部員がいません。
                  </Text>
                )}
              </ScrollView>
              <TouchableOpacity style={styles.backBtn} onPress={goBack}>
                <Text style={styles.backBtnText}>戻る</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  keyboardView: { flex: 1, justifyContent: "center" },
  content: { padding: 20, alignItems: "center" },
  headerBox: { alignItems: "center", marginBottom: 40 },
  appTitle: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#0077cc",
    letterSpacing: 1,
  },
  appSubTitle: { fontSize: 14, color: "#666", marginTop: 5 },
  formBox: {
    width: "100%",
    backgroundColor: "#fff",
    padding: 25,
    borderRadius: 15,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  label: { fontSize: 14, fontWeight: "bold", color: "#333", marginBottom: 8 },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    color: "#888",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 15,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#0077cc",
    textAlign: "center",
    marginBottom: 20,
  },
  memberBtn: {
    backgroundColor: "#3498db",
    paddingVertical: 15,
    borderRadius: 10,
    marginBottom: 15,
    alignItems: "center",
  },
  adminBtn: {
    backgroundColor: "#f39c12",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  submitBtn: {
    backgroundColor: "#2ecc71",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  backBtn: { marginTop: 20, padding: 10, alignItems: "center" },
  backBtnText: { color: "#888", fontSize: 14, fontWeight: "bold" },
  memberList: {
    maxHeight: 250,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
  },
  memberListItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
  },
  memberListName: { fontSize: 16, fontWeight: "bold", color: "#333" },
  memberListArrow: { fontSize: 16, color: "#aaa" },
});

export default LoginScreen;
