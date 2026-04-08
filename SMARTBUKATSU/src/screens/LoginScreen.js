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
  const [isLoading, setIsLoading] = useState(false);

  // ★青木さんの本物AuthContextからログイン機能を取得
  const { signIn } = useAuth();

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("エラー", "メールアドレスとパスワードを入力してください。");
      return;
    }

    setIsLoading(true);
    try {
      // Firebaseに本物のログインリクエストを送信
      await signIn(email, password);
      // 成功したらホーム画面へ
      navigation.replace("WorkspaceHome");
    } catch (error) {
      Alert.alert(
        "ログイン失敗",
        "メールアドレスかパスワードが間違っています。\n(またはアカウントが未登録です)",
      );
      console.error(error);
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
          <Text style={styles.subTitle}>ログイン</Text>
        </View>

        <View style={styles.stepContainer}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>メールアドレス</Text>
            <TextInput
              style={styles.input}
              placeholder="例: admin@example.com"
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
              placeholder="パスワードを入力"
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, isLoading && { opacity: 0.7 }]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            <Text style={styles.primaryBtnText}>
              {isLoading ? "ログイン中..." : "ログイン"}
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
  subTitle: { fontSize: 16, color: "#666" },
  stepContainer: {
    backgroundColor: "#fff",
    padding: 20,
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
});

export default LoginScreen;
