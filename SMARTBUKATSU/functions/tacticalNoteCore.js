// Shared by Metro and Functions; keep this module dependency-free.
const TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION = 2;
const DELETED_TACTICAL_NOTE_UID = 'deleted_user';
const DELETED_TACTICAL_NOTE_NAME = '削除済みユーザー';
const noteConfirmationVersion = (note = {}) => note.contentVersion || 1;
const timestampMillis = (value) => typeof value?.toMillis === 'function' ? value.toMillis() : typeof value?.seconds === 'number' ? value.seconds * 1000 + (value.nanoseconds || 0) / 1e6 : 0;
const timestampsEqual = (a, b) => {
  if (typeof a?.isEqual === 'function') return a.isEqual(b);
  if (typeof b?.isEqual === 'function') return b.isEqual(a);
  if (typeof a?.seconds === 'number' && typeof b?.seconds === 'number') return a.seconds === b.seconds && (a.nanoseconds || 0) === (b.nanoseconds || 0);
  return a?.toMillis?.() === b?.toMillis?.();
};
const contentFingerprint = (note = {}) => JSON.stringify([String(note.title || '').trim(), note.description || '', note.assigneeUids || [], note.clips || [], (note.images || []).map((image) => image.id)]);
function noteSummary(note, responses = [], progress = [], uid, today = '') {
  const latest = {}, seen = new Set(), questions = new Set();
  for (const response of responses) {
    if (response.version !== noteConfirmationVersion(note)) continue;
    seen.add(response.uid);
    if (response.status === 'question' && response.resolved !== true) questions.add(response.uid);
    if (!['read', 'understood'].includes(response.status)) continue;
    const previous = latest[response.uid];
    if (!previous || (response.status === 'understood' && previous.status !== 'understood') || (response.status === previous.status && timestampMillis(response.createdAt) > timestampMillis(previous.createdAt))) latest[response.uid] = response;
  }
  // Asking a question counts as having inspected the content, as in Phase 2.
  for (const response of responses) if (response.version === noteConfirmationVersion(note) && !latest[response.uid]) latest[response.uid] = response;
  const targets = [...new Set(note.assigneeUids || [])], records = new Map(progress.map((item) => [`${item.taskId}_${item.uid}`, item]));
  const items = Object.entries(note.tasks || {}).flatMap(([taskId, task]) => (task.assigneeUids || []).map((person) => {
    const record = records.get(`${taskId}_${person}`), done = record?.taskRevision === task.revision && record.status === 'done';
    return {taskId, uid: person, done};
  }));
  const pending = targets.filter((person) => !seen.has(person));
  return {latest, pending, questions: targets.filter((person) => questions.has(person)), confirmed: targets.length - pending.length, items,
    mine: targets.includes(uid) || items.some((item) => item.uid === uid), unconfirmed: targets.includes(uid) && !seen.has(uid),
    unfinished: items.some((item) => !item.done), completed: items.length > 0 && items.every((item) => item.done)};
}
function buildTacticalNoteSummary(note, responses = [], progress = []) {
  const state = noteSummary(note, responses, progress);
  const taskAssigneeUids = [...new Set(state.items.map((item) => item.uid))], assigneeUids = [...new Set(note.assigneeUids || [])];
  return {schemaVersion: TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION, contentVersion: noteConfirmationVersion(note), noteUpdatedAt: note.updatedAt || null,
    title: note.title || '', descriptionPreview: String(note.description || '').slice(0, 300), authorUid: note.authorUid || '', authorName: note.authorName || '',
    createdAt: note.createdAt || null, sourceProjectId: note.sourceProjectId || '', hasClips: !!note.clips?.length, imageCount: note.images?.length || 0,
    assigneeUids, mineUids: [...new Set([...assigneeUids, ...taskAssigneeUids])], confirmedUids: assigneeUids.filter((person) => !state.pending.includes(person)),
    pendingUids: state.pending, questionUids: state.questions, readUids: assigneeUids.filter((person) => responses.some((response) => response.uid === person && response.version === noteConfirmationVersion(note) && response.status === 'read')), understoodUids: assigneeUids.filter((person) => responses.some((response) => response.uid === person && response.version === noteConfirmationVersion(note) && response.status === 'understood')), taskAssigneeUids, taskCount: Object.keys(note.tasks || {}).length, taskTotalCount: state.items.length,
    taskDoneCount: state.items.filter((item) => item.done).length, hasTasks: Object.keys(note.tasks || {}).length > 0,
    unfinished: state.unfinished, completed: state.completed, draft: note.draft === true, deleting: false};
}
function anonymizeTacticalNote(note, uid) {
  const patch = {};
  if (note.authorUid === uid) {patch.authorUid = DELETED_TACTICAL_NOTE_UID; patch.authorName = DELETED_TACTICAL_NOTE_NAME;}
  const assigneeUids = (note.assigneeUids || []).filter((person) => person !== uid);
  if (assigneeUids.length !== (note.assigneeUids || []).length) {patch.assigneeUids = assigneeUids; patch.contentVersion = noteConfirmationVersion(note) + 1;}
  let changed = false; const tasks = {};
  for (const [taskId, task] of Object.entries(note.tasks || {})) {
    const people = (task.assigneeUids || []).filter((person) => person !== uid), removed = people.length !== (task.assigneeUids || []).length;
    changed ||= removed; if (removed && !people.length) continue;
    tasks[taskId] = removed ? {...task, assigneeUids: people, revision: (task.revision || 1) + 1} : task;
  }
  if (changed) patch.tasks = tasks;
  return patch;
}
function anonymizeTacticalActivity(data, uid) {
  const result = {...data};
  for (const field of ['uid', 'updatedBy', 'resolvedBy', 'uploaderUid', 'uploadedBy', 'authorUid']) if (result[field] === uid) result[field] = DELETED_TACTICAL_NOTE_UID;
  if (data.authorUid === uid && typeof data.authorName === 'string') result.authorName = DELETED_TACTICAL_NOTE_NAME;
  return result;
}
module.exports = {TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION, DELETED_TACTICAL_NOTE_UID, noteConfirmationVersion, timestampMillis, timestampsEqual, contentFingerprint,
  noteSummary, buildTacticalNoteSummary, anonymizeTacticalNote, anonymizeTacticalActivity};

