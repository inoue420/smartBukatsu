const test = require("node:test"), assert = require("node:assert/strict");
const { createInterstitialController, dateKey, SETTINGS_TTL_MS } = require("./interstitialPolicy");
const tick = () => new Promise(resolve => setImmediate(resolve));
function environment(overrides = {}) {
  let clock = new Date(2026, 10, 11, 10).getTime(), calls = 0;
  const data = new Map(), storage = { getItem: async key => data.get(key) || null,
    setItem: async (key, value) => { data.set(key, value); } };
  let policy = { audience: "all", minimumUsageMinutes: 10 };
  const create = () => createInterstitialController({ storage, now: () => clock,
    fetchPolicy: async uid => { calls++; return overrides.fetch ? overrides.fetch(uid) : policy; } });
  const controller = create();
  return { controller, create, data, storage, advance: ms => { clock += ms; },
    clock: value => { clock = value; }, policy: value => { policy = value; }, get calls() { return calls; },
    async ready() { controller.setUser("synthetic-a"); await controller.initialize(); controller.setActive(true); await controller.refresh(); } };
}
test("requires a new opportunity at ten cumulative foreground minutes; background is excluded", async () => {
  const e = environment(); await e.ready();
  e.advance(6 * 60000); e.controller.setActive(false); e.advance(3600000);
  e.controller.setActive(true); await e.controller.refresh(); e.advance(4 * 60000 - 1);
  assert.equal(await e.controller.reserve(() => true), null);
  e.advance(1); const ticket = await e.controller.reserve(() => true); assert.ok(ticket);
  ticket.opened(); await ticket.finish();
  assert.equal(e.controller.snapshot().count, 1);
  assert.equal(await e.controller.reserve(() => true), null);
});
test("usage and one daily impression survive restart and account/team changes", async () => {
  const e = environment(); await e.ready(); e.advance(600000); await e.controller.checkpoint();
  const next = e.create(); next.setUser("synthetic-b"); await next.initialize(); next.setActive(true); await next.refresh();
  const ticket = await next.reserve(() => true); assert.ok(ticket); ticket.opened(); await ticket.finish();
  const last = e.create(); last.setUser("synthetic-c"); await last.initialize(); last.setActive(true);
  assert.equal(last.snapshot().count, 1); assert.equal(await last.reserve(() => true), null);
});
test("fifteen-minute expiry skips this opportunity; refreshes coalesce and never show retroactively", async () => {
  const e = environment(); await e.ready(); e.advance(SETTINGS_TTL_MS - 1);
  assert.equal(e.calls, 1); await e.controller.refresh(); assert.equal(e.calls, 1);
  e.advance(1); assert.equal(await e.controller.reserve(() => true), null);
  await Promise.all([e.controller.refresh(), e.controller.refresh()]); assert.equal(e.calls, 2);
  assert.equal(e.controller.snapshot().count, 0);
  const ticket = await e.controller.reserve(() => true); assert.ok(ticket); await ticket.finish();
});
test("read failure blocks stale settings, and repeated events do not hammer Firebase", async () => {
  let failed = false;
  const e = environment({ fetch: async () => { if (failed) throw Error("offline"); return { audience: "all", minimumUsageMinutes: 1 }; } });
  await e.ready(); e.advance(SETTINGS_TTL_MS); failed = true;
  assert.equal(await e.controller.reserve(() => true), null); await tick();
  for (let i = 0; i < 100; i++) assert.equal(await e.controller.reserve(() => true), null);
  assert.equal(e.calls, 2); e.advance(60000); failed = false; await e.controller.refresh();
  const ticket = await e.controller.reserve(() => true); assert.ok(ticket); await ticket.finish();
});
test("off and non-member debug modes never qualify; saved settings apply locally", async () => {
  const e = environment(); await e.ready(); e.advance(600000);
  for (const policy of [{ audience: "off", minimumUsageMinutes: 1 }, { audience: "debug", minimumUsageMinutes: 1 }]) {
    e.policy(policy); await e.controller.refresh(true); assert.equal(await e.controller.reserve(() => true), null);
  }
  e.controller.applySaved({ audience: "debug", minimumUsageMinutes: 1 });
  const ticket = await e.controller.reserve(() => true); assert.ok(ticket); await ticket.finish();
});
test("simultaneous opportunities reserve at most once, and display failure does not consume the cap", async () => {
  const e = environment(); await e.ready(); e.advance(600000);
  const tickets = await Promise.all([e.controller.reserve(() => true), e.controller.reserve(() => true)]);
  assert.equal(tickets.filter(Boolean).length, 1); await tickets.find(Boolean).finish();
  assert.equal(e.controller.snapshot().count, 0);
  const retry = await e.controller.reserve(() => true); assert.ok(retry); retry.opened(); retry.opened(); await retry.finish();
  assert.equal(e.controller.snapshot().count, 1);
});
test("an uncertain native presentation is conservatively capped after process death", async () => {
  const e = environment(); await e.ready(); e.advance(600000);
  assert.ok(await e.controller.reserve(() => true));
  const restart = e.create(); await restart.initialize(); assert.equal(restart.snapshot().count, 1);
});
test("new day resets time and count, including a foreground session across midnight", async () => {
  const e = environment(); e.clock(new Date(2026, 10, 11, 23, 59).getTime()); await e.ready();
  e.advance(2 * 60000); assert.equal(e.controller.snapshot().usageMs, 60000);
  assert.equal(e.controller.snapshot().date, dateKey(new Date(2026, 10, 12).getTime()));
  assert.equal(await e.controller.reserve(() => true), null);
});
test("storage failure and corrupt ledgers fail closed", async () => {
  for (const corrupt of [true, false]) {
    const e = environment();
    if (corrupt) e.data.set("admob_interstitial_usage_v2", "invalid");
    else e.storage.setItem = async () => { throw Error("disk"); };
    await e.ready(); e.advance(600000);
    assert.equal(await e.controller.reserve(() => true), null);
  }
});
test("late account responses and a response overtaken by a save cannot overwrite current policy", async () => {
  const responses = [];
  const e = environment({ fetch: () => new Promise(resolve => responses.push(resolve)) });
  e.controller.setUser("a"); await e.controller.initialize(); const a = e.controller.refresh(); await tick();
  e.controller.setUser("b"); const b = e.controller.refresh(); await tick();
  responses[0]({ audience: "all", minimumUsageMinutes: 1 }); await a;
  assert.equal(e.controller.snapshot().fresh, false);
  e.controller.applySaved({ audience: "off", minimumUsageMinutes: 10 });
  responses[1]({ audience: "all", minimumUsageMinutes: 1 }); await b;
  e.controller.setActive(true); e.advance(600000); assert.equal(await e.controller.reserve(() => true), null);
});
test("navigation changes during a disk reservation cancel it without showing or consuming a count", async () => {
  const e = environment(); await e.ready(); e.advance(600000);
  let release, safe = true;
  e.storage.setItem = () => new Promise(resolve => { release = resolve; });
  const attempt = e.controller.reserve(() => safe); await tick(); safe = false; release();
  await tick(); release(); assert.equal(await attempt, null); assert.equal(e.controller.snapshot().count, 0);
});
test("after today's impression no background/settings-expiry event reads Firebase", async () => {
  const e = environment(); await e.ready(); e.advance(600000);
  const ticket = await e.controller.reserve(() => true); ticket.opened(); await ticket.finish();
  e.advance(3600000); await e.controller.refresh(); assert.equal(e.calls, 1);
});

test("crossing the threshold while handling an earlier opportunity does not qualify", async () => {
  const e = environment(); await e.ready(); e.advance(600000 - 500);
  const usageAtOpportunity = e.controller.snapshot().usageMs;
  e.advance(1000);
  assert.equal(await e.controller.reserve(() => true, usageAtOpportunity), null);
  const next = await e.controller.reserve(() => true); assert.ok(next); await next.finish();
});
