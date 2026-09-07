import test from "node:test";
import assert from "node:assert/strict";
import {
  CTWEBUI_V3_PUBLIC_CAPABILITIES,
  publicCoverageLabel,
  resolvePublicQueryMetricDisplay,
  resolvePublicSeriesMetricDisplay,
  validatePublicQueryDisplayShape,
  validatePublicSeriesDisplayShape
} from "../source/climate-result-model.js";

const seriesGroup = Object.freeze({
  p10: [null, 20],
  p50: [null, 25],
  p90: [null, 30]
});

test("ctwebui v3 내부 품질 코드는 공개 계약에 없으므로 추정하지 않는다", () => {
  assert.deepEqual(CTWEBUI_V3_PUBLIC_CAPABILITIES, {
    coverage: "public",
    missingReason: "not-exposed",
    qualityStatus: "not-exposed"
  });
});

test("raw-model-grid의 역사적 corrected 슬롯을 원자료 주계열로 해석한다", () => {
  const display = resolvePublicSeriesMetricDisplay({ corrected: seriesGroup }, "raw-model-grid");

  assert.equal(display.primaryKind, "raw");
  assert.equal(display.primaryLabel, "기후 모델 원자료");
  assert.equal(display.primary, seriesGroup);
  assert.equal(display.comparison, undefined);
  assert.equal(display.comparisonLabel, "");
});

test("raw-model-grid의 명시적 raw 계열을 corrected 슬롯보다 우선한다", () => {
  const corrected = { p10: [null], p50: [null], p90: [null] };
  const raw = { p10: [10], p50: [15], p90: [20] };
  const display = resolvePublicSeriesMetricDisplay({ corrected, raw }, "raw-model-grid");

  assert.equal(display.primaryKind, "raw");
  assert.equal(display.primary, raw);
  assert.equal(display.comparison, undefined);
});

test("bias-corrected는 보정 후 주계열과 보정 전 비교 계열을 분리한다", () => {
  const raw = { p10: [10], p50: [15], p90: [20] };
  const corrected = { p10: [11], p50: [16], p90: [21] };
  const display = resolvePublicSeriesMetricDisplay({ corrected, raw }, "bias-corrected");

  assert.equal(display.primaryKind, "corrected");
  assert.equal(display.primary, corrected);
  assert.equal(display.comparison, raw);
  assert.equal(display.comparisonLabel, "보정 전");
});

test("query 표시 모델은 raw 결과에 보정 전 비교값을 만들지 않는다", () => {
  const display = resolvePublicQueryMetricDisplay({
    available: true,
    value: "28.0",
    numericValue: 28,
    rawValue: "위조하면 안 되는 값",
    rawNumericValue: 99
  }, "raw-model-grid");

  assert.equal(display.primaryKind, "raw");
  assert.equal(display.primaryNumericValue, 28);
  assert.equal(display.comparisonValue, undefined);
  assert.equal(display.comparisonNumericValue, undefined);
});

test("결측은 null과 coverage 의미를 보존하며 0으로 채우지 않는다", () => {
  const display = resolvePublicSeriesMetricDisplay({ corrected: seriesGroup }, "bias-corrected");

  assert.equal(display.primary.p50[0], null);
  assert.notEqual(display.primary.p50[0], 0);
  assert.equal(publicCoverageLabel("available"), "전체 자료");
  assert.equal(publicCoverageLabel("fallback"), "일부 또는 대체 자료");
  assert.equal(publicCoverageLabel("missing"), "자료 없음");
});

test("알 수 없는 dataMode와 coverage는 fail-closed 한다", () => {
  assert.throws(
    () => resolvePublicSeriesMetricDisplay({ corrected: seriesGroup }, "legacy"),
    /dataMode/u
  );
  assert.throws(() => publicCoverageLabel("unknown"), /coverage/u);
});

test("query는 가용 상태와 유한 주값이 일치해야 한다", () => {
  const response = {
    coverage: "available",
    dataMode: "bias-corrected",
    values: [{ available: true, numericValue: 21.5, value: "21.5" }]
  };
  assert.equal(validatePublicQueryDisplayShape(response), response);
  assert.throws(
    () => validatePublicQueryDisplayShape({
      ...response,
      values: [{ available: true, value: "자료 없음" }]
    }),
    /가용 상태/u
  );
  assert.throws(
    () => validatePublicQueryDisplayShape({ ...response, coverage: "missing" }),
    /coverage/u
  );
  assert.throws(
    () => validatePublicQueryDisplayShape({
      ...response,
      values: [{ available: false, value: "자료 없음" }]
    }),
    /coverage/u
  );
});

test("series는 날짜·값·coverage·modelCounts 길이와 availableCount를 함께 검증한다", () => {
  const response = {
    coverage: "fallback",
    dataMode: "bias-corrected",
    dates: ["2050-01-01", "2050-01-02"],
    includeRaw: false,
    metrics: [{
      corrected: seriesGroup,
      coverage: [false, true],
      modelCounts: [0, 1],
      availableCount: 1
    }]
  };
  assert.equal(validatePublicSeriesDisplayShape(response), response);
  assert.throws(
    () => validatePublicSeriesDisplayShape({
      ...response,
      metrics: [{ ...response.metrics[0], coverage: [false, true], availableCount: 2 }]
    }),
    /coverage/u
  );
  assert.throws(
    () => validatePublicSeriesDisplayShape({
      ...response,
      metrics: [{
        ...response.metrics[0],
        corrected: { p10: [10, 20], p50: [15, 25], p90: [20, 30] }
      }]
    }),
    /coverage와 주계열/u
  );
  assert.throws(
    () => validatePublicSeriesDisplayShape({
      ...response,
      metrics: [{
        ...response.metrics[0],
        corrected: { p10: [null, null], p50: [null, null], p90: [null, null] }
      }]
    }),
    /coverage와 주계열/u
  );
  assert.throws(
    () => validatePublicSeriesDisplayShape({ ...response, coverage: "missing" }),
    /coverage와 가용 값/u
  );
  assert.throws(
    () => validatePublicSeriesDisplayShape({
      ...response,
      includeRaw: true,
      metrics: [{
        ...response.metrics[0],
        raw: { p10: [null, 10], p50: [5, 15], p90: [null, 20] }
      }]
    }),
    /비교 계열/u
  );
});

test("공개 응답의 dataMode와 비교 계열 조합은 fail-closed 한다", () => {
  assert.throws(
    () => validatePublicQueryDisplayShape({
      coverage: "fallback",
      dataMode: "raw-model-grid",
      values: [{
        available: true,
        numericValue: 20,
        value: "20",
        rawNumericValue: 19,
        rawValue: "19"
      }]
    }),
    /비교값/u
  );

  const rawResponse = {
    coverage: "fallback",
    dataMode: "raw-model-grid",
    dates: ["2050-01-01"],
    includeRaw: false,
    metrics: [{
      corrected: { p10: [10], p50: [15], p90: [20] },
      coverage: [true],
      modelCounts: [1],
      availableCount: 1
    }]
  };
  assert.throws(
    () => validatePublicSeriesDisplayShape({ ...rawResponse, includeRaw: true }),
    /비교 계열을 요청/u
  );
  assert.equal(validatePublicSeriesDisplayShape({
    ...rawResponse,
    metrics: [{
      ...rawResponse.metrics[0],
      corrected: { p10: [null], p50: [null], p90: [null] },
      raw: rawResponse.metrics[0].corrected
    }]
  }).metrics[0].raw.p50[0], 15);

  assert.throws(
    () => validatePublicSeriesDisplayShape({
      ...rawResponse,
      metrics: [{
        ...rawResponse.metrics[0],
        corrected: { p10: [null], p50: [null], p90: [null] }
      }]
    }),
    /coverage와 주계열/u
  );

  assert.throws(
    () => validatePublicSeriesDisplayShape({
      ...rawResponse,
      dataMode: "bias-corrected",
      includeRaw: true
    }),
    /includeRaw/u
  );
});
