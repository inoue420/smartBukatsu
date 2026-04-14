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
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "../firebase";

// ==========================================
// 📁 プロジェクト関連
// ==========================================

export function subscribeProjects(teamId, callback) {
  if (!teamId) return () => {};
  const projectsRef = collection(db, "teams", teamId, "projects");
  const q = query(projectsRef, orderBy("createdAt", "desc"));
  const unsubscribe = onSnapshot(q, (snapshot) => {
    const projectsData = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(projectsData);
  });
  return unsubscribe;
}

export async function createProject(teamId, projectData) {
  if (!teamId) throw new Error("チームIDがありません。");
  const projectsRef = collection(db, "teams", teamId, "projects");
  await addDoc(projectsRef, {
    ...projectData,
    teamId: teamId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateProject(teamId, projectId, updateData) {
  if (!teamId || !projectId) throw new Error("IDが不足しています");
  const projectRef = doc(db, "teams", teamId, "projects", projectId);
  await setDoc(
    projectRef,
    {
      ...updateData,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ==========================================
// 🏟️ チーム設定・設定画面関連（招待コード・学年・ポジション）
// ==========================================

export async function getTeamInviteCode(teamId) {
  if (!teamId) return null;
  try {
    const teamRef = doc(db, "teams", teamId);
    const teamSnap = await getDoc(teamRef);
    if (teamSnap.exists() && teamSnap.data().inviteCode) {
      return teamSnap.data().inviteCode;
    }
    return "未発行";
  } catch (error) {
    console.log("招待コード取得エラー:", error);
    return "取得エラー(権限不足)";
  }
}

export function subscribeTeamData(teamId, callback) {
  if (!teamId) return () => {};
  const teamRef = doc(db, "teams", teamId);
  return onSnapshot(teamRef, (docSnap) => {
    if (docSnap.exists()) {
      callback(docSnap.data());
    }
  });
}

export async function addTeamArrayItem(teamId, field, value) {
  const teamRef = doc(db, "teams", teamId);
  await updateDoc(teamRef, {
    [field]: arrayUnion(value),
  });
}

export async function removeTeamArrayItem(teamId, field, value) {
  const teamRef = doc(db, "teams", teamId);
  await updateDoc(teamRef, {
    [field]: arrayRemove(value),
  });
}

// ==========================================
// 🚀 新規登録フロー（招待コードを使った正規ルート完全版）
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
    {
      name: userName,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  if (role === "admin") {
    // 👑 管理者としてチームを新規作成
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

    const memberRef = doc(db, "teams", teamId, "members", uid);
    await setDoc(memberRef, {
      role: "admin",
      joinedAt: serverTimestamp(),
    });

    await setDoc(userRef, { activeTeamId: teamId }, { merge: true });

    const inviteRef = doc(db, "invites", generatedInviteCode);
    await setDoc(inviteRef, {
      teamId: teamId,
      active: true,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
    return { inviteCode: generatedInviteCode, teamId, type: "create" };
  } else {
    // 👤 部員として招待コードを使って参加
    const inviteCode = inviteCodeInput.trim().toUpperCase();
    const inviteRef = doc(db, "invites", inviteCode);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists() || !inviteSnap.data().active) {
      throw new Error("無効な招待コードです。");
    }

    const teamId = inviteSnap.data().teamId;
    const memberRef = doc(db, "teams", teamId, "members", uid);

    await setDoc(memberRef, {
      role: "member",
      inviteCode: inviteCode,
      joinedAt: serverTimestamp(),
    });

    await setDoc(userRef, { activeTeamId: teamId }, { merge: true });

    return { teamId, type: "join" };
  }
}

// ==========================================
// 👤 ユーザー情報更新関連
// ==========================================

export async function updateUserName(uid, newName) {
  if (!uid || !newName) return;
  const userRef = doc(db, "users", uid);
  await setDoc(userRef, { name: newName }, { merge: true });
}

// ==========================================
// 📋 掲示板（Notice）関連
// ==========================================

export async function createNotice(teamId, noticeData) {
  if (!teamId) throw new Error("チームIDがありません");
  const noticesRef = collection(db, "teams", teamId, "notices");
  await addDoc(noticesRef, {
    ...noticeData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateNotice(teamId, noticeId, updateData) {
  if (!teamId || !noticeId) throw new Error("IDが不足しています");
  const noticeRef = doc(db, "teams", teamId, "notices", noticeId);
  await updateDoc(noticeRef, {
    ...updateData,
    updatedAt: serverTimestamp(),
  });
}

// ==========================================
// 📡 掲示板のリアルタイム監視
// ==========================================
export function subscribeNotices(teamId, callback) {
  if (!teamId) return () => {};
  const noticesRef = collection(db, "teams", teamId, "notices");
  // 作成日順（新しいものが上）に並び替えて取得
  const q = query(noticesRef, orderBy("createdAt", "desc"));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const noticesData = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      // サーバーの時間がまだ取得できていない時（ローカル反映時）の対策
      createdAt: doc.data().createdAt?.toMillis() || Date.now(),
    }));
    callback(noticesData);
  });
  return unsubscribe; // 監視を解除するための関数を返す
}
