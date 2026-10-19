import { collection, documentId, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { measuredOnSnapshot } from "./firestoreSubscription";
import { reportDay } from "../utils/historyLoading";
import { canReadDailyReport } from "../utils/dailyReportScope";

const dataOf = (snapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id,
  createdAt: doc.data().createdAt?.toMillis?.() ?? doc.data().createdAt ?? 0 }));
const newest = (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id);
function audiences(scope) {
  if (scope.allAuthors) return [[]];
  const result = [];
  for (const field of ["authorUid", "author"]) {
    const values = [...new Set(scope.authors.map((a) => field === "authorUid" ? a.uid : a.name).filter(Boolean))];
    for (let i = 0; i < values.length; i += 30) result.push([where(field, "in", values.slice(i, i + 30))]);
  }
  if (scope.includeShared) result.push([where("sharedWith", "==", "all")]);
  return result;
}
// Separate audiences avoid Firestore's OR-disjunction limit for large rosters.
// Only an owner may start an unbounded history subscription. Alert/detail
// queries have their own explicit filters and never load the complete history.
export function subscribeDailyReportHistory(teamId, options, callback, onError) {
  const { scope, start, end, reportId, unreviewed } = options;
  if (!scope?.ready || !teamId) return () => {};
  if (!start && !reportId && !unreviewed && !scope.canSearchAll) {
    onError?.({ code: "permission-denied" }); return () => {};
  }
  const branches = audiences(scope).flatMap((audience) => (start ? ["iso", "slash"] : [null]).map((format) => {
    const clauses = [...audience];
    if (start) {
      const date = (s) => format === "slash" ? reportDay(s).replaceAll("-", "/") : reportDay(s);
      clauses.push(where("date", ">=", date(start)), where("date", "<=", date(end)));
    }
    if (reportId) clauses.push(where(documentId(), "==", reportId));
    if (unreviewed) clauses.push(where("isReviewed", "==", false));
    if (!reportId && !unreviewed) clauses.push(orderBy("date", "desc"), orderBy("createdAt", "desc"));
    return query(collection(db, "teams", teamId, "dailyReports"), ...clauses);
  }));
  if (!branches.length) { callback({ items: [], fromCache: false }); return () => {}; }
  const pages = new Map(); let live = true, failed = false;
  const stops = branches.map((ref, index) => measuredOnSnapshot("dailyReports", ref, (snapshot) => {
    if (!live || failed) return;
    pages.set(index, { items: dataOf(snapshot), cached: snapshot.metadata?.fromCache === true });
    if (pages.size !== branches.length) return;
    const items = [...new Map([...pages.values()].flatMap((p) => p.items).filter((item) => canReadDailyReport(scope, item)).map((item) => [item.id, item])).values()];
    items.sort((a, b) => reportDay(b.date).localeCompare(reportDay(a.date)) || newest(a, b));
    callback({ items, fromCache: [...pages.values()].some((p) => p.cached), hasMore: false });
  }, (error) => { if (live && !failed) { failed = true; onError?.(error); } }, { includeMetadataChanges: true }));
  return () => { live = false; stops.forEach((stop) => stop()); };
}
export function subscribeDailyReportDocument(teamId, _name, id, callback, onError, scope) {
  return subscribeDailyReportHistory(teamId, { scope, reportId: id }, (page) => {
    if (!page.fromCache || page.items.length) callback(page.items[0] || null);
  }, onError);
}
// These all-time queries return only unreviewed alerts, never the history list.
export function subscribeUnreviewedReports(teamId, scope, callback, onError) {
  return subscribeDailyReportHistory(teamId, { scope: { ...scope, includeShared: false }, unreviewed: true },
    (page) => { if (!page.fromCache) callback(page.items); }, onError);
}
// When server summaries are off, preserve roster conditions with one latest
// record per author instead of subscribing to the team's entire report history.
export function subscribeRosterLatestReports(teamId, profiles, callback, onError) {
  let live = true; const pages = new Map(), stops = new Map();
  const authors = Object.entries(profiles).filter(([, p]) => p.uid);
  const expected = authors.length * 2;
  if (!expected) { callback([]); return () => {}; }
  const publish = () => {
    if (!live || pages.size !== expected) return;
    callback(authors.flatMap(([name, p]) => {
      const candidates = [...(pages.get(p.uid + ":authorUid") || []), ...(pages.get(p.uid + ":author") || [])]
        .filter((r) => r.status !== "deleted" && (r.authorUid ? r.authorUid === p.uid : r.author === name)).sort(newest);
      return candidates.length ? [{ ...candidates[0], author: name }] : [];
    }));
  };
  const watch = (name, author, field, count) => {
    const key = author.uid + ":" + field;
    const ref = query(collection(db, "teams", teamId, "dailyReports"), where(field, "==", field === "authorUid" ? author.uid : name), orderBy("createdAt", "desc"), limit(count));
    let retired = false;
    const stop = measuredOnSnapshot("latestDailyReportsFallback", ref, (snapshot) => {
      if (!live || retired) return;
      const rows = dataOf(snapshot), valid = rows.filter((r) => r.status !== "deleted" && (r.authorUid ? r.authorUid === author.uid : r.author === name));
      if (!snapshot.metadata?.fromCache && !valid.length && snapshot.size === count) {
        retired = true; queueMicrotask(() => { if (live) { stops.get(key)?.(); watch(name, author, field, count + 25); } }); return;
      }
      if (!valid.length && snapshot.metadata?.fromCache) return;
      pages.set(key, valid); publish();
    }, onError, { includeMetadataChanges: true });
    stops.set(key, stop);
  };
  authors.forEach(([name, author]) => ["authorUid", "author"].forEach((field) => watch(name, author, field, 1)));
  return () => { live = false; stops.forEach((stop) => stop()); };
}
