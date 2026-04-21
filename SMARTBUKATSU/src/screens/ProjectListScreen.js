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
  StatusBar,
  useWindowDimensions,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Video, ResizeMode } from "expo-av";
import YoutubePlayer from "react-native-youtube-iframe";
import * as ScreenOrientation from "expo-screen-orientation";

import { useAuth } from "../AuthContext";
import {
  createProject,
  deleteProject,
  updateProject,
} from "../services/firestoreService";

const ProjectListScreen = ({
  navigation,
  isAdmin,
  currentUser,
  projects,
  setProjects,
  userProfiles,
}) => {
  const currentUserProfile = userProfiles[currentUser] || {};

  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");

  const canCreateProject = ["owner", "admin", "staff", "captain"].includes(
    userRole,
  );
  const canManageProject = ["owner", "admin", "staff"].includes(userRole);

  const { user, activeTeamId } = useAuth();
  const [isOffline, setIsOffline] = useState(false);

  const [activeTab, setActiveTab] = useState("list");
  const [summaryTab, setSummaryTab] = useState("playlist");

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const [isSideUiVisible, setIsSideUiVisible] = useState(false);
  const [clipToastMessage, setClipToastMessage] = useState(null);

  const roleNameMap = {
    owner: `${currentUser}(監督)`,
    admin: `${currentUser}(管理者)`,
    staff: `${currentUser}(コーチ)`,
    captain: `${currentUser}(キャプテン)`,
    member: currentUser,
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const activeProjects = useMemo(() => {
    return projects.filter((p) => p.status !== "deleted");
  }, [projects]);

  const clipPreSeconds = currentUserProfile.clipPreSeconds ?? 5;
  const clipPostSeconds = currentUserProfile.clipPostSeconds ?? 3;

  // ==========================================
  // ハイライト（プレイリスト）用ステート
  // ==========================================
  const [selectedHighlightTags, setSelectedHighlightTags] = useState([]);
  const [searchMode, setSearchMode] = useState("OR"); // "OR" | "AND"

  // 複合タグを分割し、全クリップと個別タグリストを生成する
  const { allClips, availableTags } = useMemo(() => {
    const clips = [];
    const tagSet = new Set();

    projects.forEach((p) => {
      if (
        p.status === "deleted" ||
        !p.videoUrl ||
        !p.tags ||
        p.tags.length === 0
      )
        return;

      p.tags.forEach((tag) => {
        if (tag.status === "private" && tag.user !== displayUserName) return;

        const individualTags = tag.label
          .split("+")
          .map((t) => t.trim())
          .filter((t) => t);

        individualTags.forEach((t) => tagSet.add(t));

        const clipMemos = (p.sharedMemos || []).filter(
          (m) => m.tagId === tag.id,
        );
        const hasUnread = clipMemos.some(
          (m) =>
            m.user !== displayUserName &&
            !(m.readBy || []).includes(currentUser),
        );

        clips.push({
          id: tag.id,
          projectId: p.id,
          project: p.title,
          url: p.videoUrl,
          start: Math.max(0, tag.videoTime - clipPreSeconds),
          end: tag.videoTime + clipPostSeconds,
          user: tag.user,
          memos: clipMemos,
          hasUnread: hasUnread,
          type: p.type,
          date: p.date,
          status: tag.status || "shared",
          labels: individualTags, // 分割したタグの配列
          originalLabel: tag.label, // 画面表示用
        });
      });
    });

    clips.sort((a, b) => a.start - b.start);
    return { allClips: clips, availableTags: Array.from(tagSet).sort() };
  }, [projects, displayUserName, currentUser, clipPreSeconds, clipPostSeconds]);

  const currentClips = useMemo(() => {
    if (selectedHighlightTags.length === 0) {
      return allClips; // タグ未選択時はすべて表示
    }

    return allClips.filter((clip) => {
      if (searchMode === "OR") {
        // OR: どれか1つでも含まれていればOK
        return selectedHighlightTags.some((tag) => clip.labels.includes(tag));
      } else {
        // AND: 選択したタグが「すべて」含まれていること
        return selectedHighlightTags.every((tag) => clip.labels.includes(tag));
      }
    });
  }, [allClips, selectedHighlightTags, searchMode]);

  const [currentClipIndex, setCurrentClipIndex] = useState(0);

  const [videoTime, setVideoTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef(null);
  const youtubeRef = useRef(null);

  const [newSharedMemo, setNewSharedMemo] = useState("");

  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [editTitle, setEditTitle] = useState("");

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

  // 使われなくなったタグを選択状態から外す
  useEffect(() => {
    setSelectedHighlightTags((prev) =>
      prev.filter((t) => availableTags.includes(t)),
    );
  }, [availableTags]);

  const currentClip = currentClips[currentClipIndex] || null;

  useEffect(() => {
    if (currentClip && isLandscape && !isSideUiVisible) {
      setClipToastMessage(
        `▶ ${currentClip.project} (${formatTime(currentClip.start)}〜)`,
      );
      const timer = setTimeout(() => setClipToastMessage(null), 3500);
      return () => clearTimeout(timer);
    } else {
      setClipToastMessage(null);
    }
  }, [currentClip, isLandscape, isSideUiVisible]);

  useEffect(() => {
    if (activeTab === "summary" && summaryTab === "memo" && currentClip) {
      const unreadMemos = currentClip.memos.filter(
        (m) =>
          m.user !== displayUserName && !(m.readBy || []).includes(currentUser),
      );
      if (unreadMemos.length > 0) {
        const targetProject = projects.find(
          (p) => p.id === currentClip.projectId,
        );
        if (targetProject) {
          const updatedMemos = (targetProject.sharedMemos || []).map((m) => {
            if (
              m.tagId === currentClip.id &&
              m.user !== displayUserName &&
              !(m.readBy || []).includes(currentUser)
            ) {
              return { ...m, readBy: [...(m.readBy || []), currentUser] };
            }
            return m;
          });
          setProjects(
            projects.map((p) =>
              p.id === targetProject.id
                ? { ...p, sharedMemos: updatedMemos }
                : p,
            ),
          );
          if (activeTeamId) {
            updateProject(activeTeamId, targetProject.id, {
              sharedMemos: updatedMemos,
            }).catch(() => {});
          }
        }
      }
    }
  }, [
    activeTab,
    summaryTab,
    currentClip,
    projects,
    activeTeamId,
    currentUser,
    displayUserName,
  ]);

  const extractYoutubeId = (url) => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };
  const ytId = currentClip ? extractYoutubeId(currentClip.url) : null;

  const handleToggleTag = (tag) => {
    setSelectedHighlightTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
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
      if (videoRef.current) {
        videoRef.current.pauseAsync();
      }
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
  }, [currentClipIndex, selectedHighlightTags, searchMode]);

  useEffect(() => {
    let interval;
    if (isPlaying && ytId && currentClip) {
      interval = setInterval(async () => {
        if (youtubeRef.current) {
          const currentTime = await youtubeRef.current.getCurrentTime();
          setVideoTime(Math.floor(currentTime));

          if (currentTime >= currentClip.end) {
            if (currentClipIndex < currentClips.length - 1) {
              setCurrentClipIndex((prev) => prev + 1);
            } else {
              setIsPlaying(false);
            }
          }
        }
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, ytId, currentClip, currentClipIndex, currentClips.length]);

  const handlePlaybackStatusUpdate = (status) => {
    if (!status.isLoaded) return;

    const currentTime = Math.floor(status.positionMillis / 1000);
    setVideoTime(currentTime);

    if (currentClip && currentTime >= currentClip.end) {
      if (currentClipIndex < currentClips.length - 1) {
        setCurrentClipIndex((prev) => prev + 1);
      } else {
        setIsPlaying(false);
        if (status.isPlaying) {
          videoRef.current?.pauseAsync();
        }
      }
    } else {
      if (isPlaying !== status.isPlaying) {
        setIsPlaying(status.isPlaying);
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

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("試合");
  const [participants, setParticipants] = useState("team");
  const [videoUrl, setVideoUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleCreateProject = async () => {
    if (title.trim() === "") {
      return Alert.alert("エラー", "プロジェクト名を入力してください。");
    }

    const realUid = user?.uid || currentUser || "local_user";

    const newProject = {
      id: "proj_" + Date.now().toString(),
      title: title.trim(),
      type: type,
      participants: participants,
      videoUrl: videoUrl.trim(),
      date: new Date().toLocaleDateString("ja-JP"),
      status: "active",
      tags: [],
      memos: [],
      sharedMemos: [],
      createdBy: realUid,
    };

    setProjects([newProject, ...projects]);
    setIsModalVisible(false);
    setTitle("");
    setType("試合");
    setParticipants("team");
    setVideoUrl("");
    Alert.alert("成功", "プロジェクトを作成しました！");

    try {
      if (activeTeamId) {
        await createProject(activeTeamId, newProject);
      }
    } catch (error) {
      console.log("Firestore保存エラー:", error);
    }
  };

  const handleOpenEditProject = (item) => {
    setEditingProject(item);
    setEditTitle(item.title);
    setIsEditModalVisible(true);
  };

  const handleSaveEditProject = async () => {
    if (!editTitle.trim()) {
      return Alert.alert("エラー", "プロジェクト名を入力してください。");
    }

    setProjects(
      projects.map((p) =>
        p.id === editingProject.id ? { ...p, title: editTitle.trim() } : p,
      ),
    );
    setIsEditModalVisible(false);

    try {
      if (activeTeamId) {
        await updateProject(activeTeamId, editingProject.id, {
          title: editTitle.trim(),
        });
      }
    } catch (e) {}
  };

  const handleDeleteProjectFromEdit = () => {
    Alert.alert(
      "削除の確認",
      `「${editingProject.title}」を削除しますか？\n（タグやメモなどのデータもすべて見えなくなります）`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: async () => {
            const pid = editingProject.id;
            setProjects(projects.filter((p) => p.id !== pid));
            setIsEditModalVisible(false);
            try {
              if (activeTeamId) {
                await deleteProject(activeTeamId, pid);
              }
            } catch (e) {
              Alert.alert("エラー", "削除に失敗しました。");
            }
          },
        },
      ],
    );
  };

  const handleSendSharedMemo = async () => {
    if (newSharedMemo.trim() === "") return;
    if (!currentClip) return;

    const newMemo = {
      id: "smemo_" + Date.now().toString(),
      tagId: currentClip.id,
      text: newSharedMemo.trim(),
      user: displayUserName,
      uid: user?.uid || currentUser,
      createdAt: Date.now(),
      readBy: [currentUser],
      status: isOffline ? "pending" : "sent",
    };

    const targetProject = projects.find((p) => p.id === currentClip.projectId);
    if (targetProject) {
      const updatedMemos = [...(targetProject.sharedMemos || []), newMemo];
      const updatedProject = { ...targetProject, sharedMemos: updatedMemos };

      setProjects(
        projects.map((p) => (p.id === targetProject.id ? updatedProject : p)),
      );
      setNewSharedMemo("");
      Keyboard.dismiss();

      try {
        if (activeTeamId) {
          await updateProject(activeTeamId, targetProject.id, {
            sharedMemos: updatedMemos,
          });
        }
      } catch (e) {}
    }
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
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>

          {canManageProject && (
            <TouchableOpacity
              style={styles.editIconBtn}
              onPress={() => handleOpenEditProject(item)}
            >
              <Text style={styles.editIconText}>⚙️</Text>
            </TouchableOpacity>
          )}
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

  const renderTagSelector = () => (
    <View
      style={[
        styles.tagSelectorWrapper,
        isLandscape && styles.fsTagSelectorWrapper,
      ]}
    >
      <View
        style={[
          styles.searchModeContainer,
          isLandscape && styles.fsSearchModeContainer,
        ]}
      >
        <Text
          style={[
            styles.searchModeLabel,
            isLandscape && styles.fsSearchModeLabel,
          ]}
        >
          検索条件:
        </Text>
        <View style={[styles.toggleGroup, isLandscape && styles.fsToggleGroup]}>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              isLandscape && styles.fsToggleBtn,
              searchMode === "OR" &&
                (isLandscape
                  ? styles.fsToggleBtnActive
                  : styles.toggleBtnActive),
            ]}
            onPress={() => {
              setSearchMode("OR");
              setCurrentClipIndex(0);
            }}
          >
            <Text
              style={[
                styles.toggleText,
                isLandscape && styles.fsToggleText,
                searchMode === "OR" &&
                  (isLandscape
                    ? styles.fsToggleTextActive
                    : styles.toggleTextActive),
              ]}
            >
              {isLandscape ? "OR" : "OR (いずれか)"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              isLandscape && styles.fsToggleBtn,
              searchMode === "AND" &&
                (isLandscape
                  ? styles.fsToggleBtnActive
                  : styles.toggleBtnActive),
            ]}
            onPress={() => {
              setSearchMode("AND");
              setCurrentClipIndex(0);
            }}
          >
            <Text
              style={[
                styles.toggleText,
                isLandscape && styles.fsToggleText,
                searchMode === "AND" &&
                  (isLandscape
                    ? styles.fsToggleTextActive
                    : styles.toggleTextActive),
              ]}
            >
              {isLandscape ? "AND" : "AND (すべて含む)"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        horizontal={!isLandscape}
        showsHorizontalScrollIndicator={false}
      >
        <View
          style={
            isLandscape
              ? { flexDirection: "row", flexWrap: "wrap" }
              : { flexDirection: "row" }
          }
        >
          {availableTags.map((tag) => {
            const isSelected = selectedHighlightTags.includes(tag);
            return (
              <TouchableOpacity
                key={tag}
                style={[
                  styles.summaryTagBtn,
                  isSelected && styles.summaryTagBtnActive,
                  isLandscape && { marginBottom: 10 },
                ]}
                onPress={() => handleToggleTag(tag)}
              >
                <Text
                  style={[
                    styles.summaryTagBtnText,
                    isSelected && styles.summaryTagBtnTextActive,
                  ]}
                >
                  {tag}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );

  const renderVideoPlayer = () => (
    <View
      style={[styles.videoPlayerArea, isLandscape && styles.fsVideoPlayerArea]}
    >
      {ytId ? (
        <View
          style={[
            styles.youtubeContainer,
            isLandscape && styles.fsYoutubeContainer,
            { pointerEvents: "auto" },
          ]}
        >
          <YoutubePlayer
            ref={youtubeRef}
            height={isLandscape ? height : 200}
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
          useNativeControls={true}
          shouldPlay={isPlaying}
        />
      )}

      <View style={styles.videoOverlay}>
        <Text style={styles.overlayProjectName}>
          {currentClip?.project || ""}
        </Text>
        <Text style={styles.overlayTag}>
          🏷️ {currentClip?.originalLabel || ""}
        </Text>
      </View>

      {isLandscape && (
        <TouchableOpacity
          style={styles.toggleSideUiBtn}
          onPress={() => setIsSideUiVisible(!isSideUiVisible)}
        >
          <Text style={styles.toggleSideUiBtnText}>
            {isSideUiVisible ? "▶ リストを隠す" : "◀ プレイリスト等"}
          </Text>
        </TouchableOpacity>
      )}

      {clipToastMessage && (
        <View style={styles.clipToast}>
          <Text style={styles.clipToastText}>{clipToastMessage}</Text>
        </View>
      )}

      <View style={[styles.videoControls, { zIndex: 100 }]}>
        <Text style={styles.videoTimeDisplay}>{formatTime(videoTime)}</Text>
        <TouchableOpacity
          style={styles.fullscreenBtn}
          onPress={isLandscape ? closeLandscapeMode : openLandscapeMode}
        >
          <Text style={styles.fullscreenBtnText}>
            {isLandscape ? "><" : "[  ]"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderPlaylist = () => (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={[styles.playlistScroll, isLandscape && { paddingHorizontal: 0 }]}
        showsVerticalScrollIndicator={false}
      >
        {!isLandscape && (
          <Text style={styles.playlistSub}>
            ※再生が終わると自動で次に進みます
          </Text>
        )}
        {currentClips.map((clip, index) => (
          <TouchableOpacity
            key={`${clip.projectId}_${clip.id}`}
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
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text
                  style={[
                    styles.clipCardTitle,
                    currentClipIndex === index && { color: "#0077cc" },
                  ]}
                  numberOfLines={1}
                >
                  {clip.project}
                </Text>
                {clip.status === "private" && (
                  <Text style={styles.privateIcon}>🔒</Text>
                )}
                {clip.hasUnread && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.clipCardSub}>
                ⏱ {formatTime(clip.start)} 〜 {formatTime(clip.end)} /{" "}
                {clip.date} / by {clip.user}
              </Text>
            </View>
            {currentClipIndex === index && isPlaying ? (
              <Text style={styles.playingIcon}>▶</Text>
            ) : null}
          </TouchableOpacity>
        ))}
        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );

  const renderSharedMemos = () => (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={[styles.memoScroll, isLandscape && { paddingHorizontal: 0 }]}
      >
        {currentClip?.memos.length === 0 ? (
          <Text style={[styles.emptyText, isLandscape && { color: "#94a3b8" }]}>
            このクリップに対する議論はまだありません。
          </Text>
        ) : (
          currentClip?.memos.map((memo) => {
            const isMyMemo = memo.user === displayUserName;
            return (
              <View
                key={memo.id}
                style={[
                  styles.chatBubbleContainer,
                  isMyMemo ? styles.chatBubbleRight : styles.chatBubbleLeft,
                ]}
              >
                {!isMyMemo && (
                  <Text
                    style={[styles.chatUser, isLandscape && { color: "#ccc" }]}
                  >
                    {memo.user}
                  </Text>
                )}
                <View
                  style={[
                    styles.chatBubble,
                    isMyMemo ? styles.chatBubbleMe : styles.chatBubbleOther,
                  ]}
                >
                  <Text
                    style={isMyMemo ? styles.chatTextMe : styles.chatTextOther}
                  >
                    {memo.text}
                  </Text>
                </View>
                <Text style={styles.chatTime}>
                  {new Date(memo.createdAt).toLocaleTimeString("ja-JP", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>
      <View style={styles.memoInputContainer}>
        <TextInput
          style={styles.memoInput}
          value={newSharedMemo}
          onChangeText={setNewSharedMemo}
          placeholder="議論やアドバイスを入力..."
          multiline
        />
        <TouchableOpacity
          style={styles.memoSendBtn}
          onPress={handleSendSharedMemo}
        >
          <Text style={styles.memoSendBtnText}>送信</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderSummaryRightPane = () => (
    <View style={{ flex: 1, paddingTop: 5 }}>
      <View
        style={[styles.summaryTabRow, isLandscape && { marginHorizontal: 0 }]}
      >
        <TouchableOpacity
          style={[
            styles.summaryTabBtn,
            summaryTab === "playlist" && styles.summaryTabBtnActive,
          ]}
          onPress={() => setSummaryTab("playlist")}
        >
          <Text
            style={[
              styles.summaryTabBtnText,
              summaryTab === "playlist" && styles.summaryTabBtnTextActive,
            ]}
          >
            プレイリスト
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.summaryTabBtn,
            summaryTab === "memo" && styles.summaryTabBtnActive,
          ]}
          onPress={() => setSummaryTab("memo")}
        >
          <Text
            style={[
              styles.summaryTabBtnText,
              summaryTab === "memo" && styles.summaryTabBtnTextActive,
            ]}
          >
            議論メモ {currentClip && currentClip.hasUnread ? "🔴" : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {summaryTab === "playlist" ? renderPlaylist() : renderSharedMemos()}
    </View>
  );

  return (
    <SafeAreaView
      style={[
        styles.container,
        isLandscape && { backgroundColor: "#000", padding: 0 },
      ]}
    >
      <StatusBar hidden={isLandscape} />

      {!isLandscape && (
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
      )}

      {!isLandscape && (
        <View style={styles.tabContainer}>
          {[
            { id: "list", label: "プロジェクト一覧" },
            { id: "summary", label: "ハイライトまとめ" },
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
      )}

      <View style={[styles.content, isLandscape && { padding: 0 }]}>
        {activeTab === "summary" ? (
          <View
            style={[
              styles.summaryContainer,
              isLandscape && { flexDirection: "row", marginHorizontal: 0 },
            ]}
          >
            <View
              style={[
                isLandscape ? styles.fsVideoCol : {},
                isLandscape && !isSideUiVisible && { flex: 1 },
              ]}
            >
              {!isLandscape && renderTagSelector()}

              {currentClips.length === 0 ? (
                <View
                  style={{
                    flex: 1,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={[styles.emptyText, isLandscape && { color: "#fff" }]}
                  >
                    条件に一致するシーンはありません。
                  </Text>
                </View>
              ) : (
                renderVideoPlayer()
              )}
            </View>

            <View
              style={[
                isLandscape
                  ? styles.fsUiCol
                  : {
                      flex: 1,
                      display: currentClips.length === 0 ? "none" : "flex",
                    },
                isLandscape && !isSideUiVisible && { display: "none" },
              ]}
            >
              {isLandscape && renderTagSelector()}
              {currentClips.length > 0 && renderSummaryRightPane()}
            </View>
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
              data={activeProjects}
              keyExtractor={(item) => item.id}
              renderItem={renderProjectItem}
              ListEmptyComponent={
                <Text style={styles.emptyText}>プロジェクトがありません。</Text>
              }
            />
          </>
        )}
      </View>

      {/* プロジェクト作成モーダル */}
      <Modal visible={isModalVisible} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>新しいプロジェクトを追加</Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 50 }}
            >
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
                {["owner", "admin", "staff"].includes(userRole) && (
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
                  disabled={isSaving}
                >
                  <Text style={styles.cancelBtnText}>キャンセル</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitBtn, isSaving && { opacity: 0.7 }]}
                  onPress={handleCreateProject}
                  disabled={isSaving}
                >
                  <Text style={styles.submitBtnText}>
                    {isSaving ? "保存中..." : "作成する"}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* プロジェクト編集用のモーダル */}
      <Modal
        visible={isEditModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.editProjectModalContent}
          >
            <Text style={styles.modalTitle}>プロジェクトの編集</Text>

            <Text style={styles.label}>プロジェクト名</Text>
            <TextInput
              style={styles.editProjectInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="プロジェクト名"
            />

            <TouchableOpacity
              style={styles.editProjectDeleteBtn}
              onPress={handleDeleteProjectFromEdit}
            >
              <Text style={styles.editProjectDeleteBtnText}>
                🗑️ このプロジェクトを消去する
              </Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsEditModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleSaveEditProject}
              >
                <Text style={styles.submitBtnText}>変更を保存</Text>
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

  editIconBtn: { padding: 5, marginLeft: 10 },
  editIconText: { fontSize: 16 },

  cardSub: { fontSize: 12, color: "#888", marginBottom: 5 },
  urlText: { fontSize: 12, color: "#2ecc71", fontWeight: "bold" },
  noUrlText: { fontSize: 12, color: "#e74c3c" },

  summaryContainer: { flex: 1, marginHorizontal: -15 },
  tagSelectorWrapper: {
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    backgroundColor: "#fff",
  },

  searchModeContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 5,
  },
  searchModeLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#555",
    marginRight: 10,
  },
  toggleGroup: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderRadius: 8,
    padding: 3,
  },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 15,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: "#fff",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#64748b",
  },
  toggleTextActive: {
    color: "#0f172a",
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
    top: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 50,
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
  videoControls: {
    position: "absolute",
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 10,
    borderRadius: 8,
  },
  videoTimeDisplay: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "bold",
    fontFamily: "monospace",
  },
  fullscreenBtn: {
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  fullscreenBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    letterSpacing: 1,
  },

  // ★ 変更：横画面用レイアウト割合を調整 (60%:40%)
  fsVideoCol: {
    flex: 0.6,
    backgroundColor: "#000",
    justifyContent: "center",
    position: "relative",
  },
  fsUiCol: {
    flex: 0.4,
    backgroundColor: "#1e293b",
    paddingTop: 10,
    paddingHorizontal: 10,
  },
  fsVideoPlayerArea: {
    width: "100%",
    height: "100%",
  },
  fsYoutubeContainer: {
    width: "100%",
    justifyContent: "center",
  },
  fsTagSelectorWrapper: {
    borderBottomWidth: 0,
    paddingBottom: 10,
    paddingHorizontal: 0,
  },

  fsSearchModeContainer: {
    flexDirection: "column",
    alignItems: "stretch",
    backgroundColor: "transparent",
    padding: 0,
    marginBottom: 10,
  },
  fsSearchModeLabel: {
    color: "#cbd5e1",
    marginBottom: 5,
    marginLeft: 0,
  },
  fsToggleGroup: {
    backgroundColor: "#334155",
    flexDirection: "row",
  },
  fsToggleBtn: {
    flex: 1,
    alignItems: "center",
  },
  fsToggleBtnActive: {
    backgroundColor: "#0077cc",
  },
  fsToggleText: {
    color: "#94a3b8",
  },
  fsToggleTextActive: {
    color: "#fff",
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
  clipToast: {
    position: "absolute",
    top: 20,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    zIndex: 200,
  },
  clipToastText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },

  summaryTabRow: {
    flexDirection: "row",
    marginHorizontal: 15,
    marginBottom: 10,
    backgroundColor: "#e6f2ff",
    borderRadius: 8,
    padding: 3,
  },
  summaryTabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 6,
  },
  summaryTabBtnActive: { backgroundColor: "#0077cc" },
  summaryTabBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  summaryTabBtnTextActive: { color: "#fff" },

  playlistSub: { fontSize: 12, color: "#888", marginBottom: 10 },
  playlistScroll: { flex: 1, paddingHorizontal: 15 },
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
    flex: 1,
  },
  clipCardSub: { fontSize: 12, color: "#666" },
  playingIcon: {
    fontSize: 12,
    color: "#0077cc",
    fontWeight: "bold",
    marginLeft: 10,
  },
  privateIcon: { fontSize: 12, marginRight: 5 },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e74c3c",
    marginLeft: 5,
  },

  memoScroll: { flex: 1, paddingHorizontal: 15 },
  chatBubbleContainer: { marginBottom: 15 },
  chatBubbleLeft: { alignItems: "flex-start" },
  chatBubbleRight: { alignItems: "flex-end" },
  chatUser: { fontSize: 11, color: "#555", marginBottom: 2, marginLeft: 5 },
  chatBubble: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 15,
    maxWidth: "80%",
  },
  chatBubbleMe: { backgroundColor: "#0077cc", borderBottomRightRadius: 0 },
  chatBubbleOther: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eee",
    borderBottomLeftRadius: 0,
  },
  chatTextMe: { color: "#fff", fontSize: 14, lineHeight: 20 },
  chatTextOther: { color: "#333", fontSize: 14, lineHeight: 20 },
  chatTime: { fontSize: 10, color: "#aaa", marginTop: 2, marginHorizontal: 5 },

  memoInputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  memoInput: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 100,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  memoSendBtn: {
    marginLeft: 10,
    backgroundColor: "#0077cc",
    paddingHorizontal: 15,
    height: 40,
    justifyContent: "center",
    borderRadius: 20,
  },
  memoSendBtnText: { color: "#fff", fontWeight: "bold", fontSize: 13 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
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
  typeBtnActive: {
    backgroundColor: "#e6f2ff",
    borderColor: "#0077cc",
    borderWidth: 2,
  },
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
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontWeight: "bold", fontSize: 15 },

  editProjectModalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    width: "85%",
  },
  editProjectInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 20,
  },
  editProjectDeleteBtn: {
    backgroundColor: "#fff5f5",
    borderWidth: 1,
    borderColor: "#ffcccc",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 15,
  },
  editProjectDeleteBtnText: { color: "#c0392b", fontWeight: "bold" },
});

export default ProjectListScreen;
