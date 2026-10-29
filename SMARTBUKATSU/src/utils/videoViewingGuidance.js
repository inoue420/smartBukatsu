const { canViewRecordedTag, isRecordedTagOwner } = require("./recordedTagPermissions");

function viewingPermissions(role, canUploadVideos = false) {
  return {
    canCreate: ["owner", "admin", "staff", "captain"].includes(role) ||
      (["member", "guardian"].includes(role) && Boolean(canUploadVideos)),
    canAdd: ["owner", "admin", "staff"].includes(role),
  };
}

function canUseViewingVideo(video, viewer) {
  return Boolean(video?.id && video.status !== "deleted" && video.videoUrl) &&
    !(["member", "captain"].includes(viewer.userRole) && video.participants === "coach");
}

function hasViewingTags(video, viewer) {
  return canUseViewingVideo(video, viewer) &&
    (video.tags || []).some((tag) => canViewRecordedTag(tag, viewer));
}

function ownPrivateTagCount(videos, viewer) {
  return videos.reduce((count, video) => count + (video.tags || []).filter(
    (tag) => tag.status === "private" && isRecordedTagOwner(tag, viewer),
  ).length, 0);
}

module.exports = { viewingPermissions, canUseViewingVideo, hasViewingTags, ownPrivateTagCount };
