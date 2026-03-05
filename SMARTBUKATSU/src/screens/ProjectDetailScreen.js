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
import { Video, ResizeMode } from "expo-av";
import * as ImagePicker from "expo-image-picker";

const QUICK_TAGS = [
  "👍 ナイスプレイ",
  "🤔 要改善",
  "🏃 スプリント",
  "🎯 チャンス",
  "⚠️ ピンチ",
];

const ProjectDetailScreen = ({ route, navigation, clubMembers }) => {
  // ★変更：List画面で選択されたロールを受け取る（デフォルトはmember）
  const { project, userRole = "member" } = route.params || {};
  const projectTitle = project ? project.title : "未定のプロジェクト";

  // ★追加：ロールに応じた権限定義と表示名
  const canEditSettings = ["owner", "staff"].includes(userRole);
  const canDeleteAnyTag = ["owner", "staff"].includes(userRole);

  const roleNameMap = {
    owner: "監督",
    staff: "コーチ",
    captain: "キャプテン",
    member: "佐藤(自分)",
  };
  const displayUserName = roleNameMap[userRole];

  // --- 動画プレイヤー用のステート ---
  const [videoUri, setVideoUri] = useState(null);
  const [inputUrl, setInputUrl] = useState("");
  const [isUrlModalVisible, setIsUrlModalVisible] = useState(false);
  const [videoDuration, setVideoDuration] = useState(15 * 60);
  const videoRef = useRef(null);

  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activeTab, setActiveTab] = useState("highlight");

  const [isSettingsModalVisible, setIsSettingsModalVisible] = useState(false);
  const [shareScope, setShareScope] = useState("team");

  // --- ハイライト再生の設定用ステート ---
  const [preRoll, setPreRoll] = useState(5);
  const [postRoll, setPostRoll] = useState(5);

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

  const [chats, setChats] = useState([
    {
      id: "1",
      user: "監督",
      text: "試合お疲れ様。[01:15] のディフェンスの動きについて確認してほしい。",
      time: "10:00",
    },
    {
      id: "2",
      user: "佐藤(自分)",
      text: "[01:15] の場面ですね。カバーが遅れてしまいました。",
      time: "10:15",
    },
  ]);
  const [newChatText, setNewChatText] = useState("");
  const chatScrollRef = useRef(null);

  const [tags, setTags] = useState([
    { id: "t1", videoTime: 15, label: "👍 ナイスプレイ", user: "監督" },
    { id: "t2", videoTime: 75, label: "🤔 要改善", user: "佐藤(自分)" },
    { id: "t3", videoTime: 120, label: "👍 ナイスプレイ", user: "キャプテン" },
    { id: "t4", videoTime: 300, label: "🎯 チャンス", user: "コーチ" },
  ]);

  const [memos, setMemos] = useState([
    {
      id: "m1",
      videoTime: 0,
      text: "立ち上がりのフォーメーションが全体的に低い。",
      user: "監督",
    },
  ]);
  const [newMemoText, setNewMemoText] = useState("");

  const [highlightFilter, setHighlightFilter] = useState("all");

  const uniqueTagLabels = Array.from(new Set(tags.map((t) => t.label)));
  const filteredHighlights =
    highlightFilter === "all"
      ? tags
      : tags.filter((t) => t.label === highlightFilter);

  const [isPlaylistActive, setIsPlaylistActive] = useState(false);
  const playlistRef = useRef({
    active: false,
    index: 0,
    endTime: 0,
    highlights: [],
  });

  // --- プレイリスト連続再生用ロジック ---
  const startPlaylist = async () => {
    if (filteredHighlights.length === 0) {
      Alert.alert("エラー", "再生するハイライトがありません。");
      return;
    }
    const firstClip = filteredHighlights[0];

    const startTime = Math.max(firstClip.videoTime - preRoll, 0);
    const endTime = firstClip.videoTime + postRoll;

    playlistRef.current = {
      active: true,
      index: 0,
      endTime: endTime,
      highlights: filteredHighlights,
    };
    setIsPlaylistActive(true);

    if (videoUri && videoRef.current) {
      await videoRef.current.setPositionAsync(startTime * 1000);
      await videoRef.current.playAsync();
    } else {
      setVideoTime(startTime);
      setIsPlaying(true);
    }
  };

  const stopPlaylist = () => {
    playlistRef.current.active = false;
    setIsPlaylistActive(false);
    if (videoUri && videoRef.current) {
      videoRef.current.pauseAsync();
    } else {
      setIsPlaying(false);
    }
  };

  const cancelPlaylistIfActive = () => {
    if (playlistRef.current.active) {
      playlistRef.current.active = false;
      setIsPlaylistActive(false);
    }
  };

  // --- 動画プレイヤー用ロジック ---
  useEffect(() => {
    let interval;
    if (isPlaying && !videoUri) {
      interval = setInterval(() => {
        setVideoTime((prev) => {
          const nextTime = prev + 1;

          if (playlistRef.current.active) {
            if (nextTime >= playlistRef.current.endTime) {
              const nextIndex = playlistRef.current.index + 1;
              if (nextIndex < playlistRef.current.highlights.length) {
                const nextClip = playlistRef.current.highlights[nextIndex];
                playlistRef.current.index = nextIndex;
                playlistRef.current.endTime = nextClip.videoTime + postRoll;
                return Math.max(nextClip.videoTime - preRoll, 0);
              } else {
                playlistRef.current.active = false;
                setIsPlaylistActive(false);
                setIsPlaying(false);
                Alert.alert(
                  "プレイリスト終了",
                  "すべてのハイライトの再生が完了しました。",
                );
                return prev;
              }
            }
          }
          return nextTime;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, videoUri, preRoll, postRoll]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (Math.floor(seconds) % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const handlePlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      const currentTime = Math.floor(status.positionMillis / 1000);
      setVideoTime(currentTime);
      setIsPlaying(status.isPlaying);
      if (status.durationMillis) {
        setVideoDuration(Math.floor(status.durationMillis / 1000));
      }

      if (playlistRef.current.active && status.isPlaying) {
        if (currentTime >= playlistRef.current.endTime) {
          const nextIndex = playlistRef.current.index + 1;
          if (nextIndex < playlistRef.current.highlights.length) {
            const nextClip = playlistRef.current.highlights[nextIndex];
            const startTime = Math.max(nextClip.videoTime - preRoll, 0);
            playlistRef.current.index = nextIndex;
            playlistRef.current.endTime = nextClip.videoTime + postRoll;
            videoRef.current.setPositionAsync(startTime * 1000);
          } else {
            playlistRef.current.active = false;
            setIsPlaylistActive(false);
            videoRef.current.pauseAsync();
            Alert.alert(
              "プレイリスト終了",
              "すべてのハイライトの再生が完了しました。",
            );
          }
        }
      }
    }
  };

  const togglePlay = async () => {
    cancelPlaylistIfActive();
    if (videoUri && videoRef.current) {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
      } else {
        await videoRef.current.playAsync();
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const jumpToTime = async (seconds) => {
    cancelPlaylistIfActive();
    if (videoUri && videoRef.current) {
      await videoRef.current.setPositionAsync(seconds * 1000);
      await videoRef.current.playAsync();
    } else {
      setVideoTime(seconds);
      setIsPlaying(false);
    }
  };

  const skipBackward = async () => {
    cancelPlaylistIfActive();
    if (videoUri && videoRef.current) {
      const newTime = Math.max(videoTime - 5, 0);
      await videoRef.current.setPositionAsync(newTime * 1000);
      setVideoTime(newTime);
    } else {
      setVideoTime((prev) => Math.max(prev - 5, 0));
    }
  };

  const skipForward = async () => {
    cancelPlaylistIfActive();
    if (videoUri && videoRef.current) {
      const newTime = Math.min(videoTime + 5, videoDuration);
      await videoRef.current.setPositionAsync(newTime * 1000);
      setVideoTime(newTime);
    } else {
      setVideoTime((prev) => Math.min(prev + 5, videoDuration));
    }
  };

  const pickVideoFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setVideoUri(result.assets[0].uri);
      }
    } catch (error) {
      Alert.alert("エラー", "動画の読み込みに失敗しました");
    }
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
          {/* ★変更：設定ボタンは「監督・スタッフ」のみ表示（キャプテン・部員は非表示） */}
          {canEditSettings ? (
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
          {videoUri ? (
            <Video
              ref={videoRef}
              source={{ uri: videoUri }}
              style={styles.videoComponent}
              resizeMode={ResizeMode.CONTAIN}
              onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
              useNativeControls={false}
              isMuted={isMuted}
            />
          ) : (
            <View style={styles.videoSetupContainer}>
              <Text style={styles.videoPlaceholderText}>
                ※ ここに動画が表示されます
              </Text>
              <View style={styles.setupBtnRow}>
                <TouchableOpacity
                  style={styles.setupBtn}
                  onPress={pickVideoFromGallery}
                >
                  <Text style={styles.setupBtnText}>📸 カメラロール</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.setupBtn}
                  onPress={() => setIsUrlModalVisible(true)}
                >
                  <Text style={styles.setupBtnText}>🔗 URL</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.videoControls}>
            <TouchableOpacity style={styles.skipBtn} onPress={skipBackward}>
              <Text style={styles.skipBtnText}>⏪ 5s</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
              <Text style={styles.playBtnText}>{isPlaying ? "⏸" : "▶"}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipBtn} onPress={skipForward}>
              <Text style={styles.skipBtnText}>5s ⏩</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.muteBtn}
              onPress={() => setIsMuted(!isMuted)}
            >
              <Text style={styles.muteBtnText}>{isMuted ? "🔇" : "🔊"}</Text>
            </TouchableOpacity>

            <Text style={styles.videoTimeDisplay}>
              {formatTime(videoTime)} / {formatTime(videoDuration)}
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
          {/* ハイライトタブ */}
          {activeTab === "highlight" && (
            <View style={{ flex: 1, backgroundColor: "#f0f2f5" }}>
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

              <View style={styles.playAllContainer}>
                <TouchableOpacity
                  style={[
                    styles.playAllBtn,
                    isPlaylistActive && styles.playAllBtnActive,
                  ]}
                  onPress={isPlaylistActive ? stopPlaylist : startPlaylist}
                >
                  <Text style={styles.playAllBtnText}>
                    {isPlaylistActive
                      ? "⏹ 連続再生を停止"
                      : `▶ プレイリストを連続再生 (${filteredHighlights.length} クリップ)`}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.playAllHint}>
                  ※タグ付けされた時間の{preRoll}秒前から{postRoll}
                  秒後までを順に再生します
                </Text>
              </View>

              <ScrollView style={styles.listScroll}>
                {filteredHighlights.length === 0 ? (
                  <Text style={styles.emptyText}>
                    該当するシーンがありません。
                  </Text>
                ) : (
                  filteredHighlights.map((highlight, index) => (
                    <TouchableOpacity
                      key={highlight.id}
                      style={[
                        styles.highlightCard,
                        isPlaylistActive &&
                          playlistRef.current.index === index &&
                          styles.highlightCardActive,
                      ]}
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

          {/* チャットタブ */}
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

          {/* タグタブ */}
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
                      {/* ★変更：自分が追加したタグ、または「監督・スタッフ」のみ消去可能 */}
                      {(canDeleteAnyTag || tag.user === displayUserName) && (
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

          {/* メモタブ */}
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
                      {/* ★変更：自分が追加したメモ、または「監督・スタッフ」のみ消去可能 */}
                      {(canDeleteAnyTag || memo.user === displayUserName) && (
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

      {/* URL入力モーダル */}
      <Modal
        visible={isUrlModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>動画のURLを入力</Text>
            <TextInput
              style={styles.modalInputField}
              placeholder="https://... (.mp4など)"
              value={inputUrl}
              onChangeText={setInputUrl}
              autoCapitalize="none"
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
                onPress={() => setIsUrlModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => {
                  if (inputUrl.trim()) setVideoUri(inputUrl.trim());
                  setIsUrlModalVisible(false);
                }}
              >
                <Text style={styles.addBtnText}>読み込む</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 設定・共有モーダル */}
      <Modal
        visible={isSettingsModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>設定</Text>

            <View style={styles.settingSection}>
              <Text style={styles.label}>プロジェクト共有設定</Text>
              <Text style={styles.settingHint}>
                誰がこのプロジェクトを見れますか？
              </Text>
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
            </View>

            <View style={styles.settingSection}>
              <Text style={styles.label}>ハイライト再生設定</Text>
              <Text style={styles.settingHint}>
                タグが付けられた時間の前後何秒を再生するか設定します。
              </Text>

              <View style={styles.numberSettingRow}>
                <Text style={styles.numberSettingLabel}>
                  再生開始 (タグの何秒前か):
                </Text>
                <View style={styles.numberInputWrapper}>
                  <TextInput
                    style={styles.numberInput}
                    value={String(preRoll)}
                    keyboardType="numeric"
                    onChangeText={(txt) => setPreRoll(Number(txt) || 0)}
                  />
                  <Text style={styles.numberInputUnit}>秒</Text>
                </View>
              </View>

              <View style={styles.numberSettingRow}>
                <Text style={styles.numberSettingLabel}>
                  再生終了 (タグの何秒後か):
                </Text>
                <View style={styles.numberInputWrapper}>
                  <TextInput
                    style={styles.numberInput}
                    value={String(postRoll)}
                    keyboardType="numeric"
                    onChangeText={(txt) => setPostRoll(Number(txt) || 0)}
                  />
                  <Text style={styles.numberInputUnit}>秒</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setIsSettingsModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>完了</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* タグ追加モーダル */}
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
              style={styles.modalInputField}
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
  videoComponent: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
  videoSetupContainer: {
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  videoPlaceholderText: {
    color: "#888",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 15,
  },
  setupBtnRow: { flexDirection: "row", gap: 10 },
  setupBtn: {
    backgroundColor: "rgba(255,255,255,0.8)",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginHorizontal: 5,
  },
  setupBtnText: { color: "#333", fontWeight: "bold", fontSize: 12 },

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
    zIndex: 20,
  },
  playBtn: { marginRight: 10 },
  playBtnText: { color: "#fff", fontSize: 24 },
  skipBtn: { marginHorizontal: 10 },
  skipBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },

  muteBtn: { marginLeft: 10 },
  muteBtnText: { color: "#fff", fontSize: 20 },

  videoTimeDisplay: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "bold",
    fontFamily: "monospace",
    marginLeft: "auto",
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
  playAllBtnActive: {
    backgroundColor: "#555",
    shadowColor: "#333",
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
  highlightCardActive: {
    borderColor: "#0077cc",
    borderWidth: 2,
    backgroundColor: "#e6f2ff",
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

  emptyText: { textAlign: "center", color: "#888", marginTop: 30 },

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
    maxHeight: "80%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#333",
    textAlign: "center",
  },
  modalInputField: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },

  settingSection: {
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    paddingBottom: 15,
  },
  label: { fontSize: 15, fontWeight: "bold", color: "#333", marginBottom: 5 },
  settingHint: { fontSize: 12, color: "#888", marginBottom: 10 },
  shareOption: {
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#eee",
  },
  shareOptionActive: { backgroundColor: "#e6f2ff", borderColor: "#0077cc" },
  shareOptionText: { fontSize: 14, color: "#555", fontWeight: "bold" },
  shareOptionTextActive: { color: "#0077cc" },

  numberSettingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    backgroundColor: "#f9f9f9",
    padding: 10,
    borderRadius: 8,
  },
  numberSettingLabel: { fontSize: 14, color: "#555", fontWeight: "bold" },
  numberInputWrapper: { flexDirection: "row", alignItems: "center" },
  numberInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    width: 50,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  numberInputUnit: { fontSize: 14, color: "#555", marginLeft: 8 },

  modalCloseBtn: {
    backgroundColor: "#0077cc",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
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
