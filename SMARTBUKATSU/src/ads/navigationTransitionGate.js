// Native-stack emits these events from onAppear/onDisappear. A JavaScript
// scheduling callback is deliberately not a substitute for transitionEnd.
function createNavigationTransitionGate(onActivity = () => {}) {
  const active = new Set();
  let pending = null;
  const notify = () => onActivity(active.size > 0 || Boolean(pending));
  const finish = result => {
    const task = pending; pending = null; notify(); task?.resolve(result);
  };
  return {
    begin(fromKey, toKey) {
      finish(false);
      if (!fromKey || !toKey || fromKey === toKey) return () => Promise.resolve(false);
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      pending = { fromKey, toKey, resolve, endSeen: false }; notify();
      return () => promise;
    },
    start(event) { if (event.target) active.add(event.target); notify(); },
    end(event) {
      active.delete(event.target);
      if (pending && ((event.target === pending.toKey && event.data?.closing === false) ||
          (event.target === pending.fromKey && event.data?.closing === true))) pending.endSeen = true;
      if (pending?.endSeen && active.size === 0) finish(true);
      else notify();
    },
    cancel(event, previousRouteKey) {
      const target = event.target;
      const matches = pending && (pending.fromKey === target || pending.toKey === target);
      if (!target || (!active.has(target) && !matches)) return;
      // A cancelled interactive pop may never change navigation state or emit
      // transitionEnd. Clear both screens, without completing an ad opportunity.
      const keys = matches ? [pending.fromKey, pending.toKey] : [target, previousRouteKey];
      for (const key of keys) {
        if (!matches && pending && (pending.fromKey === key || pending.toKey === key)) continue;
        active.delete(key);
      }
      if (matches) finish(false);
      else notify();
    },
    reset() { active.clear(); finish(false); },
  };
}
module.exports = { createNavigationTransitionGate };
