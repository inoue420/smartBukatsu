import React, { useState, useEffect, useRef } from "react";
import {
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox, ActivityIndicator, View, Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import NetInfo from "@react-native-community/netinfo";

import { AdsProvider, useAds } from "./src/ads/AdManager";
import AppBannerAd from "./src/ads/AppBannerAd";
import AppUpdateGate from "./src/components/AppUpdateGate";
import {
  DEFAULT_INTERSTITIAL_SETTINGS,
  getInterstitialSettingsFromTeamData,
} from "./src/ads/adSettings";
import { DEFAULT_ALERT_THRESHOLDS } from "./src/utils/medicalScale";

// コンテキストとサービス
import { AuthProvider, useAuth } from "./src/AuthContext";
import {
  NotificationProvider,
  useNotifications,
} from "./src/NotificationContext";
import {
  subscribeProjects,
  subscribeHighlightProjects,
  subscribeDailyReports,
  subscribeNotices,
  subscribeWorkspacePosts,
  subscribePersonalEvents,
  subscribeTeamData,
  subscribeTeamMembers,
  subscribeClubEvents, // ★ 追加
  subscribeTagGroups,
} from "./src/services/firestoreService";

// 画面
import LoginScreen from "./src/screens/LoginScreen";
import EmailVerificationScreen from "./src/screens/EmailVerificationScreen";
import TeamSelectScreen from "./src/screens/TeamSelectScreen";
import WorkspaceHomeScreen from "./src/screens/WorkspaceHomeScreen";
import NoticeBoardScreen from "./src/screens/NoticeBoardScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import DiaryScreen from "./src/screens/DiaryScreen";
import ProjectListScreen from "./src/screens/ProjectListScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";
import TagGroupEditScreen from "./src/screens/TagGroupEditScreen";
import CalendarScreen from "./src/screens/CalendarScreen";
import RosterScreen from "./src/screens/RosterScreen";
import NotificationCenterScreen from "./src/screens/NotificationCenterScreen";
import NotificationSettingsScreen from "./src/screens/NotificationSettingsScreen";

LogBox.ignoreLogs(["[expo-av]"]);
const Stack = createNativeStackNavigator();
const DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE = 3;

function AppContent() {
  const navigationRef = useNavigationContainerRef();
  const currentRouteNameRef = useRef();
  const { configureInterstitial, recordScreenTransition, showAfterDiarySubmission } =
    useAds();
  const {
    user,
    userName,
    activeTeamId,
    emailVerificationPending,
    teamSelectionRequired,
    isAdmin: authIsAdmin,
    loading: authLoading,
    selectTeam,
  } = useAuth();
  const { setNavigationHandler } = useNotifications();

  const [projects, setProjects] = useState([]);
  const [highlightProjects, setHighlightProjects] = useState([]);
  const [tagGroups, setTagGroups] = useState([]);
  const [notices, setNotices] = useState([]);
  const [dailyReports, setDailyReports] = useState([]);
  const [personalEvents, setPersonalEvents] = useState([]);
  const [clubEvents, setClubEvents] = useState([]); // ★ 追加：カレンダー用の部活予定
  const [teamName, setTeamName] = useState("ロード中...");

  const [clubMembers, setClubMembers] = useState([]);
  const [userProfiles, setUserProfiles] = useState({});

  const [grades, setGrades] = useState(["1年生", "2年生", "3年生"]);
  const [positions, setPositions] = useState(["GK", "CP", "マネージャー"]);

  const [alertThresholds, setAlertThresholds] = useState({
    ...DEFAULT_ALERT_THRESHOLDS,
  });
  const [interstitialSettings, setInterstitialSettings] = useState({
    ...DEFAULT_INTERSTITIAL_SETTINGS,
  });
  const [absenceDeadlineDaysBefore, setAbsenceDeadlineDaysBefore] = useState(
    DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE,
  );
  const [isOffline, setIsOffline] = useState(false);
  const [posts, setPosts] = useState([]);

  const [isResolvingTeam, setIsResolvingTeam] = useState(false);

  useEffect(() => {
    if (user && !emailVerificationPending && !activeTeamId) {
      setIsResolvingTeam(true);
      const timer = setTimeout(() => setIsResolvingTeam(false), 1500);
      return () => clearTimeout(timer);
    } else {
      setIsResolvingTeam(false);
    }
  }, [user, activeTeamId, emailVerificationPending]);

  useEffect(() => {
    configureInterstitial(interstitialSettings);
  }, [configureInterstitial, interstitialSettings]);

  useEffect(() => {
    const allowedScreens = new Set([
      "WorkspaceHome",
      "NoticeBoard",
      "Calendar",
      "Diary",
      "NotificationCenter",
    ]);
    return setNavigationHandler(async (notification) => {
      const requestedScreen = notification?.target?.screen || "WorkspaceHome";
      const screen = allowedScreens.has(requestedScreen)
        ? requestedScreen
        : "WorkspaceHome";
      const params = notification?.target?.params || {};
      try {
        if (notification?.teamId && notification.teamId !== activeTeamId) {
          await selectTeam(notification.teamId);
        }
        let attempts = 0;
        const navigateToTarget = () => {
          const routeNames = navigationRef.getRootState()?.routeNames || [];
          if (navigationRef.isReady() && routeNames.includes(screen)) {
            navigationRef.navigate(screen, params);
            return;
          }
          attempts += 1;
          if (attempts < 20) setTimeout(navigateToTarget, 100);
        };
        setTimeout(navigateToTarget, notification?.teamId !== activeTeamId ? 300 : 0);
      } catch (error) {
        Alert.alert(
          "通知を開けませんでした",
          error?.message || "対象チームへの切り替えを確認してください。",
        );
      }
    });
  }, [activeTeamId, navigationRef, selectTeam, setNavigationHandler]);

  // Firestore同期
  useEffect(() => {
    if (user && activeTeamId && !emailVerificationPending) {
      setPosts([]);
      setInterstitialSettings({ ...DEFAULT_INTERSTITIAL_SETTINGS });
      setAbsenceDeadlineDaysBefore(DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE);
      const unsubProjects = subscribeProjects(activeTeamId, setProjects);
      const unsubHighlightProjects = subscribeHighlightProjects(
        activeTeamId,
        setHighlightProjects,
      );
      const unsubReports = subscribeDailyReports(activeTeamId, setDailyReports);
      const unsubNotices = subscribeNotices(activeTeamId, setNotices);
      const unsubWorkspacePosts = subscribeWorkspacePosts(
        activeTeamId,
        user.uid,
        setPosts,
      );
      const unsubPersonal = subscribePersonalEvents(
        user.uid,
        setPersonalEvents,
      );
      const unsubClubEvents = subscribeClubEvents(activeTeamId, setClubEvents); // ★ 追加
      const unsubTagGroups = subscribeTagGroups(activeTeamId, setTagGroups);

      const unsubTeam = subscribeTeamData(activeTeamId, (data) => {
        if (data) {
          if (data.name) setTeamName(data.name);
          if (data.grades !== undefined) setGrades(data.grades);
          if (data.positions !== undefined) setPositions(data.positions);
          setInterstitialSettings(
            getInterstitialSettingsFromTeamData(data.adSettings),
          );
          const configuredAbsenceDeadline = Number(
            data.absenceDeadlineDaysBefore,
          );
          setAbsenceDeadlineDaysBefore(
            Number.isInteger(configuredAbsenceDeadline) &&
              configuredAbsenceDeadline >= 0 &&
              configuredAbsenceDeadline <= 365
              ? configuredAbsenceDeadline
              : DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE,
          );
        }
      });

      const unsubMembers = subscribeTeamMembers(activeTeamId, (membersData) => {
        const names = [];
        const profiles = {};
        membersData.forEach((m) => {
          const displayName = m.name || "名称未設定";
          let profileKey = displayName;
          if (profiles[profileKey]) {
            profileKey = `${displayName}_${m.uid.substring(0, 4)}`;
          }
          names.push(profileKey);
          profiles[profileKey] = {
            uid: m.uid,
            name: displayName,
            role: m.role || "member",
            assignedStaff: m.assignedStaff || null,
            staffScope: m.staffScope || "all",
            canUploadVideos: Boolean(m.canUploadVideos),
            canEditTags: Boolean(m.canEditTags),
            grade: m.grade || "",
            position: m.position || "",
          };
        });
        setClubMembers(names);
        setUserProfiles(profiles);
      });

      return () => {
        unsubProjects();
        unsubHighlightProjects();
        unsubReports();
        unsubNotices();
        unsubWorkspacePosts();
        unsubPersonal();
        unsubTeam();
        unsubMembers();
        unsubClubEvents(); // ★ 追加
        unsubTagGroups();
      };
    } else {
      setClubMembers([]);
      setHighlightProjects([]);
      setTagGroups([]);
      setUserProfiles({});
      setPosts([]);
      setAbsenceDeadlineDaysBefore(DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE);
    }
  }, [user, activeTeamId, emailVerificationPending]);

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
  const currentUserUid = user?.uid || "";

  const handleNavigationReady = () => {
    currentRouteNameRef.current = navigationRef.getCurrentRoute()?.name;
  };

  const handleNavigationStateChange = () => {
    const previousRouteName = currentRouteNameRef.current;
    const currentRouteName = navigationRef.getCurrentRoute()?.name;

    if (
      previousRouteName &&
      currentRouteName &&
      previousRouteName !== currentRouteName &&
      user &&
      activeTeamId &&
      !emailVerificationPending
    ) {
      recordScreenTransition();
    }
    currentRouteNameRef.current = currentRouteName;
  };

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer
        ref={navigationRef}
        onReady={handleNavigationReady}
        onStateChange={handleNavigationStateChange}
      >
        <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : emailVerificationPending ? (
          <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
        ) : teamSelectionRequired ? (
          <Stack.Screen name="TeamSelect" component={TeamSelectScreen} />
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
          <Stack.Screen name="TeamSelect" component={TeamSelectScreen} />
        ) : (
          <>
            <Stack.Screen name="WorkspaceHome">
              {(props) => (
                <WorkspaceHomeScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
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

            <Stack.Screen name="TeamSelect" component={TeamSelectScreen} />

            <Stack.Screen name="NoticeBoard">
              {(props) => (
                <NoticeBoardScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
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
                  currentUserUid={currentUserUid}
                  isOffline={isOffline}
                  grades={grades}
                  positions={positions}
                  posts={posts}
                  setPosts={setPosts}
                  userProfiles={userProfiles}
                  dailyReports={dailyReports}
                  setDailyReports={setDailyReports}
                  alertThresholds={alertThresholds}
                  clubMembers={clubMembers}
                  onDiarySubmitted={showAfterDiarySubmission}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Calendar">
              {(props) => (
                <CalendarScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  clubEvents={clubEvents} // ★ 修正：projects ではなく clubEvents を渡す
                  dailyReports={dailyReports}
                  userProfiles={userProfiles}
                  personalEvents={personalEvents}
                  setPersonalEvents={setPersonalEvents}
                  absenceDeadlineDaysBefore={absenceDeadlineDaysBefore}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="ProjectList">
              {(props) => (
                <ProjectListScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  projects={projects}
                  setProjects={setProjects}
                  highlightProjects={highlightProjects}
                  setHighlightProjects={setHighlightProjects}
                  tagGroups={tagGroups}
                  setTagGroups={setTagGroups}
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
                  currentUserUid={currentUserUid}
                  clubMembers={clubMembers}
                  userProfiles={userProfiles}
                  projects={projects}
                  setProjects={setProjects}
                  tagGroups={tagGroups}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="TagGroupEdit">
              {(props) => (
                <TagGroupEditScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  userProfiles={userProfiles}
                  tagGroups={tagGroups}
                  setTagGroups={setTagGroups}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Roster">
              {(props) => (
                <RosterScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  activeTeamId={activeTeamId}
                  clubMembers={clubMembers}
                  userProfiles={userProfiles}
                  dailyReports={dailyReports}
                  grades={grades}
                  positions={positions}
                  alertThresholds={alertThresholds}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Settings">
              {(props) => (
                <SettingsScreen
                  {...props}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  clubMembers={clubMembers}
                  setClubMembers={setClubMembers}
                  grades={grades}
                  setGrades={setGrades}
                  positions={positions}
                  setPositions={setPositions}
                  alertThresholds={alertThresholds}
                  setAlertThresholds={setAlertThresholds}
                  userProfiles={userProfiles}
                  interstitialSettings={interstitialSettings}
                  setInterstitialSettings={setInterstitialSettings}
                  absenceDeadlineDaysBefore={absenceDeadlineDaysBefore}
                  setAbsenceDeadlineDaysBefore={setAbsenceDeadlineDaysBefore}
                  setUserProfiles={setUserProfiles}
                  posts={posts}
                  setPosts={setPosts}
                />
              )}
            </Stack.Screen>

            <Stack.Screen
              name="NotificationCenter"
              component={NotificationCenterScreen}
            />
            <Stack.Screen
              name="NotificationSettings"
              component={NotificationSettingsScreen}
            />
          </>
        )}
        </Stack.Navigator>
      </NavigationContainer>
      <AppBannerAd />
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AdsProvider>
        <AuthProvider>
          <NotificationProvider>
            <AppContent />
          </NotificationProvider>
        </AuthProvider>
      </AdsProvider>
      <AppUpdateGate />
    </GestureHandlerRootView>
  );
}
