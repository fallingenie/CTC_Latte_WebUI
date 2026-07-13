import test from "node:test";
import assert from "node:assert/strict";
import {
  apparentTemperatureBasis,
  buildClimateCsv,
  buildPlainLanguageSummary,
  calendarPeriodEnd,
  compareMetricSnapshots,
  createMetricSnapshot,
  decodeLessonState,
  encodeLessonState,
  formatPublicMetricValue,
  isCompleteDateValue,
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

test("학생 공유 상태는 한글을 포함해 왕복 복원된다", () => {
  const encoded = encodeLessonState({ ...context, focus: "heat", source: "public" });
  assert.deepEqual(decodeLessonState(encoded), { ...context, focus: "heat", source: "public" });
});

test("손상되거나 범위를 벗어난 공유 상태는 거부한다", () => {
  assert.equal(decodeLessonState("not-valid"), undefined);
  assert.throws(() => encodeLessonState({ ...context, latitude: 90 }), RangeError);
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
  assert.equal(formatPublicMetricValue({ key: "tasmax", numericValue: 33.78 }), "33.78℃");
  assert.equal(formatPublicMetricValue({ key: "tasmin", numericValue: 21.5 }), "21.5℃");
  assert.equal(formatPublicMetricValue({ key: "apparentTemperature", numericValue: 42.23 }), "42.23℃");
  assert.equal(formatPublicMetricValue({ key: "precipitation", numericValue: 0.89 }), "0.89 mm/day");
  assert.equal(formatPublicMetricValue({ key: "wind", numericValue: 4.1 }), "4.1 m/s");
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
    attributionLabels: ["자료 제공자 A", "자료 제공자 B"],
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
  assert.match(header, /"generated_at","attribution_labels"$/u);
  assert.match(winter, /"feels_like"/u);
  assert.match(summer, /"heat_index"/u);
  assert.match(summer, /"2026-07-13T00:00:00Z","자료 제공자 A \| 자료 제공자 B"$/u);
  assert.match(summer, /"1\.234"/u);
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
