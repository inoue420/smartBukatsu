const KNOWN_ERROR_CODES = new Set([
  "invalid-request", "no-fill", "network-error", "internal-error",
  "server-error", "timeout", "os-version-too-low", "mediation-data-error",
  "mediation-adapter-error", "mediation-no-fill", "invalid-argument",
  "received-invalid-response", "consent-update-failed", "consent-form-error",
  "mediation-invalid-ad-size", "received-invalid-ad-string", "ad-already-used",
  "application-identifier-missing",
]);

export const getAdErrorCode = (error) => {
  const code = String(error?.code || "").split("/").pop();
  return KNOWN_ERROR_CODES.has(code) ? code : "unknown";
};

// Only fixed events and known error codes enter the shareable report.
const EVENTS = {
  "missing-id": { label: "広告ユニットID未設定", sdk: "設定不足" },
  "consent-start": { label: "同意確認を開始", consent: "確認中" },
  "consent-allowed": { label: "広告リクエスト可能", consent: "リクエスト可能" },
  "consent-blocked": { label: "広告リクエスト不可", consent: "リクエスト不可" },
  "consent-error": { label: "同意更新に失敗・保存済み状態を確認", consent: "更新失敗" },
  "consent-cache-error": { label: "保存済み同意状態の取得に失敗", consent: "取得失敗" },
  "sdk-start": { label: "広告の初期化を開始", sdk: "初期化中" },
  "sdk-ready": { label: "広告の初期化が完了", sdk: "初期化完了", retry: "不要" },
  "sdk-error": { label: "広告の初期化に失敗", sdk: "初期化失敗" },
  "retry-scheduled": { label: "初期化の再試行を予約", retry: "待機中" },
  "initialization-attempt": { label: "初期化の初回・自動再試行を開始" },
  "recovery-attempt": { label: "復帰をきっかけとした再試行を開始" },
  "recovery-scheduled": { label: "復帰後の再試行を予約", retry: "復帰再試行待ち" },
  "retry-exhausted": { label: "初期の自動再試行が上限に到達・復帰待ち", retry: "復帰待ち" },
  "retry-permanent": { label: "設定・SDKの修正待ち", retry: "自動再試行対象外" },
  "retry-consent": { label: "広告要求不可・前面復帰時の同意確認待ち", retry: "同意確認待ち" },
  "banner-loading": { label: "バナーの読み込みを開始", banner: "読み込み中" },
  "banner-loaded": { label: "バナーの読み込みが成功", banner: "読み込み成功" },
  "banner-error": { label: "バナーの読み込みに失敗", banner: "読み込み失敗" },
  "banner-keyboard-hidden": { label: "キーボード表示によりバナーを非表示", bannerHidden: true },
  "banner-keyboard-restored": { label: "バナーの表示を許可", bannerHidden: false },
};

export const createAdDiagnostics = (testAds, bannerConfigured) => ({
  testAds: Boolean(testAds),
  bannerConfigured: Boolean(bannerConfigured),
  consent: "未確認",
  sdk: "未初期化",
  banner: "待機中",
  bannerHidden: false,
  retry: "なし",
  attempts: 0,
  initialAttempts: 0,
  recoveryAttempts: 0,
  events: [],
});

export const recordAdDiagnostic = (previous, event, error) => {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, event)) return previous;
  const { label, ...status } = EVENTS[event];
  return {
    ...previous,
    ...status,
    attempts: previous.attempts + (["initialization-attempt", "recovery-attempt"].includes(event) ? 1 : 0),
    initialAttempts: (previous.initialAttempts || 0) + (event === "initialization-attempt" ? 1 : 0),
    recoveryAttempts: (previous.recoveryAttempts || 0) + (event === "recovery-attempt" ? 1 : 0),
    events: [
      ...previous.events,
      {
        time: new Date().toISOString(),
        label,
        code: error === undefined ? null : getAdErrorCode(error),
      },
    ].slice(-40),
  };
};

export const formatAdDiagnostics = (diagnostics, { platform, version, build }) => {
  if (!diagnostics) return "広告の診断情報はありません。";
  return [
    "SMARTBUKATSU 広告診断",
    `アプリ: ${version || "不明"} / ビルド: ${build || "不明"}`,
    `OS: ${platform}`,
    `広告モード: ${diagnostics.testAds ? "テスト" : "本番"}`,
    `バナーID: ${diagnostics.bannerConfigured ? "設定あり" : "未設定"}`,
    `同意確認: ${diagnostics.consent}`,
    `広告初期化: ${diagnostics.sdk}`,
    `初期の自動試行: ${diagnostics.initialAttempts || 0}回 / 最大3回`,
    `復帰をきっかけとした再試行: ${diagnostics.recoveryAttempts || 0}回`,
    `再試行: ${diagnostics.retry}`,
    `バナー: ${diagnostics.banner}${diagnostics.bannerHidden ? "（キーボード表示中・非表示）" : ""}`,
    "",
    "起動後の履歴（最新40件・時刻はUTC）",
    ...diagnostics.events.map(({ time, label, code }) =>
      `${time} ${label}${code ? ` [${code}]` : ""}`,
    ),
  ].join("\n");
};
