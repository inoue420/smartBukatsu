import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// 日付操作のユーティリティ関数
const getDatesInRange = (startDateStr, endDateStr) => {
  const dates = [];
  let curr = new Date(startDateStr.replace(/\//g, "-"));
  const end = new Date(endDateStr.replace(/\//g, "-"));

  while (curr <= end) {
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, "0");
    const d = String(curr.getDate()).padStart(2, "0");
    dates.push(`${y}/${m}/${d}`);
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
};

// ボタンで日付を前後にずらすための関数
const adjustDateByDays = (dateStr, days) => {
  const d = new Date(dateStr.replace(/\//g, "-"));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

const CalendarScreen = ({
  navigation,
  isAdmin,
  currentUser,
  projects,
  setProjects,
  dailyReports,
  userProfiles = {},
  personalEvents = [],
  setPersonalEvents,
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
  const staffScope = currentUserProfile.staffScope || "all";

  const today = new Date();
  const todayString = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

  const [currentMonth, setCurrentMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(todayString);

  // === 部活の予定用ステート ===
  const [isEventModalVisible, setIsEventModalVisible] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventTitle, setEventTitle] = useState("");
  const [isEventMultiDay, setIsEventMultiDay] = useState(false);
  const [eventEndDate, setEventEndDate] = useState(todayString);
  const [eventType, setEventType] = useState("練習");
  const [eventParticipants, setEventParticipants] = useState("team");
  const [eventMemo, setEventMemo] = useState("");

  // === 個人の予定用ステート ===
  const [isPersonalModalVisible, setIsPersonalModalVisible] = useState(false);
  const [editingPersonalId, setEditingPersonalId] = useState(null);
  const [personalTitle, setPersonalTitle] = useState("");
  const [isPersonalMultiDay, setIsPersonalMultiDay] = useState(false);
  const [personalEndDate, setPersonalEndDate] = useState(todayString);
  const [personalMemo, setPersonalMemo] = useState("");

  const handlePrevMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
    );
  };
  const handleNextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
    );
  };

  const getAlertLevel = (record) => {
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
    return "normal";
  };

  const visibleProjects = projects.filter((p) => {
    if (p.status === "deleted") return false;
    if (["member", "captain"].includes(userRole) && p.participants === "coach")
      return false;
    return true;
  });

  const visibleReports = dailyReports.filter((d) => {
    if (d.status === "deleted") return false;
    if (userRole === "owner") return true;
    if (userRole === "staff") {
      if (staffScope === "all") return true;
      if (staffScope === "assigned") {
        const authorProfile = userProfiles[d.author] || {};
        return authorProfile.assignedStaff === currentUser;
      }
    }
    return ["member", "captain"].includes(userRole)
      ? d.author === currentUser
      : false;
  });

  const myPersonalEvents = personalEvents.filter(
    (e) => e.status !== "deleted" && e.author === currentUser,
  );

  const eventsMap = {};

  visibleProjects.forEach((p) => {
    const range = getDatesInRange(p.date, p.endDate || p.date);
    range.forEach((d) => {
      if (!eventsMap[d])
        eventsMap[d] = { projects: [], reports: [], personal: [] };
      eventsMap[d].projects.push(p);
    });
  });

  visibleReports.forEach((r) => {
    if (!eventsMap[r.date])
      eventsMap[r.date] = { projects: [], reports: [], personal: [] };
    eventsMap[r.date].reports.push(r);
  });

  myPersonalEvents.forEach((pe) => {
    const range = getDatesInRange(pe.date, pe.endDate || pe.date);
    range.forEach((d) => {
      if (!eventsMap[d])
        eventsMap[d] = { projects: [], reports: [], personal: [] };
      eventsMap[d].personal.push(pe);
    });
  });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const daysArray = Array(firstDayOfWeek).fill(null);
  for (let i = 1; i <= daysInMonth; i++) {
    daysArray.push(i);
  }
  while (daysArray.length % 7 !== 0) {
    daysArray.push(null);
  }

  const selectedEvents = eventsMap[selectedDate] || {
    projects: [],
    reports: [],
    personal: [],
  };

  const adjustEndDate = (setter, currentEnd, days) => {
    const nextDate = adjustDateByDays(currentEnd, days);
    if (
      new Date(nextDate.replace(/\//g, "-")) <
      new Date(selectedDate.replace(/\//g, "-"))
    ) {
      return;
    }
    setter(nextDate);
  };

  const openEventModal = (event = null) => {
    if (event) {
      setEditingEventId(event.id);
      setEventTitle(event.title);
      setEventEndDate(event.endDate || event.date);
      setIsEventMultiDay(!!event.endDate && event.endDate !== event.date);
      setEventType(event.type);
      setEventParticipants(event.participants);
      setEventMemo(event.memo || "");
    } else {
      setEditingEventId(null);
      setEventTitle("");
      setEventEndDate(selectedDate);
      setIsEventMultiDay(false);
      setEventType("練習");
      setEventParticipants("team");
      setEventMemo("");
    }
    setIsEventModalVisible(true);
  };

  // ★修正: 再度「ローカルに保存（setProjects）」へ戻しました。Firebaseの門番は回避します。
  const handleSaveEvent = () => {
    if (eventTitle.trim() === "")
      return Alert.alert("エラー", "タイトルを入力してください。");

    const finalEndDate = isEventMultiDay ? eventEndDate : selectedDate;

    if (
      new Date(finalEndDate.replace(/\//g, "-")) <
      new Date(selectedDate.replace(/\//g, "-"))
    ) {
      return Alert.alert("エラー", "終了日は開始日以降に設定してください。");
    }

    if (editingEventId) {
      setProjects(
        projects.map((p) =>
          p.id === editingEventId
            ? {
                ...p,
                title: eventTitle,
                endDate: finalEndDate,
                type: eventType,
                participants: eventParticipants,
                memo: eventMemo,
              }
            : p,
        ),
      );
    } else {
      const newEvent = {
        id: "p_" + Date.now().toString(),
        title: eventTitle,
        date: selectedDate,
        endDate: finalEndDate,
        type: eventType,
        status: "active",
        participants: eventParticipants,
        memo: eventMemo,
      };
      setProjects([...projects, newEvent]);
    }
    setIsEventModalVisible(false);
    Keyboard.dismiss();
  };

  const handleDeleteEvent = () => {
    Alert.alert("削除の確認", "この予定を削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => {
          setProjects(
            projects.map((p) =>
              p.id === editingEventId ? { ...p, status: "deleted" } : p,
            ),
          );
          setIsEventModalVisible(false);
        },
      },
    ]);
  };

  const openPersonalModal = (event = null) => {
    if (event) {
      setEditingPersonalId(event.id);
      setPersonalTitle(event.title);
      setPersonalEndDate(event.endDate || event.date);
      setIsPersonalMultiDay(!!event.endDate && event.endDate !== event.date);
      setPersonalMemo(event.memo || "");
    } else {
      setEditingPersonalId(null);
      setPersonalTitle("");
      setPersonalEndDate(selectedDate);
      setIsPersonalMultiDay(false);
      setPersonalMemo("");
    }
    setIsPersonalModalVisible(true);
  };

  const handleSavePersonal = () => {
    if (personalTitle.trim() === "")
      return Alert.alert("エラー", "タイトルを入力してください。");

    const finalEndDate = isPersonalMultiDay ? personalEndDate : selectedDate;

    if (
      new Date(finalEndDate.replace(/\//g, "-")) <
      new Date(selectedDate.replace(/\//g, "-"))
    ) {
      return Alert.alert("エラー", "終了日は開始日以降に設定してください。");
    }

    if (editingPersonalId) {
      setPersonalEvents(
        personalEvents.map((p) =>
          p.id === editingPersonalId
            ? {
                ...p,
                title: personalTitle,
                endDate: finalEndDate,
                memo: personalMemo,
              }
            : p,
        ),
      );
    } else {
      const newPersonalEvent = {
        id: "pe_" + Date.now().toString(),
        title: personalTitle,
        date: selectedDate,
        endDate: finalEndDate,
        author: currentUser,
        status: "active",
        memo: personalMemo,
      };
      setPersonalEvents([...personalEvents, newPersonalEvent]);
    }
    setIsPersonalModalVisible(false);
    Keyboard.dismiss();
  };

  const handleDeletePersonal = () => {
    Alert.alert("削除の確認", "この個人の予定を削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => {
          setPersonalEvents(
            personalEvents.map((p) =>
              p.id === editingPersonalId ? { ...p, status: "deleted" } : p,
            ),
          );
          setIsPersonalModalVisible(false);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>◁ ホーム</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📅 カレンダー</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.calendarControl}>
          <TouchableOpacity style={styles.arrowBtn} onPress={handlePrevMonth}>
            <Text style={styles.arrowText}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.monthTitle}>
            {year}年 {month + 1}月
          </Text>
          <TouchableOpacity style={styles.arrowBtn} onPress={handleNextMonth}>
            <Text style={styles.arrowText}>▶</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.weekRow}>
          {["日", "月", "火", "水", "木", "金", "土"].map((day, idx) => (
            <Text
              key={idx}
              style={[
                styles.weekText,
                idx === 0 && { color: "#e74c3c" },
                idx === 6 && { color: "#3498db" },
              ]}
            >
              {day}
            </Text>
          ))}
        </View>

        <View style={styles.daysGrid}>
          {daysArray.map((day, index) => {
            if (!day)
              return <View key={`empty-${index}`} style={styles.dayCell} />;
            const dateStr = `${year}/${String(month + 1).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
            const isToday = dateStr === todayString;
            const isSelected = dateStr === selectedDate;
            const dayEvents = eventsMap[dateStr] || {
              projects: [],
              reports: [],
              personal: [],
            };

            let reportDotColor = null;
            if (dayEvents.reports.length > 0) {
              const hasDanger = dayEvents.reports.some(
                (r) => getAlertLevel(r) === "danger",
              );
              const hasWarning = dayEvents.reports.some(
                (r) => getAlertLevel(r) === "warning",
              );
              reportDotColor = hasDanger
                ? "#e74c3c"
                : hasWarning
                  ? "#f39c12"
                  : "#2ecc71";
            }

            return (
              <TouchableOpacity
                key={dateStr}
                style={[styles.dayCell, isSelected && styles.dayCellSelected]}
                onPress={() => setSelectedDate(dateStr)}
              >
                <View
                  style={[styles.dayCircle, isToday && styles.dayCircleToday]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      isToday && { color: "#fff" },
                      index % 7 === 0 && !isToday && { color: "#e74c3c" },
                      index % 7 === 6 && !isToday && { color: "#3498db" },
                    ]}
                  >
                    {day}
                  </Text>
                </View>
                <View style={styles.markerRow}>
                  {dayEvents.projects.length > 0 && (
                    <View
                      style={[styles.dot, { backgroundColor: "#3498db" }]}
                    />
                  )}
                  {reportDotColor && (
                    <View
                      style={[styles.dot, { backgroundColor: reportDotColor }]}
                    />
                  )}
                  {dayEvents.personal.length > 0 && (
                    <View
                      style={[styles.dot, { backgroundColor: "#9b59b6" }]}
                    />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />
        <Text style={styles.detailTitle}>{selectedDate} の予定・記録</Text>

        <View style={styles.detailSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionSubtitle}>
              📁 部活の予定 ({selectedEvents.projects.length})
            </Text>
            {["owner", "staff", "captain"].includes(userRole) && (
              <TouchableOpacity onPress={() => openEventModal()}>
                <Text style={styles.jumpLink}>＋ 予定を追加</Text>
              </TouchableOpacity>
            )}
          </View>
          {selectedEvents.projects.length === 0 ? (
            <Text style={styles.emptyText}>予定はありません。</Text>
          ) : (
            selectedEvents.projects.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.eventCard}
                onPress={() =>
                  ["owner", "staff", "captain"].includes(userRole) &&
                  openEventModal(p)
                }
              >
                <View style={styles.eventCardHeader}>
                  <View
                    style={[
                      styles.badge,
                      p.type === "試合"
                        ? styles.badgeMatch
                        : p.type === "練習"
                          ? styles.badgePractice
                          : styles.badgeOther,
                    ]}
                  >
                    <Text style={styles.badgeText}>{p.type}</Text>
                  </View>
                  <Text style={styles.eventTitle}>{p.title}</Text>
                </View>
                {p.endDate && p.endDate !== p.date && (
                  <Text style={styles.periodText}>
                    期間: {p.date} 〜 {p.endDate}
                  </Text>
                )}
                {p.memo ? (
                  <Text style={styles.eventMemoText}>{p.memo}</Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.detailSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionSubtitle}>
              🔒 個人の予定 ({selectedEvents.personal.length})
            </Text>
            <TouchableOpacity onPress={() => openPersonalModal()}>
              <Text style={[styles.jumpLink, { color: "#9b59b6" }]}>
                ＋ 個人の予定
              </Text>
            </TouchableOpacity>
          </View>
          {selectedEvents.personal.length === 0 ? (
            <Text style={styles.emptyText}>予定はありません。</Text>
          ) : (
            selectedEvents.personal.map((pe) => (
              <TouchableOpacity
                key={pe.id}
                style={styles.personalEventCard}
                onPress={() => openPersonalModal(pe)}
              >
                <View style={styles.eventCardHeader}>
                  <View style={styles.badgePersonal}>
                    <Text style={[styles.badgeText, { color: "#fff" }]}>
                      個人
                    </Text>
                  </View>
                  <Text style={styles.eventTitle}>{pe.title}</Text>
                </View>
                {pe.endDate && pe.endDate !== pe.date && (
                  <Text style={styles.periodText}>
                    期間: {pe.date} 〜 {pe.endDate}
                  </Text>
                )}
                {pe.memo ? (
                  <Text style={styles.eventMemoText}>{pe.memo}</Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.detailSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionSubtitle}>
              📝 振り返り ({selectedEvents.reports.length})
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate("Diary")}>
              <Text style={styles.jumpLink}>一覧を見る ＞</Text>
            </TouchableOpacity>
          </View>
          {selectedEvents.reports.length === 0 ? (
            <Text style={styles.emptyText}>記録はありません。</Text>
          ) : (
            selectedEvents.reports.map((r) => {
              const level = getAlertLevel(r);
              return (
                <View
                  key={r.id}
                  style={[
                    styles.reportCard,
                    level === "danger" && styles.dangerBorder,
                    level === "warning" && styles.warningBorder,
                  ]}
                >
                  <Text style={styles.reportAuthor}>👤 {r.author}</Text>
                  <Text style={styles.reportText}>
                    練習: {r.practiceContent || "未入力"}
                  </Text>
                </View>
              );
            })
          )}
        </View>
        <View style={{ height: 50 }} />
      </ScrollView>

      {/* --- 部活の予定モーダル --- */}
      <Modal visible={isEventModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingEventId ? "予定の編集" : "新しい予定を追加"}
              </Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>予定のタイトル</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 春季大会"
                value={eventTitle}
                onChangeText={setEventTitle}
              />

              <Text style={styles.label}>日程 (開始日: {selectedDate})</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    !isEventMultiDay && styles.typeBtnActive,
                  ]}
                  onPress={() => {
                    setIsEventMultiDay(false);
                    setEventEndDate(selectedDate);
                  }}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      !isEventMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    当日のみ
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    isEventMultiDay && styles.typeBtnActive,
                  ]}
                  onPress={() => setIsEventMultiDay(true)}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      isEventMultiDay && styles.typeBtnTextActive,
                    ]}
                  >
                    複数日
                  </Text>
                </TouchableOpacity>
              </View>

              {isEventMultiDay && (
                <View style={styles.dateAdjusterContainer}>
                  <Text style={styles.subLabel}>終了日を指定</Text>
                  <View style={styles.dateAdjusterRow}>
                    <TouchableOpacity
                      style={styles.dateAdjustBtn}
                      onPress={() =>
                        adjustEndDate(setEventEndDate, eventEndDate, -1)
                      }
                    >
                      <Text style={styles.dateAdjustBtnText}>◀</Text>
                    </TouchableOpacity>
                    <Text style={styles.dateAdjustValue}>{eventEndDate}</Text>
                    <TouchableOpacity
                      style={styles.dateAdjustBtn}
                      onPress={() =>
                        adjustEndDate(setEventEndDate, eventEndDate, 1)
                      }
                    >
                      <Text style={styles.dateAdjustBtnText}>▶</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <Text style={styles.label}>種類</Text>
              <View style={styles.typeContainer}>
                {["試合", "練習", "その他"].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.typeBtn,
                      eventType === t && styles.typeBtnActive,
                    ]}
                    onPress={() => setEventType(t)}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        eventType === t && styles.typeBtnTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>備考欄</Text>
              <TextInput
                style={styles.inputMulti}
                value={eventMemo}
                onChangeText={setEventMemo}
                multiline
              />

              <View style={styles.modalButtons}>
                {editingEventId && (
                  <TouchableOpacity
                    style={[
                      styles.submitBtn,
                      { backgroundColor: "#e74c3c", marginRight: "auto" },
                    ]}
                    onPress={handleDeleteEvent}
                  >
                    <Text style={styles.submitBtnText}>削除</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsEventModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={handleSaveEvent}
                >
                  <Text style={styles.submitBtnText}>保存する</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* --- 個人の予定モーダル --- */}
      <Modal visible={isPersonalModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingPersonalId ? "個人の予定を編集" : "個人の予定を追加"}
              </Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>予定のタイトル</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 塾、通院"
                value={personalTitle}
                onChangeText={setPersonalTitle}
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
                  onPress={() => setIsPersonalMultiDay(true)}
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

              {isPersonalMultiDay && (
                <View style={styles.dateAdjusterContainer}>
                  <Text style={styles.subLabel}>終了日を指定</Text>
                  <View style={styles.dateAdjusterRow}>
                    <TouchableOpacity
                      style={styles.dateAdjustBtn}
                      onPress={() =>
                        adjustEndDate(setPersonalEndDate, personalEndDate, -1)
                      }
                    >
                      <Text style={styles.dateAdjustBtnText}>◀</Text>
                    </TouchableOpacity>
                    <Text style={styles.dateAdjustValue}>
                      {personalEndDate}
                    </Text>
                    <TouchableOpacity
                      style={styles.dateAdjustBtn}
                      onPress={() =>
                        adjustEndDate(setPersonalEndDate, personalEndDate, 1)
                      }
                    >
                      <Text style={styles.dateAdjustBtnText}>▶</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <Text style={styles.label}>メモ</Text>
              <TextInput
                style={styles.inputMulti}
                value={personalMemo}
                onChangeText={setPersonalMemo}
                multiline
              />

              <View style={styles.modalButtons}>
                {editingPersonalId && (
                  <TouchableOpacity
                    style={[
                      styles.submitBtn,
                      { backgroundColor: "#e74c3c", marginRight: "auto" },
                    ]}
                    onPress={handleDeletePersonal}
                  >
                    <Text style={styles.submitBtnText}>削除</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsPersonalModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: "#9b59b6" }]}
                  onPress={handleSavePersonal}
                >
                  <Text style={styles.submitBtnText}>保存する</Text>
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
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#34495e",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backButton: { width: 60 },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  content: { padding: 15 },
  calendarControl: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    elevation: 1,
  },
  arrowBtn: { paddingHorizontal: 15, paddingVertical: 5 },
  arrowText: { fontSize: 18, color: "#34495e", fontWeight: "bold" },
  monthTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  weekRow: { flexDirection: "row", marginBottom: 5 },
  weekText: {
    flex: 1,
    textAlign: "center",
    fontWeight: "bold",
    color: "#555",
    fontSize: 12,
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 10,
    elevation: 1,
  },
  dayCell: {
    width: "14.28%",
    height: 55,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: 8,
  },
  dayCellSelected: { backgroundColor: "#e8f0fe", borderColor: "#3498db" },
  dayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  dayCircleToday: { backgroundColor: "#34495e" },
  dayText: { fontSize: 14, color: "#333", fontWeight: "bold" },
  markerRow: { flexDirection: "row", marginTop: 2, height: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, marginHorizontal: 2 },
  divider: { height: 1, backgroundColor: "#ddd", marginVertical: 20 },
  detailTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
  },
  detailSection: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionSubtitle: { fontSize: 15, fontWeight: "bold", color: "#2c3e50" },
  jumpLink: { fontSize: 14, color: "#3498db", fontWeight: "bold", padding: 5 },
  emptyText: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    marginVertical: 10,
  },
  eventCard: {
    backgroundColor: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#3498db",
  },
  personalEventCard: {
    backgroundColor: "#fcf9ff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#9b59b6",
  },
  eventCardHeader: { flexDirection: "row", alignItems: "center" },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 10,
  },
  badgeMatch: { backgroundColor: "#ffeaa7" },
  badgePractice: { backgroundColor: "#dff9fb" },
  badgeOther: { backgroundColor: "#e0e0e0" },
  badgePersonal: {
    backgroundColor: "#9b59b6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 10,
  },
  badgeText: { fontSize: 10, fontWeight: "bold", color: "#333" },
  eventTitle: { fontSize: 14, color: "#333", fontWeight: "bold", flex: 1 },
  periodText: {
    fontSize: 11,
    color: "#0077cc",
    marginTop: 4,
    fontWeight: "bold",
  },
  eventMemoText: { fontSize: 13, color: "#666", marginTop: 8, marginLeft: 2 },
  reportCard: {
    backgroundColor: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#2ecc71",
  },
  dangerBorder: { borderLeftColor: "#e74c3c", backgroundColor: "#fff5f5" },
  warningBorder: { borderLeftColor: "#f39c12", backgroundColor: "#fffdf5" },
  reportAuthor: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  reportText: { fontSize: 12, color: "#555", marginTop: 2 },
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
  subLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#888",
    marginBottom: 5,
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
  inputMulti: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: "top",
    marginBottom: 10,
  },
  typeContainer: { flexDirection: "row", marginBottom: 10 },
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
  typeBtnActive: { backgroundColor: "#e6f2ff", borderColor: "#3498db" },
  typeBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  typeBtnTextActive: { color: "#3498db" },

  dateAdjusterContainer: {
    backgroundColor: "#fdfdfd",
    padding: 15,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginBottom: 10,
    alignItems: "center",
  },
  dateAdjusterRow: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  dateAdjustBtn: {
    backgroundColor: "#f0f0f0",
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    marginHorizontal: 15,
  },
  dateAdjustBtnText: { fontSize: 18, fontWeight: "bold", color: "#333" },
  dateAdjustValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#3498db",
    minWidth: 120,
    textAlign: "center",
  },

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
});

export default CalendarScreen;
