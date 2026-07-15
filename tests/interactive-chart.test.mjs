import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInteractiveClimateHtml,
  chartComparison,
  chartWindowAfterPan,
  chartWindowAfterWheel
} from "../source/workbench-logic.js";

function windowSize(window) {
  return window.end - window.start;
}

function cursorValue(window, ratio) {
  return window.start + windowSize(window) * ratio;
}

const response = {
  dateStart: "2050-08-01",
  dateEnd: "2050-08-04",
  dates: ["2050-08-01", "2050-08-02", "2050-08-03", "2050-08-04"],
  latitude: -33.8651,
  longitude: 151.2099,
  scenario: "고배출 경로",
  model: "MIROC6",
  dataMode: "corrected",
  generatedAt: "2026-07-13T00:00:00.000Z",
  attributionReady: true,
  attributionLabels: ["국제기후모델 시나리오 자료"],
  storagePath: "G:\\내 드라이브\\ctc_latte\\비공개",
  metrics: [
    {
      key: "tasmax",
      label: "최고기온",
      unit: "℃",
      availableCount: 4,
      corrected: {
        p10: [28, 29, 30, 31],
        p50: [30, 31, 33, 32],
        p90: [32, 33, 35, 34]
      },
      raw: {
        p10: [27, 28, 29, 30],
        p50: [29, 30, 32, 31],
        p90: [31, 32, 34, 33]
      }
    }
  ]
};

test("휠 확대는 마우스 위치의 날짜를 유지하며 표시 범위를 줄인다", () => {
  const initial = { start: 0, end: 100 };
  const ratio = 0.25;
  const zoomed = chartWindowAfterWheel({
    ...initial,
    total: 100,
    ratio,
    deltaY: -120,
    minWindow: 7
  });

  assert.ok(windowSize(zoomed) < windowSize(initial));
  assert.ok(Math.abs(cursorValue(zoomed, ratio) - cursorValue(initial, ratio)) <= 1);
  assert.ok(zoomed.start >= 0);
  assert.ok(zoomed.end <= 100);
});

test("휠 확대와 축소는 최소 표시 기간과 전체 자료 경계를 지킨다", () => {
  const minimum = chartWindowAfterWheel({
    start: 20,
    end: 40,
    total: 100,
    ratio: 0.5,
    deltaY: -100000,
    minWindow: 7
  });
  assert.ok(windowSize(minimum) >= 7);
  assert.ok(minimum.start >= 0);
  assert.ok(minimum.end <= 100);

  const full = chartWindowAfterWheel({
    start: 0,
    end: 100,
    total: 100,
    ratio: 0.5,
    deltaY: 100000,
    minWindow: 7
  });
  assert.deepEqual(full, { start: 0, end: 100 });

  const edge = chartWindowAfterWheel({
    start: 0,
    end: 20,
    total: 100,
    ratio: 0,
    deltaY: 120,
    minWindow: 7
  });
  assert.equal(edge.start, 0);
  assert.ok(edge.end <= 100);
});

test("드래그 이동은 기간 폭을 유지하며 자료 시작과 끝에서 멈춘다", () => {
  assert.deepEqual(
    chartWindowAfterPan({ start: 20, end: 40, total: 100, delta: 10 }),
    { start: 30, end: 50 }
  );
  assert.deepEqual(
    chartWindowAfterPan({ start: 20, end: 40, total: 100, delta: -100 }),
    { start: 0, end: 20 }
  );
  assert.deepEqual(
    chartWindowAfterPan({ start: 80, end: 100, total: 100, delta: 100 }),
    { start: 80, end: 100 }
  );
});

test("첫 번째 값과의 차이와 변화율을 계산하고 계산 불가 값은 null로 둔다", () => {
  assert.deepEqual(chartComparison(15, 10), { delta: 5, percent: 50 });
  assert.deepEqual(chartComparison(8, 10), { delta: -2, percent: -20 });
  assert.deepEqual(chartComparison(5, 0), { delta: 5, percent: null });
  assert.deepEqual(chartComparison(null, 10), { delta: null, percent: null });
  assert.deepEqual(chartComparison(10, Number.NaN), { delta: null, percent: null });
});

test("대화형 HTML은 외부 의존성 없이 가리키기·휠·끌기·날짜 비교를 제공한다", () => {
  const html = buildInteractiveClimateHtml(response);

  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<style(?:\s|>)/i);
  assert.match(html, /<script id="climate-data" type="application\/json">/i);
  assert.match(html, /<script(?:\s|>)/i);
  assert.match(html, /마우스 휠/);
  assert.match(html, /끌어/);
  assert.match(html, /첫 번째 비교 날짜|첫 번째 날짜/);
  assert.match(html, /날짜를 눌러 정하기/);
  assert.doesNotMatch(html, /날짜를 눌러 저장/);
  assert.match(html, /id="clear-reference" type="button" hidden>비교 날짜 지우기/);
  assert.match(html, /clear-reference"\)\.hidden=state\.reference===null/);
  assert.match(html, /변화율/);
  assert.match(html, /확대/);
  assert.match(html, /축소/);
  assert.match(html, /초기화|전체 보기/);
  assert.match(html, /2050-08-01/);
  assert.match(html, /최고기온/);

  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /file:\/\//i);
  assert.doesNotMatch(html, /G:\\|ctc_latte|내 드라이브/i);

  const executableScript = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/giu)].at(-1)?.[1];
  assert.ok(executableScript);
  assert.doesNotThrow(() => new Function(executableScript));
});

test("대화형 HTML은 결측값을 0으로 바꾸지 않고 null로 보존한다", () => {
  const responseWithMissing = structuredClone(response);
  responseWithMissing.metrics[0].corrected.p50[1] = null;
  const html = buildInteractiveClimateHtml(responseWithMissing);
  const serialized = html.match(/<script id="climate-data" type="application\/json">([^<]+)<\/script>/u)?.[1];

  assert.ok(serialized);
  const payload = JSON.parse(serialized);
  assert.equal(payload.metrics[0].corrected.p50[1], null);
});

test("대화형 HTML은 계절 사이의 긴 공백을 선과 범위로 이어 그리지 않는다", () => {
  const seasonal = structuredClone(response);
  seasonal.dateStart = "2060-02-28";
  seasonal.dateEnd = "2060-06-02";
  seasonal.dates = ["2060-02-28", "2060-06-01", "2060-06-02", "2061-02-28"];
  const html = buildInteractiveClimateHtml(seasonal);

  assert.match(html, /const continuous=/u);
  assert.match(html, /actualDays>=sampledSteps&&actualDays<=sampledSteps\+1/u);
  assert.match(html, /function segmentedIndexes/u);
  assert.match(html, /bandPath\(currentMetric,yAt\)/u);
  assert.match(html, /previousIndex!==null&&continuous\(previousIndex,index\)\?" L":" M"/u);
});
