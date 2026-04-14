import React, { useState, useEffect } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const OptionGroup = ({ options, selected, onSelect, color = "#0077cc" }) => (
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
  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");
  const isStaffOrAbove = ["owner", "staff"].includes(userRole);

  const roleNameMap = {
    owner: `${currentUser}(監督)`,
    admin: `${currentUser}(管理者)`,
    staff: `${currentUser}(コーチ)`,
    captain: `${currentUser}(キャプテン)`,
    member: currentUser, // 「(あなた)」や「佐藤(自分)」を削除し、純粋な名前のみに！
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);
  const [commentText, setCommentText] = useState("");
  const [editingReportId, setEditingReportId] = useState(null);

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
  // ========================================

  // ★ 修正：デフォルトのタブを「unread(未読)」から「all(すべて)」に変更しました！
  // これにより、確認済みにしてもリストに残り続けます。
  const [activeTab, setActiveTab] = useState("all");

  const [searchQuery, setSearchQuery] = useState("");
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
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

  if (isStaffOrAbove) {
    if (activeTab === "unread") {
      processedReports = processedReports.filter((d) => !d.isReviewed);
    } else if (activeTab === "needs_reply") {
      processedReports = processedReports.filter(
        (d) =>
          d.comments.filter((c) =>
            ["監督", "コーチ", "アシスタント", "管理者"].some((role) =>
              c.user.includes(role),
            ),
          ).length === 0,
      );
    } else if (activeTab === "replied") {
      processedReports = processedReports.filter(
        (d) =>
          d.comments.filter((c) =>
            ["監督", "コーチ", "アシスタント", "管理者"].some((role) =>
              c.user.includes(role),
            ),
          ).length > 0,
      );
    } else if (activeTab === "danger") {
      processedReports = processedReports.filter(
        (d) => getAlertLevel(d) === "danger",
      );
    } else if (activeTab === "starred") {
      processedReports = processedReports.filter((d) => d.isStarred);
    }

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

  const handleToggleStar = (reportId) => {
    const newReports = dailyReports.map((d) =>
      d.id === reportId ? { ...d, isStarred: !d.isStarred } : d,
    );
    setDailyReports(newReports);
    if (selectedReport && selectedReport.id === reportId)
      setSelectedReport({
        ...selectedReport,
        isStarred: !selectedReport.isStarred,
      });
  };

  const handleToggleFollowUp = (reportId) => {
    const newReports = dailyReports.map((d) =>
      d.id === reportId ? { ...d, isFollowUp: !d.isFollowUp } : d,
    );
    setDailyReports(newReports);
    if (selectedReport && selectedReport.id === reportId)
      setSelectedReport({
        ...selectedReport,
        isFollowUp: !selectedReport.isFollowUp,
      });
  };

  const handleChangeShareScope = (reportId) => {
    const report = dailyReports.find((d) => d.id === reportId);
    const isCurrentlyAll = report?.sharedWith === "all";

    if (isCurrentlyAll) {
      Alert.alert("共有範囲の変更", "スタッフのみの公開に戻しますか？", [
        { text: "キャンセル", style: "cancel" },
        {
          text: "戻す",
          onPress: () => {
            const newReports = dailyReports.map((d) =>
              d.id === reportId ? { ...d, sharedWith: "staff" } : d,
            );
            setDailyReports(newReports);
            if (selectedReport && selectedReport.id === reportId)
              setSelectedReport({ ...selectedReport, sharedWith: "staff" });
          },
        },
      ]);
    } else {
      Alert.alert(
        "共有範囲の変更",
        "チーム全体に公開し、Home画面の「# 共有日記」に通知しますか？\n（※メディカル情報は非公開になります）",
        [
          { text: "キャンセル", style: "cancel" },
          {
            text: "公開する",
            onPress: () => {
              const newReports = dailyReports.map((d) =>
                d.id === reportId ? { ...d, sharedWith: "all" } : d,
              );
              setDailyReports(newReports);
              if (selectedReport && selectedReport.id === reportId)
                setSelectedReport({ ...selectedReport, sharedWith: "all" });

              const sharedPost = {
                id: "post_shared_" + Date.now().toString(),
                channel: "共有日記",
                user: displayUserName,
                content: `📢 ${report.author} の振り返りを共有します！\n\n【練習内容】\n${report.practiceContent || "未入力"}\n\n【良かった点】\n${report.goodPoint || "未入力"}\n\n※詳細は振り返り画面から確認できます。`,
                time: "たった今",
                replyTo: null,
                reactions: {},
                attachments: [],
                replies: [],
                reported: [],
                readCount: 0,
                isPinned: false,
                status: isOffline ? "pending" : "sent",
              };
              setPosts([sharedPost, ...posts]);
            },
          },
        ],
      );
    }
  };

  const handleDiscardDraft = () => {
    Alert.alert("確認", "下書きを破棄してリセットしますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "破棄する",
        style: "destructive",
        onPress: () => {
          resetForm();
          setIsCreateModalVisible(false);
        },
      },
    ]);
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

  const handleCreateOrEditReport = () => {
    if (hasPain && !painPart.trim()) {
      Alert.alert("入力エラー", "痛む部位を入力してください。");
      return;
    }

    if (editingReportId) {
      const updated = dailyReports.map((r) => {
        if (r.id === editingReportId) {
          return {
            ...r,
            condition,
            fatigue,
            sleep,
            isParticipating,
            hasPain,
            painDetails: hasPain
              ? { part: painPart, level: painLevel, sinceWhen, treatment }
              : null,
            practiceContent,
            achievement,
            goodPoint,
            badPoint,
            nextTask,
            images,
            memo,
            highlightLink,
          };
        }
        return r;
      });
      setDailyReports(updated);
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
        painDetails: hasPain
          ? { part: painPart, level: painLevel, sinceWhen, treatment }
          : null,
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
    }
    setIsCreateModalVisible(false);
    resetForm();
    Keyboard.dismiss();
  };

  const handleOpenEdit = () => {
    if (!selectedReport) return;
    setEditingReportId(selectedReport.id);

    setCondition(selectedReport.condition || "良い");
    setFatigue(
      selectedReport.fatigue !== undefined ? selectedReport.fatigue : 5,
    );
    setSleep(selectedReport.sleep || "7h");
    setIsParticipating(selectedReport.isParticipating || "通常");
    setHasPain(selectedReport.hasPain || false);
    if (selectedReport.painDetails) {
      setPainPart(selectedReport.painDetails.part || "");
      setPainLevel(selectedReport.painDetails.level || 5);
      setSinceWhen(selectedReport.painDetails.sinceWhen || "");
      setTreatment(selectedReport.painDetails.treatment || "");
    }

    setPracticeContent(selectedReport.practiceContent || "");
    setAchievement(selectedReport.achievement || 3);
    setGoodPoint(selectedReport.goodPoint || "");
    setBadPoint(selectedReport.badPoint || "");
    setNextTask(selectedReport.nextTask || "");
    setImages(selectedReport.images || []);
    setMemo(selectedReport.memo || "");
    setHighlightLink(selectedReport.highlightLink || "");
    if (selectedReport.memo) setShowMemoInput(true);
    if (selectedReport.highlightLink) setShowLinkInput(true);

    setIsCreateModalVisible(true);
    setSelectedReport(null);
  };

  const handleSendComment = () => {
    if (commentText.trim() === "") return;
    const newComment = {
      id: "c_" + Date.now().toString(),
      user: displayUserName,
      text: commentText,
      time: "たった今",
      status: isOffline ? "pending" : "sent",
    };

    const isStaffComment = isStaffOrAbove;

    const updated = dailyReports.map((r) => {
      if (r.id === selectedReport.id) {
        return {
          ...r,
          comments: [...r.comments, newComment],
          isReviewed: isStaffComment ? true : r.isReviewed,
        };
      }
      return r;
    });
    setDailyReports(updated);

    setSelectedReport((prev) => ({
      ...prev,
      isReviewed: isStaffComment ? true : prev.isReviewed,
      comments: [...prev.comments, newComment],
    }));

    setCommentText("");
    Keyboard.dismiss();
  };

  const handleMarkAsReviewed = () => {
    const updated = dailyReports.map((r) => {
      if (r.id === selectedReport.id) return { ...r, isReviewed: true };
      return r;
    });
    setDailyReports(updated);
    setSelectedReport((prev) => ({ ...prev, isReviewed: true }));
  };

  const renderStars = (rating, onSelect = null) => {
    return (
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
  };

  const unreviewedCount = isStaffOrAbove
    ? processedReports.filter((d) => !d.isReviewed).length
    : 0;
  const needsReplyCount = isStaffOrAbove
    ? processedReports.filter(
        (d) =>
          d.comments.filter((c) =>
            ["監督", "コーチ", "アシスタント", "管理者"].some((role) =>
              c.user.includes(role),
            ),
          ).length === 0,
      ).length
    : 0;

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
          {isOffline ? "オフライン" : "📝 振り返り（日報）"}
        </Text>
        <View style={styles.headerRight} />
      </View>

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
            <TouchableOpacity
              onPress={() => setActiveTab("all")}
              style={[styles.tabBtn, activeTab === "all" && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "all" && styles.tabTextActive,
                ]}
              >
                すべて
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("unread")}
              style={[
                styles.tabBtn,
                activeTab === "unread" && styles.tabActive,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "unread" && styles.tabTextActive,
                ]}
              >
                未読 ({unreviewedCount})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("danger")}
              style={[
                styles.tabBtn,
                activeTab === "danger" && { borderBottomColor: "#c0392b" },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "danger" && { color: "#c0392b" },
                ]}
              >
                🚨 危険
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("needs_reply")}
              style={[
                styles.tabBtn,
                activeTab === "needs_reply" && styles.tabActive,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "needs_reply" && styles.tabTextActive,
                ]}
              >
                要返信 ({needsReplyCount})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("starred")}
              style={[
                styles.tabBtn,
                activeTab === "starred" && styles.tabActive,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "starred" && styles.tabTextActive,
                ]}
              >
                ⭐ スター
              </Text>
            </TouchableOpacity>
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

                {expanded &&
                  reportsInDate.map((report) => {
                    const alertLevel = getAlertLevel(report);
                    return (
                      <TouchableOpacity
                        key={report.id}
                        style={[
                          styles.card,
                          report.status === "pending" && styles.pendingCard,
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
                            {report.sharedWith === "all" && (
                              <Text style={styles.badgeShared}>📢 共有</Text>
                            )}
                            {report.isStarred && (
                              <Text style={{ fontSize: 14, marginRight: 5 }}>
                                ⭐
                              </Text>
                            )}
                            {report.isReviewed ? (
                              <Text style={styles.badgeReviewed}>✅</Text>
                            ) : (
                              <Text style={styles.badgeUnreviewed}>未確認</Text>
                            )}
                          </View>
                        </View>

                        {/* メディカルサマリー部分 */}
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
                                report.hasPain && { color: "#c0392b" },
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

                        <Text style={styles.commentCountText}>
                          💬 やり取り：{report.comments?.length || 0}件
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
              </View>
            );
          })
        )}
      </ScrollView>

      {["member", "captain"].includes(userRole) && (
        <TouchableOpacity
          style={[styles.fab, isOffline && { backgroundColor: "#f39c12" }]}
          onPress={() => {
            resetForm();
            setIsCreateModalVisible(true);
          }}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      {/* 詳細表示モーダル */}
      <Modal
        visible={selectedReport !== null}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            <View style={styles.detailContainer}>
              <View style={styles.detailHeader}>
                <TouchableOpacity onPress={() => setSelectedReport(null)}>
                  <Text style={styles.closeBtn}>◁ 戻る</Text>
                </TouchableOpacity>
                <Text style={styles.createHeaderTitle}>
                  {selectedReport?.author} の日報
                </Text>
                {isStaffOrAbove ? (
                  <TouchableOpacity
                    onPress={() => handleToggleStar(selectedReport.id)}
                  >
                    <Text style={{ fontSize: 20 }}>
                      {selectedReport?.isStarred ? "⭐" : "☆"}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: 60 }} />
                )}
              </View>

              {isStaffOrAbove && selectedReport && (
                <View style={styles.actionToolbarWrapper}>
                  <TouchableOpacity
                    onPress={() => handleToggleStar(selectedReport.id)}
                    style={[
                      styles.actionBtn,
                      selectedReport.isStarred && styles.actionBtnActive,
                    ]}
                  >
                    <Text style={styles.actionBtnText}>
                      {selectedReport.isStarred ? "⭐ スター済" : "☆ スター"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleToggleFollowUp(selectedReport.id)}
                    style={[
                      styles.actionBtn,
                      selectedReport.isFollowUp && styles.actionBtnActive,
                    ]}
                  >
                    <Text style={styles.actionBtnText}>
                      {selectedReport.isFollowUp
                        ? "🎌 フォロー中"
                        : "🚩 要フォロー"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleChangeShareScope(selectedReport.id)}
                    style={[
                      styles.actionBtn,
                      selectedReport.sharedWith === "all" &&
                        styles.actionBtnActive,
                    ]}
                  >
                    <Text style={styles.actionBtnText}>
                      👁️ 共有:{" "}
                      {selectedReport.sharedWith === "all"
                        ? "全体"
                        : "スタッフのみ"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {selectedReport &&
                (() => {
                  const isMyReport =
                    currentUser === selectedReport.author &&
                    ["member", "captain"].includes(userRole);
                  const timeElapsed = Date.now() - selectedReport.createdAt;
                  const isEditable =
                    timeElapsed < 30 * 60 * 1000 && !selectedReport.isReviewed;

                  return (
                    <ScrollView
                      style={styles.detailScroll}
                      contentContainerStyle={{ paddingBottom: 30 }}
                    >
                      {selectedReport.sharedWith === "all" &&
                        !isMyReport &&
                        !isStaffOrAbove && (
                          <View style={styles.sharedBanner}>
                            <Text style={styles.sharedBannerText}>
                              📢 この振り返りはチーム全体に共有されています
                            </Text>
                          </View>
                        )}

                      <View style={styles.detailCard}>
                        <View style={styles.cardHeader}>
                          <Text style={styles.cardDate}>
                            {selectedReport.date}
                          </Text>
                          <View style={{ flexDirection: "row" }}>
                            {isStaffOrAbove && !selectedReport.isReviewed && (
                              <TouchableOpacity
                                style={styles.markReviewedBtn}
                                onPress={handleMarkAsReviewed}
                              >
                                <Text style={styles.markReviewedBtnText}>
                                  ✅ 確認済にする
                                </Text>
                              </TouchableOpacity>
                            )}
                            {isMyReport && isEditable && (
                              <TouchableOpacity
                                style={styles.editBtn}
                                onPress={handleOpenEdit}
                              >
                                <Text style={styles.editBtnText}>✏️ 修正</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>

                        {/* 日記詳細エリア */}
                        <View style={styles.cardSection}>
                          <Text style={styles.sectionLabel}>🏃 練習内容</Text>
                          <Text style={styles.sectionText}>
                            {selectedReport.practiceContent || "（未入力）"}
                          </Text>
                        </View>
                        <View style={styles.cardSection}>
                          <Text style={styles.sectionLabel}>
                            📈 今日の達成度
                          </Text>
                          {renderStars(selectedReport.achievement)}
                        </View>
                        <View
                          style={[
                            styles.cardSection,
                            { backgroundColor: "#eef9f0" },
                          ]}
                        >
                          <Text
                            style={[styles.sectionLabel, { color: "#27ae60" }]}
                          >
                            ✨ 良かった点
                          </Text>
                          <Text style={styles.sectionText}>
                            {selectedReport.goodPoint || "（未入力）"}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.cardSection,
                            { backgroundColor: "#fdf3f2" },
                          ]}
                        >
                          <Text
                            style={[styles.sectionLabel, { color: "#c0392b" }]}
                          >
                            🤔 改善点
                          </Text>
                          <Text style={styles.sectionText}>
                            {selectedReport.badPoint || "（未入力）"}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.cardSection,
                            { backgroundColor: "#f0f4f8" },
                          ]}
                        >
                          <Text
                            style={[styles.sectionLabel, { color: "#2980b9" }]}
                          >
                            🎯 明日の課題
                          </Text>
                          <Text style={styles.sectionText}>
                            {selectedReport.nextTask || "（未入力）"}
                          </Text>
                        </View>

                        {(selectedReport.memo ||
                          selectedReport.images?.length > 0 ||
                          selectedReport.highlightLink) && (
                          <View style={styles.cardSection}>
                            <Text
                              style={[
                                styles.sectionLabel,
                                { color: "#f39c12" },
                              ]}
                            >
                              📎 添付・メモ
                            </Text>
                            {selectedReport.memo ? (
                              <Text style={styles.sectionText}>
                                {selectedReport.memo}
                              </Text>
                            ) : null}
                          </View>
                        )}

                        {/* メディカル詳細エリア */}
                        {selectedReport.condition && (
                          <View style={styles.medicalDetailBox}>
                            <Text style={styles.medicalDetailTitle}>
                              🏥 コンディション
                            </Text>
                            <View style={styles.detailGrid}>
                              <View style={styles.gridItem}>
                                <Text style={styles.gridTitle}>体調</Text>
                                <Text style={styles.gridValue}>
                                  {selectedReport.condition}
                                </Text>
                              </View>
                              <View style={styles.gridItem}>
                                <Text style={styles.gridTitle}>疲労度</Text>
                                <Text style={styles.gridValue}>
                                  {selectedReport.fatigue} / 10
                                </Text>
                              </View>
                              <View style={styles.gridItem}>
                                <Text style={styles.gridTitle}>睡眠時間</Text>
                                <Text style={styles.gridValue}>
                                  {selectedReport.sleep}
                                </Text>
                              </View>
                              <View style={styles.gridItem}>
                                <Text style={styles.gridTitle}>練習可否</Text>
                                <Text
                                  style={[
                                    styles.gridValue,
                                    selectedReport.isParticipating !==
                                      "通常" && { color: "#e74c3c" },
                                  ]}
                                >
                                  {selectedReport.isParticipating}
                                </Text>
                              </View>
                            </View>
                            {selectedReport.hasPain &&
                              selectedReport.painDetails && (
                                <View style={styles.painDetailBox}>
                                  <Text style={styles.painDetailTitle}>
                                    🤕 ケガ・痛みの詳細
                                  </Text>
                                  <Text style={styles.painDetailText}>
                                    部位：{selectedReport.painDetails.part}{" "}
                                    (痛さ: {selectedReport.painDetails.level}
                                    /10)
                                  </Text>
                                  <Text style={styles.painDetailText}>
                                    いつから：
                                    {selectedReport.painDetails.sinceWhen ||
                                      "未入力"}
                                  </Text>
                                  <Text style={styles.painDetailText}>
                                    処置：
                                    {selectedReport.painDetails.treatment ||
                                      "未入力"}
                                  </Text>
                                </View>
                              )}
                          </View>
                        )}
                      </View>

                      <Text style={styles.threadTitle}>
                        💬 コーチとのやり取り
                      </Text>
                      <View style={styles.threadArea}>
                        {selectedReport.comments.map((c) => {
                          const isMe = c.user === displayUserName;
                          return (
                            <View
                              key={c.id}
                              style={[
                                styles.commentBubbleWrapper,
                                isMe
                                  ? styles.commentBubbleRight
                                  : styles.commentBubbleLeft,
                              ]}
                            >
                              {!isMe && (
                                <View style={styles.commentAvatar}>
                                  <Text style={styles.commentAvatarText}>
                                    {c.user.charAt(0)}
                                  </Text>
                                </View>
                              )}
                              <View style={styles.commentContentBox}>
                                {!isMe && (
                                  <Text style={styles.commentUserName}>
                                    {c.user}
                                  </Text>
                                )}
                                <View
                                  style={[
                                    styles.commentBubble,
                                    isMe
                                      ? styles.commentBubbleMe
                                      : styles.commentBubbleOther,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.commentText,
                                      isMe && { color: "#fff" },
                                    ]}
                                  >
                                    {c.text}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    </ScrollView>
                  );
                })()}

              <View
                style={{
                  backgroundColor: "#fff",
                  borderTopWidth: 1,
                  borderTopColor: "#eee",
                }}
              >
                {isStaffOrAbove && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.templateScroll}
                    contentContainerStyle={{ padding: 10 }}
                  >
                    {REPLY_TEMPLATES.map((tmp, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={styles.templateBtn}
                        onPress={() =>
                          setCommentText((prev) => prev + tmp.text)
                        }
                      >
                        <Text style={styles.templateBtnText}>{tmp.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
                <View style={[styles.commentInputArea, { borderTopWidth: 0 }]}>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="メッセージを入力..."
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                  />
                  <TouchableOpacity
                    style={styles.sendButton}
                    onPress={handleSendComment}
                  >
                    <Text style={styles.sendButtonText}>送信</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* 新規作成・編集モーダル（統合フォーム） */}
      <Modal
        visible={isCreateModalVisible}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.modalSafeArea}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={{ flex: 1 }}
          >
            <View style={styles.createContainer}>
              <View style={styles.detailHeader}>
                <TouchableOpacity
                  onPress={() => setIsCreateModalVisible(false)}
                >
                  <Text style={styles.closeBtn}>✕ 閉じる</Text>
                </TouchableOpacity>
                <Text style={styles.createHeaderTitle}>
                  {editingReportId ? "振り返りの修正" : "本日の振り返り"}
                </Text>
                {!editingReportId ? (
                  <TouchableOpacity onPress={handleDiscardDraft}>
                    <Text style={[styles.closeBtn, { color: "#e74c3c" }]}>
                      破棄
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: 60 }} />
                )}
              </View>

              <ScrollView
                style={styles.createScroll}
                keyboardShouldPersistTaps="handled"
              >
                {/* === 日記入力部分（先に表示） === */}
                <View style={styles.formSection}>
                  <Text style={styles.formSectionTitle}>📝 練習の振り返り</Text>
                  <Text style={styles.inputLabel}>🏃 練習内容</Text>
                  <TextInput
                    style={styles.inputSingle}
                    placeholder="例：サーブ練習、紅白戦"
                    value={practiceContent}
                    onChangeText={setPracticeContent}
                  />

                  <Text style={styles.inputLabel}>
                    📈 今日の達成度・自己評価
                  </Text>
                  <View style={styles.ratingContainer}>
                    {renderStars(achievement, setAchievement)}
                    <Text style={styles.ratingText}>{achievement} / 5</Text>
                  </View>

                  <Text style={[styles.inputLabel, { color: "#27ae60" }]}>
                    ✨ 良かった点
                  </Text>
                  <TextInput
                    style={styles.inputMulti}
                    placeholder="できたこと"
                    value={goodPoint}
                    onChangeText={setGoodPoint}
                    multiline
                  />

                  <Text style={[styles.inputLabel, { color: "#c0392b" }]}>
                    🤔 改善点
                  </Text>
                  <TextInput
                    style={styles.inputMulti}
                    placeholder="気になったこと"
                    value={badPoint}
                    onChangeText={setBadPoint}
                    multiline
                  />

                  <Text style={[styles.inputLabel, { color: "#2980b9" }]}>
                    🎯 明日の課題
                  </Text>
                  <TextInput
                    style={styles.inputMulti}
                    placeholder="明日の目標"
                    value={nextTask}
                    onChangeText={setNextTask}
                    multiline
                  />

                  <Text style={styles.inputLabel}>
                    📎 補足メモ・添付 (任意)
                  </Text>
                  <TextInput
                    style={styles.inputMulti}
                    placeholder="自由なメモや気づき..."
                    value={memo}
                    onChangeText={setMemo}
                    multiline
                  />
                </View>

                {/* === メディカル入力部分（後に表示） === */}
                <View style={[styles.formSection, { marginTop: 20 }]}>
                  <Text style={styles.formSectionTitle}>🏥 コンディション</Text>
                  <Text style={styles.inputLabel}>😀 全体的な体調</Text>
                  <OptionGroup
                    options={["良い", "普通", "不良"]}
                    selected={condition}
                    onSelect={setCondition}
                    color="#2ecc71"
                  />
                  <Text style={styles.inputLabel}>
                    🔋 疲労度 (0:なし 〜 10:限界)
                  </Text>
                  <ScaleSelector
                    selected={fatigue}
                    onSelect={setFatigue}
                    color="#f39c12"
                  />
                  <Text style={styles.inputLabel}>🛌 昨晩の睡眠時間</Text>
                  <OptionGroup
                    options={["5h未満", "6h", "7h", "8h", "9h以上"]}
                    selected={sleep}
                    onSelect={setSleep}
                    color="#9b59b6"
                  />
                  <Text style={styles.inputLabel}>🏃 今日の練習可否</Text>
                  <OptionGroup
                    options={["通常", "制限", "不可"]}
                    selected={isParticipating}
                    onSelect={setIsParticipating}
                    color="#e74c3c"
                  />

                  <View style={styles.painToggleRow}>
                    <Text style={styles.inputLabel}>
                      🤕 痛いところ・ケガはありますか？
                    </Text>
                    <View style={styles.toggleBtnGroup}>
                      <TouchableOpacity
                        style={[
                          styles.toggleBtnItem,
                          !hasPain && styles.toggleBtnItemActive,
                        ]}
                        onPress={() => setHasPain(false)}
                      >
                        <Text
                          style={[
                            styles.toggleText,
                            !hasPain && { color: "#fff" },
                          ]}
                        >
                          なし
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.toggleBtnItem,
                          hasPain && { backgroundColor: "#e74c3c" },
                        ]}
                        onPress={() => setHasPain(true)}
                      >
                        <Text
                          style={[
                            styles.toggleText,
                            hasPain && { color: "#fff" },
                          ]}
                        >
                          あり
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {hasPain && (
                    <View style={styles.painDetailSection}>
                      <Text style={styles.subLabel}>痛む部位</Text>
                      <TextInput
                        style={styles.inputSingle}
                        placeholder="例: 右肩、左足首 など"
                        value={painPart}
                        onChangeText={setPainPart}
                      />
                      <Text style={styles.subLabel}>痛みの強さ (0〜10)</Text>
                      <ScaleSelector
                        selected={painLevel}
                        onSelect={setPainLevel}
                        color="#e74c3c"
                      />
                      <Text style={styles.subLabel}>
                        いつから？ / 処置 (任意)
                      </Text>
                      <TextInput
                        style={styles.inputSingle}
                        placeholder="例: 昨日から、アイシング中"
                        value={treatment}
                        onChangeText={setTreatment}
                      />
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    isOffline && { backgroundColor: "#f39c12" },
                  ]}
                  onPress={handleCreateOrEditReport}
                >
                  <Text style={styles.submitButtonText}>
                    {editingReportId
                      ? "修正内容を保存"
                      : "この内容で1日の日報を提出する"}
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 60 }} />
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#27ae60",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  headerOffline: { backgroundColor: "#7f8c8d" },
  backButton: { position: "absolute", left: 15, zIndex: 10 },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  headerRight: { position: "absolute", right: 15, flexDirection: "row" },

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
  tabActive: { borderBottomColor: "#27ae60" },
  tabText: { fontSize: 14, color: "#666", fontWeight: "bold" },
  tabTextActive: { color: "#27ae60" },

  content: { padding: 15 },
  emptyText: { textAlign: "center", color: "#888", marginTop: 50 },

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
    backgroundColor: "#e74c3c",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 10,
  },
  unreadAlertBadgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: "#2ecc71",
  },
  warningCard: { borderLeftColor: "#f39c12", backgroundColor: "#fffdf5" },
  dangerCard: { borderLeftColor: "#c0392b", backgroundColor: "#fff5f5" },
  pendingCard: {
    opacity: 0.7,
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#f39c12",
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
  cardAuthorLarge: { fontSize: 16, color: "#0077cc", fontWeight: "bold" },
  badgeReviewed: {
    backgroundColor: "#e8f5e9",
    color: "#27ae60",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: "bold",
    overflow: "hidden",
  },
  badgeUnreviewed: {
    backgroundColor: "#fdf3f2",
    color: "#c0392b",
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
  commentCountText: {
    fontSize: 12,
    color: "#888",
    marginTop: 5,
    textAlign: "right",
    fontWeight: "bold",
  },

  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    backgroundColor: "#27ae60",
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
  closeBtn: { fontSize: 16, color: "#0077cc", fontWeight: "bold" },
  createHeaderTitle: { fontSize: 16, fontWeight: "bold", color: "#333" },

  actionToolbarWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#fff",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    justifyContent: "center",
  },
  actionBtn: {
    backgroundColor: "#f0f2f5",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    margin: 4,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  actionBtnActive: { backgroundColor: "#e2f0d9", borderColor: "#27ae60" },
  actionBtnText: { fontSize: 12, fontWeight: "bold", color: "#333" },

  detailScroll: { padding: 15 },
  sharedBanner: {
    backgroundColor: "#e8f0fe",
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
    alignItems: "center",
  },
  sharedBannerText: { color: "#2980b9", fontWeight: "bold", fontSize: 12 },

  detailCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  cardDate: { fontSize: 16, fontWeight: "bold", color: "#333" },
  markReviewedBtn: {
    backgroundColor: "#27ae60",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginRight: 5,
  },
  markReviewedBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  editActionRow: { flexDirection: "row" },
  editBtn: {
    backgroundColor: "#f39c12",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
  },
  editBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },

  medicalDetailBox: {
    backgroundColor: "#f8f9fa",
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  medicalDetailTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 5,
  },
  detailGrid: { flexDirection: "row", flexWrap: "wrap" },
  gridItem: { width: "50%", marginBottom: 10 },
  gridTitle: { fontSize: 11, color: "#888", marginBottom: 2 },
  gridValue: { fontSize: 15, fontWeight: "bold", color: "#333" },
  painDetailBox: {
    backgroundColor: "#fff5f5",
    padding: 10,
    borderRadius: 8,
    marginTop: 5,
    borderWidth: 1,
    borderColor: "#ffcccc",
  },
  painDetailTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#c0392b",
    marginBottom: 5,
  },
  painDetailText: { fontSize: 12, color: "#444", marginBottom: 2 },

  threadTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 15,
    marginLeft: 5,
  },
  threadArea: { paddingBottom: 20 },
  commentBubbleWrapper: {
    flexDirection: "row",
    marginBottom: 15,
    alignItems: "flex-end",
  },
  commentBubbleRight: { justifyContent: "flex-end" },
  commentBubbleLeft: { justifyContent: "flex-start" },
  commentAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  commentAvatarText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  commentContentBox: { maxWidth: "80%" },
  commentUserName: {
    fontSize: 11,
    color: "#666",
    marginBottom: 4,
    marginLeft: 5,
  },
  commentBubble: { padding: 12, borderRadius: 15 },
  commentBubbleOther: { backgroundColor: "#fff", borderBottomLeftRadius: 0 },
  commentBubbleMe: { backgroundColor: "#0077cc", borderBottomRightRadius: 0 },
  commentText: { fontSize: 15, color: "#333", lineHeight: 20 },

  templateScroll: { maxHeight: 50 },
  templateBtn: {
    backgroundColor: "#e2f0d9",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#a9dfbf",
  },
  templateBtnText: { color: "#27ae60", fontSize: 12, fontWeight: "bold" },
  commentInputArea: {
    flexDirection: "row",
    padding: 10,
    backgroundColor: "#fff",
    alignItems: "flex-end",
  },
  commentInput: {
    flex: 1,
    backgroundColor: "#f0f2f5",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 100,
    fontSize: 15,
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: "#27ae60",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  sendButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },

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
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  formSectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 8,
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
  inputMulti: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
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

  painToggleRow: {
    marginTop: 15,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  toggleBtnGroup: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    padding: 4,
    width: 160,
  },
  toggleBtnItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 6,
  },
  toggleBtnItemActive: { backgroundColor: "#0077cc" },
  toggleText: { fontWeight: "bold", color: "#888", fontSize: 13 },
  painDetailSection: {
    backgroundColor: "#fff5f5",
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#ffcccc",
  },
  subLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#555",
    marginTop: 10,
    marginBottom: 5,
  },

  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  ratingText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#555",
    marginLeft: 15,
  },
  starsRow: { flexDirection: "row" },
  star: { fontSize: 28, marginRight: 2 },

  submitButton: {
    backgroundColor: "#27ae60",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 25,
  },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});

export default DiaryScreen;
