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
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import { executeRegistration } from "../services/firestoreService";

const LoginScreen = ({ navigation }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [registerStep, setRegisterStep] = useState(1);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState("admin");
  const [teamName, setTeamName] = useState("");

  // 変数名を teamIdInput から inviteCode に変更
  const [inviteCode, setInviteCode] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const { signIn, signUp } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert("エラー", "入力してください。");
    setIsLoading(true);
    try {
      await signIn(email.trim(), password);
      navigation.replace("WorkspaceHome");
    } catch (error) {
      Alert.alert("エラー", "ログインに失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextStep = () => {
    if (!email || !password || !userName.trim()) {
      return Alert.alert("エラー", "すべての項目を入力してください。");
    }
    if (password.length < 6) {
      return Alert.alert("エラー", "パスワードは6文字以上で入力してください。");
    }
    setRegisterStep(2);
  };

  const handleRegister = async () => {
    if (role === "admin" && !teamName.trim())
      return Alert.alert("エラー", "チーム名を入力してください。");
    if (role === "member" && !inviteCode.trim())
      return Alert.alert("エラー", "招待コードを入力してください。");

    setIsLoading(true);
    try {
      await signUp(email.trim(), password);
      const uid = auth.currentUser?.uid;

      const result = await executeRegistration(
        uid,
        role,
        userName.trim(),
        teamName.trim(),
        inviteCode.trim(),
      );

      if (result.type === "create") {
        Alert.alert(
          "🎉 チーム作成成功！",
          `部員を招待するための【 招待コード 】が発行されました：\n\n【 ${result.inviteCode} 】\n\nこのコードを部員に教えてください！`,
          [{ text: "OK", onPress: () => navigation.replace("WorkspaceHome") }],
        );
      } else {
        Alert.alert(
          "✅ 参加完了",
          "招待コードが承認され、チームに参加しました！",
          [{ text: "OK", onPress: () => navigation.replace("WorkspaceHome") }],
        );
      }
    } catch (error) {
      Alert.alert("登録エラー", error.message || "処理に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.inner}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        >
          <View style={styles.header}>
            <Text style={styles.appTitle}>📱 スマート部活</Text>
            <Text style={styles.subTitle}>
              {isLoginMode ? "ログイン" : `新規登録 (${registerStep}/2)`}
            </Text>
          </View>

          <View style={styles.stepContainer}>
            {isLoginMode ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="メールアドレス"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="パスワード"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleLogin}
                  disabled={isLoading}
                >
                  <Text style={styles.primaryBtnText}>
                    {isLoading ? "送信中..." : "ログイン"}
                  </Text>
                </TouchableOpacity>
              </>
            ) : registerStep === 1 ? (
              <>
                <Text style={styles.label}>お名前</Text>
                <TextInput
                  style={styles.input}
                  placeholder="例: 山田 太郎"
                  value={userName}
                  onChangeText={setUserName}
                />
                <TextInput
                  style={styles.input}
                  placeholder="メールアドレス"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="パスワード(6文字以上)"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleNextStep}
                >
                  <Text style={styles.primaryBtnText}>次へ進む</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  onPress={() => setRegisterStep(1)}
                  style={{ marginBottom: 15 }}
                >
                  <Text style={{ color: "#888", fontWeight: "bold" }}>
                    ◁ 戻る
                  </Text>
                </TouchableOpacity>
                <View style={styles.roleContainer}>
                  <TouchableOpacity
                    style={[
                      styles.roleBtn,
                      role === "admin" && styles.roleBtnActive,
                    ]}
                    onPress={() => setRole("admin")}
                  >
                    <Text
                      style={
                        role === "admin"
                          ? styles.roleBtnTextActive
                          : styles.roleBtnText
                      }
                    >
                      👑 管理者
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.roleBtn,
                      role === "member" && styles.roleBtnActive,
                    ]}
                    onPress={() => setRole("member")}
                  >
                    <Text
                      style={
                        role === "member"
                          ? styles.roleBtnTextActive
                          : styles.roleBtnText
                      }
                    >
                      👤 部員
                    </Text>
                  </TouchableOpacity>
                </View>
                {role === "admin" ? (
                  <TextInput
                    style={styles.input}
                    placeholder="部活名（例：サッカー部）"
                    value={teamName}
                    onChangeText={setTeamName}
                  />
                ) : (
                  <TextInput
                    style={styles.input}
                    placeholder="共有された6桁の招待コード"
                    value={inviteCode}
                    onChangeText={setInviteCode}
                    autoCapitalize="characters"
                  />
                )}
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleRegister}
                  disabled={isLoading}
                >
                  <Text style={styles.primaryBtnText}>
                    {isLoading ? "処理中..." : "登録を完了する"}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={styles.switchModeBtn}
              onPress={() => {
                setIsLoginMode(!isLoginMode);
                setRegisterStep(1);
              }}
            >
              <Text style={styles.switchModeText}>
                {isLoginMode ? "新規登録はこちら" : "ログインに戻る"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// スタイルは前回と同じです
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  inner: { flex: 1, padding: 20 },
  header: { alignItems: "center", marginBottom: 30 },
  appTitle: { fontSize: 28, fontWeight: "bold", color: "#0077cc" },
  subTitle: { fontSize: 14, color: "#666", marginTop: 5 },
  stepContainer: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
    elevation: 3,
  },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  label: { fontSize: 12, fontWeight: "bold", color: "#555", marginBottom: 6 },
  primaryBtn: {
    backgroundColor: "#0077cc",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  primaryBtnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  roleContainer: { flexDirection: "row", marginBottom: 20 },
  roleBtn: {
    flex: 1,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#ddd",
    marginHorizontal: 5,
    borderRadius: 8,
  },
  roleBtnActive: { backgroundColor: "#e6f2ff", borderColor: "#0077cc" },
  roleBtnText: { color: "#666", fontWeight: "bold" },
  roleBtnTextActive: { color: "#0077cc", fontWeight: "bold" },
  switchModeBtn: { marginTop: 20, alignItems: "center" },
  switchModeText: {
    color: "#0077cc",
    textDecorationLine: "underline",
    fontWeight: "bold",
  },
});

export default LoginScreen;
