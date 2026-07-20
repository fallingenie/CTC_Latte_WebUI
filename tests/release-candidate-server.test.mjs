import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import {
  computeMountedDatasetVersion,
  createReleasePointer,
  parseReleasePointer,
  resolveReleaseDataEnvironment
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
  assert.match(cloudBuild, /smoke-container/u);
  assert.match(cloudBuild, /raw_zarr_point_worker/u);
  assert.doesNotMatch(cloudBuild, /id:\s*push-container/u);
  assert.match(dockerfile, /^USER 10001:10001$/mu);
  assert.doesNotMatch(requirements, /[<>~]=?/u);
});

async function createMountedReleaseFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctc-rc-pointer-"));
  const mountRoot = path.join(tempRoot, "gcs");
  const relativePath = "releases/ctc-1000-rc1/data.ctwebui";
  const webDataRoot = path.join(mountRoot, ...relativePath.split("/"));
  const pointerPath = path.join(mountRoot, "release-candidate", "current.json");
  await fs.mkdir(path.join(webDataRoot, "meta"), { recursive: true });
  await fs.writeFile(path.join(webDataRoot, "manifest.json"), "{\"format\":\"ctwebui\"}", "utf8");
  await fs.writeFile(path.join(webDataRoot, "meta", "array_index.json"), "{\"dates\":[\"2050-01-01\"]}", "utf8");
  await fs.writeFile(path.join(webDataRoot, "meta", "raw_cmip6_index.json"), "{\"entry_count\":1}", "utf8");
  return { mountRoot, pointerPath, relativePath, tempRoot, webDataRoot };
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
