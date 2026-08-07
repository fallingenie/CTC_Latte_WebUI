import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPublicExportAttribution } from "../source/export-attribution.js";
import {
  buildInteractiveClimateHtml,
  chartComparison,
  chartWindowAfterPan,
  chartWindowAfterWheel
} from "../source/workbench-logic.js";

const kmaMarkNames = ["kma_mark_1.png", "kma_mark_2.png"];
const kmaMarkDataUrls = await Promise.all(kmaMarkNames.map(async (name) => {
  const relativePath = `../source/public/assets/licenses/${name}`;
  const bytes = await fs.readFile(fileURLToPath(new URL(relativePath, import.meta.url)));
  return { name, dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
}));
const datasetVersion = "b".repeat(64);
const datasetUpdatedAt = "2026-07-15T02:30:40.123456Z";

const dwdProvider = Object.freeze({
  providerId: "dwd",
  name: "Deutscher Wetterdienst Climate Data Center",
  dataset: "dwd_cdc_hourly_observations",
  licenseName: "CC BY 4.0",
  licenseUrl: "https://www.dwd.de/EN/service/legal_notice/templates_dwd_as_source.html",
  citation: "Deutscher Wetterdienst, Climate Data Center hourly station observations.",
  attributionText: "Based on data from Deutscher Wetterdienst (DWD), Climate Data Center; processed by Climate Time Capsule.",
  redistributionPolicy: "cc_by_4_0_with_source_and_modification_notice",
  usedRowCount: 96,
  attributionRequired: true,
  requiresResultMark: false,
  markAssets: []
});

const dwdObservationAttribution = Object.freeze({
  schemaVersion: 1,
  ready: true,
  usesObservationData: true,
  providerIds: ["dwd"],
  providers: [dwdProvider]
});

const rawObservationAttribution = Object.freeze({
  schemaVersion: 1,
  ready: true,
  usesObservationData: false,
  providerIds: [],
  providers: []
});

const kmaProvider = Object.freeze({
  providerId: "kma",
  name: "Korea Meteorological Administration",
  dataset: "ASOS hourly observations",
  licenseName: "공공누리 제1유형",
  licenseUrl: "https://www.data.go.kr/data/15057210/openapi.do",
  citation: "Korea Meteorological Administration, ASOS hourly observations.",
  attributionText: "Based on Korea Meteorological Administration ASOS observations; processed by Climate Time Capsule.",
  redistributionPolicy: "source_attribution_and_result_marks_required",
  usedRowCount: 96,
  attributionRequired: true,
  requiresResultMark: true,
  markAssets: [
    {
      name: "kma_mark_1.png",
      path: "licenses/kma_mark_1.png",
      sha256: "8248bb099a0c05b9819d60a9423673582d143cfc909cc22a9ffcb3e6770c6b06",
      sizeBytes: 7485,
      mediaType: "image/png"
    },
    {
      name: "kma_mark_2.png",
      path: "licenses/kma_mark_2.png",
      sha256: "4e489d7721cd2b629c28a0aebb54e3f7668f257185949e77fda9b008f35ed8f8",
      sizeBytes: 10205,
      mediaType: "image/png"
    }
  ]
});

const kmaObservationAttribution = Object.freeze({
  schemaVersion: 1,
  ready: true,
  usesObservationData: true,
  providerIds: ["kma"],
  providers: [kmaProvider]
});

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
  dataMode: "bias-corrected",
  generatedAt: "2026-07-13T00:00:00.000Z",
  datasetVersion,
  datasetUpdatedAt,
  attributionReady: true,
  observationAttribution: dwdObservationAttribution,
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

function attributionFor(seriesResponse, markDataUrls = []) {
  return {
    ...buildPublicExportAttribution({
      dataMode: seriesResponse.dataMode,
      model: seriesResponse.model,
      observationAttribution: seriesResponse.observationAttribution,
      datasetVersion: seriesResponse.datasetVersion,
      datasetUpdatedAt: seriesResponse.datasetUpdatedAt,
      generatedAt: seriesResponse.generatedAt
    }),
    markDataUrls
  };
}

function rawResponse(overrides = {}) {
  return {
    ...structuredClone(response),
    dataMode: "raw-model-grid",
    attributionReady: false,
    observationAttribution: rawObservationAttribution,
    attributionLabels: ["국제기후모델 시나리오 원자료"],
    ...overrides
  };
}

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
  const attribution = attributionFor(response);
  const html = buildInteractiveClimateHtml(response, attribution);

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
  assert.match(html, /CMIP6\/downscaleCMIP6 출처·인용/u);
  assert.match(html, /관측자료 기반 보정값/u);
  assert.match(html, /Deutscher Wetterdienst Climate Data Center 관측자료를 사용해 보정한 값/u);
  assert.match(html, /dwd_cdc_hourly_observations/u);
  assert.match(html, /Based on data from Deutscher Wetterdienst/u);
  assert.match(html, /CC BY 4\.0/u);
  assert.match(html, new RegExp(datasetVersion, "u"));
  assert.match(html, new RegExp(datasetUpdatedAt.replaceAll(".", "\\."), "u"));
  assert.match(html, /Geonho Kim \(김건호\)/u);
  assert.match(html, /GitHub @fallingenie/u);
  const serializedPayload = html.match(/<script id="climate-data" type="application\/json">([^<]+)<\/script>/u)?.[1];
  assert.ok(serializedPayload);
  assert.deepEqual(JSON.parse(serializedPayload).observationAttribution, dwdObservationAttribution);

  for (const citation of attribution.climateModels.flatMap((model) => model.citations)) {
    assert.ok(html.includes(`href="${citation.source.url}"`));
    assert.ok(html.includes(`DOI ${citation.source.doi}`));
  }
  for (const reference of attribution.methodologyReferences) {
    assert.ok(html.includes(`href="${reference.source.url}"`));
    assert.ok(html.includes(`DOI ${reference.source.doi}`));
  }
  const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/giu)].map((match) => match[1]);
  assert.deepEqual(imageSources, []);

  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
  assert.doesNotMatch(html, /<img[^>]+src="https?:\/\//i);
  const htmlWithoutInlineImages = html.replace(/data:image\/png;base64,[a-z0-9+/=]+/giu, "data:image/png;base64,[embedded]");
  assert.doesNotMatch(htmlWithoutInlineImages, /file:\/\//i);
  assert.ok(!htmlWithoutInlineImages.includes(response.storagePath));
  assert.doesNotMatch(htmlWithoutInlineImages, /G:\\|내 드라이브|비공개/iu);
  const externalLinks = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]+rel="noopener noreferrer"/giu)]
    .map((match) => match[1]);
  assert.ok(externalLinks.length > 0);
  assert.ok(externalLinks.every((href) => (
    /^https:\/\/doi\.org\//u.test(href)
    || /^https:\/\/github\.com\//u.test(href)
    || href === dwdProvider.licenseUrl
  )));

  const executableScript = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/giu)].at(-1)?.[1];
  assert.ok(executableScript);
  assert.doesNotThrow(() => new Function(executableScript));
});

test("대화형 HTML은 결측값을 0으로 바꾸지 않고 null로 보존한다", () => {
  const responseWithMissing = structuredClone(response);
  responseWithMissing.metrics[0].corrected.p50[1] = null;
  const html = buildInteractiveClimateHtml(responseWithMissing, attributionFor(responseWithMissing));
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
  const html = buildInteractiveClimateHtml(seasonal, attributionFor(seasonal));

  assert.match(html, /const continuous=/u);
  assert.match(html, /actualDays>=sampledSteps&&actualDays<=sampledSteps\+1/u);
  assert.match(html, /function segmentedIndexes/u);
  assert.match(html, /bandPath\(currentMetric,yAt\)/u);
  assert.match(html, /previousIndex!==null&&continuous\(previousIndex,index\)\?" L":" M"/u);
});

test("대화형 HTML은 원자료 격자값에 관측 제공자를 추론하지 않는다", () => {
  const rawSeriesResponse = rawResponse();
  const html = buildInteractiveClimateHtml(rawSeriesResponse, attributionFor(rawSeriesResponse));

  assert.match(html, /기후 모델 원자료 격자값/u);
  assert.match(html, /관측자료를 사용한 보정은 적용하지 않았습니다/u);
  assert.match(html, /이 결과에는 관측자료 제공자 자료를 사용하지 않았습니다/u);
  assert.doesNotMatch(html, /KMA|ASOS|Deutscher Wetterdienst/u);
  const serialized = html.match(/<script id="climate-data" type="application\/json">([^<]+)<\/script>/u)?.[1];
  assert.ok(serialized);
  assert.deepEqual(JSON.parse(serialized).observationAttribution, rawObservationAttribution);
});

test("대화형 HTML은 Backend가 요구한 로컬 검증 결과 표장만 이름과 순서대로 포함한다", () => {
  const markedResponse = {
    ...structuredClone(response),
    observationAttribution: kmaObservationAttribution
  };
  const html = buildInteractiveClimateHtml(markedResponse, attributionFor(markedResponse, kmaMarkDataUrls));
  const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/giu)].map((match) => match[1]);

  assert.deepEqual(imageSources, kmaMarkDataUrls.map((mark) => mark.dataUrl));
  assert.match(html, /Korea Meteorological Administration/u);
  assert.match(html, /공공누리 제1유형/u);
});

test("대화형 HTML은 누락되거나 안전하지 않은 attribution을 모두 거부한다", () => {
  const attribution = attributionFor(response);
  assert.throws(() => buildInteractiveClimateHtml(response), TypeError);
  assert.throws(() => buildInteractiveClimateHtml({ ...response, datasetVersion: "" }, attribution), TypeError);
  assert.throws(() => buildInteractiveClimateHtml({ ...response, datasetUpdatedAt: "G:\\private\\dataset" }, attribution), TypeError);
  assert.throws(() => buildInteractiveClimateHtml(response, { ...attribution, dataMode: "raw-model-grid" }), TypeError);
  assert.throws(() => buildInteractiveClimateHtml(response, { ...attribution, privatePath: "G:\\private\\citation.json" }), TypeError);
  assert.throws(() => buildInteractiveClimateHtml(response, {
    ...attribution,
    datasetIdentity: { ...attribution.datasetIdentity, version: "c".repeat(64) }
  }), TypeError);
  assert.throws(() => buildInteractiveClimateHtml(response, { ...attribution, methodologyReferences: [] }), TypeError);
  assert.throws(() => buildInteractiveClimateHtml(response, { ...attribution, markDataUrls: [kmaMarkDataUrls[0]] }), TypeError);

  const markedResponse = {
    ...structuredClone(response),
    observationAttribution: kmaObservationAttribution
  };
  const markedAttribution = attributionFor(markedResponse, kmaMarkDataUrls);
  assert.throws(() => buildInteractiveClimateHtml(markedResponse, {
    ...markedAttribution,
    markDataUrls: [{ ...kmaMarkDataUrls[0], name: "wrong.png" }, kmaMarkDataUrls[1]]
  }), TypeError);
  assert.throws(() => buildInteractiveClimateHtml(markedResponse, {
    ...markedAttribution,
    markDataUrls: [kmaMarkDataUrls[0], { name: kmaMarkNames[1], dataUrl: "data:image/png;base64,bm90LWEtcG5n" }]
  }), TypeError);

  const mismatchedObservationAttribution = structuredClone(attribution);
  mismatchedObservationAttribution.observationAttribution = rawObservationAttribution;
  assert.throws(() => buildInteractiveClimateHtml(response, mismatchedObservationAttribution), TypeError);

  const unsafeDoi = structuredClone(attribution);
  unsafeDoi.climateModels[0].citations[0].source.url = "https://example.com/private";
  assert.throws(() => buildInteractiveClimateHtml(response, unsafeDoi), TypeError);

  const unsafeGithub = structuredClone(attribution);
  unsafeGithub.project.creator.githubUrl = "file:///private/profile";
  assert.throws(() => buildInteractiveClimateHtml(response, unsafeGithub), TypeError);
});
