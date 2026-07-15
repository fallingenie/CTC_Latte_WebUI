import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildGatewayChildEnvironment,
  validateCloudOnlyDeploymentEnvironment,
  validateGatewayEnvironment,
  validateGatewayFiles,
  validateRawCmip6Index
} from "../scripts/start-production-gateway.mjs";
import {
  PRODUCTION_ATTESTATION_FIELDS,
  buildProductionAttestation,
  computeDatasetVersion,
  createProductionDataAttestation,
  hasInternalPathExposure,
  resolveStrictGitMode,
  validateProductionAttestation,
  validateProductionAttestationFreshness
} from "../scripts/create-production-data-attestation.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixedDatasetTime = new Date("2026-07-13T16:22:20.121Z");
const backendDatasetTime = "2026-07-13T16:22:20.121000+00:00";

test("운영 환경은 Google Drive 마운트 안의 Web 자료와 GCS 원자료만 허용한다", () => {
  const driveRoot = path.resolve("drive-mount");
  const webDataRoot = path.join(driveRoot, "release.ctwebui");
  const env = {
    CTC_BACKEND_ROOT: path.resolve("backend"),
    CTC_GOOGLE_DRIVE_MOUNT_ROOT: driveRoot,
    CTC_WEB_DATA_ROOT: webDataRoot,
    CTC_WEBUI_CMIP6_ZARR_ROOT: "gs://private-bucket/cmip6"
  };

  const value = validateCloudOnlyDeploymentEnvironment(env);
  assert.equal(value.webDataRoot, webDataRoot);
  assert.equal(value.driveMountRoot, driveRoot);
  assert.equal(value.rawCmip6Root, env.CTC_WEBUI_CMIP6_ZARR_ROOT);

  assert.throws(
    () => validateCloudOnlyDeploymentEnvironment({ ...env, CTC_WEB_DATA_ROOT: path.resolve("outside.ctwebui") }),
    /Google Drive 마운트/u
  );
  assert.throws(
    () => validateCloudOnlyDeploymentEnvironment({ ...env, CTC_WEBUI_CMIP6_ZARR_ROOT: path.resolve("raw-zarr") }),
    /GCS 루트/u
  );
  assert.throws(
    () => validateCloudOnlyDeploymentEnvironment({ ...env, CLIMATE_CMIP6_LOCAL_ZARR_ROOT: path.resolve("raw-zarr") }),
    /비어 있어야/u
  );
});

test("운영 실행기는 loopback과 허용된 Python 실행기만 사용한다", () => {
  const driveRoot = path.resolve("drive-mount");
  const env = {
    CTC_BACKEND_ROOT: path.resolve("backend"),
    CTC_GOOGLE_DRIVE_MOUNT_ROOT: driveRoot,
    CTC_WEB_DATA_ROOT: path.join(driveRoot, "release.ctwebui"),
    CTC_WEBUI_CMIP6_ZARR_ROOT: "gs://private-bucket/cmip6",
    CTC_GATEWAY_PORT: "8765",
    CTC_PYTHON_EXECUTABLE: "python"
  };

  const value = validateGatewayEnvironment(env);
  assert.equal(value.host, "127.0.0.1");
  assert.equal(value.port, 8765);
  assert.throws(() => validateGatewayEnvironment({ ...env, CTC_GATEWAY_HOST: "0.0.0.0" }), /loopback/u);
  assert.throws(
    () => validateGatewayEnvironment({ ...env, CTC_PYTHON_EXECUTABLE: path.resolve("untrusted.exe") }),
    /허용된 Python/u
  );
});

test("게이트웨이 자식 환경은 로컬 대체 경로와 비공개 실행 설정을 제거한다", () => {
  const configuration = {
    backendRoot: path.resolve("backend"),
    webDataRoot: path.resolve("drive", "release.ctwebui"),
    rawCmip6Root: "gs://private-bucket/cmip6"
  };
  const child = buildGatewayChildEnvironment({
    PATH: process.env.PATH,
    CLIMATE_CMIP6_LOCAL_ZARR_ROOT: "local",
    CLIMATE_CMIP6_EXTRACTION_CACHE_ROOT: "local",
    CLIMATE_TIME_CAPSULE_RAW_ZARR_POINT_CACHE_DIR: "local",
    CLIMATE_TIME_CAPSULE_RAW_ZARR_POINT_CACHE_ROOT: "local",
    CTC_GOOGLE_DRIVE_MOUNT_ROOT: "private",
    CTC_PRODUCTION_ATTESTATION_OUTPUT: "private"
  }, configuration);

  assert.equal(child.CTC_WEBUI_RAW_CMIP6_INDEX_CACHE, "0");
  assert.equal(child.CTC_WEBUI_RAW_CMIP6_QUERY_CACHE, "0");
  assert.equal(child.CTC_WEBUI_RAW_CMIP6_MAX_CONCURRENT_WORKERS, "1");
  assert.equal(child.CLIMATE_CMIP6_LOCAL_ZARR_ROOT, undefined);
  assert.equal(child.CLIMATE_CMIP6_EXTRACTION_CACHE_ROOT, undefined);
  assert.equal(child.CLIMATE_TIME_CAPSULE_RAW_ZARR_POINT_CACHE_DIR, undefined);
  assert.equal(child.CLIMATE_TIME_CAPSULE_RAW_ZARR_POINT_CACHE_ROOT, undefined);
  assert.equal(child.CTC_GOOGLE_DRIVE_MOUNT_ROOT, undefined);
  assert.equal(child.CTC_PRODUCTION_ATTESTATION_OUTPUT, undefined);
});

test("raw CMIP6 index는 GCS URI 또는 안전한 상대경로만 허용한다", () => {
  const approvedRoot = "gs://private-bucket/cmip6";
  const valid = {
    entry_count: 2,
    entries: [
      { path: "tasmax/model", path_mode: "relative_to_raw_cmip6_root" },
      { path: "gs://private-bucket/cmip6/tasmin/model", path_mode: "absolute_uri" }
    ]
  };
  assert.equal(validateRawCmip6Index(valid, approvedRoot), valid);
  assert.throws(
    () => validateRawCmip6Index({ entry_count: 1, entries: [{ path: "C:\\private\\raw", path_mode: "absolute_uri" }] }, approvedRoot),
    /로컬 절대경로/u
  );
  assert.throws(
    () => validateRawCmip6Index({ entry_count: 1, entries: [{ path: "../outside", path_mode: "relative_to_raw_cmip6_root" }] }, approvedRoot),
    /상대경로/u
  );
  assert.throws(
    () => validateRawCmip6Index({
      entry_count: 1,
      entries: [{ path: "gs://unapproved-bucket/cmip6/model", path_mode: "absolute_uri" }]
    }, approvedRoot),
    /승인된 GCS 루트/u
  );
  assert.throws(
    () => validateRawCmip6Index({
      entry_count: 1,
      entries: [{ path: "gs://private-bucket/cmip6-other/model", path_mode: "absolute_uri" }]
    }, approvedRoot),
    /승인된 GCS 루트/u
  );
});

test("게이트웨이 파일은 Backend와 Drive 마운트 경계를 벗어나지 않는다", async (context) => {
  const fixture = await createFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const configuration = validateGatewayEnvironment(fixture.env);
  const files = await validateGatewayFiles(configuration);
  assert.equal(files.gatewayScript, path.join(fixture.backendRoot, "scripts", "serve_webui_data_gateway.py"));
  assert.equal(files.manifestPath, path.join(fixture.webDataRoot, "manifest.json"));
});

test("v2 확인서는 자료판 SHA와 UTC 갱신 시각, 두 Git SHA를 모두 고정한다", () => {
  const value = buildProductionAttestation({
    datasetUpdatedAt: backendDatasetTime,
    datasetVersion: "1".repeat(64),
    frontendCommitSha: "a".repeat(40),
    backendCommitSha: "b".repeat(40),
    manifestSha256: "2".repeat(64),
    rawIndexSha256: "3".repeat(64),
    verifiedAtUtc: "2026-07-15T03:04:05.006Z"
  });

  assert.deepEqual(Object.keys(value).sort(), [...PRODUCTION_ATTESTATION_FIELDS]);
  assert.equal(validateProductionAttestation(value), value);
  assert.equal(validateProductionAttestationFreshness(value, {
    nowMs: Date.parse("2026-07-15T03:13:05.006Z")
  }), value);
  assert.equal(value.gateway.seriesVerified, true);
  assert.throws(() => validateProductionAttestation({ ...value, datasetUpdatedAt: "2026-07-15" }), /갱신 시각/u);
  assert.throws(
    () => validateProductionAttestation({ ...value, datasetUpdatedAt: "2026-07-13T16:22:20.121Z" }),
    /갱신 시각/u
  );
  assert.throws(() => validateProductionAttestation({ ...value, extra: true }), /고정 스키마/u);
  assert.equal(hasInternalPathExposure({ value: "C:\\private\\release.ctwebui" }), true);
  assert.equal(hasInternalPathExposure({ value: "깨진 문자 �" }), true);
  assert.throws(
    () => validateProductionAttestationFreshness(value, { nowMs: Date.parse("2026-07-15T03:15:05.007Z") }),
    /최신이 아닙니다/u
  );
  assert.throws(
    () => validateProductionAttestationFreshness(value, { nowMs: Date.parse("2026-07-15T03:02:00.000Z") }),
    /최신이 아닙니다/u
  );
});

test("배포 검증 명령은 저장된 확인서만 읽지 않고 실시간 확인서를 다시 만든다", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["verify:deployment"],
    "pnpm build && node scripts/verify-reproducible-build.mjs && pnpm attest:production && node scripts/verify-production-data-policy.mjs --require-attestation"
  );
});

test("환경 변수로 프로덕션 Git 검증을 비활성화할 수 없다", () => {
  assert.throws(
    () => resolveStrictGitMode({ CTC_PRODUCTION_ATTESTATION_STRICT_GIT: "0" }),
    /비활성화할 수 없습니다/u
  );
});

test("패키지와 공개 인용 메타데이터의 출시 후보 버전은 일치한다", async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const citation = await fs.readFile(path.join(root, "CITATION.cff"), "utf8");
  const citationVersion = packageJson.version.replace(/-rc(\d+)$/u, " RC$1");
  assert.match(citation, new RegExp(`^version: "${citationVersion.replaceAll(".", "\\.")}"$`, "mu"));
  assert.match(citation, /^date-released: "\d{4}-\d{2}-\d{2}"$/mu);
});

test("실제 확인서 생성은 metadata, query, series가 같은 자료판일 때만 성공한다", async (context) => {
  const fixture = await createFixture();
  const outputPath = path.join(root, ".release-evidence", `test-${randomUUID()}.json`);
  context.after(async () => {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    await fs.rm(outputPath, { force: true });
  });

  const calls = [];
  const fetchImplementation = createGatewayFetch(fixture, calls);
  const value = await createProductionDataAttestation({
    env: {
      ...fixture.env,
      CTC_DEPLOYMENT_BASE_URL: "https://climate.example.test",
      CTC_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:8765",
      CTC_GATEWAY_PORT: "8765",
      CTC_PRODUCTION_ATTESTATION_OUTPUT: outputPath
    },
    fetchImplementation,
    strictGit: false,
    now: () => new Date("2026-07-15T03:04:05.006Z"),
    gitRunner: async (repositoryRoot, argumentsList) => {
      if (argumentsList.includes("--show-toplevel")) return repositoryRoot;
      if (argumentsList.includes("HEAD")) return repositoryRoot === fixture.backendRoot ? "b".repeat(40) : "a".repeat(40);
      return "";
    }
  });

  assert.equal(value.datasetVersion, fixture.datasetVersion);
  assert.equal(value.datasetUpdatedAt, backendDatasetTime);
  assert.equal(value.gateway.seriesVerified, true);
  assert.ok(calls.includes("/api/climate/metadata"));
  assert.ok(calls.includes("/api/climate/query"));
  assert.ok(calls.includes("/api/climate/series"));
  assert.equal(calls.filter((pathname) => pathname === "/api/climate/series").length, 4);
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, "utf8")), value);
});

test("외부 query 응답이 원래 요청 조건과 다르면 확인서를 만들지 않는다", async (context) => {
  const fixture = await createFixture();
  const outputPath = path.join(root, ".release-evidence", `test-request-mismatch-${randomUUID()}.json`);
  context.after(async () => {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    await fs.rm(outputPath, { force: true });
  });

  const baseFetch = createGatewayFetch(fixture, []);
  const fetchImplementation = async (url, options) => {
    const response = await baseFetch(url, options);
    if (new URL(url).pathname !== "/api/climate/query") return response;
    const payload = await response.json();
    payload.date = "2099-12-31";
    return jsonResponse(payload, 200);
  };

  await assert.rejects(
    () => createProductionDataAttestation(createAttestationOptions(fixture, outputPath, fetchImplementation)),
    /원래 요청 조건/u
  );
  await assert.rejects(() => fs.access(outputPath));
});

test("전 세계 원자료 series가 query의 자료 방식과 다르면 확인서를 만들지 않는다", async (context) => {
  const fixture = await createFixture();
  const outputPath = path.join(root, ".release-evidence", `test-raw-series-${randomUUID()}.json`);
  context.after(async () => {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    await fs.rm(outputPath, { force: true });
  });

  const baseFetch = createGatewayFetch(fixture, []);
  const fetchImplementation = async (url, options) => {
    const response = await baseFetch(url, options);
    if (new URL(url).pathname !== "/api/climate/series") return response;
    const request = JSON.parse(options.body);
    if (request.latitude === 36.35 && request.longitude === 127.38) return response;
    const payload = await response.json();
    payload.dataMode = "bias-corrected";
    return jsonResponse(payload, 200);
  };

  await assert.rejects(
    () => createProductionDataAttestation(createAttestationOptions(fixture, outputPath, fetchImplementation)),
    /원래 요청 조건/u
  );
  await assert.rejects(() => fs.access(outputPath));
});

test("외부 문서 루트가 저장소 내부 파일을 노출하면 확인서를 만들지 않는다", async (context) => {
  const fixture = await createFixture();
  const outputPath = path.join(root, ".release-evidence", `test-private-path-${randomUUID()}.json`);
  context.after(async () => {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    await fs.rm(outputPath, { force: true });
  });

  const baseFetch = createGatewayFetch(fixture, []);
  const fetchImplementation = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.pathname === "/package.json") {
      return new Response("{}", { status: 200 });
    }
    return baseFetch(url, options);
  };

  await assert.rejects(
    () => createProductionDataAttestation(createAttestationOptions(fixture, outputPath, fetchImplementation)),
    /저장소 내부 파일/u
  );
  await assert.rejects(() => fs.access(outputPath));
});

test("엄격한 확인서는 프런트엔드와 백엔드가 정확한 origin main일 때만 진행한다", async (context) => {
  const fixture = await createFixture();
  const outputPath = path.join(root, ".release-evidence", `test-main-mismatch-${randomUUID()}.json`);
  context.after(async () => {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    await fs.rm(outputPath, { force: true });
  });

  await assert.rejects(
    () => createProductionDataAttestation({
      ...createAttestationOptions(fixture, outputPath, createGatewayFetch(fixture, [])),
      strictGit: true,
      gitRunner: async (repositoryRoot, argumentsList) => {
        if (argumentsList.includes("--show-toplevel")) return repositoryRoot;
        if (argumentsList.includes("HEAD")) return "a".repeat(40);
        if (argumentsList.includes("refs/remotes/origin/main")) return "b".repeat(40);
        return "";
      }
    }),
    /origin\/main/u
  );
  await assert.rejects(() => fs.access(outputPath));
});

test("자료 버전은 파일명 정렬 canonical JSON map의 SHA256으로 계산한다", () => {
  const reverseOrderedDigests = {
    "meta/raw_cmip6_index.json": "3".repeat(64),
    "meta/array_index.json": "2".repeat(64),
    "manifest.json": "1".repeat(64)
  };
  const canonicalJson = JSON.stringify({
    "manifest.json": "1".repeat(64),
    "meta/array_index.json": "2".repeat(64),
    "meta/raw_cmip6_index.json": "3".repeat(64)
  });
  assert.equal(computeDatasetVersion(reverseOrderedDigests), sha256(Buffer.from(canonicalJson, "utf8")));
  assert.throws(
    () => computeDatasetVersion({ ...reverseOrderedDigests, "meta/extra.json": "4".repeat(64) }),
    /구성 SHA256/u
  );
});

test("외부와 로컬 게이트웨이의 실제 조회값이 다르면 확인서를 만들지 않는다", async (context) => {
  const fixture = await createFixture();
  const outputPath = path.join(root, ".release-evidence", `test-mismatch-${randomUUID()}.json`);
  context.after(async () => {
    await fs.rm(fixture.tempRoot, { recursive: true, force: true });
    await fs.rm(outputPath, { force: true });
  });

  const baseFetch = createGatewayFetch(fixture, []);
  const fetchImplementation = async (url, options) => {
    const response = await baseFetch(url, options);
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/api/climate/query") return response;
    const payload = await response.json();
    payload.values[0].numericValue += 0.5;
    return jsonResponse(payload, 200);
  };

  await assert.rejects(
    () => createProductionDataAttestation({
      env: {
        ...fixture.env,
        CTC_DEPLOYMENT_BASE_URL: "https://climate.example.test",
        CTC_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:8765",
        CTC_GATEWAY_PORT: "8765",
        CTC_PRODUCTION_ATTESTATION_OUTPUT: outputPath
      },
      fetchImplementation,
      strictGit: false,
      now: () => new Date("2026-07-15T03:04:05.006Z"),
      gitRunner: async (repositoryRoot, argumentsList) => {
        if (argumentsList.includes("--show-toplevel")) return repositoryRoot;
        if (argumentsList.includes("HEAD")) return repositoryRoot === fixture.backendRoot ? "b".repeat(40) : "a".repeat(40);
        return "";
      }
    }),
    /로컬 운영 게이트웨이와 다릅니다/u
  );
  await assert.rejects(() => fs.access(outputPath));
});

async function createFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctc-webui-production-"));
  const backendRoot = path.join(tempRoot, "backend");
  const driveRoot = path.join(tempRoot, "drive");
  const webDataRoot = path.join(driveRoot, "release.ctwebui");
  await fs.mkdir(path.join(backendRoot, "scripts"), { recursive: true });
  await fs.mkdir(path.join(webDataRoot, "meta"), { recursive: true });
  await fs.writeFile(path.join(backendRoot, "scripts", "serve_webui_data_gateway.py"), "print('gateway')\n", "utf8");

  const rawIndex = {
    entry_count: 1,
    entries: [{
      variable: "tasmax",
      model: "MIROC6",
      scenario: "ssp585",
      path: "tasmax/MIROC6/ssp585",
      path_mode: "relative_to_raw_cmip6_root",
      time_start: "2035-01-01",
      time_end: "2099-12-31"
    }]
  };
  const arrayIndex = {
    locations: [{ lat: 36.35, lon: 127.38 }],
    dates: ["2050-08-01"],
    scenarios: ["ssp585"],
    models: ["MIROC6"]
  };
  const rawIndexBuffer = Buffer.from(JSON.stringify(rawIndex), "utf8");
  const rawIndexSha256 = sha256(rawIndexBuffer);
  const manifest = {
    format: "Climate Time Capsule WebUI Hybrid Export",
    artifacts: [{
      path: "meta/raw_cmip6_index.json",
      sha256: rawIndexSha256,
      size_bytes: rawIndexBuffer.length,
      file_count: 1
    }]
  };
  const manifestBuffer = Buffer.from(JSON.stringify(manifest), "utf8");
  const arrayIndexBuffer = Buffer.from(JSON.stringify(arrayIndex), "utf8");
  const files = [
    [path.join(webDataRoot, "manifest.json"), manifestBuffer],
    [path.join(webDataRoot, "meta", "array_index.json"), arrayIndexBuffer],
    [path.join(webDataRoot, "meta", "raw_cmip6_index.json"), rawIndexBuffer]
  ];
  for (const [filePath, content] of files) {
    await fs.writeFile(filePath, content);
    await fs.utimes(filePath, fixedDatasetTime, fixedDatasetTime);
  }

  const componentDigests = {
    "manifest.json": sha256(manifestBuffer),
    "meta/array_index.json": sha256(arrayIndexBuffer),
    "meta/raw_cmip6_index.json": rawIndexSha256
  };
  return {
    tempRoot,
    backendRoot,
    driveRoot,
    webDataRoot,
    datasetVersion: computeDatasetVersion(componentDigests),
    env: {
      CTC_BACKEND_ROOT: backendRoot,
      CTC_GOOGLE_DRIVE_MOUNT_ROOT: driveRoot,
      CTC_WEB_DATA_ROOT: webDataRoot,
      CTC_WEBUI_CMIP6_ZARR_ROOT: "gs://private-bucket/cmip6",
      CTC_PYTHON_EXECUTABLE: "python"
    }
  };
}

function createAttestationOptions(fixture, outputPath, fetchImplementation) {
  return {
    env: {
      ...fixture.env,
      CTC_DEPLOYMENT_BASE_URL: "https://climate.example.test",
      CTC_GATEWAY_LOCAL_BASE_URL: "http://127.0.0.1:8765",
      CTC_GATEWAY_PORT: "8765",
      CTC_PRODUCTION_ATTESTATION_OUTPUT: outputPath
    },
    fetchImplementation,
    strictGit: false,
    now: () => new Date("2026-07-15T03:04:05.006Z"),
    gitRunner: async (repositoryRoot, argumentsList) => {
      if (argumentsList.includes("--show-toplevel")) return repositoryRoot;
      if (argumentsList.includes("HEAD")) return repositoryRoot === fixture.backendRoot ? "b".repeat(40) : "a".repeat(40);
      return "";
    }
  };
}

function createGatewayFetch(fixture, calls) {
  return async (url, options) => {
    const parsed = new URL(url);
    calls.push(parsed.pathname);
    let payload;
    if (parsed.pathname === "/api/climate/health") {
      payload = { ok: true, publicSafe: true };
    } else if (parsed.pathname === "/api/climate/metadata") {
      payload = {
        publicSafe: true,
        ready: true,
        datasetVersion: fixture.datasetVersion,
        datasetUpdatedAt: backendDatasetTime,
        dateStart: "2035-01-01",
        dateEnd: "2099-12-31",
        models: ["MIROC6"],
        scenarios: ["ssp585"]
      };
    } else if (parsed.pathname === "/api/climate/query") {
      const request = JSON.parse(options.body);
      const prepared = request.latitude === 36.35 && request.longitude === 127.38;
      payload = {
        latitude: request.latitude,
        longitude: request.longitude,
        date: request.date,
        scenario: request.scenario,
        model: request.model,
        coverage: "available",
        dataMode: prepared ? "bias-corrected" : "raw-model-grid",
        values: [{ key: "tasmax", available: true, numericValue: prepared ? 31.2 : 29.4 }],
        attributionReady: true,
        publicSafe: true,
        datasetVersion: fixture.datasetVersion,
        datasetUpdatedAt: backendDatasetTime
      };
    } else if (parsed.pathname === "/api/climate/series") {
      const request = JSON.parse(options.body);
      const prepared = request.latitude === 36.35 && request.longitude === 127.38;
      payload = {
        latitude: request.latitude,
        longitude: request.longitude,
        dateStart: request.startDate,
        dateEnd: request.endDate,
        dates: [request.startDate],
        scenario: request.scenario,
        model: request.model,
        coverage: "available",
        dataMode: prepared ? "bias-corrected" : "raw-model-grid",
        metrics: [{ key: "tasmax", availableCount: 1 }],
        includeRaw: false,
        attributionReady: true,
        attributionLabels: ["국제기후모델 시나리오 자료"],
        publicSafe: true,
        datasetVersion: fixture.datasetVersion,
        datasetUpdatedAt: backendDatasetTime
      };
    } else {
      const relativePath = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
      const filePath = path.join(root, "dist", ...relativePath.split("/"));
      try {
        return new Response(await fs.readFile(filePath), { status: 200 });
      } catch {
        return jsonResponse({ error: "not found" }, 404);
      }
    }
    return jsonResponse(payload, 200);
  };
}

function jsonResponse(value, status) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
