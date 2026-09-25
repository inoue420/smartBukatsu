const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const currentSource = fs.readFileSync(path.join(__dirname, "notifications.js"), "utf8");

// Exercise the actual trigger, recipient filters and notification transaction.
// Only external Firebase/Expo interfaces are replaced; no network is used.
function harness(source = currentSource, options = {}) {
  const documents = new Map();
  const logs = [];
  const pushes = [];
  let memberQueries = 0;
  let memberDocuments = 0;
  let teamReads = 0;
  const members = { author: "staff", writer: "member", target: "member", manager: "admin" };
  documents.set("teams/team", {
    name: "Test team",
    channels: [{ id: "channel", name: "General", notificationRecipientUids: ["manager", "writer", "author"] }],
  });
  for (const [uid, role] of Object.entries(members)) {
    documents.set(`teams/team/members/${uid}`, { role });
    documents.set(`users/${uid}`, { blockedUserUids: options.blocked ? ["writer"] : [] });
    documents.set(`users/${uid}/notificationPreferences/default`, { masterEnabled: !options.pushDisabled });
    documents.set(`users/${uid}/pushTokens/device`, { token: `ExpoPushToken[${uid}]` });
  }
  function snapshot(ref) {
    return { id: ref.id, ref, exists: documents.has(ref.path), data: () => documents.get(ref.path) };
  }
  function reference(location) {
    return {
      path: location,
      id: location.split("/").at(-1),
      doc: (id) => reference(`${location}/${id}`),
      collection: (name) => reference(`${location}/${name}`),
      async get() {
        if (location === "teams/team") {
          teamReads += 1;
          if (options.failTeamRead) throw new Error("simulated team read failure");
        }
        if (location === "teams/team/members" || location.endsWith("/pushTokens")) {
          if (location === "teams/team/members" && options.failTeamRead) {
            await new Promise((resolve) => setImmediate(resolve));
          }
          const docs = [...documents.keys()]
            .filter((key) => key.startsWith(`${location}/`) && key.split("/").length === location.split("/").length + 1)
            .map((key) => snapshot(reference(key)));
          if (location === "teams/team/members") {
            memberQueries += 1;
            memberDocuments += docs.length;
          }
          return { docs };
        }
        return snapshot(this);
      },
    };
  }
  const firestore = {
    collection: reference,
    async runTransaction(callback) {
      return callback({
        get: async (ref) => snapshot(ref),
        create(ref, data) {
          assert.equal(documents.has(ref.path), false);
          documents.set(ref.path, data);
        },
        set(ref, data) { documents.set(ref.path, { ...documents.get(ref.path), ...data }); },
      });
    },
  };
  const timestamp = (value) => ({ toMillis: () => value });
  const module = { exports: {} };
  const dependencies = {
    "firebase-functions/v2/https": { onCall: (...args) => args.at(-1), HttpsError: Error },
    "firebase-functions/v2/firestore": { onDocumentWritten: (_options, handler) => handler },
    "firebase-functions/v2/scheduler": { onSchedule: (_options, handler) => handler },
    "firebase-functions/logger": {
      info: (message, fields) => logs.push({ message, ...fields }),
      warn: (...args) => assert.fail(JSON.stringify(args)),
      error: (...args) => assert.fail(JSON.stringify(args)),
    },
    "firebase-admin/firestore": { getFirestore: () => firestore, Timestamp: { now: () => timestamp(1000), fromMillis: timestamp } },
    "node:crypto": require("node:crypto"),
    "./notificationCore": require("./notificationCore"),
  };
  vm.runInNewContext(source, {
    module,
    require: (name) => {
      assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    fetch: async (_url, request) => {
      pushes.push(...JSON.parse(request.body));
      return { ok: true, json: async () => ({ data: [{ status: "ok" }] }) };
    },
  });
  return {
    logs, pushes, documents,
    counts: () => ({ memberQueries, memberDocuments, teamReads }),
    notifications: () => [...documents.entries()]
      .filter(([key]) => key.includes("/notifications/"))
      .map(([key, value]) => ({ uid: key.split("/")[1], ...JSON.parse(JSON.stringify(value)) })),
    async run(before, after, id = "event") {
      return module.exports.notifyWorkspacePostWritten({
        id, params: { teamId: "team", postId: "post" },
        data: {
          before: { exists: before != null, data: () => before },
          after: { exists: after != null, data: () => after },
        },
      });
    },
  };
}

const post = { authorUid: "author", channelId: "channel", content: "Post", replies: [], mentionedUids: [] };
const reply = { id: "reply", authorUid: "writer", content: "Reply" };
const passiveChanges = {
  read: { readByUids: ["writer"], readBy: ["Test reader"] },
  reaction: { reactions: { thumbsUp: ["writer"] } },
  both: { readByUids: ["writer"], reactions: { thumbsUp: ["writer"] } },
};

for (const [name, change] of Object.entries(passiveChanges)) {
  test(`${name} only skips all team/member reads and notifications`, async () => {
    const h = harness();
    await h.run(post, { ...post, ...change });
    assert.deepEqual(h.counts(), { memberQueries: 0, memberDocuments: 0, teamReads: 0 });
    assert.equal(h.notifications().length, 0);
    assert.deepEqual(h.logs, [{ message: "workspace_post_notification_metrics", invocations: 1, memberFetchSkipped: 1, memberDocumentsFetched: 0 }]);
  });
  for (const kind of ["reply", "post mention", "reply mention"]) {
    test(`${name} together with ${kind} preserves recipients and navigation`, async () => {
      const h = harness();
      const addition = kind === "post mention"
        ? { mentionedUids: ["target"] }
        : { replies: [{ ...reply, ...(kind === "reply mention" ? { mentionedUids: ["target"] } : {}) }] };
      await h.run(post, { ...post, ...change, ...addition });
      const notifications = h.notifications();
      assert.deepEqual(notifications.map((item) => item.uid).sort(), kind === "reply mention" ? ["author", "target"] : [kind === "reply" ? "author" : "target"]);
      assert.equal(h.pushes.length, notifications.length);
      for (const item of notifications) {
        assert.deepEqual(item.target, { screen: "WorkspaceHome", params: kind === "post mention" ? { postId: "post" } : { postId: "post", replyId: "reply" } });
      }
      assert.equal(h.logs[0].memberDocumentsFetched, 4);
      assert.equal(h.logs[0].memberFetchSkipped, 0);
    });
  }
}

test("new post retains manager role and sender exclusion", async () => {
  const h = harness();
  await h.run(null, post);
  assert.deepEqual(h.notifications().map((item) => item.uid), ["manager"]);
});

test("mentions retain visibility, sender exclusion and membership checks", async () => {
  const h = harness();
  await h.run(post, { ...post, visibleToUids: ["author", "target", "outsider"], mentionedUids: ["author", "writer", "target", "outsider"] });
  assert.deepEqual(h.notifications().map((item) => item.uid), ["target"]);
});

test("reply mentioning its author sends only the mention notification to that author", async () => {
  const h = harness();
  await h.run(post, { ...post, replies: [{ ...reply, mentionedUids: ["author", "writer", "target" ] }], visibleToUids: ["author", "writer"] });
  assert.deepEqual(h.notifications().map((item) => [item.uid, item.category]), [["author", "mention"]]);
});

test("non-notifying changes, deletion and legacy missing arrays are safe", async () => {
  for (const [before, after] of [
    [post, { ...post, content: "Edited" }],
    [post, { ...post, mentionedUids: ["author", "invalid uid"] }],
    [post, { ...post, replies: [{ ...reply, authorUid: "author" }] }],
    [post, { ...post, status: "deleted", replies: [reply] }],
    [post, null],
    [{ createdBy: "author" }, { createdBy: "author", readBy: ["Reader"] }],
    [{ ...post, replies: [reply] }, { ...post, replies: [{ ...reply, reactions: { like: ["target"] } }] }],
  ]) {
    const h = harness();
    await h.run(before, after);
    assert.equal(h.counts().memberQueries, 0);
    assert.equal(h.notifications().length, 0);
  }
});

test("legacy author fields and channel names keep working", async () => {
  const h = harness();
  await h.run({ createdBy: "author" }, { createdBy: "author", replies: [{ id: "legacy", uid: "writer" }] });
  await h.run(null, { createdBy: "author", channel: "General" }, "new");
  assert.deepEqual(h.notifications().map((item) => item.uid).sort(), ["author", "manager"]);
});

test("same event replay does not duplicate notification documents or pushes", async () => {
  const h = harness();
  const after = { ...post, mentionedUids: ["target"], replies: [reply] };
  await h.run(post, after);
  await h.run(post, after);
  assert.equal(h.notifications().length, 2);
  assert.equal(h.pushes.length, 2);
  assert.equal(h.logs.length, 2);
});

test("separate passive and notifying writes work in either order", async () => {
  for (const passiveFirst of [true, false]) {
    const h = harness();
    const change = { replies: [reply], mentionedUids: ["target"] };
    const middle = { ...post, ...(passiveFirst ? passiveChanges.both : change) };
    const final = { ...post, ...passiveChanges.both, ...change };
    await h.run(post, middle, "first");
    await h.run(middle, final, "second");
    assert.equal(h.notifications().length, 2);
    assert.equal(h.pushes.length, 2);
    assert.equal(h.counts().memberQueries, 1);
  }
});

test("push disabled still creates in-app notifications; blocking still applies", async () => {
  const h = harness(currentSource, { pushDisabled: true });
  await h.run(post, { ...post, replies: [reply] });
  assert.equal(h.notifications().length, 1);
  assert.equal(h.pushes.length, 0);
  const blocked = harness(currentSource, { blocked: true });
  await blocked.run(post, { ...post, replies: [reply] });
  assert.equal(blocked.notifications().length, 0);
});

test("metrics are emitted even when context retrieval fails", async () => {
  const h = harness(currentSource, { failTeamRead: true });
  await assert.rejects(h.run(null, post), /simulated team read failure/);
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0].invocations, 1);
  assert.equal(h.logs[0].memberFetchSkipped, 0);
  assert.equal(h.logs[0].memberDocumentsFetched, 4);
});

test("before/after comparison: fewer reads with identical notifications", async () => {
  // Pin the approved starting revision, so this regression remains useful after commit.
  const originalSource = execFileSync("git", ["show", "1c127f44c760a9b417574661ccffaa0b6aeb3c97:./notifications.js"], { cwd: __dirname, encoding: "utf8" });
  const old = harness(originalSource);
  const updated = harness();
  const scenarios = [
    [null, post],
    ...Object.values(passiveChanges).map((change) => [post, { ...post, ...change }]),
    [post, { ...post, ...passiveChanges.both, replies: [reply], mentionedUids: ["target"] }],
    [post, { ...post, replies: [{ ...reply, mentionedUids: ["author", "target"] }] }],
    [post, { ...post, status: "deleted" }],
  ];
  for (const [index, [before, after]] of scenarios.entries()) {
    await old.run(before, after, `event-${index}`);
    await updated.run(before, after, `event-${index}`);
  }
  assert.deepEqual(updated.notifications(), old.notifications());
  assert.deepEqual(updated.pushes, old.pushes);
  assert.equal(old.counts().memberDocuments, 24);
  assert.equal(updated.counts().memberDocuments, 12);
});
