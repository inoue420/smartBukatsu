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
  let pushRequests = 0;
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
  function reference(location, filters = []) {
    return {
      path: location,
      id: location.split("/").at(-1),
      doc: (id) => reference(`${location}/${id}`),
      collection: (name) => reference(`${location}/${name}`),
      where: (field, _operator, value) => reference(location, [...filters, [field, value]]),
      async get() {
        if (location === "teams/team") {
          teamReads += 1;
          if (options.failTeamRead) throw new Error("simulated team read failure");
        }
        if (location === "teams/team/members" || location.endsWith("/pushTokens") || filters.length) {
          if (location === "teams/team/members" && options.failTeamRead) {
            await new Promise((resolve) => setImmediate(resolve));
          }
          const docs = [...documents.keys()]
            .filter((key) => key.startsWith(`${location}/`) && key.split("/").length === location.split("/").length + 1)
            .filter((key) => filters.every(([field, value]) => documents.get(key)[field] === value))
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
        get: async (ref) => ref.get(),
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
    "./workspaceAudience": require("./workspaceAudience"),
  };
  vm.runInNewContext(source, {
    module,
    AbortSignal,
    setTimeout,
    require: (name) => {
      assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    fetch: async (_url, request) => {
      const messages = JSON.parse(request.body);
      pushes.push(...messages);
      pushRequests += 1;
      return { ok: true, json: async () => ({ data: messages.map((_message, index) => ({ status: "ok", id: `ticket-${index}` })) }) };
    },
  });
  return {
    logs, pushes, documents,
    counts: () => ({ memberQueries, memberDocuments, teamReads }),
    pushRequestCount: () => pushRequests,
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

test("new post reaches public members and selected public managers, excluding the sender", async () => {
  const h = harness();
  await h.run(null, post);
  assert.deepEqual(h.notifications().map((item) => item.uid).sort(), ["manager", "target", "writer"]);
});

function gradeHarness(allowedRoleGroups = ["staff", "guardian"]) {
  const h = harness();
  h.documents.set("teams/team", { name: "Test team", channels: [{
    id: "channel", name: "First grade", shareScope: "grades", allowedGrades: ["1年生"],
    allowedRoleGroups, notificationRecipientUids: ["manager", "unselected", "target", "outsider"],
  }] });
  for (const [uid, role, grade] of [
    ["author", "staff", ""], ["writer", "member", "1年生"], ["target", "member", "2年生"],
    ["manager", "admin", ""], ["unselected", "staff", ""], ["captain", "captain", "1年生"],
    ["unset", "member", ""], ["guardian", "guardian", "1年生"],
  ]) {
    h.documents.set(`teams/team/members/${uid}`, { role, grade });
    h.documents.set(`users/${uid}`, {});
    h.documents.set(`users/${uid}/notificationPreferences/default`, { masterEnabled: true });
    h.documents.set(`users/${uid}/pushTokens/device`, { token: `ExpoPushToken[${uid}]` });
  }
  // A staff member outside the explicit selection must not receive a new-post notification.
  h.documents.get("teams/team").channels[0].notificationRecipientUids = ["manager", "target", "outsider"];
  return h;
}

test("grade post includes public captain/guardian, filters stale UID lists and retains staff selection", async () => {
  const h = gradeHarness();
  await h.run(null, { ...post, shareScope: "grades", visibleToUids: ["author", "writer", "target", "manager", "unselected", "captain", "unset", "guardian", "outsider"] });
  assert.deepEqual(h.notifications().map((item) => item.uid).sort(), ["captain", "guardian", "manager", "writer"]);
  assert.equal(h.pushes.length, 4);
});

test("a secondary group match sends one notification even when several memberships match", async () => {
  const h = gradeHarness([]);
  h.documents.get("teams/team").channels[0].allowedGrades = ["1年生", "Aチーム"];
  h.documents.get("teams/team/members/target").grades = ["2年生", "Aチーム", "Aチーム"];
  h.documents.get("teams/team/members/writer").grades = ["1年生", "Aチーム"];
  h.documents.get("teams/team/members/captain").grades = [];
  await h.run(null, { ...post, shareScope: "grades", visibleToUids: ["author", "writer", "target", "captain"] });
  assert.deepEqual(h.notifications().map((item) => item.uid).sort(), ["target", "writer"]);
  assert.equal(h.pushes.length, 2);
  await h.run(null, { ...post, shareScope: "grades", visibleToUids: ["author", "writer", "target", "captain"] });
  assert.equal(h.notifications().length, 2); assert.equal(h.pushes.length, 2);
});

test("removing a secondary group suppresses stale new-post and mention recipients", async () => {
  for (const isNew of [true, false]) {
    const h = gradeHarness([]);
    h.documents.get("teams/team").channels[0].allowedGrades = ["Aチーム"];
    h.documents.get("teams/team/members/target").grades = ["2年生"];
    await h.run(isNew ? null : post, { ...post, shareScope: "grades", visibleToUids: ["target"], mentionedUids: ["target"] });
    assert.equal(h.notifications().length, 0); assert.equal(h.pushes.length, 0);
  }
});

test("selected staff outside the public scope do not receive post contents", async () => {
  const h = gradeHarness([]);
  await h.run(null, { ...post, shareScope: "grades" });
  assert.deepEqual(h.notifications().map((item) => item.uid).sort(), ["captain", "writer"]);
});

test("grade channel with no selected grades does not default to all members", async () => {
  const h = gradeHarness([]);
  h.documents.get("teams/team").channels[0].allowedGrades = [];
  await h.run(null, { ...post, shareScope: "grades" });
  assert.equal(h.notifications().length, 0);
});

test("new-post category, team and master switches suppress pushes while retaining in-app notifications", async () => {
  const h = gradeHarness();
  h.documents.set("users/writer/notificationPreferences/default", { masterEnabled: true, categories: { workspacePost: false } });
  h.documents.set("users/manager/notificationPreferences/default", { masterEnabled: true, teamEnabled: { team: false } });
  h.documents.set("users/guardian/notificationPreferences/default", { masterEnabled: false });
  await h.run(null, post);
  assert.equal(h.notifications().length, 4);
  assert.deepEqual(h.pushes.map((message) => message.to), ["ExpoPushToken[captain]"]);
});

test("new post replay is idempotent and an explicit mention takes precedence over the new-post notification", async () => {
  const h = gradeHarness();
  const mentioned = { ...post, mentionedUids: ["writer"] };
  await h.run(null, mentioned);
  await h.run(null, mentioned);
  assert.equal(h.notifications().length, 4);
  assert.equal(h.pushes.length, 4);
  assert.deepEqual(h.notifications().filter((item) => item.uid === "writer").map((item) => item.category), ["mention"]);
});

test("hidden, unknown grade channels and empty saved audiences never produce new-post notifications", async () => {
  for (const change of [{ moderationStatus: "hidden" }, { channelId: "missing", shareScope: "grades" }, { visibleToUids: [] }]) {
    const h = gradeHarness();
    await h.run(null, { ...post, ...change });
    assert.equal(h.notifications().length, 0);
  }
});

test("grade changes also prevent stale mentions from notifying a former audience member", async () => {
  const h = gradeHarness([]);
  await h.run(post, { ...post, shareScope: "grades", visibleToUids: ["target"], mentionedUids: ["target"] });
  assert.equal(h.notifications().length, 0);
});

test("all-member mode notifies unset and other grades while retaining the selected staff rule", async () => {
  const h = gradeHarness();
  h.documents.get("teams/team").channels[0].memberAudience = "all";
  await h.run(null, post);
  assert.deepEqual(h.notifications().map((item) => item.uid).sort(), ["captain", "guardian", "manager", "target", "unset", "writer"]);
});

test("the existing system General defaults to all and still honors subsequent explicit grade choices", async () => {
  for (const memberAudience of [undefined, "grades"]) {
    const h = gradeHarness();
    const channel = h.documents.get("teams/team").channels[0];
    channel.id = "ch_1"; channel.name = "全体連絡";
    if (memberAudience) channel.memberAudience = memberAudience;
    await h.run(null, { ...post, channelId: "ch_1" });
    assert.equal(h.notifications().some((item) => item.uid === "unset"), memberAudience === undefined);
    assert.equal(h.notifications().some((item) => item.uid === "target"), memberAudience === undefined);
    assert.equal(h.notifications().some((item) => item.uid === "manager"), true);
  }
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
  assert.deepEqual(h.notifications().map((item) => item.uid).sort(), ["author", "manager", "target", "writer"]);
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

test("mentions for the same event share one HTTP request with per-user badges", async () => {
  const h = harness();
  h.documents.set("users/target/notificationState/summary", { unreadTotal: 7, unreadByTeam: { team: 7 },
    unreadBucketsVersion: 1, unreadBuckets: { '["mention","team"]': 7 } });
  await h.run(post, { ...post, mentionedUids: ["target", "manager"] });
  assert.equal(h.pushRequestCount(), 1);
  assert.equal(h.pushes.length, 2);
  assert.deepEqual(h.pushes.map((message) => [message.to, message.badge]), [["ExpoPushToken[target]", 8], ["ExpoPushToken[manager]", 1]]);
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

test("before/after comparison: passive/mention/reply events retain fewer reads and identical notifications", async () => {
  // Pin the approved starting revision, so this regression remains useful after commit.
  const originalSource = execFileSync("git", ["show", "1c127f44c760a9b417574661ccffaa0b6aeb3c97:./notifications.js"], { cwd: __dirname, encoding: "utf8" });
  const old = harness(originalSource);
  const updated = harness();
  const scenarios = [
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
  assert.equal(old.counts().memberDocuments, 20);
  assert.equal(updated.counts().memberDocuments, 8);
});
