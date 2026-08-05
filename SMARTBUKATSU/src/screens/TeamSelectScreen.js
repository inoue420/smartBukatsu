import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { useAuth } from "../AuthContext";
import {
  createTeam,
  getUserTeams,
  joinTeamWithInvite,
  MAX_TEAMS_PER_USER,
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

  const canAddTeam = (teamIds?.length || 0) < MAX_TEAMS_PER_USER;
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

    const timer = setTimeout(() => {
      if (navigation.canGoBack()) {
        navigation.goBack();
        return;
      }

      navigation.replace("WorkspaceHome");
    }, 100);

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
    if (!canAddTeam) {
      return Alert.alert(
        "上限に達しています",
        `所属できるチームは最大${MAX_TEAMS_PER_USER}件までです。`,
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
    if (!canAddTeam) {
      return Alert.alert(
        "上限に達しています",
        `所属できるチームは最大${MAX_TEAMS_PER_USER}件までです。`,
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
              <Text style={styles.subtitle}>所属 {teams.length} / {MAX_TEAMS_PER_USER}</Text>
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
              placeholder="招待コード"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              editable={canAddTeam && !isJoining}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, (!canAddTeam || isJoining) && styles.btnDisabled]}
              onPress={handleJoinTeam}
              disabled={!canAddTeam || isJoining}
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
              editable={canAddTeam && !isCreating}
            />
            <TouchableOpacity
              style={[styles.secondaryBtn, (!canAddTeam || isCreating) && styles.btnDisabled]}
              onPress={handleCreateTeam}
              disabled={!canAddTeam || isCreating}
            >
              {isCreating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>作成する</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
});

export default TeamSelectScreen;
