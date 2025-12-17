import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  writeBatch,
  where
} from 'firebase/firestore';
import { db } from '../firebase';

// videos: { title, sourceType, videoUrl, youtubeId?, createdBy, createdAt }
export async function addVideo({ title, videoUrl, sourceType = 'url', youtubeId = null, createdBy = 'anon' }) {
  const ref = await addDoc(collection(db, 'videos'), {
    title,
    sourceType,
    videoUrl,
    ...(youtubeId ? { youtubeId } : {}),
    createdBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getVideo(videoId) {
  const snap = await getDoc(doc(db, 'videos', videoId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listVideosOnce() {
  const q = query(collection(db, 'videos'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeVideos(callback) {
  const q = query(collection(db, 'videos'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(arr);
  });
}

// events: /videos/{videoId}/events
// event: { tagTypes: string[], startSec: number, endSec: number, note?, createdAt, createdBy }
export async function addEvent(videoId, event) {
  return addDoc(collection(db, 'videos', videoId, 'events'), {
    ...event,
    createdAt: serverTimestamp(),
  });
}

export async function listEventsOnce(videoId) {
  const q = query(
    collection(db, 'videos', videoId, 'events'),
    orderBy('startSec', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeEvents(videoId, callback, filters = null) {
  // 最初は全件購読、重くなったら where で絞る
  let qbase = query(
    collection(db, 'videos', videoId, 'events'),
    orderBy('startSec', 'asc')
  );

  // 例: where を足したいならここに条件追加（AND条件に注意）
  // if (filters?.tag) { ... }

  return onSnapshot(qbase, (snap) => {
    const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(arr);
  });
}

// videos/{videoId} を削除（サブコレ events も削除）
async function deleteAllDocsInSubcollection(videoId, subcollectionName) {
  const colRef = collection(db, 'videos', videoId, subcollectionName);
  const snap = await getDocs(colRef);
  if (snap.empty) return;

  // batch 上限(500)に備えて分割
  const docs = snap.docs;
  const CHUNK = 450;

  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

export async function deleteVideo(videoId) {
  // まずイベント（タグ）を全削除
  await deleteAllDocsInSubcollection(videoId, 'events');

  // もし highlights 等のサブコレがあるならここも同様に追加
  // await deleteAllDocsInSubcollection(videoId, 'highlights');

  // 最後に videos 本体を削除
  await deleteDoc(doc(db, 'videos', videoId));
}