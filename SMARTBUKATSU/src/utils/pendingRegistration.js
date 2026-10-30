// Only registration inputs are persisted. Never include email or password here.
const PREFIX = "smartbukatsu:pending-registration:v1:";

function registrationInput(value) {
  if (!value || !["admin", "member"].includes(value.role)) return null;
  if (value.role === "admin" && (!/^[A-Za-z0-9_-]{1,128}$/.test(value.teamId || "") ||
      !/^[A-Za-z0-9]{6}$/.test(value.teamInviteCode || ""))) return null;
  const text = key => typeof value[key] === "string" ? value[key] : "";
  const sport = value.sport || {};
  const consent = value.legalConsent || {};
  return {
    role: value.role,
    userName: text("userName"), teamName: text("teamName"), inviteCode: text("inviteCode"),
    invitationId: text("invitationId"), teamId: text("teamId"), teamInviteCode: text("teamInviteCode"),
    sport: Object.fromEntries(["category", "name", "customName"].map(key => [key, typeof sport[key] === "string" ? sport[key] : ""])),
    legalConsent: Object.fromEntries(["minimumAgeConfirmed", "minorConsentRequirementAcknowledged", "termsAccepted", "privacyPolicyAcknowledged"].map(key => [key, consent[key] === true])),
    profileSaved: value.profileSaved === true,
  };
}

function createPendingRegistrationStore(storage) {
  const memory = new Map();
  const queues = new Map();
  const serial = (uid, operation) => {
    const promise = (queues.get(uid) || Promise.resolve()).catch(() => {}).then(operation);
    queues.set(uid, promise);
    promise.finally(() => { if (queues.get(uid) === promise) queues.delete(uid); }).catch(() => {});
    return promise;
  };
  return {
    read: uid => serial(uid, async () => {
      if (memory.has(uid)) return memory.get(uid);
      const raw = await storage.getItem(PREFIX + uid);
      let value = null;
      try { value = raw ? registrationInput(JSON.parse(raw)) : null; } catch { /* Re-enter invalid inputs after verification. */ }
      memory.set(uid, value);
      return value;
    }),
    save: (uid, input) => serial(uid, async () => {
      const value = registrationInput(input);
      if (!uid || !value) throw new Error("登録情報を確認できませんでした。");
      await storage.setItem(PREFIX + uid, JSON.stringify(value));
      memory.set(uid, value);
      return value;
    }),
    remove: uid => serial(uid, async () => {
      await storage.removeItem(PREFIX + uid);
      memory.delete(uid);
    }),
  };
}

module.exports = { createPendingRegistrationStore };
