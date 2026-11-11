import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, cloudFunctions, isCaptureEnvironment } from "../firebase";
import { measuredOnSnapshot } from "./firestoreSubscription";

const RETRY_COOLDOWN_MS = 60000;
const normalize = value => {
  if (value?.schemaVersion !== 1 || typeof value.adultConfirmed !== "boolean" ||
      typeof value.minimumAgeConfirmed !== "boolean") return null;
  const audience = value.adultConfirmed ? "adult" : value.minimumAgeConfirmed ? "teen" : "unknown";
  return value.audience === audience ? { adultConfirmed: value.adultConfirmed,
    minimumAgeConfirmed: value.minimumAgeConfirmed } : null;
};

// A server handshake on each login precedes the first server-confirmed snapshot.
// Cached adult data alone must never enable requests for a new login session.
export function subscribeAdAgeProfile(uid, next) {
  if (Platform.OS === "web" || isCaptureEnvironment) return () => {};
  const account = auth.currentUser;
  if (!uid || account?.uid !== uid) return () => {};
  let disposed = false, inFlight = false, resolved = false, online = null;
  let lastAttempt = -Infinity, timer = null, stopSnapshot = null;
  let generation = 0;
  let recoveryPending = false;
  let lastValue = null;
  const current = () => !disposed && auth.currentUser === account;
  const cancelTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const fail = () => {
    if (!current()) return;
    generation++;
    resolved = false; lastValue = null;
    stopSnapshot?.(); stopSnapshot = null;
    next(null);
    if (recoveryPending && !inFlight) void initialize();
  };
  const initialize = async (externalEvent = false) => {
    if (!current() || resolved) { recoveryPending = false; return; }
    // Preserve events observed while a request or its first snapshot is pending.
    // A live Firestore listener reconnects itself; only its failure needs replay.
    if (externalEvent) recoveryPending = true;
    if (inFlight || stopSnapshot || AppState.currentState !== "active" || online === false) return;
    const delay = RETRY_COOLDOWN_MS - (Date.now() - lastAttempt);
    if (delay > 0) {
      if (recoveryPending && timer === null) timer = setTimeout(() => {
        timer = null; void initialize();
      }, delay);
      return;
    }
    cancelTimer(); recoveryPending = false; inFlight = true; lastAttempt = Date.now();
    const epoch = ++generation;
    const currentAttempt = () => current() && generation === epoch;
    try {
      const result = await httpsCallable(cloudFunctions, "ensureAdAgeProfile")({ expectedUid: uid });
      if (!currentAttempt()) return;
      if (result.data?.uid !== uid || !normalize(result.data)) throw new Error("invalid-ad-age-profile");
      stopSnapshot?.();
      const unsubscribe = measuredOnSnapshot("adAgeProfile", doc(db, "users", uid, "adAge", "profile"), snapshot => {
        if (!currentAttempt() || snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) return;
        const value = snapshot.exists() ? normalize(snapshot.data()) : null;
        if (!value) { fail(); return; }
        resolved = true; recoveryPending = false; cancelTimer();
        const key = JSON.stringify(value);
        if (key !== lastValue) { lastValue = key; next(value); }
      }, () => { if (currentAttempt()) fail(); }, { includeMetadataChanges: true });
      if (currentAttempt()) stopSnapshot = unsubscribe;
      else unsubscribe();
    } catch {
      // SDK errors may contain request/account details. Expose no raw error.
      if (currentAttempt()) fail();
    } finally {
      inFlight = false;
      if (recoveryPending && !stopSnapshot) void initialize();
    }
  };
  const updateNetwork = state => {
    if (!current()) return;
    const previous = online;
    online = state.isConnected === false || state.isInternetReachable === false
      ? false : state.isConnected === true ? true : null;
    if (online === false) cancelTimer();
    else if (online === true && previous !== true) void initialize(true);
  };
  const app = AppState.addEventListener("change", state => {
    if (state !== "active") cancelTimer();
    else {
      // iOS can miss network events while suspended. Refresh a failed startup.
      if (!resolved) void NetInfo.refresh().then(updateNetwork).catch(() => {});
      void initialize(true);
    }
  });
  const stopNetwork = NetInfo.addEventListener(updateNetwork);
  void initialize();
  return () => {
    disposed = true; recoveryPending = false; cancelTimer(); stopSnapshot?.(); app.remove(); stopNetwork();
  };
}
