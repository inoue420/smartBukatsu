import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox, ActivityIndicator, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";

// コンテキストとサービス
import { AuthProvider, useAuth } from "./src/AuthContext";
import {
  subscribeProjects,
  subscribeDailyReports,
  subscribeNotices,
  subscribePersonalEvents, // ★個人の予定を監視
} from "./src/services/firestoreService";

// 画面
import LoginScreen from "./src/screens/LoginScreen";
import TeamSetupScreen from "./src/screens/TeamSetupScreen";
import WorkspaceHomeScreen from "./src/screens/WorkspaceHomeScreen";
import NoticeBoardScreen from "./src/screens/NoticeBoardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import DiaryScreen from "./src/screens/DiaryScreen";
import ProjectListScreen from "./src/screens/ProjectListScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";
import CalendarScreen from "./src/screens/CalendarScreen";

LogBox.ignoreLogs(["[expo-av]"]);
const Stack = createNativeStackNavigator();

function AppContent() {
  const {
    user,
    userName,
    activeTeamId,
    isAdmin: authIsAdmin,
    loading: authLoading,
  } = useAuth();

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

  // ========================================================
  // ★ Firestore本番同期（個人予定の同期も追加）
  // ========================================================
  useEffect(() => {
    if (user && activeTeamId) {
      console.log("🔥 Firestore本番同期を開始:", activeTeamId);

      const unsubProjects = subscribeProjects(activeTeamId, (fetched) => {
        setProjects(fetched);
      });

      const unsubReports = subscribeDailyReports(activeTeamId, (fetched) => {
        setDailyReports(fetched);
      });

      const unsubNotices = subscribeNotices(activeTeamId, (fetched) => {
        setNotices(fetched);
      });

      // ★ ログインユーザー本人の個人予定のみ同期
      const unsubPersonal = subscribePersonalEvents(user.uid, (fetched) => {
        setPersonalEvents(fetched);
      });

      return () => {
        unsubProjects();
        unsubReports();
        unsubNotices();
        unsubPersonal();
      };
    } else {
      setProjects([]);
      setDailyReports([]);
      setNotices([]);
      setPersonalEvents([]);
    }
  }, [user, activeTeamId]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!state.isConnected);
    });
    return () => unsubscribe();
  }, []);

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
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="TeamSetup" component={TeamSetupScreen} />

        <Stack.Screen name="WorkspaceHome">
          {(props) => (
            <WorkspaceHomeScreen
              {...props}
              isAdmin={authIsAdmin}
              currentUser={userName || user?.email || "ユーザー"}
              notices={notices}
              setNotices={setNotices}
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
              currentUser={userName || user?.email || "ユーザー"}
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
              currentUser={userName || user?.email || "ユーザー"}
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
              currentUser={userName || user?.email || "ユーザー"}
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
              currentUser={userName || user?.email || "ユーザー"}
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
              currentUser={userName || user?.email || "ユーザー"}
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
              currentUser={userName || user?.email || "ユーザー"}
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

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
