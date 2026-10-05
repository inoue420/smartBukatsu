const { ROOTS, attachmentLocation, expiryRecord, calendarPaths } = require("./attachmentExpiryCore");

// One bounded page per call. Checkpoints advance only after the whole page succeeds.
async function backfillAttachmentExpiryPage({ firestore, bucket, backend, FieldPath, state = {}, apply = false, pageSize = 200 }) {
  const phase = state.phase || ROOTS[0];
  const totals = { scanned: 0, eligible: 0, registered: 0, invalid: 0, missing: 0 };
  if (phase === "complete") return { state, totals };
  if (ROOTS.includes(phase)) {
    const [files, nextQuery] = await bucket.getFiles({ prefix: phase + "/", autoPaginate: false,
      maxResults: pageSize, ...(state.pageToken ? { pageToken: state.pageToken } : {}) });
    for (const file of files) {
      totals.scanned++;
      let metadata = file.metadata;
      if (!metadata?.generation || !metadata?.timeCreated) {
        try { [metadata] = await file.getMetadata(); }
        catch (error) { if (Number(error?.code) !== 404) throw error; totals.missing++; continue; }
      }
      metadata = { ...metadata, bucket: bucket.name, name: file.name };
      if (!expiryRecord(metadata)) { totals.invalid++; continue; }
      totals.eligible++;
      if (apply) {
        if (!await backend.registerObject(metadata)) throw new Error("Expiry registration rejected during backfill");
        totals.registered++;
      }
    }
    const next = nextQuery?.pageToken
      ? { phase, pageToken: nextQuery.pageToken }
      : { phase: phase === ROOTS[0] ? ROOTS[1] : "calendarReferences" };
    return { state: next, totals };
  }
  if (phase !== "calendarReferences") throw new Error("Invalid migration phase");
  let query = firestore.collectionGroup("clubEvents").orderBy(FieldPath.documentId()).limit(pageSize);
  if (state.lastDocumentPath) query = query.startAfter(firestore.doc(state.lastDocumentPath));
  const page = await query.get();
  for (const document of page.docs) {
    totals.scanned++;
    for (const storagePath of calendarPaths(document.data())) {
      const location = attachmentLocation(storagePath);
      // The usual reference is already known from the object path; only split events need repair.
      if (!location || location.type !== "calendarAttachments" || location.documentPath === document.ref.path
        || document.ref.path.split("/")[1] !== location.teamId) continue;
      totals.eligible++;
      if (apply) {
        try {
          if (!await backend.trackCalendarReference(document.ref, storagePath)) throw new Error("Calendar registration rejected during backfill");
          totals.registered++;
        } catch (error) { if (Number(error?.code) !== 404) throw error; totals.missing++; }
      }
    }
  }
  return { state: page.size === pageSize ? { phase, lastDocumentPath: page.docs.at(-1).ref.path } : { phase: "complete" }, totals };
}

module.exports = { backfillAttachmentExpiryPage };
