import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Keyboard,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const QUICK_TAGS = [
  "👍 ナイスプレイ",
  "🤔 要改善",
  "🏃 スプリント",
  "🎯 チャンス",
  "⚠️ ピンチ",
];

const ProjectDetailScreen = ({
  route,
  navigation,
  isAdmin,
  currentUser,
  clubMembers,
}) => {
  const { project } = route.params || {};
  const projectTitle = project ? project.title : "未定のプロジェクト";

  const displayUserName = isAdmin ? "管理者(監督)" : currentUser;

  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTab, setActiveTab] = useState("highlight"); // 確認しやすいよう初期タブをハイライトに設定

  const [isSettingsModalVisible, setIsSettingsModalVisible] = useState(false);
  const [shareScope, setShareScope] = useState("team");

  // --- クイックタグ（ボタン）のステート ---
  const [quickTags, setQuickTags] = useState([
    "👍 ナイスプレイ",
    "🤔 要改善",
    "🏃 スプリント",
    "🎯 チャンス",
    "⚠️ ピンチ",
  ]);
  const [isAddQuickTagModalVisible, setIsAddQuickTagModalVisible] =
    useState(false);
  const [newQuickTagName, setNewQuickTagName] = useState("");

  // --- 各タブのステート ---
  const [chats, setChats] = useState([
    {
      id: "1",
      user: "管理者(監督)",
      text: "試合お疲れ様。[01:15] のディフェンスの動きについて確認してほしい。",
      time: "10:00",
    },
    {
      id: "2",
      user: "佐藤",
      text: "[01:15] の場面ですね。カバーが遅れてしまいました。",
      time: "10:15",
    },
  ]);
  const [newChatText, setNewChatText] = useState("");
  const chatScrollRef = useRef(null);

  const [tags, setTags] = useState([
    { id: "t1", videoTime: 15, label: "👍 ナイスプレイ", user: "管理者(監督)" },
    { id: "t2", videoTime: 75, label: "🤔 要改善", user: "佐藤" },
    { id: "t3", videoTime: 120, label: "👍 ナイスプレイ", user: "鈴木" },
    { id: "t4", videoTime: 300, label: "🎯 チャンス", user: "管理者(監督)" },
  ]);

  const [memos, setMemos] = useState([
    {
      id: "m1",
      videoTime: 0,
      text: "立ち上がりのフォーメーションが全体的に低い。",
      user: "管理者(監督)",
    },
  ]);
  const [newMemoText, setNewMemoText] = useState("");

  // ★追加：ハイライト用のフィルターステート
  const [highlightFilter, setHighlightFilter] = useState("all");

  // --- 動画プレイヤー用ロジック ---
  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        setVideoTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const jumpToTime = (seconds) => {
    setVideoTime(seconds);
    setIsPlaying(false);
  };

  // --- チャット処理 ---
  const handleInsertTimestamp = () => {
    setNewChatText((prev) => prev + `[${formatTime(videoTime)}] `);
  };

  const handleSendChat = () => {
    if (newChatText.trim() === "") return;
    const newChat = {
      id: Date.now().toString(),
      user: displayUserName,
      text: newChatText,
      time: "たった今",
    };
    setChats([...chats, newChat]);
    setNewChatText("");
    Keyboard.dismiss();
    setTimeout(
      () => chatScrollRef.current?.scrollToEnd({ animated: true }),
      200,
    );
  };

  const renderChatText = (text) => {
    const regex = /\[(\d{2}:\d{2})\]/g;
    const parts = text.split(regex);
    return (
      <Text style={styles.chatText}>
        {parts.map((part, index) => {
          if (index % 2 === 1) {
            return (
              <Text
                key={index}
                style={styles.timestampLink}
                onPress={() => {
                  const [m, s] = part.split(":");
                  jumpToTime(parseInt(m, 10) * 60 + parseInt(s, 10));
                }}
              >
                [{part}]
              </Text>
            );
          }
          return <Text key={index}>{part}</Text>;
        })}
      </Text>
    );
  };

  // --- タグ処理 ---
  const handleAddTag = (label) => {
    const newTag = {
      id: "tag_" + Date.now(),
      videoTime,
      label,
      user: displayUserName,
    };
    const newTags = [...tags, newTag].sort((a, b) => a.videoTime - b.videoTime);
    setTags(newTags);
  };

  const handleDeleteTag = (id) => {
    setTags(tags.filter((t) => t.id !== id));
  };

  const handleCreateQuickTag = () => {
    const trimmed = newQuickTagName.trim();
    if (trimmed === "") {
      Alert.alert("エラー", "タグの名前を入力してください。");
      return;
    }
    if (quickTags.includes(trimmed)) {
      Alert.alert("エラー", "そのタグは既に存在します。");
      return;
    }
    setQuickTags([...quickTags, trimmed]);
    setNewQuickTagName("");
    setIsAddQuickTagModalVisible(false);
  };

  // --- メモ処理 ---
  const handleAddMemo = () => {
    if (newMemoText.trim() === "") return;
    const newMemo = {
      id: "memo_" + Date.now(),
      videoTime,
      text: newMemoText,
      user: displayUserName,
    };
    const newMemos = [...memos, newMemo].sort(
      (a, b) => a.videoTime - b.videoTime,
    );
    setMemos(newMemos);
    setNewMemoText("");
    Keyboard.dismiss();
  };

  const handleDeleteMemo = (id) => {
    setMemos(memos.filter((m) => m.id !== id));
  };

  // ★追加：ハイライト表示用のデータ抽出ロジック
  const uniqueTagLabels = Array.from(new Set(tags.map((t) => t.label)));
  const filteredHighlights =
    highlightFilter === "all"
      ? tags
      : tags.filter((t) => t.label === highlightFilter);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>◁ 戻る</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {projectTitle}
          </Text>
          {isAdmin ? (
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={() => setIsSettingsModalVisible(true)}
            >
              <Text style={styles.settingsBtnIcon}>⚙️</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        <View style={styles.videoPlayerArea}>
          <Text style={styles.videoPlaceholderText}>
            ※ ここに動画が表示されます
          </Text>
          <View style={styles.videoControls}>
            <TouchableOpacity
              style={styles.playBtn}
              onPress={() => setIsPlaying(!isPlaying)}
            >
              <Text style={styles.playBtnText}>{isPlaying ? "⏸" : "▶"}</Text>
            </TouchableOpacity>
            <Text style={styles.videoTimeDisplay}>
              {formatTime(videoTime)} / 15:00
            </Text>
          </View>
        </View>

        <View style={styles.tabContainer}>
          {[
            { id: "tag", label: "動画/タグ" },
            { id: "highlight", label: "ハイライト" },
            { id: "chat", label: "チャット" },
            { id: "memo", label: "メモ" },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tab, isActive && styles.activeTab]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Text
                  style={[styles.tabText, isActive && styles.activeTabText]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.tabContentArea}>
          {/* ==============================================
              ハイライトタブ（完成版）
          ============================================== */}
          {activeTab === "highlight" && (
            <View style={{ flex: 1, backgroundColor: "#f0f2f5" }}>
              {/* フィルターバー */}
              <View style={styles.highlightFilterArea}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <TouchableOpacity
                    style={[
                      styles.filterTagBtn,
                      highlightFilter === "all" && styles.filterTagBtnActive,
                    ]}
                    onPress={() => setHighlightFilter("all")}
                  >
                    <Text
                      style={[
                        styles.filterTagBtnText,
                        highlightFilter === "all" &&
                          styles.filterTagBtnTextActive,
                      ]}
                    >
                      すべて
                    </Text>
                  </TouchableOpacity>
                  {uniqueTagLabels.map((label) => (
                    <TouchableOpacity
                      key={label}
                      style={[
                        styles.filterTagBtn,
                        highlightFilter === label && styles.filterTagBtnActive,
                      ]}
                      onPress={() => setHighlightFilter(label)}
                    >
                      <Text
                        style={[
                          styles.filterTagBtnText,
                          highlightFilter === label &&
                            styles.filterTagBtnTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* 連続再生ボタン */}
              <View style={styles.playAllContainer}>
                <TouchableOpacity
                  style={styles.playAllBtn}
                  onPress={() =>
                    Alert.alert(
                      "ハイライト再生",
                      "抽出されたシーンを5秒前から順番に連続再生します。(プロトタイプ環境では画面の表示のみとなります)",
                    )
                  }
                >
                  <Text style={styles.playAllBtnText}>
                    ▶ プレイリストを連続再生 ({filteredHighlights.length}
                    クリップ)
                  </Text>
                </TouchableOpacity>
                <Text style={styles.playAllHint}>
                  ※タグ付けされた時間の5秒前から自動再生します
                </Text>
              </View>

              {/* プレイリスト一覧 */}
              <ScrollView style={styles.listScroll}>
                {filteredHighlights.length === 0 ? (
                  <Text style={styles.emptyText}>
                    該当するシーンがありません。
                  </Text>
                ) : (
                  filteredHighlights.map((highlight, index) => (
                    <TouchableOpacity
                      key={highlight.id}
                      style={styles.highlightCard}
                      activeOpacity={0.7}
                      onPress={() => jumpToTime(highlight.videoTime)}
                    >
                      <Text style={styles.highlightIndex}>{index + 1}</Text>
                      <View style={styles.highlightInfo}>
                        <Text style={styles.highlightLabel}>
                          {highlight.label}
                        </Text>
                        <Text style={styles.highlightTimeText}>
                          🕒 {formatTime(highlight.videoTime)} (追加:{" "}
                          {highlight.user})
                        </Text>
                      </View>
                      <View style={styles.timeJumpBtn}>
                        <Text style={styles.timeJumpText}>▶ 再生</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
                <View style={{ height: 30 }} />
              </ScrollView>
            </View>
          )}

          {/* ==============================================
              チャットタブ
          ============================================== */}
          {activeTab === "chat" && (
            <>
              <ScrollView style={styles.chatScroll} ref={chatScrollRef}>
                {chats.map((chat) => {
                  const isMe = chat.user === displayUserName;
                  return (
                    <View
                      key={chat.id}
                      style={[
                        styles.chatBubbleWrapper,
                        isMe ? styles.chatRight : styles.chatLeft,
                      ]}
                    >
                      {!isMe && (
                        <Text style={styles.chatUser}>{chat.user}</Text>
                      )}
                      <View
                        style={[
                          styles.chatBubble,
                          isMe ? styles.chatBubbleMe : styles.chatBubbleOther,
                        ]}
                      >
                        {renderChatText(chat.text)}
                      </View>
                      <Text style={styles.chatTime}>{chat.time}</Text>
                    </View>
                  );
                })}
              </ScrollView>
              <View style={styles.inputContainer}>
                <TouchableOpacity
                  style={styles.timestampBtn}
                  onPress={handleInsertTimestamp}
                >
                  <Text style={styles.timestampBtnText}>
                    ⏱️ {formatTime(videoTime)} を引用
                  </Text>
                </TouchableOpacity>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.inputField}
                    value={newChatText}
                    onChangeText={setNewChatText}
                    placeholder="メッセージを入力..."
                    multiline
                  />
                  <TouchableOpacity
                    style={styles.sendBtn}
                    onPress={handleSendChat}
                  >
                    <Text style={styles.sendBtnText}>送信</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}

          {/* ==============================================
              タグタブ
          ============================================== */}
          {activeTab === "tag" && (
            <>
              <View style={styles.quickTagArea}>
                <Text style={styles.quickTagTitle}>
                  💡 再生中にタップしてタグを追加
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {quickTags.map((tag) => (
                    <TouchableOpacity
                      key={tag}
                      style={styles.quickTagBtn}
                      onPress={() => handleAddTag(tag)}
                    >
                      <Text style={styles.quickTagBtnText}>{tag}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={styles.addQuickTagBtn}
                    onPress={() => setIsAddQuickTagModalVisible(true)}
                  >
                    <Text style={styles.addQuickTagBtnText}>＋ 追加</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
              <ScrollView style={styles.listScroll}>
                {tags.length === 0 ? (
                  <Text style={styles.emptyText}>タグがありません。</Text>
                ) : (
                  tags.map((tag) => (
                    <View key={tag.id} style={styles.listItemCard}>
                      <TouchableOpacity
                        style={styles.timeJumpBtn}
                        onPress={() => jumpToTime(tag.videoTime)}
                      >
                        <Text style={styles.timeJumpText}>
                          ▶ {formatTime(tag.videoTime)}
                        </Text>
                      </TouchableOpacity>
                      <View style={styles.listInfo}>
                        <Text style={styles.listLabelText}>{tag.label}</Text>
                        <Text style={styles.listUserText}>by {tag.user}</Text>
                      </View>
                      {(isAdmin || tag.user === displayUserName) && (
                        <TouchableOpacity
                          style={styles.deleteAction}
                          onPress={() => handleDeleteTag(tag.id)}
                        >
                          <Text style={styles.deleteActionText}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>
            </>
          )}

          {/* ==============================================
              メモタブ
          ============================================== */}
          {activeTab === "memo" && (
            <>
              <ScrollView style={styles.listScroll}>
                {memos.length === 0 ? (
                  <Text style={styles.emptyText}>メモがありません。</Text>
                ) : (
                  memos.map((memo) => (
                    <View key={memo.id} style={styles.listItemCard}>
                      <TouchableOpacity
                        style={styles.timeJumpBtn}
                        onPress={() => jumpToTime(memo.videoTime)}
                      >
                        <Text style={styles.timeJumpText}>
                          ▶ {formatTime(memo.videoTime)}
                        </Text>
                      </TouchableOpacity>
                      <View style={styles.listInfo}>
                        <Text style={styles.listContentText}>{memo.text}</Text>
                        <Text style={styles.listUserText}>by {memo.user}</Text>
                      </View>
                      {(isAdmin || memo.user === displayUserName) && (
                        <TouchableOpacity
                          style={styles.deleteAction}
                          onPress={() => handleDeleteMemo(memo.id)}
                        >
                          <Text style={styles.deleteActionText}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}
              </ScrollView>
              <View style={styles.inputContainer}>
                <Text style={styles.timestampContextText}>
                  ⏱️ {formatTime(videoTime)} のメモを追加
                </Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.inputField}
                    value={newMemoText}
                    onChangeText={setNewMemoText}
                    placeholder="メモを入力..."
                    multiline
                  />
                  <TouchableOpacity
                    style={styles.sendBtn}
                    onPress={handleAddMemo}
                  >
                    <Text style={styles.sendBtnText}>保存</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* モーダル群（設定、タグ追加） */}
      <Modal
        visible={isSettingsModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>プロジェクト共有設定</Text>
            <Text style={styles.label}>誰がこのプロジェクトを見れますか？</Text>

            <TouchableOpacity
              style={[
                styles.shareOption,
                shareScope === "team" && styles.shareOptionActive,
              ]}
              onPress={() => setShareScope("team")}
            >
              <Text
                style={[
                  styles.shareOptionText,
                  shareScope === "team" && styles.shareOptionTextActive,
                ]}
              >
                👥 チーム全員
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.shareOption,
                shareScope === "selected" && styles.shareOptionActive,
              ]}
              onPress={() => setShareScope("selected")}
            >
              <Text
                style={[
                  styles.shareOptionText,
                  shareScope === "selected" && styles.shareOptionTextActive,
                ]}
              >
                👤 選択したメンバーのみ
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.shareOption,
                shareScope === "coach" && styles.shareOptionActive,
              ]}
              onPress={() => setShareScope("coach")}
            >
              <Text
                style={[
                  styles.shareOptionText,
                  shareScope === "coach" && styles.shareOptionTextActive,
                ]}
              >
                🔒 指導者のみ
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setIsSettingsModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>完了</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isAddQuickTagModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>新しいタグボタンを作成</Text>
            <TextInput
              style={styles.inputField}
              placeholder="例: 🔥 ハイプレス"
              value={newQuickTagName}
              onChangeText={setNewQuickTagName}
              autoFocus
            />
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                marginTop: 20,
              }}
            >
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setIsAddQuickTagModalVisible(false);
                  setNewQuickTagName("");
                }}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={handleCreateQuickTag}
              >
                <Text style={styles.addBtnText}>追加する</Text>
              </TouchableOpacity>
            </View>
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
    backgroundColor: "#2c3e50",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  backButton: { width: 60 },
  backButtonText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  settingsBtnIcon: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    padding: 5,
  },

  videoPlayerArea: {
    height: 220,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  videoPlaceholderText: { color: "#555", fontSize: 16, fontWeight: "bold" },
  videoControls: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 10,
    borderRadius: 8,
  },
  playBtn: { marginRight: 15 },
  playBtnText: { color: "#fff", fontSize: 24 },
  videoTimeDisplay: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
    fontFamily: "monospace",
  },

  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  activeTab: { borderBottomColor: "#0077cc" },
  tabText: { fontSize: 13, color: "#666", fontWeight: "bold" },
  activeTabText: { color: "#0077cc" },

  tabContentArea: { flex: 1 },

  // --- ハイライトタブ専用スタイル ---
  highlightFilterArea: {
    backgroundColor: "#fff",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  filterTagBtn: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: "#f0f0f0",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  filterTagBtnActive: { backgroundColor: "#2c3e50", borderColor: "#2c3e50" },
  filterTagBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  filterTagBtnTextActive: { color: "#fff" },
  playAllContainer: {
    padding: 15,
    backgroundColor: "#fafafa",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    alignItems: "center",
  },
  playAllBtn: {
    backgroundColor: "#e74c3c",
    width: "100%",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    shadowColor: "#e74c3c",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  playAllBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  playAllHint: { fontSize: 11, color: "#888", marginTop: 8 },
  highlightCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#eee",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  highlightIndex: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#ccc",
    width: 35,
  },
  highlightInfo: { flex: 1, paddingRight: 10 },
  highlightLabel: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  highlightTimeText: { fontSize: 12, color: "#888", fontWeight: "bold" },

  // --- チャット用 ---
  chatScroll: { flex: 1, padding: 15 },
  chatBubbleWrapper: { marginBottom: 15, maxWidth: "85%" },
  chatRight: { alignSelf: "flex-end", alignItems: "flex-end" },
  chatLeft: { alignSelf: "flex-start", alignItems: "flex-start" },
  chatUser: { fontSize: 11, color: "#666", marginBottom: 4, marginLeft: 5 },
  chatBubble: { padding: 12, borderRadius: 15 },
  chatBubbleMe: { backgroundColor: "#0077cc", borderBottomRightRadius: 0 },
  chatBubbleOther: {
    backgroundColor: "#fff",
    borderBottomLeftRadius: 0,
    borderWidth: 1,
    borderColor: "#eee",
  },
  chatText: { fontSize: 15, color: "#333", lineHeight: 22 },
  chatTime: { fontSize: 10, color: "#aaa", marginTop: 4 },
  timestampLink: {
    color: "#e74c3c",
    fontWeight: "bold",
    textDecorationLine: "underline",
  },

  // --- 入力エリア共通 ---
  inputContainer: {
    backgroundColor: "#fff",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
  },
  timestampBtn: {
    alignSelf: "flex-start",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#ccc",
  },
  timestampBtnText: { fontSize: 12, color: "#333", fontWeight: "bold" },
  timestampContextText: {
    fontSize: 12,
    color: "#e74c3c",
    fontWeight: "bold",
    marginBottom: 10,
    marginLeft: 5,
  },
  inputRow: { flexDirection: "row", alignItems: "flex-end" },
  inputField: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 100,
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#eee",
  },
  sendBtn: {
    marginLeft: 10,
    backgroundColor: "#0077cc",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 15,
    justifyContent: "center",
    height: 40,
  },
  sendBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },

  // --- タグ・メモリスト共通 ---
  listScroll: { flex: 1, padding: 15 },
  listItemCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    elevation: 1,
    borderWidth: 1,
    borderColor: "#eee",
    alignItems: "center",
  },
  timeJumpBtn: {
    backgroundColor: "#e6f2ff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 15,
    marginRight: 15,
  },
  timeJumpText: { color: "#0077cc", fontWeight: "bold", fontSize: 13 },
  listInfo: { flex: 1 },
  listLabelText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  listContentText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
    lineHeight: 20,
  },
  listUserText: { fontSize: 11, color: "#888" },
  deleteAction: { padding: 10 },
  deleteActionText: { color: "#aaa", fontSize: 16, fontWeight: "bold" },

  // --- タグ用上部エリア ---
  quickTagArea: {
    backgroundColor: "#fff",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  quickTagTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#888",
    marginBottom: 10,
    marginLeft: 5,
  },
  quickTagBtn: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  quickTagBtnText: { fontSize: 13, color: "#333", fontWeight: "bold" },
  addQuickTagBtn: {
    backgroundColor: "#e6f2ff",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#0077cc",
    borderStyle: "dashed",
  },
  addQuickTagBtnText: { fontSize: 13, color: "#0077cc", fontWeight: "bold" },

  emptyTabText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 10,
  },
  emptyText: { textAlign: "center", color: "#888", marginTop: 30 },

  // --- モーダル共通 ---
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#333",
  },
  label: { fontSize: 14, fontWeight: "bold", color: "#555", marginBottom: 10 },
  shareOption: {
    padding: 15,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#eee",
  },
  shareOptionActive: { backgroundColor: "#e6f2ff", borderColor: "#0077cc" },
  shareOptionText: { fontSize: 14, color: "#555", fontWeight: "bold" },
  shareOptionTextActive: { color: "#0077cc" },
  modalCloseBtn: {
    backgroundColor: "#0077cc",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  modalCloseBtnText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 15, marginRight: 10 },
  cancelBtnText: { color: "#888", fontWeight: "bold", fontSize: 14 },
  addBtn: {
    backgroundColor: "#0077cc",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
});

export default ProjectDetailScreen;
