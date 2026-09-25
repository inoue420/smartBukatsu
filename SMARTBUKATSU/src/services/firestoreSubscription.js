import { onSnapshot } from "firebase/firestore";
import {
  createFirestoreDiagnostics,
  createMeasuredOnSnapshot,
  formatFirestoreDiagnostics,
} from "./firestoreDiagnostics";

export const firestoreDiagnosticsEnabled = typeof __DEV__ !== "undefined" && __DEV__;
const diagnostics = createFirestoreDiagnostics({ enabled: firestoreDiagnosticsEnabled });

export const measuredOnSnapshot = createMeasuredOnSnapshot(onSnapshot, diagnostics);
export const getFirestoreDiagnosticsText = () =>
  formatFirestoreDiagnostics(diagnostics.getReport());
