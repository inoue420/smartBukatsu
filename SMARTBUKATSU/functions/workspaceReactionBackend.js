const EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🙏"];
const receiptId = (teamId, postId) => `${encodeURIComponent(teamId)}:${encodeURIComponent(postId)}`;
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 128 && !id.includes("/");
const hasLegacy = (post) => Object.hasOwn(post, "reactionUserUids");
function validLegacy(post) {
  const legacy = post.reactionUserUids ?? {};
  return typeof legacy === "object" && !Array.isArray(legacy) &&
    Object.entries(legacy).every(([uid, emoji]) => validId(uid) && typeof emoji === "string" && emoji.length > 0 && emoji.length <= 32);
}

function createWorkspaceReactionBackend({ firestore, FieldValue, HttpsError }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const receipt = (uid, teamId, postId) => firestore.collection("users").doc(uid)
    .collection("workspaceReactionReceipts").doc(receiptId(teamId, postId));
  const anchor = (uid, teamId) => firestore.collection("users").doc(uid).collection("workspaceReactionTeams").doc(teamId);
  const detail = (teamId, postId) => firestore.collection("teams").doc(teamId).collection("workspacePostReactionDetails").doc(postId);
  const anchors = (tx, teamId, uids) => {
    for (const uid of new Set(uids.filter(validId))) tx.set(anchor(uid, teamId), { teamId });
  };
  async function submit(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "ログインが必要です。");
    const { teamId, postId, emoji } = request.data || {};
    if (!validId(teamId) || !validId(postId) || !EMOJIS.includes(emoji)) fail("invalid-argument", "スタンプの指定が正しくありません。");
    const team = firestore.collection("teams").doc(teamId), postRef = team.collection("workspacePosts").doc(postId), privateRef = detail(teamId, postId);
    return firestore.runTransaction(async (tx) => {
      const [member, snapshot] = await Promise.all([
        tx.get(team.collection("members").doc(uid)), tx.get(postRef),
      ]);
      if (!member.exists || !["owner", "admin", "staff", "captain", "member", "guardian"].includes(member.data().role)) fail("permission-denied", "チームへの所属を確認してください。");
      if (!snapshot.exists) fail("not-found", "投稿が見つかりません。");
      const post = snapshot.data();
      if (post.status === "deleted" || post.moderationStatus === "hidden" ||
        (Array.isArray(post.visibleToUids) && !post.visibleToUids.includes(uid))) fail("permission-denied", "この投稿にはスタンプを送れません。");
      if (hasLegacy(post) || post.reactionMigrationPending) fail("failed-precondition", "スタンプ情報の移行が必要です。管理者にお問い合わせください。");
      const privateSnapshot = await tx.get(privateRef);
      const previous = privateSnapshot.data() || {}, reactors = previous.reactors || {};
      const own = Object.hasOwn(reactors, uid) ? reactors[uid] : null;
      const selected = own || emoji;
      tx.set(receipt(uid, teamId, postId), { teamId, postId, emoji: selected });
      anchors(tx, teamId, [uid, privateSnapshot.exists ? previous.authorUid : post.authorUid]);
      if (own) return { added: false, emoji: own };
      const count = post.reactions?.[emoji] || 0;
      if (!Number.isSafeInteger(count) || count < 0) fail("failed-precondition", "スタンプ件数を確認してください。");
      tx.set(privateRef, { authorUid: privateSnapshot.exists ? previous.authorUid || "" : post.authorUid || "",
        reactors: { ...reactors, [uid]: emoji }, updatedAt: FieldValue.serverTimestamp() });
      tx.update(postRef, { reactions: { ...(post.reactions || {}), [emoji]: count + 1 },
        reactionPrivacyVersion: 1, updatedAt: FieldValue.serverTimestamp() });
      return { added: true, emoji };
    });
  }

  async function migratePost(postRef) {
    const prepared = await firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(postRef);
      if (!snapshot.exists) return false;
      const post = snapshot.data();
      if (!hasLegacy(post) && post.reactionPrivacyVersion === 1) return false;
      const teamId = postRef.parent.parent.id, postId = postRef.id, privateRef = detail(teamId, postId);
      const previous = await tx.get(privateRef);
      const legacy = post.reactionUserUids ?? {};
      if (!validLegacy(post)) {
        fail("failed-precondition", "旧スタンプ形式を確認してください。移行は適用していません。");
      }
      const reactors = { ...legacy, ...(previous.data()?.reactors || {}) };
      const authorUid = previous.exists ? previous.data().authorUid || "" : post.authorUid || "";
      tx.set(privateRef, { authorUid, reactors, updatedAt: FieldValue.serverTimestamp() });
      tx.update(postRef, { reactionUserUids: FieldValue.delete(), reactionPrivacyVersion: 0, reactionMigrationPending: true });
      return { teamId, postId, reactors, authorUid };
    });
    if (!prepared) return false;
    // Receipts can exceed a transaction's write limit. BulkWriter bounds commits,
    // and the pending marker allows a failed migration to resume safely.
    const { teamId, postId, reactors, authorUid } = prepared;
    const writer = firestore.bulkWriter();
    const writes = [];
    for (const [uid, emoji] of Object.entries(reactors)) writes.push(writer.set(receipt(uid, teamId, postId), { teamId, postId, emoji }));
    for (const uid of new Set([...Object.keys(reactors), authorUid].filter(validId))) writes.push(writer.set(anchor(uid, teamId), { teamId }));
    await Promise.all([writer.close(), ...writes]);
    await firestore.runTransaction(async (tx) => {
      const snapshot = await tx.get(postRef);
      if (snapshot.exists && snapshot.data().reactionMigrationPending) {
        tx.update(postRef, { reactionMigrationPending: FieldValue.delete(), reactionPrivacyVersion: 1 });
      }
    });
    return true;
  }

  async function relatedTeamIds(uid) {
    return (await firestore.collection("users").doc(uid).collection("workspaceReactionTeams").get()).docs.map((item) => item.id);
  }
  async function anonymizeTeam(team, uid) {
    let changed = 0;
    const receipts = firestore.collection("users").doc(uid).collection("workspaceReactionReceipts");
    for (;;) {
      const page = await receipts.where("teamId", "==", team.id).limit(100).get();
      if (page.empty) break;
      for (const item of page.docs) {
        const postId = item.data().postId;
        const removed = await firestore.runTransaction(async (tx) => {
          let modified = false;
          if (validId(postId)) {
            const ref = detail(team.id, postId), snapshot = await tx.get(ref);
            if (snapshot.exists && Object.hasOwn(snapshot.data().reactors || {}, uid)) {
              const reactors = { ...snapshot.data().reactors };
              delete reactors[uid];
              tx.update(ref, { reactors, updatedAt: FieldValue.serverTimestamp() });
              modified = true;
            }
          }
          tx.delete(item.ref);
          return modified;
        });
        if (removed) changed++;
      }
    }
    for (;;) {
      const page = await team.collection("workspacePostReactionDetails").where("authorUid", "==", uid).limit(100).get();
      if (page.empty) break;
      const writer = firestore.batch();
      for (const item of page.docs) { writer.update(item.ref, { authorUid: "" }); changed++; }
      await writer.commit();
    }
    return changed;
  }
  return { submit, migratePost, relatedTeamIds, anonymizeTeam };
}

async function migrateWorkspaceReactionsPage({ firestore, backend, FieldPath, teamId, cursor = null, apply = false, pageSize = 100 }) {
  if (!validId(teamId) || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Invalid migration bounds");
  let query = firestore.collection("teams").doc(teamId).collection("workspacePosts").orderBy(FieldPath.documentId()).limit(pageSize);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get(), totals = { scanned: page.size, eligible: 0, migrated: 0, invalid: 0 };
  for (const item of page.docs) {
    if (!hasLegacy(item.data()) && item.data().reactionPrivacyVersion === 1) continue;
    totals.eligible++;
    if (!validLegacy(item.data())) {
      totals.invalid++;
      if (apply) throw new Error("Invalid legacy data; this page has not been marked complete");
      continue;
    }
    if (apply && await backend.migratePost(item.ref)) totals.migrated++;
  }
  return { cursor: page.docs.at(-1)?.id || cursor, complete: page.size < pageSize, totals };
}
module.exports = { createWorkspaceReactionBackend, migrateWorkspaceReactionsPage, receiptId };
