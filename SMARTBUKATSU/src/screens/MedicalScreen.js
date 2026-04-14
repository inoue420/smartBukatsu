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

const MedicalScreen = ({
  navigation,
  isAdmin,
  currentUser,
  medicalRecords,
  setMedicalRecords,
  isOffline,
  toggleNetworkStatus,
  alertThresholds,
  userProfiles = {},
}) => {
  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole = isAdmin ? "owner" : currentUserProfile.role || "member";
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
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [commentText, setCommentText] = useState("");

  const [editingRecordId, setEditingRecordId] = useState(null);

  const [condition, setCondition] = useState("良い");
  const [fatigue, setFatigue] = useState(5);
  const [sleep, setSleep] = useState("7h");
  const [isParticipating, setIsParticipating] = useState("通常");
  const [hasPain, setHasPain] = useState(false);

  const [painPart, setPainPart] = useState("");
  const [painLevel, setPainLevel] = useState(5);
  const [sinceWhen, setSinceWhen] = useState("");
  const [treatment, setTreatment] = useState("");
  const [memo, setMemo] = useState("");

  const [activeTab, setActiveTab] = useState("danger");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTagFilter, setActiveTagFilter] = useState(null);

  const [expandedDates, setExpandedDates] = useState({});

  const MANAGEMENT_TAGS = [
    "🚩 要フォロー",
    "🚫 練習制限",
    "🏥 受診推奨",
    "👀 経過観察",
  ];

  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const getAlertLevel = (record, allRecords) => {
    let level = "normal";

    if (
      record.condition === "不良" ||
      record.isParticipating === "不可" ||
      record.fatigue >= alertThresholds.fatigueDanger ||
      (record.hasPain &&
        record.painDetails?.level >= alertThresholds.painDanger)
    ) {
      return "danger";
    }
    if (
      record.fatigue >= alertThresholds.fatigueWarning ||
      record.isParticipating === "制限" ||
      record.hasPain
    ) {
      return "warning";
    }

    if (level === "warning" && alertThresholds.autoEscalate) {
      const userHistory = allRecords
        .filter(
          (r) => r.author === record.author && r.createdAt < record.createdAt,
        )
        .sort((a, b) => b.createdAt - a.createdAt);

      if (userHistory.length > 0) {
        const lastRecord = userHistory[0];
        const fatigueWorsened =
          record.fatigue >= alertThresholds.fatigueWarning &&
          record.fatigue > lastRecord.fatigue;
        const painWorsened =
          record.hasPain &&
          lastRecord.hasPain &&
          record.painDetails.level > lastRecord.painDetails.level;

        if (fatigueWorsened || painWorsened) {
          return "danger";
        }
      }
    }
    return level;
  };

  const staffScope = currentUserProfile.staffScope || "all";

  let processedRecords = medicalRecords.filter((r) => {
    if (userRole === "owner") return true;
    if (userRole === "staff") {
      if (staffScope === "all") return true;
      if (staffScope === "assigned") {
        const authorProfile = userProfiles[r.author] || {};
        return authorProfile.assignedStaff === currentUser;
      }
    }
    if (userRole === "member" || userRole === "captain") {
      return r.author === currentUser;
    }
    return false;
  });

  if (isStaffOrAbove) {
    if (activeTab === "danger")
      processedRecords = processedRecords.filter(
        (r) => getAlertLevel(r, medicalRecords) === "danger",
      );
    else if (activeTab === "warning")
      processedRecords = processedRecords.filter(
        (r) => getAlertLevel(r, medicalRecords) === "warning",
      );
    else if (activeTab === "unread")
      processedRecords = processedRecords.filter((r) => !r.isReviewed);

    if (searchQuery.trim() !== "")
      processedRecords = processedRecords.filter((r) =>
        r.author.includes(searchQuery),
      );
    if (activeTagFilter)
      processedRecords = processedRecords.filter(
        (r) => r.managementTags && r.managementTags.includes(activeTagFilter),
      );
  }

  const groupedRecords = processedRecords.reduce((acc, record) => {
    if (!acc[record.date]) acc[record.date] = [];
    acc[record.date].push(record);
    return acc;
  }, {});
  const sortedDates = Object.keys(groupedRecords).sort(
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

  const handleOpenEdit = () => {
    if (!selectedRecord) return;
    setEditingRecordId(selectedRecord.id);
    setCondition(selectedRecord.condition);
    setFatigue(selectedRecord.fatigue);
    setSleep(selectedRecord.sleep);
    setIsParticipating(selectedRecord.isParticipating);
    setHasPain(selectedRecord.hasPain);

    if (selectedRecord.hasPain && selectedRecord.painDetails) {
      setPainPart(selectedRecord.painDetails.part || "");
      setPainLevel(selectedRecord.painDetails.level || 5);
      setSinceWhen(selectedRecord.painDetails.sinceWhen || "");
      setTreatment(selectedRecord.painDetails.treatment || "");
      setMemo(selectedRecord.painDetails.memo || "");
    } else {
      setMemo(selectedRecord.memo || "");
    }

    setIsCreateModalVisible(true);
    setSelectedRecord(null);
  };

  const handleDiscardDraft = () => {
    Alert.alert("確認", "下書きを破棄してリセットしますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "破棄する",
        style: "destructive",
        onPress: () => {
          setCondition("良い");
          setFatigue(5);
          setSleep("7h");
          setIsParticipating("通常");
          setHasPain(false);
          setPainPart("");
          setPainLevel(5);
          setSinceWhen("");
          setTreatment("");
          setMemo("");
          setEditingRecordId(null);
          setIsCreateModalVisible(false);
        },
      },
    ]);
  };

  const handleCreateOrEditRecord = () => {
    if (hasPain && !painPart.trim()) {
      Alert.alert("エラー", "痛む部位を入力してください。");
      return;
    }

    if (editingRecordId) {
      const updatedRecords = medicalRecords.map((r) => {
        if (r.id === editingRecordId) {
          return {
            ...r,
            condition,
            fatigue,
            sleep,
            isParticipating,
            hasPain,
            painDetails: hasPain
              ? {
                  part: painPart,
                  level: painLevel,
                  memo: memo,
                  sinceWhen,
                  treatment,
                }
              : null,
            memo: hasPain ? "" : memo,
          };
        }
        return r;
      });
      setMedicalRecords(updatedRecords);
      Alert.alert("修正完了", "コンディション記録を修正しました。", [
        { text: "OK" },
      ]);
    } else {
      const today = new Date();
      const dateString = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

      const newRecord = {
        id: "med_" + Date.now().toString(),
        date: dateString,
        author: currentUser,
        condition,
        fatigue,
        sleep,
        isParticipating,
        hasPain,
        painDetails: hasPain
          ? {
              part: painPart,
              level: painLevel,
              memo: memo,
              sinceWhen,
              treatment,
            }
          : null,
        memo: hasPain ? "" : memo,
        status: isOffline ? "pending" : "sent",
        isReviewed: false,
        createdAt: Date.now(),
        comments: [],
        managementTags: [],
      };

      const newRecordsArray = [newRecord, ...medicalRecords];
      setMedicalRecords(newRecordsArray);

      setTimeout(() => {
        Alert.alert(
          "記録完了",
          "本日のコンディションを記録しました。お疲れ様でした！",
          [{ text: "OK" }],
        );
      }, 500);
    }

    setIsCreateModalVisible(false);
    setEditingRecordId(null);
    setCondition("良い");
    setFatigue(5);
    setSleep("7h");
    setIsParticipating("通常");
    setHasPain(false);
    setPainPart("");
    setPainLevel(5);
    setSinceWhen("");
    setTreatment("");
    setMemo("");
  };

  const handleSendComment = () => {
    if (commentText.trim() === "") return;

    const isStaffComment = isStaffOrAbove;

    const newRecords = medicalRecords.map((r) => {
      if (r.id === selectedRecord.id) {
        const newComment = {
          id: "c_" + Date.now().toString(),
          user: displayUserName,
          text: commentText,
          time: "たった今",
          status: isOffline ? "pending" : "sent",
        };
        return {
          ...r,
          comments: [...r.comments, newComment],
          isReviewed: isStaffComment ? true : r.isReviewed,
        };
      }
      return r;
    });
    setMedicalRecords(newRecords);

    if (isStaffComment) {
      setSelectedRecord((prev) => ({
        ...prev,
        isReviewed: true,
        comments: [
          ...prev.comments,
          {
            id: "tmp_" + Date.now(),
            user: displayUserName,
            text: commentText,
            time: "たった今",
            status: "sent",
          },
        ],
      }));
    } else {
      setSelectedRecord((prev) => ({
        ...prev,
        comments: [
          ...prev.comments,
          {
            id: "tmp_" + Date.now(),
            user: displayUserName,
            text: commentText,
            time: "たった今",
            status: "sent",
          },
        ],
      }));
    }
    setCommentText("");
    Keyboard.dismiss();
  };

  const handleMarkAsReviewed = () => {
    const newRecords = medicalRecords.map((r) => {
      if (r.id === selectedRecord.id) {
        return { ...r, isReviewed: true };
      }
      return r;
    });
    setMedicalRecords(newRecords);
    setSelectedRecord((prev) => ({ ...prev, isReviewed: true }));
  };

  const toggleManagementTag = (tag) => {
    const currentTags = selectedRecord.managementTags || [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter((t) => t !== tag)
      : [...currentTags, tag];
    const newRecords = medicalRecords.map((r) => {
      if (r.id === selectedRecord.id) {
        return { ...r, managementTags: newTags };
      }
      return r;
    });
    setMedicalRecords(newRecords);
    setSelectedRecord((prev) => ({ ...prev, managementTags: newTags }));
  };

  let dangerCount = 0;
  let warningCount = 0;
  if (isStaffOrAbove) {
    dangerCount = processedRecords.filter(
      (r) => getAlertLevel(r, medicalRecords) === "danger",
    ).length;
    warningCount = processedRecords.filter(
      (r) => getAlertLevel(r, medicalRecords) === "warning",
    ).length;
  }

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
          {isOffline ? "オフライン" : "🏥 コンディション"}
        </Text>
        {/* ★変更：不要なオフラインボタン（navBtn）を撤去しました */}
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            現在オフラインです。一部の操作が制限されます。
          </Text>
        </View>
      )}

      {isStaffOrAbove && (
        <View style={styles.adminDashboard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryTitle}>📊 サマリー</Text>
            <View style={{ flexDirection: "row" }}>
              <View
                style={[styles.summaryBadge, { backgroundColor: "#c0392b" }]}
              >
                <Text style={styles.summaryBadgeText}>
                  🚨 危険 {dangerCount}
                </Text>
              </View>
              <View
                style={[styles.summaryBadge, { backgroundColor: "#f39c12" }]}
              >
                <Text style={styles.summaryBadgeText}>
                  ⚠️ 注意 {warningCount}
                </Text>
              </View>
            </View>
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="部員名で検索..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabScroll}
            contentContainerStyle={{ paddingHorizontal: 15 }}
          >
            <TouchableOpacity
              onPress={() => {
                setActiveTab("danger");
                setActiveTagFilter(null);
              }}
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
              onPress={() => {
                setActiveTab("warning");
                setActiveTagFilter(null);
              }}
              style={[
                styles.tabBtn,
                activeTab === "warning" && { borderBottomColor: "#f39c12" },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  activeTab === "warning" && { color: "#f39c12" },
                ]}
              >
                ⚠️ 注意
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setActiveTab("unread");
                setActiveTagFilter(null);
              }}
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
                未確認
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setActiveTab("all");
                setActiveTagFilter(null);
              }}
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

          <View style={styles.tagFilterContainer}>
            <Text style={styles.tagFilterLabel}>🏷 タグで絞り込む:</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 15 }}
            >
              <TouchableOpacity
                onPress={() => setActiveTagFilter(null)}
                style={[
                  styles.tagFilterBtn,
                  !activeTagFilter && styles.tagFilterBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.tagFilterBtnText,
                    !activeTagFilter && styles.tagFilterBtnTextActive,
                  ]}
                >
                  すべて
                </Text>
              </TouchableOpacity>
              {MANAGEMENT_TAGS.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  onPress={() => {
                    setActiveTab("all");
                    setActiveTagFilter(tag);
                  }}
                  style={[
                    styles.tagFilterBtn,
                    activeTagFilter === tag && styles.tagFilterBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tagFilterBtnText,
                      activeTagFilter === tag && styles.tagFilterBtnTextActive,
                    ]}
                  >
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        {sortedDates.length === 0 ? (
          <Text style={styles.emptyText}>該当する記録がありません。</Text>
        ) : (
          sortedDates.map((date, index) => {
            const recordsInDate = groupedRecords[date];
            const expanded = isExpanded(date, index);
            const hasUnreviewed = recordsInDate.some((r) => !r.isReviewed);

            return (
              <View key={date} style={styles.dateGroupContainer}>
                <TouchableOpacity
                  style={styles.dateHeader}
                  onPress={() => toggleDate(date, index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateHeaderText}>
                    {expanded ? "▼" : "▶"} {date} ── [ {recordsInDate.length}件
                    ]
                  </Text>
                  {hasUnreviewed && isStaffOrAbove && (
                    <View style={styles.unreadAlertBadge}>
                      <Text style={styles.unreadAlertBadgeText}>
                        未確認あり
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>

                {expanded &&
                  recordsInDate.map((record) => {
                    const level = getAlertLevel(record, medicalRecords);
                    return (
                      <TouchableOpacity
                        key={record.id}
                        style={[
                          styles.card,
                          record.status === "pending" && styles.pendingCard,
                          isStaffOrAbove &&
                            level === "danger" &&
                            styles.dangerCard,
                          isStaffOrAbove &&
                            level === "warning" &&
                            styles.warningCard,
                        ]}
                        activeOpacity={0.9}
                        onPress={() => setSelectedRecord(record)}
                      >
                        {record.status === "pending" && (
                          <Text style={styles.pendingText}>🕒 送信待機中</Text>
                        )}

                        <View style={styles.cardHeader}>
                          <View>
                            <Text style={styles.cardAuthorLarge}>
                              {isStaffOrAbove || record.author !== currentUser
                                ? `👤 ${record.author}`
                                : `👤 自分`}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            {record.isReviewed ? (
                              <Text style={styles.badgeReviewed}>
                                ✅ 確認済
                              </Text>
                            ) : (
                              <Text style={styles.badgeUnreviewed}>未確認</Text>
                            )}
                            {isStaffOrAbove && level === "danger" && (
                              <Text
                                style={[
                                  styles.badgeWarningSmall,
                                  { color: "#c0392b" },
                                ]}
                              >
                                🚨 危険
                              </Text>
                            )}
                            {isStaffOrAbove && level === "warning" && (
                              <Text
                                style={[
                                  styles.badgeWarningSmall,
                                  { color: "#f39c12" },
                                ]}
                              >
                                ⚠️ 注意
                              </Text>
                            )}
                          </View>
                        </View>

                        {isStaffOrAbove &&
                          record.managementTags?.length > 0 && (
                            <View style={styles.tagDisplayRow}>
                              {record.managementTags.map((t) => (
                                <Text key={t} style={styles.tagDisplayBadge}>
                                  {t}
                                </Text>
                              ))}
                            </View>
                          )}

                        <View style={styles.cardRow}>
                          <Text style={styles.infoLabel}>
                            体調:{" "}
                            <Text style={styles.infoValue}>
                              {record.condition}
                            </Text>
                          </Text>
                          <Text style={styles.infoLabel}>
                            疲労度:{" "}
                            <Text style={styles.infoValue}>
                              {record.fatigue}/10
                            </Text>
                          </Text>
                        </View>
                        <Text style={styles.commentCountText}>
                          💬 {record.comments.length}件
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
            setEditingRecordId(null);
            setIsCreateModalVisible(true);
          }}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={selectedRecord !== null}
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
                <TouchableOpacity onPress={() => setSelectedRecord(null)}>
                  <Text style={styles.closeBtn}>◁ 戻る</Text>
                </TouchableOpacity>
                <Text style={styles.createHeaderTitle}>
                  {selectedRecord?.author}のコンディション
                </Text>
                <View style={{ width: 60 }} />
              </View>

              {isStaffOrAbove && selectedRecord && (
                <View style={styles.actionToolbarWrapper}>
                  <Text
                    style={{
                      width: "100%",
                      fontSize: 12,
                      color: "#666",
                      marginBottom: 5,
                      fontWeight: "bold",
                    }}
                  >
                    📌 管理者用 対応メモ（部員には見えません）
                  </Text>
                  {MANAGEMENT_TAGS.map((tag) => {
                    const isActive =
                      selectedRecord.managementTags?.includes(tag);
                    return (
                      <TouchableOpacity
                        key={tag}
                        style={[
                          styles.actionBtn,
                          isActive && styles.actionBtnActive,
                        ]}
                        onPress={() => toggleManagementTag(tag)}
                      >
                        <Text
                          style={[
                            styles.actionBtnText,
                            isActive && { color: "#fff" },
                          ]}
                        >
                          {tag}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {selectedRecord &&
                (() => {
                  const isMyRecord =
                    currentUser === selectedRecord.author &&
                    ["member", "captain"].includes(userRole);
                  const timeElapsed = currentTime - selectedRecord.createdAt;
                  const isEditable =
                    timeElapsed < 30 * 60 * 1000 && !selectedRecord.isReviewed;
                  const minutesLeft = Math.max(
                    0,
                    30 - Math.floor(timeElapsed / 60000),
                  );

                  return (
                    <ScrollView
                      style={styles.detailScroll}
                      keyboardShouldPersistTaps="handled"
                    >
                      <View style={styles.detailCard}>
                        <View style={[styles.cardHeader, { marginBottom: 10 }]}>
                          <Text style={styles.cardDate}>
                            {selectedRecord.date}
                          </Text>
                          <View style={{ alignItems: "flex-end" }}>
                            {isStaffOrAbove && !selectedRecord.isReviewed && (
                              <TouchableOpacity
                                style={styles.markReviewedBtn}
                                onPress={handleMarkAsReviewed}
                              >
                                <Text style={styles.markReviewedBtnText}>
                                  ✅ 確認済みにする
                                </Text>
                              </TouchableOpacity>
                            )}
                            {isMyRecord && isEditable && (
                              <TouchableOpacity
                                style={styles.editBtn}
                                onPress={handleOpenEdit}
                              >
                                <Text style={styles.editBtnText}>
                                  ✏️ 修正 (残り{minutesLeft}分)
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                        <View style={styles.detailGrid}>
                          <View style={styles.gridItem}>
                            <Text style={styles.gridTitle}>体調</Text>
                            <Text style={styles.gridValue}>
                              {selectedRecord.condition}
                            </Text>
                          </View>
                          <View style={styles.gridItem}>
                            <Text style={styles.gridTitle}>疲労度</Text>
                            <Text style={styles.gridValue}>
                              {selectedRecord.fatigue} / 10
                            </Text>
                          </View>
                          <View style={styles.gridItem}>
                            <Text style={styles.gridTitle}>睡眠時間</Text>
                            <Text style={styles.gridValue}>
                              {selectedRecord.sleep}
                            </Text>
                          </View>
                          <View style={styles.gridItem}>
                            <Text style={styles.gridTitle}>練習可否</Text>
                            <Text
                              style={[
                                styles.gridValue,
                                selectedRecord.isParticipating !== "通常" && {
                                  color: "#e74c3c",
                                },
                              ]}
                            >
                              {selectedRecord.isParticipating}
                            </Text>
                          </View>
                        </View>
                        {selectedRecord.hasPain &&
                          selectedRecord.painDetails && (
                            <View style={styles.painDetailBox}>
                              <Text style={styles.painDetailTitle}>
                                🤕 ケガ・痛みの詳細
                              </Text>
                              <Text style={styles.painDetailText}>
                                部位：{selectedRecord.painDetails.part} (痛さ:{" "}
                                {selectedRecord.painDetails.level}/10)
                              </Text>
                              <Text style={styles.painDetailText}>
                                いつから：
                                {selectedRecord.painDetails.sinceWhen ||
                                  "未入力"}
                              </Text>
                              <Text style={styles.painDetailText}>
                                現在の処置：
                                {selectedRecord.painDetails.treatment ||
                                  "未入力"}
                              </Text>
                              <Text style={styles.painDetailText}>
                                メモ：
                                {selectedRecord.painDetails.memo || "なし"}
                              </Text>
                            </View>
                          )}
                        {!selectedRecord.hasPain && selectedRecord.memo ? (
                          <View style={styles.generalMemoBox}>
                            <Text style={styles.generalMemoTitle}>
                              📝 メモ・特記事項
                            </Text>
                            <Text style={styles.generalMemoText}>
                              {selectedRecord.memo}
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Text style={styles.threadTitle}>
                        💬 メディカル相談 (スタッフ限定)
                      </Text>
                      <View style={styles.threadArea}>
                        {selectedRecord.comments.map((c) => (
                          <View
                            key={c.id}
                            style={
                              c.user === displayUserName
                                ? styles.commentBubbleRight
                                : styles.commentBubbleLeft
                            }
                          >
                            <View
                              style={
                                c.user === displayUserName
                                  ? styles.commentBubbleMe
                                  : styles.commentBubbleOther
                              }
                            >
                              <Text
                                style={
                                  c.user === displayUserName
                                    ? { color: "#fff" }
                                    : { color: "#333" }
                                }
                              >
                                {c.text}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  );
                })()}
              <View style={styles.commentInputArea}>
                <TextInput
                  style={styles.commentInput}
                  value={commentText}
                  onChangeText={setCommentText}
                  placeholder="メッセージを入力..."
                />
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={handleSendComment}
                >
                  <Text style={styles.sendButtonText}>送信</Text>
                </TouchableOpacity>
              </View>
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
                    setEditingRecordId(null);
                  }}
                >
                  <Text style={styles.closeBtn}>✕ 閉じる</Text>
                </TouchableOpacity>
                <Text style={styles.createHeaderTitle}>
                  {editingRecordId
                    ? "コンディションの修正"
                    : "本日のコンディション"}
                </Text>
                {!editingRecordId ? (
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
                {!editingRecordId && (
                  <Text style={styles.draftNotice}>
                    ※入力内容は自動で下書き保存されます。
                  </Text>
                )}

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
                <Text style={styles.inputLabel}>🏃 今日の練習</Text>
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

                {hasPain ? (
                  <View style={styles.painDetailSection}>
                    <Text style={styles.painLabelTitle}>
                      🔻 痛みの詳細を教えてください
                    </Text>
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
                    <Text style={styles.subLabel}>いつから？ (任意)</Text>
                    <TextInput
                      style={styles.inputSingle}
                      placeholder="例: 3日前の練習から"
                      value={sinceWhen}
                      onChangeText={setSinceWhen}
                    />
                    <Text style={styles.subLabel}>
                      現在の処置・受診状況 (任意)
                    </Text>
                    <TextInput
                      style={styles.inputSingle}
                      placeholder="例: アイシングのみ、昨日の夕方病院に行った"
                      value={treatment}
                      onChangeText={setTreatment}
                    />
                    <Text style={styles.subLabel}>その他のメモ (任意)</Text>
                    <TextInput
                      style={styles.inputMulti}
                      placeholder="どんな動きで痛むか等"
                      value={memo}
                      onChangeText={setMemo}
                      multiline
                    />
                  </View>
                ) : (
                  <View style={{ marginTop: 15 }}>
                    <Text style={styles.inputLabel}>
                      📝 メモ・特記事項 (任意)
                    </Text>
                    <TextInput
                      style={styles.inputMulti}
                      placeholder="体調について気になること、花粉症がつらい等"
                      value={memo}
                      onChangeText={setMemo}
                      multiline
                    />
                  </View>
                )}
                <TouchableOpacity
                  style={styles.submitButton}
                  onPress={handleCreateOrEditRecord}
                >
                  <Text style={styles.submitButtonText}>
                    {editingRecordId
                      ? "修正内容を保存"
                      : isOffline
                        ? "待機リストに保存"
                        : "報告を送信する"}
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 50 }} />
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
    backgroundColor: "#9b59b6",
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
  adminDashboard: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    paddingBottom: 0,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    backgroundColor: "#f5eef8",
  },
  summaryTitle: { fontSize: 15, fontWeight: "bold", color: "#8e44ad" },
  summaryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 8,
  },
  summaryBadgeText: { color: "#fff", fontSize: 11, fontWeight: "bold" },
  searchInput: {
    backgroundColor: "#f0f2f5",
    marginHorizontal: 15,
    marginBottom: 10,
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
  tabActive: { borderBottomColor: "#9b59b6" },
  tabText: { fontSize: 14, color: "#666", fontWeight: "bold" },
  tabTextActive: { color: "#9b59b6" },
  tagFilterContainer: {
    paddingVertical: 10,
    backgroundColor: "#fafafa",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  tagFilterLabel: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#888",
    marginLeft: 15,
    marginBottom: 5,
  },
  tagFilterBtn: {
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  tagFilterBtnActive: { backgroundColor: "#9b59b6", borderColor: "#8e44ad" },
  tagFilterBtnText: { fontSize: 12, fontWeight: "bold", color: "#555" },
  tagFilterBtnTextActive: { color: "#fff" },
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
    marginBottom: 10,
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: "#2ecc71",
  },
  warningCard: { backgroundColor: "#fffdf5", borderLeftColor: "#f39c12" },
  dangerCard: { backgroundColor: "#fff5f5", borderLeftColor: "#c0392b" },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  cardAuthorLarge: { fontSize: 16, color: "#0077cc", fontWeight: "bold" },
  badgeUnreviewed: {
    backgroundColor: "#f0f0f0",
    color: "#888",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: "bold",
    overflow: "hidden",
  },
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
  badgeWarningSmall: {
    fontSize: 12,
    fontWeight: "bold",
    marginTop: 4,
    textAlign: "right",
  },
  tagDisplayRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  tagDisplayBadge: {
    backgroundColor: "#f0f2f5",
    color: "#555",
    fontSize: 10,
    fontWeight: "bold",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    marginRight: 5,
    marginBottom: 5,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  cardRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 5 },
  infoLabel: { fontSize: 13, color: "#666", marginRight: 15, marginBottom: 5 },
  infoValue: { fontWeight: "bold", color: "#333" },
  painLabel: {
    fontSize: 13,
    color: "#c0392b",
    fontWeight: "bold",
    marginTop: 5,
  },
  commentCountText: {
    fontSize: 12,
    color: "#888",
    marginTop: 10,
    textAlign: "right",
  },
  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    backgroundColor: "#9b59b6",
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
  closeBtn: { fontSize: 16, color: "#9b59b6", fontWeight: "bold" },
  actionToolbarWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#fff",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    justifyContent: "flex-start",
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
  actionBtnActive: { backgroundColor: "#9b59b6", borderColor: "#8e44ad" },
  actionBtnText: { fontSize: 12, fontWeight: "bold", color: "#333" },
  historySection: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 5,
  },
  historyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#f9f9f9",
  },
  historyDate: { fontSize: 13, color: "#666", width: 60 },
  historyItem: { fontSize: 13, color: "#333", flex: 1, textAlign: "center" },
  detailContainer: {
    flex: 1,
    backgroundColor: "#f0f2f5",
    marginTop: 40,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  detailScroll: { padding: 15 },
  warningBanner: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
    alignItems: "center",
  },
  warningBannerText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
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
  editBtn: {
    backgroundColor: "#f39c12",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
    marginTop: 5,
  },
  editBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 10,
  },
  gridItem: { width: "50%", marginBottom: 15 },
  gridTitle: { fontSize: 12, color: "#888", marginBottom: 4 },
  gridValue: { fontSize: 16, fontWeight: "bold", color: "#333" },
  painDetailBox: {
    backgroundColor: "#fff5f5",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffcccc",
    marginTop: 10,
  },
  painDetailTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#c0392b",
    marginBottom: 8,
  },
  painDetailText: { fontSize: 13, color: "#444", marginBottom: 4 },
  generalMemoBox: {
    backgroundColor: "#fdfdfd",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#eee",
    marginTop: 10,
  },
  generalMemoTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#888",
    marginBottom: 4,
  },
  generalMemoText: { fontSize: 14, color: "#333" },
  threadTitle: {
    fontSize: 14,
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
  commentBubbleMe: {
    backgroundColor: "#9b59b6",
    padding: 12,
    borderRadius: 15,
    borderBottomRightRadius: 0,
  },
  commentBubbleOther: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 15,
    borderBottomLeftRadius: 0,
  },
  commentText: { fontSize: 15, lineHeight: 20 },
  commentTime: { fontSize: 10, color: "#aaa", marginTop: 4 },
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
    fontSize: 14,
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: "#9b59b6",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  sendButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
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
    fontSize: 15,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
    marginTop: 15,
  },
  optionGroup: { flexDirection: "row", flexWrap: "wrap" },
  optionBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ccc",
    marginRight: 10,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  optionBtnText: { fontSize: 14, fontWeight: "bold", color: "#555" },
  scaleScroll: { flexDirection: "row", marginBottom: 5 },
  scaleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
    backgroundColor: "#fff",
  },
  scaleBtnText: { fontSize: 16, fontWeight: "bold", color: "#555" },
  painToggleRow: {
    marginTop: 20,
    paddingTop: 15,
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
  toggleBtnItemActive: { backgroundColor: "#9b59b6" },
  toggleText: { fontWeight: "bold", color: "#888" },
  painDetailSection: {
    backgroundColor: "#fff5f5",
    padding: 15,
    borderRadius: 8,
    marginTop: 15,
    borderWidth: 1,
    borderColor: "#ffcccc",
  },
  painLabelTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#e74c3c",
    marginBottom: 10,
  },
  subLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#555",
    marginTop: 10,
    marginBottom: 5,
  },
  inputSingle: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
  },
  inputMulti: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
  },
  submitButton: {
    backgroundColor: "#9b59b6",
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 30,
  },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
});

export default MedicalScreen;
