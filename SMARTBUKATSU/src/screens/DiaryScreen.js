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
  Image,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

// ★ 追加：下書きをアプリ終了後も保持するためのライブラリ
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useAuth } from "../AuthContext";
import MedicalSafetyNotice from "../components/MedicalSafetyNotice";
import ZoomableImage from "../components/ZoomableImage";
import {
  createDailyReport,
  createWorkspacePost,
  updateDailyReport,
  deleteDailyReport,
  setUserBlocked,
  submitSafetyReport,
  validateUserContent,
} from "../services/firestoreService";
import {
  DEFAULT_ALERT_THRESHOLDS,
  getFatigueScore,
  getPainScore,
  MEDICAL_SCALE_DEFAULT,
  MEDICAL_SCALE_MAX,
  MEDICAL_SCALE_VALUES,
  MEDICAL_SCALE_VERSION,
  normalizeMedicalScaleValue,
} from "../utils/medicalScale";
import {
  getBlockedContentMessage,
  getContentWarningMessage,
  inspectUserContent,
  shouldUseLocalModerationFallback,
} from "../utils/contentModeration";
import {
  MAX_DAILY_REPORT_ATTACHMENTS,
  deleteDailyReportAttachments,
  getActiveDailyReportAttachments,
  prepareDailyReportImageAttachment,
  prepareDailyReportPdfAttachment,
  uploadDailyReportAttachment,
} from "../services/dailyReportAttachmentService";

const formatAttachmentSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.round(size / 1024)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
};

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
    {MEDICAL_SCALE_VALUES.map((num) => (
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

const AttachmentViewerOverlay = ({ attachment, onClose }) => {
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    setIsZoomed(false);
  }, [attachment?.id]);

  if (!attachment) return null;
  return (
    <View style={styles.attachmentViewerOverlay}>
      <TouchableOpacity
        style={styles.attachmentViewerCloseBtn}
        onPress={onClose}
      >
        <Text style={styles.attachmentViewerCloseText}>閉じる</Text>
      </TouchableOpacity>
      <ZoomableImage
        uri={attachment.downloadUrl || attachment.localUri}
        style={styles.attachmentViewerImage}
        onZoomChange={setIsZoomed}
      />
      {!isZoomed ? (
        <>
          <Text style={styles.attachmentViewerHint}>
            2本指で拡大・縮小、拡大後は1本指で移動できます
          </Text>
          <Text style={styles.attachmentViewerName} numberOfLines={2}>
            {attachment.name || ""}
          </Text>
        </>
      ) : null}
    </View>
  );
};

const getTodayString = () => {
  const today = new Date();
  return `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
};

const REPORT_REASONS = [
  { value: "harassment_bullying", label: "いじめ・嫌がらせ・誹謗中傷" },
  { value: "threat_violence", label: "脅迫・暴力的な内容" },
  { value: "hate_discrimination", label: "差別的な内容" },
  { value: "sexual_inappropriate", label: "性的・不適切な内容" },
  { value: "impersonation_privacy", label: "なりすまし・個人情報侵害" },
  { value: "spam_fraud", label: "スパム・詐欺" },
  { value: "other", label: "その他" },
];

const DiaryScreen = ({
  navigation,
  route,
  isAdmin,
  currentUser,
  currentUserUid = "",
  isOffline,
  grades,
  positions,
  setPosts,
  userProfiles = {},
  dailyReports = [],
  setDailyReports,
  clubMembers = [],
  onDiarySubmitted,
  alertThresholds = DEFAULT_ALERT_THRESHOLDS,
}) => {
  const { activeTeamId, blockedUserUids = [] } = useAuth();
  const blockedUserUidSet = useMemo(
    () => new Set(blockedUserUids),
    [blockedUserUids],
  );

  const currentUserProfile =
    Object.values(userProfiles).find(
      (profile) => profile?.uid === currentUserUid,
    ) || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");
  const isStaffOrAbove = ["owner", "staff"].includes(userRole);

  const roleNameMap = {
    owner: "管理者(監督)",
    staff: "コーチ(スタッフ)",
    captain: `${currentUser}(キャプテン)`,
    member: `${currentUser}(あなた)`,
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [selectedReport, setSelectedReport] = useState(null);

  useEffect(() => {
    const reportId = route?.params?.reportId;
    if (!reportId) return;
    const targetReport = dailyReports.find((report) => report.id === reportId);
    if (!targetReport) return;
    setSelectedReport(targetReport);
    navigation.setParams({ reportId: undefined });
  }, [dailyReports, navigation, route?.params?.reportId]);
  const [commentText, setCommentText] = useState("");
  const [editingReportId, setEditingReportId] = useState(null);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [reportingComment, setReportingComment] = useState(null);
  const [reportSubject, setReportSubject] = useState("content");
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  const [isLoading, setIsLoading] = useState(false);

  const confirmContentForSubmission = async (content, contentType) => {
    const localInspection = inspectUserContent(content);
    if (localInspection.blocked) {
      Alert.alert(
        "送信できません",
        getBlockedContentMessage(localInspection),
      );
      return false;
    }

    let warnings = localInspection.warnings;
    if (!isOffline && activeTeamId) {
      try {
        const serverResult = await validateUserContent(
          activeTeamId,
          contentType,
          content,
        );
        warnings = [
          ...new Set([...(warnings || []), ...(serverResult?.warnings || [])]),
        ];
      } catch (error) {
        const blockedReasons = error?.details?.blockedReasons || [];
        if (
          error?.details?.reason === "content-blocked" ||
          blockedReasons.length > 0
        ) {
          Alert.alert(
            "送信できません",
            getBlockedContentMessage({ blockedReasons }),
          );
          return false;
        }
        if (shouldUseLocalModerationFallback(error)) {
          console.warn(
            "Remote content validation unavailable; local validation used:",
            error?.code || "unknown",
          );
        } else {
          Alert.alert(
            "内容を確認できませんでした",
            error?.code === "functions/unauthenticated"
              ? "ログイン状態を確認できませんでした。再度ログインしてお試しください。"
              : "安全確認に失敗しました。通信状態を確認し、時間をおいて再度お試しください。",
          );
          console.warn(
            "Remote content validation failed:",
            error?.code || "unknown",
          );
          return false;
        }
      }
    }

    if (warnings.length === 0) return true;
    return new Promise((resolve) => {
      Alert.alert("送信前の確認", getContentWarningMessage({ warnings }), [
        { text: "内容を見直す", style: "cancel", onPress: () => resolve(false) },
        { text: "確認して送信", onPress: () => resolve(true) },
      ]);
    });
  };

  // === 入力ステート ===
  const [reportDate, setReportDate] = useState(getTodayString());
  const [isDatePickerVisible, setIsDatePickerVisible] = useState(false);

  const [condition, setCondition] = useState("良い");
  const [fatigue, setFatigue] = useState(MEDICAL_SCALE_DEFAULT);
  const [isParticipating, setIsParticipating] = useState("通常");
  const [hasPain, setHasPain] = useState(false);
  const [painPart, setPainPart] = useState("");
  const [painLevel, setPainLevel] = useState(MEDICAL_SCALE_DEFAULT);
  const [sinceWhen, setSinceWhen] = useState("");
  const [treatment, setTreatment] = useState("");

  const [reflection, setReflection] = useState("");
  const [achievement, setAchievement] = useState(3);

  const [attachments, setAttachments] = useState([]);
  const [removedAttachments, setRemovedAttachments] = useState([]);
  const [viewingAttachment, setViewingAttachment] = useState(null);
  const [memo, setMemo] = useState("");
  const [highlightLink, setHighlightLink] = useState("");
  // ========================================

  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDates, setExpandedDates] = useState({});

  // ★ 追加：下書き保存用のキー（ユーザーごとに分ける）
  const DRAFT_KEY = `diary_draft_${currentUser}`;

  // ★ 追加：初回起動時に下書きデータを読み込む
  useEffect(() => {
    const loadDraft = async () => {
      try {
        const draftStr = await AsyncStorage.getItem(DRAFT_KEY);
        if (draftStr) {
          const draft = JSON.parse(draftStr);
          setReportDate(draft.reportDate || getTodayString());
          setCondition(draft.condition || "良い");
          setFatigue(
            normalizeMedicalScaleValue(
              draft.fatigue,
              draft.medicalScaleVersion,
            ),
          );
          setIsParticipating(draft.isParticipating || "通常");
          setHasPain(draft.hasPain || false);
          setPainPart(draft.painPart || "");
          setPainLevel(
            normalizeMedicalScaleValue(
              draft.painLevel,
              draft.medicalScaleVersion,
            ),
          );
          setSinceWhen(draft.sinceWhen || "");
          setTreatment(draft.treatment || "");
          setReflection(draft.reflection || "");
          setAchievement(
            draft.achievement !== undefined ? draft.achievement : 3,
          );
          setMemo(draft.memo || "");
        }
      } catch (error) {
        console.log("下書き読み込みエラー:", error);
      }
    };
    loadDraft();
  }, [DRAFT_KEY]);

  // ★ 追加：入力が変わるたびに自動で下書きを保存する
  useEffect(() => {
    if (editingReportId) return; // 過去の記録を修正中の場合は下書き上書きしない

    const saveDraft = async () => {
      const draft = {
        reportDate,
        condition,
        fatigue,
        medicalScaleVersion: MEDICAL_SCALE_VERSION,
        isParticipating,
        hasPain,
        painPart,
        painLevel,
        sinceWhen,
        treatment,
        reflection,
        achievement,
        memo,
      };
      try {
        await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch (error) {
        console.log("下書き保存エラー:", error);
      }
    };
    saveDraft();
  }, [
    reportDate,
    condition,
    fatigue,
    isParticipating,
    hasPain,
    painPart,
    painLevel,
    sinceWhen,
    treatment,
    reflection,
    achievement,
    memo,
    editingReportId,
    DRAFT_KEY,
  ]);

  const targetPlayers = useMemo(() => {
    const players = [];
    const baseList =
      clubMembers.length > 0 ? clubMembers : Object.keys(userProfiles);

    baseList.forEach((name) => {
      const role = userProfiles[name]?.role || "member";
      if (role === "member" || role === "captain") {
        players.push(name);
      }
    });
    return Array.from(new Set(players)).sort();
  }, [clubMembers, userProfiles]);

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
      getFatigueScore(record) >= alertThresholds.fatigueDanger ||
      (record.hasPain &&
        getPainScore(record) >= alertThresholds.painDanger)
    )
      return "danger";
    if (
      getFatigueScore(record) >= alertThresholds.fatigueWarning ||
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
          (d.reflection && d.reflection.toLowerCase().includes(lowerQ)),
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

  let displayDates = [...sortedDates];
  if (isStaffOrAbove && activeTab === "all" && searchQuery === "") {
    const todayStr = getTodayString();
    if (!displayDates.includes(todayStr)) {
      displayDates = [todayStr, ...displayDates];
    }
  }

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

  const updateReportStatusAsync = async (reportId, updates) => {
    try {
      const safeTeamId = activeTeamId || "test_team";
      if (!isOffline) {
        await updateDailyReport(safeTeamId, reportId, updates);
      }
    } catch (error) {
      console.log("Firestore更新エラー:", error);
    }
  };

  const handleToggleStar = (reportId) => {
    const report = dailyReports.find((d) => d.id === reportId);
    const newVal = !report?.isStarred;
    setDailyReports((prev) =>
      prev.map((d) => (d.id === reportId ? { ...d, isStarred: newVal } : d)),
    );
    if (selectedReport && selectedReport.id === reportId)
      setSelectedReport({ ...selectedReport, isStarred: newVal });
    updateReportStatusAsync(reportId, { isStarred: newVal });
  };

  const handleToggleFollowUp = (reportId) => {
    const report = dailyReports.find((d) => d.id === reportId);
    const newVal = !report?.isFollowUp;
    setDailyReports((prev) =>
      prev.map((d) => (d.id === reportId ? { ...d, isFollowUp: newVal } : d)),
    );
    if (selectedReport && selectedReport.id === reportId)
      setSelectedReport({ ...selectedReport, isFollowUp: newVal });
    updateReportStatusAsync(reportId, { isFollowUp: newVal });
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
            setDailyReports((prev) =>
              prev.map((d) =>
                d.id === reportId ? { ...d, sharedWith: "staff" } : d,
              ),
            );
            if (selectedReport && selectedReport.id === reportId)
              setSelectedReport({ ...selectedReport, sharedWith: "staff" });
            updateReportStatusAsync(reportId, { sharedWith: "staff" });
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
            onPress: async () => {
              const sharedContent = `📢 ${report.author} の振り返りを共有します！\n\n【振り返り】\n${report.reflection || "未入力"}\n\n※詳細は振り返り画面から確認できます。`;
              const canSubmit = await confirmContentForSubmission(
                sharedContent,
                "workspace_post",
              );
              if (!canSubmit) return;
              setDailyReports((prev) =>
                prev.map((d) =>
                  d.id === reportId ? { ...d, sharedWith: "all" } : d,
                ),
              );
              if (selectedReport && selectedReport.id === reportId)
                setSelectedReport({ ...selectedReport, sharedWith: "all" });

              updateReportStatusAsync(reportId, { sharedWith: "all" });

              const sharedPost = {
                id: "post_shared_" + Date.now().toString(),
                channel: "共有日記",
                user: displayUserName,
                authorUid: currentUserUid,
                content: sharedContent,
                time: "たった今",
                replyTo: null,
                reactions: {},
                attachments: [],
                replies: [],
                readCount: 0,
                isPinned: false,
                status: isOffline ? "pending" : "sent",
                createdAt: Date.now(),
              };
              setPosts((prevPosts) => [sharedPost, ...prevPosts]);
              if (activeTeamId && !isOffline) {
                createWorkspacePost(activeTeamId, sharedPost).catch((error) => {
                  console.log("共有振り返り投稿エラー:", error);
                  setPosts((prevPosts) =>
                    prevPosts.map((post) =>
                      post.id === sharedPost.id
                        ? { ...post, status: "pending" }
                        : post,
                    ),
                  );
                  Alert.alert(
                    "送信待ちにしました",
                    "共有振り返りを保存できませんでした。通信復旧後に掲示板から再送します。",
                  );
                });
              }
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
        onPress: async () => {
          resetForm();
          setIsCreateModalVisible(false);
          // ★追加：破棄した場合はストレージの下書きも完全に消去
          await AsyncStorage.removeItem(DRAFT_KEY);
        },
      },
    ]);
  };

  const resetForm = () => {
    setEditingReportId(null);
    setReportDate(getTodayString());
    setCondition("良い");
    setFatigue(MEDICAL_SCALE_DEFAULT);
    setIsParticipating("通常");
    setHasPain(false);
    setPainPart("");
    setPainLevel(MEDICAL_SCALE_DEFAULT);
    setSinceWhen("");
    setTreatment("");
    setReflection("");
    setAchievement(3);
    setAttachments([]);
    setRemovedAttachments([]);
    setViewingAttachment(null);
    setMemo("");
    setHighlightLink("");
  };

  const ensureAttachmentCapacity = () => {
    if (isOffline) {
      Alert.alert("通信エラー", "添付ファイルはオンライン時に追加してください。");
      return 0;
    }
    const remaining = MAX_DAILY_REPORT_ATTACHMENTS - attachments.length;
    if (remaining <= 0) {
      Alert.alert(
        "添付上限",
        "写真とPDFを合わせて、振り返り1件につき2ファイルまで添付できます。",
      );
      return 0;
    }
    return remaining;
  };

  const appendAttachments = (nextAttachments) => {
    setAttachments((current) =>
      [...current, ...nextAttachments].slice(0, MAX_DAILY_REPORT_ATTACHMENTS),
    );
  };

  const handlePickImages = async () => {
    const remaining = ensureAttachmentCapacity();
    if (!remaining) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: remaining > 1,
        selectionLimit: remaining,
        quality: 1,
      });
      if (result.canceled) return;

      const preparedAttachments = await Promise.all(
        (result.assets || [])
          .slice(0, remaining)
          .map((asset) => prepareDailyReportImageAttachment(asset)),
      );
      appendAttachments(preparedAttachments);
    } catch (error) {
      Alert.alert("写真エラー", error?.message || "写真を追加できませんでした。");
    }
  };

  const handlePickPdfs = async () => {
    const remaining = ensureAttachmentCapacity();
    if (!remaining) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: remaining > 1,
        base64: false,
      });
      if (result.canceled) return;

      appendAttachments(
        (result.assets || [])
          .slice(0, remaining)
          .map(prepareDailyReportPdfAttachment),
      );
    } catch (error) {
      Alert.alert("PDFエラー", error?.message || "PDFを追加できませんでした。");
    }
  };

  const handleRemoveAttachment = (attachment) => {
    setAttachments((current) =>
      current.filter((item) => item.id !== attachment.id),
    );
    if (!attachment.pending && attachment.storagePath) {
      setRemovedAttachments((current) =>
        current.some((item) => item.storagePath === attachment.storagePath)
          ? current
          : [...current, attachment],
      );
    }
  };

  const openAttachment = async (attachment) => {
    const attachmentUri = attachment?.downloadUrl || attachment?.localUri;
    if (!attachmentUri) return;
    if (attachment.type === "image") {
      setViewingAttachment(attachment);
      return;
    }
    if (attachment.pending) return;

    try {
      await Linking.openURL(attachmentUri);
    } catch (error) {
      Alert.alert("表示エラー", "PDFを開けませんでした。");
    }
  };

  const handleCreateOrEditReport = async () => {
    if (!reportDate.trim()) {
      Alert.alert("入力エラー", "対象日を選択してください。");
      return;
    }
    if (hasPain && !painPart.trim()) {
      Alert.alert("入力エラー", "痛む部位を入力してください。");
      return;
    }
    if (attachments.length > MAX_DAILY_REPORT_ATTACHMENTS) {
      Alert.alert(
        "添付上限",
        "写真とPDFを合わせて、振り返り1件につき2ファイルまで添付できます。",
      );
      return;
    }

    setIsLoading(true);
    const safeTeamId = activeTeamId || "test_team";
    const reportId = editingReportId || `rep_${Date.now().toString()}`;
    let uploadedAttachments = [];
    let attachmentCleanupFailed = false;

    try {
      const painDetailsData = hasPain
        ? { part: painPart, level: painLevel, sinceWhen, treatment }
        : null;

      const persistedAttachments = attachments.filter(
        (attachment) => !attachment.pending && attachment.downloadUrl,
      );
      if (!isOffline) {
        for (const attachment of attachments.filter(
          (item) => item.pending,
        )) {
          const uploadedAttachment = await uploadDailyReportAttachment({
            teamId: safeTeamId,
            authorUid: currentUserUid,
            reportId,
            attachment,
          });
          uploadedAttachments.push(uploadedAttachment);
        }
      }
      const nextAttachments = [...persistedAttachments, ...uploadedAttachments];

      if (editingReportId) {
        const updateData = {
          date: reportDate,
          condition,
          fatigue,
          medicalScaleVersion: MEDICAL_SCALE_VERSION,
          isParticipating,
          hasPain,
          painDetails: painDetailsData,
          reflection,
          achievement,
          attachments: nextAttachments,
          memo,
          highlightLink,
          status: isOffline ? "pending" : "sent",
        };

        const updated = dailyReports.map((r) => {
          if (r.id === editingReportId) return { ...r, ...updateData };
          return r;
        });

        if (!isOffline) {
          await updateDailyReport(safeTeamId, editingReportId, updateData);
          try {
            await deleteDailyReportAttachments(removedAttachments);
          } catch (error) {
            console.warn("削除済み添付のStorage削除エラー:", error);
            attachmentCleanupFailed = true;
          }
        }
        setDailyReports(updated);
        Alert.alert(
          attachmentCleanupFailed ? "修正完了（一部削除待ち）" : "修正完了",
          attachmentCleanupFailed
            ? "振り返りは修正されましたが、一部の添付ファイルをStorageから削除できませんでした。保持期限後の削除処理で再度削除されます。"
            : "振り返りを修正しました。",
        );
      } else {
        const newReport = {
          id: reportId,
          date: reportDate,
          author: currentUser,
          authorUid: currentUserUid,
          condition,
          fatigue,
          medicalScaleVersion: MEDICAL_SCALE_VERSION,
          isParticipating,
          hasPain,
          painDetails: painDetailsData,
          reflection,
          achievement,
          attachments: nextAttachments,
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

        if (!isOffline) {
          await createDailyReport(safeTeamId, newReport);
        }
        setDailyReports([newReport, ...dailyReports]);
        Alert.alert("提出完了", "振り返りを提出しました。", [
          {
            text: "OK",
            onPress: () => {
              if (!isOffline) onDiarySubmitted?.();
            },
          },
        ]);

        // ★ 追加：提出完了したら下書きを消去
        await AsyncStorage.removeItem(DRAFT_KEY);
      }
    } catch (error) {
      console.log("Firestore保存エラー:", error);
      if (uploadedAttachments.length > 0) {
        try {
          await deleteDailyReportAttachments(uploadedAttachments);
        } catch (cleanupError) {
          console.warn("保存失敗後の添付削除エラー:", cleanupError);
        }
      }
      Alert.alert("エラー", "データの保存に失敗しました。");
    } finally {
      setIsLoading(false);
      setIsCreateModalVisible(false);
      resetForm();
      Keyboard.dismiss();
    }
  };

  const handleOpenEdit = () => {
    if (!selectedReport) return;
    setEditingReportId(selectedReport.id);

    setReportDate(selectedReport.date || getTodayString());
    setCondition(selectedReport.condition || "良い");
    setFatigue(getFatigueScore(selectedReport));
    setIsParticipating(selectedReport.isParticipating || "通常");
    setHasPain(selectedReport.hasPain || false);
    if (selectedReport.painDetails) {
      setPainPart(selectedReport.painDetails.part || "");
      setPainLevel(getPainScore(selectedReport));
      setSinceWhen(selectedReport.painDetails.sinceWhen || "");
      setTreatment(selectedReport.painDetails.treatment || "");
    }

    setReflection(selectedReport.reflection || "");
    setAchievement(selectedReport.achievement || 3);

    setAttachments(getActiveDailyReportAttachments(selectedReport));
    setRemovedAttachments([]);
    setMemo(selectedReport.memo || "");
    setHighlightLink(selectedReport.highlightLink || "");

    setIsCreateModalVisible(true);
    setSelectedReport(null);
  };

  const handleDeleteReport = (report) => {
    const isMe = report.author === currentUser;
    Alert.alert(
      isMe ? "日報の削除" : "日報の強制削除",
      isMe
        ? "この日報を削除しますか？\n（この操作は取り消せません）"
        : `${report.author} の日報を完全に削除しますか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: async () => {
            const reportId = report.id;
            setDailyReports((prev) =>
              prev.map((r) =>
                r.id === reportId ? { ...r, status: "deleted" } : r,
              ),
            );
            if (selectedReport && selectedReport.id === reportId) {
              setSelectedReport(null);
            }
            try {
              const safeTeamId = activeTeamId || "test_team";
              await deleteDailyReport(safeTeamId, reportId);
              try {
                await deleteDailyReportAttachments(
                  getActiveDailyReportAttachments(report),
                );
              } catch (attachmentError) {
                console.warn("日報添付削除エラー:", attachmentError);
                Alert.alert(
                  "一部削除エラー",
                  "振り返りは削除されましたが、一部の添付ファイルをStorageから削除できませんでした。保持期限後の削除処理で再度削除されます。",
                );
              }
            } catch (error) {
              console.log("Firestore削除エラー:", error);
            }
          },
        },
      ],
    );
  };

  const handleSendComment = async () => {
    if (commentText.trim() === "") return;
    const contentToSend = commentText.trim();
    const canSubmit = await confirmContentForSubmission(
      contentToSend,
      "daily_report_comment",
    );
    if (!canSubmit) return;
    setIsLoading(true);

    try {
      const newComment = {
        id: "c_" + Date.now().toString(),
        user: displayUserName,
        uid: currentUserUid,
        text: contentToSend,
        time: "たった今",
        status: isOffline ? "pending" : "sent",
      };

      const isStaffComment = isStaffOrAbove;
      const newComments = [...selectedReport.comments, newComment];

      const updated = dailyReports.map((r) => {
        if (r.id === selectedReport.id) {
          return {
            ...r,
            comments: newComments,
            isReviewed: isStaffComment ? true : r.isReviewed,
          };
        }
        return r;
      });
      setDailyReports(updated);

      setSelectedReport((prev) => ({
        ...prev,
        isReviewed: isStaffComment ? true : prev.isReviewed,
        comments: newComments,
      }));

      setCommentText("");
      Keyboard.dismiss();

      const safeTeamId = activeTeamId || "test_team";
      if (!isOffline) {
        await updateDailyReport(safeTeamId, selectedReport.id, {
          comments: newComments,
          isReviewed: isStaffComment ? true : selectedReport.isReviewed,
        });
      }
    } catch (e) {
      console.log("コメント送信エラー:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const closeReportModal = () => {
    if (isSubmittingReport) return;
    setIsReportModalVisible(false);
    setReportingComment(null);
    setReportSubject("content");
    setReportReason("");
    setReportDetails("");
  };

  const openCommentReportModal = (comment) => {
    if (!selectedReport?.id || !comment?.id) return;
    setReportingComment({
      dailyReportId: selectedReport.id,
      commentId: comment.id,
      targetUserUid: comment.uid || "",
    });
    setReportSubject("content");
    setReportReason("");
    setReportDetails("");
    setIsReportModalVisible(true);
  };

  const handleBlockReportingUser = () => {
    const targetUid = reportingComment?.targetUserUid;
    if (
      !targetUid ||
      targetUid === currentUserUid ||
      blockedUserUidSet.has(targetUid) ||
      !activeTeamId ||
      isOffline
    ) {
      if (isOffline) {
        Alert.alert("オフラインです", "ユーザーのブロックには通信が必要です。");
      }
      return;
    }
    Alert.alert(
      "ユーザーをブロック",
      "このコメントのユーザーをブロックしますか？\n\n投稿、返信、メンション通知、日報コメントが表示されなくなります。設定画面から解除できます。",
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "ブロックする",
          style: "destructive",
          onPress: async () => {
            setIsSubmittingReport(true);
            try {
              await setUserBlocked(activeTeamId, targetUid, true);
              setIsReportModalVisible(false);
              setReportingComment(null);
              Alert.alert("ブロックしました", "設定画面からいつでも解除できます。");
            } catch (error) {
              Alert.alert(
                "ブロックできませんでした",
                error?.message || "通信状態を確認してください。",
              );
            } finally {
              setIsSubmittingReport(false);
            }
          },
        },
      ],
    );
  };

  const submitCommentReport = async () => {
    if (isOffline) {
      Alert.alert("エラー", "オフライン時は使用できません。");
      return;
    }
    if (!activeTeamId || !reportingComment || !reportReason) {
      Alert.alert("入力確認", "通報理由を選択してください。");
      return;
    }

    setIsSubmittingReport(true);
    try {
      await submitSafetyReport({
        teamId: activeTeamId,
        targetType: "daily_report_comment",
        reportSubject,
        reason: reportReason,
        details: reportDetails,
        dailyReportId: reportingComment.dailyReportId,
        commentId: reportingComment.commentId,
      });
      setIsReportModalVisible(false);
      setReportingComment(null);
      setReportSubject("content");
      setReportReason("");
      setReportDetails("");
      Alert.alert(
        "通報を受け付けました",
        "運営が内容を確認します。緊急の危険がある場合は、保護者・所属団体責任者・警察等の適切な窓口にも連絡してください。",
      );
    } catch (error) {
      console.log("日報コメント通報エラー:", error);
      Alert.alert(
        "通報できませんでした",
        error?.message || "通信状態を確認し、時間をおいて再度お試しください。",
      );
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleMarkAsReviewed = () => {
    const updated = dailyReports.map((r) => {
      if (r.id === selectedReport.id) return { ...r, isReviewed: true };
      return r;
    });
    setDailyReports(updated);
    setSelectedReport((prev) => ({ ...prev, isReviewed: true }));
    updateReportStatusAsync(selectedReport.id, { isReviewed: true });
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

  const recentDates = useMemo(() => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      let label = dateStr;
      if (i === 0) label += " (今日)";
      else if (i === 1) label += " (昨日)";
      dates.push({ value: dateStr, label });
    }
    if (reportDate && !dates.some((d) => d.value === reportDate)) {
      dates.unshift({
        value: reportDate,
        label: `${reportDate} (記録時の日付)`,
      });
    }
    return dates;
  }, [reportDate]);

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
        {isStaffOrAbove && activeTab === "danger" && (
          <MedicalSafetyNotice variant="alert" />
        )}
        {displayDates.length === 0 ? (
          <Text style={styles.emptyText}>データがありません。</Text>
        ) : (
          displayDates.map((date, index) => {
            const reportsInDate = groupedReports[date] || [];
            const expanded = isExpanded(date, index);
            const hasUnreviewed = reportsInDate.some((d) => !d.isReviewed);

            let membersToRender = [];
            if (isStaffOrAbove && activeTab === "all" && searchQuery === "") {
              const actualSubmitters = reportsInDate.map((r) => r.author);
              membersToRender = Array.from(
                new Set([...targetPlayers, ...actualSubmitters]),
              );
            } else {
              membersToRender = Array.from(
                new Set(reportsInDate.map((r) => r.author)),
              );
            }

            return (
              <View key={date} style={styles.dateGroupContainer}>
                <TouchableOpacity
                  style={styles.dateHeader}
                  onPress={() => toggleDate(date, index)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dateHeaderText}>
                    {expanded ? "▼" : "▶"} {date}
                    {isStaffOrAbove &&
                      ` ── [ 提出 ${reportsInDate.length} / ${targetPlayers.length} 名 ]`}
                  </Text>
                  {hasUnreviewed && isStaffOrAbove && (
                    <View style={styles.unreadAlertBadge}>
                      <Text style={styles.unreadAlertBadgeText}>未確認</Text>
                    </View>
                  )}
                </TouchableOpacity>

                {expanded &&
                  (isStaffOrAbove ? (
                    <View style={styles.memberList}>
                      {membersToRender.map((memberName) => {
                        const report = reportsInDate.find(
                          (r) => r.author === memberName,
                        );
                        const isMissing = !report;
                        const isReviewed = report?.isReviewed;
                        const alertLevel = report
                          ? getAlertLevel(report)
                          : "normal";

                        let tabStyle = styles.tabMissing;
                        let textStyle = styles.tabTextMissing;

                        if (!isMissing) {
                          if (isReviewed) {
                            tabStyle = styles.tabReviewed;
                            textStyle = styles.tabTextReviewed;
                          } else {
                            tabStyle = styles.tabSubmitted;
                            textStyle = styles.tabTextSubmitted;
                          }

                          if (alertLevel === "danger") {
                            tabStyle = [
                              tabStyle,
                              {
                                borderColor: "#c0392b",
                                backgroundColor: "#fff5f5",
                              },
                            ];
                            textStyle = [textStyle, { color: "#c0392b" }];
                          } else if (alertLevel === "warning") {
                            tabStyle = [
                              tabStyle,
                              {
                                borderColor: "#f39c12",
                                backgroundColor: "#fffdf5",
                              },
                            ];
                            textStyle = [textStyle, { color: "#f39c12" }];
                          }
                        }

                        return (
                          <TouchableOpacity
                            key={memberName}
                            style={[styles.compactRow, tabStyle]}
                            activeOpacity={0.7}
                            onPress={() => {
                              if (report) {
                                setSelectedReport(report);
                              } else {
                                Alert.alert(
                                  "未提出",
                                  `${memberName} はこの日の振り返りをまだ提出していません。`,
                                );
                              }
                            }}
                            onLongPress={() => {
                              if (report) handleDeleteReport(report);
                            }}
                            delayLongPress={500}
                          >
                            <View style={styles.compactRowLeft}>
                              <Text
                                style={[styles.compactRowText, textStyle]}
                                numberOfLines={1}
                              >
                                👤 {memberName}
                              </Text>
                              {!isMissing && report.comments?.length > 0 && (
                                <Text style={styles.compactCommentCount}>
                                  💬 {report.comments.length}
                                </Text>
                              )}
                            </View>

                            {isMissing ? (
                              <Text style={styles.missingBadgeText}>
                                未提出
                              </Text>
                            ) : (
                              <View style={styles.compactRowIcons}>
                                {report.hasPain && (
                                  <Text style={styles.miniIcon}>🤕</Text>
                                )}
                                {report.sharedWith === "all" && (
                                  <Text style={styles.miniIcon}>📢</Text>
                                )}
                                {report.isStarred && (
                                  <Text style={styles.miniIcon}>⭐</Text>
                                )}
                                {isReviewed ? (
                                  <Text style={styles.miniIcon}>✅</Text>
                                ) : (
                                  <View style={styles.badgeUnreviewedMini}>
                                    <Text
                                      style={styles.badgeUnreviewedMiniText}
                                    >
                                      未確認
                                    </Text>
                                  </View>
                                )}
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <View>
                      {reportsInDate.map((report) => {
                        const alertLevel = getAlertLevel(report);
                        return (
                          <TouchableOpacity
                            key={report.id}
                            style={[
                              styles.card,
                              report.status === "pending" && styles.pendingCard,
                            ]}
                            activeOpacity={0.9}
                            onPress={() => setSelectedReport(report)}
                          >
                            <View style={styles.cardHeader}>
                              <Text style={styles.cardAuthorLarge}>
                                👤 自分
                              </Text>
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                }}
                              >
                                {report.sharedWith === "all" && (
                                  <Text style={styles.badgeShared}>
                                    📢 共有
                                  </Text>
                                )}
                                {report.isStarred && (
                                  <Text
                                    style={{ fontSize: 14, marginRight: 5 }}
                                  >
                                    ⭐
                                  </Text>
                                )}
                                {report.isReviewed ? (
                                  <Text style={styles.badgeReviewed}>✅</Text>
                                ) : (
                                  <Text style={styles.badgeUnreviewed}>
                                    未確認
                                  </Text>
                                )}
                              </View>
                            </View>

                            {report.condition && (
                              <View style={styles.miniMedicalRow}>
                                <Text style={styles.miniMedicalText}>
                                  体調: {report.condition}
                                </Text>
                                <Text style={styles.miniMedicalText}>
                                  疲労: {getFatigueScore(report)}/
                                  {MEDICAL_SCALE_MAX}
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
                              <Text style={styles.sectionLabel}>
                                📝 振り返り
                              </Text>
                              <Text
                                style={styles.sectionText}
                                numberOfLines={1}
                              >
                                {report.reflection || "（未入力）"}
                              </Text>
                            </View>

                            <Text style={styles.commentCountText}>
                              💬 やり取り：{report.comments?.length || 0}件
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
              </View>
            );
          })
        )}
      </ScrollView>

      {["member", "captain"].includes(userRole) && (
        <TouchableOpacity
          style={[styles.fab, isOffline && { backgroundColor: "#f39c12" }]}
          onPress={() => {
            setEditingReportId(null);
            setIsCreateModalVisible(true);
          }}
        >
          <Text style={styles.fabIcon}>＋</Text>
        </TouchableOpacity>
      )}

      {/* 詳細表示モーダル */}
      <Modal
        visible={selectedReport !== null && !isReportModalVisible}
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
                        ? "📌 フォロー中"
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
                  const timeElapsed =
                    Date.now() - (selectedReport.createdAt || Date.now());
                  const isEditable =
                    timeElapsed < 30 * 60 * 1000 && !selectedReport.isReviewed;
                  const reportAttachments =
                    getActiveDailyReportAttachments(selectedReport);

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
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                            }}
                          >
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
                              <View style={styles.editActionRow}>
                                <TouchableOpacity
                                  style={styles.editBtn}
                                  onPress={handleOpenEdit}
                                >
                                  <Text style={styles.editBtnText}>
                                    ✏️ 修正
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            )}
                          </View>
                        </View>

                        {/* 日記詳細エリア */}
                        <View style={styles.cardSection}>
                          <Text style={styles.sectionLabel}>📝 振り返り</Text>
                          <Text style={styles.sectionText}>
                            {selectedReport.reflection || "（未入力）"}
                          </Text>
                        </View>
                        <View style={styles.cardSection}>
                          <Text style={styles.sectionLabel}>
                            📈 今日の達成度
                          </Text>
                          {renderStars(selectedReport.achievement)}
                        </View>

                        {(selectedReport.memo ||
                          reportAttachments.length > 0 ||
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
                            {reportAttachments.length > 0 ? (
                              <>
                                <Text style={styles.attachmentTapHint}>
                                  画像をタップして拡大
                                </Text>
                                <ScrollView
                                  horizontal
                                  showsHorizontalScrollIndicator={false}
                                  style={styles.attachmentList}
                                >
                                  {reportAttachments.map((attachment) => (
                                    <TouchableOpacity
                                      key={attachment.id}
                                      style={styles.attachmentCard}
                                      onPress={() => openAttachment(attachment)}
                                    >
                                      {attachment.type === "image" ? (
                                        <Image
                                          source={{ uri: attachment.downloadUrl }}
                                          style={styles.attachmentImage}
                                        />
                                      ) : (
                                        <View style={styles.attachmentPdf}>
                                          <Text style={styles.attachmentPdfText}>
                                            PDF
                                          </Text>
                                        </View>
                                      )}
                                      <Text
                                        style={styles.attachmentName}
                                        numberOfLines={1}
                                      >
                                        {attachment.name}
                                      </Text>
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                              </>
                            ) : null}
                          </View>
                        )}

                        {/* メディカル詳細エリア */}
                        {selectedReport.condition && (
                          <View style={styles.medicalDetailBox}>
                            <MedicalSafetyNotice
                              variant={
                                getAlertLevel(selectedReport) === "danger"
                                  ? "alert"
                                  : "general"
                              }
                            />
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
                                  {getFatigueScore(selectedReport)} / {MEDICAL_SCALE_MAX}
                                </Text>
                              </View>
                              <View style={styles.gridItem}>
                                <Text style={styles.gridTitle}>
                                  今後の練習可否
                                </Text>
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
                                    (痛さ: {getPainScore(selectedReport)}/
                                    {MEDICAL_SCALE_MAX})
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
                        {(selectedReport.comments || [])
                          .filter(
                            (comment) =>
                              !comment.uid ||
                              !blockedUserUidSet.has(comment.uid),
                          )
                          .map((c) => {
                          const isMe = c.uid
                            ? c.uid === currentUserUid
                            : c.user === displayUserName;
                          return (
                            <TouchableOpacity
                              key={c.id}
                              activeOpacity={0.85}
                              delayLongPress={400}
                              onLongPress={() => openCommentReportModal(c)}
                              accessibilityLabel={`${c.user}のコメント。長押しで通報`}
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
                            </TouchableOpacity>
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
          <AttachmentViewerOverlay
            attachment={viewingAttachment}
            onClose={() => setViewingAttachment(null)}
          />
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
                  onPress={() => {
                    setIsCreateModalVisible(false);
                    if (editingReportId) {
                      resetForm();
                    } else {
                      setEditingReportId(null);
                    }
                  }}
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
                <Text style={[styles.inputLabel, { marginTop: 0 }]}>
                  📅 対象日
                </Text>
                <TouchableOpacity
                  style={[
                    styles.inputSingle,
                    {
                      backgroundColor: "#fff",
                      borderColor: "#27ae60",
                      borderWidth: 2,
                      justifyContent: "center",
                    },
                  ]}
                  onPress={() => setIsDatePickerVisible(true)}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      color: "#333",
                      fontWeight: "bold",
                      textAlign: "center",
                    }}
                  >
                    {reportDate} ▾
                  </Text>
                </TouchableOpacity>

                {!editingReportId && (
                  <Text style={styles.draftNotice}>
                    ※入力内容は自動で下書き保存されます。
                  </Text>
                )}

                {/* === 日記（振り返り）入力部分 === */}
                <View style={styles.formSection}>
                  <Text style={styles.formSectionTitle}>📝 練習の振り返り</Text>

                  <Text style={styles.inputLabel}>📝 振り返り</Text>
                  <TextInput
                    style={styles.inputMulti}
                    placeholder="今日の練習で気づいたこと、次に活かしたいことなど..."
                    value={reflection}
                    onChangeText={setReflection}
                    multiline
                  />

                  <Text style={styles.inputLabel}>
                    📈 今日の達成度・自己評価
                  </Text>
                  <View style={styles.ratingContainer}>
                    {renderStars(achievement, setAchievement)}
                    <Text style={styles.ratingText}>{achievement} / 5</Text>
                  </View>

                  <Text style={styles.inputLabel}>
                    📎 補足メモ・添付 (任意)
                  </Text>
                  <TextInput
                    style={styles.inputMulti}
                    placeholder="体調について気になること、自由なメモなど..."
                    value={memo}
                    onChangeText={setMemo}
                    multiline
                  />

                  <Text style={styles.inputLabel}>📎 写真・PDF</Text>
                  {attachments.map((attachment) => {
                    const previewUri =
                      attachment.downloadUrl || attachment.localUri;
                    return (
                      <TouchableOpacity
                        key={attachment.id}
                        style={styles.attachmentDraftRow}
                        onPress={() => {
                          if (attachment.type === "pdf" && attachment.pending) {
                            return;
                          }
                          openAttachment(attachment);
                        }}
                      >
                        <View style={styles.attachmentDraftPreview}>
                          {attachment.type === "image" && previewUri ? (
                            <Image
                              source={{ uri: previewUri }}
                              style={styles.attachmentDraftImage}
                            />
                          ) : (
                            <Text style={styles.attachmentDraftPdf}>PDF</Text>
                          )}
                        </View>
                        <View style={styles.attachmentDraftInfo}>
                          <Text
                            style={styles.attachmentDraftName}
                            numberOfLines={1}
                          >
                            {attachment.name}
                          </Text>
                          <Text style={styles.attachmentDraftStatus}>
                            {attachment.type === "image"
                              ? `${
                                  formatAttachmentSize(attachment.size)
                                    ? `${formatAttachmentSize(attachment.size)}・`
                                    : ""
                                }${
                                  attachment.pending
                                    ? "提出時にアップロード"
                                    : "アップロード済み"
                                }・タップして拡大`
                              : attachment.pending
                                ? "提出時にアップロード"
                                : "アップロード済み"}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.attachmentRemoveBtn}
                          onPress={(event) => {
                            event.stopPropagation();
                            handleRemoveAttachment(attachment);
                          }}
                        >
                          <Text style={styles.attachmentRemoveBtnText}>削除</Text>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                  <View style={styles.attachmentAddRow}>
                    <TouchableOpacity
                      style={[
                        styles.attachmentAddBtn,
                        isOffline && styles.attachmentAddBtnDisabled,
                      ]}
                      onPress={handlePickImages}
                    >
                      <Text style={styles.attachmentAddBtnText}>写真を追加</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.attachmentAddBtn,
                        isOffline && styles.attachmentAddBtnDisabled,
                      ]}
                      onPress={handlePickPdfs}
                    >
                      <Text style={styles.attachmentAddBtnText}>PDFを追加</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.attachmentHint}>
                    写真とPDFを合わせて2件まで・1件10MBまで。写真はアップロード時に自動でサイズ調整され、添付は1年間保持します。
                  </Text>
                </View>

                {/* === コンディション（メディカル）入力部分 === */}
                <View style={[styles.formSection, { marginTop: 20 }]}>
                  <Text style={styles.formSectionTitle}>🏥 コンディション</Text>
                  <MedicalSafetyNotice />
                  <Text style={styles.inputLabel}>😀 全体的な体調</Text>
                  <OptionGroup
                    options={["良い", "普通", "不良"]}
                    selected={condition}
                    onSelect={setCondition}
                    color="#2ecc71"
                  />

                  <Text style={styles.inputLabel}>
                    🔋 疲労度 (1:なし 〜 5:限界)
                  </Text>
                  <ScaleSelector
                    selected={fatigue}
                    onSelect={setFatigue}
                    color="#f39c12"
                  />

                  <Text style={styles.inputLabel}>🏃 今後の練習可否</Text>
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
                      <Text style={styles.subLabel}>痛みの強さ (1〜5)</Text>
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
                      : isOffline
                        ? "待機リストに保存"
                        : "この内容で1日の日報を提出する"}
                  </Text>
                </TouchableOpacity>
                <View style={{ height: 60 }} />
              </ScrollView>
            </View>

            {isDatePickerVisible && (
              <TouchableOpacity
                style={styles.datePickerOverlay}
                activeOpacity={1}
                onPress={() => setIsDatePickerVisible(false)}
              >
                <View style={styles.datePickerContent}>
                  <Text style={styles.datePickerTitle}>対象日を選択</Text>
                  <ScrollView style={styles.datePickerScroll}>
                    {recentDates.map((d) => (
                      <TouchableOpacity
                        key={d.value}
                        style={styles.dateOption}
                        onPress={() => {
                          setReportDate(d.value);
                          setIsDatePickerVisible(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.dateOptionText,
                            reportDate === d.value &&
                              styles.dateOptionTextActive,
                          ]}
                        >
                          {d.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                  <TouchableOpacity
                    style={styles.datePickerCloseBtn}
                    onPress={() => setIsDatePickerVisible(false)}
                  >
                    <Text style={styles.datePickerCloseText}>閉じる</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}
          </KeyboardAvoidingView>
          <AttachmentViewerOverlay
            attachment={viewingAttachment}
            onClose={() => setViewingAttachment(null)}
          />
        </SafeAreaView>
      </Modal>

      <Modal
        visible={isReportModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={closeReportModal}
      >
        <KeyboardAvoidingView
          style={styles.reportModalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.reportModalContent}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.reportModalTitle}>運営へ通報する</Text>
              <Text style={styles.reportHelpText}>
                長押ししたコメントと会話部分は、調査と安全対応のため通常データから分離して保全されます。日報の体調・痛みなどの項目は通報証拠へ複製されません。
              </Text>

              <Text style={styles.reportSectionLabel}>通報対象</Text>
              <View style={styles.reportSubjectRow}>
                <TouchableOpacity
                  style={[
                    styles.reportSubjectBtn,
                    reportSubject === "content" && styles.reportOptionSelected,
                  ]}
                  onPress={() => setReportSubject("content")}
                  disabled={isSubmittingReport}
                >
                  <Text style={styles.reportSubjectText}>コメント内容</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.reportSubjectBtn,
                    reportSubject === "user" && styles.reportOptionSelected,
                    (!reportingComment?.targetUserUid ||
                      reportingComment?.targetUserUid === currentUserUid) &&
                      styles.reportOptionDisabled,
                  ]}
                  onPress={() => setReportSubject("user")}
                  disabled={
                    isSubmittingReport ||
                    !reportingComment?.targetUserUid ||
                    reportingComment?.targetUserUid === currentUserUid
                  }
                >
                  <Text style={styles.reportSubjectText}>コメントしたユーザー</Text>
                </TouchableOpacity>
              </View>
              {(!reportingComment?.targetUserUid ||
                reportingComment?.targetUserUid === currentUserUid) && (
                <Text style={styles.reportHintText}>
                  ユーザー通報を利用できないため、必要な場合はコメント内容を通報してください。
                </Text>
              )}
              {reportingComment?.targetUserUid &&
                reportingComment.targetUserUid !== currentUserUid &&
                !blockedUserUidSet.has(reportingComment.targetUserUid) && (
                  <TouchableOpacity
                    style={[
                      styles.reportReasonBtn,
                      { borderColor: "#e74c3c", marginTop: 10 },
                    ]}
                    onPress={handleBlockReportingUser}
                    disabled={isSubmittingReport}
                  >
                    <Text
                      style={[styles.reportReasonText, { color: "#e74c3c" }]}
                    >
                      🚫 このユーザーをブロック
                    </Text>
                  </TouchableOpacity>
                )}

              <Text style={styles.reportSectionLabel}>理由</Text>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.value}
                  style={[
                    styles.reportReasonBtn,
                    reportReason === reason.value && styles.reportOptionSelected,
                  ]}
                  onPress={() => setReportReason(reason.value)}
                  disabled={isSubmittingReport}
                >
                  <Text style={styles.reportReasonText}>{reason.label}</Text>
                </TouchableOpacity>
              ))}

              <Text style={styles.reportSectionLabel}>補足（任意）</Text>
              <TextInput
                style={styles.reportDetailsInput}
                value={reportDetails}
                onChangeText={setReportDetails}
                placeholder="状況や運営に伝えたいことを入力してください"
                multiline
                maxLength={1000}
                editable={!isSubmittingReport}
              />
              <Text style={styles.reportCharacterCount}>
                {reportDetails.length}/1000
              </Text>

              <TouchableOpacity
                style={[
                  styles.reportSubmitBtn,
                  (!reportReason || isSubmittingReport) &&
                    styles.reportOptionDisabled,
                ]}
                onPress={submitCommentReport}
                disabled={!reportReason || isSubmittingReport}
              >
                {isSubmittingReport ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.reportSubmitText}>通報を送信</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.reportCancelBtn}
                onPress={closeReportModal}
                disabled={isSubmittingReport}
              >
                <Text style={styles.reportCancelText}>キャンセル</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {isLoading && (
        <View style={styles.globalLoadingOverlay}>
          <ActivityIndicator size="large" color="#27ae60" />
          <Text style={styles.globalLoadingText}>処理中...</Text>
        </View>
      )}
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

  memberList: {
    paddingHorizontal: 2,
  },
  compactRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
  },
  compactRowLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  compactRowText: {
    fontSize: 15,
    fontWeight: "bold",
  },
  compactCommentCount: {
    fontSize: 12,
    color: "#888",
    marginLeft: 8,
    fontWeight: "bold",
  },
  compactRowIcons: {
    flexDirection: "row",
    alignItems: "center",
  },
  miniIcon: {
    fontSize: 14,
    marginHorizontal: 3,
  },
  missingBadgeText: {
    fontSize: 12,
    color: "#aaa",
  },

  tabMissing: {
    backgroundColor: "#f9f9f9",
    borderColor: "#e0e0e0",
    elevation: 0,
  },
  tabTextMissing: { color: "#aaa" },
  tabSubmitted: {
    backgroundColor: "#e6f2ff",
    borderColor: "#0077cc",
  },
  tabTextSubmitted: { color: "#0077cc" },
  tabReviewed: {
    backgroundColor: "#e8f5e9",
    borderColor: "#27ae60",
  },
  tabTextReviewed: { color: "#27ae60" },
  badgeUnreviewedMini: {
    backgroundColor: "#fdf3f2",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 5,
  },
  badgeUnreviewedMiniText: {
    color: "#c0392b",
    fontSize: 10,
    fontWeight: "bold",
  },

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
  attachmentList: { marginTop: 10 },
  attachmentTapHint: { color: "#777", fontSize: 11, marginTop: 8 },
  attachmentCard: { width: 92, marginRight: 10 },
  attachmentImage: {
    width: 92,
    height: 70,
    borderRadius: 8,
    backgroundColor: "#e9ecef",
  },
  attachmentPdf: {
    width: 92,
    height: 70,
    borderRadius: 8,
    backgroundColor: "#e74c3c",
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentPdfText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  attachmentName: { fontSize: 11, color: "#555", marginTop: 4 },
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
  editActionRow: { flexDirection: "row", alignItems: "center" },
  editBtn: {
    backgroundColor: "#f39c12",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 15,
    marginTop: 5,
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
  attachmentDraftRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
    borderWidth: 1,
    borderColor: "#e1e4e8",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  attachmentDraftPreview: {
    width: 54,
    height: 46,
    borderRadius: 6,
    backgroundColor: "#e9ecef",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  attachmentDraftImage: { width: 54, height: 46 },
  attachmentDraftPdf: { color: "#c0392b", fontWeight: "bold", fontSize: 13 },
  attachmentDraftInfo: { flex: 1, marginHorizontal: 8 },
  attachmentDraftName: { fontSize: 13, color: "#333", fontWeight: "bold" },
  attachmentDraftStatus: { fontSize: 11, color: "#777", marginTop: 3 },
  attachmentRemoveBtn: {
    backgroundColor: "#fff0f0",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  attachmentRemoveBtnText: {
    color: "#c0392b",
    fontSize: 12,
    fontWeight: "bold",
  },
  attachmentAddRow: { flexDirection: "row", marginTop: 2 },
  attachmentAddBtn: {
    flex: 1,
    backgroundColor: "#e8f5e9",
    borderWidth: 1,
    borderColor: "#27ae60",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginRight: 8,
  },
  attachmentAddBtnDisabled: { opacity: 0.45 },
  attachmentAddBtnText: {
    color: "#218c53",
    fontSize: 13,
    fontWeight: "bold",
  },
  attachmentHint: {
    color: "#777",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
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
  draftNotice: {
    fontSize: 12,
    color: "#e67e22",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 10,
  },

  reportModalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  reportModalContent: {
    width: "100%",
    maxHeight: "90%",
    padding: 20,
    borderRadius: 14,
    backgroundColor: "#fff",
    elevation: 8,
  },
  reportModalTitle: {
    color: "#333",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  reportHelpText: {
    color: "#666",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 18,
  },
  reportSectionLabel: {
    color: "#333",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 8,
    marginTop: 4,
  },
  reportSubjectRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  reportSubjectBtn: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
  },
  reportSubjectText: {
    color: "#333",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
  },
  reportOptionSelected: {
    borderColor: "#e74c3c",
    backgroundColor: "#fff1f0",
  },
  reportOptionDisabled: { opacity: 0.45 },
  reportHintText: {
    color: "#666",
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  reportReasonBtn: {
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
    marginBottom: 8,
  },
  reportReasonText: {
    color: "#e74c3c",
    fontSize: 15,
    fontWeight: "bold",
  },
  reportDetailsInput: {
    minHeight: 100,
    padding: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#fff",
    color: "#333",
    textAlignVertical: "top",
  },
  reportCharacterCount: {
    color: "#666",
    fontSize: 11,
    textAlign: "right",
    marginTop: 4,
    marginBottom: 12,
  },
  reportSubmitBtn: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#e74c3c",
  },
  reportSubmitText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  reportCancelBtn: {
    alignItems: "center",
    padding: 10,
    marginTop: 10,
  },
  reportCancelText: { color: "#888", fontSize: 15, fontWeight: "bold" },

  attachmentViewerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 10000,
    elevation: 10000,
  },
  attachmentViewerCloseBtn: {
    position: "absolute",
    top: 55,
    right: 20,
    zIndex: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  attachmentViewerCloseText: { color: "#fff", fontWeight: "bold" },
  attachmentViewerImage: { width: "100%", height: "75%" },
  attachmentViewerHint: { color: "#ddd", fontSize: 12, marginTop: 10 },
  attachmentViewerName: { color: "#fff", fontSize: 14, marginTop: 12 },

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
    color: "#27ae60",
    fontWeight: "bold",
    fontSize: 16,
  },

  datePickerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  datePickerContent: {
    width: "80%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    maxHeight: "70%",
    elevation: 5,
  },
  datePickerTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 15,
    textAlign: "center",
  },
  datePickerScroll: {
    maxHeight: 300,
  },
  dateOption: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  dateOptionText: {
    fontSize: 16,
    color: "#555",
    textAlign: "center",
  },
  dateOptionTextActive: {
    color: "#27ae60",
    fontWeight: "bold",
  },
  datePickerCloseBtn: {
    marginTop: 15,
    backgroundColor: "#f0f2f5",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  datePickerCloseText: {
    color: "#555",
    fontWeight: "bold",
    fontSize: 14,
  },
});

export default DiaryScreen;
