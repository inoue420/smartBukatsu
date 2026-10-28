const HISTORY_PAGE_SIZE = 50;
const pad = (value) => String(value).padStart(2, "0");
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const reportDay = (value) => String(value || "").replaceAll("/", "-").slice(0, 10);
const jstDay = (now = new Date()) => new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
function reportWeek(day = jstDay(), offset = 0) {
  const end = new Date(`${reportDay(day)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - offset * 7);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
function reportSubmissionKey(report) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value ?? null;
  const fields = ["date", "condition", "fatigue", "medicalScaleVersion", "isParticipating", "hasPain", "painDetails", "reflection", "achievement", "attachments", "memo", "highlightLink"];
  return JSON.stringify(fields.map((field) => canonical(report[field])));
}
function monthWindow(date = isoDate(new Date()), firstDay = 0) {
  const [year, month] = date.split("-").map(Number);
  // Include the adjacent days that are visible in the calendar grid.
  const weekStart = firstDay === 1 ? 1 : 0;
  const first = new Date(year, month - 1, 1);
  first.setDate(first.getDate() - (first.getDay() - weekStart + 7) % 7);
  const last = new Date(year, month, 0);
  last.setDate(last.getDate() + (weekStart + 6 - last.getDay()) % 7);
  return { start: isoDate(first), end: isoDate(last) };
}
function mergeReadState(post, state = {}, profiles = {}) {
  const names = Object.fromEntries(Object.entries(profiles).map(([name, profile]) => [profile.uid, name]));
  const readers = Object.keys(state.readers || {}).filter((uid) => state.readers[uid]);
  const namesFor = (field, key) => Object.keys(state[field] || {}).filter((uid) => state[field][uid]?.includes(key)).map((uid) => names[uid]).filter(Boolean);
  const union = (a = [], b = []) => [...new Set([...a, ...b])];
  return { ...post, readByUids: union(post.readByUids, readers), readBy: union(post.readBy, readers.map((uid) => names[uid]).filter(Boolean)),
    readNotifs: union(post.readNotifs, namesFor("notificationReads", "post")),
    dismissedNotifs: union(post.dismissedNotifs, namesFor("notificationDismissals", "post")),
    replies: (post.replies || []).map((reply) => ({ ...reply,
      readNotifs: union(reply.readNotifs, namesFor("notificationReads", `reply:${reply.id}`)),
      dismissedNotifs: union(reply.dismissedNotifs, namesFor("notificationDismissals", `reply:${reply.id}`)),
    })) };
}
function medicalDangerCount(histogram = {}, thresholds) {
  return Object.entries(histogram).reduce((total, [key, count]) => {
    const [bad, unavailable, fatigue, pain] = key.split(":").map(Number);
    return total + ((bad || unavailable || fatigue >= thresholds.fatigueDanger || pain >= thresholds.painDanger) ? count : 0);
  }, 0);
}
module.exports = { HISTORY_PAGE_SIZE, isoDate, monthWindow, mergeReadState, medicalDangerCount, reportDay, jstDay, reportWeek, reportSubmissionKey };
