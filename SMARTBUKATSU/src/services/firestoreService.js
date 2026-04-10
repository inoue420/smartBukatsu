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
  setDoc,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase";

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
  if (!teamId) {
    throw new Error(
      "チーム情報が同期されていません。アプリを一度リロードしてください！",
    );
  }
  const projectsRef = collection(db, "teams", teamId, "projects");
  await addDoc(projectsRef, {
    ...projectData,
    createdAt: serverTimestamp(),
  });
}

export async function createTeam(uid, teamName) {
  if (!uid || !teamName) throw new Error("情報が不足しています");
  const newTeamRef = doc(collection(db, "teams"));
  const teamId = newTeamRef.id;
  await setDoc(newTeamRef, {
    name: teamName,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  const memberRef = doc(db, "teams", teamId, "members", uid);
  await setDoc(memberRef, {
    role: "owner",
    joinedAt: serverTimestamp(),
  });
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    activeTeamId: teamId,
  });
  return teamId;
}

export async function joinTeamWithInvite(uid, inviteCode) {
  if (!uid || !inviteCode) throw new Error("招待コードを入力してください");
  const inviteRef = doc(db, "invites", inviteCode);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists() || !inviteSnap.data().active) {
    throw new Error("無効な招待コードです、または期限切れです");
  }
  const teamId = inviteSnap.data().teamId;
  const memberRef = doc(db, "teams", teamId, "members", uid);
  await setDoc(memberRef, {
    role: "member",
    inviteCode: inviteCode,
    joinedAt: serverTimestamp(),
  });
  const userRef = doc(db, "users", uid);
  await updateDoc(userRef, {
    activeTeamId: teamId,
  });
  return teamId;
}
