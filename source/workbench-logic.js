const lessonStateVersion = 1;
const maximumNoteLength = 2000;

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
  const payload = JSON.stringify({
    version: lessonStateVersion,
    source,
    date: validDate(value.date),
    latitude: boundedNumber(value.latitude, -85.05112878, 85.05112878),
    longitude: boundedNumber(value.longitude, -180, 180),
    scenario: safeText(value.scenario, 80),
    model: safeText(value.model, 120),
    focus: safeText(value.focus ?? "heat", 24)
  });
  return bytesToBase64Url(new TextEncoder().encode(payload));
}

export function decodeLessonState(encoded) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
    if (parsed?.version !== lessonStateVersion) return undefined;
    return {
      source: parsed.source === "public" ? "public" : "teacher",
      date: validDate(parsed.date),
      latitude: boundedNumber(parsed.latitude, -85.05112878, 85.05112878),
      longitude: boundedNumber(parsed.longitude, -180, 180),
      scenario: safeText(parsed.scenario, 80),
      model: safeText(parsed.model, 120),
      focus: safeText(parsed.focus ?? "heat", 24)
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
    id: `${validDate(context.date)}:${boundedNumber(context.latitude, -85.05112878, 85.05112878).toFixed(4)}:${boundedNumber(context.longitude, -180, 180).toFixed(4)}:${safeText(context.model, 120)}`,
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
  if (temperature) parts.push(`최고 기온은 ${formatNumber(temperature.numericValue)}℃입니다.`);
  if (comfort) parts.push(`이 날 체감온도는 ${formatNumber(comfort.numericValue)}℃입니다.`);
  if (rain) parts.push(`예상 평균 일일 강수량은 ${formatNumber(rain.numericValue)}mm입니다.`);
  if (wind) parts.push(`평균 풍속은 ${formatNumber(wind.numericValue)}m/s입니다.`);
  return `${parts.slice(0, 3).join(" ")} 이 값은 기후 시나리오에 근거한 자료이며 단기 일기예보가 아닙니다.`;
}

export function formatPublicMetricValue(metric) {
  if (!Number.isFinite(metric?.numericValue)) return String(metric?.value ?? "자료 없음");
  const value = formatNumber(metric.numericValue);
  if (["tasmax", "tasmin", "apparentTemperature", "heatIndex", "feelsLike"].includes(metric.key)) return `${value}℃`;
  if (metric.key === "precipitation") return `${value} mm/day`;
  if (metric.key === "wind") return `${value} m/s`;
  return `${value}${metric.unit ? ` ${metric.unit}` : ""}`;
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

export function buildTeacherActivityText({ lessonTitle, objective, snapshots, studentLink }) {
  const lines = [
    "기후 타임캡슐 수업 활동",
    `수업명: ${safeText(lessonTitle, 120)}`,
    `학습 목표: ${safeText(objective, 300)}`,
    `학생용 탐색 링크: ${safeText(studentLink, 2000)}`,
    "",
    "비교 조건"
  ];
  snapshots.forEach((snapshot, index) => {
    lines.push(`${index + 1}. ${snapshot.label} · ${snapshot.date} · 위도 ${snapshot.latitude.toFixed(4)}, 경도 ${snapshot.longitude.toFixed(4)} · ${snapshot.model}`);
    snapshot.values.forEach((metric) => lines.push(`   ${metric.label}: ${formatNumber(metric.value)} ${metric.unit}`));
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
    "attribution_labels"
  ];
  const attribution = Array.isArray(response.attributionLabels) ? response.attributionLabels.join(" | ") : "";
  const rows = [header];
  response.dates.forEach((date, dateIndex) => {
    response.metrics.forEach((metric) => {
      const exportSeries = resolveExportPercentiles(metric, response.dataMode);
      rows.push([
        date,
        Number(response.latitude).toFixed(6),
        Number(response.longitude).toFixed(6),
        response.scenario,
        response.model,
        metric.key,
        metric.label,
        metric.unit,
        metric.key === "apparentTemperature" ? apparentTemperatureBasis(date).key : "",
        response.dataMode,
        csvNumber(exportSeries.corrected?.p10[dateIndex]),
        csvNumber(exportSeries.corrected?.p50[dateIndex]),
        csvNumber(exportSeries.corrected?.p90[dateIndex]),
        csvNumber(exportSeries.raw?.p10[dateIndex]),
        csvNumber(exportSeries.raw?.p50[dateIndex]),
        csvNumber(exportSeries.raw?.p90[dateIndex]),
        metric.coverage[dateIndex] ? "available" : "missing",
        String(metric.modelCounts[dateIndex] ?? 0),
        response.nearestDistanceKm === void 0 ? "" : Number(response.nearestDistanceKm).toFixed(3),
        response.generatedAt ?? "",
        attribution
      ]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function seriesPointX(position, count, left, width) {
  const values = [position, count, left, width].map(Number);
  if (!values.every(Number.isFinite) || values[1] < 1 || values[3] < 0) {
    throw new TypeError("그래프 좌표 계산값이 올바르지 않습니다.");
  }
  return values[2] + (values[1] === 1 ? values[3] / 2 : values[0] / (values[1] - 1) * values[3]);
}

function snapshotLines(title, snapshot) {
  return [
    `${title}: ${snapshot.label}`,
    `날짜: ${snapshot.date}`,
    `좌표: ${snapshot.latitude.toFixed(4)}, ${snapshot.longitude.toFixed(4)}`,
    ...snapshot.values.map((metric) => `${metric.label}: ${formatNumber(metric.value)} ${metric.unit}`)
  ];
}

function formatNumber(value) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function csvNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
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
