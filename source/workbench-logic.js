import { PUBLIC_CLIMATE_ATTRIBUTION_LABELS } from "./runtime-policy.js";

const lessonStateVersion = 2;
const maximumNoteLength = 2000;
const publicAttributionLabelSet = new Set(PUBLIC_CLIMATE_ATTRIBUTION_LABELS);
const publicExportDataModes = new Set(["bias-corrected", "raw-model-grid"]);
const attributionDocumentName = "LICENSES_AND_ATTRIBUTION.md";
const kmaAsosUseByDataMode = Object.freeze({
  "bias-corrected": "used_for_bias_correction",
  "raw-model-grid": "not_used_raw_model_grid"
});
const kmaAsosNoticeByDataMode = Object.freeze({
  "bias-corrected": "대한민국 기상청 ASOS 보정 사용",
  "raw-model-grid": "대한민국 기상청 ASOS 보정 미사용"
});
const kmaAsosSourceUrl = "https://www.data.go.kr/data/15057210/openapi.do";
const kmaMarkArchivePaths = Object.freeze([
  "licenses/kma_mark_1.png",
  "licenses/kma_mark_2.png"
]);
const pngSignature = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const privateLocatorPatterns = [
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u,
  /\b(?:gs|gcs|s3|az|file):\/\//iu,
  /\bhttps?:\/\//iu,
  /\b(?:drive\.google\.com|storage\.googleapis\.com|googleapis\.com)\b/iu,
  /(?:^|[^a-z0-9])(?:[a-z]:[\\/]|\\\\[^\\\s]+[\\/])/iu,
  /\/(?:home|users|mnt|tmp|var|srv|opt|data)\//iu,
  /\.(?:ctwebui|ctcapsule|zarr|parquet)(?:\b|[\\/])/iu,
  /\b(?:file|folder|bucket|project)[_-]?id\b/iu,
  /(?:버킷|공유\s*링크|파일\s*식별자|내부\s*경로|비밀값|토큰|액세스\s*키)/u
];

export function isPublicGatewayTextSafe(value) {
  const text = String(value ?? "");
  return privateLocatorPatterns.every((pattern) => !pattern.test(text));
}

export function normalizePublicAttributionLabels(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((label) => safeText(label, 120))
    .filter((label) => publicAttributionLabelSet.has(label));
}

export function isPublicClimateTextPayloadSafe(value) {
  if (!value
    || typeof value !== "object"
    || value.attributionReady !== true
    || !Array.isArray(value.metrics)
    || !Array.isArray(value.attributionLabels)) {
    return false;
  }
  const normalizedAttributions = normalizePublicAttributionLabels(value.attributionLabels);
  if (normalizedAttributions.length === 0 || normalizedAttributions.length !== value.attributionLabels.length) return false;
  const visibleText = [
    value.scenario,
    value.model,
    value.coverage,
    value.fallbackReason,
    ...normalizedAttributions,
    ...value.metrics.flatMap((metric) => [
      metric?.key,
      metric?.label,
      metric?.unit,
      metric?.caption,
      metric?.derivationNote,
      metric?.missingReason
    ]),
    value.exploration?.title,
    value.exploration?.question,
    value.exploration?.interpretationLimit
  ];
  return visibleText.every(isPublicGatewayTextSafe);
}

export function parseHashLocation(hash) {
  const normalized = String(hash ?? "").replace(/^#/, "");
  const [pathPart = "/query", queryPart = ""] = normalized.split("?", 2);
  return {
    path: pathPart.startsWith("/") ? pathPart : `/${pathPart}`,
    params: new URLSearchParams(queryPart)
  };
}

export function encodeLessonState(value) {
  const source = value.source === "public" ? "public" : "teacher";
  const problemSetId = safeText(value.problemSetId, 80);
  const problemRevision = problemSetId ? boundedInteger(value.problemRevision ?? 1, 1, 100000) : undefined;
  const periodStart = value.periodStart ? validDate(value.periodStart) : undefined;
  const periodEnd = value.periodEnd ? validDate(value.periodEnd) : undefined;
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw new RangeError("탐구 종료일은 시작일보다 빠를 수 없습니다.");
  }
  const payload = JSON.stringify({
    version: lessonStateVersion,
    source,
    date: validDate(value.date),
    latitude: boundedNumber(value.latitude, -85.05112878, 85.05112878),
    longitude: boundedNumber(value.longitude, -180, 180),
    scenario: safeText(value.scenario, 80),
    model: safeText(value.model, 120),
    focus: safeText(value.focus ?? "heat", 24),
    ...(problemSetId ? { problemSetId } : {}),
    ...(problemRevision ? { problemRevision } : {}),
    ...(periodStart ? { periodStart } : {}),
    ...(periodEnd ? { periodEnd } : {})
  });
  return bytesToBase64Url(new TextEncoder().encode(payload));
}

export function decodeLessonState(encoded) {
  try {
    if (String(encoded ?? "").length > 4096) return undefined;
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
    if (![1, lessonStateVersion].includes(parsed?.version)) return undefined;
    const problemSetId = safeText(parsed.problemSetId, 80);
    const problemRevision = problemSetId ? boundedInteger(parsed.problemRevision ?? 1, 1, 100000) : undefined;
    const periodStart = parsed.periodStart ? validDate(parsed.periodStart) : undefined;
    const periodEnd = parsed.periodEnd ? validDate(parsed.periodEnd) : undefined;
    if (periodStart && periodEnd && periodStart > periodEnd) return undefined;
    return {
      source: parsed.source === "public" ? "public" : "teacher",
      date: validDate(parsed.date),
      latitude: boundedNumber(parsed.latitude, -85.05112878, 85.05112878),
      longitude: boundedNumber(parsed.longitude, -180, 180),
      scenario: safeText(parsed.scenario, 80),
      model: safeText(parsed.model, 120),
      focus: safeText(parsed.focus ?? "heat", 24),
      ...(problemSetId ? { problemSetId } : {}),
      ...(problemRevision ? { problemRevision } : {}),
      ...(periodStart ? { periodStart } : {}),
      ...(periodEnd ? { periodEnd } : {})
    };
  } catch {
    return undefined;
  }
}

export function createMetricSnapshot(metrics, context) {
  const values = metrics
    .filter((metric) => metric.available !== false && Number.isFinite(metric.numericValue))
    .map((metric) => ({
      key: safeText(metric.key, 80),
      label: safeText(metric.label, 80),
      unit: safeText(metric.unit ?? "", 40),
      value: Number(metric.numericValue)
    }));
  if (values.length === 0) return undefined;
  return {
    id: `${validDate(context.date)}:${boundedNumber(context.latitude, -85.05112878, 85.05112878).toFixed(4)}:${boundedNumber(context.longitude, -180, 180).toFixed(4)}:${safeText(context.scenario, 80)}:${safeText(context.model, 120)}`,
    date: validDate(context.date),
    latitude: boundedNumber(context.latitude, -85.05112878, 85.05112878),
    longitude: boundedNumber(context.longitude, -180, 180),
    scenario: safeText(context.scenario, 80),
    model: safeText(context.model, 120),
    label: safeText(context.label ?? "선택 지점", 80),
    values
  };
}

export function compareMetricSnapshots(baseline, current) {
  if (!baseline || !current) return [];
  return baseline.values.flatMap((previous) => {
    const next = current.values.find((item) => item.key === previous.key);
    if (!next) return [];
    return [{
      key: previous.key,
      label: next.label,
      unit: next.unit,
      previous: previous.value,
      current: next.value,
      delta: next.value - previous.value
    }];
  });
}

export function filterClimateSeriesByMonths(response, months) {
  const selectedMonths = [...new Set((months ?? []).map(Number).filter((month) => Number.isInteger(month) && month >= 1 && month <= 12))];
  if (selectedMonths.length === 0) return response;
  const allowed = new Set(selectedMonths);
  const indexes = response.dates.flatMap((date, index) => allowed.has(Number(String(date).slice(5, 7))) ? [index] : []);
  const select = (values) => indexes.map((index) => values?.[index] ?? null);
  const selectGroup = (group) => group ? {
    p10: select(group.p10),
    p50: select(group.p50),
    p90: select(group.p90)
  } : undefined;
  return {
    ...response,
    dates: select(response.dates),
    seasonMonths: selectedMonths,
    metrics: response.metrics.map((metric) => {
      const coverage = select(metric.coverage).map(Boolean);
      return {
        ...metric,
        corrected: selectGroup(metric.corrected),
        ...(metric.raw ? { raw: selectGroup(metric.raw) } : {}),
        coverage,
        modelCounts: select(metric.modelCounts).map((value) => Number(value) || 0),
        availableCount: coverage.filter(Boolean).length
      };
    })
  };
}

export function isMatchingClimateSeriesResponse(value, expected) {
  const expectedDataMode = expected?.dataMode;
  const expectedIncludeRaw = expected?.includeRaw;
  if (!value
    || typeof value !== "object"
    || !expected
    || typeof expected !== "object"
    || (expectedIncludeRaw !== undefined && typeof expectedIncludeRaw !== "boolean")
    || (expectedDataMode !== undefined && !["bias-corrected", "raw-model-grid"].includes(expectedDataMode))) return false;
  if (value.publicSafe !== true
    || value.attributionReady !== true
    || !Array.isArray(value.attributionLabels)
    || value.attributionLabels.length === 0
    || typeof value.includeRaw !== "boolean"
    || !["bias-corrected", "raw-model-grid"].includes(value.dataMode)) return false;
  if ((expectedDataMode !== undefined && value.dataMode !== expectedDataMode)
    || (expectedIncludeRaw !== undefined && value.includeRaw !== expectedIncludeRaw)) return false;
  if (value.dateStart !== expected.startDate || value.dateEnd !== expected.endDate) return false;
  if (!nearlyEqual(value.latitude, expected.latitude) || !nearlyEqual(value.longitude, expected.longitude)) return false;
  if (value.scenario !== expected.scenario || value.model !== expected.model) return false;
  if (!Array.isArray(value.dates) || value.dates.length === 0 || !Array.isArray(value.metrics)) return false;
  if (!isPublicClimateTextPayloadSafe(value)) return false;
  if (value.dates[0] !== expected.startDate || value.dates.at(-1) !== expected.endDate) return false;
  if (!value.dates.every((date, index) => isOrderedDate(value.dates, date, index))) return false;

  const metricByKey = new Map();
  for (const metric of value.metrics) {
    if (!metric || typeof metric !== "object" || typeof metric.key !== "string" || metricByKey.has(metric.key)) return false;
    if (!isSeriesGroup(metric.corrected, value.dates.length)) return false;
    if (metric.raw !== undefined && !isSeriesGroup(metric.raw, value.dates.length)) return false;
    if (!isSeriesArray(metric.coverage, value.dates.length) || !isSeriesArray(metric.modelCounts, value.dates.length)) return false;
    metricByKey.set(metric.key, metric);
  }
  return expected.selectedMetrics.every((key) => metricByKey.has(key));
}

export function isContinuousSampledDateRange(dates, previousIndex, nextIndex) {
  if (!Number.isInteger(previousIndex) || !Number.isInteger(nextIndex) || nextIndex <= previousIndex) return false;
  const previousTime = Date.parse(`${dates[previousIndex]}T00:00:00Z`);
  const nextTime = Date.parse(`${dates[nextIndex]}T00:00:00Z`);
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) return false;
  const actualDays = Math.round((nextTime - previousTime) / 864e5);
  const sampledSteps = nextIndex - previousIndex;
  return actualDays >= sampledSteps && actualDays <= sampledSteps + 1;
}

function nearlyEqual(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) && Math.abs(Number(left) - Number(right)) <= 1e-7;
}

function isOrderedDate(dates, date, index) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(date ?? "")) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return false;
  return index === 0 || date > dates[index - 1];
}

function isSeriesArray(value, expectedLength) {
  return Array.isArray(value) && value.length === expectedLength;
}

function isSeriesGroup(value, expectedLength) {
  return value && ["p10", "p50", "p90"].every((key) => isSeriesArray(value[key], expectedLength));
}

export function selectClimateSeriesMetrics(response, selectedKeys) {
  const metricByKey = new Map((response.metrics ?? []).map((metric) => [metric.key, metric]));
  const metrics = [...new Set(selectedKeys ?? [])].flatMap((key) => metricByKey.has(key) ? [metricByKey.get(key)] : []);
  return { ...response, metrics };
}

export function normalizeMetadataOptions(metadata, key, fallback) {
  const candidates = Array.isArray(metadata?.[key]) ? metadata[key] : [];
  const normalized = candidates
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean);
  return [...new Set(normalized.length > 0 ? normalized : fallback)];
}

export function buildPlainLanguageSummary(metrics, date) {
  const available = new Map(metrics
    .filter((metric) => metric.available !== false && Number.isFinite(metric.numericValue))
    .map((metric) => [metric.key, metric]));
  if (available.size === 0) return "선택 조건의 자료를 확인한 뒤 쉬운 설명을 보여드립니다.";
  const temperature = available.get("tasmax");
  const rain = available.get("precipitation");
  const wind = available.get("wind");
  const comfort = available.get("apparentTemperature");
  const parts = [];
  if (temperature && rain) {
    parts.push(`예상 최고 기온은 ${formatNumber(temperature.numericValue)}℃이며, 평균 일일 강수량은 ${formatNumber(rain.numericValue)}mm입니다.`);
  } else if (temperature) {
    parts.push(`예상 최고 기온은 ${formatNumber(temperature.numericValue)}℃입니다.`);
  } else if (rain) {
    parts.push(`평균 일일 강수량은 ${formatNumber(rain.numericValue)}mm입니다.`);
  }
  if (comfort) parts.push(`이 날 체감온도는 ${formatNumber(comfort.numericValue)}℃입니다.`);
  if (wind) parts.push(`평균 풍속은 ${formatNumber(wind.numericValue)}m/s입니다.`);
  return `${parts.join(" ")}\n이 값은 기후 시나리오에 근거한 자료이며 단기 일기예보가 아닙니다.`;
}

export function formatPublicMetricValue(metric) {
  if (!Number.isFinite(metric?.numericValue)) return String(metric?.value ?? "자료 없음");
  const value = formatNumber(metric.numericValue);
  const unit = metricDisplayUnit(metric);
  return unit === "℃" ? `${value}${unit}` : `${value}${unit ? ` ${unit}` : ""}`;
}

export function metricDisplayUnit(metric) {
  if (["tasmax", "tasmin", "apparentTemperature", "heatIndex", "feelsLike"].includes(metric?.key)) return "℃";
  if (metric?.key === "precipitation") return "mm/day";
  if (metric?.key === "wind") return "m/s";
  return safeText(metric?.unit ?? "", 40);
}

export function formatCoordinate(value, axis, fractionDigits = 4) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "좌표 없음";
  const isLatitude = axis === "latitude";
  const direction = isLatitude
    ? numericValue < 0 ? "S(남위)" : "N(북위)"
    : numericValue < 0 ? "W(서경)" : "E(동경)";
  return `${direction} ${Math.abs(numericValue).toFixed(fractionDigits)}`;
}

export function formatCoordinatePair(latitude, longitude, fractionDigits = 4) {
  return `${formatCoordinate(latitude, "latitude", fractionDigits)}, ${formatCoordinate(longitude, "longitude", fractionDigits)}`;
}

export function buildStudentNotebookText({ baseline, comparison, focusLabel, note }) {
  const safeNote = safeText(note ?? "", maximumNoteLength);
  const lines = [
    "기후 타임캡슐 탐구 기록",
    `탐구 주제: ${safeText(focusLabel, 80)}`,
    ""
  ];
  if (baseline) lines.push(...snapshotLines("비교 기준", baseline));
  if (comparison) lines.push("", ...snapshotLines("현재 조건", comparison));
  lines.push("", "나의 발견", safeNote || "작성한 내용 없음");
  return lines.join("\n");
}

export function buildTeacherActivityText({
  assessmentCriteria,
  comparisonPeriods,
  expectedOutputs,
  hypothesisChoices,
  inquiryQuestion,
  interpretationLimit,
  lessonTitle,
  objective,
  periodEnd,
  periodStart,
  snapshots,
  studentLink
}) {
  const lines = [
    "기후 타임캡슐 수업 활동",
    `수업명: ${safeText(lessonTitle, 120)}`,
    `학습 목표: ${safeText(objective, 300)}`,
    `학생용 탐색 링크: ${safeText(studentLink, 2000)}`
  ];

  if (inquiryQuestion || comparisonPeriods?.length || periodStart || periodEnd || hypothesisChoices?.length || expectedOutputs?.length || assessmentCriteria?.length || interpretationLimit) {
    lines.push("", "탐구 설계");
    if (inquiryQuestion) lines.push(`탐구 질문: ${safeText(inquiryQuestion, 500)}`);
    if (comparisonPeriods?.length) {
      lines.push("탐구 기간:");
      comparisonPeriods.forEach((period) => {
        const months = period.seasonMonths?.length ? ` · 대상 월 ${period.seasonMonths.join(", ")}월` : "";
        lines.push(`- ${safeText(period.label, 80)}: ${safeText(period.start, 20)} ~ ${safeText(period.end, 20)}${months}`);
      });
    } else if (periodStart || periodEnd) {
      lines.push(`탐구 기간: ${safeText(periodStart, 20)} ~ ${safeText(periodEnd, 20)}`);
    }
    if (hypothesisChoices?.length) {
      lines.push("", "살펴볼 가능성");
      hypothesisChoices.forEach((item, index) => lines.push(`${index + 1}. ${safeText(item, 200)}`));
    }
    if (expectedOutputs?.length) {
      lines.push("", "학생 결과물");
      expectedOutputs.forEach((item) => lines.push(`- ${safeText(item, 200)}`));
    }
    if (assessmentCriteria?.length) {
      lines.push("", "교사 확인 기준");
      assessmentCriteria.forEach((item) => lines.push(`- ${safeText(item, 300)}`));
    }
    if (interpretationLimit) lines.push("", `해석할 때 주의할 점: ${safeText(interpretationLimit, 1000)}`);
  }

  lines.push("", "비교 조건");
  snapshots.forEach((snapshot, index) => {
    lines.push(`${index + 1}. ${snapshot.label} · ${snapshot.date} · ${formatCoordinatePair(snapshot.latitude, snapshot.longitude)} · ${snapshot.scenario} · ${snapshot.model}`);
    snapshot.values.forEach((metric) => lines.push(`   ${metric.label}: ${formatSnapshotMetricValue(metric)}`));
  });
  lines.push("", "자료 안내: 기후 시나리오 교육용 결과이며 단기 기상예보가 아닙니다.");
  return lines.join("\n");
}

export function sanitizeNote(value) {
  return safeText(value ?? "", maximumNoteLength);
}

export function calendarPeriodEnd(startDate, years) {
  const start = new Date(`${validDate(startDate)}T00:00:00Z`);
  const yearCount = Number(years);
  if (!Number.isInteger(yearCount) || yearCount < 1 || yearCount > 100) {
    throw new RangeError("1에서 100 사이의 연수가 필요합니다.");
  }
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + yearCount);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

export function isCompleteDateValue(value, { min, max } = {}) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return false;
  if (min && text < min) return false;
  if (max && text > max) return false;
  return true;
}

export function mapZoomAfterWheel(currentZoom, deltaY) {
  const zoom = Number(currentZoom);
  const wheelDelta = Number(deltaY);
  if (!Number.isFinite(zoom) || !Number.isFinite(wheelDelta)) {
    throw new TypeError("지도 확대 단계와 휠 이동량은 숫자여야 합니다.");
  }
  return Math.min(10, Math.max(2, zoom + (wheelDelta < 0 ? 1 : -1)));
}

export function mapMarkerSizeForZoom(zoom) {
  const safeZoom = Math.min(10, Math.max(2, Number(zoom)));
  if (!Number.isFinite(safeZoom)) return 44;
  return Math.min(54, Math.round(32 + (safeZoom - 2) * 4));
}

export function mapScaleForZoom(latitude, zoom, maximumWidth = 48) {
  const safeLatitude = Math.min(85.0511, Math.max(-85.0511, Number(latitude)));
  const safeZoom = Math.min(10, Math.max(2, Number(zoom)));
  const width = Math.max(24, Number(maximumWidth));
  if (![safeLatitude, safeZoom, width].every(Number.isFinite)) {
    throw new TypeError("지도 축척 계산값은 숫자여야 합니다.");
  }
  const metresPerPixel = 156543.03392 * Math.cos(safeLatitude * Math.PI / 180) / 2 ** safeZoom;
  const maximumKilometres = metresPerPixel * width / 1000;
  const exponent = 10 ** Math.floor(Math.log10(maximumKilometres));
  const normalized = maximumKilometres / exponent;
  const factor = normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1;
  const kilometres = factor * exponent;
  return {
    kilometres,
    label: kilometres >= 1 ? `${kilometres.toLocaleString("ko-KR")} km` : `${Math.round(kilometres * 1000)} m`,
    width: Math.max(1, Math.min(width, kilometres * 1000 / metresPerPixel))
  };
}

export function resolveExportPercentiles(metric, dataMode) {
  if (dataMode === "raw-model-grid") {
    return {
      corrected: undefined,
      raw: metric.raw ?? metric.corrected
    };
  }
  return {
    corrected: metric.corrected,
    raw: metric.raw
  };
}

export function apparentTemperatureBasis(date) {
  const month = Number(String(date).slice(5, 7));
  const usesHeatIndex = Number.isInteger(month) && month >= 5 && month <= 9;
  return usesHeatIndex
    ? { key: "heat_index", metricKey: "heatIndex", label: "열지수" }
    : { key: "feels_like", metricKey: "feelsLike", label: "체감기온" };
}

export function buildClimateCsv(response) {
  if (!isPublicClimateTextPayloadSafe(response)) {
    throw new TypeError("공개할 수 없는 연결 정보가 포함되어 자료 내보내기를 중단했습니다.");
  }
  const dataMode = requirePublicExportDataMode(response.dataMode);
  const datasetIdentity = requirePublicDatasetIdentity(response);
  const generatedAt = requireOptionalUtcTimestamp(response.generatedAt, "생성 시각");
  const header = [
    "date",
    "latitude",
    "longitude",
    "scenario",
    "model",
    "metric_key",
    "metric_label",
    "unit",
    "calculation_basis",
    "data_mode",
    "corrected_p10",
    "corrected_p50",
    "corrected_p90",
    "raw_p10",
    "raw_p50",
    "raw_p90",
    "coverage",
    "model_count",
    "nearest_reference_distance_km",
    "generated_at",
    "dataset_version",
    "dataset_updated_at",
    "attribution_document",
    "kma_asos_use",
    "attribution_labels",
    "problem_id",
    "problem_revision",
    "problem_title",
    "interpretation_limit",
    "season_months"
  ];
  const attribution = normalizePublicAttributionLabels(response.attributionLabels).join(" | ");
  const rows = [header];
  response.dates.forEach((date, dateIndex) => {
    response.metrics.forEach((metric) => {
      const exportSeries = resolveExportPercentiles(metric, dataMode);
      rows.push([
        date,
        Number(response.latitude).toFixed(6),
        Number(response.longitude).toFixed(6),
        response.scenario,
        response.model,
        metric.key,
        metric.label,
        metricDisplayUnit(metric),
        metric.key === "apparentTemperature" ? apparentTemperatureBasis(date).key : "",
        dataMode,
        csvNumber(exportSeries.corrected?.p10[dateIndex]),
        csvNumber(exportSeries.corrected?.p50[dateIndex]),
        csvNumber(exportSeries.corrected?.p90[dateIndex]),
        csvNumber(exportSeries.raw?.p10[dateIndex]),
        csvNumber(exportSeries.raw?.p50[dateIndex]),
        csvNumber(exportSeries.raw?.p90[dateIndex]),
        metric.coverage[dateIndex] ? "available" : "missing",
        String(metric.modelCounts[dateIndex] ?? 0),
        response.nearestDistanceKm === void 0 ? "" : Number(response.nearestDistanceKm).toFixed(3),
        generatedAt,
        datasetIdentity.datasetVersion,
        datasetIdentity.datasetUpdatedAt,
        attributionDocumentName,
        kmaAsosUseByDataMode[dataMode],
        attribution,
        response.exploration?.id ?? "",
        response.exploration?.revision ?? "",
        response.exploration?.title ?? "",
        response.exploration?.interpretationLimit ?? "",
        Array.isArray(response.seasonMonths) ? response.seasonMonths.join("|") : ""
      ]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function chartWindowAfterWheel({ start, end, total, ratio, deltaY, minWindow = 7 }) {
  const normalized = normalizeChartWindow(start, end, total);
  const pointerRatio = Math.min(1, Math.max(0, Number(ratio)));
  const wheelDelta = Number(deltaY);
  const minimum = Math.min(normalized.total, Math.max(1, Math.round(Number(minWindow) || 1)));
  if (!Number.isFinite(pointerRatio) || !Number.isFinite(wheelDelta) || wheelDelta === 0) {
    return { start: normalized.start, end: normalized.end };
  }
  const currentLength = normalized.end - normalized.start;
  const factor = wheelDelta < 0 ? 0.72 : 1.38;
  const nextLength = Math.min(normalized.total, Math.max(minimum, Math.round(currentLength * factor)));
  if (nextLength === currentLength) return { start: normalized.start, end: normalized.end };
  const anchor = normalized.start + pointerRatio * Math.max(currentLength - 1, 0);
  const proposedStart = Math.round(anchor - pointerRatio * Math.max(nextLength - 1, 0));
  const nextStart = Math.min(normalized.total - nextLength, Math.max(0, proposedStart));
  return { start: nextStart, end: nextStart + nextLength };
}

export function chartWindowAfterPan({ start, end, total, delta }) {
  const normalized = normalizeChartWindow(start, end, total);
  const length = normalized.end - normalized.start;
  const shift = Number(delta);
  if (!Number.isFinite(shift) || shift === 0) {
    return { start: normalized.start, end: normalized.end };
  }
  const nextStart = Math.min(normalized.total - length, Math.max(0, normalized.start + Math.round(shift)));
  return { start: nextStart, end: nextStart + length };
}

export function chartComparison(current, reference) {
  if (typeof current !== "number" || typeof reference !== "number" || !Number.isFinite(current) || !Number.isFinite(reference)) {
    return { delta: null, percent: null };
  }
  const currentValue = current;
  const referenceValue = reference;
  const delta = currentValue - referenceValue;
  return {
    delta,
    percent: Math.abs(referenceValue) > Number.EPSILON ? delta / Math.abs(referenceValue) * 100 : null
  };
}

export function buildInteractiveClimateHtml(response, attribution) {
  if (!isPublicClimateTextPayloadSafe(response)) {
    throw new TypeError("공개할 수 없는 연결 정보가 포함되어 자료 내보내기를 중단했습니다.");
  }
  const dataMode = requirePublicExportDataMode(response.dataMode);
  const datasetIdentity = requirePublicDatasetIdentity(response);
  const generatedAt = requireOptionalUtcTimestamp(response.generatedAt, "생성 시각");
  const exploration = response.exploration ? {
    title: safeText(response.exploration.title ?? "", 240),
    question: safeText(response.exploration.question ?? "", 600),
    interpretationLimit: safeText(response.exploration.interpretationLimit ?? "", 1200)
  } : null;
  const payload = {
    title: "대화형 기후 변화 그래프",
    context: {
      coordinates: formatCoordinatePair(response.latitude, response.longitude),
      scenario: safeText(response.scenario ?? "", 120),
      model: safeText(response.model ?? "", 160),
      dateStart: validDate(response.dateStart),
      dateEnd: validDate(response.dateEnd),
      dataMode: dataMode === "raw-model-grid" ? "기후 모델 원자료 격자값" : "KMA ASOS 관측자료 기반 보정값",
      datasetVersion: datasetIdentity.datasetVersion,
      datasetUpdatedAt: datasetIdentity.datasetUpdatedAt,
      generatedAt,
      seasonMonths: Array.isArray(response.seasonMonths) ? response.seasonMonths.filter((month) => Number.isInteger(month) && month >= 1 && month <= 12) : []
    },
    exploration,
    dates: Array.isArray(response.dates) ? response.dates.map(validDate) : [],
    metrics: Array.isArray(response.metrics) ? response.metrics.map((metric) => ({
      key: safeText(metric.key ?? "metric", 80),
      label: safeText(metric.label ?? "기후지표", 120),
      unit: metricDisplayUnit(metric),
      corrected: serializeSeriesGroup(metric.corrected),
      raw: metric.raw ? serializeSeriesGroup(metric.raw) : null
    })) : []
  };
  const serialized = JSON.stringify(payload).replace(/</gu, "\\u003c").replace(/>/gu, "\\u003e").replace(/&/gu, "\\u0026");
  const contextLine = [payload.context.coordinates, payload.context.scenario, payload.context.model].map(escapeHtml).join(" · ");
  const explorationBlock = payload.exploration ? `<section class="context-note"><strong>${escapeHtml(payload.exploration.title)}</strong><p>${escapeHtml(payload.exploration.question)}</p><small>해석할 때 주의할 점: ${escapeHtml(payload.exploration.interpretationLimit)}</small></section>` : "";
  const seasonLine = payload.context.seasonMonths.length ? `<p>대상 월: ${escapeHtml(payload.context.seasonMonths.join(", "))}월</p>` : "";
  const attributionBlock = buildInteractiveAttributionHtml(attribution, {
    dataMode,
    datasetVersion: payload.context.datasetVersion,
    datasetUpdatedAt: payload.context.datasetUpdatedAt,
    generatedAt: payload.context.generatedAt
  });
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(payload.title)}</title>
<style>
:root{color-scheme:light dark;--bg:#eef3f1;--surface:#fff;--ink:#10211c;--muted:#63706b;--line:#d6dfdb;--green:#176b55;--green-soft:#e5f3ed;--coral:#d95d39;--raw:#6d6483}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif}main{width:min(1180px,calc(100% - 32px));margin:28px auto;padding:28px;border:1px solid var(--line);border-radius:8px;background:var(--surface);box-shadow:0 18px 50px rgba(19,47,38,.09)}header{display:flex;gap:20px;align-items:flex-start;justify-content:space-between;margin-bottom:18px}h1{margin:0;font-size:clamp(24px,4vw,38px);letter-spacing:0}header p{margin:7px 0 0;color:var(--muted)}.badge{padding:7px 10px;border-radius:6px;background:var(--green-soft);color:var(--green);font-weight:800;white-space:nowrap}.context-note{margin:0 0 18px;padding:13px 15px;border-left:3px solid var(--green);background:var(--green-soft)}.context-note strong,.context-note p,.context-note small{display:block;margin:0}.context-note p{margin-top:4px}.context-note small{margin-top:6px;color:var(--muted)}.tabs,.controls{display:flex;flex-wrap:wrap;gap:8px}.tabs{margin-bottom:12px}.tabs button,.controls button{min-height:38px;padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);font:inherit;font-weight:750;cursor:pointer}.tabs button[aria-selected="true"]{border-color:var(--green);background:var(--green-soft);color:var(--green)}.chart-card{padding:18px;border:1px solid var(--line);border-radius:8px}.chart-title{display:flex;gap:12px;align-items:center;justify-content:space-between;margin-bottom:10px}.chart-title strong{font-size:18px}.controls button{min-width:40px}.controls .clear{color:var(--coral)}svg{display:block;width:100%;height:auto;min-height:310px;touch-action:none;cursor:crosshair;user-select:none}.grid{stroke:var(--line);stroke-width:1}.band{fill:rgba(23,107,85,.12)}.line{fill:none;stroke:var(--green);stroke-width:3;stroke-linejoin:round;stroke-linecap:round}.raw{fill:none;stroke:var(--raw);stroke-width:2;stroke-dasharray:7 6}.cursor{stroke:var(--coral);stroke-width:1}.reference{stroke:var(--green);stroke-width:2;stroke-dasharray:4 4}.point{fill:var(--coral);stroke:var(--surface);stroke-width:3}.axis{fill:var(--muted);font-size:12px}.readout{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;margin-top:12px;border:1px solid var(--line);border-radius:7px;overflow:hidden;background:var(--line)}.readout div{min-width:0;padding:10px 12px;background:var(--surface)}.readout span{display:block;color:var(--muted);font-size:11px}.readout strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.help{margin:12px 0 0;color:var(--muted);font-size:13px}.positive{color:#b24327}.negative{color:#166f93}.attribution{margin-top:18px;border:1px solid var(--line);border-radius:8px;background:var(--surface)}.attribution summary{padding:12px 14px;color:var(--green);font-weight:800;cursor:pointer}.attribution-content{padding:0 14px 14px}.attribution-content h2{margin:16px 0 7px;font-size:15px}.attribution-content p,.attribution-content li{color:var(--muted);font-size:12px}.attribution-content ul,.attribution-content ol{margin:0;padding-left:20px}.attribution-models>li,.attribution-methods li{margin:7px 0}.attribution-models ul{margin-top:4px}.attribution-content a{color:var(--green);font-weight:700;overflow-wrap:anywhere}.attribution-marks{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}.attribution-marks img{display:block;width:auto;max-width:100%;max-height:46px;object-fit:contain}.attribution-meta{padding:10px;border-radius:6px;background:var(--green-soft);overflow-wrap:anywhere}footer{margin-top:18px;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:720px){main{width:100%;margin:0;padding:18px;border:0;border-radius:0}header,.chart-title{display:grid}.readout{grid-template-columns:repeat(2,minmax(0,1fr))}svg{min-height:250px}.attribution-content{padding-inline:12px}}@media(prefers-color-scheme:dark){:root{--bg:#101714;--surface:#17201c;--ink:#edf5f1;--muted:#a9b7b0;--line:#35443d;--green:#6bc6a5;--green-soft:#203b31;--coral:#ff8968}}
</style>
</head>
<body>
<main>
<header><div><h1>대화형 기후 변화 그래프</h1><p>${contextLine}</p><p>${escapeHtml(payload.context.dateStart)} ~ ${escapeHtml(payload.context.dateEnd)}</p>${seasonLine}</div><span class="badge">${escapeHtml(payload.context.dataMode)}</span></header>
${explorationBlock}
<nav class="tabs" id="metric-tabs" aria-label="기후지표"></nav>
<section class="chart-card">
<div class="chart-title"><strong id="metric-title"></strong><div class="controls"><button id="zoom-out" type="button" title="축소">−</button><button id="zoom-in" type="button" title="확대">+</button><button id="reset-view" type="button">전체 보기</button><button class="clear" id="clear-reference" type="button" hidden>비교 날짜 지우기</button></div></div>
<svg id="chart" viewBox="0 0 960 360" role="img" aria-label="날짜별 기후 변화 그래프">
<g id="grid"></g><path class="band" id="band"></path><path class="line" id="line"></path><path class="raw" id="raw-line"></path><line class="reference" id="reference-line" y1="34" y2="300" hidden></line><line class="cursor" id="cursor" y1="34" y2="300" hidden></line><circle class="point" id="point" r="6" hidden></circle><g id="axes"></g>
</svg>
<div class="readout" aria-live="polite"><div><span>현재 날짜</span><strong id="current-date">그래프를 가리키세요</strong></div><div><span>현재 값</span><strong id="current-value">-</strong></div><div><span>첫 번째 날짜</span><strong id="reference-date">날짜를 눌러 정하기</strong></div><div><span>첫 번째 날짜와의 차이</span><strong id="delta-value">-</strong></div><div><span>변화율 · 날짜 차이</span><strong id="delta-percent">-</strong></div></div>
<p class="help">마우스 휠로 확대하거나 축소하고, 그래프를 끌어 기간을 옮길 수 있습니다. 날짜를 누르면 첫 번째 비교 날짜로 정해집니다.</p>
</section>
${attributionBlock}
<footer>이 자료는 기후 시나리오 교육·연구용 결과이며 단기 기상예보가 아닙니다. 그래프와 출처 정보는 외부 연결 없이 확인할 수 있습니다.</footer>
</main>
<script id="climate-data" type="application/json">${serialized}</script>
<script>
(()=>{
  "use strict";
  const DATA=JSON.parse(document.getElementById("climate-data").textContent);
  const chart=document.getElementById("chart");
  const plot={left:64,right:928,top:34,bottom:300};
  const state={metric:0,start:0,end:DATA.dates.length,hover:null,reference:null,drag:null};
  const finite=(value)=>typeof value==="number"&&Number.isFinite(value);
  const clamp=(value,minimum,maximum)=>Math.min(maximum,Math.max(minimum,value));
  const metric=()=>DATA.metrics[state.metric];
  const valueAt=(index)=>metric().corrected.p50[index];
  const xAt=(index)=>plot.left+(state.end-state.start<=1?.5:(index-state.start)/(state.end-state.start-1))*(plot.right-plot.left);
  const fmt=(value)=>finite(value)?value.toLocaleString("ko-KR",{maximumFractionDigits:2})+metric().unit:"자료 없음";
  const continuous=(previousIndex,nextIndex)=>{
    if(!Number.isInteger(previousIndex)||!Number.isInteger(nextIndex)||nextIndex<=previousIndex)return false;
    const previousTime=Date.parse(DATA.dates[previousIndex]+"T00:00:00Z");
    const nextTime=Date.parse(DATA.dates[nextIndex]+"T00:00:00Z");
    if(!Number.isFinite(previousTime)||!Number.isFinite(nextTime))return false;
    const actualDays=Math.round((nextTime-previousTime)/864e5);
    const sampledSteps=nextIndex-previousIndex;
    return actualDays>=sampledSteps&&actualDays<=sampledSteps+1;
  };
  function windowAfterWheel(delta,ratio){
    const length=state.end-state.start;
    const minimum=Math.min(DATA.dates.length,7);
    const next=Math.min(DATA.dates.length,Math.max(minimum,Math.round(length*(delta<0?.72:1.38))));
    const anchor=state.start+ratio*Math.max(length-1,0);
    const start=clamp(Math.round(anchor-ratio*Math.max(next-1,0)),0,DATA.dates.length-next);
    state.start=start;
    state.end=start+next;
  }
  function pan(delta){
    const length=state.end-state.start;
    state.start=clamp(state.start+Math.round(delta),0,DATA.dates.length-length);
    state.end=state.start+length;
  }
  function sample(){
    const length=state.end-state.start;
    const step=Math.max(1,Math.ceil(length/600));
    const indexes=[];
    for(let index=state.start;index<state.end;index+=step)indexes.push(index);
    if(indexes.at(-1)!==state.end-1)indexes.push(state.end-1);
    return indexes;
  }
  function pathFor(values,yAt){
    let path="";
    let previousIndex=null;
    for(const index of sample()){
      const value=values[index];
      if(!finite(value)){previousIndex=null;continue;}
      const command=previousIndex!==null&&continuous(previousIndex,index)?" L":" M";
      path+=command+xAt(index).toFixed(2)+","+yAt(value).toFixed(2);
      previousIndex=index;
    }
    return path;
  }
  function segmentedIndexes(indexes){
    const segments=[];
    let segment=[];
    let previousIndex=null;
    for(const index of indexes){
      if(previousIndex!==null&&!continuous(previousIndex,index)){
        if(segment.length)segments.push(segment);
        segment=[];
      }
      segment.push(index);
      previousIndex=index;
    }
    if(segment.length)segments.push(segment);
    return segments;
  }
  function bandPath(metricValue,yAt){
    const indexes=sample().filter((index)=>finite(metricValue.corrected.p10[index])&&finite(metricValue.corrected.p90[index]));
    return segmentedIndexes(indexes).filter((segment)=>segment.length>1).map((segment)=>{
      const lower=segment.map((index)=>xAt(index).toFixed(2)+","+yAt(metricValue.corrected.p10[index]).toFixed(2));
      const upper=[...segment].reverse().map((index)=>xAt(index).toFixed(2)+","+yAt(metricValue.corrected.p90[index]).toFixed(2));
      return "M"+lower.join(" L")+" L"+upper.join(" L")+" Z";
    }).join(" ");
  }
  function render(){
    const currentMetric=metric();
    document.getElementById("metric-title").textContent=currentMetric.label+" ("+currentMetric.unit+")";
    document.querySelectorAll("#metric-tabs button").forEach((button,index)=>button.setAttribute("aria-selected",String(index===state.metric)));
    const groups=[currentMetric.corrected.p10,currentMetric.corrected.p50,currentMetric.corrected.p90,currentMetric.raw?.p50].filter(Boolean);
    const values=groups.flatMap((group)=>group.slice(state.start,state.end)).filter(finite);
    let minimum=values.length?Math.min(...values):-1;
    let maximum=values.length?Math.max(...values):1;
    if(Math.abs(maximum-minimum)<1e-6){minimum-=1;maximum+=1;}
    const padding=Math.max((maximum-minimum)*.08,.5);
    minimum-=padding;
    maximum+=padding;
    const yAt=(value)=>plot.bottom-(value-minimum)/(maximum-minimum)*(plot.bottom-plot.top);
    document.getElementById("line").setAttribute("d",pathFor(currentMetric.corrected.p50,yAt));
    document.getElementById("raw-line").setAttribute("d",currentMetric.raw?pathFor(currentMetric.raw.p50,yAt):"");
    document.getElementById("band").setAttribute("d",bandPath(currentMetric,yAt));
    document.getElementById("grid").innerHTML=[0,1,2,3,4].map((tick)=>{
      const y=plot.top+tick*(plot.bottom-plot.top)/4;
      return '<line class="grid" x1="'+plot.left+'" x2="'+plot.right+'" y1="'+y+'" y2="'+y+'"></line>';
    }).join("");
    document.getElementById("axes").innerHTML='<text class="axis" x="4" y="44">'+maximum.toFixed(1)+'</text><text class="axis" x="4" y="300">'+minimum.toFixed(1)+'</text><text class="axis" x="64" y="338">'+DATA.dates[state.start]+'</text><text class="axis" text-anchor="end" x="928" y="338">'+DATA.dates[state.end-1]+'</text>';
    const referenceLine=document.getElementById("reference-line");
    document.getElementById("clear-reference").hidden=state.reference===null;
    if(state.reference!==null&&state.reference>=state.start&&state.reference<state.end){
      referenceLine.hidden=false;
      referenceLine.setAttribute("x1",xAt(state.reference));
      referenceLine.setAttribute("x2",xAt(state.reference));
    }else referenceLine.hidden=true;
    renderHover(yAt);
  }
  function renderHover(yAt){
    const index=state.hover;
    const cursor=document.getElementById("cursor");
    const point=document.getElementById("point");
    if(index===null||index<state.start||index>=state.end){cursor.hidden=true;point.hidden=true;return;}
    const x=xAt(index);
    const value=valueAt(index);
    cursor.hidden=false;
    cursor.setAttribute("x1",x);
    cursor.setAttribute("x2",x);
    if(finite(value)){point.hidden=false;point.setAttribute("cx",x);point.setAttribute("cy",yAt(value));}else point.hidden=true;
    document.getElementById("current-date").textContent=DATA.dates[index];
    document.getElementById("current-value").textContent=fmt(value);
    if(state.reference===null){
      document.getElementById("reference-date").textContent="날짜를 눌러 정하기";
      document.getElementById("delta-value").textContent="-";
      document.getElementById("delta-percent").textContent="-";
      return;
    }
    const reference=valueAt(state.reference);
    const delta=finite(value)&&finite(reference)?value-reference:null;
    const elapsed=Math.round((Date.parse(DATA.dates[index])-Date.parse(DATA.dates[state.reference]))/86400000);
    document.getElementById("reference-date").textContent=DATA.dates[state.reference]+" · "+fmt(reference);
    const deltaElement=document.getElementById("delta-value");
    deltaElement.textContent=delta===null?"계산 불가":(delta>=0?"+":"")+delta.toLocaleString("ko-KR",{maximumFractionDigits:2})+metric().unit;
    deltaElement.className=delta>0?"positive":delta<0?"negative":"";
    const percent=delta!==null&&Math.abs(reference)>Number.EPSILON?delta/Math.abs(reference)*100:null;
    document.getElementById("delta-percent").textContent=(percent===null?"변화율 계산 불가":(percent>=0?"+":"")+percent.toLocaleString("ko-KR",{maximumFractionDigits:2})+"%")+" · "+(elapsed>=0?"+":"")+elapsed+"일";
  }
  DATA.metrics.forEach((item,index)=>{
    const button=document.createElement("button");
    button.type="button";
    button.textContent=item.label;
    button.onclick=()=>{state.metric=index;state.hover=null;state.reference=null;render();};
    document.getElementById("metric-tabs").append(button);
  });
  chart.addEventListener("pointermove",(event)=>{
    const rect=chart.getBoundingClientRect();
    const ratio=clamp(((event.clientX-rect.left)/rect.width*960-plot.left)/(plot.right-plot.left),0,1);
    state.hover=state.start+Math.round(ratio*Math.max(state.end-state.start-1,0));
    if(state.drag){
      const moved=event.clientX-state.drag.x;
      if(Math.abs(moved)>3)state.drag.moved=true;
      const delta=-(moved/rect.width)*(state.drag.end-state.drag.start);
      state.start=state.drag.start;
      state.end=state.drag.end;
      pan(delta);
      render();
    }else render();
  });
  chart.addEventListener("pointerleave",()=>{if(!state.drag){state.hover=null;render();}});
  chart.addEventListener("pointerdown",(event)=>{chart.setPointerCapture(event.pointerId);state.drag={x:event.clientX,start:state.start,end:state.end,moved:false};});
  chart.addEventListener("pointerup",(event)=>{
    if(state.drag&&!state.drag.moved&&state.hover!==null)state.reference=state.hover;
    state.drag=null;
    chart.releasePointerCapture(event.pointerId);
    render();
  });
  chart.addEventListener("wheel",(event)=>{
    event.preventDefault();
    const rect=chart.getBoundingClientRect();
    const ratio=clamp(((event.clientX-rect.left)/rect.width*960-plot.left)/(plot.right-plot.left),0,1);
    windowAfterWheel(event.deltaY,ratio);
    render();
  },{passive:false});
  document.getElementById("zoom-in").onclick=()=>{windowAfterWheel(-1,.5);render();};
  document.getElementById("zoom-out").onclick=()=>{windowAfterWheel(1,.5);render();};
  document.getElementById("reset-view").onclick=()=>{state.start=0;state.end=DATA.dates.length;render();};
  document.getElementById("clear-reference").onclick=()=>{state.reference=null;render();};
  render();
})();
</script>
</body>
</html>`;
}

function buildInteractiveAttributionHtml(attribution, context) {
  const record = requireInteractiveAttribution(attribution, context.dataMode);
  const modelItems = record.climateModels.map((model) => {
    const citations = model.citations.map((citation) => (
      `<li>${escapeHtml(citation.activity)}: ${escapeHtml(citation.title)} <a href="${escapeHtml(citation.href)}" target="_blank" rel="noopener noreferrer">DOI ${escapeHtml(citation.doi)}</a></li>`
    )).join("");
    return `<li><strong>${escapeHtml(model.name)}</strong> · ${escapeHtml(model.institution)}<ul>${citations}</ul></li>`;
  }).join("");
  const methodItems = record.methodologyReferences.map((reference) => (
    `<li>${escapeHtml(reference.authors)} (${reference.year}). ${escapeHtml(reference.title)}. ${escapeHtml(reference.sourceTitle)}. <a href="${escapeHtml(reference.href)}" target="_blank" rel="noopener noreferrer">DOI ${escapeHtml(reference.doi)}</a></li>`
  )).join("");
  const sourceNotice = context.dataMode === "raw-model-grid"
    ? "기후 모델 원자료 격자값입니다. 대한민국 기상청 ASOS 관측자료를 사용한 보정은 적용하지 않았습니다."
    : "대한민국 기상청 ASOS 관측자료를 사용해 보정한 값입니다.";
  const generatedAt = context.generatedAt ? ` · 생성 ${escapeHtml(context.generatedAt)}` : "";
  const markItems = record.marks.map((mark) => `<img src="${escapeHtml(mark.dataUrl)}" alt="${escapeHtml(mark.alt)}">`).join("");
  return `<details class="attribution"><summary>CMIP6/downscaleCMIP6 출처·인용</summary><div class="attribution-content">
<p class="attribution-meta">${escapeHtml(sourceNotice)} · 자료판 ${escapeHtml(context.datasetVersion)} · 자료 갱신 ${escapeHtml(context.datasetUpdatedAt)}${generatedAt}</p>
<section><h2>대한민국 기상청 ASOS</h2><p>${escapeHtml(sourceNotice)} (${escapeHtml(record.asosNotice)})</p><p>자료 출처: ${escapeHtml(record.asosSource.organization)} <a href="${escapeHtml(record.asosSource.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.asosSource.title)}</a></p><div class="attribution-marks">${markItems}</div></section>
<section><h2>기후 모델 자료</h2><ul class="attribution-models">${modelItems}</ul></section>
<section><h2>자료 처리 방법</h2><ol class="attribution-methods">${methodItems}</ol></section>
<section><h2>제작자</h2><p>${escapeHtml(record.project.title)} · ${escapeHtml(record.project.creator.displayName)} · <a href="${escapeHtml(record.project.creator.githubUrl)}" target="_blank" rel="noopener noreferrer">GitHub ${escapeHtml(record.project.creator.githubHandle)}</a> · <a href="${escapeHtml(record.project.repositoryUrl)}" target="_blank" rel="noopener noreferrer">프로젝트 저장소</a> · ${escapeHtml(record.project.license.title)} (${escapeHtml(record.project.license.identifier)})</p></section>
</div></details>`;
}

function requireInteractiveAttribution(value, dataMode) {
  if (!isRecord(value)
    || value.publicSafe !== true
    || value.schemaVersion !== 1
    || value.catalogSchemaVersion !== 1
    || value.dataMode !== dataMode
    || !isPublicAttributionTreeSafe(value)) {
    throw new TypeError("대화형 HTML에 넣을 공개 출처 정보를 확인할 수 없습니다.");
  }
  const expectedUsed = dataMode === "bias-corrected";
  const expectedNotice = kmaAsosNoticeByDataMode[dataMode];
  const correction = value.asosCorrection;
  if (!isRecord(correction)
    || correction.used !== expectedUsed
    || correction.notice !== expectedNotice
    || !isRecord(correction.source)
    || correction.source.url !== kmaAsosSourceUrl
    || !Array.isArray(correction.marks)
    || correction.marks.length !== kmaMarkArchivePaths.length
    || !Array.isArray(value.markDataUrls)
    || value.markDataUrls.length !== kmaMarkArchivePaths.length) {
    throw new TypeError("dataMode와 대한민국 기상청 ASOS 출처 표기가 일치하지 않습니다.");
  }
  const marks = correction.marks.map((mark, index) => {
    if (!isRecord(mark) || mark.archivePath !== kmaMarkArchivePaths[index]) {
      throw new TypeError("대화형 HTML에 넣을 원본 출처 표시 이미지를 확인할 수 없습니다.");
    }
    return {
      alt: requirePublicAttributionText(mark.alt, 160, "출처 표시 이미지 대체 문구"),
      dataUrl: requirePngDataUrl(value.markDataUrls[index])
    };
  });
  const project = requireInteractiveProjectAttribution(value.project);
  if (!Array.isArray(value.climateModels) || value.climateModels.length === 0) {
    throw new TypeError("기후 모델 인용 정보가 필요합니다.");
  }
  const climateModels = value.climateModels.map((model) => {
    if (!isRecord(model) || !Array.isArray(model.citations) || model.citations.length === 0) {
      throw new TypeError("기후 모델 인용 정보가 완전하지 않습니다.");
    }
    return {
      name: requirePublicAttributionText(model.name, 120, "기후 모델 이름"),
      institution: requirePublicAttributionText(model.institution, 240, "기후 모델 기관"),
      citations: model.citations.map((citation) => {
        if (!isRecord(citation)) throw new TypeError("기후 모델 인용 정보가 완전하지 않습니다.");
        requireAttributionAuthors(citation.authors);
        const source = requireDoiSource(citation.source);
        return {
          activity: requirePublicAttributionText(citation.activity, 80, "기후 모델 활동"),
          title: requirePublicAttributionText(citation.title, 600, "기후 모델 자료 제목"),
          ...source
        };
      })
    };
  });
  if (!Array.isArray(value.methodologyReferences) || value.methodologyReferences.length === 0) {
    throw new TypeError("자료 처리 방법 인용 정보가 필요합니다.");
  }
  const methodologyReferences = value.methodologyReferences.map((reference) => {
    if (!isRecord(reference) || !Number.isInteger(reference.year) || reference.year < 1800 || reference.year > 2200) {
      throw new TypeError("자료 처리 방법 인용 정보가 완전하지 않습니다.");
    }
    const source = requireDoiSource(reference.source);
    return {
      authors: requireAttributionAuthors(reference.authors),
      year: reference.year,
      title: requirePublicAttributionText(reference.title, 800, "자료 처리 방법 제목"),
      sourceTitle: requirePublicAttributionText(reference.source?.title, 300, "자료 처리 방법 출처"),
      ...source
    };
  });
  return {
    asosNotice: expectedNotice,
    asosSource: {
      organization: requirePublicAttributionText(correction.source.organization, 120, "ASOS 제공 기관"),
      title: requirePublicAttributionText(correction.source.title, 200, "ASOS 자료 제목"),
      href: kmaAsosSourceUrl
    },
    marks,
    project,
    climateModels,
    methodologyReferences
  };
}

function requireInteractiveProjectAttribution(value) {
  if (!isRecord(value) || !isRecord(value.creator) || !isRecord(value.license)) {
    throw new TypeError("프로젝트 제작자와 라이선스 출처 정보가 필요합니다.");
  }
  const githubHandle = requirePublicAttributionText(value.creator.githubHandle, 40, "GitHub 계정");
  if (!/^@[a-z0-9](?:[a-z0-9-]{0,38})$/iu.test(githubHandle)) {
    throw new TypeError("GitHub 계정 표기가 올바르지 않습니다.");
  }
  const expectedGithubUrl = `https://github.com/${githubHandle.slice(1)}`;
  if (value.creator.githubUrl !== expectedGithubUrl) {
    throw new TypeError("GitHub 제작자 주소가 계정 표기와 일치하지 않습니다.");
  }
  const repositoryUrl = value.repositoryUrl;
  if (typeof repositoryUrl !== "string"
    || !/^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9._-]+$/iu.test(repositoryUrl)
    || !repositoryUrl.startsWith(`${expectedGithubUrl}/`)) {
    throw new TypeError("GitHub 프로젝트 주소가 올바르지 않습니다.");
  }
  return {
    title: requirePublicAttributionText(value.title, 240, "프로젝트 제목"),
    repositoryUrl,
    creator: {
      displayName: requirePublicAttributionText(value.creator.displayName, 160, "제작자 이름"),
      githubHandle,
      githubUrl: expectedGithubUrl
    },
    license: {
      identifier: requirePublicAttributionText(value.license.identifier, 80, "라이선스 식별자"),
      title: requirePublicAttributionText(value.license.title, 200, "라이선스 제목")
    }
  };
}

function requireAttributionAuthors(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("인용 저자 정보가 필요합니다.");
  return value.map((author) => {
    if (!isRecord(author)) throw new TypeError("인용 저자 정보가 완전하지 않습니다.");
    if (author.name !== undefined) return requirePublicAttributionText(author.name, 240, "인용 기관명");
    const familyName = requirePublicAttributionText(author.familyName, 120, "인용 저자 성");
    const givenNames = requirePublicAttributionText(author.givenNames, 120, "인용 저자 이름");
    return `${familyName}, ${givenNames}`;
  }).join("; ");
}

function requireDoiSource(value) {
  if (!isRecord(value)) throw new TypeError("인용 DOI 정보가 필요합니다.");
  const doi = requirePublicAttributionText(value.doi, 160, "인용 DOI");
  if (!/^10\.\d{4,9}\/[a-z0-9._()\-;/:]+$/iu.test(doi)) throw new TypeError("인용 DOI가 올바르지 않습니다.");
  return { doi, href: safeDoiHref(value.url, doi) };
}

function safeDoiHref(value, doi) {
  if (typeof value !== "string" || value !== `https://doi.org/${doi}`) {
    throw new TypeError("인용 DOI 주소가 DOI와 일치하지 않습니다.");
  }
  return value;
}

function requirePngDataUrl(value) {
  if (typeof value !== "string" || value.length > 4_000_000) {
    throw new TypeError("대화형 HTML에 넣을 원본 출처 표시 이미지를 확인할 수 없습니다.");
  }
  const payload = value.match(/^data:image\/png;base64,((?:[a-z0-9+/]{4})*(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?)$/iu)?.[1];
  if (!payload || typeof globalThis.atob !== "function") {
    throw new TypeError("대화형 HTML에 넣을 원본 출처 표시 이미지를 확인할 수 없습니다.");
  }
  let decoded;
  try {
    decoded = globalThis.atob(payload);
  } catch {
    throw new TypeError("대화형 HTML에 넣을 원본 출처 표시 이미지를 확인할 수 없습니다.");
  }
  const hasPngHeader = decoded.length >= 24
    && pngSignature.every((byte, index) => decoded.charCodeAt(index) === byte)
    && decoded.slice(12, 16) === "IHDR";
  if (!hasPngHeader) throw new TypeError("대화형 HTML에 넣을 원본 출처 표시 이미지를 확인할 수 없습니다.");
  return value;
}

function requirePublicAttributionText(value, maximumLength, label) {
  if (typeof value !== "string") throw new TypeError(`${label}은 문자열이어야 합니다.`);
  const text = value.trim();
  if (!text || text.length > maximumLength || !isPublicGatewayTextSafe(text)) {
    throw new TypeError(`${label}에 공개할 수 없는 정보가 포함되어 있습니다.`);
  }
  return text;
}

function isPublicAttributionTreeSafe(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    return isPublicGatewayTextSafe(value)
      || /^https:\/\/doi\.org\/10\.\d{4,9}\/[a-z0-9._()\-;/:]+$/iu.test(value)
      || /^https:\/\/github\.com\/[a-z0-9](?:[a-z0-9-]{0,38})(?:\/[a-z0-9._-]+)?$/iu.test(value)
      || value === kmaAsosSourceUrl
      || /^data:image\/png;base64,[a-z0-9+/=]+$/iu.test(value);
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).every((item) => isPublicAttributionTreeSafe(item, seen));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requirePublicExportDataMode(value) {
  if (!publicExportDataModes.has(value)) {
    throw new TypeError("자료 내보내기 dataMode는 bias-corrected 또는 raw-model-grid여야 합니다.");
  }
  return value;
}

function requirePublicDatasetIdentity(value) {
  const datasetVersion = value?.datasetVersion;
  if (typeof datasetVersion !== "string" || !/^[a-f0-9]{64}$/u.test(datasetVersion)) {
    throw new TypeError("공개 자료판 식별자는 64자리 소문자 SHA-256이어야 합니다.");
  }
  return {
    datasetVersion,
    datasetUpdatedAt: requireUtcTimestamp(value?.datasetUpdatedAt, "자료 갱신 시각")
  };
}

function requireOptionalUtcTimestamp(value, label) {
  return value === undefined || value === null || value === "" ? "" : requireUtcTimestamp(value, label);
}

function requireUtcTimestamp(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label}은 UTC 시각 문자열이어야 합니다.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/u.exec(value);
  if (!match) throw new TypeError(`${label}은 UTC ISO-8601 형식이어야 합니다.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid = year >= 1000
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute
    && parsed.getUTCSeconds() === second;
  if (!valid) throw new TypeError(`${label}이 유효하지 않습니다.`);
  return value;
}

export function seriesPointX(position, count, left, width) {
  const values = [position, count, left, width].map(Number);
  if (!values.every(Number.isFinite) || values[1] < 1 || values[3] < 0) {
    throw new TypeError("그래프 좌표 계산값이 올바르지 않습니다.");
  }
  return values[2] + (values[1] === 1 ? values[3] / 2 : values[0] / (values[1] - 1) * values[3]);
}

function normalizeChartWindow(start, end, total) {
  const count = Math.max(1, Math.round(Number(total)));
  if (!Number.isFinite(count)) throw new TypeError("그래프 자료 개수가 올바르지 않습니다.");
  const safeStart = Math.min(count - 1, Math.max(0, Math.round(Number(start) || 0)));
  const safeEnd = Math.min(count, Math.max(safeStart + 1, Math.round(Number(end) || count)));
  return { start: safeStart, end: safeEnd, total: count };
}

function serializeSeriesGroup(group) {
  const values = group && typeof group === "object" ? group : {};
  return {
    p10: serializeNumericSeries(values.p10),
    p50: serializeNumericSeries(values.p50),
    p90: serializeNumericSeries(values.p90)
  };
}

function serializeNumericSeries(values) {
  return Array.isArray(values) ? values.map((value) => typeof value === "number" && Number.isFinite(value) ? value : null) : [];
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function snapshotLines(title, snapshot) {
  return [
    `${title}: ${snapshot.label}`,
    `날짜: ${snapshot.date}`,
    `좌표: ${formatCoordinatePair(snapshot.latitude, snapshot.longitude)}`,
    ...snapshot.values.map((metric) => `${metric.label}: ${formatSnapshotMetricValue(metric)}`)
  ];
}

function formatSnapshotMetricValue(metric) {
  return formatPublicMetricValue({
    key: metric.key,
    numericValue: metric.value,
    unit: metric.unit
  });
}

function formatNumber(value) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function csvNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function csvCell(value) {
  const text = String(value ?? "");
  const numericText = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+\-]?\d+)?$/iu.test(text);
  const protectedText = typeof value === "string" && !numericText && /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
}

function safeText(value, maximumLength) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").trim().slice(0, maximumLength);
}

function validDate(value) {
  const text = String(value ?? "");
  if (!isCompleteDateValue(text)) {
    throw new TypeError("유효한 날짜가 필요합니다.");
  }
  return text;
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new RangeError(`${minimum}에서 ${maximum} 사이의 숫자가 필요합니다.`);
  }
  return number;
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new RangeError(`${minimum}에서 ${maximum} 사이의 정수가 필요합니다.`);
  }
  return number;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlToBytes(encoded) {
  const normalized = String(encoded ?? "").replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
