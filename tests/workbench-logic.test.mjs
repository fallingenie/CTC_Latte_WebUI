import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlainLanguageSummary,
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

test("일반인 설명은 실제 제공 지표만 사용한다", () => {
  const summary = buildPlainLanguageSummary([
    { key: "tasmax", numericValue: 33.2, unit: "도", available: true },
    { key: "wind", numericValue: 4.1, unit: "미터/초", available: true }
  ], "2050-08-01");
  assert.match(summary, /33.2/);
  assert.match(summary, /4.1/);
  assert.match(summary, /단기 일기예보가 아닙니다/);
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

test("지도 축척은 확대할수록 더 짧은 실제 거리를 표시한다", () => {
  const wide = mapScaleForZoom(36.35, 4);
  const close = mapScaleForZoom(36.35, 7);
  assert.ok(wide.kilometres > close.kilometres);
  assert.match(wide.label, /km|m/u);
  assert.ok(wide.width > 0 && wide.width <= 48);
});
