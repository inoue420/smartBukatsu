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
  InputAccessoryView,
  Button,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Video, ResizeMode } from "expo-av";
import YoutubePlayer from "react-native-youtube-iframe";
import * as ScreenOrientation from "expo-screen-orientation";

import { useAuth } from "../AuthContext";
import { auth } from "../firebase";
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

  const defaultQuickTags = ["得点", "罰則", "2min", "ナイス"];
  const [quickTags, setQuickTags] = useState(
    project.quickTags || defaultQuickTags,
  );

  const [selectedQuickTags, setSelectedQuickTags] = useState([]);

  const [preSec, setPreSec] = useState(5);
  const [postSec, setPostSec] = useState(3);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [isSideUiVisible, setIsSideUiVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimeoutRef = useRef(null);

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

  const [isAddQuickTagModalVisible, setIsAddQuickTagModalVisible] =
    useState(false);
  const [newQuickTagName, setNewQuickTagName] = useState("");

  const showToast = (message) => {
    setToastMessage(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2000);
  };

  const extractYoutubeId = (url) => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  useEffect(() => {
    const updatedProject = projects?.find((p) => p.id === routeProject?.id);
    if (updatedProject) {
      setLocalTags(updatedProject.tags || []);
      setQuickTags(updatedProject.quickTags || defaultQuickTags);
    }
  }, [projects, routeProject?.id]);

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
      setIsSideUiVisible(false);
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

  const toggleQuickTag = (tag) => {
    if (selectedQuickTags.includes(tag)) {
      setSelectedQuickTags(selectedQuickTags.filter((t) => t !== tag));
    } else {
      setSelectedQuickTags([...selectedQuickTags, tag]);
    }
  };

  const executeAddTag = async () => {
    if (selectedQuickTags.length === 0) return;
    const label = selectedQuickTags.join(" + ");

    const newTag = {
      id: "tag_" + Date.now(),
      videoTime,
      label,
      user: displayUserName,
      status: "private",
      preSeconds: preSec,
      postSeconds: postSec,
    };

    const newTags = [...localTags, newTag].sort(
      (a, b) => a.videoTime - b.videoTime,
    );
    setLocalTags(newTags);
    setSelectedQuickTags([]);

    if (setProjects) {
      setProjects((prev) =>
        prev.map((p) => (p.id === project.id ? { ...p, tags: newTags } : p)),
      );
    }

    showToast(`✅ タグを記録しました（未公開）`);

    try {
      const safeTeamId = activeTeamId || "test_team";
      await updateProject(safeTeamId, project.id, { tags: newTags });
    } catch (error) {}
  };

  const handleBulkShareTags = async () => {
    const privateTagsCount = localTags.filter(
      (t) => t.status === "private" && t.user === displayUserName,
    ).length;
    if (privateTagsCount === 0) return;

    Alert.alert(
      "一括公開",
      `記録済みの未公開タグ ${privateTagsCount}件 をすべてチームに公開しますか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "公開する",
          onPress: async () => {
            const newTags = localTags.map((t) =>
              t.status === "private" && t.user === displayUserName
                ? { ...t, status: "shared" }
                : t,
            );
            setLocalTags(newTags);

            if (setProjects) {
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === project.id ? { ...p, tags: newTags } : p,
                ),
              );
            }

            try {
              const safeTeamId = activeTeamId || "test_team";
              await updateProject(safeTeamId, project.id, { tags: newTags });
              showToast("📢 チーム全体に一括公開しました！");
            } catch (error) {}
          },
        },
      ],
    );
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

  const handleCreateQuickTag = async () => {
    const trimmed = newQuickTagName.trim();
    if (trimmed === "") return;
    if (!quickTags.includes(trimmed)) {
      const newQuickTags = [...quickTags, trimmed];
      setQuickTags(newQuickTags);

      if (setProjects) {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id ? { ...p, quickTags: newQuickTags } : p,
          ),
        );
      }

      setNewQuickTagName("");
      setIsAddQuickTagModalVisible(false);
      Keyboard.dismiss();

      try {
        const safeTeamId = activeTeamId || "test_team";
        await updateProject(safeTeamId, project.id, {
          quickTags: newQuickTags,
        });
      } catch (error) {}
    } else {
      setNewQuickTagName("");
      setIsAddQuickTagModalVisible(false);
    }
  };

  const handleDeleteQuickTag = (tagToDelete) => {
    Alert.alert(
      "タグボタンの削除",
      `「${tagToDelete}」ボタンを削除しますか？\n（※過去に付けたタグ履歴は消えません）`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: async () => {
            const newQuickTags = quickTags.filter((t) => t !== tagToDelete);
            setQuickTags(newQuickTags);

            if (setProjects) {
              setProjects((prev) =>
                prev.map((p) =>
                  p.id === project.id ? { ...p, quickTags: newQuickTags } : p,
                ),
              );
            }

            try {
              const safeTeamId = activeTeamId || "test_team";
              await updateProject(safeTeamId, project.id, {
                quickTags: newQuickTags,
              });
            } catch (error) {}
          },
        },
      ],
    );
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
          useNativeControls={true}
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

      {isLandscape && (
        <TouchableOpacity
          style={styles.toggleSideUiBtn}
          onPress={() => setIsSideUiVisible(!isSideUiVisible)}
        >
          <Text style={styles.toggleSideUiBtnText}>
            {isSideUiVisible ? "▶ 隠す" : "◀ タグリスト"}
          </Text>
        </TouchableOpacity>
      )}

      {(youtubeVideoId || videoUri) && (
        <View style={[styles.videoControls, { zIndex: 100 }]}>
          <TouchableOpacity style={styles.skipBtn} onPress={skipBackward}>
            <Text style={styles.skipBtnText}>⏪ 5s</Text>
          </TouchableOpacity>
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

  const renderTaggingContent = () => {
    const visibleTags = localTags.filter(
      (t) => t.status === "shared" || t.user === displayUserName,
    );
    const privateTagsCount = localTags.filter(
      (t) => t.status === "private" && t.user === displayUserName,
    ).length;

    return (
      <View style={{ flex: 1 }}>
        <View style={isLandscape ? styles.fsTagArea : styles.quickTagArea}>
          <Text style={isLandscape ? styles.fsTagTitle : styles.quickTagTitle}>
            💡 複数選択してから「記録」をタップ (長押しで削除)
          </Text>

          <View
            style={isLandscape ? styles.fsTagsWrapper : styles.quickTagsWrapper}
          >
            {quickTags.map((tag) => {
              const isSelected = selectedQuickTags.includes(tag);
              return (
                <TouchableOpacity
                  key={tag}
                  style={[
                    isLandscape ? styles.fsTagBtn : styles.quickTagBtn,
                    isSelected && styles.quickTagBtnSelected,
                  ]}
                  onPress={() => toggleQuickTag(tag)}
                  onLongPress={() => handleDeleteQuickTag(tag)}
                >
                  <Text
                    style={[
                      isLandscape
                        ? styles.fsTagBtnText
                        : styles.quickTagBtnText,
                      isSelected && styles.quickTagBtnTextSelected,
                    ]}
                  >
                    {tag}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={isLandscape ? styles.fsAddTagBtn : styles.addQuickTagBtn}
              onPress={() => {
                setNewQuickTagName("");
                setIsAddQuickTagModalVisible(true);
              }}
            >
              <Text
                style={
                  isLandscape
                    ? styles.fsAddTagBtnText
                    : styles.addQuickTagBtnText
                }
              >
                ＋ ボタン追加
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.clipSettingsRow}>
            <Text style={styles.clipSettingsLabel}>✂️ 切り抜き:</Text>
            <Text style={styles.clipSettingsText}>前</Text>
            <TextInput
              style={styles.clipSettingsInput}
              keyboardType="number-pad"
              value={String(preSec)}
              onChangeText={(v) => setPreSec(Number(v) || 0)}
              selectTextOnFocus
              inputAccessoryViewID="doneAccessory" // ★ 両方のInputに共通のIDを設定
            />
            <Text style={styles.clipSettingsText}>秒 〜 後</Text>
            <TextInput
              style={styles.clipSettingsInput}
              keyboardType="number-pad"
              value={String(postSec)}
              onChangeText={(v) => setPostSec(Number(v) || 0)}
              selectTextOnFocus
              inputAccessoryViewID="doneAccessory" // ★ 両方のInputに共通のIDを設定
            />
            <Text style={styles.clipSettingsText}>秒</Text>
          </View>

          <TouchableOpacity
            style={[
              styles.recordTagBtn,
              selectedQuickTags.length === 0 && styles.recordTagBtnDisabled,
            ]}
            onPress={executeAddTag}
            disabled={selectedQuickTags.length === 0}
          >
            <Text style={styles.recordTagBtnText}>
              {selectedQuickTags.length > 0
                ? `「${selectedQuickTags.join(" + ")}」で記録する`
                : "タグを選択してください"}
            </Text>
          </TouchableOpacity>
        </View>

        {privateTagsCount > 0 && (
          <TouchableOpacity
            style={styles.bulkShareBtn}
            onPress={handleBulkShareTags}
          >
            <Text style={styles.bulkShareBtnText}>
              📢 自分のみのタグ({privateTagsCount}件)を一括公開
            </Text>
          </TouchableOpacity>
        )}

        <ScrollView
          style={styles.listScroll}
          showsVerticalScrollIndicator={false}
        >
          {visibleTags.length === 0 ? (
            <Text style={styles.emptyText}>タグがありません。</Text>
          ) : (
            visibleTags.map((tag) => (
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
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text style={styles.listUserText}>by {tag.user}</Text>
                    {tag.status === "private" && (
                      <Text style={styles.privateBadge}>🔒 自分のみ</Text>
                    )}
                  </View>
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
      </View>
    );
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        isLandscape && { backgroundColor: "#000", padding: 0 },
      ]}
    >
      <StatusBar hidden={isLandscape} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        {!isLandscape && (
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
            <View style={{ width: 60 }} />
          </View>
        )}

        <View
          style={
            isLandscape ? styles.fsRoot : { flex: 1, flexDirection: "column" }
          }
        >
          <View
            style={[
              isLandscape ? styles.fsVideoCol : { zIndex: 10 },
              isLandscape && !isSideUiVisible && { flex: 1 },
            ]}
          >
            {renderVideoPlayer()}
          </View>

          <View
            style={[
              isLandscape ? styles.fsUiCol : { flex: 1 },
              isLandscape && !isSideUiVisible && { display: "none" },
            ]}
          >
            {renderTaggingContent()}
          </View>
        </View>
      </KeyboardAvoidingView>

      {toastMessage && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* ★ 修正：ツールバー（InputAccessoryView）を画面の一番外側に配置 */}
      {Platform.OS === "ios" && (
        <InputAccessoryView nativeID="doneAccessory">
          <View style={styles.accessoryBar}>
            <Button onPress={() => Keyboard.dismiss()} title="完了" />
          </View>
        </InputAccessoryView>
      )}

      <Modal
        visible={isAddQuickTagModalVisible}
        transparent={true}
        animationType="fade"
        supportedOrientations={[
          "portrait",
          "landscape",
          "landscape-left",
          "landscape-right",
        ]}
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

  toggleSideUiBtn: {
    position: "absolute",
    right: 0,
    top: 20,
    backgroundColor: "rgba(0,119,204,0.85)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    zIndex: 150,
  },
  toggleSideUiBtnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 12,
  },

  toastContainer: {
    position: "absolute",
    top: "20%",
    alignSelf: "center",
    backgroundColor: "rgba(0, 119, 204, 0.9)",
    paddingHorizontal: 25,
    paddingVertical: 15,
    borderRadius: 25,
    zIndex: 9999,
    elevation: 10,
  },
  toastText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "bold",
    textAlign: "center",
  },

  fsRoot: { flex: 1, flexDirection: "row", backgroundColor: "#000" },
  fsVideoCol: {
    flex: 0.6,
    backgroundColor: "#000",
    justifyContent: "center",
    position: "relative",
  },
  fsUiCol: {
    flex: 0.4,
    backgroundColor: "#1e293b",
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  fsVideoPlayerArea: { flex: 1, width: "100%", height: "100%" },
  fsYoutubeContainer: { flex: 1, width: "100%", justifyContent: "center" },

  fsTagArea: {
    marginBottom: 10,
  },
  fsTagTitle: {
    color: "#cbd5e1",
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
  },
  fsTagBtn: {
    backgroundColor: "#334155",
    paddingVertical: 10,
    paddingHorizontal: 5,
    borderRadius: 8,
    width: "48%",
    alignItems: "center",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#475569",
  },
  fsTagBtnText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
  },
  fsAddTagBtn: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#0077cc",
    borderStyle: "dashed",
    paddingVertical: 10,
    paddingHorizontal: 5,
    borderRadius: 8,
    width: "100%",
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

  bulkShareBtn: {
    backgroundColor: "#2ecc71",
    paddingVertical: 12,
    marginHorizontal: 15,
    marginTop: 5,
    marginBottom: 5,
    borderRadius: 8,
    alignItems: "center",
    elevation: 2,
  },
  bulkShareBtnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },

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
    marginRight: 10,
  },
  timeJumpText: { color: "#0077cc", fontWeight: "bold", fontSize: 13 },
  listInfo: { flex: 1 },
  listLabelText: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  listUserText: { fontSize: 11, color: "#888" },

  privateBadge: {
    fontSize: 10,
    backgroundColor: "#f39c12",
    color: "#fff",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
    fontWeight: "bold",
  },

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

  quickTagBtnSelected: {
    backgroundColor: "#0077cc",
    borderColor: "#0077cc",
  },
  quickTagBtnTextSelected: {
    color: "#fff",
  },

  accessoryBar: {
    backgroundColor: "#e5e5ea",
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 10,
    height: 44,
    borderTopWidth: 1,
    borderColor: "#ccc",
  },

  clipSettingsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
    paddingHorizontal: 5,
  },
  clipSettingsLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#555",
    marginRight: 8,
  },
  clipSettingsText: {
    fontSize: 13,
    color: "#555",
    marginHorizontal: 5,
  },
  clipSettingsInput: {
    backgroundColor: "#f9f9f9",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    width: 40,
    textAlign: "center",
    paddingVertical: 6,
    fontSize: 14,
    color: "#0077cc",
    fontWeight: "bold",
  },

  recordTagBtn: {
    backgroundColor: "#e74c3c",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 5,
    marginHorizontal: 5,
  },
  recordTagBtnDisabled: {
    backgroundColor: "#ccc",
  },
  recordTagBtnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },

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
