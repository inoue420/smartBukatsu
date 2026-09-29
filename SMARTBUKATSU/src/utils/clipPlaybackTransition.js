// Each selection owns a token. Delayed player results must retain that token.
function createClipPlaybackTransition() {
  let revision = 0;
  let current = null;
  let nativeQueue = Promise.resolve();

  const isCurrent = (token) => Boolean(token) && current === token;
  const cancel = (token) => {
    if (token && !isCurrent(token)) return;
    revision += 1;
    current = null;
  };

  return {
    cancel,
    begin(key, clip) {
      current = { revision: ++revision, key, start: clip.start, end: clip.end,
        phase: "seeking", seekIssued: false };
      return current;
    },
    current: () => current,
    isCurrent,
    matches: (key) => Boolean(current) && current.key === key,
    markSeekIssued(token) {
      if (!isCurrent(token) || token.phase !== "seeking") return false;
      token.seekIssued = true;
      return true;
    },
    confirm(token, seconds, tolerance = 1) {
      if (!isCurrent(token) || token.phase !== "seeking" || !token.seekIssued ||
          !Number.isFinite(seconds) || Math.abs(seconds - token.start) > tolerance) {
        return false;
      }
      token.phase = "playing";
      return true;
    },
    canObserve: (token) => isCurrent(token) && token.phase === "playing",
    consumeEnd(token, seconds, didJustFinish = false) {
      if (!isCurrent(token) || token.phase !== "playing" ||
          !Number.isFinite(seconds) || (seconds < token.end && !didJustFinish)) {
        return false;
      }
      // Claim the end synchronously, before React commits the next selection.
      token.phase = "finished";
      return true;
    },
    runNative(token, operation) {
      // An old native seek cannot finish after a newer seek on the same player.
      const result = nativeQueue.then(() => {
        if (isCurrent(token)) return operation();
      });
      nativeQueue = result.catch(() => {});
      return result;
    },
  };
}

module.exports = { createClipPlaybackTransition };
