const test = require("node:test"), assert = require("node:assert/strict");
const { createInitializationRecovery, initializationFailureKind } = require("./adInitializationRecovery");
const tick = () => new Promise(resolve => setImmediate(resolve));

function environment(outcomes = [], extra = {}) {
  let clock = 100000, id = 0, current = true;
  const calls = [], events = [], timers = new Map();
  const controller = createInitializationRecovery({ initialize: async args => {
    calls.push({ ...args, at: clock });
    const result = outcomes.shift() ?? "transient";
    return typeof result === "function" ? result() : result;
  }, enqueue: fn => Promise.resolve().then(fn), isCurrent: () => current,
    onEvent: event => events.push(event), now: () => clock,
    setTimer(fn, delay) { const next = ++id; timers.set(next, { fn, at: clock + delay }); return next; },
    clearTimer: timer => timers.delete(timer), ...extra });
  const h = { calls, events, timers, controller,
    async settle() { for (let i = 0; i < 3; i++) await tick(); },
    advance(ms) { const end = clock + ms; let count = 0;
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++count < 12, "must never periodically poll");
        clock = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      clock = end;
    },
    setCurrent(value) { current = value; },
    foreground() { controller.setForeground(false); controller.setForeground(true); },
    reconnect() { controller.setOnline(false); controller.setOnline(true); },
  };
  controller.start(); return h;
}

async function exhaust(h) {
  await h.settle(); h.advance(30000); await h.settle(); h.advance(60000); await h.settle();
  assert.equal(h.calls.length, 3);
}

test("startup remains exactly immediate, +30s, +60s, then waits without a polling timer", async () => {
  const h = environment(); await h.settle();
  assert.equal(h.calls.length, 1); h.advance(29999); await h.settle(); assert.equal(h.calls.length, 1);
  h.reconnect(); await h.settle(); assert.equal(h.calls.length, 1);
  h.advance(1); await h.settle(); assert.equal(h.calls.length, 2);
  h.advance(59999); await h.settle(); assert.equal(h.calls.length, 2);
  h.advance(1); await h.settle(); assert.deepEqual(h.calls.map(c => c.at), [100000, 130000, 190000]);
  assert.equal(h.timers.size, 0); h.advance(3600000); await h.settle(); assert.equal(h.calls.length, 3);
  assert.equal(h.events.filter(e => e === "initialization-attempt").length, 3);
});

test("network and foreground recovery coalesce to one request after a 60s cooldown", async () => {
  const h = environment(); await exhaust(h);
  h.reconnect(); h.foreground(); h.reconnect(); await h.settle();
  assert.equal(h.calls.length, 3); assert.equal(h.timers.size, 1);
  h.advance(59999); await h.settle(); assert.equal(h.calls.length, 3);
  h.advance(1); await h.settle(); assert.equal(h.calls.length, 4);
  assert.equal(h.timers.size, 0); h.advance(3600000); await h.settle(); assert.equal(h.calls.length, 4);
  h.foreground(); await h.settle(); assert.equal(h.calls.length, 5);
});

test("once initialized, all network/foreground events are no-ops", async () => {
  const h = environment(["transient", "transient", "transient", "ready"]); await exhaust(h);
  h.advance(60000); h.reconnect(); await h.settle(); assert.equal(h.calls.length, 4);
  h.foreground(); h.reconnect(); h.advance(3600000); await h.settle();
  assert.equal(h.calls.length, 4); assert.equal(h.timers.size, 0);
});

test("an offline or background app retains a due attempt until it can run", async () => {
  const h = environment(); await h.settle();
  h.controller.setOnline(false); h.advance(60000); await h.settle(); assert.equal(h.calls.length, 1);
  h.controller.setForeground(false); h.controller.setOnline(true); await h.settle(); assert.equal(h.calls.length, 1);
  h.controller.setForeground(true); await h.settle(); assert.equal(h.calls.length, 2);
  assert.equal(h.timers.size, 1);
});

test("events during an in-flight attempt do not enqueue another recovery", async () => {
  let complete;
  const h = environment(["transient", "transient", "transient", () => new Promise(resolve => { complete = resolve; })]);
  await exhaust(h); h.advance(60000); h.reconnect(); await h.settle();
  h.foreground(); h.reconnect(); await h.settle(); assert.equal(h.calls.length, 4);
  complete("transient"); await h.settle();
  assert.equal(h.calls.length, 4); assert.equal(h.timers.size, 0);
});

test("consent blocked has no timers or network retries; foreground rechecks consent at most once per minute", async () => {
  const h = environment(["consent-blocked", "consent-blocked", "ready"]); await h.settle();
  assert.equal(h.timers.size, 0); h.reconnect(); await h.settle(); assert.equal(h.calls.length, 1);
  h.foreground(); h.foreground(); h.advance(59999); await h.settle(); assert.equal(h.calls.length, 1);
  h.advance(1); await h.settle(); assert.equal(h.calls.length, 2); assert.equal(h.calls[1].consentOnly, true);
  h.advance(3600000); h.reconnect(); await h.settle(); assert.equal(h.calls.length, 2);
  h.foreground(); await h.settle(); assert.equal(h.calls.length, 3); assert.equal(h.timers.size, 0);
});

test("permanent setup failures never resume automatically", async () => {
  const h = environment(["permanent"]); await h.settle();
  h.advance(3600000); h.reconnect(); h.foreground(); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0); assert.ok(h.events.includes("retry-permanent"));
});

test("after consent becomes available, a transient SDK failure can recover on the network", async () => {
  const h = environment(["consent-blocked", "consent-check-failed", "transient", "ready"]);
  await h.settle(); h.advance(60000); h.foreground(); await h.settle();
  h.reconnect(); await h.settle(); assert.equal(h.calls.length, 2);
  h.advance(60000); h.foreground(); await h.settle();
  h.advance(60000); h.reconnect(); await h.settle();
  assert.equal(h.calls.length, 4); assert.equal(h.calls[3].consentOnly, false);
});

test("stop or a stale session invalidates timers, queued attempts, and late async completions", async () => {
  for (const cancel of [h => h.controller.stop(), h => h.setCurrent(false)]) {
    const h = environment(); await h.settle(); cancel(h); h.advance(60000); h.foreground(); await h.settle();
    assert.equal(h.calls.length, 1);
  }
  let resolve;
  const h = environment([() => new Promise(done => { resolve = done; })]); await h.settle();
  h.controller.stop(); const count = h.events.length; resolve("transient"); await h.settle();
  assert.equal(h.events.length, count); assert.equal(h.timers.size, 0);
});

test("an attempt queued behind another session does not run while backgrounded", async () => {
  let run;
  const h = environment([], { enqueue: fn => { run = fn; return Promise.resolve(); } });
  h.controller.setForeground(false); await run(); assert.equal(h.calls.length, 0);
  h.controller.setForeground(true); await run(); assert.equal(h.calls.length, 1);
});

test("classification excludes static request/SDK failures while preserving transient errors", () => {
  assert.equal(initializationFailureKind(new Error("validation"), "configuration"), "permanent");
  for (const code of ["invalid-request", "invalid-argument", "os-version-too-low", "age-treatment-unavailable", "application-identifier-missing"]) {
    assert.equal(initializationFailureKind({ code: `googleMobileAds/${code}` }, "initialization"), "permanent");
  }
  for (const code of ["network-error", "timeout", "internal-error", "consent-update-failed", "null-activity"]) {
    assert.equal(initializationFailureKind({ code }, "consent"), "transient");
  }
});
