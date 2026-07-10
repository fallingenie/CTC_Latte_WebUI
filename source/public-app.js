import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRef, useState, useEffect, useMemo, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { X, CalendarDays, Download, Table2, FileText, Image, Eye, ThermometerSun, ThermometerSnowflake, CloudRain, Wind, Check, LoaderCircle, CloudSun, Search, MapPin, GraduationCap, UsersRound, HardDriveDownload, PlayCircle, Activity, School, Globe2, LocateFixed, Droplets, TriangleAlert, Gauge } from "lucide-react";
async function exportClimateSeries(response, format) {
  const stem = climateExportFileStem(response);
  if (format === "csv") {
    const blob2 = new Blob([buildClimateCsv(response)], { type: "text/csv;charset=utf-8" });
    const filename2 = `${stem}.csv`;
    downloadBlob$1(filename2, blob2);
    return filename2;
  }
  const canvas = await buildClimateReportCanvas(response);
  if (format === "png") {
    const blob2 = await canvasBlob(canvas, "image/png");
    const filename2 = `${stem}.png`;
    downloadBlob$1(filename2, blob2);
    return filename2;
  }
  const blob = await canvasPdfBlob(canvas);
  const filename = `${stem}.pdf`;
  downloadBlob$1(filename, blob);
  return filename;
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
      rows.push([
        date,
        response.latitude.toFixed(6),
        response.longitude.toFixed(6),
        response.scenario,
        response.model,
        metric.key,
        metric.label,
        metric.unit,
        response.dataMode,
        csvNumber(metric.corrected.p10[dateIndex]),
        csvNumber(metric.corrected.p50[dateIndex]),
        csvNumber(metric.corrected.p90[dateIndex]),
        csvNumber(metric.raw?.p10[dateIndex]),
        csvNumber(metric.raw?.p50[dateIndex]),
        csvNumber(metric.raw?.p90[dateIndex]),
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
  const footerHeight = 170;
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
    x: plotLeft + (indexes.length <= 1 ? 0 : indexPosition / (indexes.length - 1)) * plotWidth,
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
    previousIndex = index;
    hasPoint = true;
  });
  if (!hasPoint) return;
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.stroke();
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
function downloadBlob$1(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 2e3);
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
  { key: "heatIndex", label: "열지수", icon: ThermometerSun },
  { key: "feelsLike", label: "체감기온", icon: ThermometerSun }
];
const formatOptions = [
  { key: "csv", label: "CSV", detail: "전체 일별 수치", icon: Table2 },
  { key: "pdf", label: "PDF", detail: "보고서와 그래프", icon: FileText },
  { key: "png", label: "PNG", detail: "고해상도 이미지", icon: Image }
];
function ClimateExportDialog({ context, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
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
      nextEnd = formatDate(addDays(selected, 364));
    } else if (kind === "fiveYears") {
      nextEnd = formatDate(addDays(selected, 365 * 5 - 1));
    } else if (kind === "tenYears") {
      nextEnd = formatDate(addDays(selected, 365 * 10 - 1));
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
      const payload = await fetchPublicClimateSeries({
        latitude: context.latitude,
        longitude: context.longitude,
        startDate,
        endDate,
        scenario: context.scenario,
        model: context.model,
        metrics: selectedMetrics,
        includeRaw
      });
      if (!isClimateSeriesResponse(payload, { startDate, endDate, selectedMetrics })) {
        throw new Error("선택 조건과 기간 응답이 일치하지 않습니다.");
      }
      setResponse(payload);
      setPreviewMetric(payload.metrics[0]?.key ?? selectedMetrics[0]);
      setStatus("ready");
      setMessage(
        payload.coverage === "available" ? `${payload.dates.length.toLocaleString("ko-KR")}일 자료를 확인했습니다.` : payload.fallbackReason ?? "일부 날짜의 자료 제공 범위를 확인하세요."
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
      const filename = await exportClimateSeries(response, format);
      setStatus("ready");
      setMessage(`${filename} 파일을 저장했습니다.`);
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
        /* @__PURE__ */ jsx("span", { children: rawGrid ? "기후모델 원자료 p50과 p10~p90 범위" : "보정 후 p50과 p10~p90 범위" })
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
  const xForPosition = (position) => 48 + (indexes.length <= 1 ? 0 : position / (indexes.length - 1)) * 692;
  const xForDate = (dateIndex) => 48 + (dates.length <= 1 ? 0 : dateIndex / (dates.length - 1)) * 692;
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
    correctedLine: line(metric.corrected.p50),
    correctedBand: band(metric.corrected.p10, metric.corrected.p90),
    rawLine: metric.raw ? line(metric.raw.p50) : "",
    rawBand: metric.raw ? band(metric.raw.p10, metric.raw.p90) : ""
  };
}
function isClimateSeriesResponse(value, expected) {
  if (!value || typeof value !== "object") return false;
  const response = value;
  return response.publicSafe === true && ["bias-corrected", "raw-model-grid"].includes(response.dataMode) && response.dateStart === expected.startDate && response.dateEnd === expected.endDate && Array.isArray(response.dates) && Array.isArray(response.metrics) && expected.selectedMetrics.every((key) => response.metrics.some((metric) => metric.key === key));
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
    dataNote: "저장 자료 범위 안의 예시 좌표입니다. 수업용 화면에서는 출처 고지가 함께 붙습니다.",
    metrics: [
      { label: "최고기온", value: "34.2도", caption: "보정 중간값", tone: "hot" },
      { label: "최저기온", value: "25.1도", caption: "보정 중간값", tone: "green" },
      { label: "강수량", value: "7.8", caption: "밀리미터/일", tone: "blue" },
      { label: "체감 위험", value: "높음", caption: "야외활동 주의", tone: "warn" }
    ]
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
    dataNote: "학교 주변 활동지에 바로 넣을 수 있도록 좌표와 날짜가 예시로 채워집니다.",
    metrics: [
      { label: "최고기온", value: "29.6도", caption: "보정 중간값", tone: "hot" },
      { label: "최저기온", value: "20.8도", caption: "아침 비교", tone: "green" },
      { label: "가까운 관측소", value: "1.8킬로미터", caption: "거리 보정 가능", tone: "green" },
      { label: "자료 신뢰", value: "안정", caption: "범위 안 예시", tone: "neutral" }
    ]
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
    dataNote: "강수 수업 예시로, 같은 날짜의 기온 지표도 함께 비교할 수 있습니다.",
    metrics: [
      { label: "강수량", value: "18.4", caption: "밀리미터/일", tone: "blue" },
      { label: "최고기온", value: "30.1도", caption: "보정 중간값", tone: "hot" },
      { label: "최저기온", value: "24.6도", caption: "보정 중간값", tone: "green" },
      { label: "자료 신뢰", value: "5/6", caption: "1개 모델 주의", tone: "warn" }
    ]
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
    dataNote: "범위 밖 좌표라서 보정값 대신 대체 조회 안내와 신뢰 상태를 먼저 보여줍니다.",
    metrics: [
      { label: "최고기온", value: "11.8도", caption: "대체 조회", tone: "neutral" },
      { label: "최저기온", value: "3.9도", caption: "대체 조회", tone: "neutral" },
      { label: "강수량", value: "2.4", caption: "밀리미터/일", tone: "blue" },
      { label: "자료 신뢰", value: "주의", caption: "범위 밖 예시", tone: "warn" }
    ]
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
    dataNote: "클릭한 좌표를 기준으로 예시 조회 조건을 구성합니다.",
    metrics: [
      { label: "최고기온", value: "계산 예정", caption: "좌표 선택됨", tone: "neutral" },
      { label: "최저기온", value: "계산 예정", caption: "좌표 선택됨", tone: "neutral" },
      { label: "강수량", value: "계산 예정", caption: "좌표 선택됨", tone: "neutral" },
      { label: "자료 신뢰", value: "확인 중", caption: "범위 확인 필요", tone: "warn" }
    ]
  }
];
function routeFromHash() {
  const raw = window.location.hash.replace(/^#/, "") || "/";
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
      const nextRoute = routeFromHash();
      const canonicalHash = `#${nextRoute}`;
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
  const page = useMemo(() => renderRoute(route), [route]);
  return /* @__PURE__ */ jsxs("div", { className: "app", children: [
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
      /* @__PURE__ */ jsxs("button", { className: "header-example-button", onClick: openExamplePicker, type: "button", children: [
        /* @__PURE__ */ jsx(Search, { size: 17 }),
        "예시 보기"
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs("main", { className: "main", children: [
      /* @__PURE__ */ jsx(TopBar, { route }),
      page
    ] })
  ] });
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
  const [selectedPresetId, setSelectedPresetId] = useState(initialPreset.id);
  const activePreset = queryPresets.find((preset) => preset.id === selectedPresetId) ?? queryPresets[0];
  const presetGridRef = useRef(null);
  const [model, setModel] = useState(initialPreset.model);
  const [raw, setRaw] = useState(initialPreset.raw);
  const [date, setDate] = useState(initialPreset.date);
  const [scenario, setScenario] = useState(initialPreset.scenario);
  const [coordinates, setCoordinates] = useState({
    latitude: initialPreset.latitude,
    longitude: initialPreset.longitude
  });
  const [latitudeInput, setLatitudeInput] = useState(initialPreset.latitude.toFixed(4));
  const [longitudeInput, setLongitudeInput] = useState(initialPreset.longitude.toFixed(4));
  const [exportContext, setExportContext] = useState(null);
  const [queryMessage, setQueryMessage] = useState("예시를 고르거나 지도를 눌러 좌표를 지정하세요.");
  const remoteState = useRemoteMetricResponse({ coordinate: coordinates, date, scenario, model });
  const usesRawModelGrid = remoteState.response?.dataMode === "raw-model-grid";
  const metricsForSelection = useMemo(
    () => deriveClimateMetrics({ raw, remoteState }),
    [raw, remoteState]
  );
  const hasExportableMetrics = metricsForSelection.some((metric) => metric.available !== false && Number.isFinite(metric.numericValue));
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
    applyPendingCoordinate();
    window.addEventListener("ctc:apply-coordinate", applyPendingCoordinate);
    window.addEventListener("ctc:show-examples", showExamples);
    return () => {
      window.removeEventListener("ctc:apply-coordinate", applyPendingCoordinate);
      window.removeEventListener("ctc:show-examples", showExamples);
    };
  }, []);
  const selectPreset = (preset) => {
    setSelectedPresetId(preset.id);
    setDate(preset.date);
    setScenario(preset.scenario);
    setModel(preset.model);
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
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "query-layout", children: [
      /* @__PURE__ */ jsxs("section", { className: "query-panel", children: [
        /* @__PURE__ */ jsx("h2", { children: audience === "student" ? "궁금한 곳 선택" : "질의 조건" }),
        /* @__PURE__ */ jsx("div", { className: "preset-grid", ref: presetGridRef, children: queryPresets.map((preset) => /* @__PURE__ */ jsxs(
          "button",
          {
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
        /* @__PURE__ */ jsx(DateField, { label: "날짜", value: date, onChange: setDate }),
        /* @__PURE__ */ jsxs("div", { className: "field-pair", children: [
          /* @__PURE__ */ jsx(CoordinateInput, { label: "위도", max: mercatorLatitudeLimit, min: -mercatorLatitudeLimit, onChange: setLatitudeInput, value: latitudeInput }),
          /* @__PURE__ */ jsx(CoordinateInput, { label: "경도", max: 180, min: -180, onChange: setLongitudeInput, value: longitudeInput })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
          "시나리오",
          /* @__PURE__ */ jsx("select", { value: scenario, onChange: (event) => setScenario(event.target.value), children: /* @__PURE__ */ jsx("option", { children: "고배출 경로" }) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
          "모델",
          /* @__PURE__ */ jsx("select", { value: model, onChange: (event) => setModel(event.target.value), children: cmip6ModelOptions.map((modelOption) => /* @__PURE__ */ jsx("option", { children: modelOption }, modelOption)) })
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
        /* @__PURE__ */ jsx(NoticeCard, { title: "선택한 예시", body: activePreset.summary }),
        /* @__PURE__ */ jsx(NoticeCard, { title: "선택 조건", body: `${activePreset.dataNote} 현재 좌표는 위도 ${coordinates.latitude.toFixed(4)}, 경도 ${coordinates.longitude.toFixed(4)}입니다.` })
      ] })
    ] }),
    /* @__PURE__ */ jsx(ClimateExportDialog, { context: exportContext, onClose: () => setExportContext(null) }),
    remoteState.status === "loading" ? /* @__PURE__ */ jsx(ClimateLoadingOverlay, {}) : null
  ] });
}
function ClimateLoadingOverlay() {
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
        /* @__PURE__ */ jsx("div", { "aria-label": "기후자료 불러오는 중", "aria-valuetext": "진행 중", className: "climate-loading-progress", role: "progressbar", children: /* @__PURE__ */ jsx("span", {}) }),
        /* @__PURE__ */ jsx("small", { children: "자료를 찾으면 결과 카드가 자동으로 바뀝니다." })
      ]
    }
  ) });
}
function TeacherPage() {
  const [started, setStarted] = useState(false);
  const [saved, setSaved] = useState(false);
  const activeStudents = started ? "18명 진행" : "준비됨";
  const saveTeacherPack = () => {
    setSaved(true);
    downloadTextFile(
      "climate-class-activity.txt",
      [
        "기후 타임캡슐 수업 활동",
        "활동: 우리 지역 2050년 여름",
        "비교 지점: 학교 / 해안 / 산지",
        "학생 화면: 학생 탐색 탭에서 예시와 지도를 사용",
        "저장 상태: 수업 요약 생성"
      ].join("\n")
    );
  };
  return /* @__PURE__ */ jsxs("div", { className: "page-grid", children: [
    /* @__PURE__ */ jsx("section", { className: "span-12", children: /* @__PURE__ */ jsxs("div", { className: "teacher-stats", children: [
      /* @__PURE__ */ jsx(Stat, { label: "수업 단계", value: started ? "활동 중" : "준비", sub: started ? "좌표 비교 시작" : "조건 확인" }),
      /* @__PURE__ */ jsx(Stat, { label: "학생 참여", value: activeStudents, sub: "오류 없음" }),
      /* @__PURE__ */ jsx(Stat, { label: "지도 활동", value: started ? "열림" : "대기", sub: "학생 탐색과 연결" }),
      /* @__PURE__ */ jsx(Stat, { label: "저장", value: saved ? "완료" : "대기", sub: "수업 요약 파일" })
    ] }) }),
    /* @__PURE__ */ jsx("section", { className: "span-4", children: /* @__PURE__ */ jsxs(Panel, { title: "수업 조건", icon: /* @__PURE__ */ jsx(GraduationCap, { size: 19 }), children: [
      /* @__PURE__ */ jsx(Field, { label: "학급 활동", value: "우리 지역 2050년 여름" }),
      /* @__PURE__ */ jsx(Field, { label: "비교 지점", value: "학교 / 해안 / 산지" }),
      /* @__PURE__ */ jsxs("button", { className: "primary-action wide", onClick: () => setStarted(true), type: "button", children: [
        /* @__PURE__ */ jsx(PlayCircle, { size: 18 }),
        started ? "활동 진행 중" : "활동 시작"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "teacher-actions", children: [
        /* @__PURE__ */ jsx("button", { type: "button", onClick: () => openQueryWithCoordinate({ latitude: 37.57, longitude: 126.98 }), children: "학생 화면 열기" }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: saveTeacherPack, children: "수업자료 저장" })
      ] }),
      /* @__PURE__ */ jsx("div", { className: started ? "mini-status ok" : "mini-status warn", children: started ? "학생 탐색 화면과 같은 예시 흐름으로 활동을 진행합니다." : "활동 시작을 누르면 진행 상태가 바뀝니다." })
    ] }) }),
    /* @__PURE__ */ jsx("section", { className: "span-5", children: /* @__PURE__ */ jsx(MapPanel, { compact: true, latitude: 37.57, longitude: 126.98, mapTone: "school" }) }),
    /* @__PURE__ */ jsx("section", { className: "span-3", children: /* @__PURE__ */ jsx(Panel, { title: "진행 상태", icon: /* @__PURE__ */ jsx(Activity, { size: 19 }), children: /* @__PURE__ */ jsx("div", { className: "timeline", children: ["좌표 선택", "기후값 조회", "수업자료 저장", "출처 검증"].map((step, index) => /* @__PURE__ */ jsxs("div", { className: started && index < (saved ? 4 : 2) ? "timeline-row done" : "timeline-row", children: [
      /* @__PURE__ */ jsx("span", {}),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("strong", { children: step }),
        /* @__PURE__ */ jsx("p", { children: started && index < (saved ? 4 : 2) ? "완료" : "대기" })
      ] })
    ] }, step)) }) }) })
  ] });
}
function PublicPage() {
  const [coordinates, setCoordinates] = useState({ latitude: 36.35, longitude: 127.38 });
  const [message, setMessage] = useState("지도를 누르거나 학생 탐색에서 자세한 조건을 바꿀 수 있습니다.");
  const [exportContext, setExportContext] = useState(null);
  const publicDate = "2050-08-01";
  const publicScenario = "고배출 경로";
  const publicModel = cmip6ModelOptions[0];
  const remoteState = useRemoteMetricResponse({ coordinate: coordinates, date: publicDate, scenario: publicScenario, model: publicModel });
  const usesRawModelGrid = remoteState.response?.dataMode === "raw-model-grid";
  const publicMetrics = useMemo(
    () => simplifyPublicMetrics(deriveClimateMetrics({ raw: false, remoteState })),
    [remoteState]
  );
  const hasPublicMetrics = publicMetrics.some((metric) => metric.available !== false && Number.isFinite(metric.numericValue));
  useEffect(() => {
    if (remoteState.status !== "loading") return;
    const preventRefresh = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventRefresh);
    return () => window.removeEventListener("beforeunload", preventRefresh);
  }, [remoteState.status]);
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
    /* @__PURE__ */ jsxs("div", { className: "page-grid public-grid", children: [
      /* @__PURE__ */ jsx("section", { className: "span-7", children: /* @__PURE__ */ jsx(
        MapPanel,
        {
          compact: false,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          mapTone: "heat",
          rawModelGrid: usesRawModelGrid,
          onCoordinateChange: (nextCoordinate) => {
            setCoordinates(nextCoordinate);
            setMessage("지도에서 선택한 위치로 요약을 갱신했습니다.");
          }
        }
      ) }),
      /* @__PURE__ */ jsx("section", { className: "span-5", "data-query-state": remoteState.status, children: /* @__PURE__ */ jsxs(Panel, { title: "오늘 선택한 곳의 미래", icon: /* @__PURE__ */ jsx(CloudSun, { size: 19 }), children: [
        /* @__PURE__ */ jsxs("button", { className: "secondary-action wide", disabled: !hasPublicMetrics, onClick: exportPublicMetrics, type: "button", children: [
          /* @__PURE__ */ jsx(HardDriveDownload, { size: 16 }),
          "전체 자료 내보내기"
        ] }),
        /* @__PURE__ */ jsx("div", { className: `mini-status ${remoteState.status === "ready" ? "ok" : "warn"}`, "aria-live": "polite", children: remoteState.message }),
        /* @__PURE__ */ jsx(MetricGrid, { items: publicMetrics, onExportMetric: exportPublicMetric }),
        /* @__PURE__ */ jsx(NoticeCard, { title: "선택 위치", body: `위도 ${coordinates.latitude.toFixed(4)}, 경도 ${coordinates.longitude.toFixed(4)} 기준 요약입니다.` }),
        /* @__PURE__ */ jsx(NoticeCard, { title: "화면 상태", body: message }),
        /* @__PURE__ */ jsxs("div", { className: "teacher-actions", children: [
          /* @__PURE__ */ jsx("button", { type: "button", onClick: () => openQueryWithCoordinate(coordinates), children: "자세히 바꾸기" }),
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => {
                setCoordinates({ latitude: 37.57, longitude: 126.98 });
                setMessage("학교 주변 예시로 좌표와 요약값을 바꿨습니다.");
              },
              children: "학교 주변 예시"
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("button", { className: "primary-action wide", disabled: !hasPublicMetrics, onClick: savePublicSummary, type: "button", children: [
          /* @__PURE__ */ jsx(HardDriveDownload, { size: 18 }),
          "결과 이미지 저장"
        ] })
      ] }) })
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
      }).catch(() => {
        if (active) {
          setState({ status: "error", message: "기후자료 연결을 확인할 수 없습니다. 잠시 후 다시 시도하세요." });
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
function deriveClimateMetrics({ raw, remoteState }) {
  const remoteMetrics = deriveRemoteMetrics({ raw, remoteResponse: remoteState.response });
  if (remoteMetrics.length >= 6) return remoteMetrics;
  const waiting = remoteState.status === "loading";
  return [
    ["tasmax", "최고기온", "도"],
    ["tasmin", "최저기온", "도"],
    ["precipitation", "강수량", "밀리미터/일"],
    ["wind", "풍속", "미터/초"],
    ["heatIndex", "열지수", "도"],
    ["feelsLike", "체감기온", "도"]
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
    heatIndex: "고온과 습도를 반영한 열 스트레스",
    feelsLike: "더위·추위·바람을 반영한 대표 체감기온"
  };
  return items.map((metric) => ({
    ...metric,
    caption: metric.available === false ? metric.caption : captions[metric.key ?? "tasmax"]
  }));
}
function deriveRemoteMetrics({
  raw,
  remoteResponse
}) {
  if (!remoteResponse || !remoteResponse.publicSafe) return [];
  return remoteResponse.values.map((metric) => ({
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
  if (metric.label.includes("열지수")) return /* @__PURE__ */ jsx(ThermometerSun, { size: 20 });
  if (metric.label.includes("체감")) return /* @__PURE__ */ jsx(ThermometerSun, { size: 20 });
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
  useEffect(() => {
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
  const zoomMap = (event) => {
    if (!onCoordinateChange) return;
    event.preventDefault();
    setZoom((currentZoom) => clamp(currentZoom + (event.deltaY < 0 ? 1 : -1), 2, 10));
  };
  const changeZoom = (direction) => {
    setZoom((currentZoom) => clamp(currentZoom + direction, 2, 10));
  };
  const resetMapCenter = () => {
    setMapCenter({ latitude, longitude });
  };
  const startDrag = (event) => {
    if (!onCoordinateChange) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
    }
    dragRef.current = { x: event.clientX, y: event.clientY, center: mapCenter, current: mapCenter, moved: false };
  };
  const dragMap = (event) => {
    if (!onCoordinateChange || !dragRef.current) return;
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
    if (!onCoordinateChange || !dragRef.current) return;
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
      onCoordinateChange(draggedCenter);
    }
  };
  const selectCoordinateFromKeyboard = (event) => {
    if (!onCoordinateChange) return;
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
        onClick: selectCoordinateFromEvent,
        onKeyDown: selectCoordinateFromKeyboard,
        onWheel: zoomMap,
        onPointerDown: startDrag,
        onPointerMove: dragMap,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
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
      "button",
      {
        className: "map-marker",
        "aria-label": `선택 좌표 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        onClick: () => onCoordinateChange?.({ latitude, longitude }),
        style: { left: markerPosition.x, top: markerPosition.y },
        type: "button",
        children: /* @__PURE__ */ jsx(LocateFixed, { size: 20 })
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "map-scale", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("span", {}),
      /* @__PURE__ */ jsx("b", { children: "50 km" })
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
function downloadTextFile(filename, text) {
  downloadBlob(filename, text, "text/plain;charset=utf-8");
}
function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 2e3);
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
function DateField({ label, value, onChange }) {
  const inputRef = useRef(null);
  const updateValue = (nextValue) => {
    if (nextValue) onChange(nextValue);
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
  return /* @__PURE__ */ jsxs("label", { className: "field date-field", children: [
    /* @__PURE__ */ jsx("span", { children: label }),
    /* @__PURE__ */ jsxs("div", { className: "date-input-wrap", children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          className: "date-picker-button",
          type: "button",
          "aria-label": `${label} 달력 열기`,
          title: "달력 열기",
          onClick: openCalendar,
          children: /* @__PURE__ */ jsx(CalendarDays, { size: 18 })
        }
      ),
      /* @__PURE__ */ jsx(
        "input",
        {
          ref: inputRef,
          type: "date",
          min: "2035-01-01",
          max: "2099-12-31",
          value,
          onInput: (event) => updateValue(event.currentTarget.value),
          onChange: (event) => updateValue(event.currentTarget.value),
          "aria-label": label
        }
      )
    ] })
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
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope: "./" }).catch(() => void 0);
  });
}
createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsx(StrictMode, { children: /* @__PURE__ */ jsx(App, {}) })
);
registerAppShell();
