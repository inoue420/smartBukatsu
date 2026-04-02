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

const CalendarScreen = ({
  navigation,
  isAdmin,
  currentUser,
  projects,
  setProjects,
  dailyReports,
  userProfiles = {},
  alertThresholds = {
    fatigueWarning: 7,
    fatigueDanger: 9,
    painDanger: 7,
    autoEscalate: true,
  },
}) => {
  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole = isAdmin ? "owner" : currentUserProfile.role || "member";
  const isStaffOrAbove = ["owner", "staff"].includes(userRole);
  const staffScope = currentUserProfile.staffScope || "all";

  // 今日の日付を取得
  const today = new Date();
  const todayString = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

  const [currentMonth, setCurrentMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = useState(todayString);

  // === 予定（イベント）追加・編集用のステート ===
  const [isEventModalVisible, setIsEventModalVisible] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [eventTitle, setEventTitle] = useState("");
  const [eventType, setEventType] = useState("練習");
  const [eventParticipants, setEventParticipants] = useState("team");
  // ★追加：備考欄用のステート
  const [eventMemo, setEventMemo] = useState("");

  // カレンダー移動処理
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

  // アラートレベル判定
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

  // 表示権限に基づくデータフィルタリング
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
    if (["member", "captain"].includes(userRole))
      return d.author === currentUser;
    return false;
  });

  // 日付ごとのイベントマッピング
  const eventsMap = {};
  visibleProjects.forEach((p) => {
    if (!eventsMap[p.date]) eventsMap[p.date] = { projects: [], reports: [] };
    eventsMap[p.date].projects.push(p);
  });
  visibleReports.forEach((r) => {
    if (!eventsMap[r.date]) eventsMap[r.date] = { projects: [], reports: [] };
    eventsMap[r.date].reports.push(r);
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
  };

  // === 予定の操作ロジック ===
  const openEventModal = (event = null) => {
    if (event) {
      setEditingEventId(event.id);
      setEventTitle(event.title);
      setEventType(event.type);
      setEventParticipants(event.participants);
      setEventMemo(event.memo || ""); // ★追加：既存の備考欄を読み込み
    } else {
      setEditingEventId(null);
      setEventTitle("");
      setEventType("練習");
      setEventParticipants("team");
      setEventMemo(""); // ★追加：リセット
    }
    setIsEventModalVisible(true);
  };

  const handleSaveEvent = () => {
    if (eventTitle.trim() === "") {
      Alert.alert("エラー", "予定のタイトルを入力してください。");
      return;
    }

    if (editingEventId) {
      setProjects(
        projects.map((p) =>
          p.id === editingEventId
            ? {
                ...p,
                title: eventTitle,
                type: eventType,
                participants: eventParticipants,
                memo: eventMemo,
              } // ★追加：memoを保存
            : p,
        ),
      );
    } else {
      const newEvent = {
        id: "p_" + Date.now().toString(),
        title: eventTitle,
        date: selectedDate, // 選択中の日付に登録
        type: eventType,
        status: "active",
        participants: eventParticipants,
        pinned: false,
        memo: eventMemo, // ★追加：memoを保存
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
              p.id === editingEventId
                ? {
                    ...p,
                    status: "deleted",
                    deletedBy: userRole,
                    deletedAt: new Date().toISOString(),
                  }
                : p,
            ),
          );
          setIsEventModalVisible(false);
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
        {/* カレンダーコントロール */}
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

        {/* 曜日ヘッダー */}
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

        {/* 日付グリッド */}
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
            };

            // アラートのサマリー
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
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.divider} />

        {/* 選択日の詳細エリア */}
        <Text style={styles.detailTitle}>{selectedDate} の予定・記録</Text>

        {/* 部活の予定エリア */}
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
                onPress={() => {
                  if (["owner", "staff", "captain"].includes(userRole)) {
                    openEventModal(p);
                  }
                }}
                activeOpacity={0.7}
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
                  {["owner", "staff", "captain"].includes(userRole) && (
                    <Text style={{ fontSize: 16, color: "#888" }}>✏️</Text>
                  )}
                </View>
                {/* ★追加：備考欄がある場合のみ表示 */}
                {p.memo ? (
                  <Text style={styles.eventMemoText}>{p.memo}</Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* 振り返りエリア */}
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

                  {r.condition && (
                    <Text style={styles.reportText}>
                      体調: {r.condition} / 疲労度: {r.fatigue}
                      {r.hasPain && (
                        <Text style={{ color: "#e74c3c" }}> / ケガあり</Text>
                      )}
                    </Text>
                  )}
                  <Text style={styles.reportText} numberOfLines={1}>
                    練習: {r.practiceContent || "未入力"}
                  </Text>
                </View>
              );
            })
          )}
        </View>
        <View style={{ height: 50 }} />
      </ScrollView>

      {/* カレンダー用 予定追加・編集モーダル */}
      <Modal
        visible={isEventModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingEventId ? "予定の編集" : "新しい予定を追加"}
              </Text>
              <Text style={styles.modalDateText}>📅 {selectedDate}</Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>予定のタイトル</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 春季大会 1回戦"
                value={eventTitle}
                onChangeText={setEventTitle}
                autoFocus={!editingEventId}
              />

              <Text style={styles.label}>種類</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    eventType === "試合" && styles.typeBtnActive,
                  ]}
                  onPress={() => setEventType("試合")}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      eventType === "試合" && styles.typeBtnTextActive,
                    ]}
                  >
                    試合
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    eventType === "練習" && styles.typeBtnActive,
                  ]}
                  onPress={() => setEventType("練習")}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      eventType === "練習" && styles.typeBtnTextActive,
                    ]}
                  >
                    練習
                  </Text>
                </TouchableOpacity>
                {/* ★変更：OFFからその他に変更 */}
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    eventType === "その他" && styles.typeBtnActive,
                  ]}
                  onPress={() => setEventType("その他")}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      eventType === "その他" && styles.typeBtnTextActive,
                    ]}
                  >
                    その他
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>共有範囲</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    eventParticipants === "team" && styles.typeBtnActive,
                  ]}
                  onPress={() => setEventParticipants("team")}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      eventParticipants === "team" && styles.typeBtnTextActive,
                    ]}
                  >
                    全体
                  </Text>
                </TouchableOpacity>
                {isStaffOrAbove && (
                  <TouchableOpacity
                    style={[
                      styles.typeBtn,
                      eventParticipants === "coach" && styles.typeBtnActive,
                    ]}
                    onPress={() => setEventParticipants("coach")}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        eventParticipants === "coach" &&
                          styles.typeBtnTextActive,
                      ]}
                    >
                      指導者のみ
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ★追加：備考欄入力 */}
              <Text style={styles.label}>備考欄 (任意)</Text>
              <TextInput
                style={styles.inputMulti}
                placeholder="場所や時間、持ち物など..."
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
  eventCardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 10,
  },
  badgeMatch: { backgroundColor: "#ffeaa7" },
  badgePractice: { backgroundColor: "#dff9fb" },
  badgeOther: { backgroundColor: "#e0e0e0" }, // ★追加：その他の色
  badgeText: { fontSize: 10, fontWeight: "bold", color: "#333" },
  eventTitle: { fontSize: 14, color: "#333", fontWeight: "bold", flex: 1 },
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
  modalDateText: { fontSize: 14, color: "#e74c3c", fontWeight: "bold" },
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
