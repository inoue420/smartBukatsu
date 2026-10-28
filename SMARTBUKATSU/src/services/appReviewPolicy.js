// Device-local history. No review result or rating is available from the stores.
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_COOLDOWN_MS = 120 * DAY_MS;
const REVIEW_YEAR_MS = 365 * DAY_MS;

function localDay(now) {
  const date = new Date(now);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}

function normalizeHistory(raw, now) {
  if (!raw || raw.version !== 1 || !Number.isFinite(raw.firstUsedAt) ||
      raw.firstUsedAt <= 0 || raw.firstUsedAt > now ||
      !Array.isArray(raw.usedDays) || !Array.isArray(raw.attempts)) {
    return { version: 1, firstUsedAt: now, usedDays: [], attempts: [] };
  }
  return {
    version: 1,
    firstUsedAt: raw.firstUsedAt,
    usedDays: [...new Set(raw.usedDays.filter(day => typeof day === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort().slice(-365),
    // Preserve future attempts after a clock rollback, to fail closed.
    attempts: raw.attempts.filter(at => Number.isFinite(at) && at > 0 &&
      at > now - REVIEW_YEAR_MS).sort((a, b) => a - b),
  };
}

function eligibleForReview(history, now) {
  const lastAttempt = history.attempts.at(-1);
  return now - history.firstUsedAt >= 7 * DAY_MS && history.usedDays.length >= 3 &&
    history.usedDays.includes(localDay(now)) && history.attempts.length < 3 &&
    (lastAttempt === undefined || now - lastAttempt >= REVIEW_COOLDOWN_MS);
}

function createReviewHistory({ storage, now = Date.now }) {
  // All reads/updates are serialized, including simultaneous completion events.
  let pending = Promise.resolve();
  const serialize = action => {
    const result = pending.then(action);
    pending = result.catch(() => {});
    return result;
  };
  const key = uid => `smartbukatsu_review_v1:${uid}`;
  async function read(uid, at) {
    const value = await storage.getItem(key(uid));
    let parsed;
    try { parsed = value ? JSON.parse(value) : null; } catch { parsed = null; }
    return normalizeHistory(parsed, at);
  }
  return {
    recordUse(uid) {
      if (!uid) return Promise.resolve(false);
      return serialize(async () => {
        const at = now(), history = await read(uid, at);
        const today = localDay(at);
        history.usedDays = [...new Set([...history.usedDays, today])].sort().slice(-365);
        await storage.setItem(key(uid), JSON.stringify(history));
        return true;
      });
    },
    attempt(uid, isSafe, requestReview, isAvailable) {
      if (!uid) return Promise.resolve(false);
      return serialize(async () => {
        if (!isSafe()) return false;
        const at = now(), history = await read(uid, at);
        if (!eligibleForReview(history, at) || !await isAvailable() || !isSafe()) return false;
        // Save BEFORE the native call, even if the OS declines to display it.
        history.attempts.push(at);
        await storage.setItem(key(uid), JSON.stringify(history));
        if (!isSafe()) return false;
        await requestReview();
        return true;
      });
    },
  };
}

module.exports = { DAY_MS, REVIEW_COOLDOWN_MS, REVIEW_YEAR_MS, localDay,
  normalizeHistory, eligibleForReview, createReviewHistory };
