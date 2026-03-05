import React, { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox } from "react-native";

// expo-avの非推奨警告を画面上で非表示にする
LogBox.ignoreLogs(["[expo-av]"]);

import LoginScreen from "./src/screens/LoginScreen";
import WorkspaceHomeScreen from "./src/screens/WorkspaceHomeScreen";
import NoticeBoardScreen from "./src/screens/NoticeBoardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import DiaryScreen from "./src/screens/DiaryScreen";
import MedicalScreen from "./src/screens/MedicalScreen";
import ProjectListScreen from "./src/screens/ProjectListScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState("");

  const [adminPassword, setAdminPassword] = useState("1952");
  const [memberPassword, setMemberPassword] = useState("1234");
  const [clubMembers, setClubMembers] = useState([
    "佐藤",
    "鈴木",
    "高橋",
    "田中",
    "伊藤",
  ]);
  const [grades, setGrades] = useState(["1年", "2年", "3年"]);
  const [positions, setPositions] = useState([
    "投手",
    "捕手",
    "内野",
    "外野",
    "マネ",
  ]);
  const [userProfiles, setUserProfiles] = useState({});

  const [alertThresholds, setAlertThresholds] = useState({
    fatigueWarning: 7,
    fatigueDanger: 9,
    painDanger: 7,
    autoEscalate: true,
  });

  const [isOffline, setIsOffline] = useState(false);
  const [posts, setPosts] = useState([]);
  const [notices, setNotices] = useState([]);
  const [diaries, setDiaries] = useState([]);
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

  const toggleNetworkStatus = () => {
    if (isOffline) {
      setIsOffline(false);
      let hasPending = false;
      if (posts.some((p) => p.status === "pending")) hasPending = true;
      if (hasPending)
        Alert.alert(
          "🌐 通信が復旧しました",
          "オフライン時の待機データをすべて送信しました。",
        );
    } else {
      setIsOffline(true);
    }
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
              medicalRecords={medicalRecords}
              alertThresholds={alertThresholds}
              userProfiles={userProfiles}
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
              toggleNetworkStatus={toggleNetworkStatus}
              clubMembers={clubMembers}
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
              diaries={diaries}
              setDiaries={setDiaries}
              isOffline={isOffline}
              toggleNetworkStatus={toggleNetworkStatus}
              grades={grades}
              positions={positions}
              posts={posts}
              setPosts={setPosts}
              userProfiles={userProfiles}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Medical">
          {(props) => (
            <MedicalScreen
              {...props}
              isAdmin={isAdmin}
              currentUser={currentUser}
              medicalRecords={medicalRecords}
              setMedicalRecords={setMedicalRecords}
              isOffline={isOffline}
              toggleNetworkStatus={toggleNetworkStatus}
              alertThresholds={alertThresholds}
              userProfiles={userProfiles}
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
