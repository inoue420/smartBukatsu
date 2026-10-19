import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { subscribeDailyReportHistory, subscribeDailyReportDocument } from "../services/dailyReportReadService";
import { jstDay, reportWeek } from "../utils/historyLoading";

// Windows remain live once explicitly opened, and all listeners stop on blur.
// No count limit: a busy team's seven days must never lose the 51st report.
export function useDailyReportHistory(teamId, requestedActive, receive, scope) {
  const [foreground, setForeground] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const active = requestedActive && foreground && scope?.ready === true;
  const scopeKey = JSON.stringify(scope);
  const [today, setToday] = useState(jstDay);
  const [weeks, setWeeks] = useState([{ offset: 0, open: true, loaded: true }]);
  const [all, setAll] = useState(false), [included, setIncluded] = useState([]);
  const [states, setStates] = useState({}), [retry, setRetry] = useState(0);
  const cache = useRef(new Map()), pinned = useRef(new Map()), listeners = useRef(new Map()), epoch = useRef(0), emit = useRef(() => {});
  const wasActive = useRef(false), resetPending = useRef(false);
  useEffect(() => {
    const refresh = () => setToday(jstDay());
    refresh(); const timer = setInterval(refresh, 30000);
    const subscription = AppState.addEventListener("change", (state) => { setForeground(state === "active"); if (state === "active") refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  useEffect(() => {
    epoch.current++; cache.current = new Map(); pinned.current = new Map(); setStates({});
    resetPending.current = true;
    setWeeks([{ offset: 0, open: true, loaded: true }]); setAll(false); setIncluded([]);
    if (active || wasActive.current) receive([]);
    wasActive.current = active;
    return () => { epoch.current++; listeners.current.forEach((stop) => stop()); listeners.current.clear(); };
  }, [teamId, active, today, retry, receive, scopeKey]);
  const offsets = weeks.filter((week) => week.loaded).map((week) => week.offset).join(",");
  const openOffsets = weeks.filter((week) => week.open).map((week) => week.offset).join(",");
  emit.current = () => {
    const visible = all ? cache.current.get("all") || [] : openOffsets.split(",").flatMap((key) => cache.current.get(key) || []);
    const deleted = new Set([...pinned.current].filter(([, value]) => !value).map(([id]) => id));
    receive([...new Map([...visible.filter((item) => !deleted.has(item.id)), ...[...pinned.current.values()].filter(Boolean),
      ...[...deleted].map((id) => ({ id, status: "deleted" }))].map((item) => [item.id, item])).values()]);
  };
  useEffect(() => { if (active) emit.current(); }, [active, openOffsets, all]);
  useEffect(() => {
    if (!active || !teamId) return undefined;
    const generation = epoch.current, reset = resetPending.current; resetPending.current = false;
    const windows = reset ? [{ key: "0", range: reportWeek(today) }] : all ? [{ key: "all", range: {} }] : offsets.split(",").map((offset) => ({ key: offset, range: reportWeek(today, Number(offset)) }));
    const wanted = new Set([...windows.map((window) => window.key), ...(reset ? [] : included.map((id) => `id:${id}`))]);
    for (const [key, stop] of listeners.current) if (!wanted.has(key)) { stop(); listeners.current.delete(key); }
    for (const { key, range } of windows) {
      if (listeners.current.has(key)) continue;
      listeners.current.set(key, subscribeDailyReportHistory(teamId, { ...range, scope, count: null }, (page) => {
        if (epoch.current !== generation) return; cache.current.set(key, page.items);
        setStates((current) => ({ ...current, [key]: { loaded: !page.fromCache, cached: Boolean(page.fromCache), empty: !page.fromCache && !page.items.length } })); emit.current();
      }, () => { if (epoch.current === generation) setStates((current) => ({ ...current, [key]: { error: true } })); }));
    }
    for (const id of reset ? [] : included) {
      const key = `id:${id}`; if (listeners.current.has(key)) continue;
      listeners.current.set(key, subscribeDailyReportDocument(teamId, "dailyReports", id, (item) => {
        if (epoch.current !== generation) return; pinned.current.set(id, item); emit.current();
      }, () => {
        if (epoch.current !== generation) return;
        pinned.current.set(id, null); emit.current();
        setStates((current) => ({ ...current, detail: { error: true } }));
      }, scope));
    }
  }, [teamId, active, today, offsets, all, included, retry, receive, scopeKey]);
  const include = useCallback((id) => { if (id) setIncluded((ids) => ids.includes(id) ? ids : [...ids, id]); }, []);
  const loadMore = () => setWeeks((current) => [...current, { offset: current.length, open: false }]);
  return { weeks: weeks.map((week) => ({ ...week, ...reportWeek(today, week.offset), state: states[String(week.offset)] })),
    toggleWeek: (offset) => setWeeks((current) => current.map((week) => week.offset === offset ? { ...week, loaded: true, open: !week.open } : week)),
    include, all, canSearchAll: scope?.canSearchAll === true, busy: requestedActive && (!scope?.ready || (active && (all ? !states.all?.loaded && !states.all?.error : weeks.some((week) => week.open && !states[String(week.offset)]?.loaded && !states[String(week.offset)]?.error)))),
    isDateLoaded: (day) => all ? states.all?.loaded === true : weeks.some((week) => {
      const range = reportWeek(today, week.offset);
      return week.open && states[String(week.offset)]?.loaded && range.start <= day && day <= range.end;
    }),
    error: Object.values(states).some((state) => state.error) ? "読み込みに失敗しました。通信状態と閲覧権限を確認してください。" : "",
    hasMore: !all, loadMore, searchAll: () => { if (active && scope.canSearchAll) setAll(true); }, reset: () => { setAll(false); setRetry((value) => value + 1); },
    retry: () => setRetry((value) => value + 1) };
}
