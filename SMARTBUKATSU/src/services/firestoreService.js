import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "../firebase";

// ==========================================
// 📁 プロジェクト（部活の予定・動画等）関連
// ==========================================
export function subscribeProjects(teamId, callback) {
  if (!teamId) return () => {};
  const projectsRef = collection(db, "teams", teamId, "projects");
  const q = query(projectsRef, orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    const projectsData = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(projectsData);
  });
}

export async function createProject(teamId, projectData) {
  if (!teamId) throw new Error("チームIDがありません。");
  // ★修正：アプリ側でIDが指定されている場合はそのIDを使う
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
// 🔐 個人の予定（完全非公開）関連
// ==========================================
export function subscribePersonalEvents(uid, callback) {
  if (!uid) return () => {};
  const eventsRef = collection(db, "users", uid, "personalEvents");
  const q = query(eventsRef, orderBy("date", "asc"));
  return onSnapshot(
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
  // ★修正：アプリ側でIDが指定されている場合はそのIDを使う
  if (eventData.id) {
    const docRef = doc(db, "users", uid, "personalEvents", eventData.id);
    await setDoc(docRef, { ...eventData, createdAt: serverTimestamp() });
  } else {
    const eventsRef = collection(db, "users", uid, "personalEvents");
    await addDoc(eventsRef, { ...eventData, createdAt: serverTimestamp() });
  }
}

export async function updatePersonalEvent(uid, eventId, updateData) {
  if (!uid || !eventId) return;
  const eventRef = doc(db, "users", uid, "personalEvents", eventId);
  await updateDoc(eventRef, { ...updateData, updatedAt: serverTimestamp() });
}

export async function deletePersonalEvent(uid, eventId) {
  if (!uid || !eventId) return;
  const eventRef = doc(db, "users", uid, "personalEvents", eventId);
  await deleteDoc(eventRef);
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
  return onSnapshot(doc(db, "teams", teamId), (docSnap) => {
    if (docSnap.exists()) callback(docSnap.data());
  });
}

export async function addTeamArrayItem(teamId, field, value) {
  await updateDoc(doc(db, "teams", teamId), { [field]: arrayUnion(value) });
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
) {
  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    { name: userName, createdAt: serverTimestamp() },
    { merge: true },
  );

  if (role === "admin") {
    const newTeamRef = doc(collection(db, "teams"));
    const teamId = newTeamRef.id;
    const generatedInviteCode = Math.random()
      .toString(36)
      .substring(2, 8)
      .toUpperCase();

    await setDoc(newTeamRef, {
      name: teamName,
      createdBy: uid,
      inviteCode: generatedInviteCode,
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "teams", teamId, "members", uid), {
      role: "admin",
      joinedAt: serverTimestamp(),
    });
    await setDoc(userRef, { activeTeamId: teamId }, { merge: true });
    await setDoc(doc(db, "invites", generatedInviteCode), {
      teamId: teamId,
      active: true,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });

    return { inviteCode: generatedInviteCode, teamId, type: "create" };
  } else {
    const inviteCode = inviteCodeInput.trim().toUpperCase();
    const inviteSnap = await getDoc(doc(db, "invites", inviteCode));

    if (!inviteSnap.exists() || !inviteSnap.data().active)
      throw new Error("無効な招待コードです。");

    const teamId = inviteSnap.data().teamId;
    await setDoc(doc(db, "teams", teamId, "members", uid), {
      role: "member",
      inviteCode: inviteCode,
      joinedAt: serverTimestamp(),
    });
    await setDoc(userRef, { activeTeamId: teamId }, { merge: true });

    return { teamId, type: "join" };
  }
}

export async function updateUserName(uid, newName) {
  if (!uid || !newName) return;
  await setDoc(doc(db, "users", uid), { name: newName }, { merge: true });
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
  return onSnapshot(q, (snapshot) => {
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
// 📝 振り返り（Daily Reports）関連
// ==========================================
export function subscribeDailyReports(teamId, callback) {
  if (!teamId) return () => {};
  const q = query(
    collection(db, "teams", teamId, "dailyReports"),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(q, (snapshot) => {
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
  // ★修正：アプリ側で作ったID（rep_...）をそのままFirestoreのIDとして使う
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
// ↓↓↓ firestoreService.js の一番下に追加 ↓↓↓

export async function deleteDailyReport(teamId, reportId) {
  if (!teamId || !reportId) return;
  const reportRef = doc(db, "teams", teamId, "dailyReports", reportId);
  // 完全に消すのではなく、statusを"deleted"にして画面から隠す（安全な削除方法）
  await updateDoc(reportRef, {
    status: "deleted",
    updatedAt: serverTimestamp(),
  });
}
