//firestoreService.js
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  writeBatch,
  where,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';

// -----------------------------
// Team helpers
// -----------------------------
const teamRef = (teamId) => doc(db, 'teams', teamId);
const teamVideosCol = (teamId) => collection(db, 'teams', teamId, 'videos');
const teamTagsCol = (teamId) => collection(db, 'teams', teamId, 'tags');
const videoRef = (teamId, videoId) => doc(db, 'teams', teamId, 'videos', videoId);
const eventsCol = (teamId, videoId) => collection(db, 'teams', teamId, 'videos', videoId, 'events');

function tagDocId(name) {
  return encodeURIComponent(String(name || '').trim());
}

// -----------------------------
// Team / Invite
// -----------------------------
export async function createTeam({ name, uid }) {
  const t = await addDoc(collection(db, 'teams'), {
    name,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  // 作成者は admin
  await setDoc(doc(db, 'teams', t.id, 'members', uid), { role: 'admin', joinedAt: serverTimestamp() }, { merge: true });
  // activeTeamId をセット
  await setDoc(doc(db, 'users', uid), { activeTeamId: t.id, updatedAt: serverTimestamp() }, { merge: true });
  return t.id;
}

function makeInviteCode() {
  const a = Math.random().toString(36).slice(2, 6).toUpperCase();
  const b = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${a}${b}`;
}

// /invites/{CODE} -> { teamId, createdBy, active }
export async function createInvite({ teamId, uid }) {
  const code = makeInviteCode();
  await setDoc(doc(db, 'invites', code), {
    teamId,
    createdBy: uid,
    active: true,
    createdAt: serverTimestamp(),
  });
  return code;
}

export async function joinTeamByInvite({ code, uid }) {
  const ref = doc(db, 'invites', String(code || '').trim().toUpperCase());
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('招待コードが見つかりません');
  const data = snap.data() || {};
  if (!data.active) throw new Error('この招待コードは無効です');
  const teamId = data.teamId;
  if (!teamId) throw new Error('招待データが不正です');

  // 参加（招待コードを member に残してルールで検証できるようにする）
  await setDoc(
    doc(db, 'teams', teamId, 'members', uid),
    { role: 'member', joinedAt: serverTimestamp(), inviteCode: ref.id },
    { merge: true }
  );
  await setDoc(doc(db, 'users', uid), { activeTeamId: teamId, updatedAt: serverTimestamp() }, { merge: true });
  return teamId;
}

// -----------------------------
// videos: /teams/{teamId}/videos/{videoId}
// -----------------------------
export async function addVideo(teamId, { title, videoUrl, sourceType = 'url', youtubeId = null, createdBy }) {
  const ref = await addDoc(teamVideosCol(teamId), {
    title,
    sourceType,
    videoUrl,
    ...(youtubeId ? { youtubeId } : {}),
    createdBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getVideo(teamId, videoId) {
  const snap = await getDoc(videoRef(teamId, videoId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeVideos(teamId, callback) {
  const q = query(teamVideosCol(teamId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// -----------------------------
// events: /teams/{teamId}/videos/{videoId}/events
// -----------------------------
export async function addEvent(teamId, videoId, event) {
  return addDoc(eventsCol(teamId, videoId), { ...event, createdAt: serverTimestamp() });
}

export function subscribeEvents(teamId, videoId, callback) {
  const q = query(eventsCol(teamId, videoId), orderBy('startSec', 'asc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// -----------------------------
// tags: /teams/{teamId}/tags
// -----------------------------
export function subscribeTags(teamId, callback) {
  const q = query(teamTagsCol(teamId), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function upsertTag(teamId, name, createdBy) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  const ref = doc(db, 'teams', teamId, 'tags', tagDocId(trimmed));
  await setDoc(ref, { name: trimmed, createdBy, createdAt: serverTimestamp() }, { merge: true });
}

export async function deleteTag(teamId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  await deleteDoc(doc(db, 'teams', teamId, 'tags', tagDocId(trimmed)));
}

// タグ削除時：チーム内の全動画イベントから除去（空になったらイベント削除）
export async function removeTagFromAllEvents(teamId, tagName) {
  const trimmed = String(tagName || '').trim();
  if (!trimmed) return;

  const vidsSnap = await getDocs(teamVideosCol(teamId));
  if (vidsSnap.empty) return;

  for (const v of vidsSnap.docs) {
    const videoId = v.id;
    const colRef = eventsCol(teamId, videoId);
    const q = query(colRef, where('tagTypes', 'array-contains', trimmed));
    const snap = await getDocs(q);
    if (snap.empty) continue;

    const docs = snap.docs;
    const CHUNK = 450;
    for (let i = 0; i < docs.length; i += CHUNK) {
      const batch = writeBatch(db);
      docs.slice(i, i + CHUNK).forEach((d) => {
        const data = d.data() || {};
        const tags = Array.isArray(data.tagTypes) ? data.tagTypes : [];
        const next = tags.filter((t) => t !== trimmed);
        if (next.length === 0) batch.delete(d.ref);
        else batch.update(d.ref, { tagTypes: next });
      });
      await batch.commit();
    }
  }
}

// videos/{videoId} を削除（events も削除）
async function deleteAllDocsInSubcollection(teamId, videoId, subcollectionName) {
  const colRef = collection(db, 'teams', teamId, 'videos', videoId, subcollectionName);
  const snap = await getDocs(colRef);
  if (snap.empty) return;
  const docs = snap.docs;
  const CHUNK = 450;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function deleteVideo(teamId, videoId) {
  await deleteAllDocsInSubcollection(teamId, videoId, 'events');
  await deleteDoc(videoRef(teamId, videoId));
}