import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";

// プロジェクト一覧をリアルタイムで取得する
export function subscribeProjects(teamId, callback) {
  if (!teamId) return () => {};
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

// 新しいプロジェクトを作成する
export async function createProject(teamId, uid, projectData) {
  if (!teamId || !uid)
    throw new Error("認証エラー: チームIDまたはユーザーIDがありません");
  const projectsRef = collection(db, "teams", teamId, "projects");

  return await addDoc(projectsRef, {
    ...projectData,
    name: projectData.title, // ★ルールの「name is string」をクリアするため変換
    createdBy: uid, // ★ルールの「createdBy == uid()」をクリアするため追加
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    tags: projectData.tags || [],
    memos: projectData.memos || [],
  });
}

// プロジェクトを更新する（タグ・メモ追加用）
export async function updateProject(teamId, projectId, updateData) {
  if (!teamId || !projectId) return;
  const projectRef = doc(db, "teams", teamId, "projects", projectId);
  return await updateDoc(projectRef, {
    ...updateData,
    updatedAt: serverTimestamp(),
  });
}

// プロジェクトを削除する
export async function deleteProject(teamId, projectId) {
  if (!teamId || !projectId) return;
  const projectRef = doc(db, "teams", teamId, "projects", projectId);
  return await deleteDoc(projectRef);
}
