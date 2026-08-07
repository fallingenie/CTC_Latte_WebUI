import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  LEGACY_TEST_DATASET_MODE,
  computeMountedDatasetVersion,
  createReleasePointer,
  parseReleasePointer,
  resolveLegacyTestDataEnvironment,
  resolveReleaseDataEnvironment,
  validateMountedDatasetPublication,
  validateMountedDatasetReady
} from "../scripts/release-candidate-data.mjs";
import { createReleasePointerFile } from "../scripts/create-release-pointer.mjs";
import {
  createReleaseRequestHandler,
  parseAllowedOrigins,
  startReleaseCandidateServer,
  terminateChild,
  validateGatewayPublicationReadiness,
  validateReleaseServerEnvironment,
  waitForGateway
} from "../scripts/start-release-candidate-server.mjs";

const FIXTURE_MTIME = new Date("2026-01-01T00:00:00.000Z");
const PUBLICATION_DATASET_VERSION = "a".repeat(64);
const PUBLICATION_DATASET_UPDATED_AT = "2026-08-04T00:00:00.000000+00:00";
const PUBLICATION_METADATA = Object.freeze({
  publicSafe: true,
  ready: true,
  attributionReady: true,
  observationAttribution: Object.freeze({
    schemaVersion: 1,
    ready: true,
    usesObservationData: false,
    providerIds: Object.freeze([]),
    providers: Object.freeze([])
  }),
  datasetVersion: PUBLICATION_DATASET_VERSION,
  datasetUpdatedAt: PUBLICATION_DATASET_UPDATED_AT,
  dateStart: "2035-01-01",
  dateEnd: "2099-12-31",
  models: Object.freeze(["MODEL-A"]),
  scenarios: Object.freeze(["ssp585"])
});
const PUBLICATION_ATTRIBUTION = Object.freeze({
  schemaVersion: 1,
  ready: true,
  usesObservationData: false,
  providerIds: Object.freeze([]),
  providers: Object.freeze([]),
  datasetVersion: PUBLICATION_DATASET_VERSION,
  datasetUpdatedAt: PUBLICATION_DATASET_UPDATED_AT
});
const PUBLICATION_OBSERVATION_PROVIDER = Object.freeze({
  providerId: "dwd",
  name: "Deutscher Wetterdienst Climate Data Center",
  dataset: "dwd_cdc_hourly_observations",
  licenseName: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  licenseUrl: "https://www.dwd.de/EN/service/legal_notice/templates_dwd_as_source.html",
  citation: "Deutscher Wetterdienst, Climate Data Center hourly station observations.",
  attributionText: "Based on data from Deutscher Wetterdienst (DWD), Climate Data Center; processed by Climate Time Capsule.",
  redistributionPolicy: "cc_by_4_0_with_source_and_modification_notice",
  usedRowCount: 37,
  attributionRequired: true,
  requiresResultMark: false,
  markAssets: Object.freeze([])
});

test("자료판 포인터는 고정 스키마와 안전한 상대경로만 허용한다", () => {
  const pointer = createReleasePointer({
    releaseId: "ctc-1000-rc1",
    relativePath: "releases/ctc-1000-rc1/data.ctwebui",
    datasetVersion: "a".repeat(64)
  });
  assert.equal(parseReleasePointer(JSON.stringify(pointer)).releaseId, "ctc-1000-rc1");
  assert.throws(
    () => parseReleasePointer({ ...pointer, relativePath: "../private.ctwebui" }),
    /상대경로/u
  );
  assert.throws(() => parseReleasePointer({ ...pointer, extra: true }), /허용되지 않은 필드/u);
  assert.throws(() => parseReleasePointer("{\"datasetVersion\":NaN}"), /JSON 형식/u);
});

test("GCS 자료판 포인터의 SHA-256과 실제 자료가 일치할 때만 경로를 승격한다", async (context) => {
  let fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const datasetVersion = await computeMountedDatasetVersion(fixture.webDataRoot);
  fixture = await moveFixtureToImmutableReleasePath(fixture, datasetVersion);
  const pointer = createReleasePointer({
    releaseId: "ctc-1000-rc1",
    relativePath: fixture.relativePath,
    datasetVersion
  });
  const pointerPath = path.join(
    fixture.mountRoot,
    "release-candidate",
    "releases",
    `${datasetVersion}.json`
  );
  await fs.mkdir(path.dirname(pointerPath), { recursive: true });
  await fs.writeFile(pointerPath, `${JSON.stringify(pointer)}\n`, "utf8");

  const result = await resolveReleaseDataEnvironment({
    CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
    CTC_RELEASE_POINTER: pointerPath,
    CTC_RELEASE_TOKEN: datasetVersion
  });
  const expectedWebDataRoot = await fs.realpath(fixture.webDataRoot);
  assert.equal(result.webDataRoot, expectedWebDataRoot);
  assert.equal(result.env.CTC_WEB_DATA_ROOT, expectedWebDataRoot);
  assert.equal(result.publication.integrityMode, "startup");

  await fs.writeFile(pointerPath, JSON.stringify({ ...pointer, datasetVersion: "b".repeat(64) }), "utf8");
  await assert.rejects(
    () => resolveReleaseDataEnvironment({
      CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
      CTC_RELEASE_POINTER: pointerPath,
      CTC_RELEASE_TOKEN: datasetVersion
    }),
    /일치하지 않습니다/u
  );
});

test("공개 자료 해석은 불변 pointer·dataset 경로와 CTC_RELEASE_TOKEN을 하나의 SHA-256으로 결합한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const datasetVersion = await computeMountedDatasetVersion(fixture.webDataRoot);
  const pointer = createReleasePointer({
    releaseId: "ctc-mutable",
    relativePath: fixture.relativePath,
    datasetVersion
  });
  await fs.mkdir(path.dirname(fixture.pointerPath), { recursive: true });
  await fs.writeFile(fixture.pointerPath, JSON.stringify(pointer), "utf8");

  await assert.rejects(
    () => resolveReleaseDataEnvironment({
      CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
      CTC_RELEASE_POINTER: fixture.pointerPath,
      CTC_RELEASE_TOKEN: datasetVersion
    }),
    /불변 자료 포인터 경로/u
  );
  await assert.rejects(
    () => resolveReleaseDataEnvironment({
      CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
      CTC_RELEASE_POINTER: fixture.pointerPath
    }),
    /CTC_RELEASE_TOKEN/u
  );
});

test("구형 비봉인 자료판은 명시적으로 고정한 시험 모드에서만 읽는다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const legacy = await downgradeFixtureToLegacyV2(fixture.webDataRoot);
  await fs.writeFile(
    path.join(fixture.webDataRoot, "arrays", "corrected_daily.zarr", "unregistered-test-chunk"),
    "시험용 무결성 결손",
    "utf8"
  );
  const datasetVersion = await computeMountedDatasetVersion(fixture.webDataRoot);
  const testEnvironment = {
    CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
    CTC_WEB_DATA_ROOT: fixture.webDataRoot,
    CTC_TEST_DATASET_MODE: LEGACY_TEST_DATASET_MODE,
    CTC_TEST_EXPECTED_DATASET_VERSION: datasetVersion,
    CTC_TEST_EXPECTED_GENERATION_ID: legacy.generationId,
    CTC_TEST_EXPECTED_MANIFEST_BINDING_SHA256: legacy.manifestBindingSha256,
    CTC_TEST_ACKNOWLEDGED_INTEGRITY_GAP_BYTES: "69114"
  };

  const result = await resolveLegacyTestDataEnvironment(testEnvironment);
  assert.equal(result.testOnly, true);
  assert.equal(result.acknowledgedIntegrityGapBytes, 69114);
  assert.equal(result.pointer.releaseId, `test-${datasetVersion.slice(0, 12)}`);
  assert.equal(result.pointer.datasetVersion, datasetVersion);

  await assert.rejects(
    () => resolveLegacyTestDataEnvironment({
      ...testEnvironment,
      CTC_TEST_EXPECTED_DATASET_VERSION: "f".repeat(64)
    }),
    /SHA-256이 승인한 값과 일치하지 않습니다/u
  );
  await assert.rejects(
    () => resolveLegacyTestDataEnvironment({
      ...testEnvironment,
      CTC_TEST_ACKNOWLEDGED_INTEGRITY_GAP_BYTES: ""
    }),
    /CTC_TEST_ACKNOWLEDGED_INTEGRITY_GAP_BYTES/u
  );
});

test("시험 예외는 운영 포인터 또는 봉인된 v3 자료판에 적용하지 않는다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const datasetVersion = await computeMountedDatasetVersion(fixture.webDataRoot);
  const environment = {
    CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
    CTC_WEB_DATA_ROOT: fixture.webDataRoot,
    CTC_TEST_DATASET_MODE: LEGACY_TEST_DATASET_MODE,
    CTC_TEST_EXPECTED_DATASET_VERSION: datasetVersion,
    CTC_TEST_EXPECTED_GENERATION_ID: "b".repeat(64),
    CTC_TEST_EXPECTED_MANIFEST_BINDING_SHA256: JSON.parse(
      await fs.readFile(path.join(fixture.webDataRoot, "meta", "completion.json"), "utf8")
    ).manifest_binding_sha256,
    CTC_TEST_ACKNOWLEDGED_INTEGRITY_GAP_BYTES: "1"
  };
  await assert.rejects(
    () => resolveReleaseDataEnvironment(environment),
    /공개 출시 경로/u
  );
  await assert.rejects(
    () => resolveLegacyTestDataEnvironment(environment),
    /정상 배포 절차/u
  );
  await assert.rejects(
    () => resolveLegacyTestDataEnvironment({ ...environment, CTC_RELEASE_POINTER: fixture.pointerPath }),
    /운영 포인터/u
  );
  await assert.rejects(
    () => resolveLegacyTestDataEnvironment({ ...environment, CTC_TEST_DATASET_MODE: "anything" }),
    /명시되지 않았습니다/u
  );
});

test("발행 포인터는 변경 가능한 업로드 경로 대신 자료판별 불변 경로를 가리킨다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const outputPath = path.join(fixture.tempRoot, "pointer.json");
  const immutableRelativePath = `release-candidate/datasets/${"a".repeat(64)}.ctwebui`;
  const result = await createReleasePointerFile({
    mountRoot: fixture.mountRoot,
    relativePath: fixture.relativePath,
    pointerRelativePath: immutableRelativePath,
    releaseId: "ctc-1000-rc1",
    outputPath
  });
  assert.equal(result.pointer.relativePath, immutableRelativePath);
  assert.equal(result.pointer.datasetVersion, await computeMountedDatasetVersion(fixture.webDataRoot));
});

test("부분 압축 해제 자료는 식별 파일이 생겨도 자료판 포인터로 승격하지 않는다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await fs.rm(path.join(fixture.webDataRoot, "arrays", "coverage_mask.zarr"), {
    recursive: true,
    force: true
  });

  await assert.rejects(
    () => createReleasePointerFile({
      mountRoot: fixture.mountRoot,
      relativePath: fixture.relativePath,
      releaseId: "ctc-partial",
      outputPath: path.join(fixture.tempRoot, "partial-pointer.json")
    }),
    /artifact가 아직 준비되지 않았습니다/u
  );
});

test("실행 시작 검사는 Zarr content digest를 반복하지 않고 full 검사만 변조를 거부한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const target = path.join(fixture.webDataRoot, "arrays", "coverage_mask.zarr", ".zarray");
  const originalStat = await fs.stat(target, { bigint: true });
  const original = await fs.readFile(target, "utf8");
  const replacement = "x".repeat(Buffer.byteLength(original, "utf8"));
  await fs.writeFile(target, replacement, "utf8");
  await fs.utimes(target, FIXTURE_MTIME, FIXTURE_MTIME);
  const changedStat = await fs.stat(target, { bigint: true });
  assert.equal(changedStat.size, originalStat.size);
  assert.equal(changedStat.mtimeNs, originalStat.mtimeNs);

  const startup = await validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" });
  assert.equal(startup.integrityMode, "startup");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "full" }),
    /폴더 해시가 manifest와 일치하지 않습니다/u
  );
});

test("startup 검사는 필수 Zarr 경로의 중복과 metadata 누락을 얕은 경계에서 거부한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const indexPath = path.join(fixture.webDataRoot, "meta", "array_index.json");
  const originalIndex = await fs.readFile(indexPath, "utf8");
  const index = JSON.parse(originalIndex);
  index.arrays.coverage_mask = index.arrays.raw_daily;
  await fs.writeFile(indexPath, JSON.stringify(index), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
    /배열 경로 설명/u
  );

  await fs.writeFile(indexPath, originalIndex, "utf8");
  await fs.rm(path.join(fixture.webDataRoot, "arrays", "coverage_mask.zarr", ".zarray"));
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
    /배열 metadata/u
  );
});

test("필수 Zarr는 최신 Backend content-v2 해시 계약을 하향할 수 없다", async (context) => {
  const fixture = await createMountedReleaseFixture({ zarrHashMode: "directory_listing_v1" });
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
    /content-v2 해시/u
  );
});

test("Node wrapper는 요청한 full 검사를 startup 결과로 대체하지 않는다", async () => {
  await assert.rejects(
    () => validateMountedDatasetPublication("unused.ctwebui", {
      mode: "full",
      timeoutMs: 1_000,
      spawnProcess: () => createFakeValidatorChild({
        integrityMode: "startup",
        ok: true,
        status: "complete"
      })
    }),
    /검증 결과가 올바르지 않습니다/u
  );
});

test("자료판 준비 검사는 manifest의 크기·개수와 실제 inventory가 모두 같아야 통과한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const ready = await validateMountedDatasetReady(fixture.webDataRoot);
  assert.equal(ready.artifactCount, 7);
  assert.equal(ready.fileCount, 8);

  await fs.writeFile(
    path.join(fixture.webDataRoot, "data", "scenario_model_predictions", "part-000001.parquet"),
    "추가 자료",
    "utf8"
  );
  await assert.rejects(
    () => validateMountedDatasetReady(fixture.webDataRoot),
    /폴더 해시/u
  );
});

test("원자적 v3 자료판은 완료 표식·manifest 결합·정본 봉인이 모두 맞아야 통과한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  const publication = await validateMountedDatasetPublication(fixture.webDataRoot);
  assert.equal(publication.contract, "atomic-directory-v2");
  assert.equal(publication.contractVersion, 3);
  assert.match(publication.manifestBindingSha256, /^[0-9a-f]{64}$/u);

  const markerPath = path.join(fixture.webDataRoot, "meta", "completion.json");
  const originalMarker = await fs.readFile(markerPath, "utf8");
  const changedMarker = JSON.parse(originalMarker);
  changedMarker.artifact_count += 1;
  await fs.writeFile(markerPath, JSON.stringify(changedMarker), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /완료 표식이 manifest와 일치하지 않습니다/u
  );

  await fs.writeFile(markerPath, originalMarker, "utf8");
  const manifestPath = path.join(fixture.webDataRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.artifacts[0].row_count = 1;
  await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /manifest와 결합되지 않았습니다/u
  );
});

test("완료 표식 없는 구형 자료판과 manifest 미등록 파일은 출시하지 않는다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.webDataRoot, "manifest.json");
  const originalManifest = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(originalManifest);
  delete manifest.publication_contract;
  delete manifest.completion;
  delete manifest.export_policy;
  delete manifest.generation_id;
  await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /원자적 완료 표식/u
  );

  await fs.writeFile(manifestPath, originalManifest, "utf8");
  await fs.writeFile(path.join(fixture.webDataRoot, ".env"), "SECRET=blocked", "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /manifest에 없는 파일/u
  );
});

test("파일 내용과 manifest SHA-256이 다르면 같은 크기라도 출시하지 않는다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const target = path.join(fixture.webDataRoot, "meta", "array_index.json");
  const original = await fs.readFile(target, "utf8");
  await fs.writeFile(target, original.replace("2050-01-01", "2050-01-02"), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /SHA-256/u
  );
});

test("최신 Backend Zarr content-v2 digest는 child SHA-256 정본식과 정확히 일치한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = JSON.parse(await fs.readFile(path.join(fixture.webDataRoot, "manifest.json"), "utf8"));
  const artifact = manifest.artifacts.find(({ path: artifactPath }) => artifactPath === "arrays/raw_daily.zarr");
  assert.equal(artifact.hash_mode, "directory_content_sha256_v2");
  assert.equal(artifact.file_count, 1);
  assert.equal(artifact.size_bytes, Buffer.byteLength("arrays/raw_daily.zarr", "utf8"));
  assert.equal(
    artifact.sha256,
    sha256Text(`.zarray\0${artifact.size_bytes}\0${sha256Text("arrays/raw_daily.zarr")}\n`)
  );
});

test("Backend manifest binding의 정규 JSON byte 계약을 golden digest로 고정한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = JSON.parse(await fs.readFile(path.join(fixture.webDataRoot, "manifest.json"), "utf8"));
  assert.equal(
    manifest.completion.manifest_binding_sha256,
    "590a4a7b4c07aad84d2616fb2951bee9190bcadf806e5fc873a20b7368482d7b"
  );
});

test("JSON 정수 계약은 문자열·실수·bool 버전과 범위를 벗어난 count를 거부한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.webDataRoot, "manifest.json");
  const originalManifest = await fs.readFile(manifestPath, "utf8");

  for (const invalidVersion of ["\"3\"", "3.0", "true"]) {
    const changed = originalManifest.replace('"format_version":3', `"format_version":${invalidVersion}`);
    assert.notEqual(changed, originalManifest);
    await fs.writeFile(manifestPath, changed, "utf8");
    await assert.rejects(
      () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
      /원자적 자료 게시 계약/u
    );
  }

  for (const mutate of [
    (manifest) => { manifest.completion.artifact_count = true; },
    (manifest) => { manifest.artifacts[0].file_count = 1.5; },
    (manifest) => { manifest.artifacts[0].file_count = 0; },
    (manifest) => { manifest.artifacts[0].size_bytes = -1; },
    (manifest) => { manifest.table_row_counts = { invalid: "0" }; }
  ]) {
    const manifest = JSON.parse(originalManifest);
    mutate(manifest);
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await assert.rejects(
      () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
      /완료 표식의 파일 수|artifact 설명|표 행수 설명/u
    );
  }
});

test("정본 봉인과 완료 표식은 JSON 숫자와 bool의 타입까지 정확히 일치해야 한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.webDataRoot, "manifest.json");
  const markerPath = path.join(fixture.webDataRoot, "meta", "completion.json");
  const originalManifest = await fs.readFile(manifestPath, "utf8");

  const booleanSeal = JSON.parse(originalManifest);
  booleanSeal.dataset_seal.contract_version = true;
  await fs.writeFile(manifestPath, JSON.stringify(booleanSeal), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
    /정본 봉인/u
  );

  const numericSealPrefix = '"dataset_seal":{"contract":"ctc.webui.canonical-dataset-seal","contract_version":1,';
  const floatSeal = originalManifest.replace(
    numericSealPrefix,
    numericSealPrefix.replace(":1,", ":1.0,")
  );
  assert.notEqual(floatSeal, originalManifest);
  await fs.writeFile(manifestPath, floatSeal, "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
    /정본 봉인/u
  );

  await fs.writeFile(manifestPath, originalManifest, "utf8");
  const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
  marker.table_count = false;
  await fs.writeFile(markerPath, JSON.stringify(marker), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
    /완료 표식이 manifest와 일치하지 않습니다/u
  );
});

test("artifact path와 arcname은 문자열 타입의 동일한 정규 경로여야 한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifestPath = path.join(fixture.webDataRoot, "manifest.json");
  const originalManifest = await fs.readFile(manifestPath, "utf8");
  for (const mutate of [
    (manifest) => { manifest.artifacts[0].path = 1; },
    (manifest) => { manifest.artifacts[0].path = ` ${manifest.artifacts[0].path}`; },
    (manifest) => { manifest.artifacts[0].arcname += ".alias"; }
  ]) {
    const manifest = JSON.parse(originalManifest);
    mutate(manifest);
    await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    await assert.rejects(
      () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
      /artifact 경로|내부 경로/u
    );
  }
});

test("publication validator는 Python 3.12 미만을 실행 전에 실패 폐쇄한다", () => {
  const pythonExecutable = process.platform === "win32" ? "python" : "python3";
  const validatorPath = path.resolve("scripts", "validate_ctwebui_publication.py");
  const probe = [
    "import importlib.util, sys",
    "spec = importlib.util.spec_from_file_location('ctc_validator', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module._require_supported_python((3, 11))"
  ].join("; ");
  const result = spawnSync(pythonExecutable, ["-c", probe, validatorPath], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    windowsHide: true
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Python 3\.12 이상/u);
});

test("자료판 내부 junction과 승인되지 않은 미래 형식은 실패 폐쇄한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const outside = path.join(fixture.tempRoot, "outside");
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "secret.txt"), "blocked", "utf8");
  await fs.symlink(
    outside,
    path.join(fixture.webDataRoot, "linked"),
    process.platform === "win32" ? "junction" : "dir"
  );
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /링크 또는 junction/u
  );
  await fs.rm(path.join(fixture.webDataRoot, "linked"), { recursive: true, force: true });

  const manifestPath = path.join(fixture.webDataRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  manifest.format_version = 4;
  await fs.writeFile(manifestPath, JSON.stringify(manifest), "utf8");
  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /원자적 자료 게시 계약/u
  );
});

test("startup 검사는 manifest 식별 파일의 부모 junction을 읽기 전에 거부한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const metaPath = path.join(fixture.webDataRoot, "meta");
  const outsideMetaPath = path.join(fixture.tempRoot, "outside-meta");
  await fs.rename(metaPath, outsideMetaPath);
  await fs.symlink(
    outsideMetaPath,
    metaPath,
    process.platform === "win32" ? "junction" : "dir"
  );

  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot, { mode: "startup" }),
    /링크 또는 junction|자료판 밖/u
  );
});

test("부모 junction으로 마운트 밖을 가리키는 자료판 포인터는 만들지 않는다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const releasesPath = path.join(fixture.mountRoot, "releases");
  const outsideReleasesPath = path.join(fixture.tempRoot, "outside-releases");
  await fs.rename(releasesPath, outsideReleasesPath);
  await fs.symlink(
    outsideReleasesPath,
    releasesPath,
    process.platform === "win32" ? "junction" : "dir"
  );

  await assert.rejects(
    () => createReleasePointerFile({
      mountRoot: fixture.mountRoot,
      relativePath: fixture.relativePath,
      releaseId: "ctc-parent-junction",
      outputPath: path.join(fixture.tempRoot, "junction-pointer.json")
    }),
    /실제 경로가 마운트 루트를 벗어났습니다/u
  );
});

test("부모와 자식 artifact를 함께 등록한 자료판은 거부한다", async (context) => {
  const fixture = await createMountedReleaseFixture({ includeNestedArtifact: true });
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  await assert.rejects(
    () => validateMountedDatasetPublication(fixture.webDataRoot),
    /artifact 경로가 서로 겹칩니다/u
  );
});

test("출시 후보 서버는 공개 포트와 내부 게이트웨이 포트를 분리한다", () => {
  const value = validateReleaseServerEnvironment({
    PORT: "8080",
    CTC_GATEWAY_PORT: "8765",
    CTC_PUBLIC_WEB_ORIGINS: "https://fallingenie.github.io"
  });
  assert.equal(value.publicPort, 8080);
  assert.equal(value.gatewayPort, 8765);
  assert.deepEqual([...value.allowedOrigins], ["https://fallingenie.github.io"]);
  assert.throws(
    () => validateReleaseServerEnvironment({ PORT: "8765", CTC_GATEWAY_PORT: "8765" }),
    /달라야/u
  );
});

test("공개 API는 등록한 GitHub Pages 출처의 사전 요청만 허용한다", async (context) => {
  const server = http.createServer(createReleaseRequestHandler({
    distRoot: path.join(os.tmpdir(), "unused-dist"),
    gatewayPort: 65534,
    allowedOrigins: parseAllowedOrigins("https://fallingenie.github.io")
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  context.after(async () => new Promise((resolve) => server.close(resolve)));

  const allowed = await requestLocal(origin, "/api/climate/query", {
    method: "OPTIONS",
    headers: {
      Origin: "https://fallingenie.github.io",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type"
    }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://fallingenie.github.io");
  assert.match(allowed.headers["access-control-allow-methods"], /POST/u);

  const denied = await requestLocal(origin, "/api/climate/query", {
    method: "OPTIONS",
    headers: {
      Origin: "https://attacker.example",
      "Access-Control-Request-Method": "POST"
    }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});

test("정적 서버는 dist만 제공하고 API 장애를 재시도 가능한 503으로 바꾼다", async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctc-rc-static-"));
  const distRoot = path.join(tempRoot, "dist");
  await fs.mkdir(path.join(distRoot, "assets"), { recursive: true });
  await fs.writeFile(path.join(distRoot, "index.html"), "<!doctype html><title>기후 타임캡슐</title>", "utf8");
  await fs.writeFile(path.join(distRoot, "assets", "app-AbCd1234.js"), "export default true;", "utf8");
  await fs.writeFile(path.join(tempRoot, "package.json"), "{\"private\":true}", "utf8");

  const server = http.createServer(createReleaseRequestHandler({ distRoot, gatewayPort: 65534 }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  const indexResponse = await requestLocal(origin, "/");
  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.headers["cache-control"], "no-store");
  assert.match(indexResponse.headers["content-security-policy"], /tile\.openstreetmap\.org/u);
  assert.match(indexResponse.body, /기후 타임캡슐/u);

  const assetResponse = await requestLocal(origin, "/assets/app-AbCd1234.js");
  assert.match(assetResponse.headers["cache-control"], /immutable/u);
  const privateResponse = await requestLocal(origin, "/package.json");
  assert.equal(privateResponse.status, 404);
  const gitProbeResponse = await requestLocal(origin, "/.git/HEAD");
  assert.equal(gitProbeResponse.status, 404);
  const unknownRouteResponse = await requestLocal(origin, "/teacher");
  assert.equal(unknownRouteResponse.status, 404);

  const apiResponse = await requestLocal(origin, "/api/climate/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(apiResponse.status, 503);
  assert.deepEqual(JSON.parse(apiResponse.body), {
    error: "기후자료 서비스가 응답하지 않습니다. 잠시 후 다시 시도하세요.",
    code: "gateway_unavailable",
    retryable: true
  });
});

test("게이트웨이 준비 확인은 공개 안전 health 응답만 허용한다", async () => {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  const value = await waitForGateway({
    child,
    port: 8765,
    timeoutMs: 100,
    intervalMs: 1,
    fetchImplementation: async () => new Response(JSON.stringify({ ok: true, publicSafe: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });
  assert.equal(value.publicSafe, true);
  assert.equal(child.killed, false);
});

test("공개 listen 준비 검사는 pointer·metadata·attribution 자료판 식별자를 결합한다", async () => {
  const requestedPaths = [];
  const result = await validateGatewayPublicationReadiness({
    pointer: { datasetVersion: PUBLICATION_DATASET_VERSION },
    port: 8765,
    timeoutMs: 1_000,
    fetchImplementation: async (url) => {
      const pathname = new URL(url).pathname;
      requestedPaths.push(pathname);
      const payload = pathname.endsWith("/metadata")
        ? PUBLICATION_METADATA
        : PUBLICATION_ATTRIBUTION;
      return jsonResponse(payload);
    }
  });
  assert.deepEqual(requestedPaths, [
    "/api/climate/metadata",
    "/api/climate/attribution"
  ]);
  assert.equal(result.metadata.datasetVersion, PUBLICATION_DATASET_VERSION);
  assert.equal(result.attribution.datasetUpdatedAt, PUBLICATION_DATASET_UPDATED_AT);
});

test("metadata와 dedicated attribution은 usesObservationData 의미를 보존하면서 provider catalog을 결합한다", async () => {
  const metadata = {
    ...PUBLICATION_METADATA,
    observationAttribution: {
      ...PUBLICATION_METADATA.observationAttribution,
      providerIds: ["dwd"],
      providers: [PUBLICATION_OBSERVATION_PROVIDER]
    }
  };
  const attribution = {
    ...PUBLICATION_ATTRIBUTION,
    usesObservationData: true,
    providerIds: ["dwd"],
    providers: [PUBLICATION_OBSERVATION_PROVIDER]
  };
  const result = await validateGatewayPublicationReadiness({
    pointer: { datasetVersion: PUBLICATION_DATASET_VERSION },
    port: 8765,
    timeoutMs: 1_000,
    fetchImplementation: async (url) => new URL(url).pathname.endsWith("/metadata")
      ? jsonResponse(metadata)
      : jsonResponse(attribution)
  });
  assert.deepEqual(result.metadata.observationAttribution.providerIds, ["dwd"]);
  assert.equal(result.attribution.usesObservationData, true);
});

test("공개 listen 준비 검사는 attribution 503·스키마·자료판 불일치를 실패 폐쇄한다", async (context) => {
  const pointer = { datasetVersion: PUBLICATION_DATASET_VERSION };
  const cases = [
    {
      name: "503",
      attributionResponse: new Response("not-ready", { status: 503 }),
      pattern: /attribution가 준비되지 않았습니다/u
    },
    {
      name: "schema",
      attributionResponse: jsonResponse({ ...PUBLICATION_ATTRIBUTION, schemaVersion: 2 }),
      pattern: /attribution 계약/u
    },
    {
      name: "identity",
      attributionResponse: jsonResponse({
        ...PUBLICATION_ATTRIBUTION,
        datasetUpdatedAt: "2026-08-05T00:00:00.000000+00:00"
      }),
      pattern: /자료판 식별자가 일치하지 않습니다/u
    },
    {
      name: "semantic-attribution",
      attributionResponse: jsonResponse({
        ...PUBLICATION_ATTRIBUTION,
        usesObservationData: true,
        providerIds: ["dwd"],
        providers: [PUBLICATION_OBSERVATION_PROVIDER]
      }),
      pattern: /출처 정보가 일치하지 않습니다/u
    }
  ];
  for (const item of cases) {
    await context.test(item.name, async () => {
      await assert.rejects(
        () => validateGatewayPublicationReadiness({
          pointer,
          port: 8765,
          timeoutMs: 1_000,
          fetchImplementation: async (url) => new URL(url).pathname.endsWith("/metadata")
            ? jsonResponse(PUBLICATION_METADATA)
            : item.attributionResponse
        }),
        item.pattern
      );
    });
  }
  await assert.rejects(
    () => validateGatewayPublicationReadiness({
      pointer: { datasetVersion: "b".repeat(64) },
      port: 8765,
      timeoutMs: 1_000,
      fetchImplementation: async () => jsonResponse(PUBLICATION_METADATA)
    }),
    /포인터와 게이트웨이 metadata 식별자/u
  );
});

test("env-only legacy와 testOnly 결과는 gateway spawn과 공개 bind 전에 이중 차단한다", async () => {
  const distRoot = path.resolve("dist");
  const fileSystem = fakeDistributionFileSystem(distRoot);
  let spawnCount = 0;
  let createCount = 0;
  const common = {
    fileSystem,
    spawnGateway: async () => { spawnCount += 1; },
    createServer: () => { createCount += 1; },
    env: {
      PORT: "8080",
      CTC_GATEWAY_PORT: "8765",
      CTC_FRONTEND_DIST_ROOT: distRoot
    }
  };

  await assert.rejects(
    () => startReleaseCandidateServer({
      ...common,
      env: { ...common.env, CTC_TEST_DATASET_MODE: LEGACY_TEST_DATASET_MODE }
    }),
    /공개 출시 경로/u
  );
  for (const testOnly of [true, false]) {
    await assert.rejects(
      () => startReleaseCandidateServer({
        ...common,
        resolveReleaseData: async () => ({
          env: {},
          pointer: { datasetVersion: PUBLICATION_DATASET_VERSION },
          testOnly
        })
      }),
      /공개 출시 서버/u
    );
  }
  assert.equal(spawnCount, 0);
  assert.equal(createCount, 0);
});

test("attribution readiness 실패는 공개 서버 생성과 listen 전에 gateway를 회수한다", async () => {
  const previousExitCode = process.exitCode;
  const distRoot = path.resolve("dist");
  const child = createFakeChild({ exitOnSignal: "SIGTERM" });
  let createCount = 0;
  try {
    await assert.rejects(
      () => startReleaseCandidateServer({
        env: {
          PORT: "8080",
          CTC_GATEWAY_PORT: "8765",
          CTC_FRONTEND_DIST_ROOT: distRoot,
          CTC_GATEWAY_STARTUP_TIMEOUT_MS: "1000"
        },
        fileSystem: fakeDistributionFileSystem(distRoot),
        resolveReleaseData: async () => ({
          env: {},
          pointer: { datasetVersion: PUBLICATION_DATASET_VERSION }
        }),
        spawnGateway: async () => ({ child }),
        createServer: () => { createCount += 1; },
        signalTarget: new EventEmitter(),
        fetchImplementation: async (url) => {
          const pathname = new URL(url).pathname;
          if (pathname.endsWith("/health")) {
            return jsonResponse({ ok: true, publicSafe: true });
          }
          if (pathname.endsWith("/metadata")) return jsonResponse(PUBLICATION_METADATA);
          return new Response("not-ready", { status: 503 });
        }
      }),
      /attribution가 준비되지 않았습니다/u
    );
    assert.equal(createCount, 0);
    assert.deepEqual(child.signals, ["SIGTERM"]);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("readiness 직후 gateway 종료 이벤트도 공개 서버 생성 전에 차단한다", async () => {
  const previousExitCode = process.exitCode;
  const distRoot = path.resolve("dist");
  const child = createFakeChild({ exitOnSignal: "SIGTERM" });
  let createCount = 0;
  try {
    await assert.rejects(
      () => startReleaseCandidateServer({
        env: {
          PORT: "8080",
          CTC_GATEWAY_PORT: "8765",
          CTC_FRONTEND_DIST_ROOT: distRoot,
          CTC_GATEWAY_STARTUP_TIMEOUT_MS: "1000"
        },
        fileSystem: fakeDistributionFileSystem(distRoot),
        resolveReleaseData: async () => ({
          env: {},
          pointer: { datasetVersion: PUBLICATION_DATASET_VERSION }
        }),
        spawnGateway: async () => ({ child }),
        createServer: () => { createCount += 1; },
        signalTarget: new EventEmitter(),
        fetchImplementation: async (url) => {
          const pathname = new URL(url).pathname;
          if (pathname.endsWith("/health")) {
            return jsonResponse({ ok: true, publicSafe: true });
          }
          if (pathname.endsWith("/metadata")) return jsonResponse(PUBLICATION_METADATA);
          queueMicrotask(() => child.emit("exit", 1));
          return jsonResponse(PUBLICATION_ATTRIBUTION);
        }
      }),
      /공개 서버 시작 전에 종료/u
    );
    assert.equal(createCount, 0);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("gateway가 공개 listen 대기 중 종료되면 pending bind를 AbortSignal로 취소한다", async () => {
  const previousExitCode = process.exitCode;
  const distRoot = path.resolve("dist");
  const child = createFakeChild({ exitOnSignal: "SIGTERM" });
  const pendingServer = new EventEmitter();
  pendingServer.listening = false;
  pendingServer.close = (callback) => {
    pendingServer.listening = false;
    callback?.();
  };
  pendingServer.closeAllConnections = () => {};
  pendingServer.closeIdleConnections = () => {};
  let listenSignal;
  let bindCompleted = false;
  pendingServer.listen = (options, callback) => {
    listenSignal = options.signal;
    queueMicrotask(() => child.emit("exit", 1));
    setImmediate(() => {
      if (options.signal.aborted) return;
      pendingServer.listening = true;
      bindCompleted = true;
      callback();
    });
    return pendingServer;
  };
  try {
    await assert.rejects(
      () => startReleaseCandidateServer({
        env: {
          PORT: "8080",
          CTC_GATEWAY_PORT: "8765",
          CTC_FRONTEND_DIST_ROOT: distRoot,
          CTC_GATEWAY_STARTUP_TIMEOUT_MS: "1000"
        },
        fileSystem: fakeDistributionFileSystem(distRoot),
        resolveReleaseData: async () => ({
          env: {},
          pointer: {
            datasetVersion: PUBLICATION_DATASET_VERSION,
            releaseId: "ctc-1000-rc1"
          }
        }),
        spawnGateway: async () => ({ child }),
        createServer: () => pendingServer,
        signalTarget: new EventEmitter(),
        fetchImplementation: async (url) => {
          const pathname = new URL(url).pathname;
          if (pathname.endsWith("/health")) {
            return jsonResponse({ ok: true, publicSafe: true });
          }
          if (pathname.endsWith("/metadata")) return jsonResponse(PUBLICATION_METADATA);
          return jsonResponse(PUBLICATION_ATTRIBUTION);
        }
      }),
      /취소되었습니다|공개 서버 시작 전에 종료/u
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(listenSignal?.aborted, true);
    assert.equal(bindCompleted, false);
    assert.equal(pendingServer.listening, false);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("gateway spawn 시간도 공개 시작 제한시간 예산에 포함한다", async () => {
  const previousExitCode = process.exitCode;
  const distRoot = path.resolve("dist");
  const child = createFakeChild({ exitOnSignal: "SIGTERM" });
  let fetchCount = 0;
  try {
    await assert.rejects(
      () => startReleaseCandidateServer({
        env: {
          PORT: "8080",
          CTC_GATEWAY_PORT: "8765",
          CTC_FRONTEND_DIST_ROOT: distRoot,
          CTC_GATEWAY_STARTUP_TIMEOUT_MS: "1"
        },
        fileSystem: fakeDistributionFileSystem(distRoot),
        resolveReleaseData: async () => ({
          env: {},
          pointer: { datasetVersion: PUBLICATION_DATASET_VERSION }
        }),
        spawnGateway: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { child };
        },
        createServer: () => assert.fail("공개 서버를 만들면 안 됩니다."),
        signalTarget: new EventEmitter(),
        fetchImplementation: async () => {
          fetchCount += 1;
          return jsonResponse({ ok: true, publicSafe: true });
        }
      }),
      /준비 시간이 초과/u
    );
    assert.equal(fetchCount, 0);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("게이트웨이 spawn 오류와 종료 제한시간은 자식 프로세스를 회수한다", async () => {
  const failedChild = createFakeChild({ exitOnSignal: "SIGTERM" });
  const readiness = waitForGateway({
    child: failedChild,
    port: 8765,
    timeoutMs: 100,
    intervalMs: 1,
    fetchImplementation: async () => { throw new Error("not-ready"); }
  });
  queueMicrotask(() => failedChild.emit("error", new Error("spawn-failed")));
  await assert.rejects(readiness, /준비 전에 종료/u);
  assert.deepEqual(failedChild.signals, ["SIGTERM"]);

  const stalledChild = createFakeChild({ exitOnSignal: "SIGKILL" });
  await terminateChild(stalledChild, { timeoutMs: 1 });
  assert.deepEqual(stalledChild.signals, ["SIGTERM", "SIGKILL"]);
});

test("브라우저가 조회를 취소하면 프록시도 Backend 요청을 중단한다", async (context) => {
  let resolveUpstreamRequest;
  const upstreamRequest = new Promise((resolve) => { resolveUpstreamRequest = resolve; });
  const backend = http.createServer((request) => resolveUpstreamRequest(request));
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const backendPort = backend.address().port;
  const frontend = http.createServer(createReleaseRequestHandler({
    distRoot: path.join(os.tmpdir(), "unused-dist"),
    gatewayPort: backendPort
  }));
  await new Promise((resolve) => frontend.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    frontend.closeAllConnections?.();
    backend.closeAllConnections?.();
    await Promise.all([
      new Promise((resolve) => frontend.close(resolve)),
      new Promise((resolve) => backend.close(resolve))
    ]);
  });

  const client = http.request({
    host: "127.0.0.1",
    port: frontend.address().port,
    path: "/api/climate/query",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": "100000" }
  });
  client.once("error", () => {});
  client.write("{");
  const backendRequest = await upstreamRequest;
  const backendClosed = new Promise((resolve) => {
    backendRequest.once("aborted", resolve);
    backendRequest.once("close", resolve);
  });
  client.destroy();
  await Promise.race([
    backendClosed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Backend 요청이 중단되지 않았습니다.")), 1_000))
  ]);
});

test("Cloud Run 배포는 공개 읽기 전용 GCS와 API, 체크섬 승격을 강제한다", async () => {
  const configureScript = await fs.readFile(new URL("../deploy/configure-public-release-data.ps1", import.meta.url), "utf8");
  const deployScript = await fs.readFile(new URL("../deploy/deploy-release-candidate.ps1", import.meta.url), "utf8");
  const publishScript = await fs.readFile(new URL("../deploy/publish-release-pointer.ps1", import.meta.url), "utf8");
  const promoteScript = await fs.readFile(new URL("../deploy/promote-release-candidate.ps1", import.meta.url), "utf8");
  const pagesScript = await fs.readFile(new URL("../deploy/publish-github-pages.ps1", import.meta.url), "utf8");
  const cloudBuild = await fs.readFile(new URL("../deploy/cloudbuild.yaml", import.meta.url), "utf8");
  const dockerfile = await fs.readFile(new URL("../deploy/Dockerfile", import.meta.url), "utf8");
  const requirements = await fs.readFile(new URL("../deploy/requirements-gateway.txt", import.meta.url), "utf8");
  for (const script of [configureScript, deployScript, publishScript, promoteScript, pagesScript]) {
    assert.match(script, /\$ErrorActionPreference\s*=\s*'Continue'/u);
    assert.match(script, /\$exitCode\s*=\s*\$LASTEXITCODE/u);
  }
  assert.match(deployScript, /readonly=true/u);
  assert.match(deployScript, /only-dir=\$normalizedBucketPrefix/u);
  assert.doesNotMatch(deployScript, /stat-cache-max-size-mb|type-cache-max-size-mb/u);
  assert.match(deployScript, /--allow-unauthenticated/u);
  assert.match(deployScript, /--no-iap/u);
  assert.match(deployScript, /--no-traffic/u);
  assert.match(deployScript, /\$serviceExists\s*=\s*Test-ExternalSuccess/u);
  assert.match(deployScript, /if \(\$serviceExists\)[\s\S]+\$deployArguments \+= '--no-traffic'/u);
  assert.match(deployScript, /\$revisionTag\s*=\s*"rc-\$frontendShort-\$backendShort-\$datasetShort"/u);
  assert.match(deployScript, /\(\$ServiceName\.Length \+ \$revisionTag\.Length\) -gt 46/u);
  assert.match(deployScript, /ReleasePointerObject/u);
  assert.match(deployScript, /image_summary\.digest/u);
  assert.match(deployScript, /ls-remote/u);
  assert.match(deployScript, /public_access_prevention/u);
  assert.match(deployScript, /uniform_bucket_level_access/u);
  assert.match(deployScript, /roles\/storage\.objectViewer/u);
  assert.match(deployScript, /managed-folders', 'get-iam-policy/u);
  assert.match(deployScript, /\$ErrorActionPreference\s*=\s*'Continue'/u);
  assert.doesNotMatch(deployScript, /roles\/storage\.legacyObjectReader/u);
  assert.match(deployScript, /CTC_PUBLIC_WEB_ORIGINS/u);
  assert.doesNotMatch(deployScript, /--no-allow-unauthenticated/u);
  assert.match(configureScript, /managed-folders', 'create/u);
  assert.match(configureScript, /managed-folders', 'add-iam-policy-binding/u);
  assert.match(configureScript, /roles\/storage\.objectViewer/u);
  assert.match(configureScript, /BucketRootPublic\s*=\s*\$false/u);
  assert.match(configureScript, /PublicWriteAllowed\s*=\s*\$false/u);
  assert.match(configureScript, /--no-public-access-prevention/u);
  assert.match(configureScript, /\$cors\s*=\s*'\['/u);
  assert.doesNotMatch(configureScript, /buckets', 'add-iam-policy-binding'[\s\S]+roles\/storage\.objectViewer/u);
  assert.match(publishScript, /--checksums-only/u);
  assert.match(publishScript, /--dry-run/u);
  assert.match(publishScript, /Invoke-CapturedCombined/u);
  assert.match(publishScript, /--delete-unmatched-destination-objects/u);
  assert.match(publishScript, /release-candidate\/releases\/\$datasetVersion\.json/u);
  assert.match(publishScript, /release-candidate\/datasets\/\$datasetVersion\.ctwebui/u);
  assert.match(publishScript, /--if-generation-match=0/u);
  assert.match(publishScript, /public,max-age=31536000,immutable/u);
  assert.match(publishScript, /\$ErrorActionPreference\s*=\s*'Continue'/u);
  assert.match(publishScript, /release-candidate\/current\.json/u);
  assert.equal((publishScript.match(/create-release-pointer\.mjs/gu) || []).length, 2);
  assert.match(publishScript, /--pointer-relative-path\s+\$snapshotRelativePath/u);
  assert.match(publishScript, /로컬 자료판이 변경되었습니다/u);
  assert.match(
    publishScript,
    /\$finalSnapshotComparisonOutput[\s\S]+포인터 발행 직전 GCS 자료판이 로컬 정본과 일치하지 않습니다/u
  );
  assert.doesNotMatch(promoteScript, /service-accounts', 'sign-jwt/u);
  assert.match(promoteScript, /CTC_PRODUCTION_AUTHORIZATION_TOKEN_FILE\s*=\s*\$null/u);
  assert.match(promoteScript, /Access-Control-Request-Method/u);
  assert.match(promoteScript, /ConvertTo-ProcessArgument/u);
  assert.ok(promoteScript.indexOf("create-production-data-attestation.mjs") < promoteScript.indexOf("update-traffic"));
  assert.match(promoteScript, /--to-revisions/u);
  assert.match(promoteScript, /\$bootstrapService/u);
  assert.match(promoteScript, /function Test-ExternalSuccess/u);
  assert.match(promoteScript, /Test-ExternalSuccess \$gcloud/u);
  assert.match(promoteScript, /'run', 'services', 'delete', \$ServiceName/u);
  assert.match(promoteScript, /\$previousTrafficAllocation/u);
  assert.match(pagesScript, /variable', 'set', 'CTC_PUBLIC_API_ORIGIN/u);
  assert.match(pagesScript, /--visibility', 'public/u);
  assert.match(pagesScript, /build_type=workflow/u);
  assert.match(pagesScript, /existingPages\.build_type\s+-ne\s+'workflow'/u);
  assert.match(pagesScript, /pages\.https_enforced/u);
  assert.doesNotMatch(pagesScript, /'https_enforced=true'/u);
  assert.match(pagesScript, /workflow', 'run', 'pages\.yml/u);
  assert.match(pagesScript, /foreach \(\$parsedRun in \$parsedRuns\)/u);
  assert.match(pagesScript, /PSObject\.Properties\['headSha'\]/u);
  assert.match(cloudBuild, /pnpm test/u);
  assert.match(cloudBuild, /node:22-trixie-slim/u);
  assert.match(cloudBuild, /apt-get install --yes --no-install-recommends python3/u);
  assert.match(cloudBuild, /smoke-container/u);
  assert.match(cloudBuild, /raw_zarr_point_worker/u);
  assert.doesNotMatch(cloudBuild, /id:\s*push-container/u);
  assert.match(dockerfile, /apt-get install --yes --no-install-recommends python3/u);
  assert.match(dockerfile, /^FROM node:22-trixie-slim AS frontend-build$/mu);
  assert.match(dockerfile, /^USER 10001:10001$/mu);
  assert.doesNotMatch(requirements, /[<>~]=?/u);
});

async function createMountedReleaseFixture({
  includeNestedArtifact = false,
  zarrHashMode = "directory_content_sha256_v2"
} = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctc-rc-pointer-"));
  const mountRoot = path.join(tempRoot, "gcs");
  const relativePath = "releases/ctc-1000-rc1/data.ctwebui";
  const webDataRoot = path.join(mountRoot, ...relativePath.split("/"));
  const pointerPath = path.join(mountRoot, "release-candidate", "current.json");
  await fs.mkdir(path.join(webDataRoot, "meta"), { recursive: true });
  const arrayPaths = {
    raw_daily: "arrays/raw_daily.zarr",
    corrected_daily: "arrays/corrected_daily.zarr",
    coverage_mask: "arrays/coverage_mask.zarr"
  };
  for (const relativePath of Object.values(arrayPaths)) {
    const target = path.join(webDataRoot, ...relativePath.split("/"));
    await fs.mkdir(target, { recursive: true });
    const zarrayPath = path.join(target, ".zarray");
    await fs.writeFile(zarrayPath, relativePath, "utf8");
    await fs.utimes(zarrayPath, FIXTURE_MTIME, FIXTURE_MTIME);
  }
  const dataRelativePath = "data/scenario_model_predictions";
  const dataRoot = path.join(webDataRoot, ...dataRelativePath.split("/"));
  await fs.mkdir(dataRoot, { recursive: true });
  const dataPath = path.join(dataRoot, "part-000000.parquet");
  await fs.writeFile(dataPath, "fixture", "utf8");
  await fs.utimes(dataPath, FIXTURE_MTIME, FIXTURE_MTIME);

  await fs.writeFile(path.join(webDataRoot, "meta", "array_index.json"), JSON.stringify({
    arrays: arrayPaths,
    dates: ["2050-01-01"],
    locations: [{ lat: 37.5, lon: 127 }],
    models: ["MODEL-A"],
    scenarios: ["ssp585"],
    variables: ["tasmax"]
  }), "utf8");
  await fs.writeFile(path.join(webDataRoot, "meta", "raw_cmip6_index.json"), JSON.stringify({
    entry_count: 1,
    entries: [{ model: "MODEL-A", path: "model-a", scenario: "ssp585", variable: "tasmax" }],
    format: "Climate Time Capsule WebUI Raw CMIP6 Connector Index"
  }), "utf8");
  const artifactPaths = [
    "meta/array_index.json",
    "meta/raw_cmip6_index.json",
    ...Object.values(arrayPaths),
    dataRelativePath
  ];
  if (includeNestedArtifact) {
    artifactPaths.push(`${dataRelativePath}/part-000000.parquet`);
  }
  const artifacts = [];
  for (const relativePath of artifactPaths) {
    const target = path.join(webDataRoot, ...relativePath.split("/"));
    const stats = await fixtureArtifactStats(target, { zarrHashMode });
    artifacts.push({
      arcname: relativePath,
      file_count: stats.fileCount,
      hash_mode: stats.hashMode,
      path: relativePath,
      sha256: stats.sha256,
      size_bytes: stats.sizeBytes
    });
  }
  await fs.writeFile(path.join(webDataRoot, "manifest.json"), JSON.stringify({
    artifacts,
    format: "Climate Time Capsule WebUI Hybrid Export",
    format_version: 3,
    manifest_path: "manifest.json",
    root: "."
  }), "utf8");
  await upgradeFixtureToAtomicV3(webDataRoot);
  return { mountRoot, pointerPath, relativePath, tempRoot, webDataRoot };
}

async function moveFixtureToImmutableReleasePath(fixture, datasetVersion) {
  assert.match(datasetVersion, /^[0-9a-f]{64}$/u);
  const relativePath = `release-candidate/datasets/${datasetVersion}.ctwebui`;
  const webDataRoot = path.join(fixture.mountRoot, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(webDataRoot), { recursive: true });
  await fs.rename(fixture.webDataRoot, webDataRoot);
  return { ...fixture, relativePath, webDataRoot };
}

async function fixtureArtifactStats(
  target,
  { zarrHashMode = "directory_content_sha256_v2" } = {}
) {
  const stat = await fs.stat(target);
  if (stat.isFile()) {
    return {
      fileCount: 1,
      hashMode: "sha256",
      sha256: createHash("sha256").update(await fs.readFile(target)).digest("hex"),
      sizeBytes: stat.size
    };
  }
  const files = [];
  let sizeBytes = 0;
  const pending = [target];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(child);
      } else if (entry.isFile()) {
        const childStat = await fs.stat(child, { bigint: true });
        const relativePath = path.relative(target, child).replaceAll("\\", "/");
        files.push({
          childSha256: createHash("sha256").update(await fs.readFile(child)).digest("hex"),
          mtimeNs: childStat.mtimeNs,
          relativePath,
          size: Number(childStat.size)
        });
        sizeBytes += Number(childStat.size);
      }
    }
  }
  const digest = createHash("sha256");
  const hashMode = target.toLowerCase().endsWith(".zarr")
    ? zarrHashMode
    : "directory_listing_v1";
  files.sort((left, right) => left.relativePath < right.relativePath ? -1 : Number(left.relativePath > right.relativePath));
  files.forEach(({ childSha256, mtimeNs, relativePath, size }) => {
    const identity = hashMode === "directory_content_sha256_v2" ? childSha256 : mtimeNs;
    digest.update(`${relativePath}\0${size}\0${identity}\n`, "utf8");
  });
  return {
    fileCount: files.length,
    hashMode,
    sha256: digest.digest("hex"),
    sizeBytes
  };
}

async function upgradeFixtureToAtomicV3(webDataRoot) {
  const manifestPath = path.join(webDataRoot, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const generationId = "b".repeat(64);
  const fingerprint = {
    algorithm: "sha256",
    component_sha256: {
      coverage: "c".repeat(64),
      query_context: "d".repeat(64)
    },
    contract: "ctc.immutable-artifact-inputs",
    contract_version: 2,
    sha256: "e".repeat(64)
  };
  const exportPolicy = {
    atomic_publish: true,
    completion_marker: "meta/completion.json"
  };
  const tableRowCounts = {};
  const completionBase = {
    artifact_count: manifest.artifacts.length + 1,
    atomic_publish: true,
    completed_at_unix_ns: 123456789,
    contract_version: 3,
    generation_id: generationId,
    observation_contract_version: 1,
    status: "complete",
    table_count: 0
  };
  const bindingPayload = {
    artifacts: manifest.artifacts
      .map((artifact) => ({
        file_count: Number(artifact.file_count || 1),
        hash_mode: String(artifact.hash_mode || ""),
        path: String(artifact.path || artifact.arcname || ""),
        row_count: Number(artifact.row_count || 0),
        sha256: String(artifact.sha256 || "").toLowerCase(),
        size_bytes: Number(artifact.size_bytes || 0),
        table_name: String(artifact.table_name || "")
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    completion: completionBase,
    dataset_id: fingerprint.sha256,
    export_policy: exportPolicy,
    format: "Climate Time Capsule WebUI Hybrid Export",
    format_version: 3,
    generation_id: generationId,
    immutable_input_fingerprint: fingerprint,
    observation_contract_version: 1,
    publication_contract: "atomic-directory-v2",
    source_fingerprint: fingerprint,
    table_row_counts: tableRowCounts
  };
  const binding = sha256Text(canonicalJson(bindingPayload));
  const completion = {
    ...completionBase,
    manifest_binding_sha256: binding
  };
  const markerPath = path.join(webDataRoot, "meta", "completion.json");
  const markerText = JSON.stringify(completion, null, 2);
  await fs.writeFile(markerPath, markerText, "utf8");
  const markerStats = await fixtureArtifactStats(markerPath);
  const markerArtifact = {
    arcname: "meta/completion.json",
    file_count: markerStats.fileCount,
    hash_mode: "sha256",
    path: "meta/completion.json",
    row_count: 0,
    sha256: sha256Text(markerText),
    size_bytes: markerStats.sizeBytes,
    table_name: ""
  };
  const datasetSeal = {
    contract: "ctc.webui.canonical-dataset-seal",
    contract_version: 1,
    dataset_id: fingerprint.sha256,
    manifest_hash: binding,
    source_fingerprint: fingerprint,
    status: "sealed"
  };
  await fs.writeFile(manifestPath, JSON.stringify({
    ...manifest,
    artifacts: [...manifest.artifacts, markerArtifact],
    completion,
    dataset_id: fingerprint.sha256,
    dataset_seal: datasetSeal,
    export_policy: exportPolicy,
    generation_id: generationId,
    immutable_input_fingerprint: fingerprint,
    manifest_hash: binding,
    observation_contract_version: 1,
    publication_contract: "atomic-directory-v2",
    source_fingerprint: fingerprint,
    table_row_counts: tableRowCounts
  }), "utf8");
}

async function downgradeFixtureToLegacyV2(webDataRoot) {
  const manifestPath = path.join(webDataRoot, "manifest.json");
  const markerPath = path.join(webDataRoot, "meta", "completion.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const generationId = "9".repeat(64);
  const manifestBindingSha256 = "8".repeat(64);
  const completion = {
    ...manifest.completion,
    contract_version: 2,
    generation_id: generationId,
    manifest_binding_sha256: manifestBindingSha256,
    table_count: 1
  };
  const legacyManifest = {
    ...manifest,
    completion,
    generation_id: generationId,
    table_row_counts: { scenario_model_predictions: 1 }
  };
  for (const key of ["dataset_id", "dataset_seal", "manifest_hash", "source_fingerprint"]) {
    delete legacyManifest[key];
  }
  await fs.writeFile(markerPath, JSON.stringify(completion, null, 2), "utf8");
  await fs.writeFile(manifestPath, JSON.stringify(legacyManifest), "utf8");
  return { generationId, manifestBindingSha256 };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function jsonResponse(value, { status = 200 } = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function fakeDistributionFileSystem(distRoot) {
  return {
    async lstat(target) {
      return {
        isDirectory: () => path.resolve(target) === path.resolve(distRoot),
        isFile: () => path.resolve(target) === path.resolve(distRoot, "index.html")
      };
    }
  };
}

function requestLocal(origin, pathname, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(pathname, origin), { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => resolve({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        status: response.statusCode
      }));
    });
    request.once("error", reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

function createFakeChild({ exitOnSignal }) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (signal === exitOnSignal) {
      child.killed = true;
      queueMicrotask(() => child.emit("exit", null, signal));
    }
    return true;
  };
  return child;
}

function createFakeValidatorChild(payload) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  queueMicrotask(() => {
    child.stdout.emit("data", Buffer.from(JSON.stringify(payload), "utf8"));
    child.emit("close", 0);
  });
  return child;
}
