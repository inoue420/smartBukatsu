const test = require('node:test'), assert = require('node:assert/strict');
process.env.METADATA_SERVER_DETECTION = 'none';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189';
const {initializeApp, deleteApp} = require('firebase-admin/app');
const {getFirestore, FieldValue, Timestamp, FieldPath} = require('firebase-admin/firestore');
const {createTacticalNoteBackend} = require('./tacticalNoteBackend');
const {buildTacticalNoteSummary} = require('./tacticalNoteCore');
const app = initializeApp({projectId: 'demo-tactical-notes'}, 'tactical-backend-' + Date.now());
const db = getFirestore(app);
test.after(async () => { await db.terminate(); await deleteApp(app); });
const stamp = () => FieldValue.serverTimestamp();
const noteData = () => ({title: '指導', description: '説明', authorUid: 'person', authorName: '退会者',
  createdAt: stamp(), updatedAt: stamp(), clips: [], images: [], sourceProjectId: '', draft: false,
  contentVersion: 1, assigneeUids: ['person', 'peer'], tasks: {task: {text: '練習', assigneeUids: ['person', 'peer'], revision: 1}}});
function environment() {
  const metrics = {queries: 0, reads: 0}, files = new Map(), deleted = [];
  let failDelete = false;
  const file = (path) => ({delete: async () => { if (failDelete) { failDelete = false; throw new Error('interrupted'); } deleted.push(path); files.delete(path); }});
  const bucket = {file, getFiles: async ({prefix}) => [[...files.keys()].filter((path) => path.startsWith(prefix)).map(file)]};
  const firestore = {
    collection: (...args) => db.collection(...args), collectionGroup: (...args) => db.collectionGroup(...args), recursiveDelete: (...args) => db.recursiveDelete(...args),
    runTransaction: (operation) => db.runTransaction((transaction) => operation(new Proxy(transaction, {get(target, key) {
      if (key === 'get') return (reference) => { metrics.reads++; if (!reference.path) metrics.queries++; return target.get(reference); };
      return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    }}))),
  };
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const backend = createTacticalNoteBackend({firestore, getStorage: () => ({bucket: () => bucket}), FieldValue, Timestamp, FieldPath, HttpsError});
  const team = db.collection('teams').doc();
  return {backend, team, metrics, files, deleted, failOnce() {failDelete = true;}, note: team.collection('tacticalNotes').doc('note'), index: team.collection('tacticalNoteSummaries').doc('note')};
}
const event = (ref, before, after) => ({data: {before: {data: () => before}, after: {ref, data: () => after}}, params: {teamId: ref.parent.parent.id, noteId: ref.id}});
test('shared summary separates acknowledgements and unresolved questions, task versions and captured history', () => {
  const note = noteData(), responses = [{uid: 'person', version: 1, status: 'read'}, {uid: 'person', version: 1, status: 'understood'},
    {uid: 'person', version: 1, status: 'question', resolved: false}, {uid: 'peer', version: 1, status: 'question', resolved: true}];
  const summary = buildTacticalNoteSummary(note, responses, [{taskId: 'task', uid: 'person', taskRevision: 0, status: 'done'}]);
  assert.deepEqual(summary.questionUids, ['person']); assert.deepEqual(summary.readUids, ['person']); assert.deepEqual(summary.understoodUids, ['person']);
  assert.equal(summary.taskDoneCount, 0); assert.equal(summary.taskTotalCount, 2); assert.equal(summary.confirmedUids.length, 2);
});
test('progress deltas are idempotent and delayed events follow current data without reading all progress', async () => {
  const e = environment(); await e.note.set(noteData()); await e.backend.rebuildSummary(e.note);
  const progress = e.note.collection('progress').doc('task_person');
  const data = {taskId: 'task', uid: 'person', taskRevision: 1, status: 'done'};
  await progress.set(data); const completed = event(progress, null, data);
  e.metrics.queries = 0; await e.backend.handleProgressWrite(completed); await e.backend.handleProgressWrite(completed);
  assert.equal((await e.index.get()).data().taskDoneCount, 1); assert.equal(e.metrics.queries, 0);
  await progress.set({...data, status: 'pending'}); await e.backend.handleProgressWrite(completed);
  assert.equal((await e.index.get()).data().taskDoneCount, 0);
  const before = (await e.note.get()).data(); await e.note.update({tasks: {task: {...before.tasks.task, revision: 2, text: '新しい練習'}}, updatedAt: stamp()});
  await e.backend.handleNoteWrite(event(e.note, before, (await e.note.get()).data()));
  assert.equal((await e.index.get()).data().taskDoneCount, 0);
});
test('a resolved question keeps both one-time acknowledgements and delayed response events cannot restore it', async () => {
  const e = environment(); await e.note.set(noteData()); await e.backend.rebuildSummary(e.note);
  await e.note.collection('responses').doc('ack').set({uid: 'person', version: 1, status: 'understood'});
  const question = e.note.collection('responses').doc('question'); const data = {uid: 'person', version: 1, status: 'question', resolved: false};
  await question.set(data); const unresolved = event(question, null, data); await e.backend.handleResponseWrite(unresolved);
  assert.deepEqual((await e.index.get()).data().questionUids, ['person']);
  await question.update({resolved: true}); await e.backend.handleResponseWrite(unresolved);
  const index = (await e.index.get()).data(); assert.deepEqual(index.questionUids, []); assert.deepEqual(index.understoodUids, ['person']);
});
test('legacy content edits increment once while preserving updatedAt; stale events cannot overwrite a later version', async () => {
  const e = environment(); await e.note.set(noteData()); const before = (await e.note.get()).data();
  await e.note.update({description: '旧アプリ編集', updatedAt: stamp()}); const edited = (await e.note.get()).data();
  await e.backend.handleNoteWrite(event(e.note, before, edited));
  let current = (await e.note.get()).data(); assert.equal(current.contentVersion, 2); assert.equal(current.updatedAt.toMillis(), edited.updatedAt.toMillis());
  await e.note.update({description: '新しい内容', contentVersion: 3, updatedAt: stamp()}); await e.backend.handleNoteWrite(event(e.note, before, edited));
  current = (await e.note.get()).data(); assert.equal(current.contentVersion, 3); assert.equal(current.description, '新しい内容');
  assert.equal((await e.index.get()).data().contentVersion, 3);
});
test('parent-first deletion retries failed Storage deletion and cleans descendants without losing a saved parent', async () => {
  const e = environment(); await e.note.set(noteData()); await e.backend.rebuildSummary(e.note);
  await e.note.collection('responses').doc('response').set({uid: 'person'});
  const path = `tacticalNoteAttachments/${e.team.id}/note/image.jpg`; e.files.set(path, {}); await e.note.delete();
  e.failOnce(); await assert.rejects(e.backend.cleanupDeletedNote(e.note), /interrupted/);
  assert.equal((await e.note.collection('responses').get()).size, 1);
  await e.backend.cleanupDeletedNote(e.note); assert.equal(e.files.size, 0); assert.equal((await e.index.get()).exists, false);
  assert.equal((await e.note.collection('responses').get()).size, 0);
  await e.note.set(noteData()); await e.note.collection('responses').doc('new').set({uid: 'peer'});
  await e.backend.cleanupDeletedNote(e.note); assert.equal((await e.note.collection('responses').get()).size, 1);
});
test('orphan reclamation claims before deletion, retries interruption, and preserves referenced images', async () => {
  const e = environment(); await e.note.set(noteData());
  const path = `tacticalNoteAttachments/${e.team.id}/note/image.jpg`, registration = e.note.collection('attachmentUploads').doc('image');
  e.files.set(path, {}); await registration.set({storagePath: path, uploaderUid: 'person', createdAt: Timestamp.fromMillis(1)});
  e.failOnce(); await assert.rejects(e.backend.cleanupUpload(registration), /interrupted/);
  assert.ok((await registration.get()).data().cleanupClaimedAt);
  await e.backend.cleanupUpload(registration); assert.equal(e.files.size, 0); assert.equal((await registration.get()).exists, false);
  e.files.set(path, {}); await e.note.update({images: [{id: 'image', storagePath: path}]}); await registration.set({storagePath: path});
  await e.backend.cleanupUpload(registration); assert.equal(e.files.size, 1); assert.equal((await registration.get()).exists, false);
});
test('initial index preparation is authorized, paged, resumable and cheap after completion', async () => {
  const e = environment(); await e.team.collection('members').doc('viewer').set({role: 'member'});
  await e.team.collection('members').doc('guardian').set({role: 'guardian'});
  for (let index = 0; index < 31; index++) await e.team.collection('tacticalNotes').doc(String(index).padStart(2, '0')).set({...noteData(), tasks: {}});
  const request = {auth: {uid: 'viewer'}, data: {teamId: e.team.id}};
  await assert.rejects(e.backend.ensureSummaries({...request, auth: {uid: 'guardian'}}), (error) => error.code === 'permission-denied');
  const first = await e.backend.ensureSummaries(request); assert.equal(first.ready, false); assert.equal(first.processed, 30);
  const next = await e.backend.ensureSummaries(request); assert.equal(next.ready, true); assert.equal(next.processed, 31);
  e.metrics.queries = 0; const completed = await e.backend.ensureSummaries(request); assert.equal(completed.ready, true); assert.equal(e.metrics.queries, 0);
});
test('account anonymization removes parent and child identities, UID IDs and reply references while preserving history', async () => {
  const e = environment(); await e.note.set(noteData());
  await e.note.collection('responses').doc('question_person').set({uid: 'person', version: 1, status: 'question', text: '当時の質問', resolvedBy: 'person'});
  await e.note.collection('replies').doc('reply').set({uid: 'peer', responseId: 'question_person', text: '当時の回答'});
  await e.note.collection('progress').doc('task_person').set({uid: 'person', taskId: 'task', taskRevision: 1, status: 'done', updatedBy: 'person'});
  await e.note.collection('progressHistory').doc('history').set({uid: 'person', taskId: 'task', taskText: '当時の練習', updatedBy: 'person'});
  await e.backend.anonymizeTeam(e.team, 'person');
  const parent = (await e.note.get()).data(); assert.equal(parent.authorUid, 'deleted_user'); assert.equal(parent.authorName, '削除済みユーザー');
  assert.deepEqual(parent.assigneeUids, ['peer']); assert.deepEqual(parent.tasks.task.assigneeUids, ['peer']); assert.equal(parent.tasks.task.revision, 2);
  const responses = await e.note.collection('responses').get(); assert.equal(responses.size, 1); assert.equal(responses.docs[0].data().text, '当時の質問');
  assert.equal((await e.note.collection('replies').doc('reply').get()).data().responseId, responses.docs[0].id);
  for (const name of ['responses', 'replies', 'progress', 'progressHistory', 'summaryTasks']) {
    const data = await e.note.collection(name).get();
    for (const child of data.docs) assert.equal(JSON.stringify({id: child.id, ...child.data()}).includes('person'), false, name);
  }
  await e.backend.anonymizeTeam(e.team, 'person'); assert.equal((await e.note.collection('responses').get()).size, 1);
});


test('detached images are deleted but delayed detach events preserve currently reattached images', async () => {
  const e = environment(), path = `tacticalNoteAttachments/${e.team.id}/note/image.jpg`;
  const before = {...noteData(), images: [{id: 'image', storagePath: path}, {id: 'foreign', storagePath: 'other-team/image.jpg'}]};
  await e.note.set({...noteData(), images: []}); e.files.set(path, {});
  await e.backend.handleNoteWrite(event(e.note, before, (await e.note.get()).data())); assert.deepEqual(e.deleted, [path]);
  e.files.set(path, {}); await e.note.update({images: [{id: 'image', storagePath: path}], updatedAt: stamp()});
  await e.backend.handleNoteWrite(event(e.note, before, {...before, images: []})); assert.equal(e.files.size, 1);
});
test('scheduled cleanup expires only stale drafts and leaves referenced uploads intact', async () => {
  const e = environment(), old = Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000);
  await e.note.set({...noteData(), draft: true, updatedAt: old}); await e.note.collection('responses').doc('draft').set({uid: 'peer'});
  const fresh = e.team.collection('tacticalNotes').doc('fresh'); await fresh.set({...noteData(), draft: true});
  await e.backend.cleanupExpiredUploads();
  assert.equal((await e.note.get()).exists, false); assert.equal((await e.note.collection('responses').get()).size, 0);
  assert.equal((await fresh.get()).exists, true);
});


test('maximum task assignment count still updates progress with a fixed number of document reads', async () => {
  const e = environment(), people = Array.from({length: 500}, (_, index) => 'member' + index);
  const tasks = Object.fromEntries(Array.from({length: 30}, (_, index) => ['task' + index, {text: '練習', assigneeUids: people, revision: 1}]));
  await e.note.set({...noteData(), tasks}); await e.backend.rebuildSummary(e.note);
  const progress = e.note.collection('progress').doc('task0_member0'), data = {taskId: 'task0', uid: 'member0', taskRevision: 1, status: 'done'};
  await progress.set(data); e.metrics.queries = 0; e.metrics.reads = 0;
  await e.backend.handleProgressWrite(event(progress, null, data));
  assert.equal(e.metrics.queries, 0); assert.equal(e.metrics.reads, 4);
  const summary = (await e.index.get()).data(); assert.equal(summary.taskTotalCount, 15000); assert.equal(summary.taskDoneCount, 1);
});


test('related teams are found after leaving, including historical actors and task-only assignments', async () => {
  const e = environment(); await e.note.set({...noteData(), authorUid: 'person', assigneeUids: []});
  const historical = db.collection('teams').doc(), tasksOnly = db.collection('teams').doc();
  await historical.collection('tacticalNotes').doc('other').collection('progressHistory').doc('history').set({uid: 'peer', updatedBy: 'person'});
  await tasksOnly.collection('tacticalNoteSummaries').doc('other').set({mineUids: ['person']});
  const ids = await e.backend.relatedTeamIds('person');
  for (const team of [e.team.id, historical.id, tasksOnly.id]) assert.ok(ids.includes(team));
  assert.equal(new Set(ids).size, ids.length);
});

test('legacy deadline summaries rebuild without resetting completed progress', async () => {
  const e = environment(), data = noteData();
  data.tasks.task.dueDate = '2020-01-01'; data.tasks.task.clipKey = 'removed-scene';
  await e.note.set(data);
  await e.note.collection('progress').doc('task_person').set({taskId: 'task', uid: 'person', taskRevision: 1, status: 'done'});
  await e.backend.rebuildSummary(e.note);
  const original = (await e.index.get()).data();
  await e.index.set({...original, schemaVersion: 1, taskDueCounts: {'2020-01-01': {total: 2, done: 1}}});
  await e.backend.rebuildSummary(e.note);
  const rebuilt = (await e.index.get()).data();
  assert.equal(rebuilt.schemaVersion, 2); assert.equal(rebuilt.taskDoneCount, 1);
  assert.equal('taskDueCounts' in rebuilt, false);
  await e.note.update({tasks: {task: {text: data.tasks.task.text, assigneeUids: data.tasks.task.assigneeUids, revision: 1}}, updatedAt: stamp()});
  await e.backend.rebuildSummary(e.note);
  assert.equal((await e.index.get()).data().taskDoneCount, 1);
});
