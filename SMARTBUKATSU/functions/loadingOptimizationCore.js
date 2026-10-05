const SCHEMA_VERSION = 1;
const iso = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
function lastEventDate(event = {}) {
  const dates = (event.selectedDates || []).map(iso).filter(Boolean).sort();
  return dates.at(-1) || iso(event.endDate) || iso(event.date);
}
const score = (value, version) => Math.max(1, Math.min(5, Number.isFinite(Number(value)) ? (Number(version) === 2 ? Math.round(Number(value)) : Math.ceil(Number(value) / 2)) : 3));
function medicalKey(report) {
  return [Number(report.condition === "不良"), Number(report.isParticipating === "不可"), score(report.fatigue, report.medicalScaleVersion), report.hasPain ? score(report.painDetails?.level, report.medicalScaleVersion) : 0].join(":");
}
function displayName(member) {
  const suffix = { owner: "監督", admin: "管理者", staff: "コーチ", captain: "キャプテン", guardian: "保護者" }[member.role];
  return suffix ? `${member.profileKey}(${suffix})` : member.profileKey;
}
function contentUid(data, members) {
  return data.authorUid || members.find((member) => [member.name, member.profileKey, displayName(member)].includes(data.user || data.author))?.uid || "";
}
function workspaceNotifications(post, member, members, state = {}) {
  if (!post || post.status === "deleted" || post.moderationStatus === "hidden" || !(post.visibleToUids || []).includes(member.uid)) return 0;
  const blocked = new Set(member.blockedUserUids || []);
  if (blocked.has(contentUid(post, members))) return 0;
  const unread = (data, key) => !(data.readNotifs || []).includes(member.profileKey) && !(data.dismissedNotifs || []).includes(member.profileKey) && !(state.notificationReads?.[member.uid] || []).includes(key) && !(state.notificationDismissals?.[member.uid] || []).includes(key);
  let total = String(post.content || "").includes(`@${member.profileKey}`) && post.user !== displayName(member) && unread(post, "post") ? 1 : 0;
  for (const reply of post.replies || []) {
    if (reply.status === "deleted" || reply.moderationStatus === "hidden" || blocked.has(contentUid(reply, members)) || !unread(reply, `reply:${reply.id}`)) continue;
    if ((post.user === displayName(member) && reply.user !== displayName(member)) || (post.user !== displayName(member) && String(reply.content || "").includes(`@${member.profileKey}`) && reply.user !== displayName(member))) total += 1;
  }
  return total;
}
function contributions(kind, data, members, state) {
  if (!data || data.status === "deleted") return {};
  const result = {};
  const author = members.find((member) => member.uid === data.authorUid || member.profileKey === data.author);
  for (const member of members) {
    if (kind === "notices" && !(data.readBy || []).includes(member.profileKey)) result[member.uid] = { unreadNoticeCount: 1 };
    if (kind === "dailyReports" && !data.isReviewed && (member.role !== "staff" || member.staffScope !== "assigned" || author?.assignedStaff === member.profileKey)) result[member.uid] = { medicalHistogram: { [medicalKey(data)]: 1 } };
    if (kind === "workspacePosts") {
      const count = workspaceNotifications(data, member, members, state);
      if (count) result[member.uid] = { workspaceNotificationUnreadCount: count };
    }
  }
  return result;
}
function adjustSummary(summary = {}, before = {}, after = {}) {
  const result = { ...summary };
  for (const field of ["unreadNoticeCount", "workspaceNotificationUnreadCount"]) result[field] = Math.max(0, (summary[field] || 0) - (before[field] || 0) + (after[field] || 0));
  result.medicalHistogram = { ...(summary.medicalHistogram || {}) };
  for (const key of new Set([...Object.keys(before.medicalHistogram || {}), ...Object.keys(after.medicalHistogram || {})])) {
    const count = Math.max(0, (result.medicalHistogram[key] || 0) - (before.medicalHistogram?.[key] || 0) + (after.medicalHistogram?.[key] || 0));
    if (count) result.medicalHistogram[key] = count; else delete result.medicalHistogram[key];
  }
  return result;
}
function audienceFor(post, channels, members) {
  const channel = channels.find((item) => item.id === post.channelId || item.name === post.channel) || channels[0] || { allowedRoleGroups: ["staff", "captain", "member"] };
  if (!channel) return null;
  const group = (role) => ["owner", "admin", "staff"].includes(role) ? "staff" : role === "captain" ? "captain" : role === "guardian" ? "guardian" : "member";
  let groups = channel.allowedRoleGroups?.length ? channel.allowedRoleGroups : null;
  if (!groups && channel.shareScope === "coach") groups = ["staff"];
  if (!groups && channel.shareScope === "group" && !(channel.allowedMembers || []).includes("all")) {
    groups = ["staff", ...members.filter((member) => (channel.allowedMemberUids || []).includes(member.uid) || (channel.allowedMembers || []).some((name) => [member.name, member.profileKey].includes(name))).map((member) => group(member.role))];
  }
  groups ||= ["staff", "captain", "member"];
  const audience = members.filter((member) => groups.includes(group(member.role)));
  const visibleToUids = [...new Set([...audience.map((member) => member.uid), ...(post.authorUid ? [post.authorUid] : [])])].sort();
  const readTargetUids = members.filter((member) => member.role !== "guardian" && visibleToUids.includes(member.uid)).map((member) => member.uid).sort();
  return { shareScope: "roles", visibleToUids, readTargetUids };
}
module.exports = { SCHEMA_VERSION, lastEventDate, medicalKey, displayName, contributions, adjustSummary, audienceFor };
