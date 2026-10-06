const WORKSPACE_REACTION_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🙏"];

const workspaceReactionReceiptId = (teamId, postId) =>
  `${encodeURIComponent(teamId)}:${encodeURIComponent(postId)}`;

function canViewWorkspaceReactionSenders(post, uid, role) {
  return Boolean(
    uid && post && post.status !== "deleted" &&
    post.moderationStatus !== "hidden" &&
    (!Array.isArray(post.visibleToUids) || post.visibleToUids.includes(uid)) &&
    (["owner", "admin", "staff"].includes(role) || post.authorUid === uid),
  );
}

function workspaceReactionSenders(reactors, emoji, profiles) {
  const byUid = new Map(Object.values(profiles).filter((profile) => profile?.uid)
    .map((profile) => [profile.uid, profile]));
  return Object.entries(reactors || {}).filter(([, reaction]) => reaction === emoji)
    .map(([uid]) => ({ uid, name: byUid.get(uid)?.name || "退会済み・名称未設定" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

module.exports = { WORKSPACE_REACTION_EMOJIS, workspaceReactionReceiptId,
  canViewWorkspaceReactionSenders, workspaceReactionSenders };
