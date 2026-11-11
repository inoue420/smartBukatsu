const test = require("node:test"), assert = require("node:assert/strict");
const { createNavigationTransitionGate } = require("./navigationTransitionGate");
const { createPresentationGate } = require("../services/reviewPresentationGate");
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (target, closing = false) => ({ target, data: { closing } });
// Use App's actual event handlers so missing native-stack wiring also fails.
function appListeners(gate, routeKeys = ["to", "from"]) {
  const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
  const { parseSync } = require("@babel/core");
  const source = fs.readFileSync(path.resolve(__dirname, "../../App.js"), "utf8");
  const ast = parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ["jsx"] } });
  let expression;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXAttribute" && node.name.name === "screenListeners") expression = node.value.expression;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(ast);
  return vm.runInNewContext(`(${source.slice(expression.start, expression.end)})`, {
    navigationTransitions: { current: gate },
    navigationRef: { getRootState: () => ({ routes: routeKeys.map(key => ({ key })) }) },
  });
}
test("both opening and closing native transitions finish before presentation is released", async () => {
  const presentation = createPresentationGate(); presentation.setBlocked("app-update", false);
  const key = Symbol("navigation"), gate = createNavigationTransitionGate(active => presentation.setBlocked(key, active));
  gate.start(event("from", true));
  const wait = gate.begin("from", "to"); let completed = false;
  wait().then(value => { completed = value; }); gate.start(event("to"));
  assert.equal(presentation.isBlocked(), true); assert.equal(presentation.isBlockedExcept(key), false);
  gate.end(event("to")); await tick(); assert.equal(completed, false);
  assert.equal(presentation.acquire("ad"), null);
  gate.end(event("from", true)); await tick(); assert.equal(completed, true);
  assert.ok(presentation.acquire("ad"));
});
test("unrelated completion and a cancelled gesture cannot release the target operation", async () => {
  const gate = createNavigationTransitionGate(), wait = gate.begin("from", "to"); let settled = false;
  wait().then(() => { settled = true; });
  gate.end(event("unrelated")); gate.end(event("from", false)); await tick(); assert.equal(settled, false);
  gate.reset(); assert.equal(await wait(), false);
});
test("rapid navigation cancels old waiters; reset and missing route identities fail closed", async () => {
  const gate = createNavigationTransitionGate(), old = gate.begin("a", "b");
  const next = gate.begin("b", "c"); assert.equal(await old(), false);
  gate.end(event("a", true)); gate.end(event("b", false));
  let settled = false; next().then(() => { settled = true; }); await tick(); assert.equal(settled, false);
  gate.end(event("c")); assert.equal(await next(), true);
  assert.equal(await gate.begin(null, "c")(), false);
  const pending = gate.begin("c", "d"); gate.reset(); assert.equal(await pending(), false);
});

test("review regression: App gestureCancel releases both screens without a navigation state change", () => {
  const presentation = createPresentationGate(); presentation.setBlocked("app-update", false);
  const key = Symbol("navigation"), gate = createNavigationTransitionGate(active => presentation.setBlocked(key, active));
  const listeners = appListeners(gate);
  listeners.transitionStart(event("from", true)); listeners.transitionStart(event("to"));
  assert.equal(presentation.isBlocked(), true); assert.equal(presentation.canReview(), false);
  listeners.gestureCancel?.({ target: "from" });
  assert.equal(presentation.isBlocked(), false); assert.equal(presentation.canReview(), true);
  const release = presentation.acquire("ad"); assert.equal(typeof release, "function"); release();
});

test("review regression: cancelled navigation resolves false and later events cannot resurrect its opportunity", async () => {
  const gate = createNavigationTransitionGate(), listeners = appListeners(gate);
  const wait = gate.begin("from", "to"); let result = "pending";
  wait().then(value => { result = value; });
  listeners.transitionStart(event("from", true)); listeners.transitionStart(event("to"));
  listeners.gestureCancel?.({ target: "from" }); await tick(); assert.equal(result, false);
  listeners.transitionEnd(event("from", true)); listeners.transitionEnd(event("to"));
  await tick(); assert.equal(result, false);
  const next = gate.begin("to", "next"); listeners.transitionStart(event("next"));
  listeners.transitionEnd(event("next")); assert.equal(await next(), true);
});

test("gesture cancellation preserves unrelated transitions, pending operations and presentation blockers", async () => {
  const presentation = createPresentationGate(); presentation.setBlocked("app-update", false);
  const key = Symbol("navigation"), gate = createNavigationTransitionGate(active => presentation.setBlocked(key, active));
  const listeners = appListeners(gate, ["to", "from", "other"]);
  const wait = gate.begin("from", "to"); let result = "pending"; wait().then(value => { result = value; });
  listeners.transitionStart(event("from", true)); listeners.transitionStart(event("to"));
  listeners.gestureCancel?.({ target: "unknown" }); listeners.gestureCancel?.({});
  await tick(); assert.equal(result, "pending"); assert.equal(presentation.isBlocked(), true);
  listeners.transitionStart(event("other")); presentation.setBlocked("video", true);
  listeners.gestureCancel?.({ target: "from" }); await tick(); assert.equal(result, false);
  assert.equal(presentation.isBlockedExcept("video"), true);
  listeners.transitionEnd(event("other")); assert.equal(presentation.isBlockedExcept("video"), false);
  assert.equal(presentation.isBlocked(), true);
  presentation.setBlocked("video", false); assert.equal(presentation.canReview(), true);
});

test("cancelling an older gesture cannot cancel a different pending navigation", async () => {
  let blocked;
  const gate = createNavigationTransitionGate(active => { blocked = active; });
  const listeners = appListeners(gate, ["old-to", "old-from", "to", "from"]);
  listeners.transitionStart(event("old-from", true)); listeners.transitionStart(event("old-to"));
  const wait = gate.begin("from", "to"); let result = "pending"; wait().then(value => { result = value; });
  listeners.transitionStart(event("from", true)); listeners.transitionStart(event("to"));
  listeners.gestureCancel({ target: "old-from" }); await tick();
  assert.equal(result, "pending"); assert.equal(blocked, true);
  listeners.transitionEnd(event("from", true)); listeners.transitionEnd(event("to"));
  assert.equal(await wait(), true); assert.equal(blocked, false);
});

test("pending route identities allow cancellation even if the popped screen left the JS state", async () => {
  let blocked;
  const gate = createNavigationTransitionGate(active => { blocked = active; });
  const listeners = appListeners(gate, ["to"]), wait = gate.begin("from", "to");
  listeners.transitionStart(event("from", true)); listeners.transitionStart(event("to"));
  listeners.gestureCancel({ target: "from" });
  assert.equal(await wait(), false); assert.equal(blocked, false);
});
