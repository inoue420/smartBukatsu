import React, { useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// ★修正：入力中にキーボードが閉じるのを防ぐため、部品をメイン関数の外側に移動
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
  grades,
  setGrades,
  positions,
  setPositions,
  alertThresholds,
  setAlertThresholds,
  userProfiles,
  setUserProfiles,
}) => {
  const [newAdminPass, setNewAdminPass] = useState(adminPassword);
  const [newMemberPass, setNewMemberPass] = useState(memberPassword);
  const [showAdminPass, setShowAdminPass] = useState(false);
  const [showMemberPass, setShowMemberPass] = useState(false);

  const [newMemberName, setNewMemberName] = useState("");
  const [newGradeName, setNewGradeName] = useState("");
  const [newPositionName, setNewPositionName] = useState("");

  const [expanded, setExpanded] = useState({
    alert: false,
    password: false,
    member: false,
    grade: false,
    position: false,
    myProfile: true,
    myPassword: false,
  });

  const [myNewName, setMyNewName] = useState(currentUser);
  const [myGrade, setMyGrade] = useState(
    userProfiles[currentUser]?.grade || "",
  );
  const [myPosition, setMyPosition] = useState(
    userProfiles[currentUser]?.position || "",
  );
  const [myPassword, setMyPassword] = useState("");

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

  const handleAddItem = (itemName, list, setList, setNewItemName, label) => {
    const trimmed = itemName.trim();
    if (trimmed === "") return;
    if (list.includes(trimmed)) {
      Alert.alert("エラー", `その${label}は既に登録されています。`);
      return;
    }
    setList([...list, trimmed]);
    setNewItemName("");
  };

  const handleDeleteItem = (itemName, list, setList, label) => {
    Alert.alert(`${label}の削除`, `${itemName} をリストから削除しますか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => setList(list.filter((item) => item !== itemName)),
      },
    ]);
  };

  const handleSaveMemberProfile = () => {
    const trimmedName = myNewName.trim();
    if (trimmedName === "") {
      Alert.alert("エラー", "名前を入力してください。");
      return;
    }

    let updatedProfiles = { ...userProfiles };
    let updatedMembers = [...clubMembers];

    if (trimmedName !== currentUser) {
      if (clubMembers.includes(trimmedName)) {
        Alert.alert("エラー", "その名前は既に他の部員が使用しています。");
        return;
      }
      updatedMembers = updatedMembers.map((m) =>
        m === currentUser ? trimmedName : m,
      );
      updatedProfiles[trimmedName] = {
        ...updatedProfiles[currentUser],
        grade: myGrade,
        position: myPosition,
      };
      delete updatedProfiles[currentUser];
    } else {
      updatedProfiles[currentUser] = {
        ...updatedProfiles[currentUser],
        grade: myGrade,
        position: myPosition,
      };
    }

    setClubMembers(updatedMembers);
    setUserProfiles(updatedProfiles);
    if (trimmedName !== currentUser) {
      setCurrentUser(trimmedName);
    }
    Alert.alert("保存完了", "プロフィールを更新しました。");
  };

  const handleSaveMemberPassword = () => {
    if (myPassword.trim() === "") {
      Alert.alert("エラー", "新しいパスワードを入力してください。");
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
    setMyPassword("");
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
          {!isAdmin ? (
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
                  ※過去の投稿の名前はそのまま残ります。
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
                <TextInput
                  style={styles.input}
                  placeholder="新しいパスワード"
                  secureTextEntry
                  value={myPassword}
                  onChangeText={setMyPassword}
                />
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: "#3498db" }]}
                  onPress={handleSaveMemberPassword}
                >
                  <Text style={styles.saveBtnText}>パスワードを設定</Text>
                </TouchableOpacity>
              </SectionCard>
            </>
          ) : (
            <>
              <Text style={styles.sectionDescription}>
                ※この画面は管理者のみアクセス可能です。タップして設定項目を開いてください。
              </Text>

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
                <Text style={styles.label}>管理者パスワード</Text>
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
                title="👥 部員リスト管理"
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
                      handleAddItem(
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
                  {clubMembers.map((name) => (
                    <View key={name} style={styles.memberItem}>
                      <Text style={styles.memberName}>{name}</Text>
                      <TouchableOpacity
                        onPress={() =>
                          handleDeleteItem(
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
                  ))}
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
                      handleAddItem(
                        newGradeName,
                        grades,
                        setGrades,
                        setNewGradeName,
                        "学年",
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
                          handleDeleteItem(g, grades, setGrades, "学年")
                        }
                      >
                        <Text style={styles.deleteText}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
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
                      handleAddItem(
                        newPositionName,
                        positions,
                        setPositions,
                        setNewPositionName,
                        "ポジション",
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
                          handleDeleteItem(
                            p,
                            positions,
                            setPositions,
                            "ポジション",
                          )
                        }
                      >
                        <Text style={styles.deleteText}>削除</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </SectionCard>
            </>
          )}

          <View style={{ height: 50 }} />
        </ScrollView>
      </KeyboardAvoidingView>
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
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fafafa",
  },
  memberName: { fontSize: 16, color: "#333", fontWeight: "bold" },
  deleteText: { color: "#e74c3c", fontWeight: "bold" },
  emptyText: { padding: 15, textAlign: "center", color: "#888" },
});

export default SettingsScreen;
