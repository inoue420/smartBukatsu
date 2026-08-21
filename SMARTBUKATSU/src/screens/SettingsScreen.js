import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Modal,
  Clipboard,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { auth, db } from "../firebase";
import { doc, getDoc, updateDoc } from "firebase/firestore";

import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

import {
  getTeamInviteCode,
  subscribeTeamData,
  addTeamArrayItem,
  removeTeamArrayItem,
  updateMemberProfile,
  updateMemberRoleConfig,
  removeTeamMember,
  deleteTeam,
  updateTeamAdSettings,
} from "../services/firestoreService";
import {
  DEFAULT_INTERSTITIAL_SETTINGS,
  INTERSTITIAL_ADS_ENABLED,
  INTERSTITIAL_DAILY_LIMIT_MAX,
  INTERSTITIAL_DAILY_LIMIT_MIN,
  INTERSTITIAL_NAVIGATION_INTERVAL_MAX,
  INTERSTITIAL_NAVIGATION_INTERVAL_MIN,
  getTeamAdSettingsForSave,
  normalizeInterstitialSettings,
} from "../ads/adSettings";
import { MEDICAL_SCALE_MAX } from "../utils/medicalScale";


const ThresholdSelector = ({ label, value, min, max, onChange }) => (
  <View style={styles.thresholdRow}>
    <Text style={styles.thresholdLabel}>{label}</Text>
    <View style={styles.thresholdControl}>
      <TouchableOpacity
        style={styles.thresholdBtn}
        onPress={() => value > min && onChange(value - 1)}
      >
        <Text style={styles.thresholdBtnText}>-</Text>
      </TouchableOpacity>
      <Text style={styles.thresholdValue}>{value}</Text>
      <TouchableOpacity
        style={styles.thresholdBtn}
        onPress={() => value < max && onChange(value + 1)}
      >
        <Text style={styles.thresholdBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const SectionCard = ({ isExp, onToggle, title, children }) => (
  <View style={styles.card}>
    <TouchableOpacity
      style={[styles.cardHeader, isExp && styles.cardHeaderExpanded]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.chevron}>{isExp ? "▼" : "▶"}</Text>
    </TouchableOpacity>
    {isExp && <View style={styles.cardContent}>{children}</View>}
  </View>
);

const OptionSelector = ({ options, selected, onSelect }) => (
  <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 15 }}>
    {options.map((opt) => (
      <TouchableOpacity
        key={opt}
        style={[styles.optionBtn, selected === opt && styles.optionBtnActive]}
        onPress={() => onSelect(opt)}
      >
        <Text
          style={[
            styles.optionText,
            selected === opt && styles.optionTextActive,
          ]}
        >
          {opt}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

const SettingsScreen = ({
  navigation,
  isAdmin,
  currentUser,
  currentUserUid: currentUserUidProp = "",
  setCurrentUser,
  clubMembers = [],
  grades,
  positions,
  alertThresholds,
  setAlertThresholds,
  userProfiles = {},
  interstitialSettings = DEFAULT_INTERSTITIAL_SETTINGS,
  setInterstitialSettings,
  absenceDeadlineDaysBefore = 3,
  setAbsenceDeadlineDaysBefore,
  setUserProfiles,
}) => {
  const { activeTeamId, signOut, user } = useAuth();
  const [inviteCode, setInviteCode] = useState("読み込み中...");

  const currentUserUid =
    currentUserUidProp || user?.uid || auth.currentUser?.uid || "";
  const getMemberProfileByUid = (uid) =>
    Object.values(userProfiles).find((profile) => profile?.uid === uid) || {};
  const currentUserProfile = getMemberProfileByUid(currentUserUid);
  const currentMemberRole =
    currentUserProfile.role || (isAdmin ? "admin" : "member");
  const userRole = global.TEST_ROLE || currentMemberRole;
  const isSupervisor = ["owner", "admin"].includes(userRole);
  const isStaffOrAbove = ["owner", "staff", "admin"].includes(userRole);
  const canManageGuardianPermissions = isStaffOrAbove;

  useEffect(() => {
    if (!activeTeamId) return;

    let isMounted = true;
    const fetchInvite = async () => {
      if (isStaffOrAbove) {
        const code = await getTeamInviteCode(activeTeamId);
        if (isMounted) setInviteCode(code || "未発行");
      }
    };
    fetchInvite();

    return () => {
      isMounted = false;
    };
  }, [activeTeamId, isStaffOrAbove]);

  const [newGradeName, setNewGradeName] = useState("");
  const [newPositionName, setNewPositionName] = useState("");

  const [expanded, setExpanded] = useState({
    teamInfo: false,
    absence: false,
    alert: false,
    member: false,
    grade: false,
    ads: false,
    position: false,
    myProfile: false,
    myPassword: false,
  });

  const [myNewName, setMyNewName] = useState(currentUser);

  const [adSettingsDraft, setAdSettingsDraft] = useState(() =>
    normalizeInterstitialSettings(interstitialSettings),
  );
  const [isSavingAdSettings, setIsSavingAdSettings] = useState(false);
  const [isDeletingTeam, setIsDeletingTeam] = useState(false);
  const [absenceDeadlineDraft, setAbsenceDeadlineDraft] = useState(
    String(absenceDeadlineDaysBefore),
  );
  const [isSavingAbsenceDeadline, setIsSavingAbsenceDeadline] = useState(false);

  useEffect(() => {
    setAdSettingsDraft(normalizeInterstitialSettings(interstitialSettings));
  }, [
    interstitialSettings.dailyLimit,
    interstitialSettings.navigationInterval,
  ]);

  useEffect(() => {
    setAbsenceDeadlineDraft(String(absenceDeadlineDaysBefore));
  }, [absenceDeadlineDaysBefore]);

  useEffect(() => {
    setMyNewName(currentUser);
  }, [currentUser]);

  const [inputTeamName, setInputTeamName] = useState("読み込み中...");
  const [teamCreatedBy, setTeamCreatedBy] = useState("");
  useEffect(() => {
    if (activeTeamId) {
      const fetchTeamName = async () => {
        try {
          const teamRef = doc(db, "teams", activeTeamId);
          const teamSnap = await getDoc(teamRef);
          if (teamSnap.exists()) {
            const data = teamSnap.data();
            setInputTeamName(data.teamName || data.name || "");
            setTeamCreatedBy(data.createdBy || "");
          }
        } catch (error) {
          console.log("チーム名取得エラー", error);
          setInputTeamName("エラー");
        }
      };
      fetchTeamName();
    }
  }, [activeTeamId]);

  const [myGrade, setMyGrade] = useState(
    currentUserProfile.grade || "",
  );
  const [myPosition, setMyPosition] = useState(
    currentUserProfile.position || "",
  );

  useEffect(() => {
    setMyGrade(currentUserProfile.grade || "");
    setMyPosition(currentUserProfile.position || "");
  }, [currentUserProfile.grade, currentUserProfile.position]);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isRoleModalVisible, setIsRoleModalVisible] = useState(false);
  const [selectedMemberForRole, setSelectedMemberForRole] = useState(null);
  const [isChangingMemberRole, setIsChangingMemberRole] = useState(false);

  const [isAssignStaffModalVisible, setIsAssignStaffModalVisible] =
    useState(false);
  const [selectedMemberForAssign, setSelectedMemberForAssign] = useState(null);

  const [isStaffScopeModalVisible, setIsStaffScopeModalVisible] =
    useState(false);
  const [selectedStaffForScope, setSelectedStaffForScope] = useState(null);

  const isTeamCreator =
    !!currentUserUid && !!teamCreatedBy && currentUserUid === teamCreatedBy;
  const canDeleteTeam = isSupervisor && isTeamCreator;
  const hasSupervisor = Object.values(userProfiles).some((profile) =>
    ["owner", "admin"].includes(profile?.role),
  );
  const selectedMemberProfile = getMemberProfileByUid(selectedMemberForRole);
  const selectedMemberName =
    selectedMemberProfile.name || "対象メンバー";
  const selectedMemberForAssignProfile = getMemberProfileByUid(
    selectedMemberForAssign,
  );
  const selectedStaffForScopeProfile = getMemberProfileByUid(
    selectedStaffForScope,
  );
  const canPromoteSelectedMemberToSupervisor =
    !!selectedMemberForRole &&
    selectedMemberForRole === currentUserUid &&
    (isTeamCreator || (currentMemberRole === "staff" && !hasSupervisor));

  const roleConfig = {
    owner: { label: "監督(オーナー)", color: "#e74c3c", bg: "#fceeea" },
    admin: { label: "監督", color: "#e74c3c", bg: "#fceeea" },
    staff: { label: "スタッフ", color: "#9b59b6", bg: "#f5eef8" },
    captain: { label: "キャプテン", color: "#e67e22", bg: "#fdf2e9" },
    guardian: { label: "保護者", color: "#16a085", bg: "#e8f8f5" },
    member: { label: "一般部員", color: "#3498db", bg: "#ebf5fb" },
  };

  const staffList = clubMembers.filter((m) => {
    const r = userProfiles[m]?.role;
    return r === "owner" || r === "staff" || r === "admin";
  });

  // ★ 追加：部員リストを「役職順」かつ「五十音順」に自動並び替えする処理
  const sortedMembers = useMemo(() => {
    return [...clubMembers].sort((a, b) => {
      const roleA = userProfiles[a]?.role || "member";
      const roleB = userProfiles[b]?.role || "member";

      // 権限の強さ（数字が小さいほど上に表示）
      const getRoleWeight = (role) => {
        if (role === "owner" || role === "admin") return 1; // 管理者
        if (role === "staff") return 2; // スタッフ
        if (role === "captain") return 3; // キャプテン
        if (role === "guardian") return 4;
        return 5; // 一般部員
      };

      const weightA = getRoleWeight(roleA);
      const weightB = getRoleWeight(roleB);

      // まず役職順で比較
      if (weightA !== weightB) {
        return weightA - weightB;
      }

      // 役職が同じ場合は名前で五十音順（日本語ソート）
      const nameA = userProfiles[a]?.name || a;
      const nameB = userProfiles[b]?.name || b;
      return nameA.localeCompare(nameB, "ja");
    });
  }, [clubMembers, userProfiles]);

  const toggleSection = (sectionKey) => {
    setExpanded((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const handleDeleteMember = (targetUid) => {
    const targetProfile = getMemberProfileByUid(targetUid);
    const memberName = targetProfile.name || "対象ユーザー";
    const isSelf = targetUid && targetUid === auth.currentUser?.uid;
    const targetRole = targetProfile.role || "member";
    const title = isSelf ? "チームから退会" : "メンバーの除外";
    const message = isSelf
      ? `${memberName} としてこのチームから退会しますか？\nチームの情報は削除されず、招待コードまたはFirestore上のチーム情報から確認できます。`
      : `${memberName} をチームから除外しますか？\nチームの情報は削除されず、このユーザーの所属チーム枠は1つ空きます。`;
    const actionText = isSelf ? "退会する" : "除外する";

    Alert.alert(title, message, [
      { text: "キャンセル", style: "cancel" },
      {
        text: actionText,
        style: "destructive",
        onPress: async () => {
          try {
            if (activeTeamId && targetUid) {
              await removeTeamMember(activeTeamId, targetUid);
              Alert.alert(
                isSelf ? "退会完了" : "除外完了",
                isSelf
                  ? "このチームから退会しました。"
                  : `${memberName} をチームから除外しました。`,
                isSelf
                  ? [
                      {
                        text: "OK",
                        onPress: () => {
                          if (navigation.canGoBack()) navigation.goBack();
                        },
                      },
                    ]
                  : undefined,
              );
            }
          } catch (error) {
            console.log("メンバー除外エラー:", error);
            Alert.alert(
              "エラー",
              targetRole === "admin" || targetRole === "owner"
                ? "退会または除外に失敗しました。権限設定を確認してください。"
                : "除外に失敗しました。",
            );
          }
        },
      },
    ]);
  };

  const handleDeleteTeam = () => {
    if (!activeTeamId || !canDeleteTeam || isDeletingTeam) return;

    const teamName = inputTeamName || "このチーム";
    Alert.alert(
      "チームを削除",
      `${teamName} を削除しますか？\n他のメンバーが所属している場合は削除できません。`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除手続きへ",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "最終確認",
              "チーム内の予定・動画・投稿・日報・添付ファイルと招待コードが完全に削除され、元に戻せません。",
              [
                { text: "キャンセル", style: "cancel" },
                {
                  text: "完全に削除する",
                  style: "destructive",
                  onPress: async () => {
                    setIsDeletingTeam(true);
                    try {
                      await deleteTeam(activeTeamId);
                      Alert.alert(
                        "削除完了",
                        `${teamName} を削除しました。`,
                        [
                          {
                            text: "OK",
                            onPress: () => {
                              if (navigation.canGoBack()) navigation.goBack();
                            },
                          },
                        ],
                      );
                    } catch (error) {
                      console.log("チーム削除エラー:", error);
                      const errorCode = String(error?.code || "");
                      const errorMessage = errorCode.includes(
                        "failed-precondition",
                      )
                        ? "他のメンバーが所属しているため削除できません。"
                        : errorCode.includes("permission-denied")
                          ? "チームを削除できるのは監督かつチーム作成者本人だけです。"
                          : "チームを削除できませんでした。通信状態を確認してください。";
                      Alert.alert("エラー", errorMessage);
                    } finally {
                      setIsDeletingTeam(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  const handleAddTeamArrayItem = async (field, value, setter) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await addTeamArrayItem(activeTeamId, field, trimmed);
      setter("");
    } catch (error) {
      Alert.alert("エラー", "追加に失敗しました。権限を確認してください。");
    }
  };

  const handleDeleteTeamArrayItem = (field, value, label) => {
    Alert.alert(`${label}の削除`, `「${value}」を削除しますか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await removeTeamArrayItem(activeTeamId, field, value);
          } catch (error) {
            Alert.alert("エラー", "削除に失敗しました。");
          }
        },
      },
    ]);
  };

  const handleSaveMemberProfile = async () => {
    const trimmedName = myNewName.trim();
    if (trimmedName === "") {
      Alert.alert("エラー", "名前を入力してください。");
      return;
    }

    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        await updateMemberProfile(
          activeTeamId,
          uid,
          trimmedName,
          myGrade,
          myPosition,
        );
      }
      Alert.alert(
        "保存完了",
        "プロフィールを更新しました。\n（※すぐに他の画面にも反映されます）",
      );
    } catch (error) {
      console.log("プロフィール更新エラー:", error);
      Alert.alert("エラー", "プロフィールの更新に失敗しました。");
    }
  };

  const handleSaveTeamName = async () => {
    const trimmedName = inputTeamName.trim();
    if (!trimmedName) {
      return Alert.alert("エラー", "チーム名を入力してください。");
    }
    try {
      if (activeTeamId) {
        const teamRef = doc(db, "teams", activeTeamId);
        await updateDoc(teamRef, {
          teamName: trimmedName,
          name: trimmedName,
        });
        Alert.alert(
          "保存完了",
          "チーム名を更新しました！\n※ホーム画面に戻ると反映されます。",
        );
      }
    } catch (error) {
      console.log("チーム名更新エラー:", error);
      Alert.alert("エラー", "チーム名の更新に失敗しました。");
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert("エラー", "すべての項目を入力してください。");
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert("エラー", "新しいパスワードは6文字以上で入力してください。");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(
        "エラー",
        "新しいパスワードと確認用パスワードが一致しません。",
      );
      return;
    }

    setIsChangingPassword(true);
    try {
      const user = auth.currentUser;
      if (user && user.email) {
        const credential = EmailAuthProvider.credential(
          user.email,
          currentPassword,
        );
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);

        Alert.alert("成功", "パスワードを安全に変更しました。");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setExpanded((prev) => ({ ...prev, myPassword: false }));
      }
    } catch (error) {
      console.log("パスワード変更エラー:", error);
      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password"
      ) {
        Alert.alert("エラー", "現在のパスワードが間違っています。");
      } else {
        Alert.alert(
          "エラー",
          "パスワードの変更に失敗しました。再度ログインし直してからお試しください。",
        );
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSaveAdSettings = async () => {
    if (!isSupervisor || !activeTeamId) return;

    const normalizedSettings = normalizeInterstitialSettings(adSettingsDraft);
    setIsSavingAdSettings(true);
    try {
      await updateTeamAdSettings(
        activeTeamId,
        getTeamAdSettingsForSave(normalizedSettings),
      );
      setAdSettingsDraft(normalizedSettings);
      setInterstitialSettings?.(normalizedSettings);
      Alert.alert(
        "保存完了",
        normalizedSettings.dailyLimit === 0
          ? "インタースティシャル広告を停止しました。"
          : "インタースティシャル広告の表示頻度を更新しました。",
      );
    } catch (error) {
      console.log("広告表示頻度の保存エラー:", error);
      Alert.alert(
        "エラー",
        "広告表示頻度を保存できませんでした。権限と通信状態を確認してください。",
      );
    } finally {
      setIsSavingAdSettings(false);
    }
  };

  const handleOpenRoleModal = (memberUid) => {
    setSelectedMemberForRole(memberUid);
    setIsRoleModalVisible(true);
  };

  const saveMemberRole = async (targetUid, newRole) => {
    if (!activeTeamId || !targetUid || isChangingMemberRole) return;

    const memberName = getMemberProfileByUid(targetUid).name || "対象メンバー";
    setIsChangingMemberRole(true);
    try {
      await updateMemberRoleConfig(activeTeamId, targetUid, { role: newRole });
      setIsRoleModalVisible(false);
      setSelectedMemberForRole(null);
      Alert.alert(
        "設定完了",
        memberName +
          " の権限を「" +
          roleConfig[newRole].label +
          "」に変更しました。",
      );
    } catch (error) {
      console.log("権限変更エラー:", error);
      Alert.alert(
        "エラー",
        "権限を変更できませんでした。権限と通信状態を確認してください。",
      );
    } finally {
      setIsChangingMemberRole(false);
    }
  };

  const handleChangeRole = (newRole) => {
    if (!selectedMemberForRole) return;

    const previousRole = selectedMemberProfile.role || "member";
    const requiresDowngradeConfirmation =
      ["owner", "admin", "staff"].includes(previousRole) &&
      ["member", "captain", "guardian"].includes(newRole);

    if (requiresDowngradeConfirmation) {
      Alert.alert(
        "権限変更の確認",
        "一般部員、キャプテン、または保護者へ変更すると、このメンバーは自力で監督・スタッフ権限へ戻せなくなります。それでも変更しますか？",
        [
          { text: "キャンセル", style: "cancel" },
          {
            text: "変更する",
            style: "destructive",
            onPress: () => saveMemberRole(selectedMemberForRole, newRole),
          },
        ],
      );
      return;
    }

    saveMemberRole(selectedMemberForRole, newRole);
  };

  const handleRestoreSupervisorRole = async () => {
    if (!isTeamCreator || !activeTeamId || !currentUserUid) return;

    setIsChangingMemberRole(true);
    try {
      await updateMemberRoleConfig(activeTeamId, currentUserUid, {
        role: "admin",
      });
      Alert.alert("設定完了", "監督権限へ戻しました。");
    } catch (error) {
      console.log("監督権限復旧エラー:", error);
      Alert.alert(
        "エラー",
        "監督権限へ戻せませんでした。権限と通信状態を確認してください。",
      );
    } finally {
      setIsChangingMemberRole(false);
    }
  };

  const handleToggleGuardianPermission = async (targetUid, field, value) => {
    if (!canManageGuardianPermissions || !activeTeamId || !targetUid) return;

    try {
      await updateMemberRoleConfig(activeTeamId, targetUid, { [field]: value });
      setUserProfiles((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([profileKey, profile]) => [
            profileKey,
            profile?.uid === targetUid
              ? { ...profile, [field]: value }
              : profile,
          ]),
        ),
      );
    } catch (error) {
      Alert.alert("エラー", "保護者権限の更新に失敗しました。");
    }
  };

  const handleOpenAssignStaffModal = (memberUid) => {
    setSelectedMemberForAssign(memberUid);
    setIsAssignStaffModalVisible(true);
  };

  const handleAssignStaff = async (staffUid) => {
    if (!selectedMemberForAssign) return;
    const staffName = staffUid
      ? getMemberProfileByUid(staffUid).name || null
      : null;

    if (activeTeamId) {
      await updateMemberRoleConfig(activeTeamId, selectedMemberForAssign, {
        assignedStaff: staffName,
      });
    }
    setIsAssignStaffModalVisible(false);
    setSelectedMemberForAssign(null);
  };

  const handleOpenStaffScopeModal = (staffUid) => {
    setSelectedStaffForScope(staffUid);
    setIsStaffScopeModalVisible(true);
  };

  const handleStaffScope = async (scope) => {
    if (!selectedStaffForScope) return;

    if (activeTeamId) {
      await updateMemberRoleConfig(activeTeamId, selectedStaffForScope, {
        staffScope: scope,
      });
    }
    setIsStaffScopeModalVisible(false);
    setSelectedStaffForScope(null);
  };

  const handleSaveAbsenceDeadline = async () => {
    if (!isStaffOrAbove || !activeTeamId || isSavingAbsenceDeadline) return;

    const trimmedValue = absenceDeadlineDraft.trim();
    const nextValue = Number(trimmedValue);
    if (
      !/^\d+$/.test(trimmedValue) ||
      !Number.isInteger(nextValue) ||
      nextValue < 0 ||
      nextValue > 365
    ) {
      Alert.alert("入力エラー", "0～365の整数を入力してください。");
      return;
    }

    setIsSavingAbsenceDeadline(true);
    try {
      await updateDoc(doc(db, "teams", activeTeamId), {
        absenceDeadlineDaysBefore: nextValue,
      });
      setAbsenceDeadlineDraft(String(nextValue));
      setAbsenceDeadlineDaysBefore?.(nextValue);
      Alert.alert(
        "保存完了",
        "不参加連絡は予定日の" +
          nextValue +
          "日前の午前0時から送信できなくなります。",
      );
    } catch (error) {
      console.log("不参加連絡期限の保存エラー:", error);
      Alert.alert(
        "エラー",
        "不参加連絡期限を保存できませんでした。権限と通信状態を確認してください。",
      );
    } finally {
      setIsSavingAbsenceDeadline(false);
    }
  };

  const copyToClipboard = (text, label) => {
    Clipboard.setString(text);
    Alert.alert(
      "コピー完了",
      `${label}をコピーしました。部員に送ってください。`,
    );
  };

  const handleLogout = () => {
    Alert.alert("ログアウト", "アカウントからログアウトしますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "ログアウト",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
          } catch (error) {
            console.log("ログアウトエラー:", error);
            Alert.alert("エラー", "ログアウトに失敗しました。");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backBtnText}>◁ 戻る</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>⚙️ 設定</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
          {!isStaffOrAbove ? (
            <>
              <Text style={styles.sectionDescription}>
                自分のプロフィールやパスワードを変更できます。
              </Text>

              <SectionCard
                isExp={expanded.myProfile}
                onToggle={() => toggleSection("myProfile")}
                title="👤 プロフィール設定"
              >
                <Text style={styles.label}>
                  表示名（本名またはニックネーム）
                </Text>
                <TextInput
                  style={styles.input}
                  value={myNewName}
                  onChangeText={setMyNewName}
                  placeholder="表示名"
                />
                <Text style={styles.hintText}>
                  ※変更するとアプリ全体の表示名が切り替わります。
                </Text>

                <Text style={[styles.label, { marginTop: 15 }]}>学年</Text>
                {grades.length > 0 ? (
                  <OptionSelector
                    options={grades}
                    selected={myGrade}
                    onSelect={setMyGrade}
                  />
                ) : (
                  <Text style={styles.emptyText}>
                    管理者が学年を登録していません
                  </Text>
                )}

                <Text style={styles.label}>ポジション・役割</Text>
                {positions.length > 0 ? (
                  <OptionSelector
                    options={positions}
                    selected={myPosition}
                    onSelect={setMyPosition}
                  />
                ) : (
                  <Text style={styles.emptyText}>
                    管理者がポジションを登録していません
                  </Text>
                )}

                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveMemberProfile}
                >
                  <Text style={styles.saveBtnText}>プロフィールを保存</Text>
                </TouchableOpacity>
              </SectionCard>

              <SectionCard
                isExp={expanded.myPassword}
                onToggle={() => toggleSection("myPassword")}
                title="🔑 パスワードの変更"
              >
                <Text style={styles.subText}>
                  セキュリティのため、現在のパスワードを入力してから新しいパスワードを設定してください。
                </Text>

                <Text style={styles.label}>現在のパスワード</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="現在のパスワード"
                    secureTextEntry={!showCurrentPass}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowCurrentPass(!showCurrentPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showCurrentPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>新しいパスワード (6文字以上)</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="新しいパスワード"
                    secureTextEntry={!showNewPass}
                    value={newPassword}
                    onChangeText={setNewPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowNewPass(!showNewPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showNewPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>新しいパスワード (確認用)</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="もう一度入力してください"
                    secureTextEntry={!showConfirmPass}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowConfirmPass(!showConfirmPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showConfirmPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    { backgroundColor: "#3498db", marginTop: 5 },
                  ]}
                  onPress={handleChangePassword}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>パスワードを変更</Text>
                  )}
                </TouchableOpacity>
              </SectionCard>

              {isTeamCreator && !isStaffOrAbove && (
                <SectionCard
                  isExp={expanded.teamInfo}
                  onToggle={() => toggleSection("teamInfo")}
                  title="🛡️ 監督権限の復旧"
                >
                  <Text style={styles.subText}>
                    このチームの作成者は、自分の役割を監督へ戻すことができます。
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.saveBtn,
                      isChangingMemberRole && { opacity: 0.7 },
                    ]}
                    onPress={handleRestoreSupervisorRole}
                    disabled={isChangingMemberRole}
                  >
                    {isChangingMemberRole ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnText}>監督権限へ戻す</Text>
                    )}
                  </TouchableOpacity>
                </SectionCard>
              )}
            </>
          ) : (
            <>
              <Text style={styles.sectionDescription}>
                チームの管理・設定を行うことができます。
              </Text>

              <SectionCard
                isExp={expanded.myProfile}
                onToggle={() => toggleSection("myProfile")}
                title="👤 あなたのプロフィール設定"
              >
                <Text style={styles.label}>
                  表示名（本名またはニックネーム）
                </Text>
                <TextInput
                  style={styles.input}
                  value={myNewName}
                  onChangeText={setMyNewName}
                  placeholder="表示名"
                />
                <Text style={styles.hintText}>
                  ※変更するとアプリ全体の表示名が切り替わります。
                </Text>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveMemberProfile}
                >
                  <Text style={styles.saveBtnText}>プロフィールを保存</Text>
                </TouchableOpacity>
              </SectionCard>

              <SectionCard
                isExp={expanded.teamInfo}
                onToggle={() => toggleSection("teamInfo")}
                title="🏟️ 所属チーム情報・入部用コード"
              >
                <Text style={styles.label}>現在のチーム名</Text>
                <View style={styles.addMemberRow}>
                  <TextInput
                    style={styles.inputFlex}
                    value={inputTeamName}
                    onChangeText={setInputTeamName}
                    placeholder="チーム名を入力"
                  />
                  <TouchableOpacity
                    style={[
                      styles.addMemberBtn,
                      { backgroundColor: "#3498db" },
                    ]}
                    onPress={handleSaveTeamName}
                  >
                    <Text style={styles.addMemberBtnText}>保存</Text>
                  </TouchableOpacity>
                </View>

                <View
                  style={[
                    styles.idInfoBox,
                    {
                      borderTopWidth: 1,
                      borderTopColor: "#eee",
                      paddingTop: 15,
                    },
                  ]}
                >
                  <Text style={styles.idLabel}>
                    部員に教える【招待コード】:
                  </Text>
                  <Text style={styles.idValueHighlight}>{inviteCode}</Text>
                  <TouchableOpacity
                    style={styles.copySubBtn}
                    onPress={() => copyToClipboard(inviteCode, "招待コード")}
                  >
                    <Text style={styles.copySubBtnText}>
                      招待コードをコピー
                    </Text>
                  </TouchableOpacity>
                </View>
                <View
                  style={[
                    styles.idInfoBox,
                    {
                      marginTop: 15,
                      borderTopWidth: 1,
                      borderTopColor: "#eee",
                      paddingTop: 15,
                    },
                  ]}
                >
                  <Text style={styles.idLabel}>チームID (システム用):</Text>
                  <Text style={styles.idValueSmall}>
                    {activeTeamId || "---"}
                  </Text>
                </View>
                {canDeleteTeam && (
                  <View style={styles.teamDeleteBox}>
                    <Text style={styles.teamDeleteWarning}>
                      チーム作成者本人で、所属者が自分だけの場合に限り削除できます。
                    </Text>
                    <TouchableOpacity
                      style={[
                        styles.teamDeleteBtn,
                        isDeletingTeam && { opacity: 0.7 },
                      ]}
                      onPress={handleDeleteTeam}
                      disabled={isDeletingTeam}
                    >
                      {isDeletingTeam ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.teamDeleteBtnText}>
                          チームを完全に削除
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </SectionCard>

              <SectionCard
                isExp={expanded.myPassword}
                onToggle={() => toggleSection("myPassword")}
                title="🔑 パスワードの変更"
              >
                <Text style={styles.subText}>
                  セキュリティのため、現在のパスワードを入力してから新しいパスワードを設定してください。
                </Text>

                <Text style={styles.label}>現在のパスワード</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="現在のパスワード"
                    secureTextEntry={!showCurrentPass}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowCurrentPass(!showCurrentPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showCurrentPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>新しいパスワード (6文字以上)</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="新しいパスワード"
                    secureTextEntry={!showNewPass}
                    value={newPassword}
                    onChangeText={setNewPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowNewPass(!showNewPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showNewPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>新しいパスワード (確認用)</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="もう一度入力してください"
                    secureTextEntry={!showConfirmPass}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowConfirmPass(!showConfirmPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showConfirmPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    { backgroundColor: "#3498db", marginTop: 5 },
                  ]}
                  onPress={handleChangePassword}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>パスワードを変更</Text>
                  )}
                </TouchableOpacity>
              </SectionCard>

              <SectionCard
                isExp={expanded.absence}
                onToggle={() => toggleSection("absence")}
                title="📅 不参加連絡期限"
              >
                <Text style={styles.subText}>
                  予定日の何日前から不参加連絡を送信できなくするか設定します。0日は予定日当日の午前0時から送信不可です。
                </Text>
                <Text style={styles.label}>送信を締め切る日数（0～365日）</Text>
                <TextInput
                  style={styles.input}
                  value={absenceDeadlineDraft}
                  onChangeText={setAbsenceDeadlineDraft}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={3}
                  placeholder="3"
                />
                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    isSavingAbsenceDeadline && { opacity: 0.7 },
                  ]}
                  onPress={handleSaveAbsenceDeadline}
                  disabled={isSavingAbsenceDeadline}
                >
                  {isSavingAbsenceDeadline ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>不参加連絡期限を保存</Text>
                  )}
                </TouchableOpacity>
              </SectionCard>

              {INTERSTITIAL_ADS_ENABLED && isSupervisor && (
                <SectionCard
                  isExp={expanded.ads}
                  onToggle={() => toggleSection("ads")}
                  title="📢 インタースティシャル広告頻度"
                >
                  <Text style={styles.subText}>
                    この設定はチーム全員に適用されます。新規日誌提出後の広告も、1日の表示上限に含まれます。
                  </Text>
                  <ThresholdSelector
                    label="画面遷移何回ごとに表示するか"
                    value={adSettingsDraft.navigationInterval}
                    min={INTERSTITIAL_NAVIGATION_INTERVAL_MIN}
                    max={INTERSTITIAL_NAVIGATION_INTERVAL_MAX}
                    onChange={(value) =>
                      setAdSettingsDraft((previous) => ({
                        ...previous,
                        navigationInterval: value,
                      }))
                    }
                  />
                  <ThresholdSelector
                    label="1日の最大表示回数"
                    value={adSettingsDraft.dailyLimit}
                    min={INTERSTITIAL_DAILY_LIMIT_MIN}
                    max={INTERSTITIAL_DAILY_LIMIT_MAX}
                    onChange={(value) =>
                      setAdSettingsDraft((previous) => ({
                        ...previous,
                        dailyLimit: value,
                      }))
                    }
                  />
                  <Text style={styles.hintText}>
                    ※1日の最大表示回数を0にすると、日誌提出後を含むインタースティシャル広告を停止します。バナー広告は引き続き表示されます。
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.saveBtn,
                      isSavingAdSettings && { opacity: 0.7 },
                    ]}
                    onPress={handleSaveAdSettings}
                    disabled={isSavingAdSettings}
                  >
                    {isSavingAdSettings ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.saveBtnText}>広告頻度を保存</Text>
                    )}
                  </TouchableOpacity>
                </SectionCard>
              )}

              <SectionCard
                isExp={expanded.alert}
                onToggle={() => toggleSection("alert")}
                title="🚨 メディカル・アラート基準"
              >
                <Text style={styles.subText}>
                  コンディション一覧で「注意(黄)」「危険(赤)」になる数値を設定します。
                </Text>
                <ThresholdSelector
                  label="疲労度「注意」の基準 (5段階中)"
                  value={alertThresholds.fatigueWarning}
                  min={1}
                  max={alertThresholds.fatigueDanger - 1}
                  onChange={(v) =>
                    setAlertThresholds({
                      ...alertThresholds,
                      fatigueWarning: v,
                    })
                  }
                />
                <ThresholdSelector
                  label="疲労度「危険」の基準 (5段階中)"
                  value={alertThresholds.fatigueDanger}
                  min={alertThresholds.fatigueWarning + 1}
                  max={MEDICAL_SCALE_MAX}
                  onChange={(v) =>
                    setAlertThresholds({ ...alertThresholds, fatigueDanger: v })
                  }
                />
                <ThresholdSelector
                  label="痛み「危険」の基準 (5段階中)"
                  value={alertThresholds.painDanger}
                  min={1}
                  max={MEDICAL_SCALE_MAX}
                  onChange={(v) =>
                    setAlertThresholds({ ...alertThresholds, painDanger: v })
                  }
                />
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.thresholdLabel}>
                      連続悪化の「自動昇格」
                    </Text>
                    <Text style={styles.switchSubLabel}>
                      前回の記録より疲労・痛みが悪化している場合、自動的に「危険」として通知します。
                    </Text>
                  </View>
                  <Switch
                    value={alertThresholds.autoEscalate}
                    onValueChange={(v) =>
                      setAlertThresholds({
                        ...alertThresholds,
                        autoEscalate: v,
                      })
                    }
                    trackColor={{ false: "#d9d9d9", true: "#e74c3c" }}
                  />
                </View>
              </SectionCard>

              <SectionCard
                isExp={expanded.member}
                onToggle={() => toggleSection("member")}
                title="👥 部員リスト・権限・担当管理"
              >
                <Text
                  style={[
                    styles.hintText,
                    { marginBottom: 10, textAlign: "center", color: "#e67e22" },
                  ]}
                >
                  ※部員は招待コードを使用してログインすると自動的に追加されます。
                </Text>

                <View style={styles.memberList}>
                  {/* ★ 修正：並び替えた sortedMembers を使って表示する */}
                  {sortedMembers.map((name) => {
                    const profile = userProfiles[name] || {};
                    const displayName = profile.name || name;
                    const memberRole = profile.role || "member";
                    const roleData =
                      roleConfig[memberRole] || roleConfig.member;
                    const assignedStaff = profile.assignedStaff || "未設定";
                    const staffScope = profile.staffScope || "all";
                    const canUploadVideos = Boolean(profile.canUploadVideos);
                    const canEditTags = Boolean(profile.canEditTags);

                    return (
                      <View key={profile.uid || name} style={styles.memberItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.memberName}>{displayName}</Text>
                          <TouchableOpacity
                            onPress={() => handleDeleteMember(profile.uid)}
                          >
                            <Text style={styles.deleteText}>
                              {profile.uid === auth.currentUser?.uid ? "退会" : "除外"}
                            </Text>
                          </TouchableOpacity>
                        </View>

                        <View style={{ alignItems: "flex-end" }}>
                          <TouchableOpacity
                            style={[
                              styles.roleBadge,
                              {
                                backgroundColor: roleData.bg,
                                borderColor: roleData.color,
                                marginBottom: 6,
                              },
                            ]}
                            onPress={() => handleOpenRoleModal(profile.uid)}
                          >
                            <Text
                              style={[
                                styles.roleBadgeText,
                                { color: roleData.color },
                              ]}
                            >
                              {roleData.label} ▾
                            </Text>
                          </TouchableOpacity>

                          {(memberRole === "member" ||
                            memberRole === "captain") && (
                            <TouchableOpacity
                              style={styles.subSettingBadge}
                              onPress={() => handleOpenAssignStaffModal(profile.uid)}
                            >
                              <Text style={styles.subSettingText}>
                                担当: {assignedStaff} ▾
                              </Text>
                            </TouchableOpacity>
                          )}

                          {memberRole === "staff" && (
                            <TouchableOpacity
                              style={styles.subSettingBadge}
                              onPress={() => handleOpenStaffScopeModal(profile.uid)}
                            >
                              <Text style={styles.subSettingText}>
                                閲覧:{" "}
                                {staffScope === "all" ? "全体" : "担当のみ"} ▾
                              </Text>
                            </TouchableOpacity>
                          )}

                          {memberRole === "guardian" && (
                            <>
                              <TouchableOpacity
                                style={[
                                  styles.subSettingBadge,
                                  canUploadVideos && styles.subSettingBadgeActive,
                                  !canManageGuardianPermissions && { opacity: 0.45 },
                                ]}
                                disabled={!canManageGuardianPermissions}
                                onPress={() =>
                                  handleToggleGuardianPermission(
                                    profile.uid,
                                    "canUploadVideos",
                                    !canUploadVideos,
                                  )
                                }
                              >
                                <Text
                                  style={[
                                    styles.subSettingText,
                                    canUploadVideos && styles.subSettingTextActive,
                                  ]}
                                >
                                  動画追加: {canUploadVideos ? "ON" : "OFF"}
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.subSettingBadge,
                                  canEditTags && styles.subSettingBadgeActive,
                                  !canManageGuardianPermissions && { opacity: 0.45 },
                                ]}
                                disabled={!canManageGuardianPermissions}
                                onPress={() =>
                                  handleToggleGuardianPermission(
                                    profile.uid,
                                    "canEditTags",
                                    !canEditTags,
                                  )
                                }
                              >
                                <Text
                                  style={[
                                    styles.subSettingText,
                                    canEditTags && styles.subSettingTextActive,
                                  ]}
                                >
                                  タグ編集: {canEditTags ? "ON" : "OFF"}
                                </Text>
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      </View>
                    );
                  })}
                  {sortedMembers.length === 0 && (
                    <Text style={styles.emptyText}>
                      登録されている部員がいません。
                    </Text>
                  )}
                </View>
              </SectionCard>

              <SectionCard
                isExp={expanded.grade}
                onToggle={() => toggleSection("grade")}
                title="🎓 学年リスト管理"
              >
                <View style={styles.addMemberRow}>
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="例: 1年生"
                    value={newGradeName}
                    onChangeText={setNewGradeName}
                  />
                  <TouchableOpacity
                    style={[
                      styles.addMemberBtn,
                      { backgroundColor: "#f39c12" },
                    ]}
                    onPress={() =>
                      handleAddTeamArrayItem(
                        "grades",
                        newGradeName,
                        setNewGradeName,
                      )
                    }
                  >
                    <Text style={styles.addMemberBtnText}>追加</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.memberList}>
                  {grades.map((g) => (
                    <View key={g} style={styles.memberItem}>
                      <Text style={styles.memberName}>{g}</Text>
                      <TouchableOpacity
                        onPress={() =>
                          handleDeleteTeamArrayItem("grades", g, "学年")
                        }
                      >
                        <Text style={styles.deleteText}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {grades.length === 0 && (
                    <Text style={styles.emptyText}>登録がありません</Text>
                  )}
                </View>
              </SectionCard>

              <SectionCard
                isExp={expanded.position}
                onToggle={() => toggleSection("position")}
                title="⚾ ポジション・役割管理"
              >
                <View style={styles.addMemberRow}>
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="例: FW、マネ"
                    value={newPositionName}
                    onChangeText={setNewPositionName}
                  />
                  <TouchableOpacity
                    style={[
                      styles.addMemberBtn,
                      { backgroundColor: "#e67e22" },
                    ]}
                    onPress={() =>
                      handleAddTeamArrayItem(
                        "positions",
                        newPositionName,
                        setNewPositionName,
                      )
                    }
                  >
                    <Text style={styles.addMemberBtnText}>追加</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.memberList}>
                  {positions.map((p) => (
                    <View key={p} style={styles.memberItem}>
                      <Text style={styles.memberName}>{p}</Text>
                      <TouchableOpacity
                        onPress={() =>
                          handleDeleteTeamArrayItem(
                            "positions",
                            p,
                            "ポジション",
                          )
                        }
                      >
                        <Text style={styles.deleteText}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                  {positions.length === 0 && (
                    <Text style={styles.emptyText}>登録がありません</Text>
                  )}
                </View>
              </SectionCard>
            </>
          )}

          <View style={styles.logoutContainer}>
            <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
              <Text style={styles.logoutBtnText}>🚪 ログアウト</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ========================================== */}
      {/* ▼ モーダル群 */}
      {/* ========================================== */}
      <Modal
        visible={isRoleModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedMemberName} の権限を変更
            </Text>

            {canPromoteSelectedMemberToSupervisor &&
              !["owner", "admin"].includes(
                selectedMemberProfile.role,
              ) && (
                <TouchableOpacity
                  style={styles.roleSelectBtn}
                  onPress={() => handleChangeRole("admin")}
                  disabled={isChangingMemberRole}
                >
                  <Text style={styles.roleSelectTitle}>🛡️ 監督</Text>
                  <Text style={styles.roleSelectDesc}>
                    チーム作成者、または他に監督がいないスタッフ本人だけが選択できます。
                  </Text>
                </TouchableOpacity>
              )}

            {isStaffOrAbove && (
              <TouchableOpacity
                style={[
                  styles.roleSelectBtn,
                  selectedMemberProfile.role === "staff" &&
                    styles.roleSelectBtnActive,
                ]}
                onPress={() => handleChangeRole("staff")}
              >
                <Text style={styles.roleSelectTitle}>🎓 スタッフ</Text>
                <Text style={styles.roleSelectDesc}>
                  監督と同等の権限を持ちます。メディカル管理やプロジェクトの消去が可能です。
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                selectedMemberProfile.role === "captain" &&
                  styles.roleSelectBtnActive,
              ]}
              onPress={() => handleChangeRole("captain")}
            >
              <Text style={styles.roleSelectTitle}>⭐ キャプテン</Text>
              <Text style={styles.roleSelectDesc}>
                プロジェクトの作成や消去、全体への連絡が可能です。他メンバーのメディカルは見られません。
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                selectedMemberProfile.role === "guardian" &&
                  styles.roleSelectBtnActive,
              ]}
              onPress={() => handleChangeRole("guardian")}
            >
              <Text style={styles.roleSelectTitle}>保護者</Text>
              <Text style={styles.roleSelectDesc}>
                カレンダー・動画の閲覧のみ。個別許可時だけ動画追加・タグ編集ができます。
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                (selectedMemberProfile.role === "member" ||
                  !selectedMemberProfile.role) &&
                  styles.roleSelectBtnActive,
              ]}
              onPress={() => handleChangeRole("member")}
            >
              <Text style={styles.roleSelectTitle}>👤 一般部員</Text>
              <Text style={styles.roleSelectDesc}>
                プロジェクトの閲覧やタグ付け、自身のメディカル入力のみが可能です。
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                setIsRoleModalVisible(false);
                setSelectedMemberForRole(null);
              }}
              disabled={isChangingMemberRole}
            >
              <Text style={styles.cancelBtnText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isAssignStaffModalVisible}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedMemberForAssignProfile.name || "対象メンバー"} の担当スタッフを設定
            </Text>
            <ScrollView style={{ maxHeight: 200, marginBottom: 15 }}>
              <TouchableOpacity
                style={styles.optionBtnFull}
                onPress={() => handleAssignStaff(null)}
              >
                <Text style={styles.optionTextFull}>未設定にする</Text>
              </TouchableOpacity>
              {staffList.length === 0 ? (
                <Text style={styles.emptyText}>
                  スタッフ権限のメンバーがいません
                </Text>
              ) : (
                staffList.map((staff) => (
                  <TouchableOpacity
                    key={userProfiles[staff]?.uid || staff}
                    style={styles.optionBtnFull}
                    onPress={() => handleAssignStaff(userProfiles[staff]?.uid)}
                  >
                    <Text style={styles.optionTextFull}>
                      {userProfiles[staff]?.name || staff}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setIsAssignStaffModalVisible(false)}
            >
              <Text style={styles.cancelBtnText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isStaffScopeModalVisible}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedStaffForScopeProfile.name || "対象スタッフ"} の閲覧範囲を設定
            </Text>
            <Text style={styles.settingHint}>
              日記やメディカル情報をどこまで閲覧できるか設定します。
            </Text>

            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                (selectedStaffForScopeProfile.staffScope === "all" ||
                  !selectedStaffForScopeProfile.staffScope) &&
                  styles.roleSelectBtnActive,
              ]}
              onPress={() => handleStaffScope("all")}
            >
              <Text style={styles.roleSelectTitle}>
                👀 全体閲覧 (Head Coach)
              </Text>
              <Text style={styles.roleSelectDesc}>
                すべての部員の記録を閲覧できます。
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                selectedStaffForScopeProfile.staffScope ===
                  "assigned" && styles.roleSelectBtnActive,
              ]}
              onPress={() => handleStaffScope("assigned")}
            >
              <Text style={styles.roleSelectTitle}>
                👤 担当のみ (Assistant)
              </Text>
              <Text style={styles.roleSelectDesc}>
                自分が担当に設定されている部員の記録のみ閲覧できます。
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setIsStaffScopeModalVisible(false)}
            >
              <Text style={styles.cancelBtnText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#f39c12",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backBtn: { width: 60 },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  content: { padding: 15 },
  sectionDescription: {
    color: "#666",
    fontSize: 13,
    marginBottom: 15,
    textAlign: "center",
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 15,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#fff",
  },
  cardHeaderExpanded: { borderBottomWidth: 1, borderBottomColor: "#eee" },
  cardTitle: { fontSize: 16, fontWeight: "bold", color: "#333" },
  chevron: { fontSize: 16, color: "#888", fontWeight: "bold" },
  cardContent: { padding: 20, paddingTop: 15 },

  subText: { fontSize: 12, color: "#666", marginBottom: 15 },
  label: { fontSize: 14, fontWeight: "bold", color: "#555", marginBottom: 5 },
  input: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  inputFlex: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
  },
  hintText: { fontSize: 11, color: "#888", marginTop: 4 },

  optionBtn: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
  },
  optionBtnActive: {
    backgroundColor: "#e2f0d9",
    borderWidth: 1,
    borderColor: "#27ae60",
  },
  optionText: { fontSize: 13, color: "#555" },
  optionTextActive: { color: "#27ae60", fontWeight: "bold" },

  thresholdRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#eee",
  },
  thresholdLabel: { fontSize: 14, fontWeight: "bold", color: "#333", flex: 1 },
  thresholdControl: { flexDirection: "row", alignItems: "center" },
  thresholdBtn: {
    backgroundColor: "#ddd",
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  thresholdBtnText: { fontSize: 18, fontWeight: "bold", color: "#333" },
  thresholdValue: {
    fontSize: 16,
    fontWeight: "bold",
    width: 40,
    textAlign: "center",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingTop: 15,
  },
  switchSubLabel: {
    fontSize: 11,
    color: "#888",
    marginTop: 4,
    marginRight: 10,
  },

  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 15,
  },
  passwordInput: { flex: 1, padding: 12, fontSize: 16 },
  toggleBtn: {
    paddingHorizontal: 15,
    paddingVertical: 12,
    justifyContent: "center",
  },
  toggleBtnText: { color: "#0077cc", fontWeight: "bold", fontSize: 14 },
  saveBtn: {
    backgroundColor: "#2ecc71",
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 15,
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  addMemberRow: { flexDirection: "row", marginBottom: 15 },
  addMemberBtn: {
    backgroundColor: "#0077cc",
    paddingHorizontal: 20,
    justifyContent: "center",
    borderRadius: 8,
    marginLeft: 10,
  },
  addMemberBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  memberList: { borderWidth: 1, borderColor: "#eee", borderRadius: 8 },
  memberItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
  },
  memberName: {
    fontSize: 16,
    color: "#333",
    fontWeight: "bold",
    marginBottom: 4,
  },
  deleteText: { color: "#e74c3c", fontWeight: "bold", fontSize: 12 },
  emptyText: { padding: 15, textAlign: "center", color: "#888" },

  roleBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    borderWidth: 1,
  },
  roleBadgeText: { fontSize: 12, fontWeight: "bold" },

  subSettingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    marginTop: 6,
  },
  subSettingBadgeActive: {
    backgroundColor: "#0077cc",
    borderColor: "#0077cc",
  },
  subSettingText: {
    fontSize: 10,
    color: "#666",
    fontWeight: "bold",
  },
  subSettingTextActive: {
    color: "#fff",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#333",
    textAlign: "center",
  },
  roleSelectBtn: {
    padding: 15,
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    marginBottom: 10,
  },
  roleSelectBtnActive: {
    backgroundColor: "#ebf5fb",
    borderColor: "#3498db",
  },
  roleSelectTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 6,
  },
  roleSelectDesc: {
    fontSize: 12,
    color: "#666",
    lineHeight: 18,
  },

  optionBtnFull: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  optionTextFull: {
    fontSize: 16,
    color: "#333",
    textAlign: "center",
    fontWeight: "bold",
  },
  settingHint: {
    fontSize: 13,
    color: "#888",
    marginBottom: 15,
    textAlign: "center",
  },

  cancelBtn: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#888",
  },

  idInfoBox: { alignItems: "center", paddingVertical: 10 },
  idLabel: { fontSize: 12, color: "#888", fontWeight: "bold", marginBottom: 5 },
  idValueHighlight: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#0077cc",
    letterSpacing: 3,
    marginBottom: 10,
  },
  idValueSmall: { fontSize: 12, color: "#aaa", fontFamily: "monospace" },
  copySubBtn: {
    backgroundColor: "#e6f2ff",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  copySubBtnText: { color: "#0077cc", fontSize: 13, fontWeight: "bold" },
  teamDeleteBox: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#f5b7b1",
    width: "100%",
  },
  teamDeleteWarning: {
    color: "#c0392b",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: 10,
  },
  teamDeleteBtn: {
    backgroundColor: "#c0392b",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  teamDeleteBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },

  logoutContainer: {
    marginTop: 20,
    marginBottom: 20,
    alignItems: "center",
  },
  logoutBtn: {
    backgroundColor: "#e74c3c",
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 8,
    width: "100%",
    alignItems: "center",
  },
  logoutBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default SettingsScreen;
