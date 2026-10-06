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

function timestampParts(value) {
  if (value && typeof value === "object") {
    const seconds = value.seconds ?? value._seconds, nanos = value.nanoseconds ?? value._nanoseconds;
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) return [seconds, nanos];
    if (value instanceof Date) value = value.getTime();
    else if (typeof value.toMillis === "function") value = value.toMillis();
    else return null;
  }
  if (!Number.isFinite(value)) return null;
  const seconds = Math.floor(value / 1000);
  return [seconds, Math.round((value - seconds * 1000) * 1000000)];
}

function canonicalValue(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object") return value;
  const rawTimestamp = Number.isFinite(value.seconds ?? value._seconds) && Number.isFinite(value.nanoseconds ?? value._nanoseconds)
    && Object.keys(value).every((key) => ["seconds", "nanoseconds", "_seconds", "_nanoseconds"].includes(key));
  if (value instanceof Date || typeof value.toMillis === "function" || rawTimestamp) return { timestamp: timestampParts(value) };
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}
const stableStringify = (value) => JSON.stringify(canonicalValue(value));
const selectedFields = (data, fields) => Object.fromEntries(fields.filter((field) => data[field] !== undefined).map((field) => [field, data[field]]));
const setValues = (value) => [...new Set(value || [])].sort();
const safetyFields = ["status", "moderationStatus", "sharedWith", "shareScope"];
function safetyData(data) {
  return { ...selectedFields(data, safetyFields), visibleToUids: setValues(data.visibleToUids), readTargetUids: setValues(data.readTargetUids) };
}
const latestFields = ["createdAt", "status", "date", "condition", "fatigue", "medicalScaleVersion", "sleep", "isParticipating", "hasPain"];
function latestFieldsData(data) {
  const result = selectedFields(data, latestFields);
  if (data.painDetails !== undefined) result.painDetails = data.painDetails ? selectedFields(data.painDetails, ["part", "level", "treatment"]) : data.painDetails;
  return result;
}
function aggregateData(kind, data) {
  if (!data) return null;
  const common = safetyData(data);
  if (kind === "dailyReports") return { ...common, authorUid: data.authorUid || "", author: data.author || "", isReviewed: Boolean(data.isReviewed), medicalKey: medicalKey(data) };
  if (kind === "notices") return { ...common, readBy: setValues(data.readBy) };
  if (kind === "workspacePosts") {
    const notificationData = (item) => ({ ...selectedFields(item, ["id", "user", "authorUid", "author", "content", "status", "moderationStatus"]), readNotifs: setValues(item.readNotifs), dismissedNotifs: setValues(item.dismissedNotifs) });
    const replies = (data.replies || []).map(notificationData).sort((a, b) => {
      const first = stableStringify(a), second = stableStringify(b);
      return first < second ? -1 : first > second ? 1 : 0;
    });
    return { ...common, ...notificationData(data), ...selectedFields(data, ["channel", "channelId"]), replies };
  }
  return data;
}
function contentChanges(kind, before, after) {
  const aggregate = stableStringify(aggregateData(kind, before)) !== stableStringify(aggregateData(kind, after));
  const latestData = (data) => data ? { ...latestFieldsData(data), author: data.author || "", authorUid: data.authorUid || "" } : null;
  return { aggregate, latest: kind === "dailyReports" && stableStringify(latestData(before)) !== stableStringify(latestData(after)) };
}
function validLatest(data, member) {
  return Boolean(data && member && data.status !== "deleted" && (data.authorUid ? data.authorUid === member.uid : data.author === member.profileKey));
}
function latestReportData(data, id, member) {
  if (!validLatest(data, member)) return null;
  return { ...latestFieldsData(data), id, author: member.profileKey, authorUid: member.uid };
}
function compareReports(first, second) {
  const data = (item) => typeof item?.data === "function" ? { ...item.data(), id: item.id } : item || {};
  const a = data(first), b = data(second), timeA = timestampParts(a.createdAt) || [0, 0], timeB = timestampParts(b.createdAt) || [0, 0];
  if (timeA[0] !== timeB[0]) return timeB[0] - timeA[0];
  if (timeA[1] !== timeB[1]) return timeB[1] - timeA[1];
  return Buffer.compare(Buffer.from(String(b.id || "")), Buffer.from(String(a.id || "")));
}
module.exports = { SCHEMA_VERSION, lastEventDate, medicalKey, displayName, contributions, adjustSummary, audienceFor,
  contentChanges, latestReportData, validLatest, compareReports, canonicalValue, stableStringify };
