export const MEDICAL_SCALE_MIN = 1;
export const MEDICAL_SCALE_MAX = 5;
export const MEDICAL_SCALE_DEFAULT = 3;
export const MEDICAL_SCALE_VERSION = 2;

export const MEDICAL_SCALE_VALUES = [1, 2, 3, 4, 5];

export const DEFAULT_ALERT_THRESHOLDS = {
  fatigueWarning: 4,
  fatigueDanger: 5,
  painDanger: 5,
  autoEscalate: true,
};

export const normalizeMedicalScaleValue = (value, scaleVersion) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return MEDICAL_SCALE_DEFAULT;

  const normalizedValue =
    Number(scaleVersion) === MEDICAL_SCALE_VERSION
      ? Math.round(numericValue)
      : Math.ceil(numericValue / 2);

  return Math.min(
    MEDICAL_SCALE_MAX,
    Math.max(MEDICAL_SCALE_MIN, normalizedValue),
  );
};

export const getFatigueScore = (record) =>
  normalizeMedicalScaleValue(record?.fatigue, record?.medicalScaleVersion);

export const getPainScore = (record) =>
  normalizeMedicalScaleValue(
    record?.painDetails?.level,
    record?.medicalScaleVersion,
  );
