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
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calendar, LocaleConfig } from "react-native-calendars";

import { useAuth } from "../AuthContext";
import {
  createClubEvent,
  updateClubEvent,
  deleteClubEvent,
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

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
const MINUTE_OPTIONS = [
  "00",
  "05",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "55",
];

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

const TimePickerOverlay = ({
  onClose,
  onSelect,
  currentHour,
  currentMin,
  title,
}) => (
  <View
    style={[
      StyleSheet.absoluteFill,
      {
        backgroundColor: "rgba(0,0,0,0.6)",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
      },
    ]}
  >
    <View style={styles.timePickerContent}>
      <Text style={styles.timePickerTitle}>{title}</Text>
      <View style={styles.timePickerRow}>
        <ScrollView
          style={styles.timeScroll}
          showsVerticalScrollIndicator={false}
        >
          {HOUR_OPTIONS.map((h) => (
            <TouchableOpacity
              key={h}
              onPress={() => onSelect(h, currentMin)}
              style={[
                styles.timeOption,
                currentHour === h && styles.timeOptionActive,
              ]}
            >
              <Text
                style={[
                  styles.timeOptionText,
                  currentHour === h && styles.timeOptionTextActive,
                ]}
              >
                {h}時
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Text style={styles.timeSeparator}>:</Text>
        <ScrollView
          style={styles.timeScroll}
          showsVerticalScrollIndicator={false}
        >
          {MINUTE_OPTIONS.map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => onSelect(currentHour, m)}
              style={[
                styles.timeOption,
                currentMin === m && styles.timeOptionActive,
              ]}
            >
              <Text
                style={[
                  styles.timeOptionText,
                  currentMin === m && styles.timeOptionTextActive,
                ]}
              >
                {m}分
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <TouchableOpacity style={styles.timePickerCloseBtn} onPress={onClose}>
        <Text style={styles.timePickerCloseText}>決定</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const CalendarScreen = ({
  navigation,
  isAdmin,
  currentUser,
  clubEvents = [],
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

  // === 部活の予定ステート ===
  const [editingClubEventId, setEditingClubEventId] = useState(null);
  const [clubEventTitle, setClubEventTitle] = useState("");
  const [clubEventDescription, setClubEventDescription] = useState("");
  const [clubEventType, setClubEventType] = useState("練習");
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [clubStartTime, setClubStartTime] = useState("09:00");
  const [clubEndTime, setClubEndTime] = useState("12:00");
  const [isClubAllDay, setIsClubAllDay] = useState(false);
  const [clubTimeSchedules, setClubTimeSchedules] = useState({});

  // === 個人の予定ステート ===
  const [editingPersonalEventId, setEditingPersonalEventId] = useState(null);
  const [personalEventTitle, setPersonalEventTitle] = useState("");
  const [personalEventDescription, setPersonalEventDescription] = useState("");
  const [isPersonalMultiDay, setIsPersonalMultiDay] = useState(false);
  const [personalEndDate, setPersonalEndDate] = useState("");
  const [showPersonalEndDatePicker, setShowPersonalEndDatePicker] =
    useState(false);
  const [personalStartTime, setPersonalStartTime] = useState("18:00");
  const [personalEndTime, setPersonalEndTime] = useState("19:00");
  const [isPersonalAllDay, setIsPersonalAllDay] = useState(false);
  const [personalTimeSchedules, setPersonalTimeSchedules] = useState({});

  const [viewingReport, setViewingReport] = useState(null);

  const [isTimePickerVisible, setIsTimePickerVisible] = useState(false);
  const [timePickerTarget, setTimePickerTarget] = useState("");

  const markedDates = useMemo(() => {
    const marks = {};
    const addMark = (dateStr, key, color) => {
      const normDate = normalizeDate(dateStr);
      if (!marks[normDate]) marks[normDate] = { dots: [] };
      if (!marks[normDate].dots.find((d) => d.key === key)) {
        marks[normDate].dots.push({ key, color });
      }
    };

    clubEvents.forEach((p) => {
      if (p.status !== "deleted") {
        const start = normalizeDate(p.date);
        const end = p.endDate ? normalizeDate(p.endDate) : start;
        const color =
          p.status === "pending"
            ? "#aaa"
            : p.type === "試合"
              ? COLORS.danger
              : COLORS.primary;
        getDatesInRange(start, end).forEach((d) => addMark(d, p.id, color));
      }
    });

    personalEvents.forEach((pe) => {
      if (pe.status !== "deleted") {
        const start = normalizeDate(pe.date);
        const end = pe.endDate ? normalizeDate(pe.endDate) : start;
        const color = pe.status === "pending" ? "#aaa" : COLORS.success;
        getDatesInRange(start, end).forEach((d) => addMark(d, pe.id, color));
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
  }, [clubEvents, personalEvents, dailyReports, selectedDate, currentUser]);

  const dailyClubEvents = clubEvents.filter((p) => {
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

  useEffect(() => {
    if (!isOffline) {
      const hasPendingEvents =
        clubEvents.some((p) => p.status === "pending") ||
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

  const getDisplayTime = (item, targetDate) => {
    if (
      item.isMultiDay &&
      item.timeSchedules &&
      item.timeSchedules[targetDate]
    ) {
      const sched = item.timeSchedules[targetDate];
      if (sched.isAllDay) return "⏰ 終日";
      return `⏰ ${sched.start} 〜 ${sched.end}`;
    }
    if (item.isAllDay) return "⏰ 終日";
    return `⏰ ${item.startTime || "00:00"} 〜 ${item.endTime || "00:00"}`;
  };

  const handleSaveClubEvent = async () => {
    if (!clubEventTitle.trim())
      return Alert.alert("エラー", "タイトルを入力してください");
    if (isMultiDay && endDate < selectedDate)
      return Alert.alert("エラー", "終了日を正しく選択してください");

    setIsLoading(true);

    setTimeout(async () => {
      const schedules = {};
      if (isMultiDay) {
        const dates = getDatesInRange(selectedDate, endDate);
        dates.forEach((d) => {
          schedules[d] = clubTimeSchedules[d] || {
            start: "09:00",
            end: "12:00",
            isAllDay: false,
          };
        });
      }

      const eventData = {
        title: clubEventTitle.trim(),
        name: clubEventTitle.trim(),
        description: clubEventDescription.trim(),
        type: clubEventType,
        date: selectedDate,
        endDate: isMultiDay ? endDate : selectedDate,
        isMultiDay,
        isAllDay: isMultiDay ? false : isClubAllDay,
        startTime: isMultiDay || isClubAllDay ? "" : clubStartTime,
        endTime: isMultiDay || isClubAllDay ? "" : clubEndTime,
        timeSchedules: isMultiDay ? schedules : null,
        participants: "team",
        status: isOffline ? "pending" : "active",
        createdBy: user?.uid || "local_user",
      };

      try {
        if (editingClubEventId) {
          if (!isOffline)
            await updateClubEvent(activeTeamId, editingClubEventId, eventData);
        } else {
          if (!isOffline) await createClubEvent(activeTeamId, eventData);
        }
        setIsClubModalVisible(false);
        resetClubForm();
      } catch (error) {
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
    setClubStartTime("09:00");
    setClubEndTime("12:00");
    setIsClubAllDay(false);
    setClubTimeSchedules({});
  };

  const openEditClubEvent = (event) => {
    setEditingClubEventId(event.id);
    setClubEventTitle(event.title || event.name);
    setClubEventDescription(event.description || "");
    setClubEventType(event.type || "練習");
    setIsMultiDay(event.isMultiDay || false);
    setEndDate(event.endDate || event.date);
    setClubStartTime(event.startTime || "09:00");
    setClubEndTime(event.endTime || "12:00");
    setIsClubAllDay(event.isAllDay || false);
    setClubTimeSchedules(event.timeSchedules || {});
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
            if (!isOffline) await deleteClubEvent(activeTeamId, id);
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
      const schedules = {};
      if (isPersonalMultiDay) {
        const dates = getDatesInRange(selectedDate, personalEndDate);
        dates.forEach((d) => {
          schedules[d] = personalTimeSchedules[d] || {
            start: "18:00",
            end: "19:00",
            isAllDay: false,
          };
        });
      }

      const eventData = {
        date: selectedDate,
        endDate: isPersonalMultiDay ? personalEndDate : selectedDate,
        isMultiDay: isPersonalMultiDay,
        isAllDay: isPersonalMultiDay ? false : isPersonalAllDay,
        startTime:
          isPersonalMultiDay || isPersonalAllDay ? "" : personalStartTime,
        endTime: isPersonalMultiDay || isPersonalAllDay ? "" : personalEndTime,
        timeSchedules: isPersonalMultiDay ? schedules : null,
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
    setPersonalStartTime("18:00");
    setPersonalEndTime("19:00");
    setIsPersonalAllDay(false);
    setPersonalTimeSchedules({});
  };

  const openEditPersonalEvent = (event) => {
    setEditingPersonalEventId(event.id);
    setPersonalEventTitle(event.title);
    setPersonalEventDescription(event.description || "");
    setIsPersonalMultiDay(event.isMultiDay || false);
    setPersonalEndDate(event.endDate || event.date);
    setPersonalStartTime(event.startTime || "18:00");
    setPersonalEndTime(event.endTime || "19:00");
    setIsPersonalAllDay(event.isAllDay || false);
    setPersonalTimeSchedules(event.timeSchedules || {});
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
          } finally {
            setIsLoading(false);
          }
        },
      },
    ]);
  };

  let currentPickerHour = "09";
  let currentPickerMin = "00";
  let pickerTitle = "時間を選択";

  if (timePickerTarget === "club_single_start") {
    [currentPickerHour, currentPickerMin] = clubStartTime.split(":");
    pickerTitle = "開始時間を選択";
  } else if (timePickerTarget === "club_single_end") {
    [currentPickerHour, currentPickerMin] = clubEndTime.split(":");
    pickerTitle = "終了時間を選択";
  } else if (timePickerTarget.startsWith("club_multi_start_")) {
    const d = timePickerTarget.replace("club_multi_start_", "");
    const t = clubTimeSchedules[d]?.start || "09:00";
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の開始時間`;
  } else if (timePickerTarget.startsWith("club_multi_end_")) {
    const d = timePickerTarget.replace("club_multi_end_", "");
    const t = clubTimeSchedules[d]?.end || "12:00";
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の終了時間`;
  } else if (timePickerTarget === "personal_single_start") {
    [currentPickerHour, currentPickerMin] = personalStartTime.split(":");
    pickerTitle = "開始時間を選択";
  } else if (timePickerTarget === "personal_single_end") {
    [currentPickerHour, currentPickerMin] = personalEndTime.split(":");
    pickerTitle = "終了時間を選択";
  } else if (timePickerTarget.startsWith("personal_multi_start_")) {
    const d = timePickerTarget.replace("personal_multi_start_", "");
    const t = personalTimeSchedules[d]?.start || "18:00";
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の開始時間`;
  } else if (timePickerTarget.startsWith("personal_multi_end_")) {
    const d = timePickerTarget.replace("personal_multi_end_", "");
    const t = personalTimeSchedules[d]?.end || "19:00";
    [currentPickerHour, currentPickerMin] = t.split(":");
    pickerTitle = `${d.substring(5).replace("-", "/")} の終了時間`;
  }

  const handleTimeSelect = (h, m) => {
    const timeStr = `${h}:${m}`;
    if (timePickerTarget === "club_single_start") setClubStartTime(timeStr);
    else if (timePickerTarget === "club_single_end") setClubEndTime(timeStr);
    else if (timePickerTarget.startsWith("club_multi_start_")) {
      const d = timePickerTarget.replace("club_multi_start_", "");
      setClubTimeSchedules((prev) => ({
        ...prev,
        [d]: { ...prev[d], start: timeStr },
      }));
    } else if (timePickerTarget.startsWith("club_multi_end_")) {
      const d = timePickerTarget.replace("club_multi_end_", "");
      setClubTimeSchedules((prev) => ({
        ...prev,
        [d]: { ...prev[d], end: timeStr },
      }));
    } else if (timePickerTarget === "personal_single_start")
      setPersonalStartTime(timeStr);
    else if (timePickerTarget === "personal_single_end")
      setPersonalEndTime(timeStr);
    else if (timePickerTarget.startsWith("personal_multi_start_")) {
      const d = timePickerTarget.replace("personal_multi_start_", "");
      setPersonalTimeSchedules((prev) => ({
        ...prev,
        [d]: { ...prev[d], start: timeStr },
      }));
    } else if (timePickerTarget.startsWith("personal_multi_end_")) {
      const d = timePickerTarget.replace("personal_multi_end_", "");
      setPersonalTimeSchedules((prev) => ({
        ...prev,
        [d]: { ...prev[d], end: timeStr },
      }));
    }
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
                    <Text style={styles.timeRangeText}>
                      {getDisplayTime(item, selectedDate)}
                    </Text>
                    {item.description ? (
                      <Text style={styles.eventDescription} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                    <Text style={styles.eventSub}>
                      {item.type}{" "}
                      {item.isMultiDay
                        ? `(期間: ${item.date.replace(/-/g, "/")} 〜 ${item.endDate.replace(/-/g, "/")})`
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
                    <Text style={styles.timeRangeText}>
                      {getDisplayTime(item, selectedDate)}
                    </Text>
                    {item.description ? (
                      <Text style={styles.eventDescription} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                    {item.isMultiDay ? (
                      <Text style={styles.eventSub}>
                        期間: {item.date.replace(/-/g, "/")} 〜{" "}
                        {item.endDate.replace(/-/g, "/")}
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
                  onPress={() => setViewingReport(report)}
                >
                  {isPending && (
                    <Text style={styles.pendingText}>🕒 送信待機中</Text>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>
                      日報: {report.condition}
                    </Text>
                    <Text style={styles.eventSub} numberOfLines={1}>
                      {report.reflection || "振り返り未記入"}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20 }}>🔍</Text>
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

      {/* 振り返り詳細モーダル */}
      <Modal visible={viewingReport !== null} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>提出済みの振り返り</Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 50 }}
            >
              {viewingReport && (
                <>
                  <Text style={styles.label}>📅 提出日</Text>
                  <Text style={styles.viewingText}>{viewingReport.date}</Text>

                  <Text style={styles.label}>🏥 コンディション</Text>
                  <Text style={styles.viewingText}>
                    体調: {viewingReport.condition} / 疲労度:{" "}
                    {viewingReport.fatigue} / 練習:{" "}
                    {viewingReport.isParticipating}
                  </Text>

                  {viewingReport.hasPain && viewingReport.painDetails && (
                    <Text
                      style={[
                        styles.viewingText,
                        { color: COLORS.danger, fontWeight: "bold" },
                      ]}
                    >
                      🤕 ケガ・痛み: {viewingReport.painDetails.part} (レベル:{" "}
                      {viewingReport.painDetails.level})
                    </Text>
                  )}

                  <Text style={styles.label}>📝 振り返り内容</Text>
                  <Text style={styles.viewingText}>
                    {viewingReport.reflection || "未記入"}
                  </Text>

                  <Text style={styles.label}>📈 達成度 (自己評価)</Text>
                  <Text style={styles.viewingText}>
                    {viewingReport.achievement} / 5
                  </Text>

                  {viewingReport.memo ? (
                    <>
                      <Text style={styles.label}>📎 メモ</Text>
                      <Text style={styles.viewingText}>
                        {viewingReport.memo}
                      </Text>
                    </>
                  ) : null}

                  {viewingReport.comments &&
                    viewingReport.comments.length > 0 && (
                      <>
                        <Text style={styles.label}>💬 やり取り</Text>
                        {viewingReport.comments.map((c) => (
                          <View key={c.id} style={styles.commentBox}>
                            <Text style={styles.commentUser}>{c.user}</Text>
                            <Text style={styles.commentText}>{c.text}</Text>
                          </View>
                        ))}
                      </>
                    )}
                </>
              )}
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={() => setViewingReport(null)}
                >
                  <Text style={styles.submitBtnText}>閉じる</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 部活予定モーダル */}
      <Modal visible={isClubModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingClubEventId ? "予定の編集" : "新しい予定を追加"}
              </Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 50 }}
            >
              <Text style={styles.label}>予定のタイトル</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 練習試合"
                value={clubEventTitle}
                onChangeText={setClubEventTitle}
              />

              <Text style={styles.label}>日程 (開始日: {selectedDate})</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[styles.typeBtn, !isMultiDay && styles.typeBtnActive]}
                  onPress={() => {
                    setIsMultiDay(false);
                    setEndDate(selectedDate);
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      !isMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    当日のみ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.typeBtn, isMultiDay && styles.typeBtnActive]}
                  onPress={() => {
                    setIsMultiDay(true);
                    setEndDate(endDate || selectedDate);
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      isMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    複数日
                  </Text>
                </TouchableOpacity>
              </View>

              {isMultiDay ? (
                <View style={styles.multiDayContainer}>
                  <Text
                    style={[
                      styles.label,
                      {
                        color: COLORS.primary,
                        textAlign: "center",
                        marginBottom: 10,
                      },
                    ]}
                  >
                    ▼ 終了日をタップして選択 ▼
                  </Text>
                  <TouchableOpacity
                    style={styles.endDateSelector}
                    onPress={() => setShowEndDatePicker(!showEndDatePicker)}
                  >
                    <Text style={styles.endDateText}>
                      🗓️ {endDate || selectedDate}
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

                  {endDate >= selectedDate && (
                    <View style={{ marginTop: 15 }}>
                      <Text style={[styles.label, { marginBottom: 10 }]}>
                        ⏰ 日ごとの時間設定
                      </Text>
                      {getDatesInRange(selectedDate, endDate).map((date) => {
                        const sched = clubTimeSchedules[date] || {
                          start: "09:00",
                          end: "12:00",
                          isAllDay: false,
                        };
                        return (
                          <View key={date} style={styles.multiTimeRow}>
                            <View style={styles.multiTimeLeft}>
                              <Text style={styles.multiTimeDate}>
                                {date.substring(5).replace("-", "/")}
                              </Text>
                              <View style={styles.allDaySwitchRow}>
                                <Switch
                                  value={sched.isAllDay}
                                  onValueChange={(val) =>
                                    setClubTimeSchedules((prev) => ({
                                      ...prev,
                                      [date]: { ...sched, isAllDay: val },
                                    }))
                                  }
                                  scaleX={0.7}
                                  scaleY={0.7}
                                />
                                <Text style={styles.allDayLabelSmall}>
                                  終日
                                </Text>
                              </View>
                            </View>
                            <View style={styles.multiTimeRight}>
                              {!sched.isAllDay ? (
                                <View style={styles.multiTimeInputContainer}>
                                  <TouchableOpacity
                                    style={styles.multiTimeBtn}
                                    onPress={() => {
                                      setTimePickerTarget(
                                        `club_multi_start_${date}`,
                                      );
                                      setIsTimePickerVisible(true);
                                    }}
                                  >
                                    <Text style={styles.multiTimeBtnText}>
                                      {sched.start}
                                    </Text>
                                  </TouchableOpacity>
                                  <Text style={styles.timeBetweenSmall}>
                                    〜
                                  </Text>
                                  <TouchableOpacity
                                    style={styles.multiTimeBtn}
                                    onPress={() => {
                                      setTimePickerTarget(
                                        `club_multi_end_${date}`,
                                      );
                                      setIsTimePickerVisible(true);
                                    }}
                                  >
                                    <Text style={styles.multiTimeBtnText}>
                                      {sched.end}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              ) : (
                                <Text style={styles.allDayActiveText}>
                                  終日設定中
                                </Text>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : (
                <View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 10,
                    }}
                  >
                    <Text style={styles.label}>⏰ 時間</Text>
                    <View
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      <Text
                        style={{
                          marginRight: 5,
                          fontSize: 14,
                          fontWeight: "bold",
                          color: COLORS.textSub,
                        }}
                      >
                        終日
                      </Text>
                      <Switch
                        value={isClubAllDay}
                        onValueChange={setIsClubAllDay}
                      />
                    </View>
                  </View>
                  {!isClubAllDay && (
                    <View style={styles.timeInputRow}>
                      <TouchableOpacity
                        style={styles.timeSelectBtn}
                        onPress={() => {
                          setTimePickerTarget("club_single_start");
                          setIsTimePickerVisible(true);
                        }}
                      >
                        <Text style={styles.timeSelectBtnText}>
                          {clubStartTime}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.timeBetween}>〜</Text>
                      <TouchableOpacity
                        style={styles.timeSelectBtn}
                        onPress={() => {
                          setTimePickerTarget("club_single_end");
                          setIsTimePickerVisible(true);
                        }}
                      >
                        <Text style={styles.timeSelectBtnText}>
                          {clubEndTime}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              <Text style={styles.label}>種類</Text>
              <View style={styles.typeContainer}>
                {["練習", "試合", "その他"].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.typeBtn,
                      clubEventType === t && styles.typeBtnActive,
                    ]}
                    onPress={() => setClubEventType(t)}
                  >
                    {/* ★ 修正：選択されたボタンは文字色を白くする */}
                    <Text
                      style={[
                        styles.typeBtnText,
                        clubEventType === t && styles.typeBtnTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>詳細説明・備考</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={clubEventDescription}
                onChangeText={setClubEventDescription}
                placeholder="集合時間、持ち物など"
                multiline
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsClubModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={handleSaveClubEvent}
                >
                  <Text style={styles.submitBtnText}>保存する</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          {isTimePickerVisible && timePickerTarget.includes("club") && (
            <TimePickerOverlay
              onClose={() => setIsTimePickerVisible(false)}
              title={pickerTitle}
              currentHour={currentPickerHour}
              currentMin={currentPickerMin}
              onSelect={handleTimeSelect}
            />
          )}
        </View>
      </Modal>

      {/* 個人予定モーダル */}
      <Modal visible={isPersonalModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingPersonalEventId
                  ? "個人の予定を編集"
                  : "個人の予定を追加"}
              </Text>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 50 }}
            >
              <Text style={styles.label}>予定のタイトル</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 塾、通院"
                value={personalEventTitle}
                onChangeText={setPersonalEventTitle}
              />

              <Text style={styles.label}>日程 (開始日: {selectedDate})</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    !isPersonalMultiDay && styles.typeBtnActive,
                  ]}
                  onPress={() => {
                    setIsPersonalMultiDay(false);
                    setPersonalEndDate(selectedDate);
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      !isPersonalMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    当日のみ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    isPersonalMultiDay && styles.typeBtnActive,
                  ]}
                  onPress={() => {
                    setIsPersonalMultiDay(true);
                    setPersonalEndDate(personalEndDate || selectedDate);
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      isPersonalMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    複数日
                  </Text>
                </TouchableOpacity>
              </View>

              {isPersonalMultiDay ? (
                <View style={styles.multiDayContainer}>
                  <Text
                    style={[
                      styles.label,
                      {
                        color: COLORS.success,
                        textAlign: "center",
                        marginBottom: 10,
                      },
                    ]}
                  >
                    ▼ 終了日をタップして選択 ▼
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.endDateSelector,
                      { borderColor: COLORS.success },
                    ]}
                    onPress={() =>
                      setShowPersonalEndDatePicker(!showPersonalEndDatePicker)
                    }
                  >
                    <Text
                      style={[styles.endDateText, { color: COLORS.success }]}
                    >
                      🗓️ {personalEndDate || selectedDate}
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

                  {personalEndDate >= selectedDate && (
                    <View style={{ marginTop: 15 }}>
                      <Text style={[styles.label, { marginBottom: 10 }]}>
                        ⏰ 日ごとの時間設定
                      </Text>
                      {getDatesInRange(selectedDate, personalEndDate).map(
                        (date) => {
                          const sched = personalTimeSchedules[date] || {
                            start: "18:00",
                            end: "19:00",
                            isAllDay: false,
                          };
                          return (
                            <View key={date} style={styles.multiTimeRow}>
                              <View style={styles.multiTimeLeft}>
                                <Text style={styles.multiTimeDate}>
                                  {date.substring(5).replace("-", "/")}
                                </Text>
                                <View style={styles.allDaySwitchRow}>
                                  <Switch
                                    value={sched.isAllDay}
                                    onValueChange={(val) =>
                                      setPersonalTimeSchedules((prev) => ({
                                        ...prev,
                                        [date]: { ...sched, isAllDay: val },
                                      }))
                                    }
                                    scaleX={0.7}
                                    scaleY={0.7}
                                  />
                                  <Text style={styles.allDayLabelSmall}>
                                    終日
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.multiTimeRight}>
                                {!sched.isAllDay ? (
                                  <View style={styles.multiTimeInputContainer}>
                                    <TouchableOpacity
                                      style={styles.multiTimeBtn}
                                      onPress={() => {
                                        setTimePickerTarget(
                                          `personal_multi_start_${date}`,
                                        );
                                        setIsTimePickerVisible(true);
                                      }}
                                    >
                                      <Text style={styles.multiTimeBtnText}>
                                        {sched.start}
                                      </Text>
                                    </TouchableOpacity>
                                    <Text style={styles.timeBetweenSmall}>
                                      〜
                                    </Text>
                                    <TouchableOpacity
                                      style={styles.multiTimeBtn}
                                      onPress={() => {
                                        setTimePickerTarget(
                                          `personal_multi_end_${date}`,
                                        );
                                        setIsTimePickerVisible(true);
                                      }}
                                    >
                                      <Text style={styles.multiTimeBtnText}>
                                        {sched.end}
                                      </Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : (
                                  <Text
                                    style={[
                                      styles.allDayActiveText,
                                      { color: COLORS.success },
                                    ]}
                                  >
                                    終日設定中
                                  </Text>
                                )}
                              </View>
                            </View>
                          );
                        },
                      )}
                    </View>
                  )}
                </View>
              ) : (
                <View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 10,
                    }}
                  >
                    <Text style={styles.label}>⏰ 時間</Text>
                    <View
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      <Text
                        style={{
                          marginRight: 5,
                          fontSize: 14,
                          fontWeight: "bold",
                          color: COLORS.textSub,
                        }}
                      >
                        終日
                      </Text>
                      <Switch
                        value={isPersonalAllDay}
                        onValueChange={setIsPersonalAllDay}
                      />
                    </View>
                  </View>
                  {!isPersonalAllDay && (
                    <View style={styles.timeInputRow}>
                      <TouchableOpacity
                        style={styles.timeSelectBtn}
                        onPress={() => {
                          setTimePickerTarget("personal_single_start");
                          setIsTimePickerVisible(true);
                        }}
                      >
                        <Text style={styles.timeSelectBtnText}>
                          {personalStartTime}
                        </Text>
                      </TouchableOpacity>
                      <Text style={styles.timeBetween}>〜</Text>
                      <TouchableOpacity
                        style={styles.timeSelectBtn}
                        onPress={() => {
                          setTimePickerTarget("personal_single_end");
                          setIsTimePickerVisible(true);
                        }}
                      >
                        <Text style={styles.timeSelectBtnText}>
                          {personalEndTime}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}

              <Text style={styles.label}>メモ</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={personalEventDescription}
                onChangeText={setPersonalEventDescription}
                placeholder="自分用のメモ"
                multiline
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsPersonalModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    { backgroundColor: COLORS.success },
                  ]}
                  onPress={handleSavePersonalEvent}
                >
                  <Text style={styles.submitBtnText}>保存する</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          {isTimePickerVisible && timePickerTarget.includes("personal") && (
            <TimePickerOverlay
              onClose={() => setIsTimePickerVisible(false)}
              title={pickerTitle}
              currentHour={currentPickerHour}
              currentMin={currentPickerMin}
              onSelect={handleTimeSelect}
            />
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    height: 60,
    backgroundColor: "#34495e",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backBtnWrapper: { width: 60 },
  backBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
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
  timeRangeText: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: "bold",
    marginVertical: 2,
  },
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
    borderRadius: 12,
    padding: 20,
    maxHeight: "90%",
  },
  modalHeader: { marginBottom: 15, alignItems: "center" },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 5,
  },
  label: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 8,
    marginTop: 10,
  },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 10,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  typeContainer: { flexDirection: "row", marginBottom: 10 },

  // ★ 修正：種類/日程選択ボタンのスタイル
  typeBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginRight: 10,
    backgroundColor: "#f9f9f9",
  },
  typeBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  typeBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  typeBtnTextActive: { color: "#ffffff" },

  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 20,
  },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 20, marginRight: 10 },
  cancelBtnText: { color: "#888", fontWeight: "bold", fontSize: 15 },
  submitBtn: {
    backgroundColor: "#34495e",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  submitBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },

  multiDayContainer: {
    backgroundColor: "#f9f9f9",
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#eee",
  },
  multiTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  multiTimeLeft: { width: 85 },
  multiTimeDate: { fontSize: 14, fontWeight: "bold", color: COLORS.textMain },
  allDaySwitchRow: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  allDayLabelSmall: { fontSize: 11, color: "#666", fontWeight: "bold" },

  multiTimeRight: { flex: 1, alignItems: "flex-end" },
  multiTimeInputContainer: { flexDirection: "row", alignItems: "center" },
  multiTimeBtn: {
    backgroundColor: "#f0f2f5",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#ccc",
    minWidth: 65,
    alignItems: "center",
  },
  multiTimeBtnText: { fontSize: 13, fontWeight: "bold", color: COLORS.primary },
  timeBetweenSmall: {
    marginHorizontal: 5,
    color: "#888",
    fontWeight: "bold",
    fontSize: 12,
  },
  allDayActiveText: { fontSize: 13, color: COLORS.primary, fontWeight: "bold" },

  endDateSelector: {
    backgroundColor: "#fff",
    paddingVertical: 15,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.primary,
    alignItems: "center",
    marginBottom: 10,
  },
  endDateText: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.primary,
  },

  timePickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
  },
  timeInputRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
  },
  timeSelectBtn: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  timeSelectBtnText: {
    fontSize: 20,
    fontWeight: "bold",
    color: COLORS.primary,
  },
  timeBetween: {
    marginHorizontal: 15,
    fontSize: 18,
    fontWeight: "bold",
    color: "#888",
  },
  timePickerContent: {
    width: "80%",
    height: 400,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    alignSelf: "center",
  },
  timePickerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    textAlign: "center",
    marginBottom: 10,
  },
  timePickerRow: { flexDirection: "row", flex: 1, alignItems: "center" },
  timeScroll: { flex: 1 },
  timeSeparator: { fontSize: 24, fontWeight: "bold", marginHorizontal: 10 },
  timeOption: { paddingVertical: 15, alignItems: "center" },
  timeOptionActive: { backgroundColor: "#e8f0fe", borderRadius: 8 },
  timeOptionText: { fontSize: 18, color: "#555" },
  timeOptionTextActive: { color: COLORS.primary, fontWeight: "bold" },
  timePickerCloseBtn: {
    marginTop: 20,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  timePickerCloseText: { color: "#fff", fontWeight: "bold", fontSize: 16 },

  viewingText: {
    fontSize: 15,
    color: COLORS.textMain,
    marginBottom: 15,
    lineHeight: 22,
  },
  commentBox: {
    backgroundColor: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  commentUser: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.primary,
    marginBottom: 4,
  },
  commentText: { fontSize: 14, color: COLORS.textMain },
});

export default CalendarScreen;
