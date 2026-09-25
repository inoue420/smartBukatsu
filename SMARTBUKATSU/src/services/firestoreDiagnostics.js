// Fixed names only: never store references, document IDs, payloads, or errors.
const SUBSCRIPTION_NAMES = new Set([
  "projects", "highlightProjects", "dailyReports", "notices", "workspacePosts",
  "personalEvents", "clubEvents", "tagGroups", "teamData", "teamMembers",
  "authUser", "authMembership", "notifications", "notificationSummary",
  "notificationPreferences", "workspaceTeam",
]);
const MAX_LIFECYCLE_EVENTS = 60;

const createCounts = () => ({
  snapshots: 0, initialSnapshots: 0, initialDocuments: 0,
  added: 0, modified: 0, removed: 0,
});

function createFirestoreDiagnostics({ enabled = false, now = Date.now } = {}) {
  const startedAt = enabled ? now() : null;
  const subscriptions = new Map();
  const events = [];
  let nextId = 0;
  let measurementErrors = 0;

  function start(name) {
    if (!enabled || !SUBSCRIPTION_NAMES.has(name)) return null;
    if (!subscriptions.has(name)) {
      subscriptions.set(name, {
        name, starts: 0, stops: 0, active: 0, errors: 0,
        firstServerSnapshots: 0, firstServerDocuments: 0,
        pendingWriteSnapshots: 0, cache: createCounts(), server: createCounts(),
      });
    }
    const totals = subscriptions.get(name);
    const id = ++nextId;
    let ended = false;
    let initial = true;
    let serverSeen = false;
    let previousExists = false;

    function recordEvent(event) {
      events.push({ time: now(), name, id, event });
      if (events.length > MAX_LIFECYCLE_EVENTS) events.shift();
    }

    totals.starts += 1;
    totals.active += 1;
    recordEvent("start");

    return {
      snapshot(snapshot) {
        if (ended) return;
        // Read only SDK metadata and counts. Do not call data() or keep snapshots.
        const isQuery = typeof snapshot.docChanges === "function";
        const exists = isQuery ? false : snapshot.exists();
        const size = isQuery ? snapshot.size : Number(exists);
        const fromCache = snapshot.metadata.fromCache;
        const counts = fromCache ? totals.cache : totals.server;
        const changes = { added: 0, modified: 0, removed: 0 };
        if (!initial) {
          if (isQuery) {
            for (const change of snapshot.docChanges()) {
              if (Object.prototype.hasOwnProperty.call(changes, change.type)) {
                changes[change.type] += 1;
              }
            }
          } else if (exists) {
            changes[previousExists ? "modified" : "added"] = 1;
          } else if (previousExists) {
            changes.removed = 1;
          }
        }

        counts.snapshots += 1;
        if (initial) {
          counts.initialSnapshots += 1;
          counts.initialDocuments += size;
        }
        counts.added += changes.added;
        counts.modified += changes.modified;
        counts.removed += changes.removed;
        if (!fromCache && !serverSeen) {
          totals.firstServerSnapshots += 1;
          totals.firstServerDocuments += size;
          serverSeen = true;
        }
        if (snapshot.metadata.hasPendingWrites) totals.pendingWriteSnapshots += 1;
        previousExists = exists;
        initial = false;
      },
      stop(failed = false) {
        if (ended) return;
        ended = true;
        totals.stops += 1;
        totals.active -= 1;
        if (failed) totals.errors += 1;
        recordEvent(failed ? "error" : "stop");
      },
    };
  }

  return {
    enabled,
    start,
    recordMeasurementError() { measurementErrors += 1; },
    getReport() {
      return {
        enabled, startedAt, capturedAt: enabled ? now() : null, measurementErrors,
        subscriptions: [...subscriptions.values()].map((entry) => ({
          ...entry, cache: { ...entry.cache }, server: { ...entry.server },
        })),
        events: events.map((event) => ({ ...event })),
      };
    },
  };
}

// Injection keeps accounting testable without connecting to Firebase.
function createMeasuredOnSnapshot(onSnapshot, diagnostics) {
  return (name, reference, onNext, onError) => {
    if (!diagnostics.enabled) return onSnapshot(reference, onNext, onError);

    function measure(operation) {
      try { return operation(); } catch {
        diagnostics.recordMeasurementError();
        return null;
      }
    }

    const listener = measure(() => diagnostics.start(name));
    if (!listener) return onSnapshot(reference, onNext, onError);
    let unsubscribe;
    try {
      unsubscribe = onSnapshot(
        reference,
        (snapshot) => {
          measure(() => listener.snapshot(snapshot));
          return onNext(snapshot);
        },
        // Preserve Firebase's default error handling when none was supplied.
        typeof onError === "function" ? (error) => {
          measure(() => listener.stop(true));
          return onError(error);
        } : onError,
      );
    } catch (error) {
      measure(() => listener.stop(true));
      throw error;
    }
    return () => {
      try { return unsubscribe(); } finally {
        measure(() => listener.stop());
      }
    };
  };
}

function formatFirestoreDiagnostics(report) {
  if (!report.enabled) return "Firestore購読計測は開発時のみ利用できます。";
  const lines = [
    "SMARTBUKATSU Firestore購読計測（開発用）",
    `計測開始: ${new Date(report.startedAt).toISOString()}`,
    `取得時刻: ${new Date(report.capturedAt).toISOString()}`,
    "端末メモリ内・起動後の累計（再起動でリセット）",
    "文書数は課金読取り数ではありません。単発のgetDoc/getDocsは対象外です。",
    "初回文書数は各購読の最初の通知。差分は2回目以降の通知です。",
    "サーバー初観測は別指標です。初回・差分と足し合わせないでください。",
    "キャッシュ→サーバーだけのメタデータ通知は追加していません。未観測は0です。",
    "書込み未確定の通知を含みます。端末内更新・削除も課金数とは一致しません。",
    "単一文書の変更数は通知回数です。メタデータ由来の通知も含む場合があります。",
    "エラーハンドラのない購読はエラー終了を数えず、解除時まで継続中として扱います。",
    `計測処理の失敗: ${report.measurementErrors}`,
  ];
  for (const entry of report.subscriptions) {
    lines.push(
      "", `[${entry.name}]`,
      `開始 ${entry.starts} / 終了 ${entry.stops} / 継続中 ${entry.active} / エラー終了 ${entry.errors}`,
    );
    for (const [key, label] of [["cache", "キャッシュ"], ["server", "サーバー"]]) {
      const counts = entry[key];
      lines.push(`${label}: 通知 ${counts.snapshots} / 初回 ${counts.initialSnapshots}回・${counts.initialDocuments}文書 / 以後 追加 ${counts.added}・変更 ${counts.modified}・削除 ${counts.removed}`);
    }
    lines.push(
      `サーバー初観測: ${entry.firstServerSnapshots}回・${entry.firstServerDocuments}文書（別指標）`,
      `書込み未確定を含む通知: ${entry.pendingWriteSnapshots}`,
    );
  }
  lines.push("", `開始・終了履歴（最新${MAX_LIFECYCLE_EVENTS}件・時刻はUTC）`);
  for (const event of report.events) {
    lines.push(`${new Date(event.time).toISOString()} #${event.id} ${event.name} ${event.event}`);
  }
  return lines.join("\n");
}

module.exports = {
  createFirestoreDiagnostics, createMeasuredOnSnapshot, formatFirestoreDiagnostics,
};
