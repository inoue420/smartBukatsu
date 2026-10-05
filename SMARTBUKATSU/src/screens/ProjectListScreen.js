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
import { canEditRecordedTag } from "../utils/recordedTagPermissions";
import { createClipPlaybackTransition } from "../utils/clipPlaybackTransition";
import { CommonActions, useIsFocused } from "@react-navigation/native";
import { subscribeHistoryDocument, subscribeProjectsByIds } from "../services/historyDataService";
import HistoryLoadingControls from "../components/HistoryLoadingControls";
import { canReadNotes, canPostNotes, noteClipKey, toggleNoteClipSelection, buildNoteClips, buildNotePlaybackClips } from "../utils/tacticalNotes";
import {
  createProject,
  createHighlightProject,
  deleteHighlightProject,
  deleteProject,
  updateHighlightProject,
  updateProject,
} from "../services/firestoreService";

// ★ 追加：不足していたCOLORS定義
const COLORS = {
  primary: "#0077cc",
  secondary: "#f39c12",
  danger: "#e74c3c",
  success: "#2ecc71",
  background: "#f0f2f5",
  card: "#ffffff",
  textMain: "#333333",
  textSub: "#666666",
  border: "#eeeeee",
};

const DEFAULT_TAG_GROUP_ID = "__default_tag_group__";
const EMPTY_LIST = [];
const DEFAULT_TAGS = ["得点", "罰則", "2min", "ナイス"];
const DEFAULT_TAG_GROUP = {
  id: DEFAULT_TAG_GROUP_ID,
  name: "基本タグ",
  tags: DEFAULT_TAGS,
};
const DEFAULT_CLIP_PRE_SECONDS = 5;
const DEFAULT_CLIP_POST_SECONDS = 3;
// Set false to restore the previous fixed layout for the note scene picker.
// Normal video viewing never uses this layout switch.
const NOTE_PICKER_SCROLL_LAYOUT = true;
const PROJECT_TYPE_ORDER = ["試合", "練習", "その他"];

const normalizeProjectType = (project) =>
  PROJECT_TYPE_ORDER.includes(project?.type) ? project.type : "その他";

const getProjectCreatedAtMillis = (project) => {
  const createdAt = project?.createdAt;

  if (typeof createdAt?.toMillis === "function") return createdAt.toMillis();
  if (typeof createdAt?.toDate === "function") return createdAt.toDate().getTime();
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt?.seconds === "number") return createdAt.seconds * 1000;
  if (typeof createdAt === "number") {
    return createdAt < 1000000000000 ? createdAt * 1000 : createdAt;
  }
  if (typeof createdAt === "string") {
    const parsedCreatedAt = new Date(createdAt).getTime();
    if (Number.isFinite(parsedCreatedAt)) return parsedCreatedAt;
  }

  const dateMatch = String(project?.date || "").match(
    /^(\d{4})[/.\-](\d{1,2})(?:[/.\-](\d{1,2}))?/,
  );
  if (!dateMatch) return 0;

  const [, year, month, day = "1"] = dateMatch;
  return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
};

const getProjectMonth = (project) => {
  const createdAtMillis = getProjectCreatedAtMillis(project);
  if (!createdAtMillis) {
    return {
      key: "unknown",
      label: "作成月不明",
      sortValue: Number.MIN_SAFE_INTEGER,
    };
  }

  const createdAt = new Date(createdAtMillis);
  const year = createdAt.getFullYear();
  const month = createdAt.getMonth() + 1;
  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    label: `${year}年${month}月`,
    sortValue: year * 100 + month,
  };
};

const groupProjectsByTypeAndMonth = (projects) =>
  PROJECT_TYPE_ORDER.map((type) => {
    const monthMap = new Map();

    projects.forEach((project) => {
      if (normalizeProjectType(project) !== type) return;
      const month = getProjectMonth(project);
      if (!monthMap.has(month.key)) {
        monthMap.set(month.key, { ...month, projects: [] });
      }
      monthMap.get(month.key).projects.push(project);
    });

    const months = Array.from(monthMap.values())
      .sort((a, b) => b.sortValue - a.sortValue)
      .map((month) => ({
        ...month,
        projects: [...month.projects].sort(
          (a, b) => getProjectCreatedAtMillis(b) - getProjectCreatedAtMillis(a),
        ),
      }));

    return {
      type,
      projectCount: months.reduce(
        (count, month) => count + month.projects.length,
        0,
      ),
      months,
    };
  }).filter((group) => group.projectCount > 0);

const buildProjectHierarchyRows = (
  groups,
  expandedMonths,
  expandedTypes,
) => {
  const rows = [];
  groups.forEach((group) => {
    const typeExpanded =
      expandedTypes[group.type] !== undefined
        ? expandedTypes[group.type]
        : true;
    rows.push({
      kind: "type",
      key: `type:${group.type}`,
      type: group.type,
      label: group.type,
      projectCount: group.projectCount,
      expanded: typeExpanded,
    });

    if (!typeExpanded) return;

    group.months.forEach((month, monthIndex) => {
      const expansionKey = `${group.type}:${month.key}`;
      const expanded =
        expandedMonths[expansionKey] !== undefined
          ? expandedMonths[expansionKey]
          : monthIndex === 0;
      rows.push({
        kind: "month",
        key: `month:${expansionKey}`,
        type: group.type,
        monthKey: month.key,
        monthIndex,
        label: month.label,
        projectCount: month.projects.length,
        expanded,
      });
      if (expanded) {
        month.projects.forEach((project) => {
          rows.push({
            kind: "project",
            key: `project:${group.type}:${month.key}:${project.id}`,
            project,
          });
        });
      }
    });
  });
  return rows;
};

const normalizeClipSeconds = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
};

const ProjectListScreen = ({
  navigation,
  route,
  notePlayback = null,
  notePlaybackState = null,
  onNotePlaybackStateChange,
  noteHeader = null,
  onCloseNotePlayback,
  isAdmin,
  currentUser,
  currentUserUid = "",
  projects: baseProjects,
  history = null,
  highlightHistory = null,
  setProjects,
  highlightProjects: baseHighlightProjects = EMPTY_LIST,
  tagGroups = EMPTY_LIST,
  userProfiles,
}) => {
  const focused = useIsFocused();
  const [referencedProjects, setReferencedProjects] = useState([]);
  const [loadedReferenceKey, setLoadedReferenceKey] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const [referenceRetry, setReferenceRetry] = useState(0);
  const [referencedHighlight, setReferencedHighlight] = useState(null);
  const [loadedHighlightId, setLoadedHighlightId] = useState("");
  const highlightProjects = useMemo(() => [...new Map([...(referencedHighlight ? [referencedHighlight] : []), ...baseHighlightProjects].map((project) => [project.id, project])).values()], [baseHighlightProjects, referencedHighlight]);
  const projects = useMemo(() => [...new Map([...referencedProjects, ...(baseProjects || [])].map((project) => [project.id, project])).values()], [baseProjects, referencedProjects]);
  const currentUserProfile =
    Object.values(userProfiles).find(
      (profile) => profile?.uid === currentUserUid,
    ) || {};

  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");

  const canUploadVideos = Boolean(currentUserProfile.canUploadVideos);
  const canEditTags = Boolean(currentUserProfile.canEditTags);
  const canCreateProject =
    ["owner", "admin", "staff", "captain"].includes(userRole) ||
    (["guardian", "member"].includes(userRole) && canUploadVideos);
  const canManageProject = ["owner", "admin", "staff"].includes(userRole);
  const canEditTagGroups =
    ["owner", "admin", "staff"].includes(userRole) ||
    (["guardian", "member"].includes(userRole) && canEditTags);

  const { user, activeTeamId } = useAuth();

  const notePicker = route?.params?.notePicker;
  const useScrollableNotePicker = Boolean(notePicker) && NOTE_PICKER_SCROLL_LAYOUT;
  const [noteActionsOpen, setNoteActionsOpen] = useState(false);
  const [noteSelection, setNoteSelection] = useState([]);
  const [activeTab, setActiveTab] = useState(notePicker || notePlayback ? "summary" : "list");
  const [selectedHighlightProjectId, setSelectedHighlightProjectId] =
    useState(notePlayback?.id || notePicker?.sourceId || null);
  const needsHighlight = Boolean(selectedHighlightProjectId && !notePlayback && !baseHighlightProjects.some((project) => project.id === selectedHighlightProjectId));
  const highlightPending = needsHighlight && loadedHighlightId !== selectedHighlightProjectId;
  useEffect(() => {
    if (!focused || !activeTeamId || !needsHighlight) return undefined;
    let active = true;
    const stop = subscribeHistoryDocument(activeTeamId, "highlightProjects", selectedHighlightProjectId, (item) => {
      if (active) { setReferencedHighlight(item); setLoadedHighlightId(selectedHighlightProjectId); }
    }, () => { if (active) setReferenceError("プロジェクトを読み込めませんでした。"); });
    return () => { active = false; stop(); };
  }, [activeTeamId, focused, needsHighlight, selectedHighlightProjectId, referenceRetry]);
  const noteSelectionEnabled = notePicker
    ? canReadNotes(currentUserProfile) && notePicker.teamId === activeTeamId
    : canPostNotes(currentUserProfile) && noteActionsOpen;
  const attachedNoteKeys = notePicker?.existingKeys || [];

  const { width, height } = useWindowDimensions();
  // The scrolling picker keeps a single column in either device orientation.
  const isLandscape = width > height && !useScrollableNotePicker;

  const [isSideUiVisible, setIsSideUiVisible] = useState(false);
  const [clipToastMessage, setClipToastMessage] = useState(null);

  const roleNameMap = {
    owner: `${currentUser}(監督)`,
    admin: `${currentUser}(管理者)`,
    staff: `${currentUser}(コーチ)`,
    captain: `${currentUser}(キャプテン)`,
    guardian: `${currentUser}(保護者)`,
    member: currentUser,
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const activeProjects = useMemo(() => {
    return projects.filter((p) => p.status !== "deleted");
  }, [projects]);

  const [expandedProjectTypes, setExpandedProjectTypes] = useState({});
  const [expandedProjectMonths, setExpandedProjectMonths] = useState({});
  const [expandedHighlightTypes, setExpandedHighlightTypes] = useState({});
  const [expandedHighlightMonths, setExpandedHighlightMonths] = useState({});
  const [expandedHighlightEditTypes, setExpandedHighlightEditTypes] =
    useState({});
  const [expandedHighlightEditMonths, setExpandedHighlightEditMonths] =
    useState({});
  const [isHighlightProjectEditModalVisible, setIsHighlightProjectEditModalVisible] =
    useState(false);
  const [editingHighlightProject, setEditingHighlightProject] = useState(null);
  const [editHighlightProjectTitle, setEditHighlightProjectTitle] = useState("");
  const [editHighlightVideoIds, setEditHighlightVideoIds] = useState([]);
  const [isSavingHighlightProjectEdit, setIsSavingHighlightProjectEdit] =
    useState(false);

  const visibleProjects = useMemo(() => {
    return activeProjects.filter(
      (project) =>
        !(
          ["member", "captain"].includes(userRole) &&
          project.participants === "coach"
        ),
    );
  }, [activeProjects, userRole]);

  const projectGroups = useMemo(
    () => groupProjectsByTypeAndMonth(visibleProjects),
    [visibleProjects],
  );
  const highlightVideoGroups = useMemo(
    () => groupProjectsByTypeAndMonth(activeProjects),
    [activeProjects],
  );
  const projectHierarchyRows = useMemo(
    () =>
      buildProjectHierarchyRows(
        projectGroups,
        expandedProjectMonths,
        expandedProjectTypes,
      ),
    [projectGroups, expandedProjectMonths, expandedProjectTypes],
  );
  const highlightVideoHierarchyRows = useMemo(
    () =>
      buildProjectHierarchyRows(
        highlightVideoGroups,
        expandedHighlightMonths,
        expandedHighlightTypes,
      ),
    [highlightVideoGroups, expandedHighlightMonths, expandedHighlightTypes],
  );
  const highlightEditVideoHierarchyRows = useMemo(
    () =>
      buildProjectHierarchyRows(
        highlightVideoGroups,
        expandedHighlightEditMonths,
        expandedHighlightEditTypes,
      ),
    [
      highlightVideoGroups,
      expandedHighlightEditMonths,
      expandedHighlightEditTypes,
    ],
  );

  const activeHighlightProjects = useMemo(() => {
    return highlightProjects.filter((p) => p.status !== "deleted");
  }, [highlightProjects]);

  const activeTagGroups = useMemo(() => {
    return tagGroups.filter((group) => group.status !== "deleted");
  }, [tagGroups]);

  const selectableTagGroups = useMemo(() => {
    return [DEFAULT_TAG_GROUP, ...activeTagGroups];
  }, [activeTagGroups]);

  const getTagGroupById = useCallback(
    (groupId) =>
      selectableTagGroups.find((group) => group.id === groupId) ||
      DEFAULT_TAG_GROUP,
    [selectableTagGroups],
  );

  const getProjectTagGroup = useCallback(
    (project) => {
      const matchedGroup = project?.tagGroupId
        ? activeTagGroups.find((group) => group.id === project.tagGroupId)
        : null;
      if (matchedGroup) return matchedGroup;
      if (project?.tagGroupName) {
        return {
          id: project.tagGroupId || DEFAULT_TAG_GROUP_ID,
          name: project.tagGroupName,
          tags: project.quickTags || DEFAULT_TAGS,
        };
      }
      return {
        ...DEFAULT_TAG_GROUP,
        tags: project?.quickTags?.length ? project.quickTags : DEFAULT_TAGS,
      };
    },
    [activeTagGroups],
  );

  const buildTagGroupProjectFields = useCallback(
    (groupId) => {
      const group = getTagGroupById(groupId);
      return {
        tagGroupId: group.id === DEFAULT_TAG_GROUP_ID ? null : group.id,
        tagGroupName: group.name,
        quickTags: group.tags || DEFAULT_TAGS,
      };
    },
    [getTagGroupById],
  );

  const selectedHighlightProject = useMemo(() => {
    if (notePlayback) return notePlayback;
    return (
      activeHighlightProjects.find((p) => p.id === selectedHighlightProjectId) ||
      null
    );
  }, [activeHighlightProjects, selectedHighlightProjectId, notePlayback]);
  const scrollNotePickerDetail = useScrollableNotePicker && Boolean(selectedHighlightProject);
  const ScreenBody = scrollNotePickerDetail ? ScrollView : notePlayback ? KeyboardAvoidingView : View;
  const PlaylistBody = scrollNotePickerDetail ? View : ScrollView;

  const selectedHighlightVideoIds = useMemo(() => {
    return new Set(selectedHighlightProject?.videoIds || []);
  }, [selectedHighlightProject]);
  const referenceIds = [...new Set([...(notePlayback ? (notePlayback.clips || []).map((clip) => clip.projectId) : [...selectedHighlightVideoIds]), ...(editingHighlightProject?.videoIds || [])])].sort().join("|");
  const referenceKey = `${activeTeamId}|${referenceIds}`;
  const referencesPending = highlightPending || Boolean(referenceIds && loadedReferenceKey !== referenceKey && referenceIds.split("|").some((id) => !projects.some((project) => project.id === id)));
  useEffect(() => {
    if (!focused || !activeTeamId || !referenceIds) return undefined;
    setReferenceError("");
    let active = true;
    const stop = subscribeProjectsByIds(activeTeamId, referenceIds.split("|"), (items) => { if (active) { setReferencedProjects(items); setLoadedReferenceKey(referenceKey); } }, () => { if (active) setReferenceError("参照動画を読み込めませんでした。"); });
    return () => { active = false; stop(); };
  }, [activeTeamId, focused, referenceIds, referenceRetry]);

  const highlightClipProjects = useMemo(() => {
    if (!selectedHighlightProject) return projects;
    return projects.filter((p) => selectedHighlightVideoIds.has(p.id));
  }, [projects, selectedHighlightProject, selectedHighlightVideoIds]);

  // ==========================================
  // プロジェクト（プレイリスト）用ステート
  // ==========================================
  const [selectedHighlightTags, setSelectedHighlightTags] = useState(notePicker?.tags || []);
  const [searchMode, setSearchMode] = useState(notePicker?.mode || "OR");

  const { allClips, availableTags } = useMemo(() => {
    if (notePlayback) return { allClips: buildNotePlaybackClips(notePlayback, projects), availableTags: [] };
    const clips = [];
    const tagSet = new Set();

    highlightClipProjects.forEach((p) => {
      if (p.status === "deleted") return;

      getProjectTagGroup(p).tags?.forEach((qt) => tagSet.add(qt));

      if (!p.videoUrl || !p.tags || p.tags.length === 0) return;

      const projectPreSeconds = normalizeClipSeconds(
        p.clipPreSeconds,
        DEFAULT_CLIP_PRE_SECONDS,
      );
      const projectPostSeconds = normalizeClipSeconds(
        p.clipPostSeconds,
        DEFAULT_CLIP_POST_SECONDS,
      );

      p.tags.forEach((tag) => {
        if (tag.status === "private" && tag.user !== displayUserName) return;

        const individualTags = tag.label
          .split("+")
          .map((t) => t.trim())
          .filter((t) => t);

        individualTags.forEach((t) => tagSet.add(t));

        const useCustomClipDuration = tag.useCustomClipDuration === true;
        const pre = useCustomClipDuration
          ? normalizeClipSeconds(tag.preSeconds, projectPreSeconds)
          : projectPreSeconds;
        const post = useCustomClipDuration
          ? normalizeClipSeconds(tag.postSeconds, projectPostSeconds)
          : projectPostSeconds;

        clips.push({
          id: tag.id,
          projectId: p.id,
          project: p.title,
          url: p.videoUrl,
          start: Math.max(0, tag.videoTime - pre),
          end: tag.videoTime + post,
          user: tag.user,
          type: p.type,
          date: p.date,
          status: tag.status || "shared",
          labels: individualTags,
          originalLabel: tag.label,
        });
      });
    });

    clips.sort((a, b) => a.start - b.start);
    return { allClips: clips, availableTags: Array.from(tagSet).sort() };
  }, [highlightClipProjects, displayUserName, getProjectTagGroup, notePlayback, projects]);

  const currentClips = useMemo(() => {
    if (selectedHighlightTags.length === 0) {
      return allClips;
    }

    return allClips.filter((clip) => {
      if (searchMode === "OR") {
        return selectedHighlightTags.some((tag) => clip.labels.includes(tag));
      } else {
        return selectedHighlightTags.every((tag) => clip.labels.includes(tag));
      }
    });
  }, [allClips, selectedHighlightTags, searchMode]);

  const initialNotePlayback = useRef(null);
  if (!initialNotePlayback.current) {
    const saved = notePlayback && notePlaybackState;
    const found = saved ? currentClips.findIndex((clip) => noteClipKey(clip) === saved.clipKey) : -1;
    const index = found >= 0 ? found : 0, clip = currentClips[index];
    const unchanged = Boolean(saved && found >= 0 && (clip?.url || referencesPending) && saved.sourceUrl === clip.sourceUrl &&
      saved.start === clip.start && saved.end === clip.end);
    const finished = unchanged && saved.finished === true;
    const validPosition = unchanged && Number.isFinite(saved.positionSeconds) &&
      saved.positionSeconds >= clip.start && saved.positionSeconds < clip.end;
    const positionSeconds = finished ? clip.end : validPosition ? saved.positionSeconds : clip?.start || 0;
    initialNotePlayback.current = { index, positionSeconds, finished, waitingForSource: referencesPending,
      playbackMode: saved && ["stop", "single", "all"].includes(saved.playbackMode) ? saved.playbackMode : "stop",
      resume: saved && clip ? { clipKey: noteClipKey(clip), sourceUrl: clip.sourceUrl, start: clip.start, end: clip.end,
        positionSeconds, isPlaying: validPosition && !finished && saved.isPlaying === true } : null };
  }
  const noteResumeRef = useRef(initialNotePlayback.current.resume);
  const notePlaybackCallback = useRef(onNotePlaybackStateChange);
  notePlaybackCallback.current = onNotePlaybackStateChange;
  const [playbackMode, setPlaybackMode] = useState(initialNotePlayback.current.playbackMode);
  const playbackModeRef = useRef(initialNotePlayback.current.playbackMode);
  const handleCyclePlaybackMode = () => {
    const nextMode = { stop: "single", single: "all", all: "stop" }[playbackModeRef.current];
    // Update synchronously so pending player callbacks see the latest choice.
    playbackModeRef.current = nextMode;
    setPlaybackMode(nextMode);
  };

  const [currentClipIndex, setCurrentClipIndex] = useState(initialNotePlayback.current.index);
  const [clipSelectionVersion, setClipSelectionVersion] = useState(0);
  const transitionRef = useRef(null);
  if (!transitionRef.current) {
    transitionRef.current = createClipPlaybackTransition();
  }
  const transition = transitionRef.current;
  const requestClipTransition = () => {
    noteResumeRef.current = null;
    transition.cancel();
    setClipSelectionVersion((version) => version + 1);
    setIsPlaying(false);
  };

  const [videoTime, setVideoTime] = useState(notePlayback ? initialNotePlayback.current.positionSeconds : 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [notePlaybackError, setNotePlaybackError] = useState(null);
  const [isClipEditing, setIsClipEditing] = useState(false);
  const isClipEditingRef = useRef(false);
  const [hasReachedPlaylistEnd, setHasReachedPlaylistEnd] = useState(initialNotePlayback.current.finished);

  const videoRef = useRef(null);
  const youtubeRef = useRef(null);
  const hasReachedPlaylistEndRef = useRef(initialNotePlayback.current.finished);
  const [youtubeReadyPlayer, setYoutubeReadyPlayer] = useState(null);
  const isYoutubeReady = Boolean(youtubeReadyPlayer) &&
    youtubeReadyPlayer === youtubeRef.current;
  const [nativeLoadVersion, setNativeLoadVersion] = useState(0);
  const youtubeTimeRequestRef = useRef(null);
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

  useEffect(() => {
    if (notePlayback || referencesPending) return;
    setSelectedHighlightTags((prev) => {
      const next = prev.filter((t) => availableTags.includes(t));
      return next.length === prev.length ? prev : next;
    });
  }, [availableTags, notePlayback, referencesPending]);

  useEffect(() => {
    if (selectedHighlightProjectId && !selectedHighlightProject && !highlightPending) {
      setSelectedHighlightProjectId(null);
      setIsPlaying(false);
    }
  }, [selectedHighlightProject, selectedHighlightProjectId, highlightPending]);

  const currentClip = currentClips[currentClipIndex] || null;
  // Unrelated project updates should not restart the selected clip.
  const clipPlaybackKey = JSON.stringify([
    currentClip?.projectId, currentClip?.id, currentClip?.url,
    currentClip?.start, currentClip?.end, clipSelectionVersion,
  ]);

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

  const extractYoutubeId = (url) => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|live\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };
  const ytId = currentClip ? extractYoutubeId(currentClip.url) : null;

  const stopAtClipEnd = useCallback(
    async (clip = currentClip, token = transition.current()) => {
      if (!transition.isCurrent(token)) return;
      const player = videoRef.current;
      hasReachedPlaylistEndRef.current = true;
      setHasReachedPlaylistEnd(true);
      setIsPlaying(false);

      const endMillis =
        typeof clip?.end === "number" ? Math.max(0, Math.round(clip.end * 1000)) : null;

      try {
        if (ytId) {
          return;
        }

        if (player) {
          await player.setStatusAsync({
            shouldPlay: false,
            ...(endMillis !== null ? { positionMillis: endMillis } : {}),
          });
        }
      } catch (error) {
        console.log("Highlight clip stop error:", error);
        try {
          if (transition.isCurrent(token)) await player?.pauseAsync();
        } catch (pauseError) {
          console.log("Highlight clip pause fallback error:", pauseError);
        }
      }
    },
    [currentClip, ytId],
  );

  const handleToggleTag = (tag) => {
    Keyboard.dismiss();
    requestClipTransition();
    isClipEditingRef.current = false;
    setIsClipEditing(false);
    hasReachedPlaylistEndRef.current = false;
    setHasReachedPlaylistEnd(false);
    setSelectedHighlightTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((t) => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
    setCurrentClipIndex(0);
  };

  const handleSelectClip = (index) => {
    if (!currentClips[index]) return;
    Keyboard.dismiss();
    requestClipTransition();
    isClipEditingRef.current = false;
    setIsClipEditing(false);
    hasReachedPlaylistEndRef.current = false;
    setHasReachedPlaylistEnd(false);
    setCurrentClipIndex(index);
  };

  const getEditableClipProject = (clip) => {
    const sourceProject = projects.find((item) => item.id === clip.projectId);
    if (!sourceProject || sourceProject.status === "deleted") return null;
    const tag = sourceProject.tags?.find((item) => item.id === clip.id);
    return canEditRecordedTag(tag, {
      userRole, canEditTags, currentUserUid, displayUserName,
    }) ? sourceProject : null;
  };

  const handleEditClip = (clip) => {
    const sourceProject = getEditableClipProject(clip);
    if (!sourceProject) return;
    Keyboard.dismiss();
    transition.cancel();
    isClipEditingRef.current = true;
    setIsClipEditing(true);
    setIsPlaying(false);
    navigation.navigate("ProjectDetail", {
      project: sourceProject,
      userRole,
      canEditTags,
      editRecordedTagId: clip.id,
    });
  };

  const playNextClip = (token) => {
    if (isClipEditingRef.current || !transition.isCurrent(token)) return;
    const mode = playbackModeRef.current;
    const nextIndex = mode === "single" ? currentClipIndex
      : currentClipIndex + 1 < currentClips.length ? currentClipIndex + 1
      : mode === "all" ? 0 : null;
    if (nextIndex !== null && currentClips[nextIndex]) {
      requestClipTransition();
      hasReachedPlaylistEndRef.current = false;
      setHasReachedPlaylistEnd(false);
      setCurrentClipIndex(nextIndex);
    } else {
      stopAtClipEnd(currentClip, token);
    }
  };

  useEffect(() => {
    if (!focused || referencesPending) return undefined;
    if (initialNotePlayback.current.waitingForSource) {
      initialNotePlayback.current.waitingForSource = false;
      if (!currentClip?.url) { noteResumeRef.current = null; setVideoTime(currentClip?.start || 0); setHasReachedPlaylistEnd(false); }
    }
    if (notePlayback && !currentClip?.url) {
      transition.cancel();
      setIsPlaying(false);
      return undefined;
    }
    if (!currentClip || isClipEditing || hasReachedPlaylistEnd ||
        activeTab !== "summary" || !selectedHighlightProjectId) return undefined;

    const saved = notePlayback && noteResumeRef.current;
    const resume = saved && saved.clipKey === noteClipKey(currentClip) && saved.sourceUrl === currentClip.sourceUrl &&
      saved.start === currentClip.start && saved.end === currentClip.end ? saved : null;
    const token = transition.begin(clipPlaybackKey, resume ? { ...currentClip, start: resume.positionSeconds } : currentClip);
    token.shouldPlay = resume ? resume.isPlaying : true;
    setIsPlaying(false);
    const fail = () => {
      if (!transition.isCurrent(token)) return;
      transition.cancel(token);
      setIsPlaying(false);
      Alert.alert("再生位置を変更できませんでした", notePlayback ? "場面を選択して、もう一度お試しください。" : "タグを選択して、もう一度お試しください。");
    };
    // A timeout never enables auto-advance with an unconfirmed position.
    const timeout = setTimeout(() => {
      if (token.phase === "seeking") fail();
    }, 15000);

    if (ytId) {
      if (isYoutubeReady && youtubeRef.current && youtubeReadyPlayer === youtubeRef.current) {
        try {
          transition.markSeekIssued(token);
          youtubeRef.current.seekTo(token.start, true);
        } catch (error) {
          fail();
        }
      }
    } else {
      const player = videoRef.current;
      transition.runNative(token, async () => {
        if (!player || player !== videoRef.current) return;
        const loaded = await player.getStatusAsync();
        if (!transition.isCurrent(token) || player !== videoRef.current) return;
        // onLoad reruns this effect once a newly selected source is loaded.
        if (!loaded.isLoaded) return;
        transition.markSeekIssued(token);
        const status = await player.setStatusAsync({
          positionMillis: Math.max(0, Math.round(token.start * 1000)),
          shouldPlay: false,
          seekMillisToleranceBefore: 0,
          seekMillisToleranceAfter: 0,
        });
        if (!transition.isCurrent(token) || player !== videoRef.current) return;
        if (!status.isLoaded || !Number.isFinite(status.positionMillis) ||
            Math.abs(status.positionMillis / 1000 - token.start) > 1) {
          fail();
          return;
        }
        // Keep native status callbacks blocked until both commands complete.
        const playingStatus = token.shouldPlay ? await player.playAsync() : status;
        if (!transition.isCurrent(token) || player !== videoRef.current) return;
        if (!playingStatus.isLoaded ||
            !transition.confirm(token, status.positionMillis / 1000)) {
          fail();
          return;
        }
        setVideoTime(notePlayback ? status.positionMillis / 1000 : Math.floor(status.positionMillis / 1000));
        setIsPlaying(token.shouldPlay);
      }).catch(fail);
    }

    return () => {
      clearTimeout(timeout);
      transition.cancel(token);
    };
  }, [
    clipPlaybackKey,
    isClipEditing,
    hasReachedPlaylistEnd,
    activeTab,
    selectedHighlightProjectId,
    ytId,
    isYoutubeReady,
    youtubeReadyPlayer,
    nativeLoadVersion,
    focused,
    referencesPending,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (ytId && currentClip && isYoutubeReady) {
      const interval = setInterval(async () => {
        const player = youtubeRef.current;
        const token = transition.current();
        if (!player || !transition.matches(clipPlaybackKey) || !token.seekIssued ||
            token.phase === "finished" || isClipEditingRef.current ||
            (!isPlaying && token.phase !== "seeking")) return;
        // The iframe API has no request IDs. Never overlap reads on one player,
        // even across effect cleanup/restart when the user selects another tag.
        if (youtubeTimeRequestRef.current?.player === player) return;
        const request = { player };
        youtubeTimeRequestRef.current = request;
        try {
          const currentTime = await player.getCurrentTime();
          if (cancelled || !transition.isCurrent(token) ||
              player !== youtubeRef.current || isClipEditingRef.current ||
              !Number.isFinite(currentTime)) return;
          if (token.phase === "seeking") {
            if (transition.confirm(token, currentTime)) {
              setVideoTime(notePlayback ? currentTime : Math.floor(currentTime));
              setIsPlaying(token.shouldPlay !== false);
            }
            return;
          }
          setVideoTime(notePlayback ? currentTime : Math.floor(currentTime));
          if (transition.consumeEnd(token, currentTime)) {
            playNextClip(token);
          }
        } catch (error) {
          console.log("YouTube current time error:", error);
        } finally {
          if (youtubeTimeRequestRef.current === request) {
            youtubeTimeRequestRef.current = null;
          }
        }
      }, 500);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }
  }, [
    isPlaying,
    ytId,
    clipPlaybackKey,
    currentClipIndex,
    currentClips.length,
    isYoutubeReady,
  ]);

  const handlePlaybackStatusUpdate = (status) => {
    if (isClipEditingRef.current) return;
    if (!status.isLoaded) return;
    const token = transition.current();
    if (!transition.matches(clipPlaybackKey) || !transition.canObserve(token)) return;

    const positionMillis = status.positionMillis || 0;
    setVideoTime(notePlayback ? positionMillis / 1000 : Math.floor(positionMillis / 1000));

    if (transition.consumeEnd(token, positionMillis / 1000, status.didJustFinish)) {
      playNextClip(token);
    } else {
      if (isPlaying !== status.isPlaying) {
        setIsPlaying(status.isPlaying);
      }
    }
  };

  const onYoutubeStateChange = useCallback((state) => {
    if (isClipEditingRef.current) return;
    const token = transition.current();
    if (!transition.matches(clipPlaybackKey) || !transition.canObserve(token)) return;
    if (state === "playing") {
      if (
        hasReachedPlaylistEndRef.current &&
        currentClipIndex >= currentClips.length - 1
      ) {
        setIsPlaying(false);
        return;
      }
      setIsPlaying(true);
    } else if (state === "ended") {
      if (transition.consumeEnd(token, token.end, true)) playNextClip(token);
    } else if (state === "paused") {
      setIsPlaying(false);
    }
  }, [clipPlaybackKey, currentClipIndex, currentClips.length]);

  useEffect(() => {
    if (!notePlayback || !currentClip || referencesPending || !focused) return;
    const token = transition.current();
    const seeking = transition.matches(clipPlaybackKey) && token.phase === "seeking";
    const positionSeconds = hasReachedPlaylistEnd ? currentClip.end : seeking ? token.start :
      Number.isFinite(videoTime) && videoTime >= currentClip.start && videoTime < currentClip.end ? videoTime : currentClip.start;
    notePlaybackCallback.current?.({ clipKey: noteClipKey(currentClip), sourceUrl: currentClip.sourceUrl,
      start: currentClip.start, end: currentClip.end, positionSeconds,
      isPlaying: Boolean(currentClip.url) && !hasReachedPlaylistEnd && (seeking ? token.shouldPlay !== false : isPlaying),
      playbackMode, finished: hasReachedPlaylistEnd });
  }, [notePlayback?.id, clipPlaybackKey, videoTime, isPlaying, playbackMode, hasReachedPlaylistEnd, referencesPending, focused]);

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
  const [selectedTagGroupId, setSelectedTagGroupId] = useState(
    DEFAULT_TAG_GROUP_ID,
  );
  const [editTagGroupId, setEditTagGroupId] = useState(DEFAULT_TAG_GROUP_ID);
  const [isSaving, setIsSaving] = useState(false);

  const [isHighlightProjectModalVisible, setIsHighlightProjectModalVisible] =
    useState(false);
  const [highlightProjectTitle, setHighlightProjectTitle] = useState("");
  const [draftHighlightVideoIds, setDraftHighlightVideoIds] = useState([]);
  const [isSavingHighlightProject, setIsSavingHighlightProject] =
    useState(false);

  const handleOpenCreateProjectModal = () => {
    setTitle("");
    setType("試合");
    setParticipants("team");
    setVideoUrl("");
    setSelectedTagGroupId(DEFAULT_TAG_GROUP_ID);
    setIsModalVisible(true);
  };

  const handleCreateProject = async () => {
    if (title.trim() === "") {
      return Alert.alert("エラー", "動画名を入力してください。");
    }

    const realUid = user?.uid || currentUser || "local_user";

    const tagGroupFields = buildTagGroupProjectFields(selectedTagGroupId);

    const newProject = {
      id: "proj_" + Date.now().toString(),
      title: title.trim(),
      type: type,
      participants: participants,
      videoUrl: videoUrl.trim(),
      date: new Date().toLocaleDateString("ja-JP"),
      status: "active",
      tags: [],
      ...tagGroupFields,
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
    setSelectedTagGroupId(DEFAULT_TAG_GROUP_ID);
    Alert.alert("成功", "動画を作成しました！");

    try {
      if (activeTeamId) {
        await createProject(activeTeamId, newProject);
      }
    } catch (error) {
      console.log("Firestore保存エラー:", error);
    }
  };

  const handleOpenHighlightProjectModal = () => {
    setHighlightProjectTitle("");
    setDraftHighlightVideoIds([]);
    setIsHighlightProjectModalVisible(true);
  };

  const handleToggleDraftHighlightVideo = (videoId) => {
    setDraftHighlightVideoIds((prev) =>
      prev.includes(videoId)
        ? prev.filter((id) => id !== videoId)
        : [...prev, videoId],
    );
  };

  const handleOpenHighlightProject = (projectId) => {
    requestClipTransition();
    isClipEditingRef.current = false;
    setIsClipEditing(false);
    setSelectedHighlightProjectId(projectId);
    setSelectedHighlightTags([]);
    setCurrentClipIndex(0);
    playbackModeRef.current = "stop";
    setPlaybackMode("stop");
    hasReachedPlaylistEndRef.current = false;
    setHasReachedPlaylistEnd(false);
    setIsPlaying(false);
  };

  const handleCreateHighlightProject = async () => {
    const trimmedTitle = highlightProjectTitle.trim();
    if (!trimmedTitle) {
      return Alert.alert("エラー", "プロジェクト名を入力してください。");
    }
    if (draftHighlightVideoIds.length === 0) {
      return Alert.alert("エラー", "動画を1件以上選択してください。");
    }

    const realUid = user?.uid || currentUser || "local_user";
    const newHighlightProject = {
      title: trimmedTitle,
      videoIds: draftHighlightVideoIds,
      status: "active",
      createdBy: realUid,
    };

    setIsSavingHighlightProject(true);
    try {
      if (activeTeamId) {
        await createHighlightProject(activeTeamId, newHighlightProject);
      }
      setIsHighlightProjectModalVisible(false);
      setHighlightProjectTitle("");
      setDraftHighlightVideoIds([]);
      Alert.alert("成功", "プロジェクトを作成しました！");
    } catch (error) {
      Alert.alert("エラー", "プロジェクトの作成に失敗しました。");
    } finally {
      setIsSavingHighlightProject(false);
    }
  };

  const handleOpenEditHighlightProject = (item) => {
    const activeVideoIds = new Set(activeProjects.map((project) => project.id));
    setEditingHighlightProject(item);
    setEditHighlightProjectTitle(item.title || "");
    setEditHighlightVideoIds(
      (item.videoIds || []).filter((videoId) => activeVideoIds.has(videoId)),
    );
    setExpandedHighlightEditTypes({});
    setExpandedHighlightEditMonths({});
    setIsHighlightProjectEditModalVisible(true);
  };

  const handleToggleEditHighlightVideo = (videoId) => {
    setEditHighlightVideoIds((previous) =>
      previous.includes(videoId)
        ? previous.filter((id) => id !== videoId)
        : [...previous, videoId],
    );
  };

  const handleSaveHighlightProjectEdit = async () => {
    const trimmedTitle = editHighlightProjectTitle.trim();
    if (!trimmedTitle) {
      return Alert.alert("エラー", "プロジェクト名を入力してください。");
    }
    if (editHighlightVideoIds.length === 0) {
      return Alert.alert("エラー", "動画を1件以上選択してください。");
    }
    if (!activeTeamId || !editingHighlightProject) return;

    setIsSavingHighlightProjectEdit(true);
    try {
      await updateHighlightProject(activeTeamId, editingHighlightProject.id, {
        title: trimmedTitle,
        videoIds: editHighlightVideoIds,
      });
      setIsHighlightProjectEditModalVisible(false);
      setEditingHighlightProject(null);
      Alert.alert("成功", "プロジェクトを更新しました。");
    } catch (error) {
      Alert.alert("エラー", "プロジェクトの更新に失敗しました。");
    } finally {
      setIsSavingHighlightProjectEdit(false);
    }
  };

  const handleDeleteHighlightProjectFromEdit = () => {
    if (!editingHighlightProject) return;

    Alert.alert(
      "削除の確認",
      `「${editingHighlightProject.title}」を削除しますか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: async () => {
            setIsSavingHighlightProjectEdit(true);
            try {
              if (activeTeamId) {
                await deleteHighlightProject(
                  activeTeamId,
                  editingHighlightProject.id,
                );
              }
              if (selectedHighlightProjectId === editingHighlightProject.id) {
                setSelectedHighlightProjectId(null);
              }
              setIsHighlightProjectEditModalVisible(false);
              setEditingHighlightProject(null);
              Alert.alert("成功", "プロジェクトを削除しました。");
            } catch (error) {
              Alert.alert("エラー", "プロジェクトの削除に失敗しました。");
            } finally {
              setIsSavingHighlightProjectEdit(false);
            }
          },
        },
      ],
    );
  };

  const handleOpenEditProject = (item) => {
    setEditingProject(item);
    setEditTitle(item.title);
    setEditTagGroupId(item.tagGroupId || DEFAULT_TAG_GROUP_ID);
    setIsEditModalVisible(true);
  };

  const handleSaveEditProject = async () => {
    if (!editTitle.trim()) {
      return Alert.alert("エラー", "動画名を入力してください。");
    }

    const tagGroupFields = buildTagGroupProjectFields(editTagGroupId);

    setProjects(
      projects.map((p) =>
        p.id === editingProject.id
          ? { ...p, title: editTitle.trim(), ...tagGroupFields }
          : p,
      ),
    );
    setIsEditModalVisible(false);

    try {
      if (activeTeamId) {
        await updateProject(activeTeamId, editingProject.id, {
          title: editTitle.trim(),
          ...tagGroupFields,
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

  const renderProjectItem = ({ item }) => {
    const normalizedType = normalizeProjectType(item);

    return (
      <TouchableOpacity
        style={[styles.card, styles.videoListCard]}
        onPress={() =>
          navigation.navigate("ProjectDetail", {
            project: item,
            userRole,
            canEditTags,
          })
        }
      >
        <View style={[styles.cardHeader, styles.videoListCardHeader]}>
          <View
            style={[
              styles.badge,
              normalizedType === "試合"
                ? styles.badgeMatch
                : normalizedType === "練習"
                  ? styles.badgePractice
                  : styles.badgeOther,
            ]}
          >
            <Text style={styles.badgeText}>{normalizedType}</Text>
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
        <View style={styles.cardMetaRow}>
          <Text style={styles.cardSub}>作成日: {item.date}</Text>
          <Text style={styles.tagGroupText} numberOfLines={1}>
            タグリスト: {getProjectTagGroup(item).name}
          </Text>
        </View>
        {!item.videoUrl && (
          <Text style={styles.noUrlText}>※ 動画未設定</Text>
        )}
      </TouchableOpacity>
    );
  };

  const toggleExpandedType = (setExpandedTypes, item) => {
    setExpandedTypes((previous) => {
      const current =
        previous[item.type] !== undefined ? previous[item.type] : true;
      return { ...previous, [item.type]: !current };
    });
  };

  const toggleExpandedMonth = (setExpandedMonths, item) => {
    const expansionKey = `${item.type}:${item.monthKey}`;
    setExpandedMonths((previous) => {
      const current =
        previous[expansionKey] !== undefined
          ? previous[expansionKey]
          : item.monthIndex === 0;
      return { ...previous, [expansionKey]: !current };
    });
  };

  const renderHierarchyHeader = (
    item,
    setExpandedMonths,
    setExpandedTypes,
    compact = false,
  ) => {
    if (item.kind === "type") {
      const isPractice = item.type === "練習";
      const isOther = item.type === "その他";
      return (
        <TouchableOpacity
          key={item.key}
          style={[
            styles.projectTypeHeader,
            isPractice && styles.projectTypeHeaderPractice,
            isOther && styles.projectTypeHeaderOther,
            compact && styles.videoSelectTypeHeader,
          ]}
          onPress={() => toggleExpandedType(setExpandedTypes, item)}
          accessibilityRole="button"
          accessibilityState={{ expanded: item.expanded }}
        >
          <Text
            style={[
              styles.projectTypeHeaderText,
              isPractice && styles.projectTypeHeaderTextPractice,
              isOther && styles.projectTypeHeaderTextOther,
            ]}
          >
            {item.expanded ? "▼" : "▶"} {item.label}
          </Text>
          <Text style={styles.projectTypeCount}>{item.projectCount}件</Text>
        </TouchableOpacity>
      );
    }
    if (item.kind === "month") {
      return (
        <TouchableOpacity
          key={item.key}
          style={[
            styles.projectMonthHeader,
            compact && styles.videoSelectMonthHeader,
          ]}
          onPress={() => toggleExpandedMonth(setExpandedMonths, item)}
          accessibilityRole="button"
          accessibilityState={{ expanded: item.expanded }}
        >
          <Text style={styles.projectMonthHeaderText}>
            {item.expanded ? "▼" : "▶"} {item.label}
          </Text>
          <Text style={styles.projectMonthCount}>{item.projectCount}件</Text>
        </TouchableOpacity>
      );
    }
    return null;
  };

  const renderProjectHierarchyItem = ({ item }) => {
    if (item.kind !== "project") {
      return renderHierarchyHeader(
        item,
        setExpandedProjectMonths,
        setExpandedProjectTypes,
      );
    }
    return renderProjectItem({ item: item.project });
  };

  const renderHighlightVideoSelectionRow = (
    item,
    selectedVideoIds,
    onToggle,
    setExpandedMonths,
    setExpandedTypes,
  ) => {
    if (item.kind !== "project") {
      return renderHierarchyHeader(
        item,
        setExpandedMonths,
        setExpandedTypes,
        true,
      );
    }

    const project = item.project;
    const isSelected = selectedVideoIds.includes(project.id);
    return (
      <TouchableOpacity
        key={item.key}
        style={[
          styles.videoSelectItem,
          styles.videoSelectProjectItem,
          isSelected && styles.videoSelectItemActive,
        ]}
        onPress={() => onToggle(project.id)}
      >
        <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
          <Text style={styles.checkboxText}>{isSelected ? "✓" : ""}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.videoSelectTitle} numberOfLines={1}>
            {project.title}
          </Text>
          <Text style={styles.videoSelectSub} numberOfLines={1}>
            {project.videoUrl ? "動画リンクあり" : "動画未設定"}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHighlightProjectItem = ({ item }) => {
    const videoIdSet = new Set(item.videoIds || []);
    const selectedVideos = activeProjects.filter((p) => videoIdSet.has(p.id));
    const previewTitle = selectedVideos.map((p) => p.title).join("、");

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => handleOpenHighlightProject(item.id)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          {canManageProject && (
            <TouchableOpacity
              style={styles.editIconBtn}
              onPress={() => handleOpenEditHighlightProject(item)}
            >
              <Text style={styles.editIconText}>⚙️</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.highlightProjectMeta}>
          動画 {videoIdSet.size} 件
        </Text>
        <Text style={styles.cardSub} numberOfLines={2}>
          {previewTitle || (videoIdSet.size ? "開いて動画を表示" : "動画が選択されていません")}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderHighlightProjectList = () => (
    <>
      <View style={styles.topRow}>
        <Text style={styles.sectionTitle}>プロジェクト一覧</Text>
        {canCreateProject && (
          <TouchableOpacity
            style={styles.createBtn}
            onPress={handleOpenHighlightProjectModal}
          >
            <Text style={styles.createBtnText}>＋ 新規追加</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={activeHighlightProjects}
        keyExtractor={(item) => item.id}
        renderItem={renderHighlightProjectItem}
        ListEmptyComponent={
          <Text style={styles.emptyText}>プロジェクトがありません。</Text>
        }
      />
    </>
  );

  const renderHighlightProjectDetailHeader = () => (
    <View style={styles.highlightDetailHeader}>
      <TouchableOpacity
        style={styles.highlightBackBtn}
        onPress={() => {
          setSelectedHighlightProjectId(null);
          setIsPlaying(false);
        }}
      >
        <Text style={styles.highlightBackText}>一覧へ</Text>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.highlightDetailTitle} numberOfLines={1}>
          {selectedHighlightProject?.title || "プロジェクト"}
        </Text>
        <Text style={styles.highlightDetailSub}>
          動画 {selectedHighlightProject?.videoIds?.length || 0} 件 / タグ絞り込み利用可
        </Text>
      </View>
    </View>
  );

  const handleToggleNoteClip = (clip) => {
    try {
      setNoteSelection(toggleNoteClipSelection(noteSelection, clip, attachedNoteKeys));
    } catch (error) {
      Alert.alert("選択上限", error.message);
    }
  };

  const handleConfirmNoteSelection = () => {
    if (!noteSelectionEnabled || !noteSelection.length) return;
    const available = buildNoteClips(projects, { videoIds: projects.map((p) => p.id) });
    const clips = noteSelection.filter((clip) => available.some((current) =>
      noteClipKey(current) === noteClipKey(clip) && current.sourceUrl === clip.sourceUrl));
    if (clips.length !== noteSelection.length) {
      setNoteSelection(clips);
      Alert.alert("場面を確認", "削除・非公開化などで利用できなくなった場面を選択から外しました。内容を確認して再度追加してください。");
      return;
    }
    requestClipTransition();
    setIsPlaying(false);
    setHasReachedPlaylistEnd(true);
    if (notePicker) {
      navigation.dispatch({ ...CommonActions.setParams({
        noteAttachmentResult: { clips, sourceId: selectedHighlightProjectId || "", teamId: activeTeamId },
      }), source: notePicker.returnKey });
      navigation.goBack();
    } else {
      navigation.push("TacticalNotes", { noteSeed: {
        sourceId: selectedHighlightProjectId, clips,
        tags: [...selectedHighlightTags], mode: searchMode,
      } });
      setNoteSelection([]);
      setNoteActionsOpen(false);
    }
  };

  const renderNoteSelectionControls = () => {
    if (notePlayback) return null;
    if (!notePicker && (!canPostNotes(currentUserProfile) || activeTab !== "summary")) return null;
    return <View style={{ backgroundColor: "#f0f6fc", paddingHorizontal: 10, paddingVertical: 4 }}>
      {!notePicker && <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: noteActionsOpen }}
        onPress={() => setNoteActionsOpen((open) => !open)} style={{ alignSelf: "flex-end", padding: 6 }}>
        <Text style={{ color: COLORS.primary, fontSize: 12 }}>戦術ノート {noteActionsOpen ? "▾" : "▸"}</Text>
      </TouchableOpacity>}
      {(notePicker || noteActionsOpen) && <>
        <Text style={{ color: COLORS.textSub, fontSize: 12 }}>左のチェックで場面を選択・カードを押すと再生。絞り込みやプロジェクトを変えても選択は保持されます。</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <TouchableOpacity accessibilityRole="button" disabled={!noteSelectionEnabled || !noteSelection.length}
            accessibilityState={{ disabled: !noteSelectionEnabled || !noteSelection.length }}
            onPress={handleConfirmNoteSelection} style={[styles.noteSelectionButton, { opacity: noteSelectionEnabled && noteSelection.length ? 1 : 0.4 }]}>
            <Text style={styles.noteSelectionButtonText}>{notePicker ? `選択した${noteSelection.length}件を追加` : `選択した${noteSelection.length}件でノートを作成`}</Text>
          </TouchableOpacity>
          {!!noteSelection.length && <TouchableOpacity onPress={() => setNoteSelection([])}><Text>選択解除</Text></TouchableOpacity>}
          {notePicker && <TouchableOpacity onPress={() => navigation.goBack()}><Text>キャンセル</Text></TouchableOpacity>}
        </View>
      </>}
    </View>;
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
              requestClipTransition();
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
              requestClipTransition();
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
        style={isLandscape ? styles.fsTagScroll : undefined}
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

  const handleNotePlaybackError = () => {
    if (!notePlayback || !transition.matches(clipPlaybackKey)) return;
    transition.cancel();
    setIsPlaying(false);
    setNotePlaybackError(clipPlaybackKey);
  };

  const renderVideoPlayer = () => (
    <View
      style={[styles.videoPlayerArea, isLandscape && styles.fsVideoPlayerArea]}
      onTouchStart={Keyboard.dismiss}
    >
      {notePlayback && (!currentClip?.url || notePlaybackError === clipPlaybackKey) ? (
        <View style={styles.stoppedVideoPlaceholder}>
          <Text style={styles.stoppedVideoText}>この場面は再生できません。別の場面を選択してください。</Text>
        </View>
      ) : isClipEditing || hasReachedPlaylistEnd ? (
        <View style={styles.stoppedVideoPlaceholder}>
          <Text style={styles.stoppedVideoText}>
            {isClipEditing ? "切り抜きを選択して再生" : "再生終了"}
          </Text>
        </View>
      ) : ytId ? (
        <View
          style={[
            styles.youtubeContainer,
            isLandscape && styles.fsYoutubeContainer,
            { pointerEvents: "auto" },
          ]}
        >
          <YoutubePlayer
            key={ytId}
            ref={youtubeRef}
            height={isLandscape ? height : 200}
            play={isPlaying}
            videoId={ytId}
            onReady={() => setYoutubeReadyPlayer(youtubeRef.current)}
            onChangeState={onYoutubeStateChange}
            onError={notePlayback ? handleNotePlaybackError : undefined}
            initialPlayerParams={{ controls: 0, rel: 0 }}
          />
        </View>
      ) : (
        <Video
          key={currentClip?.url}
          ref={videoRef}
          source={{ uri: currentClip?.url }}
          style={styles.videoComponent}
          resizeMode={ResizeMode.CONTAIN}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
          onLoad={() => setNativeLoadVersion((version) => version + 1)}
          onError={notePlayback ? handleNotePlaybackError : undefined}
          useNativeControls={true}
          shouldPlay={isPlaying}
        />
      )}

      <View style={styles.videoOverlay}>
        <Text style={styles.overlayProjectName}>
          {currentClip?.project || ""}
        </Text>
        {!notePlayback && <Text style={styles.overlayTag}>
          🏷️ {currentClip?.originalLabel || ""}
        </Text>}
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
        {!useScrollableNotePicker && <TouchableOpacity
          style={styles.fullscreenBtn}
          onPress={isLandscape ? closeLandscapeMode : openLandscapeMode}
        >
          <Text style={styles.fullscreenBtnText}>
            {isLandscape ? "><" : "[  ]"}
          </Text>
        </TouchableOpacity>}
      </View>
    </View>
  );

  const renderPlaylist = () => (
    <View style={scrollNotePickerDetail ? undefined : { flex: 1, minHeight: 0 }}>
      <PlaylistBody
        style={scrollNotePickerDetail ? styles.notePickerPlaylist : [styles.playlistScroll, isLandscape && { paddingHorizontal: 0 }]}
        {...(!scrollNotePickerDetail ? {
          showsVerticalScrollIndicator: false,
          keyboardShouldPersistTaps: "handled",
          onScrollBeginDrag: Keyboard.dismiss,
        } : {})}
        onTouchStart={Keyboard.dismiss}
      >
        {!isLandscape && (
          <Text style={styles.playlistSub}>
            ※再生が終わると自動で次に進みます
          </Text>
        )}
        {currentClips.map((clip, index) => (
          <View key={`${clip.projectId}_${clip.id}`} style={{ flexDirection: "row", alignItems: "center" }}>
          {noteSelectionEnabled && <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityLabel={`${clip.project} ${formatTime(clip.start)}からの場面${attachedNoteKeys.includes(noteClipKey(clip)) ? "（添付済み）" : ""}`}
            accessibilityState={{ checked: attachedNoteKeys.includes(noteClipKey(clip)) || noteSelection.some((item) => noteClipKey(item) === noteClipKey(clip)), disabled: clip.status === "private" || attachedNoteKeys.includes(noteClipKey(clip)) }}
            disabled={clip.status === "private" || attachedNoteKeys.includes(noteClipKey(clip))}
            onPress={() => handleToggleNoteClip(clip)}
            style={{ width: 44, minHeight: 44, justifyContent: "center", alignItems: "center", opacity: clip.status === "private" ? 0.3 : 1 }}>
            <Text style={{ fontSize: 24, color: COLORS.primary }}>{attachedNoteKeys.includes(noteClipKey(clip)) || noteSelection.some((item) => noteClipKey(item) === noteClipKey(clip)) ? "☑" : "☐"}</Text>
          </TouchableOpacity>}
          <TouchableOpacity
            key={`${clip.projectId}_${clip.id}`}
            style={[
              styles.clipCard,
              { flex: 1 },
              currentClipIndex === index && styles.clipCardActive,
            ]}
            onPress={() => handleSelectClip(index)}
            onLongPress={!notePicker && !notePlayback && getEditableClipProject(clip) ? () => handleEditClip(clip) : undefined}
            accessibilityHint={!notePlayback && getEditableClipProject(clip) ? "長押しで切り取りタグを編集" : undefined}
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
              </View>
              <Text style={styles.clipCardSub}>
                ⏱ {formatTime(clip.start)} 〜 {formatTime(clip.end)}
                {!notePlayback && ` / ${clip.date} / by ${clip.user}`}
              </Text>
              {notePlayback && <Text style={{ marginTop: 6, color: "#333" }}>{clip.comment || "コメントなし"}</Text>}
              {notePlayback && !clip.url && <Text style={{ color: COLORS.danger, marginTop: 4 }}>元動画が利用できないため再生できません</Text>}
            </View>
            {currentClipIndex === index && isPlaying ? (
              <Text style={styles.playingIcon}>▶</Text>
            ) : null}
          </TouchableOpacity>
          </View>
        ))}
        <View style={{ height: 30 }} />
      </PlaylistBody>
    </View>
  );

  const renderSummaryRightPane = () => (
    <View style={scrollNotePickerDetail ? { paddingTop: 5 } : { flex: 1, minHeight: 0, paddingTop: 5 }}>
      <View style={[styles.summaryTabRow, isLandscape && { marginHorizontal: 0 }]}>
        <View style={styles.summaryTabBtn}>
          <Text style={styles.summaryTabBtnText}>プレイリスト</Text>
        </View>
        <TouchableOpacity
          style={[styles.summaryTabBtn, styles.summaryTabBtnActive]}
          onPress={handleCyclePlaybackMode}
          accessibilityRole="button"
          accessibilityLabel={
            "再生モード：" + { single: notePlayback ? "1場面リピート" : "1タグリピート", all: "全体リピート", stop: "最後で終了" }[playbackMode]
          }
          accessibilityHint="タップすると次の再生モードに切り替わります"
        >
          <Text style={[styles.summaryTabBtnText, styles.summaryTabBtnTextActive]}>
            {{ single: notePlayback ? "1場面リピート" : "1タグリピート", all: "全体リピート", stop: "最後で終了" }[playbackMode]}
          </Text>
        </TouchableOpacity>
      </View>
      {renderPlaylist()}
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

      <ScreenBody style={{ flex: 1 }} {...(notePlayback ? { behavior: Platform.OS === "ios" ? "padding" : undefined } : {})} {...(scrollNotePickerDetail ? {
        contentContainerStyle: styles.notePickerScrollContent,
        keyboardShouldPersistTaps: "handled",
        onScrollBeginDrag: Keyboard.dismiss,
      } : {})}>

      {!isLandscape && (
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => notePlayback ? onCloseNotePlayback() : navigation.goBack()}
          >
            <Text style={styles.backButtonText}>{notePlayback ? "◁ 一覧" : notePicker ? "◁ ノート" : "◁ ホーム"}</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{notePlayback ? "戦術ノート" : notePicker ? "場面を選択" : "🎬 動画"}</Text>
          <View style={{ width: 60 }} />
        </View>
      )}

      {!isLandscape && !notePicker && !notePlayback && (
        <View style={styles.tabContainer}>
          {[
            { id: "list", label: "動画編集（タグ付け）" },
            { id: "summary", label: "動画閲覧" },
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

      {renderNoteSelectionControls()}
      {!notePlayback && !isLandscape && <HistoryLoadingControls history={activeTab === "summary" && !selectedHighlightProject ? highlightHistory : history} label="過去の動画を追加読み込み" />}
      {notePlayback && !isLandscape && <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 210, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 15 }}>{noteHeader}</ScrollView>}
      <View style={[styles.content, isLandscape && { padding: 0 }, scrollNotePickerDetail && styles.notePickerFlow]}>
        {activeTab === "summary" ? (
          selectedHighlightProject ? (
            <>
              {!isLandscape && !notePlayback && renderHighlightProjectDetailHeader()}
              <View
                style={[
                  styles.summaryContainer,
                  scrollNotePickerDetail && styles.notePickerFlow,
                  isLandscape && { flexDirection: "row", marginHorizontal: 0 },
                ]}
              >
            <View
              style={[
                isLandscape ? styles.fsVideoCol : {},
                isLandscape && !isSideUiVisible && { flex: 1 },
              ]}
            >
              {!isLandscape && !notePlayback && renderTagSelector()}

              {referencesPending ? <View style={{ padding: 20 }}><Text>参照動画を読み込み中…</Text>{!!referenceError && <TouchableOpacity onPress={() => setReferenceRetry((value) => value + 1)}><Text>{referenceError} タップして再試行</Text></TouchableOpacity>}</View> : currentClips.length === 0 ? (
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
                scrollNotePickerDetail ? undefined : isLandscape
                  ? styles.fsUiCol
                  : {
                      flex: 1,
                      display: currentClips.length === 0 ? "none" : "flex",
                    },
                isLandscape && !isSideUiVisible && { display: "none" },
              ]}
            >
              {isLandscape && !notePlayback && renderTagSelector()}
              {currentClips.length > 0 && renderSummaryRightPane()}
            </View>
              </View>
            </>
          ) : (
            renderHighlightProjectList()
          )
        ) : (
          <>
            <View style={styles.topRow}>
              <Text style={styles.sectionTitle}>動画一覧</Text>
              {(canCreateProject || canEditTagGroups) && (
                <View style={styles.topActions}>
                  {canCreateProject && (
                    <TouchableOpacity
                      style={styles.createBtn}
                      onPress={handleOpenCreateProjectModal}
                    >
                      <Text style={styles.createBtnText}>新規追加</Text>
                    </TouchableOpacity>
                  )}
                  {canEditTagGroups && (
                    <TouchableOpacity
                      style={styles.tagEditBtn}
                      onPress={() => navigation.navigate("TagGroupEdit")}
                    >
                      <Text style={styles.tagEditBtnText}>タグ編集</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            <FlatList
              data={projectHierarchyRows}
              keyExtractor={(item) => item.key}
              renderItem={renderProjectHierarchyItem}
              ListEmptyComponent={
                <Text style={styles.emptyText}>動画がありません。</Text>
              }
            />
          </>
        )}
      </View>
      {scrollNotePickerDetail && currentClips.length > 0 && renderNoteSelectionControls()}
      </ScreenBody>

      {/* プロジェクト作成モーダル */}
      <Modal visible={isModalVisible} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <Text style={styles.modalTitle}>新しい動画を追加</Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 50 }}
            >
              <Text style={styles.label}>動画名</Text>
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


              <Text style={styles.label}>タグリスト</Text>
              <View style={styles.tagGroupSelector}>
                {selectableTagGroups.map((group) => {
                  const isSelected = selectedTagGroupId === group.id;
                  return (
                    <TouchableOpacity
                      key={group.id}
                      style={[
                        styles.tagGroupOption,
                        isSelected && styles.tagGroupOptionActive,
                      ]}
                      onPress={() => setSelectedTagGroupId(group.id)}
                    >
                      <Text
                        style={[
                          styles.tagGroupOptionText,
                          isSelected && styles.tagGroupOptionTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {group.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
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
      {/* Highlight project creation modal */}
      <Modal
        visible={isHighlightProjectModalVisible}
        transparent={true}
        animationType="slide"
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.highlightProjectModalContent}
          >
            <Text style={styles.modalTitle}>新しいプロジェクトを追加</Text>

            <View style={styles.highlightProjectModalBody}>
              <Text style={styles.label}>プロジェクト名</Text>
              <TextInput
                style={styles.input}
                placeholder="例: 決勝戦ハイライト"
                value={highlightProjectTitle}
                onChangeText={setHighlightProjectTitle}
              />

              <Text style={styles.label}>格納する動画</Text>
              <ScrollView
                style={styles.videoSelectList}
                contentContainerStyle={styles.videoSelectListContent}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps="handled"
              >
                {isHighlightProjectModalVisible && <HistoryLoadingControls history={history} label="過去の動画を追加読み込み" />}
                {highlightVideoHierarchyRows.length === 0 ? (
                  <Text style={styles.videoSelectEmptyText}>
                    選択できる動画がありません。
                  </Text>
                ) : (
                  highlightVideoHierarchyRows.map((item) =>
                    renderHighlightVideoSelectionRow(
                      item,
                      draftHighlightVideoIds,
                      handleToggleDraftHighlightVideo,
                      setExpandedHighlightMonths,
                      setExpandedHighlightTypes,
                    ),
                  )
                )}
              </ScrollView>
            </View>

            <View style={styles.highlightProjectFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsHighlightProjectModalVisible(false)}
                disabled={isSavingHighlightProject}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  isSavingHighlightProject && { opacity: 0.7 },
                ]}
                onPress={handleCreateHighlightProject}
                disabled={isSavingHighlightProject}
              >
                <Text style={styles.submitBtnText}>
                  {isSavingHighlightProject ? "保存中..." : "作成する"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Highlight project edit modal */}
      <Modal
        visible={isHighlightProjectEditModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.highlightProjectModalContent}
          >
            <Text style={styles.modalTitle}>プロジェクトの編集</Text>

            <View style={styles.highlightProjectModalBody}>
              <Text style={styles.label}>プロジェクト名</Text>
              <TextInput
                style={styles.input}
                value={editHighlightProjectTitle}
                onChangeText={setEditHighlightProjectTitle}
                placeholder="プロジェクト名"
                editable={!isSavingHighlightProjectEdit}
              />

              <Text style={styles.label}>格納する動画</Text>
              <ScrollView
                style={styles.videoSelectList}
                contentContainerStyle={styles.videoSelectListContent}
                showsVerticalScrollIndicator={true}
                nestedScrollEnabled={true}
                keyboardShouldPersistTaps="handled"
              >
                {isHighlightProjectEditModalVisible && <HistoryLoadingControls history={history} label="過去の動画を追加読み込み" />}
                {highlightEditVideoHierarchyRows.length === 0 ? (
                  <Text style={styles.videoSelectEmptyText}>
                    選択できる動画がありません。
                  </Text>
                ) : (
                  highlightEditVideoHierarchyRows.map((item) =>
                    renderHighlightVideoSelectionRow(
                      item,
                      editHighlightVideoIds,
                      handleToggleEditHighlightVideo,
                      setExpandedHighlightEditMonths,
                      setExpandedHighlightEditTypes,
                    ),
                  )
                )}
              </ScrollView>

              <TouchableOpacity
                style={[
                  styles.editProjectDeleteBtn,
                  isSavingHighlightProjectEdit && { opacity: 0.7 },
                ]}
                onPress={handleDeleteHighlightProjectFromEdit}
                disabled={isSavingHighlightProjectEdit}
              >
                <Text style={styles.editProjectDeleteBtnText}>
                  🗑️ このプロジェクトを削除する
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.highlightProjectFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setIsHighlightProjectEditModalVisible(false)}
                disabled={isSavingHighlightProjectEdit}
              >
                <Text style={styles.cancelBtnText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  isSavingHighlightProjectEdit && { opacity: 0.7 },
                ]}
                onPress={handleSaveHighlightProjectEdit}
                disabled={isSavingHighlightProjectEdit}
              >
                <Text style={styles.submitBtnText}>
                  {isSavingHighlightProjectEdit ? "保存中..." : "変更を保存"}
                </Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Project edit modal */}
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
            <Text style={styles.modalTitle}>動画の編集</Text>

            <Text style={styles.label}>動画名</Text>
            <TextInput
              style={styles.editProjectInput}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="動画名"
            />

            <Text style={styles.label}>タグリスト</Text>
            <View style={styles.tagGroupSelector}>
              {selectableTagGroups.map((group) => {
                const isSelected = editTagGroupId === group.id;
                return (
                  <TouchableOpacity
                    key={group.id}
                    style={[
                      styles.tagGroupOption,
                      isSelected && styles.tagGroupOptionActive,
                    ]}
                    onPress={() => setEditTagGroupId(group.id)}
                  >
                    <Text
                      style={[
                        styles.tagGroupOptionText,
                        isSelected && styles.tagGroupOptionTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {group.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={styles.editProjectDeleteBtn}
              onPress={handleDeleteProjectFromEdit}
            >
              <Text style={styles.editProjectDeleteBtnText}>
                🗑️ この動画を消去する
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
  noteSelectionButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minHeight: 48,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  noteSelectionButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  notePickerScrollContent: { paddingBottom: 24 },
  notePickerFlow: { flex: 0 },
  notePickerPlaylist: { paddingHorizontal: 15 },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 18, fontWeight: "bold", color: "#333" },
  createBtn: {
    backgroundColor: "#0077cc",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  createBtnText: { color: "#fff", fontWeight: "bold", fontSize: 13 },
  topActions: { flexDirection: "row", alignItems: "center" },
  tagEditBtn: {
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "#0077cc",
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  tagEditBtnText: { color: "#0077cc", fontWeight: "bold", fontSize: 13 },
  emptyText: { textAlign: "center", color: "#888", marginTop: 30 },
  projectTypeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#dceeff",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
    marginBottom: 8,
  },
  projectTypeHeaderPractice: { backgroundColor: "#fff1a8" },
  projectTypeHeaderOther: { backgroundColor: "#d8f3dc" },
  projectTypeHeaderText: {
    color: "#005a9c",
    fontSize: 16,
    fontWeight: "bold",
  },
  projectTypeHeaderTextPractice: { color: "#7a5200" },
  projectTypeHeaderTextOther: { color: "#1d6b3a" },
  projectTypeCount: { color: "#52616b", fontSize: 12, fontWeight: "bold" },
  projectMonthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d9e2ec",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginLeft: 8,
    marginBottom: 8,
  },
  projectMonthHeaderText: { color: "#334e68", fontSize: 14, fontWeight: "bold" },
  projectMonthCount: { color: "#7b8794", fontSize: 12 },
  card: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#0077cc",
    elevation: 1,
  },
  videoListCard: { paddingTop: 10, paddingBottom: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  videoListCardHeader: { marginBottom: 4 },
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

  cardMetaRow: { flexDirection: "row", alignItems: "center", minWidth: 0 },
  cardSub: { fontSize: 12, color: "#888", flexShrink: 0, marginRight: 10 },
  tagGroupText: {
    fontSize: 12,
    color: "#0077cc",
    fontWeight: "bold",
    flex: 1,
    minWidth: 0,
  },
  noUrlText: { fontSize: 12, color: "#e74c3c", marginTop: 5 },

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
  stoppedVideoPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  stoppedVideoText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
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

  fsVideoCol: {
    flex: 0.6,
    backgroundColor: "#000",
    justifyContent: "center",
    position: "relative",
  },
  fsUiCol: {
    flex: 0.4,
    minHeight: 0,
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
    maxHeight: "45%",
    borderBottomWidth: 0,
    paddingBottom: 10,
    paddingHorizontal: 0,
  },
  fsTagScroll: {
    flexShrink: 1,    
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
  playlistScroll: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 15,
  },
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
  tagGroupSelector: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 10,
  },
  tagGroupOption: {
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "#f9f9f9",
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
    maxWidth: "48%",
  },
  tagGroupOptionActive: {
    backgroundColor: "#e6f2ff",
    borderColor: "#0077cc",
  },
  tagGroupOptionText: { color: "#555", fontSize: 13, fontWeight: "bold" },
  tagGroupOptionTextActive: { color: "#0077cc" },
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
  highlightProjectMeta: {
    fontSize: 13,
    color: "#0077cc",
    fontWeight: "bold",
    marginBottom: 6,
  },
  highlightDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e8edf3",
  },
  highlightBackBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#f0f4f8",
    marginRight: 12,
  },
  highlightBackText: {
    color: "#0077cc",
    fontWeight: "bold",
  },
  highlightDetailTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  highlightDetailSub: {
    fontSize: 12,
    color: "#7f8c8d",
    marginTop: 3,
  },
  highlightProjectModalContent: {
    width: "90%",
    maxHeight: "86%",
    backgroundColor: "#fff",
    borderRadius: 12,
    paddingTop: 20,
    overflow: "hidden",
  },
  highlightProjectModalBody: {
    paddingHorizontal: 20,
    flexShrink: 1,
  },
  highlightProjectFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: "#eef2f6",
    backgroundColor: "#fff",
  },
  videoSelectList: {
    maxHeight: 320,
    minHeight: 120,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 14,
  },
  videoSelectListContent: {
    paddingBottom: 8,
  },
  videoSelectEmptyText: {
    textAlign: "center",
    color: "#888",
    paddingVertical: 24,
  },
  videoSelectItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f2f2f2",
  },
  videoSelectTypeHeader: { marginHorizontal: 8, marginTop: 8 },
  videoSelectMonthHeader: { marginHorizontal: 8, marginLeft: 16 },
  videoSelectProjectItem: { paddingLeft: 24 },
  videoSelectItemActive: {
    backgroundColor: "#eef7ff",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#b8c2cc",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: "#fff",
  },
  checkboxActive: {
    backgroundColor: "#0077cc",
    borderColor: "#0077cc",
  },
  checkboxText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  videoSelectTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2c3e50",
  },
  videoSelectSub: {
    fontSize: 12,
    color: "#7f8c8d",
    marginTop: 2,
  },
});

export default ProjectListScreen;
