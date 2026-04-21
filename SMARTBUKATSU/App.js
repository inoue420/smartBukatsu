import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox, ActivityIndicator, View, Text } from "react-native";
import NetInfo from "@react-native-community/netinfo";

// コンテキストとサービス
import { AuthProvider, useAuth } from "./src/AuthContext";
import {
  subscribeProjects,
  subscribeDailyReports,
  subscribeNotices,
  subscribePersonalEvents,
  subscribeTeamData,
  subscribeTeamMembers,
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
import RosterScreen from "./src/screens/RosterScreen";

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
  const [notices, setNotices] = useState([]);
  const [dailyReports, setDailyReports] = useState([]);
  const [personalEvents, setPersonalEvents] = useState([]);
  const [teamName, setTeamName] = useState("ロード中...");

  const [clubMembers, setClubMembers] = useState([]);
  const [userProfiles, setUserProfiles] = useState({});

  const [grades, setGrades] = useState(["1年生", "2年生", "3年生"]);
  const [positions, setPositions] = useState([
    "キャプテン",
    "マネージャー",
    "GK",
    "CP",
  ]);

  const [alertThresholds, setAlertThresholds] = useState({
    fatigueWarning: 7,
    fatigueDanger: 9,
    painDanger: 7,
    autoEscalate: true,
  });
  const [isOffline, setIsOffline] = useState(false);
  const [posts, setPosts] = useState([]);

  const [isResolvingTeam, setIsResolvingTeam] = useState(false);

  useEffect(() => {
    if (user && !activeTeamId) {
      setIsResolvingTeam(true);
      const timer = setTimeout(() => setIsResolvingTeam(false), 1500);
      return () => clearTimeout(timer);
    } else if (user && activeTeamId) {
      setIsResolvingTeam(false);
    }
  }, [user, activeTeamId]);

  // Firestore同期
  useEffect(() => {
    if (user && activeTeamId) {
      const unsubProjects = subscribeProjects(activeTeamId, setProjects);
      const unsubReports = subscribeDailyReports(activeTeamId, setDailyReports);
      const unsubNotices = subscribeNotices(activeTeamId, setNotices);
      const unsubPersonal = subscribePersonalEvents(
        user.uid,
        setPersonalEvents,
      );

      const unsubTeam = subscribeTeamData(activeTeamId, (data) => {
        if (data) {
          if (data.name) setTeamName(data.name);
          if (data.grades && data.grades.length > 0) setGrades(data.grades);
          if (data.positions && data.positions.length > 0)
            setPositions(data.positions);
        }
      });

      const unsubMembers = subscribeTeamMembers(activeTeamId, (membersData) => {
        const names = [];
        const profiles = {};
        membersData.forEach((m) => {
          let mName = m.name || "名称未設定";
          if (profiles[mName]) {
            mName = `${mName}_${m.uid.substring(0, 4)}`;
          }
          names.push(mName);
          profiles[mName] = {
            uid: m.uid,
            role: m.role || "member",
            assignedStaff: m.assignedStaff || null,
            staffScope: m.staffScope || "all",
          };
        });
        setClubMembers(names);
        setUserProfiles(profiles);
      });

      return () => {
        unsubProjects();
        unsubReports();
        unsubNotices();
        unsubPersonal();
        unsubTeam();
        unsubMembers();
      };
    } else {
      setClubMembers([]);
      setUserProfiles({});
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

  const safeUserName = userName || user?.email || "ユーザー";

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : !activeTeamId && isResolvingTeam ? (
          <Stack.Screen name="LoadingTeam">
            {() => (
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: "#27ae60",
                }}
              >
                <ActivityIndicator size="large" color="#fff" />
                <Text
                  style={{ color: "#fff", marginTop: 15, fontWeight: "bold" }}
                >
                  アカウントを設定中...
                </Text>
              </View>
            )}
          </Stack.Screen>
        ) : !activeTeamId ? (
          <Stack.Screen name="TeamSetup" component={TeamSetupScreen} />
        ) : (
          <>
            <Stack.Screen name="WorkspaceHome">
              {(props) => (
                <WorkspaceHomeScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  teamName={teamName}
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
                  currentUser={safeUserName}
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
                  currentUser={safeUserName}
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
                  currentUser={safeUserName}
                  projects={projects}
                  setProjects={setProjects}
                  dailyReports={dailyReports}
                  userProfiles={userProfiles}
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
                  currentUser={safeUserName}
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
                  currentUser={safeUserName}
                  clubMembers={clubMembers}
                  userProfiles={userProfiles}
                  projects={projects}
                  setProjects={setProjects}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Roster">
              {(props) => (
                <RosterScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  clubMembers={clubMembers}
                  userProfiles={userProfiles}
                  dailyReports={dailyReports}
                  grades={grades}
                  positions={positions}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Settings">
              {(props) => (
                <SettingsScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
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
          </>
        )}
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
