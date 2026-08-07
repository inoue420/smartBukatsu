import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";

const EmailVerificationScreen = () => {
  const {
    user,
    refreshEmailVerification,
    resendVerificationEmail,
    signOut,
  } = useAuth();
  const [activeAction, setActiveAction] = useState(null);

  const runAction = async (action, callback) => {
    if (activeAction) return;
    setActiveAction(action);
    try {
      await callback();
    } finally {
      setActiveAction(null);
    }
  };

  const handleRefresh = () =>
    runAction("refresh", async () => {
      try {
        const verified = await refreshEmailVerification();
        if (!verified) {
          Alert.alert(
            "確認待ちです",
            "メール内のリンクを開いた後、もう一度お試しください。",
          );
        }
      } catch (error) {
        console.log("メール確認状態の再取得エラー:", error);
        Alert.alert(
          "確認できませんでした",
          "通信状態を確認して、時間をおいてもう一度お試しください。",
        );
      }
    });

  const handleResend = () =>
    runAction("resend", async () => {
      try {
        await resendVerificationEmail();
        Alert.alert(
          "確認メールを再送しました",
          "受信トレイに見当たらない場合は、迷惑メールフォルダもご確認ください。",
        );
      } catch (error) {
        console.log("確認メール再送エラー:", error);
        Alert.alert(
          "再送できませんでした",
          "短時間に繰り返し送信した場合は、時間をおいてもう一度お試しください。",
        );
      }
    });

  const handleSignOut = () =>
    runAction("signout", async () => {
      try {
        await signOut();
      } catch (error) {
        console.log("ログアウトエラー:", error);
        Alert.alert(
          "ログアウトできませんでした",
          "通信状態を確認して、もう一度お試しください。",
        );
      }
    });

  const isBusy = Boolean(activeAction);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>✉️</Text>
        </View>
        <Text style={styles.title}>メールアドレスを確認してください</Text>
        <Text style={styles.description}>
          登録したメールアドレス宛に確認メールを送信しました。メール内のリンクを開くまで、アプリの主要機能は利用できません。
        </Text>
        <View style={styles.emailBox}>
          <Text style={styles.emailLabel}>送信先</Text>
          <Text style={styles.email}>
            {user?.email || "メールアドレスを確認できません"}
          </Text>
        </View>
        <Text style={styles.hint}>
          リンクを開いた後、この画面へ戻って確認状態を再取得してください。
        </Text>

        <TouchableOpacity
          style={[styles.primaryButton, isBusy && styles.disabledButton]}
          onPress={handleRefresh}
          disabled={isBusy}
        >
          {activeAction === "refresh" ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>確認状態を再取得</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, isBusy && styles.disabledButton]}
          onPress={handleResend}
          disabled={isBusy}
        >
          {activeAction === "resend" ? (
            <ActivityIndicator color="#27ae60" />
          ) : (
            <Text style={styles.secondaryButtonText}>確認メールを再送</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          disabled={isBusy}
        >
          {activeAction === "signout" ? (
            <ActivityIndicator color="#b42318" />
          ) : (
            <Text style={styles.signOutButtonText}>ログアウト</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#27ae60",
  },
  card: {
    borderRadius: 20,
    padding: 24,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  iconCircle: {
    width: 72,
    height: 72,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    borderRadius: 36,
    backgroundColor: "#eaf8ef",
  },
  icon: { fontSize: 34 },
  title: {
    marginBottom: 12,
    color: "#222",
    fontSize: 21,
    fontWeight: "bold",
    textAlign: "center",
  },
  description: {
    color: "#555",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
  emailBox: {
    marginTop: 20,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#f4f6f8",
  },
  emailLabel: {
    marginBottom: 5,
    color: "#777",
    fontSize: 12,
    fontWeight: "bold",
  },
  email: { color: "#222", fontSize: 15, fontWeight: "bold" },
  hint: {
    marginTop: 14,
    marginBottom: 20,
    color: "#777",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
  primaryButton: {
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: "#27ae60",
  },
  primaryButtonText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  secondaryButton: {
    alignItems: "center",
    marginTop: 12,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: "#27ae60",
    borderRadius: 10,
    backgroundColor: "#fff",
  },
  secondaryButtonText: {
    color: "#27ae60",
    fontSize: 14,
    fontWeight: "bold",
  },
  signOutButton: {
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 10,
  },
  signOutButtonText: {
    color: "#b42318",
    fontSize: 13,
    fontWeight: "bold",
  },
  disabledButton: { opacity: 0.6 },
});

export default EmailVerificationScreen;
