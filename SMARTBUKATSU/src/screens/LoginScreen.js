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
  // ★修正：ログインフローを2段階にするためのステート
  const [step, setStep] = useState(1); // 1: チームID入力, 2: ログイン/新規登録
  const [teamId, setTeamId] = useState("");

  const [selectedRole, setSelectedRole] = useState("member");
  const [selectedMember, setSelectedMember] = useState("");
  const [password, setPassword] = useState("");

  const [isRegistering, setIsRegistering] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");

  const handleNextStep = () => {
    if (!teamId.trim()) {
      Alert.alert("エラー", "チームIDを入力してください。");
      return;
    }
    // 本番環境ではここで「チームが存在するか」をデータベースに確認します
    setStep(2);
  };

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
      if (!selectedMember) {
        Alert.alert("エラー", "名前を選択してください。");
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
        "その名前は既に登録されています。ログイン画面に戻って選択してください。",
      );
      return;
    }
    // 部員を追加してログイン画面（選択状態）に戻す
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
          <Text style={styles.subTitle}>
            {step === 1 ? "チームの検索" : "ログイン"}
          </Text>
        </View>

        {/* =========================================================
            ステップ1：チームID入力
        ========================================================= */}
        {step === 1 && (
          <View style={styles.stepContainer}>
            <Text style={styles.label}>チームID (ワークスペースID)</Text>
            <TextInput
              style={styles.input}
              placeholder="例: demo-team"
              value={teamId}
              onChangeText={setTeamId}
              autoCapitalize="none"
            />
            <Text style={styles.hintText}>
              ※プロトタイプ版は任意の文字（例: demo）で進めます
            </Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleNextStep}
            >
              <Text style={styles.primaryBtnText}>次へ進む</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.textLinkContainer}
              onPress={() =>
                Alert.alert(
                  "お知らせ",
                  "プロトタイプ版では新しいチームの作成はスキップし、任意のIDを入力して「次へ進む」を押してください。",
                )
              }
            >
              <Text style={styles.textLink}>
                新しくチームを作成する場合はこちら
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* =========================================================
            ステップ2：ログイン / 新規登録
        ========================================================= */}
        {step === 2 && (
          <View style={styles.stepContainer}>
            {/* 選択中のチームID表示と戻るボタン */}
            <View style={styles.teamIdDisplayRow}>
              <Text style={styles.teamIdText}>
                チームID:{" "}
                <Text style={{ fontWeight: "bold", color: "#333" }}>
                  {teamId}
                </Text>
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setStep(1);
                  setIsRegistering(false);
                }}
              >
                <Text style={styles.changeTeamText}>変更</Text>
              </TouchableOpacity>
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
                  setIsRegistering(false);
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
                  setIsRegistering(false);
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

            {selectedRole === "member" && isRegistering ? (
              /* --- 新規登録モード --- */
              <View>
                <Text style={styles.label}>新しい部員の名前を登録</Text>
                <TextInput
                  style={styles.input}
                  placeholder="名前を入力"
                  value={newMemberName}
                  onChangeText={setNewMemberName}
                />
                <Text style={styles.hintText}>
                  ※登録後は初期パスワード「{memberPassword}
                  」でログインできます。
                </Text>

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleRegister}
                >
                  <Text style={styles.primaryBtnText}>
                    登録してログイン画面へ
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.textLinkContainer}
                  onPress={() => setIsRegistering(false)}
                >
                  <Text style={styles.textLink}>
                    既存のアカウントでログインする
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* --- ログインモード --- */
              <View>
                {selectedRole === "member" && (
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>名前を選択</Text>
                    <ScrollView
                      style={styles.memberScroll}
                      nestedScrollEnabled={true}
                    >
                      <View style={styles.memberList}>
                        {clubMembers.map((name) => (
                          <TouchableOpacity
                            key={name}
                            style={[
                              styles.memberBadge,
                              selectedMember === name &&
                                styles.memberBadgeActive,
                            ]}
                            onPress={() => setSelectedMember(name)}
                          >
                            <Text
                              style={[
                                styles.memberBadgeText,
                                selectedMember === name &&
                                  styles.memberBadgeTextActive,
                              ]}
                            >
                              {name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
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

                  {selectedRole === "member" ? (
                    <Text style={styles.hintText}>
                      ※個人パスワード未設定の場合は「{memberPassword}」
                    </Text>
                  ) : (
                    <Text style={styles.hintText}>
                      ※管理者の初期パスワードは「{adminPassword}」です
                    </Text>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleLogin}
                >
                  <Text style={styles.primaryBtnText}>ログイン</Text>
                </TouchableOpacity>

                {selectedRole === "member" && (
                  <TouchableOpacity
                    style={styles.textLinkContainer}
                    onPress={() => setIsRegistering(true)}
                  >
                    <Text style={styles.textLink}>
                      自分の名前がない場合はこちら (新規登録)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5", justifyContent: "center" },
  inner: { padding: 20, width: "100%", maxWidth: 400, alignSelf: "center" },
  header: { alignItems: "center", marginBottom: 20 },
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },

  teamIdDisplayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#eee",
  },
  teamIdText: { fontSize: 14, color: "#666" },
  changeTeamText: { fontSize: 13, color: "#0077cc", fontWeight: "bold" },

  roleContainer: {
    flexDirection: "row",
    marginBottom: 20,
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 4,
  },
  roleBtn: {
    flex: 1,
    paddingVertical: 10,
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
  roleBtnText: { fontSize: 14, fontWeight: "bold", color: "#888" },
  roleBtnTextActive: { color: "#0077cc" },

  inputGroup: { marginBottom: 15 },
  label: { fontSize: 13, fontWeight: "bold", color: "#555", marginBottom: 8 },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  hintText: { fontSize: 11, color: "#888", marginTop: 5 },

  memberScroll: { maxHeight: 120 },
  memberList: { flexDirection: "row", flexWrap: "wrap" },
  memberBadge: {
    backgroundColor: "#f9f9f9",
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

  primaryBtn: {
    backgroundColor: "#0077cc",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },

  textLinkContainer: { marginTop: 20, alignItems: "center" },
  textLink: { color: "#0077cc", fontSize: 13, fontWeight: "bold" },
});

export default LoginScreen;
