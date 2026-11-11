const SETTINGS_TTL_MS = 15 * 60 * 1000;
const DEFAULT_POLICY = Object.freeze({ audience: "debug", minimumUsageMinutes: 10 });
const MODES = ["off", "debug", "all"];
const STORAGE_KEY = "admob_interstitial_usage_v2";
const LEGACY_KEY = "admob_interstitial_daily_count_v1";

function normalizePolicy(value) {
  if (!value || !MODES.includes(value.audience) || !Number.isInteger(value.minimumUsageMinutes) ||
      value.minimumUsageMinutes < 1 || value.minimumUsageMinutes > 30) return null;
  return { audience: value.audience, minimumUsageMinutes: value.minimumUsageMinutes };
}
function dateKey(time) {
  const date = new Date(time);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")].join("-");
}
function dayStart(time) { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); }

// One device-wide ledger. Only settings refreshes use the network; usage and
// opportunity checks are local. Pending reservations survive process death.
function createInterstitialController({ storage, fetchPolicy, now = Date.now, onPolicy = () => {} }) {
  let state = { date: dateKey(now()), count: 0, usageMs: 0 }, healthy = false;
  let active = false, lastAt = now(), uid = null, policy = null, fetchedAt = -Infinity;
  let generation = 0, inFlight = null, lastAttempt = -Infinity, busy = false, writes = Promise.resolve();
  let initialized = null, policyRevision = 0;
  function settle() {
    const time = now(), day = dateKey(time);
    if (state.date !== day) state = { date: day, count: 0, usageMs: 0 };
    if (active) state.usageMs += Math.max(0, time - Math.max(lastAt, dayStart(time)));
    lastAt = time;
  }
  function persist() {
    const value = JSON.stringify(state);
    const result = writes.then(() => storage.setItem(STORAGE_KEY, value));
    writes = result.catch(() => { healthy = false; });
    return result;
  }
  const fresh = () => policy && now() >= fetchedAt && now() - fetchedAt < SETTINGS_TTL_MS;
  const allowed = () => fresh() && (policy.audience === "all" ||
    (policy.audience === "debug" && policy.isDebugMember === true));
  async function refresh(force = false) {
    settle();
    if (!uid || (!force && (state.count >= 1 || fresh()))) return false;
    if (inFlight) return inFlight;
    if (!force && now() - lastAttempt < 60000) return false;
    const token = generation, expectedUid = uid, started = now();
    lastAttempt = started;
    const task = Promise.resolve().then(() => fetchPolicy(expectedUid)).then(value => {
      if (generation !== token || uid !== expectedUid) return false;
      const settings = normalizePolicy(value);
      if (!settings) throw new Error("invalid-policy");
      policy = { ...settings, isDebugMember: value.isDebugMember === true };
      fetchedAt = started; policyRevision++; onPolicy(policy); return true;
    }).catch(() => {
      if (generation === token) { policy = null; fetchedAt = -Infinity; policyRevision++; onPolicy(null); }
      return false;
    }).finally(() => { if (inFlight === task) inFlight = null; });
    inFlight = task;
    return task;
  }
  return {
    initialize() {
      if (!initialized) initialized = (async () => {
        try {
          const raw = await storage.getItem(STORAGE_KEY);
          const saved = raw ? JSON.parse(raw) : null;
          if (saved && (!Number.isFinite(saved.usageMs) || saved.usageMs < 0 ||
              !Number.isInteger(saved.count) || saved.count < 0 || typeof saved.date !== "string")) throw new Error("invalid-ledger");
          if (saved?.date === dateKey(now())) state = { date: saved.date,
            usageMs: saved.usageMs, count: saved.pending ? 1 : Math.min(1, saved.count) };
          if (!raw) {
            const legacyRaw = await storage.getItem(LEGACY_KEY);
            const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
            if (legacy?.date === state.date && legacy.count > 0) state.count = 1;
          }
          healthy = true;
          // Initialization time is not counted until the ledger is resolved.
          lastAt = now();
        } catch { healthy = false; }
        return healthy;
      })();
      return initialized;
    },
    setUser(value) {
      if (uid === value) return;
      uid = value; generation++; policyRevision++; policy = null; fetchedAt = -Infinity;
      inFlight = null; lastAttempt = -Infinity; onPolicy(null);
    },
    setActive(value) { settle(); active = Boolean(value); },
    checkpoint() { settle(); return healthy ? persist().catch(() => {}) : Promise.resolve(); },
    refresh,
    applySaved(value) {
      const settings = normalizePolicy(value);
      if (!settings || !uid) return false;
      generation++; inFlight = null;
      policy = { ...settings, isDebugMember: true }; fetchedAt = now(); policyRevision++; onPolicy(policy); return true;
    },
    canPreload() { settle(); return healthy && uid && active && state.count < 1 && allowed(); },
    snapshot() { settle(); return { ...state, healthy, busy, fresh: Boolean(fresh()), policyRevision }; },
    async reserve(isSafe, usageAtOpportunity = Infinity) {
      settle();
      if (!healthy || busy || !uid || !active || state.count >= 1 || !isSafe()) return null;
      if (!fresh()) { void refresh(); return null; }
      if (!allowed() || Math.min(state.usageMs, usageAtOpportunity) < policy.minimumUsageMinutes * 60000) return null;
      const token = generation, day = state.date;
      busy = true; state.pending = true;
      try { await persist(); } catch { busy = false; return null; }
      let opened = false, finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true; settle(); delete state.pending; busy = false;
        if (healthy) await persist().catch(() => {});
      };
      // No delayed opportunity is retained after a navigation/account change.
      settle();
      if (token !== generation || day !== state.date || !active || !isSafe() || !allowed()) {
        await finish(); return null;
      }
      return {
        opened() {
          if (opened || finished) return;
          opened = true; settle(); state.count = 1; delete state.pending;
          void persist().catch(() => {});
        },
        finish,
      };
    },
  };
}

module.exports = { SETTINGS_TTL_MS, DEFAULT_POLICY, MODES, normalizePolicy, dateKey, createInterstitialController };
