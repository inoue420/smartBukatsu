const { SCHEMA_VERSION, lastEventDate, contributions, adjustSummary, audienceFor } = require("./loadingOptimizationCore");

function createLoadingOptimizationBackend({ firestore, FieldValue, FieldPath, HttpsError }) {
  const teamRef = (id) => firestore.collection("teams").doc(id);
  const stateRef = (id) => teamRef(id).collection("loadingOptimization").doc("state");
  async function context(teamId) {
    const revision = (await stateRef(teamId).get()).data()?.preparationId || null;
    const [team, snapshot] = await Promise.all([teamRef(teamId).get(), teamRef(teamId).collection("members").get()]);
    if (!team.exists) return null;
    const userDocs = snapshot.size ? await firestore.getAll(...snapshot.docs.map((item) => firestore.collection("users").doc(item.id))) : [];
    const usedNames = new Set();
    const members = snapshot.docs.map((item, index) => {
      const data = item.data(), user = userDocs[index]?.data() || {}, name = data.name || user.name || "名称未設定";
      const profileKey = usedNames.has(name) ? `${name}_${item.id.substring(0, 4)}` : name;
      usedNames.add(profileKey);
      return { ...data, uid: item.id, name, profileKey, blockedUserUids: user.blockedUserUids || [] };
    });
    return { members, channels: team.data().channels || [], preparationId: revision };
  }
  async function refreshLatest(teamId, member, expectedRevision) {
    if (!member) return;
    const reports = teamRef(teamId).collection("dailyReports"), target = teamRef(teamId).collection("latestDailyReports").doc(member.uid);
    await firestore.runTransaction(async (transaction) => {
      const revision = (await transaction.get(stateRef(teamId))).data()?.preparationId || null;
      if (expectedRevision !== undefined && revision !== expectedRevision) return;
      await transaction.get(target);
      const identity = await transaction.get(teamRef(teamId).collection("members").doc(member.uid));
      const user = await transaction.get(firestore.collection("users").doc(member.uid));
      if (!identity.exists || !user.exists) { transaction.delete(target); return; }
      const candidates = [];
      for (const [field, value] of [["authorUid", member.uid], ["author", member.profileKey]]) {
        let cursor = null;
        for (;;) {
          let q = reports.where(field, "==", value).orderBy("createdAt", "desc").limit(20);
          if (cursor) q = q.startAfter(cursor);
          const page = await transaction.get(q);
          const candidate = page.docs.find((item) => item.data().status !== "deleted" && (!item.data().authorUid || item.data().authorUid === member.uid));
          if (candidate) { candidates.push(candidate); break; }
          if (page.size < 20) break;
          cursor = page.docs.at(-1);
        }
      }
      candidates.sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
      if (candidates.length) transaction.set(target, { ...candidates[0].data(), id: candidates[0].id, author: member.profileKey, authorUid: member.uid });
      else transaction.delete(target);
    });
  }
  async function process(teamId, kind, id, suppliedContext, skipLatest = false, attempt = 0) {
    const ctx = suppliedContext || await context(teamId);
    if (!ctx) return;
    const source = teamRef(teamId).collection(kind).doc(id), entry = teamRef(teamId).collection("loadingEntries").doc(`${kind}_${id}`);
    const reads = teamRef(teamId).collection("workspacePostReadStates").doc(id);
    let authors = [], changedContext = false;
    await firestore.runTransaction(async (transaction) => {
      changedContext = false;
      const revision = (await transaction.get(stateRef(teamId))).data()?.preparationId || null;
      if (revision !== ctx.preparationId) { changedContext = true; return; }
      const sourceSnapshot = await transaction.get(source), oldEntry = (await transaction.get(entry)).data() || {};
      const readState = kind === "workspacePosts" ? (await transaction.get(reads)).data() || {} : {};
      const data = sourceSnapshot.data() || null;
      const authorUids = ctx.members.filter((member) => data?.authorUid ? member.uid === data.authorUid : data?.author === member.profileKey).map((member) => member.uid);
      authors = ctx.members.filter((member) => [...authorUids, ...(oldEntry.authorUids || [])].includes(member.uid));
      const next = contributions(kind, data, ctx.members, readState), previous = oldEntry.contributions || {};
      const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter((uid) => JSON.stringify(previous[uid] || {}) !== JSON.stringify(next[uid] || {}));
      const summaries = await Promise.all(changed.map((uid) => transaction.get(teamRef(teamId).collection("loadingSummaries").doc(uid))));
      const identities = await Promise.all(changed.map(async (uid) => {
        if (!ctx.members.some((member) => member.uid === uid)) return false;
        const [member, user] = await Promise.all([transaction.get(teamRef(teamId).collection("members").doc(uid)), transaction.get(firestore.collection("users").doc(uid))]);
        return member.exists && user.exists;
      }));
      changed.forEach((uid, index) => {
        if (!identities[index]) { delete next[uid]; transaction.delete(summaries[index].ref); }
        else transaction.set(summaries[index].ref, { ...adjustSummary(summaries[index].data(), previous[uid], next[uid]), updatedAt: FieldValue.serverTimestamp() });
      });
      if (JSON.stringify(previous) !== JSON.stringify(next) || JSON.stringify(oldEntry.authorUids || []) !== JSON.stringify(authorUids)) {
        transaction.set(entry, { contributions: next, authorUids });
      }
    });
    if (changedContext) {
      if (suppliedContext) return;
      if (attempt >= 2) throw new HttpsError("aborted", "チーム設定の更新後に再試行します。");
      return process(teamId, kind, id, null, skipLatest, attempt + 1);
    }
    if (kind === "dailyReports" && !skipLatest) await Promise.all(authors.map((member) => refreshLatest(teamId, member, ctx.preparationId)));
  }
  async function prepare(teamId, options = {}) {
    const ctx = await context(teamId);
    if (!ctx) throw new HttpsError("not-found", "チームがありません。");
    await stateRef(teamId).set({ ready: false, enabled: false, separateReads: false, schemaVersion: SCHEMA_VERSION,
      status: "preparing", stage: 0, cursor: null, personalIndex: 0, processed: 0,
      desiredEnabled: options.enabled === true, desiredSeparateReads: options.separateReads === true,
      preparationId: `${Date.now()}_${Math.random().toString(36).slice(2)}`, lease: null }, { merge: true });
    return { ready: false, status: "preparing" };
  }
  async function handlePreparation(event) {
    if (!event.data?.after.exists || event.data.after.data().status !== "preparing") return;
    const teamId = event.params.teamId, ref = stateRef(teamId), token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const state = await firestore.runTransaction(async (transaction) => {
      const current = (await transaction.get(ref)).data();
      if (current?.status !== "preparing" || (current.lease?.expiresAt || 0) > Date.now()) return null;
      transaction.update(ref, { lease: { token, expiresAt: Date.now() + 240000 } });
      return current;
    });
    if (!state) return;
    try {
      const ctx = await context(teamId);
      if (!ctx) return;
      const stages = ["audiences", "clubEvents", "personalEvents", "notices", "dailyReports", "workspacePosts", "latest", "cleanup"];
      const stage = stages[state.stage || 0];
      const next = { stage: state.stage || 0, cursor: null, personalIndex: state.personalIndex || 0, processed: state.processed || 0, lease: null };
      if (stage === "latest") {
        await Promise.all(ctx.members.map((member) => refreshLatest(teamId, member, ctx.preparationId))); next.stage += 1;
      } else if (stage === "cleanup") {
        const valid = new Set(ctx.members.map((member) => member.uid));
        for (const name of ["loadingSummaries", "latestDailyReports"]) {
          const snapshot = await teamRef(teamId).collection(name).get();
          for (const item of snapshot.docs.filter((record) => !valid.has(record.id))) {
            await firestore.runTransaction(async (transaction) => {
              const member = await transaction.get(teamRef(teamId).collection("members").doc(item.id));
              if (!member.exists) transaction.delete(item.ref);
            });
          }
        }
        Object.assign(next, { ready: true, status: "ready", enabled: state.desiredEnabled === true, separateReads: state.desiredSeparateReads === true, preparedAt: FieldValue.serverTimestamp() });
      } else {
        const personal = stage === "personalEvents", member = ctx.members[next.personalIndex];
        if (personal && !member) next.stage += 1;
        else {
          const source = personal ? firestore.collection("users").doc(member.uid).collection(stage) : teamRef(teamId).collection(stage === "audiences" ? "workspacePosts" : stage);
          let q = source.orderBy(FieldPath.documentId()).limit(50);
          if (state.cursor) q = q.startAfter(state.cursor);
          const page = await q.get();
          for (const item of page.docs) {
            if (stage === "audiences") {
              await firestore.runTransaction(async (transaction) => {
                if ((await transaction.get(ref)).data()?.preparationId !== state.preparationId) return;
                const current = await transaction.get(item.ref), data = current.data();
                if (!data || data.status === "deleted" || data.moderationStatus === "hidden") return;
                const audience = audienceFor(data, ctx.channels, ctx.members);
                if (audience && JSON.stringify([data.shareScope, [...(data.visibleToUids || [])].sort(), [...(data.readTargetUids || [])].sort()]) !== JSON.stringify([audience.shareScope, audience.visibleToUids, audience.readTargetUids])) transaction.update(item.ref, { ...audience, updatedAt: FieldValue.serverTimestamp() });
              });
            } else if (stage === "clubEvents" || personal) {
              await handleEventDate({ data: { after: { exists: true, ref: item.ref } } });
            } else await process(teamId, stage, item.id, ctx, true);
          }
          next.processed += page.size;
          if (page.size === 50) next.cursor = page.docs.at(-1).id;
          else if (personal) next.personalIndex += 1;
          else next.stage += 1;
        }
      }
      await firestore.runTransaction(async (transaction) => {
        const current = (await transaction.get(ref)).data();
        if (current?.preparationId === state.preparationId && current.lease?.token === token) transaction.update(ref, next);
      });
    } catch (error) {
      await firestore.runTransaction(async (transaction) => {
        const current = (await transaction.get(ref)).data();
        if (current?.lease?.token === token) transaction.update(ref, { lease: null });
      });
      throw error;
    }
  }
  async function authorize(request) {
    const uid = request.auth?.uid, teamId = request.data?.teamId;
    if (!uid) throw new HttpsError("unauthenticated", "ログインしてください。");
    if (typeof teamId !== "string" || !teamId || teamId.includes("/")) throw new HttpsError("invalid-argument", "チームIDを確認してください。");
    const member = (await teamRef(teamId).collection("members").doc(uid).get()).data();
    if (!member || !["owner", "admin"].includes(member.role)) throw new HttpsError("permission-denied", "管理者の承認が必要です。");
    return teamId;
  }
  async function prepareCallable(request) {
    const teamId = await authorize(request), state = (await stateRef(teamId).get()).data();
    if (state?.ready && state.schemaVersion === SCHEMA_VERSION) return { ready: true };
    if (state?.status === "preparing") {
      if ((state.lease?.expiresAt || 0) < Date.now()) await stateRef(teamId).update({ lease: null, resumeAt: FieldValue.serverTimestamp() });
      return { ready: false, status: "preparing" };
    }
    return prepare(teamId);
  }
  async function configureCallable(request) {
    const teamId = await authorize(request), state = (await stateRef(teamId).get()).data();
    if (request.data.enabled === true && (!state?.ready || state.schemaVersion !== SCHEMA_VERSION)) throw new HttpsError("failed-precondition", "既存データの準備を先に完了してください。");
    // These switches require an explicit administrative action; the app never invokes them.
    await stateRef(teamId).set({ enabled: request.data.enabled === true, separateReads: request.data.separateReads === true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { enabled: request.data.enabled === true, separateReads: request.data.separateReads === true };
  }
  async function handleContent(kind, event) {
    const { teamId } = event.params, id = event.params.documentId;
    await process(teamId, kind, id);
  }
  async function handleReadState(event) {
    const { teamId, postId } = event.params;
    const before = event.data?.before.data() || {}, after = event.data?.after.data() || {};
    // Reader-only writes do not change notification badges or require a team-wide recalculation.
    if (!event.data || JSON.stringify([before.notificationReads, before.notificationDismissals]) !== JSON.stringify([after.notificationReads, after.notificationDismissals])) await process(teamId, "workspacePosts", postId);
    const reads = (await teamRef(teamId).collection("workspacePostReadStates").doc(postId).get()).data() || {};
    for (const uid of new Set([...Object.keys(reads.readers || {}), ...Object.keys(reads.notificationReads || {}), ...Object.keys(reads.notificationDismissals || {})])) {
      if (event.data && JSON.stringify([before.readers?.[uid], before.notificationReads?.[uid], before.notificationDismissals?.[uid]]) === JSON.stringify([after.readers?.[uid], after.notificationReads?.[uid], after.notificationDismissals?.[uid]])) continue;
      const user = firestore.collection("users").doc(uid), anchor = user.collection("loadingReadTeams").doc(teamId);
      await firestore.runTransaction(async (transaction) => {
        const [identity, existing] = await Promise.all([transaction.get(user), transaction.get(anchor)]);
        if (identity.exists && !existing.exists) transaction.set(anchor, { teamId });
      });
    }
  }
  async function relatedTeamIds(uid) {
    return (await firestore.collection("users").doc(uid).collection("loadingReadTeams").get()).docs.map((item) => item.id);
  }
  async function anonymizeTeam(team, uid) {
    const collection = team.collection("workspacePostReadStates"), records = new Map();
    for (const field of ["readers", "notificationReads", "notificationDismissals"]) {
      const snapshot = await collection.where(new FieldPath(field, uid), "!=", null).get();
      snapshot.docs.forEach((item) => records.set(item.id, item));
    }
    const writer = firestore.bulkWriter();
    records.forEach((item) => writer.update(item.ref,
      new FieldPath("readers", uid), FieldValue.delete(),
      new FieldPath("notificationReads", uid), FieldValue.delete(),
      new FieldPath("notificationDismissals", uid), FieldValue.delete()));
    const entries = new Map();
    const entryCollection = team.collection("loadingEntries");
    for (const q of [entryCollection.where(new FieldPath("contributions", uid), "!=", null), entryCollection.where("authorUids", "array-contains", uid)]) {
      (await q.get()).docs.forEach((item) => entries.set(item.id, item));
    }
    entries.forEach((item) => writer.update(item.ref, new FieldPath("contributions", uid), FieldValue.delete(), "authorUids", FieldValue.arrayRemove(uid)));
    writer.delete(team.collection("loadingSummaries").doc(uid)); writer.delete(team.collection("latestDailyReports").doc(uid));
    await writer.close(); return records.size;
  }
  async function handleEventDate(event) {
    const ref = event.data?.after.ref;
    if (!event.data?.after.exists) return;
    await firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(ref), data = current.data();
      if (data && lastEventDate(data) && data.lastEventDate !== lastEventDate(data)) transaction.update(ref, { lastEventDate: lastEventDate(data) });
    });
  }
  async function handleMembership(event) {
    const before = event.data?.before.data() || null, after = event.data?.after.data() || null;
    const relevant = (data) => data && [data.name, data.role, data.staffScope, data.assignedStaff];
    if (JSON.stringify(relevant(before)) === JSON.stringify(relevant(after))) return;
    const state = (await stateRef(event.params.teamId).get()).data();
    if (state?.ready || state?.status === "preparing") await prepare(event.params.teamId, state.ready ? state : { enabled: state.desiredEnabled, separateReads: state.desiredSeparateReads });
  }
  async function handleTeam(event) {
    if (!event.data?.after.exists) return;
    if (JSON.stringify(event.data.before.data()?.channels) === JSON.stringify(event.data.after.data()?.channels)) return;
    const state = (await stateRef(event.params.teamId).get()).data();
    if (state?.ready || state?.status === "preparing") await prepare(event.params.teamId, state.ready ? state : { enabled: state.desiredEnabled, separateReads: state.desiredSeparateReads });
  }
  async function handleUser(event) {
    if (!event.data?.after.exists) return;
    const before = event.data.before.data() || {}, after = event.data.after.data() || {};
    if (JSON.stringify([before.name, before.blockedUserUids]) === JSON.stringify([after.name, after.blockedUserUids])) return;
    for (const teamId of new Set([...(after.teamIds || []), after.activeTeamId].filter(Boolean))) {
      const state = (await stateRef(teamId).get()).data();
      if (state?.ready || state?.status === "preparing") await prepare(teamId, state.ready ? state : { enabled: state.desiredEnabled, separateReads: state.desiredSeparateReads });
    }
  }
  return { process, context, refreshLatest, prepare, prepareCallable, configureCallable, handleContent, handleReadState, handleEventDate, handleMembership, handleTeam, handlePreparation, handleUser, relatedTeamIds, anonymizeTeam };
}
module.exports = { createLoadingOptimizationBackend };
