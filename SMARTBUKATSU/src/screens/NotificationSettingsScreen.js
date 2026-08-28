import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { useNotifications } from "../NotificationContext";
import { NOTIFICATION_CATEGORIES } from "../notifications/notificationConfig";
import { getUserTeams } from "../services/firestoreService";

const DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE = 3;

function getScheduleNotificationWindowDays(value) {
  const daysBefore = Number(value);
  const normalizedDaysBefore =
    Number.isInteger(daysBefore) && daysBefore >= 0 && daysBefore <= 365
      ? daysBefore
      : DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE;
  return normalizedDaysBefore + 1;
}

export default function NotificationSettingsScreen({ navigation }) {
  const { user } = useAuth();
  const {
    preferences,
    permissionStatus,
    isSavingPreferences,
    updatePreferences,
    enablePushNotifications,
  } = useNotifications();
  const [teams, setTeams] = useState([]);

  const getCategoryDescription = (key, category) => {
    if (key !== "schedule") return category.description;
    if (teams.length === 0) {
      return `直近${getScheduleNotificationWindowDays()}日以内の変更`;
    }
    return teams
      .map(
        (team) =>
          `${team.name}: 直近${getScheduleNotificationWindowDays(
            team.absenceDeadlineDaysBefore,
          )}日以内の変更`,
      )
      .join("\n");
  };

  useEffect(() => {
    if (!user?.uid) return;
    getUserTeams(user.uid).then(setTeams).catch((error) => {
      console.log("通知設定チーム取得エラー:", error?.message);
    });
  }, [user?.uid]);

  const toggleMaster = async (enabled) => {
    try {
      if (enabled) {
        const result = await enablePushNotifications();
        if (!result?.granted) {
          Alert.alert(
            "通知が許可されていません",
            "端末設定でSMARTBUKATSUの通知を許可してください。アプリ内通知は引き続き利用できます。",
            [
              { text: "閉じる", style: "cancel" },
              { text: "端末設定を開く", onPress: Linking.openSettings },
            ],
          );
        }
        return;
      }
      await updatePreferences({ ...preferences, masterEnabled: false });
    } catch (error) {
      Alert.alert("保存できませんでした", error?.message || "通信状態を確認してください。");
    }
  };

  const toggleCategory = (category, enabled) =>
    updatePreferences({
      ...preferences,
      categories: { ...preferences.categories, [category]: enabled },
    }).catch((error) => {
      Alert.alert("保存できませんでした", error?.message || "通信状態を確認してください。");
    });

  const toggleTeam = (teamId, enabled) =>
    updatePreferences({
      ...preferences,
      teamEnabled: { ...preferences.teamEnabled, [teamId]: enabled },
    }).catch((error) => {
      Alert.alert("保存できませんでした", error?.message || "通信状態を確認してください。");
    });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={navigation.goBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹ 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>プッシュ通知設定</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>アプリ内通知は常に保存されます</Text>
          <Text style={styles.infoText}>
            ここでOFFにした項目も通知センターには残り、プッシュ表示だけが停止します。
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.settingRow}>
            <View style={styles.settingTextBox}>
              <Text style={styles.settingTitle}>プッシュ通知</Text>
              <Text style={styles.settingDescription}>
                端末の通知権限: {permissionStatus}
              </Text>
            </View>
            {isSavingPreferences ? (
              <ActivityIndicator color="#0077cc" />
            ) : (
              <Switch
                value={preferences.masterEnabled}
                onValueChange={toggleMaster}
                trackColor={{ false: "#ccc", true: "#8ecdf2" }}
                thumbColor={preferences.masterEnabled ? "#0077cc" : "#f4f4f4"}
              />
            )}
          </View>
        </View>

        <Text style={styles.sectionHeading}>通知する項目</Text>
        <View style={styles.section}>
          {Object.entries(NOTIFICATION_CATEGORIES).map(([key, category], index) => (
            <View
              key={key}
              style={[styles.settingRow, index > 0 && styles.rowBorder]}
            >
              <Text style={styles.categoryIcon}>{category.icon}</Text>
              <View style={styles.settingTextBox}>
                <Text style={styles.settingTitle}>{category.label}</Text>
                <Text style={styles.settingDescription}>
                  {getCategoryDescription(key, category)}
                </Text>
              </View>
              <Switch
                value={preferences.categories[key] !== false}
                onValueChange={(enabled) => toggleCategory(key, enabled)}
                disabled={isSavingPreferences}
              />
            </View>
          ))}
        </View>

        <Text style={styles.sectionHeading}>チーム別設定</Text>
        <View style={styles.section}>
          {teams.length === 0 ? (
            <Text style={styles.emptyText}>所属チームを読み込んでいます。</Text>
          ) : (
            teams.map((team, index) => (
              <View
                key={team.id}
                style={[styles.settingRow, index > 0 && styles.rowBorder]}
              >
                <View style={styles.settingTextBox}>
                  <Text style={styles.settingTitle}>{team.name}</Text>
                  <Text style={styles.settingDescription}>
                    このチームからのプッシュ通知
                  </Text>
                </View>
                <Switch
                  value={preferences.teamEnabled[team.id] !== false}
                  onValueChange={(enabled) => toggleTeam(team.id, enabled)}
                  disabled={isSavingPreferences}
                />
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f4f7f6" },
  header: {
    minHeight: 64,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  backButton: { width: 72, paddingVertical: 10 },
  backButtonText: { color: "#0077cc", fontWeight: "bold", fontSize: 15 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 18, fontWeight: "bold" },
  headerSpacer: { width: 72 },
  content: { padding: 14, paddingBottom: 40 },
  infoCard: {
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#eaf6fd",
    borderWidth: 1,
    borderColor: "#b9dff5",
  },
  infoTitle: { fontSize: 14, fontWeight: "bold", color: "#005b91" },
  infoText: { marginTop: 5, fontSize: 12, lineHeight: 18, color: "#386274" },
  sectionHeading: { marginTop: 20, marginBottom: 8, color: "#555", fontWeight: "bold" },
  section: {
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
  },
  settingRow: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: "#edf1f4" },
  categoryIcon: { width: 38, fontSize: 22 },
  settingTextBox: { flex: 1, paddingRight: 12 },
  settingTitle: { fontSize: 14, color: "#222", fontWeight: "bold" },
  settingDescription: { marginTop: 3, fontSize: 11, color: "#777", lineHeight: 16 },
  emptyText: { padding: 18, color: "#777", textAlign: "center" },
});
