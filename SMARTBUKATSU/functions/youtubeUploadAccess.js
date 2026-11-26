const UPLOAD_ROLES = new Set(["owner", "admin", "guardian"]);
const CONFIG_PATH = "appConfig/youtubeUpload";
const INVITE_PATH = "invites/AWUH95";

function isUploadMember(member) {
  return UPLOAD_ROLES.has(member?.role) && member.archived !== true;
}

function confirmationRef(firestore, teamId, uid) {
  return firestore.doc(`${CONFIG_PATH}/teams/${teamId}/adultConfirmations/${uid}`);
}

function confirmed(snapshot, teamId) {
  const data = snapshot.data();
  return data?.teamId === teamId && data.adultConfirmed === true;
}

function enabledTeam(teamId, config, pilotTeamId) {
  return teamId === config.data()?.teamId && teamId === pilotTeamId;
}

// Read the current roster inside the transaction so a retried or out-of-order
// membership event cannot restore a registration after a demotion or deletion.
async function syncYoutubeUploadMember(firestore, memberRef) {
  const teamRef = memberRef.parent.parent;
  return firestore.runTransaction(async (tx) => {
    const [config, invite] = await tx.getAll(firestore.doc(CONFIG_PATH), firestore.doc(INVITE_PATH));
    const pilotTeamId = invite.data()?.teamId;
    if (!enabledTeam(teamRef.id, config, pilotTeamId)) return;
    const refs = [confirmationRef(firestore, teamRef.id, memberRef.id)];
    // The deployed pilot access function still reads this original location.
    if (teamRef.id === pilotTeamId) {
      refs.push(firestore.doc(`${CONFIG_PATH}/adultConfirmations/${memberRef.id}`));
    }
    const [team, member, ...registrations] = await tx.getAll(teamRef, memberRef, ...refs);
    const eligible = team.exists && isUploadMember(member.data());
    for (const [index, existing] of registrations.entries()) {
      if (eligible && !confirmed(existing, teamRef.id)) {
        tx.set(refs[index], { teamId: teamRef.id, adultConfirmed: true, source: "teamMembership" });
      } else if (!eligible && existing.data()?.teamId === teamRef.id) {
        tx.delete(refs[index]);
      }
    }
  });
}

function createYoutubeUploadAccess({ firestore, HttpsError }) {
  return async function getYoutubeUploadAccess(request) {
    const uid = request.auth?.uid;
    if (!uid || request.auth.token?.email_verified !== true) {
      throw new HttpsError("unauthenticated", "メール確認済みのログインが必要です。");
    }
    if (request.data?.expectedUid !== uid) {
      throw new HttpsError("failed-precondition", "ログイン状態が変わりました。");
    }
    const teamId = request.data.teamId;
    if (typeof teamId !== "string" || !teamId.trim() || teamId.includes("/") || uid.includes("/")) {
      throw new HttpsError("invalid-argument", "利用者またはチームの指定が不正です。");
    }

    const allowed = await firestore.runTransaction(async (tx) => {
      const [config, invite] = await tx.getAll(firestore.doc(CONFIG_PATH), firestore.doc(INVITE_PATH));
      const pilotTeamId = invite.data()?.teamId;
      if (!enabledTeam(teamId, config, pilotTeamId)) return false;

      // Check the live roster as well as the server-managed registration.
      const [team, user, member, confirmation] = await tx.getAll(
        firestore.doc(`teams/${teamId}`),
        firestore.doc(`users/${uid}`),
        firestore.doc(`teams/${teamId}/members/${uid}`),
        confirmationRef(firestore, teamId, uid),
      );
      const membership = member.data();
      if (!team.exists || team.data().membershipBatchPending === true
          || user.data()?.activeTeamId !== teamId || !isUploadMember(membership)) return false;
      if (confirmation.exists) return confirmed(confirmation, teamId);
      // Only the original pilot used UID-only registrations. Check their embedded team ID.
      if (teamId !== pilotTeamId) return false;
      const legacy = await tx.get(firestore.doc(`${CONFIG_PATH}/adultConfirmations/${uid}`));
      return confirmed(legacy, teamId);
    });
    return { allowed };
  };
}

module.exports = { createYoutubeUploadAccess, isUploadMember, syncYoutubeUploadMember };
