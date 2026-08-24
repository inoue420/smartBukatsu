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
  Modal, // ★ 追加：ポップアップ表示用
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import {
  MINIMUM_USER_AGE,
  SMARTBUKATSU_PRIVACY_URL,
  SMARTBUKATSU_TERMS_URL,
} from "../legal";

const LoginScreen = () => {
  const { signIn, signUp, resetPassword } = useAuth();
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
  const [eligibilityConfirmed, setEligibilityConfirmed] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);

  // ★ 追加：パスワードリセット用の状態
  const [isResetModalVisible, setIsResetModalVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

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
      if (!eligibilityConfirmed) {
        return Alert.alert(
          "年齢・同意条件の確認",
          `${MINIMUM_USER_AGE}歳以上であることと、18歳未満の場合の同意条件を確認してください。`,
        );
      }
      if (!legalAccepted) {
        return Alert.alert(
          "利用条件の確認",
          "利用規約とプライバシーポリシーを確認し、同意してください。",
        );
      }
    }

    setIsLoading(true);
    try {
      if (isLogin) {
        // === ログイン処理 ===
        await signIn(email, password);
      } else {
        // === 新規登録処理（1ページ完結） ===
        await signUp(
          email,
          password,
          {
            role,
            userName: userName.trim(),
            teamName: teamName.trim(),
            inviteCode: inviteCode.trim(),
            legalConsent: {
              minimumAgeConfirmed: true,
              minorConsentRequirementAcknowledged: true,
              termsAccepted: true,
              privacyPolicyAcknowledged: true,
            },
          },
        );

        Alert.alert(
          "確認メールを送信しました",
          "メール内のリンクを開いてメールアドレスを確認してください。",
        );
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
        errorMsg = "このメールアドレスは既に登録されています。既存アカウントでログイン後、ホーム上部のチーム名から新しいチームを追加してください。";
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

  // ★ 追加：パスワードリセットの送信処理
  const handlePasswordReset = async () => {
    if (!resetEmail.trim()) {
      return Alert.alert("エラー", "メールアドレスを入力してください。");
    }

    try {
      await resetPassword(resetEmail);
      Alert.alert(
        "メール送信完了",
        "パスワード再設定用のメールを送信しました。\nメール内のリンクから新しいパスワードを設定してください。",
      );
      setIsResetModalVisible(false);
      setResetEmail("");
    } catch (error) {
      console.log("パスワードリセットエラー:", error);
      let errorMsg =
        "メールの送信に失敗しました。時間をおいて再度お試しください。";
      if (error.code === "auth/user-not-found") {
        errorMsg = "このメールアドレスは登録されていません。";
      } else if (error.code === "auth/invalid-email") {
        errorMsg = "メールアドレスの形式が正しくありません。";
      }
      Alert.alert("エラー", errorMsg);
    }
  };

  const resetForm = () => {
    setEmail("");
    setPassword("");
    setUserName("");
    setTeamName("");
    setInviteCode("");
    setEligibilityConfirmed(false);
    setLegalAccepted(false);
  };

  const openLegalPage = async (url, pageName) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      console.log(`${pageName}を開けませんでした:`, error);
      Alert.alert(
        "ページを開けません",
        `${pageName}を開けませんでした。通信環境をご確認ください。`,
      );
    }
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
                      placeholder="例: aB3xY7（大文字・小文字を区別）"
                      value={inviteCode}
                      onChangeText={setInviteCode}
                      autoCapitalize="none"
                      autoCorrect={false}
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
              autoCorrect={false}
              autoComplete={isLogin ? "username" : "email"}
              textContentType={isLogin ? "username" : "emailAddress"}
              importantForAutofill="yes"
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
              autoComplete={isLogin ? "current-password" : "new-password"}
              textContentType={isLogin ? "password" : "newPassword"}
              passwordRules={isLogin ? undefined : "minlength: 6;"}
              importantForAutofill="yes"
            />

            {!isLogin && (
              <View style={styles.consentContainer}>
                <TouchableOpacity
                  style={styles.consentRow}
                  onPress={() => setEligibilityConfirmed((value) => !value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: eligibilityConfirmed }}
                >
                  <View
                    style={[
                      styles.checkbox,
                      eligibilityConfirmed && styles.checkboxChecked,
                    ]}
                  >
                    {eligibilityConfirmed && (
                      <Text style={styles.checkboxMark}>✓</Text>
                    )}
                  </View>
                  <Text style={styles.consentText}>
                    私は{MINIMUM_USER_AGE}
                    歳以上です。18歳未満の場合は、保護者または所属団体責任者の同意・管理のもとで利用します。
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.consentRow}
                  onPress={() => setLegalAccepted((value) => !value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: legalAccepted }}
                >
                  <View
                    style={[
                      styles.checkbox,
                      legalAccepted && styles.checkboxChecked,
                    ]}
                  >
                    {legalAccepted && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                  <Text style={styles.consentText}>
                    利用規約とプライバシーポリシーに同意します。
                  </Text>
                </TouchableOpacity>

                <View style={styles.legalLinksRow}>
                  <TouchableOpacity
                    onPress={() =>
                      openLegalPage(SMARTBUKATSU_TERMS_URL, "利用規約")
                    }
                  >
                    <Text style={styles.legalLink}>利用規約を確認</Text>
                  </TouchableOpacity>
                  <Text style={styles.legalLinkSeparator}>／</Text>
                  <TouchableOpacity
                    onPress={() =>
                      openLegalPage(
                        SMARTBUKATSU_PRIVACY_URL,
                        "プライバシーポリシー",
                      )
                    }
                  >
                    <Text style={styles.legalLink}>
                      プライバシーポリシーを確認
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

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

            {/* ★ 追加：パスワードを忘れた場合のリンク（ログイン時のみ表示） */}
            {isLogin && !isLoading && (
              <TouchableOpacity
                style={{ marginTop: 20, alignItems: "center" }}
                onPress={() => {
                  setResetEmail(email); // 入力途中のメールアドレスがあれば引き継ぐ
                  setIsResetModalVisible(true);
                }}
              >
                <Text
                  style={{ color: "#27ae60", fontWeight: "bold", fontSize: 13 }}
                >
                  パスワードを忘れた方はこちら
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ★ 追加：パスワードリセット用モーダル */}
      <Modal
        visible={isResetModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>パスワードの再設定</Text>
            <Text style={styles.modalText}>
              登録したメールアドレスを入力してください。再設定用のリンクをお送りします。
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="email@example.com"
              value={resetEmail}
              onChangeText={setResetEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              importantForAutofill="yes"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setIsResetModalVisible(false);
                  setResetEmail("");
                }}
              >
                <Text style={styles.modalCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handlePasswordReset}
              >
                <Text style={styles.modalSubmitText}>送信する</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  consentContainer: {
    marginTop: 2,
    marginBottom: 4,
    padding: 12,
    backgroundColor: "#f7fbf8",
    borderWidth: 1,
    borderColor: "#d6eadc",
    borderRadius: 10,
  },
  consentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#9aa5a0",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxChecked: {
    backgroundColor: "#27ae60",
    borderColor: "#27ae60",
  },
  checkboxMark: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
    lineHeight: 18,
  },
  consentText: {
    flex: 1,
    color: "#444",
    fontSize: 12,
    lineHeight: 18,
  },
  legalLinksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  legalLink: {
    color: "#1677c8",
    fontSize: 12,
    fontWeight: "bold",
    textDecorationLine: "underline",
  },
  legalLinkSeparator: {
    color: "#888",
    fontSize: 12,
  },

  // ★ 追加：モーダル用のスタイル
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "#fff",
    padding: 25,
    borderRadius: 12,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
    color: "#333",
    textAlign: "center",
  },
  modalText: {
    fontSize: 13,
    color: "#666",
    marginBottom: 20,
    lineHeight: 18,
  },
  modalInput: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginRight: 10,
  },
  modalCancelText: {
    color: "#888",
    fontWeight: "bold",
    fontSize: 14,
  },
  modalSubmitBtn: {
    backgroundColor: "#27ae60",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  modalSubmitText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
});

export default LoginScreen;
