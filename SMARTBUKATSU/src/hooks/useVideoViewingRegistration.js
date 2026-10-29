import { useEffect, useState } from "react";
import { findVideoViewingProjects } from "../services/videoViewingService";

export function useVideoViewingRegistration(teamId, videoIds, enabled, revision = "") {
  const idsKey = JSON.stringify([...new Set(videoIds)].sort());
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([teamId, idsKey, revision, attempt]);
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!enabled || !teamId) { setResult(null); return undefined; }
    let current = true;
    setResult(null);
    const ids = JSON.parse(idsKey);
    if (!ids.length) {
      setResult({ key, status: "ready", byVideo: {} });
      return undefined;
    }
    findVideoViewingProjects(teamId, ids).then((byVideo) => {
      if (current) setResult({ key, status: "ready", byVideo });
    }, () => {
      if (current) setResult({ key, status: "error", byVideo: {} });
    });
    return () => { current = false; };
  }, [teamId, idsKey, enabled, revision, attempt]);
  const valid = enabled && result?.key === key;
  return {
    status: valid ? result.status : "loading",
    byVideo: valid ? result.byVideo : {},
    retry: () => setAttempt((value) => value + 1),
  };
}
