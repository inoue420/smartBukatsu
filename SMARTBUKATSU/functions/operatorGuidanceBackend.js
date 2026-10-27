const { createHash } = require("node:crypto");
const { shouldSendPush } = require("./notificationCore");
const { createOperatorGuidanceConversationBackend } = require("./operatorGuidanceConversationBackend");

const GUIDE_URL = "https://sharprise.jp/smartbukatsu/guide/";
const FEATURE_TOPICS = ["members", "calendar", "communication", "video-clip", "tactics"];
function guidanceContent(title, introduction, features, closing) {
  const content = { title, introduction, features: features.map(({ topic, label }) => ({ topic, label,
    url: `${GUIDE_URL}#${topic}`, ...(topic === "members" ? { related: [{ label: "権限設定の説明", url: `${GUIDE_URL}#permissions` }] } : {}) })), closing };
  return { title, body: [introduction, features.map(({ label }) => `・${label}`).join("\n"), closing].filter(Boolean).join("\n\n"), content, url: GUIDE_URL };
}
const GUIDANCE_TEMPLATE = Object.freeze({ version: "guide-v3", ...guidanceContent("運営からのご案内",
  "弊社アプリのインストールおよびチームの作成をありがとうございます。\nこのアプリには下記機能が実装されています。",
  FEATURE_TOPICS.map((topic, i) => ({ topic, label: ["メンバーの招待(権限設定)", "予定表の作成共有(欠席連絡)", "全体連絡",
    "youtube動画の切り抜き・タグ付け", "切り抜いた動画を貼り付け議論ができる戦術ノート"][i] })),
  "これらの使用方法は、上記リンクをタップもしくは各画面に設置の操作ガイドからもご覧いただけます。まずはメンバーとの連絡手段として活用いただき、慣れてきたら動画タグ付けという流れをお勧めしています。\n\nプレーのタグ付けはyoutubeの限定公開やライブ動画に対しても行えます。また部員全員で切り抜きを分担できる機能も実装しており、負担の分散も可能。ぜひお試しください。\nもしチーム作成など初期設定でご不明点などありましたら、サポートさせていただきますのでこのチャットをご活用ください。\n\nSMARTBUKATSU運営チーム") });
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
const millis = (value) => value?.toMillis?.() || 0;
const key = (...values) => createHash("sha256").update(JSON.stringify(values)).digest("hex");

function createOperatorGuidanceBackend({ firestore, Timestamp, FieldPath, HttpsError, deliver, now = () => Date.now() }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const member = (teamId, uid) => firestore.doc(`teams/${teamId}/members/${uid}`);
  const receipt = (uid) => firestore.doc(`users/${uid}/operatorGuidanceState/initial`);
  function account(request) {
    const uid = request.auth?.uid;
    if (!uid) fail("unauthenticated", "ログインが必要です。");
    if (request.data?.expectedUid && request.data.expectedUid !== uid) fail("failed-precondition", "ログイン状態が変わりました。");
    return uid;
  }
  async function operator(request, transaction) {
    const uid = account(request);
    const read = (ref) => transaction ? transaction.get(ref) : ref.get();
    const invite = await read(firestore.doc("invites/AWUH95"));
    const teamId = invite.data()?.teamId;
    if (!validId(teamId) || !(await read(member(teamId, uid))).exists) {
      fail("permission-denied", "この操作は運営チーム所属者だけが利用できます。");
    }
    return uid;
  }
  async function access(request) {
    await operator(request);
    return { allowed: true, template: GUIDANCE_TEMPLATE, maxRecipients: 10 };
  }
  function cursorOf(request) {
    const cursor = request.data?.cursor;
    if (cursor != null && !validId(cursor)) fail("invalid-argument", "追加読み込み位置が正しくありません。");
    return cursor;
  }
  async function page(collection, cursor) {
    let query = firestore.collection(collection).orderBy(FieldPath.documentId()).limit(50);
    if (cursor) query = query.startAfter(cursor);
    const result = await query.get();
    return { docs: result.docs, cursor: result.docs.length === 50 ? result.docs.at(-1).id : null };
  }
  async function list(request) {
    await operator(request);
    const cursor = request.data?.cursor;
    if (cursor != null && (cursor.version !== 1 || !validId(cursor.id) ||
      (cursor.createdAt !== null && (!Number.isInteger(cursor.createdAt?.seconds) ||
        cursor.createdAt.seconds < -62135596800 || cursor.createdAt.seconds > 253402300799 ||
        !Number.isInteger(cursor.createdAt?.nanoseconds) || cursor.createdAt.nanoseconds < 0 || cursor.createdAt.nanoseconds > 999999999)))) {
      fail("invalid-argument", "追加読み込み位置が変わりました。一覧を更新してください。");
    }
    // Firestore's descending field index also orders document IDs descending.
    // Keep nanoseconds and the ID so equal creation times never skip a team.
    let query = firestore.collection("teams").orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc").limit(5);
    if (cursor) query = query.startAfter(cursor.createdAt === null ? null : new Timestamp(cursor.createdAt.seconds, cursor.createdAt.nanoseconds), cursor.id);
    const snapshot = await query.get(), last = snapshot.docs.at(-1);
    const lastCreatedAt = last?.data().createdAt;
    const result = { docs: snapshot.docs, cursor: snapshot.size === 5 ? { version: 1, id: last.id,
      createdAt: lastCreatedAt == null ? null : { seconds: lastCreatedAt.seconds, nanoseconds: lastCreatedAt.nanoseconds } } : null };
    const items = [];
    // Only enrich the five teams requested; usage counts stay on demand.
    for (const doc of result.docs) {
      // createdBy follows ownership transfers; originalCreatorUid is historical only.
      const data = doc.data(), creatorUid = validId(data.createdBy) && data.createdBy !== "deleted_user" ? data.createdBy : "";
      const [membership, initial, preferences] = creatorUid ? await Promise.all([
        member(doc.id, creatorUid).get(), receipt(creatorUid).get(),
        firestore.doc(`users/${creatorUid}/notificationPreferences/default`).get(),
      ]) : [];
      items.push({ id: doc.id, name: String(data.name || "名称未設定").slice(0, 120),
        createdAt: millis(data.createdAt), creatorUid, ownerUid: creatorUid,
        creatorName: String(membership?.data()?.name || "").slice(0, 120),
        ownerName: String(membership?.data()?.name || "").slice(0, 120),
        selectable: Boolean(creatorUid && membership?.exists),
        unavailableReason: !creatorUid ? "所有者不明" : !membership?.exists ? "所有者が未所属" : "",
        initialRecorded: initial?.exists === true,
        initialStatus: initial?.data()?.status || (initial?.exists ? "processing" : ""),
        pushEnabled: creatorUid ? shouldSendPush(preferences?.data(), "operatorGuidance", doc.id) : false,
      });
    }
    await operator(request);
    return { items, cursor: result.cursor };
  }
  async function usage(request) {
    await operator(request);
    const teamId = request.data?.teamId;
    if (!validId(teamId)) fail("invalid-argument", "チームを指定してください。");
    // Read-only transaction gives all nine counts the same snapshot, without writes.
    const counts = await firestore.runTransaction(async (transaction) => {
      await operator(request, transaction);
      if (!(await transaction.get(firestore.doc(`teams/${teamId}`))).exists) fail("not-found", "チームが見つかりません。");
      const count = async (query) => (await transaction.get(query.count())).data().count;
      const collection = (name) => firestore.collection(`teams/${teamId}/${name}`);
      const current = async (name, field, excluded) => {
        const ref = collection(name);
        const [total, removed] = await Promise.all([count(ref), count(ref.where(field, "==", excluded))]);
        return total - removed;
      };
      // At most two aggregation requests in flight. Missing legacy fields remain included.
      return { members: await count(collection("members")),
        events: await current("clubEvents", "status", "deleted"),
        videos: await current("projects", "status", "deleted"),
        viewingProjects: await current("highlightProjects", "status", "deleted"),
        tacticalNotes: await current("tacticalNotes", "draft", true) };
    }, { readOnly: true });
    await operator(request);
    return { teamId, counts, fetchedAt: now() };
  }
  async function history(request) {
    await operator(request);
    // IDs begin with reverse chronological time; one index and no full scan.
    const result = await page("operatorGuidanceHistory", cursorOf(request));
    await operator(request);
    return { items: result.docs.map((doc) => {
      const data = doc.data();
      return { ...data, id: doc.id, createdAt: millis(data.createdAt), completedAt: millis(data.completedAt), lastMessageAt: millis(data.lastMessageAt) };
    }), cursor: result.cursor };
  }
  async function validateTarget(transaction, request, teamId, expectedUid, test) {
    await operator(request, transaction);
    if (test) return;
    const team = await transaction.get(firestore.doc(`teams/${teamId}`));
    if (team.data()?.createdBy !== expectedUid || !(await transaction.get(member(teamId, expectedUid))).exists) {
      fail("failed-precondition", "所有者または所属が変わりました。一覧を更新してください。");
    }
  }
  async function send(request) {
    const senderUid = await operator(request), data = request.data || {};
    // This marker describes this invocation only. Clients must not discard an
    // earlier uncertain attempt merely because its later retry is rejected.
    const rejectBeforeSend = (message, refreshTemplate = false) => { throw new HttpsError("invalid-argument", message,
      { guidanceSendNotStarted: true, refreshTemplate }); };
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(data.requestId || "") || data.templateVersion !== GUIDANCE_TEMPLATE.version) {
      rejectBeforeSend("文面を再確認してから送信してください。", data.templateVersion !== GUIDANCE_TEMPLATE.version);
    }
    const draft = data.content ?? GUIDANCE_TEMPLATE.content;
    const validText = (value, max, optional = false) => typeof value === "string" && value.length <= max && (optional || value.trim().length > 0);
    if (!draft || !validText(draft.title, 120) || !validText(draft.introduction, 2000, true) || !validText(draft.closing, 3000, true) ||
      !Array.isArray(draft.features) || draft.features.length !== 5 || !draft.features.every((item, i) =>
        item?.topic === FEATURE_TOPICS[i] && validText(item.label, 200))) rejectBeforeSend("タイトルと5項目、案内文の文字数を確認してください。");
    // URLs are always rebuilt from server-owned topics, never accepted from the editor.
    const composed = guidanceContent(draft.title.trim(), draft.introduction.trim(), draft.features.map(({ topic, label }) => ({ topic, label: label.trim() })), draft.closing.trim());
    const contentHash = key(composed);
    const test = data.mode === "test", resend = data.mode === "resend";
    if (!["test", "initial", "resend"].includes(data.mode) || (resend && data.confirmResend !== true)) {
      rejectBeforeSend("再送には確認が必要です。");
    }
    const targets = test ? [""] : data.teamIds;
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > 10 || (!test && !targets.every(validId)) || new Set(targets).size !== targets.length) {
      rejectBeforeSend("対象チームは1〜10件で選択してください。");
    }
    if (!test && !targets.every((id) => validId(data.expectedOwnerUids?.[id]))) {
      rejectBeforeSend("アプリを更新し、現在の所有者を確認してから送信してください。");
    }
    const results = [], seen = new Set();
    for (const teamId of targets) {
      await operator(request);
      const team = test ? null : await firestore.doc(`teams/${teamId}`).get();
      const targetUid = test ? senderUid : data.expectedOwnerUids[teamId];
      if (!test && (!validId(team.data()?.createdBy) || team.data().createdBy === "deleted_user")) {
        results.push({ teamId, status: "unavailable", reason: "owner_unknown" }); continue;
      }
      if (!test && team.data().createdBy !== targetUid) {
        results.push({ teamId, status: "unavailable", reason: "membership_changed" }); continue;
      }
      if (seen.has(targetUid)) { results.push({ teamId, status: "unavailable", reason: "same_account" }); continue; }
      seen.add(targetUid);
      const requestRef = firestore.doc(`operatorGuidanceRequests/${key(senderUid, data.requestId, targetUid)}`);
      const id = `${String(9999999999999 - now()).padStart(13, "0")}_${key(senderUid, data.requestId, targetUid).slice(0, 32)}`;
      const historyRef = firestore.doc(`operatorGuidanceHistory/${id}`);
      let claim;
      try {
        claim = await firestore.runTransaction(async (transaction) => {
          await validateTarget(transaction, request, teamId, targetUid, test);
          const existing = await transaction.get(requestRef);
          if (existing.exists) {
            if (existing.data().mode !== data.mode || existing.data().teamId !== teamId || existing.data().contentHash !== contentHash) fail("invalid-argument", "同じ操作IDの内容は変更できません。");
            return { existing: existing.data() };
          }
          const initial = !test ? await transaction.get(receipt(targetUid)) : null;
          // One active operation per account, including explicit resends.
          const activeClaim = initial?.data()?.inFlight === true && now() - millis(initial.data().updatedAt) < 10 * 60 * 1000;
          if (activeClaim || (!test && !resend && initial?.exists)) return { duplicate: true };
          const record = { senderUid, targetUid, teamId, teamName: String(team?.data()?.name || "自分へのテスト").slice(0, 120),
            mode: data.mode, templateVersion: GUIDANCE_TEMPLATE.version, ...composed, createdAt: Timestamp.fromMillis(now()),
            status: "processing", reason: "", notificationSaved: false, historyId: id };
          transaction.create(historyRef, record);
          transaction.create(requestRef, { historyId: id, teamId, mode: data.mode, senderUid, targetUid, contentHash });
          if (!test) transaction.set(receipt(targetUid), { historyId: id, inFlight: true, status: "processing", updatedAt: record.createdAt });
          return { record };
        });
      } catch (error) {
        if (error.code === "permission-denied" || error.code === "unauthenticated") throw error;
        if (error.code !== "failed-precondition") throw error;
        results.push({ teamId, status: "unavailable", reason: "membership_changed" }); continue;
      }
      if (claim.existing) {
        const old = await firestore.doc(`operatorGuidanceHistory/${claim.existing.historyId}`).get();
        results.push({ teamId, historyId: claim.existing.historyId, status: old.data()?.status || "processing", reason: old.data()?.reason || "" }); continue;
      }
      if (claim.duplicate) { results.push({ teamId, status: "unavailable", reason: "initial_recorded_or_processing" }); continue; }
      let outcome;
      try {
        outcome = await deliver(targetUid, { id: `guidance_${id}`, category: "operatorGuidance", teamId,
          teamName: claim.record.teamName, title: claim.record.title, body: claim.record.body,
          target: { screen: "OperatorGuidanceConversation", params: { historyId: id } }, source: { historyId: id, templateVersion: GUIDANCE_TEMPLATE.version } },
        async (transaction) => {
          await validateTarget(transaction, request, teamId, targetUid, test);
          if (!test && (await transaction.get(receipt(targetUid))).data()?.historyId !== id) fail("failed-precondition", "別の送信操作が開始されています。");
        });
      } catch (error) {
        outcome = { status: error.code === "failed-precondition" || error.code === "permission-denied" ? "unavailable" : "failed",
          reason: error.code === "failed-precondition" ? "membership_changed" : error.code === "permission-denied" ? "operator_removed" : "result_unknown" };
      }
      // A crash before this update leaves processing visible, never auto-replays.
      await firestore.runTransaction(async (transaction) => {
        const current = !test ? await transaction.get(receipt(targetUid)) : null;
        transaction.update(historyRef, { ...outcome, completedAt: Timestamp.fromMillis(now()) });
        if (!test && current.data()?.historyId === id) transaction.set(receipt(targetUid), { historyId: id, inFlight: false, status: outcome.status, updatedAt: Timestamp.fromMillis(now()) });
      });
      results.push({ teamId, historyId: id, ...outcome });
    }
    return { results };
  }
  async function anonymizeAccount(uid) {
    for (const field of ["senderUid", "targetUid"]) {
      for (const collection of ["operatorGuidanceHistory", "operatorGuidanceRequests"]) {
        for (;;) {
          const page = await firestore.collection(collection).where(field, "==", uid).limit(50).get();
          if (!page.docs.length) break;
          const batch = firestore.batch();
          for (const doc of page.docs) {
            if (collection === "operatorGuidanceRequests") batch.delete(doc.ref);
            else batch.update(doc.ref, { [field]: "deleted_user",
              ...(field === "targetUid" && doc.data().content ? { title: "運営からのご案内", body: "受信者の退会に伴い案内本文を削除しました。", content: null } : {}) });
          }
          await batch.commit();
        }
      }
    }
    // Revoke thread access before deleting messages, so a concurrent reply cannot escape cleanup.
    await conversations.deleteAccountMessages(uid);
  }
  const conversations = createOperatorGuidanceConversationBackend({ firestore, Timestamp, FieldPath, HttpsError, deliver, now, account, operator });
  return { access, list, usage, history, send, anonymizeAccount, inbox: conversations.inbox, conversation: conversations.conversation, reply: conversations.reply };
}
module.exports = { createOperatorGuidanceBackend, GUIDANCE_TEMPLATE };
