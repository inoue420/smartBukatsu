const { SCHEMA_VERSION, lastEventDate, contributions, adjustSummary, audienceFor,
  contentChanges, latestReportData, validLatest, compareReports, stableStringify, postActorUids } = require("./loadingOptimizationCore");
const { memberGrades } = require("./workspaceAudience");
const CONTEXT_VERSION = 3, SHARD_BYTES = 256 * 1024, MAX_CONTEXT_BYTES = 4 * 1024 * 1024;
const SOURCE_KINDS = ["notices", "dailyReports", "workspacePosts"];
const MEDICAL_SUMMARY_VERSION = 2;
const POST_ACTOR_INDEX_VERSION = 1;
const chunksOf = (values) => Array.from({ length: Math.ceil(values.length / 30) }, (_, i) => values.slice(i * 30, i * 30 + 30));
const maintained = (s) => s?.status === "preparing" || Boolean(s?.ready && s.enabled);
const revision = () => Date.now() + "_" + require("node:crypto").randomUUID();
// Existing author queries order Timestamp values ahead of numeric legacy values.
// Keep their selection semantics; current apps always save serverTimestamp().
const reportOrder = (first, second) => {
  const normalized = (item) => {
    const data = typeof item?.data === "function" ? { ...item.data(), id: item.id } : item || {};
    return { ...data, createdAt: typeof data.createdAt?.toMillis === "function" ? data.createdAt : 0 };
  };
  return compareReports(normalized(first), normalized(second));
};

function createLoadingOptimizationBackend({ firestore, FieldValue, FieldPath, HttpsError, logger = { info() {} } }) {
  const teamRef = (id) => firestore.collection("teams").doc(id);
  const stateRef = (id) => teamRef(id).collection("loadingOptimization").doc("state");
  const contextRef = (id, index) => teamRef(id).collection("system").doc("loadingContext_" + index);
  const exclusionsRef = (id) => teamRef(id).collection("system").doc("loadingExclusions");
  async function measured(operation, work, existing) {
    if (existing) return work(existing);
    const start = Date.now(), m = { operation, reads: 0, writes: 0, queries: 0, retries: 0,
      skipped: 0, contextRebuilds: 0, latestSearches: 0, durationMs: 0 };
    try { return await work(m); }
    finally { m.durationMs = Date.now() - start; logger.info("loading_optimization_metrics", m); }
  }
  async function read(ref, m, tx) {
    const snap = await (tx ? tx.get(ref) : ref.get());
    if (Array.isArray(snap.docs)) { m.queries++; m.reads += Math.max(1, snap.size); } else m.reads++;
    return snap;
  }
  function write(tx, method, ref, data, m, options) {
    m.writes++;
    if (method === "delete") tx.delete(ref);
    else if (options) tx[method](ref, data, options);
    else tx[method](ref, data);
  }
  async function transact(m, work) {
    let attempts = 0;
    return firestore.runTransaction((tx) => { if (attempts++) m.retries++; return work(tx); });
  }
  function preparationFields(current, options = {}) {
    return { ready: false, enabled: false, separateReads: false, schemaVersion: SCHEMA_VERSION,
      status: "preparing", stage: 0, cursor: null, personalIndex: 0, processed: 0, lease: null,
      desiredEnabled: options.enabled === true, desiredSeparateReads: options.separateReads === true,
      preparationId: revision(), contextVersion: CONTEXT_VERSION, contextRevision: null,
      preparationStages: null, latestUids: null, targetedPreparation: false, queryIndex: 0,
      postActorIndexVersion: 0,
      medicalSummaryVersion: MEDICAL_SUMMARY_VERSION,
      contextShardCount: current?.contextShardCount || 0 };
  }
  const desired = (s) => ({ enabled: s?.status === "preparing" ? s.desiredEnabled : s?.enabled,
    separateReads: s?.status === "preparing" ? s.desiredSeparateReads : s?.separateReads });
  function shardsFor(payload) {
    const buffer = Buffer.from(payload, "utf8"), chunks = [];
    if (buffer.length > MAX_CONTEXT_BYTES) throw new HttpsError("resource-exhausted", "集計用の参照情報が大きすぎます。準備を確認してください。");
    for (let start = 0; start < buffer.length;) {
      let end = Math.min(start + SHARD_BYTES, buffer.length);
      while (end < buffer.length && (buffer[end] & 0xc0) === 0x80) end--;
      chunks.push(buffer.subarray(start, end).toString("utf8")); start = end;
    }
    return chunks;
  }
  async function sourceContext(teamId, m, tx) {
    const [team, excluded] = await Promise.all([read(teamRef(teamId), m, tx), read(exclusionsRef(teamId), m, tx)]);
    if (!team.exists) return null;
    const excludedUids = excluded.data()?.uids || {};
    const snap = await read(teamRef(teamId).collection("members").orderBy(FieldPath.documentId()), m, tx);
    const documents = snap.docs.filter((d) => !excludedUids[d.id]);
    const users = await Promise.all(documents.map((d) => read(firestore.collection("users").doc(d.id), m, tx)));
    const usedNames = new Set(), members = [];
    documents.forEach((d, i) => {
      if (!users[i].exists) return;
      const data = d.data(), user = users[i].data(), name = data.name || user.name || "名称未設定";
      const profileKey = usedNames.has(name) ? name + "_" + d.id.substring(0, 4) : name;
      usedNames.add(profileKey);
      members.push({ uid: d.id, name, profileKey, role: data.role || "member", grade: data.grade || "",
        grades: memberGrades(data),
        staffScope: data.staffScope || null, assignedStaff: data.assignedStaff || null,
        blockedUserUids: (user.blockedUserUids || []).filter((uid) => !excludedUids[uid]).sort() });
    });
    const channels = (team.data().channels || []).map((c) => Object.fromEntries(
      ["id", "name", "memberAudience", "allowedRoleGroups", "allowedGrades", "shareScope", "allowedMemberUids", "allowedMembers"]
        .filter((key) => c[key] !== undefined).map((key) => [key, c[key]])));
    return { members, channels, ...(Object.keys(excludedUids).length ? { excludedUids: Object.keys(excludedUids).sort() } : {}) };
  }
  async function cachedPayload(teamId, s, m, tx) {
    if (s?.contextVersion !== CONTEXT_VERSION || s.contextRevision !== s.preparationId ||
        !Number.isInteger(s.contextShardCount) || s.contextShardCount < 1 || s.contextShardCount > 17) return null;
    const records = await Promise.all(Array.from({ length: s.contextShardCount }, (_, i) => read(contextRef(teamId, i), m, tx)));
    if (records.some((d) => d.data()?.revision !== s.preparationId || typeof d.data()?.payload !== "string")) return null;
    return records.map((d) => d.data().payload).join("");
  }
  function publishContext(teamId, s, ctx, m, tx) {
    const chunks = shardsFor(stableStringify(ctx));
    chunks.forEach((payload, i) => write(tx, "set", contextRef(teamId, i), { revision: s.preparationId, payload }, m));
    for (let i = chunks.length; i < (s.contextShardCount || 0); i++) write(tx, "delete", contextRef(teamId, i), null, m);
    write(tx, "update", stateRef(teamId), { contextVersion: CONTEXT_VERSION,
      contextRevision: s.preparationId, contextShardCount: chunks.length }, m);
    m.contextRebuilds++;
    return { ...ctx, preparationId: s.preparationId };
  }
  function parseContext(payload, preparationId) {
    try { const ctx = JSON.parse(payload); if (Array.isArray(ctx?.members) && Array.isArray(ctx?.channels)) return { ...ctx, preparationId }; } catch {}
    return null;
  }
  async function context(teamId, existing, attempt = 0) {
    return measured("context", async (m) => {
      const s = (await read(stateRef(teamId), m)).data();
      if (!maintained(s)) { m.skipped++; m.skipReason = "optimization_disabled"; return null; }
      if (s.medicalSummaryVersion !== MEDICAL_SUMMARY_VERSION) {
        await transact(m, async (tx) => {
          const current = (await read(stateRef(teamId), m, tx)).data();
          if (!maintained(current) || current.medicalSummaryVersion === MEDICAL_SUMMARY_VERSION) return;
          write(tx, "update", stateRef(teamId), preparationFields(current, desired(current)), m);
        });
        return context(teamId, m, attempt + 1);
      }
      const cached = parseContext(await cachedPayload(teamId, s, m), s.preparationId);
      if (cached) return cached;
      if (attempt >= 2) throw new HttpsError("aborted", "チーム設定の更新後に再試行します。");
      if (s.status !== "preparing") {
        await prepare(teamId, null, m);
        return context(teamId, m, attempt + 1);
      }
      const result = await transact(m, async (tx) => {
        const current = (await read(stateRef(teamId), m, tx)).data();
        if (!maintained(current) || current.preparationId !== s.preparationId) return null;
        const stored = parseContext(await cachedPayload(teamId, current, m, tx), current.preparationId);
        if (stored) return stored;
        const ctx = await sourceContext(teamId, m, tx);
        return ctx ? publishContext(teamId, current, ctx, m, tx) : null;
      });
      return result || context(teamId, m, attempt + 1);
    }, existing);
  }
  async function refreshLatest(teamId, member, expectedRevision, changeId = null, existing) {
    if (!member) return;
    return measured("latest", async (m) => {
      const reports = teamRef(teamId).collection("dailyReports"), target = teamRef(teamId).collection("latestDailyReports").doc(member.uid);
      await transact(m, async (tx) => {
        const s = (await read(stateRef(teamId), m, tx)).data();
        if (!maintained(s) || (expectedRevision !== undefined && s.preparationId !== expectedRevision)) return;
        const old = await read(target, m, tx);
        const [identity, user] = await Promise.all([read(teamRef(teamId).collection("members").doc(member.uid), m, tx), read(firestore.collection("users").doc(member.uid), m, tx)]);
        const changed = changeId ? await read(reports.doc(changeId), m, tx) : null;
        if (!identity.exists || !user.exists) { if (old.exists) write(tx, "delete", target, null, m); return; }
        const data = changed?.data(), candidate = data?.createdAt !== undefined && validLatest(data, member) ? latestReportData(data, changeId, member) : null;
        let next = null, search = !changeId;
        if (changeId) {
          const previous = old.data();
          if (candidate && typeof data.createdAt?.toMillis !== "function") search = true;
          else if (previous?.id === changeId) {
            if (!candidate || reportOrder(candidate, previous) > 0) search = true;
            else next = candidate;
          } else if (candidate && (!old.exists || reportOrder(candidate, previous) < 0)) next = candidate;
          else return;
        }
        if (search) {
          m.latestSearches++;
          const candidates = [];
          for (const [field, value] of [["authorUid", member.uid], ["author", member.profileKey]]) {
            let cursor = null;
            for (;;) {
              let q = reports.where(field, "==", value).orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc").limit(20);
              if (cursor) q = q.startAfter(cursor);
              const page = await read(q, m, tx), found = page.docs.find((d) => validLatest(d.data(), member));
              if (found) { candidates.push(found); break; }
              if (page.size < 20) break;
              cursor = page.docs.at(-1);
            }
          }
          candidates.sort(reportOrder);
          if (candidates.length) next = latestReportData(candidates[0].data(), candidates[0].id, member);
        }
        if (next) { if (stableStringify(old.data()) !== stableStringify(next)) write(tx, "set", target, next, m); }
        else if (old.exists) write(tx, "delete", target, null, m);
      });
    }, existing);
  }
  async function process(teamId, kind, id, suppliedContext, skipLatest = false, attempt = 0, options = {}, existing) {
    return measured("content", async (m) => {
      const ctx = suppliedContext || await context(teamId, m);
      if (!ctx) return;
      const source = teamRef(teamId).collection(kind).doc(id), entry = teamRef(teamId).collection("loadingEntries").doc(kind + "_" + id);
      let authors = [], changedContext = false;
      await transact(m, async (tx) => {
        authors = []; changedContext = false;
        const s = (await read(stateRef(teamId), m, tx)).data();
        if (!maintained(s)) return;
        if (s.preparationId !== ctx.preparationId || s.contextRevision !== ctx.preparationId) { changedContext = true; return; }
        const sourceSnap = await read(source, m, tx), oldSnap = await read(entry, m, tx);
        const data = sourceSnap.data() || null, old = oldSnap.data() || {};
        const authorsOf = (d) => ctx.members.filter((member) => d?.authorUid ? member.uid === d.authorUid : d?.author === member.profileKey).map((member) => member.uid);
        const authorUids = authorsOf(data), affected = new Set([...authorUids, ...(old.authorUids || []), ...authorsOf(options.before)]);
        authors = ctx.members.filter((member) => affected.has(member.uid));
        if (options.aggregate === false) return;
        const reads = kind === "workspacePosts" ? (await read(teamRef(teamId).collection("workspacePostReadStates").doc(id), m, tx)).data() || {} : {};
        const next = contributions(kind, data, ctx.members, reads), previous = old.contributions || {};
        const changed = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter((uid) => stableStringify(previous[uid] || {}) !== stableStringify(next[uid] || {}));
        const summaries = await Promise.all(changed.map((uid) => read(teamRef(teamId).collection("loadingSummaries").doc(uid), m, tx)));
        const identities = await Promise.all(changed.map(async (uid) => {
          if (!ctx.members.some((member) => member.uid === uid)) return false;
          const [member, user] = await Promise.all([read(teamRef(teamId).collection("members").doc(uid), m, tx), read(firestore.collection("users").doc(uid), m, tx)]);
          return member.exists && user.exists;
        }));
        changed.forEach((uid, i) => {
          if (!identities[i]) { delete next[uid]; if (summaries[i].exists) write(tx, "delete", summaries[i].ref, null, m); }
          else write(tx, "set", summaries[i].ref, { ...adjustSummary(summaries[i].data(), previous[uid], next[uid]), updatedAt: FieldValue.serverTimestamp() }, m);
        });
        if (!sourceSnap.exists) { if (oldSnap.exists) write(tx, "delete", entry, null, m); }
        else {
          const actorUids = kind === "workspacePosts" ? postActorUids(data, ctx.members, ctx.excludedUids) : null;
          const changedEntry = stableStringify(previous) !== stableStringify(next) || stableStringify(old.authorUids || []) !== stableStringify(authorUids)
            || (actorUids && stableStringify(old.postActorUids) !== stableStringify(actorUids));
          if (changedEntry || (options.preparing && old.referencePreparationId !== ctx.preparationId)) write(tx, "set", entry,
            { contributions: next, authorUids, ...(actorUids ? { postActorUids: actorUids } : {}), referencePreparationId: ctx.preparationId }, m);
        }
      });
      if (changedContext) {
        if (suppliedContext) return;
        if (attempt >= 2) throw new HttpsError("aborted", "チーム設定の更新後に再試行します。");
        return process(teamId, kind, id, null, skipLatest, attempt + 1, options, m);
      }
      if (kind === "dailyReports" && !skipLatest) await Promise.all(authors.map((member) => refreshLatest(teamId, member, ctx.preparationId, id, m)));
      if (!m.writes && !m.skipReason) m.skipReason = "already_applied_or_no_recipient_change";
    }, existing);
  }
  async function prepare(teamId, options = {}, existing) {
    return measured("prepare", async (m) => transact(m, async (tx) => {
      const [team, snap] = await Promise.all([read(teamRef(teamId), m, tx), read(stateRef(teamId), m, tx)]);
      if (!team.exists) throw new HttpsError("not-found", "チームがありません。");
      write(tx, "set", stateRef(teamId), preparationFields(snap.data(), options === null ? desired(snap.data()) : options), m, { merge: true });
      return { ready: false, status: "preparing" };
    }), existing);
  }
  async function handlePreparation(event) {
    if (!event.data?.after.exists || event.data.after.data().status !== "preparing") return;
    return measured("preparation", async (m) => {
      const teamId = event.params.teamId, ref = stateRef(teamId), token = revision();
      const s = await transact(m, async (tx) => {
        const current = (await read(ref, m, tx)).data();
        if (current?.status !== "preparing" || (current.lease?.expiresAt || 0) > Date.now()) return null;
        write(tx, "update", ref, { lease: { token, expiresAt: Date.now() + 240000 } }, m); return current;
      });
      if (!s) return;
      try {
        const ctx = await context(teamId, m);
        if (!ctx || ctx.preparationId !== s.preparationId) return;
        const stages = s.preparationStages || ["audiences", "clubEvents", "personalEvents", "notices", "dailyReports", "workspacePosts", "entries", "latest", "cleanup"];
        const stage = stages[s.stage || 0];
        const next = { stage: s.stage || 0, cursor: null, queryIndex: 0, personalIndex: s.personalIndex || 0, processed: s.processed || 0, lease: null };
        if (stage === "latest") {
          await Promise.all(ctx.members.filter((member) => !s.latestUids || s.latestUids.includes(member.uid)).map((member) => refreshLatest(teamId, member, ctx.preparationId, null, m))); next.stage++;
        } else if (stage === "targetPosts" || stage === "targetReports") {
          // The plan lives in the private context shards, never in the state
          // document that team members can read (block lists are private).
          const targets = ctx.referenceTargets?.[stage === "targetPosts" ? "posts" : "reports"];
          if (!targets) { await prepare(teamId, null, m); return; }
          const queryIndex = s.queryIndex || 0, target = targets[queryIndex];
          if (!target) next.stage++;
          else {
            const field = target.recipientUid ? new FieldPath("contributions", target.recipientUid, "workspaceNotificationUnreadCount") : target.field;
            let q = teamRef(teamId).collection("loadingEntries");
            if (target.recipientUid) q = q.where(field, ">", 0).orderBy(field).orderBy(FieldPath.documentId());
            else q = q.where(field, "array-contains-any", target.uids).orderBy(FieldPath.documentId());
            if (s.cursor) q = target.recipientUid ? q.startAfter(s.cursor.value, s.cursor.id) : q.startAfter(s.cursor);
            const page = await read(q.limit(50), m), kind = stage === "targetPosts" ? "workspacePosts" : "dailyReports";
            for (const item of page.docs) {
              if (!item.id.startsWith(kind + "_") || item.data().referencePreparationId === ctx.preparationId) continue;
              await process(teamId, kind, item.id.slice(kind.length + 1), ctx, true, 0, { preparing: true }, m);
            }
            next.processed += page.size;
            next.queryIndex = queryIndex;
            if (page.size === 50) {
              const last = page.docs.at(-1);
              next.cursor = target.recipientUid ? { id: last.id, value: last.get(field) } : last.id;
            } else if (queryIndex + 1 < targets.length) next.queryIndex++;
            else { next.stage++; next.queryIndex = 0; }
          }
        } else if (stage === "cleanup" || stage === "complete") {
          const valid = new Set(ctx.members.map((member) => member.uid));
          for (const name of stage === "cleanup" ? ["loadingSummaries", "latestDailyReports"] : []) {
            const snap = await read(teamRef(teamId).collection(name), m);
            for (const item of snap.docs.filter((d) => !valid.has(d.id))) {
              await transact(m, async (tx) => {
                const current = (await read(ref, m, tx)).data();
                if (current?.preparationId === ctx.preparationId) write(tx, "delete", item.ref, null, m);
              });
            }
          }
          Object.assign(next, { ready: true, status: "ready", preparedAt: FieldValue.serverTimestamp() });
        } else {
          const entryKind = stage?.startsWith("entries:") ? stage.slice(8) : null;
          const personal = stage === "personalEvents", member = ctx.members[next.personalIndex];
          if (personal && !member) next.stage++;
          else {
            const source = personal ? firestore.collection("users").doc(member.uid).collection(stage) : teamRef(teamId).collection(stage === "audiences" ? "workspacePosts" : stage === "entries" || entryKind ? "loadingEntries" : stage);
            let q = source.orderBy(FieldPath.documentId()).limit(50);
            if (entryKind) q = q.where(FieldPath.documentId(), ">=", entryKind + "_").where(FieldPath.documentId(), "<=", entryKind + "_\uf8ff");
            if (s.cursor) q = q.startAfter(s.cursor);
            const page = await read(q, m);
            for (const item of page.docs) {
              if (stage === "audiences") {
                await transact(m, async (tx) => {
                  const currentState = (await read(ref, m, tx)).data();
                  if (currentState?.preparationId !== ctx.preparationId || currentState.contextRevision !== ctx.preparationId) return;
                  const current = await read(item.ref, m, tx), data = current.data();
                  if (!data || data.status === "deleted" || data.moderationStatus === "hidden") return;
                  const audience = audienceFor(data, ctx.channels, ctx.members);
                  if (audience && stableStringify([data.shareScope, [...(data.visibleToUids || [])].sort(), [...(data.readTargetUids || [])].sort()]) !== stableStringify([audience.shareScope, audience.visibleToUids, audience.readTargetUids])) write(tx, "update", item.ref, { ...audience, updatedAt: FieldValue.serverTimestamp() }, m);
                });
              } else if (stage === "clubEvents" || personal) await handleEventDate({ data: { after: { exists: true, ref: item.ref } } }, m);
              else if (stage === "entries" || entryKind) {
                const kind = SOURCE_KINDS.find((name) => item.id.startsWith(name + "_"));
                // Source stages already applied these entries in this
                // generation. Only drain old entries, including orphans.
                if (kind && item.data().referencePreparationId !== ctx.preparationId) await process(teamId, kind, item.id.slice(kind.length + 1), ctx, true, 0, { preparing: true }, m);
              } else await process(teamId, stage, item.id, ctx, true, 0, { preparing: true }, m);
            }
            next.processed += page.size;
            if (page.size === 50) next.cursor = page.docs.at(-1).id;
            else if (personal) next.personalIndex++;
            else next.stage++;
          }
        }
        await transact(m, async (tx) => {
          const current = (await read(ref, m, tx)).data();
          if (current?.preparationId !== s.preparationId || current.lease?.token !== token) return;
          if (next.ready) Object.assign(next, { enabled: current.desiredEnabled === true, separateReads: current.desiredEnabled === true && current.desiredSeparateReads === true,
            ...(!s.preparationStages || stages.includes("workspacePosts") ? { postActorIndexVersion: POST_ACTOR_INDEX_VERSION } : {}) });
          write(tx, "update", ref, next, m);
        });
      } catch (error) {
        await transact(m, async (tx) => {
          const current = (await read(ref, m, tx)).data();
          if (current?.lease?.token === token) write(tx, "update", ref, { lease: null }, m);
        }); throw error;
      }
    });
  }
  async function authorize(request, m) {
    const uid = request.auth?.uid, teamId = request.data?.teamId;
    if (!uid) throw new HttpsError("unauthenticated", "ログインしてください。");
    if (typeof teamId !== "string" || !teamId || teamId.includes("/")) throw new HttpsError("invalid-argument", "チームIDを確認してください。");
    const member = (await read(teamRef(teamId).collection("members").doc(uid), m)).data();
    if (!member || !["owner", "admin"].includes(member.role)) throw new HttpsError("permission-denied", "管理者の承認が必要です。");
    return teamId;
  }
  async function prepareCallable(request) {
    return measured("prepare_callable", async (m) => {
      const teamId = await authorize(request, m);
      const result = await transact(m, async (tx) => {
        const s = (await read(stateRef(teamId), m, tx)).data();
        if (s?.ready && s.enabled && s.schemaVersion === SCHEMA_VERSION && s.medicalSummaryVersion === MEDICAL_SUMMARY_VERSION &&
            parseContext(await cachedPayload(teamId, s, m, tx), s.preparationId)) return { ready: true };
        if (s?.status !== "preparing") return null;
        if ((s.lease?.expiresAt || 0) < Date.now()) write(tx, "update", stateRef(teamId), { lease: null, resumeAt: FieldValue.serverTimestamp() }, m);
        return { ready: false, status: "preparing" };
      });
      return result || prepare(teamId, null, m);
    });
  }
  async function configureCallable(request) {
    const enabled = request.data.enabled === true, separateReads = request.data.separateReads === true;
    return measured("configure", async (m) => {
      const teamId = await authorize(request, m);
      return transact(m, async (tx) => {
      const [team, snap] = await Promise.all([read(teamRef(teamId), m, tx), read(stateRef(teamId), m, tx)]);
      if (!team.exists) throw new HttpsError("not-found", "チームがありません。");
      const s = snap.data();
      if (enabled && (!s || s.schemaVersion !== SCHEMA_VERSION)) throw new HttpsError("failed-precondition", "既存データの準備を先に完了してください。");
      if (enabled && s.status === "preparing" && s.contextVersion === CONTEXT_VERSION) {
        write(tx, "update", stateRef(teamId), { desiredEnabled: true, desiredSeparateReads: separateReads, updatedAt: FieldValue.serverTimestamp() }, m);
        return { enabled: false, separateReads: false, ready: false, status: "preparing" };
      }
      if (enabled && (!s.enabled || !s.ready || s.medicalSummaryVersion !== MEDICAL_SUMMARY_VERSION || !parseContext(await cachedPayload(teamId, s, m, tx), s.preparationId))) {
        write(tx, "set", stateRef(teamId), preparationFields(s, { enabled, separateReads }), m, { merge: true });
        return { enabled: false, separateReads: false, ready: false, status: "preparing" };
      }
      const update = { enabled, separateReads: enabled && separateReads, desiredEnabled: enabled,
        desiredSeparateReads: enabled && separateReads, updatedAt: FieldValue.serverTimestamp() };
      if (!enabled && s?.status !== "preparing") Object.assign(update, { ready: false, status: "disabled", preparationId: revision(), contextRevision: null });
      write(tx, "set", stateRef(teamId), update, m, { merge: true });
      return { enabled, separateReads: enabled && separateReads };
      });
    });
  }
  async function handleContent(kind, event) {
    const before = event.data?.before.exists ? event.data.before.data() : null, after = event.data?.after.exists ? event.data.after.data() : null;
    const changes = event.data ? contentChanges(kind, before, after) : { aggregate: true, latest: kind === "dailyReports" };
    return measured("content", async (m) => {
      if (!changes.aggregate && !changes.latest) { m.skipped++; m.skipReason = "irrelevant_fields"; return; }
      await process(event.params.teamId, kind, event.params.documentId, null, !changes.latest, 0, { aggregate: changes.aggregate, before }, m);
    });
  }
  async function handleReadState(event) {
    return measured("read_state", async (m) => {
      const { teamId, postId } = event.params, before = event.data?.before.data() || {}, after = event.data?.after.data() || {};
      if (!event.data || stableStringify([before.notificationReads, before.notificationDismissals]) !== stableStringify([after.notificationReads, after.notificationDismissals])) await process(teamId, "workspacePosts", postId, null, true, 0, {}, m);
      const reads = event.data ? after : (await read(teamRef(teamId).collection("workspacePostReadStates").doc(postId), m)).data() || {};
      for (const uid of new Set([...Object.keys(reads.readers || {}), ...Object.keys(reads.notificationReads || {}), ...Object.keys(reads.notificationDismissals || {})])) {
        if (event.data && stableStringify([before.readers?.[uid], before.notificationReads?.[uid], before.notificationDismissals?.[uid]]) === stableStringify([after.readers?.[uid], after.notificationReads?.[uid], after.notificationDismissals?.[uid]])) continue;
        const user = firestore.collection("users").doc(uid), anchor = user.collection("loadingReadTeams").doc(teamId);
        await transact(m, async (tx) => {
          const [identity, existing, exclusions] = await Promise.all([read(user, m, tx), read(anchor, m, tx), read(exclusionsRef(teamId), m, tx)]);
          if (identity.exists && !existing.exists && !exclusions.data()?.uids?.[uid]) write(tx, "set", anchor, { teamId }, m);
        });
      }
    });
  }
  async function relatedTeamIds(uid) {
    return (await firestore.collection("users").doc(uid).collection("loadingReadTeams").get()).docs.map((d) => d.id);
  }
  async function anonymizeTeam(team, uid) {
    return measured("anonymize", async (m) => {
      await transact(m, async (tx) => {
        const [snap, excluded, identity] = await Promise.all([read(stateRef(team.id), m, tx), read(exclusionsRef(team.id), m, tx), read(team, m, tx)]);
        if (!identity.exists) return;
        const s = snap.data();
        write(tx, "set", exclusionsRef(team.id), { uids: { ...(excluded.data()?.uids || {}), [uid]: true } }, m);
        for (let i = 0; i < (s?.contextShardCount || 0); i++) write(tx, "delete", contextRef(team.id, i), null, m);
        if (s) {
          const next = maintained(s) ? preparationFields(s, desired(s)) : { ready: false, enabled: false, status: "disabled", preparationId: revision(), contextRevision: null };
          write(tx, "update", stateRef(team.id), { ...next, contextShardCount: 0 }, m);
        }
      });
      const collection = team.collection("workspacePostReadStates"), records = new Map();
      for (const field of ["readers", "notificationReads", "notificationDismissals"]) {
        const snap = await read(collection.where(new FieldPath(field, uid), "!=", null), m);
        snap.docs.forEach((d) => records.set(d.id, d));
      }
      const writer = firestore.bulkWriter();
      records.forEach((d) => { m.writes++; writer.update(d.ref,
        new FieldPath("readers", uid), FieldValue.delete(), new FieldPath("notificationReads", uid), FieldValue.delete(), new FieldPath("notificationDismissals", uid), FieldValue.delete()); });
      const entries = new Map(), entryCollection = team.collection("loadingEntries");
      for (const q of [entryCollection.where(new FieldPath("contributions", uid), "!=", null), entryCollection.where("authorUids", "array-contains", uid),
        entryCollection.where("postActorUids", "array-contains", uid)]) (await read(q, m)).docs.forEach((d) => entries.set(d.id, d));
      entries.forEach((d) => { m.writes++; writer.update(d.ref, new FieldPath("contributions", uid), FieldValue.delete(), "authorUids", FieldValue.arrayRemove(uid),
        ...(Array.isArray(d.data().postActorUids) ? ["postActorUids", FieldValue.arrayRemove(uid)] : [])); });
      writer.delete(team.collection("loadingSummaries").doc(uid)); writer.delete(team.collection("latestDailyReports").doc(uid)); m.writes += 2;
      await writer.close(); return records.size;
    });
  }
  async function handleEventDate(event, existing) {
    if (!event.data?.after.exists) return;
    return measured("event_date", async (m) => transact(m, async (tx) => {
      const ref = event.data.after.ref, current = await read(ref, m, tx), data = current.data();
      if (data && lastEventDate(data) && data.lastEventDate !== lastEventDate(data)) write(tx, "update", ref, { lastEventDate: lastEventDate(data) }, m);
    }), existing);
  }
  function referenceStages(before, after, state) {
    const kinds = new Set(), stages = new Set();
    if (stableStringify(before.channels) !== stableStringify(after.channels)) { stages.add("audiences"); kinds.add("workspacePosts"); }
    const oldMembers = new Map(before.members.map((member) => [member.uid, member]));
    const newMembers = new Map(after.members.map((member) => [member.uid, member]));
    const latestUids = [], reportAuthors = new Set(), postQueries = [];
    for (const uid of new Set([...oldMembers.keys(), ...newMembers.keys()])) {
      const a = oldMembers.get(uid), b = newMembers.get(uid);
      if (stableStringify(a) === stableStringify(b)) continue;
      if (!a || !b || a.name !== b.name || a.profileKey !== b.profileKey) {
        stages.add("audiences"); stages.add("cleanup");
        SOURCE_KINDS.forEach((kind) => kinds.add(kind)); latestUids.push(uid);
      } else {
        if (a.role !== b.role) { stages.add("audiences"); kinds.add("workspacePosts"); kinds.add("dailyReports"); }
        if (stableStringify(memberGrades(a).sort()) !== stableStringify(memberGrades(b).sort())) { stages.add("audiences"); kinds.add("workspacePosts"); }
        if ((a.assignedStaff || null) !== (b.assignedStaff || null)) reportAuthors.add(uid);
        if ((a.staffScope || null) !== (b.staffScope || null)) {
          for (const author of after.members) {
            const report = { authorUid: author.uid, author: author.profileKey, isReviewed: false };
            if (stableStringify(contributions("dailyReports", report, before.members)) !== stableStringify(contributions("dailyReports", report, after.members))) reportAuthors.add(author.uid);
          }
        }
        const oldBlocked = new Set(a.blockedUserUids || []), newBlocked = new Set(b.blockedUserUids || []);
        const changed = [...new Set([...oldBlocked, ...newBlocked])].filter((blocked) => oldBlocked.has(blocked) !== newBlocked.has(blocked));
        if (changed.length) {
          if (state.postActorIndexVersion === POST_ACTOR_INDEX_VERSION) {
            postQueries.push(...chunksOf(changed).map((uids) => ({ field: "postActorUids", uids })));
          } else if (changed.some((blocked) => oldBlocked.has(blocked))) {
            // Old ready teams have no actor index for previously suppressed
            // notifications. Backfill posts once when unblocking needs it.
            kinds.add("workspacePosts");
          } else {
            // Adding a block can only remove existing notifications. This
            // query works with old entries too and avoids a migration scan.
            postQueries.push({ recipientUid: uid });
          }
        }
      }
    }
    const targets = { posts: kinds.has("workspacePosts") ? [] : postQueries,
      reports: kinds.has("dailyReports") ? [] : chunksOf([...reportAuthors]).map((uids) => ({ field: "authorUids", uids })) };
    // Author UIDs were already maintained for every known daily-report
    // author, including reviewed reports. Reading these entries also drains
    // orphan contributions without walking the entire source collection.
    return { stages: [...(stages.has("audiences") ? ["audiences"] : []), ...kinds,
      ...[...kinds].map((kind) => "entries:" + kind), ...(targets.posts.length ? ["targetPosts"] : []),
      ...(targets.reports.length ? ["targetReports"] : []), ...(latestUids.length ? ["latest"] : []),
      stages.has("cleanup") ? "cleanup" : "complete"], latestUids, targets };
  }
  async function referenceContext(teamId, old, change, m, tx) {
    if (!old || !change) return sourceContext(teamId, m, tx);
    if (change.kind === "channels") {
      const team = await read(teamRef(teamId), m, tx);
      if (!team.exists) return null;
      const channels = (team.data().channels || []).map((channel) => Object.fromEntries(
        ["id", "name", "memberAudience", "allowedRoleGroups", "allowedGrades", "shareScope", "allowedMemberUids", "allowedMembers"]
          .filter((key) => channel[key] !== undefined).map((key) => [key, channel[key]])));
      return { members: old.members, channels, ...(old.excludedUids?.length ? { excludedUids: old.excludedUids } : {}) };
    }
    const uid = change.uid, previous = old.members.find((member) => member.uid === uid);
    const [member, user] = await Promise.all([read(teamRef(teamId).collection("members").doc(uid), m, tx), read(firestore.collection("users").doc(uid), m, tx)]);
    const name = member.data()?.name || user.data()?.name || "名称未設定";
    if (!previous || !member.exists || !user.exists || previous.name !== name) return sourceContext(teamId, m, tx);
    const updated = { ...previous, role: member.data().role || "member", grade: member.data().grade || "", staffScope: member.data().staffScope || null,
      grades: memberGrades(member.data()),
      assignedStaff: member.data().assignedStaff || null, blockedUserUids: [...(user.data().blockedUserUids || [])].sort() };
    const excluded = (await read(exclusionsRef(teamId), m, tx)).data()?.uids || {};
    if (excluded[uid]) return sourceContext(teamId, m, tx);
    updated.blockedUserUids = updated.blockedUserUids.filter((blocked) => !excluded[blocked]);
    return { channels: old.channels, members: old.members.map((item) => item.uid === uid ? updated : item),
      ...(Object.keys(excluded).length ? { excludedUids: Object.keys(excluded).sort() } : {}) };
  }
  async function restartForReferenceChange(teamId, change) {
    return measured("reference_change", async (m) => {
      try { return await transact(m, async (tx) => {
      const s = (await read(stateRef(teamId), m, tx)).data();
      if (!s) return;
      if (!maintained(s)) {
        for (let i = 0; i < (s.contextShardCount || 0); i++) write(tx, "delete", contextRef(teamId, i), null, m);
        write(tx, "update", stateRef(teamId), { ready: false, contextRevision: null, contextShardCount: 0 }, m); return;
      }
      const payload = await cachedPayload(teamId, s, m, tx), old = parseContext(payload, s.preparationId);
      const ctx = await referenceContext(teamId, old, change, m, tx);
      const previous = old && { members: old.members, channels: old.channels, ...(old.excludedUids?.length ? { excludedUids: old.excludedUids } : {}) };
      if (!ctx || stableStringify(previous) === stableStringify(ctx)) return;
      const next = preparationFields(s, desired(s));
      let published = ctx;
      if (old && s.status === "ready" && s.medicalSummaryVersion === MEDICAL_SUMMARY_VERSION) {
        const scope = referenceStages(old, ctx, s);
        next.preparationStages = scope.stages; next.latestUids = scope.latestUids;
        next.postActorIndexVersion = s.postActorIndexVersion || 0;
        next.targetedPreparation = scope.targets.posts.length > 0 || scope.targets.reports.length > 0;
        if (next.targetedPreparation) published = { ...ctx, referenceTargets: scope.targets };
        m.partialPreparation = scope.stages;
      }
      shardsFor(stableStringify(published));
      write(tx, "update", stateRef(teamId), next, m);
      publishContext(teamId, next, published, m, tx);
      }); } catch (error) {
        if (error.code === "resource-exhausted") {
          await transact(m, async (tx) => {
            const s = (await read(stateRef(teamId), m, tx)).data();
            if (s?.ready && s.enabled) write(tx, "update", stateRef(teamId), preparationFields(s, desired(s)), m);
          });
        }
        throw error;
      }
    });
  }
  async function handleMembership(event) {
    const relevant = (d) => d && [d.name, d.role, memberGrades(d).sort(), d.staffScope, d.assignedStaff];
    if (stableStringify(relevant(event.data?.before.data() || null)) === stableStringify(relevant(event.data?.after.data() || null))) return;
    await restartForReferenceChange(event.params.teamId, { kind: "member", uid: event.params.uid });
  }
  async function handleTeam(event) {
    if (!event.data?.after.exists) return;
    if (stableStringify(event.data.before.data()?.channels) === stableStringify(event.data.after.data()?.channels)) return;
    await restartForReferenceChange(event.params.teamId, { kind: "channels" });
  }
  async function handleUser(event) {
    const before = event.data?.before.data() || null, after = event.data?.after.data() || null;
    if (stableStringify(before && [before.name, before.blockedUserUids]) === stableStringify(after && [after.name, after.blockedUserUids])) return;
    const teamIds = new Set([...(before?.teamIds || []), ...(after?.teamIds || []), before?.activeTeamId, after?.activeTeamId].filter(Boolean));
    for (const teamId of teamIds) await restartForReferenceChange(teamId, { kind: "user", uid: event.params.uid });
  }
  return { process, context, refreshLatest, prepare, prepareCallable, configureCallable, handleContent, handleReadState,
    handleEventDate, handleMembership, handleTeam, handlePreparation, handleUser, relatedTeamIds, anonymizeTeam };
}
module.exports = { createLoadingOptimizationBackend };
