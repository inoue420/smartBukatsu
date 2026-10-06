import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Alert, LogBox, ActivityIndicator, View, Text, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";

// On iOS, measure screen insets above the banner instead of reusing its bottom inset.
const NavigationArea = Platform.OS === "ios" ? SafeAreaProvider : View;

import { AdsProvider, useAds } from "./src/ads/AdManager";
import AppBannerAd from "./src/ads/AppBannerAd";
import AppUpdateGate from "./src/components/AppUpdateGate";
import {
  DEFAULT_INTERSTITIAL_SETTINGS,
  getInterstitialSettingsFromTeamData,
} from "./src/ads/adSettings";
import { DEFAULT_ALERT_THRESHOLDS } from "./src/utils/medicalScale";
import { mergeReadState, monthAgo, monthWindow } from "./src/utils/historyLoading";
import { useHistoryData } from "./src/hooks/useHistoryData";
import { subscribeLoadingState, subscribeLoadingSummary, subscribeLatestReports, subscribePostReadStates, subscribePinnedPosts } from "./src/services/historyDataService";

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
import TacticalNotesScreen from "./src/screens/TacticalNotesScreen";
import ProjectDetailScreen from "./src/screens/ProjectDetailScreen";
import TagGroupEditScreen from "./src/screens/TagGroupEditScreen";
import CalendarScreen from "./src/screens/CalendarScreen";
import RosterScreen from "./src/screens/RosterScreen";
import NotificationCenterScreen from "./src/screens/NotificationCenterScreen";
import NotificationSettingsScreen from "./src/screens/NotificationSettingsScreen";

LogBox.ignoreLogs(["[expo-av]"]);
const Stack = createNativeStackNavigator();
const DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE = 3;
const DEFAULT_ABSENCE_DETAILS_VISIBLE = true;

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
    isTeamSwitching,
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
  const [absenceDetailsVisible, setAbsenceDetailsVisible] = useState(
    DEFAULT_ABSENCE_DETAILS_VISIBLE,
  );
  const [dailyReportCommentSettings, setDailyReportCommentSettings] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [posts, setPosts] = useState([]);
  const [currentScreen, setCurrentScreen] = useState("WorkspaceHome");
  const [currentParams, setCurrentParams] = useState({});
  const [calendarWindow, setCalendarWindow] = useState(() => monthWindow());
  const [loadingState, setLoadingState] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState({});
  const [latestReports, setLatestReports] = useState([]);
  const [postReads, setPostReads] = useState({});
  const [workspaceChannel, setWorkspaceChannel] = useState("");
  const [pinnedPosts, setPinnedPosts] = useState([]);
  const [teamScope, setTeamScope] = useState(null);
  const loadingStateResolved = loadingState?._teamId === activeTeamId;
  const optimize = Boolean(loadingStateResolved && loadingState.ready && loadingState.enabled && loadingState.schemaVersion === 1);
  const separateReads = Boolean(optimize && loadingState?.separateReads);
  const readStateAvailable = Boolean(loadingStateResolved && loadingState.schemaVersion === 1);
  const authorized = Boolean(user && activeTeamId && !emailVerificationPending);
  const dailyReportCommentSettingsReady = Boolean(authorized &&
    dailyReportCommentSettings?.teamId === activeTeamId &&
    dailyReportCommentSettings?.uid === user?.uid);
  const dailyReportCommentsEnabled = dailyReportCommentSettingsReady &&
    dailyReportCommentSettings.enabled === true;
  useEffect(() => {
    let active = true;
    setLoadingState(null); setLoadingSummary({}); setLatestReports([]); setPostReads({});
    setProjects([]); setHighlightProjects([]); setPosts([]); setNotices([]); setDailyReports([]); setClubEvents([]); setPersonalEvents([]); setTagGroups([]); setCurrentParams({});
    setCalendarWindow(monthWindow());
    setWorkspaceChannel(""); setPinnedPosts([]);
    if (!authorized) return undefined;
    const stop = subscribeLoadingState(activeTeamId, (value) => { if (active) setLoadingState({ ...value, _teamId: activeTeamId }); }, () => { if (active) setLoadingState({ _teamId: activeTeamId }); });
    return () => { active = false; stop(); };
  }, [activeTeamId, user?.uid, authorized]);
  useEffect(() => {
    if (!optimize || !authorized) return undefined;
    let active = true;
    const stop = subscribeLoadingSummary(activeTeamId, user.uid, (value) => { if (active) setLoadingSummary(value); }, () => {});
    return () => { active = false; stop(); };
  }, [activeTeamId, user?.uid, authorized, optimize]);
  useEffect(() => {
    if (!optimize || !authorized || currentScreen !== "Roster") { setLatestReports([]); return undefined; }
    let active = true;
    const stop = subscribeLatestReports(activeTeamId, (value) => { if (active) setLatestReports(value); }, () => {});
    return () => { active = false; stop(); };
  }, [activeTeamId, authorized, optimize, currentScreen]);
  useEffect(() => {
    if (!optimize || !authorized || currentScreen !== "WorkspaceHome" || !workspaceChannel) { setPinnedPosts([]); return undefined; }
    let active = true;
    const stop = subscribePinnedPosts(activeTeamId, user.uid, workspaceChannel, (items) => { if (active) setPinnedPosts(items); }, () => {});
    return () => { active = false; stop(); };
  }, [activeTeamId, user?.uid, optimize, authorized, currentScreen, workspaceChannel]);
  const basePosts = useMemo(() => [...new Map([...posts, ...pinnedPosts].map((post) => [post.id, post])).values()], [posts, pinnedPosts]);
  const postIds = basePosts.map((post) => post.id).sort().join("|");
  useEffect(() => {
    if (!readStateAvailable || !authorized || currentScreen !== "WorkspaceHome") { setPostReads({}); return undefined; }
    let active = true;
    const stop = subscribePostReadStates(activeTeamId, postIds ? postIds.split("|") : [], (value) => { if (active) setPostReads(value); }, () => {});
    return () => { active = false; stop(); };
  }, [activeTeamId, readStateAvailable, authorized, currentScreen, postIds]);
  const displayedPosts = useMemo(() => readStateAvailable ? basePosts.map((post) => mergeReadState(post, postReads[post.id], userProfiles)) : basePosts, [basePosts, postReads, userProfiles, readStateAvailable]);
  const historiesActive = optimize && authorized;
  const postHistory = useHistoryData(activeTeamId, "workspacePosts", historiesActive && currentScreen === "WorkspaceHome" && Boolean(workspaceChannel), { uid: user?.uid, channel: workspaceChannel }, setPosts);
  const noticeHistory = useHistoryData(activeTeamId, "notices", historiesActive && currentScreen === "NoticeBoard", {}, setNotices);
  const reportHistory = useHistoryData(activeTeamId, "dailyReports", historiesActive && currentScreen === "Diary", { since: monthAgo() }, setDailyReports);
  const clubHistory = useHistoryData(activeTeamId, "clubEvents", historiesActive && currentScreen === "Calendar", calendarWindow, setClubEvents);
  const personalHistory = useHistoryData(activeTeamId, "personalEvents", historiesActive && currentScreen === "Calendar", { ...calendarWindow, uid: user?.uid }, setPersonalEvents);
  const videoScreen = ["ProjectList", "ProjectDetail", "TacticalNotes"].includes(currentScreen);
  const projectHistory = useHistoryData(activeTeamId, "projects", historiesActive && videoScreen, {}, setProjects);
  const highlightHistory = useHistoryData(activeTeamId, "highlightProjects", historiesActive && videoScreen, {}, setHighlightProjects);
  useHistoryData(activeTeamId, "tagGroups", historiesActive && (videoScreen || currentScreen === "TagGroupEdit"), {}, setTagGroups);
  useEffect(() => {
    if (!optimize) return;
    if (currentScreen === "WorkspaceHome") postHistory.include(currentParams.postId);
    if (currentScreen === "Diary") reportHistory.include(currentParams.reportId);
    if (currentScreen === "NoticeBoard") noticeHistory.include(currentParams.noticeId);
  }, [optimize, currentScreen, workspaceChannel, currentParams.postId, currentParams.reportId, currentParams.noticeId, postHistory.include, reportHistory.include, noticeHistory.include]);

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

  // Basic team information does not depend on the history optimization gate.
  useEffect(() => {
    setTeamScope({ teamId: activeTeamId, uid: user?.uid });
    setTeamName("チーム情報を読み込み中...");
    setClubMembers([]);
    setUserProfiles({});
    setGrades(["1年生", "2年生", "3年生"]);
    setPositions(["GK", "CP", "マネージャー"]);
    setInterstitialSettings({ ...DEFAULT_INTERSTITIAL_SETTINGS });
    setAbsenceDeadlineDaysBefore(DEFAULT_ABSENCE_DEADLINE_DAYS_BEFORE);
    setAbsenceDetailsVisible(DEFAULT_ABSENCE_DETAILS_VISIBLE);
    setDailyReportCommentSettings(null);
    if (authorized) {
      let active = true;
      const unsubTeam = subscribeTeamData(activeTeamId, (data) => {
        if (!active) return;
        setDailyReportCommentSettings({ teamId: activeTeamId, uid: user.uid,
          enabled: data?.dailyReportCommentsEnabled === true });
        if (data) {
          setTeamName(data.name || "名称未設定のチーム");
          setGrades(data.grades ?? ["1年生", "2年生", "3年生"]);
          setPositions(data.positions ?? ["GK", "CP", "マネージャー"]);
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
          setAbsenceDetailsVisible(data.absenceDetailsVisible !== false);
        }
      });

      const unsubMembers = subscribeTeamMembers(activeTeamId, (membersData) => {
        if (!active) return;
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
            canPostTacticalNotes: Boolean(m.canPostTacticalNotes),
            canEditTags: Boolean(m.canEditTags),
            canEditCalendar: Boolean(m.canEditCalendar),
            grade: m.grade || "",
            position: m.position || "",
          };
        });
        setClubMembers(names);
        setUserProfiles(profiles);
      });

      return () => {
        active = false;
        unsubTeam();
        unsubMembers();
      };
    }
  }, [user?.uid, activeTeamId, authorized]);

  // Preserve legacy history loading until preparation and explicit activation.
  useEffect(() => {
    if (!authorized || !loadingStateResolved || optimize) return undefined;
    let active = true;
    const receive = (setter) => (value) => { if (active) setter(value); };
    const stops = [
      subscribeProjects(activeTeamId, receive(setProjects)),
      subscribeHighlightProjects(activeTeamId, receive(setHighlightProjects)),
      subscribeDailyReports(activeTeamId, receive(setDailyReports)),
      subscribeNotices(activeTeamId, receive(setNotices)),
      subscribeWorkspacePosts(activeTeamId, user.uid, receive(setPosts)),
      subscribePersonalEvents(user.uid, receive(setPersonalEvents)),
      subscribeClubEvents(activeTeamId, receive(setClubEvents)),
      subscribeTagGroups(activeTeamId, receive(setTagGroups)),
    ];
    return () => { active = false; stops.forEach((stop) => stop()); };
  }, [user?.uid, activeTeamId, authorized, optimize, loadingStateResolved]);

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
    setCurrentScreen(currentRouteNameRef.current);
    setCurrentParams(navigationRef.getCurrentRoute()?.params || {});
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
    setCurrentScreen(currentRouteName);
    setCurrentParams(navigationRef.getCurrentRoute()?.params || {});
  };

  return (
    <SafeAreaProvider>
      <NavigationArea style={{ flex: 1 }}>
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
                  key={activeTeamId}
                  history={optimize ? postHistory : null}
                  loadingSummary={optimize ? loadingSummary : null}
                  optimize={optimize}
                  separateReads={separateReads}
                  onChannelChange={setWorkspaceChannel}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  teamName={teamName}
                  notices={notices}
                  setNotices={setNotices}
                  posts={displayedPosts}
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
                  key={activeTeamId}
                  history={optimize ? noticeHistory : null}
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
                  dailyReportCommentsEnabled={dailyReportCommentsEnabled}
                  {...props}
                  key={activeTeamId}
                  history={optimize ? reportHistory : null}
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
                  key={activeTeamId}
                  optimize={optimize}
                  eventHistory={optimize ? { busy: clubHistory.busy || personalHistory.busy, error: clubHistory.error || personalHistory.error, retry: () => { clubHistory.retry(); personalHistory.retry(); } } : null}
                  onVisibleMonthChange={optimize ? (date) => setCalendarWindow(monthWindow(date)) : undefined}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  clubEvents={clubEvents} // ★ 修正：projects ではなく clubEvents を渡す
                  dailyReports={dailyReports}
                  userProfiles={userProfiles}
                  personalEvents={personalEvents}
                  setPersonalEvents={setPersonalEvents}
                  absenceDeadlineDaysBefore={absenceDeadlineDaysBefore}
                  absenceDetailsVisible={absenceDetailsVisible}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="ProjectList">
              {(props) => (
                <ProjectListScreen
                  {...props}
                  key={activeTeamId}
                  history={optimize ? projectHistory : null}
                  highlightHistory={optimize ? highlightHistory : null}
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

            <Stack.Screen name="TacticalNotes">
              {(props) => <TacticalNotesScreen {...props} key={activeTeamId}
                currentUser={safeUserName} currentUserUid={currentUserUid}
                projects={projects} highlightProjects={highlightProjects} userProfiles={userProfiles} />}
            </Stack.Screen>

            <Stack.Screen name="ProjectDetail">
              {(props) => (
                <ProjectDetailScreen
                  {...props}
                  key={activeTeamId}
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
                  key={activeTeamId}
                  isAdmin={authIsAdmin}
                  currentUser={safeUserName}
                  currentUserUid={currentUserUid}
                  activeTeamId={activeTeamId}
                  clubMembers={clubMembers}
                  userProfiles={userProfiles}
                  dailyReports={optimize ? latestReports : dailyReports}
                  grades={grades}
                  positions={positions}
                  alertThresholds={alertThresholds}
                />
              )}
            </Stack.Screen>

            <Stack.Screen name="Settings">
              {(props) => (
                <SettingsScreen
                  dailyReportCommentsEnabled={dailyReportCommentsEnabled}
                  dailyReportCommentSettingsReady={dailyReportCommentSettingsReady}
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
                  absenceDetailsVisible={absenceDetailsVisible}
                  setAbsenceDetailsVisible={setAbsenceDetailsVisible}
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
      {authorized && !teamSelectionRequired && (
        isTeamSwitching || !loadingStateResolved ||
        teamScope?.teamId !== activeTeamId || teamScope?.uid !== user?.uid
      ) && (
        <View accessibilityRole="progressbar" accessibilityLabel="チームを切り替え中"
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
            zIndex: 10, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color="#0077cc" />
          <Text style={{ marginTop: 15 }}>チーム情報を読み込み中...</Text>
        </View>
      )}
      </NavigationArea>
      <AppBannerAd />
    </SafeAreaProvider>
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
