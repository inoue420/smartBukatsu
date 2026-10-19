// Pure shared logic: used by the app, notification delivery and audience repair.
// Keep this module free of Node/Firebase dependencies so Metro can bundle it.
const DEFAULT_ROLE_GROUPS = ["staff", "captain", "member"];
const STAFF_ROLES = ["owner", "admin", "staff"];
const MEMBER_AUDIENCES = ["all", "grades", "none"];

function needsGeneralAudienceUpgrade(channel) {
  return (channel?.id === "ch_1" || (!channel?.id && channel?.name === "全体連絡")) &&
    !MEMBER_AUDIENCES.includes(channel.memberAudience);
}

function roleGroup(role) {
  if (STAFF_ROLES.includes(role)) return "staff";
  if (role === "guardian") return "guardian";
  return role === "captain" ? "captain" : "member";
}

function channelRoleGroups(channel, members = []) {
  if (channel?.shareScope === "grades") return channel.allowedRoleGroups || [];
  if (channel?.allowedRoleGroups?.length) return channel.allowedRoleGroups;
  if (channel?.shareScope === "coach") return ["staff"];
  if (channel?.shareScope === "group" && !(channel.allowedMembers || []).includes("all")) {
    return [...new Set(["staff", ...members.filter((member) =>
      (channel.allowedMemberUids || []).includes(member.uid) ||
      (channel.allowedMembers || []).some((name) => [member.name, member.profileKey].includes(name)),
    ).map((member) => roleGroup(member.role))])];
  }
  return DEFAULT_ROLE_GROUPS;
}

function channelMemberAudience(channel, members = []) {
  if (MEMBER_AUDIENCES.includes(channel?.memberAudience)) return channel.memberAudience;
  if (needsGeneralAudienceUpgrade(channel)) return "all";
  if (channel?.shareScope === "grades") return "grades";
  return channelRoleGroups(channel, members).some((group) => ["captain", "member"].includes(group)) ? "all" : "none";
}

function canViewChannel(channel, member, members = []) {
  if (!member) return false;
  const groups = channelRoleGroups(channel, members);
  if (STAFF_ROLES.includes(member.role)) return groups.includes("staff");
  if (member.role === "guardian") return groups.includes("guardian");
  // Preserve non-system legacy role scopes until they are explicitly edited.
  if (!MEMBER_AUDIENCES.includes(channel?.memberAudience) && !needsGeneralAudienceUpgrade(channel) && channel?.shareScope !== "grades") {
    return groups.includes(roleGroup(member.role));
  }
  const mode = channelMemberAudience(channel, members);
  if (!["member", "captain"].includes(member.role || "member")) return false;
  if (mode === "all") return true;
  if (mode === "none") return false;
  return ["member", "captain"].includes(member.role || "member") && Boolean(member.grade) &&
    (channel.allowedGrades || []).includes(member.grade);
}

function audienceForChannel(channel, members, authorUid = "") {
  const audience = members.filter((member) => canViewChannel(channel, member, members));
  const visibleToUids = [...new Set([...audience.map((member) => member.uid), ...(authorUid ? [authorUid] : [])])].sort();
  const readTargetUids = members.filter((member) => member.role !== "guardian" && visibleToUids.includes(member.uid))
    .map((member) => member.uid).sort();
  return { shareScope: channelMemberAudience(channel, members) === "grades" ? "grades" : "roles", visibleToUids, readTargetUids };
}

module.exports = { DEFAULT_ROLE_GROUPS, channelRoleGroups, channelMemberAudience, needsGeneralAudienceUpgrade, canViewChannel, audienceForChannel };
