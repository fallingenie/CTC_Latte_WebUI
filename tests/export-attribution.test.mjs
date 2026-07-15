import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import {
  ASOS_CORRECTION_NOT_USED_NOTICE,
  ASOS_CORRECTION_USED_NOTICE,
  BIAS_CORRECTED_DATA_MODE,
  RAW_MODEL_GRID_DATA_MODE,
  buildAttributionBundle,
  buildAttributionJson,
  buildAttributionMarkdown,
  buildCmip6ModelAttributionCsv,
  buildPublicExportAttribution
} from "../source/export-attribution.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const markPaths = new Map([
  ["assets/licenses/kma_mark_1.png", path.join(root, "source", "public", "assets", "licenses", "kma_mark_1.png")],
  ["assets/licenses/kma_mark_2.png", path.join(root, "source", "public", "assets", "licenses", "kma_mark_2.png")]
]);
const markBytes = new Map(await Promise.all([...markPaths].map(async ([url, filePath]) => (
  [url, await fs.readFile(filePath)]
))));
const expectedModelNames = [
  "CanESM5",
  "EC-Earth3",
  "HadGEM3-GC31-LL",
  "MIROC-ES2L",
  "MIROC6",
  "KIOST-ESM"
];
const forbiddenOutputPatterns = [
  /\b(?:file|gs|gcs):\/\//iu,
  /\b(?:drive\.google\.com|storage\.googleapis\.com|storage\.cloud\.google\.com)\b/iu,
  /(?:^|[^a-z0-9])(?:[a-z]:[\\/]|\\\\[^\\\s]+[\\/])/imu,
  /\/(?:home|users|mnt|tmp|var|srv|opt|volumes)(?:\/|$)/imu,
  /(?:\bgoogle\s+drive\b|내\s*드라이브)/iu
];

test("공개 attribution record는 catalog 전체와 dataMode별 ASOS 보정 상태를 보존한다", () => {
  const corrected = buildPublicExportAttribution({ dataMode: BIAS_CORRECTED_DATA_MODE });
  const raw = buildPublicExportAttribution({ dataMode: RAW_MODEL_GRID_DATA_MODE });

  assert.equal(corrected.publicSafe, true);
  assert.equal(corrected.catalogSchemaVersion, 1);
  assert.equal(corrected.asosCorrection.used, true);
  assert.equal(corrected.asosCorrection.notice, ASOS_CORRECTION_USED_NOTICE);
  assert.equal(raw.asosCorrection.used, false);
  assert.equal(raw.asosCorrection.notice, ASOS_CORRECTION_NOT_USED_NOTICE);
  assert.deepEqual(corrected.climateModels.map((model) => model.name), expectedModelNames);
  assert.equal(
    corrected.climateModels.flatMap((model) => model.citations).length,
    13
  );
  assert.equal(corrected.methodologyReferences.length, 4);
  assert.ok(Object.isFrozen(corrected));
  assert.ok(Object.isFrozen(corrected.asosCorrection));

  const selected = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    model: "KIOST-ESM"
  });
  assert.deepEqual(selected.climateModels.map((model) => model.name), ["KIOST-ESM"]);
  assert.equal(selected.climateModels[0].citations.length, 3);

  const ensemble = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    modelNames: ["전체 앙상블"]
  });
  assert.deepEqual(ensemble.climateModels.map((model) => model.name), expectedModelNames);
  assert.throws(
    () => buildPublicExportAttribution({ dataMode: "unknown-mode" }),
    /dataMode/u
  );
  assert.throws(
    () => buildPublicExportAttribution({ dataMode: BIAS_CORRECTED_DATA_MODE, model: "UnknownModel" }),
    /catalog/u
  );
  assert.throws(
    () => buildPublicExportAttribution({ dataMode: BIAS_CORRECTED_DATA_MODE, model: 42 }),
    /문자열/u
  );
});

test("Markdown, JSON, model CSV는 DOI 13개와 ASOS 보정 사용 문구를 공개 정보만으로 직렬화한다", () => {
  const attribution = buildPublicExportAttribution({ dataMode: BIAS_CORRECTED_DATA_MODE });
  const markdown = buildAttributionMarkdown(attribution);
  const json = buildAttributionJson(attribution);
  const csv = buildCmip6ModelAttributionCsv(attribution);

  assert.match(markdown, /^# Licenses and Attribution$/mu);
  assert.match(markdown, /^- 보정 상태: 대한민국 기상청 ASOS 보정 사용$/mu);
  assert.doesNotMatch(markdown, /^- 보정 상태: 대한민국 기상청 ASOS 보정 미사용$/mu);
  assert.match(markdown, /https:\/\/www\.data\.go\.kr\/data\/15057210\/openapi\.do/u);
  assert.match(markdown, /!\[공공누리 제1유형 출처표시\]\(licenses\/kma_mark_1\.png\)/u);
  assert.match(markdown, /!\[제3자 권리 포함 저작권 표시\]\(licenses\/kma_mark_2\.png\)/u);
  assert.match(markdown, /10\.22033\/ESGF\/CMIP6\.11249/u);
  assert.match(markdown, /10\.5194\/gmd-17-191-2024/u);
  assert.doesNotMatch(markdown, /CC BY-NC-SA/u);
  assert.match(markdown, /라이선스와 변경 여부는 공개 인용 메타데이터에서 확인된 경우에만 표시/u);

  assert.deepEqual(JSON.parse(json), attribution);
  const csvLines = csv.split("\r\n").filter(Boolean);
  assert.equal(csvLines.length, 14);
  assert.equal(
    csvLines[0],
    "\"model\",\"institution\",\"activity\",\"citation_title\",\"authors\",\"doi\",\"url\",\"license\",\"changes_made\""
  );
  assert.equal(csvLines.filter((line) => line.startsWith("\"KIOST-ESM\",")).length, 3);
  for (const model of attribution.climateModels) {
    for (const citation of model.citations) {
      assert.match(csv, new RegExp(escapeRegExp(citation.source.doi), "u"));
    }
  }

  assertPublicOutputsSafe(markdown, json, csv);
});

test("raw-model-grid 직렬화는 ASOS 보정 미사용만 정확히 표시한다", () => {
  const attribution = buildPublicExportAttribution({ dataMode: RAW_MODEL_GRID_DATA_MODE });
  const markdown = buildAttributionMarkdown(attribution);

  assert.match(markdown, /^- 보정 상태: 대한민국 기상청 ASOS 보정 미사용$/mu);
  assert.doesNotMatch(markdown, /^- 보정 상태: 대한민국 기상청 ASOS 보정 사용$/mu);
  assert.throws(
    () => buildAttributionMarkdown({
      ...attribution,
      asosCorrection: {
        ...attribution.asosCorrection,
        used: true,
        notice: ASOS_CORRECTION_USED_NOTICE
      }
    }),
    /일치하지 않습니다/u
  );
});

test("model CSV는 쉼표와 큰따옴표를 RFC 4180 방식으로 이스케이프한다", () => {
  const attribution = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    model: "MIROC6"
  });
  const model = attribution.climateModels[0];
  const customRecord = {
    ...attribution,
    climateModels: [{
      ...model,
      citations: [{
        ...model.citations[0],
        title: "A \"quoted\", citation"
      }]
    }]
  };

  const csv = buildCmip6ModelAttributionCsv(customRecord);
  assert.match(csv, /"A ""quoted"", citation"/u);
});

test("출처 기록은 산출물의 자료판과 시각을 공개 가능한 형식으로 보존한다", () => {
  const datasetVersion = "a".repeat(64);
  const attribution = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    model: "MIROC6",
    datasetVersion,
    datasetUpdatedAt: "2026-07-15T03:04:05.123000+00:00",
    generatedAt: "2026-07-15T12:34:56.000Z"
  });
  const markdown = buildAttributionMarkdown(attribution);
  const json = JSON.parse(buildAttributionJson(attribution));

  assert.equal(json.datasetIdentity.version, datasetVersion);
  assert.equal(json.datasetIdentity.updatedAt, "2026-07-15T03:04:05.123000+00:00");
  assert.equal(json.datasetIdentity.generatedAt, "2026-07-15T12:34:56.000Z");
  assert.match(markdown, new RegExp(`자료판: ${datasetVersion}`, "u"));
  assert.match(markdown, /자료 갱신 시각: 2026-07-15T03:04:05\.123000\+00:00/u);
  assertPublicOutputsSafe(markdown, JSON.stringify(json));
});

test("ZIP 묶음은 CSV, attribution 산출물, same-origin KMA PNG 원본만 포함한다", async () => {
  const csv = "\"date\",\"value\"\r\n\"2060-08-01\",\"31.2\"\r\n";
  const fetchCalls = [];
  const blob = await buildAttributionBundle({
    csv,
    csvFilename: "climate-period.csv",
    dataMode: RAW_MODEL_GRID_DATA_MODE
  }, {
    fetch: createAssetFetch(fetchCalls)
  });

  assert.equal(blob.type, "application/zip");
  assert.ok(blob.size > csv.length);
  assert.deepEqual(fetchCalls.map((call) => call.url), [...markPaths.keys()]);
  for (const call of fetchCalls) {
    assert.deepEqual(call.options, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-cache"
    });
  }

  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const fileNames = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(fileNames, [
    "LICENSES_AND_ATTRIBUTION.md",
    "climate-period.csv",
    "cmip6_model_attribution.csv",
    "cmip6_model_attribution.json",
    "licenses/kma_mark_1.png",
    "licenses/kma_mark_2.png"
  ]);
  assert.equal(await zip.file("climate-period.csv").async("text"), csv);

  const markdown = await zip.file("LICENSES_AND_ATTRIBUTION.md").async("text");
  const json = await zip.file("cmip6_model_attribution.json").async("text");
  const modelCsv = await zip.file("cmip6_model_attribution.csv").async("text");
  assert.match(markdown, /^- 보정 상태: 대한민국 기상청 ASOS 보정 미사용$/mu);
  assert.doesNotMatch(markdown, /^- 보정 상태: 대한민국 기상청 ASOS 보정 사용$/mu);
  assert.equal(JSON.parse(json).asosCorrection.used, false);
  assert.equal(modelCsv.split("\r\n").filter(Boolean).length, 14);
  assertPublicOutputsSafe(markdown, json, modelCsv);

  for (const [sourceUrl, bytes] of markBytes) {
    const archivePath = sourceUrl.replace(/^assets\//u, "");
    const archived = await zip.file(archivePath).async("uint8array");
    assert.deepEqual(archived, new Uint8Array(bytes));
  }
});

test("ZIP 묶음은 로컬, Drive, GCS 경로와 잘못된 PNG를 실패 폐쇄한다", async () => {
  let fetchCount = 0;
  const environment = {
    async fetch() {
      fetchCount += 1;
      throw new Error("호출되면 안 됩니다.");
    }
  };
  const unsafeCsvValues = [
    "path\r\ngs://private-bucket/model.zarr\r\n",
    "path\r\nfile:///C:/climate/raw.csv\r\n",
    "path\r\nhttps://drive.google.com/drive/folders/example\r\n",
    "path\r\nG:\\내 드라이브\\climate\\raw.csv\r\n",
    "path\r\n/home/researcher/climate/raw.csv\r\n",
    "path\r\nhttp://localhost:8765/api/climate/query\r\n"
  ];

  for (const csv of unsafeCsvValues) {
    await assert.rejects(
      buildAttributionBundle({ csv, dataMode: BIAS_CORRECTED_DATA_MODE }, environment),
      /공개 내보내기/u
    );
  }
  await assert.rejects(
    buildAttributionBundle({
      csv: "date,value\r\n2060-08-01,31.2\r\n",
      csvFilename: "../private.csv",
      dataMode: BIAS_CORRECTED_DATA_MODE
    }, environment),
    /CSV 파일 이름/u
  );
  assert.equal(fetchCount, 0);

  await assert.rejects(
    buildAttributionBundle({
      csv: "date,value\r\n2060-08-01,31.2\r\n",
      dataMode: BIAS_CORRECTED_DATA_MODE
    }, {
      async fetch() {
        return {
          ok: true,
          async arrayBuffer() {
            return new TextEncoder().encode("not a png").buffer;
          }
        };
      }
    }),
    /유효한 PNG/u
  );
});

function createAssetFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    const bytes = markBytes.get(url);
    return {
      ok: Boolean(bytes),
      status: bytes ? 200 : 404,
      async arrayBuffer() {
        if (!bytes) return new ArrayBuffer(0);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
  };
}

function assertPublicOutputsSafe(...values) {
  for (const value of values) {
    for (const pattern of forbiddenOutputPatterns) assert.doesNotMatch(value, pattern);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
