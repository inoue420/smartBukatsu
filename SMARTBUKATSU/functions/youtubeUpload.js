const crypto = require("node:crypto");

const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const YOUTUBE = "https://www.googleapis.com/youtube/v3/";
const SCOPES = ["youtube.upload", "youtube.readonly"].map(name => "https://www.googleapis.com/auth/" + name);
const SCHEMES = new Set(["smartbukatsu", "smartbukatsu-dev"]);
const MAX_BYTES = 1024 ** 3;

function uploadMetadata(input) {
  if (!input || typeof input.title !== "string" || !input.title.trim() ||
      [...input.title.trim()].length > 100 || typeof input.description !== "string" ||
      Buffer.byteLength(input.description) > 5000 || /[<>]/.test(input.title + input.description) ||
      !["unlisted", "private", "public"].includes(input.privacy) ||
      typeof input.kids !== "boolean" || input.accepted !== true ||
      (input.privacy === "public" && input.publicConfirmed !== true) ||
      !Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_BYTES ||
      !/^video\/[a-z0-9.+-]{1,64}$/i.test(input.mime || "")) return null;
  return {
    snippet: { title: input.title.trim(), description: input.description, categoryId: "17" },
    status: { privacyStatus: input.privacy, selfDeclaredMadeForKids: input.kids },
  };
}

// Envelopes kept on the device contain no readable Google credentials.
// Additional authenticated data prevents use by another uid/team or for another purpose.
function vault(key, context) {
  const aad = Buffer.from(JSON.stringify(context));
  return {
    seal(data) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad);
      const body = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    open(value) {
      if (typeof value !== "string" || value.length > 24000) throw new Error("invalid envelope");
      const raw = Buffer.from(value, "base64url");
      const cipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
      cipher.setAAD(aad);
      cipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString());
    },
  };
}

function oauthReturn(req, res) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  const { state, error, code } = req.query;
  if (req.method !== "GET" || typeof state !== "string" || !/^[dp]\.[a-zA-Z0-9_-]{43}$/.test(state) ||
      (!error && (typeof code !== "string" || !code || code.length > 4096))) {
    return res.status(400).send("連携を確認できません。アプリからやり直してください。");
  }
  const scheme = state.startsWith("d.") ? "smartbukatsu-dev" : "smartbukatsu";
  const params = new URLSearchParams(error ? { state, error: "denied" } : { state, code });
  return res.redirect(302, scheme + "://youtube-oauth?" + params);
}

function createYoutubeUpload({ access, HttpsError, settings, http = fetch }) {
  const fail = (code, message) => { throw new HttpsError(code, message); };
  async function google(url, options) {
    let response;
    try {
      response = await http(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) });
    } catch {
      fail("unavailable", "Googleと通信できません。通信環境を確認してください。");
    }
    if (response.ok) return response;
    const details = await response.json().catch(() => ({}));
    if (details.error === "invalid_grant" || response.status === 401) {
      throw new HttpsError("failed-precondition", "Google連携の有効期限が切れました。再連携してください。", { reconnect: true });
    }
    if (response.status === 429 || /quota|limit/i.test(details.error?.errors?.[0]?.reason || "")) {
      fail("resource-exhausted", "YouTubeの利用上限に達しました。時間をおいて再開してください。");
    }
    fail(response.status >= 500 ? "unavailable" : "failed-precondition", "Googleが操作を受け付けませんでした。連携やチャンネルの状態を確認してください。");
  }
  return async function youtubeUpload(request) {
    const data = request.data || {};
    const uid = request.auth?.uid;
    const { teamId, action } = data;
    if (!uid || data.expectedUid !== uid || typeof teamId !== "string" || !teamId || teamId.includes("/")) {
      fail("unauthenticated", "ログイン状態を確認してください。");
    }
    // The owner can revoke even after leaving the team.
    if (action !== "disconnect" && !(await access(request)).allowed) {
      fail("permission-denied", "このチームでの投稿権限がありません。");
    }
    const { clientId, clientSecret, redirectUri, key } = settings();
    const encryptionKey = Buffer.from(key || "", "base64");
    if (!clientId || !clientSecret || !/^https:\/\//.test(redirectUri) || encryptionKey.length !== 32) {
      fail("failed-precondition", "YouTube連携の運営設定が必要です。");
    }
    const box = purpose => vault(encryptionKey, [purpose, uid, teamId]);
    function unpack(purpose, value) {
      try { return box(purpose).open(value); }
      catch { fail("failed-precondition", "連携情報を確認できません。利用者とチームを確認してください。"); }
    }
    const token = async fields => (await google(GOOGLE_TOKEN, {
      method: "POST", body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...fields }),
    })).json();
    const bearer = value => ({ Authorization: "Bearer " + value });
    if (action === "authorize") {
      if (!SCHEMES.has(data.scheme)) fail("invalid-argument", "アプリの戻り先が不正です。");
      const state = (data.scheme.endsWith("-dev") ? "d." : "p.") + crypto.randomBytes(32).toString("base64url");
      const verifier = crypto.randomBytes(32).toString("base64url");
      const params = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "),
        access_type: "offline", prompt: "consent select_account", state, code_challenge_method: "S256",
        code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
      });
      return { state, flow: box("flow").seal({ verifier, state, until: Date.now() + 600000 }),
        url: "https://accounts.google.com/o/oauth2/v2/auth?" + params };
    }
    if (action === "connect") {
      const flow = unpack("flow", data.flow);
      if (Date.now() >= flow.until || data.state !== flow.state || typeof data.code !== "string" || !data.code) {
        fail("failed-precondition", "連携操作が失効しました。もう一度連携してください。");
      }
      const grant = await token({ code: data.code, code_verifier: flow.verifier, redirect_uri: redirectUri, grant_type: "authorization_code" });
      if (!grant.refresh_token || !SCOPES.every(scope => (grant.scope || "").split(" ").includes(scope))) {
        fail("failed-precondition", "投稿とチャンネル確認の両方の権限を許可してください。");
      }
      const result = await (await google(YOUTUBE + "channels?part=snippet&mine=true", { headers: bearer(grant.access_token) })).json();
      const channel = result.items?.[0];
      if (!channel?.id || result.items.length !== 1) fail("failed-precondition", "投稿するYouTubeチャンネルを1件選択してください。");
      if (data.requiredChannelId && data.requiredChannelId !== channel.id) {
        fail("failed-precondition", "再開する動画を投稿した元のチャンネルを選んでください。");
      }
      return { channelId: channel.id, title: channel.snippet.title,
        connection: box("connection").seal({ refresh: grant.refresh_token, channelId: channel.id }) };
    }
    const connection = unpack("connection", data.connection);
    if (action === "disconnect") {
      const response = await http("https://oauth2.googleapis.com/revoke", {
        method: "POST", body: new URLSearchParams({ token: connection.refresh }), signal: AbortSignal.timeout(20000),
      }).catch(() => null);
      if (!response?.ok) {
        const body = await response?.json().catch(() => ({}));
        if (body?.error !== "invalid_token") fail("unavailable", "Googleの連携解除を確認できません。再試行してください。");
      }
      return { revoked: true };
    }
    const metadata = action === "start" && uploadMetadata(data);
    if (action === "start" && (!metadata || data.channelId !== connection.channelId)) {
      fail("invalid-argument", "チャンネル・動画情報・公開設定・同意を確認してください。");
    }
    if (!["start", "resume", "status", "channel"].includes(action)) fail("invalid-argument", "操作が不正です。");
    const grant = await token({ refresh_token: connection.refresh, grant_type: "refresh_token" });
    const headers = bearer(grant.access_token);
    if (action === "channel") {
      const channels = await (await google(YOUTUBE + "channels?part=snippet&mine=true", { headers })).json();
      const channel = channels.items?.find(item => item.id === connection.channelId);
      if (!channel) fail("failed-precondition", "チャンネルを確認できません。再連携してください。");
      return { channelId: channel.id, title: channel.snippet.title };
    }
    if (action === "status") {
      if (!/^[\w-]{11}$/.test(data.videoId || "")) fail("invalid-argument", "動画IDが不正です。");
      const result = await (await google(YOUTUBE + "videos?part=snippet,status,processingDetails&id=" + data.videoId, { headers })).json();
      const video = result.items?.[0];
      if (!video || video.snippet?.channelId !== connection.channelId) return { phase: "unavailable" };
      return { phase: video.processingDetails?.processingStatus || video.status?.uploadStatus || "unknown",
        privacy: video.status?.privacyStatus || null };
    }
    if (action === "start") {
      const response = await google("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false", {
        method: "POST", headers: { ...headers, "Content-Type": "application/json",
          "X-Upload-Content-Type": data.mime, "X-Upload-Content-Length": String(data.size) }, body: JSON.stringify(metadata),
      });
      const location = response.headers.get("location");
      if (!location || !/^https:\/\/(?:www|upload|youtube)\.googleapis\.com\//.test(location)) fail("unavailable", "再開情報を取得できません。");
      return { session: box("session").seal({ location, channelId: connection.channelId }) };
    }
    const session = unpack("session", data.session);
    if (session.channelId !== connection.channelId) fail("failed-precondition", "元の投稿チャンネルで再連携してください。");
    return { location: session.location, accessToken: grant.access_token, expiresIn: grant.expires_in };
  };
}

module.exports = { createYoutubeUpload, oauthReturn, uploadMetadata, vault };
