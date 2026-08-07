import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import {
  BIAS_CORRECTED_DATA_MODE,
  RAW_MODEL_GRID_DATA_MODE,
  VERIFIED_LOCAL_RESULT_MARK_ASSETS,
  buildAttributionBundle,
  buildAttributionJson,
  buildAttributionMarkdown,
  buildCmip6ModelAttributionCsv,
  buildPublicExportAttribution,
  resolveVerifiedObservationMarkAssets,
  verifyLocalObservationMarkAssetBytes
} from "../source/export-attribution.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const markBytes = new Map(await Promise.all(VERIFIED_LOCAL_RESULT_MARK_ASSETS.map(async (asset) => (
  [
    asset.sourceUrl,
    await fs.readFile(path.join(root, "source", "public", asset.sourceUrl.replace(/^\.\//u, "")))
  ]
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

const dwdProvider = Object.freeze({
  providerId: "dwd",
  name: "Deutscher Wetterdienst Climate Data Center",
  dataset: "dwd_cdc_hourly_observations",
  licenseName: "CC BY 4.0",
  licenseUrl: "https://www.dwd.de/EN/service/legal_notice/templates_dwd_as_source.html",
  citation: "Deutscher Wetterdienst, Climate Data Center hourly station observations.",
  attributionText: "Based on data from Deutscher Wetterdienst (DWD), Climate Data Center; processed by Climate Time Capsule.",
  redistributionPolicy: "cc_by_4_0_with_source_and_modification_notice",
  usedRowCount: 42,
  attributionRequired: true,
  requiresResultMark: false,
  markAssets: Object.freeze([])
});

const kmaProvider = Object.freeze({
  providerId: "kma_asos",
  name: "Korea Meteorological Administration",
  dataset: "ASOS hourly observations",
  licenseName: "Korea Open Government License Type 1",
  licenseUrl: "https://www.kogl.or.kr/info/license.do",
  citation: "Korea Meteorological Administration ASOS hourly observations.",
  attributionText: "Based on Korea Meteorological Administration ASOS observations; processed by Climate Time Capsule.",
  redistributionPolicy: "source_attribution_and_third_party_rights_notice",
  usedRowCount: 128,
  attributionRequired: true,
  requiresResultMark: true,
  markAssets: Object.freeze(VERIFIED_LOCAL_RESULT_MARK_ASSETS.map((asset) => Object.freeze({
    name: asset.name,
    path: asset.path,
    sha256: asset.sha256,
    sizeBytes: asset.sizeBytes,
    mediaType: asset.mediaType
  })))
});

function rawObservationAttribution() {
  return {
    schemaVersion: 1,
    ready: true,
    usesObservationData: false,
    providerIds: [],
    providers: []
  };
}

function usedObservationAttribution(providers = [dwdProvider]) {
  return {
    schemaVersion: 1,
    ready: true,
    usesObservationData: true,
    providerIds: providers.map((provider) => provider.providerId),
    providers
  };
}

test("공개 attribution은 dataMode로 제공자를 추론하지 않고 Backend 제공자만 보존한다", () => {
  const observationAttribution = usedObservationAttribution([dwdProvider]);
  const corrected = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution
  });
  const raw = buildPublicExportAttribution({
    dataMode: RAW_MODEL_GRID_DATA_MODE,
    observationAttribution: rawObservationAttribution()
  });

  assert.equal(corrected.publicSafe, true);
  assert.equal(corrected.catalogSchemaVersion, 1);
  assert.deepEqual(corrected.observationAttribution, observationAttribution);
  assert.deepEqual(corrected.observationAttribution.providerIds, ["dwd"]);
  assert.deepEqual(raw.observationAttribution.providerIds, []);
  assert.equal("asosCorrection" in corrected, false);
  assert.deepEqual(corrected.climateModels.map((model) => model.name), expectedModelNames);
  assert.equal(corrected.climateModels.flatMap((model) => model.citations).length, 13);
  assert.equal(corrected.methodologyReferences.length, 4);
  assert.ok(Object.isFrozen(corrected));
  assert.ok(Object.isFrozen(corrected.observationAttribution));

  const selected = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution,
    model: "KIOST-ESM"
  });
  assert.deepEqual(selected.climateModels.map((model) => model.name), ["KIOST-ESM"]);
  assert.equal(selected.climateModels[0].citations.length, 3);

  const ensemble = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution,
    modelNames: ["전체 앙상블"]
  });
  assert.deepEqual(ensemble.climateModels.map((model) => model.name), expectedModelNames);
});

test("Markdown과 JSON은 실제 사용된 DWD만 표기하고 프로젝트·CMIP6·방법론 인용을 유지한다", () => {
  const attribution = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution: usedObservationAttribution([dwdProvider])
  });
  const markdown = buildAttributionMarkdown(attribution);
  const json = buildAttributionJson(attribution);
  const csv = buildCmip6ModelAttributionCsv(attribution);

  assert.match(markdown, /^# Licenses and Attribution$/mu);
  assert.match(markdown, /^## Observation Data Attribution$/mu);
  assert.match(markdown, /Deutscher Wetterdienst Climate Data Center/u);
  assert.match(markdown, /dwd_cdc_hourly_observations/u);
  assert.match(markdown, /https:\/\/www\.dwd\.de\/EN\/service\/legal_notice\/templates_dwd_as_source\.html/u);
  assert.match(markdown, /Used rows: 42/u);
  assert.doesNotMatch(markdown, /Korea Meteorological Administration|kma_mark_|ASOS 보정/u);
  assert.match(markdown, /10\.22033\/ESGF\/CMIP6\.11249/u);
  assert.match(markdown, /10\.5194\/gmd-17-191-2024/u);
  assert.match(markdown, /라이선스와 변경 여부는 공개 인용 메타데이터에서 확인된 경우에만 표시/u);

  assert.deepEqual(JSON.parse(json), attribution);
  assert.deepEqual(JSON.parse(json).observationAttribution.providerIds, ["dwd"]);
  const csvLines = csv.split("\r\n").filter(Boolean);
  assert.equal(csvLines.length, 14);
  assert.equal(
    csvLines[0],
    "\"model\",\"institution\",\"activity\",\"citation_title\",\"authors\",\"doi\",\"url\",\"license\",\"changes_made\""
  );
  assert.equal(csvLines.filter((line) => line.startsWith("\"KIOST-ESM\",")).length, 3);
  assertPublicOutputsSafe(markdown, json, csv);
});

test("Backend 자유 텍스트는 Markdown raw HTML로 해석되지 않는다", () => {
  const provider = {
    ...dwdProvider,
    name: "<img src=x onerror=alert(1)>",
    attributionText: "Research & <script>alert(1)</script>"
  };
  const markdown = buildAttributionMarkdown(buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution: usedObservationAttribution([provider])
  }));
  assert.doesNotMatch(markdown, /<img|<script|<\/script>/u);
  assert.match(markdown, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(markdown, /Research &amp; &lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
});

test("raw 결과는 관측 제공자와 결과 표장을 모두 비우고 fetch 대상도 만들지 않는다", () => {
  const attribution = buildPublicExportAttribution({
    dataMode: RAW_MODEL_GRID_DATA_MODE,
    observationAttribution: rawObservationAttribution()
  });
  const markdown = buildAttributionMarkdown(attribution);

  assert.match(markdown, /이 결과에는 관측자료를 사용하지 않았습니다/u);
  assert.doesNotMatch(markdown, /kma_mark_|Deutscher Wetterdienst|Korea Meteorological Administration/u);
  assert.deepEqual(resolveVerifiedObservationMarkAssets(attribution.observationAttribution), []);
});

test("결과 표장 선택기는 legacy ready=false와 metadata용 제공자 목록을 결과로 재사용하지 않는다", () => {
  assert.throws(
    () => resolveVerifiedObservationMarkAssets({
      ...rawObservationAttribution(),
      ready: false
    }),
    /준비되지 않았습니다/u
  );
  assert.throws(
    () => resolveVerifiedObservationMarkAssets({
      schemaVersion: 1,
      ready: true,
      usesObservationData: false,
      providerIds: ["dwd"],
      providers: [dwdProvider]
    }),
    /준비되지 않았습니다/u
  );
});

test("결과 dataMode와 Backend observationAttribution 불일치는 실패 폐쇄한다", () => {
  assert.throws(
    () => buildPublicExportAttribution({
      dataMode: BIAS_CORRECTED_DATA_MODE,
      observationAttribution: rawObservationAttribution()
    }),
    /일치하지 않습니다/u
  );
  assert.throws(
    () => buildPublicExportAttribution({
      dataMode: RAW_MODEL_GRID_DATA_MODE,
      observationAttribution: usedObservationAttribution([dwdProvider])
    }),
    /일치하지 않습니다/u
  );
  assert.throws(
    () => buildPublicExportAttribution({ dataMode: BIAS_CORRECTED_DATA_MODE }),
    /공개 .*자료 응답/u
  );
  assert.throws(
    () => buildPublicExportAttribution({
      dataMode: "unknown-mode",
      observationAttribution: rawObservationAttribution()
    }),
    /dataMode/u
  );
  assert.throws(
    () => buildPublicExportAttribution({
      dataMode: BIAS_CORRECTED_DATA_MODE,
      observationAttribution: usedObservationAttribution([dwdProvider]),
      model: "UnknownModel"
    }),
    /catalog/u
  );
});

test("결과 표장은 Backend descriptor와 로컬 name·path·SHA·size·mediaType이 모두 일치해야 한다", () => {
  const observationAttribution = usedObservationAttribution([kmaProvider]);
  const resolved = resolveVerifiedObservationMarkAssets(observationAttribution);

  assert.deepEqual(resolved.map((asset) => ({
    name: asset.name,
    path: asset.path,
    sourceUrl: asset.sourceUrl,
    providerIds: asset.providerIds
  })), [
    {
      name: "kma_mark_1.png",
      path: "licenses/kma_mark_1.png",
      sourceUrl: "./assets/licenses/kma_mark_1.png",
      providerIds: ["kma_asos"]
    },
    {
      name: "kma_mark_2.png",
      path: "licenses/kma_mark_2.png",
      sourceUrl: "./assets/licenses/kma_mark_2.png",
      providerIds: ["kma_asos"]
    }
  ]);

  for (const field of ["sha256", "sizeBytes", "mediaType"]) {
    const modifiedProvider = structuredClone(kmaProvider);
    modifiedProvider.markAssets[0][field] = {
      sha256: "b".repeat(64),
      sizeBytes: kmaProvider.markAssets[0].sizeBytes + 1,
      mediaType: "image/jpeg"
    }[field];
    assert.throws(
      () => resolveVerifiedObservationMarkAssets(usedObservationAttribution([modifiedProvider]))
    );
  }

  const maliciousPathProvider = structuredClone(kmaProvider);
  maliciousPathProvider.markAssets[0].path = "https://backend.invalid/licenses/kma_mark_1.png";
  assert.throws(
    () => resolveVerifiedObservationMarkAssets(usedObservationAttribution([maliciousPathProvider])),
    /공개 .*자료 응답/u
  );
});

test("model CSV는 쉼표와 큰따옴표를 RFC 4180 방식으로 이스케이프한다", () => {
  const attribution = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution: usedObservationAttribution([dwdProvider]),
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

test("출처 기록은 산출물 자료판과 시각을 공개 가능한 형식으로 보존한다", () => {
  const datasetVersion = "a".repeat(64);
  const attribution = buildPublicExportAttribution({
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution: usedObservationAttribution([dwdProvider]),
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

test("raw와 표장 없는 제공자의 ZIP은 로컬 표장을 fetch하거나 포함하지 않는다", async () => {
  const csv = "\"date\",\"value\"\r\n\"2060-08-01\",\"31.2\"\r\n";
  let fetchCount = 0;
  const noFetchEnvironment = {
    async fetch() {
      fetchCount += 1;
      throw new Error("호출되면 안 됩니다.");
    }
  };

  for (const [dataMode, observationAttribution] of [
    [RAW_MODEL_GRID_DATA_MODE, rawObservationAttribution()],
    [BIAS_CORRECTED_DATA_MODE, usedObservationAttribution([dwdProvider])]
  ]) {
    const blob = await buildAttributionBundle({
      csv,
      csvFilename: "climate-period.csv",
      dataMode,
      observationAttribution
    }, noFetchEnvironment);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const fileNames = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(fileNames, [
      "LICENSES_AND_ATTRIBUTION.md",
      "climate-period.csv",
      "cmip6_model_attribution.csv",
      "cmip6_model_attribution.json"
    ]);
  }
  assert.equal(fetchCount, 0);
});

test("표장이 필요한 ZIP은 descriptor.path가 아닌 고정 로컬 URL만 fetch하고 byte SHA·size를 검증한다", async () => {
  const csv = "date,value\r\n2060-08-01,31.2\r\n";
  const fetchCalls = [];
  const blob = await buildAttributionBundle({
    csv,
    csvFilename: "climate-period.csv",
    dataMode: BIAS_CORRECTED_DATA_MODE,
    observationAttribution: usedObservationAttribution([kmaProvider])
  }, {
    fetch: createAssetFetch(fetchCalls)
  });

  assert.equal(blob.type, "application/zip");
  assert.deepEqual(fetchCalls.map((call) => call.url), VERIFIED_LOCAL_RESULT_MARK_ASSETS.map((asset) => asset.sourceUrl));
  assert.ok(fetchCalls.every((call) => !call.url.startsWith("licenses/")));
  for (const call of fetchCalls) {
    assert.deepEqual(call.options, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-cache",
      redirect: "error"
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
  for (const asset of VERIFIED_LOCAL_RESULT_MARK_ASSETS) {
    assert.deepEqual(
      await zip.file(asset.archivePath).async("uint8array"),
      new Uint8Array(markBytes.get(asset.sourceUrl))
    );
  }

  const markdown = await zip.file("LICENSES_AND_ATTRIBUTION.md").async("text");
  const json = JSON.parse(await zip.file("cmip6_model_attribution.json").async("text"));
  assert.match(markdown, /Korea Meteorological Administration/u);
  assert.match(markdown, /licenses\/kma_mark_1\.png/u);
  assert.deepEqual(json.observationAttribution.providerIds, ["kma_asos"]);
});

test("잘못된 표장 byte와 descriptor는 fetch 전후 각각 실패 폐쇄한다", async () => {
  const csv = "date,value\r\n2060-08-01,31.2\r\n";
  const mismatchedProvider = structuredClone(kmaProvider);
  mismatchedProvider.markAssets[0].sha256 = "b".repeat(64);
  let fetchCount = 0;
  await assert.rejects(
    buildAttributionBundle({
      csv,
      dataMode: BIAS_CORRECTED_DATA_MODE,
      observationAttribution: usedObservationAttribution([mismatchedProvider])
    }, {
      async fetch() {
        fetchCount += 1;
        throw new Error("호출되면 안 됩니다.");
      }
    }),
    /descriptor/u
  );
  assert.equal(fetchCount, 0);

  const altered = new Uint8Array(markBytes.get(VERIFIED_LOCAL_RESULT_MARK_ASSETS[0].sourceUrl));
  altered[100] ^= 1;
  await assert.rejects(
    verifyLocalObservationMarkAssetBytes(VERIFIED_LOCAL_RESULT_MARK_ASSETS[0], altered),
    /SHA-256/u
  );
  await assert.rejects(
    verifyLocalObservationMarkAssetBytes(VERIFIED_LOCAL_RESULT_MARK_ASSETS[0], altered.slice(0, -1)),
    /형식 또는 크기/u
  );

  const mutationTarget = new Uint8Array(markBytes.get(VERIFIED_LOCAL_RESULT_MARK_ASSETS[0].sourceUrl));
  const expectedBytes = Uint8Array.from(mutationTarget);
  const verifiedBytes = await verifyLocalObservationMarkAssetBytes(
    VERIFIED_LOCAL_RESULT_MARK_ASSETS[0],
    mutationTarget,
    {
      crypto: {
        subtle: {
          async digest(_algorithm, value) {
            const digestInput = Uint8Array.from(value);
            mutationTarget[100] ^= 1;
            const digest = createHash("sha256").update(digestInput).digest();
            return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
          }
        }
      }
    }
  );
  assert.deepEqual(verifiedBytes, expectedBytes);
  assert.notDeepEqual(mutationTarget, expectedBytes);

  await assert.rejects(
    buildAttributionBundle({
      csv,
      dataMode: BIAS_CORRECTED_DATA_MODE,
      observationAttribution: usedObservationAttribution([kmaProvider])
    }, {
      async fetch(url) {
        const bytes = new Uint8Array(markBytes.get(url));
        if (url.endsWith("kma_mark_1.png")) bytes[100] ^= 1;
        return {
          ok: true,
          async arrayBuffer() {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          }
        };
      }
    }),
    /SHA-256/u
  );
});

test("ZIP 묶음은 로컬·Drive·GCS 경로와 안전하지 않은 파일명을 거부한다", async () => {
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
      buildAttributionBundle({
        csv,
        dataMode: RAW_MODEL_GRID_DATA_MODE,
        observationAttribution: rawObservationAttribution()
      }, environment),
      /공개 내보내기/u
    );
  }
  await assert.rejects(
    buildAttributionBundle({
      csv: "date,value\r\n2060-08-01,31.2\r\n",
      csvFilename: "../private.csv",
      dataMode: RAW_MODEL_GRID_DATA_MODE,
      observationAttribution: rawObservationAttribution()
    }, environment),
    /CSV 파일 이름/u
  );
  assert.equal(fetchCount, 0);
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
