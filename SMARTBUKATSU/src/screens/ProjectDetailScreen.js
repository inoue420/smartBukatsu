import React, { useState, useEffect, useRef, useCallback } from "react";
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
  StatusBar,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Video, ResizeMode } from "expo-av";
import YoutubePlayer from "react-native-youtube-iframe";
import * as ScreenOrientation from "expo-screen-orientation";

import { useAuth } from "../AuthContext";
import { updateProject } from "../services/firestoreService";

const ProjectDetailScreen = ({
  route,
  navigation,
  currentUser,
  projects,
  setProjects,
}) => {
  const { project: routeProject, userRole = "member" } = route.params || {};

  const project =
    projects?.find((p) => p.id === routeProject?.id) || routeProject || {};
  const projectTitle = project.title || "未定のプロジェクト";
  const projectVideoUrl = project.videoUrl || "";

  const { activeTeamId } = useAuth();

  const [localTags, setLocalTags] = useState(project.tags || []);
  const [localMemos, setLocalMemos] = useState(project.memos || []);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const canDeleteAnyTag = ["owner", "admin", "staff"].includes(userRole);

  const roleNameMap = {
    owner: `${currentUser}(監督)`,
    admin: `${currentUser}(管理者)`,
    staff: `${currentUser}(コーチ)`,
    captain: `${currentUser}(キャプテン)`,
    member: currentUser,
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const [videoUri, setVideoUri] = useState(null);
  const [youtubeVideoId, setYoutubeVideoId] = useState(null);
  const [videoDuration, setVideoDuration] = useState(15 * 60);
  const videoRef = useRef(null);
  const youtubeRef = useRef(null);

  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [activeTab, setActiveTab] = useState("tag");

  const [quickTags, setQuickTags] = useState(["ナイスプレー", "得点", "罰則"]);
  const [isAddQuickTagModalVisible, setIsAddQuickTagModalVisible] =
    useState(false);
  const [newQuickTagName, setNewQuickTagName] = useState("");

  const [isCustomTagModalVisible, setIsCustomTagModalVisible] = useState(false);
  const [customTagText, setCustomTagText] = useState("");
  const [customTagTime, setCustomTagTime] = useState(0);

  const [newMemoText, setNewMemoText] = useState("");

  const extractYoutubeId = (url) => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  useEffect(() => {
    if (projectVideoUrl) {
      const url = projectVideoUrl.trim();
      const extractedId = extractYoutubeId(url);
      if (extractedId) {
        setYoutubeVideoId(extractedId);
        setVideoUri(null);
      } else {
        setVideoUri(url);
        setYoutubeVideoId(null);
      }
    } else {
      setVideoUri(null);
      setYoutubeVideoId(null);
    }
  }, [projectVideoUrl]);

  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      ).catch(() => {});
    };
  }, []);

  const openLandscapeMode = async () => {
    try {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT,
      );
    } catch (e) {}
  };

  const closeLandscapeMode = async () => {
    try {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
      setTimeout(async () => {
        await ScreenOrientation.unlockAsync();
      }, 2000);
    } catch (e) {}
  };

  useEffect(() => {
    let interval;
    if (isPlaying && youtubeVideoId) {
      interval = setInterval(async () => {
        if (youtubeRef.current) {
          const currentTime = await youtubeRef.current.getCurrentTime();
          setVideoTime(Math.floor(currentTime));
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, youtubeVideoId]);

  useEffect(() => {
    let interval;
    if (isPlaying && videoUri && !youtubeVideoId) {
      interval = setInterval(() => {
        setVideoTime((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, videoUri, youtubeVideoId]);

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
      if (status.durationMillis) {
        setVideoDuration(Math.floor(status.durationMillis / 1000));
      }
      if (status.didJustFinish) {
        setIsPlaying(false);
      }
    }
  };

  const onYoutubeStateChange = useCallback((state) => {
    if (state === "playing") setIsPlaying(true);
    else if (state === "paused" || state === "ended") setIsPlaying(false);
  }, []);

  const jumpToTime = async (seconds) => {
    if (youtubeVideoId && youtubeRef.current) {
      youtubeRef.current.seekTo(seconds, true);
      setIsPlaying(true);
    } else if (videoUri && videoRef.current) {
      await videoRef.current.setPositionAsync(seconds * 1000);
      await videoRef.current.playAsync();
      setIsPlaying(true);
    } else {
      setVideoTime(seconds);
    }
  };

  const skipBackward = async () => {
    const newTime = Math.max(videoTime - 5, 0);
    if (youtubeVideoId && youtubeRef.current)
      youtubeRef.current.seekTo(newTime, true);
    else if (videoUri && videoRef.current)
      await videoRef.current.setPositionAsync(newTime * 1000);
    setVideoTime(newTime);
  };

  const skipForward = async () => {
    let newTime = videoTime + 5;
    if (youtubeVideoId && youtubeRef.current) {
      const dur = await youtubeRef.current.getDuration();
      newTime = Math.min(newTime, dur);
      youtubeRef.current.seekTo(newTime, true);
    } else if (videoUri && videoRef.current) {
      newTime = Math.min(newTime, videoDuration);
      await videoRef.current.setPositionAsync(newTime * 1000);
    }
    setVideoTime(newTime);
  };

  const handleAddTag = async (label) => {
    const newTag = {
      id: "tag_" + Date.now(),
      videoTime,
      label,
      user: displayUserName,
    };
    const newTags = [...localTags, newTag].sort(
      (a, b) => a.videoTime - b.videoTime,
    );

    setLocalTags(newTags);

    if (setProjects) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, tags: newTags } : p)),
      );
    }

    try {
      const safeTeamId = activeTeamId || "test_team";
      await updateProject(safeTeamId, project.id, { tags: newTags });
    } catch (error) {
      console.log("Firestore保存はスキップ:", error);
    }
  };

  const handleDeleteTag = async (id) => {
    const newTags = localTags.filter((t) => t.id !== id);
    setLocalTags(newTags);

    if (setProjects) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, tags: newTags } : p)),
      );
    }

    try {
      const safeTeamId = activeTeamId || "test_team";
      await updateProject(safeTeamId, project.id, { tags: newTags });
    } catch (error) {}
  };

  const handleOpenCustomTag = () => {
    setCustomTagTime(videoTime);
    setCustomTagText("");
    setIsCustomTagModalVisible(true);
  };

  const handleSaveCustomTag = async () => {
    if (customTagText.trim() === "") return;
    const newTag = {
      id: "tag_" + Date.now(),
      videoTime: customTagTime,
      label: customTagText.trim(),
      user: displayUserName,
    };
    const newTags = [...localTags, newTag].sort(
      (a, b) => a.videoTime - b.videoTime,
    );

    setLocalTags(newTags);

    if (setProjects) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, tags: newTags } : p)),
      );
    }

    setIsCustomTagModalVisible(false);
    Keyboard.dismiss();

    try {
      const safeTeamId = activeTeamId || "test_team";
      await updateProject(safeTeamId, project.id, { tags: newTags });
    } catch (error) {
      console.log(error);
    }
  };

  const handleAddMemo = async () => {
    if (newMemoText.trim() === "") return;
    const newMemo = {
      id: "memo_" + Date.now(),
      videoTime,
      text: newMemoText,
      user: displayUserName,
    };
    const newMemos = [...localMemos, newMemo].sort(
      (a, b) => a.videoTime - b.videoTime,
    );

    setLocalMemos(newMemos);

    if (setProjects) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, memos: newMemos } : p)),
      );
    }

    setNewMemoText("");
    Keyboard.dismiss();

    try {
      const safeTeamId = activeTeamId || "test_team";
      await updateProject(safeTeamId, project.id, { memos: newMemos });
    } catch (error) {
      console.log(error);
    }
  };

  const handleDeleteMemo = async (id) => {
    const newMemos = localMemos.filter((m) => m.id !== id);
    setLocalMemos(newMemos);

    if (setProjects) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, memos: newMemos } : p)),
      );
    }

    try {
      const safeTeamId = activeTeamId || "test_team";
      await updateProject(safeTeamId, project.id, { memos: newMemos });
    } catch (error) {}
  };

  const handleCreateQuickTag = () => {
    const trimmed = newQuickTagName.trim();
    if (trimmed === "") return;
    if (!quickTags.includes(trimmed)) setQuickTags([...quickTags, trimmed]);
    setNewQuickTagName("");
    setIsAddQuickTagModalVisible(false);
  };

  const renderVideoPlayer = () => (
    <View
      style={[styles.videoPlayerArea, isLandscape && styles.fsVideoPlayerArea]}
    >
      {youtubeVideoId ? (
        <View
          style={[
            styles.youtubeContainer,
            isLandscape && styles.fsYoutubeContainer,
            { pointerEvents: "auto" },
          ]}
        >
          <YoutubePlayer
            ref={youtubeRef}
            height={isLandscape ? Math.min(width, height) : 220}
            play={isPlaying}
            videoId={youtubeVideoId}
            onChangeState={onYoutubeStateChange}
            initialPlayerParams={{ controls: 1, rel: 0 }}
          />
        </View>
      ) : videoUri ? (
        <Video
          ref={videoRef}
          source={{ uri: videoUri }}
          style={styles.videoComponent}
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          useNativeControls={true} // ★スマホ標準の再生バーを使用するよう変更！
          shouldPlay={isPlaying}
          onError={() => {
            Alert.alert(
              "エラー",
              "このURLは再生できません。\nYouTubeリンクか、直接の動画ファイル(.mp4)を指定してください。",
            );
          }}
        />
      ) : (
        <View style={styles.videoSetupContainer}>
          <Text style={styles.videoPlaceholderText}>
            ※ 動画URLが設定されていません
          </Text>
          <Text style={styles.videoPlaceholderSub}>
            一覧画面でプロジェクトを作成し直すか、管理者に確認してください
          </Text>
        </View>
      )}

      {(youtubeVideoId || videoUri) && (
        <View style={[styles.videoControls, { zIndex: 100 }]}>
          <TouchableOpacity style={styles.skipBtn} onPress={skipBackward}>
            <Text style={styles.skipBtnText}>⏪ 5s</Text>
          </TouchableOpacity>
          {/* ★ 問題のあったオリジナルの再生ボタンを完全に削除しました */}
          <TouchableOpacity style={styles.skipBtn} onPress={skipForward}>
            <Text style={styles.skipBtnText}>5s ⏩</Text>
          </TouchableOpacity>
          <Text style={styles.videoTimeDisplay}>
            {formatTime(videoTime)}{" "}
            {videoDuration > 0 && !youtubeVideoId
              ? `/ ${formatTime(videoDuration)}`
              : ""}
          </Text>
          <TouchableOpacity
            style={styles.fullscreenBtn}
            onPress={isLandscape ? closeLandscapeMode : openLandscapeMode}
          >
            <Text style={styles.fullscreenBtnText}>
              {isLandscape ? "><" : "[  ]"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderLandscapeTagUI = () => (
    <View style={styles.fsTagContainer}>
      <Text style={styles.fsTagTitle}>💡 タップしてタグ付け</Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.fsTagsWrapper}>
          {quickTags.map((tag) => (
            <TouchableOpacity
              key={tag}
              style={styles.fsTagBtn}
              onPress={() => handleAddTag(tag)}
            >
              <Text style={styles.fsTagBtnText}>{tag}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.fsCustomTagBtn}
            onPress={handleOpenCustomTag}
          >
            <Text style={styles.fsCustomTagBtnText}>✏️ 自由入力</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fsAddTagBtn}
            onPress={() => setIsAddQuickTagModalVisible(true)}
          >
            <Text style={styles.fsAddTagBtnText}>＋ ボタン追加</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  const renderTabsAndContent = () => (
    <View style={{ flex: 1 }}>
      <View style={styles.tabContainer}>
        {[
          { id: "tag", label: "動画/タグ" },
          { id: "memo", label: "メモ" },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.activeTab]}
            onPress={() => setActiveTab(tab.id)}
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

      <View style={styles.tabContentArea}>
        {activeTab === "tag" && (
          <>
            <View style={styles.quickTagArea}>
              <Text style={styles.quickTagTitle}>
                💡 再生中にタップしてタグを追加
              </Text>
              <View style={styles.quickTagsWrapper}>
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
                  style={styles.customTagBtn}
                  onPress={handleOpenCustomTag}
                >
                  <Text style={styles.customTagBtnText}>✏️ 自由入力</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.addQuickTagBtn}
                  onPress={() => setIsAddQuickTagModalVisible(true)}
                >
                  <Text style={styles.addQuickTagBtnText}>＋ ボタン追加</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={styles.listScroll}>
              {localTags.length === 0 ? (
                <Text style={styles.emptyText}>タグがありません。</Text>
              ) : (
                localTags.map((tag) => (
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

        {activeTab === "memo" && (
          <>
            <ScrollView style={styles.listScroll}>
              {localMemos.length === 0 ? (
                <Text style={styles.emptyText}>メモがありません。</Text>
              ) : (
                localMemos.map((memo) => (
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
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={isLandscape} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <View style={[styles.header, isLandscape && { display: "none" }]}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>◁ 戻る</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {projectTitle}
          </Text>
          <View style={{ width: 60 }} />
        </View>

        <View
          style={
            isLandscape ? styles.fsRoot : { flex: 1, flexDirection: "column" }
          }
        >
          <View style={isLandscape ? styles.fsVideoCol : { zIndex: 10 }}>
            {renderVideoPlayer()}
          </View>
          <View style={isLandscape ? styles.fsUiCol : { flex: 1 }}>
            <View style={{ flex: 1, display: isLandscape ? "none" : "flex" }}>
              {renderTabsAndContent()}
            </View>
            <View style={{ flex: 1, display: isLandscape ? "flex" : "none" }}>
              {renderLandscapeTagUI()}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={isCustomTagModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>自由入力でタグ付け</Text>
            <Text style={styles.timestampContextTextCenter}>
              ⏱️ {formatTime(customTagTime)} の位置にタグを追加
            </Text>
            <TextInput
              style={styles.modalInputField}
              placeholder="気づいたこと、課題など..."
              value={customTagText}
              onChangeText={setCustomTagText}
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
                onPress={() => setIsCustomTagModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={handleSaveCustomTag}
              >
                <Text style={styles.addBtnText}>タグを保存</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
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
                <Text style={styles.addBtnText}>追加</Text>
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

  videoPlayerArea: {
    height: 220,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  youtubeContainer: { width: "100%", height: 220 },
  videoComponent: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },

  fsRoot: { flex: 1, flexDirection: "row", backgroundColor: "#000" },
  fsVideoCol: {
    flex: 0.65,
    backgroundColor: "#000",
    justifyContent: "center",
    position: "relative",
  },
  fsUiCol: {
    flex: 0.35,
    backgroundColor: "#1e293b",
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  fsVideoPlayerArea: { flex: 1, width: "100%", height: "100%" },
  fsYoutubeContainer: { flex: 1, width: "100%", justifyContent: "center" },

  fsTagContainer: { flex: 1 },
  fsTagTitle: {
    color: "#ccc",
    fontSize: 13,
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
    marginTop: 5,
  },
  fsTagsWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingBottom: 20,
  },
  fsTagBtn: {
    backgroundColor: "#0077cc",
    paddingVertical: 15,
    paddingHorizontal: 5,
    borderRadius: 8,
    width: "48%",
    alignItems: "center",
    marginBottom: 10,
  },
  fsTagBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
  },

  fsCustomTagBtn: {
    backgroundColor: "#fff",
    paddingVertical: 15,
    paddingHorizontal: 5,
    borderRadius: 8,
    width: "48%",
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e67e22",
  },
  fsCustomTagBtnText: {
    color: "#e67e22",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
  },
  fsAddTagBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#0077cc",
    borderStyle: "dashed",
    paddingVertical: 15,
    paddingHorizontal: 5,
    borderRadius: 8,
    width: "48%",
    alignItems: "center",
    marginBottom: 10,
  },
  fsAddTagBtnText: {
    color: "#0077cc",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
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
    marginBottom: 5,
  },
  videoPlaceholderSub: { color: "#aaa", fontSize: 12 },

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
  playBtn: { marginRight: 10, padding: 5 },
  playBtnText: { color: "#fff", fontSize: 24 },
  skipBtn: { marginHorizontal: 10, padding: 5 },
  skipBtnText: { color: "#fff", fontSize: 14, fontWeight: "bold" },
  videoTimeDisplay: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "bold",
    fontFamily: "monospace",
    marginLeft: "auto",
  },

  fullscreenBtn: {
    marginLeft: 15,
    paddingHorizontal: 5,
    justifyContent: "center",
  },
  fullscreenBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    letterSpacing: 1,
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
  inputContainer: {
    backgroundColor: "#fff",
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
  },
  timestampContextText: {
    fontSize: 12,
    color: "#e74c3c",
    fontWeight: "bold",
    marginBottom: 10,
    marginLeft: 5,
  },
  timestampContextTextCenter: {
    fontSize: 13,
    color: "#e74c3c",
    fontWeight: "bold",
    marginBottom: 15,
    textAlign: "center",
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
  quickTagsWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 5,
  },
  quickTagBtn: {
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  quickTagBtnText: { fontSize: 13, color: "#333", fontWeight: "bold" },

  customTagBtn: {
    backgroundColor: "#fff",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e67e22",
  },
  customTagBtnText: { fontSize: 13, color: "#e67e22", fontWeight: "bold" },

  addQuickTagBtn: {
    backgroundColor: "#e6f2ff",
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    marginBottom: 10,
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
