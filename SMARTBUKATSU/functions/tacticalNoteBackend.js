const {createHash} = require('node:crypto');
const {TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION, noteConfirmationVersion, timestampMillis, timestampsEqual, contentFingerprint,
  buildTacticalNoteSummary, anonymizeTacticalNote, anonymizeTacticalActivity} = require('./tacticalNoteCore');
const NOTE_READ_ROLES = ['owner', 'admin', 'staff', 'captain', 'member'];
const TASK_COUNT_FIELDS = ['taskAssigneeUids', 'taskCount', 'taskTotalCount', 'taskDoneCount', 'hasTasks', 'unfinished', 'completed'];
const hashTasks = (note) => createHash('sha256').update(JSON.stringify(note.tasks || {})).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const summaryCurrent = (note, summary) => summary?.schemaVersion === TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION && summary.contentVersion === noteConfirmationVersion(note) && timestampsEqual(summary.noteUpdatedAt, note.updatedAt);
const moveUid = (values, uid, include) => include ? [...new Set([...(values || []), uid])] : (values || []).filter((person) => person !== uid);

function createTacticalNoteBackend({firestore, getStorage, FieldValue, Timestamp, FieldPath, HttpsError}) {
  const summaryRef = (noteRef) => noteRef.parent.parent.collection('tacticalNoteSummaries').doc(noteRef.id);
  const taskStateRef = (noteRef, taskId) => noteRef.collection('summaryTasks').doc(taskId);
  const metadataRef = (noteRef) => noteRef.collection('summaryState').doc('metadata');
  const imagesAt = (note) => new Set((note?.images || []).map((image) => image.storagePath));

  async function rebuildSummary(noteRef) {
    return firestore.runTransaction(async (transaction) => {
      const [snapshot, previousIndex, metadata] = await Promise.all([
        transaction.get(noteRef), transaction.get(summaryRef(noteRef)), transaction.get(metadataRef(noteRef)),
      ]);
      if (!snapshot.exists) { if (previousIndex.exists) transaction.delete(summaryRef(noteRef)); return false; }
      const note = snapshot.data(), previous = previousIndex.data(), oldMeta = metadata.data();
      const responses = await transaction.get(noteRef.collection('responses').where('version', '==', noteConfirmationVersion(note)));
      const taskFingerprint = hashTasks(note), reuseTasks = oldMeta?.taskFingerprint === taskFingerprint && previous?.schemaVersion === TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION;
      const progress = [];
      if (!reuseTasks) {
        const taskSnapshots = await Promise.all(Object.entries(note.tasks || {}).map(([taskId, task]) =>
          transaction.get(noteRef.collection('progress').where('taskId', '==', taskId).where('taskRevision', '==', task.revision))));
        taskSnapshots.forEach((items) => progress.push(...items.docs.map((item) => item.data())));
      }
      const next = buildTacticalNoteSummary(note, responses.docs.map((item) => item.data()), progress);
      if (reuseTasks) for (const field of TASK_COUNT_FIELDS) next[field] = previous[field];
      if (!reuseTasks) {
        for (const [taskId, task] of Object.entries(note.tasks || {})) {
          const doneUids = progress.filter((item) => item.taskId === taskId && item.taskRevision === task.revision && item.status === 'done' && task.assigneeUids.includes(item.uid)).map((item) => item.uid);
          transaction.set(taskStateRef(noteRef, taskId), {revision: task.revision, doneUids: [...new Set(doneUids)]});
        }
        for (const removedId of oldMeta?.taskIds || []) if (!note.tasks?.[removedId]) transaction.delete(taskStateRef(noteRef, removedId));
        transaction.set(metadataRef(noteRef), {schemaVersion: TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION, taskFingerprint, taskIds: Object.keys(note.tasks || {})});
      }
      if (!same(previous, next)) transaction.set(summaryRef(noteRef), next);
      return true;
    });
  }

  async function cleanupDeletedNote(noteRef) {
    if ((await noteRef.get()).exists) return;
    // The parent is already gone. Server permissions allow retries after a partial cleanup.
    const prefix = `tacticalNoteAttachments/${noteRef.parent.parent.id}/${noteRef.id}/`;
    const [files] = await getStorage().bucket().getFiles({prefix});
    await Promise.all(files.map((file) => file.delete({ignoreNotFound: true})));
    if ((await noteRef.get()).exists) return;
    // Delete collections, rather than the parent, so a recreated parent is never erased.
    const children = await noteRef.listCollections();
    for (const collection of children) await firestore.recursiveDelete(collection);
    await summaryRef(noteRef).delete();
  }

  async function handleNoteWrite(event) {
    const before = event.data?.before.data(), after = event.data?.after.data(), ref = event.data.after.ref;
    if (!after) { await cleanupDeletedNote(ref); return; }
    if (before && contentFingerprint(before) !== contentFingerprint(after) && noteConfirmationVersion(before) === noteConfirmationVersion(after)) {
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        if (current.exists && timestampsEqual(current.data().updatedAt, after.updatedAt) && noteConfirmationVersion(current.data()) === noteConfirmationVersion(after)) {
          transaction.update(ref, {contentVersion: noteConfirmationVersion(after) + 1});
        }
      });
    }
    await rebuildSummary(ref);
    const current = await ref.get();
    if (!current.exists) { await cleanupDeletedNote(ref); return; }
    const retained = imagesAt(current.data()), prefix = `tacticalNoteAttachments/${event.params.teamId}/${event.params.noteId}/`;
    const removed = (before?.images || []).filter((image) => image.storagePath?.startsWith(prefix) && !retained.has(image.storagePath));
    await Promise.all(removed.map((image) => getStorage().bucket().file(image.storagePath).delete({ignoreNotFound: true})));
    // The daily sweep clears referenced registrations once, avoiding deletes on every edit.
  }

  async function handleResponseWrite(event) {
    const ref = event.data.after.ref.parent.parent;
    const uids = [...new Set([event.data.before.data()?.uid, event.data.after.data()?.uid].filter(Boolean))];
    await rebuildIfNeeded(ref);
    for (const uid of uids) await firestore.runTransaction(async (transaction) => {
      const [parent, index] = await Promise.all([transaction.get(ref), transaction.get(summaryRef(ref))]);
      if (!parent.exists || !summaryCurrent(parent.data(), index.data())) return;
      const note = parent.data(), current = index.data();
      if (!(note.assigneeUids || []).includes(uid)) return;
      const own = await transaction.get(ref.collection('responses').where('uid', '==', uid).where('version', '==', noteConfirmationVersion(note)));
      const responses = own.docs.map((item) => item.data());
      const next = {...current,
        pendingUids: moveUid(current.pendingUids, uid, responses.length === 0),
        confirmedUids: moveUid(current.confirmedUids, uid, responses.length > 0),
        questionUids: moveUid(current.questionUids, uid, responses.some((item) => item.status === 'question' && item.resolved !== true)),
        readUids: moveUid(current.readUids, uid, responses.some((item) => item.status === 'read')),
        understoodUids: moveUid(current.understoodUids, uid, responses.some((item) => item.status === 'understood'))};
      if (!same(current, next)) transaction.set(summaryRef(ref), next);
    });
  }

  async function rebuildIfNeeded(ref) {
    const [parent, index] = await Promise.all([ref.get(), summaryRef(ref).get()]);
    if (parent.exists && !summaryCurrent(parent.data(), index.data())) await rebuildSummary(ref);
  }

  async function handleProgressWrite(event) {
    const progressRef = event.data.after.ref, ref = progressRef.parent.parent;
    const data = event.data.after.data() || event.data.before.data();
    if (!data?.taskId || !data.uid) return;
    await rebuildIfNeeded(ref);
    await firestore.runTransaction(async (transaction) => {
      const [parent, index, currentProgress, accounted] = await Promise.all([
        transaction.get(ref), transaction.get(summaryRef(ref)), transaction.get(progressRef), transaction.get(taskStateRef(ref, data.taskId)),
      ]);
      if (!parent.exists || !summaryCurrent(parent.data(), index.data())) return;
      const task = parent.data().tasks?.[data.taskId], state = accounted.data(), summary = index.data();
      if (!task || !task.assigneeUids.includes(data.uid) || state?.revision !== task.revision) return;
      const record = currentProgress.data(), done = record?.taskRevision === task.revision && record.status === 'done';
      const wasDone = (state.doneUids || []).includes(data.uid);
      if (done === wasDone) return;
      const delta = done ? 1 : -1, doneCount = summary.taskDoneCount + delta;
      transaction.set(taskStateRef(ref, data.taskId), {...state, doneUids: moveUid(state.doneUids, data.uid, done)});
      transaction.update(summaryRef(ref), {taskDoneCount: doneCount, unfinished: doneCount < summary.taskTotalCount, completed: summary.taskTotalCount > 0 && doneCount === summary.taskTotalCount});
    });
  }

  async function ensureSummaries(request) {
    const uid = request.auth?.uid, teamId = request.data?.teamId;
    if (!uid) throw new HttpsError('unauthenticated', 'ログインが必要です。');
    if (typeof teamId !== 'string' || !teamId || teamId.includes('/')) throw new HttpsError('invalid-argument', 'チームを確認してください。');
    const team = firestore.collection('teams').doc(teamId);
    const member = await team.collection('members').doc(uid).get();
    if (!member.exists || !NOTE_READ_ROLES.includes(member.data().role)) throw new HttpsError('permission-denied', '閲覧権限がありません。');
    const marker = team.collection('system').doc('tacticalNoteSummaries');
    const token = firestore.collection('unusedIds').doc().id;
    const acquired = await firestore.runTransaction(async (transaction) => {
      const state = (await transaction.get(marker)).data() || {};
      if (state.schemaVersion === TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION && state.complete) return {ready: true, processed: state.processed || 0};
      if (timestampMillis(state.leaseUntil) > Date.now()) return {ready: false, busy: true, retryAfterMs: 1500, processed: state.processed || 0};
      const current = state.schemaVersion === TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION ? state : {};
      transaction.set(marker, {...current, schemaVersion: TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION, complete: false,
        leaseToken: token, leaseUntil: Timestamp.fromMillis(Date.now() + 360000), updatedAt: FieldValue.serverTimestamp()});
      return {lastNoteId: current.lastNoteId || null, processed: current.processed || 0};
    });
    if ('ready' in acquired) return acquired;
    try {
      let query = team.collection('tacticalNotes').orderBy(FieldPath.documentId()).limit(30);
      if (acquired.lastNoteId) query = query.startAfter(acquired.lastNoteId);
      const page = await query.get();
      for (const note of page.docs) await rebuildSummary(note.ref);
      return await firestore.runTransaction(async (transaction) => {
        const current = (await transaction.get(marker)).data();
        if (current?.leaseToken !== token) return {ready: false, busy: true, retryAfterMs: 1500, processed: current?.processed || 0};
        const processed = acquired.processed + page.size, ready = page.size < 30;
        transaction.set(marker, {schemaVersion: TACTICAL_NOTE_SUMMARY_SCHEMA_VERSION, complete: ready, processed,
          lastNoteId: page.docs.at(-1)?.id || acquired.lastNoteId, leaseUntil: null, leaseToken: null, updatedAt: FieldValue.serverTimestamp()});
        return {ready, processed};
      });
    } catch (error) {
      await firestore.runTransaction(async (transaction) => {
        const current = (await transaction.get(marker)).data();
        if (current?.leaseToken === token) transaction.update(marker, {leaseUntil: null, leaseToken: null});
      });
      throw error;
    }
  }

  async function cleanupUpload(registrationRef) {
    const noteRef = registrationRef.parent.parent;
    const claimed = await firestore.runTransaction(async (transaction) => {
      const [registration, parent] = await Promise.all([transaction.get(registrationRef), transaction.get(noteRef)]);
      if (!registration.exists) return null;
      const upload = registration.data(), prefix = `tacticalNoteAttachments/${noteRef.parent.parent.id}/${noteRef.id}/`;
      if (!upload.storagePath?.startsWith(prefix)) { transaction.delete(registrationRef); return null; }
      if (imagesAt(parent.data()).has(upload.storagePath)) { transaction.delete(registrationRef); return null; }
      transaction.update(registrationRef, {cleanupClaimedAt: FieldValue.serverTimestamp()});
      return upload.storagePath;
    });
    if (!claimed) return;
    await getStorage().bucket().file(claimed).delete({ignoreNotFound: true});
    await registrationRef.delete();
  }

  async function cleanupExpiredUploads() {
    const cutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
    // Bound one scheduled run; remaining work is picked up the following day.
    for (let page = 0; page < 10; page++) {
      const uploads = await firestore.collectionGroup('attachmentUploads').where('createdAt', '<=', cutoff).orderBy('createdAt').limit(200).get();
      for (const registration of uploads.docs) await cleanupUpload(registration.ref);
      if (uploads.size < 200) break;
    }
    const drafts = await firestore.collectionGroup('tacticalNotes').where('draft', '==', true).where('updatedAt', '<=', cutoff).orderBy('updatedAt').limit(100).get();
    for (const draft of drafts.docs) {
      await firestore.runTransaction(async (transaction) => {
        const current = await transaction.get(draft.ref);
        if (current.exists && current.data().draft === true && timestampMillis(current.data().updatedAt) <= timestampMillis(cutoff)) transaction.delete(draft.ref);
      });
      await cleanupDeletedNote(draft.ref);
    }
  }

  async function relatedTeamIds(uid) {
    const queries = [['tacticalNotes', 'authorUid', '=='], ['tacticalNotes', 'assigneeUids', 'array-contains'],
      ['tacticalNoteSummaries', 'mineUids', 'array-contains'], ['responses', 'uid', '=='], ['responses', 'resolvedBy', '=='],
      ['replies', 'uid', '=='], ['progress', 'uid', '=='], ['progress', 'updatedBy', '=='],
      ['progressHistory', 'uid', '=='], ['progressHistory', 'updatedBy', '=='], ['attachmentUploads', 'uploaderUid', '==']];
    const teams = new Set();
    for (const [collection, field, operator] of queries) {
      let cursor = null;
      do {
        let query = firestore.collectionGroup(collection).where(field, operator, uid).orderBy(FieldPath.documentId()).limit(100);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        for (const snapshot of page.docs) {
          const parts = snapshot.ref.path.split('/');
          if (parts[0] === 'teams' && (parts[2] === 'tacticalNotes' || parts[2] === 'tacticalNoteSummaries')) teams.add(parts[1]);
        }
        cursor = page.size === 100 ? page.docs.at(-1) : null;
      } while (cursor);
    }
    return [...teams];
  }

  async function anonymizeTeam(teamRef, uid) {
    let cursor = null, changedCount = 0;
    do {
      let query = teamRef.collection('tacticalNotes').orderBy(FieldPath.documentId()).limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const snapshot of page.docs) {
        const ref = snapshot.ref;
        changedCount += await firestore.runTransaction(async (transaction) => {
          const current = await transaction.get(ref);
          if (!current.exists) return 0;
          const patch = anonymizeTacticalNote(current.data(), uid);
          if (!Object.keys(patch).length) return 0;
          transaction.update(ref, {...patch, updatedAt: FieldValue.serverTimestamp()});
          return 1;
        });
        const collections = {responses: ['uid', 'resolvedBy'], replies: ['uid'], progress: ['uid', 'updatedBy'], progressHistory: ['uid', 'updatedBy'], attachmentUploads: ['uploaderUid']};
        for (const [name, fields] of Object.entries(collections)) {
          const matches = new Map();
          for (const field of fields) {
            const result = await ref.collection(name).where(field, '==', uid).get();
            result.docs.forEach((child) => matches.set(child.id, child));
          }
          for (const child of matches.values()) {
            if (name === 'attachmentUploads') {
              const parent = await ref.get();
              if (!imagesAt(parent.data()).has(child.data().storagePath)) { await cleanupUpload(child.ref); changedCount++; continue; }
            }
            const moveId = child.id.includes(uid);
            const anonymousId = 'deleted_' + createHash('sha256').update(child.ref.path).digest('hex').slice(0, 32);
            const target = moveId ? ref.collection(name).doc(anonymousId) : child.ref;
            await firestore.runTransaction(async (transaction) => {
              const current = await transaction.get(child.ref);
              if (!current.exists) return;
              transaction.set(target, anonymizeTacticalActivity(current.data(), uid));
              if (moveId) transaction.delete(child.ref);
            });
            if (moveId && name === 'responses') {
              const references = await ref.collection('replies').where('responseId', '==', child.id).get();
              for (const reply of references.docs) await reply.ref.update({responseId: anonymousId});
            }
            changedCount++;
          }
        }
        // Also repair references after an interrupted earlier response-ID move.
        let replyCursor = null;
        do {
          let replies = ref.collection('replies').orderBy(FieldPath.documentId()).limit(100);
          if (replyCursor) replies = replies.startAfter(replyCursor);
          const pageOfReplies = await replies.get();
          for (const reply of pageOfReplies.docs) {
            if (!reply.data().responseId?.includes(uid)) continue;
            const anonymousId = 'deleted_' + createHash('sha256').update(ref.collection('responses').doc(reply.data().responseId).path).digest('hex').slice(0, 32);
            await reply.ref.update({responseId: anonymousId});
          }
          replyCursor = pageOfReplies.size === 100 ? pageOfReplies.docs.at(-1).id : null;
        } while (replyCursor);
        await rebuildSummary(ref);
      }
      cursor = page.size === 100 ? page.docs.at(-1).id : null;
    } while (cursor);
    return changedCount;
  }
  return {rebuildSummary, handleNoteWrite, handleResponseWrite, handleProgressWrite, ensureSummaries,
    cleanupDeletedNote, cleanupUpload, cleanupExpiredUploads, anonymizeTeam, relatedTeamIds};
}
module.exports = {createTacticalNoteBackend, summaryCurrent};
