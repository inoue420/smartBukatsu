const { contentFingerprint, noteConfirmationVersion, timestampsEqual, noteSummary: summarizeNote } = require("../../functions/tacticalNoteCore");
const NOTE_ROLES = ["owner", "admin", "staff", "captain", "member"];
const canReadNotes = (profile) => NOTE_ROLES.includes(profile?.role);
const canPostNotes = (profile) => ["owner", "admin", "staff", "captain"].includes(profile?.role) ||
  (profile?.role === "member" && profile.canPostTacticalNotes === true);
const canManageNote = (profile, uid, note) => canReadNotes(profile) &&
  (["owner", "admin"].includes(profile?.role) || note?.authorUid === uid);
const seconds = (value, fallback) => Number.isFinite(Number(value))
  ? Math.max(0, Math.floor(Number(value))) : fallback;

const noteClipKey = (clip) => JSON.stringify([clip.projectId, String(clip.tagId ?? clip.id)]);
function buildNotePlaybackClips(note, projects) {
  return (note?.clips || []).map((clip, index) => {
    const source = projects.find((p) => p.id === clip.projectId && p.status !== "deleted");
    return { ...clip, id: `${index}:${clip.tagId}`, project: clip.projectTitle,
      url: source?.videoUrl && source.videoUrl === clip.sourceUrl ? clip.sourceUrl : null,
      originalLabel: "", labels: [], user: note.authorName || "", date: "" };
  });
}
const snapshotNoteClip = (clip) => ({
  projectId: clip.projectId, tagId: String(clip.tagId ?? clip.id),
  sourceUrl: clip.sourceUrl ?? clip.url, projectTitle: clip.projectTitle ?? clip.project,
  label: clip.label ?? clip.originalLabel, start: clip.start, end: clip.end, comment: "",
});
function mergeNoteClips(existing, additions) {
  const keys = new Set(existing.map(noteClipKey));
  const result = [...existing];
  for (const clip of additions) {
    const key = noteClipKey(clip);
    if (!keys.has(key) && clip.status !== "private") {
      result.push(snapshotNoteClip(clip));
      keys.add(key);
    }
  }
  if (result.length > 100) throw new Error("場面は100件までです。選択数を減らしてください。");
  return result;
}

function toggleNoteClipSelection(selection, clip, existingKeys = []) {
  const key = noteClipKey(clip);
  if (clip.status === "private" || existingKeys.includes(key)) return selection;
  if (selection.some((item) => noteClipKey(item) === key)) return selection.filter((item) => noteClipKey(item) !== key);
  if (selection.length + existingKeys.length >= 100) throw new Error("場面は100件までです。選択数を減らしてください。");
  return [...selection, snapshotNoteClip(clip)];
}

function buildNoteClips(projects, source, tags = [], mode = "OR") {
  const videoIds = new Set(source?.videoIds || []);
  return projects.filter((p) => videoIds.has(p.id) && p.status !== "deleted" && p.videoUrl)
    .flatMap((p) => (p.tags || []).filter((tag) => tag.status !== "private").flatMap((tag) => {
      const labels = String(tag.label || "").split("+").map((x) => x.trim()).filter(Boolean);
      if (tags.length && !(mode === "AND" ? tags.every((x) => labels.includes(x)) : tags.some((x) => labels.includes(x)))) return [];
      const time = Number(tag.videoTime);
      if (!Number.isFinite(time) || time < 0) return [];
      const pre = seconds(tag.useCustomClipDuration === true ? tag.preSeconds : p.clipPreSeconds, seconds(p.clipPreSeconds, 5));
      const post = seconds(tag.useCustomClipDuration === true ? tag.postSeconds : p.clipPostSeconds, seconds(p.clipPostSeconds, 3));
      const start = Math.max(0, time - pre), end = time + post;
      if (end <= start) return [];
      return [{ projectId: p.id, tagId: String(tag.id), sourceUrl: p.videoUrl, projectTitle: p.title || "動画", label: labels.join(" + "), start, end, comment: "" }];
    })).sort((a, b) => a.start - b.start);
}

function validateNote(note) {
  if (!note.title?.trim()) throw new Error("タイトルを入力してください。");
  if (note.title.length > 120 || note.description.length > 5000) throw new Error("タイトルは120文字、説明は5000文字以内です。");
  if ((!note.clips.length && !(note.images || []).length) || note.clips.length > 100) throw new Error("動画場面または画像を添付してください（場面は100件まで）。");
  if (note.clips.some((c) => !c.projectId || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || c.comment.length > 2000)) throw new Error("場面の区間またはコメントを確認してください（2000文字以内）。");
}
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
function getNoteConfirmationSelection(members, selectedUids = []) {
  const allUids = [...new Set(members.filter((member) => ["captain", "member"].includes(member.role) && member.uid).map((member) => member.uid))];
  return { allUids, allSelected: allUids.length > 0 && selectedUids.length === allUids.length && allUids.every((uid) => selectedUids.includes(uid)) };
}
const noteAcknowledgementId = (note, uid, status) => `ack_${note.contentVersion || 1}_${status}_${uid}`;
const hasNoteAcknowledgement = (note, responses = [], uid, status) => ["read", "understood"].includes(status) &&
  responses.some((response) => response.uid === uid && response.status === status && response.version === (note.contentVersion || 1));
function validateTasks(tasks = {}, clips = [], members = []) {
  if (Object.keys(tasks).length > 30) throw new Error("タスクは30件までです。");
  for (const [id, task] of Object.entries(tasks)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !task.text?.trim() || task.text.length > 2000 ||
      !task.assigneeUids?.length || new Set(task.assigneeUids).size !== task.assigneeUids.length ||
      task.assigneeUids.some((uid) => !members.includes(uid)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate) ||
      localDate(new Date(`${task.dueDate}T12:00:00`)) !== task.dueDate ||
      (task.clipKey && !clips.some((clip) => noteClipKey(clip) === task.clipKey))) {
      throw new Error("タスクの実施内容・担当者・期限・対象場面を確認してください。");
    }
  }
}
const noteSummary = (note, responses, progress, uid, today = localDate()) => summarizeNote(note, responses, progress, uid, today);
function isNoteSummaryCurrent(note, index) {
  return Boolean(index && index.schemaVersion >= 1 && index.contentVersion === (note.contentVersion || 1)
    && timestampsEqual(note.updatedAt, index.noteUpdatedAt));
}
function summaryFromIndex(index, uid, today = localDate()) {
  const pending = index.pendingUids || [], questions = index.questionUids || [];
  const latest = {};
  for (const [field, status] of [["confirmedUids", "question"], ["readUids", "read"], ["understoodUids", "understood"]]) {
    for (const person of index[field] || []) latest[person] = { uid: person, status, version: index.contentVersion };
  }
  const dueCounts = index.taskDueCounts || {};
  return { latest, pending, questions, confirmed: (index.confirmedUids || []).length,
    mine: (index.mineUids || []).includes(uid), unconfirmed: pending.includes(uid),
    unfinished: index.unfinished === true, completed: index.completed === true,
    taskCount: index.taskCount || 0, total: index.taskTotalCount || 0, done: index.taskDoneCount || 0,
    overdue: Object.entries(dueCounts).reduce((sum, [date, count]) => sum + (date < today ? count.total - count.done : 0), 0),
    dueDates: Object.keys(dueCounts).sort() };
}
module.exports = { canReadNotes, canPostNotes, canManageNote, buildNoteClips, validateNote,
  noteClipKey, snapshotNoteClip, mergeNoteClips, toggleNoteClipSelection, buildNotePlaybackClips,
  contentFingerprint, noteConfirmationVersion, timestampsEqual, localDate, validateTasks, noteSummary,
  getNoteConfirmationSelection, noteAcknowledgementId, hasNoteAcknowledgement, isNoteSummaryCurrent, summaryFromIndex };
