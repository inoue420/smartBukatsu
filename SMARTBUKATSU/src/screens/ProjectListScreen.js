import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Video, ResizeMode } from "expo-av";
import YoutubePlayer from "react-native-youtube-iframe";

export default function ProjectListScreen({
  navigation,
  isAdmin,
  currentUser,
  projects,
  setProjects,
  userProfiles,
}) {
  const currentUserProfile = userProfiles[currentUser] || {};
  const userRole = isAdmin ? "owner" : currentUserProfile.role || "member";
  const canCreateProject = ["owner", "staff", "captain"].includes(userRole);

  const [activeTab, setActiveTab] = useState("summary");

  // ==========================================
  // ★変更：実際の projects データからハイライト用データを自動生成
  // ==========================================
  const highlightData = useMemo(() => {
    const data = {};
    projects.forEach((p) => {
      if (p.videoUrl && p.tags && p.tags.length > 0) {
        p.tags.forEach((tag) => {
          if (!data[tag.label]) data[tag.label] = [];
          data[tag.label].push({
            id: tag.id,
            project: p.title,
            url: p.videoUrl,
            start: tag.videoTime,
            end: tag.videoTime + 5, // タグの位置から5秒間再生
            user: tag.user,
          });
        });
      }
    });
    // 再生順（開始時間が早い順）に並び替え
    Object.keys(data).forEach((key) => {
      data[key].sort((a, b) => a.start - b.start);
    });
    return data;
  }, [projects]);

  // タグ一覧（実際にタグ付けされたものだけが表示されます）
  const availableTags = useMemo(
    () => Object.keys(highlightData).sort(),
    [highlightData],
  );

  const [selectedHighlightTag, setSelectedHighlightTag] = useState("");
  const [currentClipIndex, setCurrentClipIndex] = useState(0);

  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef(null);
  const youtubeRef = useRef(null);

  // 初期タグの自動選択
  useEffect(() => {
    if (
      availableTags.length > 0 &&
      (!selectedHighlightTag || !availableTags.includes(selectedHighlightTag))
    ) {
      setSelectedHighlightTag(availableTags[0]);
      setCurrentClipIndex(0);
    }
  }, [availableTags, selectedHighlightTag]);

  const currentClips = highlightData[selectedHighlightTag] || [];
  const currentClip = currentClips[currentClipIndex] || null;

  const extractYoutubeId = (url) => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };
  const ytId = currentClip ? extractYoutubeId(currentClip.url) : null;

  const handleSelectTag = (tag) => {
    setSelectedHighlightTag(tag);
    setCurrentClipIndex(0);
    setIsPlaying(true);
  };

  const handleSelectClip = (index) => {
    setCurrentClipIndex(index);
    setIsPlaying(true);
  };

  const playNextClip = () => {
    if (currentClipIndex < currentClips.length - 1) {
      setCurrentClipIndex((prev) => prev + 1);
    } else {
      setIsPlaying(false);
      if (videoRef.current) videoRef.current.pauseAsync();
    }
  };

  useEffect(() => {
    if (!currentClip) return;
    if (ytId) {
      setTimeout(() => {
        if (youtubeRef.current)
          youtubeRef.current.seekTo(currentClip.start, true);
      }, 500);
    } else {
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.setPositionAsync(currentClip.start * 1000);
          videoRef.current.playAsync();
          setIsPlaying(true);
        }
      }, 300);
    }
  }, [currentClipIndex, selectedHighlightTag]);

  useEffect(() => {
    let interval;
    if (isPlaying && ytId) {
      interval = setInterval(async () => {
        if (youtubeRef.current) {
          const currentTime = await youtubeRef.current.getCurrentTime();
          setVideoTime(Math.floor(currentTime));
          if (currentClip && currentTime >= currentClip.end) {
            playNextClip();
          }
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, ytId, currentClip, currentClipIndex]);

  const handlePlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      const currentTime = Math.floor(status.positionMillis / 1000);
      setVideoTime(currentTime);
      setIsPlaying(status.isPlaying);
      if (currentClip && currentTime >= currentClip.end) {
        playNextClip();
      }
    }
  };

  const onYoutubeStateChange = useCallback((state) => {
    if (state === "playing") setIsPlaying(true);
    else if (state === "paused" || state === "ended") setIsPlaying(false);
  }, []);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (Math.floor(seconds) % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // ==========================================
  // プロジェクト作成ロジック
  // ==========================================
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("試合");
  const [participants, setParticipants] = useState("team");
  const [videoUrl, setVideoUrl] = useState("");

  const handleCreateProject = () => {
    if (title.trim() === "") {
      Alert.alert("エラー", "プロジェクト名を入力してください。");
      return;
    }
    const newProject = {
      id: "p_" + Date.now().toString(),
      title,
      type,
      participants,
      videoUrl: videoUrl.trim(),
      date: new Date().toLocaleDateString("ja-JP"),
      status: "active",
      tags: [], // ★追加：タグとメモの初期データ
      memos: [],
    };
    setProjects([newProject, ...projects]);
    setIsModalVisible(false);
    setTitle("");
    setType("試合");
    setParticipants("team");
    setVideoUrl("");
  };

  const renderProjectItem = ({ item }) => {
    if (
      ["member", "captain"].includes(userRole) &&
      item.participants === "coach"
    )
      return null;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() =>
          navigation.navigate("ProjectDetail", { project: item, userRole })
        }
      >
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.badge,
              item.type === "試合"
                ? styles.badgeMatch
                : item.type === "練習"
                  ? styles.badgePractice
                  : styles.badgeOther,
            ]}
          >
            <Text style={styles.badgeText}>{item.type}</Text>
          </View>
          <Text style={styles.cardTitle}>{item.title}</Text>
        </View>
        <Text style={styles.cardSub}>作成日: {item.date}</Text>
        {item.videoUrl ? (
          <Text style={styles.urlText}>🔗 動画リンクあり</Text>
        ) : (
          <Text style={styles.noUrlText}>※ 動画未設定</Text>
        )}
      </TouchableOpacity>
    );
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
        <Text style={styles.headerTitle}>📁 プロジェクト</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabContainer}>
        {[
          { id: "summary", label: "ハイライトまとめ" },
          { id: "list", label: "プロジェクト一覧" },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.activeTab]}
            onPress={() => {
              setActiveTab(tab.id);
              setIsPlaying(false);
            }}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab.id && styles.activeTabText,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.content}>
        {activeTab === "summary" ? (
          <View style={styles.summaryContainer}>
            <View style={styles.tagSelectorWrapper}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {availableTags.map((tag) => (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.summaryTagBtn,
                      selectedHighlightTag === tag &&
                        styles.summaryTagBtnActive,
                    ]}
                    onPress={() => handleSelectTag(tag)}
                  >
                    <Text
                      style={[
                        styles.summaryTagBtnText,
                        selectedHighlightTag === tag &&
                          styles.summaryTagBtnTextActive,
                      ]}
                    >
                      {tag}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {currentClips.length === 0 ? (
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={styles.emptyText}>
                  タグが付けられたシーンはありません。
                </Text>
                <Text style={styles.emptySubText}>
                  動画詳細画面でタグ付けを行うと、ここに表示されます。
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.videoPlayerArea}>
                  {ytId ? (
                    <View style={styles.youtubeContainer}>
                      <YoutubePlayer
                        ref={youtubeRef}
                        height={200}
                        play={isPlaying}
                        videoId={ytId}
                        onChangeState={onYoutubeStateChange}
                        initialPlayerParams={{ controls: 0, rel: 0 }}
                      />
                    </View>
                  ) : (
                    <Video
                      ref={videoRef}
                      source={{ uri: currentClip.url }}
                      style={styles.videoComponent}
                      resizeMode={ResizeMode.CONTAIN}
                      onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
                      useNativeControls={false}
                      shouldPlay={isPlaying}
                    />
                  )}
                  <View style={styles.videoOverlay}>
                    <Text style={styles.overlayProjectName}>
                      {currentClip.project}
                    </Text>
                    <Text style={styles.overlayTag}>
                      🏷️ {selectedHighlightTag}
                    </Text>
                  </View>
                </View>

                <View style={styles.playlistHeader}>
                  <Text style={styles.playlistTitle}>
                    連続再生リスト ({currentClips.length}件)
                  </Text>
                  <Text style={styles.playlistSub}>
                    ※再生が終わると自動で次に進みます
                  </Text>
                </View>
                <ScrollView
                  style={styles.playlistScroll}
                  showsVerticalScrollIndicator={false}
                >
                  {currentClips.map((clip, index) => (
                    <TouchableOpacity
                      key={clip.id}
                      style={[
                        styles.clipCard,
                        currentClipIndex === index && styles.clipCardActive,
                      ]}
                      onPress={() => handleSelectClip(index)}
                    >
                      <Text
                        style={[
                          styles.clipCardNumber,
                          currentClipIndex === index && { color: "#0077cc" },
                        ]}
                      >
                        {index + 1}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.clipCardTitle,
                            currentClipIndex === index && { color: "#0077cc" },
                          ]}
                        >
                          {clip.project}
                        </Text>
                        <Text style={styles.clipCardSub}>
                          ⏱ {formatTime(clip.start)} 〜 {formatTime(clip.end)} /
                          by {clip.user}
                        </Text>
                      </View>
                      {currentClipIndex === index && isPlaying ? (
                        <Text style={styles.playingIcon}>▶ 再生中</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                  <View style={{ height: 30 }} />
                </ScrollView>
              </>
            )}
          </View>
        ) : (
          <>
            <View style={styles.topRow}>
              <Text style={styles.sectionTitle}>プロジェクト一覧</Text>
              {canCreateProject && (
                <TouchableOpacity
                  style={styles.createBtn}
                  onPress={() => setIsModalVisible(true)}
                >
                  <Text style={styles.createBtnText}>＋ 新規追加</Text>
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={projects}
              keyExtractor={(item) => item.id}
              renderItem={renderProjectItem}
              ListEmptyComponent={
                <Text style={styles.emptyText}>プロジェクトがありません。</Text>
              }
            />
          </>
        )}
      </View>

      {/* 新規プロジェクト作成モーダル */}
      <Modal visible={isModalVisible} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>新しいプロジェクトを追加</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>プロジェクト名</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 秋季大会 決勝戦"
                value={title}
                onChangeText={setTitle}
              />

              <Text style={styles.label}>種類</Text>
              <View style={styles.typeContainer}>
                {["試合", "練習", "その他"].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeBtn, type === t && styles.typeBtnActive]}
                    onPress={() => setType(t)}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        type === t && styles.typeBtnTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>共有範囲</Text>
              <View style={styles.typeContainer}>
                <TouchableOpacity
                  style={[
                    styles.typeBtn,
                    participants === "team" && styles.typeBtnActive,
                  ]}
                  onPress={() => setParticipants("team")}
                >
                  <Text
                    style={[
                      styles.typeBtnText,
                      participants === "team" && styles.typeBtnTextActive,
                    ]}
                  >
                    全体
                  </Text>
                </TouchableOpacity>
                {["owner", "staff"].includes(userRole) && (
                  <TouchableOpacity
                    style={[
                      styles.typeBtn,
                      participants === "coach" && styles.typeBtnActive,
                    ]}
                    onPress={() => setParticipants("coach")}
                  >
                    <Text
                      style={[
                        styles.typeBtnText,
                        participants === "coach" && styles.typeBtnTextActive,
                      ]}
                    >
                      指導者のみ
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.label}>動画のURL (YouTubeなど)</Text>
              <TextInput
                style={styles.input}
                placeholder="https://youtu.be/..."
                value={videoUrl}
                onChangeText={setVideoUrl}
                autoCapitalize="none"
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsModalVisible(false)}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.submitBtn}
                  onPress={handleCreateProject}
                >
                  <Text style={styles.submitBtnText}>作成する</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

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
  tabText: { fontSize: 14, color: "#666", fontWeight: "bold" },
  activeTabText: { color: "#0077cc" },

  content: { flex: 1, padding: 15 },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  sectionTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  createBtn: {
    backgroundColor: "#0077cc",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  createBtnText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
  emptyText: { textAlign: "center", color: "#888", marginTop: 30 },
  emptySubText: {
    textAlign: "center",
    color: "#aaa",
    fontSize: 12,
    marginTop: 10,
  },

  card: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#0077cc",
    elevation: 1,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginRight: 10,
  },
  badgeMatch: { backgroundColor: "#ffeaa7" },
  badgePractice: { backgroundColor: "#dff9fb" },
  badgeOther: { backgroundColor: "#e0e0e0" },
  badgeText: { fontSize: 10, fontWeight: "bold", color: "#333" },
  cardTitle: { fontSize: 16, fontWeight: "bold", color: "#333", flex: 1 },
  cardSub: { fontSize: 12, color: "#888", marginBottom: 5 },
  urlText: { fontSize: 12, color: "#2ecc71", fontWeight: "bold" },
  noUrlText: { fontSize: 12, color: "#e74c3c" },

  summaryContainer: { flex: 1, marginHorizontal: -15 },
  tagSelectorWrapper: {
    paddingHorizontal: 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  summaryTagBtn: {
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    elevation: 1,
  },
  summaryTagBtnActive: { backgroundColor: "#0077cc", borderColor: "#0077cc" },
  summaryTagBtnText: { fontSize: 14, color: "#555", fontWeight: "bold" },
  summaryTagBtnTextActive: { color: "#fff" },

  videoPlayerArea: {
    height: 200,
    backgroundColor: "#000",
    justifyContent: "center",
    position: "relative",
  },
  youtubeContainer: { width: "100%", height: 200 },
  videoComponent: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
  videoOverlay: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  overlayProjectName: {
    color: "#fff",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: "bold",
  },
  overlayTag: {
    color: "#fff",
    backgroundColor: "rgba(0,119,204,0.8)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: "bold",
  },

  playlistHeader: {
    padding: 15,
    backgroundColor: "#f9f9f9",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  playlistTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 2,
  },
  playlistSub: { fontSize: 12, color: "#888" },
  playlistScroll: { flex: 1, paddingHorizontal: 15, paddingTop: 10 },
  clipCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#eee",
    elevation: 1,
  },
  clipCardActive: { borderColor: "#0077cc", backgroundColor: "#e6f2ff" },
  clipCardNumber: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#aaa",
    marginRight: 15,
    width: 20,
    textAlign: "center",
  },
  clipCardTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  clipCardSub: { fontSize: 12, color: "#666" },
  playingIcon: {
    fontSize: 12,
    color: "#0077cc",
    fontWeight: "bold",
    marginLeft: 10,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "90%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#333",
    textAlign: "center",
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
  typeBtnActive: { backgroundColor: "#e6f2ff", borderColor: "#0077cc" },
  typeBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  typeBtnTextActive: { color: "#0077cc" },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 20,
  },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 20, marginRight: 10 },
  cancelBtnText: { color: "#888", fontWeight: "bold", fontSize: 15 },
  submitBtn: {
    backgroundColor: "#0077cc",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  submitBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
});
