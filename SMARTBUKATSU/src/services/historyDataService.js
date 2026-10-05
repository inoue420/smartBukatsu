import { and, collection, doc, documentId, getDocs, limit, or, orderBy, query, startAfter, where } from "firebase/firestore";
import { db } from "../firebase";
import { measuredOnSnapshot } from "./firestoreSubscription";
import { HISTORY_PAGE_SIZE } from "../utils/historyLoading";

const items = (snapshot) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id,
  createdAt: item.data().createdAt?.toMillis?.() ?? item.data().createdAt ?? 0 }));
function historyQuery(teamId, name, options = {}, cursor = null) {
  const path = name === "personalEvents" ? ["users", options.uid, name] : ["teams", teamId, name];
  const clauses = [];
  if (name === "workspacePosts") {
    clauses.push(where("visibleToUids", "array-contains", options.uid));
    if (options.channel) clauses.push(where("channel", "==", options.channel));
  }
  if (name === "clubEvents" || name === "personalEvents") {
    clauses.push(where("date", "<=", options.end), where("lastEventDate", ">=", options.start), orderBy("date", "desc"), orderBy("lastEventDate", "desc"));
  } else if (name === "dailyReports") {
    const filters = [];
    if (options.since) filters.push(where("date", ">=", options.since));
    if (options.start) filters.push(where("date", ">=", options.start), where("date", "<=", options.end));
    if (options.authorUid) filters.push(or(where("authorUid", "==", options.authorUid), where("author", "==", options.author)));
    clauses.push(...(options.authorUid ? [and(...filters)] : filters));
    clauses.push(orderBy("date", "desc"), orderBy("createdAt", "desc"));
  } else clauses.push(orderBy("createdAt", name === "tagGroups" ? "asc" : "desc"));
  if (cursor) clauses.push(startAfter(cursor));
  if (options.count) clauses.push(limit(options.count));
  return query(collection(db, ...path), ...clauses);
}
export function subscribeHistory(teamId, name, options, callback, onError) {
  return measuredOnSnapshot(name, historyQuery(teamId, name, options), (snapshot) => callback({ items: items(snapshot), hasMore: Boolean(options.count && snapshot.size === options.count) }), onError);
}
export async function readHistoryPage(teamId, name, options, cursor) {
  const snapshot = await getDocs(historyQuery(teamId, name, { ...options, count: HISTORY_PAGE_SIZE }, cursor));
  return { items: items(snapshot), cursor: snapshot.docs.at(-1) || null, hasMore: snapshot.size === HISTORY_PAGE_SIZE };
}
export function subscribeLoadingState(teamId, callback, onError) {
  return measuredOnSnapshot("loadingState", doc(db, "teams", teamId, "loadingOptimization", "state"), (snapshot) => {
    // An empty cache does not prove that the server's feature gate is absent.
    if (!snapshot.exists() && snapshot.metadata.fromCache) return;
    callback(snapshot.data() || {});
  }, onError);
}
export function subscribeLoadingSummary(teamId, uid, callback, onError) {
  return measuredOnSnapshot("loadingSummary", doc(db, "teams", teamId, "loadingSummaries", uid), (snapshot) => callback(snapshot.data() || {}), onError);
}
export function subscribeLatestReports(teamId, callback, onError) {
  return measuredOnSnapshot("latestDailyReports", collection(db, "teams", teamId, "latestDailyReports"), (snapshot) => callback(snapshot.docs.map((item) => ({ ...item.data(), createdAt: item.data().createdAt?.toMillis?.() ?? 0 }))), onError);
}
export function subscribeHistoryDocument(teamId, name, id, callback, onError) {
  return measuredOnSnapshot(name, doc(db, "teams", teamId, name, id), (snapshot) => callback(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id, createdAt: snapshot.data().createdAt?.toMillis?.() ?? 0 } : null), onError);
}
export function subscribePostReadStates(teamId, ids, callback, onError) {
  if (!ids.length) { callback({}); return () => {}; }
  const state = {};
  const stops = [];
  for (let index = 0; index < ids.length; index += 30) {
    const chunk = ids.slice(index, index + 30);
    stops.push(measuredOnSnapshot("workspacePostReads", query(collection(db, "teams", teamId, "workspacePostReadStates"), where(documentId(), "in", chunk)), (snapshot) => {
      chunk.forEach((id) => delete state[id]);
      snapshot.docs.forEach((item) => { state[item.id] = item.data(); });
      callback({ ...state });
    }, onError));
  }
  return () => stops.forEach((stop) => stop());
}
export function subscribePinnedPosts(teamId, uid, channel, callback, onError) {
  return measuredOnSnapshot("pinnedWorkspacePosts", query(collection(db, "teams", teamId, "workspacePosts"), where("visibleToUids", "array-contains", uid), where("channel", "==", channel), where("isPinned", "==", true), orderBy("createdAt", "desc")), (snapshot) => callback(items(snapshot)), onError);
}
export function subscribeProjectsByIds(teamId, ids, callback, onError) {
  if (!teamId || !ids.length) { callback([]); return () => {}; }
  const chunks = new Map();
  const stops = [];
  for (let index = 0; index < ids.length; index += 30) {
    const chunk = ids.slice(index, index + 30), key = index;
    stops.push(measuredOnSnapshot("projectReferences", query(collection(db, "teams", teamId, "projects"), where(documentId(), "in", chunk)), (snapshot) => {
      chunks.set(key, items(snapshot));
      if (chunks.size === Math.ceil(ids.length / 30)) callback([...chunks.values()].flat());
    }, onError));
  }
  return () => stops.forEach((stop) => stop());
}
