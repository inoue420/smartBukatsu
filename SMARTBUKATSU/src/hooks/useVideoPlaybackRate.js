import { useEffect, useRef, useState } from "react";

const RATES = [0.25, 0.5, 0.75, 1];
const emptyState = { rates: [], actual: null, requested: 1, pending: false, error: "" };

// Keep the preference across scenes, but only display a rate confirmed by the player.
export function useVideoPlaybackRate({ sourceKey, enabled, isYoutube, youtubeRef, videoRef, youtubeReadyPlayer }) {
  const preference = useRef(1);
  const latestSource = useRef(sourceKey);
  latestSource.current = sourceKey;
  const sessionRef = useRef(null);
  const [nativeReady, setNativeReady] = useState(null);
  const [state, setState] = useState(emptyState);

  useEffect(() => {
    const player = isYoutube
      ? youtubeReadyPlayer === youtubeRef.current && youtubeReadyPlayer
      : nativeReady?.sourceKey === sourceKey && nativeReady.player === videoRef.current && nativeReady.player;
    if (!enabled || !sourceKey || !player) {
      sessionRef.current = null;
      setState(emptyState);
      return undefined;
    }

    const session = { player, sourceKey, active: true, timers: new Set(), pending: false, rates: [], request: 0 };
    sessionRef.current = session;
    const current = () => session.active && sessionRef.current === session &&
      player === (isYoutube ? youtubeRef.current : videoRef.current);
    const update = (patch) => {
      if (current()) setState((previous) => Object.keys(patch).every((key) => Object.is(previous[key], patch[key]))
        ? previous : { ...previous, ...patch });
    };
    const later = (fn, delay) => {
      const timer = setTimeout(() => { session.timers.delete(timer); if (current()) fn(); }, delay);
      session.timers.add(timer);
      return timer;
    };
    // IFrame queries can remain unresolved when a WebView fails or is removed.
    const read = (operation) => new Promise((resolve, reject) => {
      const timer = later(() => reject(new Error("Playback rate query timed out")), 5000);
      Promise.resolve().then(() => { if (current()) return operation(); }).then(resolve, reject).finally(() => {
        clearTimeout(timer); session.timers.delete(timer);
      });
    });
    session.confirm = (rate, error = "") => {
      if (!current() || !Number.isFinite(rate) || rate <= 0) return;
      clearTimeout(session.confirmTimer); session.timers.delete(session.confirmTimer);
      session.pending = false;
      session.actual = rate;
      update({ actual: rate, requested: rate, pending: false, error });
    };
    session.apply = async (rate) => {
      if (!current() || session.pending || !session.rates.includes(rate)) return;
      session.pending = true;
      const request = ++session.request;
      session.target = rate;
      update({ requested: rate, pending: true, error: "" });
      if (isYoutube) {
        // playbackRate is applied through the component prop. Confirm via its
        // event, with a bounded readback if YouTube rejects/ignores the request.
        session.confirmTimer = later(async () => {
          try {
            const actual = await read(() => player.getPlaybackRate());
            if (!Number.isFinite(actual) || actual <= 0) throw new Error("Unconfirmed playback rate");
            if (current() && session.pending && request === session.request) {
              session.confirm(actual, actual === rate ? "" : "この速度へ変更できませんでした。");
            }
          } catch {
            if (!current() || !session.pending || request !== session.request) return;
            session.pending = false;
            update({ actual: null, pending: false, error: "再生速度を確認できません。動画を選び直してください。" });
          }
        }, 2000);
      } else {
        try {
          const status = await read(() => player.setRateAsync(rate, true));
          if (!current()) return;
          if (!status?.isLoaded || !Number.isFinite(status.rate) || status.rate <= 0) throw new Error("Unconfirmed playback rate");
          session.confirm(status.rate, status.rate === rate ? "" : "この速度へ変更できませんでした。");
        } catch {
          if (!current()) return;
          try {
            const status = await read(() => player.getStatusAsync());
            if (!status?.isLoaded || !Number.isFinite(status.rate) || status.rate <= 0) throw new Error("Unconfirmed playback rate");
            session.confirm(status.rate, "この速度へ変更できませんでした。");
          } catch {
            session.pending = false;
            update({ actual: null, pending: false, error: "再生速度を確認できません。動画を選び直してください。" });
          }
        }
      }
    };
    setState({ ...emptyState, sourceKey, player });
    if (isYoutube) {
      Promise.all([
        read(() => player.getAvailablePlaybackRates()),
        read(() => player.getPlaybackRate()),
      ]).then(([available, actual]) => {
        if (!current()) return;
        if (!Array.isArray(available) || !Number.isFinite(actual) || actual <= 0) throw new Error("Invalid playback rates");
        session.rates = RATES.filter((rate) => available.includes(rate));
        session.confirm(actual);
        update({ rates: session.rates });
        const target = session.rates.includes(preference.current) ? preference.current : 1;
        if (target !== actual) session.apply(target);
      }).catch(() => update({ error: "再生速度を取得できません。動画を選び直してください。" }));
    } else {
      session.rates = RATES;
      update({ rates: RATES });
      session.apply(preference.current);
    }
    return () => {
      session.active = false;
      session.timers.forEach(clearTimeout);
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [sourceKey, enabled, isYoutube, youtubeReadyPlayer, nativeReady, youtubeRef, videoRef]);

  const current = sessionRef.current;
  const visible = enabled && state.sourceKey === sourceKey && current?.player === state.player ? state : emptyState;
  return {
    ...visible,
    select(rate) {
      const session = sessionRef.current;
      if (!session?.active || session.pending || !session.rates.includes(rate)) return;
      preference.current = rate;
      session.apply(rate);
    },
    onNativeLoad() {
      if (latestSource.current === sourceKey) setNativeReady({ sourceKey, player: videoRef.current });
    },
    onNativeStatus(status) {
      const session = sessionRef.current;
      if (!isYoutube && session === current && session?.sourceKey === sourceKey && !session.pending && status.isLoaded && status.rate !== session.actual) {
        session.confirm(status.rate);
      }
    },
    onYoutubeRateChange(rate) {
      const session = sessionRef.current;
      if (isYoutube && session === current && session?.sourceKey === sourceKey &&
          (!session.pending || rate === session.target)) session.confirm(rate);
    },
  };
}
