import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../AuthContext";
import { createNotice } from "../services/firestoreService";

// ==========================================
// ★ カラーパレットの統一（テーマカラー）
// ==========================================
const COLORS = {
  primary: "#0077cc",
  secondary: "#f39c12",
  danger: "#e74c3c",
  success: "#2ecc71",
  background: "#f4f7f6",
  card: "#ffffff",
  textMain: "#333333",
  textSub: "#666666",
  border: "#e2e8f0",
};

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🙏"];
const REPORT_REASONS = ["暴言・誹謗中傷", "スパム・宣伝", "その他"];

const WorkspaceHomeScreen = ({
  navigation,
  isAdmin,
  currentUser,
  teamName,
  notices,
  setNotices,
  posts,
  setPosts,
  isOffline,
  clubMembers,
  medicalRecords,
  alertThresholds,
  userProfiles = {},
}) => {
  const { activeTeamId } = useAuth();
  const currentUserProfile = userProfiles[currentUser] || {};

  const userRole =
    global.TEST_ROLE ||
    (isAdmin ? "owner" : currentUserProfile.role || "member");

  const roleNameMap = {
    owner: `${currentUser}(監督)`,
    admin: `${currentUser}(管理者)`,
    staff: `${currentUser}(コーチ)`,
    captain: `${currentUser}(キャプテン)`,
    member: currentUser,
  };
  const displayUserName = roleNameMap[userRole] || currentUser;

  const isStaffOrAbove = ["owner", "staff", "admin"].includes(userRole);
  const canCreateChannel = ["owner", "staff", "admin"].includes(userRole);

  const unreadNoticeCount = notices.filter(
    (n) => !n.readBy.includes(currentUser),
  ).length;

  const getAlertLevel = (record, allRecords) => {
    let level = "normal";
    if (
      record.condition === "不良" ||
      record.isParticipating === "不可" ||
      record.fatigue >= alertThresholds.fatigueDanger ||
      (record.hasPain &&
        record.painDetails?.level >= alertThresholds.painDanger)
    )
      return "danger";
    if (
      record.fatigue >= alertThresholds.fatigueWarning ||
      record.isParticipating === "制限" ||
      record.hasPain
    )
      return "warning";
    return level;
  };

  const unreadMedicalDangerCount = medicalRecords
    ? medicalRecords.filter((r) => {
        if (r.isReviewed) return false;
        return getAlertLevel(r, medicalRecords) === "danger";
      }).length
    : 0;

  const [searchQuery, setSearchQuery] = useState("");
  const [channels, setChannels] = useState([
    {
      id: "ch_1",
      name: "全体連絡",
      isReadOnly: true,
      shareScope: "team",
      allowedMembers: ["all"],
    },
    {
      id: "ch_diary",
      name: "共有日記",
      isReadOnly: true,
      shareScope: "team",
      allowedMembers: ["all"],
    },
    {
      id: "ch_2",
      name: "トレーニング",
      isReadOnly: false,
      shareScope: "team",
      allowedMembers: ["all"],
    },
  ]);
  const [activeChannelId, setActiveChannelId] = useState("ch_1");

  // ローディング（処理中）状態の管理
  const [isLoading, setIsLoading] = useState(false);

  const visibleChannels = channels.filter((ch) => {
    if (isStaffOrAbove) return true;
    if (ch.shareScope === "coach") return false;
    if (ch.shareScope === "group")
      return ch.allowedMembers.includes(currentUser);
    return true;
  });

  const activeChannelObj =
    channels.find((c) => c.id === activeChannelId) || visibleChannels[0];

  const [isAddChannelModalVisible, setIsAddChannelModalVisible] =
    useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelIsReadOnly, setNewChannelIsReadOnly] = useState(false);
  const [newChannelScope, setNewChannelScope] = useState("team");
  const [selectedMembers, setSelectedMembers] = useState(["all"]);

  const [newPostText, setNewPostText] = useState("");
  const [expandedPostId, setExpandedPostId] = useState(null);
  const [replyText, setReplyText] = useState("");

  const [activeReactionPostId, setActiveReactionPostId] = useState(null);
  const [activeLongPressPostId, setActiveLongPressPostId] = useState(null);
  const [activeLongPressReply, setActiveLongPressReply] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [isReplyFocused, setIsReplyFocused] = useState(false);

  // 通知センター・ダッシュボード用のステート
  const [isNotifModalVisible, setIsNotifModalVisible] = useState(false);
  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [reportingTarget, setReportingTarget] = useState(null);
  const [isDashboardVisible, setIsDashboardVisible] = useState(false);

  const mainInputRef = useRef(null);
  const replyInputRef = useRef(null);

  // ==========================================
  // 通知センター用のデータ生成
  // ==========================================
  const notifications = useMemo(() => {
    const notifs = [];
    posts.forEach((post) => {
      if (post.status === "deleted") return;

      // メンション (投稿内)
      if (
        post.content.includes(`@${currentUser}`) &&
        post.user !== displayUserName
      ) {
        notifs.push({
          id: `notif_mention_${post.id}`,
          type: "mention",
          title: `🗣️ ${post.user}さんがあなたをメンションしました`,
          content: post.content,
          time: post.time,
          postId: post.id,
        });
      }

      // リプライ (返信)
      post.replies?.forEach((reply) => {
        if (reply.status === "deleted") return;

        if (post.user === displayUserName && reply.user !== displayUserName) {
          // 自分の投稿への返信
          notifs.push({
            id: `notif_reply_${reply.id}`,
            type: "reply",
            title: `💬 ${reply.user}さんがあなたの投稿に返信しました`,
            content: reply.content,
            time: reply.time,
            postId: post.id,
          });
        } else if (
          reply.content.includes(`@${currentUser}`) &&
          reply.user !== displayUserName
        ) {
          // 返信内でのメンション
          notifs.push({
            id: `notif_reply_mention_${reply.id}`,
            type: "mention",
            title: `🗣️ ${reply.user}さんが返信であなたをメンションしました`,
            content: reply.content,
            time: reply.time,
            postId: post.id,
          });
        }
      });
    });
    // 最新のものが上に来るように反転
    return notifs.reverse();
  }, [posts, currentUser, displayUserName]);

  // ==========================================
  // オフライン自動同期機能
  // ==========================================
  useEffect(() => {
    if (!isOffline) {
      const pendingPosts = posts.filter((p) => p.status === "pending");
      if (pendingPosts.length > 0) {
        setIsLoading(true);
        setTimeout(() => {
          setPosts(
            posts.map((p) =>
              p.status === "pending" ? { ...p, status: "sent" } : p,
            ),
          );
          setIsLoading(false);
          Alert.alert(
            "📶 通信復旧",
            `ネットワークに再接続しました。\n待機していた ${pendingPosts.length} 件の投稿を自動送信しました！`,
          );
        }, 1200);
      }
    }
  }, [isOffline]);

  const reportedItems = [];
  posts.forEach((post) => {
    if (post.status === "deleted") return;
    if (post.reported && post.reported.length > 0)
      reportedItems.push({ type: "post", item: post, postId: post.id });

    post.replies?.forEach((reply) => {
      if (reply.status === "deleted") return;
      if (reply.reported && reply.reported.length > 0)
        reportedItems.push({
          type: "reply",
          item: reply,
          postId: post.id,
          replyId: reply.id,
        });
    });
  });
  const reportCount = reportedItems.length;

  const handleAddChannel = () => {
    const trimmedName = newChannelName.trim();
    if (trimmedName === "") return;

    setIsLoading(true);
    setTimeout(() => {
      const newCh = {
        id: "ch_" + Date.now().toString(),
        name: trimmedName,
        isReadOnly: newChannelIsReadOnly,
        shareScope: newChannelScope,
        allowedMembers: newChannelScope === "group" ? selectedMembers : ["all"],
      };
      setChannels([...channels, newCh]);
      setActiveChannelId(newCh.id);
      setIsAddChannelModalVisible(false);
      setNewChannelName("");
      setNewChannelIsReadOnly(false);
      setNewChannelScope("team");
      setSelectedMembers(["all"]);
      setIsLoading(false);
    }, 500);
  };

  const handleDeleteChannel = (channel) => {
    if (channel.id === "ch_1" || channel.id === "ch_diary") {
      Alert.alert(
        "エラー",
        "「全体連絡」と「共有日記」はシステムに必要なため削除できません。",
      );
      return;
    }
    Alert.alert(
      "チャンネルの削除",
      `タブ「${channel.name}」を削除しますか？\n（※このタブに投稿された内容は表示されなくなります）`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "削除する",
          style: "destructive",
          onPress: () => {
            const newChannels = channels.filter((c) => c.id !== channel.id);
            setChannels(newChannels);
            if (activeChannelId === channel.id) setActiveChannelId("ch_1");
          },
        },
      ],
    );
  };

  const toggleMemberSelection = (m) => {
    if (m === "all") setSelectedMembers(["all"]);
    else {
      let updated = selectedMembers.filter((item) => item !== "all");
      if (updated.includes(m)) {
        updated = updated.filter((item) => item !== m);
        if (updated.length === 0) updated = ["all"];
      } else updated.push(m);
      setSelectedMembers(updated);
    }
  };

  const handleCreatePost = () => {
    if (newPostText.trim() === "") return;
    setIsLoading(true);

    setTimeout(
      () => {
        const newPost = {
          id: Date.now().toString(),
          channel: activeChannelObj.name,
          user: displayUserName,
          content: newPostText,
          time: "たった今",
          replyTo: replyingTo,
          reactions: {},
          attachments: [],
          replies: [],
          reported: [],
          readBy: [currentUser],
          isPinned: false,
          status: isOffline ? "pending" : "sent",
        };
        setPosts([newPost, ...posts]);
        setNewPostText("");
        setReplyingTo(null);
        Keyboard.dismiss();
        setIsLoading(false);
      },
      isOffline ? 300 : 600,
    );
  };

  const handleSendReply = (postId) => {
    if (replyText.trim() === "") return;
    setIsLoading(true);

    setTimeout(() => {
      const newPosts = posts.map((post) => {
        if (post.id === postId)
          return {
            ...post,
            replies: [
              ...(post.replies || []),
              {
                id: Date.now().toString(),
                user: displayUserName,
                content: replyText,
                time: "たった今",
                reported: [],
                status: isOffline ? "pending" : "sent",
              },
            ],
          };
        return post;
      });
      setPosts(newPosts);
      setReplyText("");
      Keyboard.dismiss();
      setIsReplyFocused(false);
      setIsLoading(false);
    }, 400);
  };

  const openReportModal = (type, postId, replyId = null) => {
    setReportingTarget({ type, postId, replyId });
    setIsReportModalVisible(true);
    setActiveLongPressPostId(null);
    setActiveLongPressReply(null);
  };

  const submitReport = (reason) => {
    if (isOffline) {
      Alert.alert("エラー", "オフライン時は使用できません。");
      setIsReportModalVisible(false);
      return;
    }
    const newPosts = posts.map((post) => {
      if (reportingTarget.type === "post" && post.id === reportingTarget.postId)
        return {
          ...post,
          reported: [...(post.reported || []), { by: displayUserName, reason }],
        };
      if (
        reportingTarget.type === "reply" &&
        post.id === reportingTarget.postId
      )
        return {
          ...post,
          replies: post.replies.map((r) =>
            r.id === reportingTarget.replyId
              ? {
                  ...r,
                  reported: [
                    ...(r.reported || []),
                    { by: displayUserName, reason },
                  ],
                }
              : r,
          ),
        };
      return post;
    });
    setPosts(newPosts);
    setIsReportModalVisible(false);
    setReportingTarget(null);
    Alert.alert("報告完了", "管理者に報告しました。");
  };

  const handleResolveReport = (type, postId, replyId, action) => {
    if (action === "delete") {
      if (type === "post") {
        setPosts(
          posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  status: "deleted",
                  deletedBy: displayUserName,
                  deletedAt: new Date().toISOString(),
                }
              : p,
          ),
        );
      } else {
        setPosts(
          posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  replies: p.replies.map((r) =>
                    r.id === replyId
                      ? {
                          ...r,
                          status: "deleted",
                          deletedBy: displayUserName,
                          deletedAt: new Date().toISOString(),
                        }
                      : r,
                  ),
                }
              : p,
          ),
        );
      }
    } else if (action === "ignore") {
      if (type === "post")
        setPosts(
          posts.map((p) => (p.id === postId ? { ...p, reported: [] } : p)),
        );
      else
        setPosts(
          posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  replies: p.replies.map((r) =>
                    r.id === replyId ? { ...r, reported: [] } : r,
                  ),
                }
              : p,
          ),
        );
    }
  };

  const handleReaction = (postId, emoji) => {
    if (isOffline) return;
    const newPosts = posts.map((post) => {
      if (post.id === postId) {
        const currentCount = post.reactions[emoji] || 0;
        return {
          ...post,
          reactions: { ...post.reactions, [emoji]: currentCount + 1 },
        };
      }
      return post;
    });
    setPosts(newPosts);
    setActiveReactionPostId(null);
  };

  const togglePin = (postId) => {
    setPosts(
      posts.map((post) =>
        post.id === postId ? { ...post, isPinned: !post.isPinned } : post,
      ),
    );
    setActiveLongPressPostId(null);
  };

  const handleDeletePost = (postId) => {
    Alert.alert("削除の確認", "本当に削除しますか？", [
      { text: "キャンセル" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => {
          setPosts(
            posts.map((p) =>
              p.id === postId
                ? {
                    ...p,
                    status: "deleted",
                    deletedBy: displayUserName,
                    deletedAt: new Date().toISOString(),
                  }
                : p,
            ),
          );
          setActiveLongPressPostId(null);
        },
      },
    ]);
  };

  const handleShareToNotice = (post) => {
    Alert.alert(
      "掲示板へ共有",
      `「${post.channel}」の投稿を掲示板に共有しますか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "共有する",
          onPress: async () => {
            setIsLoading(true);
            const noticeId = "notice_" + Date.now().toString();
            const newNotice = {
              id: noticeId,
              title: `【${post.channel}より】${post.user} の投稿`,
              content: post.content,
              date: new Date().toLocaleDateString("ja-JP"),
              author: displayUserName,
              readBy: [currentUser],
              isImportant: false,
              isSharedPost: true,
              createdAt: Date.now(),
              status: "active",
            };

            if (typeof setNotices === "function")
              setNotices([newNotice, ...notices]);
            else if (notices && Array.isArray(notices))
              notices.unshift(newNotice);

            try {
              if (activeTeamId) await createNotice(activeTeamId, newNotice);
            } catch (error) {
              console.log("Firestore共有エラー:", error);
            }

            setIsLoading(false);
            Alert.alert(
              "共有完了",
              "掲示板に共有しました！\n「掲示板」タブをご確認ください。",
            );
            setActiveLongPressPostId(null);
          },
        },
      ],
    );
  };

  const renderContentWithMentions = (text) => {
    const parts = text.split(/(@\S+)/g);
    return parts.map((part, index) =>
      part.startsWith("@") ? (
        <Text key={index} style={styles.mentionText}>
          {part}
        </Text>
      ) : (
        <Text key={index}>{part}</Text>
      ),
    );
  };

  const toggleThread = (postId) => {
    setExpandedPostId(expandedPostId === postId ? null : postId);
    if (expandedPostId !== postId) {
      setReplyText("");
      setIsReplyFocused(false);
      setActiveLongPressReply(null);
    }
  };

  const insertText = (textToInsert) =>
    setNewPostText((prev) => prev + textToInsert);
  const isReportedByMe = (item) =>
    item.reported?.some((r) => r.by === displayUserName);

  let filteredPosts = posts.filter(
    (post) =>
      post.channel === activeChannelObj?.name && post.status !== "deleted",
  );
  if (searchQuery.trim() !== "") {
    filteredPosts = filteredPosts.filter(
      (post) =>
        post.content.includes(searchQuery) || post.user.includes(searchQuery),
    );
  }

  const pinnedPosts = filteredPosts.filter((p) => p.isPinned);
  const regularPosts = filteredPosts
    .filter((p) => !p.isPinned)
    .sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return 0;
    });

  const renderPostCard = (post, isPinnedArea = false) => {
    if (isReportedByMe(post) && !isStaffOrAbove)
      return (
        <View key={post.id} style={styles.reportedMaskCard}>
          <Text style={styles.reportedMaskText}>
            ※管理者に報告済みのため非表示
          </Text>
        </View>
      );
    const isPending = post.status === "pending";
    const validReplies = post.replies
      ? post.replies.filter((r) => r.status !== "deleted")
      : [];

    const isExpanded = expandedPostId === post.id;
    const isUnread =
      post.user !== displayUserName &&
      !(post.readBy || []).includes(currentUser);

    return (
      <TouchableOpacity
        key={post.id}
        style={[
          styles.postCard,
          isPinnedArea && styles.pinnedCard,
          post.reported?.length > 0 &&
            isStaffOrAbove &&
            styles.adminReportedCard,
          isPending && styles.pendingCard,
          isPinnedArea && { marginBottom: 10 },
        ]}
        activeOpacity={0.8}
        onPress={() => {
          if (!isPending) {
            toggleThread(post.id);
            if (isUnread) {
              setPosts(
                posts.map((p) =>
                  p.id === post.id
                    ? { ...p, readBy: [...(p.readBy || []), currentUser] }
                    : p,
                ),
              );
            }
          }
        }}
        onLongPress={() => !isPending && setActiveLongPressPostId(post.id)}
        delayLongPress={300}
      >
        {isPending && (
          <View style={styles.pendingHeader}>
            <ActivityIndicator
              size="small"
              color={COLORS.secondary}
              style={{ marginRight: 5 }}
            />
            <Text style={styles.pendingHeaderText}>
              電波復旧待ち（自動送信されます）
            </Text>
          </View>
        )}
        {post.reported?.length > 0 && isStaffOrAbove && !isPending && (
          <View style={styles.adminReportedHeader}>
            <Text style={styles.adminReportedHeaderText}>
              🚨 {post.reported.length}件の報告があります
            </Text>
          </View>
        )}

        <View style={styles.postHeader}>
          <View
            style={[styles.userIcon, isPending && { backgroundColor: "#aaa" }]}
          >
            <Text style={styles.userIconText}>{post.user.charAt(0)}</Text>
          </View>
          <Text
            style={[
              styles.postUser,
              isUnread && { fontWeight: "900", color: "#000" },
            ]}
          >
            {post.user}
          </Text>
          {isUnread && <View style={styles.unreadDot} />}
          <Text style={styles.postTime}>
            {isPending ? "送信待機中..." : post.time}
          </Text>
        </View>

        {post.replyTo && isExpanded && (
          <View style={styles.quoteContainer}>
            <Text style={styles.quoteUser}>{post.replyTo.user}</Text>
            <Text style={styles.quoteContent} numberOfLines={2}>
              {post.replyTo.content}
            </Text>
          </View>
        )}

        <Text
          style={styles.postContent}
          numberOfLines={isExpanded || isPinnedArea ? undefined : 4}
        >
          {renderContentWithMentions(post.content)}
        </Text>

        {!isPending && !isExpanded && !isPinnedArea && (
          <View style={styles.compactFooter}>
            <Text style={styles.compactFooterText}>
              タップして詳細を表示{" "}
              {validReplies.length > 0 ? `(💬 ${validReplies.length}件)` : ""}
            </Text>
            {Object.keys(post.reactions || {}).length > 0 && (
              <View style={styles.compactReactions}>
                {Object.entries(post.reactions || {}).map(([emoji, count]) => (
                  <Text key={emoji} style={styles.compactReactionText}>
                    {emoji}
                    {count}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {!isPending && isExpanded && !isPinnedArea && (
          <View style={styles.actionBar}>
            <View style={styles.actionLeft}>
              <Text style={styles.replyCountText}>
                💬{" "}
                {validReplies.length > 0
                  ? `${validReplies.length}件の返信`
                  : "返信なし"}
              </Text>
            </View>
            <View style={styles.actionRight}>
              <Text style={styles.readCountText}>
                既読 {post.readBy?.length || 0}
              </Text>
              <View style={styles.reactionsContainer}>
                {Object.entries(post.reactions || {}).map(([emoji, count]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={styles.reactionBadge}
                    onPress={() => handleReaction(post.id, emoji)}
                  >
                    <Text style={styles.reactionText}>
                      {emoji} {count}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={styles.addReactionBadge}
                  onPress={() =>
                    setActiveReactionPostId(
                      activeReactionPostId === post.id ? null : post.id,
                    )
                  }
                >
                  <Text style={styles.addReactionText}>+</Text>
                </TouchableOpacity>
                {activeReactionPostId === post.id && (
                  <View style={styles.reactionPicker}>
                    {REACTION_EMOJIS.map((emoji) => (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => handleReaction(post.id, emoji)}
                      >
                        <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </View>
        )}

        {activeLongPressPostId === post.id && !isPending && (
          <View style={styles.longPressMenu}>
            {isStaffOrAbove && (
              <>
                <TouchableOpacity
                  style={styles.longPressMenuItem}
                  onPress={() => togglePin(post.id)}
                >
                  <Text style={styles.longPressMenuText}>
                    {post.isPinned ? "📌 固定を解除" : "📌 固定する"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.longPressMenuItem}
                  onPress={() => handleShareToNotice(post)}
                >
                  <Text style={styles.longPressMenuText}>📋 掲示板に共有</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.longPressMenuItem}
                  onPress={() => handleDeletePost(post.id)}
                >
                  <Text
                    style={[styles.longPressMenuText, { color: COLORS.danger }]}
                  >
                    🗑 削除する
                  </Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={styles.longPressMenuItem}
              onPress={() => {
                insertText(`@${post.user} `);
                setActiveLongPressPostId(null);
              }}
            >
              <Text style={styles.longPressMenuText}>@ メンションする</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.longPressMenuItem}
              onPress={() => {
                setReplyingTo({ user: post.user, content: post.content });
                setActiveLongPressPostId(null);
              }}
            >
              <Text style={styles.longPressMenuText}>↩️ リプライする</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.longPressMenuItem}
              onPress={() => openReportModal("post", post.id)}
            >
              <Text
                style={[styles.longPressMenuText, { color: COLORS.danger }]}
              >
                🚨 報告する
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.longPressMenuItem}
              onPress={() => setActiveLongPressPostId(null)}
            >
              <Text
                style={[styles.longPressMenuText, { color: COLORS.textSub }]}
              >
                ✕ キャンセル
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {expandedPostId === post.id && !isPending && !isPinnedArea && (
          <View style={styles.threadContainer}>
            <View style={styles.replyInputContainer}>
              <TextInput
                ref={replyInputRef}
                style={styles.replyInput}
                placeholder="返信を追加..."
                value={replyText}
                onChangeText={setReplyText}
                multiline
                onFocus={() => setIsReplyFocused(true)}
                onBlur={() => setIsReplyFocused(false)}
              />
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  isOffline && { backgroundColor: COLORS.secondary },
                ]}
                onPress={() => handleSendReply(post.id)}
              >
                <Text style={styles.sendButtonText}>送信</Text>
              </TouchableOpacity>
            </View>

            {validReplies.map((reply) => {
              const isReplyPending = reply.status === "pending";
              if (isReportedByMe(reply) && !isStaffOrAbove)
                return (
                  <View key={reply.id} style={styles.reportedMaskCard}>
                    <Text style={styles.reportedMaskText}>※報告済み</Text>
                  </View>
                );
              return (
                <TouchableOpacity
                  key={reply.id}
                  style={[
                    styles.replyCard,
                    { position: "relative", zIndex: 1 },
                    reply.reported?.length > 0 &&
                      isStaffOrAbove &&
                      styles.adminReportedCard,
                    isReplyPending && styles.pendingCard,
                  ]}
                  activeOpacity={0.8}
                  onLongPress={() =>
                    !isReplyPending &&
                    setActiveLongPressReply({
                      postId: post.id,
                      replyId: reply.id,
                    })
                  }
                  delayLongPress={400}
                >
                  {isReplyPending && (
                    <Text
                      style={[styles.pendingHeaderText, { marginBottom: 5 }]}
                    >
                      🕒 待機中
                    </Text>
                  )}
                  <View style={styles.postHeader}>
                    <Text style={styles.replyUser}>{reply.user}</Text>
                    <Text style={styles.postTime}>
                      {isReplyPending ? "待機中..." : reply.time}
                    </Text>
                  </View>
                  <Text style={styles.replyContent}>
                    {renderContentWithMentions(reply.content)}
                  </Text>
                  {activeLongPressReply?.replyId === reply.id &&
                    !isReplyPending && (
                      <View
                        style={[styles.longPressMenu, { top: 10, right: 10 }]}
                      >
                        {isStaffOrAbove && (
                          <TouchableOpacity
                            style={styles.longPressMenuItem}
                            onPress={() => {
                              setPosts(
                                posts.map((p) =>
                                  p.id === post.id
                                    ? {
                                        ...p,
                                        replies: p.replies.map((r) =>
                                          r.id === reply.id
                                            ? {
                                                ...r,
                                                status: "deleted",
                                                deletedBy: displayUserName,
                                                deletedAt:
                                                  new Date().toISOString(),
                                              }
                                            : r,
                                        ),
                                      }
                                    : p,
                                ),
                              );
                              setActiveLongPressReply(null);
                            }}
                          >
                            <Text
                              style={[
                                styles.longPressMenuText,
                                { color: COLORS.danger },
                              ]}
                            >
                              🗑 削除
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.longPressMenuItem}
                          onPress={() =>
                            openReportModal("reply", post.id, reply.id)
                          }
                        >
                          <Text
                            style={[
                              styles.longPressMenuText,
                              { color: COLORS.danger },
                            ]}
                          >
                            🚨 報告する
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.longPressMenuItem}
                          onPress={() => setActiveLongPressReply(null)}
                        >
                          <Text
                            style={[
                              styles.longPressMenuText,
                              { color: COLORS.textSub },
                            ]}
                          >
                            ✕ キャンセル
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={[
            styles.header,
            isOffline && styles.headerOffline,
            { paddingVertical: 10, height: "auto", minHeight: 60 },
          ]}
        >
          <View style={{ flex: 1, justifyContent: "center", marginRight: 10 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {isOffline
                ? "⚠️ オフラインモード"
                : `🏢 ${teamName || "チーム未設定"}`}
            </Text>
            <Text
              style={{
                color: "#e6f2ff",
                fontSize: 11,
                marginTop: 2,
                fontWeight: "bold",
              }}
              numberOfLines={1}
            >
              こんにちは、{displayUserName} さん
            </Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => setIsNotifModalVisible(true)}
            >
              <Text style={styles.headerIcon}>🔔</Text>
              {notifications.length > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {notifications.length > 99 ? "99+" : notifications.length}
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {isStaffOrAbove && (
              <TouchableOpacity
                style={styles.headerIconBtn}
                onPress={() => setIsDashboardVisible(true)}
              >
                <Text style={styles.headerIcon}>🚨</Text>
                {reportCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{reportCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => navigation.navigate("Settings")}
            >
              <Text style={styles.headerIcon}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* サブメニューエリア */}
        <View style={styles.menuRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.menuScroll}
          >
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate("NoticeBoard")}
            >
              <View style={styles.menuIconContainer}>
                <Text style={styles.menuIconText}>📋</Text>
                {!isStaffOrAbove && unreadNoticeCount > 0 && (
                  <View style={styles.menuBadge}>
                    <Text style={styles.menuBadgeText}>
                      {unreadNoticeCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.menuLabel}>掲示板</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate("Diary")}
            >
              <View style={styles.menuIconContainer}>
                <Text style={styles.menuIconText}>📝</Text>
              </View>
              <Text style={styles.menuLabel}>振り返り</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate("Calendar")}
            >
              <View style={styles.menuIconContainer}>
                <Text style={styles.menuIconText}>📅</Text>
                {isStaffOrAbove && unreadMedicalDangerCount > 0 && (
                  <View style={styles.menuBadge}>
                    <Text style={styles.menuBadgeText}>
                      {unreadMedicalDangerCount}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.menuLabel}>カレンダー</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate("ProjectList")}
            >
              <View style={styles.menuIconContainer}>
                <Text style={styles.menuIconText}>📁</Text>
              </View>
              <Text style={styles.menuLabel}>プロジェクト</Text>
            </TouchableOpacity>

            {/* ★ 選手名簿（Roster）ボタンを追加（管理者・コーチのみ） */}
            {isStaffOrAbove && (
              <TouchableOpacity
                style={styles.menuItem}
                onPress={() => navigation.navigate("Roster")}
              >
                <View style={styles.menuIconContainer}>
                  <Text style={styles.menuIconText}>📖</Text>
                </View>
                <Text style={styles.menuLabel}>選手名簿</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {/* オフラインバナー */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <ActivityIndicator
              size="small"
              color="#fff"
              style={{ marginRight: 8 }}
            />
            <Text style={styles.offlineBannerText}>
              現在オフラインです。投稿は通信復旧時に自動で送信されます。
            </Text>
          </View>
        )}

        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="投稿やメッセージを検索..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            editable={!isOffline}
          />
        </View>

        <View style={styles.channelSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.channelScroll}
          >
            {visibleChannels.map((channel) => (
              <TouchableOpacity
                key={channel.id}
                style={[
                  styles.channelTab,
                  activeChannelId === channel.id && styles.activeTab,
                ]}
                onPress={() => {
                  setActiveChannelId(channel.id);
                  setReplyingTo(null);
                }}
                onLongPress={() => {
                  if (canCreateChannel) handleDeleteChannel(channel);
                }}
              >
                <Text
                  style={[
                    styles.channelTabText,
                    activeChannelId === channel.id && styles.activeTabText,
                  ]}
                >
                  {channel.shareScope === "team" ? "# " : "🔐 "}
                  {channel.name} {channel.isReadOnly && "🔒"}
                </Text>
              </TouchableOpacity>
            ))}
            {canCreateChannel && !isOffline && (
              <TouchableOpacity
                style={styles.addChannelButton}
                onPress={() => setIsAddChannelModalVisible(true)}
              >
                <Text style={styles.addChannelButtonText}>＋ 追加</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>

        {pinnedPosts.length > 0 && (
          <View style={styles.pinnedContainer}>
            <View style={styles.pinnedHeaderTitleRow}>
              <Text style={styles.pinnedHeaderTitleText}>
                📌 ピン留めされた投稿 ({pinnedPosts.length}件)
              </Text>
            </View>
            <ScrollView
              style={styles.pinnedScrollArea}
              nestedScrollEnabled={true}
            >
              {pinnedPosts.map((post) => renderPostCard(post, true))}
            </ScrollView>
          </View>
        )}

        <ScrollView
          style={styles.feedSection}
          contentContainerStyle={{ paddingBottom: 100 }}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => {
            setActiveReactionPostId(null);
            setActiveLongPressPostId(null);
            setActiveLongPressReply(null);
          }}
        >
          {regularPosts.length === 0 ? (
            <Text style={styles.emptyText}>まだ投稿がありません。</Text>
          ) : (
            regularPosts.map((post) => renderPostCard(post, false))
          )}
        </ScrollView>

        {!isReplyFocused && activeChannelObj && (
          <View style={styles.createPostContainer}>
            {!isStaffOrAbove && activeChannelObj.isReadOnly ? (
              <View style={styles.readOnlyContainer}>
                <Text style={styles.readOnlyText}>
                  ※「{activeChannelObj.name}」は管理者のみ投稿可能です。
                </Text>
              </View>
            ) : (
              <>
                {replyingTo && (
                  <View style={styles.replyingToPreview}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.replyingToUser}>
                        {replyingTo.user} へのリプライ
                      </Text>
                      <Text style={styles.replyingToContent} numberOfLines={1}>
                        {replyingTo.content}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setReplyingTo(null)}
                      style={styles.cancelReplyBtn}
                    >
                      <Text style={styles.cancelReplyBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
                <View style={styles.toolbar}>
                  <TouchableOpacity
                    style={styles.toolbarBtn}
                    onPress={() => insertText("@")}
                  >
                    <Text style={styles.toolbarBtnText}>@ メンション</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.inputRow}>
                  <TextInput
                    ref={mainInputRef}
                    style={styles.createPostInput}
                    placeholder={`# ${activeChannelObj.name} に${isOffline ? "下書きを作成..." : "新しく投稿する..."}`}
                    value={newPostText}
                    onChangeText={setNewPostText}
                    multiline
                  />
                  <TouchableOpacity
                    style={[
                      styles.createPostButton,
                      isOffline && { backgroundColor: COLORS.secondary },
                      newPostText.trim() === "" &&
                        styles.createPostButtonDisabled,
                    ]}
                    onPress={handleCreatePost}
                    disabled={newPostText.trim() === ""}
                  >
                    <Text style={styles.createPostButtonText}>
                      {isOffline ? "待機" : "投稿"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* 全体ローディングオーバーレイ */}
      {isLoading && (
        <View style={styles.globalLoadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.globalLoadingText}>通信中...</Text>
        </View>
      )}

      {/* 通知センターモーダル */}
      <Modal
        visible={isNotifModalVisible}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.dashboardContainer}>
          <View style={styles.dashboardHeader}>
            <Text style={[styles.dashboardTitle, { color: COLORS.textMain }]}>
              🔔 通知センター
            </Text>
            <TouchableOpacity onPress={() => setIsNotifModalVisible(false)}>
              <Text style={{ fontSize: 24, color: COLORS.textMain }}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.dashboardContent}>
            {notifications.length === 0 ? (
              <Text style={styles.emptyText}>
                現在、新しい通知はありません。
              </Text>
            ) : (
              notifications.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  style={styles.notifCard}
                  onPress={() => {
                    setIsNotifModalVisible(false);
                    const targetPost = posts.find((p) => p.id === n.postId);
                    if (targetPost) {
                      const targetChannel = channels.find(
                        (c) => c.name === targetPost.channel,
                      );
                      if (targetChannel) setActiveChannelId(targetChannel.id);
                    }
                    setExpandedPostId(n.postId);
                  }}
                >
                  <View style={styles.notifHeader}>
                    <Text style={styles.notifTitle}>{n.title}</Text>
                    <Text style={styles.notifTime}>{n.time}</Text>
                  </View>
                  <Text style={styles.notifContent} numberOfLines={2}>
                    {n.content}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* 新規チャンネル追加モーダル */}
      <Modal
        visible={isAddChannelModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>新しいチャンネルを作成</Text>
            <Text style={styles.inputLabel}>チャンネル名</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="例: 1年生専用"
              value={newChannelName}
              onChangeText={setNewChannelName}
            />
            <View style={styles.switchContainer}>
              <View>
                <Text style={styles.switchLabel}>
                  部員は閲覧のみ (投稿不可)
                </Text>
                <Text style={styles.switchSubLabel}>
                  オンにすると、管理者の発信専用になります。
                </Text>
              </View>
              <Switch
                value={newChannelIsReadOnly}
                onValueChange={setNewChannelIsReadOnly}
                trackColor={{ false: "#d9d9d9", true: "#81b0ff" }}
                thumbColor={newChannelIsReadOnly ? COLORS.primary : "#f4f3f4"}
              />
            </View>

            <Text style={styles.inputLabel}>共有範囲（アクセス権）</Text>
            <View style={styles.typeContainer}>
              <TouchableOpacity
                style={[
                  styles.typeBtn,
                  newChannelScope === "team" && styles.typeBtnActive,
                ]}
                onPress={() => setNewChannelScope("team")}
              >
                <Text
                  style={[
                    styles.typeBtnText,
                    newChannelScope === "team" && styles.typeBtnTextActive,
                  ]}
                >
                  全体
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeBtn,
                  newChannelScope === "group" && styles.typeBtnActive,
                ]}
                onPress={() => setNewChannelScope("group")}
              >
                <Text
                  style={[
                    styles.typeBtnText,
                    newChannelScope === "group" && styles.typeBtnTextActive,
                  ]}
                >
                  限定
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeBtn,
                  newChannelScope === "coach" && styles.typeBtnActive,
                ]}
                onPress={() => setNewChannelScope("coach")}
              >
                <Text
                  style={[
                    styles.typeBtnText,
                    newChannelScope === "coach" && styles.typeBtnTextActive,
                  ]}
                >
                  指導者のみ
                </Text>
              </TouchableOpacity>
            </View>

            {newChannelScope === "group" && (
              <>
                <Text style={[styles.inputLabel, { marginTop: 10 }]}>
                  参加メンバーを選択
                </Text>
                <ScrollView
                  style={styles.memberSelector}
                  nestedScrollEnabled={true}
                >
                  {clubMembers.map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[
                        styles.memberOption,
                        selectedMembers.includes(m) &&
                          styles.memberOptionSelected,
                      ]}
                      onPress={() => toggleMemberSelection(m)}
                    >
                      <Text
                        style={
                          selectedMembers.includes(m)
                            ? styles.memberOptionTextSelected
                            : {}
                        }
                      >
                        {m}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setIsAddChannelModalVisible(false);
                  setNewChannelName("");
                  setNewChannelIsReadOnly(false);
                  setNewChannelScope("team");
                  setSelectedMembers(["all"]);
                }}
              >
                <Text style={styles.modalCancelText}>キャンセル</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleAddChannel}
              >
                <Text style={styles.modalSubmitText}>作成する</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isReportModalVisible}
        transparent={true}
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>管理者に報告する</Text>
            {REPORT_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={styles.reasonBtn}
                onPress={() => submitReport(reason)}
              >
                <Text style={styles.reasonBtnText}>{reason}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                styles.modalCancelBtn,
                { marginTop: 10, alignSelf: "flex-end" },
              ]}
              onPress={() => setIsReportModalVisible(false)}
            >
              <Text style={styles.modalCancelText}>キャンセル</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 管理者用：通報管理ダッシュボード */}
      <Modal
        visible={isDashboardVisible}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.dashboardContainer}>
          <View style={styles.dashboardHeader}>
            <Text style={styles.dashboardTitle}>🚨 通報管理</Text>
            <TouchableOpacity onPress={() => setIsDashboardVisible(false)}>
              <Text style={{ fontSize: 24 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.dashboardContent}>
            {reportedItems.length === 0 ? (
              <Text style={styles.emptyText}>
                現在、通報された投稿はありません。
              </Text>
            ) : (
              reportedItems.map((ri, index) => (
                <View key={index} style={styles.dashboardCard}>
                  <Text style={{ fontWeight: "bold", marginBottom: 5 }}>
                    [{ri.type === "post" ? "投稿" : "返信"}] {ri.item.user}
                    の書き込み
                  </Text>
                  <Text
                    style={{
                      color: COLORS.textSub,
                      backgroundColor: "#f0f0f0",
                      padding: 10,
                      borderRadius: 5,
                      marginBottom: 10,
                    }}
                  >
                    {ri.item.content}
                  </Text>
                  <View
                    style={{ flexDirection: "row", justifyContent: "flex-end" }}
                  >
                    <TouchableOpacity
                      style={[
                        styles.dashBtn,
                        { backgroundColor: COLORS.success, marginRight: 10 },
                      ]}
                      onPress={() =>
                        handleResolveReport(
                          ri.type,
                          ri.postId,
                          ri.replyId,
                          "ignore",
                        )
                      }
                    >
                      <Text style={{ color: "#fff" }}>✅ 問題なし</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.dashBtn,
                        { backgroundColor: COLORS.danger },
                      ]}
                      onPress={() =>
                        handleResolveReport(
                          ri.type,
                          ri.postId,
                          ri.replyId,
                          "delete",
                        )
                      }
                    >
                      <Text style={{ color: "#fff" }}>🗑 削除</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  globalLoadingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.7)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  globalLoadingText: {
    marginTop: 10,
    color: COLORS.primary,
    fontWeight: "bold",
    fontSize: 16,
  },

  header: {
    height: 60,
    backgroundColor: COLORS.primary,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  headerOffline: { backgroundColor: "#7f8c8d" },
  headerTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    flex: 1,
    textAlign: "left",
  },
  headerRight: { flexDirection: "row", alignItems: "center" },
  headerIconBtn: { position: "relative", marginRight: 15, padding: 5 },
  headerIcon: { fontSize: 20 },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: COLORS.danger,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },

  menuRow: {
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 15,
  },
  menuScroll: { paddingHorizontal: 15 },
  menuItem: { alignItems: "center", marginRight: 25, width: 70 },
  menuIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#f0f4f8",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
    position: "relative",
  },
  menuIconText: { fontSize: 24 },
  menuLabel: {
    fontSize: 11,
    color: COLORS.textSub,
    fontWeight: "bold",
    textAlign: "center",
  },
  menuBadge: {
    position: "absolute",
    top: -2,
    right: -5,
    backgroundColor: COLORS.danger,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    zIndex: 10,
  },
  menuBadgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },

  offlineBanner: {
    backgroundColor: COLORS.secondary,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },

  searchContainer: {
    padding: 15,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchInput: {
    height: 40,
    backgroundColor: "#f0f0f0",
    borderRadius: 20,
    paddingHorizontal: 15,
    fontSize: 14,
  },
  channelSection: {
    backgroundColor: COLORS.card,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  channelScroll: { paddingHorizontal: 15 },
  channelTab: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  channelTabText: { color: COLORS.textSub, fontWeight: "bold", fontSize: 14 },
  activeTab: { backgroundColor: "#e6f2ff", borderColor: COLORS.primary },
  activeTabText: { color: COLORS.primary },
  addChannelButton: {
    backgroundColor: "#e2f0d9",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 30,
    borderWidth: 1,
    borderColor: COLORS.success,
    borderStyle: "dashed",
  },
  addChannelButtonText: {
    color: COLORS.success,
    fontWeight: "bold",
    fontSize: 14,
  },

  pinnedContainer: {
    backgroundColor: "#fffdf5",
    borderBottomWidth: 2,
    borderBottomColor: "#f3c623",
    padding: 10,
    paddingBottom: 0,
  },
  pinnedHeaderTitleRow: { marginBottom: 8, paddingHorizontal: 5 },
  pinnedHeaderTitleText: { color: "#d4a000", fontSize: 13, fontWeight: "bold" },
  pinnedScrollArea: { maxHeight: 180 },
  feedSection: { flex: 1, padding: 15 },
  emptyText: {
    textAlign: "center",
    color: "#888",
    marginTop: 20,
    fontSize: 15,
  },
  postCard: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    elevation: 2,
    zIndex: 1,
    position: "relative",
  },
  pendingCard: {
    opacity: 0.8,
    backgroundColor: "#fdfdfd",
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: COLORS.secondary,
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  pendingHeaderText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: "bold",
  },
  pinnedCard: {
    borderWidth: 1,
    borderColor: "#f3c623",
    backgroundColor: COLORS.card,
    elevation: 1,
  },
  adminReportedCard: {
    borderWidth: 1,
    borderColor: COLORS.danger,
    backgroundColor: "#fff5f5",
  },
  adminReportedHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#ffcccc",
  },
  adminReportedHeaderText: {
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: "bold",
  },
  reportedMaskCard: {
    backgroundColor: "#e0e0e0",
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  reportedMaskText: { color: "#888", fontSize: 12, fontStyle: "italic" },

  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
    marginRight: 8,
    marginLeft: 5,
  },

  postHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  userIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  userIconText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  postUser: {
    fontSize: 15,
    fontWeight: "bold",
    color: COLORS.textMain,
    flex: 1,
  },
  postTime: { fontSize: 12, color: "#888" },
  quoteContainer: {
    backgroundColor: "#f9f9f9",
    padding: 8,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#aaa",
    marginBottom: 8,
  },
  quoteUser: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 2,
  },
  quoteContent: { fontSize: 13, color: "#777" },
  postContent: {
    fontSize: 15,
    color: COLORS.textMain,
    lineHeight: 22,
    marginBottom: 5,
  },
  mentionText: { color: COLORS.primary, fontWeight: "bold" },

  compactFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#f5f5f5",
  },
  compactFooterText: {
    fontSize: 12,
    color: "#888",
    fontWeight: "bold",
  },
  compactReactions: {
    flexDirection: "row",
  },
  compactReactionText: {
    fontSize: 11,
    color: "#555",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 5,
  },

  actionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 10,
    marginTop: 10,
    zIndex: 2,
  },
  actionLeft: { flex: 1 },
  replyCountText: { color: "#555", fontSize: 13, fontWeight: "bold" },
  actionRight: { flexDirection: "row", alignItems: "center" },
  readCountText: { fontSize: 12, color: "#888", marginRight: 10 },
  replyButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: "#f0f0f0",
    borderRadius: 15,
  },
  replyButtonText: { color: "#555", fontSize: 13, fontWeight: "bold" },
  reactionsContainer: {
    flexDirection: "row",
    position: "relative",
    alignItems: "center",
  },
  reactionBadge: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginLeft: 5,
  },
  reactionText: { fontSize: 12, color: "#555", fontWeight: "bold" },
  addReactionBadge: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginLeft: 5,
    justifyContent: "center",
  },
  addReactionText: { fontSize: 14, color: "#888", fontWeight: "bold" },
  reactionPicker: {
    position: "absolute",
    bottom: 35,
    right: 0,
    flexDirection: "row",
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 8,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    zIndex: 10,
  },
  reactionPickerEmoji: { fontSize: 22, marginHorizontal: 6 },
  longPressMenu: {
    position: "absolute",
    top: 40,
    right: 15,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 5,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 20,
  },
  longPressMenuItem: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  longPressMenuText: {
    fontSize: 14,
    fontWeight: "bold",
    color: COLORS.primary,
  },
  threadContainer: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  replyCard: {
    backgroundColor: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  replyUser: {
    fontSize: 14,
    fontWeight: "bold",
    color: COLORS.textMain,
    flex: 1,
  },
  replyContent: { fontSize: 14, color: "#444", marginTop: 4 },
  replyInputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginBottom: 15,
  },
  replyInput: {
    flex: 1,
    backgroundColor: "#f0f0f0",
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 100,
    fontSize: 14,
  },
  sendButton: {
    marginLeft: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  sendButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  createPostContainer: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
  },
  readOnlyContainer: {
    paddingVertical: 20,
    alignItems: "center",
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
  },
  readOnlyText: { color: "#888", fontSize: 14, fontWeight: "bold" },
  replyingToPreview: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    marginBottom: 10,
    alignItems: "center",
  },
  replyingToUser: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.primary,
    marginBottom: 2,
  },
  replyingToContent: { fontSize: 13, color: "#555" },
  cancelReplyBtn: { padding: 5, marginLeft: 10 },
  cancelReplyBtnText: { fontSize: 16, color: "#888", fontWeight: "bold" },
  toolbar: { flexDirection: "row", marginBottom: 10 },
  toolbarBtn: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
    marginRight: 10,
  },
  toolbarBtnText: { color: "#555", fontSize: 13, fontWeight: "bold" },
  inputRow: { flexDirection: "row", alignItems: "center" },
  createPostInput: {
    flex: 1,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 40,
    maxHeight: 100,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#eee",
  },
  createPostButton: {
    marginLeft: 10,
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  createPostButtonDisabled: { backgroundColor: "#b3d9ff" },
  createPostButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },

  typeContainer: { flexDirection: "row", marginBottom: 15 },
  typeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginRight: 10,
  },
  typeBtnActive: { backgroundColor: "#e6f2ff", borderColor: COLORS.primary },
  typeBtnText: { fontSize: 13, color: "#555", fontWeight: "bold" },
  typeBtnTextActive: { color: COLORS.primary },

  switchContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    backgroundColor: "#f9f9f9",
    padding: 15,
    borderRadius: 8,
  },
  switchLabel: { fontSize: 15, fontWeight: "bold", color: COLORS.textMain },
  switchSubLabel: { fontSize: 12, color: "#888", marginTop: 4 },
  inputLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 8,
  },
  memberSelector: {
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    marginBottom: 15,
  },
  memberOption: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  memberOptionSelected: { backgroundColor: "#e6f2ff" },
  memberOptionTextSelected: { color: COLORS.primary, fontWeight: "bold" },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "85%",
    backgroundColor: COLORS.card,
    padding: 20,
    borderRadius: 12,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 15,
    color: COLORS.textMain,
  },
  modalInput: {
    backgroundColor: "#f0f0f0",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  modalButtons: { flexDirection: "row", justifyContent: "flex-end" },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    marginRight: 10,
  },
  modalCancelText: { color: "#888", fontWeight: "bold", fontSize: 15 },
  modalSubmitBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalSubmitText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  reasonBtn: { padding: 15, borderBottomWidth: 1, borderBottomColor: "#eee" },
  reasonBtnText: {
    fontSize: 16,
    color: COLORS.primary,
    textAlign: "center",
    fontWeight: "bold",
  },

  // ★ 通知センター・ダッシュボード用のスタイル
  dashboardContainer: { flex: 1, backgroundColor: "#f9f9f9" },
  dashboardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 60 : 30,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  dashboardTitle: { fontSize: 20, fontWeight: "bold", color: COLORS.danger },
  dashboardContent: { padding: 15 },
  dashboardCard: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#ffcccc",
  },
  dashBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 5 },

  notifCard: {
    backgroundColor: COLORS.card,
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    elevation: 1,
  },
  notifHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: COLORS.textMain,
    flex: 1,
  },
  notifTime: {
    fontSize: 12,
    color: COLORS.textSub,
    marginLeft: 10,
  },
  notifContent: {
    fontSize: 13,
    color: COLORS.textSub,
  },
});

export default WorkspaceHomeScreen;
