function createInterstitialSettingsBackend({ firestore, FieldValue, HttpsError }) {
  function account(request) {
    const uid = request.auth?.uid;
    if (!uid || request.auth.token?.email_verified !== true) throw new HttpsError("unauthenticated", "メール確認済みのログインが必要です。");
    if (request.data?.expectedUid !== uid) throw new HttpsError("failed-precondition", "ログイン状態が変わりました。");
    return uid;
  }
  async function isOperator(uid, transaction) {
    const read = ref => transaction ? transaction.get(ref) : ref.get();
    const invite = await read(firestore.doc("invites/AWUH95"));
    const teamId = invite.data()?.teamId;
    if (typeof teamId !== "string" || !teamId || teamId.includes("/")) return false;
    return (await read(firestore.doc(`teams/${teamId}/members/${uid}`))).exists;
  }
  return {
    async access(request) { return { allowed: await isOperator(account(request)) }; },
    async save(request) {
      const uid = account(request), { audience, minimumUsageMinutes } = request.data;
      if (!["off", "debug", "all"].includes(audience) || !Number.isInteger(minimumUsageMinutes) ||
          minimumUsageMinutes < 1 || minimumUsageMinutes > 30) throw new HttpsError("invalid-argument", "広告設定が不正です。");
      await firestore.runTransaction(async transaction => {
        if (!await isOperator(uid, transaction)) throw new HttpsError("permission-denied", "運営チーム所属者のみ変更できます。");
        transaction.set(firestore.doc("appConfig/interstitialAds"), { audience, minimumUsageMinutes,
          updatedAt: FieldValue.serverTimestamp(), updatedBy: uid });
      });
      return { audience, minimumUsageMinutes };
    },
  };
}
module.exports = { createInterstitialSettingsBackend };
