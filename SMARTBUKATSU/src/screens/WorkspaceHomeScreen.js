import React, { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
  Modal,
  Switch,
} from "react-native";

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🙏"];
const REPORT_REASONS = ["暴言・誹謗中傷", "スパム・宣伝", "その他"];

const WorkspaceHomeScreen = ({
  navigation,
  isAdmin,
  currentUser,
  notices,
  posts,
  setPosts,
  isOffline,
  toggleNetworkStatus,
  clubMembers,
}) => {
  const displayUserName = isAdmin ? "管理者(監督)" : `${currentUser}(あなた)`;
  const unreadNoticeCount = notices.filter(
    (n) => !n.readBy.includes(currentUser),
  ).length;

  const [searchQuery, setSearchQuery] = useState("");

  // ★修正：新しく「共有日記」チャンネルを追加
  const [channels, setChannels] = useState([
    { id: "ch_1", name: "全体連絡", isReadOnly: true, allowedMembers: ["all"] },
    {
      id: "ch_diary",
      name: "共有日記",
      isReadOnly: true,
      allowedMembers: ["all"],
    },
    {
      id: "ch_2",
      name: "トレーニング",
      isReadOnly: false,
      allowedMembers: ["all"],
    },
    {
      id: "ch_3",
      name: "Aチーム限定",
      isReadOnly: false,
      allowedMembers: ["佐藤", "鈴木"],
    },
  ]);
  const [activeChannelId, setActiveChannelId] = useState("ch_1");

  const visibleChannels = channels.filter((ch) => {
    if (isAdmin) return true;
    return (
      ch.allowedMembers.includes("all") ||
      ch.allowedMembers.includes(currentUser)
    );
  });

  const activeChannelObj =
    channels.find((c) => c.id === activeChannelId) || visibleChannels[0];

  const [isAddChannelModalVisible, setIsAddChannelModalVisible] =
    useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelIsReadOnly, setNewChannelIsReadOnly] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState(["all"]);

  const [newPostText, setNewPostText] = useState("");
  const [expandedPostId, setExpandedPostId] = useState(null);
  const [replyText, setReplyText] = useState("");

  const [activeReactionPostId, setActiveReactionPostId] = useState(null);
  const [activeLongPressPostId, setActiveLongPressPostId] = useState(null);
  const [activeLongPressReply, setActiveLongPressReply] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [isReplyFocused, setIsReplyFocused] = useState(false);

  const [isReportModalVisible, setIsReportModalVisible] = useState(false);
  const [reportingTarget, setReportingTarget] = useState(null);
  const [isDashboardVisible, setIsDashboardVisible] = useState(false);

  const mainInputRef = useRef(null);
  const replyInputRef = useRef(null);

  const reportedItems = [];
  posts.forEach((post) => {
    if (post.reported && post.reported.length > 0)
      reportedItems.push({ type: "post", item: post, postId: post.id });
    post.replies?.forEach((reply) => {
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
    if (trimmedName === "") {
      Alert.alert("エラー", "チャンネル名を入力してください。");
      return;
    }
    if (channels.some((c) => c.name === trimmedName)) {
      Alert.alert("エラー", "そのチャンネルは既に存在します。");
      return;
    }
    const newCh = {
      id: "ch_" + Date.now().toString(),
      name: trimmedName,
      isReadOnly: newChannelIsReadOnly,
      allowedMembers: selectedMembers,
    };
    setChannels([...channels, newCh]);
    setActiveChannelId(newCh.id);
    setIsAddChannelModalVisible(false);
    setNewChannelName("");
    setNewChannelIsReadOnly(false);
    setSelectedMembers(["all"]);
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
      readCount: 0,
      isPinned: false,
      status: isOffline ? "pending" : "sent",
    };
    setPosts([newPost, ...posts]);
    setNewPostText("");
    setReplyingTo(null);
    mainInputRef.current?.clear();
    Keyboard.dismiss();
  };

  const handleSendReply = (postId) => {
    if (replyText.trim() === "") return;
    const newPosts = posts.map((post) => {
      if (post.id === postId) {
        return {
          ...post,
          replies: [
            ...post.replies,
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
      }
      return post;
    });
    setPosts(newPosts);
    setReplyText("");
    replyInputRef.current?.clear();
    Keyboard.dismiss();
    setIsReplyFocused(false);
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
      if (type === "post") setPosts(posts.filter((p) => p.id !== postId));
      else
        setPosts(
          posts.map((p) =>
            p.id === postId
              ? { ...p, replies: p.replies.filter((r) => r.id !== replyId) }
              : p,
          ),
        );
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
    const newPosts = posts.map((post) => {
      if (post.id === postId) return { ...post, isPinned: !post.isPinned };
      return post;
    });
    setPosts(newPosts);
    setActiveLongPressPostId(null);
  };

  const handleDeletePost = (postId) => {
    Alert.alert("投稿の削除", "削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除する",
        style: "destructive",
        onPress: () => {
          setPosts(posts.filter((post) => post.id !== postId));
          setActiveLongPressPostId(null);
        },
      },
    ]);
  };

  const handleMutePost = () => {
    Alert.alert("ミュート完了", "通知をオフにしました。");
    setActiveLongPressPostId(null);
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
      replyInputRef.current?.clear();
      setIsReplyFocused(false);
      setActiveLongPressReply(null);
    }
  };

  const insertText = (textToInsert) =>
    setNewPostText((prev) => prev + textToInsert);
  const isReportedByMe = (item) =>
    item.reported?.some((r) => r.by === displayUserName);

  const filteredPosts = posts.filter(
    (post) => post.channel === activeChannelObj.name,
  );
  const pinnedPosts = filteredPosts.filter((p) => p.isPinned);
  const regularPosts = filteredPosts
    .filter((p) => !p.isPinned)
    .sort((a, b) => {
      if (a.status === "pending" && b.status !== "pending") return -1;
      if (a.status !== "pending" && b.status === "pending") return 1;
      return 0;
    });

  const renderPostCard = (post, isPinnedArea = false) => {
    if (isReportedByMe(post) && !isAdmin)
      return (
        <View key={post.id} style={styles.reportedMaskCard}>
          <Text style={styles.reportedMaskText}>
            ※管理者に報告済みのため非表示
          </Text>
        </View>
      );
    const isPending = post.status === "pending";
    return (
      <TouchableOpacity
        key={post.id}
        style={[
          styles.postCard,
          isPinnedArea && styles.pinnedCard,
          post.reported?.length > 0 && isAdmin && styles.adminReportedCard,
          isPending && styles.pendingCard,
          isPinnedArea && { marginBottom: 10 },
        ]}
        activeOpacity={0.9}
        onLongPress={() => !isPending && setActiveLongPressPostId(post.id)}
        delayLongPress={300}
      >
        {isPending && (
          <View style={styles.pendingHeader}>
            <Text style={styles.pendingHeaderText}>
              🕒 送信待機中（オフライン）
            </Text>
          </View>
        )}
        {post.reported?.length > 0 && isAdmin && !isPending && (
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
          <Text style={styles.postUser}>{post.user}</Text>
          <Text style={styles.postTime}>
            {isPending ? "待機中..." : post.time}
          </Text>
        </View>

        {post.replyTo && (
          <View style={styles.quoteContainer}>
            <Text style={styles.quoteUser}>{post.replyTo.user}</Text>
            <Text style={styles.quoteContent} numberOfLines={2}>
              {post.replyTo.content}
            </Text>
          </View>
        )}
        <Text style={styles.postContent}>
          {renderContentWithMentions(post.content)}
        </Text>

        {!isPending && !isPinnedArea && (
          <View style={styles.actionBar}>
            <TouchableOpacity
              style={styles.replyButton}
              onPress={() => toggleThread(post.id)}
            >
              <Text style={styles.replyButtonText}>
                💬{" "}
                {post.replies.length > 0
                  ? `${post.replies.length}件の返信`
                  : "返信(スレッド)"}
              </Text>
            </TouchableOpacity>
            <View style={styles.actionRight}>
              <Text style={styles.readCountText}>既読 {post.readCount}</Text>
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
            {isAdmin && (
              <>
                <TouchableOpacity
                  style={styles.longPressMenuItem}
                  onPress={() => togglePin(post.id)}
                >
                  <Text style={styles.longPressMenuText}>
                    {post.isPinned ? "📌 固定を解除する" : "📌 投稿を固定する"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.longPressMenuItem}
                  onPress={() => handleMutePost(post.id)}
                >
                  <Text
                    style={[styles.longPressMenuText, { color: "#f0ad4e" }]}
                  >
                    🔇 ミュートする
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.longPressMenuItem}
                  onPress={() => handleDeletePost(post.id)}
                >
                  <Text
                    style={[styles.longPressMenuText, { color: "#d9534f" }]}
                  >
                    🗑 投稿を削除する
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
              <Text style={[styles.longPressMenuText, { color: "#d9534f" }]}>
                🚨 管理者に報告する
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.longPressMenuItem}
              onPress={() => setActiveLongPressPostId(null)}
            >
              <Text style={[styles.longPressMenuText, { color: "#888" }]}>
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
                  isOffline && { backgroundColor: "#f39c12" },
                ]}
                onPress={() => handleSendReply(post.id)}
              >
                <Text style={styles.sendButtonText}>送信</Text>
              </TouchableOpacity>
            </View>
            {post.replies.map((reply) => {
              const isReplyPending = reply.status === "pending";
              if (isReportedByMe(reply) && !isAdmin)
                return (
                  <View key={reply.id} style={styles.reportedMaskCard}>
                    <Text style={styles.reportedMaskText}>
                      ※報告済みのため非表示
                    </Text>
                  </View>
                );

              return (
                <TouchableOpacity
                  key={reply.id}
                  style={[
                    styles.replyCard,
                    { position: "relative", zIndex: 1 },
                    reply.reported?.length > 0 &&
                      isAdmin &&
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
                        {isAdmin && (
                          <TouchableOpacity
                            style={styles.longPressMenuItem}
                            onPress={() => {
                              Alert.alert("確認", "削除しますか？", [
                                { text: "キャンセル" },
                                {
                                  text: "削除",
                                  style: "destructive",
                                  onPress: () => {
                                    setPosts(
                                      posts.map((p) =>
                                        p.id === post.id
                                          ? {
                                              ...p,
                                              replies: p.replies.filter(
                                                (r) => r.id !== reply.id,
                                              ),
                                            }
                                          : p,
                                      ),
                                    );
                                    setActiveLongPressReply(null);
                                  },
                                },
                              ]);
                            }}
                          >
                            <Text
                              style={[
                                styles.longPressMenuText,
                                { color: "#d9534f" },
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
                              { color: "#d9534f" },
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
                              { color: "#888" },
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
        <View style={[styles.header, isOffline && styles.headerOffline]}>
          <Text style={styles.headerTitle}>
            {isOffline ? "オフライン表示中" : "ホーム"}
          </Text>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={toggleNetworkStatus}
            >
              <Text style={styles.navIcon}>{isOffline ? "🚫" : "🌐"}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => navigation.navigate("NoticeBoard")}
            >
              <Text style={styles.navIcon}>📋</Text>
              {!isAdmin && unreadNoticeCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unreadNoticeCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => navigation.navigate("Diary")}
            >
              <Text style={styles.navIcon}>📖</Text>
            </TouchableOpacity>
            {isAdmin && (
              <>
                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={() => setIsDashboardVisible(true)}
                >
                  <Text style={styles.navIcon}>🔔</Text>
                  {reportCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{reportCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={() => navigation.navigate("Settings")}
                >
                  <Text style={styles.navIcon}>⚙️</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={() =>
                navigation.reset({ index: 0, routes: [{ name: "Login" }] })
              }
            >
              <Text style={styles.logoutBtnText}>ログアウト</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isOffline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineBannerText}>
              現在オフラインです。投稿は通信復旧時に送信されます。
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
              >
                <Text
                  style={[
                    styles.channelTabText,
                    activeChannelId === channel.id && styles.activeTabText,
                  ]}
                >
                  {channel.allowedMembers.includes("all") ? "# " : "🔐 "}
                  {channel.name} {channel.isReadOnly && "🔒"}
                </Text>
              </TouchableOpacity>
            ))}
            {isAdmin && !isOffline && (
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

        {!isReplyFocused && (
          <View style={styles.createPostContainer}>
            {!isAdmin && activeChannelObj.isReadOnly ? (
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
                  <TouchableOpacity
                    style={styles.toolbarBtn}
                    onPress={() => insertText("\n[🎥添付: 新しい動画]")}
                  >
                    <Text style={styles.toolbarBtnText}>📎 動画を添付</Text>
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
                      isOffline && { backgroundColor: "#f39c12" },
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
                thumbColor={newChannelIsReadOnly ? "#0077cc" : "#f4f3f4"}
              />
            </View>
            <Text style={styles.inputLabel}>参加メンバーを選択</Text>
            <ScrollView
              style={styles.memberSelector}
              nestedScrollEnabled={true}
            >
              <TouchableOpacity
                style={[
                  styles.memberOption,
                  selectedMembers.includes("all") &&
                    styles.memberOptionSelected,
                ]}
                onPress={() => toggleMemberSelection("all")}
              >
                <Text
                  style={
                    selectedMembers.includes("all")
                      ? styles.memberOptionTextSelected
                      : {}
                  }
                >
                  全員参加
                </Text>
              </TouchableOpacity>
              {clubMembers.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.memberOption,
                    selectedMembers.includes(m) && styles.memberOptionSelected,
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
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => {
                  setIsAddChannelModalVisible(false);
                  setNewChannelName("");
                  setNewChannelIsReadOnly(false);
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

      <Modal
        visible={isDashboardVisible}
        transparent={true}
        animationType="slide"
      >
        <SafeAreaView style={styles.dashboardContainer}>
          <View style={styles.dashboardHeader}>
            <Text style={styles.dashboardTitle}>🚨 通報管理ダッシュボード</Text>
            <TouchableOpacity onPress={() => setIsDashboardVisible(false)}>
              <Text style={{ fontSize: 24 }}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.dashboardContent}>
            {reportedItems.map((ri, index) => (
              <View key={index} style={styles.dashboardCard}>
                <Text style={{ fontWeight: "bold", marginBottom: 5 }}>
                  [{ri.type === "post" ? "投稿" : "返信"}] {ri.item.user}
                  の書き込み
                </Text>
                <Text
                  style={{
                    color: "#555",
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
                      { backgroundColor: "#5cb85c", marginRight: 10 },
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
                    style={[styles.dashBtn, { backgroundColor: "#d9534f" }]}
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
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f5" },
  header: {
    height: 60,
    backgroundColor: "#0077cc",
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
    textAlign: "center",
  },
  headerRight: { flexDirection: "row", alignItems: "center" },
  navBtn: { position: "relative", marginRight: 15, padding: 5 },
  navIcon: { fontSize: 20 },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    backgroundColor: "#d9534f",
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "bold" },
  logoutBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: "#e74c3c",
  },
  logoutBtnText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  offlineBanner: {
    backgroundColor: "#f39c12",
    padding: 8,
    alignItems: "center",
  },
  offlineBannerText: { color: "#fff", fontSize: 12, fontWeight: "bold" },
  searchContainer: {
    padding: 15,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  searchInput: {
    height: 40,
    backgroundColor: "#f0f0f0",
    borderRadius: 20,
    paddingHorizontal: 15,
    fontSize: 14,
  },
  channelSection: {
    backgroundColor: "#fff",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
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
  channelTabText: { color: "#666", fontWeight: "bold", fontSize: 14 },
  activeTab: { backgroundColor: "#e6f2ff", borderColor: "#0077cc" },
  activeTabText: { color: "#0077cc" },
  addChannelButton: {
    backgroundColor: "#e2f0d9",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 30,
    borderWidth: 1,
    borderColor: "#5cb85c",
    borderStyle: "dashed",
  },
  addChannelButtonText: { color: "#5cb85c", fontWeight: "bold", fontSize: 14 },
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
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    elevation: 2,
    zIndex: 1,
    position: "relative",
  },
  pendingCard: {
    opacity: 0.6,
    backgroundColor: "#fdfdfd",
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#ccc",
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  pendingHeaderText: { color: "#e67e22", fontSize: 12, fontWeight: "bold" },
  pinnedCard: {
    borderWidth: 1,
    borderColor: "#f3c623",
    backgroundColor: "#fff",
    elevation: 1,
  },
  pinnedHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  pinnedHeaderText: { color: "#d4a000", fontSize: 12, fontWeight: "bold" },
  adminReportedCard: {
    borderWidth: 1,
    borderColor: "#d9534f",
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
    color: "#d9534f",
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
  postHeader: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  userIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0077cc",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  userIconText: { color: "#fff", fontWeight: "bold", fontSize: 16 },
  postUser: { fontSize: 15, fontWeight: "bold", color: "#333", flex: 1 },
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
    color: "#333",
    lineHeight: 22,
    marginBottom: 10,
  },
  mentionText: { color: "#0077cc", fontWeight: "bold" },
  attachmentsContainer: { marginBottom: 15 },
  attachmentCard: {
    backgroundColor: "#e6f2ff",
    borderColor: "#0077cc",
    borderWidth: 1,
    padding: 10,
    borderRadius: 8,
  },
  attachmentText: { color: "#0077cc", fontWeight: "bold", fontSize: 14 },
  actionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
    paddingTop: 10,
    zIndex: 2,
  },
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
    backgroundColor: "#fff",
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
    backgroundColor: "#fff",
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
  longPressMenuText: { fontSize: 14, fontWeight: "bold", color: "#0077cc" },
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
  replyUser: { fontSize: 14, fontWeight: "bold", color: "#333", flex: 1 },
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
    backgroundColor: "#0077cc",
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  sendButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  createPostContainer: {
    backgroundColor: "#fff",
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
    borderLeftColor: "#0077cc",
    marginBottom: 10,
    alignItems: "center",
  },
  replyingToUser: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#0077cc",
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
    backgroundColor: "#0077cc",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 15,
    justifyContent: "center",
  },
  createPostButtonDisabled: { backgroundColor: "#b3d9ff" },
  createPostButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  switchContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
    backgroundColor: "#f9f9f9",
    padding: 15,
    borderRadius: 8,
  },
  switchLabel: { fontSize: 15, fontWeight: "bold", color: "#333" },
  switchSubLabel: { fontSize: 12, color: "#888", marginTop: 4 },
  inputLabel: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#555",
    marginBottom: 8,
  },
  memberSelector: {
    maxHeight: 150,
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
  memberOptionTextSelected: { color: "#0077cc", fontWeight: "bold" },
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
    elevation: 5,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#333",
  },
  modalInput: {
    backgroundColor: "#f0f0f0",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 20,
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
    backgroundColor: "#0077cc",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  modalSubmitText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
  reasonBtn: { padding: 15, borderBottomWidth: 1, borderBottomColor: "#eee" },
  reasonBtnText: {
    fontSize: 16,
    color: "#0077cc",
    textAlign: "center",
    fontWeight: "bold",
  },
  dashboardContainer: { flex: 1, backgroundColor: "#f9f9f9" },
  dashboardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  dashboardTitle: { fontSize: 20, fontWeight: "bold", color: "#d9534f" },
  dashboardContent: { padding: 15 },
  dashboardCard: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#ffcccc",
  },
  dashBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 5 },
});

export default WorkspaceHomeScreen;
