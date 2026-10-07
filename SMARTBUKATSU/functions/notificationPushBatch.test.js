const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const source = fs.readFileSync(path.join(__dirname, "notifications.js"), "utf8");
const tokenFor = (uid, device = "device") => `ExpoPushToken[synthetic-${uid}-${device}]`;
const registryPath = (token) => `notificationPushTokens/${createHash("sha256").update(token).digest("hex")}`;
const ticketError = (error) => ({ status: "error", details: { error } });
const accepted = (messages) => ({ ok: true, status: 200, json: async () => ({ data: messages.map((_message, index) => ({ status: "ok", id: `synthetic-ticket-${index}` })) }) });

// Execute the production triggers and transaction/transport code. Only the
// Firebase and Expo interfaces are replaced, using synthetic data and no network.
function harness(options = {}) {
  const documents = new Map();
  const requests = [], logs = [], waits = [], timeouts = [], writes = [];
  let clockMillis = Date.UTC(2026, 9, 6, 3);
  let transactionQueue = Promise.resolve();
  let h;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clockMillis])); }
    static now() { return clockMillis; }
  }
  const timestamp = (millis) => ({ toMillis: () => millis });
  const snapshot = (ref) => {
    const value = documents.get(ref.path);
    return { ref, id: ref.id, exists: value !== undefined, data: () => value };
  };
  function reference(location, filters = [], max = Infinity) {
    return {
      path: location,
      id: location.split("/").at(-1),
      get parent() { return location.includes("/") ? reference(location.slice(0, location.lastIndexOf("/"))) : null; },
      doc: (id) => reference(`${location}/${id}`),
      collection: (name) => reference(`${location}/${name}`),
      where: (field, operator, value) => reference(location, [...filters, { field, operator, value }], max),
      limit: (limit) => reference(location, filters, limit),
      async get() {
        if (options.failPreparationUid && location === `users/${options.failPreparationUid}/pushTokens`) throw new Error("synthetic preparation failure");
        if (location.split("/").length % 2 === 0) return snapshot(this);
        const docs = [...documents.keys()].filter((key) => key.startsWith(`${location}/`) && key.split("/").length === location.split("/").length + 1)
          .filter((key) => filters.every(({ field, operator, value }) => operator === "==" ? documents.get(key)[field] === value : operator === "array-contains" && documents.get(key)[field]?.includes(value)))
          .slice(0, max).map((key) => snapshot(reference(key)));
        return { docs };
      },
    };
  }
  const firestore = {
    collection: reference,
    runTransaction(callback) {
      const result = transactionQueue.then(async () => {
        const operations = [];
        const result = await callback({
          get: async (ref) => {
            assert.equal(operations.length, 0, "Firestore reads must precede writes");
            return snapshot(ref);
          },
          create: (ref, data) => operations.push({ action: "create", ref, data }),
          set: (ref, data, config) => operations.push({ action: "set", ref, data, config }),
          delete: (ref) => operations.push({ action: "delete", ref }),
        });
        if (operations.some((operation) => operation.action === "delete") && options.failCleanup) throw new Error("synthetic cleanup failure");
        for (const operation of operations) {
          const { action, ref, data, config } = operation;
          if (action === "create") assert.equal(documents.has(ref.path), false, "duplicate notification create");
          if (action === "delete") documents.delete(ref.path);
          else documents.set(ref.path, config?.merge ? { ...documents.get(ref.path), ...data } : data);
          writes.push({ action, path: ref.path });
        }
        return result;
      });
      transactionQueue = result.catch(() => {});
      return result;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(options.source || source, {
    module,
    Date: ClockDate,
    AbortSignal: { timeout: (milliseconds) => { timeouts.push(milliseconds); return AbortSignal.timeout(milliseconds); } },
    setTimeout: (callback, milliseconds) => { waits.push(milliseconds); clockMillis += milliseconds; callback(); },
    require(name) {
      if (name === "firebase-admin/firestore") return { getFirestore: () => firestore, Timestamp: { now: () => timestamp(1000), fromMillis: timestamp } };
      if (name === "firebase-functions/v2/firestore" || name === "firebase-functions/v2/scheduler") return { onDocumentWritten: (_config, handler) => handler, onSchedule: (_config, handler) => handler };
      if (name === "firebase-functions/v2/https") return { onCall: (_config, handler) => handler, HttpsError: Error };
      if (name === "firebase-functions/logger") return Object.fromEntries(["info", "warn", "error"].map((level) => [level, (message, fields) => logs.push({ level, message, ...fields })]));
      if (name === "./notificationCore") return require("./notificationCore");
      if (name === "node:crypto") return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
    async fetch(url, request) {
      const messages = JSON.parse(request.body);
      assert.equal(url, "https://exp.host/--/api/v2/push/send");
      assert.equal(request.method, "POST");
      const index = requests.length;
      requests.push(messages);
      return options.respond ? options.respond({ messages, index, h }) : accepted(messages);
    },
  });
  const notifications = () => [...documents.entries()].filter(([key]) => key.includes("/notifications/"))
    .map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]);
  h = {
    documents, requests, logs, waits, timeouts, writes, notifications,
    advance: (milliseconds) => { clockMillis += milliseconds; },
    seedUser(uid, role = "member", devices = ["device"]) {
      documents.set(`teams/team/members/${uid}`, { role, name: "Synthetic member" });
      documents.set(`users/${uid}`, {});
      documents.set(`users/${uid}/notificationPreferences/default`, { masterEnabled: true });
      for (const device of devices) {
        const token = tokenFor(uid, device);
        documents.set(`users/${uid}/pushTokens/${device}`, { token, platform: "android" });
        documents.set(registryPath(token), { uid, deviceId: device });
      }
    },
    run(kind = "notice", id = "synthetic-event", before = null, after) {
      const handlers = { notice: "notifyNoticeWritten", schedule: "notifyClubEventWritten", post: "notifyWorkspacePostWritten", diary: "notifyDailyReportWritten", join: "notifyTeamMemberCreated" };
      const defaults = {
        notice: { authorUid: "actor", title: "Synthetic notice", content: "Synthetic content" },
        schedule: { authorUid: "actor", title: "Synthetic schedule", date: "2026-10-07" },
        post: { authorUid: "actor", channelId: "channel", mentionedUids: [], replies: [], content: "Synthetic post" },
        diary: { authorUid: "member0", comments: [{ id: "comment", authorUid: "actor", text: "Synthetic comment" }] },
        join: { name: "Synthetic new member", role: "member" },
      };
      return module.exports[handlers[kind]]({ id, time: "2026-10-06T03:00:00Z",
        params: { teamId: "team", noticeId: "notice", eventId: "schedule", postId: "post", reportId: "report", memberUid: "newmember" },
        data: { before: { exists: before != null, data: () => before }, after: { exists: true, data: () => after || defaults[kind] } },
      });
    },
    reminders: () => module.exports.sendScheduledEventReminders(),
  };
  documents.set("teams/team", { name: "Synthetic team", dailyReportCommentsEnabled: true, channels: [{ id: "channel", name: "Synthetic channel", notificationRecipientUids: ["member0", "member1", "actor"] }] });
  h.seedUser("actor", "staff");
  for (let index = 0; index < (options.count ?? 30); index += 1) h.seedUser(`member${index}`);
  return h;
}

test("30 recipients use one HTTP request and identical notifications/unread writes to the approved baseline", async () => {
  const original = execFileSync("git", ["show", "da53f362:./notifications.js"], { cwd: __dirname, encoding: "utf8" });
  const before = harness({ source: original }), after = harness();
  for (const h of [before, after]) {
    h.documents.set("users/member0/notificationState/summary", { unreadTotal: 9, unreadByTeam: { other: 5, team: 4 } });
    await h.run();
  }
  assert.equal(before.requests.length, 30);
  assert.equal(after.requests.length, 1);
  assert.equal(after.requests[0].length, 30);
  assert.deepEqual(after.requests.flat(), before.requests.flat());
  assert.deepEqual(after.notifications(), before.notifications());
  assert.deepEqual(after.writes, before.writes);
  assert.equal(after.documents.get("users/member0/notificationState/summary").unreadTotal, 10);
});

test("205 recipients split into 100, 100 and 5, without mixing ticket indices across chunks", async () => {
  const h = harness({ count: 205, respond: ({ messages, index }) => ({ ok: true, status: 200,
    json: async () => ({ data: messages.map((_message, position) => index === 1 && position === 0 ? ticketError("DeviceNotRegistered") : { status: "ok", id: "synthetic-ticket" }) }) }) });
  await h.run();
  assert.deepEqual(h.requests.map((messages) => messages.length), [100, 100, 5]);
  assert.deepEqual(h.waits, [200, 200]);
  assert.equal(h.documents.has("users/member100/pushTokens/device"), false);
  assert.equal(h.documents.has("users/member0/pushTokens/device"), true);
  assert.equal(h.documents.has("users/member200/pushTokens/device"), true);
  assert.equal(h.notifications().length, 205);
});

test("100 is one request; 101 is two requests", async () => {
  for (const count of [100, 101]) {
    const h = harness({ count });
    await h.run();
    assert.equal(h.requests.length, Math.ceil(count / 100));
  }
});

test("partial retry sends only explicit transient failures and retains terminal/accepted recipients", async () => {
  const h = harness({ count: 4, respond: ({ messages, index }) => index === 0
    ? { ok: true, status: 200, json: async () => ({ data: [{ status: "ok", id: "accepted" }, ticketError("MessageRateExceeded"), ticketError("DeviceNotRegistered"), ticketError("InvalidCredentials")] }) }
    : accepted(messages) });
  await h.run();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].map((message) => message.to), [tokenFor("member1")]);
  assert.equal(h.documents.has("users/member2/pushTokens/device"), false);
  assert.equal(h.documents.has(registryPath(tokenFor("member2"))), false);
  assert.equal(h.documents.has("users/member3/pushTokens/device"), true);
  assert.deepEqual(h.waits, [1000]);
  for (let index = 0; index < 4; index += 1) assert.equal(h.documents.get(`users/member${index}/notificationState/summary`).unreadTotal, 1);
  await h.run();
  assert.equal(h.requests.length, 2);
  assert.equal(h.notifications().length, 4);
});

test("retry exhaustion is bounded to three attempts with backoff and no extra notification writes", async () => {
  const h = harness({ count: 1, respond: ({ messages }) => ({ ok: true, status: 200, json: async () => ({ data: messages.map(() => ticketError("MessageRateExceeded")) }) }) });
  await h.run();
  assert.equal(h.requests.length, 3);
  assert.deepEqual(h.waits, [1000, 2000]);
  assert.equal(h.writes.length, 2);
  assert.equal(h.logs.at(-1).reason, "retry_exhausted");
});

for (const status of [429, 500, 503]) {
  test(`HTTP ${status} retries the rejected batch, with no notification/counter duplication`, async () => {
    const h = harness({ count: 2, respond: ({ messages, index }) => index === 0 ? { ok: false, status } : accepted(messages) });
    await h.run();
    assert.equal(h.requests.length, 2);
    assert.deepEqual(h.requests[0], h.requests[1]);
    assert.equal(h.writes.length, 4);
  });
}

test("a request-level rate rejection is retried; other API errors are not", async () => {
  for (const code of ["TOO_MANY_REQUESTS", "PUSH_TOO_MANY_EXPERIENCE_IDS"]) {
    const h = harness({ count: 2, respond: ({ messages, index }) => index === 0 ? { ok: true, status: 200, json: async () => ({ errors: [{ code }] }) } : accepted(messages) });
    await h.run();
    assert.equal(h.requests.length, code === "TOO_MANY_REQUESTS" ? 2 : 1);
    assert.equal(h.notifications().length, 2);
  }
});

for (const status of [400, 401, 403]) {
  test(`HTTP ${status} is not retried and does not remove tokens`, async () => {
    const h = harness({ count: 2, respond: () => ({ ok: false, status }) });
    await h.run();
    assert.equal(h.requests.length, 1);
    assert.equal(h.documents.has("users/member0/pushTokens/device"), true);
    assert.equal(h.notifications().length, 2);
  });
}

for (const failure of ["timeout", "network", "json", "missing", "extra", "invalid"]) {
  test(`${failure} leaves uncertain pushes unreplayed and preserves in-app state`, async () => {
    const h = harness({ count: 2, respond: () => {
      if (failure === "timeout" || failure === "network") throw new Error(`synthetic ${failure} containing a private token`);
      return { ok: true, status: 200, json: async () => {
        if (failure === "json") throw new Error("synthetic parse failure");
        return { data: failure === "missing" ? [ticketError("DeviceNotRegistered")] : failure === "extra"
          ? [ticketError("DeviceNotRegistered"), { status: "ok", id: "accepted" }, ticketError("MessageRateExceeded")]
          : [{ status: "ok" }, {}] };
      } };
    } });
    await h.run();
    await h.run();
    assert.equal(h.requests.length, 1);
    assert.equal(h.notifications().length, 2);
    assert.equal(h.documents.has("users/member0/pushTokens/device"), true);
    assert.equal(h.documents.get("users/member0/notificationState/summary").unreadTotal, 1);
    assert.deepEqual(h.timeouts, [10000]);
    assert.equal(JSON.stringify(h.logs).includes("private token"), false);
  });
}

test("a single-ticket object is supported for a single message", async () => {
  const h = harness({ count: 1, respond: () => ({ ok: true, status: 200, json: async () => ({ data: { status: "ok", id: "synthetic-ticket" } }) }) });
  await h.run();
  assert.equal(h.logs.length, 0);
});

test("later valid chunks are still sent after an earlier chunk fails", async () => {
  const h = harness({ count: 101, respond: ({ messages, index }) => {
    if (index === 0) throw new Error("synthetic connection loss");
    return accepted(messages);
  } });
  await h.run();
  assert.deepEqual(h.requests.map((messages) => messages.length), [100, 1]);
  assert.equal(h.requests[1][0].to, tokenFor("member100"));
});

test("a provider outage cannot consume an unbounded send budget", async () => {
  const h = harness({ count: 205, respond: ({ h }) => { h.advance(10000); return { ok: false, status: 503 }; } });
  await h.run();
  assert.equal(h.requests.length, 3);
  assert.ok(h.logs.some((log) => log.reason === "send_budget_exhausted"));
  assert.deepEqual(h.timeouts, [10000, 10000, 7000]);
  assert.equal(h.notifications().length, 205);
});

test("master/category/team OFF affect only pushes; no tokens and malformed tokens do not make HTTP requests", async () => {
  const h = harness({ count: 5 });
  h.documents.set("users/member0/notificationPreferences/default", { masterEnabled: false });
  h.documents.set("users/member1/notificationPreferences/default", { masterEnabled: true, categories: { notice: false } });
  h.documents.set("users/member2/notificationPreferences/default", { masterEnabled: true, teamEnabled: { team: false } });
  h.documents.delete("users/member3/pushTokens/device");
  h.documents.set("users/member4/pushTokens/device", { token: "malformed synthetic token" });
  await h.run();
  assert.equal(h.requests.length, 0);
  assert.equal(h.notifications().length, 5);
  assert.equal(h.writes.length, 10);
});

test("multiple devices are preserved, duplicate tokens send once and all invalid aliases are removed", async () => {
  const h = harness({ count: 1, respond: ({ messages }) => ({ ok: true, status: 200, json: async () => ({ data: messages.map((message) => message.to === tokenFor("member0") ? ticketError("DeviceNotRegistered") : { status: "ok", id: "accepted" }) }) }) });
  h.seedUser("member0", "member", ["device", "ios"]);
  h.documents.set("users/member0/pushTokens/alias", { token: tokenFor("member0") });
  await h.run();
  assert.equal(h.requests[0].length, 2);
  assert.equal(h.documents.has("users/member0/pushTokens/device"), false);
  assert.equal(h.documents.has("users/member0/pushTokens/alias"), false);
  assert.equal(h.documents.has("users/member0/pushTokens/ios"), true);
  assert.equal(h.notifications().length, 1);
});

test("an invalid old-token response cannot delete a replacement token or its registry", async () => {
  const replacement = "ExpoPushToken[synthetic-replacement]";
  const h = harness({ count: 1, respond: ({ h }) => {
    h.documents.set("users/member0/pushTokens/device", { token: replacement });
    h.documents.delete(registryPath(tokenFor("member0")));
    h.documents.set(registryPath(replacement), { uid: "member0", deviceId: "device" });
    return { ok: true, status: 200, json: async () => ({ data: [ticketError("DeviceNotRegistered")] }) };
  } });
  await h.run();
  assert.equal(h.documents.get("users/member0/pushTokens/device").token, replacement);
  assert.equal(h.documents.has(registryPath(replacement)), true);
  assert.equal(h.writes.length, 2);
});

test("invalid-token cleanup preserves a registry now owned by another account", async () => {
  const h = harness({ count: 1, respond: () => ({ ok: true, status: 200, json: async () => ({ data: [ticketError("DeviceNotRegistered")] }) }) });
  h.documents.set(registryPath(tokenFor("member0")), { uid: "another", deviceId: "anotherdevice" });
  await h.run();
  assert.equal(h.documents.has("users/member0/pushTokens/device"), false);
  assert.equal(h.documents.get(registryPath(tokenFor("member0"))).uid, "another");
});

test("cleanup failure cannot resend accepted pushes or suppress subsequent chunks", async () => {
  const h = harness({ count: 101, failCleanup: true, respond: ({ messages, index }) => index === 0
    ? { ok: true, status: 200, json: async () => ({ data: messages.map((_message, position) => position === 0 ? ticketError("DeviceNotRegistered") : { status: "ok", id: "accepted" }) }) }
    : accepted(messages) });
  await h.run();
  assert.equal(h.requests.length, 2);
  assert.equal(h.logs[0].reason, "token_cleanup_failed");
  assert.equal(h.notifications().length, 101);
});

test("a failed recipient preparation does not prevent sending to the other recipients", async () => {
  const h = harness({ count: 3, failPreparationUid: "member1" });
  await h.run();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].map((message) => message.to), [tokenFor("member0"), tokenFor("member2")]);
  assert.equal(h.notifications().length, 3);
  assert.equal(h.logs[0].count, 1);
});

test("sender/guardian exclusions and blocked actors retain the existing recipient rules", async () => {
  const h = harness({ count: 3 });
  h.documents.set("teams/team/members/member1", { role: "guardian" });
  // Team notice payloads previously omit actorUid, so their block behavior is
  // intentionally unchanged. Workspace payloads below do carry actorUid.
  await h.run();
  assert.deepEqual(h.requests[0].map((message) => message.to), [tokenFor("member0"), tokenFor("member2")]);
  assert.equal(h.documents.has("users/actor/notifications/notice_synthetic-event"), false);
  assert.equal(h.documents.has("users/member1/notifications/notice_synthetic-event"), false);
  const blocked = harness({ count: 2 });
  blocked.documents.set("users/member0", { blockedUserUids: ["actor"] });
  await blocked.run("post", "mention", {}, { authorUid: "actor", mentionedUids: ["member0", "member1", "actor", "outsider"], visibleToUids: ["member0", "member1", "outsider"], replies: [] });
  assert.deepEqual(blocked.requests[0].map((message) => message.to), [tokenFor("member1")]);
  assert.equal(blocked.notifications().length, 1);
});

test("simultaneous delivery of the same event creates and sends each notification once", async () => {
  const h = harness({ count: 30 });
  await Promise.all([h.run(), h.run()]);
  assert.equal(h.notifications().length, 30);
  assert.equal(h.requests.flat().length, 30);
  assert.equal(h.writes.length, 60);
});

for (const kind of ["notice", "schedule", "post", "diary", "join", "reminder"]) {
  test(`${kind} retains navigation, per-user badge, channel and notification ID`, async () => {
    const h = harness({ count: 2 });
    h.documents.set("teams/team/members/member0", { role: "admin" });
    h.documents.set("teams/team/members/member1", { role: "staff" });
    if (kind === "reminder") {
      h.documents.set("teams/team/clubEvents/schedule", { date: "2026-10-07", title: "Synthetic reminder" });
      await h.reminders();
    } else await h.run(kind);
    assert.equal(h.requests.length, 1);
    const expectedScreen = ["schedule", "reminder"].includes(kind) ? "Calendar" : kind === "notice" ? "NoticeBoard" : kind === "diary" ? "Diary" : kind === "join" ? "Roster" : "WorkspaceHome";
    for (const message of h.requests.flat()) {
      assert.equal(message.data.screen, expectedScreen);
      assert.equal(message.channelId, "smartbukatsu-notifications");
      assert.equal(message.sound, "default");
      assert.equal(message.badge, 1);
      const saved = h.notifications().find(([, notification]) => notification.id === message.data.notificationId);
      assert.ok(saved);
      assert.equal(message.title, saved[1].title);
      assert.equal(message.body, saved[1].body);
      assert.equal(message.data.targetParams, JSON.stringify(saved[1].target.params));
    }
  });
}
