import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import { VERIFIED_LOCAL_RESULT_MARK_ASSETS } from "../source/export-attribution.js";
import { buildCsvWorkspaceShareFiles } from "../source/export-share.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const markBytes = new Map(await Promise.all(VERIFIED_LOCAL_RESULT_MARK_ASSETS.map(async (asset) => (
  [
    asset.archivePath,
    await fs.readFile(path.join(root, "source", "public", asset.sourceUrl.replace(/^\.\//u, "")))
  ]
))));
const csvSpecification = {
  filename: "climate.csv",
  mimeType: "text/csv;charset=utf-8",
  extension: ".csv",
  description: "기후 자료"
};

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

function observationAttribution({ providers = [], usesObservationData = providers.length > 0 } = {}) {
  return {
    schemaVersion: 1,
    ready: true,
    usesObservationData,
    providerIds: providers.map((provider) => provider.providerId),
    providers
  };
}

async function attributionBundle({ omitPath, alterPath } = {}) {
  const zip = new JSZip();
  for (const [archivePath, originalBytes] of markBytes) {
    if (archivePath === omitPath) continue;
    const bytes = new Uint8Array(originalBytes);
    if (archivePath === alterPath) bytes[100] ^= 1;
    zip.file(archivePath, bytes);
  }
  return new Blob([await zip.generateAsync({ type: "uint8array" })], { type: "application/zip" });
}

test("Workspace 공유는 raw/no-provider 결과에 CSV만 준비한다", async () => {
  const csvBlob = new Blob(["\uFEFFdate,value\r\n2050-08-01,33.7\r\n"], { type: csvSpecification.mimeType });
  const files = await buildCsvWorkspaceShareFiles(
    new Blob(["표장이 없어 ZIP을 열 필요가 없습니다."], { type: "application/zip" }),
    csvBlob,
    csvSpecification,
    observationAttribution()
  );

  assert.deepEqual(files.map(({ filename, mimeType }) => ({ filename, mimeType })), [
    { filename: "climate.csv", mimeType: "text/csv" }
  ]);
  assert.equal(await files[0].blob.text(), await csvBlob.text());
});

test("Workspace 공유 명세는 검증된 CSV blob과 안전한 파일 이름을 덮어쓸 수 없다", async () => {
  const csvBlob = new Blob(["trusted"], { type: csvSpecification.mimeType });
  const files = await buildCsvWorkspaceShareFiles(
    new Blob(["표장 없음"], { type: "application/zip" }),
    csvBlob,
    { ...csvSpecification, blob: new Blob(["untrusted"]), extra: "discarded" },
    observationAttribution()
  );
  assert.equal(await files[0].blob.text(), "trusted");
  assert.deepEqual(Object.keys(files[0]).sort(), ["blob", "filename", "mimeType"]);

  for (const filename of ["../climate.csv", ".csv", " climate.csv", "climate.txt"]) {
    await assert.rejects(
      buildCsvWorkspaceShareFiles(
        new Blob(["표장 없음"], { type: "application/zip" }),
        csvBlob,
        { ...csvSpecification, filename },
        observationAttribution()
      ),
      /CSV 파일 정보/u
    );
  }
});

test("Workspace 공유는 Backend가 요구하고 로컬에서 검증된 표장만 함께 준비한다", async () => {
  const csvBlob = new Blob(["\uFEFFdate,value\r\n2050-08-01,33.7\r\n"], { type: csvSpecification.mimeType });
  const files = await buildCsvWorkspaceShareFiles(
    await attributionBundle(),
    csvBlob,
    csvSpecification,
    observationAttribution({ providers: [kmaProvider] })
  );

  assert.deepEqual(files.map(({ filename, mimeType }) => ({ filename, mimeType })), [
    { filename: "climate.csv", mimeType: "text/csv" },
    { filename: "kma_mark_1.png", mimeType: "image/png" },
    { filename: "kma_mark_2.png", mimeType: "image/png" }
  ]);
  assert.equal(await files[0].blob.text(), await csvBlob.text());
  for (const [index, asset] of VERIFIED_LOCAL_RESULT_MARK_ASSETS.entries()) {
    assert.deepEqual(
      new Uint8Array(await files[index + 1].blob.arrayBuffer()),
      new Uint8Array(markBytes.get(asset.archivePath))
    );
  }
});

test("필수 표장이 누락되거나 ZIP byte가 변조되면 불완전한 공유 파일을 만들지 않는다", async () => {
  const csvBlob = new Blob(["date,value"], { type: csvSpecification.mimeType });
  const observation = observationAttribution({ providers: [kmaProvider] });
  await assert.rejects(
    buildCsvWorkspaceShareFiles(
      await attributionBundle({ omitPath: VERIFIED_LOCAL_RESULT_MARK_ASSETS[1].archivePath }),
      csvBlob,
      csvSpecification,
      observation
    ),
    /필수 결과 표장 파일/u
  );
  await assert.rejects(
    buildCsvWorkspaceShareFiles(
      await attributionBundle({ alterPath: VERIFIED_LOCAL_RESULT_MARK_ASSETS[0].archivePath }),
      csvBlob,
      csvSpecification,
      observation
    ),
    /SHA-256/u
  );
});

test("Backend descriptor가 로컬 catalog와 다르면 ZIP을 열기 전에 실패 폐쇄한다", async () => {
  const csvBlob = new Blob(["date,value"], { type: csvSpecification.mimeType });
  const modifiedProvider = structuredClone(kmaProvider);
  modifiedProvider.markAssets[0].sha256 = "c".repeat(64);

  await assert.rejects(
    buildCsvWorkspaceShareFiles(
      new Blob(["not a zip"], { type: "application/zip" }),
      csvBlob,
      csvSpecification,
      observationAttribution({ providers: [modifiedProvider] })
    ),
    /descriptor/u
  );
});
