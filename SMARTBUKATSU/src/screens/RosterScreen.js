import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ★ カラーパレット（他画面と統一）
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

const RosterScreen = ({
  navigation,
  isAdmin,
  currentUser,
  clubMembers = [],
  userProfiles = {},
  dailyReports = [],
  grades = [], // ★ 追加：設定から受け取る
  positions = [], // ★ 追加：設定から受け取る
}) => {
  // --- 権限の確認 ---
  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");
  const isStaffOrAbove = ["owner", "admin", "staff"].includes(userRole);

  const roleConfig = {
    owner: { label: "監督", color: "#e74c3c", bg: "#fceeea" },
    admin: { label: "管理者", color: "#e74c3c", bg: "#fceeea" },
    staff: { label: "コーチ", color: "#9b59b6", bg: "#f5eef8" },
    captain: { label: "キャプテン", color: "#e67e22", bg: "#fdf2e9" },
    member: { label: "部員", color: "#3498db", bg: "#ebf5fb" },
  };

  // --- 検索・フィルター用のステート ---
  const [searchQuery, setSearchQuery] = useState("");
  const [filterGrade, setFilterGrade] = useState("all");
  const [filterPosition, setFilterPosition] = useState("all");
  const [filterCondition, setFilterCondition] = useState("all"); // all, danger, warning

  // 選択されたユーザーの詳細モーダル用
  const [selectedUser, setSelectedUser] = useState(null);

  // --- データの事前計算 ---

  // 各メンバーの「最新の日報（コンディション）」を取得
  const latestReports = useMemo(() => {
    const reportsMap = {};
    // 日付と作成時間で降順（新しい順）にソート
    const sortedReports = [...dailyReports].sort(
      (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    );
    sortedReports.forEach((report) => {
      if (!reportsMap[report.author] && report.status !== "deleted") {
        reportsMap[report.author] = report;
      }
    });
    return reportsMap;
  }, [dailyReports]);

  // メンバーリストにプロフィールと最新レポートを結合し、フィルターを適用
  const processedMembers = useMemo(() => {
    let list = clubMembers.map((name) => {
      const profile = userProfiles[name] || {};
      const latestReport = latestReports[name] || null;

      // 簡易アラートレベル判定
      let alertLevel = "normal";
      if (latestReport) {
        if (
          latestReport.condition === "不良" ||
          latestReport.isParticipating === "不可" ||
          latestReport.fatigue >= 8 ||
          latestReport.hasPain
        ) {
          alertLevel = "danger";
        } else if (
          latestReport.fatigue >= 6 ||
          latestReport.isParticipating === "制限"
        ) {
          alertLevel = "warning";
        }
      }

      return {
        name,
        profile,
        latestReport,
        alertLevel,
      };
    });

    // フィルターの適用
    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    if (filterGrade !== "all") {
      list = list.filter((m) => m.profile.grade === filterGrade);
    }
    if (filterPosition !== "all") {
      list = list.filter((m) => m.profile.position === filterPosition);
    }
    if (filterCondition !== "all" && isStaffOrAbove) {
      if (filterCondition === "danger")
        list = list.filter((m) => m.alertLevel === "danger");
      if (filterCondition === "warning")
        list = list.filter(
          (m) => m.alertLevel === "warning" || m.alertLevel === "danger",
        );
    }

    // ソート: 役職順（監督・コーチが上）、その後に学年順、名前順
    const roleOrder = { owner: 1, admin: 2, staff: 3, captain: 4, member: 5 };
    list.sort((a, b) => {
      const roleA = roleOrder[a.profile.role || "member"];
      const roleB = roleOrder[b.profile.role || "member"];
      if (roleA !== roleB) return roleA - roleB;

      const gradeA = a.profile.grade || "";
      const gradeB = b.profile.grade || "";
      if (gradeA !== gradeB) return gradeB.localeCompare(gradeA); // 3年生→1年生の順

      return a.name.localeCompare(b.name);
    });

    return list;
  }, [
    clubMembers,
    userProfiles,
    latestReports,
    searchQuery,
    filterGrade,
    filterPosition,
    filterCondition,
    isStaffOrAbove,
  ]);

  // --- UIコンポーネント ---

  const renderFilterScroll = (options, selected, onSelect, prefix = "") => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.filterScroll}
    >
      <TouchableOpacity
        style={[
          styles.filterChip,
          selected === "all" && styles.filterChipActive,
        ]}
        onPress={() => onSelect("all")}
      >
        <Text
          style={[
            styles.filterChipText,
            selected === "all" && styles.filterChipTextActive,
          ]}
        >
          すべて
        </Text>
      </TouchableOpacity>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          style={[
            styles.filterChip,
            selected === opt && styles.filterChipActive,
          ]}
          onPress={() => onSelect(opt)}
        >
          <Text
            style={[
              styles.filterChipText,
              selected === opt && styles.filterChipTextActive,
            ]}
          >
            {prefix}
            {opt}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* ヘッダー */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>◁ ホーム</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          📖 選手名簿 ({processedMembers.length}名)
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* 検索・フィルターエリア */}
      <View style={styles.filterContainer}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="選手名で検索..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <View style={styles.filterRowWrapper}>
          <Text style={styles.filterLabel}>学年</Text>
          {/* ★ 直接 grades を渡す */}
          {renderFilterScroll(grades, filterGrade, setFilterGrade)}
        </View>

        <View style={styles.filterRowWrapper}>
          <Text style={styles.filterLabel}>ﾎﾟｼﾞｼｮﾝ</Text>
          {/* ★ 直接 positions を渡す */}
          {renderFilterScroll(positions, filterPosition, setFilterPosition)}
        </View>

        {isStaffOrAbove && (
          <View style={styles.filterRowWrapper}>
            <Text style={styles.filterLabel}>体調</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterScroll}
            >
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  filterCondition === "all" && styles.filterChipActive,
                ]}
                onPress={() => setFilterCondition("all")}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterCondition === "all" && styles.filterChipTextActive,
                  ]}
                >
                  すべて
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  filterCondition === "danger" && {
                    backgroundColor: COLORS.danger,
                    borderColor: COLORS.danger,
                  },
                ]}
                onPress={() => setFilterCondition("danger")}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterCondition === "danger" && { color: "#fff" },
                  ]}
                >
                  🚨 要注意(赤)のみ
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.filterChip,
                  filterCondition === "warning" && {
                    backgroundColor: COLORS.secondary,
                    borderColor: COLORS.secondary,
                  },
                ]}
                onPress={() => setFilterCondition("warning")}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterCondition === "warning" && { color: "#fff" },
                  ]}
                >
                  ⚠️ 疲労蓄積を含む
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </View>

      {/* 名簿リスト */}
      <ScrollView
        style={styles.listContainer}
        contentContainerStyle={{ paddingBottom: 50 }}
      >
        {processedMembers.length === 0 ? (
          <Text style={styles.emptyText}>
            該当するメンバーが見つかりません。
          </Text>
        ) : (
          processedMembers.map((member) => {
            const role = member.profile.role || "member";
            const roleData = roleConfig[role] || roleConfig.member;

            return (
              <TouchableOpacity
                key={member.name}
                style={[
                  styles.memberCard,
                  isStaffOrAbove &&
                    member.alertLevel === "danger" &&
                    styles.cardDanger,
                  isStaffOrAbove &&
                    member.alertLevel === "warning" &&
                    styles.cardWarning,
                ]}
                onPress={() => setSelectedUser(member)}
                activeOpacity={0.7}
              >
                <View style={styles.avatarBox}>
                  <Text style={styles.avatarText}>{member.name.charAt(0)}</Text>
                </View>

                <View style={styles.memberInfo}>
                  <View style={styles.nameRow}>
                    <Text style={styles.memberName}>{member.name}</Text>
                    <View
                      style={[
                        styles.roleBadge,
                        {
                          backgroundColor: roleData.bg,
                          borderColor: roleData.color,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleBadgeText,
                          { color: roleData.color },
                        ]}
                      >
                        {roleData.label}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.memberSubInfo}>
                    {member.profile.grade
                      ? `🎓 ${member.profile.grade}`
                      : "🎓 未設定"}{" "}
                    |{" "}
                    {member.profile.position
                      ? `⚾ ${member.profile.position}`
                      : "⚾ 未設定"}
                  </Text>

                  {/* 管理者向け：最新のコンディションサマリー */}
                  {isStaffOrAbove && member.latestReport && (
                    <View style={styles.medicalSummary}>
                      <Text style={styles.medicalDate}>
                        最新報告: {member.latestReport.date}
                      </Text>
                      <View style={styles.medicalMetrics}>
                        <Text style={styles.metricText}>
                          疲労: {member.latestReport.fatigue}/10
                        </Text>
                        <Text style={styles.metricText}>
                          体調: {member.latestReport.condition}
                        </Text>
                        <Text
                          style={[
                            styles.metricText,
                            member.latestReport.hasPain && {
                              color: COLORS.danger,
                              fontWeight: "bold",
                            },
                          ]}
                        >
                          ケガ: {member.latestReport.hasPain ? "あり" : "なし"}
                        </Text>
                      </View>
                    </View>
                  )}
                  {isStaffOrAbove && !member.latestReport && (
                    <Text style={styles.noReportText}>
                      ※日報の提出履歴がありません
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* 詳細プロフィールモーダル */}
      <Modal
        visible={selectedUser !== null}
        transparent={true}
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {selectedUser && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>プロフィール詳細</Text>
                  <TouchableOpacity onPress={() => setSelectedUser(null)}>
                    <Text style={styles.closeBtnText}>✕ 閉じる</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={styles.modalProfileTop}>
                    <View style={[styles.avatarBox, styles.avatarBoxLarge]}>
                      <Text style={[styles.avatarText, { fontSize: 32 }]}>
                        {selectedUser.name.charAt(0)}
                      </Text>
                    </View>
                    <Text style={styles.modalUserName}>
                      {selectedUser.name}
                    </Text>
                    <View
                      style={[
                        styles.roleBadge,
                        {
                          backgroundColor: (
                            roleConfig[selectedUser.profile.role || "member"] ||
                            roleConfig.member
                          ).bg,
                          borderColor: (
                            roleConfig[selectedUser.profile.role || "member"] ||
                            roleConfig.member
                          ).color,
                          marginTop: 10,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.roleBadgeText,
                          {
                            color: (
                              roleConfig[
                                selectedUser.profile.role || "member"
                              ] || roleConfig.member
                            ).color,
                            fontSize: 14,
                          },
                        ]}
                      >
                        {roleConfig[selectedUser.profile.role || "member"]
                          ?.label || "一般部員"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.detailSection}>
                    <Text style={styles.detailSectionTitle}>基本情報</Text>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>🎓 学年</Text>
                      <Text style={styles.detailValue}>
                        {selectedUser.profile.grade || "未設定"}
                      </Text>
                    </View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>⚾ ポジション</Text>
                      <Text style={styles.detailValue}>
                        {selectedUser.profile.position || "未設定"}
                      </Text>
                    </View>
                    <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
                      <Text style={styles.detailLabel}>👤 担当スタッフ</Text>
                      <Text style={styles.detailValue}>
                        {selectedUser.profile.assignedStaff || "未設定"}
                      </Text>
                    </View>
                  </View>

                  {isStaffOrAbove && selectedUser.latestReport && (
                    <View style={styles.detailSection}>
                      <Text style={styles.detailSectionTitle}>
                        🏥 最新のコンディション (
                        {selectedUser.latestReport.date})
                      </Text>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>全体的な体調</Text>
                        <Text style={styles.detailValue}>
                          {selectedUser.latestReport.condition}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>疲労度 (10段階)</Text>
                        <Text style={styles.detailValue}>
                          {selectedUser.latestReport.fatigue}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>睡眠時間</Text>
                        <Text style={styles.detailValue}>
                          {selectedUser.latestReport.sleep}
                        </Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>練習可否</Text>
                        <Text
                          style={[
                            styles.detailValue,
                            selectedUser.latestReport.isParticipating !==
                              "通常" && { color: COLORS.danger },
                          ]}
                        >
                          {selectedUser.latestReport.isParticipating}
                        </Text>
                      </View>
                      {selectedUser.latestReport.hasPain && (
                        <View style={styles.painAlertBox}>
                          <Text style={styles.painAlertTitle}>
                            🤕 ケガ・痛みの報告あり
                          </Text>
                          <Text style={styles.painAlertText}>
                            部位: {selectedUser.latestReport.painDetails?.part}
                          </Text>
                          <Text style={styles.painAlertText}>
                            痛みの強さ:{" "}
                            {selectedUser.latestReport.painDetails?.level}/10
                          </Text>
                          <Text style={styles.painAlertText}>
                            処置:{" "}
                            {selectedUser.latestReport.painDetails?.treatment ||
                              "なし"}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    height: 60,
    backgroundColor: COLORS.primary,
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

  filterContainer: {
    backgroundColor: "#fff",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchBox: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    marginBottom: 15,
    height: 40,
  },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 15 },

  filterRowWrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  filterLabel: {
    width: 60,
    fontSize: 13,
    fontWeight: "bold",
    color: COLORS.textSub,
  },
  filterScroll: { flex: 1 },
  filterChip: {
    backgroundColor: "#f5f5f5",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  filterChipActive: { backgroundColor: "#e6f2ff", borderColor: COLORS.primary },
  filterChipText: { fontSize: 12, color: COLORS.textSub, fontWeight: "bold" },
  filterChipTextActive: { color: COLORS.primary },

  listContainer: { flex: 1, padding: 15 },
  emptyText: {
    textAlign: "center",
    color: "#888",
    marginTop: 30,
    fontSize: 15,
  },

  memberCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 1,
    borderLeftWidth: 4,
    borderLeftColor: "transparent",
  },
  cardWarning: {
    borderLeftColor: COLORS.secondary,
    backgroundColor: "#fffdf5",
  },
  cardDanger: { borderLeftColor: COLORS.danger, backgroundColor: "#fff5f5" },

  avatarBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#d1e8ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },
  avatarText: { fontSize: 20, fontWeight: "bold", color: COLORS.primary },

  memberInfo: { flex: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  memberName: {
    fontSize: 16,
    fontWeight: "bold",
    color: COLORS.textMain,
    marginRight: 10,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  roleBadgeText: { fontSize: 10, fontWeight: "bold" },
  memberSubInfo: { fontSize: 13, color: COLORS.textSub, marginBottom: 8 },

  medicalSummary: {
    backgroundColor: "rgba(255,255,255,0.6)",
    padding: 8,
    borderRadius: 8,
    marginTop: 5,
    borderWidth: 1,
    borderColor: "#eee",
  },
  medicalDate: {
    fontSize: 11,
    color: "#888",
    marginBottom: 4,
    fontWeight: "bold",
  },
  medicalMetrics: { flexDirection: "row", justifyContent: "space-between" },
  metricText: { fontSize: 12, color: "#555" },
  noReportText: {
    fontSize: 11,
    color: "#aaa",
    fontStyle: "italic",
    marginTop: 5,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#f9f9f9",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "90%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: COLORS.textMain },
  closeBtnText: { fontSize: 15, color: COLORS.primary, fontWeight: "bold" },

  modalProfileTop: { alignItems: "center", marginBottom: 25 },
  avatarBoxLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginRight: 0,
    marginBottom: 10,
  },
  modalUserName: { fontSize: 22, fontWeight: "bold", color: COLORS.textMain },

  detailSection: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 15,
    elevation: 1,
  },
  detailSectionTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: COLORS.primary,
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 5,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  detailLabel: { fontSize: 14, color: COLORS.textSub, fontWeight: "bold" },
  detailValue: { fontSize: 14, color: COLORS.textMain, fontWeight: "bold" },

  painAlertBox: {
    marginTop: 15,
    backgroundColor: "#fff5f5",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffcccc",
  },
  painAlertTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: COLORS.danger,
    marginBottom: 8,
  },
  painAlertText: { fontSize: 13, color: "#555", marginBottom: 4 },
});

export default RosterScreen;
