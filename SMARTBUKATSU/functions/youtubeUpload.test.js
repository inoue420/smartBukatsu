const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createYoutubeUpload, oauthReturn, uploadMetadata } = require("./youtubeUpload");

function setup() {
  const settings = { key: crypto.randomBytes(32).toString("base64"), clientId: "test-client",
    clientSecret: "mock", redirectUri: "https://example.test/oauth" };
  const requests = [];
  let eligible = true;
  const googleState = { expired: false, channel: "channel" };
  const scopes = ["upload", "readonly"].map(s => "https://www.googleapis.com/auth/youtube." + s).join(" ");
  const http = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/token") && options.body.get("grant_type") === "refresh_token" && googleState.expired) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url.endsWith("/token")) return Response.json({ access_token: "access-test", refresh_token: "refresh-test",
      scope: scopes, expires_in: 3600 });
    if (url.includes("/channels?")) return Response.json({ items: [{ id: googleState.channel, snippet: { title: "Team" } }] });
    if (url.includes("/upload/")) return new Response(null, { headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?id=mock" } });
    if (url.endsWith("/revoke")) return new Response(null);
    if (url.includes("/videos?")) return Response.json({ items: [{ snippet: { channelId: "channel" }, processingDetails: { processingStatus: "succeeded" }, status: { privacyStatus: "private" } }] });
    throw new Error("unexpected request");
  };
  class Failure extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
  const handler = createYoutubeUpload({ access: async () => ({ allowed: eligible }), HttpsError: Failure, settings: () => settings, http });
  const call = (action, fields = {}, uid = "one", teamId = "team") => handler({ auth: { uid }, data: { expectedUid: uid, teamId, action, ...fields } });
  async function connect() {
    const start = await call("authorize", { scheme: "smartbukatsu-dev" });
    const result = await call("connect", { ...start, code: "mock-code" });
    return { start, ...result };
  }
  return { call, connect, requests, googleState, disable() { eligible = false; } };
}

const sample = { channelId: "channel", title: "試合", description: "", privacy: "unlisted", kids: false,
  accepted: true, size: 123, mime: "video/mp4" };

test("privacy, kids designation, explicit consent and limits are validated before insertion", () => {
  assert.equal(uploadMetadata(sample).status.privacyStatus, "unlisted");
  for (const override of [{ privacy: undefined }, { privacy: "public" }, { kids: null }, { accepted: false },
    { size: 1024 ** 3 + 1 }, { title: " " }, { title: "<bad>" }, { description: "あ".repeat(1667) }]) {
    assert.equal(uploadMetadata({ ...sample, ...override }), null);
  }
  assert.equal(uploadMetadata({ ...sample, privacy: "public", publicConfirmed: true, kids: true }).status.selfDeclaredMadeForKids, true);
});

test("code exchange binds PKCE, uid, team and state; device gets no readable refresh token", async () => {
  const f = setup();
  const { start, connection } = await f.connect();
  const params = new URL(start.url).searchParams;
  const verifier = f.requests[0].options.body.get("code_verifier");
  assert.equal(params.get("code_challenge"), crypto.createHash("sha256").update(verifier).digest("base64url"));
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.ok(!connection.includes("refresh-test"));
  for (const args of [["two", "team"], ["one", "foreign"]]) {
    await assert.rejects(f.call("connect", { ...start, code: "x" }, ...args), { code: "failed-precondition" });
  }
  await assert.rejects(f.call("connect", { ...start, state: "wrong", code: "x" }), { code: "failed-precondition" });
  assert.equal(f.requests.length, 2);
});

test("start only sends metadata; resume refreshes credentials, and status reports actual privacy", async () => {
  const f = setup();
  const { connection } = await f.connect();
  await assert.rejects(f.call("start", { ...sample, connection, channelId: "foreign" }), { code: "invalid-argument" });
  const { session } = await f.call("start", { ...sample, connection });
  const start = f.requests.find(req => req.url.includes("/upload/"));
  assert.equal(start.options.headers["X-Upload-Content-Length"], "123");
  assert.deepEqual(JSON.parse(start.options.body).status, { privacyStatus: "unlisted", selfDeclaredMadeForKids: false });
  const permit = await f.call("resume", { session, connection });
  assert.equal(permit.accessToken, "access-test");
  assert.match(permit.location, /^https:\/\/www\.googleapis\.com\//);
  assert.deepEqual(await f.call("status", { connection, videoId: "abcdefghijk" }), { phase: "succeeded", privacy: "private" });
  f.disable();
  await assert.rejects(f.call("resume", { session, connection }), { code: "permission-denied" });
  await assert.rejects(f.call("disconnect", { connection }, "two"), { code: "failed-precondition" });
  assert.deepEqual(await f.call("disconnect", { connection }), { revoked: true });
});

test("expired consent can resume the same session only for its original channel after reauthorization", async () => {
  const f = setup();
  const first = await f.connect();
  const { session } = await f.call("start", { ...sample, connection: first.connection });
  f.googleState.expired = true;
  await assert.rejects(f.call("resume", { session, connection: first.connection }),
    error => error.code === "failed-precondition" && error.details?.reconnect === true);
  f.googleState.expired = false;
  f.googleState.channel = "other-channel";
  const other = await f.connect();
  await assert.rejects(f.call("resume", { session, connection: other.connection }), { code: "failed-precondition" });
  f.googleState.channel = "channel";
  const renewed = await f.connect();
  assert.ok((await f.call("resume", { session, connection: renewed.connection })).location);
  assert.equal(f.requests.filter(req => req.url.includes("/upload/")).length, 1);
});

test("callback restricts return schemes and rejects ambiguous, malformed requests", () => {
  const state = "p." + "a".repeat(43);
  const res = { set() {}, redirect(status, url) { return { status, url }; }, status(status) { return { send: () => status }; } };
  const result = oauthReturn({ method: "GET", query: { state, code: "a&b", redirect: "untrusted" } }, res);
  assert.equal(new URL(result.url).protocol, "smartbukatsu:");
  assert.equal(new URL(result.url).searchParams.get("code"), "a&b");
  assert.equal(oauthReturn({ method: "GET", query: { state: [state], code: "x" } }, res), 400);
});
