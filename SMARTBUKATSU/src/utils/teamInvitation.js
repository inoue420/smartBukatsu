const INVITE_PAGE = "https://sharprise.jp/smartbukatsu/invite/";
const PENDING_KEY = "@smartbukatsu/pending-invitation/v1";
const REFERRER_KEY = "@smartbukatsu/install-invitation-checked/v1";

function normalizeInviteCode(value) {
  const code = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9]{6}$/.test(code) ? code : "";
}

function queryCode(query, key) {
  try {
    const values = query.split("&").map(part => {
      const index = part.indexOf("=");
      return [decodeURIComponent(index < 0 ? part : part.slice(0, index)),
        decodeURIComponent(index < 0 ? "" : part.slice(index + 1))];
    }).filter(([name]) => name === key);
    return values.length === 1 ? normalizeInviteCode(values[0][1]) : "";
  } catch {
    return "";
  }
}

function parseInvitationUrl(value, development = false) {
  if (typeof value !== "string" || value.length > 2048) return "";
  const match = value.match(/^(https:\/\/sharprise\.jp\/smartbukatsu\/invite\/?|smartbukatsu:\/\/invite\/?|smartbukatsu-dev:\/\/invite\/?)\?([^#]*)$/);
  if (!match || (!development && match[1].startsWith("smartbukatsu-dev:"))) return "";
  return queryCode(match[2], "code");
}

function parseInstallInvitation(value) {
  return typeof value === "string" && value.length <= 2048
    ? queryCode(value, "invite_code") : "";
}

function invitationMessage(teamName, input) {
  const code = normalizeInviteCode(input);
  if (!code) throw new Error("招待コードを読み込んでからお試しください。");
  const name = String(teamName || "チーム").replace(/[\r\n]/g, " ").trim();
  const link = `${INVITE_PAGE}?code=${code}`;
  return `${name}から、SMARTBUKATSUへの招待です。\n\n` +
    `① アプリをインストール\n${link}&step=download\n\n` +
    `② インストール後、このメッセージに戻って参加リンクを押してください\n${link}\n` +
    "招待コードが自動入力されます。\nすでにアプリをお使いの方は②から進めます。\n\n" +
    "初めての方は、新規登録・利用条件の確認・確認メールの手続きをお願いします。\n\n" +
    `自動入力されない場合の招待コード：${code}\n` +
    "リンクで開けない場合はアプリを最新版に更新してください。LINE内で開けない場合は、メニューから外部ブラウザで開いてください。";
}

// Kept independent of native modules so startup/storage races can be tested offline.
function createInvitationManager({ storage, getInitialURL, subscribeUrls, readReferrer,
  development = false, now = Date.now, nativeTimeout = 2500 }) {
  let snapshot = { pendingInvitation: null, invitationReady: false, storageError: false };
  let generation = 0, sequence = 0, started, stopUrls;
  let writes = Promise.resolve();
  const listeners = new Set();
  const publish = changes => {
    snapshot = { ...snapshot, ...changes };
    listeners.forEach(listener => listener(snapshot));
  };
  const persist = (key, value) => {
    writes = writes.then(() => value === null ? storage.removeItem(key) : storage.setItem(key, value))
      .catch(() => { publish({ storageError: true }); });
    return writes;
  };
  const accept = code => {
    generation += 1;
    const pendingInvitation = { code, id: `${now()}-${++sequence}`, receivedAt: now() };
    publish({ pendingInvitation });
    persist(PENDING_KEY, JSON.stringify(pendingInvitation));
  };
  const receiveUrl = url => {
    const code = parseInvitationUrl(url, development);
    if (code) accept(code);
    return Boolean(code);
  };
  const bounded = operation => {
    let timer;
    return Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Native invitation lookup timed out")), nativeTimeout);
    })]).finally(() => clearTimeout(timer));
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    receiveUrl,
    clearInvitation(expectedId) {
      if (!expectedId || snapshot.pendingInvitation?.id !== expectedId) return false;
      generation += 1;
      publish({ pendingInvitation: null });
      persist(PENDING_KEY, null);
      return true;
    },
    initialize() {
      if (started) return started;
      const initialGeneration = generation;
      stopUrls = subscribeUrls?.(receiveUrl);
      started = (async () => {
        let saved, checked;
        try {
          [saved, checked] = await Promise.all([storage.getItem(PENDING_KEY), storage.getItem(REFERRER_KEY)]);
          if (saved && generation === initialGeneration) {
            const pending = JSON.parse(saved);
            if (normalizeInviteCode(pending?.code) && typeof pending.id === "string") {
              publish({ pendingInvitation: pending });
            }
          }
        } catch { publish({ storageError: true }); }
        try {
          const url = await bounded(getInitialURL);
          if (generation === initialGeneration && url) receiveUrl(url);
        } catch { /* The explicit link can still be tapped again. */ }
        if (readReferrer && !checked) {
          try {
            const referrer = await bounded(readReferrer);
            // Consume once even if another invitation already has priority.
            persist(REFERRER_KEY, "1");
            const code = parseInstallInvitation(referrer);
            if (code && generation === initialGeneration && !snapshot.pendingInvitation) accept(code);
          } catch { /* Retry on the next app launch if the Play service was unavailable. */ }
        }
        publish({ invitationReady: true });
      })();
      return started;
    },
    flush: () => writes,
    dispose() { stopUrls?.(); listeners.clear(); },
  };
}

module.exports = { INVITE_PAGE, PENDING_KEY, REFERRER_KEY, normalizeInviteCode,
  parseInvitationUrl, parseInstallInvitation, invitationMessage, createInvitationManager };
