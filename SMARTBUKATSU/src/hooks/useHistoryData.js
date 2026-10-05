import { useCallback, useEffect, useRef, useState } from "react";
import { readHistoryPage, subscribeHistory, subscribeHistoryDocument } from "../services/historyDataService";
import { HISTORY_PAGE_SIZE } from "../utils/historyLoading";

// A requested larger window stays live, including old edits and deletions.
// Search scans are explicit, cancellable, and never run merely on text entry.
export function useHistoryData(teamId, name, active, options, receive) {
  const [count, setCount] = useState(HISTORY_PAGE_SIZE);
  const [all, setAll] = useState(false);
  const [past, setPast] = useState(false);
  const [included, setIncluded] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [scanned, setScanned] = useState(0);
  const generation = useRef(0), scanning = useRef(false);
  const wasActive = useRef(false);
  const base = useRef([]), extras = useRef({}), size = useRef(0);
  const optionKey = JSON.stringify(options);
  useEffect(() => {
    generation.current += 1; scanning.current = false;
    setCount(HISTORY_PAGE_SIZE); setAll(false); setPast(false); base.current = []; size.current = 0;
    setBusy(false); setError(""); setScanned(0);
  }, [teamId, optionKey, active]);
  useEffect(() => { setIncluded([]); extras.current = {}; }, [teamId, active]);
  useEffect(() => {
    const epoch = ++generation.current;
    if (!active || !teamId) {
      if (wasActive.current) receive([]);
      wasActive.current = false; setHasMore(false); return undefined;
    }
    wasActive.current = true;
    setBusy(true); setError("");
    const range = { ...options, count: name === "tagGroups" || ((name === "dailyReports" || name === "clubEvents" || name === "personalEvents") && !past) ? null : count };
    if (past) delete range.since;
    const stop = subscribeHistory(teamId, name, range, (page) => {
      if (generation.current !== epoch) return;
      base.current = page.items; size.current = page.items.length;
      receive([...new Map([...page.items, ...Object.values(extras.current).filter(Boolean)].map((item) => [item.id, item])).values()]);
      setHasMore(page.hasMore || (name === "dailyReports" && !past)); setBusy(scanning.current);
    }, (failure) => {
      if (generation.current !== epoch) return;
      setError(failure?.code === "permission-denied" ? "閲覧権限を確認してください。" : "読み込みに失敗しました。通信状態を確認して再試行してください。");
      setBusy(false);
    });
    return () => { generation.current += 1; stop(); };
  }, [teamId, name, active, optionKey, count, past, receive]);
  useEffect(() => {
    if (!active || !teamId) return undefined;
    let live = true;
    const stops = included.map((id) => subscribeHistoryDocument(teamId, name, id, (item) => {
      if (!live) return;
      if (item && name === "workspacePosts" && !(item.visibleToUids || []).includes(options.uid)) item = null;
      extras.current[id] = item;
      const deleted = new Set(Object.keys(extras.current).filter((key) => extras.current[key] === null));
      receive([...new Map([...base.current.filter((value) => !deleted.has(value.id)), ...Object.values(extras.current).filter(Boolean)].map((value) => [value.id, value])).values()]);
    }, () => { if (live) setError("対象の履歴を開けませんでした。"); }));
    return () => { live = false; stops.forEach((stop) => stop()); };
  }, [teamId, name, active, included, receive]);
  const include = useCallback((id) => { if (id) setIncluded((current) => current.includes(id) ? current : [...current, id]); }, []);
  const loadMore = useCallback(() => {
    if (name === "dailyReports" && !past) { setPast(true); setCount(size.current + HISTORY_PAGE_SIZE); }
    else setCount((current) => current + HISTORY_PAGE_SIZE);
  }, [name, past]);
  const searchAll = useCallback(async () => {
    if (scanning.current || !active || !teamId) return;
    const epoch = generation.current;
    scanning.current = true; setBusy(true); setError(""); setScanned(0);
    let cursor = null, total = 0;
    try {
      do {
        const page = await readHistoryPage(teamId, name, { ...options, since: null }, cursor);
        if (generation.current !== epoch || !scanning.current) return;
        total += page.items.length; setScanned(total); cursor = page.cursor;
        if (!page.hasMore) break;
      } while (cursor);
      // The final live window supersedes scan results, so stale/deleted rows cannot survive.
      scanning.current = false; setAll(true); setPast(true); setCount(Math.max(HISTORY_PAGE_SIZE, total + HISTORY_PAGE_SIZE));
    } catch {
      if (generation.current === epoch) { setError("過去履歴の検索に失敗しました。再試行してください。"); setBusy(false); }
      scanning.current = false;
    }
  }, [active, teamId, name, optionKey]);
  const cancel = useCallback(() => { scanning.current = false; setBusy(false); }, []);
  const reset = useCallback(() => { scanning.current = false; setAll(false); setPast(false); setCount(HISTORY_PAGE_SIZE); setScanned(0); }, []);
  return { busy, searching: scanning.current, error, hasMore, scanned, all, loadMore, searchAll, cancel, reset,
    include, retry: () => setCount((current) => current + 1) };
}
