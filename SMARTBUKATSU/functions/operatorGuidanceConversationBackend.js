const { createHash } = require("node:crypto");
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
const millis = (value) => value?.toMillis?.() || 0;
const hash = (...values) => createHash("sha256").update(JSON.stringify(values)).digest("hex");

function createOperatorGuidanceConversationBackend({ firestore, Timestamp, FieldPath, HttpsError, deliver, now, account, operator }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const threadRef = (id) => firestore.doc(`operatorGuidanceHistory/${id}`);
  const messageRef = (id) => firestore.doc(`operatorGuidanceMessages/${id}`);
  const read = (ref, transaction) => transaction ? transaction.get(ref) : ref.get();
  const summary = (id, data) => ({ id, title: data.title || "運営からのご案内", body: data.body || "",
    teamName: data.teamName || "", createdAt: millis(data.createdAt), mode: data.mode,
    messageCount: data.messageCount || 0, lastMessageAt: millis(data.lastMessageAt), lastMessageRole: data.lastMessageRole || "" });
  const message = (doc) => ({ id: doc.id, body: doc.data().body, senderRole: doc.data().senderRole, createdAt: millis(doc.data().createdAt) });

  async function authorize(request, transaction, forReply = false) {
    const uid = account(request), data = request.data || {}, historyId = data.historyId;
    if (!validId(historyId) || (data.asOperator != null && typeof data.asOperator !== "boolean")) fail("invalid-argument", "ご案内を選び直してください。");
    const asOperator = data.asOperator === true;
    if (asOperator) await operator(request, transaction);
    const ref = threadRef(historyId), snapshot = await read(ref, transaction);
    if (!snapshot.exists) fail("not-found", "ご案内が見つかりません。");
    const thread = snapshot.data();
    if (!asOperator && thread.targetUid !== uid) fail("permission-denied", "このご案内を確認できません。");
    const activeRecipient = validId(thread.targetUid) && thread.targetUid !== "deleted_user";
    // Only server-authorized replies can advance this count, so it also proves
    // prior delivery when an older unfinished record has lost its notification.
    let available = thread.notificationSaved === true || (Number.isSafeInteger(thread.messageCount) && thread.messageCount > 0);
    // Handles a response loss between notification storage and the history outcome update.
    if (!available && activeRecipient) {
      const note = await read(firestore.doc(`users/${thread.targetUid}/notifications/guidance_${historyId}`), transaction);
      available = note.data()?.category === "operatorGuidance" && note.data()?.source?.historyId === historyId;
    }
    if (!asOperator && !available) fail("permission-denied", "このご案内を確認できません。");
    if (forReply && (!available || !activeRecipient)) fail("failed-precondition", "このご案内には返信できません。");
    return { uid, asOperator, historyId, ref, thread, canReply: available && activeRecipient };
  }

  async function recoverAccess(request, prior) {
    const access = prior || await authorize(request);
    if (access.thread.notificationSaved === true || !access.canReply) return access;
    // Recheck both access and evidence inside the write transaction. Recovery
    // must not revive a recipient removed while the page was loading.
    return firestore.runTransaction(async (transaction) => {
      const current = await authorize(request, transaction);
      if (current.thread.notificationSaved !== true && current.canReply) {
        transaction.update(current.ref, { notificationSaved: true });
        return { ...current, thread: { ...current.thread, notificationSaved: true } };
      }
      return current;
    });
  }

  async function inbox(request) {
    const uid = account(request), cursor = request.data?.cursor;
    if (cursor != null && !validId(cursor)) fail("invalid-argument", "読み込み位置が正しくありません。");
    let query = firestore.collection("operatorGuidanceHistory").where("targetUid", "==", uid).orderBy(FieldPath.documentId()).limit(20);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    account(request);
    const items = [];
    for (const doc of page.docs) {
      if (doc.data().notificationSaved === true) { items.push(summary(doc.id, doc.data())); continue; }
      try {
        // Inbox requests cannot opt into the operator role or another account.
        const access = await recoverAccess({ auth: request.auth, data: { expectedUid: uid, historyId: doc.id } });
        if (access.canReply) items.push(summary(doc.id, access.thread));
      } catch (error) { if (!["permission-denied", "not-found"].includes(error.code)) throw error; }
    }
    return { items,
      cursor: page.size === 20 ? page.docs.at(-1).id : null };
  }

  async function conversation(request) {
    let access = await authorize(request);
    const prefix = `${access.historyId}_`, cursor = request.data?.cursor;
    if (cursor != null && (typeof cursor !== "string" || !cursor.startsWith(prefix) || !/^\d{12}$/.test(cursor.slice(prefix.length)))) {
      fail("invalid-argument", "会話の読み込み位置が正しくありません。");
    }
    access = await recoverAccess(request, access);
    // IDs encode the thread and sequence: no collection scan or composite index.
    const page = await firestore.collection("operatorGuidanceMessages").where("historyId", "==", access.historyId).orderBy(FieldPath.documentId(), "desc")
      .startAfter(cursor || `${prefix}\uf8ff`).endAt(prefix).limit(30).get();
    access = await authorize(request);
    return { thread: { ...summary(access.historyId, access.thread), ...(access.thread.content ? { content: access.thread.content } : {}), canReply: access.canReply, asOperator: access.asOperator },
      items: page.docs.map(message).reverse(), cursor: page.size === 30 ? page.docs.at(-1).id : null };
  }

  async function reply(request) {
    const uid = account(request), data = request.data || {}, text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text || text.length > 2000 || !/^[a-zA-Z0-9_-]{16,100}$/.test(data.requestId || "")) fail("invalid-argument", "返信は1〜2000文字で入力してください。");
    const operation = firestore.doc(`operatorGuidanceRequests/${hash("reply", uid, data.requestId)}`);
    const claim = await firestore.runTransaction(async (transaction) => {
      const access = await authorize(request, transaction, true), previous = await transaction.get(operation);
      const senderRole = access.asOperator ? "operator" : "recipient";
      if (previous.exists) {
        const value = previous.data();
        if (value.historyId !== access.historyId || value.textHash !== hash(text) || value.senderRole !== senderRole) fail("invalid-argument", "確認中の返信内容は変更できません。");
        if (access.thread.notificationSaved !== true) transaction.update(access.ref, { notificationSaved: true });
        return { existing: true, messageId: value.messageId };
      }
      const sequence = (access.thread.messageCount || 0) + 1;
      if (!Number.isSafeInteger(sequence) || sequence > 999999999999) fail("failed-precondition", "この会話には返信を追加できません。");
      const messageId = `${access.historyId}_${String(sequence).padStart(12, "0")}`, createdAt = Timestamp.fromMillis(now());
      transaction.create(messageRef(messageId), { historyId: access.historyId, senderUid: uid, targetUid: access.thread.targetUid,
        senderRole, body: text, createdAt, notificationStatus: "processing", notificationReason: "" });
      transaction.create(operation, { mode: "reply", historyId: access.historyId, messageId, senderUid: uid,
        targetUid: access.thread.targetUid, senderRole, textHash: hash(text) });
      transaction.update(access.ref, { notificationSaved: true, messageCount: sequence, lastMessageAt: createdAt, lastMessageRole: senderRole });
      return { ...access, messageId, senderRole };
    });
    if (claim.existing) {
      const saved = await messageRef(claim.messageId).get();
      await authorize(request);
      return { saved: true, messageId: claim.messageId, notificationStatus: saved.data()?.notificationStatus || "processing", replayed: true };
    }
    let outcome;
    const targetUid = claim.asOperator ? claim.thread.targetUid : claim.thread.senderUid;
    // A test recipient and its original operator intentionally share one UID.
    // Let this path exercise the same push/preferences checks as a real reply.
    const selfTestReply = !claim.asOperator && claim.thread.mode === "test" && targetUid === uid;
    try {
      if (!validId(targetUid) || targetUid === "deleted_user" || (targetUid === uid && !selfTestReply)) {
        outcome = { status: "unavailable", reason: targetUid === uid ? "self_reply" : "operator_removed" };
      } else {
        // Recipient replies notify the original sender only while they remain an operator.
        if (!claim.asOperator) await operator({ auth: { uid: targetUid } });
        outcome = await deliver(targetUid, { id: `guidance_reply_${hash(claim.messageId)}`, category: "operatorGuidance",
          teamId: claim.asOperator ? claim.thread.teamId : "", teamName: claim.thread.teamName || "",
          title: claim.asOperator ? "運営から返信が届きました" : "ご案内への返信が届きました",
          body: "運営とのやり取り画面で返信内容をご確認ください。",
          target: { screen: "OperatorGuidanceConversation", params: { historyId: claim.historyId, asOperator: !claim.asOperator } },
          source: { historyId: claim.historyId, messageId: claim.messageId } }, async (transaction) => {
          const current = await authorize(request, transaction, true);
          if ((claim.asOperator ? current.thread.targetUid : current.thread.senderUid) !== targetUid) fail("failed-precondition", "会話の参加者が変わりました。");
          if (!claim.asOperator) await operator({ auth: { uid: targetUid } }, transaction);
          if (!(await transaction.get(messageRef(claim.messageId))).exists) fail("failed-precondition", "返信が削除されています。");
        });
      }
    } catch (error) {
      outcome = { status: ["permission-denied", "failed-precondition"].includes(error.code) ? "unavailable" : "failed",
        reason: error.code === "permission-denied" ? "operator_removed" : "result_unknown" };
    }
    // Stored replies are never replayed to push after a timeout or lost response.
    try { await messageRef(claim.messageId).update({ notificationStatus: outcome.status, notificationReason: outcome.reason || "" }); }
    catch (error) { if (error.code !== 5 && error.code !== "not-found") throw error; }
    return { saved: true, messageId: claim.messageId, notificationStatus: outcome.status };
  }

  async function deleteAccountMessages(uid) {
    for (const field of ["senderUid", "targetUid"]) for (;;) {
      const page = await firestore.collection("operatorGuidanceMessages").where(field, "==", uid).limit(50).get();
      if (!page.size) break;
      const batch = firestore.batch(); for (const doc of page.docs) batch.delete(doc.ref); await batch.commit();
    }
  }
  return { inbox, conversation, reply, deleteAccountMessages };
}
module.exports = { createOperatorGuidanceConversationBackend };
