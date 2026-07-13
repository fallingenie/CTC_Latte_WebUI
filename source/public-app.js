import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRef, useState, useEffect, useLayoutEffect, useMemo, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { X, CalendarDays, Download, Table2, FileText, Image, Eye, ThermometerSun, ThermometerSnowflake, CloudRain, Wind, Check, LoaderCircle, CloudSun, Search, MapPin, GraduationCap, UsersRound, HardDriveDownload, PlayCircle, Activity, School, Globe2, LocateFixed, Droplets, TriangleAlert, Gauge, Mountain, Waves, ArrowRight, Sun, Moon, Monitor, BookOpen, BookmarkPlus, ClipboardCopy, Navigation, Plus, Trash2, NotebookPen, Target, Link, RefreshCw } from "lucide-react";
import { requestSaveTarget, saveBlobToTarget } from "./browser-download.js";
import {
  buildPlainLanguageSummary,
  buildStudentNotebookText,
  buildTeacherActivityText,
  calendarPeriodEnd,
  compareMetricSnapshots,
  createMetricSnapshot,
  decodeLessonState,
  encodeLessonState,
  isCompleteDateValue,
  mapScaleForZoom,
  mapZoomAfterWheel,
  normalizeMetadataOptions,
  parseHashLocation,
  resolveExportPercentiles,
  sanitizeNote,
  seriesPointX
} from "./workbench-logic.js";
async function exportClimateSeries(response, format) {
  const stem = climateExportFileStem(response);
  const specifications = {
    csv: { filename: `${stem}.csv`, mimeType: "text/csv", extension: ".csv", description: "기후 시계열 CSV" },
    png: { filename: `${stem}.png`, mimeType: "image/png", extension: ".png", description: "기후 시계열 이미지" },
    pdf: { filename: `${stem}.pdf`, mimeType: "application/pdf", extension: ".pdf", description: "기후 시계열 보고서" }
  };
  const specification = specifications[format] ?? specifications.pdf;
  const target = await requestSaveTarget(specification);
  if (target.kind === "cancelled") return saveBlobToTarget(target, new Blob());
  let blob;
  if (format === "csv") {
    blob = new Blob([buildClimateCsv(response)], { type: "text/csv;charset=utf-8" });
  } else {
    const canvas = await buildClimateReportCanvas(response);
    blob = format === "png" ? await canvasBlob(canvas, "image/png") : await canvasPdfBlob(canvas);
  }
  return saveBlobToTarget(target, blob);
}
function buildClimateCsv(response) {
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
    "nearest_reference_distance_km"
  ];
  const rows = [header];
  response.dates.forEach((date, dateIndex) => {
    response.metrics.forEach((metric) => {
      const exportSeries = resolveExportPercentiles(metric, response.dataMode);
      rows.push([
        date,
        response.latitude.toFixed(6),
        response.longitude.toFixed(6),
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
        response.nearestDistanceKm === void 0 ? "" : response.nearestDistanceKm.toFixed(3)
      ]);
    });
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
function climateExportFileStem(response) {
  const metricPart = response.metrics.length === 1 ? response.metrics[0].key : "all-metrics";
  return `climate-series_${metricPart}_${response.dateStart}_${response.dateEnd}`;
}
function csvNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}
function csvCell(value) {
  return `"${value.replace(/"/g, '""')}"`;
}
async function buildClimateReportCanvas(response) {
  const width = 1600;
  const chartHeight = 230;
  const headerHeight = 390;
  const footerHeight = 220;
  const height = headerHeight + response.metrics.length * chartHeight + footerHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지 생성 기능을 사용할 수 없습니다.");
  context.fillStyle = "#f4f7f6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(42, 42, width - 84, height - 84, 22);
  context.fill();
  context.strokeStyle = "#c7d3e1";
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = "#14213d";
  context.font = '700 50px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText("미래 기후 기간 보고서", 88, 120);
  context.fillStyle = "#5b6577";
  context.font = '26px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(`${response.dateStart} ~ ${response.dateEnd} · ${response.dates.length.toLocaleString("ko-KR")}일`, 88, 174);
  context.fillText(
    `위도 ${response.latitude.toFixed(4)}, 경도 ${response.longitude.toFixed(4)} · ${response.scenario} · ${response.model}`,
    88,
    220
  );
  context.fillStyle = response.coverage === "available" ? "#25845f" : "#a35d0b";
  context.font = '700 24px "Segoe UI", "Noto Sans KR", sans-serif';
  const coverageText = response.dataMode === "raw-model-grid" ? "선택 좌표의 기후모델 원자료 격자값 확인 완료" : response.coverage === "available" ? "선택 기간 자료 확인 완료" : "일부 값은 제공 가능한 모델 범위를 사용";
  context.fillText(coverageText, 88, 276);
  context.fillStyle = "#5b6577";
  context.font = '22px "Segoe UI", "Noto Sans KR", sans-serif';
  if (response.nearestDistanceKm !== void 0) {
    context.fillText(`가장 가까운 기준 지점까지 약 ${response.nearestDistanceKm.toFixed(1)}킬로미터`, 88, 320);
  }
  response.metrics.forEach((metric, metricIndex) => {
    drawMetricChart(context, response, metric, 88, headerHeight + metricIndex * chartHeight, width - 176, chartHeight - 30);
  });
  const footerY = headerHeight + response.metrics.length * chartHeight + 22;
  context.fillStyle = "#5b6577";
  context.font = '20px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(
    response.dataMode === "raw-model-grid" ? "굵은 선은 기후모델 원자료 p50, 음영은 p10~p90 범위입니다. 관측자료 기반 보정은 적용되지 않았습니다." : "굵은 선은 보정 후 p50, 음영은 p10~p90 범위입니다. 보정 전 값 선택 시 황색 선을 함께 표시합니다.",
    88,
    footerY
  );
  context.fillText("이 자료는 기후 시나리오 교육·연구용 결과이며 단기 기상예보가 아닙니다.", 88, footerY + 38);
  const attribution = response.attributionLabels.join(" · ") || "기후자료 출처 정보 포함";
  context.fillText(`자료 고지: ${attribution}`, 88, footerY + 76);
  context.fillText(`생성 시각: ${new Date(response.generatedAt).toLocaleString("ko-KR")}`, 88, footerY + 114);
  return canvas;
}
function drawMetricChart(context, response, metric, left, top, width, height) {
  context.fillStyle = "#14213d";
  context.font = '700 26px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(`${metric.label} (${metric.unit})`, left, top + 30);
  context.fillStyle = "#7c8797";
  context.font = '19px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(`자료 ${metric.availableCount.toLocaleString("ko-KR")} / ${response.dates.length.toLocaleString("ko-KR")}일`, left + 250, top + 30);
  const plotLeft = left + 76;
  const plotTop = top + 52;
  const plotWidth = width - 96;
  const plotHeight = height - 82;
  const indexes = sampledIndexes(response.dates.length, 420);
  const valueSets = [metric.corrected.p10, metric.corrected.p50, metric.corrected.p90];
  if (metric.raw && response.dataMode !== "raw-model-grid") valueSets.push(metric.raw.p10, metric.raw.p50, metric.raw.p90);
  const values = valueSets.flatMap((items) => indexes.map((index) => items[index])).filter(isFiniteNumber$1);
  const [minimum, maximum] = paddedRange(values);
  const point = (indexPosition, value) => ({
    x: seriesPointX(indexPosition, indexes.length, plotLeft, plotWidth),
    y: plotTop + plotHeight - (value - minimum) / (maximum - minimum) * plotHeight
  });
  context.strokeStyle = "#dde6f0";
  context.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick += 1) {
    const y = plotTop + tick / 4 * plotHeight;
    context.beginPath();
    context.moveTo(plotLeft, y);
    context.lineTo(plotLeft + plotWidth, y);
    context.stroke();
  }
  context.fillStyle = "#7c8797";
  context.font = '17px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(maximum.toFixed(1), left, plotTop + 7);
  context.fillText(minimum.toFixed(1), left, plotTop + plotHeight);
  context.fillText(response.dates[0] ?? "", plotLeft, plotTop + plotHeight + 25);
  context.fillText(response.dates.at(-1) ?? "", plotLeft + plotWidth - 104, plotTop + plotHeight + 25);
  drawCanvasBand(context, indexes, metric.corrected.p10, metric.corrected.p90, point, "rgba(37,132,95,0.16)");
  drawCanvasLine(context, indexes, metric.corrected.p50, point, "#25845f", 4);
  if (metric.raw && response.dataMode !== "raw-model-grid") drawCanvasLine(context, indexes, metric.raw.p50, point, "#d99b25", 3);
}
function drawCanvasBand(context, indexes, lower, upper, point, fill) {
  const segments = [];
  let segment = [];
  let previousIndex;
  indexes.forEach((index, position) => {
    const low = lower[index];
    const high = upper[index];
    if (!isFiniteNumber$1(low) || !isFiniteNumber$1(high)) {
      if (segment.length) segments.push(segment);
      segment = [];
      previousIndex = void 0;
      return;
    }
    const uninterrupted = previousIndex === void 0 || lower.slice(previousIndex + 1, index + 1).every((value, offset) => isFiniteNumber$1(value) && isFiniteNumber$1(upper[previousIndex + offset + 1]));
    if (!uninterrupted && segment.length) {
      segments.push(segment);
      segment = [];
    }
    segment.push({ low: point(position, low), high: point(position, high) });
    previousIndex = index;
  });
  if (segment.length) segments.push(segment);
  segments.filter((pairs) => pairs.length >= 2).forEach((pairs) => {
    context.beginPath();
    pairs.forEach(({ low }, index) => index === 0 ? context.moveTo(low.x, low.y) : context.lineTo(low.x, low.y));
    [...pairs].reverse().forEach(({ high }) => context.lineTo(high.x, high.y));
    context.closePath();
    context.fillStyle = fill;
    context.fill();
  });
}
function drawCanvasLine(context, indexes, values, point, stroke, width) {
  let hasPoint = false;
  let previousIndex;
  const points = [];
  context.beginPath();
  indexes.forEach((index, position) => {
    const value = values[index];
    if (!isFiniteNumber$1(value)) {
      previousIndex = void 0;
      return;
    }
    const next = point(position, value);
    const uninterrupted = previousIndex !== void 0 && values.slice(previousIndex + 1, index + 1).every(isFiniteNumber$1);
    if (!uninterrupted) context.moveTo(next.x, next.y);
    else context.lineTo(next.x, next.y);
    points.push(next);
    previousIndex = index;
    hasPoint = true;
  });
  if (!hasPoint) return;
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.stroke();
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, Math.max(6, width * 1.75), 0, Math.PI * 2);
    context.fillStyle = stroke;
    context.fill();
  }
}
function sampledIndexes(length, maximum) {
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  return Array.from(new Set(Array.from({ length: maximum }, (_, index) => Math.round(index * (length - 1) / (maximum - 1)))));
}
function paddedRange(values) {
  if (!values.length) return [-1, 1];
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (Math.abs(maximum - minimum) < 1e-6) {
    minimum -= 1;
    maximum += 1;
  }
  const padding = Math.max((maximum - minimum) * 0.08, 0.5);
  return [minimum - padding, maximum + padding];
}
function isFiniteNumber$1(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("이미지 파일을 만들지 못했습니다.")), type, quality);
  });
}
async function canvasPdfBlob(canvas) {
  const jpeg = new Uint8Array(await (await canvasBlob(canvas, "image/jpeg", 0.94)).arrayBuffer());
  const pageWidth = 842;
  const pageHeight = Math.round(pageWidth * canvas.height / canvas.width);
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [0];
  let byteLength = 0;
  const append = (value) => {
    const bytes = typeof value === "string" ? encoder.encode(value) : value;
    parts.push(bytes);
    byteLength += bytes.byteLength;
  };
  const object = (id, body, suffix = "") => {
    offsets[id] = byteLength;
    append(`${id} 0 obj
`);
    append(body);
    append(`${suffix}
endobj
`);
  };
  append("%PDF-1.4\n%CTC\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
  );
  offsets[4] = byteLength;
  append(`4 0 obj
<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>
stream
`);
  append(jpeg);
  append("\nendstream\nendobj\n");
  const content = `q
${pageWidth} 0 0 ${pageHeight} 0 0 cm
/Im0 Do
Q
`;
  object(5, `<< /Length ${encoder.encode(content).byteLength} >>
stream
${content}endstream`);
  const xrefOffset = byteLength;
  const newline = String.fromCharCode(10);
  append(["xref", "0 6", "0000000000 65535 f ", ""].join(newline));
  for (let id = 1; id <= 5; id += 1) {
    append(`${String(offsets[id]).padStart(10, "0")} 00000 n ${newline}`);
  }
  append(`trailer
<< /Size 6 /Root 1 0 R >>
startxref
${xrefOffset}
%%EOF
`);
  const output = new Uint8Array(byteLength);
  let cursor = 0;
  parts.forEach((part) => {
    output.set(part, cursor);
    cursor += part.byteLength;
  });
  return new Blob([output.buffer], { type: "application/pdf" });
}
const configPath = "./runtime-config.json";
const defaultReadPath = "/api/climate/query";
const defaultTimeoutMs = 10 * 60 * 1e3;
let configPromise;
async function fetchPublicClimateQuery(request) {
  const config = await loadPublicClimateConfig();
  return fetchClimateJson(config.readPath, "POST", request, config.timeoutMs);
}
async function fetchPublicClimateSeries(request) {
  const config = await loadPublicClimateConfig();
  return fetchClimateJson(replaceEndpoint(config.readPath, "series"), "POST", request, config.timeoutMs);
}
async function fetchPublicClimateMetadata() {
  const config = await loadPublicClimateConfig();
  return fetchClimateJson(replaceEndpoint(config.readPath, "metadata"), "GET", void 0, config.timeoutMs);
}
async function loadPublicClimateConfig() {
  configPromise ??= fetch(configPath, { headers: { Accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error("기후자료 연결 정보를 확인할 수 없습니다.");
    const value = await response.json();
    const readPath = typeof value.readPath === "string" ? value.readPath.trim() : "";
    if (readPath !== defaultReadPath || value.publicSafe !== true) {
      throw new Error("기후자료 연결 정보가 공개 조회 기준과 맞지 않습니다.");
    }
    const requestedTimeout = typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) ? Math.round(value.timeoutMs) : defaultTimeoutMs;
    return {
      readPath,
      timeoutMs: Math.min(defaultTimeoutMs, Math.max(3e4, requestedTimeout))
    };
  }).catch((error) => {
    configPromise = void 0;
    throw error;
  });
  return configPromise;
}
async function fetchClimateJson(path, method, body, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`기후자료 응답을 확인할 수 없습니다. 상태 ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("기후자료")) throw error;
    if (controller.signal.aborted) throw new Error("기후자료 조회 시간이 길어 요청을 마쳤습니다. 잠시 후 다시 시도하세요.");
    throw new Error("기후자료를 불러오는 중 연결이 끊겼습니다. 잠시 후 다시 시도하세요.");
  } finally {
    window.clearTimeout(timer);
  }
}
function replaceEndpoint(readPath, endpoint) {
  return readPath.replace(/\/query$/u, `/${endpoint}`);
}
const metricOptions = [
  { key: "tasmax", label: "최고기온", icon: ThermometerSun },
  { key: "tasmin", label: "최저기온", icon: ThermometerSnowflake },
  { key: "precipitation", label: "강수량", icon: CloudRain },
  { key: "wind", label: "풍속", icon: Wind },
  { key: "apparentTemperature", label: "월별 체감 지표", icon: CloudSun }
];
const formatOptions = [
  { key: "csv", label: "CSV", detail: "전체 일별 수치", icon: Table2 },
  { key: "pdf", label: "PDF", detail: "보고서와 그래프", icon: FileText },
  { key: "png", label: "PNG", detail: "고해상도 이미지", icon: Image }
];
function ClimateExportDialog({ context, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const openerRef = useRef(null);
  const [metadata, setMetadata] = useState();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedMetrics, setSelectedMetrics] = useState([]);
  const [includeRaw, setIncludeRaw] = useState(false);
  const [format, setFormat] = useState("csv");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("기간과 자료를 선택한 뒤 미리보기를 불러오세요.");
  const [response, setResponse] = useState();
  const [previewMetric, setPreviewMetric] = useState("tasmax");
  useEffect(() => {
    if (!context) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let active = true;
    setStartDate(context.date);
    setEndDate(context.date);
    setSelectedMetrics(context.initialMetrics);
    setPreviewMetric(context.initialMetrics[0] ?? "tasmax");
    setIncludeRaw(context.includeRaw);
    setFormat(context.initialFormat ?? "csv");
    setResponse(void 0);
    setStatus("idle");
    setMessage("기간과 자료를 선택한 뒤 미리보기를 불러오세요.");
    fetchPublicClimateMetadata().then((nextMetadata) => {
      if (!active || !nextMetadata.publicSafe || !nextMetadata.ready) return;
      setMetadata(nextMetadata);
      const clipped = clipPeriod(context.date, context.date, nextMetadata.dateStart, nextMetadata.dateEnd);
      setStartDate(clipped.start);
      setEndDate(clipped.end);
    }).catch(() => {
      if (active) setMessage("자료 제공 기간을 확인하지 못했습니다. 현재 날짜로 조회할 수 있습니다.");
    });
    window.setTimeout(() => closeButtonRef.current?.focus(), 40);
    return () => {
      active = false;
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [context]);
  useEffect(() => {
    if (!context) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [context]);
  const busy = status === "loading" || status === "exporting";
  const dayCount = inclusiveDayCount(startDate, endDate);
  const selectedMetric = response?.metrics.find((metric) => metric.key === previewMetric) ?? response?.metrics[0];
  useEffect(() => {
    if (!busy) return;
    const preventRefresh = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventRefresh);
    return () => window.removeEventListener("beforeunload", preventRefresh);
  }, [busy]);
  const markDirty = (nextMessage = "조건이 바뀌었습니다. 미리보기를 다시 불러오세요.") => {
    setResponse(void 0);
    setStatus("idle");
    setMessage(nextMessage);
  };
  const updatePeriod = (start, end) => {
    setStartDate(start);
    setEndDate(end);
    markDirty();
  };
  const applyQuickPeriod = (kind) => {
    if (!context) return;
    const bounds = metadata ?? {
      dateStart: context.date,
      dateEnd: context.date
    };
    const selected = parseDate(context.date);
    let nextStart = context.date;
    let nextEnd = context.date;
    if (kind === "month") {
      nextStart = formatDate(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth(), 1)));
      nextEnd = formatDate(new Date(Date.UTC(selected.getUTCFullYear(), selected.getUTCMonth() + 1, 0)));
    } else if (kind === "year") {
      nextEnd = calendarPeriodEnd(context.date, 1);
    } else if (kind === "fiveYears") {
      nextEnd = calendarPeriodEnd(context.date, 5);
    } else if (kind === "tenYears") {
      nextEnd = calendarPeriodEnd(context.date, 10);
    } else if (kind === "full") {
      nextStart = bounds.dateStart;
      nextEnd = bounds.dateEnd;
    }
    const clipped = clipPeriod(nextStart, nextEnd, bounds.dateStart, bounds.dateEnd);
    updatePeriod(clipped.start, clipped.end);
  };
  const toggleMetric = (key) => {
    const next = selectedMetrics.includes(key) ? selectedMetrics.filter((metric) => metric !== key) : [...selectedMetrics, key];
    if (next.length === 0) {
      setMessage("기후지표를 하나 이상 선택하세요.");
      return;
    }
    setSelectedMetrics(next);
    if (!next.includes(previewMetric)) setPreviewMetric(next[0]);
    markDirty();
  };
  const loadPreview = async () => {
    if (!context) return;
    if (!isValidPeriod(startDate, endDate)) {
      setStatus("error");
      setMessage("시작일과 종료일을 확인하세요. 종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }
    setStatus("loading");
    setMessage(`${dayCount.toLocaleString("ko-KR")}일의 실제 기후자료를 불러오고 있습니다. 새로고침하지 마세요.`);
    try {
      const requestMetrics = expandMetricKeys(selectedMetrics);
      const payload = await fetchPublicClimateSeries({
        latitude: context.latitude,
        longitude: context.longitude,
        startDate,
        endDate,
        scenario: context.scenario,
        model: context.model,
        metrics: requestMetrics,
        includeRaw
      });
      if (!isClimateSeriesResponse(payload, { startDate, endDate, selectedMetrics: requestMetrics })) {
        throw new Error("선택 조건과 기간 응답이 일치하지 않습니다.");
      }
      const displayPayload = collapseApparentTemperatureSeries(payload, selectedMetrics);
      setResponse(displayPayload);
      setPreviewMetric(displayPayload.metrics[0]?.key ?? selectedMetrics[0]);
      setStatus("ready");
      setMessage(
        displayPayload.coverage === "available" ? `${displayPayload.dates.length.toLocaleString("ko-KR")}일 자료를 확인했습니다.` : displayPayload.fallbackReason ?? "일부 날짜의 자료 제공 범위를 확인하세요."
      );
    } catch (error) {
      setResponse(void 0);
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "기간 자료를 불러오지 못했습니다.");
    }
  };
  const exportFile = async () => {
    if (!response) return;
    setStatus("exporting");
    setMessage(`${format.toUpperCase()} 파일을 만들고 있습니다.`);
    try {
      const result = await exportClimateSeries(response, format);
      setStatus("ready");
      if (result.outcome === "written") {
        setMessage(`${result.filename} 파일을 저장했습니다.`);
      } else if (result.outcome === "cancelled") {
        setMessage("파일 저장을 취소했습니다.");
      } else {
        setMessage(`${result.filename} 다운로드를 요청했습니다. 브라우저의 다운로드 목록에서 파일을 확인하세요.`);
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "파일을 만들지 못했습니다.");
    }
  };
  const requestClose = () => {
    if (!busy) onClose();
  };
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  if (!context) return null;
  return /* @__PURE__ */ jsx("div", { className: "export-dialog-backdrop", onMouseDown: (event) => event.target === event.currentTarget && requestClose(), children: /* @__PURE__ */ jsxs(
    "section",
    {
      "aria-labelledby": "export-dialog-title",
      "aria-modal": "true",
      className: "export-dialog",
      onKeyDown: handleKeyDown,
      ref: dialogRef,
      role: "dialog",
      children: [
        /* @__PURE__ */ jsxs("header", { className: "export-dialog-header", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { className: "export-eyebrow", children: "기간 자료 내보내기" }),
            /* @__PURE__ */ jsx("h2", { id: "export-dialog-title", children: "필요한 기간과 형식을 선택하세요" }),
            /* @__PURE__ */ jsx("p", { children: "선택 좌표의 실제 시나리오 값을 확인한 뒤 CSV, PDF 또는 PNG로 저장합니다." })
          ] }),
          /* @__PURE__ */ jsx("button", { "aria-label": "내보내기 창 닫기", className: "icon-button", disabled: busy, onClick: requestClose, ref: closeButtonRef, type: "button", children: /* @__PURE__ */ jsx(X, { size: 20 }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "export-dialog-body", children: [
          /* @__PURE__ */ jsxs("aside", { className: "export-controls", children: [
            /* @__PURE__ */ jsxs("fieldset", { disabled: busy, children: [
              /* @__PURE__ */ jsxs("legend", { children: [
                /* @__PURE__ */ jsx(CalendarDays, { size: 17 }),
                " 기간"
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "period-shortcuts", children: [
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("day"), type: "button", children: "선택일" }),
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("month"), type: "button", children: "선택 월" }),
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("year"), type: "button", children: "1년" }),
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("fiveYears"), type: "button", children: "5년" }),
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("tenYears"), type: "button", children: "10년" }),
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("full"), type: "button", children: "전체" })
              ] }),
              /* @__PURE__ */ jsxs("div", { className: "export-date-grid", children: [
                /* @__PURE__ */ jsxs("label", { children: [
                  "시작일",
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      max: metadata?.dateEnd,
                      min: metadata?.dateStart,
                      onChange: (event) => updatePeriod(event.target.value, endDate),
                      type: "date",
                      value: startDate
                    }
                  )
                ] }),
                /* @__PURE__ */ jsxs("label", { children: [
                  "종료일",
                  /* @__PURE__ */ jsx(
                    "input",
                    {
                      max: metadata?.dateEnd,
                      min: metadata?.dateStart,
                      onChange: (event) => updatePeriod(startDate, event.target.value),
                      type: "date",
                      value: endDate
                    }
                  )
                ] })
              ] }),
              /* @__PURE__ */ jsx("small", { children: dayCount > 0 ? `${dayCount.toLocaleString("ko-KR")}일 선택` : "기간을 확인하세요." })
            ] }),
            /* @__PURE__ */ jsxs("fieldset", { disabled: busy, children: [
              /* @__PURE__ */ jsxs("legend", { children: [
                /* @__PURE__ */ jsx(Download, { size: 17 }),
                " 출력 형식"
              ] }),
              /* @__PURE__ */ jsx("div", { className: "export-format-control", children: formatOptions.map(({ key, label, detail, icon: Icon }) => /* @__PURE__ */ jsxs("button", { "aria-pressed": format === key, className: format === key ? "selected" : "", onClick: () => setFormat(key), type: "button", children: [
                /* @__PURE__ */ jsx(Icon, { size: 19 }),
                /* @__PURE__ */ jsxs("span", { children: [
                  label,
                  /* @__PURE__ */ jsx("small", { children: detail })
                ] })
              ] }, key)) })
            ] }),
            /* @__PURE__ */ jsxs("fieldset", { disabled: busy, children: [
              /* @__PURE__ */ jsxs("legend", { children: [
                /* @__PURE__ */ jsx(Eye, { size: 17 }),
                " 기후지표"
              ] }),
              /* @__PURE__ */ jsx("div", { className: "export-metric-list", children: metricOptions.map(({ key, label, icon: Icon }) => /* @__PURE__ */ jsxs("label", { className: selectedMetrics.includes(key) ? "selected" : "", children: [
                /* @__PURE__ */ jsx("input", { checked: selectedMetrics.includes(key), onChange: () => toggleMetric(key), type: "checkbox" }),
                /* @__PURE__ */ jsx(Icon, { size: 18 }),
                /* @__PURE__ */ jsx("span", { children: label }),
                selectedMetrics.includes(key) ? /* @__PURE__ */ jsx(Check, { size: 16 }) : null
              ] }, key)) }),
              /* @__PURE__ */ jsxs("label", { className: "export-raw-toggle", children: [
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    checked: includeRaw,
                    onChange: (event) => {
                      setIncludeRaw(event.target.checked);
                      markDirty();
                    },
                    type: "checkbox"
                  }
                ),
                /* @__PURE__ */ jsx("span", { children: "보정 전 모델값 함께 포함" })
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("main", { className: "export-preview", children: [
            /* @__PURE__ */ jsxs("div", { className: "export-context-strip", children: [
              /* @__PURE__ */ jsx("span", { children: context.scenario }),
              /* @__PURE__ */ jsx("span", { children: context.model }),
              /* @__PURE__ */ jsxs("span", { children: [
                context.latitude.toFixed(4),
                ", ",
                context.longitude.toFixed(4)
              ] })
            ] }),
            response && selectedMetric ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx("div", { className: "preview-metric-tabs", role: "tablist", "aria-label": "미리보기 지표", children: response.metrics.map((metric) => /* @__PURE__ */ jsx(
                "button",
                {
                  "aria-selected": selectedMetric.key === metric.key,
                  className: selectedMetric.key === metric.key ? "selected" : "",
                  onClick: () => setPreviewMetric(metric.key),
                  role: "tab",
                  type: "button",
                  children: metric.label
                },
                metric.key
              )) }),
              /* @__PURE__ */ jsx(InteractiveSeriesChart, { dataMode: response.dataMode, dates: response.dates, metric: selectedMetric }),
              /* @__PURE__ */ jsxs("div", { className: "preview-summary-grid", children: [
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("span", { children: "조회 기간" }),
                  /* @__PURE__ */ jsxs("strong", { children: [
                    response.dates.length.toLocaleString("ko-KR"),
                    "일"
                  ] })
                ] }),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("span", { children: "자료가 있는 날" }),
                  /* @__PURE__ */ jsxs("strong", { children: [
                    selectedMetric.availableCount.toLocaleString("ko-KR"),
                    "일"
                  ] })
                ] }),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("span", { children: "단위" }),
                  /* @__PURE__ */ jsx("strong", { children: selectedMetric.unit })
                ] }),
                /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsx("span", { children: response.dataMode === "raw-model-grid" ? "자료 기준" : "기준 지점 거리" }),
                  /* @__PURE__ */ jsx("strong", { children: response.dataMode === "raw-model-grid" ? "원자료 격자" : response.nearestDistanceKm === void 0 ? "확인됨" : `${response.nearestDistanceKm.toFixed(1)}km` })
                ] })
              ] })
            ] }) : /* @__PURE__ */ jsxs("div", { className: `export-preview-empty ${status}`, children: [
              status === "loading" ? /* @__PURE__ */ jsx(LoaderCircle, { className: "spin", size: 30 }) : /* @__PURE__ */ jsx(Eye, { size: 30 }),
              /* @__PURE__ */ jsx("strong", { children: status === "loading" ? "기간 자료를 읽고 있습니다" : "내보낼 자료를 먼저 확인하세요" }),
              /* @__PURE__ */ jsx("p", { children: "기간, 지표와 보정 전 값 포함 여부를 정한 뒤 미리보기를 불러오면 그래프와 자료 수를 확인할 수 있습니다." })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("footer", { className: "export-dialog-footer", children: [
          /* @__PURE__ */ jsxs("div", { className: `export-dialog-status ${status}`, "aria-live": "polite", children: [
            status === "loading" || status === "exporting" ? /* @__PURE__ */ jsx(LoaderCircle, { className: "spin", size: 17 }) : status === "ready" ? /* @__PURE__ */ jsx(Check, { size: 17 }) : null,
            /* @__PURE__ */ jsx("span", { children: message })
          ] }),
          busy ? /* @__PURE__ */ jsx("div", { "aria-label": "기간 자료 처리 중", "aria-valuetext": "진행 중", className: "export-loading-progress", role: "progressbar", children: /* @__PURE__ */ jsx("span", {}) }) : null,
          /* @__PURE__ */ jsxs("div", { className: "export-dialog-actions", children: [
            /* @__PURE__ */ jsxs("button", { className: "secondary-action", disabled: busy, onClick: loadPreview, type: "button", children: [
              /* @__PURE__ */ jsx(Eye, { size: 17 }),
              " 자료 미리보기"
            ] }),
            /* @__PURE__ */ jsxs("button", { className: "primary-action", disabled: !response || busy, onClick: exportFile, type: "button", children: [
              /* @__PURE__ */ jsx(Download, { size: 17 }),
              " ",
              format.toUpperCase(),
              " 저장"
            ] })
          ] })
        ] })
      ]
    }
  ) });
}
function InteractiveSeriesChart({
  dataMode,
  dates,
  metric
}) {
  const [hoveredIndex, setHoveredIndex] = useState();
  const chart = useMemo(() => buildChartGeometry(dates, metric), [dates, metric]);
  const rawGrid = dataMode === "raw-model-grid";
  const hovered = hoveredIndex === void 0 ? void 0 : {
    date: dates[hoveredIndex],
    corrected: metric.corrected.p50[hoveredIndex],
    raw: metric.raw?.p50[hoveredIndex]
  };
  return /* @__PURE__ */ jsxs("div", { className: "interactive-series-chart", children: [
    /* @__PURE__ */ jsxs("div", { className: "chart-heading", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("strong", { children: [
          metric.label,
          " 기간 변화"
        ] }),
        /* @__PURE__ */ jsx("span", { children: metric.key === "apparentTemperature" ? "월별 기준: 5~9월 열지수, 10~4월 체감기온" : rawGrid ? "기후모델 원자료 p50과 p10~p90 범위" : "보정 후 p50과 p10~p90 범위" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "chart-legend", children: [
        /* @__PURE__ */ jsx("span", { className: "corrected", children: rawGrid ? "기후모델 원자료" : "보정 후" }),
        !rawGrid && metric.raw ? /* @__PURE__ */ jsx("span", { className: "raw", children: "보정 전" }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsxs(
      "svg",
      {
        "aria-label": `${metric.label} 기간 그래프`,
        onPointerLeave: () => setHoveredIndex(void 0),
        onPointerMove: (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          setHoveredIndex(Math.round(ratio * Math.max(dates.length - 1, 0)));
        },
        role: "img",
        viewBox: "0 0 760 280",
        children: [
          [0, 1, 2, 3, 4].map((tick) => /* @__PURE__ */ jsx("line", { className: "chart-gridline", x1: "48", x2: "740", y1: 28 + tick * 51, y2: 28 + tick * 51 }, tick)),
          chart.correctedBand ? /* @__PURE__ */ jsx("path", { className: "chart-band corrected", d: chart.correctedBand }) : null,
          chart.rawBand ? /* @__PURE__ */ jsx("path", { className: "chart-band raw", d: chart.rawBand }) : null,
          chart.correctedLine ? /* @__PURE__ */ jsx("path", { className: "chart-line corrected", d: chart.correctedLine }) : null,
          chart.rawLine ? /* @__PURE__ */ jsx("path", { className: "chart-line raw", d: chart.rawLine }) : null,
          chart.correctedPoint ? /* @__PURE__ */ jsx("circle", { className: "chart-point corrected", cx: chart.correctedPoint.x, cy: chart.correctedPoint.y, r: "5" }) : null,
          chart.rawPoint ? /* @__PURE__ */ jsx("circle", { className: "chart-point raw", cx: chart.rawPoint.x, cy: chart.rawPoint.y, r: "4" }) : null,
          /* @__PURE__ */ jsx("text", { x: "4", y: "34", children: chart.maximum.toFixed(1) }),
          /* @__PURE__ */ jsx("text", { x: "4", y: "238", children: chart.minimum.toFixed(1) }),
          /* @__PURE__ */ jsx("text", { x: "48", y: "272", children: dates[0] }),
          /* @__PURE__ */ jsx("text", { textAnchor: "end", x: "740", y: "272", children: dates.at(-1) }),
          hoveredIndex !== void 0 ? /* @__PURE__ */ jsx("line", { className: "chart-cursor", x1: chart.xForDate(hoveredIndex), x2: chart.xForDate(hoveredIndex), y1: "28", y2: "232" }) : null
        ]
      }
    ),
    hovered ? /* @__PURE__ */ jsxs("div", { className: "chart-hover-readout", children: [
      /* @__PURE__ */ jsx("strong", { children: hovered.date }),
      /* @__PURE__ */ jsxs("span", { children: [
        rawGrid ? "기후모델 원자료" : "보정 후",
        " ",
        displayChartValue(hovered.corrected, metric.unit)
      ] }),
      !rawGrid && metric.raw ? /* @__PURE__ */ jsxs("span", { children: [
        "보정 전 ",
        displayChartValue(hovered.raw, metric.unit)
      ] }) : null
    ] }) : /* @__PURE__ */ jsx("div", { className: "chart-hover-readout muted", children: "그래프 위에서 날짜별 값을 확인할 수 있습니다." })
  ] });
}
function buildChartGeometry(dates, metric) {
  const indexes = sampleIndexes(dates.length, 320);
  const arrays = [metric.corrected.p10, metric.corrected.p50, metric.corrected.p90];
  if (metric.raw) arrays.push(metric.raw.p10, metric.raw.p50, metric.raw.p90);
  const values = arrays.flatMap((items) => indexes.map((index) => items[index])).filter(isFiniteNumber);
  let minimum = values.length ? Math.min(...values) : -1;
  let maximum = values.length ? Math.max(...values) : 1;
  if (Math.abs(maximum - minimum) < 1e-6) {
    minimum -= 1;
    maximum += 1;
  }
  const padding = Math.max((maximum - minimum) * 0.08, 0.5);
  minimum -= padding;
  maximum += padding;
  const xForPosition = (position) => seriesPointX(position, indexes.length, 48, 692);
  const xForDate = (dateIndex) => seriesPointX(dateIndex, dates.length, 48, 692);
  const yForValue = (value) => 28 + 204 - (value - minimum) / (maximum - minimum) * 204;
  const line = (items) => {
    let path = "";
    let previousIndex;
    indexes.forEach((index, position) => {
      const value = items[index];
      if (!isFiniteNumber(value)) {
        previousIndex = void 0;
        return;
      }
      const uninterrupted = previousIndex !== void 0 && items.slice(previousIndex + 1, index + 1).every(isFiniteNumber);
      path += `${uninterrupted ? " L" : " M"}${xForPosition(position)},${yForValue(value)}`;
      previousIndex = index;
    });
    return path.trim();
  };
  const band = (lower, upper) => {
    const segments = [];
    let segment = [];
    let previousIndex;
    indexes.forEach((index, position) => {
      const low = lower[index];
      const high = upper[index];
      if (!isFiniteNumber(low) || !isFiniteNumber(high)) {
        if (segment.length) segments.push(segment);
        segment = [];
        previousIndex = void 0;
        return;
      }
      const uninterrupted = previousIndex === void 0 || lower.slice(previousIndex + 1, index + 1).every((value, offset) => isFiniteNumber(value) && isFiniteNumber(upper[previousIndex + offset + 1]));
      if (!uninterrupted && segment.length) {
        segments.push(segment);
        segment = [];
      }
      segment.push({
        low: `${xForPosition(position)},${yForValue(low)}`,
        high: `${xForPosition(position)},${yForValue(high)}`
      });
      previousIndex = index;
    });
    if (segment.length) segments.push(segment);
    return segments.filter((pairs) => pairs.length >= 2).map((pairs) => `M${pairs.map((pair) => pair.low).join(" L")} L${[...pairs].reverse().map((pair) => pair.high).join(" L")} Z`).join(" ");
  };
  return {
    minimum,
    maximum,
    xForDate,
    correctedPoint: dates.length === 1 && isFiniteNumber(metric.corrected.p50[0]) ? { x: xForDate(0), y: yForValue(metric.corrected.p50[0]) } : void 0,
    correctedLine: line(metric.corrected.p50),
    correctedBand: band(metric.corrected.p10, metric.corrected.p90),
    rawPoint: dates.length === 1 && isFiniteNumber(metric.raw?.p50[0]) ? { x: xForDate(0), y: yForValue(metric.raw.p50[0]) } : void 0,
    rawLine: metric.raw ? line(metric.raw.p50) : "",
    rawBand: metric.raw ? band(metric.raw.p10, metric.raw.p90) : ""
  };
}
function isClimateSeriesResponse(value, expected) {
  if (!value || typeof value !== "object") return false;
  const response = value;
  return response.publicSafe === true && ["bias-corrected", "raw-model-grid"].includes(response.dataMode) && response.dateStart === expected.startDate && response.dateEnd === expected.endDate && Array.isArray(response.dates) && Array.isArray(response.metrics) && expected.selectedMetrics.every((key) => response.metrics.some((metric) => metric.key === key));
}
function expandMetricKeys(metrics) {
  return [...new Set(metrics.flatMap((key) => key === "apparentTemperature" ? ["heatIndex", "feelsLike"] : [key]))];
}
function apparentTemperatureBasis(date) {
  const month = Number(String(date).slice(5, 7));
  const usesHeatIndex = Number.isInteger(month) && month >= 5 && month <= 9;
  return usesHeatIndex ? { key: "heat_index", metricKey: "heatIndex", label: "열지수" } : { key: "feels_like", metricKey: "feelsLike", label: "체감기온" };
}
function collapseApparentTemperatureSeries(response, selectedMetrics) {
  if (!selectedMetrics.includes("apparentTemperature")) return response;
  const heatIndex = response.metrics.find((metric) => metric.key === "heatIndex");
  const feelsLike = response.metrics.find((metric) => metric.key === "feelsLike");
  const pickMetric = (date) => apparentTemperatureBasis(date).metricKey === "heatIndex" ? heatIndex : feelsLike;
  const pickValues = (group, band) => response.dates.map((date, index) => pickMetric(date)?.[group]?.[band]?.[index]);
  const coverage = response.dates.map((date, index) => Boolean(pickMetric(date)?.coverage?.[index]));
  const modelCounts = response.dates.map((date, index) => pickMetric(date)?.modelCounts?.[index] ?? 0);
  const hasRaw = Boolean(heatIndex?.raw || feelsLike?.raw);
  const apparentMetric = {
    key: "apparentTemperature",
    label: "월별 체감 지표",
    unit: heatIndex?.unit ?? feelsLike?.unit ?? "도",
    corrected: {
      p10: pickValues("corrected", "p10"),
      p50: pickValues("corrected", "p50"),
      p90: pickValues("corrected", "p90")
    },
    ...hasRaw ? { raw: {
      p10: pickValues("raw", "p10"),
      p50: pickValues("raw", "p50"),
      p90: pickValues("raw", "p90")
    } } : {},
    coverage,
    modelCounts,
    availableCount: coverage.filter(Boolean).length
  };
  const metrics = response.metrics.filter((metric) => !["heatIndex", "feelsLike"].includes(metric.key));
  const comfortIndexes = ["heatIndex", "feelsLike"].map((key) => response.metrics.findIndex((metric) => metric.key === key)).filter((index) => index >= 0);
  const insertAt = comfortIndexes.length > 0 ? Math.min(Math.min(...comfortIndexes), metrics.length) : metrics.length;
  metrics.splice(insertAt, 0, apparentMetric);
  return { ...response, metrics };
}
function sampleIndexes(length, maximum) {
  if (length <= maximum) return Array.from({ length }, (_, index) => index);
  return Array.from(new Set(Array.from({ length: maximum }, (_, index) => Math.round(index * (length - 1) / (maximum - 1)))));
}
function displayChartValue(value, unit) {
  return isFiniteNumber(value) ? `${value.toFixed(2)} ${unit}` : "자료 없음";
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function parseDate(value) {
  return /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
}
function formatDate(value) {
  return value.toISOString().slice(0, 10);
}
function addDays(value, days) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
function clipPeriod(start, end, minimum, maximum) {
  return {
    start: start < minimum ? minimum : start > maximum ? maximum : start,
    end: end < minimum ? minimum : end > maximum ? maximum : end
  };
}
function isValidPeriod(start, end) {
  return /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;
}
function inclusiveDayCount(start, end) {
  if (!isValidPeriod(start, end)) return 0;
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / 864e5) + 1;
}
const runtimePublicBlockList = ["버킷", "공유 링크", "파일 식별자", "내부 경로", "비밀값", "토큰", "액세스 키"];
function validateRemoteChunkResponse(response, request) {
  const coordinateMatches = isClose(response.latitude, request.latitude) && isClose(response.longitude, request.longitude);
  const requestMatches = response.stationLabel === request.stationLabel && coordinateMatches && response.date === request.date && response.scenario === request.scenario && response.model === request.model;
  const hasValues = response.values.length > 0;
  const hasAttribution = response.attributionReady;
  const safeText = hasNoRuntimePublicLeak([
    response.stationLabel,
    String(response.latitude),
    String(response.longitude),
    response.date,
    response.scenario,
    response.model,
    response.coverage,
    response.fallbackReason ?? "",
    ...response.values.flatMap((value) => [value.label, value.value, value.caption])
  ].join(" "));
  const publicSafe = response.publicSafe && safeText;
  const items = [
    {
      label: "요청 일치",
      value: requestMatches ? "통과" : "확인",
      detail: requestMatches ? "선택 지점과 시간 응답이 맞습니다." : "응답이 현재 선택 조건과 다릅니다.",
      tone: requestMatches ? "ok" : "warn"
    },
    {
      label: "결과 카드",
      value: `${response.values.length}개`,
      detail: hasValues ? "공개 화면에 올릴 핵심 결과가 있습니다." : "표시할 결과가 없습니다.",
      tone: hasValues ? "ok" : "hold"
    },
    {
      label: "출처 고지",
      value: hasAttribution ? "포함" : "확인",
      detail: hasAttribution ? "결과와 출처 고지를 함께 전달할 수 있습니다." : "출처 고지 상태를 확인해야 합니다.",
      tone: hasAttribution ? "ok" : "warn"
    },
    {
      label: "공개 보호",
      value: publicSafe ? "통과" : "확인",
      detail: publicSafe ? "결과 응답에 내부 연결 정보를 넣지 않습니다." : "공개 응답 문구를 다시 점검해야 합니다.",
      tone: publicSafe ? "ok" : "warn"
    }
  ];
  const issueCount = items.filter((item) => item.tone !== "ok").length;
  return {
    status: !requestMatches || !publicSafe ? "blocked" : issueCount > 0 ? "review" : "ready",
    publicSafe,
    issueCount,
    items
  };
}
function hasNoRuntimePublicLeak(text) {
  return runtimePublicBlockList.every((term) => !text.includes(term));
}
function isClose(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 1e-4;
}
const publicNavItems = [
  { route: "/query", label: "학생 탐색", icon: /* @__PURE__ */ jsx(MapPin, { size: 18 }), group: "공유" },
  { route: "/teacher", label: "교사용 수업", icon: /* @__PURE__ */ jsx(GraduationCap, { size: 18 }), group: "공유" },
  { route: "/public", label: "일반 요약", icon: /* @__PURE__ */ jsx(UsersRound, { size: 18 }), group: "공유" }
];
const cmip6ModelOptions = [
  "전체 앙상블",
  "MIROC-ES2L",
  "MIROC6",
  "EC-Earth3",
  "HadGEM3-GC31-LL",
  "KIOST-ESM",
  "CanESM5"
];
const mapTileSize = 256;
const defaultMapZoom = 5;
const mercatorLatitudeLimit = 85.05112878;
const routeTitles = {
  "/query": {
    eyebrow: "미래 기후 탐색",
    title: "지도에서 미래 기후를 만나보세요",
    subtitle: "궁금한 곳과 날짜를 고르면 실제 기후자료에서 기온, 비, 바람, 체감기온을 찾아 보여줍니다."
  },
  "/teacher": {
    eyebrow: "교사용 수업",
    title: "지역의 미래를 탐구하는 수업",
    subtitle: "학생과 함께 위치를 고르고, 결과를 비교하고, 활동 자료를 저장할 수 있습니다."
  },
  "/public": {
    eyebrow: "우리 지역 요약",
    title: "한눈에 보는 우리 지역의 미래 기후",
    subtitle: "지도를 눌러 위치를 바꾸면 꼭 필요한 기후 지표만 쉽고 빠르게 확인할 수 있습니다."
  }
};
const queryPresets = [
  {
    id: "heatClass",
    label: "A 폭염 수업",
    detail: "대전, 2050년 여름",
    icon: /* @__PURE__ */ jsx(ThermometerSun, { size: 18 }),
    date: "2050-08-01",
    latitude: 36.35,
    longitude: 127.38,
    scenario: "고배출 경로",
    model: "전체 앙상블",
    raw: false,
    mapTone: "heat",
    summary: "한여름 수업 예시입니다. 최고기온과 체감 위험을 먼저 봅니다.",
    dataNote: "저장 자료 범위 안의 예시 좌표입니다. 실제 자료 응답이 확인된 경우에만 수치를 표시합니다."
  },
  {
    id: "nearSchool",
    label: "B 학교 주변",
    detail: "서울, 등교 시간대",
    icon: /* @__PURE__ */ jsx(School, { size: 18 }),
    date: "2045-09-03",
    latitude: 37.57,
    longitude: 126.98,
    scenario: "고배출 경로",
    model: "MIROC6",
    raw: false,
    mapTone: "school",
    summary: "학교 주변 비교 예시입니다. 가까운 관측소와 일교차를 함께 확인합니다.",
    dataNote: "학교 주변 활동지에 사용할 조회 조건만 채웁니다. 수치는 실제 자료 응답에서 가져옵니다."
  },
  {
    id: "rainChange",
    label: "C 강수 변화",
    detail: "부산, 장마 사례",
    icon: /* @__PURE__ */ jsx(CloudRain, { size: 18 }),
    date: "2060-07-12",
    latitude: 35.18,
    longitude: 129.08,
    scenario: "고배출 경로",
    model: "HadGEM3-GC31-LL",
    raw: false,
    mapTone: "rain",
    summary: "장마철 강수 변화 예시입니다. 강수량과 신뢰 상태를 먼저 봅니다.",
    dataNote: "강수 수업용 조회 조건입니다. 같은 날짜의 기온 지표도 실제 자료에서 함께 확인합니다."
  },
  {
    id: "overseas",
    label: "D 해외 지점",
    detail: "도쿄, 대체 조회",
    icon: /* @__PURE__ */ jsx(Globe2, { size: 18 }),
    date: "2055-01-15",
    latitude: 35.68,
    longitude: 139.76,
    scenario: "고배출 경로",
    model: "전체 앙상블",
    raw: true,
    mapTone: "global",
    summary: "국내 저장 범위 밖 예시입니다. 원본 모델 기준의 대체 조회 상태를 확인합니다.",
    dataNote: "범위 밖 좌표는 raw CMIP6 응답이 확인된 경우에만 원자료 값을 표시합니다."
  },
  {
    id: "custom",
    label: "자유 선택",
    detail: "지도를 눌러 지정",
    icon: /* @__PURE__ */ jsx(LocateFixed, { size: 18 }),
    date: "2050-08-01",
    latitude: 36.5,
    longitude: 127.4,
    scenario: "고배출 경로",
    model: "전체 앙상블",
    raw: false,
    mapTone: "custom",
    summary: "지도에서 직접 고른 위치입니다. 핀을 바꾸면 좌표가 즉시 갱신됩니다.",
    dataNote: "클릭한 좌표를 기준으로 실제 자료 조회 조건을 구성합니다."
  }
];
function routeFromHash() {
  const raw = parseHashLocation(window.location.hash).path;
  return publicNavItems.some((item) => item.route === raw) ? raw : "/query";
}
function setRoute(route) {
  window.location.hash = route;
}
function openExamplePicker() {
  setRoute("/query");
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("ctc:show-examples"));
  }, 0);
}
function openQueryWithCoordinate(coordinate) {
  window.sessionStorage.setItem("ctc:pending-coordinate", JSON.stringify(coordinate));
  setRoute("/query");
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("ctc:apply-coordinate"));
  }, 0);
}
function useHashRoute() {
  const [route, setCurrentRoute] = useState(() => routeFromHash());
  useEffect(() => {
    const onHashChange = () => {
      const hashLocation = parseHashLocation(window.location.hash);
      const nextRoute = routeFromHash();
      const query = hashLocation.params.toString();
      const canonicalHash = `#${nextRoute}${query ? `?${query}` : ""}`;
      if (window.location.hash !== canonicalHash) {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${canonicalHash}`);
      }
      setCurrentRoute(nextRoute);
    };
    onHashChange();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}
function App() {
  const route = useHashRoute();
  const [themeMode, setThemeMode] = useThemeMode();
  const page = useMemo(() => renderRoute(route), [route]);
  return /* @__PURE__ */ jsxs("div", { className: `app route-${route.slice(1)}`, children: [
    /* @__PURE__ */ jsx("header", { className: "site-header", children: /* @__PURE__ */ jsxs("div", { className: "site-header-inner", children: [
      /* @__PURE__ */ jsxs("button", { className: "brand", onClick: () => setRoute("/query"), type: "button", "aria-label": "기후 타임캡슐 학생 탐색으로 이동", children: [
        /* @__PURE__ */ jsx("span", { className: "brand-mark", children: /* @__PURE__ */ jsx(CloudSun, { size: 23 }) }),
        /* @__PURE__ */ jsxs("span", { className: "brand-copy", children: [
          /* @__PURE__ */ jsx("strong", { children: "기후 타임캡슐" }),
          /* @__PURE__ */ jsx("small", { children: "미래 기후 지도" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("nav", { className: "nav", "aria-label": "사용자 화면 탐색", children: publicNavItems.map((item) => /* @__PURE__ */ jsxs("button", { className: route === item.route ? "nav-item active" : "nav-item", onClick: () => setRoute(item.route), type: "button", children: [
        item.icon,
        /* @__PURE__ */ jsx("span", { children: item.label })
      ] }, item.route)) }),
      /* @__PURE__ */ jsxs("div", { className: "header-actions", children: [
        /* @__PURE__ */ jsx(ThemeControl, { mode: themeMode, onChange: setThemeMode }),
        /* @__PURE__ */ jsxs("button", { className: "header-example-button", onClick: openExamplePicker, type: "button", children: [
          /* @__PURE__ */ jsx(Search, { size: 17 }),
          "예시 보기"
        ] })
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs("main", { className: "main", children: [
      /* @__PURE__ */ jsx(TopBar, { route }),
      page
    ] })
  ] });
}
function useThemeMode() {
  const [mode, setMode] = useState(() => {
    try {
      const saved = window.localStorage.getItem("ctc:theme-mode");
      return ["system", "light", "dark"].includes(saved) ? saved : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolved = mode === "system" ? media.matches ? "dark" : "light" : mode;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themeMode = mode;
      document.documentElement.style.colorScheme = resolved;
    };
    try {
      window.localStorage.setItem("ctc:theme-mode", mode);
    } catch {
    }
    applyTheme();
    media.addEventListener?.("change", applyTheme);
    return () => media.removeEventListener?.("change", applyTheme);
  }, [mode]);
  return [mode, setMode];
}
function ThemeControl({ mode, onChange }) {
  const options = [
    { key: "system", label: "시스템 설정 따르기", icon: Monitor },
    { key: "light", label: "밝게 보기", icon: Sun },
    { key: "dark", label: "어둡게 보기", icon: Moon }
  ];
  return /* @__PURE__ */ jsx("div", { className: "theme-control", role: "group", "aria-label": "화면 테마", children: options.map(({ key, label, icon: Icon }) => /* @__PURE__ */ jsx("button", {
    "aria-label": label,
    "aria-pressed": mode === key,
    className: mode === key ? "active" : "",
    onClick: () => onChange(key),
    title: label,
    type: "button",
    children: /* @__PURE__ */ jsx(Icon, { size: 16 })
  }, key)) });
}
function TopBar({ route }) {
  const meta = routeTitles[route];
  return /* @__PURE__ */ jsx("header", { className: "topbar", children: /* @__PURE__ */ jsxs("div", { className: "topbar-copy", children: [
    /* @__PURE__ */ jsx("span", { className: "eyebrow", children: meta.eyebrow }),
    /* @__PURE__ */ jsx("h1", { children: meta.title }),
    /* @__PURE__ */ jsx("p", { children: meta.subtitle })
  ] }) });
}
function renderRoute(route) {
  switch (route) {
    case "/teacher":
      return /* @__PURE__ */ jsx(TeacherPage, {});
    case "/public":
      return /* @__PURE__ */ jsx(PublicPage, {});
    default:
      return /* @__PURE__ */ jsx(QueryPage, { audience: "student" });
  }
}
function QueryPage({ audience }) {
  const initialPreset = queryPresets[0];
  const sharedLessonState = useMemo(() => {
    const encoded = parseHashLocation(window.location.hash).params.get("lesson");
    return encoded ? decodeLessonState(encoded) : undefined;
  }, []);
  const [selectedPresetId, setSelectedPresetId] = useState(sharedLessonState ? "custom" : initialPreset.id);
  const activePreset = queryPresets.find((preset) => preset.id === selectedPresetId) ?? queryPresets[0];
  const presetGridRef = useRef(null);
  const [model, setModel] = useState(sharedLessonState?.model ?? initialPreset.model);
  const [raw, setRaw] = useState(initialPreset.raw);
  const [date, setDate] = useState(sharedLessonState?.date ?? initialPreset.date);
  const [scenario, setScenario] = useState(sharedLessonState?.scenario ?? initialPreset.scenario);
  const [coordinates, setCoordinates] = useState({
    latitude: sharedLessonState?.latitude ?? initialPreset.latitude,
    longitude: sharedLessonState?.longitude ?? initialPreset.longitude
  });
  const [latitudeInput, setLatitudeInput] = useState((sharedLessonState?.latitude ?? initialPreset.latitude).toFixed(4));
  const [longitudeInput, setLongitudeInput] = useState((sharedLessonState?.longitude ?? initialPreset.longitude).toFixed(4));
  const [exportContext, setExportContext] = useState(null);
  const [metadata, setMetadata] = useState();
  const [learningFocus, setLearningFocus] = useState(sharedLessonState?.focus ?? "heat");
  const [studentNote, setStudentNote] = useState("");
  const [comparisonBaseline, setComparisonBaseline] = useState();
  const [queryMessage, setQueryMessage] = useState(sharedLessonState ? sharedLessonMessage(sharedLessonState) : "예시를 고르거나 지도를 눌러 좌표를 지정하세요.");
  const availableModels = metadata?.models?.length ? metadata.models : cmip6ModelOptions;
  const remoteState = useRemoteMetricResponse({ coordinate: coordinates, date, scenario, model });
  const usesRawModelGrid = remoteState.response?.dataMode === "raw-model-grid";
  const metricsForSelection = useMemo(
    () => deriveClimateMetrics({ date, raw, remoteState }),
    [date, raw, remoteState]
  );
  const hasExportableMetrics = metricsForSelection.some((metric) => metric.available !== false && Number.isFinite(metric.numericValue));
  const currentSnapshot = useMemo(() => createMetricSnapshot(metricsForSelection, {
    date,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    scenario,
    model,
    label: activePreset.label.replace(/^[A-D]\s+/u, "")
  }), [metricsForSelection, date, coordinates.latitude, coordinates.longitude, scenario, model, activePreset.label]);
  const comparisonRows = useMemo(
    () => compareMetricSnapshots(comparisonBaseline, currentSnapshot),
    [comparisonBaseline, currentSnapshot]
  );
  useEffect(() => {
    let active = true;
    fetchPublicClimateMetadata().then((nextMetadata) => {
      if (!active || !nextMetadata.publicSafe || !nextMetadata.ready) return;
      setMetadata(nextMetadata);
      if (Array.isArray(nextMetadata.models) && nextMetadata.models.length > 0) {
        setModel((currentModel) => nextMetadata.models.includes(currentModel) ? currentModel : nextMetadata.models[0]);
      }
      if (nextMetadata.dateStart && nextMetadata.dateEnd) {
        setDate((currentDate) => clipPeriod(currentDate, currentDate, nextMetadata.dateStart, nextMetadata.dateEnd).start);
      }
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (remoteState.status !== "loading") return;
    const preventRefresh = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventRefresh);
    return () => window.removeEventListener("beforeunload", preventRefresh);
  }, [remoteState.status]);
  useEffect(() => {
    setLatitudeInput(coordinates.latitude.toFixed(4));
    setLongitudeInput(coordinates.longitude.toFixed(4));
  }, [coordinates]);
  useEffect(() => {
    const applyPendingCoordinate = () => {
      const pending = window.sessionStorage.getItem("ctc:pending-coordinate");
      if (!pending) return;
      try {
        const nextCoordinate = JSON.parse(pending);
        if (Number.isFinite(nextCoordinate.latitude) && Number.isFinite(nextCoordinate.longitude)) {
          setSelectedPresetId("custom");
          setCoordinates({
            latitude: clamp(nextCoordinate.latitude, -mercatorLatitudeLimit, mercatorLatitudeLimit),
            longitude: normalizeLongitude(nextCoordinate.longitude)
          });
          setQueryMessage("이전 화면에서 고른 좌표를 이어서 열었습니다. 날짜와 모델을 바꾸면 값이 다시 계산됩니다.");
        }
      } catch {
        setQueryMessage("이전 화면 좌표를 읽지 못했습니다. 지도에서 다시 지점을 골라 주세요.");
      } finally {
        window.sessionStorage.removeItem("ctc:pending-coordinate");
      }
    };
    const applySharedLesson = () => {
      const encodedLesson = parseHashLocation(window.location.hash).params.get("lesson");
      if (!encodedLesson) return;
      const shared = decodeLessonState(encodedLesson);
      if (!shared) {
        setQueryMessage("공유된 수업 조건을 읽지 못했습니다. 교사에게 새 링크를 요청하거나 직접 조건을 선택하세요.");
        return;
      }
      setSelectedPresetId("custom");
      setDate(shared.date);
      setScenario(shared.scenario);
      setModel(shared.model);
      setLearningFocus(shared.focus);
      setCoordinates({ latitude: shared.latitude, longitude: shared.longitude });
      setQueryMessage(sharedLessonMessage(shared));
    };
    const showExamples = () => {
      const preset = queryPresets[0];
      setSelectedPresetId(preset.id);
      setDate(preset.date);
      setScenario(preset.scenario);
      setModel(preset.model);
      setRaw(preset.raw);
      setCoordinates({ latitude: preset.latitude, longitude: preset.longitude });
      setQueryMessage("예시 보기를 열었습니다. 다른 예시나 지도를 눌러 조건을 바꿀 수 있습니다.");
      presetGridRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        presetGridRef.current?.querySelector("button")?.focus();
      }, 80);
    };
    applySharedLesson();
    applyPendingCoordinate();
    window.addEventListener("ctc:apply-coordinate", applyPendingCoordinate);
    window.addEventListener("ctc:show-examples", showExamples);
    return () => {
      window.removeEventListener("ctc:apply-coordinate", applyPendingCoordinate);
      window.removeEventListener("ctc:show-examples", showExamples);
    };
  }, []);
  const selectPreset = (preset) => {
    const nextDate = metadata?.dateStart && metadata?.dateEnd ? clipPeriod(preset.date, preset.date, metadata.dateStart, metadata.dateEnd).start : preset.date;
    const nextModel = availableModels.includes(preset.model) ? preset.model : availableModels[0] ?? cmip6ModelOptions[0];
    setSelectedPresetId(preset.id);
    setDate(nextDate);
    setScenario(preset.scenario);
    setModel(nextModel);
    setRaw(preset.raw);
    setCoordinates({ latitude: preset.latitude, longitude: preset.longitude });
    setQueryMessage(`${preset.label} 예시가 적용됐습니다. 필요하면 지도에서 지점을 다시 고르세요.`);
  };
  const selectMapCoordinate = (nextCoordinate) => {
    setSelectedPresetId("custom");
    setCoordinates(nextCoordinate);
    setQueryMessage("좌표를 지정했습니다. 결과와 CSV 기준을 갱신했습니다.");
  };
  const confirmQuery = () => {
    const nextLatitude = Number(latitudeInput);
    const nextLongitude = Number(longitudeInput);
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude) || nextLatitude < -mercatorLatitudeLimit || nextLatitude > mercatorLatitudeLimit || nextLongitude < -180 || nextLongitude > 180) {
      setQueryMessage(`위도는 -${mercatorLatitudeLimit}~${mercatorLatitudeLimit}, 경도는 -180~180 범위로 입력하세요.`);
      return;
    }
    const nextCoordinates = {
      latitude: clamp(nextLatitude, -mercatorLatitudeLimit, mercatorLatitudeLimit),
      longitude: normalizeLongitude(nextLongitude)
    };
    setSelectedPresetId("custom");
    setCoordinates(nextCoordinates);
    setQueryMessage(`${date} · ${model} · ${nextCoordinates.latitude.toFixed(4)}, ${nextCoordinates.longitude.toFixed(4)} 기준으로 값과 저장 기준을 갱신했습니다.`);
  };
  const exportMetric = (metric) => {
    if (!metric.key) return;
    setExportContext({
      date,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario,
      model,
      initialMetrics: [metric.key],
      includeRaw: raw && !usesRawModelGrid
    });
  };
  const exportAllMetrics = () => {
    const initialMetrics = metricsForSelection.filter((metric) => metric.key && metric.available !== false && Number.isFinite(metric.numericValue)).map((metric) => metric.key);
    setExportContext({
      date,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario,
      model,
      initialMetrics,
      includeRaw: raw && !usesRawModelGrid
    });
  };
  const saveComparisonBaseline = () => {
    if (!currentSnapshot) return;
    setComparisonBaseline(currentSnapshot);
    setQueryMessage("현재 실제 자료를 비교 기준으로 저장했습니다. 위치나 날짜를 바꾸면 차이를 확인할 수 있습니다.");
  };
  const saveStudentNotebook = async () => {
    if (!currentSnapshot) return;
    const focus = studentFocusOptions.find((option) => option.key === learningFocus) ?? studentFocusOptions[0];
    try {
      const result = await saveTextFile("climate-exploration-note.txt", buildStudentNotebookText({
        baseline: comparisonBaseline ?? currentSnapshot,
        comparison: comparisonBaseline ? currentSnapshot : undefined,
        focusLabel: focus.label,
        note: studentNote
      }));
      setQueryMessage(describeSaveResult(result, "탐구 기록"));
    } catch (error) {
      setQueryMessage(error instanceof Error ? error.message : "탐구 기록 파일을 만들지 못했습니다.");
    }
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "query-layout", children: [
      /* @__PURE__ */ jsxs("section", { className: "query-panel", children: [
        /* @__PURE__ */ jsx("h2", { children: audience === "student" ? "궁금한 곳 선택" : "질의 조건" }),
        /* @__PURE__ */ jsx("div", { className: "preset-grid", ref: presetGridRef, children: queryPresets.map((preset) => /* @__PURE__ */ jsxs(
          "button",
          {
            "aria-pressed": selectedPresetId === preset.id,
            className: selectedPresetId === preset.id ? "active" : preset.id === "custom" ? "custom-preset" : "",
            onClick: () => selectPreset(preset),
            type: "button",
            children: [
              /* @__PURE__ */ jsx("span", { className: "preset-icon", children: preset.icon }),
              /* @__PURE__ */ jsx("span", { children: preset.label }),
              /* @__PURE__ */ jsx("small", { children: preset.detail })
            ]
          },
          preset.id
        )) }),
        /* @__PURE__ */ jsx(DateField, { label: "날짜", min: metadata?.dateStart, max: metadata?.dateEnd, value: date, onChange: setDate }),
        /* @__PURE__ */ jsxs("div", { className: "field-pair", children: [
          /* @__PURE__ */ jsx(CoordinateInput, { label: "위도", max: mercatorLatitudeLimit, min: -mercatorLatitudeLimit, onChange: setLatitudeInput, value: latitudeInput }),
          /* @__PURE__ */ jsx(CoordinateInput, { label: "경도", max: 180, min: -180, onChange: setLongitudeInput, value: longitudeInput })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
          "시나리오",
          /* @__PURE__ */ jsx("select", { value: scenario, onChange: (event) => setScenario(event.target.value), children: /* @__PURE__ */ jsx("option", { value: "고배출 경로", children: "고배출 경로 · SSP5-8.5" }) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
          "모델",
          /* @__PURE__ */ jsx("select", { value: model, onChange: (event) => setModel(event.target.value), children: availableModels.map((modelOption) => /* @__PURE__ */ jsx("option", { children: modelOption }, modelOption)) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: `toggle-row ${usesRawModelGrid ? "disabled" : ""}`, children: [
          /* @__PURE__ */ jsx("input", { disabled: usesRawModelGrid, type: "checkbox", checked: usesRawModelGrid ? false : raw, onChange: (event) => setRaw(event.target.checked) }),
          usesRawModelGrid ? "이 위치는 기후모델 원자료로 표시됩니다" : "보정 전 모델값 함께 보기"
        ] }),
        /* @__PURE__ */ jsxs("button", { className: "primary-action wide", onClick: confirmQuery, type: "button", children: [
          /* @__PURE__ */ jsx(Search, { size: 18 }),
          "선택 지점 확인"
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mini-status ok", children: queryMessage })
      ] }),
      /* @__PURE__ */ jsx(
        MapPanel,
        {
          compact: false,
          raw,
          rawModelGrid: usesRawModelGrid,
          date,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          mapTone: activePreset.mapTone,
          onCoordinateChange: selectMapCoordinate
        }
      ),
      /* @__PURE__ */ jsxs("section", { className: "result-panel", "data-query-state": remoteState.status, children: [
        /* @__PURE__ */ jsxs("div", { className: "panel-heading-row", children: [
          /* @__PURE__ */ jsx("h2", { children: "기본 기후 지표" }),
          /* @__PURE__ */ jsxs("button", { className: "secondary-action", disabled: !hasExportableMetrics, onClick: exportAllMetrics, type: "button", children: [
            /* @__PURE__ */ jsx(HardDriveDownload, { size: 16 }),
            "전체 자료 내보내기"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: `mini-status ${remoteState.status === "ready" ? "ok" : "warn"}`, "aria-live": "polite", children: remoteState.message }),
        /* @__PURE__ */ jsx(MetricGrid, { items: metricsForSelection, onExportMetric: exportMetric }),
        /* @__PURE__ */ jsx(StudentWorkbench, {
          baseline: comparisonBaseline,
          comparisonRows,
          currentSnapshot,
          focus: learningFocus,
          note: studentNote,
          onFocusChange: setLearningFocus,
          onNoteChange: (value) => setStudentNote(sanitizeNote(value)),
          onSaveBaseline: saveComparisonBaseline,
          onSaveNotebook: saveStudentNotebook
        }),
        /* @__PURE__ */ jsx(NoticeCard, { title: "선택한 예시", body: activePreset.summary }),
        /* @__PURE__ */ jsx(NoticeCard, { title: "선택 조건", body: `${activePreset.dataNote} 현재 좌표는 위도 ${coordinates.latitude.toFixed(4)}, 경도 ${coordinates.longitude.toFixed(4)}입니다.` })
      ] })
    ] }),
    /* @__PURE__ */ jsx(ClimateExportDialog, { context: exportContext, onClose: () => setExportContext(null) }),
    remoteState.status === "loading" ? /* @__PURE__ */ jsx(ClimateLoadingOverlay, {}) : null
  ] });
}
const studentFocusOptions = [
  { key: "heat", label: "더워지는 날", icon: ThermometerSun, prompt: "최고기온과 월별 체감 지표가 함께 어떻게 달라지는지 살펴보세요." },
  { key: "rain", label: "비의 변화", icon: CloudRain, prompt: "장소나 날짜를 바꾸고 하루 강수량의 차이를 비교해 보세요." },
  { key: "wind", label: "바람과 체감", icon: Wind, prompt: "풍속과 체감기온 또는 열지수가 같은 방향으로 변하는지 확인해 보세요." }
];
function sharedLessonMessage(shared) {
  return shared.source === "public" ? "일반 요약에서 선택한 조건을 자세히 열었습니다. 기준을 저장한 뒤 다른 위치나 날짜와 비교해 보세요." : "교사가 공유한 수업 조건을 열었습니다. 기준을 저장한 뒤 다른 위치나 날짜와 비교해 보세요.";
}
function StudentWorkbench({ baseline, comparisonRows, currentSnapshot, focus, note, onFocusChange, onNoteChange, onSaveBaseline, onSaveNotebook }) {
  const selectedFocus = studentFocusOptions.find((option) => option.key === focus) ?? studentFocusOptions[0];
  return /* @__PURE__ */ jsxs("section", { className: "student-workbench", children: [
    /* @__PURE__ */ jsxs("div", { className: "workbench-heading", children: [
      /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(BookOpen, { size: 18 }) }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h3", { children: "나의 기후 탐구" }),
        /* @__PURE__ */ jsx("p", { children: "실제 자료 두 조건을 비교하고 발견한 내용을 기록합니다." })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "student-focus-options", role: "group", "aria-label": "탐구 주제", children: studentFocusOptions.map(({ key, label, icon: Icon }) => /* @__PURE__ */ jsxs("button", { "aria-pressed": focus === key, className: focus === key ? "active" : "", onClick: () => onFocusChange(key), type: "button", children: [
      /* @__PURE__ */ jsx(Icon, { size: 16 }),
      label
    ] }, key)) }),
    /* @__PURE__ */ jsxs("div", { className: "student-prompt", children: [
      /* @__PURE__ */ jsx(Target, { size: 17 }),
      /* @__PURE__ */ jsx("span", { children: selectedFocus.prompt })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "student-comparison", children: [
      /* @__PURE__ */ jsxs("div", { className: "comparison-toolbar", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: baseline ? "비교 기준 저장됨" : "첫 조건을 기준으로 저장하세요" }),
          /* @__PURE__ */ jsx("span", { children: baseline ? `${baseline.label} · ${baseline.date}` : "자료가 확인되면 기준 저장 버튼이 활성화됩니다." })
        ] }),
        /* @__PURE__ */ jsxs("button", { disabled: !currentSnapshot, onClick: onSaveBaseline, type: "button", children: [
          /* @__PURE__ */ jsx(BookmarkPlus, { size: 16 }),
          baseline ? "현재 조건으로 다시 저장" : "비교 기준 저장"
        ] })
      ] }),
      baseline && comparisonRows.length > 0 ? /* @__PURE__ */ jsx("div", { className: "comparison-table", children: comparisonRows.map((row) => /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("strong", { children: row.label }),
        /* @__PURE__ */ jsxs("span", { children: [formatWorkbenchNumber(row.previous), " → ", formatWorkbenchNumber(row.current), " ", row.unit] }),
        /* @__PURE__ */ jsx("b", { className: row.delta > 0 ? "up" : row.delta < 0 ? "down" : "same", children: `${row.delta > 0 ? "+" : ""}${formatWorkbenchNumber(row.delta)}` })
      ] }, row.key)) }) : null
    ] }),
    /* @__PURE__ */ jsxs("label", { className: "student-note-field", children: [
      /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx(NotebookPen, { size: 16 }), "나의 발견"] }),
      /* @__PURE__ */ jsx("textarea", { maxLength: 2000, onChange: (event) => onNoteChange(event.target.value), placeholder: "두 조건에서 어떤 값이 달라졌는지 적어 보세요.", value: note })
    ] }),
    /* @__PURE__ */ jsxs("button", { className: "student-save-action", disabled: !currentSnapshot, onClick: onSaveNotebook, type: "button", children: [
      /* @__PURE__ */ jsx(Download, { size: 16 }),
      "탐구 기록 저장"
    ] })
  ] });
}
function formatWorkbenchNumber(value) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}
function ClimateLoadingOverlay() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1e3));
    }, 1e3);
    return () => window.clearInterval(timer);
  }, []);
  return /* @__PURE__ */ jsx("div", { className: "climate-loading-backdrop", role: "presentation", children: /* @__PURE__ */ jsxs(
    "section",
    {
      "aria-describedby": "climate-loading-description",
      "aria-labelledby": "climate-loading-title",
      "aria-modal": "true",
      className: "climate-loading-dialog",
      role: "dialog",
      children: [
        /* @__PURE__ */ jsx("div", { className: "climate-loading-icon", children: /* @__PURE__ */ jsx(LoaderCircle, { size: 28 }) }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { className: "eyebrow", children: "실제 기후자료 조회 중" }),
          /* @__PURE__ */ jsx("h2", { id: "climate-loading-title", children: "선택 좌표의 자료를 확인하고 있습니다" }),
          /* @__PURE__ */ jsx("p", { id: "climate-loading-description", children: "원본 기후모델 격자를 읽는 위치는 시간이 더 걸릴 수 있습니다. 조회가 끝날 때까지 새로고침하거나 창을 닫지 마세요." })
        ] }),
        /* @__PURE__ */ jsx("div", { "aria-label": "기후자료 불러오는 중", "aria-valuetext": `조회 중 · ${elapsedSeconds}초 경과`, className: "climate-loading-progress", role: "progressbar", children: /* @__PURE__ */ jsx("span", {}) }),
        /* @__PURE__ */ jsxs("div", { className: "loading-meta", children: [
          /* @__PURE__ */ jsxs("strong", { children: [elapsedSeconds, "초 경과"] }),
          /* @__PURE__ */ jsx("span", { children: elapsedSeconds < 3 ? "좌표와 날짜 확인 중" : elapsedSeconds < 12 ? "기후모델 격자 읽는 중" : "자료를 찾고 결과를 정리하는 중" })
        ] }),
        /* @__PURE__ */ jsx("small", { children: "완료되면 이 창이 닫히고 결과가 자동으로 바뀝니다." })
      ]
    }
  ) });
}
function TeacherPage() {
  const [started, setStarted] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState("idle");
  const [lessonTitle, setLessonTitle] = useState("우리 지역 2050년 여름");
  const [lessonObjective, setLessonObjective] = useState("장소에 따라 미래 기온, 강수량, 바람과 월별 체감 지표가 어떻게 달라지는지 설명한다.");
  const [lessonLocation, setLessonLocation] = useState({ id: "school", label: "학교", latitude: 37.57, longitude: 126.98, icon: School });
  const [lessonDate, setLessonDate] = useState("2050-08-01");
  const [lessonScenario, setLessonScenario] = useState("고배출 경로");
  const [lessonModel, setLessonModel] = useState(cmip6ModelOptions[0]);
  const [metadata, setMetadata] = useState();
  const [comparisonPoints, setComparisonPoints] = useState([]);
  const [teacherMessage, setTeacherMessage] = useState("실제 자료를 확인한 뒤 수업 활동을 시작하세요.");
  const [exportContext, setExportContext] = useState(null);
  const lessonLocations = [
    { id: "school", label: "학교", detail: "서울 도심", latitude: 37.57, longitude: 126.98, icon: School },
    { id: "coast", label: "해안", detail: "부산 해안", latitude: 35.18, longitude: 129.08, icon: Waves },
    { id: "mountain", label: "산지", detail: "대관령", latitude: 37.68, longitude: 128.72, icon: Mountain }
  ];
  const availableModels = normalizeMetadataOptions(metadata, "models", cmip6ModelOptions);
  const availableScenarios = normalizeMetadataOptions(metadata, "scenarios", ["고배출 경로"]);
  const remoteState = useRemoteMetricResponse({
    coordinate: { latitude: lessonLocation.latitude, longitude: lessonLocation.longitude },
    date: lessonDate,
    scenario: lessonScenario,
    model: lessonModel
  });
  const lessonMetrics = useMemo(
    () => deriveClimateMetrics({ date: lessonDate, raw: false, remoteState }),
    [lessonDate, remoteState]
  );
  const currentSnapshot = useMemo(() => createMetricSnapshot(lessonMetrics, {
    date: lessonDate,
    latitude: lessonLocation.latitude,
    longitude: lessonLocation.longitude,
    scenario: lessonScenario,
    model: lessonModel,
    label: lessonLocation.label
  }), [lessonMetrics, lessonDate, lessonLocation.latitude, lessonLocation.longitude, lessonLocation.label, lessonScenario, lessonModel]);
  const lessonToken = useMemo(() => encodeLessonState({
    source: "teacher",
    date: lessonDate,
    latitude: lessonLocation.latitude,
    longitude: lessonLocation.longitude,
    scenario: lessonScenario,
    model: lessonModel,
    focus: "heat"
  }), [lessonDate, lessonLocation.latitude, lessonLocation.longitude, lessonScenario, lessonModel]);
  const studentLink = useMemo(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = `/query?lesson=${lessonToken}`;
    return url.toString();
  }, [lessonToken]);
  useEffect(() => {
    let active = true;
    fetchPublicClimateMetadata().then((nextMetadata) => {
      if (!active || !nextMetadata.publicSafe || !nextMetadata.ready) return;
      setMetadata(nextMetadata);
      const models = normalizeMetadataOptions(nextMetadata, "models", cmip6ModelOptions);
      const scenarios = normalizeMetadataOptions(nextMetadata, "scenarios", ["고배출 경로"]);
      setLessonModel((current) => models.includes(current) ? current : models[0]);
      setLessonScenario((current) => scenarios.includes(current) ? current : scenarios[0]);
      if (nextMetadata.dateStart && nextMetadata.dateEnd) {
        setLessonDate((current) => clipPeriod(current, current, nextMetadata.dateStart, nextMetadata.dateEnd).start);
      }
    }).catch(() => {
      if (active) setTeacherMessage("자료 제공 범위를 확인하지 못했습니다. 현재 선택 조건으로 조회를 계속합니다.");
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setStarted(false);
    setSaveOutcome("idle");
  }, [lessonDate, lessonLocation.latitude, lessonLocation.longitude, lessonScenario, lessonModel]);
  const selectLessonLocation = (location) => {
    setLessonLocation(location);
    setTeacherMessage(`${location.label} 위치의 실제 자료를 조회합니다.`);
  };
  const selectTeacherMapCoordinate = (coordinate) => {
    setLessonLocation({ id: "custom", label: "직접 선택", detail: "지도에서 선택", ...coordinate, icon: LocateFixed });
    setTeacherMessage("지도에서 고른 위치의 실제 자료를 조회합니다.");
  };
  const addComparisonPoint = () => {
    if (!currentSnapshot) return;
    setComparisonPoints((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== currentSnapshot.id);
      if (withoutDuplicate.length >= 3) {
        setTeacherMessage("비교 지점은 세 곳까지 저장할 수 있습니다. 기존 지점을 삭제한 뒤 추가하세요.");
        return current;
      }
      setTeacherMessage(`${currentSnapshot.label}의 실제 자료를 수업 비교 목록에 추가했습니다.`);
      return [...withoutDuplicate, currentSnapshot];
    });
  };
  const startTeacherActivity = () => {
    if (!currentSnapshot) return;
    setStarted(true);
    setTeacherMessage(`${lessonLocation.label} 지점의 실제 자료로 비교 활동을 시작했습니다.`);
  };
  const copyStudentLink = async () => {
    const copied = await copyTextToClipboard(studentLink);
    setTeacherMessage(copied ? "현재 수업 조건이 담긴 학생용 링크를 복사했습니다." : "링크를 복사하지 못했습니다. 학생 화면 열기를 사용하세요.");
  };
  const openStudentLesson = () => {
    window.location.hash = `/query?lesson=${lessonToken}`;
  };
  const saveTeacherPack = async () => {
    if (!currentSnapshot) return;
    const snapshots = comparisonPoints.length > 0 ? comparisonPoints : [currentSnapshot];
    try {
      const result = await saveTextFile(
        "climate-class-activity.txt",
        buildTeacherActivityText({ lessonTitle, objective: lessonObjective, snapshots, studentLink })
      );
      setSaveOutcome(result.outcome);
      setTeacherMessage(describeSaveResult(result, "수업 활동지"));
    } catch (error) {
      setSaveOutcome("idle");
      setTeacherMessage(error instanceof Error ? error.message : "수업 활동지 파일을 만들지 못했습니다.");
    }
  };
  const exportTeacherData = () => {
    if (!currentSnapshot) return;
    setExportContext({
      date: lessonDate,
      latitude: lessonLocation.latitude,
      longitude: lessonLocation.longitude,
      scenario: lessonScenario,
      model: lessonModel,
      initialMetrics: currentSnapshot.values.map((metric) => metric.key),
      includeRaw: false
    });
  };
  const journey = [
    { label: "장소 고르기", detail: lessonLocation.label, done: true },
    { label: "미래 날짜", detail: lessonDate, done: true },
    { label: "실제 자료 확인", detail: currentSnapshot ? "값 확인 완료" : "조회 필요", done: Boolean(currentSnapshot) },
    { label: "수업자료 저장", detail: saveOutcome === "written" ? "저장 완료" : saveOutcome === "requested" ? "다운로드 요청" : "활동지와 자료", done: ["written", "requested"].includes(saveOutcome) }
  ];
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "teacher-page", children: [
    /* @__PURE__ */ jsx("section", { className: "teacher-journey", "aria-label": "수업 진행 단계", children: journey.map((step, index) => /* @__PURE__ */ jsxs("div", { className: step.done ? "lesson-step done" : "lesson-step", children: [
      /* @__PURE__ */ jsx("span", { children: step.done ? /* @__PURE__ */ jsx(Check, { size: 14 }) : index + 1 }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("strong", { children: step.label }),
        /* @__PURE__ */ jsx("small", { children: step.detail })
      ] })
    ] }, step.label)) }),
    /* @__PURE__ */ jsxs("div", { className: "teacher-layout", children: [
      /* @__PURE__ */ jsxs("section", { className: "teacher-map-column", children: [
        /* @__PURE__ */ jsx(MapPanel, { compact: false, date: lessonDate, latitude: lessonLocation.latitude, longitude: lessonLocation.longitude, mapTone: lessonLocation.id === "coast" ? "rain" : "school", rawModelGrid: remoteState.response?.dataMode === "raw-model-grid", onCoordinateChange: selectTeacherMapCoordinate }),
        /* @__PURE__ */ jsxs("div", { className: "teacher-map-note", children: [
          /* @__PURE__ */ jsx("span", { className: "teacher-note-icon", children: /* @__PURE__ */ jsx(lessonLocation.icon, { size: 18 }) }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("strong", { children: [lessonLocation.label, " 수업 지점"] }),
            /* @__PURE__ */ jsxs("p", { children: ["위도 ", lessonLocation.latitude.toFixed(4), ", 경도 ", lessonLocation.longitude.toFixed(4), " · 지도를 눌러 직접 바꿀 수 있습니다."] })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("aside", { className: "teacher-control-panel", children: [
        /* @__PURE__ */ jsxs("div", { className: "teacher-panel-title", children: [
          /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(GraduationCap, { size: 19 }) }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h2", { children: "수업 조건" }),
            /* @__PURE__ */ jsx("p", { children: "비교할 장소를 고르고 활동을 시작하세요." })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "teacher-text-field", children: [
          "수업명",
          /* @__PURE__ */ jsx("input", { maxLength: 120, onChange: (event) => setLessonTitle(event.target.value), value: lessonTitle })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "teacher-text-field", children: [
          "학습 목표",
          /* @__PURE__ */ jsx("textarea", { maxLength: 300, onChange: (event) => setLessonObjective(event.target.value), value: lessonObjective })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "lesson-location-options", children: lessonLocations.map((location) => {
          const LocationIcon = location.icon;
          return /* @__PURE__ */ jsxs("button", { "aria-pressed": lessonLocation.id === location.id, className: lessonLocation.id === location.id ? "active" : "", onClick: () => selectLessonLocation(location), type: "button", children: [
            /* @__PURE__ */ jsx(LocationIcon, { size: 18 }),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx("strong", { children: location.label }),
              /* @__PURE__ */ jsx("small", { children: location.detail })
            ] }),
            lessonLocation.id === location.id ? /* @__PURE__ */ jsx(Check, { size: 16 }) : null
          ] }, location.id);
        }) }),
        /* @__PURE__ */ jsx(DateField, { label: "미래 날짜", min: metadata?.dateStart, max: metadata?.dateEnd, onChange: setLessonDate, value: lessonDate }),
        /* @__PURE__ */ jsxs("div", { className: "teacher-select-grid", children: [
          /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
            "시나리오",
            /* @__PURE__ */ jsx("select", { onChange: (event) => setLessonScenario(event.target.value), value: lessonScenario, children: availableScenarios.map((option) => /* @__PURE__ */ jsx("option", { children: option }, option)) })
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
            "모델",
            /* @__PURE__ */ jsx("select", { onChange: (event) => setLessonModel(event.target.value), value: lessonModel, children: availableModels.map((option) => /* @__PURE__ */ jsx("option", { children: option }, option)) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "teacher-condition-grid", children: [
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "자료 상태" }), /* @__PURE__ */ jsx("strong", { children: remoteState.status === "ready" ? "확인 완료" : remoteState.status === "partial" ? "부분 자료" : "확인 중" })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "비교 목록" }), /* @__PURE__ */ jsxs("strong", { children: [comparisonPoints.length, "/3 지점"] })] })
        ] }),
        /* @__PURE__ */ jsxs("button", { className: "teacher-start-action", disabled: !currentSnapshot, onClick: startTeacherActivity, type: "button", children: [
          /* @__PURE__ */ jsx(PlayCircle, { size: 18 }),
          /* @__PURE__ */ jsx("span", { children: started ? "활동 진행 중" : "이 조건으로 활동 시작" }),
          /* @__PURE__ */ jsx(ArrowRight, { size: 17 })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "teacher-actions", children: [
          /* @__PURE__ */ jsxs("button", { disabled: !currentSnapshot, type: "button", onClick: addComparisonPoint, children: [/* @__PURE__ */ jsx(Plus, { size: 16 }), "비교 지점 추가"] }),
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: copyStudentLink, children: [/* @__PURE__ */ jsx(ClipboardCopy, { size: 16 }), "학생 링크 복사"] }),
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: openStudentLesson, children: [/* @__PURE__ */ jsx(Link, { size: 16 }), "학생 화면 열기"] }),
          /* @__PURE__ */ jsxs("button", { type: "button", disabled: !currentSnapshot, onClick: exportTeacherData, children: [/* @__PURE__ */ jsx(HardDriveDownload, { size: 16 }), "자료 내보내기"] }),
          /* @__PURE__ */ jsxs("button", { type: "button", disabled: !started || !currentSnapshot, onClick: saveTeacherPack, children: [/* @__PURE__ */ jsx(Download, { size: 16 }), "수업 활동지 저장"] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: currentSnapshot ? "mini-status ok" : "mini-status warn", "aria-live": "polite", children: currentSnapshot ? teacherMessage : remoteState.message })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "teacher-data-workbench", children: [
      /* @__PURE__ */ jsxs("div", { className: "panel-heading-row", children: [
        /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", { children: "수업에 사용할 실제 기후자료" }), /* @__PURE__ */ jsx("p", { children: "현재 좌표·날짜·시나리오·모델 응답에서 확인된 값만 표시합니다." })] }),
        /* @__PURE__ */ jsxs("button", { className: "secondary-action", disabled: !currentSnapshot, onClick: addComparisonPoint, type: "button", children: [/* @__PURE__ */ jsx(BookmarkPlus, { size: 16 }), "비교 목록에 저장"] })
      ] }),
      /* @__PURE__ */ jsx(MetricGrid, { items: lessonMetrics }),
      comparisonPoints.length > 0 ? /* @__PURE__ */ jsx("div", { className: "teacher-comparison-list", children: comparisonPoints.map((point) => /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: point.label }), /* @__PURE__ */ jsxs("span", { children: [point.date, " · ", point.latitude.toFixed(4), ", ", point.longitude.toFixed(4)] })] }),
        /* @__PURE__ */ jsx("button", { "aria-label": `${point.label} 비교 지점 삭제`, onClick: () => setComparisonPoints((current) => current.filter((item) => item.id !== point.id)), type: "button", children: /* @__PURE__ */ jsx(Trash2, { size: 16 }) })
      ] }, point.id)) }) : /* @__PURE__ */ jsx("p", { className: "teacher-empty-comparison", children: "서로 다른 위치나 날짜의 실제 자료를 최대 세 곳까지 저장해 수업 활동지에 포함할 수 있습니다." })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "teacher-summary", children: [
      /* @__PURE__ */ jsx(Stat, { label: "활동 상태", value: started ? "진행 중" : "준비", sub: started ? "기후값 비교 가능" : "조건 선택" }),
      /* @__PURE__ */ jsx(Stat, { label: "선택 지점", value: lessonLocation.label, sub: lessonLocation.detail ?? "지도에서 선택" }),
      /* @__PURE__ */ jsx(Stat, { label: "월별 체감 기준", value: apparentTemperatureBasis(lessonDate).label, sub: `${Number(lessonDate.slice(5, 7))}월 조회` }),
      /* @__PURE__ */ jsx(Stat, { label: "수업자료", value: saveOutcome === "written" ? "저장 완료" : saveOutcome === "requested" ? "다운로드 요청" : "대기", sub: "실제 수치와 조건 포함" })
    ] })
    ] }),
    /* @__PURE__ */ jsx(ClimateExportDialog, { context: exportContext, onClose: () => setExportContext(null) }),
    remoteState.status === "loading" ? /* @__PURE__ */ jsx(ClimateLoadingOverlay, {}) : null
  ] });
}
function PublicPage() {
  const [coordinates, setCoordinates] = useState({ latitude: 36.35, longitude: 127.38 });
  const [message, setMessage] = useState("지도를 누르거나 학생 탐색에서 자세한 조건을 바꿀 수 있습니다.");
  const [exportContext, setExportContext] = useState(null);
  const [metadata, setMetadata] = useState();
  const [publicDate, setPublicDate] = useState("2050-08-01");
  const [publicScenario, setPublicScenario] = useState("고배출 경로");
  const [publicModel, setPublicModel] = useState(cmip6ModelOptions[0]);
  const [locating, setLocating] = useState(false);
  const availableScenarios = normalizeMetadataOptions(metadata, "scenarios", ["고배출 경로"]);
  const availableModels = normalizeMetadataOptions(metadata, "models", cmip6ModelOptions);
  const remoteState = useRemoteMetricResponse({ coordinate: coordinates, date: publicDate, scenario: publicScenario, model: publicModel });
  const usesRawModelGrid = remoteState.response?.dataMode === "raw-model-grid";
  const publicMetrics = useMemo(
    () => simplifyPublicMetrics(deriveClimateMetrics({ date: publicDate, raw: false, remoteState })),
    [remoteState]
  );
  const hasPublicMetrics = publicMetrics.some((metric) => metric.available !== false && Number.isFinite(metric.numericValue));
  const plainLanguageSummary = buildPlainLanguageSummary(publicMetrics, publicDate);
  const dateYear = Number(publicDate.slice(0, 4));
  const dateMonthDay = publicDate.slice(4);
  const decadeOptions = [2040, 2050, 2070, 2090].filter((year) => {
    const candidate = `${year}${dateMonthDay}`;
    return (!metadata?.dateStart || candidate >= metadata.dateStart) && (!metadata?.dateEnd || candidate <= metadata.dateEnd);
  });
  useEffect(() => {
    let active = true;
    fetchPublicClimateMetadata().then((nextMetadata) => {
      if (!active || !nextMetadata.publicSafe || !nextMetadata.ready) return;
      setMetadata(nextMetadata);
      const models = normalizeMetadataOptions(nextMetadata, "models", cmip6ModelOptions);
      const scenarios = normalizeMetadataOptions(nextMetadata, "scenarios", ["고배출 경로"]);
      setPublicModel(models.includes("전체 앙상블") ? "전체 앙상블" : models[0]);
      setPublicScenario((current) => scenarios.includes(current) ? current : scenarios[0]);
      if (nextMetadata.dateStart && nextMetadata.dateEnd) {
        setPublicDate((current) => clipPeriod(current, current, nextMetadata.dateStart, nextMetadata.dateEnd).start);
      }
    }).catch(() => {
      if (active) setMessage("자료 제공 기간을 확인하지 못했습니다. 현재 선택 날짜로 조회를 계속합니다.");
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (remoteState.status !== "loading") return;
    const preventRefresh = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventRefresh);
    return () => window.removeEventListener("beforeunload", preventRefresh);
  }, [remoteState.status]);
  const moveToCurrentLocation = () => {
    if (!navigator.geolocation) {
      setMessage("이 브라우저에서는 현재 위치 기능을 사용할 수 없습니다. 지도에서 직접 위치를 선택하세요.");
      return;
    }
    setLocating(true);
    setMessage("브라우저에서 현재 위치를 확인하고 있습니다.");
    navigator.geolocation.getCurrentPosition((position) => {
      setCoordinates({ latitude: clamp(position.coords.latitude, -mercatorLatitudeLimit, mercatorLatitudeLimit), longitude: normalizeLongitude(position.coords.longitude) });
      setLocating(false);
      setMessage("현재 위치로 이동했습니다. 실제 기후자료를 다시 조회합니다.");
    }, () => {
      setLocating(false);
      setMessage("현재 위치 권한을 사용할 수 없습니다. 지도에서 직접 위치를 선택하세요.");
    }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
  };
  const changePublicYear = (year) => {
    const candidate = `${year}${dateMonthDay}`;
    const clipped = metadata?.dateStart && metadata?.dateEnd ? clipPeriod(candidate, candidate, metadata.dateStart, metadata.dateEnd).start : candidate;
    setPublicDate(clipped);
    setMessage(`${year}년의 실제 기후자료를 조회합니다.`);
  };
  const openPublicDetail = () => {
    const token = encodeLessonState({
      source: "public",
      date: publicDate,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario: publicScenario,
      model: publicModel,
      focus: "heat"
    });
    window.location.hash = `/query?lesson=${token}`;
  };
  const exportPublicMetric = (metric) => {
    if (!metric.key) return;
    setExportContext({
      date: publicDate,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario: publicScenario,
      model: publicModel,
      initialMetrics: [metric.key],
      includeRaw: false
    });
  };
  const exportPublicMetrics = () => {
    const initialMetrics = publicMetrics.filter((metric) => metric.key && metric.available !== false && Number.isFinite(metric.numericValue)).map((metric) => metric.key);
    setExportContext({
      date: publicDate,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario: publicScenario,
      model: publicModel,
      initialMetrics,
      includeRaw: false
    });
  };
  const savePublicSummary = () => {
    setExportContext({
      date: publicDate,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario: publicScenario,
      model: publicModel,
      initialMetrics: publicMetrics.filter((metric) => metric.key && metric.available !== false).map((metric) => metric.key),
      includeRaw: false,
      initialFormat: "png"
    });
    setMessage("기간과 출력 형식을 고를 수 있는 내보내기 창을 열었습니다.");
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "public-page", children: [
      /* @__PURE__ */ jsxs("section", { className: "public-command-bar", children: [
        /* @__PURE__ */ jsxs("div", { className: "public-location", children: [
          /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(MapPin, { size: 19 }) }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("small", { children: "선택한 위치" }),
            /* @__PURE__ */ jsxs("strong", { children: [coordinates.latitude.toFixed(4), ", ", coordinates.longitude.toFixed(4)] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "public-condition-strip", children: [
          /* @__PURE__ */ jsxs("div", { className: "public-date-control", children: [/* @__PURE__ */ jsx(CalendarDays, { size: 15 }), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("small", { children: "미래 날짜" }), /* @__PURE__ */ jsx(ConfirmedDateInput, { compact: true, label: "미래 날짜", max: metadata?.dateEnd, min: metadata?.dateStart, onConfirm: (nextDate) => {
            setPublicDate(nextDate);
            setMessage(`${nextDate}의 실제 기후자료를 조회합니다.`);
          }, showPickerButton: false, value: publicDate })] })] }),
          /* @__PURE__ */ jsxs("label", { className: "public-scenario-control", children: [/* @__PURE__ */ jsx(Globe2, { size: 15 }), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("small", { children: "시나리오" }), /* @__PURE__ */ jsx("select", { onChange: (event) => setPublicScenario(event.target.value), value: publicScenario, children: availableScenarios.map((option) => /* @__PURE__ */ jsx("option", { children: option }, option)) })] })] }),
          /* @__PURE__ */ jsxs("label", { className: "public-model-control", children: [/* @__PURE__ */ jsx(Activity, { size: 15 }), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("small", { children: "CMIP6 모델" }), /* @__PURE__ */ jsx("select", { "aria-label": "CMIP6 모델", onChange: (event) => {
            setPublicModel(event.target.value);
            setMessage(`${event.target.value} 모델의 실제 기후자료를 조회합니다.`);
          }, value: publicModel, children: availableModels.map((option) => /* @__PURE__ */ jsx("option", { children: option === "전체 앙상블" ? "전체 앙상블 · 여러 모델" : option }, option)) })] })] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "public-command-actions", children: [
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: openPublicDetail, children: [/* @__PURE__ */ jsx(Search, { size: 16 }), "자세히 보기"] }),
          /* @__PURE__ */ jsxs("button", { disabled: locating, type: "button", onClick: moveToCurrentLocation, children: [locating ? /* @__PURE__ */ jsx(LoaderCircle, { className: "spin", size: 16 }) : /* @__PURE__ */ jsx(Navigation, { size: 16 }), locating ? "위치 확인 중" : "내 위치"] }),
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => {
            setCoordinates({ latitude: 37.57, longitude: 126.98 });
            setMessage("학교 주변 예시로 위치와 요약을 바꿨습니다.");
          }, children: [/* @__PURE__ */ jsx(School, { size: 16 }), "학교 예시"] })
        ] })
      ] }),
      decadeOptions.length > 1 ? /* @__PURE__ */ jsxs("section", { className: "public-decade-picker", children: [
        /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx(RefreshCw, { size: 15 }), "시기 바꾸기"] }),
        /* @__PURE__ */ jsx("div", { role: "group", "aria-label": "조회 연도", children: decadeOptions.map((year) => /* @__PURE__ */ jsxs("button", { "aria-pressed": dateYear === year, className: dateYear === year ? "active" : "", onClick: () => changePublicYear(year), type: "button", children: [year, "년"] }, year)) })
      ] }) : null,
      /* @__PURE__ */ jsx("section", { className: "public-map-stage", children: /* @__PURE__ */ jsx(MapPanel, {
        compact: false,
        date: publicDate,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        mapTone: "global",
        rawModelGrid: usesRawModelGrid,
        onCoordinateChange: (nextCoordinate) => {
          setCoordinates(nextCoordinate);
          setMessage("지도에서 선택한 위치로 요약을 갱신했습니다.");
        }
      }) }),
      /* @__PURE__ */ jsxs("section", { className: "public-results-strip", "data-query-state": remoteState.status, children: [
        /* @__PURE__ */ jsxs("div", { className: "public-results-head", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: "선택한 곳의 미래" }),
            /* @__PURE__ */ jsx("h2", { children: `${Number(publicDate.slice(0, 4))}년 ${Number(publicDate.slice(5, 7))}월 ${Number(publicDate.slice(8, 10))}일의 기후` })
          ] }),
          /* @__PURE__ */ jsxs("button", { className: "public-export-action", disabled: !hasPublicMetrics, onClick: exportPublicMetrics, type: "button", children: [
            /* @__PURE__ */ jsx(HardDriveDownload, { size: 16 }),
            "기간 자료 내보내기"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: `mini-status ${remoteState.status === "ready" ? "ok" : "warn"}`, "aria-live": "polite", children: remoteState.message }),
        /* @__PURE__ */ jsxs("div", { className: "public-plain-summary", children: [
          /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(CloudSun, { size: 18 }) }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: "쉽게 읽기" }), /* @__PURE__ */ jsx("p", { children: plainLanguageSummary })] })
        ] }),
        /* @__PURE__ */ jsx(MetricGrid, { items: publicMetrics, onExportMetric: exportPublicMetric }),
        /* @__PURE__ */ jsxs("div", { className: "public-results-footer", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("strong", { children: "현재 화면" }),
            /* @__PURE__ */ jsx("span", { children: message })
          ] }),
          /* @__PURE__ */ jsxs("button", { disabled: !hasPublicMetrics, onClick: savePublicSummary, type: "button", children: [/* @__PURE__ */ jsx(Image, { size: 16 }), "결과 이미지 저장"] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(ClimateExportDialog, { context: exportContext, onClose: () => setExportContext(null) }),
    remoteState.status === "loading" ? /* @__PURE__ */ jsx(ClimateLoadingOverlay, {}) : null
  ] });
}
function useRemoteMetricResponse({
  coordinate,
  date,
  scenario,
  model
}) {
  const request = useMemo(
    () => buildUiRemoteChunkRequest({ coordinate, date, scenario, model }),
    [coordinate.latitude, coordinate.longitude, date, scenario, model]
  );
  const [state, setState] = useState({
    status: "loading",
    message: "실제 기후자료를 조회하고 있습니다."
  });
  useEffect(() => {
    let active = true;
    setState({ status: "loading", message: "실제 기후자료를 조회하고 있습니다." });
    const timer = window.setTimeout(() => {
      fetchPublicClimateQuery(request).then((payload) => {
        if (!active) return;
        const response = responseIfRequestMatches(payload, request);
        if (!response) throw new Error("현재 선택 조건과 응답이 일치하지 않습니다.");
        if (response.coverage === "available") {
          setState({ response, status: "ready", message: "실제 기후자료에서 선택 조건의 값을 불러왔습니다." });
        } else if (response.coverage === "fallback") {
          setState({ response, status: "partial", message: response.fallbackReason ?? "일부 지표의 자료가 없습니다." });
        } else {
          setState({ response, status: "missing", message: response.fallbackReason ?? "선택 조건의 자료가 없습니다." });
        }
      }).catch((error) => {
        if (active) {
          setState({ status: "error", message: error instanceof Error ? error.message : "기후자료 연결을 확인할 수 없습니다. 잠시 후 다시 시도하세요." });
        }
      });
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [request]);
  return state;
}
function buildUiRemoteChunkRequest({
  coordinate,
  date,
  scenario,
  model
}) {
  return {
    stationLabel: `선택 좌표 ${coordinate.latitude.toFixed(2)}, ${coordinate.longitude.toFixed(2)}`,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    date,
    scenario,
    variable: "최고기온",
    model
  };
}
function responseIfRequestMatches(response, request) {
  if (!response) return void 0;
  const validation = validateRemoteChunkResponse(response, request);
  return validation.status === "ready" ? response : void 0;
}
function deriveClimateMetrics({ date, raw, remoteState }) {
  const remoteMetrics = deriveRemoteMetrics({ date, raw, remoteResponse: remoteState.response });
  if (remoteMetrics.length >= 5) return remoteMetrics;
  const waiting = remoteState.status === "loading";
  const comfortLabel = apparentTemperatureBasis(date).label;
  return [
    ["tasmax", "최고기온", "도"],
    ["tasmin", "최저기온", "도"],
    ["precipitation", "강수량", "밀리미터/일"],
    ["wind", "풍속", "미터/초"],
    ["apparentTemperature", comfortLabel, "도"]
  ].map(([key, label, unit]) => ({
    key,
    label,
    value: waiting ? "조회 중" : "자료 없음",
    unit,
    caption: remoteState.message,
    tone: "neutral",
    available: false
  }));
}
function simplifyPublicMetrics(items) {
  const captions = {
    tasmax: "하루 중 가장 높은 기온",
    tasmin: "하루 중 가장 낮은 기온",
    precipitation: "하루 동안 내리는 비",
    wind: "하루 평균 바람",
    apparentTemperature: "월에 따라 열지수 또는 체감기온 적용"
  };
  return items.map((metric) => ({
    ...metric,
    caption: metric.available === false ? metric.caption : captions[metric.key ?? "tasmax"]
  }));
}
function deriveRemoteMetrics({
  date,
  raw,
  remoteResponse
}) {
  if (!remoteResponse || !remoteResponse.publicSafe) return [];
  const metrics = remoteResponse.values.map((metric) => ({
    key: metric.key,
    label: metric.label,
    value: metric.value,
    numericValue: metric.numericValue,
    unit: metric.unit,
    caption: metric.caption,
    tone: metric.tone,
    available: metric.available !== false && metric.numericValue !== void 0,
    ...raw && metric.rawValue !== void 0 ? { rawValue: metric.rawValue, rawNumericValue: metric.rawNumericValue } : {}
  }));
  const basis = apparentTemperatureBasis(date);
  const apparentMetric = metrics.find((metric) => metric.key === basis.metricKey);
  const publicMetrics = metrics.filter((metric) => !["heatIndex", "feelsLike"].includes(metric.key));
  if (apparentMetric) {
    publicMetrics.push({
      ...apparentMetric,
      key: "apparentTemperature",
      label: basis.label,
      caption: `${Number(String(date).slice(5, 7))}월 기준 · ${apparentMetric.caption}`
    });
  }
  return publicMetrics;
}
function MetricGrid({ items, onExportMetric }) {
  return /* @__PURE__ */ jsx("div", { className: "metric-grid", children: items.map((metric) => {
    const icon = metricIcon(metric);
    const metricContent = /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsxs("div", { className: "metric-head", children: [
        /* @__PURE__ */ jsx("span", { className: "metric-icon", children: icon }),
        /* @__PURE__ */ jsx("strong", { children: metric.label })
      ] }),
      /* @__PURE__ */ jsx("b", { children: metric.value }),
      /* @__PURE__ */ jsx("span", { children: metric.caption }),
      metric.rawValue ? /* @__PURE__ */ jsxs("small", { className: "raw-metric", children: [
        "보정 전 ",
        metric.rawValue
      ] }) : null,
      onExportMetric ? /* @__PURE__ */ jsxs(
        "button",
        {
          className: "metric-export-button",
          disabled: metric.available === false || !Number.isFinite(metric.numericValue),
          "aria-label": `${metric.label} 기간 자료 내보내기`,
          onClick: () => onExportMetric(metric),
          type: "button",
          children: [
            /* @__PURE__ */ jsx(HardDriveDownload, { size: 14 }),
            "내보내기"
          ]
        }
      ) : null
    ] });
    return /* @__PURE__ */ jsx(
      "div",
      {
        className: `metric-card ${metric.tone}`,
        "data-metric-label": metric.label,
        "data-metric-value": String(metric.numericValue ?? metric.value),
        "data-metric-raw": metric.rawNumericValue === void 0 ? "" : String(metric.rawNumericValue),
        children: metricContent
      },
      metric.label
    );
  }) });
}
function metricIcon(metric) {
  if (metric.label.includes("최고")) return /* @__PURE__ */ jsx(ThermometerSun, { size: 20 });
  if (metric.label.includes("최저")) return /* @__PURE__ */ jsx(ThermometerSnowflake, { size: 20 });
  if (metric.label.includes("강수")) return /* @__PURE__ */ jsx(CloudRain, { size: 20 });
  if (metric.label.includes("풍속")) return /* @__PURE__ */ jsx(Wind, { size: 20 });
  if (metric.label.includes("열지수")) return /* @__PURE__ */ jsx(Gauge, { size: 20 });
  if (metric.label.includes("체감")) return /* @__PURE__ */ jsx(CloudSun, { size: 20 });
  if (metric.label.includes("습도")) return /* @__PURE__ */ jsx(Droplets, { size: 20 });
  if (metric.tone === "warn") return /* @__PURE__ */ jsx(TriangleAlert, { size: 20 });
  if (metric.tone === "hot") return /* @__PURE__ */ jsx(ThermometerSun, { size: 20 });
  if (metric.tone === "blue") return /* @__PURE__ */ jsx(CloudRain, { size: 20 });
  return /* @__PURE__ */ jsx(Gauge, { size: 20 });
}
function MapPanel({
  compact,
  raw = false,
  rawModelGrid = false,
  date = "2050-08-01",
  latitude = 36.5,
  longitude = 127.4,
  mapTone = "custom",
  onCoordinateChange
}) {
  const initialZoom = compact ? 4 : defaultMapZoom;
  const [zoom, setZoom] = useState(initialZoom);
  const [mapCenter, setMapCenter] = useState({ latitude, longitude });
  const [mapSize, setMapSize] = useState({ width: 900, height: compact ? 448 : 544 });
  const mapElementRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  useEffect(() => {
    setMapCenter({ latitude, longitude });
  }, [latitude, longitude]);
  useEffect(() => {
    setZoom(initialZoom);
  }, [initialZoom]);
  useLayoutEffect(() => {
    const element = mapElementRef.current;
    if (!element) return;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setMapSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = mapElementRef.current;
    if (!element || !onCoordinateChange) return;
    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      setZoom((currentZoom) => mapZoomAfterWheel(currentZoom, event.deltaY));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [onCoordinateChange]);
  const viewport = useMemo(
    () => buildMapViewport({
      latitude: mapCenter.latitude,
      longitude: mapCenter.longitude,
      zoom,
      width: mapSize.width,
      height: mapSize.height
    }),
    [mapCenter.latitude, mapCenter.longitude, mapSize.height, mapSize.width, zoom]
  );
  const markerPosition = coordinateToMapPosition({ latitude, longitude }, viewport);
  const mapScale = mapScaleForZoom(mapCenter.latitude, zoom);
  const selectCoordinateFromEvent = (event) => {
    if (!onCoordinateChange) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const y = clamp(event.clientY - rect.top, 0, rect.height);
    onCoordinateChange(mapPositionToCoordinate(x, y, viewport));
  };
  const changeZoom = (direction) => {
    setZoom((currentZoom) => clamp(currentZoom + direction, 2, 10));
  };
  const resetMapCenter = () => {
    setMapCenter({ latitude, longitude });
  };
  const startDrag = (event) => {
    if (!onCoordinateChange) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, center: mapCenter, current: mapCenter, moved: false };
  };
  const dragMap = (event) => {
    if (!onCoordinateChange || !dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = (event.clientX - dragRef.current.x) / mapTileSize;
    const dy = (event.clientY - dragRef.current.y) / mapTileSize;
    if (Math.abs(event.clientX - dragRef.current.x) + Math.abs(event.clientY - dragRef.current.y) > 4) {
      dragRef.current.moved = true;
    }
    const draggedCenter = coordinateFromTilePoint(
      lonToTileX(dragRef.current.center.longitude, zoom) - dx,
      latToTileY(dragRef.current.center.latitude, zoom) - dy,
      zoom
    );
    dragRef.current.current = draggedCenter;
    setMapCenter(draggedCenter);
  };
  const endDrag = (event) => {
    if (!onCoordinateChange || !dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
    }
    const wasMoved = dragRef.current.moved;
    const draggedCenter = dragRef.current.current;
    dragRef.current = null;
    if (wasMoved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      onCoordinateChange(draggedCenter);
    }
  };
  const cancelDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const originalCenter = dragRef.current.center;
    dragRef.current = null;
    suppressClickRef.current = false;
    setMapCenter(originalCenter);
  };
  const selectCoordinateFromKeyboard = (event) => {
    if (!onCoordinateChange) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(1);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeZoom(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      resetMapCenter();
      return;
    }
    const step = Math.max(0.01, 30 / 2 ** zoom);
    const movements = {
      ArrowUp: { latitude: step, longitude: 0 },
      ArrowDown: { latitude: -step, longitude: 0 },
      ArrowLeft: { latitude: 0, longitude: -step },
      ArrowRight: { latitude: 0, longitude: step }
    };
    const movement = movements[event.key];
    if (movement) {
      event.preventDefault();
      const next = {
        latitude: clamp(latitude + movement.latitude, -85.0511, 85.0511),
        longitude: clamp(longitude + movement.longitude, -180, 180)
      };
      setMapCenter(next);
      onCoordinateChange(next);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onCoordinateChange(mapCenter);
  };
  return /* @__PURE__ */ jsxs("section", { className: `${compact ? "map-panel compact" : "map-panel"} tone-${mapTone}`, children: [
    /* @__PURE__ */ jsxs("div", { className: "map-toolbar", children: [
      /* @__PURE__ */ jsx("span", { children: "OpenStreetMap" }),
      /* @__PURE__ */ jsxs("span", { children: [
        "기준일 ",
        date
      ] }),
      /* @__PURE__ */ jsx("span", { children: rawModelGrid ? "기후모델 원자료" : raw ? "보정 전 값 함께 보기" : "보정값 중심" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "map-controls", "aria-label": "지도 확대 축소", children: [
      /* @__PURE__ */ jsx("button", { onClick: () => changeZoom(1), type: "button", "aria-label": "지도 확대", children: "+" }),
      /* @__PURE__ */ jsx("button", { onClick: () => changeZoom(-1), type: "button", "aria-label": "지도 축소", children: "-" }),
      /* @__PURE__ */ jsx("button", { onClick: resetMapCenter, type: "button", "aria-label": "선택 지점으로 이동", children: /* @__PURE__ */ jsx(LocateFixed, { size: 17 }) })
    ] }),
    /* @__PURE__ */ jsx(
      "div",
      {
        ref: mapElementRef,
        className: onCoordinateChange ? "osm-map interactive" : "osm-map",
        role: onCoordinateChange ? "button" : void 0,
        tabIndex: onCoordinateChange ? 0 : void 0,
        "aria-label": onCoordinateChange ? "지도에서 좌표 선택" : "OpenStreetMap 기반 기후 조회 지도",
        "aria-keyshortcuts": onCoordinateChange ? "ArrowUp ArrowDown ArrowLeft ArrowRight Plus Minus Home Enter Space" : void 0,
        onClick: selectCoordinateFromEvent,
        onKeyDown: selectCoordinateFromKeyboard,
        onPointerDown: startDrag,
        onPointerMove: dragMap,
        onPointerUp: endDrag,
        onPointerCancel: cancelDrag,
        onLostPointerCapture: endDrag,
        children: viewport.tiles.map((tile) => /* @__PURE__ */ jsx(
          "img",
          {
            src: tile.url,
            alt: "",
            "aria-hidden": "true",
            loading: "eager",
            style: { left: tile.left, top: tile.top }
          },
          tile.key
        ))
      }
    ),
    /* @__PURE__ */ jsx(
      "div",
      {
        className: "map-marker",
        "aria-hidden": "true",
        style: { left: markerPosition.x, top: markerPosition.y },
        children: /* @__PURE__ */ jsx(LocateFixed, { size: 20 })
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "map-scale", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("span", { style: { width: mapScale.width } }),
      /* @__PURE__ */ jsx("b", { children: mapScale.label })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "map-attribution", children: "지도 데이터: OpenStreetMap 기여자" }),
    /* @__PURE__ */ jsxs("div", { className: "map-status", children: [
      /* @__PURE__ */ jsxs("strong", { children: [
        "선택 좌표 ",
        latitude.toFixed(4),
        ", ",
        longitude.toFixed(4)
      ] }),
      /* @__PURE__ */ jsxs("span", { children: [
        date,
        " 기준, ",
        onCoordinateChange ? "지도를 눌러 위치 변경 가능" : "예시 위치 표시"
      ] })
    ] })
  ] });
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function buildMapViewport({
  latitude,
  longitude,
  zoom,
  width,
  height
}) {
  const dimension = 2 ** zoom;
  const worldSize = dimension * mapTileSize;
  const viewportWidth = Math.max(1, width);
  const viewportHeight = Math.max(1, height);
  const safeLatitude = clamp(latitude, -mercatorLatitudeLimit, mercatorLatitudeLimit);
  const centerX = lonToTileX(longitude, zoom) * mapTileSize;
  const centerY = latToTileY(safeLatitude, zoom) * mapTileSize;
  const originX = centerX - viewportWidth / 2;
  const originY = clamp(centerY - viewportHeight / 2, 0, Math.max(0, worldSize - viewportHeight));
  const minTileX = Math.floor(originX / mapTileSize);
  const maxTileX = Math.floor((originX + viewportWidth) / mapTileSize);
  const minTileY = Math.floor(originY / mapTileSize);
  const maxTileY = Math.min(dimension - 1, Math.floor((originY + viewportHeight) / mapTileSize));
  const tiles = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedX = wrapTileX(tileX, dimension);
      const clampedY = clamp(tileY, 0, dimension - 1);
      tiles.push({
        key: `${zoom}-${tileX}-${clampedY}`,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${clampedY}.png`,
        left: tileX * mapTileSize - originX,
        top: tileY * mapTileSize - originY
      });
    }
  }
  return { zoom, originX, originY, width: viewportWidth, height: viewportHeight, tiles };
}
function coordinateToMapPosition(coordinate, viewport) {
  const worldSize = 2 ** viewport.zoom * mapTileSize;
  let pixelX = lonToTileX(coordinate.longitude, viewport.zoom) * mapTileSize;
  const pixelY = latToTileY(clamp(coordinate.latitude, -mercatorLatitudeLimit, mercatorLatitudeLimit), viewport.zoom) * mapTileSize;
  while (pixelX < viewport.originX) pixelX += worldSize;
  while (pixelX > viewport.originX + viewport.width) pixelX -= worldSize;
  return {
    x: clamp(pixelX - viewport.originX, 26, Math.max(26, viewport.width - 26)),
    y: clamp(pixelY - viewport.originY, 52, Math.max(52, viewport.height - 28))
  };
}
function mapPositionToCoordinate(x, y, viewport) {
  const tileX = (viewport.originX + x) / mapTileSize;
  const tileY = (viewport.originY + y) / mapTileSize;
  return coordinateFromTilePoint(tileX, tileY, viewport.zoom);
}
function coordinateFromTilePoint(tileX, tileY, zoom) {
  return {
    latitude: clamp(tileYToLat(tileY, zoom), -mercatorLatitudeLimit, mercatorLatitudeLimit),
    longitude: normalizeLongitude(tileXToLon(tileX, zoom))
  };
}
function lonToTileX(longitude, zoom) {
  return (normalizeLongitude(longitude) + 180) / 360 * 2 ** zoom;
}
function latToTileY(latitude, zoom) {
  const radians = clamp(latitude, -mercatorLatitudeLimit, mercatorLatitudeLimit) * Math.PI / 180;
  return (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2 * 2 ** zoom;
}
function tileXToLon(tileX, zoom) {
  return tileX / 2 ** zoom * 360 - 180;
}
function tileYToLat(tileY, zoom) {
  const radians = Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / 2 ** zoom)));
  return radians * 180 / Math.PI;
}
function wrapTileX(tileX, dimension) {
  return (tileX % dimension + dimension) % dimension;
}
function normalizeLongitude(longitude) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}
async function saveTextFile(filename, text) {
  const target = await requestSaveTarget({
    filename,
    mimeType: "text/plain",
    extension: ".txt",
    description: "기후 학습 활동 문서"
  });
  if (target.kind === "cancelled") return saveBlobToTarget(target, new Blob());
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  return saveBlobToTarget(target, blob);
}
function describeSaveResult(result, label) {
  if (result.outcome === "written") return `${label} 파일을 저장했습니다.`;
  if (result.outcome === "cancelled") return `${label} 저장을 취소했습니다.`;
  return `${label} 다운로드를 요청했습니다. 브라우저의 다운로드 목록에서 파일을 확인하세요.`;
}
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}
function Panel({ title, icon, children }) {
  return /* @__PURE__ */ jsxs("section", { className: "panel", children: [
    /* @__PURE__ */ jsxs("div", { className: "panel-title", children: [
      icon,
      /* @__PURE__ */ jsx("h2", { children: title })
    ] }),
    children
  ] });
}
function Field({ label, value }) {
  return /* @__PURE__ */ jsxs("label", { className: "field", children: [
    /* @__PURE__ */ jsx("span", { children: label }),
    /* @__PURE__ */ jsx("input", { value, readOnly: true })
  ] });
}
function CoordinateInput({
  label,
  max,
  min,
  onChange,
  value
}) {
  return /* @__PURE__ */ jsxs("label", { className: "field", children: [
    /* @__PURE__ */ jsx("span", { children: label }),
    /* @__PURE__ */ jsx(
      "input",
      {
        inputMode: "decimal",
        max,
        min,
        onChange: (event) => onChange(event.target.value),
        step: "0.0001",
        type: "number",
        value
      }
    )
  ] });
}
function ConfirmedDateInput({ compact = false, label, min = "2035-01-01", max = "2099-12-31", value, onConfirm, showPickerButton = true }) {
  const inputRef = useRef(null);
  const [draftValue, setDraftValue] = useState(value);
  const [errorMessage, setErrorMessage] = useState("");
  useEffect(() => {
    setDraftValue(value);
    setErrorMessage("");
  }, [value]);
  const confirmValue = () => {
    if (!isCompleteDateValue(draftValue, { min, max })) {
      setErrorMessage("연도, 월, 일을 모두 선택한 뒤 확인을 누르세요.");
      inputRef.current?.focus();
      return;
    }
    setErrorMessage("");
    onConfirm(draftValue);
  };
  const openCalendar = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      input.click();
    }
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: `date-input-wrap${showPickerButton ? "" : " without-picker"}${errorMessage ? " invalid" : ""}${compact ? " compact" : ""}`, children: [
      showPickerButton ? /* @__PURE__ */ jsx(
        "button",
        {
          className: "date-picker-button",
          type: "button",
          "aria-label": `${label} 달력 열기`,
          title: "달력 열기",
          onClick: openCalendar,
          children: /* @__PURE__ */ jsx(CalendarDays, { size: 18 })
        }
      ) : null,
      /* @__PURE__ */ jsx(
        "input",
        {
          ref: inputRef,
          type: "date",
          min,
          max,
          value: draftValue,
          onInput: (event) => {
            setDraftValue(event.currentTarget.value);
            setErrorMessage("");
          },
          onChange: (event) => {
            setDraftValue(event.currentTarget.value);
            setErrorMessage("");
          },
          onKeyDown: (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            confirmValue();
          },
          "aria-invalid": Boolean(errorMessage),
          "aria-label": label
        }
      ),
      /* @__PURE__ */ jsx("button", { "aria-label": compact ? `${label} 확인` : void 0, className: "date-confirm-button", onClick: confirmValue, title: compact ? "날짜 확인" : void 0, type: "button", children: compact ? /* @__PURE__ */ jsx(Check, { size: 14 }) : "확인" })
    ] }),
    errorMessage ? /* @__PURE__ */ jsx("small", { className: "date-error-message", role: "alert", children: errorMessage }) : null
  ] });
}
function DateField({ label, min = "2035-01-01", max = "2099-12-31", value, onChange }) {
  return /* @__PURE__ */ jsxs("div", { className: "field date-field", children: [
    /* @__PURE__ */ jsx("span", { children: label }),
    /* @__PURE__ */ jsx(ConfirmedDateInput, { label, max, min, onConfirm: onChange, value })
  ] });
}
function NoticeCard({ title, body }) {
  return /* @__PURE__ */ jsxs("div", { className: "notice-card", children: [
    /* @__PURE__ */ jsx("strong", { children: title }),
    /* @__PURE__ */ jsx("p", { children: body })
  ] });
}
function Stat({ label, value, sub }) {
  return /* @__PURE__ */ jsxs("div", { className: "stat-card", children: [
    /* @__PURE__ */ jsx("span", { children: label }),
    /* @__PURE__ */ jsx("strong", { children: value }),
    /* @__PURE__ */ jsx("p", { children: sub })
  ] });
}
function registerAppShell() {
  if (!("serviceWorker" in navigator)) return;
  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    }).catch(() => void 0);
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope: "./" }).catch(() => void 0);
  });
}
createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsx(StrictMode, { children: /* @__PURE__ */ jsx(App, {}) })
);
registerAppShell();
