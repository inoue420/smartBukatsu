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
import { httpsCallable } from "firebase/functions";
import { auth, db, cloudFunctions } from "../firebase";
export const MAX_TEAMS_PER_USER = 5;

function subscribeToTeamData(reference, callback) {
  return onSnapshot(reference, callback, (error) => {
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
  if (teamIds.length >= MAX_TEAMS_PER_USER) {
    throw new Error(`所属できるチームは最大${MAX_TEAMS_PER_USER}件までです。`);
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

export async function createTeam(uid, teamName, userName = "ゲスト") {
  if (!uid) throw new Error("ユーザー情報を確認できませんでした。");
  const trimmedTeamName = (teamName || "").trim();
  if (!trimmedTeamName) throw new Error("チーム名を入力してください。");

  await assertCanAddTeam(uid);

  const newTeamRef = doc(collection(db, "teams"));
  const teamId = newTeamRef.id;
  const generatedInviteCode = Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();

  await setDoc(newTeamRef, {
    name: trimmedTeamName,
    createdBy: uid,
    inviteCode: generatedInviteCode,
    createdAt: serverTimestamp(),
    grades: ["1年生", "2年生", "3年生"],
    positions: ["GK", "CP", "マネージャー"],
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
  const inviteCode = (inviteCodeInput || "").trim().toUpperCase();
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
  return subscribeToTeamData(q, (snapshot) => {
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
  return subscribeToTeamData(q, (snapshot) => {
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
  return subscribeToTeamData(q, (snapshot) => {
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
  return subscribeToTeamData(q, (snapshot) => {
    const data = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    callback(data);
  });
}

export async function createClubEvent(teamId, eventData) {
  if (!teamId) return;
  const ref = collection(db, "teams", teamId, "clubEvents");
  await addDoc(ref, {
    ...eventData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateClubEvent(teamId, eventId, updateData) {
  if (!teamId || !eventId) return;
  const ref = doc(db, "teams", teamId, "clubEvents", eventId);
  await updateDoc(ref, { ...updateData, updatedAt: serverTimestamp() });
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
// 👥 メンバー取得・プロフィール更新
// ==========================================
export function subscribeTeamMembers(teamId, callback) {
  if (!teamId) return () => {};
  const membersRef = collection(db, "teams", teamId, "members");
  return subscribeToTeamData(membersRef, async (snapshot) => {
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
    callback(membersData);
  });
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
  return subscribeToTeamData(doc(db, "teams", teamId), (docSnap) => {
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
  { emailVerificationRequired = false } = {},
) {
  const userRef = doc(db, "users", uid);
  await setDoc(
    userRef,
    {
      name: userName,
      createdAt: serverTimestamp(),
      emailVerificationRequired: emailVerificationRequired === true,
    },
    { merge: true },
  );

  if (role === "admin") {
    return createTeam(uid, teamName, userName);
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
  return subscribeToTeamData(q, (snapshot) => {
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

export async function markWorkspacePostRead(
  teamId,
  postId,
  userUid,
  userName,
) {
  if (!teamId || !postId) throw new Error("IDが不足しています");

  const updateData = { updatedAt: serverTimestamp() };
  if (userUid) updateData.readByUids = arrayUnion(userUid);
  if (userName) updateData.readBy = arrayUnion(userName);
  await updateDoc(
    doc(db, "teams", teamId, "workspacePosts", postId),
    updateData,
  );
}

export function subscribeWorkspacePosts(teamId, callback) {
  if (!teamId) return () => {};
  const q = query(
    collection(db, "teams", teamId, "workspacePosts"),
    orderBy("createdAt", "desc"),
  );
  return subscribeToTeamData(q, (snapshot) => {
    callback(
      snapshot.docs.map((postDoc) => ({
        id: postDoc.id,
        ...postDoc.data(),
        createdAt: postDoc.data().createdAt?.toMillis() || Date.now(),
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
  return subscribeToTeamData(q, (snapshot) => {
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
