import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox } from "react-native";
// ★追加：本番用ネットワーク監視ライブラリ
import NetInfo from "@react-native-community/netinfo";

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

  // ★追加：ネットワーク状態の自動監視と復旧時の全データ一括送信処理
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // ネットワークに繋がっていない場合をオフラインとする
      const currentlyOffline = !state.isConnected;

      setIsOffline((prevOffline) => {
        // オフラインからオンラインに復旧した瞬間
        if (prevOffline && !currentlyOffline) {
          let hasPending = false;

          // 1. 投稿と返信の待機データを一括処理
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

          // 2. 日記とコメントの待機データを一括処理
          setDiaries((prev) => {
            let changed = false;
            const newDiaries = prev.map((d) => {
              let diaryChanged = false;
              let newD = { ...d };
              if (newD.status === "pending") {
                newD.status = "sent";
                diaryChanged = true;
                changed = true;
              }
              if (
                newD.comments &&
                newD.comments.some((c) => c.status === "pending")
              ) {
                newD.comments = newD.comments.map((c) =>
                  c.status === "pending" ? { ...c, status: "sent" } : c,
                );
                diaryChanged = true;
                changed = true;
              }
              return diaryChanged ? newD : d;
            });
            if (changed) hasPending = true;
            return newDiaries;
          });

          // 3. メディカルとコメントの待機データを一括処理
          setMedicalRecords((prev) => {
            let changed = false;
            const newRecords = prev.map((r) => {
              let recordChanged = false;
              let newR = { ...r };
              if (newR.status === "pending") {
                newR.status = "sent";
                recordChanged = true;
                changed = true;
              }
              if (
                newR.comments &&
                newR.comments.some((c) => c.status === "pending")
              ) {
                newR.comments = newR.comments.map((c) =>
                  c.status === "pending" ? { ...c, status: "sent" } : c,
                );
                recordChanged = true;
                changed = true;
              }
              return recordChanged ? newR : r;
            });
            if (changed) hasPending = true;
            return newRecords;
          });

          // いずれかの待機データが送信された場合のみ通知
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

  // ★変更：手動ボタンの無効化（エラーを防ぐための安全ガード）
  const toggleNetworkStatus = () => {
    Alert.alert(
      "自動判定中",
      "現在は端末のネットワーク状態を自動で監視しています。\n（※スマホの機内モードをON/OFFにしてテストできます）",
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
