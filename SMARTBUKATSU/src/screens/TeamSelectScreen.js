import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
import {
  checkAccountDeletionEligibility,
  createTeam,
  deleteCurrentUserAccount,
  getMaxTeamsForMemberships,
  getUserTeams,
  joinTeamWithInvite,
  SHARP_RISE_MAX_TEAMS_PER_USER,
} from "../services/firestoreService";

const roleLabels = {
  owner: "監督",
  admin: "管理者",
  staff: "スタッフ",
  captain: "キャプテン",
  guardian: "保護者",
  member: "部員",
};

const TeamSelectScreen = ({ navigation }) => {
  const { user, userName, activeTeamId, teamIds, selectTeam, signOut } = useAuth();
  const [teams, setTeams] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyTeamId, setBusyTeamId] = useState(null);
  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [shouldReturnHome, setShouldReturnHome] = useState(false);
  const [isAccountDeleteModalVisible, setIsAccountDeleteModalVisible] =
    useState(false);
  const [accountDeletePassword, setAccountDeletePassword] = useState("");
  const [showAccountDeletePassword, setShowAccountDeletePassword] =
    useState(false);
  const [isCheckingAccountDeletion, setIsCheckingAccountDeletion] =
    useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const teamCount = teamIds?.length || 0;
  const maxTeamsPerUser = getMaxTeamsForMemberships(teams);
  const joinTeamLimit = getMaxTeamsForMemberships(teams, inviteCode);
  const canCreateTeam = teamCount < maxTeamsPerUser;
  const canJoinTeam = teamCount < joinTeamLimit;
  const canEnterInviteCode = teamCount < SHARP_RISE_MAX_TEAMS_PER_USER;
  const canGoBack = navigation.canGoBack();

  const loadTeams = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    try {
      const userTeams = await getUserTeams(user.uid);
      setTeams(userTeams);
    } catch (error) {
      console.log("所属チーム取得エラー:", error);
      Alert.alert("エラー", "所属チームの取得に失敗しました。");
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      loadTeams();
    }, [loadTeams, teamIds?.length, activeTeamId]),
  );

  useEffect(() => {
    if (!shouldReturnHome || !activeTeamId) return undefined;

    let timer;
    let attempts = 0;
    const returnToWorkspaceHome = () => {
      if (navigation.canGoBack()) {
        setShouldReturnHome(false);
        navigation.goBack();
        return;
      }

      const routeNames = navigation.getState()?.routeNames || [];
      if (routeNames.includes("WorkspaceHome")) {
        setShouldReturnHome(false);
        navigation.reset({
          index: 0,
          routes: [{ name: "WorkspaceHome" }],
        });
        return;
      }

      attempts += 1;
      if (attempts < 20) {
        timer = setTimeout(returnToWorkspaceHome, 50);
        return;
      }

      setShouldReturnHome(false);
    };

    timer = setTimeout(returnToWorkspaceHome, 50);

    return () => clearTimeout(timer);
  }, [activeTeamId, navigation, shouldReturnHome]);

  const handleSelectTeam = async (teamId) => {
    setBusyTeamId(teamId);
    try {
      await selectTeam(teamId);
      setShouldReturnHome(true);
    } catch (error) {
      console.log("チーム切替エラー:", error);
      Alert.alert("エラー", error.message || "チームの切替に失敗しました。");
    } finally {
      setBusyTeamId(null);
    }
  };

  const handleCreateTeam = async () => {
    if (!canCreateTeam) {
      return Alert.alert(
        "上限に達しています",
        `所属できるチームは最大${maxTeamsPerUser}件までです。`,
      );
    }
    if (!teamName.trim()) {
      return Alert.alert("エラー", "チーム名を入力してください。");
    }

    setIsCreating(true);
    try {
      const result = await createTeam(user.uid, teamName, userName);
      await selectTeam(result.teamId);
      setTeamName("");
      await loadTeams();
      Alert.alert(
        "チームを作成しました",
        `招待コード: ${result.inviteCode}`,
      );
      setShouldReturnHome(true);
    } catch (error) {
      console.log("チーム作成エラー:", error);
      Alert.alert("エラー", error.message || "チームの作成に失敗しました。");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinTeam = async () => {
    if (!canJoinTeam) {
      return Alert.alert(
        "上限に達しています",
        `所属できるチームは最大${joinTeamLimit}件までです。`,
      );
    }
    if (!inviteCode.trim()) {
      return Alert.alert("エラー", "招待コードを入力してください。");
    }

    setIsJoining(true);
    try {
      const result = await joinTeamWithInvite(user.uid, inviteCode, userName);
      await selectTeam(result.teamId);
      setInviteCode("");
      await loadTeams();
      Alert.alert("チームに参加しました", "選択中のチームを切り替えました。");
      setShouldReturnHome(true);
    } catch (error) {
      console.log("チーム参加エラー:", error);
      Alert.alert("エラー", error.message || "チームへの参加に失敗しました。");
    } finally {
      setIsJoining(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert("ログアウト", "ログアウトしてよろしいですか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "ログアウト",
        style: "destructive",
        onPress: async () => {
          setIsSigningOut(true);
          try {
            await signOut();
          } catch (error) {
            console.log("ログアウトエラー:", error);
            Alert.alert("エラー", "ログアウトに失敗しました。");
          } finally {
            setIsSigningOut(false);
          }
        },
      },
    ]);
  };

  const formatBlockingTeams = (blockingTeams = []) =>
    blockingTeams
      .map((team) => team?.teamName || team?.teamId)
      .filter(Boolean)
      .map((blockingTeamName) => `・${blockingTeamName}`)
      .join("\n");

  const handleOpenBlockingTeamManagement = async (blockingTeam) => {
    if (!blockingTeam?.teamId || busyTeamId) return;

    setBusyTeamId(blockingTeam.teamId);
    try {
      await selectTeam(blockingTeam.teamId);
      setShouldReturnHome(true);
      Alert.alert(
        "対象チームを選択しました",
        `${blockingTeam.teamName || "対象チーム"} のホーム画面から設定を開き、「チーム所有権の移管」を行ってください。`,
      );
    } catch (error) {
      console.log("所有チーム選択エラー:", error?.code || error?.message);
      Alert.alert(
        "エラー",
        "対象チームを選択できませんでした。通信状態を確認してください。",
      );
    } finally {
      setBusyTeamId(null);
    }
  };

  const showAccountDeletionError = (error) => {
    const errorCode = String(error?.code || "");
    const blockingTeams = error?.details?.blockingTeams || [];

    if (blockingTeams.length > 0) {
      const firstBlockingTeam = blockingTeams[0];
      Alert.alert(
        "アカウントを削除できません",
        "作成者として残っているチームがあります。チーム削除または所有権移管を先に完了してください。複数ある場合は1チームずつ処理します。\n\n" +
          formatBlockingTeams(blockingTeams),
        [
          { text: "閉じる", style: "cancel" },
          {
            text: "対象チームを選択",
            onPress: () =>
              handleOpenBlockingTeamManagement(firstBlockingTeam),
          },
        ],
      );
      return;
    }
    if (
      errorCode.includes("auth/invalid-credential") ||
      errorCode.includes("auth/wrong-password")
    ) {
      Alert.alert("本人確認エラー", "現在のパスワードが正しくありません。");
      return;
    }
    if (
      errorCode.includes("auth/too-many-requests") ||
      errorCode.includes("auth/user-disabled")
    ) {
      Alert.alert(
        "本人確認エラー",
        "現在は本人確認を行えません。時間をおいてから再度お試しください。",
      );
      return;
    }
    if (
      errorCode.includes("failed-precondition") &&
      error?.details?.reason === "recent-auth-required"
    ) {
      Alert.alert(
        "再認証が必要です",
        "本人確認の有効時間が切れました。パスワードを再入力してください。",
      );
      return;
    }

    Alert.alert(
      "アカウント削除エラー",
      "アカウントを削除できませんでした。通信状態を確認し、時間をおいて再度お試しください。",
    );
  };

  const handleOpenAccountDeletion = async () => {
    if (isCheckingAccountDeletion || isDeletingAccount) return;

    setIsCheckingAccountDeletion(true);
    try {
      const result = await checkAccountDeletionEligibility();
      const blockingTeams = result?.blockingTeams || [];
      if (!result?.eligible || blockingTeams.length > 0) {
        showAccountDeletionError({
          code: "failed-precondition",
          details: { blockingTeams },
        });
        return;
      }

      setAccountDeletePassword("");
      setShowAccountDeletePassword(false);
      setIsAccountDeleteModalVisible(true);
    } catch (error) {
      console.log("アカウント削除可否確認エラー:", error?.code || error?.message);
      showAccountDeletionError(error);
    } finally {
      setIsCheckingAccountDeletion(false);
    }
  };

  const performAccountDeletion = async () => {
    setIsDeletingAccount(true);
    try {
      await deleteCurrentUserAccount();
      setIsAccountDeleteModalVisible(false);
      setAccountDeletePassword("");
      if (userName) {
        try {
          await AsyncStorage.removeItem(`diary_draft_${userName}`);
        } catch (storageError) {
          console.log(
            "削除完了後の端末下書き削除エラー:",
            storageError?.message,
          );
        }
      }
      try {
        await signOut();
      } catch (signOutError) {
        console.log(
          "削除完了後のログアウトエラー:",
          signOutError?.code || signOutError?.message,
        );
      }
      Alert.alert(
        "アカウント削除完了",
        "アカウントと個人データを削除しました。同じメールアドレスで再登録しても、以前のデータは復元されません。",
      );
    } catch (error) {
      console.log("アカウント削除エラー:", error?.code || error?.message);
      showAccountDeletionError(error);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleConfirmAccountDeletion = async () => {
    const currentAuthUser = auth.currentUser;
    if (!currentAuthUser?.email) {
      Alert.alert(
        "本人確認エラー",
        "メールアドレスでログイン中のユーザーを確認できませんでした。",
      );
      return;
    }
    if (!accountDeletePassword) {
      Alert.alert("入力エラー", "現在のパスワードを入力してください。");
      return;
    }

    setIsDeletingAccount(true);
    try {
      const credential = EmailAuthProvider.credential(
        currentAuthUser.email,
        accountDeletePassword,
      );
      await reauthenticateWithCredential(currentAuthUser, credential);
      await currentAuthUser.getIdToken(true);
      setIsDeletingAccount(false);

      Alert.alert(
        "最終確認",
        "この操作は取り消せません。すべての所属チームから退会し、プロフィール・個人予定・認証情報を削除します。アカウントを完全に削除しますか？",
        [
          { text: "キャンセル", style: "cancel" },
          {
            text: "完全に削除する",
            style: "destructive",
            onPress: performAccountDeletion,
          },
        ],
      );
    } catch (error) {
      console.log("アカウント削除の本人確認エラー:", error?.code || error?.message);
      showAccountDeletionError(error);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <View style={styles.titleBox}>
              <Text style={styles.title}>チーム管理</Text>
              <Text style={styles.subtitle}>所属 {teams.length} / {maxTeamsPerUser}</Text>
            </View>
            <View style={styles.headerActions}>
              {canGoBack && (
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={() => navigation.goBack()}
                  disabled={isSigningOut}
                >
                  <Text style={styles.closeBtnText}>閉じる</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[
                  styles.signOutBtn,
                  isSigningOut && styles.signOutBtnDisabled,
                ]}
                onPress={handleSignOut}
                disabled={isSigningOut}
              >
                {isSigningOut ? (
                  <ActivityIndicator size="small" color="#b42318" />
                ) : (
                  <Text style={styles.signOutBtnText}>ログアウト</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#0077cc" />
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>所属チーム</Text>
              {teams.map((team) => {
                const isActive = team.id === activeTeamId;
                return (
                  <TouchableOpacity
                    key={team.id}
                    style={[styles.teamItem, isActive && styles.teamItemActive]}
                    onPress={() => handleSelectTeam(team.id)}
                    disabled={busyTeamId === team.id}
                    activeOpacity={0.8}
                  >
                    <View style={styles.teamTextBox}>
                      <Text style={styles.teamName} numberOfLines={1}>
                        {team.name}
                      </Text>
                      <Text style={styles.teamRole} numberOfLines={1}>
                        {roleLabels[team.role] || "部員"}
                      </Text>
                    </View>
                    {busyTeamId === team.id ? (
                      <ActivityIndicator color="#0077cc" />
                    ) : (
                      <Text style={[styles.statusText, isActive && styles.statusTextActive]}>
                        {isActive ? "選択中" : "選択"}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}

              {teams.length === 0 && (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>所属チームがありません。</Text>
                </View>
              )}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>招待コードで参加</Text>
            <TextInput
              style={styles.input}
              placeholder="例: aB3xY7（大文字・小文字を区別）"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="none"
              autoCorrect={false}
              editable={canEnterInviteCode && !isJoining}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, (!canJoinTeam || isJoining) && styles.btnDisabled]}
              onPress={handleJoinTeam}
              disabled={!canJoinTeam || isJoining}
            >
              {isJoining ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>参加する</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>監督として新規作成</Text>
            <TextInput
              style={styles.input}
              placeholder="チーム名"
              value={teamName}
              onChangeText={setTeamName}
              editable={canCreateTeam && !isCreating}
            />
            <TouchableOpacity
              style={[styles.secondaryBtn, (!canCreateTeam || isCreating) && styles.btnDisabled]}
              onPress={handleCreateTeam}
              disabled={!canCreateTeam || isCreating}
            >
              {isCreating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>作成する</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.accountDeleteContainer}>
            <Text style={styles.accountDeleteTitle}>アカウントの削除</Text>
            <Text style={styles.accountDeleteDescription}>
              すべての所属チームから退会し、プロフィール・個人予定・ログイン情報を削除します。作成者として残っているチームがある場合は、対象チームの設定から所有権を移管できます。
            </Text>
            <TouchableOpacity
              style={[
                styles.accountDeleteBtn,
                (isCheckingAccountDeletion || isDeletingAccount) && {
                  opacity: 0.6,
                },
              ]}
              onPress={handleOpenAccountDeletion}
              disabled={isCheckingAccountDeletion || isDeletingAccount}
            >
              {isCheckingAccountDeletion ? (
                <ActivityIndicator color="#c0392b" />
              ) : (
                <Text style={styles.accountDeleteBtnText}>
                  アカウントを削除
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={isAccountDeleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeletingAccount) setIsAccountDeleteModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.accountDeleteModalTitle}>
              アカウントを削除
            </Text>
            <Text style={styles.accountDeleteModalWarning}>
              削除後は元に戻せません。本人確認のため、現在のパスワードを入力してください。
            </Text>
            <Text style={styles.modalLabel}>現在のパスワード</Text>
            <View style={styles.passwordRow}>
              <TextInput
                style={styles.passwordInput}
                placeholder="現在のパスワード"
                secureTextEntry={!showAccountDeletePassword}
                value={accountDeletePassword}
                onChangeText={setAccountDeletePassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isDeletingAccount}
              />
              <TouchableOpacity
                style={styles.passwordToggleBtn}
                onPress={() =>
                  setShowAccountDeletePassword(!showAccountDeletePassword)
                }
                disabled={isDeletingAccount}
              >
                <Text style={styles.passwordToggleBtnText}>
                  {showAccountDeletePassword ? "隠す" : "表示"}
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[
                styles.accountDeleteConfirmBtn,
                isDeletingAccount && { opacity: 0.7 },
              ]}
              onPress={handleConfirmAccountDeletion}
              disabled={isDeletingAccount}
            >
              {isDeletingAccount ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.accountDeleteConfirmBtnText}>
                  本人確認して削除手続きへ
                </Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                setIsAccountDeleteModalVisible(false);
                setAccountDeletePassword("");
              }}
              disabled={isDeletingAccount}
            >
              <Text style={styles.cancelBtnText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  keyboardView: { flex: 1 },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    padding: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  titleBox: { flex: 1, marginRight: 12 },
  title: { fontSize: 24, fontWeight: "bold", color: "#222" },
  subtitle: { fontSize: 13, fontWeight: "bold", color: "#0077cc", marginTop: 3 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  closeBtn: {
    borderWidth: 1,
    borderColor: "#dce2e8",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  closeBtnText: { color: "#333", fontSize: 13, fontWeight: "bold" },
  signOutBtn: {
    minWidth: 86,
    borderWidth: 1,
    borderColor: "#f0b4ae",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fff5f4",
  },
  signOutBtnDisabled: { opacity: 0.6 },
  signOutBtnText: { color: "#b42318", fontSize: 13, fontWeight: "bold" },
  section: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#e4e8ee",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
  },
  loadingBox: {
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 30,
    marginBottom: 14,
    alignItems: "center",
  },
  teamItem: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: "#dce2e8",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  teamItemActive: {
    borderColor: "#0077cc",
    backgroundColor: "#eef7ff",
  },
  teamTextBox: { flex: 1, marginRight: 12 },
  teamName: { fontSize: 16, fontWeight: "bold", color: "#222" },
  teamRole: { fontSize: 12, color: "#667085", marginTop: 4 },
  statusText: { fontSize: 13, fontWeight: "bold", color: "#0077cc" },
  statusTextActive: { color: "#1f7a3f" },
  emptyBox: { paddingVertical: 12 },
  emptyText: { color: "#667085", fontSize: 14 },
  input: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dce2e8",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 12,
    color: "#222",
  },
  primaryBtn: {
    backgroundColor: "#0077cc",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  secondaryBtn: {
    backgroundColor: "#1f7a3f",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnDisabled: { backgroundColor: "#9aa7b2" },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  accountDeleteContainer: {
    marginBottom: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f5b7b1",
    borderRadius: 10,
    backgroundColor: "#fff8f7",
  },
  accountDeleteTitle: {
    color: "#922b21",
    fontSize: 15,
    fontWeight: "bold",
    marginBottom: 8,
  },
  accountDeleteDescription: {
    color: "#7b241c",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  accountDeleteBtn: {
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#c0392b",
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  accountDeleteBtnText: {
    color: "#c0392b",
    fontSize: 14,
    fontWeight: "bold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 440,
    alignSelf: "center",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  accountDeleteModalTitle: {
    color: "#c0392b",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
  },
  accountDeleteModalWarning: {
    color: "#7b241c",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 18,
  },
  modalLabel: {
    color: "#555",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 5,
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  passwordInput: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#dce2e8",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: "#222",
  },
  passwordToggleBtn: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#dce2e8",
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  passwordToggleBtnText: {
    color: "#333",
    fontSize: 13,
    fontWeight: "bold",
  },
  accountDeleteConfirmBtn: {
    backgroundColor: "#c0392b",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  accountDeleteConfirmBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  cancelBtn: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: {
    color: "#667085",
    fontSize: 14,
    fontWeight: "bold",
  },
});

export default TeamSelectScreen;
