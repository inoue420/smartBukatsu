const { EXPIRY_COLLECTION, attachmentLocation, expiryRecord, expiryId, calendarPaths,
  removeAttachment, validDocumentPath } = require("./attachmentExpiryCore");

function createAttachmentExpiryBackend({ firestore, getStorage, FieldValue, now = Date.now, logger = { info() {}, warn() {} } }) {
  const queue = firestore.collection(EXPIRY_COLLECTION);
  const defaultBucket = () => getStorage().bucket();
  const missing = (error) => Number(error?.code) === 404;

  async function registerObject(metadata, documentPath = null) {
    const record = expiryRecord(metadata);
    if (!record || record.bucket !== defaultBucket().name) return false;
    if (documentPath && !validDocumentPath(record, documentPath)) return false;
    const ref = queue.doc(expiryId(record));
    return firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists) {
        if (documentPath && !record.documentPaths.includes(documentPath)) record.documentPaths.push(documentPath);
        transaction.set(ref, record);
      } else if (documentPath && !(current.data().documentPaths || []).includes(documentPath)) {
        transaction.update(ref, { documentPaths: FieldValue.arrayUnion(documentPath) });
      }
      return true;
    });
  }

  async function handleFinalize(event) {
    if (!attachmentLocation(event.data?.name)) return;
    if (!await registerObject(event.data)) logger.warn("Attachment expiry registration skipped: invalid metadata.");
  }

  async function removeReference(documentRef, type, storagePath) {
    return firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(documentRef);
      if (!current.exists) return false;
      const patch = removeAttachment(current.data(), type, storagePath);
      if (!patch) return false;
      transaction.update(documentRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
      return true;
    });
  }

  async function trackCalendarReference(documentRef, storagePath) {
    const location = attachmentLocation(storagePath);
    if (!location || location.type !== "calendarAttachments" || !validDocumentPath(location, documentRef.path)) return false;
    const [metadata] = await defaultBucket().file(storagePath).getMetadata();
    return registerObject(metadata, documentRef.path);
  }

  async function handleCalendarWrite(event) {
    const after = event.data?.after;
    if (!after?.exists) return;
    const previous = new Set(calendarPaths(event.data.before?.data()));
    // Splitting a multi-day event transfers references without moving the Storage object.
    // Normal saves need no extra reads; record only newly transferred references.
    for (const storagePath of calendarPaths(after.data()).filter((value) => !previous.has(value))) {
      const location = attachmentLocation(storagePath);
      if (!location || location.documentPath === after.ref.path || !validDocumentPath(location, after.ref.path)) continue;
      try { await trackCalendarReference(after.ref, storagePath); }
      catch (error) {
        if (!missing(error)) throw error;
        await removeReference(after.ref, "calendarAttachments", storagePath);
      }
    }
  }

  async function complete(ref, record) {
    // Read targets and delete registration together; concurrent transfers trigger a retry.
    return firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (!current.exists) return 0;
      const paths = [...new Set(current.data().documentPaths || [])].filter((value) => validDocumentPath(record, value));
      const snapshots = await Promise.all(paths.map((value) => transaction.get(firestore.doc(value))));
      let updated = 0;
      for (const snapshot of snapshots) {
        if (!snapshot.exists) continue;
        const patch = removeAttachment(snapshot.data(), record.type, record.storagePath, record);
        if (patch) { transaction.update(snapshot.ref, { ...patch, updatedAt: FieldValue.serverTimestamp() }); updated++; }
      }
      transaction.delete(ref);
      return updated;
    });
  }

  async function processExpiry(ref, cutoff) {
    const snapshot = await ref.get();
    if (!snapshot.exists) return { skipped: 1 };
    const record = snapshot.data(), location = attachmentLocation(record.storagePath);
    if (!location || location.teamId !== record.teamId || location.type !== record.type
      || record.bucket !== defaultBucket().name || !/^[1-9]\d*$/.test(record.generation)
      || !Number.isFinite(record.expiresAt)) throw new Error("Invalid server expiry registration");
    if (record.nextAttemptAt > cutoff || record.expiresAt > cutoff) return { skipped: 1 };
    let metadata;
    try { [metadata] = await defaultBucket().file(record.storagePath).getMetadata(); }
    catch (error) { if (!missing(error)) throw error; }
    if (metadata) {
      if (String(metadata.generation) !== record.generation) {
        await ref.delete();
        return { replaced: 1 };
      }
      const current = expiryRecord(metadata);
      if (!current) throw new Error("Invalid attachment expiry metadata");
      if (current.expiresAt > cutoff) {
        await ref.update({ expiresAt: current.expiresAt, nextAttemptAt: current.expiresAt });
        return { postponed: 1 };
      }
      // Preconditions apply to the live object: replacement or metadata changes fail with 412.
      await defaultBucket().file(record.storagePath, { preconditionOpts: {
        ifGenerationMatch: record.generation, ifMetagenerationMatch: String(metadata.metageneration),
      } }).delete({ ignoreNotFound: true });
    }
    // A missing object on retry is expected; retain registration until reference cleanup succeeds.
    return { completed: 1, updatedDocuments: await complete(ref, record) };
  }

  async function cleanupExpired({ batchSize = 100, maxBatches = 10, concurrency = 5, maxDurationMs = 450000 } = {}) {
    const cutoff = now(), deadline = cutoff + maxDurationMs;
    const totals = { examined: 0, completed: 0, updatedDocuments: 0, failed: 0, replaced: 0, postponed: 0, skipped: 0 };
    for (let page = 0; page < maxBatches && now() < deadline; page++) {
      const due = await queue.where("nextAttemptAt", "<=", cutoff).orderBy("nextAttemptAt").limit(batchSize).get();
      let index = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (index < due.size && now() < deadline) {
          const ref = due.docs[index++].ref;
          totals.examined++;
          try {
            const result = await processExpiry(ref, cutoff);
            for (const [key, value] of Object.entries(result)) totals[key] += value;
          } catch (error) {
            await firestore.runTransaction(async (transaction) => {
              const current = await transaction.get(ref);
              if (current.exists) transaction.update(ref, { nextAttemptAt: cutoff + 3600000,
                attempts: FieldValue.increment(1), lastErrorCode: String(error?.code || "unknown").slice(0, 32) });
            });
            totals.failed++;
          }
        }
      }));
      if (due.size < batchSize) break;
    }
    logger.info("Attachment expiry cleanup finished.", totals);
    if (totals.failed) throw new Error("Attachment expiry cleanup has " + totals.failed + " pending failures");
    return totals;
  }

  return { registerObject, handleFinalize, handleCalendarWrite, trackCalendarReference, processExpiry, cleanupExpired };
}
module.exports = { createAttachmentExpiryBackend };
