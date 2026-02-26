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
// ★修正：SafeAreaViewの警告を消すための正しいインポート
import { SafeAreaView } from "react-native-safe-area-context";

const DiaryScreen = ({
  navigation,
  isAdmin,
  currentUser,
  diaries,
  setDiaries,
  isOffline,
  toggleNetworkStatus,
  grades,
  positions,
  posts,
  setPosts,
}) => {
  const displayUserName = isAdmin ? "管理者(監督)" : currentUser;

  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [selectedDiary, setSelectedDiary] = useState(null);
  const [commentText, setCommentText] = useState("");

  const [editingDiaryId, setEditingDiaryId] = useState(null);
  const [isAppendModalVisible, setIsAppendModalVisible] = useState(false);
  const [appendContent, setAppendContent] = useState("");

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

  const [activeTab, setActiveTab] = useState("unread");
  const [searchQuery, setSearchQuery] = useState("");

  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [filterGrade, setFilterGrade] = useState("全て");
  const [filterPosition, setFilterPosition] = useState("全て");
  const [filterPeriod, setFilterPeriod] = useState("全て");

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
  ];

  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  let processedDiaries = isAdmin
    ? diaries
    : diaries.filter((d) => d.author === currentUser || d.sharedWith === "all");

  if (isAdmin) {
    if (activeTab === "unread") {
      processedDiaries = processedDiaries.filter((d) => !d.isReviewed);
    } else if (activeTab === "needs_reply") {
      processedDiaries = processedDiaries.filter(
        (d) => d.comments.filter((c) => c.user.includes("管理者")).length === 0,
      );
    } else if (activeTab === "replied") {
      processedDiaries = processedDiaries.filter(
        (d) => d.comments.filter((c) => c.user.includes("管理者")).length > 0,
      );
    } else if (activeTab === "starred") {
      processedDiaries = processedDiaries.filter((d) => d.isStarred);
    }

    if (searchQuery.trim() !== "") {
      const lowerQ = searchQuery.toLowerCase();
      processedDiaries = processedDiaries.filter(
        (d) =>
          d.author.toLowerCase().includes(lowerQ) ||
          (d.practiceContent &&
            d.practiceContent.toLowerCase().includes(lowerQ)) ||
          (d.goodPoint && d.goodPoint.toLowerCase().includes(lowerQ)),
      );
    }
  }

  const groupedDiaries = processedDiaries.reduce((acc, diary) => {
    if (!acc[diary.date]) acc[diary.date] = [];
    acc[diary.date].push(diary);
    return acc;
  }, {});
  const sortedDates = Object.keys(groupedDiaries).sort(
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

  const handleToggleStar = (diaryId) => {
    const newDiaries = diaries.map((d) =>
      d.id === diaryId ? { ...d, isStarred: !d.isStarred } : d,
    );
    setDiaries(newDiaries);
    if (selectedDiary && selectedDiary.id === diaryId)
      setSelectedDiary({
        ...selectedDiary,
        isStarred: !selectedDiary.isStarred,
      });
  };

  const handleToggleFollowUp = (diaryId) => {
    const newDiaries = diaries.map((d) =>
      d.id === diaryId ? { ...d, isFollowUp: !d.isFollowUp } : d,
    );
    setDiaries(newDiaries);
    if (selectedDiary && selectedDiary.id === diaryId)
      setSelectedDiary({
        ...selectedDiary,
        isFollowUp: !selectedDiary.isFollowUp,
      });
  };

  const handleChangeShareScope = (diaryId) => {
    const diary = diaries.find((d) => d.id === diaryId);
    const isCurrentlyAll = diary?.sharedWith === "all";

    if (isCurrentlyAll) {
      Alert.alert("共有範囲の変更", "スタッフのみの公開に戻しますか？", [
        { text: "キャンセル", style: "cancel" },
        {
          text: "戻す",
          onPress: () => {
            const newDiaries = diaries.map((d) =>
              d.id === diaryId ? { ...d, sharedWith: "staff" } : d,
            );
            setDiaries(newDiaries);
            if (selectedDiary && selectedDiary.id === diaryId)
              setSelectedDiary({ ...selectedDiary, sharedWith: "staff" });
          },
        },
      ]);
    } else {
      Alert.alert(
        "共有範囲の変更",
        "この日記をチーム全体に公開し、Home画面の「# 共有日記」に通知しますか？",
        [
          { text: "キャンセル", style: "cancel" },
          {
            text: "全体に公開する",
            onPress: () => {
              const newDiaries = diaries.map((d) =>
                d.id === diaryId ? { ...d, sharedWith: "all" } : d,
              );
              setDiaries(newDiaries);
              if (selectedDiary && selectedDiary.id === diaryId)
                setSelectedDiary({ ...selectedDiary, sharedWith: "all" });

              const sharedPost = {
                id: "post_shared_" + Date.now().toString(),
                channel: "共有日記",
                user: displayUserName,
                content: `📢 ${diary.author} の素晴らしい振り返りをチームに共有します！\n\n【練習内容】\n${diary.practiceContent || "未入力"}\n\n【良かった点】\n${diary.goodPoint || "未入力"}\n\n※詳細は日記画面から確認できます。`,
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
              Alert.alert(
                "変更完了",
                "チーム全体に公開し、Home画面にも通知しました。",
              );
            },
          },
        ],
      );
    }
  };

  const handleAddDummyImage = () => {
    setImages([...images, `添付画像_${images.length + 1}.jpg`]);
  };

  // ★修正：エラーの原因だった関数の定義を保証
  const handleDiscardDraft = () => {
    Alert.alert("確認", "下書きを破棄してリセットしますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "破棄する",
        style: "destructive",
        onPress: () => {
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
          setEditingDiaryId(null);
          setIsCreateModalVisible(false);
        },
      },
    ]);
  };

  const handleCreateOrEditDiary = () => {
    if (editingDiaryId) {
      const updatedDiaries = diaries.map((diary) => {
        if (diary.id === editingDiaryId) {
          return {
            ...diary,
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
        return diary;
      });
      setDiaries(updatedDiaries);
      Alert.alert("修正完了", "日記を修正しました。");
    } else {
      const today = new Date();
      const dateString = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
      const newDiary = {
        id: "diary_" + Date.now().toString(),
        date: dateString,
        author: currentUser,
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
        appendedTexts: [],
        comments: [],
      };
      setDiaries([newDiary, ...diaries]);
    }
    setIsCreateModalVisible(false);
    setEditingDiaryId(null);
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
    Keyboard.dismiss();
  };

  const handleOpenEdit = () => {
    if (!selectedDiary) return;
    setEditingDiaryId(selectedDiary.id);
    setPracticeContent(selectedDiary.practiceContent);
    setAchievement(selectedDiary.achievement);
    setGoodPoint(selectedDiary.goodPoint);
    setBadPoint(selectedDiary.badPoint || "");
    setNextTask(selectedDiary.nextTask);
    setImages(selectedDiary.images || []);
    setMemo(selectedDiary.memo || "");
    setHighlightLink(selectedDiary.highlightLink || "");
    if (selectedDiary.memo) setShowMemoInput(true);
    if (selectedDiary.highlightLink) setShowLinkInput(true);

    setIsCreateModalVisible(true);
    setSelectedDiary(null);
  };

  const handleSaveAppend = () => {
    if (appendContent.trim() === "") return;
    const timeString = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const newDiaries = diaries.map((diary) => {
      if (diary.id === selectedDiary.id) {
        const appended = {
          ...diary,
          appendedTexts: [
            ...(diary.appendedTexts || []),
            { text: appendContent, time: timeString },
          ],
        };
        return appended;
      }
      return diary;
    });
    setDiaries(newDiaries);
    setSelectedDiary((prev) => ({
      ...prev,
      appendedTexts: [
        ...(prev.appendedTexts || []),
        { text: appendContent, time: timeString },
      ],
    }));
    setAppendContent("");
    setIsAppendModalVisible(false);
    Keyboard.dismiss();
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
    const newDiaries = diaries.map((diary) => {
      if (diary.id === selectedDiary.id) {
        // ★管理者がコメントした場合は自動的に確認済みにする
        return {
          ...diary,
          comments: [...diary.comments, newComment],
          isReviewed: isAdmin ? true : diary.isReviewed,
        };
      }
      return diary;
    });
    setDiaries(newDiaries);

    // ★即座に詳細画面の修正・追記ボタンを消すためにステートを同期
    if (isAdmin) {
      setSelectedDiary((prev) => ({
        ...prev,
        isReviewed: true,
        comments: [...prev.comments, newComment],
      }));
    } else {
      setSelectedDiary((prev) => ({
        ...prev,
        comments: [...prev.comments, newComment],
      }));
    }
    setCommentText("");
    Keyboard.dismiss();
  };

  const handleMarkAsReviewed = () => {
    const newDiaries = diaries.map((diary) => {
      if (diary.id === selectedDiary.id) {
        return { ...diary, isReviewed: true };
      }
      return diary;
    });
    setDiaries(newDiaries);
    // ★即座に詳細画面の修正・追記ボタンを消すためにステートを同期
    setSelectedDiary((prev) => ({ ...prev, isReviewed: true }));
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

  const handleApplyFilter = () => {
    setIsFilterModalVisible(false);
    Alert.alert(
      "プロトタイプ環境",
      "「学年・ポジション」による高度な絞り込み機能は、本番環境で選手データベースと連携した後に有効になります。",
      [{ text: "OK" }],
    );
  };

  const unreviewedCount = diaries.filter((d) => !d.isReviewed).length;
  const needsReplyCount = diaries.filter(
    (d) => d.comments.filter((c) => c.user.includes("管理者")).length === 0,
  ).length;

  const gradeOptions = ["全て", ...(grades || [])];
  const positionOptions = ["全て", ...(positions || [])];

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, isOffline && styles.headerOffline]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>◁ 戻る</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isOffline ? "オフライン表示中" : "📖 部活日記"}
        </Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.navBtn} onPress={toggleNetworkStatus}>
            <Text style={styles.navIcon}>{isOffline ? "🚫" : "🌐"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            現在オフラインです。一部の操作が制限されます。
          </Text>
        </View>
      )}

      {isAdmin && (
        <View style={styles.adminDashboard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryTitle}>📊 処理サマリー</Text>
            <View style={{ flexDirection: "row" }}>
              <View style={styles.summaryBadgeUnread}>
                <Text style={styles.summaryBadgeTextUnread}>
                  未読 {unreviewedCount}
                </Text>
              </View>
              <View
                style={[
                  styles.summaryBadgeUnread,
                  { backgroundColor: "#e67e22" },
                ]}
              >
                <Text style={styles.summaryBadgeTextUnread}>
                  要返信 {needsReplyCount}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInputFlex}
              placeholder="部員名やキーワードで検索..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <TouchableOpacity
              style={styles.filterBtn}
              onPress={() => setIsFilterModalVisible(true)}
            >
              <Text style={styles.filterBtnIcon}>⚙️ 詳細条件</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabScroll}
            contentContainerStyle={{ paddingHorizontal: 15 }}
          >
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
                未読
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
                要返信
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setActiveTab("replied")}
              style={[
                styles.tabBtn,
                activeTab === "replied" && styles.tabActive,
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "replied" && styles.tabTextActive,
                ]}
              >
                返信済
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
          </ScrollView>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 100 }}
        keyboardShouldPersistTaps="handled"
      >
        {sortedDates.length === 0 ? (
          <Text style={styles.emptyText}>条件に一致する日記がありません。</Text>
        ) : (
          sortedDates.map((date, index) => {
            const diariesInDate = groupedDiaries[date];
            const expanded = isExpanded(date, index);
            const hasUnreviewed = diariesInDate.some((d) => !d.isReviewed);

            return (
              <View key={date} style={styles.dateGroupContainer}>
                <TouchableOpacity
                  style={styles.dateHeader}
                  onPress={() => toggleDate(date, index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateHeaderText}>
                    {expanded ? "▼" : "▶"} {date} ── [ {diariesInDate.length}件
                    ]
                  </Text>
                  {hasUnreviewed && (
                    <View style={styles.unreadAlertBadge}>
                      <Text style={styles.unreadAlertBadgeText}>
                        未確認あり
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                {expanded &&
                  diariesInDate.map((diary) => (
                    <TouchableOpacity
                      key={diary.id}
                      style={[
                        styles.card,
                        diary.status === "pending" && styles.pendingCard,
                      ]}
                      activeOpacity={0.9}
                      onPress={() => setSelectedDiary(diary)}
                    >
                      {diary.status === "pending" && (
                        <Text style={styles.pendingText}>🕒 送信待機中</Text>
                      )}

                      <View style={styles.cardHeader}>
                        <View>
                          <Text style={styles.cardAuthorLarge}>
                            {isAdmin || diary.author !== currentUser
                              ? `👤 ${diary.author}`
                              : `👤 自分`}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.badgeContainer,
                            { flexDirection: "row", alignItems: "center" },
                          ]}
                        >
                          {diary.sharedWith === "all" && (
                            <Text style={styles.badgeShared}>
                              📢 チーム共有
                            </Text>
                          )}
                          {diary.isFollowUp && (
                            <Text style={{ fontSize: 16, marginRight: 5 }}>
                              🎌
                            </Text>
                          )}
                          {diary.isStarred && (
                            <Text style={{ fontSize: 16, marginRight: 10 }}>
                              ⭐
                            </Text>
                          )}
                          {diary.isReviewed ? (
                            <Text style={styles.badgeReviewed}>✅ 確認済</Text>
                          ) : (
                            <Text style={styles.badgeUnreviewed}>未確認</Text>
                          )}
                        </View>
                      </View>

                      <View style={styles.cardSection}>
                        <Text style={styles.sectionLabel}>🏃 練習内容</Text>
                        <Text style={styles.sectionText} numberOfLines={1}>
                          {diary.practiceContent || "（未入力）"}
                        </Text>
                      </View>
                      {(diary.images?.length > 0 ||
                        diary.memo ||
                        diary.highlightLink) && (
                        <View style={styles.attachmentIndicatorRow}>
                          <Text style={styles.attachmentIndicatorText}>
                            📎 添付データあり
                          </Text>
                        </View>
                      )}
                      <View style={styles.commentCountRow}>
                        <Text style={styles.commentCountText}>
                          💬 コーチとのやり取り：{diary.comments.length}件
                        </Text>
                      </View>
                      <Text style={styles.clickHint}>
                        タップして詳細・コーチからの返信を見る
                      </Text>
                    </TouchableOpacity>
                  ))}
              </View>
            );
          })
        )}
      </ScrollView>

      {!isAdmin && (
        <TouchableOpacity
          style={[styles.fab, isOffline && { backgroundColor: "#f39c12" }]}
          onPress={() => {
            setEditingDiaryId(null);
            setIsCreateModalVisible(true);
          }}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={isFilterModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.appendOverlay}>
          <View style={[styles.appendModalContent, { padding: 15 }]}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginBottom: 15,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: "bold", color: "#333" }}>
                🔍 詳細条件で絞り込む
              </Text>
              <TouchableOpacity onPress={() => setIsFilterModalVisible(false)}>
                <Text style={{ fontSize: 18, color: "#888" }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.filterSectionTitle}>学年</Text>
            <View style={styles.filterOptionsRow}>
              {gradeOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[
                    styles.filterOptionBtn,
                    filterGrade === opt && styles.filterOptionActive,
                  ]}
                  onPress={() => setFilterGrade(opt)}
                >
                  <Text
                    style={[
                      styles.filterOptionText,
                      filterGrade === opt && styles.filterOptionTextActive,
                    ]}
                  >
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.filterSectionTitle}>ポジション・役割</Text>
            <View style={styles.filterOptionsRow}>
              {positionOptions.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[
                    styles.filterOptionBtn,
                    filterPosition === opt && styles.filterOptionActive,
                  ]}
                  onPress={() => setFilterPosition(opt)}
                >
                  <Text
                    style={[
                      styles.filterOptionText,
                      filterPosition === opt && styles.filterOptionTextActive,
                    ]}
                  >
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.filterSectionTitle}>期間</Text>
            <View style={styles.filterOptionsRow}>
              {["全て", "今日", "過去7日", "今月"].map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[
                    styles.filterOptionBtn,
                    filterPeriod === opt && styles.filterOptionActive,
                  ]}
                  onPress={() => setFilterPeriod(opt)}
                >
                  <Text
                    style={[
                      styles.filterOptionText,
                      filterPeriod === opt && styles.filterOptionTextActive,
                    ]}
                  >
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.filterApplyBtn}
              onPress={handleApplyFilter}
            >
              <Text style={styles.filterApplyBtnText}>この条件で適用する</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={selectedDiary !== null}
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
                <TouchableOpacity onPress={() => setSelectedDiary(null)}>
                  <Text style={styles.closeBtn}>◁ 戻る</Text>
                </TouchableOpacity>
                <Text style={styles.createHeaderTitle}>
                  {selectedDiary?.author}の日記
                </Text>
                {isAdmin ? (
                  <TouchableOpacity
                    onPress={() => handleToggleStar(selectedDiary.id)}
                  >
                    <Text style={{ fontSize: 20 }}>
                      {selectedDiary?.isStarred ? "⭐" : "☆"}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: 60 }} />
                )}
              </View>

              {isAdmin && selectedDiary && (
                <View style={styles.actionToolbarWrapper}>
                  <TouchableOpacity
                    onPress={() => handleToggleStar(selectedDiary.id)}
                    style={[
                      styles.actionBtn,
                      selectedDiary.isStarred && styles.actionBtnActive,
                    ]}
                  >
                    <Text style={styles.actionBtnText}>
                      {selectedDiary.isStarred ? "⭐ スター済" : "☆ スター"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleToggleFollowUp(selectedDiary.id)}
                    style={[
                      styles.actionBtn,
                      selectedDiary.isFollowUp && styles.actionBtnActive,
                    ]}
                  >
                    <Text style={styles.actionBtnText}>
                      {selectedDiary.isFollowUp
                        ? "🎌 フォロー中"
                        : "🚩 要フォロー"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleChangeShareScope(selectedDiary.id)}
                    style={[
                      styles.actionBtn,
                      selectedDiary.sharedWith === "all" &&
                        styles.actionBtnActive,
                    ]}
                  >
                    <Text style={styles.actionBtnText}>
                      👁️ 共有:{" "}
                      {selectedDiary.sharedWith === "all"
                        ? "全体"
                        : "スタッフのみ"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {selectedDiary &&
                (() => {
                  const isMyDiary =
                    currentUser === selectedDiary.author && !isAdmin;
                  const timeElapsed = currentTime - selectedDiary.createdAt;
                  // ★修正：確認済みの場合は修正不可（!selectedDiary.isReviewed）
                  const isEditable =
                    timeElapsed < 30 * 60 * 1000 && !selectedDiary.isReviewed;
                  const minutesLeft = Math.max(
                    0,
                    30 - Math.floor(timeElapsed / 60000),
                  );

                  return (
                    <ScrollView
                      style={styles.detailScroll}
                      contentContainerStyle={{ paddingBottom: 30 }}
                      keyboardShouldPersistTaps="handled"
                    >
                      {selectedDiary.sharedWith === "all" &&
                        !isMyDiary &&
                        !isAdmin && (
                          <View
                            style={{
                              backgroundColor: "#e8f0fe",
                              padding: 10,
                              borderRadius: 8,
                              marginBottom: 15,
                              alignItems: "center",
                            }}
                          >
                            <Text
                              style={{
                                color: "#2980b9",
                                fontWeight: "bold",
                                fontSize: 12,
                              }}
                            >
                              📢
                              この日記は監督によってチーム全体に共有されています
                            </Text>
                          </View>
                        )}

                      <View style={styles.detailCard}>
                        <View style={styles.cardHeader}>
                          <View>
                            <Text style={styles.cardDate}>
                              {selectedDiary.date}
                            </Text>
                            {!isMyDiary && (
                              <Text style={styles.cardAuthor}>
                                👤 {selectedDiary.author}
                              </Text>
                            )}
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            {isAdmin && !selectedDiary.isReviewed && (
                              <TouchableOpacity
                                style={styles.markReviewedBtn}
                                onPress={handleMarkAsReviewed}
                              >
                                <Text style={styles.markReviewedBtnText}>
                                  ✅ 確認済みにする
                                </Text>
                              </TouchableOpacity>
                            )}

                            {/* ★修正：isEditable（確認済ならfalseになる）に従って表示を消す */}
                            {isMyDiary && !selectedDiary.isReviewed && (
                              <View style={styles.editActionRow}>
                                {isEditable ? (
                                  <TouchableOpacity
                                    style={styles.editBtn}
                                    onPress={handleOpenEdit}
                                  >
                                    <Text style={styles.editBtnText}>
                                      ✏️ 修正 (残り{minutesLeft}分)
                                    </Text>
                                  </TouchableOpacity>
                                ) : (
                                  <TouchableOpacity
                                    style={styles.appendBtn}
                                    onPress={() =>
                                      setIsAppendModalVisible(true)
                                    }
                                  >
                                    <Text style={styles.appendBtnText}>
                                      ➕ 追記する
                                    </Text>
                                  </TouchableOpacity>
                                )}
                              </View>
                            )}
                          </View>
                        </View>

                        <View style={styles.cardSection}>
                          <Text style={styles.sectionLabel}>🏃 練習内容</Text>
                          <Text style={styles.sectionText}>
                            {selectedDiary.practiceContent || "（未入力）"}
                          </Text>
                        </View>
                        <View style={styles.cardSection}>
                          <Text style={styles.sectionLabel}>
                            📈 今日の達成度
                          </Text>
                          {renderStars(selectedDiary.achievement)}
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
                            {selectedDiary.goodPoint || "（未入力）"}
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
                            {selectedDiary.badPoint || "（未入力）"}
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
                            {selectedDiary.nextTask || "（未入力）"}
                          </Text>
                        </View>

                        {(selectedDiary.images?.length > 0 ||
                          selectedDiary.memo ||
                          selectedDiary.highlightLink) && (
                          <View
                            style={[
                              styles.cardSection,
                              {
                                backgroundColor: "#fdfbf7",
                                borderColor: "#f1c40f",
                                borderWidth: 1,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.sectionLabel,
                                { color: "#f39c12" },
                              ]}
                            >
                              📎 添付データ
                            </Text>
                            {selectedDiary.images?.map((img, idx) => (
                              <Text key={idx} style={styles.attachedItemText}>
                                📷 {img}
                              </Text>
                            ))}
                            {selectedDiary.highlightLink ? (
                              <View style={styles.videoPlayerMock}>
                                <View style={styles.videoPlayIcon}>
                                  <Text
                                    style={{
                                      color: "#fff",
                                      fontSize: 24,
                                      marginLeft: 4,
                                    }}
                                  >
                                    ▶
                                  </Text>
                                </View>
                                <Text
                                  style={styles.videoLinkText}
                                  numberOfLines={1}
                                >
                                  {selectedDiary.highlightLink}
                                </Text>
                              </View>
                            ) : null}
                            {selectedDiary.memo ? (
                              <View style={styles.memoBox}>
                                <Text style={styles.memoBoxTitle}>
                                  📝 補足メモ
                                </Text>
                                <Text style={styles.memoBoxText}>
                                  {selectedDiary.memo}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        )}

                        {selectedDiary.appendedTexts &&
                          selectedDiary.appendedTexts.length > 0 && (
                            <View style={styles.appendedArea}>
                              {selectedDiary.appendedTexts.map((app, idx) => (
                                <View key={idx} style={styles.appendedBox}>
                                  <Text style={styles.appendedLabel}>
                                    ➕ 追記 ({app.time})
                                  </Text>
                                  <Text style={styles.appendedText}>
                                    {app.text}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          )}
                      </View>

                      <Text style={styles.threadTitle}>
                        💬 コーチとのやり取り
                      </Text>
                      <View style={styles.threadArea}>
                        {selectedDiary.comments.length === 0 ? (
                          <Text style={styles.emptyCommentText}>
                            まだメッセージはありません。
                          </Text>
                        ) : (
                          selectedDiary.comments.map((comment) => {
                            const isMe = comment.user === displayUserName;
                            return (
                              <View
                                key={comment.id}
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
                                      {comment.user.charAt(0)}
                                    </Text>
                                  </View>
                                )}
                                <View style={styles.commentContentBox}>
                                  {!isMe && (
                                    <Text style={styles.commentUserName}>
                                      {comment.user}
                                    </Text>
                                  )}
                                  <View
                                    style={[
                                      styles.commentBubble,
                                      isMe
                                        ? styles.commentBubbleMe
                                        : styles.commentBubbleOther,
                                      comment.status === "pending" && {
                                        opacity: 0.6,
                                      },
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.commentText,
                                        isMe && { color: "#fff" },
                                      ]}
                                    >
                                      {comment.text}
                                    </Text>
                                  </View>
                                  <Text
                                    style={[
                                      styles.commentTime,
                                      isMe && { textAlign: "right" },
                                    ]}
                                  >
                                    {comment.status === "pending"
                                      ? "待機中..."
                                      : comment.time}
                                  </Text>
                                </View>
                              </View>
                            );
                          })
                        )}
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
                {isAdmin && (
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
                    placeholder={
                      isAdmin
                        ? "指導・アドバイスを入力..."
                        : "コーチに返信する..."
                    }
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                  />
                  <TouchableOpacity
                    style={[
                      styles.sendButton,
                      isOffline && { backgroundColor: "#f39c12" },
                    ]}
                    onPress={handleSendComment}
                  >
                    <Text style={styles.sendButtonText}>送信</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isAppendModalVisible && (
                <View style={styles.appendOverlay}>
                  <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : "height"}
                    style={styles.appendKeyboardContainer}
                  >
                    <View style={styles.appendModalContent}>
                      <Text style={styles.appendModalTitle}>
                        日記に追記する
                      </Text>
                      <Text style={styles.appendModalSubTitle}>
                        ※投稿から30分経過したため、元の文章は編集できません。
                      </Text>
                      <TextInput
                        style={styles.appendInput}
                        placeholder="追記内容を入力してください..."
                        value={appendContent}
                        onChangeText={setAppendContent}
                        multiline
                        autoFocus
                      />
                      <View style={styles.appendModalButtons}>
                        <TouchableOpacity
                          style={styles.appendCancelBtn}
                          onPress={() => {
                            setIsAppendModalVisible(false);
                            setAppendContent("");
                          }}
                        >
                          <Text style={styles.appendCancelText}>
                            キャンセル
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.appendSubmitBtn}
                          onPress={handleSaveAppend}
                        >
                          <Text style={styles.appendSubmitText}>
                            追記を保存
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </KeyboardAvoidingView>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

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
                  onPress={() => {
                    setIsCreateModalVisible(false);
                    setEditingDiaryId(null);
                  }}
                >
                  <Text style={styles.closeBtn}>✕ 閉じる</Text>
                </TouchableOpacity>
                <Text style={styles.createHeaderTitle}>
                  {editingDiaryId ? "日記の修正" : "本日の振り返り"}
                </Text>

                {/* ★修正：エラー解消済みのhandleDiscardDraftを使用 */}
                {!editingDiaryId ? (
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
                {!editingDiaryId && (
                  <Text style={styles.draftNotice}>
                    ※入力内容は自動で下書き保存されます。
                  </Text>
                )}
                <Text style={styles.inputLabel}>🏃 練習内容</Text>
                <TextInput
                  style={styles.inputSingle}
                  placeholder="例：サーブ練習、紅白戦"
                  value={practiceContent}
                  onChangeText={setPracticeContent}
                />
                <Text style={styles.inputLabel}>📈 今日の達成度・自己評価</Text>
                <View style={styles.ratingContainer}>
                  {renderStars(achievement, setAchievement)}
                  <Text style={styles.ratingText}>{achievement} / 5</Text>
                </View>
                <Text style={[styles.inputLabel, { color: "#27ae60" }]}>
                  ✨ 良かった点・できたこと
                </Text>
                <TextInput
                  style={styles.inputMulti}
                  placeholder="例：サーブの確率が上がった"
                  value={goodPoint}
                  onChangeText={setGoodPoint}
                  multiline
                />
                <Text style={[styles.inputLabel, { color: "#c0392b" }]}>
                  🤔 改善点・気になったこと
                </Text>
                <TextInput
                  style={styles.inputMulti}
                  placeholder="例：後半バテて足が動かなかった"
                  value={badPoint}
                  onChangeText={setBadPoint}
                  multiline
                />
                <Text style={[styles.inputLabel, { color: "#2980b9" }]}>
                  🎯 明日の課題・目標
                </Text>
                <TextInput
                  style={styles.inputMulti}
                  placeholder="例：疲れた時こそ声を出す"
                  value={nextTask}
                  onChangeText={setNextTask}
                  multiline
                />

                <Text style={styles.inputLabel}>📎 添付 (オプション)</Text>
                <View style={styles.attachmentToolbar}>
                  <TouchableOpacity
                    style={styles.attachBtn}
                    onPress={handleAddDummyImage}
                  >
                    <Text style={styles.attachBtnText}>📷 画像</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.attachBtn,
                      showMemoInput && styles.attachBtnActive,
                    ]}
                    onPress={() => setShowMemoInput(!showMemoInput)}
                  >
                    <Text style={styles.attachBtnText}>📝 メモ</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.attachBtn,
                      showLinkInput && styles.attachBtnActive,
                    ]}
                    onPress={() => setShowLinkInput(!showLinkInput)}
                  >
                    <Text style={styles.attachBtnText}>🔗 ハイライト</Text>
                  </TouchableOpacity>
                </View>
                {images.length > 0 && (
                  <View style={styles.attachmentPreview}>
                    {images.map((img, idx) => (
                      <Text key={idx} style={styles.attachedItemText}>
                        📷 {img}
                      </Text>
                    ))}
                  </View>
                )}
                {showMemoInput && (
                  <TextInput
                    style={[
                      styles.inputMulti,
                      { marginTop: 10, borderColor: "#f1c40f" },
                    ]}
                    placeholder="自由なメモや気づきを記入..."
                    value={memo}
                    onChangeText={setMemo}
                    multiline
                  />
                )}
                {showLinkInput && (
                  <TextInput
                    style={[
                      styles.inputSingle,
                      { marginTop: 10, borderColor: "#f1c40f" },
                    ]}
                    placeholder="プロジェクトや動画のリンクURLを貼り付け"
                    value={highlightLink}
                    onChangeText={setHighlightLink}
                    autoCapitalize="none"
                  />
                )}

                <View style={styles.privacyNote}>
                  <Text style={styles.privacyNoteText}>
                    🔒 公開範囲：本人 ＋ スタッフのみ
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    isOffline && { backgroundColor: "#f39c12" },
                  ]}
                  onPress={handleCreateOrEditDiary}
                >
                  <Text style={styles.submitButtonText}>
                    {editingDiaryId
                      ? "修正内容を保存"
                      : isOffline
                        ? "待機リストに保存"
                        : "日記を送信する"}
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 40 }} />
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
  navBtn: { padding: 5 },
  navIcon: { fontSize: 20 },
  offlineBanner: {
    backgroundColor: "#f39c12",
    padding: 8,
    alignItems: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },

  adminDashboard: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 5,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    backgroundColor: "#e8f5e9",
  },
  summaryTitle: { fontSize: 15, fontWeight: "bold", color: "#27ae60" },
  summaryBadgeUnread: {
    backgroundColor: "#c0392b",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  summaryBadgeTextUnread: { color: "#fff", fontSize: 11, fontWeight: "bold" },

  searchRow: {
    flexDirection: "row",
    paddingHorizontal: 15,
    marginBottom: 10,
    alignItems: "center",
  },
  searchInputFlex: {
    flex: 1,
    backgroundColor: "#f0f2f5",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    marginRight: 10,
  },
  filterBtn: {
    backgroundColor: "#f0f2f5",
    padding: 10,
    borderRadius: 8,
    justifyContent: "center",
  },
  filterBtnIcon: { fontSize: 14, fontWeight: "bold", color: "#555" },

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

  filterSectionTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 10,
    marginTop: 15,
  },
  filterOptionsRow: { flexDirection: "row", flexWrap: "wrap" },
  filterOptionBtn: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
  },
  filterOptionActive: {
    backgroundColor: "#e2f0d9",
    borderWidth: 1,
    borderColor: "#27ae60",
  },
  filterOptionText: { fontSize: 13, color: "#555" },
  filterOptionTextActive: { color: "#27ae60", fontWeight: "bold" },
  filterApplyBtn: {
    backgroundColor: "#27ae60",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 30,
  },
  filterApplyBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },

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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  pendingCard: {
    opacity: 0.7,
    borderWidth: 1,
    borderColor: "#f39c12",
    borderStyle: "dashed",
  },
  pendingText: {
    color: "#f39c12",
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 5,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 10,
  },
  cardDate: { fontSize: 16, fontWeight: "bold", color: "#333" },
  cardAuthor: {
    fontSize: 14,
    color: "#0077cc",
    fontWeight: "bold",
    marginTop: 4,
  },
  cardAuthorLarge: { fontSize: 16, color: "#0077cc", fontWeight: "bold" },
  badgeContainer: { justifyContent: "center" },

  badgeShared: {
    backgroundColor: "#e8f0fe",
    color: "#2980b9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: "bold",
    overflow: "hidden",
    marginRight: 5,
  },
  badgeReviewed: {
    backgroundColor: "#e8f5e9",
    color: "#27ae60",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: "bold",
    overflow: "hidden",
  },
  badgeUnreviewed: {
    backgroundColor: "#fdf3f2",
    color: "#c0392b",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: "bold",
    overflow: "hidden",
  },
  cardSection: {
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  cardSectionRow: { flexDirection: "row", justifyContent: "space-between" },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 5,
  },
  sectionText: { fontSize: 14, color: "#333", lineHeight: 20 },
  starsRow: { flexDirection: "row" },
  star: { fontSize: 24, marginRight: 2 },
  attachmentIndicatorRow: { marginTop: 5, paddingVertical: 5 },
  attachmentIndicatorText: {
    fontSize: 12,
    color: "#e67e22",
    fontWeight: "bold",
  },
  commentCountRow: {
    marginTop: 5,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  commentCountText: { fontSize: 13, color: "#0077cc", fontWeight: "bold" },
  clickHint: {
    textAlign: "center",
    fontSize: 12,
    color: "#aaa",
    marginTop: 10,
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
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
  },
  closeBtn: { fontSize: 16, color: "#0077cc", fontWeight: "bold" },

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

  detailContainer: {
    flex: 1,
    backgroundColor: "#f0f2f5",
    marginTop: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  detailScroll: { padding: 15 },
  detailCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  markReviewedBtn: {
    backgroundColor: "#27ae60",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  markReviewedBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  editActionRow: { marginTop: 5 },
  editBtn: {
    backgroundColor: "#f39c12",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
  },
  editBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  appendBtn: {
    backgroundColor: "#3498db",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
  },
  appendBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  attachedItemText: { fontSize: 13, color: "#555", marginBottom: 3 },

  videoPlayerMock: {
    backgroundColor: "#000",
    height: 120,
    borderRadius: 8,
    marginTop: 10,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  videoPlayIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  videoLinkText: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    color: "#fff",
    fontSize: 10,
    opacity: 0.8,
  },

  memoBox: {
    backgroundColor: "#fff",
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#eee",
  },
  memoBoxTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#888",
    marginBottom: 4,
  },
  memoBoxText: { fontSize: 13, color: "#444" },
  appendedArea: {
    marginTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 10,
  },
  appendedBox: {
    backgroundColor: "#eef2f5",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#3498db",
  },
  appendedLabel: {
    fontSize: 11,
    color: "#3498db",
    fontWeight: "bold",
    marginBottom: 4,
  },
  appendedText: { fontSize: 14, color: "#333" },

  threadTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 15,
    marginLeft: 5,
  },
  threadArea: { paddingBottom: 20 },
  emptyCommentText: {
    textAlign: "center",
    color: "#888",
    fontStyle: "italic",
    marginTop: 20,
  },
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
  commentTime: { fontSize: 10, color: "#aaa", marginTop: 4 },

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
    borderTopWidth: 1,
    borderTopColor: "#eee",
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

  appendOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    zIndex: 1000,
  },
  appendKeyboardContainer: { width: "100%", alignItems: "center" },
  appendModalContent: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    elevation: 5,
  },
  appendModalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 5,
  },
  appendModalSubTitle: { fontSize: 12, color: "#e74c3c", marginBottom: 15 },
  appendInput: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 100,
    textAlignVertical: "top",
    marginBottom: 20,
  },
  appendModalButtons: { flexDirection: "row", justifyContent: "flex-end" },
  appendCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginRight: 10,
  },
  appendCancelText: { color: "#888", fontWeight: "bold", fontSize: 15 },
  appendSubmitBtn: {
    backgroundColor: "#3498db",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  appendSubmitText: { color: "#fff", fontWeight: "bold", fontSize: 15 },

  createContainer: {
    flex: 1,
    backgroundColor: "#fff",
    marginTop: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  createHeaderTitle: { fontSize: 16, fontWeight: "bold", color: "#333" },
  draftNotice: {
    fontSize: 12,
    color: "#e67e22",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 10,
  },
  createScroll: { padding: 20 },
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
  attachmentToolbar: { flexDirection: "row", marginBottom: 10 },
  attachBtn: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  attachBtnActive: { backgroundColor: "#fff3cd", borderColor: "#f1c40f" },
  attachBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  attachmentPreview: {
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
    marginTop: 5,
  },
  privacyNote: {
    backgroundColor: "#e6f2ff",
    padding: 10,
    borderRadius: 8,
    marginTop: 20,
    marginBottom: 20,
    alignItems: "center",
  },
  privacyNoteText: { color: "#0077cc", fontSize: 12, fontWeight: "bold" },
  submitButton: {
    backgroundColor: "#27ae60",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  submitButtonText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
});

export default DiaryScreen;
