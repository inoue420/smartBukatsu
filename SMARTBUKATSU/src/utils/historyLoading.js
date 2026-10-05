const HISTORY_PAGE_SIZE = 50;
const pad = (value) => String(value).padStart(2, "0");
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
function monthAgo(today = new Date()) {
  const day = today.getDate();
  const result = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  result.setDate(Math.min(day, new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()));
  return isoDate(result);
}
function monthWindow(date = isoDate(new Date())) {
  const [year, month] = date.split("-").map(Number);
  // Include the adjacent days that are visible in the calendar grid.
  const first = new Date(year, month - 1, 1);
  first.setDate(first.getDate() - first.getDay());
  const last = new Date(year, month, 0);
  last.setDate(last.getDate() + 6 - last.getDay());
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
module.exports = { HISTORY_PAGE_SIZE, isoDate, monthAgo, monthWindow, mergeReadState, medicalDangerCount };
