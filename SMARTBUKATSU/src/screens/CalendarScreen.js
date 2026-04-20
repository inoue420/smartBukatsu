import React, { useState, useMemo, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calendar, LocaleConfig } from "react-native-calendars";

import { useAuth } from "../AuthContext";
import {
  createProject,
  updateProject,
  deleteProject,
  createPersonalEvent,
  updatePersonalEvent,
  deletePersonalEvent,
} from "../services/firestoreService";

LocaleConfig.locales["ja"] = {
  monthNames: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  monthNamesShort: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  dayNames: [
    "日曜日",
    "月曜日",
    "火曜日",
    "水曜日",
    "木曜日",
    "金曜日",
    "土曜日",
  ],
  dayNamesShort: ["日", "月", "火", "水", "木", "金", "土"],
  today: "今日",
};
LocaleConfig.defaultLocale = "ja";

const COLORS = {
  primary: "#0077cc",
  secondary: "#f39c12",
  danger: "#e74c3c",
  success: "#2ecc71",
  background: "#f0f2f5",
  card: "#ffffff",
  textMain: "#333333",
  textSub: "#666666",
  border: "#eeeeee",
};

const normalizeDate = (dateStr) => {
  if (!dateStr) return "";
  if (dateStr.includes("/")) {
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
  }
  return dateStr;
};

const getDatesInRange = (startDate, endDate) => {
  const dates = [];
  let currentDate = new Date(startDate);
  const end = new Date(endDate);

  let count = 0;
  while (currentDate <= end && count < 365) {
    dates.push(currentDate.toISOString().split("T")[0]);
    currentDate.setDate(currentDate.getDate() + 1);
    count++;
  }
  return dates;
};

const CalendarScreen = ({
  navigation,
  isAdmin,
  currentUser,
  projects = [],
  dailyReports = [],
  personalEvents = [],
  userProfiles = {},
  isOffline = false,
}) => {
  const { activeTeamId, user } = useAuth();

  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");

  const canManageClubEvents = ["owner", "admin", "staff", "captain"].includes(
    userRole,
  );

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );

  const [isClubModalVisible, setIsClubModalVisible] = useState(false);
  const [isPersonalModalVisible, setIsPersonalModalVisible] = useState(false);

  const [isLoading, setIsLoading] = useState(false);

  const [editingClubEventId, setEditingClubEventId] = useState(null);
  const [clubEventTitle, setClubEventTitle] = useState("");
  const [clubEventDescription, setClubEventDescription] = useState("");
  const [clubEventType, setClubEventType] = useState("練習");
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const [editingPersonalEventId, setEditingPersonalEventId] = useState(null);
  const [personalEventTitle, setPersonalEventTitle] = useState("");
  const [personalEventDescription, setPersonalEventDescription] = useState("");
  const [isPersonalMultiDay, setIsPersonalMultiDay] = useState(false);
  const [personalEndDate, setPersonalEndDate] = useState("");
  const [showPersonalEndDatePicker, setShowPersonalEndDatePicker] =
    useState(false);

  const markedDates = useMemo(() => {
    const marks = {};
    const addMark = (dateStr, key, color) => {
      const normDate = normalizeDate(dateStr);
      if (!marks[normDate]) marks[normDate] = { dots: [] };
      if (!marks[normDate].dots.find((d) => d.key === key)) {
        marks[normDate].dots.push({ key, color });
      }
    };

    projects.forEach((p) => {
      if (p.status !== "deleted") {
        const start = normalizeDate(p.date);
        const end = p.endDate ? normalizeDate(p.endDate) : start;
        const color =
          p.status === "pending"
            ? "#aaa"
            : p.type === "試合"
              ? COLORS.danger
              : COLORS.primary;
        const range = getDatesInRange(start, end);
        range.forEach((d) => addMark(d, p.id, color));
      }
    });

    personalEvents.forEach((pe) => {
      if (pe.status !== "deleted") {
        const start = normalizeDate(pe.date);
        const end = pe.endDate ? normalizeDate(pe.endDate) : start;
        const color = pe.status === "pending" ? "#aaa" : COLORS.success;
        const range = getDatesInRange(start, end);
        range.forEach((d) => addMark(d, pe.id, color));
      }
    });

    dailyReports.forEach((r) => {
      if (r.author === currentUser && r.status !== "deleted") {
        const color = r.status === "pending" ? "#aaa" : COLORS.secondary;
        addMark(r.date, r.id, color);
      }
    });

    if (!marks[selectedDate]) marks[selectedDate] = { dots: [] };
    marks[selectedDate].selected = true;
    marks[selectedDate].selectedColor = "#e8f0fe";
    marks[selectedDate].selectedTextColor = COLORS.textMain;

    return marks;
  }, [projects, personalEvents, dailyReports, selectedDate, currentUser]);

  const dailyClubEvents = projects.filter((p) => {
    if (p.status === "deleted") return false;
    const start = normalizeDate(p.date);
    const end = p.endDate ? normalizeDate(p.endDate) : start;
    return selectedDate >= start && selectedDate <= end;
  });

  const dailyPersonalEvents = personalEvents.filter((pe) => {
    if (pe.status === "deleted") return false;
    const start = normalizeDate(pe.date);
    const end = pe.endDate ? normalizeDate(pe.endDate) : start;
    return selectedDate >= start && selectedDate <= end;
  });

  const dailyMyReports = dailyReports.filter(
    (r) =>
      normalizeDate(r.date) === selectedDate &&
      r.author === currentUser &&
      r.status !== "deleted",
  );

  // オフライン自動同期
  useEffect(() => {
    if (!isOffline) {
      const hasPendingEvents =
        projects.some((p) => p.status === "pending") ||
        personalEvents.some((pe) => pe.status === "pending");
      if (hasPendingEvents) {
        setIsLoading(true);
        setTimeout(() => {
          setIsLoading(false);
          Alert.alert(
            "📶 通信復旧",
            "待機していたカレンダーの予定を同期しました！",
          );
        }, 1500);
      }
    }
  }, [isOffline]);

  const handleSaveClubEvent = async () => {
    if (!clubEventTitle.trim())
      return Alert.alert("エラー", "タイトルを入力してください");
    if (isMultiDay && endDate < selectedDate)
      return Alert.alert("エラー", "終了日を正しく選択してください");

    setIsLoading(true);

    setTimeout(async () => {
      const eventData = {
        title: clubEventTitle.trim(),
        name: clubEventTitle.trim(),
        description: clubEventDescription.trim(),
        type: clubEventType,
        date: selectedDate,
        endDate: isMultiDay ? endDate : selectedDate,
        participants: "team",
        status: isOffline ? "pending" : "active",
        createdBy: user?.uid || "local_user",
      };

      try {
        if (editingClubEventId) {
          if (!isOffline)
            await updateProject(activeTeamId, editingClubEventId, eventData);
        } else {
          if (!isOffline) await createProject(activeTeamId, eventData);
        }
        setIsClubModalVisible(false);
        resetClubForm();
      } catch (error) {
        console.error(error);
        Alert.alert("エラー", "保存に失敗しました。");
      } finally {
        setIsLoading(false);
      }
    }, 400);
  };

  const resetClubForm = () => {
    setEditingClubEventId(null);
    setClubEventTitle("");
    setClubEventDescription("");
    setClubEventType("練習");
    setIsMultiDay(false);
    setEndDate("");
    setShowEndDatePicker(false);
  };

  const openEditClubEvent = (event) => {
    setEditingClubEventId(event.id);
    setClubEventTitle(event.title || event.name);
    setClubEventDescription(event.description || "");
    setClubEventType(event.type || "練習");
    const hasRange = event.endDate && event.endDate !== event.date;
    setIsMultiDay(hasRange);
    setEndDate(event.endDate || event.date);
    setIsClubModalVisible(true);
  };

  const handleDeleteClubEvent = (id) => {
    Alert.alert("削除", "部活の予定を削除しますか？", [
      { text: "キャンセル" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          setIsLoading(true);
          try {
            if (!isOffline) await deleteProject(activeTeamId, id);
          } catch (e) {
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  const handleSavePersonalEvent = async () => {
    if (!personalEventTitle.trim())
      return Alert.alert("エラー", "タイトルを入力してください");
    if (isPersonalMultiDay && personalEndDate < selectedDate)
      return Alert.alert("エラー", "終了日を正しく選択してください");

    setIsLoading(true);

    setTimeout(async () => {
      const eventData = {
        date: selectedDate,
        endDate: isPersonalMultiDay ? personalEndDate : selectedDate,
        title: personalEventTitle.trim(),
        description: personalEventDescription.trim(),
        status: isOffline ? "pending" : "active",
      };

      try {
        if (editingPersonalEventId) {
          if (!isOffline)
            await updatePersonalEvent(
              user.uid,
              editingPersonalEventId,
              eventData,
            );
        } else {
          if (!isOffline) await createPersonalEvent(user.uid, eventData);
        }
        setIsPersonalModalVisible(false);
        resetPersonalForm();
      } catch (error) {
        console.error(error);
        Alert.alert("エラー", "個人予定の保存に失敗しました。");
      } finally {
        setIsLoading(false);
      }
    }, 400);
  };

  const resetPersonalForm = () => {
    setEditingPersonalEventId(null);
    setPersonalEventTitle("");
    setPersonalEventDescription("");
    setIsPersonalMultiDay(false);
    setPersonalEndDate("");
    setShowPersonalEndDatePicker(false);
  };

  const openEditPersonalEvent = (event) => {
    setEditingPersonalEventId(event.id);
    setPersonalEventTitle(event.title);
    setPersonalEventDescription(event.description || "");
    const hasRange = event.endDate && event.endDate !== event.date;
    setIsPersonalMultiDay(hasRange);
    setPersonalEndDate(event.endDate || event.date);
    setIsPersonalModalVisible(true);
  };

  const handleDeletePersonalEvent = (id) => {
    Alert.alert("削除", "個人の予定を削除しますか？", [
      { text: "キャンセル" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          setIsLoading(true);
          try {
            if (!isOffline) await deletePersonalEvent(user.uid, id);
          } catch (e) {
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtnWrapper}
        >
          <Text style={styles.backBtnText}>◁ ホーム</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📅 カレンダー</Text>
        <View style={{ width: 60 }} />
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <ActivityIndicator
            size="small"
            color="#fff"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.offlineBannerText}>
            現在オフラインです。予定の変更は通信復旧時に送信されます。
          </Text>
        </View>
      )}

      <Calendar
        onDayPress={(day) => setSelectedDate(day.dateString)}
        markedDates={markedDates}
        markingType={"multi-dot"}
        theme={{ todayTextColor: COLORS.primary, arrowColor: "#555" }}
      />

      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={{ paddingBottom: 100 }}
      >
        <View style={styles.dateHeaderRow}>
          <Text style={styles.selectedDateText}>
            {selectedDate.replace(/-/g, "/")} の予定
          </Text>
        </View>

        {/* 部活セクション */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🏟️ 部活の予定（共有）</Text>
            {canManageClubEvents && (
              <TouchableOpacity
                style={styles.addBtnSmall}
                onPress={() => {
                  resetClubForm();
                  setIsClubModalVisible(true);
                }}
              >
                <Text style={styles.addBtnTextSmall}>＋ 追加</Text>
              </TouchableOpacity>
            )}
          </View>
          {dailyClubEvents.length === 0 ? (
            <Text style={styles.emptyText}>予定なし</Text>
          ) : (
            dailyClubEvents.map((item) => {
              const isPending = item.status === "pending";
              return (
                <View
                  key={item.id}
                  style={[
                    styles.eventCard,
                    {
                      borderLeftColor:
                        item.type === "試合" ? COLORS.danger : COLORS.primary,
                    },
                    isPending && styles.pendingCard,
                  ]}
                >
                  {isPending && (
                    <Text style={styles.pendingText}>🕒 待機中</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>
                      {item.title || item.name}
                    </Text>
                    {item.description ? (
                      <Text style={styles.eventDescription} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                    <Text style={styles.eventSub}>
                      {item.type}{" "}
                      {item.endDate && item.endDate !== item.date
                        ? `(${item.date}〜${item.endDate})`
                        : ""}
                    </Text>
                  </View>
                  {canManageClubEvents && !isPending && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => openEditClubEvent(item)}
                        style={styles.iconBtn}
                      >
                        <Text>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeleteClubEvent(item.id)}
                        style={styles.iconBtn}
                      >
                        <Text>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* 個人セクション */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>👤 個人の予定（非公開）</Text>
            <TouchableOpacity
              style={[styles.addBtnSmall, { backgroundColor: COLORS.success }]}
              onPress={() => {
                resetPersonalForm();
                setIsPersonalModalVisible(true);
              }}
            >
              <Text style={styles.addBtnTextSmall}>＋ 追加</Text>
            </TouchableOpacity>
          </View>
          {dailyPersonalEvents.length === 0 ? (
            <Text style={styles.emptyText}>予定なし</Text>
          ) : (
            dailyPersonalEvents.map((item) => {
              const isPending = item.status === "pending";
              return (
                <View
                  key={item.id}
                  style={[
                    styles.eventCard,
                    { borderLeftColor: COLORS.success },
                    isPending && styles.pendingCard,
                  ]}
                >
                  {isPending && (
                    <Text style={styles.pendingText}>🕒 待機中</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>{item.title}</Text>
                    {item.description ? (
                      <Text style={styles.eventDescription} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                    {item.endDate && item.endDate !== item.date ? (
                      <Text style={styles.eventSub}>
                        期間: {item.date} 〜 {item.endDate}
                      </Text>
                    ) : null}
                  </View>
                  {!isPending && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        onPress={() => openEditPersonalEvent(item)}
                        style={styles.iconBtn}
                      >
                        <Text>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeletePersonalEvent(item.id)}
                        style={styles.iconBtn}
                      >
                        <Text>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* 振り返りセクション (個人の履歴のみ) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📝 あなたの提出済み振り返り</Text>
          {dailyMyReports.length === 0 ? (
            <Text style={styles.emptyText}>未提出</Text>
          ) : (
            dailyMyReports.map((report) => {
              const isPending = report.status === "pending";
              return (
                <TouchableOpacity
                  key={report.id}
                  style={[
                    styles.eventCard,
                    {
                      borderLeftColor: COLORS.secondary,
                      backgroundColor: "#fff9f0",
                    },
                    isPending && styles.pendingCard,
                  ]}
                  onPress={() => navigation.navigate("Diary")}
                >
                  {isPending && (
                    <Text style={styles.pendingText}>🕒 送信待機中</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>
                      日報: {report.condition}
                    </Text>
                    <Text style={styles.eventSub} numberOfLines={1}>
                      {report.practiceContent || "練習内容未記入"}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20 }}>📖</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      {isLoading && (
        <View style={styles.globalLoadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.globalLoadingText}>処理中...</Text>
        </View>
      )}

      {/* モーダル：部活 */}
      <Modal visible={isClubModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>部活の予定を共有</Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 60 }}
            >
              <Text style={styles.label}>開始日: {selectedDate}</Text>

              <View style={styles.durationToggleRow}>
                <Text style={styles.label}>期間</Text>
                <View style={styles.toggleGroup}>
                  <TouchableOpacity
                    style={[
                      styles.toggleBtn,
                      !isMultiDay && styles.toggleBtnActive,
                    ]}
                    onPress={() => setIsMultiDay(false)}
                  >
                    <Text
                      style={[
                        styles.toggleText,
                        !isMultiDay && { color: "#fff" },
                      ]}
                    >
                      当日のみ
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.toggleBtn,
                      isMultiDay && styles.toggleBtnActive,
                    ]}
                    onPress={() => {
                      setIsMultiDay(true);
                      setEndDate(endDate || selectedDate);
                    }}
                  >
                    <Text
                      style={[
                        styles.toggleText,
                        isMultiDay && { color: "#fff" },
                      ]}
                    >
                      複数日
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isMultiDay && (
                <View style={styles.endDateContainer}>
                  <TouchableOpacity
                    style={styles.endDateSelector}
                    onPress={() => setShowEndDatePicker(!showEndDatePicker)}
                  >
                    <Text style={styles.endDateText}>
                      終了日: {endDate || selectedDate}
                    </Text>
                  </TouchableOpacity>
                  {showEndDatePicker && (
                    <Calendar
                      onDayPress={(day) => {
                        setEndDate(day.dateString);
                        setShowEndDatePicker(false);
                      }}
                      markedDates={{
                        [endDate]: {
                          selected: true,
                          selectedColor: COLORS.primary,
                        },
                      }}
                    />
                  )}
                </View>
              )}

              <Text style={styles.label}>タイトル</Text>
              <TextInput
                style={styles.input}
                value={clubEventTitle}
                onChangeText={setClubEventTitle}
                placeholder="例: 夏季合宿"
              />
              <Text style={styles.label}>詳細説明</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={clubEventDescription}
                onChangeText={setClubEventDescription}
                placeholder="集合時間、持ち物など"
                multiline
              />

              <Text style={styles.label}>種別</Text>
              <View style={styles.typeRow}>
                {["練習", "試合"].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.typeBtn,
                      clubEventType === t && styles.typeBtnActive,
                    ]}
                    onPress={() => setClubEventType(t)}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        clubEventType === t && { color: "#fff" },
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.modalBtns}>
                <TouchableOpacity
                  onPress={() => setIsClubModalVisible(false)}
                  style={styles.cancelBtn}
                >
                  <Text>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSaveClubEvent}
                  style={styles.saveBtn}
                >
                  <Text style={{ color: "#fff", fontWeight: "bold" }}>
                    共有する
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* モーダル：個人 */}
      <Modal visible={isPersonalModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>個人の予定（非公開）</Text>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 60 }}
            >
              <Text style={styles.label}>開始日: {selectedDate}</Text>

              <View style={styles.durationToggleRow}>
                <Text style={styles.label}>期間</Text>
                <View style={styles.toggleGroup}>
                  <TouchableOpacity
                    style={[
                      styles.toggleBtn,
                      !isPersonalMultiDay && styles.toggleBtnActive,
                    ]}
                    onPress={() => setIsPersonalMultiDay(false)}
                  >
                    <Text
                      style={[
                        styles.toggleText,
                        !isPersonalMultiDay && { color: "#fff" },
                      ]}
                    >
                      当日のみ
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.toggleBtn,
                      isPersonalMultiDay && styles.toggleBtnActive,
                    ]}
                    onPress={() => {
                      setIsPersonalMultiDay(true);
                      setPersonalEndDate(personalEndDate || selectedDate);
                    }}
                  >
                    <Text
                      style={[
                        styles.toggleText,
                        isPersonalMultiDay && { color: "#fff" },
                      ]}
                    >
                      複数日
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isPersonalMultiDay && (
                <View style={styles.endDateContainer}>
                  <TouchableOpacity
                    style={styles.endDateSelector}
                    onPress={() =>
                      setShowPersonalEndDatePicker(!showPersonalEndDatePicker)
                    }
                  >
                    <Text style={styles.endDateText}>
                      終了日: {personalEndDate || selectedDate}
                    </Text>
                  </TouchableOpacity>
                  {showPersonalEndDatePicker && (
                    <Calendar
                      onDayPress={(day) => {
                        setPersonalEndDate(day.dateString);
                        setShowPersonalEndDatePicker(false);
                      }}
                      markedDates={{
                        [personalEndDate]: {
                          selected: true,
                          selectedColor: COLORS.success,
                        },
                      }}
                    />
                  )}
                </View>
              )}

              <Text style={styles.label}>タイトル</Text>
              <TextInput
                style={styles.input}
                value={personalEventTitle}
                onChangeText={setPersonalEventTitle}
                placeholder="例: 整体予約"
              />
              <Text style={styles.label}>詳細・メモ</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={personalEventDescription}
                onChangeText={setPersonalEventDescription}
                placeholder="自分用のメモ"
                multiline
              />

              <View style={styles.modalBtns}>
                <TouchableOpacity
                  onPress={() => setIsPersonalModalVisible(false)}
                  style={styles.cancelBtn}
                >
                  <Text>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSavePersonalEvent}
                  style={[styles.saveBtn, { backgroundColor: COLORS.success }]}
                >
                  <Text style={{ color: "#fff", fontWeight: "bold" }}>
                    保存する
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    height: 60,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtnWrapper: { width: 60 },
  backBtnText: { color: COLORS.textMain, fontWeight: "bold" },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "bold",
    color: COLORS.textMain,
  },

  offlineBanner: {
    backgroundColor: COLORS.secondary,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },

  scrollContent: { flex: 1, padding: 15 },
  dateHeaderRow: {
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#ddd",
  },
  selectedDateText: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.textMain,
  },

  section: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 20,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  sectionTitle: { fontSize: 15, fontWeight: "bold", color: COLORS.textMain },
  addBtnSmall: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  addBtnTextSmall: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  emptyText: {
    textAlign: "center",
    color: "#aaa",
    marginVertical: 10,
    fontSize: 13,
  },

  eventCard: {
    backgroundColor: "#fdfdfd",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderLeftWidth: 4,
    borderWidth: 1,
    borderColor: "#eee",
  },
  pendingCard: { opacity: 0.6, borderStyle: "dashed" },
  pendingText: {
    position: "absolute",
    top: 5,
    right: 10,
    fontSize: 10,
    color: COLORS.secondary,
    fontWeight: "bold",
  },

  eventTitle: { fontSize: 15, fontWeight: "bold", color: COLORS.textMain },
  eventDescription: {
    fontSize: 13,
    color: COLORS.textSub,
    marginTop: 4,
    lineHeight: 18,
  },
  eventSub: { fontSize: 11, color: "#aaa", marginTop: 4 },
  actionRow: { flexDirection: "row", marginLeft: "auto" },
  iconBtn: { padding: 10, marginLeft: 5 },

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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 15,
    padding: 20,
    maxHeight: "90%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  label: { fontSize: 13, fontWeight: "bold", marginBottom: 8, color: "#555" },
  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#eee",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  durationToggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  toggleGroup: {
    flexDirection: "row",
    backgroundColor: "#f0f2f5",
    borderRadius: 8,
    padding: 4,
  },
  toggleBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  toggleBtnActive: { backgroundColor: COLORS.primary },
  toggleText: { fontWeight: "bold", color: "#666", fontSize: 12 },
  endDateContainer: {
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
  },
  endDateSelector: {
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  endDateText: { fontSize: 14, fontWeight: "bold", color: COLORS.primary },
  typeRow: { flexDirection: "row", marginBottom: 20 },
  typeBtn: {
    flex: 1,
    padding: 10,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginRight: 10,
  },
  typeBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeBtnText: { fontWeight: "bold", color: "#666" },
  modalBtns: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
  },
  cancelBtn: { padding: 12, marginRight: 10 },
  saveBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
});

export default CalendarScreen;
