const PROHIBITED_PATTERNS = [
  {
    label: "生命・身体への脅迫表現",
    pattern:
      /(?:死ね|消えろ|ぶっ殺す|(?:殺|ころ)してやる|(?:お前|てめえ|貴様|あいつ|こいつ|そいつ|あなた|君|きみ)(?:を|は|が|に|、|\s)*(?:殺す|ころす|しね)|(?:殺す|ころす)(?:ぞ|からな|からね)|(?:^|[\s、。！？!?])しね(?:$|[\s、。！？!?]))/u,
  },
  {
    label: "性的な強要・搾取を示す表現",
    pattern: /(?:レイプ|強姦|裸(?:の)?(?:写真|画像)(?:を)?送れ)/u,
  },
];

const ATTACK_WARNING_PATTERNS = [
  /(?:バカ|馬鹿|アホ|クズ|きもい|気持ち悪い|役立たず)/u,
  /(?:殴る|蹴る|痛い目にあわせる|殺す|ころす|殺して|ころして)/u,
];

const PERSONAL_INFORMATION_PATTERNS = [
  {
    label: "メールアドレス",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  },
  {
    label: "電話番号",
    pattern: /(?:\+?81[-\s]?)?0\d{1,4}[-\sー‐–—]?\d{1,4}[-\sー‐–—]?\d{3,4}/u,
  },
  {
    label: "郵便番号",
    pattern: /〒?\s*\d{3}[-ー‐–—]\d{4}/u,
  },
  {
    label: "外部連絡先ID",
    pattern: /(?:LINE|ライン|SNS)\s*(?:ID|ＩＤ|id)?\s*[:：]\s*\S+/iu,
  },
];

const normalizeForInspection = (value) =>
  String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();

const LOCAL_FALLBACK_FUNCTION_ERROR_CODES = new Set([
  "functions/cancelled",
  "functions/deadline-exceeded",
  "functions/not-found",
  "functions/unavailable",
]);

export function inspectUserContent(value) {
  const normalized = normalizeForInspection(value);
  const blockedReasons = PROHIBITED_PATTERNS.filter(({ pattern }) =>
    pattern.test(normalized),
  ).map(({ label }) => label);
  const personalInformationWarnings = PERSONAL_INFORMATION_PATTERNS.filter(
    ({ pattern }) => pattern.test(normalized),
  ).map(({ label }) => label);
  const containsAttackWarning = ATTACK_WARNING_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const warnings = [
    ...(containsAttackWarning ? ["攻撃的と受け取られる可能性のある表現"] : []),
    ...personalInformationWarnings.map(
      (label) => `${label}などの個人情報である可能性`,
    ),
  ];

  return {
    normalized,
    blocked: blockedReasons.length > 0,
    blockedReasons,
    warnings,
  };
}

export function getBlockedContentMessage(result) {
  const reasons = result?.blockedReasons || [];
  return [
    "安全上の理由により、この内容は送信できません。",
    reasons.length > 0 ? `検出項目：${reasons.join("、")}` : "",
    "表現を見直すか、安全に関する相談は「運営への相談窓口」を利用してください。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function getContentWarningMessage(result) {
  const warnings = result?.warnings || [];
  return [
    "次の内容が含まれている可能性があります。",
    warnings.map((warning) => `・${warning}`).join("\n"),
    "チーム内で共有してよい内容か確認してください。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function shouldUseLocalModerationFallback(error) {
  return LOCAL_FALLBACK_FUNCTION_ERROR_CODES.has(String(error?.code || ""));
}
