import {
  collection, query, where, getDocsFromServer,
  doc, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { hasViewingTags, viewingPermissions } from "../utils/videoViewingGuidance";

const idsOf = (ids) => [...new Set(ids.filter((id) => typeof id === "string" && id))];
const dataOf = (snapshot) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));

// Search membership independently of the paginated viewing-project list.
// A server-confirmed empty result is required before saying "not added".
export async function findVideoViewingProjects(teamId, videoIds) {
  if (!teamId) throw new Error("チームを確認してください。");
  const ids = idsOf(videoIds), found = new Map();
  const pages = [];
  for (let offset = 0; offset < ids.length; offset += 30) {
    pages.push(getDocsFromServer(query(collection(db, "teams", teamId, "highlightProjects"),
      where("videoIds", "array-contains-any", ids.slice(offset, offset + 30)))));
  }
  for (const snapshot of await Promise.all(pages)) {
    dataOf(snapshot).forEach((item) => {
      if (item.status !== "deleted") found.set(item.id, item);
    });
  }
  return Object.fromEntries(ids.map((id) => [id, [...found.values()].filter((item) => item.videoIds?.includes(id))]));
}

// The complete destination list is fetched only after opening the add dialog.
export async function listVideoViewingProjects(teamId) {
  if (!teamId) throw new Error("チームを確認してください。");
  return dataOf(await getDocsFromServer(collection(db, "teams", teamId, "highlightProjects")))
    .filter((item) => item.status !== "deleted")
    .sort((a, b) => (a.title || "").localeCompare(b.title || "", "ja"));
}

async function checkSources(transaction, teamId, ids, viewer) {
  for (const id of ids) {
    const source = await transaction.get(doc(db, "teams", teamId, "projects", id));
    if (!source.exists() || !hasViewingTags({ ...source.data(), id }, viewer)) {
      throw new Error("選択した動画が変更されたか、閲覧できません。動画一覧から選び直してください。");
    }
  }
}

export async function createVideoViewingProject(teamId, title, videoIds, viewer) {
  if (!teamId || !viewer.currentUserUid || !viewingPermissions(viewer.userRole, viewer.canUploadVideos).canCreate) {
    throw new Error("閲覧用プロジェクトを作成する権限がありません。");
  }
  const ids = idsOf(videoIds);
  if (!title.trim() || !ids.length) throw new Error("プロジェクト名と動画を指定してください。");
  const ref = doc(collection(db, "teams", teamId, "highlightProjects"));
  const project = { id: ref.id, title: title.trim(), videoIds: ids, status: "active", createdBy: viewer.currentUserUid };
  await runTransaction(db, async (transaction) => {
    await checkSources(transaction, teamId, ids, viewer);
    const { id, ...data } = project;
    transaction.set(ref, { ...data, teamId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  return project;
}

export async function addVideosToViewingProject(teamId, projectId, videoIds, viewer) {
  if (!teamId || !projectId || !viewer.currentUserUid || !viewingPermissions(viewer.userRole).canAdd) {
    throw new Error("既存プロジェクトへ追加する権限がありません。");
  }
  const ids = idsOf(videoIds);
  if (!ids.length) throw new Error("動画を1件以上選択してください。");
  const ref = doc(db, "teams", teamId, "highlightProjects", projectId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    if (!snapshot.exists() || current.status === "deleted") {
      throw new Error("追加先が削除されました。別のプロジェクトを選んでください。");
    }
    // Read inside the transaction to reject deleted/hidden sources at save time.
    await checkSources(transaction, teamId, ids, viewer);
    const merged = [...new Set([...(current.videoIds || []), ...ids])];
    if (ids.some((id) => !(current.videoIds || []).includes(id))) {
      transaction.update(ref, { videoIds: merged, updatedAt: serverTimestamp() });
    }
    return { ...current, id: projectId, videoIds: merged };
  });
}
