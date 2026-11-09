const INITIAL_DELAYS = [30000, 60000];
const RECOVERY_INTERVAL = 60000;

function initializationFailureKind(error, stage) {
  const code = String(error?.code || "").split("/").pop();
  if (stage === "configuration" || ["invalid-request", "invalid-argument", "os-version-too-low",
    "application-identifier-missing", "age-treatment-unavailable", "unsupported-platform",
    "not-supported", "native-module-not-found"].includes(code)) return "permanent";
  return "transient";
}

// One bounded startup sequence, followed only by external recovery events.
// Timers can finish a requested cooldown; they never start a periodic retry loop.
function createInitializationRecovery({ initialize, enqueue, isCurrent, onEvent,
  foreground = true, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let stopped = false, started = false, running = false, online = null;
  let phase = "initial", attempts = 0, pending = false, timer = null;
  let dueAt = now(), lastCompleted = -Infinity;
  const live = () => !stopped && isCurrent();
  const cancel = () => { if (timer !== null) clearTimer(timer); timer = null; };

  const pump = () => {
    cancel();
    if (!live() || !started || running || !foreground || online === false ||
        phase === "ready" || phase === "permanent" || (phase !== "initial" && !pending)) return;
    const remaining = (phase === "initial" ? dueAt : lastCompleted + RECOVERY_INTERVAL) - now();
    if (remaining > 0) { timer = setTimer(pump, remaining); return; }
    running = true;
    pending = false;
    const initial = phase === "initial", consentOnly = phase === "consent";
    void enqueue(async () => {
      if (!live()) return;
      if (!foreground || online === false) {
        running = false;
        if (!initial) pending = true;
        return;
      }
      if (initial) attempts++;
      onEvent(initial ? "initialization-attempt" : "recovery-attempt");
      let outcome;
      try { outcome = await initialize({ consentOnly }); }
      catch { outcome = "transient"; }
      if (!live()) return;
      running = false;
      lastCompleted = now();
      if (outcome === "ready") { phase = "ready"; cancel(); return; }
      if (outcome === "permanent") { phase = "permanent"; onEvent("retry-permanent"); return; }
      if (outcome === "consent-blocked" || outcome === "consent-check-failed") {
        phase = "consent"; onEvent("retry-consent"); return;
      }
      if (initial && INITIAL_DELAYS[attempts - 1] !== undefined) {
        dueAt = now() + INITIAL_DELAYS[attempts - 1];
        onEvent("retry-scheduled"); pump(); return;
      }
      phase = "waiting";
      onEvent("retry-exhausted");
    });
  };

  const recover = trigger => {
    if (!live() || running || phase === "ready" || phase === "permanent") return;
    if (phase === "consent" && trigger !== "foreground") return;
    if (phase !== "initial") {
      if (!pending) onEvent("recovery-scheduled");
      pending = true;
    }
    pump();
  };

  return {
    start() { if (!started) { started = true; pump(); } },
    setForeground(value) {
      const previous = foreground; foreground = value;
      if (!value) cancel();
      else if (!previous) recover("foreground");
    },
    setOnline(value) {
      const previous = online; online = value;
      if (value === false) cancel();
      else if (previous === false && value === true) recover("network");
      else if (phase === "initial") pump();
    },
    stop() { stopped = true; cancel(); },
  };
}

module.exports = { createInitializationRecovery, initializationFailureKind };
