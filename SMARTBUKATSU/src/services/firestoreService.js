import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  query,
  orderBy,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  getDocs,
  runTransaction,
  where,
  writeBatch,
  limit,
  startAfter,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { measuredOnSnapshot } from "./firestoreSubscription";
import { auth, db, cloudFunctions } from "../firebase";
import { LEGAL_POLICY_VERSION, MINIMUM_USER_AGE } from "../legal";
import { validateNote, contentFingerprint, validateTasks, noteAcknowledgementId, isNoteSummaryCurrent, timestampsEqual } from "../utils/tacticalNotes";
import { uploadTacticalNoteImage } from "./tacticalNoteAttachmentService";
const eventLastDate = (data) => [...(data.selectedDates || [])].sort().at(-1) || data.endDate || data.date;

const TACTICAL_PAGE_SIZE = 30;
const TACTICAL_HISTORY_PAGE_SIZE = 20;
const tacticalItems = (snapshot) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
const tacticalPage = (snapshot, size) => ({ items: tacticalItems(snapshot), cursor: snapshot.docs.at(-1) || null, hasMore: snapshot.size === size });
function tacticalSummaryQuery(teamId, filter, uid, cursor) {
  const clauses = [where("draft", "==", false)];
  const arrayFilters = { mine: "mineUids", unconfirmed: "pendingUids" };
  const flags = { tasks: "hasTasks", unfinished: "unfinished", completed: "completed" };
  if (arrayFilters[filter]) clauses.push(where(arrayFilters[filter], "array-contains", uid));
  if (flags[filter]) clauses.push(where(flags[filter], "==", true));
  clauses.push(orderBy("createdAt", "desc"));
  if (cursor) clauses.push(startAfter(cursor));
  return query(collection(db, "teams", teamId, "tacticalNoteSummaries"), ...clauses, limit(TACTICAL_PAGE_SIZE));
}
export function subscribeTacticalNoteSummaries(teamId, filter, uid, callback, onError) {
  return measuredOnSnapshot("tacticalNoteSummaries", tacticalSummaryQuery(teamId, filter, uid),
    (snapshot) => callback(tacticalPage(snapshot, TACTICAL_PAGE_SIZE)), onError);
}
export async function getTacticalNoteSummaryPage(teamId, filter, uid, cursor) {
  return tacticalPage(await getDocs(tacticalSummaryQuery(teamId, filter, uid, cursor)), TACTICAL_PAGE_SIZE);
}
export async function ensureTacticalNoteSummaries(teamId) {
  return (await httpsCallable(cloudFunctions, "ensureTacticalNoteSummaries")({ teamId })).data;
}
export function subscribeTacticalNote(teamId, noteId, callback, onError) {
  return measuredOnSnapshot("tacticalNote", doc(db, "teams", teamId, "tacticalNotes", noteId),
    (snapshot) => callback(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null), onError);
}
export function subscribeTacticalNoteSummary(teamId, noteId, callback, onError) {
  return measuredOnSnapshot("tacticalNoteSummary", doc(db, "teams", teamId, "tacticalNoteSummaries", noteId),
    (snapshot) => callback(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null), onError);
}

export async function saveTacticalNote(teamId, noteId, data, authorName, memberUids = []) {
  validateNote(data);
  validateTasks(data.tasks, data.clips, memberUids);
  if ((data.images || []).length > 6) throw new Error("画像は6枚までです。");
  const target = noteId ? doc(db, "teams", teamId, "tacticalNotes", noteId) : doc(collection(db, "teams", teamId, "tacticalNotes"));
  const before = await getDoc(target);
  const old = before.data();
  if (noteId && (!old || (data.baseUpdatedAt && !timestampsEqual(old.updatedAt, data.baseUpdatedAt)) || (data.baseContentVersion && (old.contentVersion || 1) !== data.baseContentVersion))) throw new Error("ノートが変更または削除されています。一覧に戻って開き直してください。");
  // Create the permission anchor before uploading a new note's images.
  if (!before.exists()) await setDoc(target, { title: data.title.trim(), description: data.description,
    assigneeUids: data.assigneeUids, clips: data.clips, sourceProjectId: data.sourceProjectId,
    images: [], tasks: {}, contentVersion: 1, draft: true,
    authorUid: auth.currentUser.uid, authorName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  try {
    const images = [];
    for (const image of data.images || []) {
      if (image.pending) images.push(await uploadTacticalNoteImage(teamId, target.id, image));
      else images.push(image);
    }
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(target), current = snapshot.data();
      if (!snapshot.exists()) throw new Error("ノートが削除されました。");
      if (old && (!timestampsEqual(current.updatedAt, old.updatedAt) || (current.contentVersion || 1) !== (old.contentVersion || 1))) throw new Error("他の編集が保存されています。一覧に戻って開き直してください。");
      for (const image of (data.images || []).filter((item) => item.pending)) {
        const upload = (await transaction.get(doc(target, "attachmentUploads", image.id))).data();
        if (!upload || upload.cleanupClaimedAt) throw new Error("画像の保存情報が期限切れになりました。画像を選び直してください。");
      }
      const tasks = Object.fromEntries(Object.entries(data.tasks || {}).map(([id, task]) => {
        const previous = current.tasks?.[id];
        const unchanged = previous && JSON.stringify([previous.text, previous.assigneeUids]) === JSON.stringify([task.text.trim(), task.assigneeUids]);
        return [id, { text: task.text.trim(), assigneeUids: task.assigneeUids, revision: unchanged ? previous.revision : (previous?.revision || 0) + 1 }];
      }));
      const payload = { title: data.title.trim(), description: data.description, assigneeUids: data.assigneeUids,
        clips: data.clips, sourceProjectId: data.sourceProjectId, images, tasks, draft: false,
        contentVersion: (current.contentVersion || 1) + (contentFingerprint(current) !== contentFingerprint({ ...data, images }) ? 1 : 0), updatedAt: serverTimestamp() };
      transaction.update(target, payload);
    });
    return { id: target.id, cleanupPending: false };
  } catch (error) {
    // Registered uploads survive a failed edit and can be reused on retry.
    // Deleting only a new draft allows the server to retry all cleanup safely.
    if (!before.exists()) await runTransaction(db, async (transaction) => {
      const current = await transaction.get(target);
      if (current.exists() && current.data().draft === true) transaction.delete(target);
    }).catch(() => {});
    throw error;
  }
}

export function updateTacticalNoteDescription(teamId, noteId, description, base) {
  if (typeof description !== "string" || description.length > 5000) throw new Error("全体コメントは5000文字以内で入力してください。");
  const target = doc(db, "teams", teamId, "tacticalNotes", noteId);
  return runTransaction(db, async (transaction) => {
    const note = (await transaction.get(target)).data();
    if (!note) throw new Error("ノートが削除されました。");
    if (!base || !timestampsEqual(note.updatedAt, base.updatedAt) || (note.contentVersion || 1) !== (base.contentVersion || 1)) {
      throw new Error("他の編集が保存されています。開き直して確認してください。");
    }
    transaction.update(target, { description, updatedAt: serverTimestamp(),
      contentVersion: (note.contentVersion || 1) + (note.description !== description ? 1 : 0) });
  });
}
export function deleteTacticalNote(teamId, noteId) {
  return deleteDoc(doc(db, "teams", teamId, "tacticalNotes", noteId));
}
export function subscribeTacticalNoteActivity(teamId, note, uid, callback, onError) {
  const parent = doc(db, "teams", teamId, "tacticalNotes", note.id);
  const taskIds = Object.keys(note.tasks || {});
  const state = { responses: [], progress: [] }, ready = new Set(taskIds.length ? [] : ["progress"]);
  const receive = (name) => (snapshot) => {
    state[name] = tacticalItems(snapshot); ready.add(name);
    if (ready.size === 2) callback({ ...state });
  };
  const stops = [measuredOnSnapshot("tacticalNote-responses", query(collection(parent, "responses"),
    where("uid", "==", uid), where("version", "==", note.contentVersion || 1), where("status", "in", ["read", "understood"])), receive("responses"), onError)];
  if (taskIds.length) stops.push(measuredOnSnapshot("tacticalNote-progress", query(collection(parent, "progress"), where("taskId", "in", taskIds)), receive("progress"), onError));
  return () => stops.forEach((stop) => stop());
}
export async function getTacticalNoteQuestions(teamId, noteId, cursor = null) {
  const clauses = [where("status", "==", "question"), orderBy("createdAt", "desc")];
  if (cursor) clauses.push(startAfter(cursor));
  return tacticalPage(await getDocs(query(collection(db, "teams", teamId, "tacticalNotes", noteId, "responses"), ...clauses, limit(TACTICAL_HISTORY_PAGE_SIZE))), TACTICAL_HISTORY_PAGE_SIZE);
}
export async function getTacticalNoteReplies(teamId, noteId, responseId, cursor = null) {
  const clauses = [where("responseId", "==", responseId), orderBy("createdAt", "desc")];
  if (cursor) clauses.push(startAfter(cursor));
  return tacticalPage(await getDocs(query(collection(db, "teams", teamId, "tacticalNotes", noteId, "replies"), ...clauses, limit(TACTICAL_HISTORY_PAGE_SIZE))), TACTICAL_HISTORY_PAGE_SIZE);
}
export async function getTacticalNoteHistory(teamId, noteId, { responseCursor, progressCursor } = {}) {
  const parent = doc(db, "teams", teamId, "tacticalNotes", noteId);
  const fetchPage = async (name, field, cursor) => {
    if (cursor === false) return { items: [], cursor: false, hasMore: false };
    const clauses = [orderBy(field, "desc")];
    if (cursor) clauses.push(startAfter(cursor));
    return tacticalPage(await getDocs(query(collection(parent, name), ...clauses, limit(TACTICAL_HISTORY_PAGE_SIZE))), TACTICAL_HISTORY_PAGE_SIZE);
  };
  const [responses, progress] = await Promise.all([fetchPage("responses", "createdAt", responseCursor), fetchPage("progressHistory", "updatedAt", progressCursor)]);
  return { responses: responses.items, progressHistory: progress.items, responseCursor: responses.cursor,
    progressCursor: progress.cursor, hasMoreResponses: responses.hasMore, hasMoreProgress: progress.hasMore };
}
export async function recordTacticalNoteResponse(teamId, note, status, text = "") {
  if (!["read", "understood", "question"].includes(status) || text.length > 2000 || (status === "question" && !text.trim())) throw new Error("質問本文を入力してください（2000文字以内）。");
  const uid = auth.currentUser.uid, version = note.contentVersion || 1;
  const parent = doc(db, "teams", teamId, "tacticalNotes", note.id);
  const index = doc(db, "teams", teamId, "tacticalNoteSummaries", note.id);
  const responses = collection(parent, "responses");
  if (status !== "question") {
    // Narrowly check legacy auto-ID records without fetching the person's entire history.
    const existing = await getDocs(query(responses, where("uid", "==", uid), where("version", "==", version), where("status", "==", status), limit(1)));
    if (existing.docs.length) return;
  }
  const target = status === "question" ? doc(responses) : doc(responses, noteAcknowledgementId(note, uid, status));
  return runTransaction(db, async (transaction) => {
    const current = (await transaction.get(parent)).data();
    const summary = (await transaction.get(index)).data();
    const saved = await transaction.get(target);
    if (!current || (current.contentVersion || 1) !== version || !current.assigneeUids?.includes(uid) || !isNoteSummaryCurrent(current, summary)) {
      throw new Error("内容または確認対象者が変更されています。少し待って開き直してください。");
    }
    if (saved.exists()) return;
    transaction.set(target, { uid, version, status, text: status === "question" ? text.trim() : "", createdAt: serverTimestamp(),
      ...(status === "question" ? { resolved: false, resolvedAt: null, resolvedBy: null } : {}) });
  });
}
export function resolveTacticalNoteQuestion(teamId, noteId, responseId) {
  const target = doc(db, "teams", teamId, "tacticalNotes", noteId, "responses", responseId);
  return runTransaction(db, async (transaction) => {
    const response = (await transaction.get(target)).data();
    if (!response || response.status !== "question" || response.uid !== auth.currentUser.uid) throw new Error("質問した本人だけが解決済みにできます。");
    if (response.resolved === true) return;
    transaction.update(target, { resolved: true, resolvedAt: serverTimestamp(), resolvedBy: auth.currentUser.uid });
  });
}
export function replyTacticalNoteQuestion(teamId, noteId, responseId, text) {
  if (!text.trim() || text.length > 2000) throw new Error("返信は1〜2000文字で入力してください。");
  return addDoc(collection(db, "teams", teamId, "tacticalNotes", noteId, "replies"),
    { responseId, uid: auth.currentUser.uid, text: text.trim(), createdAt: serverTimestamp() });
}
export async function recordTacticalTaskProgress(teamId, noteId, taskId, uid, status, comment = "", expectedRevision) {
  if (!["done", "pending", "returned"].includes(status) || comment.length > 2000 || (status === "returned" && !comment.trim())) throw new Error("差し戻し理由を入力してください（2000文字以内）。");
  const parent = doc(db, "teams", teamId, "tacticalNotes", noteId);
  const target = doc(parent, "progress", `${taskId}_${uid}`);
  const history = doc(collection(parent, "progressHistory"));
  return runTransaction(db, async (transaction) => {
    const note = (await transaction.get(parent)).data();
    const task = note?.tasks?.[taskId];
    if (!task?.assigneeUids.includes(uid)) throw new Error("担当者またはタスクが変更されました。");
    if (task.revision !== expectedRevision) throw new Error("タスクが変更されています。新しい内容を確認してから報告してください。");
    const data = { taskId, uid, taskRevision: task.revision, status, comment: comment.trim(),
      updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp(), completedAt: status === "done" ? serverTimestamp() : null };
    transaction.set(target, data); transaction.set(history, { ...data, taskText: task.text });
  });
}
export const DEFAULT_MAX_TEAMS_PER_USER = 5;
export const SHARP_RISE_MAX_TEAMS_PER_USER = 100;
export const SHARP_RISE_INVITE_CODE = "AWUH95";
const INVITE_CODE_LENGTH = 6;
const AMBIGUOUS_INVITE_CODE_CHARACTERS = /[IlO0]/;

export function getMaxTeamsForMemberships(teams = [], inviteCode = "") {
  const isJoiningSharpRise = inviteCode.trim() === SHARP_RISE_INVITE_CODE;
  const isSharpRiseMember = teams.some(
    (team) => team?.inviteCode === SHARP_RISE_INVITE_CODE,
  );

  return isJoiningSharpRise || isSharpRiseMember
    ? SHARP_RISE_MAX_TEAMS_PER_USER
    : DEFAULT_MAX_TEAMS_PER_USER;
}

function generateInviteCode() {
  let candidate = "";

  do {
    candidate = doc(collection(db, "invites")).id.slice(0, INVITE_CODE_LENGTH);
  } while (
    AMBIGUOUS_INVITE_CODE_CHARACTERS.test(candidate) ||
    !/[a-z]/.test(candidate) ||
    !/[A-Z]/.test(candidate) ||
    !/[0-9]/.test(candidate)
  );

  return candidate;
}

function subscribeToTeamData(name, reference, callback) {
  return measuredOnSnapshot(name, reference, callback, (error) => {
    if (error?.code === "permission-denied") {
      return;
    }
    console.log("Team snapshot listener error:", error);
  });
}

function normalizeTeamIds(data = {}) {
  const ids = Array.isArray(data.teamIds)
    ? data.teamIds.filter((id) => typeof id === "string" && id)
    : [];
  const activeTeamId =
    typeof data.activeTeamId === "string" && data.activeTeamId
      ? data.activeTeamId
      : null;
  return [...new Set([...ids, ...(activeTeamId ? [activeTeamId] : [])])];
}

async function assertCanAddTeam(uid, teamId = null) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const teamIds = userSnap.exists() ? normalizeTeamIds(userSnap.data()) : [];

  if (teamId && teamIds.includes(teamId)) return teamIds;
  const teams = teamIds.length > 0 ? await getUserTeams(uid) : [];
  const maxTeamsPerUser = getMaxTeamsForMemberships(teams);

  if (teamIds.length >= maxTeamsPerUser) {
    throw new Error(`所属できるチームは最大${maxTeamsPerUser}件までです。`);
  }
  return teamIds;
}

async function rememberTeamMembership(uid, teamId) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);
  const currentTeamIds = userSnap.exists()
    ? normalizeTeamIds(userSnap.data())
    : [];
  const nextTeamIds = [...new Set([...currentTeamIds, teamId])];

  await setDoc(
    userRef,
    { activeTeamId: teamId, teamIds: nextTeamIds },
    { merge: true },
  );
}

export async function getUserTeams(uid) {
  if (!uid) return [];

  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) return [];

  const teamIds = normalizeTeamIds(userSnap.data());
  const teams = await Promise.all(
    teamIds.map(async (teamId) => {
      const [teamSnap, memberSnap] = await Promise.all([
        getDoc(doc(db, "teams", teamId)),
        getDoc(doc(db, "teams", teamId, "members", uid)),
      ]);

      if (!teamSnap.exists() || !memberSnap.exists()) return null;

      const teamData = teamSnap.data() || {};
      const memberData = memberSnap.data() || {};
      return {
        id: teamId,
        name: teamData.name || "名称未設定のチーム",
        role: memberData.role || "member",
        inviteCode: teamData.inviteCode || "",
        absenceDeadlineDaysBefore: teamData.absenceDeadlineDaysBefore,
      };
    }),
  );

  return teams.filter(Boolean);
}

export async function switchActiveTeam(uid, teamId) {
  if (!uid || !teamId) throw new Error("ユーザーまたはチーム情報を確認できませんでした。");

  const memberSnap = await getDoc(doc(db, "teams", teamId, "members", uid));
  if (!memberSnap.exists()) {
    throw new Error("このチームへの所属を確認できませんでした。");
  }

  await rememberTeamMembership(uid, teamId);
}

export async function createTeam(uid, teamName, userName = "ゲスト", sport = {}) {
  if (!uid) throw new Error("ユーザー情報を確認できませんでした。");
  const trimmedTeamName = (teamName || "").trim();
  if (!trimmedTeamName) throw new Error("チーム名を入力してください。");
  const sportCategory = typeof sport.category === "string" ? sport.category : "";
  const sportName = typeof sport.name === "string" ? sport.name : "";
  const customSportName = typeof sport.customName === "string" ? sport.customName.trim() : "";
  if (!sportCategory || !sportName) throw new Error("スポーツの分類と競技を選択してください。");
  if (["その他スポーツ", "その他文化部"].includes(sportName) && !customSportName) {
    throw new Error("競技名を入力してください。");
  }

  await assertCanAddTeam(uid);

  const newTeamRef = doc(collection(db, "teams"));
  const teamId = newTeamRef.id;
  const generatedInviteCode = generateInviteCode();

  await setDoc(newTeamRef, {
    name: trimmedTeamName,
    createdBy: uid,
    inviteCode: generatedInviteCode,
    createdAt: serverTimestamp(),
    grades: ["1年生", "2年生", "3年生"],
    positions: ["GK", "CP", "マネージャー"],
    sportCategory,
    sportName,
    ...(customSportName ? { customSportName } : {}),
  });

  await setDoc(doc(db, "teams", teamId, "members", uid), {
    name: userName || "ゲスト",
    role: "admin",
    joinedAt: serverTimestamp(),
  });

  await rememberTeamMembership(uid, teamId);
  await setDoc(doc(db, "invites", generatedInviteCode), {
    teamId: teamId,
    active: true,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });

  return { inviteCode: generatedInviteCode, teamId, type: "create" };
}

export async function joinTeamWithInvite(uid, inviteCodeInput, userName = "ゲスト") {
  if (!uid) throw new Error("ユーザー情報を確認できませんでした。");
  const inviteCode = (inviteCodeInput || "").trim();
  if (!inviteCode) throw new Error("招待コードを入力してください。");

  const joinTeam = httpsCallable(cloudFunctions, "joinTeamWithInvite");
  const response = await joinTeam({ inviteCode, userName: userName || "ゲスト" });
  const teamId = response.data?.teamId;

  if (!teamId) {
    throw new Error("チームへの参加結果を確認できませんでした。");
  }

  return { teamId, type: "join" };
}

// ==========================================
// 📁 プロジェクト（部活の予定・動画等）関連
// ==========================================
export function subscribeProjects(teamId, callback) {
  if (!teamId) return () => {};
  const projectsRef = collection(db, "teams", teamId, "projects");
  const q = query(projectsRef, orderBy("createdAt", "desc"));
  return subscribeToTeamData("projects", q, (snapshot) => {
    const projectsData = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(projectsData);
  });
}

export async function createProject(teamId, projectData) {
  if (!teamId) throw new Error("チームIDがありません。");
  if (projectData.id) {
    const docRef = doc(db, "teams", teamId, "projects", projectData.id);
    await setDoc(docRef, {
      ...projectData,
      teamId: teamId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    const projectsRef = collection(db, "teams", teamId, "projects");
    await addDoc(projectsRef, {
      ...projectData,
      teamId: teamId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateProject(teamId, projectId, updateData) {
  if (!teamId || !projectId) throw new Error("IDが不足しています");
  const projectRef = doc(db, "teams", teamId, "projects", projectId);
  await setDoc(
    projectRef,
    { ...updateData, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteProject(teamId, projectId) {
  if (!teamId || !projectId) return;
  const projectRef = doc(db, "teams", teamId, "projects", projectId);
  await updateDoc(projectRef, {
    status: "deleted",
    updatedAt: serverTimestamp(),
  });
}
// ==========================================
// 🏷️ タググループ関連
// ==========================================
export function subscribeTagGroups(teamId, callback) {
  if (!teamId) return () => {};
  const ref = collection(db, "teams", teamId, "tagGroups");
  const q = query(ref, orderBy("createdAt", "asc"));
  return subscribeToTeamData("tagGroups", q, (snapshot) => {
    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(data);
  });
}

export async function createTagGroup(teamId, groupData) {
  if (!teamId) throw new Error("チームIDがありません。");
  const ref = collection(db, "teams", teamId, "tagGroups");
  const created = await addDoc(ref, {
    ...groupData,
    status: groupData.status || "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

export async function updateTagGroup(teamId, groupId, updateData) {
  if (!teamId || !groupId) throw new Error("IDが不足しています。");
  const ref = doc(db, "teams", teamId, "tagGroups", groupId);
  await setDoc(
    ref,
    { ...updateData, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteTagGroup(teamId, groupId) {
  if (!teamId || !groupId) return;
  const ref = doc(db, "teams", teamId, "tagGroups", groupId);
  await updateDoc(ref, {
    status: "deleted",
    updatedAt: serverTimestamp(),
  });
}

// ==========================================
// 🎬 ハイライト用プロジェクト関連
// ==========================================
export function subscribeHighlightProjects(teamId, callback) {
  if (!teamId) return () => {};
  const ref = collection(db, "teams", teamId, "highlightProjects");
  const q = query(ref, orderBy("createdAt", "desc"));
  return subscribeToTeamData("highlightProjects", q, (snapshot) => {
    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(data);
  });
}

export async function createHighlightProject(teamId, projectData) {
  if (!teamId) throw new Error("チームIDがありません。");
  const ref = collection(db, "teams", teamId, "highlightProjects");
  await addDoc(ref, {
    ...projectData,
    teamId,
    status: projectData.status || "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateHighlightProject(teamId, projectId, updateData) {
  if (!teamId || !projectId) throw new Error("IDが不足しています");
  const ref = doc(db, "teams", teamId, "highlightProjects", projectId);
  await setDoc(
    ref,
    { ...updateData, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteHighlightProject(teamId, projectId) {
  if (!teamId || !projectId) return;
  const ref = doc(db, "teams", teamId, "highlightProjects", projectId);
  await updateDoc(ref, {
    status: "deleted",
    updatedAt: serverTimestamp(),
  });
}
// ==========================================
// 📅 カレンダー（チーム共通の予定）関連 ★新規追加
// ==========================================
export function subscribeClubEvents(teamId, callback) {
  if (!teamId) return () => {};
  const ref = collection(db, "teams", teamId, "clubEvents");
  const q = query(ref, orderBy("createdAt", "desc"));
  return subscribeToTeamData("clubEvents", q, (snapshot) => {
    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(data);
  });
}

export function createClubEventId(teamId) {
  if (!teamId) throw new Error("チームIDがありません。");
  return doc(collection(db, "teams", teamId, "clubEvents")).id;
}

export async function createClubEvent(teamId, eventData, eventId = null) {
  if (!teamId) return;
  const eventRef = eventId
    ? doc(db, "teams", teamId, "clubEvents", eventId)
    : doc(collection(db, "teams", teamId, "clubEvents"));
  await setDoc(eventRef, {
    ...eventData,
    lastEventDate: eventLastDate(eventData),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return eventRef.id;
}

export async function updateClubEvent(teamId, eventId, updateData) {
  if (!teamId || !eventId) return;
  const ref = doc(db, "teams", teamId, "clubEvents", eventId);
  const end = eventLastDate(updateData);
  await updateDoc(ref, { ...updateData, ...(end ? { lastEventDate: end } : {}), updatedAt: serverTimestamp() });
}

export async function removeClubEventAbsenceComment(
  teamId,
  eventId,
  comment,
) {
  if (!teamId || !eventId || !comment?.id) return;
  const ref = doc(db, "teams", teamId, "clubEvents", eventId);
  await updateDoc(ref, {
    absenceComments: arrayRemove(comment),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteClubEvent(teamId, eventId) {
  if (!teamId || !eventId) return;
  const ref = doc(db, "teams", teamId, "clubEvents", eventId);
  await updateDoc(ref, { status: "deleted", updatedAt: serverTimestamp() });
}

// ==========================================
// 🔐 個人の予定（完全非公開）関連
// ==========================================
export function subscribePersonalEvents(uid, callback) {
  if (!uid) return () => {};
  const eventsRef = collection(db, "users", uid, "personalEvents");
  const q = query(eventsRef, orderBy("date", "asc"));
  return measuredOnSnapshot(
    "personalEvents",
    q,
    (snapshot) => {
      const events = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      callback(events);
    },
    (error) => {
      console.log("🔐 個人予定の監視エラー:", error.message);
    },
  );
}

export async function createPersonalEvent(uid, eventData) {
  if (!uid) return;
  if (eventData.id) {
    const docRef = doc(db, "users", uid, "personalEvents", eventData.id);
    await setDoc(docRef, { ...eventData, lastEventDate: eventLastDate(eventData), createdAt: serverTimestamp() });
  } else {
    const eventsRef = collection(db, "users", uid, "personalEvents");
    await addDoc(eventsRef, { ...eventData, lastEventDate: eventLastDate(eventData), createdAt: serverTimestamp() });
  }
}

export async function updatePersonalEvent(uid, eventId, updateData) {
  if (!uid || !eventId) return;
  const eventRef = doc(db, "users", uid, "personalEvents", eventId);
  const end = eventLastDate(updateData);
  await updateDoc(eventRef, { ...updateData, ...(end ? { lastEventDate: end } : {}), updatedAt: serverTimestamp() });
}

export async function deletePersonalEvent(uid, eventId) {
  if (!uid || !eventId) return;
  const eventRef = doc(db, "users", uid, "personalEvents", eventId);
  await deleteDoc(eventRef);
}

// ==========================================
// 👥 メンバー取得・プロフィール更新
// ==========================================
export function subscribeTeamMembers(teamId, callback) {
  if (!teamId) return () => {};
  const membersRef = collection(db, "teams", teamId, "members");
  let active = true, generation = 0;
  const stop = subscribeToTeamData("teamMembers", membersRef, async (snapshot) => {
    const version = ++generation;
    const promises = snapshot.docs.map(async (docSnap) => {
      const uid = docSnap.id;
      const data = docSnap.data();
      let name = data.name;

      if (!name) {
        try {
          const userSnap = await getDoc(doc(db, "users", uid));
          name = userSnap.exists() ? userSnap.data().name : "未設定";
        } catch (error) {
          name = "名称未設定";
        }
      }
      return { uid, name, ...data };
    });

    const membersData = await Promise.all(promises);
    if (active && version === generation) callback(membersData);
  });
  return () => { active = false; generation += 1; stop(); };
}

export async function updateMemberProfile(
  teamId,
  uid,
  newName,
  grade,
  position,
) {
  if (!uid) return;
  await setDoc(doc(db, "users", uid), { name: newName }, { merge: true });

  if (teamId) {
    await setDoc(
      doc(db, "teams", teamId, "members", uid),
      { name: newName, grade: grade || "", position: position || "" },
      { merge: true },
    );
  }
}

export async function updateMemberRoleConfig(teamId, uid, updateData) {
  if (!teamId || !uid) return;
  await setDoc(doc(db, "teams", teamId, "members", uid), updateData, {
    merge: true,
  });
}

export async function removeTeamMember(teamId, targetUid) {
  if (!teamId || !targetUid) return;

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Authentication is required. Please sign in again.");
  }

  await currentUser.getIdToken(true);

  const removeMember = httpsCallable(cloudFunctions, "removeTeamMember");
  const response = await removeMember({ teamId, targetUid });
  return response.data;
}

export async function deleteTeam(teamId) {
  if (!teamId) throw new Error("チームIDがありません。");

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Authentication is required. Please sign in again.");
  }

  await currentUser.getIdToken(true);

  const deleteTeamCallable = httpsCallable(cloudFunctions, "deleteTeam");
  const response = await deleteTeamCallable({ teamId });
  return response.data;
}

export async function checkAccountDeletionEligibility() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Authentication is required. Please sign in again.");
  }

  await currentUser.getIdToken(true);
  const checkEligibility = httpsCallable(
    cloudFunctions,
    "checkAccountDeletionEligibility",
  );
  const response = await checkEligibility();
  return response.data;
}

export async function deleteCurrentUserAccount() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Authentication is required. Please sign in again.");
  }

  await currentUser.getIdToken(true);
  const deleteAccount = httpsCallable(cloudFunctions, "deleteUserAccount");
  const response = await deleteAccount();
  return response.data;
}

export async function transferTeamOwnership(teamId, targetUid) {
  if (!teamId || !targetUid) {
    throw new Error("チームまたは移管先の管理者を確認できませんでした。");
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Authentication is required. Please sign in again.");
  }

  await currentUser.getIdToken(true);
  const transferOwnership = httpsCallable(
    cloudFunctions,
    "transferTeamOwnership",
  );
  const response = await transferOwnership({ teamId, targetUid });
  return response.data;
}

// ==========================================
// 🏟️ チーム設定・設定画面関連
// ==========================================
export async function getTeamInviteCode(teamId) {
  if (!teamId) return null;
  try {
    const teamSnap = await getDoc(doc(db, "teams", teamId));
    return teamSnap.exists() && teamSnap.data().inviteCode
      ? teamSnap.data().inviteCode
      : "未発行";
  } catch (error) {
    return "取得エラー(権限不足)";
  }
}

export function subscribeTeamData(teamId, callback) {
  if (!teamId) return () => {};
  return subscribeToTeamData("teamData", doc(db, "teams", teamId), (docSnap) => {
    if (docSnap.exists()) callback(docSnap.data());
  });
}

export async function updateTeamAdSettings(teamId, adSettings) {
  if (!teamId) throw new Error("チームIDがありません");
  await updateDoc(doc(db, "teams", teamId), {
    adSettings,
  });
}

export async function addTeamArrayItem(teamId, field, value) {
  const teamRef = doc(db, "teams", teamId);
  const snap = await getDoc(teamRef);
  if (!snap.exists()) return;

  const data = snap.data();
  if (data[field] === undefined) {
    const defaultGrades = ["1年生", "2年生", "3年生"];
    const defaultPositions = ["GK", "CP", "マネージャー"];
    const baseArray = field === "grades" ? defaultGrades : defaultPositions;
    await updateDoc(teamRef, { [field]: [...baseArray, value] });
  } else {
    await updateDoc(teamRef, { [field]: arrayUnion(value) });
  }
}

export async function removeTeamArrayItem(teamId, field, value) {
  await updateDoc(doc(db, "teams", teamId), { [field]: arrayRemove(value) });
}

// ==========================================
// 🚀 新規登録フロー
// ==========================================
export async function executeRegistration(
  uid,
  role,
  userName,
  teamName,
  inviteCodeInput,
  { emailVerificationRequired = false, legalConsent = {}, sport = {} } = {},
) {
  if (
    legalConsent.minimumAgeConfirmed !== true ||
    legalConsent.minorConsentRequirementAcknowledged !== true ||
    legalConsent.termsAccepted !== true ||
    legalConsent.privacyPolicyAcknowledged !== true
  ) {
    throw new Error("利用条件への同意を確認できませんでした。");
  }

  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      name: userName,
      createdAt: serverTimestamp(),
      emailVerificationRequired: emailVerificationRequired === true,
      legalConsent: {
        minimumAge: MINIMUM_USER_AGE,
        minimumAgeConfirmed: true,
        minorConsentRequirementAcknowledged: true,
        termsVersion: LEGAL_POLICY_VERSION,
        privacyPolicyVersion: LEGAL_POLICY_VERSION,
        acceptedAt: serverTimestamp(),
      },
    },
    { merge: true },
  );

  if (role === "admin") {
    return createTeam(uid, teamName, userName, sport);
  }

  return joinTeamWithInvite(uid, inviteCodeInput, userName);
}

// ==========================================
// 📋 掲示板（Notice）関連
// ==========================================
export async function createNotice(teamId, noticeData) {
  if (!teamId) throw new Error("チームIDがありません");
  if (noticeData.id) {
    const docRef = doc(db, "teams", teamId, "notices", noticeData.id);
    await setDoc(docRef, {
      ...noticeData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, "teams", teamId, "notices"), {
      ...noticeData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateNotice(teamId, noticeId, updateData) {
  if (!teamId || !noticeId) throw new Error("IDが不足しています");
  await updateDoc(doc(db, "teams", teamId, "notices", noticeId), {
    ...updateData,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeNotices(teamId, callback) {
  if (!teamId) return () => {};
  const q = query(
    collection(db, "teams", teamId, "notices"),
    orderBy("createdAt", "desc"),
  );
  return subscribeToTeamData("notices", q, (snapshot) => {
    callback(
      snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis() || Date.now(),
      })),
    );
  });
}

// ==========================================
// 💬 ワークスペース掲示板（Workspace Posts）関連
// ==========================================
export async function submitSafetyReport(reportData) {
  const submitReport = httpsCallable(cloudFunctions, "submitSafetyReport");
  const result = await submitReport(reportData);
  return result.data;
}

export async function submitSupportRequest(requestData) {
  const submitRequest = httpsCallable(cloudFunctions, "submitSupportRequest");
  const result = await submitRequest(requestData);
  return result.data;
}

export async function setUserBlocked(teamId, targetUid, blocked) {
  if (!targetUid) throw new Error("ブロック対象を確認できませんでした。");
  const updateUserBlock = httpsCallable(cloudFunctions, "setUserBlocked");
  const result = await updateUserBlock({
    teamId: teamId || null,
    targetUid,
    blocked: blocked === true,
  });
  return result.data;
}

export async function validateUserContent(teamId, contentType, content) {
  const validateContent = httpsCallable(cloudFunctions, "validateUserContent");
  const result = await validateContent({ teamId, contentType, content });
  return result.data;
}

export async function moderateWorkspaceContent(moderationData) {
  const moderateContent = httpsCallable(
    cloudFunctions,
    "moderateWorkspaceContent",
  );
  const result = await moderateContent(moderationData);
  return result.data;
}

export async function manageOwnWorkspaceContent(contentData) {
  const manageContent = httpsCallable(
    cloudFunctions,
    "manageOwnWorkspaceContent",
  );
  const result = await manageContent(contentData);
  return result.data;
}

export async function createWorkspacePost(teamId, postData) {
  if (!teamId) throw new Error("チームIDがありません");

  if (postData.id) {
    await setDoc(doc(db, "teams", teamId, "workspacePosts", postData.id), {
      ...postData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return postData.id;
  }

  const created = await addDoc(
    collection(db, "teams", teamId, "workspacePosts"),
    {
      ...postData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
  );
  return created.id;
}

export async function updateWorkspacePost(teamId, postId, updateData) {
  if (!teamId || !postId) throw new Error("IDが不足しています");
  await setDoc(
    doc(db, "teams", teamId, "workspacePosts", postId),
    { ...updateData, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function appendWorkspacePostReply(teamId, postId, reply) {
  if (!teamId || !postId) throw new Error("IDが不足しています");
  await updateDoc(doc(db, "teams", teamId, "workspacePosts", postId), {
    replies: arrayUnion(reply),
    updatedAt: serverTimestamp(),
  });
}

export async function updateWorkspacePostReply(
  teamId,
  postId,
  replyId,
  updater,
) {
  if (!teamId || !postId || !replyId) throw new Error("IDが不足しています");
  const postRef = doc(db, "teams", teamId, "workspacePosts", postId);

  await runTransaction(db, async (transaction) => {
    const postSnapshot = await transaction.get(postRef);
    if (!postSnapshot.exists()) throw new Error("投稿が見つかりません");

    const currentReplies = postSnapshot.data().replies || [];
    let replyFound = false;
    const nextReplies = currentReplies.map((reply) => {
      if (reply.id !== replyId) return reply;
      replyFound = true;
      return updater(reply);
    });
    if (!replyFound) throw new Error("返信が見つかりません");
    transaction.update(postRef, {
      replies: nextReplies,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function incrementWorkspacePostReaction(
  teamId,
  postId,
  emoji,
  userUid,
) {
  if (!teamId || !postId || !emoji || !userUid) {
    throw new Error("IDが不足しています");
  }

  const postRef = doc(db, "teams", teamId, "workspacePosts", postId);
  return runTransaction(db, async (transaction) => {
    const postSnapshot = await transaction.get(postRef);
    if (!postSnapshot.exists()) throw new Error("投稿が見つかりません");

    const post = postSnapshot.data();
    if (post.reactionUserUids?.[userUid]) return false;

    transaction.update(postRef, {
      reactions: {
        ...(post.reactions || {}),
        [emoji]: (post.reactions?.[emoji] || 0) + 1,
      },
      reactionUserUids: {
        ...(post.reactionUserUids || {}),
        [userUid]: emoji,
      },
      updatedAt: serverTimestamp(),
    });
    return true;
  });
}

export async function markWorkspacePostRead(
  teamId,
  postId,
  userUid,
  userName,
  separateReads = false,
) {
  if (!teamId || !postId) throw new Error("IDが不足しています");

  if (separateReads) {
    if (!userUid || auth.currentUser?.uid !== userUid) throw new Error("ログイン状態を確認してください。");
    await setDoc(doc(db, "teams", teamId, "workspacePostReadStates", postId), {
      readers: { [userUid]: true }, updatedAt: serverTimestamp(),
    }, { merge: true });
    return;
  }
  const updateData = { updatedAt: serverTimestamp() };
  if (userUid) updateData.readByUids = arrayUnion(userUid);
  if (userName) updateData.readBy = arrayUnion(userName);
  await updateDoc(
    doc(db, "teams", teamId, "workspacePosts", postId),
    updateData,
  );
}

export async function markWorkspaceNotificationState(teamId, postId, uid, key, action) {
  if (!teamId || !postId || auth.currentUser?.uid !== uid || !["read", "dismiss"].includes(action)) throw new Error("通知の更新対象を確認してください。");
  const field = action === "read" ? "notificationReads" : "notificationDismissals";
  await setDoc(doc(db, "teams", teamId, "workspacePostReadStates", postId), {
    [field]: { [uid]: arrayUnion(key) }, updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getWorkspacePostsForAudienceSync(teamId) {
  if (!teamId) return [];
  const snapshot = await getDocs(
    collection(db, "teams", teamId, "workspacePosts"),
  );
  return snapshot.docs.map((postDoc) => ({
    id: postDoc.id,
    ...postDoc.data(),
  }));
}

export async function updateWorkspacePostAudiences(teamId, updates) {
  if (!teamId || !Array.isArray(updates) || updates.length === 0) return;

  const batchSize = 400;
  for (let index = 0; index < updates.length; index += batchSize) {
    const batch = writeBatch(db);
    updates.slice(index, index + batchSize).forEach(({ postId, audience }) => {
      batch.update(doc(db, "teams", teamId, "workspacePosts", postId), {
        ...audience,
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export function subscribeWorkspacePosts(teamId, userUid, callback) {
  if (!teamId || !userUid) return () => {};
  const q = query(
    collection(db, "teams", teamId, "workspacePosts"),
    where("visibleToUids", "array-contains", userUid),
  );
  return subscribeToTeamData("workspacePosts", q, (snapshot) => {
    const posts = snapshot.docs
      .map((postDoc) => ({
        id: postDoc.id,
        ...postDoc.data(),
        createdAt: postDoc.data().createdAt?.toMillis() || Date.now(),
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    callback(posts);
  });
}

// ==========================================
// 📝 振り返り（Daily Reports）関連
// ==========================================
export function subscribeDailyReports(teamId, callback) {
  if (!teamId) return () => {};
  const q = query(
    collection(db, "teams", teamId, "dailyReports"),
    orderBy("createdAt", "desc"),
  );
  return subscribeToTeamData("dailyReports", q, (snapshot) => {
    callback(
      snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis() || Date.now(),
      })),
    );
  });
}

export async function createDailyReport(teamId, reportData) {
  if (!teamId) throw new Error("チームIDがありません");
  if (reportData.id) {
    const docRef = doc(db, "teams", teamId, "dailyReports", reportData.id);
    await setDoc(docRef, {
      ...reportData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, "teams", teamId, "dailyReports"), {
      ...reportData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateDailyReport(teamId, reportId, updateData) {
  if (!teamId || !reportId) throw new Error("IDが不足しています");
  await updateDoc(doc(db, "teams", teamId, "dailyReports", reportId), {
    ...updateData,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDailyReport(teamId, reportId) {
  if (!teamId || !reportId) return;
  const reportRef = doc(db, "teams", teamId, "dailyReports", reportId);
  await updateDoc(reportRef, {
    status: "deleted",
    updatedAt: serverTimestamp(),
  });
}
