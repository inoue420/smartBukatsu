import React, { useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert } from "react-native";

import LoginScreen from "./src/screens/LoginScreen";
import WorkspaceHomeScreen from "./src/screens/WorkspaceHomeScreen";
import VideoListScreen from "./src/screens/VideoListScreen";
import NoticeBoardScreen from "./src/screens/NoticeBoardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import DiaryScreen from "./src/screens/DiaryScreen";
import MedicalScreen from "./src/screens/MedicalScreen";

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

  // ★追加：部員ごとの個人プロフィール（パスワード、学年、ポジション）を管理
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

  const [medicalRecords, setMedicalRecords] = useState([
    {
      id: "med_1",
      date: "2026/02/26",
      author: "佐藤",
      condition: "普通",
      fatigue: 7,
      sleep: "6h",
      isParticipating: "制限",
      hasPain: true,
      painDetails: {
        part: "右肩",
        level: 5,
        memo: "投げる時にピキッとする",
        sinceWhen: "3日前から",
        treatment: "アイシングのみ",
      },
      status: "sent",
      isReviewed: false,
      createdAt: Date.now(),
      comments: [
        {
          id: "c1",
          user: "管理者(監督)",
          text: "無理せず別メニューで調整しよう。",
          time: "10:00",
          status: "sent",
        },
      ],
      managementTags: ["👀 経過観察"],
    },
    {
      id: "med_2",
      date: "2026/02/25",
      author: "佐藤",
      condition: "良い",
      fatigue: 5,
      sleep: "7h",
      isParticipating: "通常",
      hasPain: true,
      painDetails: {
        part: "右肩",
        level: 3,
        memo: "少し違和感",
        sinceWhen: "昨日から",
        treatment: "",
      },
      status: "sent",
      isReviewed: true,
      createdAt: Date.now() - 86400000,
      comments: [],
      managementTags: [],
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
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="VideoList" component={VideoListScreen} />
        <Stack.Screen name="Settings">
          {/* ★修正：userProfiles も渡すように変更 */}
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
