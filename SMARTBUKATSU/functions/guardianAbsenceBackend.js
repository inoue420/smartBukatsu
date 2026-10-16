const CHILD_ROLES = ["member", "captain", "staff"];
const MANAGER_ROLES = ["owner", "admin", "staff"];
const MEMBER_ROLES = [...MANAGER_ROLES, "captain", "member", "guardian"];
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
const validIds = (values) => Array.isArray(values) && values.length <= 100 && values.every(validId) && new Set(values).size === values.length;
const membershipKey = (snapshot) => `${snapshot.createTime.seconds}:${snapshot.createTime.nanoseconds}`;
const commentsOf = (event) => Array.isArray(event.absenceComments) ? event.absenceComments : [];
const dateKey = (value) => {
  if (typeof value !== "string") return "";
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:$|T| )/.exec(value.trim());
  return match ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : "";
};
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().substring(0, 10) === value;
}
function eventDates(event) {
  const explicit = Array.isArray(event.selectedDates) ? event.selectedDates.map(dateKey).filter(validDate) : [];
  if (explicit.length) return [...new Set(explicit)];
  const start = dateKey(event.date), end = dateKey(event.endDate) || start;
  if (!validDate(start) || !validDate(end)) return [];
  const dates = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`) && dates.length < 365; time += 86400000) {
    dates.push(new Date(time).toISOString().substring(0, 10));
  }
  return dates;
}
function absenceDeadline(event, date, daysBefore) {
  const days = Number(daysBefore);
  const safeDays = Number.isInteger(days) && days >= 0 && days <= 365 ? days : 3;
  const schedule = event.timeSchedules?.[date];
  const allDay = schedule?.isAllDay ?? event.isAllDay;
  const start = allDay ? "" : schedule?.start || event.startTime;
  const time = safeDays === 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(start || "") ? start : "00:00";
  // Team calendar dates and notification schedules use Japan time.
  return Date.parse(`${date}T${time}:00+09:00`) - safeDays * 86400000;
}

function createGuardianAbsenceBackend({ firestore, FieldValue, HttpsError, now = () => Date.now() }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  const memberRef = (teamId, uid) => firestore.collection("teams").doc(teamId).collection("members").doc(uid);
  const manualChildRef = (teamId, id) => firestore.collection("teams").doc(teamId).collection("absenceChildren").doc(id);
  const anchor = (uid, teamId) => firestore.collection("users").doc(uid).collection("guardianAbsenceTeams").doc(teamId);
  function context(request) {
    const uid = request.auth?.uid, data = request.data || {};
    if (!uid) fail("unauthenticated", "ログインが必要です。");
    if (!validId(data.teamId)) fail("invalid-argument", "チームを確認してください。");
    return { ...data, uid };
  }
  function assertLinked(caller, child) {
    const profile = caller.data(), target = child.data();
    if (!child.exists || !CHILD_ROLES.includes(target?.role) ||
      !Array.isArray(profile.childUids) || !profile.childUids.includes(child.id) ||
      profile.childMemberships?.[child.id] !== membershipKey(child)) {
      fail("permission-denied", "この子供との紐づけを確認できません。監督・スタッフに設定を確認してください。");
    }
  }
  function assertManualLinked(caller, child) {
    if (!child.exists || !Array.isArray(caller.data().manualChildren) ||
      !caller.data().manualChildren.some((item) => item.id === child.id)) {
      fail("permission-denied", "この子供との紐づけを確認できません。監督・スタッフに設定を確認してください。");
    }
  }
  async function setChildren(request) {
    const { uid, teamId, guardianUid, childUids, manualChildIds, newManualChildren = [] } = context(request);
    if (!validId(guardianUid) || !validIds(childUids) || childUids.includes(guardianUid) ||
      (manualChildIds !== undefined && !validIds(manualChildIds)) ||
      !Array.isArray(newManualChildren) || newManualChildren.length > 100 ||
      !newManualChildren.every((child) => child && validId(child.id) && typeof child.name === "string" &&
        child.name.trim().length > 0 && child.name.trim().length <= 100 && manualChildIds?.includes(child.id)) ||
      new Set(newManualChildren.map((child) => child.id)).size !== newManualChildren.length) {
      fail("invalid-argument", "子供の指定を確認してください（最大100人）。");
    }
    return firestore.runTransaction(async (tx) => {
      const [team, caller, guardian, ...children] = await Promise.all([
        tx.get(firestore.collection("teams").doc(teamId)), tx.get(memberRef(teamId, uid)),
        tx.get(memberRef(teamId, guardianUid)), ...childUids.map((child) => tx.get(memberRef(teamId, child))),
      ]);
      if (!team.exists || !caller.exists || !MANAGER_ROLES.includes(caller.data().role)) fail("permission-denied", "監督・スタッフのみ設定できます。");
      if (!guardian.exists || guardian.data().role !== "guardian") fail("failed-precondition", "保護者として登録されたメンバーを選んでください。");
      if (children.some((child) => !child.exists || !CHILD_ROLES.includes(child.data().role))) {
        fail("failed-precondition", "同じチームの一般部員・キャプテン・スタッフを選んでください。");
      }
      // An earlier app sends only childUids. Preserve its already configured manual children.
      const manualIds = manualChildIds ?? (guardian.data().manualChildren || []).map((child) => child.id);
      if (!validIds(manualIds) || childUids.length + manualIds.length > 100) fail("invalid-argument", "子供は合計100人まで設定できます。");
      const manualSnapshots = await Promise.all(manualIds.map((id) => tx.get(manualChildRef(teamId, id))));
      const additions = new Map(newManualChildren.map((child) => [child.id, child.name.trim()]));
      const manualChildren = manualSnapshots.map((child) => {
        const name = additions.get(child.id);
        if ((!child.exists && !name) || (child.exists && name && child.data().name !== name)) {
          fail("failed-precondition", "未登録の子供の選択を確認してください。画面を開き直してください。");
        }
        return { id: child.id, name: child.exists ? child.data().name : name };
      });
      // Keep creation and linking atomic; stable draft IDs make a retry idempotent.
      manualSnapshots.forEach((child) => {
        if (!child.exists) tx.set(child.ref, { name: additions.get(child.id), createdAt: FieldValue.serverTimestamp() });
      });
      tx.update(guardian.ref, { childUids, childMemberships: Object.fromEntries(children.map((child) => [child.id, membershipKey(child)])), manualChildren });
      for (const id of new Set([guardianUid, ...childUids])) tx.set(anchor(id, teamId), { teamId });
      return { childUids, manualChildren };
    });
  }
  async function submit(request) {
    const { uid, teamId, eventId, targetUid = uid, targetChildId, date, text } = context(request);
    const manual = targetChildId !== undefined;
    if (!validId(eventId) || !(manual ? validId(targetChildId) && request.data.targetUid === undefined : validId(targetUid)) ||
      !validDate(date) || typeof text !== "string" || !text.trim() || text.trim().length > 2000) {
      fail("invalid-argument", "日付・対象者・不参加コメントを確認してください（2000文字以内）。");
    }
    const teamRef = firestore.collection("teams").doc(teamId), eventRef = teamRef.collection("clubEvents").doc(eventId);
    const commentId = teamRef.collection("clubEvents").doc().id;
    return firestore.runTransaction(async (tx) => {
      const [team, caller, target, snapshot] = await Promise.all([
        tx.get(teamRef), tx.get(memberRef(teamId, uid)), tx.get(manual ? manualChildRef(teamId, targetChildId) : memberRef(teamId, targetUid)), tx.get(eventRef),
      ]);
      if (!team.exists || !caller.exists || !MEMBER_ROLES.includes(caller.data().role)) fail("permission-denied", "チームへの所属を確認してください。");
      if (manual) {
        if (caller.data().role !== "guardian") fail("permission-denied", "紐づいた保護者のみ代理登録できます。");
        assertManualLinked(caller, target);
      } else if (caller.data().role === "guardian") assertLinked(caller, target);
      else if (targetUid !== uid) fail("permission-denied", "本人の不参加連絡のみ登録できます。");
      if (!snapshot.exists) fail("not-found", "予定が見つかりません。");
      const event = snapshot.data(), dates = eventDates(event);
      if (event.status === "deleted" || event.status === "pending" || !dates.includes(date)) fail("failed-precondition", "この日付の予定には登録できません。");
      if (now() >= absenceDeadline(event, date, team.data().absenceDeadlineDaysBefore)) fail("failed-precondition", "この予定の不参加連絡は受付期限を過ぎています。");
      const comments = commentsOf(event);
      const existing = comments.find((comment) => (manual ? comment.childId === targetChildId : !comment.childId && comment.uid === targetUid) &&
        (dates.length <= 1 || dateKey(comment.date) === date));
      if (existing) return { added: false, comment: existing };
      const comment = { id: commentId, uid: manual ? "" : targetUid, ...(manual ? { childId: targetChildId } : {}), user: target.data().name || "名称未設定", text: text.trim(), date,
        time: new Date(now()).toISOString(), submittedBy: { uid, user: caller.data().name || "名称未設定" } };
      tx.update(eventRef, { absenceComments: [...comments, comment], updatedAt: FieldValue.serverTimestamp() });
      for (const id of new Set(manual ? [uid] : [uid, targetUid])) tx.set(anchor(id, teamId), { teamId });
      return { added: true, comment };
    });
  }
  async function cancel(request) {
    const { uid, teamId, eventId, commentId } = context(request);
    if (!validId(eventId) || !validId(commentId)) fail("invalid-argument", "取り消す連絡を確認してください。");
    const eventRef = firestore.collection("teams").doc(teamId).collection("clubEvents").doc(eventId);
    return firestore.runTransaction(async (tx) => {
      const [caller, snapshot] = await Promise.all([tx.get(memberRef(teamId, uid)), tx.get(eventRef)]);
      if (!caller.exists || !MEMBER_ROLES.includes(caller.data().role)) fail("permission-denied", "チームへの所属を確認してください。");
      if (!snapshot.exists || snapshot.data().status === "deleted") fail("not-found", "予定が見つかりません。");
      const comments = commentsOf(snapshot.data()), comment = comments.find((item) => item.id === commentId);
      if (!comment) return { removed: false };
      if (caller.data().role === "guardian") {
        if (comment.childId) {
          if (!validId(comment.childId)) fail("permission-denied", "この連絡は取り消せません。");
          assertManualLinked(caller, await tx.get(manualChildRef(teamId, comment.childId)));
        } else {
          if (!validId(comment.uid)) fail("permission-denied", "この連絡は取り消せません。");
          assertLinked(caller, await tx.get(memberRef(teamId, comment.uid)));
        }
      } else if (comment.childId || comment.uid !== uid) fail("permission-denied", "本人の不参加連絡のみ取り消せます。");
      tx.update(eventRef, { absenceComments: comments.filter((item) => item.id !== commentId), updatedAt: FieldValue.serverTimestamp() });
      return { removed: true };
    });
  }
  async function removeLinks(teamId, uid, oldMembership = null, invalidRoleOnly = false) {
    const parents = await firestore.collection("teams").doc(teamId).collection("members").where("childUids", "array-contains", uid).get();
    for (const parent of parents.docs) await firestore.runTransaction(async (tx) => {
      const current = await tx.get(parent.ref);
      if (!current.exists || (oldMembership && current.data().childMemberships?.[uid] !== oldMembership)) return;
      if (invalidRoleOnly) {
        const child = await tx.get(memberRef(teamId, uid));
        if (child.exists && CHILD_ROLES.includes(child.data().role)) return;
      }
      const data = current.data(), memberships = { ...(data.childMemberships || {}) };
      delete memberships[uid];
      tx.update(parent.ref, { childUids: (data.childUids || []).filter((id) => id !== uid), childMemberships: memberships });
    });
  }
  async function membershipChanged(event) {
    const { before, after } = event.data || {};
    if (!before?.exists) return;
    const { teamId, uid } = event.params;
    if (!after.exists || (CHILD_ROLES.includes(before.data().role) && !CHILD_ROLES.includes(after.data().role))) {
      await removeLinks(teamId, uid, membershipKey(before), after.exists);
    }
    if (before.data().role === "guardian" && after.exists && after.data().role !== "guardian") {
      await firestore.runTransaction(async (tx) => {
        const current = await tx.get(after.ref);
        if (current.exists && current.data().role !== "guardian" &&
          ((current.data().childUids || []).length || (current.data().manualChildren || []).length)) {
          tx.update(after.ref, { childUids: [], childMemberships: {}, manualChildren: [] });
        }
      });
    }
  }
  async function relatedTeamIds(uid) {
    return (await firestore.collection("users").doc(uid).collection("guardianAbsenceTeams").get()).docs.map((item) => item.id);
  }
  async function anonymizeTeam(teamRef, uid) {
    await removeLinks(teamRef.id, uid);
    const events = await teamRef.collection("clubEvents").get();
    let changed = 0;
    for (const event of events.docs) await firestore.runTransaction(async (tx) => {
      const current = await tx.get(event.ref);
      if (!current.exists) return;
      let modified = false;
      const comments = commentsOf(current.data()).map((comment) => {
        const next = { ...comment };
        if (next.uid === uid) { next.uid = "deleted_user"; next.user = "削除済みユーザー"; modified = true; }
        if (next.submittedBy?.uid === uid) { next.submittedBy = { uid: "deleted_user", user: "削除済みユーザー" }; modified = true; }
        return next;
      });
      if (modified) { tx.update(event.ref, { absenceComments: comments }); changed++; }
    });
    return changed;
  }
  return { setChildren, submit, cancel, membershipChanged, removeLinks, relatedTeamIds, anonymizeTeam };
}
module.exports = { createGuardianAbsenceBackend, eventDates, absenceDeadline, membershipKey };
