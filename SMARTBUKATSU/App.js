import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox, ActivityIndicator, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

// コンテキストとサービス
import { AuthProvider, useAuth } from "./src/AuthContext";
import { subscribeProjects } from "./src/services/firestoreService";

// 画面
import LoginScreen from "./src/screens/LoginScreen";
import TeamSetupScreen from "./src/screens/TeamSetupScreen"; // ★追加
import WorkspaceHomeScreen from "./src/screens/WorkspaceHomeScreen";
import NoticeBoardScreen from "./src/screens/NoticeBoardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import DiaryScreen from "./src/screens/DiaryScreen";
import ProjectListScreen from "./src/screens/ProjectListScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";
import CalendarScreen from "./src/screens/CalendarScreen";

LogBox.ignoreLogs(["[expo-av]"]);
const Stack = createNativeStackNavigator();

/**
 * メインのコンテンツ部分
 * AuthProviderの内側に配置することで、useAuth() から
 * ログインユーザー情報やチームIDを取得できるようにします。
 */
function AppContent() {
  const {
    user,
    activeTeamId,
    isAdmin: authIsAdmin,
    loading: authLoading,
  } = useAuth();

  // --- アプリ全体で共有する状態（UI用） ---
  const [projects, setProjects] = useState([]);
  const [clubMembers, setClubMembers] = useState(["キャプテン", "部員1"]);
  const [grades, setGrades] = useState(["1年", "2年", "3年"]);
  const [positions, setPositions] = useState(["CP", "GK", "マネージャー"]);
  const [userProfiles, setUserProfiles] = useState({
    キャプテン: { role: "captain" },
    部員1: { role: "member" },
  });
  const [alertThresholds, setAlertThresholds] = useState({
    fatigueWarning: 7,
    fatigueDanger: 9,
    painDanger: 7,
    autoEscalate: true,
  });
  const [isOffline, setIsOffline] = useState(false);
  const [posts, setPosts] = useState([]);
  const [notices, setNotices] = useState([]);
  const [dailyReports, setDailyReports] = useState([]);
  const [personalEvents, setPersonalEvents] = useState([]);

  // ★Firestoreのリアルタイム購読
  // ログイン済み かつ チーム所属済み の時だけデータを取ってくる
  useEffect(() => {
    if (user && activeTeamId) {
      console.log("Firestore購読開始 (Team ID):", activeTeamId);
      const unsubscribe = subscribeProjects(activeTeamId, (fetchedProjects) => {
        setProjects(fetchedProjects);
      });
      return () => unsubscribe();
    } else {
      setProjects([]);
    }
  }, [user, activeTeamId]);

  // オフライン状態の監視
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // 認証情報の読み込み中はローディング画面を表示
  if (authLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: "#f0f2f5",
        }}
      >
        <ActivityIndicator size="large" color="#0077cc" />
      </View>
    );
  }

  // ★ナビゲーションの初期画面（初期ルート）のロジック
  // 1. 未ログインなら「Login」
  // 2. ログイン済みだがチーム未設定なら「TeamSetup」
  // 3. ログイン済みかつチーム設定済みなら「WorkspaceHome」
  const initialRoute = !user
    ? "Login"
    : !activeTeamId
      ? "TeamSetup"
      : "WorkspaceHome";

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        {/* 認証・初期設定フロー */}
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="TeamSetup" component={TeamSetupScreen} />

        {/* メイン機能 */}
        <Stack.Screen name="WorkspaceHome">
          {(props) => (
            <WorkspaceHomeScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={user?.email || ""}
              notices={notices}
              posts={posts}
              setPosts={setPosts}
              isOffline={isOffline}
              clubMembers={clubMembers}
              alertThresholds={alertThresholds}
              userProfiles={userProfiles}
              dailyReports={dailyReports}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="NoticeBoard">
          {(props) => (
            <NoticeBoardScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={user?.email || ""}
              notices={notices}
              setNotices={setNotices}
              isOffline={isOffline}
              userProfiles={userProfiles}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="Diary">
          {(props) => (
            <DiaryScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={user?.email || ""}
              isOffline={isOffline}
              grades={grades}
              positions={positions}
              posts={posts}
              setPosts={setPosts}
              userProfiles={userProfiles}
              dailyReports={dailyReports}
              setDailyReports={setDailyReports}
              alertThresholds={alertThresholds}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="Calendar">
          {(props) => (
            <CalendarScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={user?.email || ""}
              projects={projects}
              setProjects={setProjects}
              dailyReports={dailyReports}
              userProfiles={userProfiles}
              alertThresholds={alertThresholds}
              personalEvents={personalEvents}
              setPersonalEvents={setPersonalEvents}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="ProjectList">
          {(props) => (
            <ProjectListScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={user?.email || ""}
              projects={projects}
              setProjects={setProjects}
              userProfiles={userProfiles}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="ProjectDetail">
          {(props) => (
            <ProjectDetailScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={user?.email || ""}
              clubMembers={clubMembers}
              userProfiles={userProfiles}
              projects={projects}
              setProjects={setProjects}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="Settings">
          {(props) => (
            <SettingsScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={user?.email || ""}
              clubMembers={clubMembers}
              setClubMembers={setClubMembers}
              grades={grades}
              setGrades={setGrades}
              positions={positions}
              setPositions={setPositions}
              alertThresholds={alertThresholds}
              setAlertThresholds={setAlertThresholds}
              userProfiles={userProfiles}
              setUserProfiles={setUserProfiles}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/**
 * エントリーポイント
 */
export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
