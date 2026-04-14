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
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { createTeam, joinTeamWithInvite } from "../services/firestoreService";

const TeamSetupScreen = ({ route, navigation }) => {
  const { user } = useAuth();

  // ★追加：ログイン画面から渡された「役割」と「名前」をしっかり受け取る！
  const initialRole = route.params?.initialRole || "member";
  const userName = route.params?.userName || "ゲスト";

  const [teamName, setTeamName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleCreateTeam = async () => {
    if (!teamName.trim())
      return Alert.alert("エラー", "チーム名を入力してください");

    setIsLoading(true);
    try {
      // ★修正：userName も一緒に送る！
      await createTeam(user.uid, teamName, userName);

      global.TEST_ROLE = null;
      Alert.alert("成功！", "新しいチームを作成し、管理者になりました！");
      navigation.replace("WorkspaceHome");
    } catch (error) {
      Alert.alert("作成失敗", error.message); // ログだけでなく画面にもエラー理由を表示
      console.log(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinTeam = async () => {
    if (!inviteCode.trim())
      return Alert.alert("エラー", "招待コードを入力してください");

    setIsLoading(true);
    try {
      // ★修正：userName も一緒に送る！
      await joinTeamWithInvite(user.uid, inviteCode, userName);

      global.TEST_ROLE = null;
      Alert.alert("成功！", "チームに参加しました！");
      navigation.replace("WorkspaceHome");
    } catch (error) {
      Alert.alert("参加失敗", error.message);
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
          <Text style={styles.subTitle}>初期セットアップ</Text>
        </View>

        {initialRole === "member" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>👤 部員・関係者として参加</Text>
            <Text style={styles.cardDesc}>
              教員から教えられた招待コードを入力してください
            </Text>
            <TextInput
              style={styles.input}
              placeholder="例: A1B2C3"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={handleJoinTeam}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>参加する</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {initialRole === "admin" && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>👑 管理者としてチームを作成</Text>
            <Text style={styles.cardDesc}>
              新しく自分の部活チームを立ち上げます
            </Text>
            <TextInput
              style={styles.input}
              placeholder="例: 野々市高校 サッカー部"
              value={teamName}
              onChangeText={setTeamName}
            />
            <TouchableOpacity
              style={styles.btnPrimary}
              onPress={handleCreateTeam}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>チームを作成する</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5", justifyContent: "center" },
  inner: { padding: 20, width: "100%", maxWidth: 450, alignSelf: "center" },
  header: { alignItems: "center", marginBottom: 30 },
  appTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#0077cc",
    marginBottom: 5,
  },
  subTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  card: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
    elevation: 2,
    marginBottom: 15,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 5,
  },
  cardDesc: { fontSize: 12, color: "#666", marginBottom: 15 },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 15,
  },
  btnPrimary: {
    backgroundColor: "#0077cc",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});

export default TeamSetupScreen;
