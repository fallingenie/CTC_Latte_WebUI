import test from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_BACKEND_CONTRACT_PROFILE,
  PUBLIC_CLIMATE_METADATA_TIMEOUT_MS,
  PUBLIC_CLIMATE_READ_PATH,
  PUBLIC_DATASET_REACTIVATION_MIN_INTERVAL_MS,
  PUBLIC_DATASET_REFRESH_INTERVAL_MS,
  PUBLIC_DATA_SOURCE_POLICY,
  PUBLIC_RETRYABLE_RAW_QUERY_MESSAGE,
  createPublicMetadataRefreshQueue,
  formatPublicDatasetUpdatedAt,
  isCurrentPublicDatasetResult,
  isMatchingPublicDatasetIdentity,
  isMatchingPublicDatasetVersion,
  isPublicDatasetIdentityChange,
  isPublicDatasetVersionChange,
  validatePublicApiResponse,
  validatePublicClimateQueryResponse,
  validatePublicClimateRetryableError,
  validatePublicClimateSeriesResponse,
  validatePublicDatasetMetadata,
  validatePublicClimateReadPath,
  validatePublicRuntimeConfig
} from "../source/runtime-policy.js";

const currentDatasetVersion = "a".repeat(64);
const nextDatasetVersion = "b".repeat(64);
const currentDatasetUpdatedAt = "2026-07-13T16:22:20.121000+00:00";
const nextDatasetUpdatedAt = "2026-07-14T03:20:10.000000+00:00";

const validConfig = {
  readPath: "/api/climate/query",
  timeoutMs: 600000,
  publicSafe: true,
  sourcePolicy: "cloud-only"
};

const validMetadata = {
  publicSafe: true,
  ready: true,
  datasetVersion: currentDatasetVersion,
  datasetUpdatedAt: currentDatasetUpdatedAt,
  dateStart: "2035-01-01",
  dateEnd: "2099-12-31",
  models: ["전체 앙상블"],
  scenarios: ["고배출 경로"]
};

const allowedPublicResponseFields = [
  "publicSafe",
  "attributionReady",
  "datasetVersion",
  "model",
  "values",
  "values[].key",
  "values[].label",
  "values[].caption",
  "values[].numericValue"
];

const validPublicResponse = {
  publicSafe: true,
  attributionReady: true,
  datasetVersion: currentDatasetVersion,
  model: "MIROC6",
  values: [{
    key: "tasmax",
    label: "최고기온",
    caption: "관측 자료를 바탕으로 보정한 값",
    numericValue: 31.25
  }]
};

const validQueryResponse = {
  requestId: "query-2050-08-01-123456789abc",
  sourceId: "climate-data-live",
  stationLabel: "선택한 위치 N(북위) 36.35, E(동경) 127.38",
  latitude: 36.35,
  longitude: 127.38,
  date: "2050-08-01",
  scenario: "고배출 경로",
  model: "MIROC6",
  coverage: "available",
  dataMode: "bias-corrected",
  values: [{ key: "tasmax", label: "최고기온", value: "31.25도", unit: "도", caption: "선택 모델 보정값", tone: "hot", available: true, numericValue: 31.25 }],
  attributionReady: true,
  publicSafe: true,
  generatedAt: "2026-07-15T00:00:00Z",
  datasetVersion: currentDatasetVersion,
  datasetUpdatedAt: currentDatasetUpdatedAt
};

const validSeriesResponse = {
  requestId: "series-2050-08-01-2050-08-02-123456789abc",
  sourceId: "climate-data-live",
  latitude: 36.35,
  longitude: 127.38,
  dateStart: "2050-08-01",
  dateEnd: "2050-08-02",
  dates: ["2050-08-01", "2050-08-02"],
  scenario: "고배출 경로",
  model: "MIROC6",
  coverage: "available",
  dataMode: "bias-corrected",
  metrics: [{
    key: "tasmax",
    label: "최고기온",
    unit: "도",
    corrected: { p10: [29, 30], p50: [31, 32], p90: [33, 34] },
    coverage: [true, true],
    modelCounts: [1, 1],
    availableCount: 2
  }],
  includeRaw: false,
  attributionReady: true,
  attributionLabels: ["국제기후모델 시나리오 자료", "관측자료 기반 보정"],
  publicSafe: true,
  generatedAt: "2026-07-15T00:00:00Z",
  datasetVersion: currentDatasetVersion,
  datasetUpdatedAt: currentDatasetUpdatedAt
};

test("배포 연결 설정은 동일 출처 API와 클라우드 전용 정책을 허용한다", () => {
  assert.deepEqual(validatePublicRuntimeConfig(validConfig), {
    readPath: PUBLIC_CLIMATE_READ_PATH,
    sourcePolicy: PUBLIC_DATA_SOURCE_POLICY,
    timeoutMs: 600000
  });
});

test("GitHub Pages는 HTTPS Cloud Run 공개 조회 주소만 사용할 수 있다", () => {
  const readPath = "https://ctc-latte-rc-123456789012.asia-northeast3.run.app/api/climate/query";
  assert.equal(validatePublicClimateReadPath(readPath), readPath);
  assert.equal(validatePublicRuntimeConfig({ ...validConfig, readPath }).readPath, readPath);
  for (const invalid of [
    "http://ctc-latte-rc.example.run.app/api/climate/query",
    "https://example.com/api/climate/query",
    "https://ctc-latte-rc.example.run.app/api/climate/series",
    "https://ctc-latte-rc.example.run.app/api/climate/query?token=secret",
    "https://user:password@ctc-latte-rc.example.run.app/api/climate/query"
  ]) {
    assert.throws(() => validatePublicClimateReadPath(invalid), /공개 조회 기준/u);
  }
});

test("배포 연결 설정은 시간 제한을 안전 범위로 조정한다", () => {
  assert.equal(validatePublicRuntimeConfig({ ...validConfig, timeoutMs: 1 }).timeoutMs, 30000);
  assert.equal(validatePublicRuntimeConfig({ ...validConfig, timeoutMs: 9999999 }).timeoutMs, 600000);
});

test("메타데이터 확인은 실제 기후자료 조회보다 빠르게 실패한다", () => {
  assert.equal(PUBLIC_CLIMATE_METADATA_TIMEOUT_MS, 10000);
  assert.equal(validatePublicRuntimeConfig(validConfig).timeoutMs, 600000);
  assert.ok(PUBLIC_CLIMATE_METADATA_TIMEOUT_MS < validatePublicRuntimeConfig(validConfig).timeoutMs);
});

test("로컬 또는 외부 저장소를 가리키는 추가 설정은 거부한다", () => {
  for (const extra of [
    { root: "local" },
    { storageUrl: "external" },
    { folderId: "private" },
    { credentials: "secret" }
  ]) {
    assert.throws(() => validatePublicRuntimeConfig({ ...validConfig, ...extra }), /공개 조회 기준/u);
  }
});

test("개발용 로컬 정책과 임의 외부 API 경로는 배포 설정으로 허용하지 않는다", () => {
  assert.throws(
    () => validatePublicRuntimeConfig({ ...validConfig, sourcePolicy: "development-local" }),
    /공개 조회 기준/u
  );
  assert.throws(
    () => validatePublicRuntimeConfig({ ...validConfig, readPath: "https://example.invalid/query" }),
    /공개 조회 기준/u
  );
});

test("불완전하거나 잘못된 형식의 설정은 거부한다", () => {
  assert.throws(() => validatePublicRuntimeConfig(null), /공개 조회 기준/u);
  assert.throws(() => validatePublicRuntimeConfig([]), /공개 조회 기준/u);
  assert.throws(() => validatePublicRuntimeConfig({ ...validConfig, timeoutMs: "600000" }), /공개 조회 기준/u);
  const { sourcePolicy, ...missingPolicy } = validConfig;
  assert.equal(sourcePolicy, "cloud-only");
  assert.throws(() => validatePublicRuntimeConfig(missingPolicy), /공개 조회 기준/u);
});

test("공개 메타데이터는 Backend Main의 정확한 자료판 형식만 허용한다", () => {
  const metadata = validatePublicDatasetMetadata(validMetadata);
  assert.equal(metadata.datasetVersion, validMetadata.datasetVersion);
  assert.equal(metadata.datasetUpdatedAt, validMetadata.datasetUpdatedAt);
  assert.deepEqual(metadata.models, ["전체 앙상블"]);
});

test("자료판 필드가 없는 이전 main 메타데이터는 거부한다", () => {
  const { datasetVersion, datasetUpdatedAt, ...mainMetadata } = validMetadata;
  assert.equal(datasetVersion, validMetadata.datasetVersion);
  assert.equal(datasetUpdatedAt, validMetadata.datasetUpdatedAt);
  assert.throws(() => validatePublicDatasetMetadata(mainMetadata), /기후 자료 기준/u);
});

test("공개 준비 상태와 자료 기준이 불완전한 메타데이터는 거부한다", () => {
  for (const metadata of [
    null,
    [],
    { ...validMetadata, publicSafe: false },
    { ...validMetadata, ready: false },
    { ...validMetadata, datasetVersion: "" },
    { ...validMetadata, datasetVersion: "A".repeat(64) },
    { ...validMetadata, datasetVersion: "a".repeat(63) },
    { ...validMetadata, datasetVersion: "version\nleak" },
    { ...validMetadata, datasetUpdatedAt: undefined },
    { ...validMetadata, datasetVersion: undefined },
    { ...validMetadata, datasetUpdatedAt: "2026-02-30T00:00:00.000000+00:00" },
    { ...validMetadata, datasetUpdatedAt: "2026-07-14T03:20:10Z" },
    { ...validMetadata, datasetUpdatedAt: "2026-07-14T03:20:10.000+00:00" },
    { ...validMetadata, datasetUpdatedAt: "2026/07/14" },
    { ...validMetadata, storageUrl: "redacted" },
    { ...validMetadata, models: ["/srv/private/model.nc"] }
  ]) {
    assert.throws(() => validatePublicDatasetMetadata(metadata), /기후 자료 기준/u);
  }
});

test("공개 API 응답은 선언한 중첩 필드만 그대로 허용한다", () => {
  assert.equal(
    validatePublicApiResponse(validPublicResponse, allowedPublicResponseFields),
    validPublicResponse
  );
});

test("공개 API 응답은 루트와 배열 원소의 미허용 필드를 거부한다", () => {
  assert.throws(
    () => validatePublicApiResponse({ ...validPublicResponse, storageUrl: "redacted" }, allowedPublicResponseFields),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicApiResponse({
      ...validPublicResponse,
      values: [{ ...validPublicResponse.values[0], sourcePath: "redacted" }]
    }, allowedPublicResponseFields),
    /공개 계약/u
  );
});

test("정상 조회 호환 계층은 안전한 추가 필드를 무시하고 내부 계약만 반환한다", () => {
  const metadata = validatePublicDatasetMetadata({
    ...validMetadata,
    qualitySummary: { status: "ready", checkedItems: 18 }
  });
  const query = validatePublicClimateQueryResponse({
    ...validQueryResponse,
    qualityFlags: ["verified"],
    values: [{ ...validQueryResponse.values[0], displayHint: "warm" }]
  });
  const series = validatePublicClimateSeriesResponse({
    ...validSeriesResponse,
    diagnostics: { sampledDays: 2 },
    metrics: [{ ...validSeriesResponse.metrics[0], displayHint: "line" }]
  });

  assert.equal(metadata.qualitySummary, undefined);
  assert.equal(query.qualityFlags, undefined);
  assert.equal(query.values[0].displayHint, undefined);
  assert.equal(series.diagnostics, undefined);
  assert.equal(series.metrics[0].displayHint, undefined);
  assert.equal(query.values[0].numericValue, 31.25);
  assert.deepEqual(series.metrics[0].corrected.p50, [31, 32]);
});

test("정상 조회의 추가 필드도 비공개 위치나 인증 정보를 암시하면 거부한다", () => {
  for (const response of [
    { ...validQueryResponse, qualityNotes: "gs://private-bucket/raw" },
    { ...validQueryResponse, diagnostics: { auth: "Bearer top-secret" } },
    { ...validQueryResponse, diagnostics: { note: "Bearer top-secret" } },
    { ...validQueryResponse, diagnostics: { note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123" } },
    { ...validQueryResponse, sourcePath: "redacted" },
    { ...validSeriesResponse, diagnostics: { accessToken: "redacted" } },
    { ...validMetadata, qualitySummary: { storageId: "redacted" } }
  ]) {
    const validator = "metrics" in response
      ? validatePublicClimateSeriesResponse
      : "values" in response
        ? validatePublicClimateQueryResponse
        : validatePublicDatasetMetadata;
    assert.throws(() => validator(response), /(?:공개 계약|기후 자료 기준)/u);
  }
});

test("Backend 호환 방침은 안전한 추가 필드만 흡수하고 파괴 변경은 차단한다", () => {
  assert.deepEqual(PUBLIC_BACKEND_CONTRACT_PROFILE, {
    id: "ctc-public-climate-v1",
    additiveFields: "project-and-ignore",
    incompatibleChanges: "fail-closed"
  });
});

test("공개 API 응답은 내부 위치와 저장소를 가리키는 문자열을 거부한다", () => {
  const forbiddenValues = [
    "file:///private/climate.ctwebui",
    "gs://private-bucket/raw",
    "https://drive.google.com/private-folder",
    "C:\\private\\climate.nc",
    "\\\\server\\share\\climate.parquet",
    "/srv/climate/data.zarr",
    "https://github.com/example/private-repository",
    "bucket_id=private",
    "내부 경로: 비공개"
  ];

  for (const forbiddenValue of forbiddenValues) {
    assert.throws(
      () => validatePublicApiResponse({
        ...validPublicResponse,
        values: [{ ...validPublicResponse.values[0], caption: forbiddenValue }]
      }, allowedPublicResponseFields),
      /공개 계약/u
    );
  }
});

test("단일 날짜와 기간 응답은 공개 허용 목록을 통과해야 한다", () => {
  assert.deepEqual(validatePublicClimateQueryResponse(validQueryResponse), validQueryResponse);
  assert.deepEqual(validatePublicClimateSeriesResponse(validSeriesResponse), validSeriesResponse);
  assert.throws(
    () => validatePublicClimateQueryResponse({ ...validQueryResponse, sourcePath: "redacted" }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateSeriesResponse({ ...validSeriesResponse, publicSafe: false }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateQueryResponse({ ...validQueryResponse, attributionReady: false }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateSeriesResponse({ ...validSeriesResponse, attributionReady: false }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateSeriesResponse({ ...validSeriesResponse, attributionLabels: [] }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateSeriesResponse({ ...validSeriesResponse, attributionLabels: ["임의 출처"] }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateSeriesResponse({
      ...validSeriesResponse,
      attributionLabels: ["국제기후모델 시나리오 자료", "국제기후모델 시나리오 자료"]
    }),
    /공개 계약/u
  );
});

test("단일 날짜와 기간 응답은 자료판 필드를 반드시 포함해야 한다", () => {
  const {
    datasetVersion: queryVersion,
    datasetUpdatedAt: queryUpdatedAt,
    ...mainQueryResponse
  } = validQueryResponse;
  const {
    datasetVersion: seriesVersion,
    datasetUpdatedAt: seriesUpdatedAt,
    ...mainSeriesResponse
  } = validSeriesResponse;

  assert.ok(queryVersion && queryUpdatedAt && seriesVersion && seriesUpdatedAt);
  assert.throws(() => validatePublicClimateQueryResponse(mainQueryResponse), /공개 계약/u);
  assert.throws(() => validatePublicClimateSeriesResponse(mainSeriesResponse), /공개 계약/u);
  assert.throws(
    () => validatePublicClimateQueryResponse({ ...mainQueryResponse, datasetVersion: queryVersion }),
    /공개 계약/u
  );
});

test("원자료 미완결 응답은 공개된 재시도 계약만 허용한다", () => {
  const retryable = {
    error: PUBLIC_RETRYABLE_RAW_QUERY_MESSAGE,
    code: "raw_query_incomplete_retryable",
    retryable: true
  };
  assert.deepEqual(validatePublicClimateRetryableError(retryable), retryable);
  assert.throws(
    () => validatePublicClimateRetryableError({ ...retryable, sourcePath: "redacted" }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateRetryableError({ ...retryable, code: "internal_worker_timeout" }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateRetryableError({ ...retryable, retryable: false }),
    /공개 계약/u
  );
  assert.throws(
    () => validatePublicClimateRetryableError({ ...retryable, error: "잠시 후 다시 시도하세요." }),
    /공개 계약/u
  );
});

test("공개 API 허용 필드 계약도 비어 있거나 중복되거나 와일드카드이면 거부한다", () => {
  for (const allowedFields of [
    [],
    ["publicSafe", "publicSafe"],
    ["publicSafe", "values.*"]
  ]) {
    assert.throws(() => validatePublicApiResponse(validPublicResponse, allowedFields), /공개 계약/u);
  }
});

test("자료 버전은 최초 기준 확정과 실제 변경을 구분한다", () => {
  assert.equal(isPublicDatasetVersionChange(undefined, validMetadata.datasetVersion), false);
  assert.equal(isPublicDatasetVersionChange(validMetadata.datasetVersion, validMetadata.datasetVersion), false);
  assert.equal(isPublicDatasetVersionChange(validMetadata.datasetVersion, nextDatasetVersion), true);
  assert.equal(isPublicDatasetIdentityChange(validMetadata, validMetadata), false);
  assert.equal(isPublicDatasetIdentityChange(validMetadata, { ...validMetadata, datasetVersion: nextDatasetVersion }), true);
  assert.equal(isPublicDatasetIdentityChange(validMetadata, { ...validMetadata, datasetUpdatedAt: nextDatasetUpdatedAt }), true);
});

test("버전이 고정된 API 응답은 요청 버전과 정확히 같아야 한다", () => {
  assert.equal(isMatchingPublicDatasetVersion({ datasetVersion: validMetadata.datasetVersion }, validMetadata.datasetVersion), true);
  assert.equal(isMatchingPublicDatasetVersion({ datasetVersion: nextDatasetVersion }, validMetadata.datasetVersion), false);
  assert.equal(isMatchingPublicDatasetVersion({}, validMetadata.datasetVersion), false);
  assert.equal(isMatchingPublicDatasetVersion({ datasetVersion: validMetadata.datasetVersion }, "invalid\nversion"), false);
  assert.equal(isMatchingPublicDatasetVersion({}, undefined), true);
  assert.equal(isMatchingPublicDatasetIdentity(validQueryResponse, currentDatasetVersion, currentDatasetUpdatedAt), true);
  assert.equal(isMatchingPublicDatasetIdentity(validQueryResponse, currentDatasetVersion, nextDatasetUpdatedAt), false);
  assert.equal(isMatchingPublicDatasetIdentity(validQueryResponse, nextDatasetVersion, currentDatasetUpdatedAt), false);
});

test("저장 가능한 결과는 현재 자료판과 일치하고 조회가 완료된 경우로 제한한다", () => {
  assert.equal(isCurrentPublicDatasetResult(validQueryResponse, validMetadata, "ready"), true);
  assert.equal(isCurrentPublicDatasetResult(validQueryResponse, validMetadata, "loading"), false);
  assert.equal(isCurrentPublicDatasetResult(validQueryResponse, validMetadata, "error"), false);
  assert.equal(isCurrentPublicDatasetResult(
    { ...validQueryResponse, datasetVersion: nextDatasetVersion },
    validMetadata,
    "ready"
  ), false);
  assert.equal(isCurrentPublicDatasetResult(
    { ...validQueryResponse, datasetUpdatedAt: nextDatasetUpdatedAt },
    validMetadata,
    "ready"
  ), false);
});

test("진행 중 강제 자료 확인은 기존 요청 뒤에 최신 요청을 정확히 한 번 실행한다", async () => {
  const pending = [];
  let callCount = 0;
  const queue = createPublicMetadataRefreshQueue(() => new Promise((resolve, reject) => {
    callCount += 1;
    pending.push({ resolve, reject });
  }));

  const first = queue.request();
  const shared = queue.request();
  const forced = queue.request({ force: true });
  const sharedForced = queue.request({ force: true });
  assert.equal(callCount, 1);
  assert.equal(shared, first);
  assert.equal(sharedForced, forced);

  pending[0].resolve("이전 자료판");
  assert.equal(await first, "이전 자료판");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callCount, 2);
  assert.equal(queue.hasInFlight(), true);

  pending[1].resolve("최신 자료판");
  assert.equal(await forced, "최신 자료판");
  assert.equal(queue.hasInFlight(), false);
});

test("첫 자료 확인이 실패해도 대기한 강제 확인은 새 요청으로 이어진다", async () => {
  const pending = [];
  let callCount = 0;
  const queue = createPublicMetadataRefreshQueue(() => new Promise((resolve, reject) => {
    callCount += 1;
    pending.push({ resolve, reject });
  }));

  const first = queue.request();
  const forced = queue.request({ force: true });
  pending[0].reject(new Error("교체 전 요청 실패"));
  await assert.rejects(first, /교체 전 요청 실패/u);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callCount, 2);
  pending[1].resolve("최신 자료판");
  assert.equal(await forced, "최신 자료판");
});

test("자료 갱신 시각은 내부 버전 대신 한국어 기준일로 표시한다", () => {
  assert.equal(formatPublicDatasetUpdatedAt(validMetadata.datasetUpdatedAt), "2026년 7월 13일");
  assert.equal(formatPublicDatasetUpdatedAt("2026-01-02T00:00:00.000000+00:00"), "2026년 1월 2일");
  assert.equal(formatPublicDatasetUpdatedAt("2026-01-02"), "");
  assert.equal(formatPublicDatasetUpdatedAt("not-a-date"), "");
});

test("자료 확인은 재활성화 중복을 제한하고 저빈도 주기를 사용한다", () => {
  assert.ok(PUBLIC_DATASET_REACTIVATION_MIN_INTERVAL_MS >= 60000);
  assert.ok(PUBLIC_DATASET_REFRESH_INTERVAL_MS >= 10 * 60000);
  assert.ok(PUBLIC_DATASET_REFRESH_INTERVAL_MS > PUBLIC_DATASET_REACTIVATION_MIN_INTERVAL_MS);
});
