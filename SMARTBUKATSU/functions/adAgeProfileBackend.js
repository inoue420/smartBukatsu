const validId = value => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
const minimumAgeConfirmed = data => data?.legalConsent?.minimumAgeConfirmed === true &&
  Number.isInteger(data.legalConsent.minimumAge) && data.legalConsent.minimumAge >= 13;
const identityOf = snapshot => `${snapshot.createTime.seconds}:${snapshot.createTime.nanoseconds}`;
const teamsOf = data => [...new Set([
  ...(Array.isArray(data.teamIds) ? data.teamIds.filter(validId) : []),
  ...(validId(data.activeTeamId) ? [data.activeTeamId] : []),
])].sort();

function createAdAgeProfileBackend({ firestore, FieldValue, HttpsError }) {
  const profileRef = uid => firestore.doc(`users/${uid}/adAge/profile`);
  async function synchronize(uid, { scanMemberships = false, candidateTeamId = null } = {}) {
    if (!validId(uid)) return null;
    return firestore.runTransaction(async tx => {
      const [user, saved] = await Promise.all([
        tx.get(firestore.doc(`users/${uid}`)), tx.get(profileRef(uid)),
      ]);
      if (!user.exists) {
        if (saved.exists) tx.delete(profileRef(uid));
        return null;
      }
      const userCreatedAt = identityOf(user), data = user.data();
      const previous = saved.data() || {};
      const sameAccount = previous.schemaVersion === 1 && previous.userCreatedAt === userCreatedAt;
      let adultConfirmed = sameAccount && previous.adultConfirmed === true && previous.adultConfirmedBy === "guardian";
      let guardianTeamId = adultConfirmed ? previous.adultSourceTeamId : null;
      if (!adultConfirmed && (scanMemberships || candidateTeamId)) {
        const ids = [...new Set([
          ...(scanMemberships ? teamsOf(data) : []),
          ...(validId(candidateTeamId) ? [candidateTeamId] : []),
        ])].sort();
        if (ids.length > 100) throw new HttpsError("resource-exhausted", "所属情報の確認上限を超えています。");
        // Never trust a client-provided role or team list without actual documents.
        const memberships = await Promise.all(ids.map(async teamId => {
          const [team, member] = await Promise.all([
            tx.get(firestore.doc(`teams/${teamId}`)), tx.get(firestore.doc(`teams/${teamId}/members/${uid}`)),
          ]);
          return team.exists && member.exists && member.data().role === "guardian" ? teamId : null;
        }));
        guardianTeamId = memberships.find(Boolean) || null;
        adultConfirmed = Boolean(guardianTeamId);
      }
      const ageConfirmed = minimumAgeConfirmed(data);
      const audience = adultConfirmed ? "adult" : ageConfirmed ? "teen" : "unknown";
      const next = {
        schemaVersion: 1, userCreatedAt, adultConfirmed, minimumAgeConfirmed: ageConfirmed, audience,
        adultConfirmedBy: adultConfirmed ? "guardian" : null,
        adultSourceTeamId: guardianTeamId,
      };
      if (Object.entries(next).some(([key, value]) => previous[key] !== value)) {
        tx.set(profileRef(uid), { ...next,
          adultConfirmedAt: adultConfirmed
            ? (sameAccount && previous.adultConfirmed === true && previous.adultConfirmedAt || FieldValue.serverTimestamp()) : null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return { schemaVersion: 1, adultConfirmed, minimumAgeConfirmed: ageConfirmed, audience };
    });
  }
  return {
    async ensure(request) {
      const uid = request.auth?.uid;
      if (!validId(uid)) {
        throw new HttpsError("unauthenticated", "ログインが必要です。");
      }
      if (request.data?.expectedUid !== uid) throw new HttpsError("failed-precondition", "ログイン状態が変わりました。");
      if (Object.keys(request.data).some(key => key !== "expectedUid")) throw new HttpsError("invalid-argument", "広告の年齢情報はサーバーで確認します。");
      const profile = await synchronize(uid, { scanMemberships: true });
      if (!profile) throw new HttpsError("failed-precondition", "ユーザー情報を確認できませんでした。");
      return { uid, ...profile };
    },
    async membershipChanged(event) {
      if (event.data?.after?.data()?.role !== "guardian") return;
      await synchronize(event.params.uid, { candidateTeamId: event.params.teamId });
    },
    async userChanged(event) {
      const before = event.data?.before, after = event.data?.after;
      const oldData = before?.data() || {}, newData = after?.data() || {};
      const membershipsChanged = JSON.stringify(teamsOf(oldData)) !== JSON.stringify(teamsOf(newData));
      if (before?.exists && after?.exists && !membershipsChanged &&
          minimumAgeConfirmed(oldData) === minimumAgeConfirmed(newData)) return;
      await synchronize(event.params.uid, { scanMemberships: membershipsChanged });
    },
  };
}

module.exports = { createAdAgeProfileBackend };
