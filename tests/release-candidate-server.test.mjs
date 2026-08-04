import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  resolveReleaseDataEnvironment,
  validateMountedDatasetPublication,
  validateMountedDatasetReady
} from "../scripts/release-candidate-data.mjs";
import { createReleasePointerFile } from "../scripts/create-release-pointer.mjs";
import {
  createReleaseRequestHandler,
  parseAllowedOrigins,
  terminateChild,
  validateReleaseServerEnvironment,
  waitForGateway
} from "../scripts/start-release-candidate-server.mjs";

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
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const datasetVersion = await computeMountedDatasetVersion(fixture.webDataRoot);
  const pointer = createReleasePointer({
    releaseId: "ctc-1000-rc1",
    relativePath: fixture.relativePath,
    datasetVersion
  });
  await fs.mkdir(path.dirname(fixture.pointerPath), { recursive: true });
  await fs.writeFile(fixture.pointerPath, `${JSON.stringify(pointer)}\n`, "utf8");

  const result = await resolveReleaseDataEnvironment({
    CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
    CTC_RELEASE_POINTER: fixture.pointerPath
  });
  assert.equal(result.webDataRoot, fixture.webDataRoot);
  assert.equal(result.env.CTC_WEB_DATA_ROOT, fixture.webDataRoot);

  await fs.writeFile(fixture.pointerPath, JSON.stringify({ ...pointer, datasetVersion: "b".repeat(64) }), "utf8");
  await assert.rejects(
    () => resolveReleaseDataEnvironment({
      CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
      CTC_RELEASE_POINTER: fixture.pointerPath
    }),
    /일치하지 않습니다/u
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

  const result = await resolveReleaseDataEnvironment(testEnvironment);
  assert.equal(result.testOnly, true);
  assert.equal(result.acknowledgedIntegrityGapBytes, 69114);
  assert.equal(result.pointer.releaseId, `test-${datasetVersion.slice(0, 12)}`);
  assert.equal(result.pointer.datasetVersion, datasetVersion);

  await assert.rejects(
    () => resolveReleaseDataEnvironment({
      ...testEnvironment,
      CTC_TEST_EXPECTED_DATASET_VERSION: "f".repeat(64)
    }),
    /SHA-256이 승인한 값과 일치하지 않습니다/u
  );
  await assert.rejects(
    () => resolveReleaseDataEnvironment({
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
    /정상 배포 절차/u
  );
  await assert.rejects(
    () => resolveReleaseDataEnvironment({ ...environment, CTC_RELEASE_POINTER: fixture.pointerPath }),
    /운영 포인터/u
  );
  await assert.rejects(
    () => resolveReleaseDataEnvironment({ ...environment, CTC_TEST_DATASET_MODE: "anything" }),
    /실행 방식/u
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

test("실행 시작 검사도 완료 표식 뒤에 누락된 Zarr 청크를 거부한다", async (context) => {
  const fixture = await createMountedReleaseFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const datasetVersion = await computeMountedDatasetVersion(fixture.webDataRoot);
  const pointer = createReleasePointer({
    releaseId: "ctc-startup-partial",
    relativePath: fixture.relativePath,
    datasetVersion
  });
  await fs.mkdir(path.dirname(fixture.pointerPath), { recursive: true });
  await fs.writeFile(fixture.pointerPath, `${JSON.stringify(pointer)}\n`, "utf8");
  await fs.rm(path.join(fixture.webDataRoot, "arrays", "coverage_mask.zarr", ".zarray"));

  await assert.rejects(
    () => resolveReleaseDataEnvironment({
      CTC_PREPARED_DATA_MOUNT_ROOT: fixture.mountRoot,
      CTC_RELEASE_POINTER: fixture.pointerPath
    }),
    /폴더 해시가 manifest와 일치하지 않습니다/u
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
  assert.match(cloudBuild, /apt-get install --yes --no-install-recommends python3/u);
  assert.match(cloudBuild, /smoke-container/u);
  assert.match(cloudBuild, /raw_zarr_point_worker/u);
  assert.doesNotMatch(cloudBuild, /id:\s*push-container/u);
  assert.match(dockerfile, /apt-get install --yes --no-install-recommends python3/u);
  assert.match(dockerfile, /^USER 10001:10001$/mu);
  assert.doesNotMatch(requirements, /[<>~]=?/u);
});

async function createMountedReleaseFixture({ includeNestedArtifact = false } = {}) {
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
    await fs.writeFile(path.join(target, ".zarray"), relativePath, "utf8");
  }
  const dataRelativePath = "data/scenario_model_predictions";
  const dataRoot = path.join(webDataRoot, ...dataRelativePath.split("/"));
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.writeFile(path.join(dataRoot, "part-000000.parquet"), "fixture", "utf8");

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
    const stats = await fixtureArtifactStats(target);
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

async function fixtureArtifactStats(target) {
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
          mtimeNs: childStat.mtimeNs,
          relativePath,
          size: Number(childStat.size)
        });
        sizeBytes += Number(childStat.size);
      }
    }
  }
  const digest = createHash("sha256");
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  files.forEach(({ mtimeNs, relativePath, size }) => {
    digest.update(`${relativePath}\0${size}\0${mtimeNs}\n`, "utf8");
  });
  return {
    fileCount: files.length,
    hashMode: "directory_listing_v1",
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
