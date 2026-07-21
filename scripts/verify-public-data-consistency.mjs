import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validatePublicClimateQueryResponse,
  validatePublicClimateRetryableError,
  validatePublicClimateSeriesResponse,
  validatePublicDatasetMetadata
} from "../source/runtime-policy.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const EVIDENCE_ROOT = path.join(ROOT, ".release-evidence");
const DEFAULT_SAMPLE_COUNT = 4;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_SAMPLE_COUNT = 16;
const REQUEST_ATTEMPTS = 3;
const QUERY_METRIC_KEYS = Object.freeze([
  "tasmax",
  "tasmin",
  "precipitation",
  "wind",
  "heatIndex",
  "feelsLike"
]);
const PREPARED_ANCHOR = Object.freeze({ latitude: 36.35, longitude: 127.38 });
const WORLD_COORDINATES = Object.freeze([
  Object.freeze({ latitude: 31.05, longitude: -7.92 }),
  Object.freeze({ latitude: 40.7128, longitude: -74.006 }),
  Object.freeze({ latitude: -23.5505, longitude: -46.6333 }),
  Object.freeze({ latitude: 51.5074, longitude: -0.1278 }),
  Object.freeze({ latitude: -33.8688, longitude: 151.2093 }),
  Object.freeze({ latitude: -33.9249, longitude: 18.4241 }),
  Object.freeze({ latitude: 35.6762, longitude: 139.6503 }),
  Object.freeze({ latitude: 28.6139, longitude: 77.209 })
]);

export class PublicDataConsistencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "PublicDataConsistencyError";
  }
}

export function buildRandomProbeRequests(metadataValue, {
  sampleCount = DEFAULT_SAMPLE_COUNT,
  seed = randomBytes(16).toString("hex")
} = {}) {
  const metadata = validateMetadata(metadataValue);
  const count = validateSampleCount(sampleCount);
  const normalizedSeed = validateSeed(seed);
  const random = createSeededRandom(normalizedSeed);
  const dates = dateRange(metadata.dateStart, metadata.dateEnd);
  const scenarios = shuffle([...metadata.scenarios], random);
  const ensembleModel = metadata.models.find((model) => model === "전체 앙상블") ?? metadata.models[0];
  const individualModels = shuffle(metadata.models.filter((model) => model !== ensembleModel), random);
  const coordinates = shuffle([...WORLD_COORDINATES], random);
  const requests = [];

  requests.push({
    stationLabel: "무작위 대조 표본 1",
    latitude: PREPARED_ANCHOR.latitude,
    longitude: PREPARED_ANCHOR.longitude,
    date: randomDate(dates, random),
    scenario: scenarios[0],
    model: ensembleModel,
    datasetVersion: metadata.datasetVersion
  });

  for (let index = 1; index < count; index += 1) {
    const coordinate = coordinates[(index - 1) % coordinates.length];
    const model = individualModels.length
      ? individualModels[(index - 1) % individualModels.length]
      : ensembleModel;
    requests.push({
      stationLabel: `무작위 대조 표본 ${index + 1}`,
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      date: randomDate(dates, random),
      scenario: scenarios[index % scenarios.length],
      model,
      datasetVersion: metadata.datasetVersion
    });
  }

  return { requests, seed: normalizedSeed };
}

export async function verifyPublicDataConsistency({
  baseUrl,
  sampleCount = DEFAULT_SAMPLE_COUNT,
  seed = randomBytes(16).toString("hex"),
  fetchImplementation = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelayMs = 1000,
  now = () => new Date()
} = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new PublicDataConsistencyError("공개 기후 자료를 호출할 수 없습니다.");
  }
  const origin = validateBaseUrl(baseUrl);
  const metadata = validateMetadata(await fetchJson(
    new URL("/api/climate/metadata", origin),
    { fetchImplementation, timeoutMs, retryDelayMs, label: "자료 기준" }
  ));
  const randomSelection = buildRandomProbeRequests(metadata, { sampleCount, seed });
  const checks = [];

  // 원자료 조회가 무거우므로 표본은 순차 실행해 공개 서비스의 동시 작업 한도를 침범하지 않는다.
  for (const [index, request] of randomSelection.requests.entries()) {
    const queryStartedAt = Date.now();
    const query = validatePublicClimateQueryResponse(await fetchJson(
      new URL("/api/climate/query", origin),
      {
        fetchImplementation,
        timeoutMs,
        retryDelayMs,
        label: `표본 ${index + 1} 단일 날짜`,
        body: request
      }
    ));
    const queryElapsedMs = Date.now() - queryStartedAt;
    const includeRaw = query.dataMode === "bias-corrected";
    const seriesRequest = {
      latitude: request.latitude,
      longitude: request.longitude,
      startDate: request.date,
      endDate: request.date,
      scenario: request.scenario,
      model: request.model,
      metrics: [...QUERY_METRIC_KEYS],
      includeRaw,
      datasetVersion: request.datasetVersion
    };
    const seriesStartedAt = Date.now();
    const series = validatePublicClimateSeriesResponse(await fetchJson(
      new URL("/api/climate/series", origin),
      {
        fetchImplementation,
        timeoutMs,
        retryDelayMs,
        label: `표본 ${index + 1} 기간`,
        body: seriesRequest
      }
    ));
    const seriesElapsedMs = Date.now() - seriesStartedAt;
    const metricChecks = compareQueryAndSeries({ metadata, query, request, series, seriesRequest });
    checks.push({
      sample: index + 1,
      latitude: request.latitude,
      longitude: request.longitude,
      date: request.date,
      scenario: request.scenario,
      model: request.model,
      coverage: query.coverage,
      dataMode: query.dataMode,
      queryElapsedMs,
      seriesElapsedMs,
      metrics: metricChecks,
      responseDigest: digestComparableResponses(query, series)
    });
  }

  const dataModes = [...new Set(checks.map((check) => check.dataMode))].sort();
  if (!dataModes.includes("bias-corrected") || !dataModes.includes("raw-model-grid")) {
    throw new PublicDataConsistencyError("무작위 대조에 보정 자료와 전 세계 기후 모델 원자료가 모두 포함되지 않았습니다.");
  }

  return {
    schemaVersion: 1,
    verifiedAtUtc: now().toISOString(),
    apiOrigin: origin,
    datasetVersion: metadata.datasetVersion,
    datasetUpdatedAt: metadata.datasetUpdatedAt,
    seed: randomSelection.seed,
    requestedSamples: randomSelection.requests.length,
    completedSamples: checks.length,
    dataModes,
    models: [...new Set(checks.map((check) => check.model))].sort(),
    scenarios: [...new Set(checks.map((check) => check.scenario))].sort(),
    checks
  };
}

export function compareQueryAndSeries({ metadata, query, request, series, seriesRequest }) {
  requireDatasetIdentity(metadata, query, "단일 날짜");
  requireDatasetIdentity(metadata, series, "기간");
  if (!sameCoordinate(query.latitude, request.latitude)
    || !sameCoordinate(query.longitude, request.longitude)
    || query.date !== request.date
    || query.scenario !== request.scenario
    || query.model !== request.model) {
    throw new PublicDataConsistencyError("단일 날짜 응답이 무작위 표본 조건과 다릅니다.");
  }
  if (!sameCoordinate(series.latitude, seriesRequest.latitude)
    || !sameCoordinate(series.longitude, seriesRequest.longitude)
    || series.dateStart !== seriesRequest.startDate
    || series.dateEnd !== seriesRequest.endDate
    || series.dates?.length !== 1
    || series.dates[0] !== seriesRequest.startDate
    || series.scenario !== seriesRequest.scenario
    || series.model !== seriesRequest.model
    || series.dataMode !== query.dataMode
    || series.includeRaw !== seriesRequest.includeRaw) {
    throw new PublicDataConsistencyError("기간 응답이 무작위 표본 조건과 다릅니다.");
  }

  const seriesMetrics = new Map((series.metrics ?? []).map((metric) => [metric?.key, metric]));
  const checks = [];
  for (const key of QUERY_METRIC_KEYS) {
    const queryMetric = query.values?.find((metric) => metric?.key === key);
    if (!queryMetric || queryMetric.available !== true || !Number.isFinite(queryMetric.numericValue)) continue;
    const seriesMetric = seriesMetrics.get(key);
    const seriesValue = seriesMetric?.corrected?.p50?.[0];
    if (seriesMetric?.coverage?.[0] !== true || !nearlyEqual(queryMetric.numericValue, seriesValue)) {
      throw new PublicDataConsistencyError(`${key}의 단일 날짜 값과 기간 대표값이 다릅니다.`);
    }
    const check = {
      key,
      queryValue: queryMetric.numericValue,
      seriesP50: seriesValue
    };
    if (seriesRequest.includeRaw && Number.isFinite(queryMetric.rawNumericValue)) {
      const rawValue = seriesMetric?.raw?.p50?.[0];
      if (!nearlyEqual(queryMetric.rawNumericValue, rawValue)) {
        throw new PublicDataConsistencyError(`${key}의 보정 전 단일 날짜 값과 기간 대표값이 다릅니다.`);
      }
      check.queryRawValue = queryMetric.rawNumericValue;
      check.seriesRawP50 = rawValue;
    }
    checks.push(check);
  }
  if (checks.length === 0) {
    throw new PublicDataConsistencyError("무작위 표본에서 대조할 수 있는 기후 지표를 찾지 못했습니다.");
  }
  return checks;
}

export async function writeConsistencyEvidence(outputPath, evidence, { fileSystem = fs } = {}) {
  const resolvedOutput = validateOutputPath(outputPath);
  const directory = path.dirname(resolvedOutput);
  const temporaryPath = path.join(directory, `.${path.basename(resolvedOutput)}.${process.pid}.tmp`);
  try {
    await fileSystem.mkdir(directory, { recursive: true });
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await fileSystem.rename(temporaryPath, resolvedOutput);
    return resolvedOutput;
  } catch (error) {
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => void 0);
    throw error instanceof PublicDataConsistencyError
      ? error
      : new PublicDataConsistencyError("무작위 대조 증거를 저장하지 못했습니다.");
  }
}

async function fetchJson(url, {
  fetchImplementation,
  timeoutMs,
  retryDelayMs,
  label,
  body
}) {
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await fetchImplementation(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal
      });
      const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
      const text = await readTextLimited(response, MAX_RESPONSE_BYTES);
      if (!contentType.startsWith("application/json")) {
        throw new PublicDataConsistencyError(`${label} 응답이 JSON이 아닙니다.`);
      }
      let payload;
      try {
        payload = JSON.parse(text.replace(/^\uFEFF/u, ""));
      } catch {
        throw new PublicDataConsistencyError(`${label} 응답 JSON 형식이 올바르지 않습니다.`);
      }
      if (response.status === 503 && attempt < REQUEST_ATTEMPTS) {
        try {
          validatePublicClimateRetryableError(payload);
        } catch {
          throw new PublicDataConsistencyError(`${label}의 다시 시도 가능한 오류 계약이 올바르지 않습니다.`);
        }
        await delay(retryDelayMs);
        continue;
      }
      if (!response.ok) {
        throw new PublicDataConsistencyError(`${label} 조회가 HTTP ${response.status}로 실패했습니다.`);
      }
      return payload;
    } catch (error) {
      if (error instanceof PublicDataConsistencyError) throw error;
      if (attempt >= REQUEST_ATTEMPTS) {
        throw new PublicDataConsistencyError(`${label} 조회에 실패했습니다.`);
      }
      await delay(retryDelayMs);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new PublicDataConsistencyError(`${label} 조회에 실패했습니다.`);
}

async function readTextLimited(response, maximumBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new PublicDataConsistencyError("공개 기후 자료 응답이 허용 크기를 넘었습니다.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maximumBytes) {
    throw new PublicDataConsistencyError("공개 기후 자료 응답이 허용 크기를 넘었습니다.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new PublicDataConsistencyError("공개 기후 자료 응답의 UTF-8 형식이 올바르지 않습니다.");
  }
}

function validateMetadata(value) {
  let metadata;
  try {
    metadata = validatePublicDatasetMetadata(value);
  } catch {
    throw new PublicDataConsistencyError("공개 기후 자료 기준 정보가 올바르지 않습니다.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(metadata.dateStart)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(metadata.dateEnd)
    || metadata.dateStart > metadata.dateEnd
    || !Array.isArray(metadata.models)
    || metadata.models.length === 0
    || !metadata.models.every(isNonEmptyText)
    || !Array.isArray(metadata.scenarios)
    || metadata.scenarios.length === 0
    || !metadata.scenarios.every(isNonEmptyText)) {
    throw new PublicDataConsistencyError("공개 기후 자료의 날짜·모델·배출 경로 범위가 올바르지 않습니다.");
  }
  return metadata;
}

function validateBaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? ""));
  } catch {
    throw new PublicDataConsistencyError("공개 API 주소 형식이 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:"
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.pathname !== "/") {
    throw new PublicDataConsistencyError("공개 API 주소는 인증 정보가 없는 HTTPS 출처여야 합니다.");
  }
  return parsed.origin;
}

function validateOutputPath(value) {
  const candidate = value
    ? path.resolve(String(value))
    : path.join(EVIDENCE_ROOT, `public-data-consistency-${Date.now()}.json`);
  if (path.dirname(candidate) !== EVIDENCE_ROOT || path.extname(candidate).toLowerCase() !== ".json") {
    throw new PublicDataConsistencyError("무작위 대조 증거는 비공개 release evidence 폴더에 저장해야 합니다.");
  }
  return candidate;
}

function validateSampleCount(value) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 2 || count > MAX_SAMPLE_COUNT) {
    throw new PublicDataConsistencyError(`표본 수는 2~${MAX_SAMPLE_COUNT} 사이의 정수여야 합니다.`);
  }
  return count;
}

function validateSeed(value) {
  const seed = String(value ?? "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(seed)) {
    throw new PublicDataConsistencyError("난수 시드는 8~128자의 안전한 문자로 지정해야 합니다.");
  }
  return seed;
}

function createSeededRandom(seed) {
  let counter = 0;
  return () => {
    const digest = createHash("sha256").update(seed).update(":").update(String(counter)).digest();
    counter += 1;
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  };
}

function shuffle(values, random) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}

function dateRange(start, end) {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    throw new PublicDataConsistencyError("공개 기후 자료 날짜 범위를 해석할 수 없습니다.");
  }
  return { startMs, endMs };
}

function randomDate({ startMs, endMs }, random) {
  const dayMs = 24 * 60 * 60 * 1000;
  const dayCount = Math.floor((endMs - startMs) / dayMs) + 1;
  return new Date(startMs + Math.floor(random() * dayCount) * dayMs).toISOString().slice(0, 10);
}

function requireDatasetIdentity(metadata, response, label) {
  if (response.datasetVersion !== metadata.datasetVersion
    || response.datasetUpdatedAt !== metadata.datasetUpdatedAt
    || response.publicSafe !== true
    || response.attributionReady !== true) {
    throw new PublicDataConsistencyError(`${label} 응답의 자료판 또는 공개 안전 정보가 기준 정보와 다릅니다.`);
  }
}

function sameCoordinate(left, right) {
  return Number.isFinite(Number(left))
    && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) <= 1e-7;
}

function nearlyEqual(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= scale * 1e-10;
}

function digestComparableResponses(query, series) {
  const comparable = {
    query: omitVolatileFields(query),
    series: omitVolatileFields(series)
  };
  return createHash("sha256").update(stableJson(comparable)).digest("hex");
}

function omitVolatileFields(value) {
  if (Array.isArray(value)) return value.map(omitVolatileFields);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    if (key === "generatedAt" || key === "requestId") return [];
    return [[key, omitVolatileFields(value[key])]];
  }));
}

function stableJson(value) {
  return JSON.stringify(value);
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function delay(milliseconds) {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!["--base-url", "--samples", "--seed", "--output"].includes(argument) || value === undefined) {
      throw new PublicDataConsistencyError(`지원하지 않는 실행 인자입니다: ${argument}`);
    }
    index += 1;
    if (argument === "--base-url") options.baseUrl = value;
    if (argument === "--samples") options.sampleCount = Number(value);
    if (argument === "--seed") options.seed = value;
    if (argument === "--output") options.outputPath = value;
  }
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  try {
    const options = parseArguments(argv);
    const evidence = await verifyPublicDataConsistency({
      baseUrl: options.baseUrl ?? env.CTC_PUBLIC_API_ORIGIN,
      sampleCount: options.sampleCount,
      seed: options.seed
    });
    const outputPath = await writeConsistencyEvidence(options.outputPath, evidence);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      datasetVersion: evidence.datasetVersion,
      seed: evidence.seed,
      completedSamples: evidence.completedSamples,
      dataModes: evidence.dataModes,
      outputPath
    }, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof PublicDataConsistencyError
      ? error.message
      : "공개 기후 자료 무작위 대조를 완료하지 못했습니다.";
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
