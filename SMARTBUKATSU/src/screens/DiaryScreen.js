import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ★ Firestore通信用の関数をインポート
import { useAuth } from "../AuthContext";
import {
  createDailyReport,
  updateDailyReport,
  deleteDailyReport,
} from "../services/firestoreService";

// ★ カラーパレットの定義
const COLORS = {
  primary: "#0077cc",
  secondary: "#f39c12",
  danger: "#e74c3c",
  success: "#27ae60",
  background: "#f0f2f5",
  card: "#ffffff",
  textMain: "#333333",
  textSub: "#666666",
  border: "#eeeeee",
};

const OptionGroup = ({
  options,
  selected,
  onSelect,
  color = COLORS.primary,
}) => (
  <View style={styles.optionGroup}>
    {options.map((opt) => (
      <TouchableOpacity
        key={opt}
        style={[
          styles.optionBtn,
          selected === opt && { backgroundColor: color, borderColor: color },
        ]}
        onPress={() => onSelect(opt)}
      >
        <Text
          style={[styles.optionBtnText, selected === opt && { color: "#fff" }]}
        >
          {opt}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

const ScaleSelector = ({ selected, onSelect, color }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={styles.scaleScroll}
  >
    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
      <TouchableOpacity
        key={num}
        style={[
          styles.scaleBtn,
          selected === num && { backgroundColor: color, borderColor: color },
        ]}
        onPress={() => onSelect(num)}
      >
        <Text
          style={[styles.scaleBtnText, selected === num && { color: "#fff" }]}
        >
          {num}
        </Text>
      </TouchableOpacity>
    ))}
  </ScrollView>
);

const DiaryScreen = ({
  navigation,
  isAdmin,
  currentUser,
  isOffline,
  grades,
  positions,
  posts,
  setPosts,
  userProfiles = {},
  dailyReports = [],
  setDailyReports,
  alertThresholds = {
    fatigueWarning: 7,
    fatigueDanger: 9,
    painDanger: 7,
    autoEscalate: true,
  },
}) => {
  const { activeTeamId } = useAuth();

  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");
  const isStaffOrAbove = ["owner", "staff"].includes(userRole);

  const roleNameMap = {
    owner: "管理者(監督)",
    staff: "コーチ(スタッフ)",
    captain: `${currentUser}(キャプテン)`,
    member: currentUser,
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [editingReportId, setEditingReportId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  // === 入力ステート（メディカル ＋ 日記） ===
  const [condition, setCondition] = useState("良い");
  const [fatigue, setFatigue] = useState(5);
  const [sleep, setSleep] = useState("7h");
  const [isParticipating, setIsParticipating] = useState("通常");
  const [hasPain, setHasPain] = useState(false);
  const [painPart, setPainPart] = useState("");
  const [painLevel, setPainLevel] = useState(5);
  const [sinceWhen, setSinceWhen] = useState("");
  const [treatment, setTreatment] = useState("");
  const [practiceContent, setPracticeContent] = useState("");
  const [achievement, setAchievement] = useState(3);
  const [goodPoint, setGoodPoint] = useState("");
  const [badPoint, setBadPoint] = useState("");
  const [nextTask, setNextTask] = useState("");
  const [images, setImages] = useState([]);
  const [memo, setMemo] = useState("");
  const [highlightLink, setHighlightLink] = useState("");
  const [showMemoInput, setShowMemoInput] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);

  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDates, setExpandedDates] = useState({});

  const REPLY_TEMPLATES = [
    { label: "👍 励ます", text: "お疲れ様！その調子で引き続き頑張ろう。" },
    {
      label: "🎯 課題提示",
      text: "今日の反省を踏まえて、明日はこの課題を一番に意識して練習に入ろう。",
    },
    {
      label: "👀 次回確認",
      text: "次回の練習で実際の動き（フォーム）を直接確認するね。",
    },
    {
      label: "🏥 メディカル",
      text: "無理せず、明日は別メニューで様子を見ましょう。",
    },
  ];

  useEffect(() => {
    if (!isOffline) {
      const pendingReports = dailyReports.filter(
        (r) => r.status === "pending" && r.author === currentUser,
      );
      if (pendingReports.length > 0) {
        setIsLoading(true);
        setTimeout(() => {
          setDailyReports((prev) =>
            prev.map((r) =>
              r.status === "pending" && r.author === currentUser
                ? { ...r, status: "sent" }
                : r,
            ),
          );
          setIsLoading(false);
          Alert.alert(
            "📶 通信復旧",
            "待機していた振り返りを自動で送信しました！",
          );
        }, 1500);
      }
    }
  }, [isOffline]);

  const getAlertLevel = (record) => {
    let level = "normal";
    if (!record.condition) return "normal";
    if (
      record.condition === "不良" ||
      record.isParticipating === "不可" ||
      record.fatigue >= alertThresholds.fatigueDanger ||
      (record.hasPain &&
        record.painDetails?.level >= alertThresholds.painDanger)
    )
      return "danger";
    if (
      record.fatigue >= alertThresholds.fatigueWarning ||
      record.isParticipating === "制限" ||
      record.hasPain
    )
      return "warning";
    return level;
  };

  const staffScope = currentUserProfile.staffScope || "all";

  let processedReports = dailyReports.filter((d) => {
    if (d.status === "deleted") return false;
    if (d.sharedWith === "all") return true;
    if (userRole === "owner") return true;
    if (userRole === "staff") {
      if (staffScope === "all") return true;
      if (staffScope === "assigned") {
        const authorProfile = userProfiles[d.author] || {};
        return authorProfile.assignedStaff === currentUser;
      }
    }
    if (userRole === "member" || userRole === "captain") {
      return d.author === currentUser;
    }
    return false;
  });

  // ★ 修正：件数をタブで絞り込む「前」に計算しておく
  const unreviewedCount = isStaffOrAbove
    ? processedReports.filter((d) => !d.isReviewed).length
    : 0;

  const needsFollowUpCount = isStaffOrAbove
    ? processedReports.filter((d) => d.isFollowUp === true).length
    : 0;

  // タブによる絞り込み
  if (isStaffOrAbove) {
    if (activeTab === "unread")
      processedReports = processedReports.filter((d) => !d.isReviewed);
    else if (activeTab === "needs_followup")
      processedReports = processedReports.filter((d) => d.isFollowUp === true);
    else if (activeTab === "danger")
      processedReports = processedReports.filter(
        (d) => getAlertLevel(d) === "danger",
      );
    else if (activeTab === "starred")
      processedReports = processedReports.filter((d) => d.isStarred);

    if (searchQuery.trim() !== "") {
      const lowerQ = searchQuery.toLowerCase();
      processedReports = processedReports.filter(
        (d) =>
          d.author.toLowerCase().includes(lowerQ) ||
          (d.practiceContent &&
            d.practiceContent.toLowerCase().includes(lowerQ)),
      );
    }
  }

  const groupedReports = processedReports.reduce((acc, report) => {
    if (!acc[report.date]) acc[report.date] = [];
    acc[report.date].push(report);
    return acc;
  }, {});
  const sortedDates = Object.keys(groupedReports).sort(
    (a, b) => new Date(b) - new Date(a),
  );

  const isExpanded = (date, index) => {
    if (expandedDates[date] !== undefined) return expandedDates[date];
    return index === 0;
  };

  const toggleDate = (date, index) => {
    setExpandedDates((prev) => {
      const currentState = prev[date] !== undefined ? prev[date] : index === 0;
      return { ...prev, [date]: !currentState };
    });
  };

  const handleCreateOrEditReport = async () => {
    if (hasPain && !painPart.trim()) {
      Alert.alert("入力エラー", "痛む部位を入力してください。");
      return;
    }
    setIsLoading(true);
    setTimeout(async () => {
      const safeTeamId = activeTeamId || "test_team";
      const painDetailsData = hasPain
        ? { part: painPart, level: painLevel, sinceWhen, treatment }
        : null;
      try {
        if (editingReportId) {
          const updateData = {
            condition,
            fatigue,
            sleep,
            isParticipating,
            hasPain,
            painDetails: painDetailsData,
            practiceContent,
            achievement,
            goodPoint,
            badPoint,
            nextTask,
            images,
            memo,
            highlightLink,
            status: isOffline ? "pending" : "sent",
          };
          setDailyReports(
            dailyReports.map((r) =>
              r.id === editingReportId ? { ...r, ...updateData } : r,
            ),
          );
          if (!isOffline)
            await updateDailyReport(safeTeamId, editingReportId, updateData);
          Alert.alert("修正完了", "振り返りを修正しました。");
        } else {
          const today = new Date();
          const dateString = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
          const newReport = {
            id: "rep_" + Date.now().toString(),
            date: dateString,
            author: currentUser,
            condition,
            fatigue,
            sleep,
            isParticipating,
            hasPain,
            painDetails: painDetailsData,
            practiceContent,
            achievement,
            goodPoint,
            badPoint,
            nextTask,
            images,
            memo,
            highlightLink,
            status: isOffline ? "pending" : "sent",
            isReviewed: false,
            isStarred: false,
            isFollowUp: false,
            sharedWith: "staff",
            createdAt: Date.now(),
            comments: [],
          };
          setDailyReports([newReport, ...dailyReports]);
          if (!isOffline) await createDailyReport(safeTeamId, newReport);
          Alert.alert("記録完了", "本日の振り返りを記録しました。");
        }
      } catch (error) {
        console.log(error);
      } finally {
        setIsCreateModalVisible(false);
        resetForm();
        Keyboard.dismiss();
        setIsLoading(false);
      }
    }, 400);
  };

  const resetForm = () => {
    setEditingReportId(null);
    setCondition("良い");
    setFatigue(5);
    setSleep("7h");
    setIsParticipating("通常");
    setHasPain(false);
    setPainPart("");
    setPainLevel(5);
    setSinceWhen("");
    setTreatment("");
    setPracticeContent("");
    setAchievement(3);
    setGoodPoint("");
    setBadPoint("");
    setNextTask("");
    setImages([]);
    setMemo("");
    setHighlightLink("");
    setShowMemoInput(false);
    setShowLinkInput(false);
  };

  const renderStars = (rating, onSelect = null) => (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((num) => (
        <TouchableOpacity
          key={num}
          disabled={!onSelect}
          onPress={() => onSelect && onSelect(num)}
        >
          <Text
            style={[
              styles.star,
              { color: num <= rating ? "#f1c40f" : "#e0e0e0" },
            ]}
          >
            ★
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  // ★ 日付ごとの平均疲労度グラフを表示するコンポーネント
  const TeamFatigueGraph = ({ reports }) => {
    const avg = useMemo(() => {
      if (reports.length === 0) return 0;
      const total = reports.reduce(
        (sum, r) => sum + (Number(r.fatigue) || 0),
        0,
      );
      return (total / reports.length).toFixed(1);
    }, [reports]);

    return (
      <View style={styles.graphContainer}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginBottom: 5,
          }}
        >
          <Text style={styles.graphLabel}>
            チーム平均疲労度:{" "}
            <Text style={{ fontWeight: "bold", fontSize: 16 }}>{avg}</Text> / 10
          </Text>
          <Text style={styles.graphLabel}>提出: {reports.length}人</Text>
        </View>
        <View style={styles.graphBarBackground}>
          <View
            style={[
              styles.graphBarFill,
              {
                width: `${(avg / 10) * 100}%`,
                backgroundColor:
                  avg >= alertThresholds.fatigueDanger
                    ? COLORS.danger
                    : avg >= alertThresholds.fatigueWarning
                      ? COLORS.secondary
                      : COLORS.success,
              },
            ]}
          />
        </View>
        <View style={styles.graphScale}>
          <Text style={styles.graphScaleText}>0 (快調)</Text>
          <Text style={styles.graphScaleText}>5</Text>
          <Text style={styles.graphScaleText}>10 (限界)</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, isOffline && styles.headerOffline]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>◁ ホーム</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isOffline ? "⚠️ オフライン" : "📝 振り返り（日報）"}
        </Text>
        <View style={styles.headerRight} />
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <ActivityIndicator
            size="small"
            color="#fff"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.offlineBannerText}>
            現在オフラインです。通信復旧時に自動同期されます。
          </Text>
        </View>
      )}

      {isStaffOrAbove && (
        <View style={styles.adminDashboard}>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInputFlex}
              placeholder="部員名やキーワードで検索..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabScroll}
            contentContainerStyle={{ paddingHorizontal: 15 }}
          >
            {["all", "unread", "danger", "needs_followup", "starred"].map(
              (tab) => (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setActiveTab(tab)}
                  style={[styles.tabBtn, activeTab === tab && styles.tabActive]}
                >
                  <Text
                    style={[
                      styles.tabText,
                      activeTab === tab && styles.tabTextActive,
                    ]}
                  >
                    {tab === "all"
                      ? "すべて"
                      : tab === "unread"
                        ? `未読 (${unreviewedCount})`
                        : tab === "danger"
                          ? "🚨 危険"
                          : tab === "needs_followup"
                            ? `🚩 要フォロー (${needsFollowUpCount})`
                            : "⭐ スター"}
                  </Text>
                </TouchableOpacity>
              ),
            )}
          </ScrollView>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {sortedDates.length === 0 ? (
          <Text style={styles.emptyText}>データがありません。</Text>
        ) : (
          sortedDates.map((date, index) => {
            const reportsInDate = groupedReports[date];
            const expanded = isExpanded(date, index);
            const hasUnreviewed = reportsInDate.some((d) => !d.isReviewed);

            return (
              <View key={date} style={styles.dateGroupContainer}>
                <TouchableOpacity
                  style={styles.dateHeader}
                  onPress={() => toggleDate(date, index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateHeaderText}>
                    {expanded ? "▼" : "▶"} {date} ── [ {reportsInDate.length}件
                    ]
                  </Text>
                  {hasUnreviewed && isStaffOrAbove && (
                    <View style={styles.unreadAlertBadge}>
                      <Text style={styles.unreadAlertBadgeText}>未確認</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {expanded && (
                  <View style={styles.expandedSection}>
                    {/* ★ 管理者の場合、その日付のトップに平均グラフを表示 */}
                    {isStaffOrAbove && (
                      <TeamFatigueGraph reports={reportsInDate} />
                    )}

                    {reportsInDate.map((report) => {
                      const alertLevel = getAlertLevel(report);
                      const isPending = report.status === "pending";
                      return (
                        <TouchableOpacity
                          key={report.id}
                          style={[
                            styles.card,
                            isPending && styles.pendingCard,
                            isStaffOrAbove &&
                              alertLevel === "danger" &&
                              styles.dangerCard,
                            isStaffOrAbove &&
                              alertLevel === "warning" &&
                              styles.warningCard,
                          ]}
                          activeOpacity={0.9}
                          onPress={() => setSelectedReport(report)}
                        >
                          <View style={styles.cardHeader}>
                            <Text style={styles.cardAuthorLarge}>
                              {isStaffOrAbove || report.author !== currentUser
                                ? `👤 ${report.author}`
                                : `👤 自分`}
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                              }}
                            >
                              {isPending && (
                                <Text style={styles.pendingText}>🕒待機中</Text>
                              )}
                              {report.sharedWith === "all" && (
                                <Text style={styles.badgeShared}>📢 共有</Text>
                              )}
                              {report.isFollowUp && (
                                <Text style={{ fontSize: 14, marginRight: 5 }}>
                                  📌
                                </Text>
                              )}
                              {report.isStarred && (
                                <Text style={{ fontSize: 14, marginRight: 5 }}>
                                  ⭐
                                </Text>
                              )}
                              <Text
                                style={
                                  report.isReviewed
                                    ? styles.badgeReviewed
                                    : styles.badgeUnreviewed
                                }
                              >
                                {report.isReviewed ? "✅" : "未確認"}
                              </Text>
                            </View>
                          </View>
                          {report.condition && (
                            <View style={styles.miniMedicalRow}>
                              <Text style={styles.miniMedicalText}>
                                体調: {report.condition}
                              </Text>
                              <Text style={styles.miniMedicalText}>
                                疲労: {report.fatigue}/10
                              </Text>
                              <Text
                                style={[
                                  styles.miniMedicalText,
                                  report.hasPain && { color: COLORS.danger },
                                ]}
                              >
                                ケガ: {report.hasPain ? "あり" : "なし"}
                              </Text>
                            </View>
                          )}
                          <View style={styles.cardSection}>
                            <Text style={styles.sectionLabel}>🏃 練習内容</Text>
                            <Text style={styles.sectionText} numberOfLines={1}>
                              {report.practiceContent || "（未入力）"}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {["member", "captain"].includes(userRole) && (
        <TouchableOpacity
          style={[
            styles.fab,
            isOffline && { backgroundColor: COLORS.secondary },
          ]}
          onPress={() => {
            resetForm();
            setIsCreateModalVisible(true);
          }}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      {isLoading && (
        <View style={styles.globalLoadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.globalLoadingText}>処理中...</Text>
        </View>
      )}

      {/* 詳細表示モーダル */}
      <Modal
        visible={selectedReport !== null}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.detailContainer}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setSelectedReport(null)}>
                <Text style={styles.closeBtn}>◁ 戻る</Text>
              </TouchableOpacity>
              <Text style={styles.createHeaderTitle}>
                {selectedReport?.author} の日報
              </Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView style={styles.detailScroll}>
              <View style={styles.detailCard}>
                <Text style={styles.cardDate}>{selectedReport?.date}</Text>
                <View style={styles.cardSection}>
                  <Text style={styles.sectionLabel}>🏃 練習内容</Text>
                  <Text style={styles.sectionText}>
                    {selectedReport?.practiceContent || "（未入力）"}
                  </Text>
                </View>
                <View style={styles.cardSection}>
                  <Text style={styles.sectionLabel}>📈 今日の達成度</Text>
                  {renderStars(selectedReport?.achievement || 0)}
                </View>
                <View style={styles.cardSection}>
                  <Text style={styles.sectionLabel}>✨ 良かった点</Text>
                  <Text style={styles.sectionText}>
                    {selectedReport?.goodPoint || "なし"}
                  </Text>
                </View>
                <View style={styles.cardSection}>
                  <Text style={styles.sectionLabel}>🤔 改善点</Text>
                  <Text style={styles.sectionText}>
                    {selectedReport?.badPoint || "なし"}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* 作成モーダル */}
      <Modal
        visible={isCreateModalVisible}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <View style={styles.createContainer}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setIsCreateModalVisible(false)}>
                <Text style={styles.closeBtn}>✕ 閉じる</Text>
              </TouchableOpacity>
              <Text style={styles.createHeaderTitle}>振り返りの入力</Text>
              <View style={{ width: 60 }} />
            </View>
            <ScrollView style={styles.createScroll}>
              <View style={styles.formSection}>
                <Text style={styles.inputLabel}>🏃 練習内容</Text>
                <TextInput
                  style={styles.inputSingle}
                  value={practiceContent}
                  onChangeText={setPracticeContent}
                />
                <Text style={styles.inputLabel}>📈 達成度</Text>
                {renderStars(achievement, setAchievement)}
                <Text style={styles.inputLabel}>🔋 疲労度 (0-10)</Text>
                <ScaleSelector
                  selected={fatigue}
                  onSelect={setFatigue}
                  color={COLORS.secondary}
                />
                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={handleCreateOrEditReport}
                >
                  <Text style={styles.submitButtonText}>提出する</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  globalLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  globalLoadingText: {
    marginTop: 10,
    color: COLORS.primary,
    fontWeight: "bold",
    fontSize: 16,
  },
  offlineBanner: {
    backgroundColor: COLORS.secondary,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  header: {
    height: 60,
    backgroundColor: COLORS.success,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  adminDashboard: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 5,
  },
  searchRow: { padding: 10 },
  searchInputFlex: {
    backgroundColor: "#f0f2f5",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  tabScroll: { borderBottomWidth: 1, borderBottomColor: "#eee" },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginRight: 5,
  },
  tabActive: { borderBottomColor: COLORS.success },
  tabText: { fontSize: 14, color: "#666", fontWeight: "bold" },
  tabTextActive: { color: COLORS.success },
  content: { padding: 15 },
  dateGroupContainer: { marginBottom: 15 },
  dateHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#e0e0e0",
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  dateHeaderText: { fontSize: 14, fontWeight: "bold", color: "#555" },
  unreadAlertBadge: {
    backgroundColor: COLORS.danger,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 10,
  },
  unreadAlertBadgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  expandedSection: { paddingHorizontal: 5 },

  // ★ グラフ用スタイル
  graphContainer: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    backgroundColor: "#fff",
    elevation: 2,
  },
  graphTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: COLORS.textMain,
    marginBottom: 10,
  },
  graphLabel: { fontSize: 12, color: COLORS.textSub },
  graphBarBackground: {
    height: 12,
    backgroundColor: "#eee",
    borderRadius: 6,
    overflow: "hidden",
  },
  graphBarFill: { height: "100%", borderRadius: 6 },
  graphScale: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
  },
  graphScaleText: { fontSize: 10, color: "#aaa" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.success,
  },
  warningCard: {
    borderLeftColor: COLORS.secondary,
    backgroundColor: "#fffdf5",
  },
  dangerCard: { borderLeftColor: COLORS.danger, backgroundColor: "#fff5f5" },
  pendingCard: {
    opacity: 0.7,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: COLORS.secondary,
  },
  pendingText: {
    position: "absolute",
    top: 10,
    right: 10,
    fontSize: 10,
    color: COLORS.secondary,
    fontWeight: "bold",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  cardAuthorLarge: { fontSize: 16, color: COLORS.primary, fontWeight: "bold" },
  badgeReviewed: {
    backgroundColor: "#e8f5e9",
    color: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: "bold",
    overflow: "hidden",
  },
  badgeUnreviewed: {
    backgroundColor: "#fdf3f2",
    color: COLORS.danger,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: "bold",
    overflow: "hidden",
  },
  badgeShared: {
    backgroundColor: "#e8f0fe",
    color: "#2980b9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: "bold",
    marginRight: 5,
    overflow: "hidden",
  },
  miniMedicalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#f9f9f9",
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
  },
  miniMedicalText: { fontSize: 12, color: "#555", fontWeight: "bold" },
  cardSection: {
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 5,
  },
  sectionText: { fontSize: 14, color: "#333", lineHeight: 20 },
  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    backgroundColor: COLORS.success,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
  },
  fabIcon: { fontSize: 30, color: "#fff", fontWeight: "bold" },
  modalSafeArea: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  detailContainer: {
    flex: 1,
    backgroundColor: "#f0f2f5",
    marginTop: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
    alignItems: "center",
  },
  closeBtn: { fontSize: 16, color: COLORS.primary, fontWeight: "bold" },
  createHeaderTitle: { fontSize: 16, fontWeight: "bold", color: "#333" },
  detailScroll: { padding: 15 },
  detailCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  cardDate: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
  },
  starsRow: { flexDirection: "row", marginBottom: 10 },
  star: { fontSize: 28, marginRight: 2 },
  createContainer: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    marginTop: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  createScroll: { padding: 15 },
  formSection: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    elevation: 2,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
    marginTop: 10,
  },
  inputSingle: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  optionGroup: { flexDirection: "row", flexWrap: "wrap", marginBottom: 5 },
  optionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ccc",
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  optionBtnText: { fontSize: 13, fontWeight: "bold", color: "#555" },
  scaleScroll: { flexDirection: "row", marginBottom: 5 },
  scaleBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
    backgroundColor: "#fff",
  },
  scaleBtnText: { fontSize: 14, fontWeight: "bold", color: "#555" },
  submitButton: {
    backgroundColor: COLORS.success,
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 25,
  },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});

export default DiaryScreen;
