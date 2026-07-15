import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRef, useState, useEffect, useLayoutEffect, useMemo, useReducer, useCallback, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { X, CalendarDays, Download, Table2, FileText, Image, Eye, ThermometerSun, ThermometerSnowflake, CloudRain, Wind, Check, LoaderCircle, CloudSun, Search, MapPin, GraduationCap, UsersRound, HardDriveDownload, PlayCircle, Activity, School, Globe2, LocateFixed, Droplets, TriangleAlert, Gauge, Mountain, Waves, ArrowLeft, ArrowRight, Sun, Moon, Monitor, BookOpen, BookmarkPlus, ClipboardCopy, Navigation, Plus, Minus, Trash2, NotebookPen, Target, Link, LockKeyhole, RefreshCw } from "lucide-react";
import { requestSaveTarget, saveBlobToTarget } from "./browser-download.js";
import { climateProblemSets } from "./climate-problem-catalog.js";
import { PUBLIC_ATTRIBUTION_CATALOG, findClimateModelAttribution } from "./attribution-catalog.js";
import { buildClimatePdfBlob } from "./climate-pdf.js";
import { buildAttributionBundle, buildPublicExportAttribution } from "./export-attribution.js";
import {
  PUBLIC_DATASET_REACTIVATION_MIN_INTERVAL_MS,
  PUBLIC_DATASET_REFRESH_INTERVAL_MS,
  createPublicMetadataRefreshQueue,
  formatPublicDatasetUpdatedAt,
  isCurrentPublicDatasetResult,
  isMatchingPublicDatasetIdentity,
  isPublicDatasetIdentityChange,
  validatePublicClimateQueryResponse,
  validatePublicClimateRetryableError,
  validatePublicClimateSeriesResponse,
  validatePublicDatasetMetadata,
  validatePublicRuntimeConfig
} from "./runtime-policy.js";
import {
  apparentTemperatureBasis,
  buildClimateCsv,
  buildInteractiveClimateHtml,
  buildPlainLanguageSummary,
  calendarPeriodEnd,
  chartComparison,
  chartWindowAfterPan,
  chartWindowAfterWheel,
  compareMetricSnapshots,
  createMetricSnapshot,
  decodeLessonState,
  encodeLessonState,
  filterClimateSeriesByMonths,
  formatCoordinatePair,
  formatPublicMetricValue,
  isCompleteDateValue,
  isContinuousSampledDateRange,
  isMatchingClimateSeriesResponse,
  isPublicClimateTextPayloadSafe,
  isPublicGatewayTextSafe,
  mapMarkerSizeForZoom,
  mapScaleForZoom,
  mapZoomAfterWheel,
  metricDisplayUnit,
  normalizeMetadataOptions,
  normalizePublicAttributionLabels,
  parseHashLocation,
  sanitizeNote,
  selectClimateSeriesMetrics,
  seriesPointX
} from "./workbench-logic.js";
import {
  TEACHER_FLOW_ACTIONS,
  TEACHER_QUERY_STATUSES,
  TEACHER_STEP_DEFINITIONS,
  TEACHER_STEP_IDS,
  createTeacherStepFlowState,
  getTeacherStepNavigation,
  resolveTeacherQueryStatus,
  teacherStepFlowReducer,
  validateTeacherLessonConditions,
  validateTeacherReviewReadiness
} from "./teacher-step-flow.js";
async function exportClimateSeries(response, format) {
  if (!isPublicClimateTextPayloadSafe(response)) {
    throw new TypeError("자료를 안전하게 저장할 수 없어 중단했습니다. 자료를 다시 불러온 뒤 시도하세요.");
  }
  const stem = climateExportFileStem(response);
  const specifications = {
    csv: { filename: `${stem}.zip`, mimeType: "application/zip", extension: ".zip", description: "날짜별 기후 자료와 출처 묶음" },
    png: { filename: `${stem}.png`, mimeType: "image/png", extension: ".png", description: "날짜별 기후 변화 이미지" },
    pdf: { filename: `${stem}.pdf`, mimeType: "application/pdf", extension: ".pdf", description: "날짜별 기후 변화 보고서" },
    html: { filename: `${stem}.html`, mimeType: "text/html", extension: ".html", description: "대화형 기후 변화 그래프" }
  };
  const specification = specifications[format] ?? specifications.pdf;
  const target = await requestSaveTarget(specification);
  if (target.kind === "cancelled") return saveBlobToTarget(target, new Blob());
  let blob;
  if (format === "csv") {
    blob = await buildAttributionBundle({
      csv: `\uFEFF${buildClimateCsv(response)}`,
      csvFilename: `${stem}.csv`,
      dataMode: response.dataMode,
      model: response.model,
      datasetVersion: response.datasetVersion,
      datasetUpdatedAt: response.datasetUpdatedAt,
      generatedAt: response.generatedAt
    });
  } else if (format === "html") {
    blob = new Blob([buildInteractiveClimateHtml(response, await buildInteractiveAttributionPayload(response))], { type: "text/html;charset=utf-8" });
  } else {
    const canvas = await buildClimateReportCanvas(response);
    blob = format === "png" ? await canvasBlob(canvas, "image/png") : await buildClimatePdfBlob(canvas, response);
  }
  return saveBlobToTarget(target, blob);
}
async function buildInteractiveAttributionPayload(response) {
  const record = buildPublicExportAttribution({
    dataMode: response.dataMode,
    model: response.model,
    datasetVersion: response.datasetVersion,
    datasetUpdatedAt: response.datasetUpdatedAt,
    generatedAt: response.generatedAt
  });
  const markDataUrls = await Promise.all([
    imageAssetDataUrl("./assets/licenses/kma_mark_1.png"),
    imageAssetDataUrl("./assets/licenses/kma_mark_2.png")
  ]);
  return { ...record, markDataUrls };
}
async function imageAssetDataUrl(path) {
  const response = await fetch(path, { cache: "force-cache" });
  if (!response.ok) throw new Error("출처 표시 이미지를 불러오지 못했습니다.");
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("출처 표시 이미지를 읽지 못했습니다."));
    reader.onerror = () => reject(new Error("출처 표시 이미지를 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}
function climateExportFileStem(response) {
  const metricPart = response.metrics.length === 1 ? response.metrics[0].key : "all-metrics";
  return `climate-series_${metricPart}_${response.dateStart}_${response.dateEnd}`;
}
async function buildClimateReportCanvas(response) {
  const width = 1600;
  const chartHeight = 230;
  const footerHeight = 285;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  const measurementContext = canvas.getContext("2d");
  if (!measurementContext) throw new Error("이미지 생성 기능을 사용할 수 없습니다.");
  const headerLayout = climateReportHeaderLayout(measurementContext, response, width);
  const headerHeight = headerLayout.headerHeight;
  const height = headerHeight + response.metrics.length * chartHeight + footerHeight;
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
  context.fillText(`${response.dateStart} ~ ${response.dateEnd} · ${response.dates.length.toLocaleString("ko-KR")}일${response.seasonMonths?.length ? ` · ${response.seasonMonths.join(", ")}월만` : ""}`, 88, 174);
  context.fillText(
    `${formatCoordinatePair(response.latitude, response.longitude)} · ${response.scenario} · ${response.model}`,
    88,
    220
  );
  const coverageY = headerLayout.coverageY;
  if (response.exploration) {
    context.fillStyle = "#126b52";
    context.font = '700 25px "Segoe UI", "Noto Sans KR", sans-serif';
    drawWrappedCanvasText(context, response.exploration.title ?? "탐구 문제", 88, headerLayout.titleY, headerLayout.textWidth, 34, 2);
    context.fillStyle = "#35443d";
    context.font = '21px "Segoe UI", "Noto Sans KR", sans-serif';
    drawWrappedCanvasText(context, response.exploration.question ?? "", 88, headerLayout.questionY, headerLayout.textWidth, 30, 3);
    context.fillStyle = "#6b5a4b";
    context.font = '18px "Segoe UI", "Noto Sans KR", sans-serif';
    drawWrappedCanvasText(context, `해석할 때 주의할 점: ${response.exploration.interpretationLimit ?? ""}`, 88, headerLayout.limitY, headerLayout.textWidth, 26, 4);
  }
  context.fillStyle = response.coverage === "available" ? "#25845f" : "#a35d0b";
  context.font = '700 24px "Segoe UI", "Noto Sans KR", sans-serif';
  const coverageText = response.dataMode === "raw-model-grid" ? "선택한 위치의 기후 모델 원자료를 확인했습니다." : response.coverage === "available" ? "선택한 기간의 자료를 확인했습니다." : "일부 값은 자료를 제공하는 모델만 사용해 계산했습니다.";
  context.fillText(coverageText, 88, coverageY);
  context.fillStyle = "#5b6577";
  context.font = '22px "Segoe UI", "Noto Sans KR", sans-serif';
  if (response.nearestDistanceKm !== void 0) {
    context.fillText(`가장 가까운 기준 지점까지 약 ${response.nearestDistanceKm.toFixed(1)}킬로미터`, 88, coverageY + 44);
  }
  response.metrics.forEach((metric, metricIndex) => {
    drawMetricChart(context, response, metric, 88, headerHeight + metricIndex * chartHeight, width - 176, chartHeight - 30);
  });
  const footerY = headerHeight + response.metrics.length * chartHeight + 22;
  context.fillStyle = "#5b6577";
  context.font = '20px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(
    response.dataMode === "raw-model-grid" ? "굵은 선은 기후 모델 원자료의 대표값이고, 옅은 영역은 여러 모델의 값이 주로 모인 범위입니다. 관측 자료를 이용한 보정은 적용하지 않았습니다." : "굵은 선은 보정을 반영한 대표값이고, 옅은 영역은 여러 모델의 값이 주로 모인 범위입니다. 보정 전 값도 선택하면 점선으로 함께 표시합니다.",
    88,
    footerY
  );
  context.fillText("이 자료는 기후 시나리오 교육·연구용 결과이며 단기 기상예보가 아닙니다.", 88, footerY + 38);
  const attribution = normalizePublicAttributionLabels(response.attributionLabels).join(" · ") || "기후 자료 출처 정보 포함";
  context.fillText(`자료 고지: ${attribution}`, 88, footerY + 76);
  context.fillText(`생성 시각: ${new Date(response.generatedAt).toLocaleString("ko-KR")}`, 88, footerY + 114);
  context.font = '18px "Segoe UI", "Noto Sans KR", sans-serif';
  context.fillText(`자료판: ${response.datasetVersion}`, 88, footerY + 152);
  context.fillText(`자료 갱신 시각: ${response.datasetUpdatedAt}`, 88, footerY + 186);
  context.fillText(`제작자: ${PUBLIC_ATTRIBUTION_CATALOG.project.creator.displayName} · GitHub ${PUBLIC_ATTRIBUTION_CATALOG.project.creator.githubHandle}`, 88, footerY + 220);
  await drawKmaAttributionMarks(context, response, width);
  return canvas;
}
function climateReportHeaderLayout(context, response, width) {
  if (!response.exploration) {
    return { coverageY: 276, headerHeight: 390 };
  }
  const textWidth = width - 176;
  const titleY = 278;
  context.font = '700 25px "Segoe UI", "Noto Sans KR", sans-serif';
  const titleLineCount = Math.max(1, Math.min(2, canvasTextLines(context, response.exploration.title ?? "탐구 문제", textWidth).length));
  const questionY = titleY + titleLineCount * 34 + 12;
  context.font = '21px "Segoe UI", "Noto Sans KR", sans-serif';
  const questionLineCount = Math.max(1, Math.min(3, canvasTextLines(context, response.exploration.question ?? "", textWidth).length));
  const limitY = questionY + questionLineCount * 30 + 12;
  context.font = '18px "Segoe UI", "Noto Sans KR", sans-serif';
  const limitLineCount = Math.max(1, Math.min(4, canvasTextLines(context, `해석할 때 주의할 점: ${response.exploration.interpretationLimit ?? ""}`, textWidth).length));
  const coverageY = Math.max(500, limitY + limitLineCount * 26 + 24);
  const headerHeight = coverageY + (response.nearestDistanceKm !== void 0 ? 104 : 70);
  return { coverageY, headerHeight, limitY, questionY, textWidth, titleY };
}
function splitOversizedCanvasWord(context, word, maxWidth) {
  const chunks = [];
  let chunk = "";
  Array.from(word).forEach((character) => {
    const candidate = `${chunk}${character}`;
    if (chunk && context.measureText(candidate).width > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else {
      chunk = candidate;
    }
  });
  if (chunk) chunks.push(chunk);
  return chunks;
}
function canvasTextLines(context, value, maxWidth) {
  const words = String(value ?? "").trim().split(/\s+/u).filter(Boolean).flatMap((word) => context.measureText(word).width <= maxWidth ? [word] : splitOversizedCanvasWord(context, word, maxWidth));
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      return;
    }
    lines.push(line);
    line = word;
  });
  if (line) lines.push(line);
  return lines;
}
function drawWrappedCanvasText(context, value, x, y, maxWidth, lineHeight, maximumLines) {
  const lines = canvasTextLines(context, value, maxWidth);
  const visibleLines = lines.slice(0, maximumLines);
  if (lines.length > maximumLines && visibleLines.length) {
    let finalLine = visibleLines.at(-1);
    while (finalLine && context.measureText(`${finalLine}…`).width > maxWidth) {
      finalLine = finalLine.slice(0, -1).trimEnd();
    }
    visibleLines[visibleLines.length - 1] = `${finalLine}…`;
  }
  visibleLines.forEach((text, index) => context.fillText(text, x, y + index * lineHeight));
  return y + Math.max(visibleLines.length, 1) * lineHeight;
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
  drawCanvasBand(context, response.dates, indexes, metric.corrected.p10, metric.corrected.p90, point, "rgba(37,132,95,0.16)");
  drawCanvasLine(context, response.dates, indexes, metric.corrected.p50, point, "#25845f", 4);
  if (metric.raw && response.dataMode !== "raw-model-grid") drawCanvasLine(context, response.dates, indexes, metric.raw.p50, point, "#d99b25", 3);
}
function drawCanvasBand(context, dates, indexes, lower, upper, point, fill) {
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
    const uninterrupted = previousIndex === void 0 || isContinuousSampledDateRange(dates, previousIndex, index) && lower.slice(previousIndex + 1, index + 1).every((value, offset) => isFiniteNumber$1(value) && isFiniteNumber$1(upper[previousIndex + offset + 1]));
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
function drawCanvasLine(context, dates, indexes, values, point, stroke, width) {
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
    const uninterrupted = previousIndex !== void 0 && isContinuousSampledDateRange(dates, previousIndex, index) && values.slice(previousIndex + 1, index + 1).every(isFiniteNumber$1);
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
async function drawKmaAttributionMarks(context, response, canvasWidth) {
  const [markOne, markTwo] = await Promise.all([
    loadImageAsset("./assets/licenses/kma_mark_1.png"),
    loadImageAsset("./assets/licenses/kma_mark_2.png")
  ]);
  const markOneWidth = 132;
  const markOneHeight = markOneWidth * markOne.naturalHeight / markOne.naturalWidth;
  const markTwoWidth = 112;
  const markTwoHeight = markTwoWidth * markTwo.naturalHeight / markTwo.naturalWidth;
  const right = canvasWidth - 88;
  const top = 82;
  context.drawImage(markOne, right - markOneWidth - markTwoWidth - 18, top, markOneWidth, markOneHeight);
  context.drawImage(markTwo, right - markTwoWidth, top, markTwoWidth, markTwoHeight);
  context.save();
  context.fillStyle = "#43514c";
  context.font = '16px "Segoe UI", "Noto Sans KR", sans-serif';
  context.textAlign = "right";
  context.fillText(response.dataMode === "raw-model-grid" ? "ASOS 관측 보정 미적용" : "대한민국 기상청 ASOS 자료 포함", right, top + Math.max(markOneHeight, markTwoHeight) + 24);
  context.restore();
}
function loadImageAsset(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("출처 표시 이미지를 불러오지 못했습니다."));
    image.src = path;
  });
}
const configPath = "./runtime-config.json";
const RETRYABLE_CLIMATE_REQUEST_ATTEMPTS = 2;
const RETRYABLE_CLIMATE_REQUEST_DELAY_MS = 800;
let configPromise;
async function fetchPublicClimateQuery(request, { signal } = {}) {
  const config = await loadPublicClimateConfig();
  return validatePublicClimateQueryResponse(
    await fetchClimateJson(config.readPath, "POST", request, config.timeoutMs, signal)
  );
}
async function fetchPublicClimateSeries(request, { signal } = {}) {
  const config = await loadPublicClimateConfig();
  return validatePublicClimateSeriesResponse(
    await fetchClimateJson(replaceEndpoint(config.readPath, "series"), "POST", request, config.timeoutMs, signal)
  );
}
async function fetchPublicClimateMetadata({ signal } = {}) {
  const config = await loadPublicClimateConfig();
  return fetchClimateJson(replaceEndpoint(config.readPath, "metadata"), "GET", void 0, config.timeoutMs, signal);
}
async function loadPublicClimateConfig() {
  configPromise ??= fetch(configPath, { headers: { Accept: "application/json" } }).then(async (response) => {
    if (!response.ok) throw new Error("기후 자료를 불러올 준비가 되지 않았습니다. 잠시 후 다시 시도하세요.");
    const value = await response.json();
    return validatePublicRuntimeConfig(value);
  }).catch((error) => {
    configPromise = void 0;
    throw error;
  });
  return configPromise;
}
async function fetchClimateJson(path, method, body, timeoutMs, externalSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    forwardAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const requestBody = body === void 0 ? void 0 : JSON.stringify(body);
    for (let attempt = 0; attempt < RETRYABLE_CLIMATE_REQUEST_ATTEMPTS; attempt += 1) {
      const response = await fetch(path, {
        method,
        headers: { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
        body: requestBody,
        cache: "no-store",
        signal: controller.signal
      });
      if (response.ok) return await response.json();
      if (response.status === 503) {
        const retryablePayload = await response.json()
          .then(validatePublicClimateRetryableError)
          .catch(() => void 0);
        if (retryablePayload && attempt + 1 < RETRYABLE_CLIMATE_REQUEST_ATTEMPTS) {
          await waitForClimateRetry(controller.signal);
          continue;
        }
        if (retryablePayload) {
          throw new Error("기후 자료를 완전히 확인하지 못했습니다. 잠시 후 같은 조건으로 다시 시도하세요.");
        }
      }
      throw new Error("기후 자료를 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
    }
    throw new Error("기후 자료를 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("기후 자료")) throw error;
    if (externalSignal?.aborted) {
      const cancelledError = new Error("사용자가 기후 자료 불러오기를 취소했습니다.");
      cancelledError.name = "AbortError";
      throw cancelledError;
    }
    if (timedOut) throw new Error("기후 자료를 불러오는 데 시간이 너무 오래 걸려 조회를 중단했습니다. 잠시 후 다시 시도하세요.");
    throw new Error("기후 자료를 불러오는 중 연결이 끊겼습니다. 잠시 후 다시 시도하세요.");
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", forwardAbort);
  }
}
function waitForClimateRetry(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      const error = new Error("기후 자료 다시 시도를 취소했습니다.");
      error.name = "AbortError";
      reject(error);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, RETRYABLE_CLIMATE_REQUEST_DELAY_MS);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
function replaceEndpoint(readPath, endpoint) {
  return readPath.replace(/\/query$/u, `/${endpoint}`);
}
function datasetBasisDateSuffix(datasetUpdatedAt) {
  const date = formatPublicDatasetUpdatedAt(datasetUpdatedAt);
  return date ? ` 자료 기준일: ${date}.` : "";
}
function datasetRefreshSucceededMessage(datasetUpdatedAt) {
  return `새 기후자료가 준비되어 결과를 다시 불러왔습니다.${datasetBasisDateSuffix(datasetUpdatedAt)}`;
}
function datasetRefreshFailedMessage(datasetUpdatedAt, retainedResult) {
  const result = retainedResult ? " 기존 결과를 유지합니다." : " 잠시 후 다시 확인해 주세요.";
  return `새 기후자료의 결과를 다시 불러오지 못했습니다.${result}${datasetBasisDateSuffix(datasetUpdatedAt)}`;
}
const metricOptions = [
  { key: "tasmax", label: "최고기온", icon: ThermometerSun },
  { key: "tasmin", label: "최저기온", icon: ThermometerSnowflake },
  { key: "precipitation", label: "강수량", icon: CloudRain },
  { key: "wind", label: "풍속", icon: Wind },
  { key: "apparentTemperature", label: "체감 지표", icon: CloudSun },
];
const formatOptions = [
  { key: "csv", label: "CSV 자료 묶음", detail: "CSV·출처 문서·원본 표장", icon: Table2 },
  { key: "html", label: "대화형 그래프(HTML)", detail: "마우스로 값 확인·확대·날짜 비교", icon: Monitor },
  { key: "pdf", label: "인쇄용 보고서(PDF)", detail: "보고서와 그래프", icon: FileText },
  { key: "png", label: "고해상도 이미지(PNG)", detail: "그래프를 이미지로 저장", icon: Image }
];
function ClimateExportDialog({ context, datasetState, onClose }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const openerRef = useRef(null);
  const metadata = datasetState.metadata;
  const exportScenarios = normalizeMetadataOptions(metadata, "scenarios", context?.scenario ? [context.scenario] : []);
  const exportModels = normalizeMetadataOptions(metadata, "models", context?.model ? [context.model] : []);
  const exportScenario = context && exportScenarios.includes(context.scenario) ? context.scenario : exportScenarios[0];
  const exportModel = context && exportModels.includes(context.model) ? context.model : exportModels[0];
  const seriesControllerRef = useRef();
  const reloadPreviewRef = useRef();
  const handledRefreshSequenceRef = useRef(datasetState.refreshSequence);
  const observedDialogDatasetVersionRef = useRef(metadata?.datasetVersion);
  const expectedDataModeRef = useRef(context?.expectedDataMode);
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
    expectedDataModeRef.current = context.expectedDataMode;
    seriesControllerRef.current?.abort();
    seriesControllerRef.current = void 0;
    setStartDate(context.initialStartDate ?? context.date);
    setEndDate(context.initialEndDate ?? context.date);
    setSelectedMetrics(context.initialMetrics);
    setPreviewMetric(context.initialMetrics[0] ?? "tasmax");
    setIncludeRaw(context.includeRaw);
    setFormat(context.initialFormat ?? "csv");
    setResponse(void 0);
    setStatus("idle");
    setMessage("기간과 자료를 선택한 뒤 미리보기를 불러오세요.");
    window.setTimeout(() => closeButtonRef.current?.focus(), 40);
    return () => {
      seriesControllerRef.current?.abort();
      seriesControllerRef.current = void 0;
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [context]);
  useEffect(() => {
    if (!context || !metadata?.dateStart || !metadata?.dateEnd) return;
    setStartDate((current) => clipPeriod(current, current, metadata.dateStart, metadata.dateEnd).start);
    setEndDate((current) => clipPeriod(current, current, metadata.dateStart, metadata.dateEnd).end);
  }, [context, metadata?.dateStart, metadata?.dateEnd]);
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
  const hasCurrentPreview = isCurrentPublicDatasetResult(response, metadata, status);
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
      setMessage("기후 지표를 하나 이상 선택하세요.");
      return;
    }
    setSelectedMetrics(next);
    if (!next.includes(previewMetric)) setPreviewMetric(next[0]);
    markDirty();
  };
  const loadPreview = async (options = {}) => {
    if (!context) return;
    const datasetRefresh = options.datasetRefresh === true;
    const retainExistingResult = options.retainExistingResult === true;
    if (!isValidPeriod(startDate, endDate)) {
      setStatus("error");
      setMessage("시작일과 종료일을 확인하세요. 종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }
    if (!metadata?.datasetVersion || !metadata?.datasetUpdatedAt) {
      setStatus("loading");
      setMessage("최신 기후자료의 기준을 확인하고 있습니다.");
      try {
        await datasetState.requestRefresh({ force: true });
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "최신 기후자료의 기준을 확인하지 못했습니다. 다시 시도하세요.");
      }
      return;
    }
    const controller = new AbortController();
    seriesControllerRef.current?.abort();
    seriesControllerRef.current = controller;
    setStatus("loading");
    setMessage(datasetRefresh
      ? "새 기후자료를 확인해 현재 조건의 기간 결과를 다시 불러오고 있습니다."
      : `${dayCount.toLocaleString("ko-KR")}일 동안의 실제 기후 자료를 불러오고 있습니다. 새로고침하지 마세요.`);
    try {
      const requestMetrics = expandMetricKeys(selectedMetrics);
      const seriesRequest = {
        latitude: context.latitude,
        longitude: context.longitude,
        startDate,
        endDate,
        scenario: exportScenario,
        model: exportModel,
        metrics: requestMetrics,
        includeRaw,
        ...(metadata?.datasetVersion ? { datasetVersion: metadata.datasetVersion } : {})
      };
      const payload = await fetchPublicClimateSeries(seriesRequest, { signal: controller.signal });
      if (!isMatchingPublicDatasetIdentity(payload, seriesRequest.datasetVersion, metadata?.datasetUpdatedAt)) {
        const nextMetadata = await datasetState.requestRefresh({ force: true });
        if (isPublicDatasetIdentityChange(metadata, nextMetadata)) {
          setStatus("loading");
          setMessage("기후자료가 갱신되어 같은 조건의 기간 결과를 다시 불러오고 있습니다.");
          return;
        }
        throw new Error("불러온 자료가 최신 자료 기준과 다릅니다. 다시 시도하세요.");
      }
      if (!isMatchingClimateSeriesResponse(payload, {
        startDate,
        endDate,
        latitude: context.latitude,
        longitude: context.longitude,
        scenario: exportScenario,
        model: exportModel,
        dataMode: datasetRefresh ? undefined : expectedDataModeRef.current,
        includeRaw: datasetRefresh ? undefined : seriesRequest.includeRaw,
        selectedMetrics: requestMetrics
      })) {
        throw new Error("불러온 자료가 선택한 조건이나 기간과 다릅니다. 다시 시도하세요.");
      }
      expectedDataModeRef.current = payload.dataMode;
      setIncludeRaw(payload.includeRaw);
      let displayPayload = collapseApparentTemperatureSeries(payload, selectedMetrics);
      displayPayload = selectClimateSeriesMetrics(displayPayload, selectedMetrics);
      displayPayload = filterClimateSeriesByMonths(displayPayload, context.seasonMonths);
      displayPayload = { ...displayPayload, exploration: context.exploration };
      setResponse(displayPayload);
      setPreviewMetric(displayPayload.metrics[0]?.key ?? selectedMetrics[0]);
      setStatus("ready");
      const coverageMessage = displayPayload.coverage === "available"
        ? `${displayPayload.dates.length.toLocaleString("ko-KR")}일 자료를 확인했습니다.${context.seasonMonths?.length ? ` 선택한 ${context.seasonMonths.join(", ")}월만 표시합니다.` : ""}`
        : toAudienceClimateCopy(displayPayload.fallbackReason, "일부 날짜에는 자료가 없습니다. 기간이나 모델을 바꿔 보세요.");
      setMessage(datasetRefresh
        ? `${datasetRefreshSucceededMessage(metadata?.datasetUpdatedAt)}${displayPayload.coverage === "available" ? "" : ` ${coverageMessage}`}`
        : coverageMessage);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      const retainedResult = retainExistingResult && Boolean(response);
      if (!retainedResult) setResponse(void 0);
      setStatus("error");
      setMessage(datasetRefresh
        ? datasetRefreshFailedMessage(metadata?.datasetUpdatedAt, retainedResult)
        : error instanceof Error ? error.message : "기간 자료를 불러오지 못했습니다.");
    } finally {
      if (seriesControllerRef.current === controller) seriesControllerRef.current = void 0;
    }
  };
  reloadPreviewRef.current = loadPreview;
  useEffect(() => {
    const nextDatasetVersion = metadata?.datasetVersion;
    const versionTransition = observedDialogDatasetVersionRef.current !== nextDatasetVersion;
    observedDialogDatasetVersionRef.current = nextDatasetVersion;
    const datasetRefresh = datasetState.refreshSequence > handledRefreshSequenceRef.current;
    if (datasetRefresh) handledRefreshSequenceRef.current = datasetState.refreshSequence;
    if (!nextDatasetVersion || (!versionTransition && !datasetRefresh)) return;
    expectedDataModeRef.current = undefined;
    const shouldReload = Boolean(context) && (status === "loading" || (Boolean(response) && status !== "exporting"));
    if (!shouldReload) return;
    seriesControllerRef.current?.abort();
    const timer = window.setTimeout(() => reloadPreviewRef.current?.({ datasetRefresh, retainExistingResult: true }), 0);
    return () => window.clearTimeout(timer);
  }, [datasetState.refreshSequence, metadata?.datasetVersion]);
  const exportFile = async () => {
    if (!hasCurrentPreview) {
      setStatus("error");
      setMessage("현재 자료판으로 미리보기를 다시 불러온 뒤 저장하세요.");
      return;
    }
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
        setMessage(`${result.filename} 파일 저장을 시작했습니다. 브라우저의 다운로드 목록을 확인하세요.`);
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
            /* @__PURE__ */ jsx("p", { children: "실제 기후 시나리오 값을 확인한 뒤 표 자료, 대화형 그래프, 보고서 또는 이미지로 저장합니다." })
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
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("day"), type: "button", children: "선택한 날" }),
                /* @__PURE__ */ jsx("button", { onClick: () => applyQuickPeriod("month"), type: "button", children: "선택한 달" }),
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
                " 파일 형식"
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
                " 기후 지표"
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
                /* @__PURE__ */ jsx("span", { children: "보정 전 모델 값 함께 포함" })
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("main", { className: "export-preview", children: [
            /* @__PURE__ */ jsxs("div", { className: "export-context-strip", children: [
              context.exploration?.title ? /* @__PURE__ */ jsx("span", { children: context.exploration.title }) : null,
              /* @__PURE__ */ jsx("span", { children: exportScenario }),
              /* @__PURE__ */ jsx("span", { children: exportModel }),
              /* @__PURE__ */ jsx("span", { children: formatCoordinatePair(context.latitude, context.longitude) }),
              context.seasonMonths?.length ? /* @__PURE__ */ jsxs("span", { children: ["대상 월 ", context.seasonMonths.join(", "), "월"] }) : null
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
                  /* @__PURE__ */ jsx("strong", { children: response.dataMode === "raw-model-grid" ? "기후 모델 원자료" : response.nearestDistanceKm === void 0 ? "확인됨" : `${response.nearestDistanceKm.toFixed(1)}km` })
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
            /* @__PURE__ */ jsxs("button", { className: "primary-action", disabled: !hasCurrentPreview || busy, onClick: exportFile, type: "button", children: [
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
  const [referenceIndex, setReferenceIndex] = useState();
  const [viewWindow, setViewWindow] = useState({ start: 0, end: dates.length });
  const dragRef = useRef();
  useEffect(() => {
    setHoveredIndex(void 0);
    setReferenceIndex(void 0);
    setViewWindow({ start: 0, end: dates.length });
  }, [dates, metric.key]);
  const visibleDates = dates.slice(viewWindow.start, viewWindow.end);
  const visibleMetric = useMemo(
    () => sliceSeriesMetric(metric, viewWindow.start, viewWindow.end),
    [metric, viewWindow.start, viewWindow.end]
  );
  const chart = useMemo(() => buildChartGeometry(visibleDates, visibleMetric), [visibleDates, visibleMetric]);
  const rawGrid = dataMode === "raw-model-grid";
  const hovered = hoveredIndex === void 0 ? void 0 : {
    date: dates[hoveredIndex],
    corrected: metric.corrected.p50[hoveredIndex],
    raw: metric.raw?.p50[hoveredIndex]
  };
  const reference = referenceIndex === void 0 ? void 0 : {
    date: dates[referenceIndex],
    corrected: metric.corrected.p50[referenceIndex]
  };
  const comparison = hovered && reference ? chartComparison(hovered.corrected, reference.corrected) : void 0;
  const elapsedDays = hovered && reference ? Math.round((Date.parse(hovered.date) - Date.parse(reference.date)) / 864e5) : void 0;
  const localHoveredIndex = hoveredIndex === void 0 ? void 0 : hoveredIndex - viewWindow.start;
  const localReferenceIndex = referenceIndex === void 0 ? void 0 : referenceIndex - viewWindow.start;
  const referenceIsVisible = localReferenceIndex !== void 0 && localReferenceIndex >= 0 && localReferenceIndex < visibleDates.length;
  const pointerIndex = (event, window = viewWindow) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const viewX = (event.clientX - rect.left) / Math.max(rect.width, 1) * 760;
    const ratio = Math.max(0, Math.min(1, (viewX - 48) / 692));
    return window.start + Math.round(ratio * Math.max(window.end - window.start - 1, 0));
  };
  const zoom = (deltaY, ratio = 0.5) => {
    setViewWindow((current) => chartWindowAfterWheel({ ...current, total: dates.length, ratio, deltaY, minWindow: 7 }));
  };
  const resetView = () => setViewWindow({ start: 0, end: dates.length });
  const hoveredRatio = localHoveredIndex === void 0 ? 0 : localHoveredIndex / Math.max(visibleDates.length - 1, 1);
  const tooltipEdge = hoveredRatio < 0.2 ? "edge-start" : hoveredRatio > 0.8 ? "edge-end" : "";
  return /* @__PURE__ */ jsxs("div", { className: "interactive-series-chart", children: [
    /* @__PURE__ */ jsxs("div", { className: "chart-heading", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("strong", { children: [
          metric.label,
          " 기간 변화"
        ] }),
        /* @__PURE__ */ jsx("span", { children: metric.key === "apparentTemperature" ? "월별 기준: 5~9월 열지수, 10~4월 체감기온" : rawGrid ? "굵은 선은 기후 모델 원자료의 대표값이고, 옅은 영역은 여러 모델의 값이 주로 모인 범위입니다." : "굵은 선은 보정을 반영한 대표값이고, 옅은 영역은 여러 모델의 값이 주로 모인 범위입니다." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "chart-legend", children: [
        /* @__PURE__ */ jsx("span", { className: "corrected", children: rawGrid ? "기후 모델 원자료" : "보정 후" }),
        !rawGrid && metric.raw ? /* @__PURE__ */ jsx("span", { className: "raw", children: "보정 전" }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "chart-tool-row", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        visibleDates[0],
        " ~ ",
        visibleDates.at(-1),
        " · ",
        visibleDates.length.toLocaleString("ko-KR"),
        "일"
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "chart-view-controls", children: [
        /* @__PURE__ */ jsx("button", { "aria-label": "그래프 축소", onClick: () => zoom(1), title: "축소", type: "button", children: /* @__PURE__ */ jsx(Minus, { size: 16 }) }),
        /* @__PURE__ */ jsx("button", { "aria-label": "그래프 확대", onClick: () => zoom(-1), title: "확대", type: "button", children: /* @__PURE__ */ jsx(Plus, { size: 16 }) }),
        /* @__PURE__ */ jsx("button", { "aria-label": "전체 기간 보기", onClick: resetView, title: "전체 기간 보기", type: "button", children: /* @__PURE__ */ jsx(RefreshCw, { size: 16 }) }),
        reference ? /* @__PURE__ */ jsx("button", { "aria-label": "첫 번째 날짜 지우기", className: "chart-reference-clear", onClick: () => setReferenceIndex(void 0), title: "첫 번째 날짜 지우기", type: "button", children: /* @__PURE__ */ jsx(X, { size: 15 }) }) : null
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "chart-plot-shell", children: [
      /* @__PURE__ */ jsxs("svg", {
        "aria-label": `${metric.label} 대화형 기간 그래프. 휠로 확대하거나 그래프를 끌어 이동하고, 날짜를 누르면 첫 번째 비교 날짜로 저장됩니다.`,
        onDoubleClick: resetView,
        onPointerCancel: (event) => {
          dragRef.current = void 0;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        },
        onPointerDown: (event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragRef.current = { clientX: event.clientX, window: viewWindow, moved: false };
        },
        onPointerLeave: () => {
          if (!dragRef.current) setHoveredIndex(void 0);
        },
        onPointerMove: (event) => {
          const drag = dragRef.current;
          if (!drag) {
            setHoveredIndex(pointerIndex(event));
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          const deltaX = event.clientX - drag.clientX;
          if (Math.abs(deltaX) > 4) drag.moved = true;
          const nextWindow = chartWindowAfterPan({
            ...drag.window,
            total: dates.length,
            delta: -deltaX / Math.max(rect.width, 1) * (drag.window.end - drag.window.start)
          });
          setViewWindow(nextWindow);
          setHoveredIndex(pointerIndex(event, nextWindow));
        },
        onPointerUp: (event) => {
          const drag = dragRef.current;
          if (drag && !drag.moved) setReferenceIndex(pointerIndex(event));
          dragRef.current = void 0;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        },
        onWheel: (event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const viewX = (event.clientX - rect.left) / Math.max(rect.width, 1) * 760;
          const ratio = Math.max(0, Math.min(1, (viewX - 48) / 692));
          zoom(event.deltaY, ratio);
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
          /* @__PURE__ */ jsx("text", { x: "48", y: "272", children: visibleDates[0] }),
          /* @__PURE__ */ jsx("text", { textAnchor: "end", x: "740", y: "272", children: visibleDates.at(-1) }),
          referenceIsVisible ? /* @__PURE__ */ jsx("line", { className: "chart-reference", x1: chart.xForDate(localReferenceIndex), x2: chart.xForDate(localReferenceIndex), y1: "28", y2: "232" }) : null,
          localHoveredIndex !== void 0 ? /* @__PURE__ */ jsx("line", { className: "chart-cursor", x1: chart.xForDate(localHoveredIndex), x2: chart.xForDate(localHoveredIndex), y1: "28", y2: "232" }) : null
        ]
      }),
      hovered ? /* @__PURE__ */ jsxs("div", { className: `chart-floating-tooltip ${tooltipEdge}`, role: "status", style: { left: `${6.5 + hoveredRatio * 91}%` }, children: [
        /* @__PURE__ */ jsx("strong", { children: hovered.date }),
        /* @__PURE__ */ jsxs("span", { children: [rawGrid ? "기후 모델 원자료 " : "현재 값 ", displayChartValue(hovered.corrected, metric.unit)] }),
        !rawGrid && metric.raw ? /* @__PURE__ */ jsxs("small", { children: ["보정 전 ", displayChartValue(hovered.raw, metric.unit)] }) : null,
        reference ? /* @__PURE__ */ jsxs("span", { className: comparison?.delta > 0 ? "positive" : comparison?.delta < 0 ? "negative" : "", children: ["첫 번째 날짜와의 차이 ", formatSignedChartValue(comparison?.delta, metric.unit), " · ", formatSignedPercent(comparison?.percent), " · ", formatSignedDays(elapsedDays)] }) : /* @__PURE__ */ jsx("small", { children: "날짜를 누르면 첫 번째 비교 날짜로 저장됩니다." })
      ] }) : null
    ] }),
    hovered ? /* @__PURE__ */ jsxs("div", { className: "chart-hover-readout", children: [
      /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "가리킨 날짜" }), /* @__PURE__ */ jsx("strong", { children: hovered.date })] }),
      /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: rawGrid ? "기후 모델 원자료" : "현재 값" }), /* @__PURE__ */ jsx("strong", { children: displayChartValue(hovered.corrected, metric.unit) })] }),
      !rawGrid && metric.raw ? /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "보정 전" }), /* @__PURE__ */ jsx("strong", { children: displayChartValue(hovered.raw, metric.unit) })] }) : null,
      reference ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "첫 번째 날짜" }), /* @__PURE__ */ jsxs("strong", { children: [reference.date, " · ", displayChartValue(reference.corrected, metric.unit)] })] }),
        /* @__PURE__ */ jsxs("div", { className: `chart-comparison-detail ${comparison?.delta > 0 ? "positive" : comparison?.delta < 0 ? "negative" : ""}`, children: [
          /* @__PURE__ */ jsx("span", { className: "comparison-title", children: "첫 번째 날짜와의 차이" }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "값 변화" }), /* @__PURE__ */ jsx("strong", { children: formatSignedChartValue(comparison?.delta, metric.unit) })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "변화율" }), /* @__PURE__ */ jsx("strong", { children: formatSignedPercent(comparison?.percent) })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "날짜 차이" }), /* @__PURE__ */ jsx("strong", { children: formatSignedDays(elapsedDays) })] })
        ] })
      ] }) : /* @__PURE__ */ jsxs("div", { className: "chart-reference-hint", children: [/* @__PURE__ */ jsx(Target, { size: 15 }), " 날짜를 눌러 첫 번째 비교 날짜로 정하세요."] })
    ] }) : /* @__PURE__ */ jsx("div", { className: "chart-hover-readout muted", children: "그래프를 가리키면 값을 확인할 수 있습니다. 휠로 확대하고 그래프를 끌어 기간을 옮겨 보세요." })
  ] });
}
function sliceSeriesMetric(metric, start, end) {
  const sliceGroup = (group) => group ? {
    p10: group.p10.slice(start, end),
    p50: group.p50.slice(start, end),
    p90: group.p90.slice(start, end)
  } : void 0;
  return {
    ...metric,
    corrected: sliceGroup(metric.corrected),
    raw: sliceGroup(metric.raw)
  };
}
function formatSignedChartValue(value, unit) {
  if (value === null || value === void 0 || !Number.isFinite(value)) return "비교 불가";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
}
function formatSignedPercent(value) {
  if (value === null || value === void 0 || !Number.isFinite(value)) return "변화율 계산 불가";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%`;
}
function formatSignedDays(value) {
  if (!Number.isFinite(value)) return "날짜 차이를 계산할 수 없음";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR")}일`;
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
      const uninterrupted = previousIndex !== void 0
        && isContinuousSampledDateRange(dates, previousIndex, index)
        && items.slice(previousIndex + 1, index + 1).every(isFiniteNumber);
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
      const uninterrupted = previousIndex === void 0 || (
        isContinuousSampledDateRange(dates, previousIndex, index)
        && lower.slice(previousIndex + 1, index + 1).every((value, offset) => isFiniteNumber(value) && isFiniteNumber(upper[previousIndex + offset + 1]))
      );
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
function expandMetricKeys(metrics) {
  return [...new Set(metrics.flatMap((key) => key === "apparentTemperature" ? ["heatIndex", "feelsLike"] : [key]))];
}
function collapseApparentTemperatureSeries(response, selectedMetrics) {
  const normalizedResponse = {
    ...response,
    metrics: response.metrics.map((metric) => ({ ...metric, unit: metricDisplayUnit(metric) }))
  };
  if (!selectedMetrics.includes("apparentTemperature")) return normalizedResponse;
  const heatIndex = normalizedResponse.metrics.find((metric) => metric.key === "heatIndex");
  const feelsLike = normalizedResponse.metrics.find((metric) => metric.key === "feelsLike");
  const pickMetric = (date) => apparentTemperatureBasis(date).metricKey === "heatIndex" ? heatIndex : feelsLike;
  const pickValues = (group, band) => response.dates.map((date, index) => pickMetric(date)?.[group]?.[band]?.[index]);
  const coverage = normalizedResponse.dates.map((date, index) => Boolean(pickMetric(date)?.coverage?.[index]));
  const modelCounts = normalizedResponse.dates.map((date, index) => pickMetric(date)?.modelCounts?.[index] ?? 0);
  const hasRaw = Boolean(heatIndex?.raw || feelsLike?.raw);
  const apparentMetric = {
    key: "apparentTemperature",
    label: apparentTemperatureSeriesLabel(response.dates),
    unit: metricDisplayUnit({ key: "apparentTemperature", unit: heatIndex?.unit ?? feelsLike?.unit }),
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
  const metrics = normalizedResponse.metrics.filter((metric) => !["heatIndex", "feelsLike"].includes(metric.key));
  const comfortIndexes = ["heatIndex", "feelsLike"].map((key) => normalizedResponse.metrics.findIndex((metric) => metric.key === key)).filter((index) => index >= 0);
  const insertAt = comfortIndexes.length > 0 ? Math.min(Math.min(...comfortIndexes), metrics.length) : metrics.length;
  metrics.splice(insertAt, 0, apparentMetric);
  return { ...normalizedResponse, metrics };
}
function apparentTemperatureSeriesLabel(dates) {
  const labels = [...new Set(dates.map((date) => apparentTemperatureBasis(date).label))];
  return labels.length === 1 ? labels[0] : "열지수·체감기온";
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
function validateRemoteChunkResponse(response, request, expectedUpdatedAt) {
  const coordinateMatches = isClose(response.latitude, request.latitude) && isClose(response.longitude, request.longitude);
  const datasetMatches = isMatchingPublicDatasetIdentity(response, request.datasetVersion, expectedUpdatedAt);
  const requestMatches = response.stationLabel === request.stationLabel && coordinateMatches && response.date === request.date && response.scenario === request.scenario && response.model === request.model && datasetMatches;
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
  return isPublicGatewayTextSafe(text) && runtimePublicBlockList.every((term) => !text.includes(term));
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
    title: "지도에서 미래 기후를 살펴보세요",
    subtitle: "궁금한 곳과 날짜를 고르면 실제 기후 모델 자료에서 기온, 강수량, 풍속, 체감기온을 찾아 보여 줍니다."
  },
  "/teacher": {
    eyebrow: "교사용 수업",
    title: "우리 지역의 미래 기후를 탐구하는 수업",
    subtitle: "학생과 함께 지역과 시기를 정해 기후 자료를 비교하고, 수업 활동지를 만들 수 있습니다."
  },
  "/public": {
    eyebrow: "우리 지역 요약",
    title: "한눈에 보는 우리 지역의 미래 기후",
    subtitle: "지도를 눌러 위치를 바꾸면 꼭 필요한 기후 지표만 쉽고 빠르게 확인할 수 있습니다."
  }
};
const problemIconByKey = {
  cold: ThermometerSnowflake,
  global: Globe2,
  heat: ThermometerSun,
  rain: CloudRain,
  temperature: Gauge,
  wind: Wind
};
const problemFocusByCategory = {
  heat: "heat",
  rain: "rain",
  temperature: "temperature",
  wind: "wind"
};
const problemCategoryOptions = [
  { key: "all", label: "전체" },
  { key: "heat", label: "체감기온과 안전" },
  { key: "temperature", label: "기온" },
  { key: "rain", label: "강수" },
  { key: "wind", label: "바람" }
];
const problemVariableLabels = {
  apparentTemperature: "체감 지표",
  precipitation: "강수량",
  tasmax: "최고기온",
  tasmin: "최저기온",
  wind: "풍속"
};
function problemSiteIcon(site) {
  if (/산지|고원|아틀라스/u.test(site.detail)) return Mountain;
  if (/해안|섬/u.test(site.detail)) return Waves;
  return MapPin;
}
function commonSeasonMonths(problem) {
  const periods = problem?.dataPlan?.comparisonPeriods ?? [];
  if (periods.length === 0 || !periods.every((period) => period.seasonMonths?.length)) return undefined;
  const first = periods[0].seasonMonths.join(",");
  return periods.every((period) => period.seasonMonths.join(",") === first) ? [...periods[0].seasonMonths] : undefined;
}
function problemExploration(problem) {
  if (!problem) return undefined;
  return {
    id: problem.id,
    revision: problem.revision,
    title: problem.presentation.title,
    question: problem.inquiry.question,
    interpretationLimit: problem.inquiry.interpretationLimit,
    comparisonPeriods: problem.dataPlan.comparisonPeriods ?? [],
    expectedOutputs: problem.roles.student.output,
    assessmentCriteria: problem.roles.teacher.assessmentCriteria,
    evidenceRequirements: problem.evidenceRequirements,
    microclimateExtension: problem.microclimateExtension,
    validationEvidence: problem.validationEvidence
  };
}
function studentFacingSites(problem) {
  const aliases = new Map((problem.mystery?.studentSiteAliases ?? []).map((alias) => [alias.siteId, alias]));
  return problem.dataPlan.sites.map((site) => ({ ...site, ...(aliases.get(site.id) ?? {}) }));
}
function problemToPreset(problem) {
  const firstSite = problem.dataPlan.sites[0];
  const studentSites = studentFacingSites(problem);
  const Icon = problemIconByKey[problem.presentation.iconKey] ?? Target;
  return {
    id: problem.id,
    category: problem.category,
    label: problem.presentation.shortLabel,
    detail: problem.presentation.detail,
    icon: /* @__PURE__ */ jsx(Icon, { size: 18 }),
    date: problem.dataPlan.anchorDate,
    latitude: firstSite.latitude,
    longitude: firstSite.longitude,
    scenario: problem.dataPlan.scenario,
    model: problem.dataPlan.defaultModel,
    raw: problem.dataPlan.raw,
    mapTone: problem.presentation.mapTone,
    focus: problemFocusByCategory[problem.category] ?? "heat",
    problemSetId: problem.id,
    problemRevision: problem.revision,
    periodStart: problem.dataPlan.periodStart,
    periodEnd: problem.dataPlan.periodEnd,
    studySites: studentSites.length > 1 ? studentSites : undefined,
    allowCustomLocation: problem.dataPlan.allowCustomLocation,
    variableKeys: problem.dataPlan.variableKeys,
    derivedKeys: problem.dataPlan.derivedKeys ?? [],
    conclusionOptions: problem.inquiry.hypothesisChoices,
    summary: problem.inquiry.question,
    dataNote: problem.inquiry.interpretationLimit,
    problem
  };
}
const teacherLessonSamples = climateProblemSets.map((problem) => {
  const sites = problem.dataPlan.sites.map((site) => ({ ...site, icon: problemSiteIcon(site) }));
  return {
    id: problem.id,
    revision: problem.revision,
    label: "실제 기후 자료로 확인한 수업 문제",
    title: problem.presentation.title,
    objective: problem.inquiry.objective,
    question: problem.inquiry.question,
    guardrail: problem.inquiry.interpretationLimit,
    conclusionOptions: problem.inquiry.hypothesisChoices,
    date: problem.dataPlan.anchorDate,
    periodStart: problem.dataPlan.periodStart,
    periodEnd: problem.dataPlan.periodEnd,
    scenario: problem.dataPlan.scenario,
    model: problem.dataPlan.defaultModel,
    focus: problemFocusByCategory[problem.category] ?? "heat",
    variableKeys: problem.dataPlan.variableKeys,
    derivedKeys: problem.dataPlan.derivedKeys ?? [],
    comparisonPeriods: problem.dataPlan.comparisonPeriods ?? [],
    evidenceRequirements: problem.evidenceRequirements,
    location: sites[0],
    sites,
    output: problem.roles.student.output,
    assessmentCriteria: problem.roles.teacher.assessmentCriteria,
    problem
  };
});
const queryPresets = [
  ...climateProblemSets.map(problemToPreset),
  {
    id: "custom",
    label: "지도에서 직접 선택",
    detail: "지도를 눌러 위치 고르기",
    icon: /* @__PURE__ */ jsx(LocateFixed, { size: 18 }),
    date: "2050-08-01",
    latitude: 36.5,
    longitude: 127.4,
    scenario: "고배출 경로",
    model: "전체 앙상블",
    raw: false,
    mapTone: "custom",
    focus: "heat",
    summary: "지도에서 다른 곳을 누르면 선택한 위치가 바로 바뀝니다.",
    dataNote: "지도에서 고른 위치를 기준으로 기후 자료를 불러옵니다."
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
function usePublicDatasetMetadata() {
  const [datasetState, setDatasetState] = useState({
    metadata: void 0,
    refreshSequence: 0,
    status: "loading"
  });
  const refreshRef = useRef(() => Promise.resolve(void 0));
  const requestRefresh = useCallback((options = {}) => refreshRef.current(options), []);
  useEffect(() => {
    let active = true;
    let activeController;
    let lastCheckAt = 0;
    const performMetadataCheck = () => {
      if (!active) return Promise.resolve(void 0);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return Promise.reject(new Error("기후자료 연결을 확인할 수 없습니다."));
      }
      lastCheckAt = Date.now();
      const controller = new AbortController();
      activeController = controller;
      return fetchPublicClimateMetadata({ signal: controller.signal }).then(validatePublicDatasetMetadata).then((nextMetadata) => {
        if (!active) return void 0;
        setDatasetState((current) => {
          if (!current.metadata) {
            return { metadata: nextMetadata, refreshSequence: current.refreshSequence, status: "ready" };
          }
          const changed = isPublicDatasetIdentityChange(current.metadata, nextMetadata);
          return {
            metadata: nextMetadata,
            refreshSequence: changed ? current.refreshSequence + 1 : current.refreshSequence,
            status: changed ? "updated" : "ready"
          };
        });
        return nextMetadata;
      }).catch((error) => {
        if (!active) return;
        setDatasetState((current) => current.metadata ? current : { ...current, status: "unavailable" });
        throw error;
      }).finally(() => {
        if (activeController === controller) activeController = void 0;
      });
    };
    const refreshQueue = createPublicMetadataRefreshQueue(performMetadataCheck);
    const checkMetadata = ({ force = false, initial = false } = {}) => {
      const now = Date.now();
      if (refreshQueue.hasInFlight()) return refreshQueue.request({ force });
      if (!initial && !force && now - lastCheckAt < PUBLIC_DATASET_REACTIVATION_MIN_INTERVAL_MS) return Promise.resolve(void 0);
      return refreshQueue.request();
    };
    refreshRef.current = checkMetadata;
    const checkSilently = (options) => void checkMetadata(options).catch(() => void 0);
    const onFocus = () => checkSilently();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkSilently();
    };
    checkSilently({ initial: true });
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const interval = window.setInterval(() => checkSilently(), PUBLIC_DATASET_REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      refreshRef.current = () => Promise.resolve(void 0);
      activeController?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
  return useMemo(() => ({ ...datasetState, requestRefresh }), [datasetState, requestRefresh]);
}
function App() {
  const route = useHashRoute();
  const [themeMode, setThemeMode] = useThemeMode();
  const datasetState = usePublicDatasetMetadata();
  const page = useMemo(() => renderRoute(route, datasetState), [route, datasetState]);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [route]);
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
      /* @__PURE__ */ jsx(TopBar, { metadata: datasetState.metadata, route }),
      page
    ] }),
    /* @__PURE__ */ jsx(SiteFooter, {})
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
function ProblemCategoryControl({ value, onChange, label }) {
  return /* @__PURE__ */ jsx("div", { className: "problem-category-control", role: "group", "aria-label": label, children: problemCategoryOptions.map((option) => /* @__PURE__ */ jsx("button", {
    "aria-pressed": value === option.key,
    className: value === option.key ? "active" : "",
    onClick: () => onChange(option.key),
    type: "button",
    children: option.label
  }, option.key)) });
}
function TopBar({ metadata, route }) {
  const meta = routeTitles[route];
  return /* @__PURE__ */ jsx("header", { className: "topbar", children: /* @__PURE__ */ jsxs("div", { className: "topbar-copy", children: [
    /* @__PURE__ */ jsxs("div", { className: "topbar-eyebrow-row", children: [
      /* @__PURE__ */ jsx("span", { className: "eyebrow", children: meta.eyebrow }),
      /* @__PURE__ */ jsx(SourceCitationDisclosure, { metadata })
    ] }),
    /* @__PURE__ */ jsx("h1", { children: meta.title }),
    /* @__PURE__ */ jsx("p", { children: meta.subtitle })
  ] }) });
}
function SourceCitationDisclosure({ metadata }) {
  const catalog = PUBLIC_ATTRIBUTION_CATALOG;
  const advertisedModels = Array.isArray(metadata?.models)
    ? metadata.models.filter((model) => model && model !== "전체 앙상블")
    : catalog.climateModels.map((model) => model.name);
  const modelRows = advertisedModels.map((model) => ({ name: model, attribution: findClimateModelAttribution(model) }));
  const basisDate = formatPublicDatasetUpdatedAt(metadata?.datasetUpdatedAt);
  return /* @__PURE__ */ jsxs("details", { className: "source-citation-disclosure", children: [
    /* @__PURE__ */ jsxs("summary", { children: [/* @__PURE__ */ jsx(BookOpen, { size: 14 }), /* @__PURE__ */ jsx("span", { children: "출처·인용" })] }),
    /* @__PURE__ */ jsxs("div", { className: "source-citation-panel", children: [
      /* @__PURE__ */ jsxs("header", { children: [
        /* @__PURE__ */ jsx("strong", { children: "CMIP6/downscaleCMIP6 자료 출처" }),
        /* @__PURE__ */ jsx("p", { children: "기후 모델, 관측자료, 자료 처리 방법의 출처와 인용 정보를 확인할 수 있습니다." }),
        basisDate ? /* @__PURE__ */ jsxs("small", { children: ["현재 자료 기준일: ", basisDate] }) : null
      ] }),
      /* @__PURE__ */ jsxs("section", { children: [
        /* @__PURE__ */ jsx("h2", { children: "기후 모델 자료" }),
        /* @__PURE__ */ jsx("ul", { className: "source-model-list", children: modelRows.map(({ name, attribution }) => /* @__PURE__ */ jsxs("li", { children: [
          /* @__PURE__ */ jsx("strong", { children: name }),
          attribution ? /* @__PURE__ */ jsx("span", { children: attribution.citations.map((citation) => /* @__PURE__ */ jsx("a", { href: citation.source.url, rel: "noreferrer", target: "_blank", children: citation.activity }, citation.source.doi)) }) : /* @__PURE__ */ jsx("small", { children: "이 자료판의 상세 인용 정보를 확인하세요." })
        ] }, name)) })
      ] }),
      /* @__PURE__ */ jsxs("section", { children: [
        /* @__PURE__ */ jsx("h2", { children: "자료 처리 방법" }),
        /* @__PURE__ */ jsx("ol", { className: "source-method-list", children: catalog.methodologyReferences.map((reference) => /* @__PURE__ */ jsxs("li", { children: [
          /* @__PURE__ */ jsxs("span", { children: [formatCitationAuthors(reference.authors), " (", reference.year, "). ", reference.title] }),
          /* @__PURE__ */ jsx("a", { href: reference.source.url, rel: "noreferrer", target: "_blank", children: "DOI" })
        ] }, reference.id)) })
      ] }),
      /* @__PURE__ */ jsxs("section", { className: "source-kma-notice", children: [
        /* @__PURE__ */ jsx("h2", { children: "대한민국 기상청 ASOS" }),
        /* @__PURE__ */ jsx("p", { children: "관측 보정이 적용된 결과에는 대한민국 기상청 ASOS 자료가 포함됩니다." }),
        /* @__PURE__ */ jsx("a", { href: "https://www.data.go.kr/data/15057210/openapi.do", rel: "noreferrer", target: "_blank", children: "ASOS 시간자료 출처 보기" }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("img", { alt: "공공누리 제1유형 출처 표시", src: "./assets/licenses/kma_mark_1.png" }),
          /* @__PURE__ */ jsx("img", { alt: "제3자 권리 포함 저작권 표시", src: "./assets/licenses/kma_mark_2.png" })
        ] })
      ] }),
      /* @__PURE__ */ jsx("a", { className: "source-citation-link", href: `${catalog.project.repositoryUrl}/blob/main/CITATION.cff`, rel: "noreferrer", target: "_blank", children: "전체 인용 정보 보기" })
    ] })
  ] });
}
function formatCitationAuthors(authors) {
  if (!Array.isArray(authors)) return "저자 정보 없음";
  return authors.map((author) => author.name ?? [author.familyName, author.givenNames].filter(Boolean).join(", ")).join("; ");
}
function SiteFooter() {
  const creator = PUBLIC_ATTRIBUTION_CATALOG.project.creator;
  return /* @__PURE__ */ jsx("footer", { className: "site-footer", children: /* @__PURE__ */ jsxs("div", { className: "site-footer-inner", children: [
    /* @__PURE__ */ jsxs("span", { children: ["제작자 ", /* @__PURE__ */ jsx("strong", { children: creator.displayName })] }),
    /* @__PURE__ */ jsx("a", { href: creator.githubUrl, rel: "noreferrer", target: "_blank", children: `GitHub ${creator.githubHandle}` })
  ] }) });
}
function renderRoute(route, datasetState) {
  switch (route) {
    case "/teacher":
      return /* @__PURE__ */ jsx(TeacherPage, { datasetState });
    case "/public":
      return /* @__PURE__ */ jsx(PublicPage, { datasetState });
    default:
      return /* @__PURE__ */ jsx(QueryPage, { audience: "student", datasetState });
  }
}
function QueryPage({ audience, datasetState }) {
  const initialPreset = queryPresets.find((preset) => preset.id === "custom") ?? queryPresets[0];
  const sharedLessonState = useMemo(() => {
    const encoded = parseHashLocation(window.location.hash).params.get("lesson");
    return encoded ? decodeLessonState(encoded) : undefined;
  }, []);
  const sharedProblemPreset = sharedLessonState?.problemSetId
    ? queryPresets.find((preset) => preset.problemSetId === sharedLessonState.problemSetId && preset.problemRevision === sharedLessonState.problemRevision)
    : undefined;
  const [selectedPresetId, setSelectedPresetId] = useState(sharedProblemPreset?.id ?? (sharedLessonState ? "custom" : initialPreset.id));
  const [problemCategory, setProblemCategory] = useState("all");
  const activePreset = queryPresets.find((preset) => preset.id === selectedPresetId) ?? initialPreset;
  const activeMystery = activePreset.problem?.mystery;
  const [mysteryGuess, setMysteryGuess] = useState("");
  const [mysteryRevealed, setMysteryRevealed] = useState(false);
  const locationConcealed = Boolean(activeMystery?.hiddenLocation && !mysteryRevealed);
  const visiblePresets = queryPresets.filter((preset) => preset.id === "custom" || problemCategory === "all" || preset.category === problemCategory);
  const presetGridRef = useRef(null);
  const [model, setModel] = useState(sharedLessonState?.model ?? initialPreset.model);
  const [raw, setRaw] = useState(sharedProblemPreset?.raw ?? initialPreset.raw);
  const [date, setDate] = useState(sharedLessonState?.date ?? initialPreset.date);
  const [scenario, setScenario] = useState(sharedLessonState?.scenario ?? initialPreset.scenario);
  const [coordinates, setCoordinates] = useState({
    latitude: sharedLessonState?.latitude ?? initialPreset.latitude,
    longitude: sharedLessonState?.longitude ?? initialPreset.longitude
  });
  const activeStudySite = activePreset.studySites?.find(
    (site) => isClose(site.latitude, coordinates.latitude) && isClose(site.longitude, coordinates.longitude)
  );
  const [latitudeInput, setLatitudeInput] = useState((sharedLessonState?.latitude ?? initialPreset.latitude).toFixed(4));
  const [longitudeInput, setLongitudeInput] = useState((sharedLessonState?.longitude ?? initialPreset.longitude).toFixed(4));
  const [exportContext, setExportContext] = useState(null);
  const metadata = datasetState.metadata;
  const [learningFocus, setLearningFocus] = useState(sharedLessonState?.focus ?? "heat");
  const [studentNote, setStudentNote] = useState("");
  const [studentConclusion, setStudentConclusion] = useState("");
  const [comparisonBaseline, setComparisonBaseline] = useState();
  const [queryMessage, setQueryMessage] = useState(sharedLessonState ? sharedLessonMessage(sharedLessonState) : "지도에서 위치를 고른 뒤 날짜와 기후 모델을 선택하세요.");
  const availableModels = metadata?.models?.length ? metadata.models : cmip6ModelOptions;
  const availableScenarios = metadata?.scenarios?.length ? metadata.scenarios : [initialPreset.scenario];
  const remoteState = useRemoteMetricResponse({
    coordinate: coordinates,
    date,
    scenario,
    model,
    requestDatasetRefresh: datasetState.requestRefresh,
    datasetUpdatedAt: metadata?.datasetUpdatedAt,
    datasetVersion: metadata?.datasetVersion,
    refreshSequence: datasetState.refreshSequence
  });
  const usesRawModelGrid = remoteState.response?.dataMode === "raw-model-grid";
  const hasCurrentDatasetResult = isCurrentPublicDatasetResult(remoteState.response, metadata, remoteState.status);
  const metricsForSelection = useMemo(
    () => deriveClimateMetrics({ date, raw, remoteState }),
    [date, raw, remoteState]
  );
  const hasExportableMetrics = hasCurrentDatasetResult
    && metricsForSelection.some((metric) => metric.available !== false && Number.isFinite(metric.numericValue));
  const currentSnapshot = useMemo(() => hasCurrentDatasetResult ? createMetricSnapshot(metricsForSelection, {
    date,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    scenario,
    model,
    label: activeStudySite ? `${activePreset.label.replace(/^[A-Z]\s+/u, "")} · ${activeStudySite.label}` : activePreset.label.replace(/^[A-Z]\s+/u, "")
  }) : void 0, [hasCurrentDatasetResult, metricsForSelection, date, coordinates.latitude, coordinates.longitude, scenario, model, activePreset.label, activeStudySite]);
  const comparisonRows = useMemo(
    () => compareMetricSnapshots(comparisonBaseline, currentSnapshot),
    [comparisonBaseline, currentSnapshot]
  );
  useEffect(() => {
    if (!metadata) return;
    if (Array.isArray(metadata.models) && metadata.models.length > 0) {
      setModel((currentModel) => metadata.models.includes(currentModel) ? currentModel : metadata.models[0]);
    }
    if (Array.isArray(metadata.scenarios) && metadata.scenarios.length > 0) {
      setScenario((currentScenario) => metadata.scenarios.includes(currentScenario) ? currentScenario : metadata.scenarios[0]);
    }
    if (metadata.dateStart && metadata.dateEnd) {
      setDate((currentDate) => clipPeriod(currentDate, currentDate, metadata.dateStart, metadata.dateEnd).start);
    }
  }, [metadata]);
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
    setStudentConclusion("");
  }, [date, coordinates.latitude, coordinates.longitude, scenario, model, selectedPresetId]);
  useEffect(() => {
    setComparisonBaseline(void 0);
  }, [metadata?.datasetUpdatedAt, metadata?.datasetVersion]);
  useEffect(() => {
    setMysteryGuess("");
    setMysteryRevealed(false);
  }, [selectedPresetId]);
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
          setQueryMessage("이전 화면에서 고른 위치를 불러왔습니다. 날짜나 모델을 바꾸면 값이 다시 계산됩니다.");
        }
      } catch {
        setQueryMessage("이전 화면에서 고른 위치를 불러오지 못했습니다. 지도에서 다시 골라 주세요.");
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
      const problemPreset = shared.problemSetId
        ? queryPresets.find((preset) => preset.problemSetId === shared.problemSetId && preset.problemRevision === shared.problemRevision)
        : undefined;
      setSelectedPresetId(problemPreset?.id ?? "custom");
      setDate(shared.date);
      setScenario(shared.scenario);
      setModel(shared.model);
      setRaw(problemPreset?.raw ?? false);
      setLearningFocus(shared.focus);
      setCoordinates({ latitude: shared.latitude, longitude: shared.longitude });
      setComparisonBaseline(void 0);
      setQueryMessage(sharedLessonMessage(shared));
    };
    const showExamples = () => {
      const preset = queryPresets[0];
      setSelectedPresetId(preset.id);
      setDate(preset.date);
      setScenario(preset.scenario);
      setModel(preset.model);
      setRaw(preset.raw);
      setLearningFocus(preset.focus ?? "heat");
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
    window.addEventListener("hashchange", applySharedLesson);
    return () => {
      window.removeEventListener("ctc:apply-coordinate", applyPendingCoordinate);
      window.removeEventListener("ctc:show-examples", showExamples);
      window.removeEventListener("hashchange", applySharedLesson);
    };
  }, []);
  const selectPreset = (preset) => {
    const nextDate = metadata?.dateStart && metadata?.dateEnd ? clipPeriod(preset.date, preset.date, metadata.dateStart, metadata.dateEnd).start : preset.date;
    const nextModel = availableModels.includes(preset.model) ? preset.model : availableModels[0] ?? cmip6ModelOptions[0];
    const nextScenario = availableScenarios.includes(preset.scenario) ? preset.scenario : availableScenarios[0] ?? initialPreset.scenario;
    setSelectedPresetId(preset.id);
    setDate(nextDate);
    setScenario(nextScenario);
    setModel(nextModel);
    setRaw(preset.raw);
    setLearningFocus(preset.focus ?? "heat");
    setCoordinates({ latitude: preset.latitude, longitude: preset.longitude });
      setQueryMessage(`${preset.label} 예시를 열었습니다. 필요하면 지도에서 다른 위치를 고르세요.`);
  };
  const selectStudySite = (site) => {
    setSelectedPresetId(activePreset.id);
    setLearningFocus(activePreset.focus ?? "heat");
    setCoordinates({ latitude: site.latitude, longitude: site.longitude });
    setQueryMessage(`${site.label}을 비교할 지역으로 골랐습니다. ${activePreset.periodStart}부터 ${activePreset.periodEnd}까지 실제 기후 자료를 모델별로 비교해 보세요.`);
  };
  const selectMapCoordinate = (nextCoordinate) => {
    setSelectedPresetId(activePreset.problemSetId && activePreset.allowCustomLocation ? activePreset.id : "custom");
    setCoordinates(nextCoordinate);
    setQueryMessage("위치를 바꾸었습니다. 결과와 자료 내보내기 조건도 새 위치에 맞게 바뀌었습니다.");
  };
  const confirmQuery = () => {
    const nextLatitude = Number(latitudeInput);
    const nextLongitude = Number(longitudeInput);
    if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude) || nextLatitude < -mercatorLatitudeLimit || nextLatitude > mercatorLatitudeLimit || nextLongitude < -180 || nextLongitude > 180) {
      setQueryMessage(`위도는 북위(N) 또는 남위(S) 0~${mercatorLatitudeLimit}, 경도는 동경(E) 또는 서경(W) 0~180 범위로 입력하세요.`);
      return;
    }
    const nextCoordinates = {
      latitude: clamp(nextLatitude, -mercatorLatitudeLimit, mercatorLatitudeLimit),
      longitude: normalizeLongitude(nextLongitude)
    };
    setSelectedPresetId(activePreset.problemSetId && activePreset.allowCustomLocation ? activePreset.id : "custom");
    setCoordinates(nextCoordinates);
    setQueryMessage(`${date} · ${model} · ${formatCoordinatePair(nextCoordinates.latitude, nextCoordinates.longitude)} 기준으로 값과 저장 기준을 갱신했습니다.`);
  };
  const exportMetric = (metric) => {
    if (!metric.key) return;
    if (!hasCurrentDatasetResult) {
      setQueryMessage("최신 기후자료 조회가 끝난 뒤 기간 자료를 내보낼 수 있습니다.");
      return;
    }
    if (locationConcealed) {
      setQueryMessage("먼저 위치 후보를 고르고 정답을 확인하세요. 그 뒤 기간 자료를 내보낼 수 있습니다.");
      return;
    }
    setExportContext({
      date,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario,
      model,
      expectedDataMode: remoteState.response?.dataMode,
      initialMetrics: [metric.key],
      includeRaw: raw && !usesRawModelGrid,
      initialStartDate: activePreset.periodStart,
      initialEndDate: activePreset.periodEnd,
      derivedKeys: activePreset.derivedKeys,
      seasonMonths: commonSeasonMonths(activePreset.problem),
      exploration: problemExploration(activePreset.problem)
    });
  };
  const exportAllMetrics = () => {
    if (!hasCurrentDatasetResult) {
      setQueryMessage("최신 기후자료 조회가 끝난 뒤 전체 자료를 내보낼 수 있습니다.");
      return;
    }
    if (locationConcealed) {
      setQueryMessage("먼저 위치 후보를 고르고 정답을 확인하세요. 그 뒤 전체 자료를 내보낼 수 있습니다.");
      return;
    }
    const initialMetrics = [...new Set([
      ...metricsForSelection.filter((metric) => metric.key && metric.available !== false && Number.isFinite(metric.numericValue)).map((metric) => metric.key),
      ...(activePreset.derivedKeys ?? [])
    ])];
    setExportContext({
      date,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario,
      model,
      expectedDataMode: remoteState.response?.dataMode,
      initialMetrics,
      includeRaw: raw && !usesRawModelGrid,
      initialStartDate: activePreset.periodStart,
      initialEndDate: activePreset.periodEnd,
      derivedKeys: activePreset.derivedKeys,
      seasonMonths: commonSeasonMonths(activePreset.problem),
      exploration: problemExploration(activePreset.problem)
    });
  };
  const openProblemPeriod = (period) => {
    if (!hasCurrentDatasetResult) {
      setQueryMessage("최신 기후자료 조회가 끝난 뒤 기간 자료를 확인할 수 있습니다.");
      return;
    }
    if (locationConcealed) {
      setQueryMessage("먼저 지표와 단서를 살펴보고 위치 후보를 고르세요. 정답을 확인하면 기간 자료가 열립니다.");
      return;
    }
    setExportContext({
      date: period.start,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario,
      model,
      expectedDataMode: remoteState.response?.dataMode,
      initialMetrics: [...(activePreset.variableKeys ?? []), ...(activePreset.derivedKeys ?? [])],
      includeRaw: raw && !usesRawModelGrid,
      initialStartDate: period.start,
      initialEndDate: period.end,
      derivedKeys: activePreset.derivedKeys,
      seasonMonths: period.seasonMonths,
      exploration: problemExploration(activePreset.problem)
    });
  };
  const saveComparisonBaseline = () => {
    if (!currentSnapshot) return;
    setComparisonBaseline(currentSnapshot);
    setQueryMessage("현재 자료를 첫 번째 비교 자료로 정했습니다. 위치나 날짜를 바꾸면 두 자료의 차이를 확인할 수 있습니다.");
  };
  const saveStudentNotebook = async () => {
    if (!currentSnapshot) return;
    if (locationConcealed) {
      setQueryMessage("정답을 확인하면 위치와 자료가 포함된 탐구 기록을 저장할 수 있습니다.");
      return;
    }
    const focus = studentFocusOptions.find((option) => option.key === learningFocus) ?? studentFocusOptions[0];
    try {
      const { buildStudentNotebookDocx } = await import("./student-docx.js");
      const blob = await buildStudentNotebookDocx({
        baseline: comparisonBaseline ?? currentSnapshot,
        comparison: comparisonBaseline ? currentSnapshot : undefined,
        focusLabel: focus.label,
        conclusion: studentConclusion,
        note: studentNote,
        problem: activePreset.problem
      });
      const target = await requestSaveTarget({
        filename: "climate-exploration-note.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: ".docx",
        description: "기후 탐구 문서(DOCX)"
      });
      const result = await saveBlobToTarget(target, blob);
      setQueryMessage(describeSaveResult(result, "탐구 기록"));
    } catch (error) {
      setQueryMessage(error instanceof Error ? error.message : "탐구 기록 문서를 만들지 못했습니다.");
    }
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "query-layout", children: [
      /* @__PURE__ */ jsxs("section", { className: "query-panel", children: [
        /* @__PURE__ */ jsx("h2", { children: audience === "student" ? "탐구할 문제를 골라 보세요" : "조회 조건" }),
        /* @__PURE__ */ jsx(ProblemCategoryControl, { label: "학생 문제 주제", onChange: setProblemCategory, value: problemCategory }),
        /* @__PURE__ */ jsx("div", { className: "preset-grid", ref: presetGridRef, children: visiblePresets.map((preset) => /* @__PURE__ */ jsxs(
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
        activePreset.studySites ? /* @__PURE__ */ jsxs("section", { className: "regional-study-sites", children: [
          /* @__PURE__ */ jsxs("div", { className: "regional-study-heading", children: [
            /* @__PURE__ */ jsx(CloudRain, { size: 17 }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("strong", { children: "비교할 지역" }),
              /* @__PURE__ */ jsxs("small", { children: [activePreset.studySites.length, "개 지역 가운데 하나를 고르거나 지도에서 다른 위치를 선택할 수 있습니다."] })
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "regional-study-options", role: "group", "aria-label": "비교할 지역", children: activePreset.studySites.map((site) => /* @__PURE__ */ jsxs("button", {
            "aria-pressed": activeStudySite?.id === site.id,
            className: activeStudySite?.id === site.id ? "active" : "",
            onClick: () => selectStudySite(site),
            type: "button",
            children: [
              /* @__PURE__ */ jsx("strong", { children: site.label }),
              /* @__PURE__ */ jsx("small", { children: site.detail })
            ]
          }, site.id)) })
        ] }) : null,
        /* @__PURE__ */ jsx(DateField, { label: "날짜", min: metadata?.dateStart, max: metadata?.dateEnd, value: date, onChange: setDate }),
        locationConcealed ? /* @__PURE__ */ jsxs("div", { className: "concealed-coordinate-field", children: [
          /* @__PURE__ */ jsx(Globe2, { size: 18 }),
          /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("strong", { children: "위치를 추리해 보세요" }), /* @__PURE__ */ jsx("small", { children: "답을 고를 때까지 위치와 지명을 보여 주지 않습니다." })] })
        ] }) : /* @__PURE__ */ jsxs("div", { className: "field-pair", children: [
          /* @__PURE__ */ jsx(CoordinateInput, { label: "위도", max: mercatorLatitudeLimit, min: -mercatorLatitudeLimit, onChange: setLatitudeInput, value: latitudeInput }),
          /* @__PURE__ */ jsx(CoordinateInput, { label: "경도", max: 180, min: -180, onChange: setLongitudeInput, value: longitudeInput })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
          "배출 경로",
          /* @__PURE__ */ jsx("select", { value: scenario, onChange: (event) => setScenario(event.target.value), children: availableScenarios.map((scenarioOption) => /* @__PURE__ */ jsx("option", { children: scenarioOption }, scenarioOption)) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
          "기후 모델",
          /* @__PURE__ */ jsx("select", { value: model, onChange: (event) => setModel(event.target.value), children: availableModels.map((modelOption) => /* @__PURE__ */ jsx("option", { children: modelOption }, modelOption)) })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: `toggle-row ${usesRawModelGrid ? "disabled" : ""}`, children: [
          /* @__PURE__ */ jsx("input", { disabled: usesRawModelGrid, type: "checkbox", checked: usesRawModelGrid ? false : raw, onChange: (event) => setRaw(event.target.checked) }),
          usesRawModelGrid ? "이 위치는 기후 모델 원자료로 표시됩니다" : "보정 전 모델 값 함께 보기"
        ] }),
        /* @__PURE__ */ jsxs("button", { className: "primary-action wide", disabled: locationConcealed, onClick: confirmQuery, type: "button", children: [
          /* @__PURE__ */ jsx(Search, { size: 18 }),
          locationConcealed ? "정답을 확인하면 위치 보기" : "선택한 위치 확인"
        ] }),
        /* @__PURE__ */ jsx("div", { className: "mini-status ok", children: queryMessage })
      ] }),
      locationConcealed ? /* @__PURE__ */ jsx(MysteryLocationPanel, {
        guess: mysteryGuess,
        mystery: activeMystery,
        onGuess: setMysteryGuess,
        onReveal: () => {
          if (!mysteryGuess) {
            setQueryMessage("자료와 단서를 살펴본 뒤 위치 후보를 먼저 고르세요.");
            return;
          }
          setMysteryRevealed(true);
          setQueryMessage(`${mysteryGuess}을 골랐습니다. 실제 위치를 보여 주고 자료 비교 기능을 열었습니다.`);
        }
      }) : /* @__PURE__ */ jsx(
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
          /* @__PURE__ */ jsx("h2", { children: "주요 기후 지표" }),
          /* @__PURE__ */ jsxs("button", { className: "secondary-action", disabled: !hasExportableMetrics || locationConcealed, onClick: exportAllMetrics, type: "button", children: [
            /* @__PURE__ */ jsx(HardDriveDownload, { size: 16 }),
            "전체 자료 내보내기"
          ] })
        ] }),
        /* @__PURE__ */ jsx("div", { className: `mini-status ${remoteState.status === "ready" ? "ok" : "warn"}`, "aria-live": "polite", children: remoteState.message }),
        /* @__PURE__ */ jsx(MetricGrid, { items: metricsForSelection, onExportMetric: locationConcealed || !hasCurrentDatasetResult ? undefined : exportMetric }),
        /* @__PURE__ */ jsx(StudentWorkbench, {
          baseline: comparisonBaseline,
          comparisonRows,
          currentSnapshot,
          focus: learningFocus,
          conclusion: studentConclusion,
          conclusionOptions: activePreset.conclusionOptions,
          note: studentNote,
          problemPrompt: learningFocus === activePreset.focus ? activePreset.problem?.roles.student.prompt : undefined,
          onConclusionChange: setStudentConclusion,
          onFocusChange: setLearningFocus,
          onNoteChange: (value) => setStudentNote(sanitizeNote(value)),
          onOpenProblemPeriod: openProblemPeriod,
          onSaveBaseline: saveComparisonBaseline,
          onSaveNotebook: saveStudentNotebook,
          problem: activePreset.problem,
          mysteryRevealed,
          mysteryGuess
        }),
        /* @__PURE__ */ jsx(NoticeCard, { title: "현재 탐구", body: activePreset.summary }),
        /* @__PURE__ */ jsx(NoticeCard, { title: "자료를 읽을 때 주의할 점", body: locationConcealed ? `${activePreset.dataNote} 위치는 답을 고를 때까지 공개하지 않습니다.` : `${activePreset.dataNote} 현재 위치는 ${formatCoordinatePair(coordinates.latitude, coordinates.longitude)}입니다.` })
      ] })
    ] }),
    /* @__PURE__ */ jsx(ClimateExportDialog, { context: exportContext, datasetState, onClose: () => setExportContext(null) }),
    remoteState.status === "loading" ? /* @__PURE__ */ jsx(ClimateLoadingOverlay, { onCancel: remoteState.cancel }) : null
  ] });
}
const studentFocusOptions = [
  { key: "heat", label: "더위와 체감기온", icon: ThermometerSun, prompt: "최고기온과 체감 지표가 함께 어떻게 달라지는지 살펴보세요. 5~9월에는 열지수, 10~4월에는 체감기온을 표시합니다." },
  { key: "temperature", label: "최고·최저기온", icon: Gauge, prompt: "최고기온과 최저기온을 함께 비교해 하루 기온 차이와 계절 변화를 살펴보세요." },
  { key: "rain", label: "비의 변화", icon: CloudRain, prompt: "6~10월 동안 비가 많이 내린 시기를 찾고, 그 시기가 우리가 알고 있던 6~7월과 다른지 지점과 모델별로 비교해 보세요." },
  { key: "wind", label: "바람과 체감", icon: Wind, prompt: "풍속과 체감기온 또는 열지수의 변화를 함께 살펴보세요. 두 값이 함께 변해도 원인과 결과로 단정하지 마세요." }
];
function sharedLessonMessage(shared) {
  return shared.source === "public" ? "일반 요약에서 고른 자료를 자세히 열었습니다. 첫 번째 비교 자료를 정한 뒤 위치, 날짜 또는 기후 모델을 바꾸어 보세요." : "교사가 공유한 수업을 열었습니다. 첫 번째 비교 자료를 정한 뒤 위치, 날짜 또는 기후 모델을 바꾸어 보세요.";
}
function MysteryLocationPanel({ guess, mystery, onGuess, onReveal }) {
  return /* @__PURE__ */ jsxs("section", { className: "mystery-location-panel", "aria-labelledby": "mystery-location-title", children: [
    /* @__PURE__ */ jsxs("div", { className: "mystery-location-heading", children: [
      /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(Globe2, { size: 28 }) }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("small", { children: "위치 추리 활동" }),
        /* @__PURE__ */ jsx("h2", { id: "mystery-location-title", children: "자료만 보고 위치를 추리해 보세요" }),
        /* @__PURE__ */ jsx("p", { children: "기온, 강수량, 풍속과 아래 단서를 읽고 가장 알맞은 위치를 골라 보세요. 답을 확인하면 실제 지도가 열립니다." })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "mystery-choice-grid", role: "group", "aria-label": "위치 후보", children: mystery.choices.map((choice) => /* @__PURE__ */ jsx("button", {
      "aria-pressed": guess === choice,
      className: guess === choice ? "active" : "",
      onClick: () => onGuess(choice),
      type: "button",
      children: choice
    }, choice)) }),
    /* @__PURE__ */ jsxs("div", { className: "mystery-hints", children: [
      /* @__PURE__ */ jsx("strong", { children: "자료에서 확인할 단서" }),
      /* @__PURE__ */ jsx("ol", { children: mystery.hints.map((hint) => /* @__PURE__ */ jsx("li", { children: hint }, hint)) })
    ] }),
    /* @__PURE__ */ jsxs("button", { className: "mystery-reveal-action", disabled: !guess, onClick: onReveal, type: "button", children: [
      /* @__PURE__ */ jsx(Eye, { size: 17 }),
      guess ? `${guess}으로 정답 확인` : "위치 후보를 먼저 고르세요"
    ] })
  ] });
}
function StudentProblemBrief({ mysteryGuess, mysteryRevealed, onOpenPeriod, problem }) {
  const variables = problem.dataPlan.variableKeys.map((key) => problemVariableLabels[key] ?? key);
  const periods = problem.dataPlan.comparisonPeriods ?? [{
    id: "full",
    label: "전체 탐구 기간",
    start: problem.dataPlan.periodStart,
    end: problem.dataPlan.periodEnd
  }];
  return /* @__PURE__ */ jsxs("section", { className: "student-problem-brief", "aria-labelledby": `student-problem-${problem.id}`, children: [
    /* @__PURE__ */ jsxs("div", { className: "student-problem-question", children: [
      /* @__PURE__ */ jsx(Target, { size: 18 }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("span", { children: "탐구 문제" }),
        /* @__PURE__ */ jsx("h4", { id: `student-problem-${problem.id}`, children: problem.presentation.title }),
        /* @__PURE__ */ jsx("p", { children: problem.inquiry.question })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "student-problem-facts", children: [
      /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx(CalendarDays, { size: 14 }), problem.dataPlan.periodStart, " ~ ", problem.dataPlan.periodEnd] }),
      /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx(Activity, { size: 14 }), variables.join(" · ")] }),
      problem.mystery?.hiddenLocation && !mysteryRevealed ? /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx(Globe2, { size: 14 }), "정답을 고를 때까지 위치 숨김"] }) : null
    ] }),
    problem.mystery && mysteryRevealed ? /* @__PURE__ */ jsxs("div", { className: "mystery-answer", children: [
      /* @__PURE__ */ jsx(Check, { size: 18 }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsxs("strong", { children: ["내가 고른 답: ", mysteryGuess, " · 실제 위치: ", problem.mystery.reveal.title] }),
        /* @__PURE__ */ jsx("p", { children: problem.mystery.reveal.explanation })
      ] })
    ] }) : null,
    /* @__PURE__ */ jsxs("div", { className: "student-problem-output", children: [
      /* @__PURE__ */ jsx("strong", { children: "완성할 결과물" }),
      /* @__PURE__ */ jsx("ul", { children: problem.roles.student.output.map((item) => /* @__PURE__ */ jsx("li", { children: item }, item)) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "student-problem-periods", children: [
      /* @__PURE__ */ jsx("strong", { children: periods.length > 1 ? "비교할 기간 열기" : "탐구 기간 자료 열기" }),
      /* @__PURE__ */ jsx("div", { children: periods.map((period) => /* @__PURE__ */ jsxs("button", {
        onClick: () => onOpenPeriod(period),
        type: "button",
        children: [
          /* @__PURE__ */ jsx(CalendarDays, { size: 14 }),
          /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("b", { children: period.label }), /* @__PURE__ */ jsxs("small", { children: [period.start, " ~ ", period.end, period.seasonMonths?.length ? ` · ${period.seasonMonths.join(", ")}월만` : ""] })] })
        ]
      }, period.id)) })
    ] }),
    problem.microclimateExtension ? /* @__PURE__ */ jsxs("div", { className: "student-microclimate-extension", children: [
      /* @__PURE__ */ jsx("strong", { children: "장소별 기후 차이 더 살펴보기" }),
      /* @__PURE__ */ jsx("p", { children: problem.microclimateExtension.prompt }),
      /* @__PURE__ */ jsxs("small", { children: ["열지수를 계산할 때 직접 쓰는 요소: ", problem.microclimateExtension.directIndexInputs.join(" · ")] }),
      /* @__PURE__ */ jsxs("small", { children: ["주변의 더위에 영향을 줄 수 있는 환경: ", problem.microclimateExtension.backgroundFactors.join(" · ")] }),
      /* @__PURE__ */ jsxs("small", { children: ["추가로 필요한 자료: ", problem.microclimateExtension.unavailableVariables.join(" · ")] })
    ] }) : null
  ] });
}
function StudentWorkbench({ baseline, comparisonRows, conclusion, conclusionOptions, currentSnapshot, focus, mysteryGuess, mysteryRevealed, note, onConclusionChange, onFocusChange, onNoteChange, onOpenProblemPeriod, onSaveBaseline, onSaveNotebook, problem, problemPrompt }) {
  const selectedFocus = studentFocusOptions.find((option) => option.key === focus) ?? studentFocusOptions[0];
  return /* @__PURE__ */ jsxs("section", { className: "student-workbench", children: [
    /* @__PURE__ */ jsxs("div", { className: "workbench-heading", children: [
      /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(BookOpen, { size: 18 }) }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h3", { children: "나의 기후 탐구" }),
        /* @__PURE__ */ jsx("p", { children: "기후 모델 자료에서 위치·날짜·모델이 다른 두 자료를 비교하고, 찾은 내용을 기록합니다." })
      ] })
    ] }),
    problem ? /* @__PURE__ */ jsx(StudentProblemBrief, { mysteryGuess, mysteryRevealed, onOpenPeriod: onOpenProblemPeriod, problem }) : null,
    /* @__PURE__ */ jsx("div", { className: "student-focus-options", role: "group", "aria-label": "탐구 주제", children: studentFocusOptions.map(({ key, label, icon: Icon }) => /* @__PURE__ */ jsxs("button", { "aria-pressed": focus === key, className: focus === key ? "active" : "", onClick: () => onFocusChange(key), type: "button", children: [
      /* @__PURE__ */ jsx(Icon, { size: 16 }),
      label
    ] }, key)) }),
    /* @__PURE__ */ jsxs("div", { className: "student-prompt", children: [
      /* @__PURE__ */ jsx(Target, { size: 17 }),
      /* @__PURE__ */ jsx("span", { children: problemPrompt ?? selectedFocus.prompt })
    ] }),
    conclusionOptions?.length ? /* @__PURE__ */ jsxs("fieldset", { className: "student-conclusion-options", children: [
      /* @__PURE__ */ jsx("legend", { children: "자료를 보고 내린 판단" }),
      /* @__PURE__ */ jsx("div", { children: conclusionOptions.map((option) => /* @__PURE__ */ jsx("button", {
        "aria-pressed": conclusion === option,
        className: conclusion === option ? "active" : "",
        onClick: () => onConclusionChange(option),
        type: "button",
        children: option
      }, option)) })
    ] }) : null,
    /* @__PURE__ */ jsxs("div", { className: "student-comparison", children: [
      /* @__PURE__ */ jsxs("div", { className: "comparison-toolbar", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("strong", { children: baseline ? "첫 번째 비교 자료를 정했습니다" : "먼저 비교할 자료를 정하세요" }),
          /* @__PURE__ */ jsx("span", { children: baseline ? `${baseline.label} · ${baseline.date}` : "현재 위치·날짜·기후 모델의 값을 첫 번째 자료로 정할 수 있습니다." })
        ] }),
        /* @__PURE__ */ jsxs("button", { disabled: !currentSnapshot, onClick: onSaveBaseline, type: "button", children: [
          /* @__PURE__ */ jsx(BookmarkPlus, { size: 16 }),
          baseline ? "현재 자료로 바꾸기" : "첫 번째 비교 자료로 정하기"
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
      /* @__PURE__ */ jsx("textarea", { maxLength: 2000, onChange: (event) => onNoteChange(event.target.value), placeholder: "두 자료에서 어떤 값이 얼마나 달랐으며, 무엇을 알 수 있는지 적어 보세요.", value: note })
    ] }),
    /* @__PURE__ */ jsxs("button", { className: "student-save-action", disabled: !currentSnapshot, onClick: onSaveNotebook, type: "button", children: [
      /* @__PURE__ */ jsx(Download, { size: 16 }),
      "탐구 기록을 문서로 저장"
    ] })
  ] });
}
function formatWorkbenchNumber(value) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}
function ClimateLoadingOverlay({ onCancel }) {
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
        /* @__PURE__ */ jsxs("div", { className: "climate-loading-heading", children: [
          /* @__PURE__ */ jsx("div", { className: "climate-loading-icon", children: /* @__PURE__ */ jsx(LoaderCircle, { size: 28 }) }),
          /* @__PURE__ */ jsxs("div", { className: "climate-loading-copy", children: [
            /* @__PURE__ */ jsx("span", { className: "eyebrow", children: "실제 기후 자료 조회 중" }),
            /* @__PURE__ */ jsx("h2", { id: "climate-loading-title", children: "선택한 위치의 자료를 확인하고 있습니다" }),
            /* @__PURE__ */ jsx("p", { id: "climate-loading-description", children: "선택한 위치 주변에 보정에 사용할 관측소가 없어 기후 모델 원자료를 읽고 있습니다. 이 경우 시간이 더 걸릴 수 있습니다. 조회가 끝날 때까지 새로고침하거나 창을 닫지 마세요." })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "climate-loading-status", children: [
          /* @__PURE__ */ jsx("div", { "aria-label": "기후 자료 불러오는 중", "aria-valuetext": `조회 중 · ${elapsedSeconds}초 경과`, className: "climate-loading-progress", role: "progressbar", children: /* @__PURE__ */ jsx("span", {}) }),
          /* @__PURE__ */ jsxs("div", { className: "loading-meta", children: [
            /* @__PURE__ */ jsxs("strong", { children: [elapsedSeconds, "초 경과"] }),
            /* @__PURE__ */ jsx("span", { children: elapsedSeconds < 3 ? "위치와 날짜 확인 중" : elapsedSeconds < 12 ? "기후 모델 자료를 읽는 중" : "자료를 찾고 정리하는 중" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "loading-completion", children: [
            /* @__PURE__ */ jsx("small", { children: "완료되면 이 창이 닫히고 결과가 자동으로 바뀝니다." }),
            /* @__PURE__ */ jsx("button", { className: "loading-cancel-button", onClick: onCancel, type: "button", children: "취소" })
          ] })
        ] })
      ]
    }
  ) });
}
function TeacherLessonBlueprint({ onOpenPeriod, sample }) {
  if (!sample) return null;
  const problem = sample.problem;
  const variables = sample.variableKeys.map((key) => problemVariableLabels[key] ?? key);
  return /* @__PURE__ */ jsxs("section", { className: "teacher-lesson-blueprint", "aria-labelledby": "teacher-blueprint-title", children: [
    /* @__PURE__ */ jsxs("div", { className: "teacher-blueprint-heading", children: [
      /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(NotebookPen, { size: 19 }) }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h2", { id: "teacher-blueprint-title", children: "가설에서 결과물까지" }),
        /* @__PURE__ */ jsx("p", { children: problem.presentation.title })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "teacher-blueprint-grid", children: [
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("strong", { children: "살펴볼 가설" }),
        /* @__PURE__ */ jsx("ul", { children: problem.inquiry.hypothesisChoices.map((item) => /* @__PURE__ */ jsx("li", { children: item }, item)) })
      ] }),
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("strong", { children: "비교할 자료" }),
        sample.problem.dataPlan.comparisonPeriods?.length ? /* @__PURE__ */ jsx("div", { className: "teacher-period-actions", children: sample.problem.dataPlan.comparisonPeriods.map((period) => /* @__PURE__ */ jsxs("button", { onClick: () => onOpenPeriod(period), type: "button", children: [/* @__PURE__ */ jsx(CalendarDays, { size: 14 }), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("b", { children: period.label }), /* @__PURE__ */ jsxs("small", { children: [period.start, " ~ ", period.end, period.seasonMonths?.length ? ` · ${period.seasonMonths.join(", ")}월만` : ""] })] })] }, period.id)) }) : /* @__PURE__ */ jsxs("p", { children: [sample.periodStart, " ~ ", sample.periodEnd] }),
        /* @__PURE__ */ jsx("p", { children: variables.join(" · ") }),
        /* @__PURE__ */ jsxs("p", { children: [sample.sites.map((site) => site.label).join(" · "), " · 기후 모델(CMIP6)별 비교"] })
      ] }),
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("strong", { children: "학생이 만들 결과물" }),
        /* @__PURE__ */ jsx("ul", { children: sample.output.map((item) => /* @__PURE__ */ jsx("li", { children: item }, item)) })
      ] }),
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("strong", { children: "교사 검토 기준" }),
        /* @__PURE__ */ jsx("ul", { children: sample.assessmentCriteria.map((item) => /* @__PURE__ */ jsx("li", { children: item }, item)) })
      ] }),
      /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsx("strong", { children: "결론에 필요한 근거" }),
        /* @__PURE__ */ jsxs("p", { children: ["비교 지점 ", sample.evidenceRequirements.minimumSites, "개 이상"] }),
        /* @__PURE__ */ jsxs("p", { children: ["CMIP6 기후 모델 ", sample.evidenceRequirements.minimumModels, "개 이상"] }),
        /* @__PURE__ */ jsx("p", { children: sample.evidenceRequirements.includeEnsemble ? "여러 모델 종합값과 개별 모델을 함께 확인" : "개별 모델을 비교" })
      ] }),
      problem.mystery ? /* @__PURE__ */ jsxs("article", { className: "teacher-mystery-blueprint", children: [
        /* @__PURE__ */ jsx("strong", { children: "생각을 바로잡는 수업 흐름" }),
        /* @__PURE__ */ jsx("ol", { children: [
          "좌표와 지명을 숨긴 네 지표를 먼저 제시합니다.",
          "학생이 후보를 고르고 자료에서 찾은 근거를 말하게 합니다.",
          "사하라의 비교 지점과 계절별 자료를 비교합니다.",
          `위치를 공개한 뒤, 자료를 바탕으로 ‘${problem.mystery.reveal.answer}’이라고 판단할 수 있는 범위와 한계를 구분합니다.`
        ].map((item) => /* @__PURE__ */ jsx("li", { children: item }, item)) })
      ] }) : null,
      problem.validationEvidence ? /* @__PURE__ */ jsxs("article", { className: "teacher-validation-evidence", children: [
        /* @__PURE__ */ jsx("strong", { children: "교사가 먼저 확인한 자료" }),
        /* @__PURE__ */ jsx("p", { children: problem.validationEvidence.basis }),
        /* @__PURE__ */ jsx("p", { children: problem.validationEvidence.atlasSummary }),
        /* @__PURE__ */ jsx("p", { children: problem.validationEvidence.rainSummary }),
        /* @__PURE__ */ jsx("p", { children: problem.validationEvidence.modelAvailability })
      ] }) : null,
      problem.microclimateExtension ? /* @__PURE__ */ jsxs("article", { className: "microclimate-blueprint", children: [
        /* @__PURE__ */ jsx("strong", { children: "장소별 기후 차이 조사" }),
        /* @__PURE__ */ jsx("p", { children: problem.microclimateExtension.prompt }),
        /* @__PURE__ */ jsxs("p", { children: ["열지수 계산에 직접 쓰는 요소: ", problem.microclimateExtension.directIndexInputs.join(" · ")] }),
        /* @__PURE__ */ jsxs("p", { children: ["주변의 더위에 영향을 줄 수 있는 환경: ", problem.microclimateExtension.backgroundFactors.join(" · ")] }),
        /* @__PURE__ */ jsxs("p", { children: ["추가로 필요한 자료: ", problem.microclimateExtension.unavailableVariables.join(" · ")] })
      ] }) : null
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "teacher-blueprint-limit", children: [
      /* @__PURE__ */ jsx(TriangleAlert, { size: 16 }),
      /* @__PURE__ */ jsx("p", { children: sample.guardrail })
    ] })
  ] });
}
const teacherDataStatusLabels = {
  ready: "자료 확인 완료",
  partial: "일부 자료만 있음",
  missing: "자료 없음",
  error: "확인 실패",
  cancelled: "조회 취소",
  loading: "자료 확인 중"
};
function teacherDataStatusLabel(status) {
  return teacherDataStatusLabels[status] ?? "자료 확인 중";
}

const teacherStepCopy = {
  [TEACHER_STEP_IDS.LESSON_SELECTION]: {
    eyebrow: "수업 주제",
    title: "탐구 수업 선택",
    description: "연구 자료로 확인한 수업 문제 중 하나를 고릅니다."
  },
  [TEACHER_STEP_IDS.LESSON_CONDITIONS]: {
    eyebrow: "수업 설계",
    title: "수업 조건 확인",
    description: "수업명과 목표, 위치, 날짜, 배출 경로와 기후 모델을 확인합니다."
  },
  [TEACHER_STEP_IDS.ACTIVITY_COMPOSITION]: {
    eyebrow: "근거 구성",
    title: "활동 자료 구성",
    description: "실제 기후 자료를 조회하고 수업에서 요구하는 비교 근거를 모읍니다."
  },
  [TEACHER_STEP_IDS.REVIEW_AND_SHARE]: {
    eyebrow: "수업 준비",
    title: "확인 및 공유",
    description: "수업 조건과 비교 자료를 확인한 뒤 학생 화면과 활동지를 준비합니다."
  }
};

function createInitialTeacherStepFlowState() {
  return createTeacherStepFlowState({
    conditions: {
      date: "2050-08-01",
      dateConfirmed: true,
      title: "우리 지역 2050년 여름",
      objective: "미래의 기온, 강수량, 풍속, 체감 지표가 장소에 따라 어떻게 달라지는지 설명한다.",
      location: { id: "school", label: "학교", latitude: 37.57, longitude: 126.98 },
      scenario: "고배출 경로",
      model: cmip6ModelOptions[0]
    }
  });
}

function TeacherStepProgress({ state }) {
  const navigation = getTeacherStepNavigation(state);
  const currentIndex = TEACHER_STEP_DEFINITIONS.findIndex((step) => step.id === state.currentStep);
  return /* @__PURE__ */ jsx("nav", { className: "teacher-step-progress", "aria-label": navigation.ariaLabel, children: /* @__PURE__ */ jsx("ol", { children: navigation.steps.map((step, index) => {
    const completed = index < currentIndex;
    const stateLabel = step.current ? "현재 단계" : completed ? "완료" : step.locked ? "잠김" : "이동 가능";
    return /* @__PURE__ */ jsxs("li", { className: `${step.current ? "current" : ""}${completed ? " completed" : ""}${step.locked ? " locked" : ""}`, "aria-current": step.ariaCurrent, children: [
      /* @__PURE__ */ jsx("span", { className: "teacher-step-marker", "aria-hidden": "true", children: completed ? /* @__PURE__ */ jsx(Check, { size: 15 }) : step.locked ? /* @__PURE__ */ jsx(LockKeyhole, { size: 14 }) : index + 1 }),
      /* @__PURE__ */ jsxs("span", { className: "teacher-step-label", children: [
        /* @__PURE__ */ jsx("strong", { children: step.label }),
        /* @__PURE__ */ jsx("small", { children: stateLabel })
      ] })
    ] }, step.id);
  }) }) });
}

function TeacherStepNavigation({ state, onNext, onPrevious }) {
  const navigation = getTeacherStepNavigation(state);
  const currentIndex = TEACHER_STEP_DEFINITIONS.findIndex((step) => step.id === state.currentStep);
  const previousStep = TEACHER_STEP_DEFINITIONS[currentIndex - 1];
  const nextStep = TEACHER_STEP_DEFINITIONS[currentIndex + 1];
  return /* @__PURE__ */ jsxs("footer", { className: "teacher-step-navigation", "aria-label": "수업 만들기 단계 이동", children: [
    /* @__PURE__ */ jsxs("button", { className: "teacher-step-previous", disabled: navigation.previous.disabled, onClick: onPrevious, type: "button", "aria-label": navigation.previous.ariaLabel, children: [
      /* @__PURE__ */ jsx(ArrowLeft, { size: 17 }),
      previousStep ? `이전: ${previousStep.label}` : "이전"
    ] }),
    /* @__PURE__ */ jsx("span", { className: "teacher-step-count", "aria-live": "polite", children: `${currentIndex + 1} / ${TEACHER_STEP_DEFINITIONS.length}` }),
    nextStep ? /* @__PURE__ */ jsxs("button", { className: "teacher-step-next", disabled: navigation.next.disabled, onClick: onNext, type: "button", "aria-label": navigation.next.ariaLabel, children: [
      `다음: ${nextStep.label}`,
      /* @__PURE__ */ jsx(ArrowRight, { size: 17 })
    ] }) : /* @__PURE__ */ jsx("span", { className: "teacher-step-navigation-placeholder", "aria-hidden": "true" })
  ] });
}

function TeacherValidationSummary({ messages, successMessage }) {
  const valid = messages.length === 0;
  return /* @__PURE__ */ jsxs("section", { className: `teacher-validation-summary ${valid ? "valid" : "blocked"}`, "aria-live": "polite", children: [
    /* @__PURE__ */ jsx("span", { "aria-hidden": "true", children: valid ? /* @__PURE__ */ jsx(Check, { size: 16 }) : /* @__PURE__ */ jsx(LockKeyhole, { size: 16 }) }),
    /* @__PURE__ */ jsx("div", { children: valid
      ? /* @__PURE__ */ jsx("strong", { children: successMessage })
      : /* @__PURE__ */ jsx("ul", { children: messages.map((message) => /* @__PURE__ */ jsx("li", { children: message }, message)) }) })
  ] });
}

function TeacherPage({ datasetState }) {
  const [teacherFlowState, dispatchTeacherFlow] = useReducer(teacherStepFlowReducer, void 0, createInitialTeacherStepFlowState);
  const teacherStepPanelRef = useRef(null);
  const teacherStepHeadingRef = useRef(null);
  const [started, setStarted] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState("idle");
  const [lessonTitle, setLessonTitle] = useState("우리 지역 2050년 여름");
  const [lessonObjective, setLessonObjective] = useState("미래의 기온, 강수량, 풍속, 체감 지표가 장소에 따라 어떻게 달라지는지 설명한다.");
  const [lessonLocation, setLessonLocation] = useState({ id: "school", label: "학교", latitude: 37.57, longitude: 126.98, icon: School });
  const [lessonDate, setLessonDate] = useState("2050-08-01");
  const [lessonScenario, setLessonScenario] = useState("고배출 경로");
  const [lessonModel, setLessonModel] = useState(cmip6ModelOptions[0]);
  const [lessonFocus, setLessonFocus] = useState("heat");
  const [activeTeacherSampleId, setActiveTeacherSampleId] = useState();
  const [teacherProblemCategory, setTeacherProblemCategory] = useState("all");
  const metadata = datasetState.metadata;
  const [comparisonPoints, setComparisonPoints] = useState([]);
  const [teacherMessage, setTeacherMessage] = useState("기후 모델 자료를 확인한 뒤 수업 활동을 시작하세요.");
  const [exportContext, setExportContext] = useState(null);
  const [shareOutcome, setShareOutcome] = useState("idle");
  const activeTeacherSample = teacherLessonSamples.find((sample) => sample.id === activeTeacherSampleId);
  const visibleTeacherSamples = teacherLessonSamples.filter((sample) => teacherProblemCategory === "all" || sample.problem.category === teacherProblemCategory);
  const comparisonLimit = activeTeacherSample ? Math.max(
    3,
    activeTeacherSample.sites.length,
    activeTeacherSample.evidenceRequirements.minimumSites,
    activeTeacherSample.evidenceRequirements.minimumModels
  ) : 3;
  const requiredEvidence = activeTeacherSample?.evidenceRequirements ?? { minimumSites: 1, minimumModels: 1, includeEnsemble: false };
  const comparisonSiteCount = new Set(comparisonPoints.map((point) => `${point.latitude.toFixed(4)}:${point.longitude.toFixed(4)}`)).size;
  const comparisonModelCount = new Set(comparisonPoints.map((point) => point.model)).size;
  const hasRequiredEnsemble = !requiredEvidence.includeEnsemble || comparisonPoints.some((point) => point.model === "전체 앙상블");
  const evidenceReady = comparisonSiteCount >= requiredEvidence.minimumSites && comparisonModelCount >= requiredEvidence.minimumModels && hasRequiredEnsemble;
  const defaultLessonLocations = [
    { id: "school", label: "학교", detail: "서울 도심", latitude: 37.57, longitude: 126.98, icon: School },
    { id: "coast", label: "해안", detail: "부산 해안", latitude: 35.18, longitude: 129.08, icon: Waves },
    { id: "mountain", label: "산지", detail: "대관령", latitude: 37.68, longitude: 128.72, icon: Mountain }
  ];
  const lessonLocations = activeTeacherSample?.sites ?? defaultLessonLocations;
  const availableModels = normalizeMetadataOptions(metadata, "models", cmip6ModelOptions);
  const availableScenarios = normalizeMetadataOptions(metadata, "scenarios", ["고배출 경로"]);
  const remoteState = useRemoteMetricResponse({
    coordinate: { latitude: lessonLocation.latitude, longitude: lessonLocation.longitude },
    date: lessonDate,
    scenario: lessonScenario,
    model: lessonModel,
    requestDatasetRefresh: datasetState.requestRefresh,
    datasetUpdatedAt: metadata?.datasetUpdatedAt,
    datasetVersion: metadata?.datasetVersion,
    refreshSequence: datasetState.refreshSequence
  });
  const hasCurrentDatasetResult = isCurrentPublicDatasetResult(remoteState.response, metadata, remoteState.status);
  const lessonMetrics = useMemo(
    () => deriveClimateMetrics({ date: lessonDate, raw: false, remoteState }),
    [lessonDate, remoteState]
  );
  const requiredTeacherMetricKeys = useMemo(
    () => activeTeacherSample
      ? [...new Set([...activeTeacherSample.variableKeys, ...activeTeacherSample.derivedKeys])]
      : [],
    [activeTeacherSample]
  );
  const teacherQueryStatus = useMemo(
    () => resolveTeacherQueryStatus(remoteState.status, lessonMetrics, requiredTeacherMetricKeys),
    [remoteState.status, lessonMetrics, requiredTeacherMetricKeys]
  );
  const currentSnapshot = useMemo(() => hasCurrentDatasetResult ? createMetricSnapshot(lessonMetrics, {
    date: lessonDate,
    latitude: lessonLocation.latitude,
    longitude: lessonLocation.longitude,
    scenario: lessonScenario,
    model: lessonModel,
    label: lessonLocation.label
  }) : void 0, [hasCurrentDatasetResult, lessonMetrics, lessonDate, lessonLocation.latitude, lessonLocation.longitude, lessonLocation.label, lessonScenario, lessonModel]);
  useLayoutEffect(() => {
    dispatchTeacherFlow({
      type: TEACHER_FLOW_ACTIONS.UPDATE_CONDITIONS,
      patch: {
        date: lessonDate,
        title: lessonTitle,
        objective: lessonObjective,
        location: lessonLocation,
        scenario: lessonScenario,
        model: lessonModel
      }
    });
    dispatchTeacherFlow({ type: TEACHER_FLOW_ACTIONS.CONFIRM_DATE, confirmed: true });
  }, [lessonDate, lessonTitle, lessonObjective, lessonLocation, lessonScenario, lessonModel]);
  useLayoutEffect(() => {
    dispatchTeacherFlow({
      type: TEACHER_FLOW_ACTIONS.SET_COMPARISON_MATERIALS,
      materials: comparisonPoints
    });
  }, [comparisonPoints]);
  useEffect(() => {
    setComparisonPoints([]);
    setStarted(false);
  }, [metadata?.datasetUpdatedAt, metadata?.datasetVersion]);
  useEffect(() => {
    dispatchTeacherFlow({
      type: TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS,
      status: teacherQueryStatus
    });
  }, [teacherQueryStatus]);
  useEffect(() => {
    teacherStepPanelRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
    teacherStepHeadingRef.current?.focus({ preventScroll: true });
  }, [teacherFlowState.currentStep]);
  const currentTeacherStep = teacherFlowState.currentStep;
  const isLessonSelection = currentTeacherStep === TEACHER_STEP_IDS.LESSON_SELECTION;
  const isLessonConditions = currentTeacherStep === TEACHER_STEP_IDS.LESSON_CONDITIONS;
  const isActivityComposition = currentTeacherStep === TEACHER_STEP_IDS.ACTIVITY_COMPOSITION;
  const isReviewAndShare = currentTeacherStep === TEACHER_STEP_IDS.REVIEW_AND_SHARE;
  const currentTeacherStepCopy = teacherStepCopy[currentTeacherStep];
  const teacherConditionValidation = validateTeacherLessonConditions(teacherFlowState);
  const teacherReviewValidation = validateTeacherReviewReadiness(teacherFlowState);
  const teacherConditionErrorFields = new Set(teacherConditionValidation.errors.map((error) => error.field));
  const lessonToken = useMemo(() => encodeLessonState({
    source: "teacher",
    date: lessonDate,
    latitude: lessonLocation.latitude,
    longitude: lessonLocation.longitude,
    scenario: lessonScenario,
    model: lessonModel,
    focus: lessonFocus,
    problemSetId: activeTeacherSample?.id,
    problemRevision: activeTeacherSample?.revision,
    periodStart: activeTeacherSample?.periodStart,
    periodEnd: activeTeacherSample?.periodEnd
  }), [lessonDate, lessonLocation.latitude, lessonLocation.longitude, lessonScenario, lessonModel, lessonFocus, activeTeacherSample]);
  const studentLink = useMemo(() => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = `/query?lesson=${lessonToken}`;
    return url.toString();
  }, [lessonToken]);
  useEffect(() => {
    if (!metadata) return;
    const models = normalizeMetadataOptions(metadata, "models", cmip6ModelOptions);
    const scenarios = normalizeMetadataOptions(metadata, "scenarios", ["고배출 경로"]);
    setLessonModel((current) => models.includes(current) ? current : models[0]);
    setLessonScenario((current) => scenarios.includes(current) ? current : scenarios[0]);
    if (metadata.dateStart && metadata.dateEnd) {
      setLessonDate((current) => clipPeriod(current, current, metadata.dateStart, metadata.dateEnd).start);
    }
  }, [metadata]);
  useEffect(() => {
    if (datasetState.status === "unavailable" && !metadata) {
      setTeacherMessage("자료 제공 범위를 확인하지 못했습니다. 현재 선택 조건으로 조회를 계속합니다.");
    }
  }, [datasetState.status, metadata]);
  useEffect(() => {
    if (remoteState.refreshNotice) setTeacherMessage(remoteState.refreshNotice);
  }, [remoteState.refreshNotice]);
  useEffect(() => {
    setSaveOutcome("idle");
    setShareOutcome("idle");
  }, [lessonDate, lessonLocation.latitude, lessonLocation.longitude, lessonScenario, lessonModel]);
  const selectLessonLocation = (location) => {
    setLessonLocation(location);
    setTeacherMessage(`${location.label} 위치의 기후 모델 자료를 불러옵니다.`);
  };
  const applyTeacherSample = (sample) => {
    setActiveTeacherSampleId(sample.id);
    setLessonTitle(sample.title);
    setLessonObjective(sample.objective);
    setLessonLocation(sample.location);
    setLessonDate(sample.date);
    setLessonScenario(sample.scenario);
    setLessonModel(sample.model);
    setLessonFocus(sample.focus);
    setComparisonPoints([]);
    setStarted(false);
    dispatchTeacherFlow({
      type: TEACHER_FLOW_ACTIONS.SELECT_LESSON,
      lessonId: sample.id,
      requirements: sample.evidenceRequirements
    });
    dispatchTeacherFlow({ type: TEACHER_FLOW_ACTIONS.NEXT });
    setTeacherMessage("실제 기후 자료로 확인한 수업 문제를 불러왔습니다. 첫 번째 위치의 자료를 확인한 뒤 첫 번째 비교 자료로 정하세요.");
  };
  const selectTeacherMapCoordinate = (coordinate) => {
    setLessonLocation({ id: "custom", label: "직접 선택", detail: "지도에서 선택", ...coordinate, icon: LocateFixed });
    setTeacherMessage("지도에서 고른 위치의 기후 모델 자료를 불러옵니다.");
  };
  const addComparisonPoint = () => {
    if (!currentSnapshot || !started) return;
    setComparisonPoints((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== currentSnapshot.id);
      if (withoutDuplicate.length >= comparisonLimit) {
        setTeacherMessage(`비교 목록에는 ${comparisonLimit}개까지 저장할 수 있습니다. 항목을 하나 삭제한 뒤 다시 추가하세요.`);
        return current;
      }
      setTeacherMessage(`${currentSnapshot.label}의 기후 모델 자료를 비교 목록에 추가했습니다.`);
      return [...withoutDuplicate, currentSnapshot];
    });
  };
  const startTeacherActivity = () => {
    if (!currentSnapshot) return;
    setStarted(true);
    setComparisonPoints((current) => current.some((item) => item.id === currentSnapshot.id) ? current : [currentSnapshot, ...current].slice(0, comparisonLimit));
      setTeacherMessage(`첫 번째 비교 자료는 ${lessonLocation.label}입니다. 이제 위치, 날짜 또는 기후 모델을 바꾸어 다른 자료를 추가하세요.`);
  };
  const copyStudentLink = async () => {
    const copied = await copyTextToClipboard(studentLink);
    setShareOutcome(copied ? "copied" : "failed");
    setTeacherMessage(copied ? "현재 수업 조건이 담긴 학생용 링크를 복사했습니다." : "링크를 복사하지 못했습니다. 학생 화면 열기를 사용하세요.");
  };
  const openStudentLesson = () => {
    window.location.hash = `/query?lesson=${lessonToken}`;
  };
  const saveTeacherPack = async () => {
    if (!currentSnapshot) return;
    const snapshots = comparisonPoints.length > 0 ? comparisonPoints : [currentSnapshot];
    try {
      const { buildTeacherActivityDocx } = await import("./student-docx.js");
      const blob = await buildTeacherActivityDocx({
        lessonTitle,
        objective: lessonObjective,
        snapshots,
        studentLink,
        inquiryQuestion: activeTeacherSample?.question,
        comparisonPeriods: activeTeacherSample?.comparisonPeriods,
        hypothesisChoices: activeTeacherSample?.conclusionOptions,
        periodStart: activeTeacherSample?.periodStart,
        periodEnd: activeTeacherSample?.periodEnd,
        expectedOutputs: activeTeacherSample?.output,
        assessmentCriteria: activeTeacherSample?.assessmentCriteria,
        interpretationLimit: activeTeacherSample?.guardrail,
        problem: activeTeacherSample?.problem
      });
      const target = await requestSaveTarget({
        filename: "climate-class-activity.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        extension: ".docx",
        description: "교사용 기후 탐구 활동지(DOCX)"
      });
      const result = await saveBlobToTarget(target, blob);
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
      expectedDataMode: remoteState.response?.dataMode,
      initialMetrics: activeTeacherSample ? [...activeTeacherSample.variableKeys, ...activeTeacherSample.derivedKeys] : currentSnapshot.values.map((metric) => metric.key),
      includeRaw: false,
      initialStartDate: activeTeacherSample?.periodStart,
      initialEndDate: activeTeacherSample?.periodEnd,
      derivedKeys: activeTeacherSample?.derivedKeys,
      seasonMonths: commonSeasonMonths(activeTeacherSample?.problem),
      exploration: problemExploration(activeTeacherSample?.problem)
    });
  };
  const openTeacherPeriod = (period) => {
    if (!activeTeacherSample) return;
    setExportContext({
      date: period.start,
      latitude: lessonLocation.latitude,
      longitude: lessonLocation.longitude,
      scenario: lessonScenario,
      model: lessonModel,
      expectedDataMode: remoteState.response?.dataMode,
      initialMetrics: [...activeTeacherSample.variableKeys, ...activeTeacherSample.derivedKeys],
      includeRaw: false,
      initialStartDate: period.start,
      initialEndDate: period.end,
      derivedKeys: activeTeacherSample.derivedKeys,
      seasonMonths: period.seasonMonths,
      exploration: problemExploration(activeTeacherSample.problem)
    });
  };
  const nextTeacherStep = !currentSnapshot
    ? { label: "기후 모델 자료 확인", body: "선택한 위치와 날짜의 기후 자료를 불러오는 중입니다." }
    : !started
      ? { label: "첫 번째 비교 자료 정하기", body: "현재 위치·날짜·기후 모델의 값을 첫 번째 자료로 정한 뒤, 조건을 바꾸어 다른 자료를 추가하세요." }
      : comparisonSiteCount < requiredEvidence.minimumSites
        ? { label: "다른 지역 자료 추가", body: `위치를 바꾸어 서로 다른 지역의 자료를 ${requiredEvidence.minimumSites}개 이상 비교 목록에 추가하세요.` }
        : comparisonModelCount < requiredEvidence.minimumModels
          ? { label: "다른 기후 모델과 비교", body: `기후 모델을 바꾸어 ${requiredEvidence.minimumModels}개 이상 비교하세요. 자료가 없는 기후 모델은 그 사실을 그대로 기록하세요.` }
        : !hasRequiredEnsemble
            ? { label: "여러 모델 종합값 함께 확인", body: "기후 모델에서 여러 모델 종합값을 선택해 비교 목록에 추가하세요." }
        : shareOutcome !== "copied"
          ? { label: "학생과 공유", body: "학생 화면을 미리 확인하고 현재 수업 조건이 담긴 링크를 공유하세요." }
          : { label: "활동지와 자료 준비", body: "비교 목록과 기후 모델 값을 확인한 뒤 수업 활동지 또는 기간 자료를 저장하세요." };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "teacher-page", ref: teacherStepPanelRef, children: [
    /* @__PURE__ */ jsx(TeacherStepProgress, { state: teacherFlowState }),
    /* @__PURE__ */ jsxs("header", { className: "teacher-step-heading", children: [
      /* @__PURE__ */ jsx("span", { children: currentTeacherStepCopy.eyebrow }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h2", { id: "teacher-current-step-title", ref: teacherStepHeadingRef, tabIndex: -1, children: currentTeacherStepCopy.title }),
        /* @__PURE__ */ jsx("p", { children: currentTeacherStepCopy.description })
      ] })
    ] }),
    isLessonSelection ? /* @__PURE__ */ jsxs("section", { className: "teacher-sample-library teacher-step-content", "aria-labelledby": "teacher-sample-title", children: [
      /* @__PURE__ */ jsxs("div", { className: "teacher-sample-library-heading", children: [
        /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(BookOpen, { size: 19 }) }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h2", { id: "teacher-sample-title", children: "실제 기후 자료로 만드는 탐구 수업" }),
          /* @__PURE__ */ jsx("p", { children: "자료에서 확인한 위치, 기간, 기후 지표를 수업 조건과 학생 화면에 함께 적용합니다." }),
          /* @__PURE__ */ jsx(ProblemCategoryControl, { label: "교사용 문제 주제", onChange: setTeacherProblemCategory, value: teacherProblemCategory })
        ] })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "teacher-sample-list", children: visibleTeacherSamples.map((sample) => /* @__PURE__ */ jsxs("article", { className: activeTeacherSampleId === sample.id ? "active" : "", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { className: "teacher-sample-label", children: sample.label }),
          /* @__PURE__ */ jsx("h3", { children: sample.title }),
          /* @__PURE__ */ jsx("p", { children: sample.question }),
          /* @__PURE__ */ jsxs("div", { className: "teacher-sample-meta", children: [
            /* @__PURE__ */ jsxs("span", { children: [sample.periodStart, " ~ ", sample.periodEnd] }),
            /* @__PURE__ */ jsxs("span", { children: [sample.sites.length, "개 비교 지점"] }),
            /* @__PURE__ */ jsx("span", { children: sample.problem.presentation.tags.join(" · ") })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("button", { "aria-pressed": activeTeacherSampleId === sample.id, onClick: () => applyTeacherSample(sample), type: "button", children: [
          /* @__PURE__ */ jsx(PlayCircle, { size: 17 }),
          activeTeacherSampleId === sample.id ? "수업 적용됨" : "이 문제로 수업 만들기"
        ] })
      ] }, sample.id)) })
    ] }) : null,
    !isLessonSelection ? /* @__PURE__ */ jsxs("div", { className: `teacher-layout teacher-step-content${isReviewAndShare ? " review" : ""}`, children: [
      !isReviewAndShare ? /* @__PURE__ */ jsxs("section", { className: "teacher-map-column", children: [
        /* @__PURE__ */ jsx(MapPanel, { compact: false, date: lessonDate, latitude: lessonLocation.latitude, longitude: lessonLocation.longitude, mapTone: lessonFocus === "rain" || lessonLocation.id === "coast" ? "rain" : "school", rawModelGrid: remoteState.response?.dataMode === "raw-model-grid", onCoordinateChange: selectTeacherMapCoordinate }),
        /* @__PURE__ */ jsxs("div", { className: "teacher-map-note", children: [
          /* @__PURE__ */ jsx("span", { className: "teacher-note-icon", children: /* @__PURE__ */ jsx(lessonLocation.icon, { size: 18 }) }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("strong", { children: [lessonLocation.label, " 수업 지점"] }),
            /* @__PURE__ */ jsxs("p", { children: [formatCoordinatePair(lessonLocation.latitude, lessonLocation.longitude), " · 지도를 눌러 직접 바꿀 수 있습니다."] })
          ] })
        ] })
      ] }) : null,
      /* @__PURE__ */ jsxs("aside", { className: "teacher-control-panel", children: [
        /* @__PURE__ */ jsxs("div", { className: "teacher-panel-title", children: [
          /* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(GraduationCap, { size: 19 }) }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h2", { children: isLessonConditions ? "수업 조건" : isActivityComposition ? "비교 자료 구성" : "수업 준비 확인" }),
            /* @__PURE__ */ jsx("p", { children: isLessonConditions ? "학습 목표와 조회 조건을 확인합니다." : isActivityComposition ? "위치·날짜·기후 모델을 바꾸어 필수 근거를 모읍니다." : "학생과 공유하기 전에 수업 내용과 자료를 확인합니다." })
          ] })
        ] }),
        isActivityComposition ? /* @__PURE__ */ jsxs("section", { className: "teacher-next-step", "aria-live": "polite", children: [
          /* @__PURE__ */ jsx("span", { children: "다음 할 일" }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("strong", { children: nextTeacherStep.label }),
            /* @__PURE__ */ jsx("p", { children: nextTeacherStep.body })
          ] })
        ] }) : null,
        /* @__PURE__ */ jsxs("label", { className: "teacher-text-field", hidden: !isLessonConditions, children: [
          "수업명",
          /* @__PURE__ */ jsx("input", { "aria-invalid": teacherConditionErrorFields.has("title"), maxLength: 120, onChange: (event) => setLessonTitle(event.target.value), value: lessonTitle })
        ] }),
        /* @__PURE__ */ jsxs("label", { className: "teacher-text-field", hidden: !isLessonConditions, children: [
          "학습 목표",
          /* @__PURE__ */ jsx("textarea", { "aria-invalid": teacherConditionErrorFields.has("objective"), maxLength: 300, onChange: (event) => setLessonObjective(event.target.value), value: lessonObjective })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "lesson-location-options", hidden: isReviewAndShare, role: "group", "aria-label": "수업 위치 선택", children: lessonLocations.map((location) => {
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
        !isReviewAndShare ? /* @__PURE__ */ jsx(DateField, { label: "살펴볼 날짜", min: metadata?.dateStart, max: metadata?.dateEnd, onChange: setLessonDate, value: lessonDate }) : null,
        /* @__PURE__ */ jsxs("div", { className: "teacher-select-grid", hidden: isReviewAndShare, children: [
          /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
            "배출 경로",
            /* @__PURE__ */ jsx("select", { "aria-invalid": teacherConditionErrorFields.has("scenario"), onChange: (event) => setLessonScenario(event.target.value), value: lessonScenario, children: availableScenarios.map((option) => /* @__PURE__ */ jsx("option", { children: option }, option)) })
          ] }),
          /* @__PURE__ */ jsxs("label", { className: "select-field", children: [
            "기후 모델",
            /* @__PURE__ */ jsx("select", { "aria-invalid": teacherConditionErrorFields.has("model"), onChange: (event) => setLessonModel(event.target.value), value: lessonModel, children: availableModels.map((option) => /* @__PURE__ */ jsx("option", { children: option }, option)) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "teacher-condition-grid", hidden: isReviewAndShare, children: [
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "자료 상태" }), /* @__PURE__ */ jsx("strong", { children: teacherDataStatusLabel(teacherQueryStatus) })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "비교 목록" }), /* @__PURE__ */ jsxs("strong", { children: [comparisonPoints.length, "/", comparisonLimit, "개 자료"] })] })
        ] }),
        isLessonConditions ? /* @__PURE__ */ jsx(TeacherValidationSummary, {
          messages: teacherConditionValidation.errors.map((error) => error.message),
          successMessage: "활동 구성 단계로 이동할 수 있습니다."
        }) : null,
        isActivityComposition ? /* @__PURE__ */ jsx(TeacherValidationSummary, {
          messages: teacherReviewValidation.errors.map((error) => error.message),
          successMessage: "확인 및 공유 단계로 이동할 수 있습니다."
        }) : null,
        isReviewAndShare ? /* @__PURE__ */ jsxs("section", { className: "teacher-review-brief", "aria-label": "수업 조건 확인", children: [
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "수업명" }), /* @__PURE__ */ jsx("strong", { children: lessonTitle })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "학습 목표" }), /* @__PURE__ */ jsx("strong", { children: lessonObjective })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "위치와 날짜" }), /* @__PURE__ */ jsxs("strong", { children: [lessonLocation.label, " · ", lessonDate] })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "배출 경로와 기후 모델" }), /* @__PURE__ */ jsxs("strong", { children: [lessonScenario, " · ", lessonModel] })] }),
          /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("span", { children: "비교 근거" }), /* @__PURE__ */ jsx("strong", { children: `${comparisonPoints.length}개 자료 · 지역 ${comparisonSiteCount}곳 · 기후 모델 ${comparisonModelCount}개` })] })
        ] }) : null,
        isReviewAndShare ? /* @__PURE__ */ jsxs("section", { className: "teacher-review-comparisons", "aria-labelledby": "teacher-review-comparisons-title", children: [
          /* @__PURE__ */ jsx("h3", { id: "teacher-review-comparisons-title", children: "수업에 사용할 비교 자료" }),
          /* @__PURE__ */ jsx("ol", { children: comparisonPoints.map((point) => /* @__PURE__ */ jsxs("li", { children: [
            /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("strong", { children: point.label }), /* @__PURE__ */ jsxs("small", { children: [point.date, " · ", formatCoordinatePair(point.latitude, point.longitude)] })] }),
            /* @__PURE__ */ jsx("span", { children: point.model })
          ] }, point.id)) })
        ] }) : null,
        isActivityComposition ? /* @__PURE__ */ jsxs("button", { className: "teacher-start-action", disabled: !currentSnapshot || teacherQueryStatus !== TEACHER_QUERY_STATUSES.READY, onClick: startTeacherActivity, type: "button", children: [
          /* @__PURE__ */ jsx(PlayCircle, { size: 18 }),
          /* @__PURE__ */ jsx("span", { children: started ? "첫 번째 비교 자료 선택 완료" : "현재 자료를 첫 번째 비교 자료로 정하기" }),
          /* @__PURE__ */ jsx(ArrowRight, { size: 17 })
        ] }) : null,
        isReviewAndShare ? /* @__PURE__ */ jsxs("div", { className: "teacher-action-groups", children: [
          /* @__PURE__ */ jsxs("section", { className: "teacher-action-group", children: [
            /* @__PURE__ */ jsxs("div", { className: "teacher-action-heading", children: [/* @__PURE__ */ jsx("strong", { children: "학생과 공유" }), /* @__PURE__ */ jsx("small", { children: "현재 자료를 시작점으로 학생이 위치와 날짜를 바꾸며 탐구합니다." })] }),
            /* @__PURE__ */ jsxs("div", { className: "teacher-actions", children: [
              /* @__PURE__ */ jsxs("button", { disabled: !started, type: "button", onClick: openStudentLesson, children: [/* @__PURE__ */ jsx(Link, { size: 16 }), "학생 화면 열기"] }),
              /* @__PURE__ */ jsxs("button", { disabled: !started, type: "button", onClick: copyStudentLink, children: [/* @__PURE__ */ jsx(ClipboardCopy, { size: 16 }), shareOutcome === "copied" ? "학생용 링크 복사 완료" : "학생용 링크 복사"] })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("section", { className: "teacher-action-group", children: [
            /* @__PURE__ */ jsxs("div", { className: "teacher-action-heading", children: [/* @__PURE__ */ jsx("strong", { children: "비교하고 정리하기" }), /* @__PURE__ */ jsx("small", { children: "위치·날짜·기후 모델이 다른 자료를 비교해 활동지나 기간 자료로 정리합니다." })] }),
            /* @__PURE__ */ jsxs("div", { className: "teacher-actions", children: [
              /* @__PURE__ */ jsxs("button", { disabled: !started || !currentSnapshot, type: "button", onClick: addComparisonPoint, children: [/* @__PURE__ */ jsx(Plus, { size: 16 }), "현재 자료를 비교 목록에 추가"] }),
              /* @__PURE__ */ jsxs("button", { type: "button", disabled: !currentSnapshot, onClick: exportTeacherData, children: [/* @__PURE__ */ jsx(HardDriveDownload, { size: 16 }), "수업 자료 내보내기"] }),
              /* @__PURE__ */ jsxs("button", { type: "button", disabled: !started || !currentSnapshot, onClick: saveTeacherPack, children: [/* @__PURE__ */ jsx(Download, { size: 16 }), "수업 활동지 저장"] })
            ] })
          ] })
        ] }) : null,
        /* @__PURE__ */ jsx("div", { className: currentSnapshot ? "mini-status ok" : "mini-status warn", "aria-live": "polite", children: currentSnapshot ? teacherMessage : remoteState.message })
      ] })
    ] }) : null,
    isActivityComposition ? /* @__PURE__ */ jsxs("section", { className: "teacher-inquiry-flow", "aria-label": "기후 자료 탐구 수업 흐름", children: [
      /* @__PURE__ */ jsxs("article", { children: [/* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(Target, { size: 18 }) }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: "1. 가설 세우기" }), /* @__PURE__ */ jsx("p", { children: activeTeacherSample?.question ?? "우리 학교와 다른 지역은 같은 날짜에 어떤 차이가 있을까요?" })] })] }),
      /* @__PURE__ */ jsxs("article", { children: [/* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(Activity, { size: 18 }) }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: "2. 자료로 비교하기" }), /* @__PURE__ */ jsx("p", { children: activeTeacherSample ? `${activeTeacherSample.periodStart}부터 ${activeTeacherSample.periodEnd}까지 ${activeTeacherSample.problem.roles.student.prompt}` : `현재 ${comparisonPoints.length}/${comparisonLimit}개 자료가 비교 목록에 있습니다. 위치·날짜·기후 모델을 바꾸어 근거를 모으세요.` })] })] }),
      /* @__PURE__ */ jsxs("article", { children: [/* @__PURE__ */ jsx("span", { children: /* @__PURE__ */ jsx(TriangleAlert, { size: 18 }) }), /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: "3. 근거와 한계를 함께 정리하기" }), /* @__PURE__ */ jsx("p", { children: activeTeacherSample?.guardrail ?? "이 자료는 특정 날짜의 일기예보가 아니라 선택한 조건에 따른 기후 시나리오 결과입니다. 모델과 자료의 한계를 함께 설명하세요." })] })] })
    ] }) : null,
    isActivityComposition ? /* @__PURE__ */ jsx(TeacherLessonBlueprint, { onOpenPeriod: openTeacherPeriod, sample: activeTeacherSample }) : null,
    isActivityComposition ? /* @__PURE__ */ jsxs("section", { className: "teacher-data-workbench", children: [
      /* @__PURE__ */ jsxs("div", { className: "panel-heading-row", children: [
        /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("h2", { children: "수업에 사용할 기후 모델 자료" }), /* @__PURE__ */ jsx("p", { children: "선택한 위치, 날짜, 배출 경로, 기후 모델에 해당하는 값을 보여 줍니다." })] }),
        /* @__PURE__ */ jsxs("button", { className: "secondary-action", disabled: !started || !currentSnapshot, onClick: addComparisonPoint, type: "button", children: [/* @__PURE__ */ jsx(BookmarkPlus, { size: 16 }), "비교 목록에 추가"] })
      ] }),
      /* @__PURE__ */ jsx(MetricGrid, { items: lessonMetrics }),
      comparisonPoints.length > 0 ? /* @__PURE__ */ jsx("div", { className: "teacher-comparison-list", children: comparisonPoints.map((point) => /* @__PURE__ */ jsxs("article", { children: [
        /* @__PURE__ */ jsxs("div", { children: [/* @__PURE__ */ jsx("strong", { children: point.label }), /* @__PURE__ */ jsxs("span", { children: [point.date, " · ", formatCoordinatePair(point.latitude, point.longitude)] }), /* @__PURE__ */ jsxs("span", { children: [point.scenario, " · ", point.model] }), /* @__PURE__ */ jsx("small", { children: point.values.slice(0, 3).map((metric) => `${metric.label} ${formatPublicMetricValue({ key: metric.key, numericValue: metric.value, unit: metric.unit })}`).join(" · ") })] }),
        /* @__PURE__ */ jsx("button", { "aria-label": `${point.label} 비교 지점 삭제`, onClick: () => setComparisonPoints((current) => current.filter((item) => item.id !== point.id)), type: "button", children: /* @__PURE__ */ jsx(Trash2, { size: 16 }) })
      ] }, point.id)) }) : /* @__PURE__ */ jsx("p", { className: "teacher-empty-comparison", children: `서로 다른 위치·날짜·기후 모델의 값을 최대 ${comparisonLimit}개까지 비교 목록에 추가할 수 있습니다.` })
    ] }) : null,
    isReviewAndShare ? /* @__PURE__ */ jsxs("section", { className: "teacher-summary", "aria-label": "수업 준비 상태", children: [
      /* @__PURE__ */ jsx(Stat, { label: "활동 상태", value: evidenceReady ? "근거 준비 완료" : started ? "진행 중" : "준비", sub: evidenceReady ? "필수 비교 조건 충족" : started ? "기후 값 비교 가능" : "비교 자료 선택" }),
      /* @__PURE__ */ jsx(Stat, { label: "선택 지점", value: lessonLocation.label, sub: lessonLocation.detail ?? "지도에서 선택" }),
      /* @__PURE__ */ jsx(Stat, { label: "월별 체감 기준", value: apparentTemperatureBasis(lessonDate).label, sub: `${Number(lessonDate.slice(5, 7))}월 조회` }),
      /* @__PURE__ */ jsx(Stat, { label: "수업 자료", value: saveOutcome === "written" ? "저장 완료" : saveOutcome === "requested" ? "파일 저장 시작" : "대기", sub: "기후 모델 값과 조건 포함" })
    ] }) : null,
    /* @__PURE__ */ jsx(TeacherStepNavigation, {
      state: teacherFlowState,
      onPrevious: () => dispatchTeacherFlow({ type: TEACHER_FLOW_ACTIONS.PREVIOUS }),
      onNext: () => dispatchTeacherFlow({ type: TEACHER_FLOW_ACTIONS.NEXT })
    })
    ] }),
    /* @__PURE__ */ jsx(ClimateExportDialog, { context: exportContext, datasetState, onClose: () => setExportContext(null) }),
    remoteState.status === "loading" ? /* @__PURE__ */ jsx(ClimateLoadingOverlay, { onCancel: remoteState.cancel }) : null
  ] });
}
function PublicPage({ datasetState }) {
  const [coordinates, setCoordinates] = useState({ latitude: 36.35, longitude: 127.38 });
  const [message, setMessage] = useState("지도를 누르거나 학생 탐색에서 자세한 조건을 바꿀 수 있습니다.");
  const [exportContext, setExportContext] = useState(null);
  const metadata = datasetState.metadata;
  const [publicDate, setPublicDate] = useState("2050-08-01");
  const [publicScenario, setPublicScenario] = useState("고배출 경로");
  const [publicModel, setPublicModel] = useState(cmip6ModelOptions[0]);
  const [locating, setLocating] = useState(false);
  const availableScenarios = normalizeMetadataOptions(metadata, "scenarios", ["고배출 경로"]);
  const availableModels = normalizeMetadataOptions(metadata, "models", cmip6ModelOptions);
  const remoteState = useRemoteMetricResponse({
    coordinate: coordinates,
    date: publicDate,
    scenario: publicScenario,
    model: publicModel,
    requestDatasetRefresh: datasetState.requestRefresh,
    datasetUpdatedAt: metadata?.datasetUpdatedAt,
    datasetVersion: metadata?.datasetVersion,
    refreshSequence: datasetState.refreshSequence
  });
  const usesRawModelGrid = remoteState.response?.dataMode === "raw-model-grid";
  const hasCurrentDatasetResult = isCurrentPublicDatasetResult(remoteState.response, metadata, remoteState.status);
  const publicMetrics = useMemo(
    () => simplifyPublicMetrics(deriveClimateMetrics({ date: publicDate, raw: false, remoteState })),
    [remoteState]
  );
  const hasPublicMetrics = hasCurrentDatasetResult
    && publicMetrics.some((metric) => metric.available !== false && Number.isFinite(metric.numericValue));
  const plainLanguageSummary = buildPlainLanguageSummary(publicMetrics, publicDate);
  const dateYear = Number(publicDate.slice(0, 4));
  const dateMonthDay = publicDate.slice(4);
  const decadeOptions = [2040, 2050, 2070, 2090].filter((year) => {
    const candidate = `${year}${dateMonthDay}`;
    return (!metadata?.dateStart || candidate >= metadata.dateStart) && (!metadata?.dateEnd || candidate <= metadata.dateEnd);
  });
  useEffect(() => {
    if (!metadata) return;
    const models = normalizeMetadataOptions(metadata, "models", cmip6ModelOptions);
    const scenarios = normalizeMetadataOptions(metadata, "scenarios", ["고배출 경로"]);
    setPublicModel((current) => models.includes(current) ? current : models.includes("전체 앙상블") ? "전체 앙상블" : models[0]);
    setPublicScenario((current) => scenarios.includes(current) ? current : scenarios[0]);
    if (metadata.dateStart && metadata.dateEnd) {
      setPublicDate((current) => clipPeriod(current, current, metadata.dateStart, metadata.dateEnd).start);
    }
  }, [metadata]);
  useEffect(() => {
    if (datasetState.status === "unavailable" && !metadata) {
      setMessage("자료 제공 기간을 확인하지 못했습니다. 현재 선택 날짜로 조회를 계속합니다.");
    }
  }, [datasetState.status, metadata]);
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
      setMessage("현재 위치로 이동했습니다. 실제 기후 자료를 다시 불러옵니다.");
    }, () => {
      setLocating(false);
      setMessage("현재 위치 권한을 사용할 수 없습니다. 지도에서 직접 위치를 선택하세요.");
    }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
  };
  const changePublicYear = (year) => {
    const candidate = `${year}${dateMonthDay}`;
    const clipped = metadata?.dateStart && metadata?.dateEnd ? clipPeriod(candidate, candidate, metadata.dateStart, metadata.dateEnd).start : candidate;
    setPublicDate(clipped);
    setMessage(`${year}년의 실제 기후 자료를 불러옵니다.`);
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
    if (!hasCurrentDatasetResult) {
      setMessage("최신 기후자료 조회가 끝난 뒤 기간 자료를 내보낼 수 있습니다.");
      return;
    }
    setExportContext({
      date: publicDate,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario: publicScenario,
      model: publicModel,
      expectedDataMode: remoteState.response?.dataMode,
      initialMetrics: [metric.key],
      includeRaw: false
    });
  };
  const exportPublicMetrics = () => {
    if (!hasCurrentDatasetResult) {
      setMessage("최신 기후자료 조회가 끝난 뒤 기간 자료를 내보낼 수 있습니다.");
      return;
    }
    const initialMetrics = publicMetrics.filter((metric) => metric.key && metric.available !== false && Number.isFinite(metric.numericValue)).map((metric) => metric.key);
    setExportContext({
      date: publicDate,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario: publicScenario,
      model: publicModel,
      expectedDataMode: remoteState.response?.dataMode,
      initialMetrics,
      includeRaw: false
    });
  };
  const savePublicSummary = () => {
    if (!hasCurrentDatasetResult) {
      setMessage("최신 기후자료 조회가 끝난 뒤 결과 이미지를 저장할 수 있습니다.");
      return;
    }
    setExportContext({
      date: publicDate,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      scenario: publicScenario,
      model: publicModel,
      expectedDataMode: remoteState.response?.dataMode,
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
            /* @__PURE__ */ jsx("strong", { children: formatCoordinatePair(coordinates.latitude, coordinates.longitude) })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "public-condition-strip", children: [
          /* @__PURE__ */ jsxs("div", { className: "public-date-control", children: [/* @__PURE__ */ jsx(CalendarDays, { size: 15 }), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("small", { children: "살펴볼 날짜" }), /* @__PURE__ */ jsx(ConfirmedDateInput, { compact: true, label: "살펴볼 날짜", max: metadata?.dateEnd, min: metadata?.dateStart, onConfirm: (nextDate) => {
            setPublicDate(nextDate);
            setMessage(`${nextDate}의 실제 기후 자료를 불러옵니다.`);
          }, showPickerButton: false, value: publicDate })] })] }),
          /* @__PURE__ */ jsxs("label", { className: "public-scenario-control", children: [/* @__PURE__ */ jsx(Globe2, { size: 15 }), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("small", { children: "배출 경로" }), /* @__PURE__ */ jsx("select", { onChange: (event) => setPublicScenario(event.target.value), value: publicScenario, children: availableScenarios.map((option) => /* @__PURE__ */ jsx("option", { children: option }, option)) })] })] }),
          /* @__PURE__ */ jsxs("label", { className: "public-model-control", children: [/* @__PURE__ */ jsx(Activity, { size: 15 }), /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx("small", { children: "기후 모델" }), /* @__PURE__ */ jsx("select", { "aria-label": "기후 모델", onChange: (event) => {
            setPublicModel(event.target.value);
            setMessage(`${event.target.value} 모델의 실제 기후 자료를 불러옵니다.`);
          }, value: publicModel, children: availableModels.map((option) => /* @__PURE__ */ jsx("option", { children: option === "전체 앙상블" ? "여러 모델 종합값(앙상블)" : option }, option)) })] })] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "public-command-actions", children: [
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: openPublicDetail, children: [/* @__PURE__ */ jsx(Search, { size: 16 }), "자세히 보기"] }),
          /* @__PURE__ */ jsxs("button", { disabled: locating, type: "button", onClick: moveToCurrentLocation, children: [locating ? /* @__PURE__ */ jsx(LoaderCircle, { className: "spin", size: 16 }) : /* @__PURE__ */ jsx(Navigation, { size: 16 }), locating ? "위치 확인 중" : "내 위치"] }),
          /* @__PURE__ */ jsxs("button", { type: "button", onClick: () => {
            setCoordinates({ latitude: 37.57, longitude: 126.98 });
            setMessage("학교 주변 예시로 위치와 요약을 바꿨습니다.");
          }, children: [/* @__PURE__ */ jsx(School, { size: 16 }), "학교 예시"] })
        ] }),
        decadeOptions.length > 1 ? /* @__PURE__ */ jsxs("div", { className: "public-decade-picker", children: [
          /* @__PURE__ */ jsxs("span", { children: [/* @__PURE__ */ jsx(RefreshCw, { size: 15 }), "시기 바꾸기"] }),
          /* @__PURE__ */ jsx("div", { role: "group", "aria-label": "조회 연도", children: decadeOptions.map((year) => /* @__PURE__ */ jsxs("button", { "aria-pressed": dateYear === year, className: dateYear === year ? "active" : "", onClick: () => changePublicYear(year), type: "button", children: [year, "년"] }, year)) })
        ] }) : null
      ] }),
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
        /* @__PURE__ */ jsx(MetricGrid, { items: publicMetrics, onExportMetric: hasCurrentDatasetResult ? exportPublicMetric : undefined }),
        /* @__PURE__ */ jsxs("div", { className: "public-results-footer", children: [
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("strong", { children: "현재 화면" }),
            /* @__PURE__ */ jsx("span", { children: message })
          ] }),
          /* @__PURE__ */ jsxs("button", { disabled: !hasPublicMetrics, onClick: savePublicSummary, type: "button", children: [/* @__PURE__ */ jsx(Image, { size: 16 }), "결과 이미지 저장"] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx(ClimateExportDialog, { context: exportContext, datasetState, onClose: () => setExportContext(null) }),
    remoteState.status === "loading" ? /* @__PURE__ */ jsx(ClimateLoadingOverlay, { onCancel: remoteState.cancel }) : null
  ] });
}
function useRemoteMetricResponse({
  coordinate,
  date,
  scenario,
  model,
  requestDatasetRefresh,
  datasetUpdatedAt,
  datasetVersion,
  refreshSequence
}) {
  const conditionKey = useMemo(
    () => JSON.stringify([coordinate.latitude, coordinate.longitude, date, scenario, model]),
    [coordinate.latitude, coordinate.longitude, date, scenario, model]
  );
  const request = useMemo(
    () => buildUiRemoteChunkRequest({ coordinate, date, scenario, model, datasetVersion }),
    [coordinate.latitude, coordinate.longitude, date, scenario, model, datasetVersion]
  );
  const [state, setState] = useState({
    conditionKey,
    status: "loading",
    message: "실제 기후 자료를 불러오고 있습니다."
  });
  const controllerRef = useRef();
  const cancelledConditionRef = useRef();
  const completedRefreshSequenceRef = useRef(refreshSequence);
  const observedDatasetVersionRef = useRef(datasetVersion);
  useEffect(() => {
    if (cancelledConditionRef.current && cancelledConditionRef.current !== conditionKey) {
      cancelledConditionRef.current = void 0;
    }
    if (cancelledConditionRef.current === conditionKey) return;
    if (!datasetVersion || !datasetUpdatedAt) {
      setState((current) => ({
        ...(current.conditionKey === conditionKey && current.response ? { response: current.response } : {}),
        conditionKey,
        status: "loading",
        message: "최신 기후자료의 기준을 확인하고 있습니다."
      }));
      return;
    }
    let active = true;
    const controller = new AbortController();
    const datasetRefresh = refreshSequence > completedRefreshSequenceRef.current;
    const versionTransition = observedDatasetVersionRef.current !== datasetVersion;
    const retainForVersionTransition = datasetRefresh || Boolean(datasetVersion && versionTransition);
    observedDatasetVersionRef.current = datasetVersion;
    const loadingRefreshNotice = datasetRefresh ? "새 기후자료를 확인해 현재 조건의 결과를 다시 불러오고 있습니다." : void 0;
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setState((current) => {
      const retainResponse = retainForVersionTransition && current.conditionKey === conditionKey && current.response;
      return {
        ...(retainResponse ? { response: current.response } : {}),
        conditionKey,
        retainingResponse: Boolean(retainResponse),
        status: "loading",
        message: loadingRefreshNotice ?? "실제 기후 자료를 불러오고 있습니다.",
        ...(loadingRefreshNotice ? { refreshNotice: loadingRefreshNotice } : {})
      };
    });
    const timer = window.setTimeout(() => {
      fetchPublicClimateQuery(request, { signal: controller.signal }).then((payload) => {
        if (!active) return;
        const response = responseIfRequestMatches(payload, request, datasetUpdatedAt);
        if (!response) {
          return requestDatasetRefresh({ force: true }).then((nextMetadata) => {
            if (!active || cancelledConditionRef.current === conditionKey) return;
            if (isPublicDatasetIdentityChange({ datasetVersion, datasetUpdatedAt }, nextMetadata)) {
              setState((current) => ({
                ...(current.conditionKey === conditionKey && current.response ? { response: current.response } : {}),
                conditionKey,
                status: "loading",
                message: "기후자료가 갱신되어 같은 조건의 결과를 다시 불러오고 있습니다.",
                refreshNotice: "기후자료가 갱신되어 같은 조건의 결과를 다시 불러오고 있습니다."
              }));
              return;
            }
            throw new Error("불러온 자료가 현재 선택한 조건과 다릅니다. 다시 시도하세요.");
          });
        }
        completedRefreshSequenceRef.current = Math.max(completedRefreshSequenceRef.current, refreshSequence);
        const status = response.coverage === "available" ? "ready" : response.coverage === "fallback" ? "partial" : "missing";
        const coverageMessage = response.coverage === "available"
          ? "선택한 조건에 해당하는 실제 기후 자료를 불러왔습니다."
          : response.coverage === "fallback"
            ? toAudienceClimateCopy(response.fallbackReason, "일부 지표의 자료가 없습니다.")
            : toAudienceClimateCopy(response.fallbackReason, "선택 조건의 자료가 없습니다.");
        const refreshNotice = datasetRefresh
          ? `${datasetRefreshSucceededMessage(datasetUpdatedAt)}${response.coverage === "available" ? "" : ` ${coverageMessage}`}`
          : void 0;
        setState({
          conditionKey,
          response,
          status,
          message: refreshNotice ?? coverageMessage,
          ...(refreshNotice ? { refreshNotice } : {})
        });
      }).catch((error) => {
        if (error instanceof Error && error.name === "AbortError") return;
        if (cancelledConditionRef.current === conditionKey) return;
        if (active) {
          completedRefreshSequenceRef.current = Math.max(completedRefreshSequenceRef.current, refreshSequence);
          setState((current) => {
            const retainResponse = retainForVersionTransition && current.conditionKey === conditionKey && current.response;
            const refreshNotice = datasetRefresh ? datasetRefreshFailedMessage(datasetUpdatedAt, Boolean(retainResponse)) : void 0;
            return {
              ...(retainResponse ? { response: current.response } : {}),
              conditionKey,
              status: "error",
              message: refreshNotice ?? (error instanceof Error ? error.message : "기후 자료를 불러오지 못했습니다. 잠시 후 다시 시도하세요."),
              ...(refreshNotice ? { refreshNotice } : {})
            };
          });
        }
      });
    }, 280);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = void 0;
    };
  }, [conditionKey, datasetUpdatedAt, datasetVersion, request, requestDatasetRefresh, refreshSequence]);
  const cancel = () => {
    if (state.status !== "loading") return;
    cancelledConditionRef.current = conditionKey;
    controllerRef.current?.abort();
    controllerRef.current = void 0;
    completedRefreshSequenceRef.current = Math.max(completedRefreshSequenceRef.current, refreshSequence);
    setState((current) => ({
      ...(current.retainingResponse && current.conditionKey === conditionKey && current.response ? { response: current.response } : {}),
      conditionKey,
      status: "cancelled",
      message: "자료 불러오기를 취소했습니다. 조건을 바꾸면 다시 시작합니다."
    }));
  };
  return { ...state, cancel };
}
function buildUiRemoteChunkRequest({
  coordinate,
  date,
  scenario,
  model,
  datasetVersion
}) {
  return {
    stationLabel: `선택한 위치 ${formatCoordinatePair(coordinate.latitude, coordinate.longitude, 2)}`,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    date,
    scenario,
    model,
    ...(datasetVersion ? { datasetVersion } : {})
  };
}
function responseIfRequestMatches(response, request, expectedUpdatedAt) {
  if (!response || !isMatchingPublicDatasetIdentity(response, request.datasetVersion, expectedUpdatedAt)) return void 0;
  const validation = validateRemoteChunkResponse(response, request, expectedUpdatedAt);
  return validation.status === "ready" ? response : void 0;
}
function toAudienceClimateCopy(value, fallback = "") {
  const copy = typeof value === "string" && value.trim() ? value : fallback;
  return copy.replace(/선택\s*좌표/gu, "선택한 위치").replace(/기후모델/gu, "기후 모델").replace(/원자료\s*격자값/gu, "원자료").replace(/원자료\s*격자/gu, "원자료").replace(/앙상블\s*중간값/gu, "여러 모델의 중간값").replace(/관측자료/gu, "관측 자료");
}
function deriveClimateMetrics({ date, raw, remoteState }) {
  const remoteMetrics = deriveRemoteMetrics({ date, raw, remoteResponse: remoteState.response });
  if (remoteMetrics.length >= 5) return remoteMetrics;
  const waiting = remoteState.status === "loading";
  const comfortLabel = apparentTemperatureBasis(date).label;
  return [
    ["tasmax", "최고기온", "℃"],
    ["tasmin", "최저기온", "℃"],
    ["precipitation", "강수량", "mm/day"],
    ["wind", "풍속", "m/s"],
    ["apparentTemperature", comfortLabel, "℃"]
  ].map(([key, label, unit]) => ({
    key,
    label,
    value: waiting ? "조회 중" : "자료 없음",
    unit,
    caption: toAudienceClimateCopy(remoteState.message),
    tone: "neutral",
    available: false
  }));
}
function simplifyPublicMetrics(items) {
  const captions = {
    precipitation: "하루 평균 강수량",
    wind: "평균 풍속",
    apparentTemperature: "월에 따라 열지수 또는 체감기온 적용"
  };
  return items.map((metric) => ({
    ...metric,
    value: metric.available === false ? metric.value : formatPublicMetricValue(metric),
    caption: metric.available === false ? metric.caption : captions[metric.key] ?? ""
  }));
}
function deriveRemoteMetrics({
  date,
  raw,
  remoteResponse
}) {
  if (!remoteResponse || !remoteResponse.publicSafe) return [];
  const metrics = remoteResponse.values.map((metric) => {
    const available = metric.available !== false && Number.isFinite(metric.numericValue);
    const rawValue = Number.isFinite(metric.rawNumericValue)
      ? formatPublicMetricValue({ ...metric, numericValue: metric.rawNumericValue })
      : metric.rawValue;
    return {
      key: metric.key,
      label: metric.label,
      value: available ? formatPublicMetricValue(metric) : metric.value,
      numericValue: metric.numericValue,
      unit: metricDisplayUnit(metric),
      caption: toAudienceClimateCopy(metric.caption),
      tone: metric.tone,
      available,
      ...raw && metric.rawValue !== void 0 ? { rawValue, rawNumericValue: metric.rawNumericValue } : {}
    };
  });
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
      metric.caption ? /* @__PURE__ */ jsx("span", { children: metric.caption }) : null,
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
  const markerSize = mapMarkerSizeForZoom(zoom);
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
        "날짜 ",
        date
      ] }),
      /* @__PURE__ */ jsx("span", { children: rawModelGrid ? "기후 모델 원자료" : raw ? "보정 전 값 함께 보기" : "보정한 값" })
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
        "data-marker-size": markerSize,
        "data-zoom": zoom,
        style: { left: markerPosition.x, top: markerPosition.y, "--marker-size": `${markerSize}px` },
        children: /* @__PURE__ */ jsx(LocateFixed, { size: Math.round(markerSize * 0.45) })
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "map-scale", "aria-hidden": "true", children: [
      /* @__PURE__ */ jsx("span", { style: { width: mapScale.width } }),
      /* @__PURE__ */ jsx("b", { children: mapScale.label })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "map-attribution", children: "지도 데이터: OpenStreetMap 기여자" }),
    /* @__PURE__ */ jsxs("div", { className: "map-status", children: [
      /* @__PURE__ */ jsxs("strong", { children: ["선택한 위치 ", formatCoordinatePair(latitude, longitude)] }),
      /* @__PURE__ */ jsxs("span", { children: [
        date,
        " 기준, ",
        onCoordinateChange ? "지도를 눌러 위치를 바꿀 수 있습니다" : "예시 위치입니다"
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
function describeSaveResult(result, label) {
  if (result.outcome === "written") return `${label} 파일을 저장했습니다.`;
  if (result.outcome === "cancelled") return `${label} 저장을 취소했습니다.`;
  return `${label} 파일 저장을 시작했습니다. 브라우저의 다운로드 목록을 확인하세요.`;
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
  const isLatitude = label === "위도";
  const negative = String(value).startsWith("-") || Number(value) < 0;
  const direction = isLatitude ? negative ? "S" : "N" : negative ? "W" : "E";
  const directionOptions = isLatitude ? [["N", "N(북위)"], ["S", "S(남위)"]] : [["E", "E(동경)"], ["W", "W(서경)"]];
  const absoluteValue = String(value).replace(/^-/, "");
  const absoluteMaximum = Math.max(Math.abs(Number(min)), Math.abs(Number(max)));
  const changeDirection = (nextDirection) => {
    const shouldBeNegative = ["S", "W"].includes(nextDirection);
    onChange(absoluteValue === "" ? "" : `${shouldBeNegative ? "-" : ""}${absoluteValue}`);
  };
  return /* @__PURE__ */ jsxs("label", { className: "field", children: [
    /* @__PURE__ */ jsx("span", { children: label }),
    /* @__PURE__ */ jsxs("div", { className: "coordinate-input-wrap", children: [
      /* @__PURE__ */ jsx("select", { "aria-label": `${label} 방향`, onChange: (event) => changeDirection(event.target.value), value: direction, children: directionOptions.map(([optionValue, optionLabel]) => /* @__PURE__ */ jsx("option", { value: optionValue, children: optionLabel }, optionValue)) }),
      /* @__PURE__ */ jsx(
        "input",
        {
          "aria-label": `${label} 숫자`,
          inputMode: "decimal",
          max: absoluteMaximum,
          min: 0,
          onChange: (event) => onChange(`${negative ? "-" : ""}${event.target.value}`),
          step: "0.0001",
          type: "number",
          value: absoluteValue
        }
      )
    ] })
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
    navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope: "./", updateViaCache: "none" }).catch(() => void 0);
  });
}
createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsx(StrictMode, { children: /* @__PURE__ */ jsx(App, {}) })
);
registerAppShell();
