import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  where,
} from "firebase/firestore";
import { db } from "../firebase";

// videos: { title, sourceType, videoUrl, createdBy, createdAt }
export async function addVideo({
  title,
  videoUrl,
  sourceType = "url",
  createdBy = "anon",
}) {
  const ref = await addDoc(collection(db, "videos"), {
    title,
    sourceType,
    videoUrl,
    createdBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getVideo(videoId) {
  const snap = await getDoc(doc(db, "videos", videoId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listVideosOnce() {
  const q = query(collection(db, "videos"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeVideos(callback) {
  const q = query(collection(db, "videos"), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(arr);
  });
}

// events: /videos/{videoId}/events
// event: { tagTypes: string[], startSec: number, endSec: number, note?, createdAt, createdBy }
export async function addEvent(videoId, event) {
  return addDoc(collection(db, "videos", videoId, "events"), {
    ...event,
    createdAt: serverTimestamp(),
  });
}

export async function listEventsOnce(videoId) {
  const q = query(
    collection(db, "videos", videoId, "events"),
    orderBy("startSec", "asc"),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeEvents(videoId, callback, filters = null) {
  // 最初は全件購読、重くなったら where で絞る
  let qbase = query(
    collection(db, "videos", videoId, "events"),
    orderBy("startSec", "asc"),
  );

  // 例: where を足したいならここに条件追加（AND条件に注意）
  // if (filters?.tag) { ... }

  return onSnapshot(qbase, (snap) => {
    const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(arr);
  });
}
// --- 以下、新UI（プロジェクト一覧・詳細）向けに追加した関数 ---

export function subscribeProjects(teamId, callback) {
  const q = query(
    collection(db, "teams", teamId, "projects"),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(q, (snapshot) => {
    const projects = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(projects);
  });
}

export async function createProject(teamId, projectData) {
  const projectsRef = collection(db, "teams", teamId, "projects");
  return await addDoc(projectsRef, {
    ...projectData,
    createdAt: serverTimestamp(),
    tags: projectData.tags || [],
    memos: projectData.memos || [],
  });
}

export async function updateProject(teamId, projectId, updateData) {
  const projectRef = doc(db, "teams", teamId, "projects", projectId);
  return await updateDoc(projectRef, updateData);
}

export async function deleteProject(teamId, projectId) {
  const projectRef = doc(db, "teams", teamId, "projects", projectId);
  return await deleteDoc(projectRef);
}
