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
import { useAuth } from "../AuthContext";

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const { signIn, signUp } = useAuth();

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert("エラー", "メールアドレスとパスワードを入力してください。");
      return;
    }

    setIsLoading(true);
    try {
      if (isLoginMode) {
        await signIn(email.trim(), password);
        // ★ ログイン成功したら、直接ホームではなく「セットアップ画面」へ！
        navigation.replace("TeamSetup");
      } else {
        await signUp(email.trim(), password);
        // ★ 新規登録後も「セットアップ画面」へ！
        navigation.replace("TeamSetup");
      }
    } catch (error) {
      Alert.alert(
        "認証エラー",
        "メールアドレスかパスワードが間違っています（パスワードは6文字以上）。",
      );
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
        <View style={styles.header}>
          <Text style={styles.appTitle}>📱 スマート部活</Text>
          <Text style={styles.subTitle}>
            {isLoginMode ? "ログイン" : "新規アカウント作成"}
          </Text>
        </View>

        <View style={styles.stepContainer}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>メールアドレス</Text>
            <TextInput
              style={styles.input}
              placeholder="例: user@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>パスワード</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              placeholder="6文字以上で入力"
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, isLoading && { opacity: 0.7 }]}
            onPress={handleAuth}
            disabled={isLoading}
          >
            <Text style={styles.primaryBtnText}>
              {isLoading
                ? "処理中..."
                : isLoginMode
                  ? "次へ"
                  : "アカウントを作成して次へ"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchModeBtn}
            onPress={() => setIsLoginMode(!isLoginMode)}
          >
            <Text style={styles.switchModeText}>
              {isLoginMode
                ? "初めての方はこちら（新規登録）"
                : "すでにアカウントをお持ちの方（ログイン）"}
            </Text>
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
  subTitle: { fontSize: 16, color: "#666", fontWeight: "bold" },
  stepContainer: {
    backgroundColor: "#fff",
    padding: 25,
    borderRadius: 12,
    elevation: 3,
  },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: "bold", color: "#555", marginBottom: 8 },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  primaryBtn: {
    backgroundColor: "#0077cc",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  switchModeBtn: { marginTop: 20, alignItems: "center", paddingVertical: 10 },
  switchModeText: {
    color: "#0077cc",
    fontSize: 14,
    fontWeight: "bold",
    textDecorationLine: "underline",
  },
});

export default LoginScreen;
