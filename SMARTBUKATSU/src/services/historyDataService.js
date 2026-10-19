import { and, collection, doc, documentId, getDocs, limit, or, orderBy, query, startAfter, where } from "firebase/firestore";
import { db } from "../firebase";
import { measuredOnSnapshot } from "./firestoreSubscription";
import { HISTORY_PAGE_SIZE, reportDay } from "../utils/historyLoading";

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
    if (!options.start || !options.end || !options.authorUid) throw new Error("カレンダーの日報取得には本人と期間の指定が必要です。");
    const filters = [];
    const dateValue = (value) => options.dateFormat === "slash" ? reportDay(value).replaceAll("-", "/") : reportDay(value);
    if (options.start) filters.push(where("date", ">=", dateValue(options.start)), where("date", "<=", dateValue(options.end)));
    if (options.authorUid) filters.push(or(where("authorUid", "==", options.authorUid), where("author", "==", options.author)));
    clauses.push(...(options.authorUid ? [and(...filters)] : filters));
    clauses.push(orderBy("date", "desc"), orderBy("createdAt", "desc"));
  } else clauses.push(orderBy("createdAt", name === "tagGroups" ? "asc" : "desc"));
  if (cursor) clauses.push(startAfter(cursor));
  if (options.count) clauses.push(limit(options.count));
  return query(collection(db, ...path), ...clauses);
}
export function subscribeHistory(teamId, name, options, callback, onError) {
  // Old clients write YYYY/MM/DD. Bound each format separately; a single ISO
  // range would silently omit slash dates (or fetch nearly a year with >=).
  if (name === "dailyReports" && options.start && !options.dateFormat) {
    const pages = new Map(); let failed = false;
    const stops = ["iso", "slash"].map((dateFormat) => subscribeHistory(teamId, name,
      { ...options, dateFormat }, (page) => {
        if (failed) return;
        pages.set(dateFormat, page);
        if (pages.size !== 2) return;
        const merged = [...new Map([...pages.values()].flatMap((p) => p.items).map((item) => [item.id, item])).values()];
        merged.sort((a, b) => reportDay(b.date).localeCompare(reportDay(a.date)) || b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        callback({ items: merged, hasMore: [...pages.values()].some((p) => p.hasMore), fromCache: [...pages.values()].some((p) => p.fromCache) });
      }, (error) => { failed = true; onError?.(error); }));
    return () => stops.forEach((stop) => stop());
  }
  return measuredOnSnapshot(name, historyQuery(teamId, name, options), (snapshot) => callback({ items: items(snapshot), hasMore: Boolean(options.count && snapshot.size === options.count), fromCache: snapshot.metadata?.fromCache === true }), onError,
    name === "dailyReports" ? { includeMetadataChanges: true } : undefined);
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
  }, onError, { includeMetadataChanges: true });
}
export function subscribeLoadingSummary(teamId, uid, callback, onError) {
  return measuredOnSnapshot("loadingSummary", doc(db, "teams", teamId, "loadingSummaries", uid), (snapshot) => callback(snapshot.data() || {}), onError);
}
export function subscribeLatestReports(teamId, callback, onError) {
  return measuredOnSnapshot("latestDailyReports", collection(db, "teams", teamId, "latestDailyReports"), (snapshot) => callback(snapshot.docs.map((item) => ({ ...item.data(), createdAt: item.data().createdAt?.toMillis?.() ?? 0 }))), onError);
}
export function subscribeHistoryDocument(teamId, name, id, callback, onError) {
  return measuredOnSnapshot(name, doc(db, "teams", teamId, name, id), (snapshot) => {
    if (!snapshot.exists() && snapshot.metadata?.fromCache) return;
    callback(snapshot.exists() ? { ...snapshot.data(), id: snapshot.id, createdAt: snapshot.data().createdAt?.toMillis?.() ?? snapshot.data().createdAt ?? 0 } : null);
  }, onError, { includeMetadataChanges: true });
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
