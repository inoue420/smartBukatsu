function isRecordedTagOwner(tag, { currentUserUid, displayUserName }) {
  if (!tag) return false;
  if (tag.uid) return Boolean(currentUserUid) && tag.uid === currentUserUid;
  return Boolean(displayUserName) && tag.user === displayUserName;
}

function canViewRecordedTag(tag, viewer) {
  return Boolean(tag) && (tag.status === "shared" || isRecordedTagOwner(tag, viewer));
}

function canEditRecordedTag(tag, viewer) {
  const allowed = ["owner", "admin", "staff", "captain"].includes(viewer.userRole) ||
    (["member", "guardian"].includes(viewer.userRole) && Boolean(viewer.canEditTags));
  return allowed && canViewRecordedTag(tag, viewer);
}

module.exports = { isRecordedTagOwner, canViewRecordedTag, canEditRecordedTag };
