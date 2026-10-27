const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), Module = require("node:module");
const sdk = require("firebase/firestore"), { initializeApp, deleteApp } = require("firebase/app");
const fr = require("node:module").createRequire(path.join(__dirname, "../../functions/package.json"));
const adminApp = fr("firebase-admin/app"), admin = fr("firebase-admin/firestore"), { HttpsError } = fr("firebase-functions/v2/https");
const { createOperatorGuidanceBackend, GUIDANCE_TEMPLATE } = require("../../functions/operatorGuidanceBackend");
const projectId = "demo-operator-guidance", host = "127.0.0.1:8195";
if (process.env.FIRESTORE_EMULATOR_HOST !== host || process.env.GCLOUD_PROJECT !== projectId) throw new Error("Use the dedicated demo emulator.");

test("operator guidance with real transactions, Rules and production notification transport", async (t) => {
  const app = adminApp.initializeApp({ projectId }, "guidance-server"), db = admin.getFirestore(app), clients = [];
  const client = (uid) => {
    const app = initializeApp({ projectId, apiKey: "emulator-only", appId: "emulator-only" }, `guidance-${uid}-${clients.length}`);
    const value = sdk.getFirestore(app); sdk.connectFirestoreEmulator(value, "127.0.0.1", 8195, { mockUserToken: { sub: uid } });
    clients.push({ app, db: value }); return value;
  };
  const requests = [], waits = [];
  let respond, clock = Date.UTC(2026, 9, 23), beforeDeliver, beforeAggregate, afterReadOnlyTransaction, beforeNextWriteTransaction, aggregateCalls = 0;
  const filename = path.join(__dirname, "../../functions/notifications.js");
  // Compile in Node's own realm so the real Admin SDK accepts plain objects.
  const exports = new Module(filename);
  exports.filename = filename; exports.paths = Module._nodeModulePaths(path.dirname(filename));
  exports.require = (name) => {
    if (name === "firebase-admin/firestore") return { ...admin, getFirestore: () => db };
    if (name === "firebase-functions/v2/https") return { onCall: (_options, handler) => handler, HttpsError };
    if (name === "firebase-functions/v2/firestore") return { onDocumentWritten: (_options, handler) => handler };
    if (name === "firebase-functions/v2/scheduler") return { onSchedule: (_options, handler) => handler };
    if (name === "firebase-functions/logger") return { warn() {}, error() {}, info() {} };
    if (name.startsWith("./")) return require(path.join(__dirname, "../../functions", name));
    return fr(name);
  };
  exports.testDependencies = {
    setTimeout: (callback, ms) => { waits.push(ms); callback(); }, Date,
    fetch: async (url, options) => {
      assert.equal(url, "https://exp.host/--/api/v2/push/send");
      const messages = JSON.parse(options.body); requests.push(messages);
      return respond ? respond(messages) : { ok: true, json: async () => ({ data: messages.map(() => ({ status: "ok", id: "synthetic-ticket" })) }) };
    },
  };
  exports._compile("const { fetch, setTimeout } = module.testDependencies;\n" + fs.readFileSync(filename, "utf8"), filename);
  const measuredDb = new Proxy(db, { get(target, name) {
    if (name === "runTransaction") return async (handler, options) => {
      if (!options?.readOnly && beforeNextWriteTransaction) { const hook = beforeNextWriteTransaction; beforeNextWriteTransaction = null; await hook(); }
      const result = await target.runTransaction((transaction) => handler(new Proxy(transaction, { get(tx, field) {
      if (field === "get") return async (query) => { if (query.constructor.name === "AggregateQuery") { aggregateCalls++; await beforeAggregate?.(); } return tx.get(query); };
      const value = tx[field]; return typeof value === "function" ? value.bind(tx) : value;
    } })), options); if (options?.readOnly) await afterReadOnlyTransaction?.(); return result; };
    const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
  } });
  const backend = createOperatorGuidanceBackend({ firestore: measuredDb, Timestamp: admin.Timestamp, FieldPath: admin.FieldPath, HttpsError,
    now: () => clock, deliver: async (...args) => { await beforeDeliver?.(); return exports.exports.sendOperatorGuidanceNotification(...args); } });
  const req = (data = {}, uid = "operator") => ({ auth: { uid }, data: { expectedUid: uid, ...data } });
  let number = 0;
  const send = (data = {}, uid = "operator") => backend.send(req({ mode: "initial", teamIds: ["a"], templateVersion: GUIDANCE_TEMPLATE.version,
    expectedOwnerUids: Object.fromEntries((data.teamIds || ["a"]).map((id) => [id, "owner"])),
    requestId: `synthetic_request_${++number}`, ...data }, uid));
  const denied = (promise) => assert.rejects(promise, (error) => error.code === "permission-denied");
  async function seed() {
    const cleared = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
    assert.equal(cleared.ok, true, await cleared.text()); requests.length = 0; waits.length = 0; respond = null; beforeDeliver = null; beforeAggregate = null; afterReadOnlyTransaction = null; beforeNextWriteTransaction = null; aggregateCalls = 0;
    const batch = db.batch();
    batch.set(db.doc("invites/AWUH95"), { teamId: "debug" });
    batch.set(db.doc("teams/debug"), { name: "Synthetic operator team", createdBy: "operator" });
    batch.set(db.doc("teams/debug/members/operator"), { name: "Synthetic operator", role: "member" });
    for (const id of ["a", "b"]) {
      batch.set(db.doc(`teams/${id}`), { name: `Synthetic ${id}`, createdBy: "owner", originalCreatorUid: "owner", createdAt: admin.Timestamp.fromMillis(clock - 3600000) });
      batch.set(db.doc(`teams/${id}/members/owner`), { name: "Synthetic creator", role: "admin" });
    }
    batch.set(db.doc("teams/legacy"), { name: "Synthetic legacy", createdBy: "owner", createdAt: admin.Timestamp.fromMillis(clock - 365 * 86400000) });
    for (const uid of ["owner", "operator"]) {
      batch.set(db.doc(`users/${uid}`), { activeTeamId: "a" });
      batch.set(db.doc(`users/${uid}/notificationPreferences/default`), { masterEnabled: true });
      batch.set(db.doc(`users/${uid}/pushTokens/device`), { token: `ExpoPushToken[synthetic-${uid}]` });
      batch.set(db.doc(`users/${uid}/notificationState/summary`), { unreadBucketsVersion: 1, unreadTotal: 0, unreadByTeam: {}, unreadBuckets: {} });
    }
    await batch.commit();
  }
  try {
    const rules = await fetch(`http://${host}/emulator/v1/projects/${projectId}:securityRules`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8") }] } }) });
    assert.equal(rules.ok, true, await rules.text());
    await t.test("all five endpoints deny outsiders, including activeTeamId and invite-code lookalikes", async () => {
      await seed(); await db.doc("users/outsider").set({ activeTeamId: "debug" });
      await db.doc("teams/lookalike").set({ inviteCode: "AWUH95" }); await db.doc("teams/lookalike/members/outsider").set({ role: "admin" });
      for (const handler of [backend.access, backend.list, backend.usage, backend.history, backend.send]) await denied(handler(req({}, "outsider")));
      await assert.rejects(backend.access({ data: {} }), (error) => error.code === "unauthenticated");
      await assert.rejects(backend.access(req({ expectedUid: "other" })), (error) => error.code === "failed-precondition");
      assert.equal((await backend.access(req())).allowed, true);
    });
    await t.test("new creator is authenticated at creation, immutable, optional for old clients; server-only records stay private", async () => {
      await seed(); const owner = client("owner"), outsider = client("outsider"), op = client("operator");
      await sdk.setDoc(sdk.doc(owner, "teams/new"), { createdBy: "owner", originalCreatorUid: "owner" });
      await denied(sdk.setDoc(sdk.doc(owner, "teams/forged"), { createdBy: "owner", originalCreatorUid: "other" }));
      await denied(sdk.updateDoc(sdk.doc(owner, "teams/a"), { originalCreatorUid: "other" }));
      await denied(sdk.updateDoc(sdk.doc(owner, "teams/a"), { originalCreatorUid: sdk.deleteField() }));
      await db.doc("teams/legacy/members/owner").set({ role: "admin" });
      await denied(sdk.updateDoc(sdk.doc(owner, "teams/legacy"), { originalCreatorUid: "owner" }));
      await sdk.setDoc(sdk.doc(owner, "teams/old-client"), { createdBy: "owner" });
      await sdk.updateDoc(sdk.doc(owner, "teams/a"), { name: "Synthetic renamed" });
      for (const value of [owner, outsider, op]) for (const location of ["operatorGuidanceHistory/x", "operatorGuidanceRequests/x", "operatorGuidanceMessages/x", "users/owner/operatorGuidanceState/initial"]) {
        await denied(sdk.getDoc(sdk.doc(value, location))); await denied(sdk.setDoc(sdk.doc(value, location), { forged: true }));
      }
    });
    await t.test("one-hour-old teams can send; duplicate teams/accounts and concurrent operators create one initial notification", async () => {
      await seed(); await db.doc("teams/debug/members/operator2").set({ role: "member" });
      const result = await Promise.all([send({ teamIds: ["a", "b"] }), send({}, "operator2")]);
      assert.equal(requests.flat().length, 1);
      assert.equal(result.flatMap((r) => r.results).filter((r) => r.status === "accepted").length, 1);
      const notes = await db.collection("users/owner/notifications").get(); assert.equal(notes.size, 1);
      assert.equal(notes.docs[0].data().category, "operatorGuidance"); assert.equal(notes.docs[0].data().readAt, null);
      assert.equal((await db.doc("users/owner/notificationState/summary").get()).data().unreadTotal, 1);
    });
    await t.test("same request after response loss is replay-safe; explicit resend requires confirmation", async () => {
      await seed(); const input = { requestId: "synthetic_stable_request" };
      const first = await send(input), second = await send(input); assert.equal(first.results[0].historyId, second.results[0].historyId); assert.equal(requests.length, 1);
      await assert.rejects(send({ mode: "resend" }), (error) => error.code === "invalid-argument");
      assert.equal((await send({ mode: "resend", confirmResend: true })).results[0].status, "accepted"); assert.equal(requests.length, 2);
    });
    await t.test("the approved initial template saves five feature links plus permissions and preserves historical plain-text guides", async () => {
      await seed(); const template = (await backend.access(req())).template;
      assert.equal(template.version, "guide-v3"); assert.equal(template.title, "運営からのご案内");
      assert.equal(template.content.introduction, "弊社アプリのインストールおよびチームの作成をありがとうございます。\nこのアプリには下記機能が実装されています。");
      assert.equal(template.content.closing, "これらの使用方法は、上記リンクをタップもしくは各画面に設置の操作ガイドからもご覧いただけます。まずはメンバーとの連絡手段として活用いただき、慣れてきたら動画タグ付けという流れをお勧めしています。\n\nプレーのタグ付けはyoutubeの限定公開やライブ動画に対しても行えます。また部員全員で切り抜きを分担できる機能も実装しており、負担の分散も可能。ぜひお試しください。\nもしチーム作成など初期設定でご不明点などありましたら、サポートさせていただきますのでこのチャットをご活用ください。\n\nSMARTBUKATSU運営チーム");
      const id = (await send()).results[0].historyId;
      const saved = (await db.doc(`operatorGuidanceHistory/${id}`).get()).data();
      assert.equal(saved.body, template.body); assert.equal(saved.content.features.length, 5);
      assert.deepEqual(saved.content.features.map((item) => item.url), ["members", "calendar", "communication", "video-clip", "tactics"].map((topic) => `${template.url}#${topic}`));
      assert.equal(saved.content.features[0].related[0].url, `${template.url}#permissions`);
      assert.deepEqual((await backend.conversation(req({ historyId: id }, "owner"))).thread.content, saved.content);
      await db.doc("operatorGuidanceHistory/legacy-guide").set({ targetUid: "owner", notificationSaved: true, body: "Keep the old original", templateVersion: "guide-v1" });
      const old = await backend.conversation(req({ historyId: "legacy-guide" }, "owner"));
      assert.equal(old.thread.body, "Keep the old original"); assert.equal(old.thread.content, undefined);
    });
    await t.test("edited content is saved as an immutable original; push excerpts keep the full body in conversation and operator history", async () => {
      await seed(); const content = JSON.parse(JSON.stringify(GUIDANCE_TEMPLATE.content));
      content.title = "調整後の案内"; content.introduction = "調整した前文。".repeat(100);
      content.features[0].label = "このチームへの招待と権限"; content.features[0].url = "https://example.invalid/";
      content.features[0].related = [{ label: "Arbitrary", url: "https://example.invalid/" }]; content.closing = "調整後の署名";
      const input = { content, requestId: "synthetic_edited_request" };
      const result = (await send(input)).results[0]; assert.equal(result.status, "accepted");
      const record = (await db.doc(`operatorGuidanceHistory/${result.historyId}`).get()).data();
      assert.equal(record.title, content.title); assert.ok(record.body.length > 300); assert.ok(record.body.endsWith(content.closing));
      assert.equal(record.content.features[0].url, `${GUIDANCE_TEMPLATE.url}#members`);
      assert.equal(record.content.features[0].related[0].url, `${GUIDANCE_TEMPLATE.url}#permissions`);
      assert.equal(requests[0][0].title, content.title); assert.ok(requests[0][0].body.length <= 300);
      assert.equal((await backend.conversation(req({ historyId: result.historyId }, "owner"))).thread.body, record.body);
      assert.equal((await backend.history(req())).items[0].body, record.body);
      assert.equal((await send(input)).results[0].historyId, result.historyId); assert.equal(requests.length, 1);
      await assert.rejects(send({ ...input, content: { ...content, introduction: "Changed after send" } }), (e) => e.code === "invalid-argument");
      await assert.rejects(send({ ...input, content: { ...content, title: "Changed title" } }), (e) => e.code === "invalid-argument");
      content.closing = "Locally changed after the request";
      assert.equal((await db.doc(`operatorGuidanceHistory/${result.historyId}`).get()).data().body, record.body);
      assert.notEqual(GUIDANCE_TEMPLATE.title, "調整後の案内"); assert.equal(requests.length, 1);
    });
    await t.test("invalid edited drafts and changed topic mappings are rejected before any message is stored", async () => {
      await seed(); const content = JSON.parse(JSON.stringify(GUIDANCE_TEMPLATE.content));
      for (const patch of [{ title: " " }, { title: "x".repeat(121) }, { introduction: "x".repeat(2001) }, { closing: "x".repeat(3001) },
        { features: [] }, { features: content.features.slice(1) }, { features: content.features.map((item, i) => i === 0 ? { ...item, topic: "other" } : item) },
        { features: content.features.map((item, i) => i === 1 ? { ...item, label: " " } : item) },
        { features: content.features.map((item, i) => i === 1 ? { ...item, label: "x".repeat(201) } : item) }]) {
        await assert.rejects(send({ content: { ...content, ...patch } }), (e) => e.code === "invalid-argument");
      }
      await denied(send({ content }, "outsider"));
      assert.equal((await db.collection("operatorGuidanceHistory").get()).size, 0); assert.equal(requests.length, 0);
    });
    await t.test("operator deletion preserves the recipient's original, while recipient deletion removes editable private text and links", async () => {
      await seed(); const content = JSON.parse(JSON.stringify(GUIDANCE_TEMPLATE.content));
      content.title = "Private personalized title"; content.introduction = "Private personalized introduction";
      const id = (await send({ content })).results[0].historyId;
      await backend.anonymizeAccount("operator");
      assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).thread.content.introduction, content.introduction);
      await backend.anonymizeAccount("owner");
      const record = (await db.doc(`operatorGuidanceHistory/${id}`).get()).data();
      assert.equal(record.targetUid, "deleted_user"); assert.equal(record.content, null);
      assert.ok(!record.title.includes("Private")); assert.ok(!record.body.includes("Private"));
      await denied(backend.conversation(req({ historyId: id }, "owner")));
    });
    await t.test("legacy teams select their current owner; transfer only sends to the new owner, never other admins", async () => {
      await seed(); await db.doc("teams/legacy/members/owner").set({ role: "admin" });
      assert.equal((await backend.list(req())).items.find((item) => item.id === "legacy").selectable, true);
      assert.equal((await send({ teamIds: ["legacy"] })).results[0].status, "accepted");
      await seed();
      await db.doc("teams/a").update({ createdBy: "new-owner" });
      await db.doc("teams/a/members/new-owner").set({ role: "admin" });
      await db.doc("users/new-owner/notificationPreferences/default").set({ masterEnabled: true });
      await db.doc("users/new-owner/pushTokens/device").set({ token: "ExpoPushToken[synthetic-new-owner]" });
      await db.doc("users/new-owner/notificationState/summary").set({ unreadBucketsVersion: 1, unreadTotal: 0, unreadByTeam: {}, unreadBuckets: {} });
      const target = (await backend.list(req())).items.find((item) => item.id === "a"); assert.equal(target.ownerUid, "new-owner"); assert.equal(target.selectable, true);
      assert.equal((await send({ expectedOwnerUids: { a: "new-owner" } })).results[0].status, "accepted");
      assert.deepEqual(requests.flat().map((message) => message.to), ["ExpoPushToken[synthetic-new-owner]"]);
      assert.equal((await db.collection("users/owner/notifications").get()).size, 0);
      assert.equal((await db.doc("teams/a").get()).data().originalCreatorUid, "owner");
    });
    await t.test("stale owner selections and transfers during delivery never silently send to another account", async () => {
      await seed(); await db.doc("teams/a").update({ createdBy: "new-owner" });
      assert.equal((await send()).results[0].reason, "membership_changed"); assert.equal(requests.length, 0);
      await seed(); beforeDeliver = () => db.doc("teams/a").update({ createdBy: "new-owner" });
      assert.equal((await send()).results[0].reason, "membership_changed"); assert.equal(requests.length, 0);
      await assert.rejects(send({ expectedOwnerUids: null }), (error) => error.code === "invalid-argument");
      await seed(); await db.doc("teams/a").update({ createdBy: "deleted_user" });
      assert.equal((await send()).results[0].reason, "owner_unknown");
    });
    await t.test("usage is requested separately, counts legacy records and excludes deleted records and drafts in nine aggregations", async () => {
      await seed(); const batch = db.batch();
      batch.set(db.doc("teams/a/members/second"), { role: "member" });
      for (const name of ["clubEvents", "projects", "highlightProjects"]) {
        batch.set(db.doc(`teams/a/${name}/legacy`), {}); batch.set(db.doc(`teams/a/${name}/active`), { status: "active" });
        batch.set(db.doc(`teams/a/${name}/deleted`), { status: "deleted" });
      }
      for (const [id, data] of [["legacy", {}], ["published", { draft: false }], ["draft", { draft: true }]]) batch.set(db.doc(`teams/a/tacticalNotes/${id}`), data);
      batch.set(db.doc("teams/b/projects/other-team"), {}); await batch.commit();
      await backend.list(req()); assert.equal(aggregateCalls, 0);
      const result = await backend.usage(req({ teamId: "a" }));
      assert.deepEqual(result.counts, { members: 2, events: 2, videos: 2, viewingProjects: 2, tacticalNotes: 2 });
      assert.equal(result.teamId, "a"); assert.equal(result.fetchedAt, clock); assert.equal(aggregateCalls, 9);
      assert.equal((await db.collection("operatorGuidanceHistory").get()).size, 0); assert.equal(requests.length, 0);
      const empty = await backend.usage(req({ teamId: "legacy" }));
      assert.deepEqual(empty.counts, { members: 0, events: 0, videos: 0, viewingProjects: 0, tacticalNotes: 0 });
      await assert.rejects(backend.usage(req({ teamId: "a/b" })), (error) => error.code === "invalid-argument");
      await assert.rejects(backend.usage(req({ teamId: "missing" })), (error) => error.code === "not-found");
    });
    await t.test("usage failures do not become zero counts, and revoked operator membership blocks late results", async () => {
      await seed(); beforeAggregate = () => { throw new Error("synthetic aggregation failure"); };
      await assert.rejects(backend.usage(req({ teamId: "a" })), /synthetic aggregation failure/);
      await seed(); afterReadOnlyTransaction = () => db.doc("teams/debug/members/operator").delete();
      await denied(backend.usage(req({ teamId: "a" })));
    });
    await t.test("membership and operator revocations between claim and notification are enforced", async () => {
      await seed(); beforeDeliver = () => db.doc("teams/a/members/owner").delete();
      assert.equal((await send()).results[0].reason, "membership_changed"); assert.equal(requests.length, 0);
      await seed(); beforeDeliver = () => db.doc("teams/debug/members/operator").delete();
      assert.equal((await send()).results[0].reason, "operator_removed"); assert.equal(requests.length, 0);
      assert.equal((await db.collection("users/owner/notifications").get()).size, 0);
    });
    await t.test("master/category/team OFF save history without HTTP, badge or visible-unread counts", async () => {
      for (const setting of [{ masterEnabled: false }, { categories: { operatorGuidance: false } }, { teamEnabled: { a: false } }]) {
        await seed(); await db.doc("users/owner/notificationPreferences/default").set({ masterEnabled: true, ...setting });
        const result = (await send()).results[0]; assert.equal(result.reason, "notifications_off"); assert.equal(result.notificationSaved, true); assert.equal(requests.length, 0);
        const summary = (await db.doc("users/owner/notificationState/summary").get()).data();
        assert.equal(require("../../functions/notificationCore").getVisibleUnreadSummary(summary, { masterEnabled: true, ...setting }).unreadTotal, 0);
      }
    });
    await t.test("test send only reaches caller, records history and does not consume initial receipt", async () => {
      await seed(); assert.equal((await send({ mode: "test", teamIds: ["a"] })).results[0].status, "accepted");
      assert.equal(requests[0][0].to, "ExpoPushToken[synthetic-operator]"); assert.equal((await db.doc("users/operator/operatorGuidanceState/initial").get()).exists, false);
      assert.equal((await db.collection("users/owner/notifications").get()).size, 0);
    });
    await t.test("large legacy summaries stop at the bounded repair limit instead of fetching all history", async () => {
      await seed(); await db.doc("users/owner/notificationState/summary").delete();
      const batch = db.batch();
      for (let i = 0; i < 260; i++) batch.set(db.doc(`users/owner/notifications/legacy${i}`), { readAt: null, category: "notice" });
      await batch.commit();
      const result = (await send()).results[0]; assert.equal(result.reason, "summary_not_ready"); assert.equal(result.notificationSaved, false); assert.equal(requests.length, 0);
      assert.equal((await db.collection("users/owner/notifications").get()).size, 260);
    });
    await t.test("Expo ticket outcomes distinguish acceptance, partial failure, unavailable and uncertain response", async () => {
      await seed(); await db.doc("users/owner/pushTokens/second").set({ token: "ExpoPushToken[synthetic-second]" });
      respond = () => ({ ok: true, json: async () => ({ data: [{ status: "ok", id: "synthetic" }, { status: "error", details: { error: "DeviceNotRegistered" } }] }) });
      const partial = (await send()).results[0]; assert.equal(partial.status, "accepted"); assert.equal(partial.deviceResults.unavailable, 1);
      await seed(); respond = () => { throw new Error("synthetic lost response"); };
      const unknown = (await send()).results[0]; assert.equal(unknown.reason, "response_unknown"); assert.equal(unknown.deviceResults.unknown, 1); assert.equal(requests.length, 1);
      const saved = await backend.history(req()); assert.equal(saved.items[0].status, "failed"); assert.equal(saved.items[0].notificationSaved, true);
    });
    await t.test("transient ticket errors retry only three times; guidance caps token reads at ten", async () => {
      await seed(); respond = (messages) => ({ ok: true, json: async () => ({ data: messages.map(() => ({ status: "error", details: { error: "MessageRateExceeded" } })) }) });
      assert.equal((await send()).results[0].status, "failed"); assert.equal(requests.length, 3); assert.deepEqual(waits, [1000, 2000]);
      await seed(); const batch = db.batch(); for (let i = 0; i < 15; i++) batch.set(db.doc(`users/owner/pushTokens/d${i}`), { token: `ExpoPushToken[synthetic-${i}]` }); await batch.commit();
      await send(); assert.equal(requests[0].length, 10);
    });
    await t.test("stale unfinished claim requires explicit resend; invalid bounds/templates are rejected", async () => {
      await seed(); await db.doc("users/owner/operatorGuidanceState/initial").set({ inFlight: true, updatedAt: admin.Timestamp.fromMillis(clock - 11 * 60000), historyId: "stale" });
      assert.equal((await send()).results[0].status, "unavailable");
      assert.equal((await send({ mode: "resend", confirmResend: true })).results[0].status, "accepted");
      for (const data of [{ teamIds: [] }, { teamIds: ["a", "a"] }, { teamIds: Array.from({ length: 11 }, (_, i) => `t${i}`) }, { templateVersion: "other" }, { requestId: "short" }]) {
        await assert.rejects(send(data), (error) => error.code === "invalid-argument");
      }
    });
    await t.test("targets page newest five with sub-millisecond precision; missing dates are excluded and history keeps fifty", async () => {
      await seed(); const batch = db.batch();
      for (let i = 0; i < 105; i++) {
        batch.set(db.doc(`teams/page${String(i).padStart(3, "0")}`), { name: "Synthetic page", createdAt: new admin.Timestamp(clock / 1000 - Math.floor(i / 7), (i % 7) * 100000) });
        batch.set(db.doc(`operatorGuidanceHistory/${String(i).padStart(3, "0")}`), { status: "unavailable", createdAt: admin.Timestamp.fromMillis(clock) });
      }
      batch.set(db.doc("teams/undated"), { name: "Synthetic undated", createdBy: "owner" });
      await batch.commit();
      for (const handler of [backend.list, backend.history]) {
        const ids = []; let cursor = null, count = 0;
        do {
          const page = await handler(req({ cursor })); assert.ok(page.items.length <= (handler === backend.list ? 5 : 50));
          if (handler === backend.list && count === 0) {
            assert.deepEqual(page.items.map((item) => item.id), ["page006", "page005", "page004", "page003", "page002"]);
            assert.equal(page.cursor.createdAt.nanoseconds, 200000);
          }
          ids.push(...page.items.map((item) => item.id)); cursor = page.cursor; count++;
        } while (cursor);
        assert.equal(new Set(ids).size, ids.length); assert.equal(ids.length, handler === backend.list ? 108 : 105);
        assert.equal(count, handler === backend.list ? 22 : 3);
        if (handler === backend.list) {
          assert.deepEqual(ids.slice(-3), ["b", "a", "legacy"]);
          assert.ok(!ids.includes("debug") && !ids.includes("undated"));
        }
      }
      assert.equal(aggregateCalls, 0);
    });
    await t.test("cursor remains valid if its team is deleted; equal timestamps and new teams do not duplicate or skip existing teams", async () => {
      await seed(); const batch = db.batch();
      for (let i = 0; i < 10; i++) batch.set(db.doc(`teams/tie${i}`), { createdAt: new admin.Timestamp(clock / 1000, 123456789) });
      await batch.commit();
      const first = await backend.list(req()); assert.deepEqual(first.items.map((item) => item.id), ["tie9", "tie8", "tie7", "tie6", "tie5"]);
      await db.doc("teams/tie5").delete();
      await db.doc("teams/newer").set({ createdAt: admin.Timestamp.fromMillis(clock + 1000) });
      const second = await backend.list(req({ cursor: first.cursor }));
      assert.deepEqual(second.items.map((item) => item.id), ["tie4", "tie3", "tie2", "tie1", "tie0"]);
      assert.equal((await backend.list(req())).items[0].id, "newer");
      for (const cursor of ["old-id-cursor", {}, { ...first.cursor, version: 2 }, { ...first.cursor, id: "bad/id" },
        { ...first.cursor, createdAt: { seconds: 1.5, nanoseconds: 0 } }, { ...first.cursor, createdAt: { seconds: 253402300800, nanoseconds: 0 } },
        { ...first.cursor, createdAt: { seconds: 1, nanoseconds: 1000000000 } }]) {
        await assert.rejects(backend.list(req({ cursor })), (error) => error.code === "invalid-argument");
      }
    });
    await t.test("conversation APIs authenticate, isolate recipients and recheck the actual operator membership", async () => {
      await seed(); const id = (await send()).results[0].historyId;
      for (const handler of [backend.inbox, backend.conversation, backend.reply]) await assert.rejects(handler({ data: {} }), (e) => e.code === "unauthenticated");
      assert.equal((await backend.inbox(req({}, "owner"))).items[0].id, id);
      assert.equal((await backend.inbox(req({ targetUid: "owner" }, "outsider"))).items.length, 0);
      await denied(backend.conversation(req({ historyId: id }, "outsider")));
      await denied(backend.reply(req({ historyId: id, requestId: "synthetic_outsider_reply", text: "Not allowed" }, "outsider")));
      await denied(backend.conversation(req({ historyId: id, asOperator: true }, "owner")));
      assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).thread.canReply, true);
      await db.doc("teams/debug/members/operator2").set({ role: "member" });
      assert.equal((await backend.conversation(req({ historyId: id, asOperator: true }, "operator2"))).thread.asOperator, true);
      await db.doc("teams/debug/members/operator2").delete();
      await denied(backend.conversation(req({ historyId: id, asOperator: true }, "operator2")));
      await denied(backend.reply(req({ historyId: id, asOperator: true, requestId: "synthetic_removed_reply", text: "Not allowed" }, "operator2")));
      await db.doc("teams/a").update({ createdBy: "outsider" }); await db.doc("teams/a/members/outsider").set({ role: "admin" });
      await denied(backend.conversation(req({ historyId: id }, "outsider")));
      await assert.rejects(backend.conversation(req({ historyId: id, expectedUid: "other" }, "owner")), (e) => e.code === "failed-precondition");
    });
    await t.test("recipient replies and operator replies stay private, preserve their order and use the existing guidance preference", async () => {
      await seed(); const id = (await send()).results[0].historyId;
      const first = await backend.reply(req({ historyId: id, requestId: "synthetic_reply_owner", text: "Synthetic question" }, "owner"));
      assert.equal(first.saved, true); assert.equal(first.notificationStatus, "accepted");
      assert.equal(requests.at(-1)[0].to, "ExpoPushToken[synthetic-operator]");
      assert.equal(requests.at(-1)[0].data.category, "operatorGuidance");
      assert.equal(JSON.parse(requests.at(-1)[0].data.targetParams).asOperator, true);
      const second = await backend.reply(req({ historyId: id, asOperator: true, requestId: "synthetic_reply_operator", text: "Synthetic answer" }));
      assert.equal(second.notificationStatus, "accepted"); assert.equal(requests.at(-1)[0].to, "ExpoPushToken[synthetic-owner]");
      const page = await backend.conversation(req({ historyId: id }, "owner"));
      assert.deepEqual(page.items.map((item) => [item.senderRole, item.body]), [["recipient", "Synthetic question"], ["operator", "Synthetic answer"]]);
      assert.equal(page.thread.messageCount, 2); assert.equal(page.thread.lastMessageRole, "operator");
      assert.ok(!("senderUid" in page.items[0])); assert.ok(!("targetUid" in page.thread));
      assert.equal((await backend.history(req())).items[0].messageCount, 2);
      assert.equal((await send()).results[0].reason, "initial_recorded_or_processing");
    });
    await t.test("a recipient reply to a self-test notifies its original operator once and still respects preferences and revocation", async () => {
      await seed(); const id = (await send({ mode: "test" })).results[0].historyId;
      const input = req({ historyId: id, requestId: "synthetic_self_test_reply", text: "Test from the recipient view" });
      assert.equal((await backend.reply(input)).notificationStatus, "accepted");
      assert.equal(requests.length, 2); assert.equal(requests.at(-1).length, 1);
      assert.equal(requests.at(-1)[0].to, "ExpoPushToken[synthetic-operator]");
      assert.equal(JSON.parse(requests.at(-1)[0].data.targetParams).asOperator, true);
      const notes = (await db.collection("users/operator/notifications").get()).docs;
      const replyNote = notes.find((doc) => doc.data().source?.messageId);
      assert.equal(replyNote.data().teamId, ""); assert.equal(replyNote.data().category, "operatorGuidance");
      await backend.reply(input); assert.equal(requests.length, 2);
      await backend.reply(req({ historyId: id, asOperator: true, requestId: "synthetic_self_operator_answer", text: "Operator answering own test" }));
      assert.equal(requests.length, 2);
      for (const setting of [{ masterEnabled: false }, { masterEnabled: true, categories: { operatorGuidance: false } }]) {
        await seed(); const offId = (await send({ mode: "test" })).results[0].historyId;
        await db.doc("users/operator/notificationPreferences/default").set(setting);
        const result = await backend.reply(req({ historyId: offId, requestId: "synthetic_self_test_off", text: "Saved with push off" }));
        assert.equal(result.saved, true); assert.equal(result.notificationStatus, "unavailable"); assert.equal(requests.length, 1);
      }
      await seed(); const revokedId = (await send({ mode: "test" })).results[0].historyId;
      beforeDeliver = () => db.doc("teams/debug/members/operator").delete();
      const revoked = await backend.reply(req({ historyId: revokedId, requestId: "synthetic_self_test_revoked", text: "Saved before operator removal" }));
      assert.equal(revoked.saved, true); assert.equal(revoked.notificationStatus, "unavailable"); assert.equal(requests.length, 1);
    });
    await t.test("a repeated or simultaneous reply operation creates one message and one push; changed content cannot reuse its ID", async () => {
      await seed(); const id = (await send()).results[0].historyId;
      const input = req({ historyId: id, requestId: "synthetic_stable_reply", text: "Synthetic once" }, "owner");
      const results = await Promise.all([backend.reply(input), backend.reply(input)]);
      assert.equal(results[0].messageId, results[1].messageId); assert.equal(requests.flat().length, 2);
      assert.equal((await db.collection("operatorGuidanceMessages").get()).size, 1);
      assert.equal((await db.doc(`operatorGuidanceHistory/${id}`).get()).data().messageCount, 1);
      await backend.reply(input); assert.equal(requests.flat().length, 2);
      await assert.rejects(backend.reply({ ...input, data: { ...input.data, text: "Changed" } }), (e) => e.code === "invalid-argument");
      for (const data of [{ text: " " }, { text: "x".repeat(2001) }, { requestId: "short" }, { asOperator: "true" }]) {
        await assert.rejects(backend.reply({ ...input, data: { ...input.data, ...data } }), (e) => e.code === "invalid-argument");
      }
    });
    await t.test("OFF notifications and dismissed or expired notifications do not hide the independent conversation", async () => {
      for (const setting of [{ masterEnabled: false }, { categories: { operatorGuidance: false } }, { teamEnabled: { a: false } }]) {
        await seed(); const id = (await send()).results[0].historyId;
        await db.doc("users/owner/notificationPreferences/default").set({ masterEnabled: true, ...setting });
        const initial = (await db.collection("users/owner/notifications").get()).docs[0];
        await initial.ref.delete();
        const response = await backend.reply(req({ historyId: id, asOperator: true, requestId: "synthetic_off_reply", text: "Saved while OFF" }));
        assert.equal(response.saved, true); assert.equal(response.notificationStatus, "unavailable"); assert.equal(requests.flat().length, 1);
        assert.equal((await backend.inbox(req({}, "owner"))).items[0].id, id);
        assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).items[0].body, "Saved while OFF");
      }
    });
    await t.test("a claimed but undelivered guide is private; a stored notification recovers a lost outcome update", async () => {
      await seed(); beforeDeliver = () => db.doc("teams/a/members/owner").delete();
      const failed = (await send()).results[0].historyId;
      assert.equal((await backend.inbox(req({}, "owner"))).items.length, 0);
      await denied(backend.conversation(req({ historyId: failed }, "owner")));
      assert.equal((await backend.conversation(req({ historyId: failed, asOperator: true }))).thread.canReply, false);
      await seed(); const id = (await send()).results[0].historyId;
      await db.doc(`operatorGuidanceHistory/${id}`).update({ notificationSaved: false, status: "processing" });
      assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).thread.canReply, true);
    });
    await t.test("inbox and detail permanently recover a saved notification before its removal, without new pushes", async () => {
      for (const via of ["inbox", "detail"]) {
        await seed(); const id = (await send()).results[0].historyId;
        await db.doc(`operatorGuidanceHistory/${id}`).update({ notificationSaved: false, status: "processing" });
        if (via === "inbox") assert.equal((await backend.inbox(req({}, "owner"))).items[0].id, id);
        else assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).thread.canReply, true);
        assert.equal((await db.doc(`operatorGuidanceHistory/${id}`).get()).data().notificationSaved, true);
        await db.doc(`users/owner/notifications/guidance_${id}`).delete();
        assert.equal((await backend.inbox(req({}, "owner"))).items[0].id, id);
        assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).thread.canReply, true);
        assert.equal(requests.length, 1);
      }
    });
    await t.test("legacy pending conversations with prior replies recover after notification expiry; replay never pushes twice", async () => {
      await seed(); const id = (await send()).results[0].historyId;
      const reply = req({ historyId: id, requestId: "synthetic_recovery_reply", text: "A saved reply before upgrade" }, "owner");
      await backend.reply(reply);
      await db.doc(`operatorGuidanceHistory/${id}`).update({ notificationSaved: false, status: "processing" });
      await db.doc(`users/owner/notifications/guidance_${id}`).delete();
      const inbox = await backend.inbox(req({}, "owner")); assert.equal(inbox.items[0].id, id);
      const page = await backend.conversation(req({ historyId: id }, "owner")); assert.equal(page.items[0].body, reply.data.text);
      assert.equal((await db.doc(`operatorGuidanceHistory/${id}`).get()).data().notificationSaved, true);
      await db.doc(`operatorGuidanceHistory/${id}`).update({ notificationSaved: false });
      await backend.reply(reply); assert.equal(requests.length, 2);
      assert.equal((await db.doc(`operatorGuidanceHistory/${id}`).get()).data().notificationSaved, true);
    });
    await t.test("a first reply atomically confirms recovered delivery before the original notification is removed", async () => {
      await seed(); const id = (await send()).results[0].historyId;
      await db.doc(`operatorGuidanceHistory/${id}`).update({ notificationSaved: false });
      await backend.reply(req({ historyId: id, requestId: "synthetic_atomic_recovery", text: "First recovered reply" }, "owner"));
      assert.equal((await db.doc(`operatorGuidanceHistory/${id}`).get()).data().notificationSaved, true);
      await db.doc(`users/owner/notifications/guidance_${id}`).delete();
      assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).items.length, 1);
    });
    await t.test("recovery refuses outsiders, unrelated notifications and recipients removed between its reads", async () => {
      await seed(); const id = (await send()).results[0].historyId;
      const parent = db.doc(`operatorGuidanceHistory/${id}`);
      await parent.update({ notificationSaved: false });
      await denied(backend.conversation(req({ historyId: id }, "outsider")));
      assert.equal((await parent.get()).data().notificationSaved, false);
      await db.doc(`users/owner/notifications/guidance_${id}`).update({ source: { historyId: "unrelated" } });
      assert.equal((await backend.inbox(req({}, "owner"))).items.length, 0);
      await denied(backend.conversation(req({ historyId: id }, "owner")));
      await db.doc(`users/owner/notifications/guidance_${id}`).update({ source: { historyId: id } });
      beforeNextWriteTransaction = () => parent.update({ targetUid: "deleted_user", content: null, body: "Removed" });
      assert.equal((await backend.inbox(req({ asOperator: true }, "owner"))).items.length, 0);
      assert.equal((await parent.get()).data().notificationSaved, false); assert.equal((await parent.get()).data().targetUid, "deleted_user");
      await denied(backend.conversation(req({ historyId: id }, "owner")));
    });
    await t.test("only whole-call preflight rejections are marked safe; content conflicts after an operation begins stay uncertain", async () => {
      await seed();
      for (const data of [{ templateVersion: "guide-v1" }, { requestId: "short" }, { content: { title: "" } }, { teamIds: [] }, { mode: "resend" }]) {
        await assert.rejects(send(data), (e) => e.code === "invalid-argument" && e.details.guidanceSendNotStarted === true && e.details.refreshTemplate === (data.templateVersion === "guide-v1"));
      }
      assert.equal(requests.length, 0); assert.equal((await db.collection("operatorGuidanceHistory").get()).size, 0);
      const stable = { requestId: "synthetic_partial_conflict" };
      const first = (await send(stable)).results[0];
      const content = JSON.parse(JSON.stringify(GUIDANCE_TEMPLATE.content)); content.title = "Changed after initial result loss";
      await assert.rejects(send({ ...stable, content }), (e) => e.code === "invalid-argument" && !e.details?.guidanceSendNotStarted);
      assert.equal((await send(stable)).results[0].historyId, first.historyId); assert.equal(requests.length, 1);
    });
    await t.test("operator revocation and push failures leave a saved reply but never resend it automatically", async () => {
      await seed(); const id = (await send()).results[0].historyId;
      beforeDeliver = () => db.doc("teams/debug/members/operator").delete();
      const input = req({ historyId: id, asOperator: true, requestId: "synthetic_revoked_reply", text: "Saved before revocation" });
      assert.equal((await backend.reply(input)).notificationStatus, "unavailable"); assert.equal(requests.flat().length, 1);
      await denied(backend.conversation(req({ historyId: id, asOperator: true })));
      assert.equal((await backend.conversation(req({ historyId: id }, "owner"))).items.length, 1);
      await seed(); const nextId = (await send()).results[0].historyId;
      beforeDeliver = () => { throw new Error("Synthetic network loss"); };
      const next = req({ historyId: nextId, requestId: "synthetic_failed_reply", text: "Stored despite push failure" }, "owner");
      assert.equal((await backend.reply(next)).notificationStatus, "failed"); beforeDeliver = null;
      await backend.reply(next); assert.equal(requests.flat().length, 1);
    });
    await t.test("inbox and message reads are bounded, chronological and cannot leak another thread sharing the ID prefix", async () => {
      await seed(); const id = (await send()).results[0].historyId, batch = db.batch();
      for (let i = 0; i < 45; i++) {
        batch.set(db.doc(`operatorGuidanceHistory/inbox${String(i).padStart(3, "0")}`), { targetUid: "owner", notificationSaved: true, title: "Synthetic old guide" });
        batch.set(db.doc(`operatorGuidanceHistory/other${i}`), { targetUid: "outsider", notificationSaved: true, body: "Private other guide" });
      }
      for (let i = 1; i <= 65; i++) batch.set(db.doc(`operatorGuidanceMessages/${id}_${String(i).padStart(12, "0")}`),
        { historyId: id, senderUid: "owner", targetUid: "owner", senderRole: "recipient", body: `Message ${i}`, createdAt: admin.Timestamp.fromMillis(clock + i) });
      batch.set(db.doc(`operatorGuidanceMessages/${id}_foreign_000000000001`), { historyId: "foreign", body: "Private other message" });
      batch.update(db.doc(`operatorGuidanceHistory/${id}`), { messageCount: 65 }); await batch.commit();
      let cursor = null; const ids = [];
      do { const page = await backend.inbox(req({ cursor }, "owner")); assert.ok(page.items.length <= 20); ids.push(...page.items.map((item) => item.id)); cursor = page.cursor; } while (cursor);
      assert.equal(ids.length, 46); assert.equal(new Set(ids).size, 46);
      const newest = await backend.conversation(req({ historyId: id }, "owner"));
      assert.equal(newest.items.length, 30); assert.equal(newest.items[0].body, "Message 36"); assert.equal(newest.items.at(-1).body, "Message 65");
      const middle = await backend.conversation(req({ historyId: id, cursor: newest.cursor }, "owner"));
      const oldest = await backend.conversation(req({ historyId: id, cursor: middle.cursor }, "owner"));
      assert.equal(middle.items[0].body, "Message 6"); assert.equal(oldest.items.length, 5); assert.equal(oldest.cursor, null);
      await assert.rejects(backend.conversation(req({ historyId: id, cursor: "foreign_000000000001" }, "owner")), (e) => e.code === "invalid-argument");
    });
    await t.test("read/dismiss are separate from delivery outcome and account deletion removes private replies and anonymizes history", async () => {
      await seed(); const result = (await send()).results[0];
      await backend.reply(req({ historyId: result.historyId, requestId: "synthetic_delete_reply", text: "Private reply to remove" }, "owner"));
      const note = (await db.collection("users/owner/notifications").get()).docs[0];
      await exports.exports.markNotificationRead(req({ notificationId: note.id }, "owner"));
      assert.equal((await db.doc("users/owner/notificationState/summary").get()).data().unreadTotal, 0);
      assert.equal((await db.doc(`operatorGuidanceHistory/${result.historyId}`).get()).data().status, "accepted");
      await backend.anonymizeAccount("owner"); await backend.anonymizeAccount("operator");
      const history = (await db.doc(`operatorGuidanceHistory/${result.historyId}`).get()).data(); assert.equal(history.targetUid, "deleted_user"); assert.equal(history.senderUid, "deleted_user");
      assert.equal((await db.collection("operatorGuidanceRequests").get()).size, 0);
      assert.equal((await db.collection("operatorGuidanceMessages").get()).size, 0);
      await denied(backend.conversation(req({ historyId: result.historyId }, "owner")));
    });
  } finally {
    for (const value of clients) { await sdk.terminate(value.db); await deleteApp(value.app); }
    await adminApp.deleteApp(app);
  }
});
