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

  const [isOffline, setIsOffline] = useState(false);

  // ホーム画面の投稿データ
  const [posts, setPosts] = useState([]);

  const [notices, setNotices] = useState([
    {
      id: "1",
      title: "秋季大会のエントリーシート提出について",
      content:
        "今週末の練習時に、秋季大会のエントリーシートを必ず提出してください。",
      author: "管理者(監督)",
      date: "2026/02/19 18:00",
      readBy: ["鈴木"],
      status: "sent",
    },
  ]);

  const [diaries, setDiaries] = useState([
    {
      id: "diary_1",
      date: "2026/02/20",
      author: "佐藤",
      practiceContent: "フットワーク確認、紅白戦",
      achievement: 4,
      goodPoint: "最後まで走り切れた。声出しができた。",
      badPoint: "疲れた時にパスの精度が落ちた。",
      nextTask: "疲労時のフォームを意識する。",
      images: [],
      memo: "",
      highlightLink: "",
      status: "sent",
      isReviewed: true,
      isStarred: false,
      isFollowUp: false,
      sharedWith: "staff",
      createdAt: Date.now() - 3600000,
      appendedTexts: [],
      comments: [
        {
          id: "c1",
          user: "管理者(監督)",
          text: "お疲れ様！後半のスタミナは今後の課題だね。",
          time: "昨日 18:30",
          status: "sent",
        },
      ],
    },
  ]);

  const toggleNetworkStatus = () => {
    if (isOffline) {
      setIsOffline(false);
      let hasPending = false;
      const updatedPosts = posts.map((p) => {
        let updatedP = { ...p };
        if (p.status === "pending") {
          updatedP.status = "sent";
          hasPending = true;
        }
        updatedP.replies = p.replies.map((r) => {
          if (r.status === "pending") {
            hasPending = true;
            return { ...r, status: "sent" };
          }
          return r;
        });
        return updatedP;
      });
      setPosts(updatedPosts);
      const updatedNotices = notices.map((n) => {
        if (n.status === "pending") {
          hasPending = true;
          return { ...n, status: "sent" };
        }
        return n;
      });
      setNotices(updatedNotices);
      const updatedDiaries = diaries.map((d) => {
        let updatedD = { ...d };
        if (d.status === "pending") {
          updatedD.status = "sent";
          hasPending = true;
        }
        updatedD.comments = d.comments.map((c) => {
          if (c.status === "pending") {
            hasPending = true;
            return { ...c, status: "sent" };
          }
          return c;
        });
        return updatedD;
      });
      setDiaries(updatedDiaries);
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
          {/* ★修正：posts と setPosts を渡す */}
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
        <Stack.Screen name="VideoList" component={VideoListScreen} />
        <Stack.Screen name="Settings">
          {(props) => (
            <SettingsScreen
              {...props}
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
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
