"use strict";
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { assertLocalBackend, CAPTURE_PROJECT, CAPTURE_PORTS } = require("../../src/config/captureEnvironment");
const backendRequire = createRequire(path.resolve(__dirname, "../../functions/package.json"));

async function seed() {
  assertLocalBackend(process.env);
  const { initializeApp, getApps } = backendRequire("firebase-admin/app");
  const { getAuth } = backendRequire("firebase-admin/auth");
  const { getFirestore, Timestamp } = backendRequire("firebase-admin/firestore");
  const { getStorage } = backendRequire("firebase-admin/storage");
  const app = getApps()[0] || initializeApp({ projectId: CAPTURE_PROJECT, storageBucket: `${CAPTURE_PROJECT}.appspot.com` });
  const db = getFirestore(app), auth = getAuth(app), teamId = "capture-team";
  if ((await db.doc(`teams/${teamId}`).get()).exists) {
    const sample = db.doc(`teams/${teamId}/workspacePosts/practice-post`);
    const current = await sample.get();
    if (current.exists && current.data().user === undefined) {
      await sample.update({ user: "管理者サンプル", replies: [], readBy: ["capture-admin"] });
    }
    return { reused: true };
  }
  const accounts = [
    ["admin", "管理者サンプル", "admin"], ["staff", "スタッフサンプル", "staff"],
    ["captain", "キャプテンサンプル", "captain"], ["member", "部員サンプルA", "member"],
    ["member-b", "部員サンプルB", "member"], ["guardian", "保護者サンプル", "guardian"],
  ];
  // Fictional credentials work only against the local, non-existent demo project.
  const password = "PracticeOnly-2026!";
  for (const [id, displayName] of accounts) {
    await auth.createUser({ uid: `capture-${id}`, email: `${id}@capture.invalid`, password, displayName, emailVerified: true });
  }
  const time = Timestamp.now(), date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
  const batch = db.batch(), uids = accounts.map(([id]) => `capture-${id}`);
  const invite = crypto.randomBytes(7).toString("hex").toUpperCase();
  batch.set(db.doc(`teams/${teamId}`), { name: "操作練習用チーム", createdBy: "capture-admin", createdAt: time,
    inviteCode: invite, grades: ["1年生", "2年生", "3年生"], positions: ["部員", "マネージャー"],
    sportCategory: "球技", sportName: "バスケットボール", channels: [{ id: "ch_1", name: "全体連絡", isReadOnly: true,
      shareScope: "roles", memberAudience: "all", allowedRoleGroups: ["staff", "captain", "member", "guardian"],
      notificationRecipientUids: ["capture-admin", "capture-staff"] }] });
  batch.set(db.doc(`invites/${invite}`), { teamId, active: true, createdBy: "capture-admin", createdAt: time });
  for (const [id, name, role] of accounts) {
    const uid = `capture-${id}`;
    batch.set(db.doc(`users/${uid}`), { name, email: `${id}@capture.invalid`, activeTeamId: teamId, teamIds: [teamId], createdAt: time });
    batch.set(db.doc(`teams/${teamId}/members/${uid}`), { name, role, joinedAt: time, grade: "1年生", grades: ["1年生"],
      groups: [], canUploadVideos: false, canEditTags: false, canEditCalendar: false, canPostTacticalNotes: false,
      ...(role === "guardian" ? { childUids: ["capture-member"] } : {}) });
    batch.set(db.doc(`users/${uid}/notificationPreferences/default`), { masterEnabled: true, categories: {}, teams: { [teamId]: true } });
  }
  batch.set(db.doc(`teams/${teamId}/clubEvents/practice-event`), { date, lastEventDate: date, type: "練習", title: "練習",
    startTime: "16:00", endTime: "18:00", details: "15:50集合。飲み物と室内シューズを持参。", description: "練習用の予定です。",
    createdBy: "capture-admin", createdAt: time, updatedAt: time, participants: "team", status: "active", attachments: [] });
  batch.set(db.doc(`teams/${teamId}/workspacePosts/practice-post`), { channel: "全体連絡", text: "【導入練習】明日の練習は16時からです。持ち物を確認しましょう。",
    content: "【導入練習】明日の練習は16時からです。持ち物を確認しましょう。", user: "管理者サンプル", authorUid: "capture-admin", replies: [], readBy: ["capture-admin"],
    visibleToUids: uids, createdAt: time, updatedAt: time, attachments: [], isPinned: false });
  batch.set(db.doc(`teams/${teamId}/tagGroups/practice-tags`), { name: "パス練習", tags: ["周囲の確認", "パス", "キャッチ"], createdAt: time, createdBy: "capture-admin", status: "active" });
  const videoUrl = `http://127.0.0.1:${CAPTURE_PORTS.assets}/practice.webm`;
  const tag = { id: "practice-scene", videoTime: 3, label: "周囲の確認 + パス", user: "管理者サンプル", uid: "capture-admin", createdBy: "capture-admin",
    status: "shared", preSeconds: 2, postSeconds: 3, useCustomClipDuration: false };
  batch.set(db.doc(`teams/${teamId}/projects/practice-video`), { title: "導入練習用・パス練習", type: "練習", participants: "team", videoUrl,
    date: date.replaceAll("-", "/"), status: "active", createdBy: "capture-admin", createdAt: time, updatedAt: time,
    tagGroupId: "practice-tags", tags: [tag], memos: [], sharedMemos: [], clipPreSeconds: 2, clipPostSeconds: 3 });
  batch.set(db.doc(`teams/${teamId}/highlightProjects/practice-project`), { title: "パス練習の振り返り", videoIds: ["practice-video"], status: "active", createdBy: "capture-admin", createdAt: time });
  const { buildTacticalNoteSummary } = require("../../functions/tacticalNoteCore");
  const note = { title: "パスを受ける前の準備", description: "受ける前に周囲を確認しましょう。添付の場面でタイミングを確認します。",
    authorUid: "capture-admin", authorName: "管理者サンプル", assigneeUids: ["capture-member", "capture-captain"],
    sourceProjectId: "practice-project", clips: [{ projectId: "practice-video", tagId: tag.id, sourceUrl: videoUrl,
      projectTitle: "導入練習用・パス練習", label: "周囲の確認", start: 1, end: 6, comment: "受ける前の視線に注目しましょう。" }],
    images: [], tasks: { "practice-task": { text: "次の練習で周囲を確認する動きを3回試す", assigneeUids: ["capture-member"], revision: 1 } },
    draft: false, contentVersion: 1, createdAt: time, updatedAt: time };
  batch.set(db.doc(`teams/${teamId}/tacticalNotes/practice-note`), note);
  batch.set(db.doc(`teams/${teamId}/tacticalNoteSummaries/practice-note`), buildTacticalNoteSummary(note, [], []));
  await batch.commit();
  // Synthetic teaching image. The actual UI will handle selecting/uploading images.
  const media = path.resolve(__dirname, "../../.codex-temp/android-capture/runtime/media/court.png");
  await getStorage(app).bucket().upload(media, { destination: "capture/court.png", metadata: { contentType: "image/png" } });
  return { reused: false, accountCount: accounts.length, teamId };
}
if (require.main === module) seed().then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { seed };
