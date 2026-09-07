export const BIAS_CORRECTED_DATA_MODE = "bias-corrected";
export const RAW_MODEL_GRID_DATA_MODE = "raw-model-grid";

export const CTWEBUI_V3_PUBLIC_CAPABILITIES = Object.freeze({
  coverage: "public",
  missingReason: "not-exposed",
  qualityStatus: "not-exposed"
});

export function resolvePublicQueryMetricDisplay(metric, dataMode) {
  requireDataMode(dataMode);
  if (!isRecord(metric)) throw new TypeError("공개 기후 지표의 표시 형식이 올바르지 않습니다.");

  const rawGrid = dataMode === RAW_MODEL_GRID_DATA_MODE;
  return {
    primaryKind: rawGrid ? "raw" : "corrected",
    primaryLabel: rawGrid ? "기후 모델 원자료" : "보정 후",
    primaryValue: metric.value,
    primaryNumericValue: metric.numericValue,
    comparisonLabel: rawGrid ? "" : "보정 전",
    comparisonValue: rawGrid ? undefined : metric.rawValue,
    comparisonNumericValue: rawGrid ? undefined : metric.rawNumericValue,
    available: metric.available === true
  };
}

export function resolvePublicSeriesMetricDisplay(metric, dataMode) {
  requireDataMode(dataMode);
  if (!isRecord(metric)) {
    throw new TypeError("공개 기간 지표의 표시 형식이 올바르지 않습니다.");
  }

  const rawGrid = dataMode === RAW_MODEL_GRID_DATA_MODE;
  const primary = rawGrid ? metric.raw ?? metric.corrected : metric.corrected;
  if (!isSeriesGroup(primary)) {
    throw new TypeError("공개 기간 지표의 주계열 형식이 올바르지 않습니다.");
  }
  const comparison = rawGrid ? undefined : metric.raw;
  if (comparison !== undefined && !isSeriesGroup(comparison)) {
    throw new TypeError("공개 기간 지표의 보정 전 값 형식이 올바르지 않습니다.");
  }

  return {
    primaryKind: rawGrid ? "raw" : "corrected",
    primaryLabel: rawGrid ? "기후 모델 원자료" : "보정 후",
    primary,
    comparisonLabel: comparison ? "보정 전" : "",
    comparison
  };
}

export function publicCoverageLabel(coverage) {
  if (coverage === "available") return "전체 자료";
  if (coverage === "fallback") return "일부 또는 대체 자료";
  if (coverage === "missing") return "자료 없음";
  throw new TypeError("공개 기후 자료의 coverage 형식이 올바르지 않습니다.");
}

export function validatePublicQueryDisplayShape(response) {
  if (!isRecord(response) || !Array.isArray(response.values) || response.values.length === 0) {
    throw new TypeError("공개 단일 날짜 자료의 표시 형식이 올바르지 않습니다.");
  }
  publicCoverageLabel(response.coverage);
  let availableValueCount = 0;
  for (const metric of response.values) {
    const display = resolvePublicQueryMetricDisplay(metric, response.dataMode);
    if (display.available !== Number.isFinite(display.primaryNumericValue)) {
      throw new TypeError("공개 단일 날짜 자료의 가용 상태와 주값이 일치하지 않습니다.");
    }
    if (display.available) availableValueCount += 1;
    if (display.primaryKind === "raw"
      && (metric.rawValue !== undefined || metric.rawNumericValue !== undefined)) {
      throw new TypeError("기후 모델 원자료 결과에 보정 전 비교값을 함께 표시할 수 없습니다.");
    }
  }
  if ((response.coverage === "missing") !== (availableValueCount === 0)) {
    throw new TypeError("공개 단일 날짜 자료의 coverage와 가용 값이 일치하지 않습니다.");
  }
  return response;
}

export function validatePublicSeriesDisplayShape(response) {
  if (!isRecord(response)
    || !Array.isArray(response.dates)
    || response.dates.length === 0
    || !Array.isArray(response.metrics)
    || response.metrics.length === 0
    || typeof response.includeRaw !== "boolean") {
    throw new TypeError("공개 기간 자료의 표시 형식이 올바르지 않습니다.");
  }
  publicCoverageLabel(response.coverage);

  const rawGrid = response.dataMode === RAW_MODEL_GRID_DATA_MODE;
  if (rawGrid && response.includeRaw) {
    throw new TypeError("기후 모델 원자료 결과에 보정 전 비교 계열을 요청할 수 없습니다.");
  }
  let availablePointCount = 0;
  for (const metric of response.metrics) {
    const display = resolvePublicSeriesMetricDisplay(metric, response.dataMode);
    const length = response.dates.length;
    if (!isSeriesGroupOfLength(display.primary, length)
      || (display.comparison !== undefined && !isSeriesGroupOfLength(display.comparison, length))
      || !Array.isArray(metric.coverage)
      || metric.coverage.length !== length
      || !metric.coverage.every((value) => typeof value === "boolean")
      || !Array.isArray(metric.modelCounts)
      || metric.modelCounts.length !== length
      || !metric.modelCounts.every((value) => Number.isInteger(value) && value >= 0)
      || !Number.isInteger(metric.availableCount)
      || metric.availableCount !== metric.coverage.filter(Boolean).length) {
      throw new TypeError("공개 기간 자료의 배열 길이 또는 coverage가 올바르지 않습니다.");
    }
    if (!metric.coverage.every((available, index) => (
      available
        ? isFiniteSeriesPoint(display.primary, index) && metric.modelCounts[index] > 0
        : isNullSeriesPoint(display.primary, index) && metric.modelCounts[index] === 0
    ))) {
      throw new TypeError("공개 기간 자료의 coverage와 주계열 값이 일치하지 않습니다.");
    }
    if (display.comparison !== undefined
      && !response.dates.every((_, index) => (
        isFiniteSeriesPoint(display.comparison, index) || isNullSeriesPoint(display.comparison, index)
      ))) {
      throw new TypeError("공개 기간 자료의 비교 계열 값이 올바르지 않습니다.");
    }
    availablePointCount += metric.availableCount;
    if (!rawGrid && response.includeRaw !== Boolean(metric.raw)) {
      throw new TypeError("보정 전 비교 계열과 includeRaw가 일치하지 않습니다.");
    }
  }
  if ((response.coverage === "missing") !== (availablePointCount === 0)) {
    throw new TypeError("공개 기간 자료의 coverage와 가용 값이 일치하지 않습니다.");
  }
  return response;
}

function requireDataMode(value) {
  if (value !== BIAS_CORRECTED_DATA_MODE && value !== RAW_MODEL_GRID_DATA_MODE) {
    throw new TypeError("공개 기후 자료의 dataMode 형식이 올바르지 않습니다.");
  }
  return value;
}

function isSeriesGroup(value) {
  return isRecord(value)
    && ["p10", "p50", "p90"].every((key) => Array.isArray(value[key]));
}

function isSeriesGroupOfLength(value, length) {
  return isSeriesGroup(value)
    && ["p10", "p50", "p90"].every((key) => (
      value[key].length === length
      && value[key].every((item) => item === null || Number.isFinite(item))
    ));
}

function isFiniteSeriesPoint(group, index) {
  return ["p10", "p50", "p90"].every((key) => Number.isFinite(group[key][index]));
}

function isNullSeriesPoint(group, index) {
  return ["p10", "p50", "p90"].every((key) => group[key][index] === null);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
