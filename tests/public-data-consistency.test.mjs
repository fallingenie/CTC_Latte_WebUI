import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_RETRYABLE_RAW_QUERY_MESSAGE } from "../source/runtime-policy.js";

import {
  PublicDataConsistencyError,
  buildRandomProbeRequests,
  compareQueryAndSeries,
  verifyPublicDataConsistency
} from "../scripts/verify-public-data-consistency.mjs";

const metadata = Object.freeze({
  ready: true,
  dateStart: "2035-01-01",
  dateEnd: "2099-12-31",
  scenarios: ["고배출 경로"],
  models: ["전체 앙상블", "CanESM5", "MIROC6"],
  publicSafe: true,
  datasetVersion: "a".repeat(64),
  datasetUpdatedAt: "2026-07-20T00:45:24.000000+00:00"
});

test("같은 시드의 무작위 표본은 재현되며 준비 자료와 전 세계 모델을 함께 포함한다", () => {
  const left = buildRandomProbeRequests(metadata, { sampleCount: 3, seed: "repeatable-seed" });
  const right = buildRandomProbeRequests(metadata, { sampleCount: 3, seed: "repeatable-seed" });
  assert.deepEqual(left, right);
  assert.equal(left.requests[0].latitude, 36.35);
  assert.equal(left.requests[0].longitude, 127.38);
  assert.equal(left.requests[0].model, "전체 앙상블");
  assert.equal(new Set(left.requests.map((request) => request.model)).size, 3);
  assert.ok(left.requests.slice(1).some((request) => request.longitude < 0 || request.latitude < 0));
});

test("단일 날짜 값과 같은 날 기간 대표값 및 보정 전 값이 정확히 일치해야 한다", () => {
  const request = buildRequest();
  const query = buildQuery(request);
  const seriesRequest = buildSeriesRequest(request, true);
  const series = buildSeries(seriesRequest, "bias-corrected", true);
  const checks = compareQueryAndSeries({ metadata, query, request, series, seriesRequest });
  assert.equal(checks.length, 6);
  assert.deepEqual(checks[0], {
    key: "tasmax",
    queryValue: 31,
    seriesP50: 31,
    queryRawValue: 30,
    seriesRawP50: 30
  });

  series.metrics[0].corrected.p50[0] = 99;
  assert.throws(
    () => compareQueryAndSeries({ metadata, query, request, series, seriesRequest }),
    PublicDataConsistencyError
  );
});

test("공개 API 검증은 다시 시도 가능한 503을 재호출하고 query와 series를 대조한다", async () => {
  let retryCount = 0;
  const calls = [];
  const fetchImplementation = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    calls.push(pathname);
    if (pathname === "/api/climate/metadata") return jsonResponse(metadata);
    const body = JSON.parse(options.body);
    if (pathname === "/api/climate/query") {
      if (retryCount === 0) {
        retryCount += 1;
        return jsonResponse({
          error: PUBLIC_RETRYABLE_RAW_QUERY_MESSAGE,
          code: "raw_query_incomplete_retryable",
          retryable: true
        }, 503);
      }
      return jsonResponse(buildQuery(body, body.latitude === 36.35 ? "bias-corrected" : "raw-model-grid"));
    }
    if (pathname === "/api/climate/series") {
      return jsonResponse(buildSeries(body, body.includeRaw ? "bias-corrected" : "raw-model-grid", body.includeRaw));
    }
    return jsonResponse({ error: "not-found" }, 404);
  };

  const evidence = await verifyPublicDataConsistency({
    baseUrl: "https://climate.example.test",
    sampleCount: 2,
    seed: "retryable-seed",
    fetchImplementation,
    retryDelayMs: 0,
    now: () => new Date("2026-07-21T01:00:00Z")
  });
  assert.equal(evidence.completedSamples, 2);
  assert.deepEqual(evidence.dataModes, ["bias-corrected", "raw-model-grid"]);
  assert.equal(evidence.checks.every((check) => check.metrics.length === 6), true);
  assert.equal(calls.filter((pathname) => pathname === "/api/climate/query").length, 3);
  assert.equal(calls.filter((pathname) => pathname === "/api/climate/series").length, 2);
});

function buildRequest() {
  return {
    stationLabel: "무작위 대조 표본",
    latitude: 36.35,
    longitude: 127.38,
    date: "2050-08-01",
    scenario: metadata.scenarios[0],
    model: metadata.models[0],
    datasetVersion: metadata.datasetVersion
  };
}

function buildSeriesRequest(request, includeRaw) {
  return {
    latitude: request.latitude,
    longitude: request.longitude,
    startDate: request.date,
    endDate: request.date,
    scenario: request.scenario,
    model: request.model,
    metrics: ["tasmax", "tasmin", "precipitation", "wind", "heatIndex", "feelsLike"],
    includeRaw,
    datasetVersion: request.datasetVersion
  };
}

function buildQuery(request, dataMode = "bias-corrected") {
  const values = [
    ["tasmax", 31, 30],
    ["tasmin", 21, 20],
    ["precipitation", 4.2, 4],
    ["wind", 3.1, 3],
    ["heatIndex", 38.4, 38],
    ["feelsLike", 35.2, 35]
  ].map(([key, numericValue, rawNumericValue]) => ({
    key,
    label: key,
    value: String(numericValue),
    unit: key === "wind" ? "미터/초" : "도",
    caption: "검증 표본",
    tone: "neutral",
    available: true,
    numericValue,
    ...(dataMode === "bias-corrected" ? { rawValue: String(rawNumericValue), rawNumericValue } : {})
  }));
  return {
    requestId: "query-test",
    sourceId: "climate-data-live",
    stationLabel: request.stationLabel,
    latitude: request.latitude,
    longitude: request.longitude,
    date: request.date,
    scenario: request.scenario,
    model: request.model,
    coverage: dataMode === "bias-corrected" ? "available" : "fallback",
    dataMode,
    values,
    attributionReady: true,
    publicSafe: true,
    generatedAt: "2026-07-21T01:00:00.000000+00:00",
    datasetVersion: metadata.datasetVersion,
    datasetUpdatedAt: metadata.datasetUpdatedAt,
    ...(dataMode === "bias-corrected" ? { nearestDistanceKm: 2.5 } : { fallbackReason: "기후 모델 원자료" })
  };
}

function buildSeries(request, dataMode, includeRaw) {
  const values = {
    tasmax: [31, 30],
    tasmin: [21, 20],
    precipitation: [4.2, 4],
    wind: [3.1, 3],
    heatIndex: [38.4, 38],
    feelsLike: [35.2, 35]
  };
  return {
    requestId: "series-test",
    sourceId: "climate-data-live",
    latitude: request.latitude,
    longitude: request.longitude,
    dateStart: request.startDate,
    dateEnd: request.endDate,
    dates: [request.startDate],
    scenario: request.scenario,
    model: request.model,
    coverage: dataMode === "bias-corrected" ? "available" : "fallback",
    dataMode,
    metrics: request.metrics.map((key) => ({
      key,
      label: key,
      unit: key === "wind" ? "미터/초" : "도",
      corrected: { p10: [values[key][0]], p50: [values[key][0]], p90: [values[key][0]] },
      coverage: [true],
      modelCounts: [1],
      availableCount: 1,
      ...(includeRaw ? { raw: { p10: [values[key][1]], p50: [values[key][1]], p90: [values[key][1]] } } : {})
    })),
    includeRaw,
    attributionReady: true,
    attributionLabels: dataMode === "bias-corrected"
      ? ["국제기후모델 시나리오 자료", "관측자료 기반 보정"]
      : ["국제기후모델 시나리오 원자료"],
    publicSafe: true,
    generatedAt: "2026-07-21T01:00:00.000000+00:00",
    datasetVersion: metadata.datasetVersion,
    datasetUpdatedAt: metadata.datasetUpdatedAt,
    ...(dataMode === "bias-corrected" ? { nearestDistanceKm: 2.5 } : { fallbackReason: "기후 모델 원자료" })
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
