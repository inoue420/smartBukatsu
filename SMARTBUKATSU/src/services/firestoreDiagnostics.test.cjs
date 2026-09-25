const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createFirestoreDiagnostics,
  createMeasuredOnSnapshot,
  formatFirestoreDiagnostics,
} = require("./firestoreDiagnostics");

function querySnapshot(size, types = [], fromCache = false, hasPendingWrites = false) {
  return {
    size, metadata: { fromCache, hasPendingWrites },
    docChanges: () => types.map((type) => ({ type })),
    data() { throw new Error("Document contents must not be read"); },
    get docs() { throw new Error("Document identities must not be read"); },
  };
}

function documentSnapshot(exists, fromCache = false) {
  return {
    exists: () => exists, metadata: { fromCache, hasPendingWrites: false },
    data() { throw new Error("Document contents must not be read"); },
    get id() { throw new Error("Document identity must not be read"); },
  };
}

function harness(enabled = true) {
  let time = 1000;
  const diagnostics = createFirestoreDiagnostics({ enabled, now: () => time++ });
  const calls = [];
  const subscribe = createMeasuredOnSnapshot((reference, next, error) => {
    const call = { reference, next, error, stops: 0 };
    call.unsubscribe = () => { call.stops += 1; };
    calls.push(call);
    return call.unsubscribe;
  }, diagnostics);
  return { diagnostics, subscribe, calls, entry: () => diagnostics.getReport().subscriptions[0] };
}

test("disabled diagnostics delegate the original callbacks, reference and unsubscribe", () => {
  const h = harness(false);
  const reference = {};
  const next = () => {};
  const error = () => {};
  const stop = h.subscribe("dailyReports", reference, next, error);
  assert.equal(h.calls[0].reference, reference);
  assert.equal(h.calls[0].next, next);
  assert.equal(h.calls[0].error, error);
  assert.equal(stop, h.calls[0].unsubscribe);
  assert.deepEqual(h.diagnostics.getReport().subscriptions, []);
  assert.deepEqual(h.diagnostics.getReport().events, []);
  assert.equal(h.diagnostics.getReport().startedAt, null);
});

test("initial query documents are not also counted as added; callbacks receive the same snapshot", () => {
  const h = harness();
  const received = [];
  h.subscribe("dailyReports", {}, (snapshot) => received.push(snapshot));
  const first = querySnapshot(3, ["added", "added", "added"]);
  h.calls[0].next(first);
  h.calls[0].next(querySnapshot(3, ["added", "modified", "removed"]));
  assert.equal(received[0], first);
  assert.deepEqual(h.entry().server, {
    snapshots: 2, initialSnapshots: 1, initialDocuments: 3,
    added: 1, modified: 1, removed: 1,
  });
  assert.equal(h.entry().firstServerDocuments, 3);
});

test("cache-first and first observed server sizes are separate, with pending writes visible", () => {
  const h = harness();
  h.subscribe("projects", {}, () => {});
  h.calls[0].next(querySnapshot(2, ["added", "added"], true));
  h.calls[0].next(querySnapshot(3, ["added"], false));
  h.calls[0].next(querySnapshot(3, ["modified"], true, true));
  const entry = h.entry();
  assert.equal(entry.cache.initialDocuments, 2);
  assert.equal(entry.cache.modified, 1);
  assert.equal(entry.server.initialDocuments, 0);
  assert.equal(entry.server.added, 1);
  assert.equal(entry.firstServerDocuments, 3);
  assert.equal(entry.firstServerSnapshots, 1);
  assert.equal(entry.pendingWriteSnapshots, 1);
});

test("empty first query still counts as a first snapshot and later inserts are additions", () => {
  const h = harness();
  h.subscribe("notices", {}, () => {});
  h.calls[0].next(querySnapshot(0));
  h.calls[0].next(querySnapshot(1, ["added"]));
  assert.equal(h.entry().server.initialSnapshots, 1);
  assert.equal(h.entry().server.initialDocuments, 0);
  assert.equal(h.entry().server.added, 1);
  assert.equal(h.entry().firstServerDocuments, 0);
});

test("document existence transitions track creation, updates, deletion and missing notifications", () => {
  const h = harness();
  h.subscribe("authMembership", {}, () => {});
  for (const exists of [false, false, true, true, false, false]) {
    h.calls[0].next(documentSnapshot(exists));
  }
  assert.deepEqual(h.entry().server, {
    snapshots: 6, initialSnapshots: 1, initialDocuments: 0,
    added: 1, modified: 1, removed: 1,
  });
});

test("an initially existing document is one initial document, not an update", () => {
  const h = harness();
  h.subscribe("teamData", {}, () => {});
  h.calls[0].next(documentSnapshot(true, true));
  h.calls[0].next(documentSnapshot(false));
  assert.equal(h.entry().cache.initialDocuments, 1);
  assert.equal(h.entry().cache.modified, 0);
  assert.equal(h.entry().server.removed, 1);
});

test("parallel subscriptions and team changes keep independent first-snapshot state", () => {
  const h = harness();
  const stopA = h.subscribe("dailyReports", { team: "a" }, () => {});
  const stopB = h.subscribe("dailyReports", { team: "b" }, () => {});
  h.calls[0].next(querySnapshot(2));
  h.calls[1].next(querySnapshot(5));
  stopA();
  stopA();
  h.calls[0].next(querySnapshot(99));
  assert.equal(h.entry().active, 1);
  assert.equal(h.entry().stops, 1);
  assert.equal(h.entry().server.initialDocuments, 7);
  stopB();
  h.subscribe("dailyReports", { team: "c" }, () => {});
  h.calls[2].next(querySnapshot(4));
  assert.equal(h.entry().starts, 3);
  assert.equal(h.entry().server.initialSnapshots, 3);
  assert.equal(h.entry().server.initialDocuments, 11);
  assert.equal(h.entry().active, 1);
});

test("permission errors reach the existing handler unchanged and terminate accounting once", () => {
  const h = harness();
  const error = { code: "permission-denied", message: "sensitive-details" };
  let received;
  const stop = h.subscribe("authMembership", {}, () => {}, (value) => { received = value; });
  h.calls[0].error(error);
  stop();
  assert.equal(received, error);
  assert.equal(h.entry().errors, 1);
  assert.equal(h.entry().stops, 1);
  assert.equal(h.entry().active, 0);
  assert.equal(JSON.stringify(h.diagnostics.getReport()).includes("sensitive-details"), false);
});

test("absent error handlers remain absent to preserve the SDK's default error reporting", () => {
  const h = harness();
  h.subscribe("authUser", {}, () => {});
  assert.equal(h.calls[0].error, undefined);
});

test("synchronous listener registration failure is rethrown and does not leave active counts", () => {
  const diagnostics = createFirestoreDiagnostics({ enabled: true });
  const error = new Error("registration failed");
  const subscribe = createMeasuredOnSnapshot(() => { throw error; }, diagnostics);
  assert.throws(() => subscribe("projects", {}, () => {}), (value) => value === error);
  assert.equal(diagnostics.getReport().subscriptions[0].active, 0);
  assert.equal(diagnostics.getReport().subscriptions[0].errors, 1);
});

test("accounting failure cannot suppress a valid application callback", () => {
  const h = harness();
  let received;
  h.subscribe("notices", {}, (value) => { received = value; });
  const broken = { exists() { throw new Error("unexpected snapshot shape"); } };
  h.calls[0].next(broken);
  assert.equal(received, broken);
  assert.equal(h.diagnostics.getReport().measurementErrors, 1);
  h.calls[0].next(querySnapshot(2));
  assert.equal(h.entry().server.initialDocuments, 2);
});

test("application callback exceptions are not swallowed or counted as measurement failures", () => {
  const h = harness();
  const error = new Error("application failure");
  h.subscribe("projects", {}, () => { throw error; });
  assert.throws(() => h.calls[0].next(querySnapshot(1)), (value) => value === error);
  assert.equal(h.diagnostics.getReport().measurementErrors, 0);
});

test("unrecognized names cannot leak data into diagnostic records", () => {
  const h = harness();
  const next = () => {};
  const stop = h.subscribe("teams/private-team-id/projects", {}, next);
  assert.equal(h.calls[0].next, next);
  assert.equal(stop, h.calls[0].unsubscribe);
  assert.deepEqual(h.diagnostics.getReport().subscriptions, []);
});

test("report copies cannot corrupt running totals and lifecycle history is bounded", () => {
  const h = harness();
  for (let i = 0; i < 80; i += 1) {
    h.subscribe("tagGroups", {}, () => {})();
  }
  const report = h.diagnostics.getReport();
  assert.equal(report.events.length, 60);
  assert.equal(report.subscriptions.length, 1);
  report.subscriptions[0].cache.added = 999;
  report.events[0].name = "private";
  assert.equal(h.entry().cache.added, 0);
  assert.notEqual(h.diagnostics.getReport().events[0].name, "private");
  assert.equal(h.entry().starts, 80);
  assert.equal(h.entry().stops, 80);
});

test("text reports expose useful counts and caveats without examining document contents", () => {
  const h = harness();
  h.subscribe("notifications", { path: "private/path" }, () => {});
  h.calls[0].next(querySnapshot(2));
  const text = formatFirestoreDiagnostics(h.diagnostics.getReport());
  assert.match(text, /notifications/);
  assert.match(text, /初回 1回・2文書/);
  assert.match(text, /課金読取り数ではありません/);
  assert.match(text, /getDoc\/getDocsは対象外/);
  assert.match(text, /足し合わせない/);
  assert.doesNotMatch(text, /private\/path/);
  assert.match(formatFirestoreDiagnostics(harness(false).diagnostics.getReport()), /開発時のみ/);
});
