// A shared synchronous gate prevents races between native presentations.
function createPresentationGate(now = Date.now) {
  const blockers = new Set(["app-update"]);
  let active = null, lastAdAt = -Infinity, reviewQuietUntil = 0;
  function canReview() {
    return !active && blockers.size === 0 && now() - lastAdAt >= 60000 &&
      now() >= reviewQuietUntil;
  }
  return {
    setBlocked(name, blocked) { if (blocked) blockers.add(name); else blockers.delete(name); },
    isBlocked: () => blockers.size > 0,
    canReview,
    acquire(kind) {
      if (active || (kind === "review" ? !canReview() : now() < reviewQuietUntil)) return null;
      const token = {};
      active = token;
      if (kind === "ad") lastAdAt = now();
      return (presented = true) => {
        if (active !== token) return;
        active = null;
        if (kind === "ad") lastAdAt = now();
        else if (presented) reviewQuietUntil = now() + 60000;
      };
    },
  };
}

const reviewPresentationGate = createPresentationGate();
module.exports = { createPresentationGate, reviewPresentationGate };
