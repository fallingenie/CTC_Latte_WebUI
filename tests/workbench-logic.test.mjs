import test from "node:test";
import assert from "node:assert/strict";
import {
  apparentTemperatureBasis,
  buildClimateCsv,
  buildPlainLanguageSummary,
  buildStudentNotebookText,
  buildTeacherActivityText,
  calendarPeriodEnd,
  compareMetricSnapshots,
  createMetricSnapshot,
  decodeLessonState,
  encodeLessonState,
  filterClimateSeriesByMonths,
  formatCoordinate,
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
  normalizeMetadataOptions,
  parseHashLocation,
  resolveExportPercentiles,
  sanitizeNote,
  seriesPointX
} from "../source/workbench-logic.js";

const context = {
  date: "2050-08-01",
  latitude: 36.35,
  longitude: 127.38,
  scenario: "고배출 경로",
  model: "전체 앙상블"
};

const validSeriesResponse = {
  publicSafe: true,
  dataMode: "bias-corrected",
  includeRaw: false,
  latitude: 36.35,
  longitude: 127.38,
  dateStart: "2050-08-01",
  dateEnd: "2050-08-02",
  dates: ["2050-08-01", "2050-08-02"],
  scenario: "고배출 경로",
  model: "MIROC6",
  attributionReady: true,
  attributionLabels: ["국제기후모델 시나리오 자료", "관측자료 기반 보정"],
  metrics: [{
    key: "tasmax",
    corrected: { p10: [30, 31], p50: [32, 33], p90: [34, 35] },
    coverage: [true, true],
    modelCounts: [1, 1]
  }]
};

const validSeriesExpectation = {
  startDate: "2050-08-01",
  endDate: "2050-08-02",
  latitude: 36.35,
  longitude: 127.38,
  scenario: "고배출 경로",
  model: "MIROC6",
  dataMode: "bias-corrected",
  includeRaw: false,
  selectedMetrics: ["tasmax"]
};

const standardUnitSnapshot = {
  label: "남반구 비교 지점",
  date: "2050-08-01",
  latitude: -33.8651,
  longitude: -151.2099,
  scenario: "고배출 경로",
  model: "MIROC6",
  values: [
    { key: "tasmax", label: "최고기온", unit: "도", value: 33.78 },
    { key: "apparentTemperature", label: "체감온도", unit: "도", value: 42.23 },
    { key: "precipitation", label: "강수량", unit: "밀리미터/일", value: 0.89 },
    { key: "wind", label: "풍속", unit: "미터/초", value: 4.1 }
  ]
};

test("학생 공유 상태는 한글을 포함해 왕복 복원된다", () => {
  const encoded = encodeLessonState({ ...context, focus: "heat", source: "public" });
  assert.deepEqual(decodeLessonState(encoded), { ...context, focus: "heat", source: "public" });
});

test("문제와 비교 기간을 포함한 공유 상태를 같은 판으로 복원한다", () => {
  const shared = {
    ...context,
    focus: "rain",
    source: "teacher",
    problemSetId: "southern-rain-shift",
    problemRevision: 3,
    periodStart: "2060-06-01",
    periodEnd: "2060-10-31"
  };
  assert.deepEqual(decodeLessonState(encodeLessonState(shared)), shared);
});

test("이전 판의 공유 상태도 계속 열 수 있다", () => {
  const legacy = Buffer.from(JSON.stringify({ version: 1, ...context, focus: "heat", source: "public" })).toString("base64url");
  assert.deepEqual(decodeLessonState(legacy), { ...context, focus: "heat", source: "public" });
});

test("손상되거나 범위를 벗어난 공유 상태는 거부한다", () => {
  assert.equal(decodeLessonState("not-valid"), undefined);
  assert.equal(decodeLessonState("x".repeat(4097)), undefined);
  assert.throws(() => encodeLessonState({ ...context, latitude: 90 }), RangeError);
  assert.throws(() => encodeLessonState({ ...context, periodStart: "2060-10-31", periodEnd: "2060-06-01" }), RangeError);
});

test("해시 경로와 수업 매개변수를 분리한다", () => {
  const parsed = parseHashLocation("#/query?lesson=abc");
  assert.equal(parsed.path, "/query");
  assert.equal(parsed.params.get("lesson"), "abc");
});

test("실제 수치가 있는 지표만 비교 스냅샷에 포함한다", () => {
  const baseline = createMetricSnapshot([
    { key: "tasmax", label: "최고기온", unit: "도", numericValue: 30, available: true },
    { key: "wind", label: "풍속", unit: "미터/초", available: false }
  ], { ...context, label: "기준" });
  const current = createMetricSnapshot([
    { key: "tasmax", label: "최고기온", unit: "도", numericValue: 32.5, available: true }
  ], { ...context, date: "2051-08-01", label: "현재" });
  assert.equal(baseline.values.length, 1);
  assert.equal(compareMetricSnapshots(baseline, current)[0].delta, 2.5);
});

test("비교 스냅샷은 시나리오가 다르면 별도 조건으로 식별한다", () => {
  const metrics = [{ key: "tasmax", label: "최고기온", unit: "℃", numericValue: 32.5, available: true }];
  const high = createMetricSnapshot(metrics, { ...context, scenario: "고배출 경로" });
  const medium = createMetricSnapshot(metrics, { ...context, scenario: "중간배출 경로" });
  assert.notEqual(high.id, medium.id);
  assert.equal(high.scenario, "고배출 경로");
  assert.equal(medium.scenario, "중간배출 경로");
});

test("메타데이터 선택지는 중복을 제거하고 빈 값이면 대체값을 쓴다", () => {
  assert.deepEqual(normalizeMetadataOptions({ models: ["A", "A", "B"] }, "models", ["기본"]), ["A", "B"]);
  assert.deepEqual(normalizeMetadataOptions({}, "models", ["기본"]), ["기본"]);
});

test("일반인 설명은 실제 제공 지표와 읽기 쉬운 표준 단위를 사용한다", () => {
  const summary = buildPlainLanguageSummary([
    { key: "tasmax", numericValue: 33.78, unit: "도", available: true },
    { key: "apparentTemperature", numericValue: 42.23, unit: "도", available: true },
    { key: "precipitation", numericValue: 0.89, unit: "밀리미터/일", available: true },
    { key: "wind", numericValue: 4.1, unit: "미터/초", available: true }
  ], "2050-08-01");
  assert.equal(summary, "예상 최고 기온은 33.78℃이며, 평균 일일 강수량은 0.89mm입니다. 이 날 체감온도는 42.23℃입니다. 평균 풍속은 4.1m/s입니다.\n이 값은 기후 시나리오에 근거한 자료이며 단기 일기예보가 아닙니다.");
});

test("일반인 설명은 시나리오 안내를 새 줄에 분리한다", () => {
  const summary = buildPlainLanguageSummary([
    { key: "tasmax", available: true, numericValue: 45.04 },
    { key: "precipitation", available: true, numericValue: 0 },
    { key: "wind", available: true, numericValue: 3.71 }
  ], "2050-08-01");

  assert.equal(summary, "예상 최고 기온은 45.04℃이며, 평균 일일 강수량은 0mm입니다. 평균 풍속은 3.71m/s입니다.\n이 값은 기후 시나리오에 근거한 자료이며 단기 일기예보가 아닙니다.");
});

test("일반 요약 카드는 지표별 표준 단위를 사용한다", () => {
  assert.equal(formatPublicMetricValue({ key: "tasmax", numericValue: 33.78, unit: "도" }), "33.78℃");
  assert.equal(formatPublicMetricValue({ key: "tasmin", numericValue: 21.5, unit: "도" }), "21.5℃");
  assert.equal(formatPublicMetricValue({ key: "apparentTemperature", numericValue: 42.23, unit: "도" }), "42.23℃");
  assert.equal(formatPublicMetricValue({ key: "heatIndex", numericValue: 40.2, unit: "도" }), "40.2℃");
  assert.equal(formatPublicMetricValue({ key: "feelsLike", numericValue: -2.4, unit: "도" }), "-2.4℃");
  assert.equal(formatPublicMetricValue({ key: "precipitation", numericValue: 0.89, unit: "밀리미터/일" }), "0.89 mm/day");
  assert.equal(formatPublicMetricValue({ key: "wind", numericValue: 4.1, unit: "미터/초" }), "4.1 m/s");
});

test("사용자 표시 좌표는 방향과 절댓값을 사용한다", () => {
  assert.equal(formatCoordinate(36.35, "latitude"), "N(북위) 36.3500");
  assert.equal(formatCoordinate(-33.8651, "latitude"), "S(남위) 33.8651");
  assert.equal(formatCoordinate(127.38, "longitude"), "E(동경) 127.3800");
  assert.equal(formatCoordinate(-151.2099, "longitude"), "W(서경) 151.2099");
  assert.equal(formatCoordinatePair(-33.8651, -151.2099), "S(남위) 33.8651, W(서경) 151.2099");
});

test("학생 탐구 기록 저장 텍스트는 표준 단위와 방향 좌표를 사용한다", () => {
  const notebook = buildStudentNotebookText({
    baseline: standardUnitSnapshot,
    focusLabel: "기온과 강수",
    note: "단위 확인"
  });

  assert.equal(notebook, [
    "기후 타임캡슐 탐구 기록",
    "탐구 주제: 기온과 강수",
    "",
    "비교 기준: 남반구 비교 지점",
    "날짜: 2050-08-01",
    "좌표: S(남위) 33.8651, W(서경) 151.2099",
    "최고기온: 33.78℃",
    "체감온도: 42.23℃",
    "강수량: 0.89 mm/day",
    "풍속: 4.1 m/s",
    "",
    "나의 발견",
    "단위 확인"
  ].join("\n"));
});

test("교사 수업 활동 저장 텍스트는 표준 단위와 방향 좌표를 사용한다", () => {
  const activity = buildTeacherActivityText({
    lessonTitle: "기후 단위 비교",
    objective: "표준 단위로 조건을 비교한다.",
    snapshots: [standardUnitSnapshot],
    studentLink: "https://example.test/#/query"
  });

  assert.equal(activity, [
    "기후 타임캡슐 수업 활동",
    "수업명: 기후 단위 비교",
    "학습 목표: 표준 단위로 조건을 비교한다.",
    "학생용 탐색 링크: https://example.test/#/query",
    "",
    "비교 조건",
    "1. 남반구 비교 지점 · 2050-08-01 · S(남위) 33.8651, W(서경) 151.2099 · 고배출 경로 · MIROC6",
    "   최고기온: 33.78℃",
    "   체감온도: 42.23℃",
    "   강수량: 0.89 mm/day",
    "   풍속: 4.1 m/s",
    "",
    "자료 안내: 기후 시나리오 교육용 결과이며 단기 기상예보가 아닙니다."
  ].join("\n"));
});

test("교사 수업 활동지는 질문부터 결과물과 해석 한계까지 보존한다", () => {
  const activity = buildTeacherActivityText({
    lessonTitle: "남부 강수 집중 시기 탐구",
    objective: "모델별 강수 집중 시기를 비교한다.",
    snapshots: [standardUnitSnapshot],
    studentLink: "https://example.test/#/query",
    inquiryQuestion: "우리가 알던 장마 시기가 달라질 가능성이 있을까?",
    periodStart: "2060-06-01",
    periodEnd: "2060-10-31",
    hypothesisChoices: ["집중 시기가 비슷함", "모델마다 다름"],
    expectedOutputs: ["모델별 비교표", "자료 한계"],
    assessmentCriteria: ["한 모델을 전체 결과로 일반화하지 않는다"],
    interpretationLimit: "강수량만으로 장마의 시작과 종료를 확정하지 않는다."
  });

  assert.match(activity, /탐구 질문: 우리가 알던 장마 시기가 달라질 가능성이 있을까\?/u);
  assert.match(activity, /탐구 기간: 2060-06-01 ~ 2060-10-31/u);
  assert.match(activity, /살펴볼 가능성\n1\. 집중 시기가 비슷함\n2\. 모델마다 다름/u);
  assert.match(activity, /학생 결과물\n- 모델별 비교표\n- 자료 한계/u);
  assert.match(activity, /교사 확인 기준\n- 한 모델을 전체 결과로 일반화하지 않는다/u);
  assert.match(activity, /해석할 때 주의할 점: 강수량만으로 장마의 시작과 종료를 확정하지 않는다\./u);
});

test("비교 기간이 여러 개면 대상 월과 함께 교사 활동지에 모두 남긴다", () => {
  const activity = buildTeacherActivityText({
    lessonTitle: "여름 비교",
    objective: "여름만 비교한다.",
    snapshots: [standardUnitSnapshot],
    studentLink: "https://example.test/#/query",
    comparisonPeriods: [
      { label: "중기 여름", start: "2041-01-01", end: "2050-12-31", seasonMonths: [6, 7, 8] },
      { label: "후기 여름", start: "2081-01-01", end: "2090-12-31", seasonMonths: [6, 7, 8] }
    ]
  });
  assert.match(activity, /- 중기 여름: 2041-01-01 ~ 2050-12-31 · 대상 월 6, 7, 8월/u);
  assert.match(activity, /- 후기 여름: 2081-01-01 ~ 2090-12-31 · 대상 월 6, 7, 8월/u);
});

test("계절 탐구는 지정한 월만 남기고 모든 지표 배열을 같은 길이로 자른다", () => {
  const response = {
    dates: ["2060-01-01", "2060-06-01", "2060-07-01", "2060-12-01"],
    metrics: [{
      key: "tasmax",
      corrected: { p10: [1, 2, 3, 4], p50: [5, 6, 7, 8], p90: [9, 10, 11, 12] },
      coverage: [true, true, false, true],
      modelCounts: [1, 2, 0, 3],
      availableCount: 3
    }]
  };
  const filtered = filterClimateSeriesByMonths(response, [6, 7, 8]);
  assert.deepEqual(filtered.dates, ["2060-06-01", "2060-07-01"]);
  assert.deepEqual(filtered.metrics[0].corrected.p50, [6, 7]);
  assert.deepEqual(filtered.metrics[0].coverage, [true, false]);
  assert.deepEqual(filtered.metrics[0].modelCounts, [2, 0]);
  assert.equal(filtered.metrics[0].availableCount, 1);
});

test("기간 자료 응답은 좌표·기간·시나리오·모델과 배열 길이가 모두 같아야 승인된다", () => {
  assert.equal(isMatchingClimateSeriesResponse(validSeriesResponse, validSeriesExpectation), true);
  assert.equal(isMatchingClimateSeriesResponse(
    { ...validSeriesResponse, dataMode: "raw-model-grid" },
    { ...validSeriesExpectation, dataMode: "raw-model-grid" }
  ), true);
  assert.equal(isMatchingClimateSeriesResponse(
    { ...validSeriesResponse, includeRaw: true },
    { ...validSeriesExpectation, includeRaw: true }
  ), true);
  assert.equal(isMatchingClimateSeriesResponse({ ...validSeriesResponse, longitude: 129.08 }, validSeriesExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({ ...validSeriesResponse, scenario: "다른 경로" }, validSeriesExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({ ...validSeriesResponse, model: "EC-Earth3" }, validSeriesExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({ ...validSeriesResponse, attributionReady: false }, validSeriesExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({ ...validSeriesResponse, attributionLabels: [] }, validSeriesExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({ ...validSeriesResponse, dataMode: "raw-model-grid" }, validSeriesExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({ ...validSeriesResponse, includeRaw: true }, validSeriesExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({
    ...validSeriesResponse,
    metrics: [{ ...validSeriesResponse.metrics[0], coverage: [true] }]
  }, validSeriesExpectation), false);
});

test("자료판 갱신 뒤에는 같은 조건의 원자료와 보정 자료 전환을 모두 허용한다", () => {
  const refreshedExpectation = { ...validSeriesExpectation, dataMode: undefined };
  assert.equal(isMatchingClimateSeriesResponse(validSeriesResponse, refreshedExpectation), true);
  assert.equal(isMatchingClimateSeriesResponse({
    ...validSeriesResponse,
    dataMode: "raw-model-grid"
  }, refreshedExpectation), true);
  assert.equal(isMatchingClimateSeriesResponse({
    ...validSeriesResponse,
    dataMode: "unknown-mode"
  }, refreshedExpectation), false);
  assert.equal(isMatchingClimateSeriesResponse({
    ...validSeriesResponse,
    dataMode: "raw-model-grid"
  }, validSeriesExpectation), false);
});

test("기간 자료 응답은 저장소 주소와 내부 파일 형식을 공개 화면에서 거부한다", () => {
  const unsafeValues = [
    "gs://synthetic-private-bucket/cmip6.zarr",
    "https://drive.google.com/drive/folders/private",
    "D:\\private\\climate.ctwebui",
    "/mnt/private/model.parquet"
  ];
  unsafeValues.forEach((unsafe) => {
    assert.equal(isPublicGatewayTextSafe(unsafe), false);
    assert.equal(isMatchingClimateSeriesResponse({
      ...validSeriesResponse,
      attributionLabels: [unsafe]
    }, validSeriesExpectation), false);
    assert.equal(isMatchingClimateSeriesResponse({
      ...validSeriesResponse,
      fallbackReason: unsafe
    }, validSeriesExpectation), false);
  });
  assert.equal(isPublicClimateTextPayloadSafe(validSeriesResponse), true);
});

test("자료 내보내기는 허용하지 않은 출처 문구가 있으면 파일 생성을 중단한다", () => {
  assert.throws(() => buildClimateCsv({
    ...validSeriesResponse,
    attributionLabels: ["gs://synthetic-private-bucket/cmip6.zarr"]
  }), /공개할 수 없는 연결 정보/u);
  assert.throws(() => buildClimateCsv({
    ...validSeriesResponse,
    attributionReady: false
  }), /공개할 수 없는 연결 정보/u);
  assert.throws(() => buildClimateCsv({
    ...validSeriesResponse,
    attributionLabels: []
  }), /공개할 수 없는 연결 정보/u);
});

test("CSV 텍스트는 스프레드시트 수식으로 실행되지 않게 저장한다", () => {
  const csv = buildClimateCsv({
    ...validSeriesResponse,
    scenario: "=1+1"
  });
  assert.match(csv, /"'=1\+1"/u);
  assert.match(csv, /"-?\d+(?:\.\d+)?"/u);
});

test("계절 자료의 긴 날짜 공백은 그래프에서 이어 그리지 않는다", () => {
  assert.equal(isContinuousSampledDateRange(["2060-01-01", "2060-01-02"], 0, 1), true);
  assert.equal(isContinuousSampledDateRange(["2060-01-01", "2060-01-02", "2060-01-03"], 0, 2), true);
  assert.equal(isContinuousSampledDateRange(["2060-02-28", "2060-06-01"], 0, 1), false);
});

test("기후모델 원자료는 CSV의 raw 열에 기록한다", () => {
  const metric = {
    corrected: { p10: [1], p50: [2], p90: [3] }
  };
  assert.deepEqual(resolveExportPercentiles(metric, "raw-model-grid"), {
    corrected: undefined,
    raw: metric.corrected
  });
  assert.deepEqual(resolveExportPercentiles(metric, "corrected"), {
    corrected: metric.corrected,
    raw: undefined
  });
});

test("연구용 CSV는 생성 시각과 자료 출처 및 월별 체감 기준을 보존한다", () => {
  const csv = buildClimateCsv({
    attributionReady: true,
    attributionLabels: ["국제기후모델 시나리오 자료", "관측자료 기반 보정"],
    dataMode: "bias-corrected",
    dates: ["2050-01-15", "2050-08-15"],
    generatedAt: "2026-07-13T00:00:00Z",
    latitude: 36.35,
    longitude: 127.38,
    model: "MIROC6",
    nearestDistanceKm: 1.2345,
    scenario: "고배출 경로",
    metrics: [{
      key: "apparentTemperature",
      label: "월별 체감 지표",
      unit: "도",
      corrected: { p10: [-5, 38], p50: [-3, 42], p90: [-1, 46] },
      raw: { p10: [-6, 37], p50: [-4, 41], p90: [-2, 45] },
      coverage: [true, true],
      modelCounts: [1, 1]
    }]
  });
  const [header, winter, summer] = csv.split("\r\n");
  assert.match(header, /"generated_at","attribution_labels","problem_id","problem_revision","problem_title","interpretation_limit","season_months"$/u);
  assert.match(winter, /"feels_like"/u);
  assert.match(summer, /"heat_index"/u);
  assert.match(summer, /"2026-07-13T00:00:00Z","국제기후모델 시나리오 자료 \| 관측자료 기반 보정","","","","",""$/u);
  assert.match(summer, /"1\.234"/u);
});

test("CSV의 기계 판독용 위경도는 음수 부호를 보존한다", () => {
  const csv = buildClimateCsv({
    attributionReady: true,
    attributionLabels: ["국제기후모델 시나리오 자료"],
    dataMode: "bias-corrected",
    dates: ["2050-08-01"],
    latitude: -33.8651,
    longitude: -151.2099,
    model: "MIROC6",
    scenario: "고배출 경로",
    metrics: [{
      key: "wind",
      label: "풍속",
      unit: "미터/초",
      corrected: { p10: [3], p50: [4.1], p90: [5] },
      raw: { p10: [2.8], p50: [3.9], p90: [4.8] },
      coverage: [true],
      modelCounts: [1]
    }]
  });
  const [, row] = csv.split("\r\n");

  assert.match(row, /^"2050-08-01","-33\.865100","-151\.209900",/u);
});

test("월별 체감 기준은 5~9월 열지수, 나머지 달은 체감기온이다", () => {
  assert.equal(apparentTemperatureBasis("2050-05-01").key, "heat_index");
  assert.equal(apparentTemperatureBasis("2050-09-30").key, "heat_index");
  assert.equal(apparentTemperatureBasis("2050-10-01").key, "feels_like");
  assert.equal(apparentTemperatureBasis("2050-04-30").key, "feels_like");
});

test("단일 날짜 그래프는 가로축 중앙에 점을 배치한다", () => {
  assert.equal(seriesPointX(0, 1, 48, 692), 394);
  assert.equal(seriesPointX(0, 2, 48, 692), 48);
  assert.equal(seriesPointX(1, 2, 48, 692), 740);
  assert.throws(() => seriesPointX(0, 0, 48, 692), TypeError);
});

test("학습 기록은 제어문자를 제거하고 길이를 제한한다", () => {
  assert.equal(sanitizeNote("관찰\u0000 내용"), "관찰 내용");
  assert.equal(sanitizeNote("가".repeat(2500)).length, 2000);
});

test("5년과 10년 기간은 윤년을 포함한 달력 연도로 계산한다", () => {
  assert.equal(calendarPeriodEnd("2050-08-02", 5), "2055-08-01");
  assert.equal(calendarPeriodEnd("2050-08-02", 10), "2060-08-01");
  assert.equal(calendarPeriodEnd("2048-02-29", 1), "2049-02-28");
});

test("조회 날짜는 연도, 월, 일이 모두 유효하고 제공 범위 안에 있어야 한다", () => {
  assert.equal(isCompleteDateValue("2050"), false);
  assert.equal(isCompleteDateValue("2050-08"), false);
  assert.equal(isCompleteDateValue("2050-02-31"), false);
  assert.equal(isCompleteDateValue("2050-08-01", { min: "2035-01-01", max: "2099-12-31" }), true);
  assert.equal(isCompleteDateValue("2100-01-01", { min: "2035-01-01", max: "2099-12-31" }), false);
});

test("지도 휠은 2~10단계 범위에서 확대와 축소를 계산한다", () => {
  assert.equal(mapZoomAfterWheel(5, -120), 6);
  assert.equal(mapZoomAfterWheel(5, 120), 4);
  assert.equal(mapZoomAfterWheel(10, -120), 10);
  assert.equal(mapZoomAfterWheel(2, 120), 2);
});

test("지도 마커는 축소 화면에서 작아지고 확대 화면에서 제한적으로 커진다", () => {
  assert.equal(mapMarkerSizeForZoom(2), 32);
  assert.equal(mapMarkerSizeForZoom(5), 44);
  assert.equal(mapMarkerSizeForZoom(8), 54);
  assert.equal(mapMarkerSizeForZoom(10), 54);
  assert.equal(mapMarkerSizeForZoom(Number.NaN), 44);
});

test("지도 축척은 확대할수록 더 짧은 실제 거리를 표시한다", () => {
  const wide = mapScaleForZoom(36.35, 4);
  const close = mapScaleForZoom(36.35, 7);
  assert.ok(wide.kilometres > close.kilometres);
  assert.match(wide.label, /km|m/u);
  assert.ok(wide.width > 0 && wide.width <= 48);
});
