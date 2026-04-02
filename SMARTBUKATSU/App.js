import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox } from "react-native";
import NetInfo from "@react-native-community/netinfo";

// expo-avの非推奨警告を画面上で非表示にする
LogBox.ignoreLogs(["[expo-av]"]);

import LoginScreen from "./src/screens/LoginScreen";
import WorkspaceHomeScreen from "./src/screens/WorkspaceHomeScreen";
import NoticeBoardScreen from "./src/screens/NoticeBoardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import DiaryScreen from "./src/screens/DiaryScreen";
import ProjectListScreen from "./src/screens/ProjectListScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";
import CalendarScreen from "./src/screens/CalendarScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState("");

  const [adminPassword, setAdminPassword] = useState("1952");
  const [memberPassword, setMemberPassword] = useState("1234");

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
  const [medicalRecords, setMedicalRecords] = useState([]);

  const [projects, setProjects] = useState([
    {
      id: "p1",
      title: "秋季大会 vs 〇〇高校",
      date: "2026/02/20",
      type: "試合",
      status: "active",
      participants: "team",
      pinned: false,
    },
    {
      id: "p2",
      title: "2月第3週 紅白戦",
      date: "2026/02/15",
      type: "練習",
      status: "closed",
      participants: "team",
      pinned: false,
    },
  ]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const currentlyOffline = !state.isConnected;

      setIsOffline((prevOffline) => {
        if (prevOffline && !currentlyOffline) {
          let hasPending = false;

          setPosts((prev) => {
            let changed = false;
            const newPosts = prev.map((p) => {
              let postChanged = false;
              let newP = { ...p };
              if (newP.status === "pending") {
                newP.status = "sent";
                postChanged = true;
                changed = true;
              }
              if (
                newP.replies &&
                newP.replies.some((r) => r.status === "pending")
              ) {
                newP.replies = newP.replies.map((r) =>
                  r.status === "pending" ? { ...r, status: "sent" } : r,
                );
                postChanged = true;
                changed = true;
              }
              return postChanged ? newP : p;
            });
            if (changed) hasPending = true;
            return newPosts;
          });

          setDailyReports((prev) => {
            let changed = false;
            const newReports = prev.map((r) => {
              let reportChanged = false;
              let newR = { ...r };
              if (newR.status === "pending") {
                newR.status = "sent";
                reportChanged = true;
                changed = true;
              }
              if (
                newR.comments &&
                newR.comments.some((c) => c.status === "pending")
              ) {
                newR.comments = newR.comments.map((c) =>
                  c.status === "pending" ? { ...c, status: "sent" } : c,
                );
                reportChanged = true;
                changed = true;
              }
              return reportChanged ? newR : r;
            });
            if (changed) hasPending = true;
            return newReports;
          });

          if (hasPending) {
            setTimeout(() => {
              Alert.alert(
                "🌐 通信が復旧しました",
                "オフライン時の待機データをすべて自動送信しました。",
              );
            }, 500);
          }
        }
        return currentlyOffline;
      });
    });

    return () => unsubscribe();
  }, []);

  const toggleNetworkStatus = () => {
    Alert.alert(
      "自動判定中",
      "現在は端末のネットワーク状態を自動で監視しています。",
    );
  };

  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login">
          {(props) => (
            <LoginScreen
              {...props}
              setIsAdmin={setIsAdmin}
              setCurrentUser={setCurrentUser}
              adminPassword={adminPassword}
              memberPassword={memberPassword}
              clubMembers={clubMembers}
              setClubMembers={setClubMembers}
              grades={grades}
              positions={positions}
              userProfiles={userProfiles}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="WorkspaceHome">
          {(props) => (
            <WorkspaceHomeScreen
              {...props}
              isAdmin={isAdmin}
              currentUser={currentUser}
              notices={notices}
              posts={posts}
              setPosts={setPosts}
              isOffline={isOffline}
              toggleNetworkStatus={toggleNetworkStatus}
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
              isAdmin={isAdmin}
              currentUser={currentUser}
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
              isAdmin={isAdmin}
              currentUser={currentUser}
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
              isAdmin={isAdmin}
              currentUser={currentUser}
              projects={projects}
              setProjects={setProjects} // ★追加：カレンダーから予定を編集できるように
              dailyReports={dailyReports}
              userProfiles={userProfiles}
              alertThresholds={alertThresholds}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="ProjectList">
          {(props) => (
            <ProjectListScreen
              {...props}
              isAdmin={isAdmin}
              currentUser={currentUser}
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
              isAdmin={isAdmin}
              currentUser={currentUser}
              clubMembers={clubMembers}
              userProfiles={userProfiles}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Settings">
          {(props) => (
            <SettingsScreen
              {...props}
              isAdmin={isAdmin}
              currentUser={currentUser}
              setCurrentUser={setCurrentUser}
              adminPassword={adminPassword}
              setAdminPassword={setAdminPassword}
              memberPassword={memberPassword}
              setMemberPassword={setMemberPassword}
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
