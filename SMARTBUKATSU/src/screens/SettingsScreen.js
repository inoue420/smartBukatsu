import React, { useState, useEffect } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../AuthContext";
import { auth } from "../firebase"; // ★追加
import {
  getTeamInviteCode,
  subscribeTeamData,
  addTeamArrayItem,
  removeTeamArrayItem,
  updateUserName, // ★追加
} from "../services/firestoreService";

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
  setCurrentUser,
  adminPassword,
  setAdminPassword,
  memberPassword,
  setMemberPassword,
  clubMembers,
  setClubMembers,
  alertThresholds,
  setAlertThresholds,
  userProfiles,
  setUserProfiles,
}) => {
  const { activeTeamId } = useAuth();
  const [inviteCode, setInviteCode] = useState("読み込み中...");

  const [grades, setGrades] = useState([]);
  const [positions, setPositions] = useState([]);

  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");
  const isStaffOrAbove = ["owner", "staff", "admin"].includes(userRole);

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

    const unsubscribe = subscribeTeamData(activeTeamId, (data) => {
      if (data) {
        setGrades(data.grades || []);
        setPositions(data.positions || []);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [activeTeamId, isStaffOrAbove]);

  const [newAdminPass, setNewAdminPass] = useState(adminPassword);
  const [newMemberPass, setNewMemberPass] = useState(memberPassword);
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [showMemberPass, setShowMemberPass] = useState(false);

  const [newMemberName, setNewMemberName] = useState("");
  const [newGradeName, setNewGradeName] = useState("");
  const [newPositionName, setNewPositionName] = useState("");

  const [expanded, setExpanded] = useState({
    teamInfo: true,
    alert: false,
    password: false,
    member: false,
    grade: false,
    position: false,
    myProfile: true,
    myPassword: false,
  });

  // ★ 修正：currentUserが変わったら入力欄も追従する
  const [myNewName, setMyNewName] = useState(currentUser);
  useEffect(() => {
    setMyNewName(currentUser);
  }, [currentUser]);

  const [myGrade, setMyGrade] = useState(
    userProfiles[currentUser]?.grade || "",
  );
  const [myPosition, setMyPosition] = useState(
    userProfiles[currentUser]?.position || "",
  );
  const [myPassword, setMyPassword] = useState(
    userProfiles[currentUser]?.password || "",
  );
  const [showMyPassword, setShowMyPassword] = useState(false);

  const [isRoleModalVisible, setIsRoleModalVisible] = useState(false);
  const [selectedMemberForRole, setSelectedMemberForRole] = useState(null);

  const [isAssignStaffModalVisible, setIsAssignStaffModalVisible] =
    useState(false);
  const [selectedMemberForAssign, setSelectedMemberForAssign] = useState(null);

  const [isStaffScopeModalVisible, setIsStaffScopeModalVisible] =
    useState(false);
  const [selectedStaffForScope, setSelectedStaffForScope] = useState(null);

  const roleConfig = {
    owner: { label: "監督(オーナー)", color: "#e74c3c", bg: "#fceeea" },
    admin: { label: "管理者", color: "#e74c3c", bg: "#fceeea" },
    staff: { label: "スタッフ", color: "#9b59b6", bg: "#f5eef8" },
    captain: { label: "キャプテン", color: "#e67e22", bg: "#fdf2e9" },
    member: { label: "一般部員", color: "#3498db", bg: "#ebf5fb" },
  };

  const staffList = clubMembers.filter((m) => {
    const r = userProfiles[m]?.role;
    return r === "owner" || r === "staff" || r === "admin";
  });

  const toggleSection = (sectionKey) => {
    setExpanded((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const handleSavePasswords = () => {
    if (newAdminPass.trim() === "" || newMemberPass.trim() === "") {
      Alert.alert("エラー", "パスワードは空にできません。");
      return;
    }
    setAdminPassword(newAdminPass);
    setMemberPassword(newMemberPass);
    Alert.alert("保存完了", "チームの共通パスワードを更新しました。");
  };

  const handleAddItemLocal = (
    itemName,
    list,
    setList,
    setNewItemName,
    label,
  ) => {
    const trimmed = itemName.trim();
    if (trimmed === "") return;
    if (list.includes(trimmed)) {
      Alert.alert("エラー", `その${label}は既に登録されています。`);
      return;
    }
    setList([...list, trimmed]);
    setNewItemName("");
  };

  const handleDeleteItemLocal = (itemName, list, setList, label) => {
    Alert.alert(`${label}の削除`, `${itemName} をリストから削除しますか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => setList(list.filter((item) => item !== itemName)),
      },
    ]);
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

  // ★ 修正：Firestoreのユーザー名を更新するように変更
  const handleSaveMemberProfile = async () => {
    const trimmedName = myNewName.trim();
    if (trimmedName === "") {
      Alert.alert("エラー", "名前を入力してください。");
      return;
    }

    try {
      const uid = auth.currentUser?.uid;
      if (uid) {
        await updateUserName(uid, trimmedName);
      }
      Alert.alert(
        "保存完了",
        "プロフィールを更新しました。\n変更はアプリ全体に即座に反映されます。",
      );
    } catch (error) {
      console.log(error);
      Alert.alert("エラー", "プロフィールの更新に失敗しました。");
    }
  };

  const handleSaveMemberPassword = () => {
    if (myPassword.trim() === "") {
      Alert.alert("エラー", "パスワードは空にできません。");
      return;
    }
    setUserProfiles((prev) => ({
      ...prev,
      [currentUser]: { ...(prev[currentUser] || {}), password: myPassword },
    }));
    Alert.alert(
      "保存完了",
      "自分専用のパスワードを設定しました。次回のログインから使用できます。",
    );
  };

  const handleOpenRoleModal = (memberName) => {
    if (memberName === "管理者" || memberName === "監督") {
      Alert.alert("エラー", "デフォルト管理者の権限は変更できません。");
      return;
    }
    const targetRole = userProfiles[memberName]?.role || "member";
    if (targetRole === "owner") {
      Alert.alert("操作エラー", "監督(オーナー)の権限は変更できません。");
      return;
    }

    if (
      userRole === "staff" &&
      targetRole === "staff" &&
      memberName !== currentUser
    ) {
      Alert.alert(
        "操作制限",
        "他のスタッフの権限は変更できません。監督に依頼してください。",
      );
      return;
    }

    setSelectedMemberForRole(memberName);
    setIsRoleModalVisible(true);
  };

  const handleChangeRole = (newRole) => {
    if (!selectedMemberForRole) return;
    setUserProfiles((prev) => ({
      ...prev,
      [selectedMemberForRole]: {
        ...(prev[selectedMemberForRole] || {}),
        role: newRole,
      },
    }));
    setIsRoleModalVisible(false);
    Alert.alert(
      "設定完了",
      `${selectedMemberForRole} の権限を「${roleConfig[newRole].label}」に変更しました。`,
    );
    setSelectedMemberForRole(null);
  };

  const handleOpenAssignStaffModal = (memberName) => {
    setSelectedMemberForAssign(memberName);
    setIsAssignStaffModalVisible(true);
  };

  const handleAssignStaff = (staffName) => {
    if (!selectedMemberForAssign) return;
    setUserProfiles((prev) => ({
      ...prev,
      [selectedMemberForAssign]: {
        ...(prev[selectedMemberForAssign] || {}),
        assignedStaff: staffName === "未設定" ? null : staffName,
      },
    }));
    setIsAssignStaffModalVisible(false);
    setSelectedMemberForAssign(null);
  };

  const handleOpenStaffScopeModal = (staffName) => {
    setSelectedStaffForScope(staffName);
    setIsStaffScopeModalVisible(true);
  };

  const handleStaffScope = (scope) => {
    if (!selectedStaffForScope) return;
    setUserProfiles((prev) => ({
      ...prev,
      [selectedStaffForScope]: {
        ...(prev[selectedStaffForScope] || {}),
        staffScope: scope,
      },
    }));
    setIsStaffScopeModalVisible(false);
    setSelectedStaffForScope(null);
  };

  const copyToClipboard = (text, label) => {
    Clipboard.setString(text);
    Alert.alert(
      "コピー完了",
      `${label}をコピーしました。部員に送ってください。`,
    );
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
                title="🔑 自分専用パスワードの設定"
              >
                <Text style={styles.subText}>
                  チーム共通パスワードの代わりに、自分だけがログインできる秘密のパスワードを設定します。
                </Text>
                <Text style={styles.label}>自分専用パスワード</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="未設定"
                    secureTextEntry={!showMyPassword}
                    value={myPassword}
                    onChangeText={setMyPassword}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowMyPassword(!showMyPassword)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showMyPassword ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    { backgroundColor: "#3498db", marginTop: 5 },
                  ]}
                  onPress={handleSaveMemberPassword}
                >
                  <Text style={styles.saveBtnText}>パスワードを設定</Text>
                </TouchableOpacity>
              </SectionCard>
            </>
          ) : (
            <>
              <Text style={styles.sectionDescription}>
                チームの管理・設定を行うことができます。
              </Text>

              {/* Profile setup for admin */}
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
                title="🏟️ 所属チーム・入部用コード"
              >
                <View style={styles.idInfoBox}>
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
              </SectionCard>

              <SectionCard
                isExp={expanded.alert}
                onToggle={() => toggleSection("alert")}
                title="🚨 メディカル・アラート基準"
              >
                <Text style={styles.subText}>
                  コンディション一覧で「注意(黄)」「危険(赤)」になる数値を設定します。
                </Text>
                <ThresholdSelector
                  label="疲労度「注意」の基準 (10段階中)"
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
                  label="疲労度「危険」の基準 (10段階中)"
                  value={alertThresholds.fatigueDanger}
                  min={alertThresholds.fatigueWarning + 1}
                  max={10}
                  onChange={(v) =>
                    setAlertThresholds({ ...alertThresholds, fatigueDanger: v })
                  }
                />
                <ThresholdSelector
                  label="痛み「危険」の基準 (10段階中)"
                  value={alertThresholds.painDanger}
                  min={1}
                  max={10}
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
                isExp={expanded.password}
                onToggle={() => toggleSection("password")}
                title="🔑 チームパスワード設定"
              >
                <Text style={styles.label}>管理者・スタッフ用パスワード</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    value={newAdminPass}
                    onChangeText={setNewAdminPass}
                    secureTextEntry={!showAdminPass}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowAdminPass(!showAdminPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showAdminPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.label}>部員用共通パスワード（初期）</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={styles.passwordInput}
                    value={newMemberPass}
                    onChangeText={setNewMemberPass}
                    secureTextEntry={!showMemberPass}
                  />
                  <TouchableOpacity
                    style={styles.toggleBtn}
                    onPress={() => setShowMemberPass(!showMemberPass)}
                  >
                    <Text style={styles.toggleBtnText}>
                      {showMemberPass ? "隠す" : "表示"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSavePasswords}
                >
                  <Text style={styles.saveBtnText}>パスワードを保存</Text>
                </TouchableOpacity>
              </SectionCard>

              <SectionCard
                isExp={expanded.member}
                onToggle={() => toggleSection("member")}
                title="👥 部員リスト・権限・担当管理"
              >
                <View style={styles.addMemberRow}>
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="新しい部員の名前"
                    value={newMemberName}
                    onChangeText={setNewMemberName}
                  />
                  <TouchableOpacity
                    style={styles.addMemberBtn}
                    onPress={() =>
                      handleAddItemLocal(
                        newMemberName,
                        clubMembers,
                        setClubMembers,
                        setNewMemberName,
                        "部員",
                      )
                    }
                  >
                    <Text style={styles.addMemberBtnText}>追加</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.memberList}>
                  {clubMembers.map((name) => {
                    const profile = userProfiles[name] || {};
                    const memberRole = profile.role || "member";
                    const roleData = roleConfig[memberRole];
                    const assignedStaff = profile.assignedStaff || "未設定";
                    const staffScope = profile.staffScope || "all";

                    return (
                      <View key={name} style={styles.memberItem}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.memberName}>{name}</Text>
                          <TouchableOpacity
                            onPress={() =>
                              handleDeleteItemLocal(
                                name,
                                clubMembers,
                                setClubMembers,
                                "部員",
                              )
                            }
                          >
                            <Text style={styles.deleteText}>削除</Text>
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
                            onPress={() => handleOpenRoleModal(name)}
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
                              onPress={() => handleOpenAssignStaffModal(name)}
                            >
                              <Text style={styles.subSettingText}>
                                担当: {assignedStaff} ▾
                              </Text>
                            </TouchableOpacity>
                          )}
                          {memberRole === "staff" && (
                            <TouchableOpacity
                              style={styles.subSettingBadge}
                              onPress={() => handleOpenStaffScopeModal(name)}
                            >
                              <Text style={styles.subSettingText}>
                                閲覧:{" "}
                                {staffScope === "all" ? "全体" : "担当のみ"} ▾
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })}
                  {clubMembers.length === 0 && (
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
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={isRoleModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {selectedMemberForRole} の権限を変更
            </Text>
            {userRole === "owner" && (
              <TouchableOpacity
                style={[
                  styles.roleSelectBtn,
                  userProfiles[selectedMemberForRole]?.role === "staff" &&
                    styles.roleSelectBtnActive,
                ]}
                onPress={() => handleChangeRole("staff")}
              >
                <Text style={styles.roleSelectTitle}>🎓 スタッフ</Text>
                <Text style={styles.roleSelectDesc}>
                  監督と同等の権限を持ちます。通報の閲覧やメディカル管理、プロジェクトの消去が可能です。
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                userProfiles[selectedMemberForRole]?.role === "captain" &&
                  styles.roleSelectBtnActive,
              ]}
              onPress={() => handleChangeRole("captain")}
            >
              <Text style={styles.roleSelectTitle}>⭐ キャプテン</Text>
              <Text style={styles.roleSelectDesc}>
                プロジェクトの作成や消去、全体への連絡が可能です。他メンバーの通報・メディカルは見られません。
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                (userProfiles[selectedMemberForRole]?.role === "member" ||
                  !userProfiles[selectedMemberForRole]?.role) &&
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
              onPress={() => setIsRoleModalVisible(false)}
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
              {selectedMemberForAssign} の担当スタッフを設定
            </Text>
            <ScrollView style={{ maxHeight: 200, marginBottom: 15 }}>
              <TouchableOpacity
                style={styles.optionBtnFull}
                onPress={() => handleAssignStaff("未設定")}
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
                    key={staff}
                    style={styles.optionBtnFull}
                    onPress={() => handleAssignStaff(staff)}
                  >
                    <Text style={styles.optionTextFull}>{staff}</Text>
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
              {selectedStaffForScope} の閲覧範囲を設定
            </Text>
            <Text style={styles.settingHint}>
              日記やメディカル情報をどこまで閲覧できるか設定します。
            </Text>
            <TouchableOpacity
              style={[
                styles.roleSelectBtn,
                (userProfiles[selectedStaffForScope]?.staffScope === "all" ||
                  !userProfiles[selectedStaffForScope]?.staffScope) &&
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
                userProfiles[selectedStaffForScope]?.staffScope ===
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
  subSettingText: { fontSize: 10, color: "#666", fontWeight: "bold" },
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
  roleSelectBtnActive: { backgroundColor: "#ebf5fb", borderColor: "#3498db" },
  roleSelectTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 6,
  },
  roleSelectDesc: { fontSize: 12, color: "#666", lineHeight: 18 },
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
  cancelBtn: { marginTop: 10, paddingVertical: 12, alignItems: "center" },
  cancelBtnText: { fontSize: 15, fontWeight: "bold", color: "#888" },
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
});

export default SettingsScreen;
