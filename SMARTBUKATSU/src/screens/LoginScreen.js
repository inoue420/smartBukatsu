import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "../firebase";

// ★ 追加：Firestoreへの登録処理をインポート
import { executeRegistration } from "../services/firestoreService";

const LoginScreen = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // 共通の入力項目
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // 新規登録用の入力項目
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState("member"); // "admin" or "member"
  const [teamName, setTeamName] = useState(""); // 管理者用
  const [inviteCode, setInviteCode] = useState(""); // 部員用

  const handleAuth = async () => {
    // 1. バリデーション（入力チェック）
    if (!email || !password) {
      return Alert.alert(
        "エラー",
        "メールアドレスとパスワードを入力してください。",
      );
    }

    if (!isLogin) {
      if (!userName.trim()) {
        return Alert.alert("エラー", "お名前（表示名）を入力してください。");
      }
      if (role === "admin" && !teamName.trim()) {
        return Alert.alert("エラー", "作成するチーム名を入力してください。");
      }
      if (role === "member" && !inviteCode.trim()) {
        return Alert.alert("エラー", "招待コードを入力してください。");
      }
    }

    setIsLoading(true);
    try {
      if (isLogin) {
        // === ログイン処理 ===
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        // === 新規登録処理（1ページ完結） ===
        // ① Firebase Auth にユーザーを作成
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        const uid = userCredential.user.uid;

        // ② Firestore にユーザー情報とチーム情報（または所属情報）を書き込む
        await executeRegistration(
          uid,
          role,
          userName.trim(),
          teamName.trim(),
          inviteCode.trim(),
        );

        Alert.alert("登録完了", "アカウントの作成と設定が完了しました！");
      }
    } catch (error) {
      console.log("認証エラー:", error);
      let errorMsg = "エラーが発生しました。";
      if (
        error.message.includes("invalid-credential") ||
        error.message.includes("invalid-email")
      ) {
        errorMsg = "メールアドレスまたはパスワードが間違っています。";
      } else if (error.message.includes("email-already-in-use")) {
        errorMsg = "このメールアドレスは既に登録されています。";
      } else if (error.message.includes("weak-password")) {
        errorMsg = "パスワードは6文字以上で入力してください。";
      } else if (error.message.includes("無効な招待コード")) {
        errorMsg = "招待コードが間違っているか、無効になっています。";
      }
      Alert.alert("エラー", errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setUserName("");
    setTeamName("");
    setInviteCode("");
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.appTitle}>スマート部活 📱</Text>

            {/* タブ切り替え */}
            <View style={styles.tabContainer}>
              <TouchableOpacity
                style={[styles.tabButton, isLogin && styles.tabButtonActive]}
                onPress={() => {
                  setIsLogin(true);
                  resetForm();
                }}
              >
                <Text style={[styles.tabText, isLogin && styles.tabTextActive]}>
                  ログイン
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tabButton, !isLogin && styles.tabButtonActive]}
                onPress={() => {
                  setIsLogin(false);
                  resetForm();
                }}
              >
                <Text
                  style={[styles.tabText, !isLogin && styles.tabTextActive]}
                >
                  新規登録
                </Text>
              </TouchableOpacity>
            </View>

            {/* ====== 新規登録のみ表示するエリア ====== */}
            {!isLogin && (
              <View style={styles.signupSection}>
                <Text style={styles.label}>役割を選択</Text>
                <View style={styles.roleToggleContainer}>
                  <TouchableOpacity
                    style={[
                      styles.roleBtn,
                      role === "member" && styles.roleBtnActive,
                    ]}
                    onPress={() => setRole("member")}
                  >
                    <Text
                      style={[
                        styles.roleBtnText,
                        role === "member" && { color: "#fff" },
                      ]}
                    >
                      👤 部員として参加
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.roleBtn,
                      role === "admin" && styles.roleBtnActive,
                    ]}
                    onPress={() => setRole("admin")}
                  >
                    <Text
                      style={[
                        styles.roleBtnText,
                        role === "admin" && { color: "#fff" },
                      ]}
                    >
                      👑 管理者として作成
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>お名前 (表示名)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="例: 山田 太郎"
                  value={userName}
                  onChangeText={setUserName}
                />

                {role === "admin" ? (
                  <>
                    <Text style={styles.label}>新しく作成するチーム名</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例: ○○高校 男子バレー部"
                      value={teamName}
                      onChangeText={setTeamName}
                    />
                  </>
                ) : (
                  <>
                    <Text style={styles.label}>チームの招待コード</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="監督から共有された6桁のコード"
                      value={inviteCode}
                      onChangeText={setInviteCode}
                      autoCapitalize="characters"
                    />
                  </>
                )}
              </View>
            )}

            {/* ====== 共通エリア (ログイン / 新規登録) ====== */}
            <Text style={styles.label}>メールアドレス</Text>
            <TextInput
              style={styles.input}
              placeholder="email@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.label}>
              パスワード {!isLogin && "(6文字以上)"}
            </Text>
            <TextInput
              style={styles.input}
              placeholder="パスワード"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            {isLoading ? (
              <ActivityIndicator
                size="large"
                color="#27ae60"
                style={{ marginTop: 20 }}
              />
            ) : (
              <TouchableOpacity
                style={styles.submitButton}
                onPress={handleAuth}
              >
                <Text style={styles.submitButtonText}>
                  {isLogin ? "ログイン" : "登録して始める"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#27ae60" },
  keyboardView: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 25,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
    marginBottom: 20,
  },
  tabContainer: {
    flexDirection: "row",
    marginBottom: 25,
    backgroundColor: "#f0f2f5",
    borderRadius: 10,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  tabText: { fontSize: 14, fontWeight: "bold", color: "#888" },
  tabTextActive: { color: "#27ae60" },

  signupSection: {
    marginBottom: 10,
  },
  roleToggleContainer: {
    flexDirection: "row",
    marginBottom: 15,
    gap: 10,
  },
  roleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "#f9f9f9",
  },
  roleBtnActive: {
    backgroundColor: "#27ae60",
    borderColor: "#27ae60",
  },
  roleBtnText: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#666",
  },

  label: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    marginBottom: 15,
    color: "#333",
  },
  submitButton: {
    backgroundColor: "#27ae60",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default LoginScreen;
