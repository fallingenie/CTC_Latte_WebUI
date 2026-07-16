import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  validatePublicClimateQueryResponse,
  validatePublicClimateSeriesResponse,
  validatePublicDatasetMetadata
} from "../source/runtime-policy.js";
import {
  DEFAULT_GATEWAY_PORT,
  ProductionDeploymentError,
  isLocalAbsolutePath,
  validateCloudOnlyDeploymentEnvironment,
  validateGatewayFiles,
  validateRawCmip6Index
} from "./start-production-gateway.mjs";

export const ATTESTATION_VERSION = 2;
export const ALLOWED_PROVIDERS = Object.freeze(["google-drive", "gcs"]);
export const QUERY_ORDER = Object.freeze(["prepared-web-data", "raw-cmip6"]);
export const PRODUCTION_ATTESTATION_MAX_AGE_MS = 10 * 60 * 1000;

const FRONTEND_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_FRONTEND_FILE_BYTES = 16 * 1024 * 1024;
const MAX_FRONTEND_TOTAL_BYTES = 64 * 1024 * 1024;
const PRIVATE_DEPLOYMENT_PROBE_PATHS = Object.freeze([
  "/package.json",
  "/source/access-gate.js",
  "/source/access-policy.js",
  "/source/public-app.js",
  "/config/production-data-policy.json",
  "/scripts/create-production-data-attestation.mjs",
  "/.git/HEAD",
  "/.release-evidence/production-data-attestation.json"
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DATASET_UPDATED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/u;
const DATASET_VERSION_PATHS = Object.freeze([
  "manifest.json",
  "meta/array_index.json",
  "meta/raw_cmip6_index.json"
]);
export const PRODUCTION_ATTESTATION_FIELDS = Object.freeze([
  "allowedProviders",
  "attestationVersion",
  "attributionReady",
  "backendCommitSha",
  "datasetUpdatedAt",
  "datasetVersion",
  "frontendCommitSha",
  "gateway",
  "internalPathExposure",
  "preparedData",
  "publicSafe",
  "queryOrder",
  "rawData",
  "verifiedAtUtc"
]);
const PREPARED_DATA_FIELDS = Object.freeze([
  "attributionReady",
  "dataMode",
  "manifestSha256",
  "publicSafe",
  "queryVerified"
]);
const RAW_DATA_FIELDS = Object.freeze([
  "attributionReady",
  "dataMode",
  "publicSafe",
  "queryVerified",
  "rawIndexSha256",
  "rawModelGrid"
]);
const GATEWAY_FIELDS = Object.freeze([
  "frontendAssetsVerified",
  "healthVerified",
  "localGatewayVerified",
  "metadataVerified",
  "sameOrigin",
  "seriesVerified"
]);
const HEALTH_FIELDS = new Set(["message", "ok", "publicSafe"]);
const RAW_VARIABLES = new Set(["tasmax", "tasmin", "pr", "precipitation", "sfcwind", "wind_speed"]);
const INTERNAL_TEXT_PATTERNS = Object.freeze([
  /\uFFFD/u,
  /(?:[ÃÂ][\u0080-\u00BF]|â(?:€|€™|€œ|€�)|ï»¿)/u,
  /\b(?:file|gs|gcs|s3|az|ssh):\/\//iu,
  /\bhttps?:\/\//iu,
  /\b(?:drive\.google\.com|storage\.googleapis\.com|googleapis\.com)\b/iu,
  /(?:^|[\s"'(=])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\/])/u,
  /(?:^|[\s"'(=])\/(?:home|users|mnt|tmp|var|srv|opt|data|etc|root)(?:\/|$)/iu,
  /\.(?:ctwebui|ctcapsule|zarr|parquet|nc4?|git)(?:\b|[\\/])/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /\b(?:token|secret|password|credential|authorization|api[_-]?key)\b\s*[:=]/iu
]);

const execFileAsync = promisify(execFile);

export class AttestationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AttestationValidationError";
  }
}

class ProbeHttpError extends AttestationValidationError {
  constructor(status) {
    super("운영 게이트웨이 조회가 성공하지 못했습니다.");
    this.name = "ProbeHttpError";
    this.status = status;
  }
}

export function hasInternalPathExposure(value) {
  return inspectInternalExposure(value, new Set());
}

export function validateProductionAttestation(value) {
  if (!isPlainRecord(value)) {
    throw new AttestationValidationError("프로덕션 데이터 확인서는 JSON 객체여야 합니다.");
  }
  if (hasInternalPathExposure(value)) {
    throw new AttestationValidationError("프로덕션 데이터 확인서에 내부 주소, 경로 또는 인증 정보가 포함되어 있습니다.");
  }
  requireExactFields(value, PRODUCTION_ATTESTATION_FIELDS, "프로덕션 데이터 확인서");
  if (value.attestationVersion !== ATTESTATION_VERSION) {
    throw new AttestationValidationError("프로덕션 데이터 확인서 버전은 2여야 합니다.");
  }
  if (!SHA256_PATTERN.test(value.datasetVersion)) {
    throw new AttestationValidationError("자료 버전 형식이 올바르지 않습니다.");
  }
  if (!isDatasetUpdatedAt(value.datasetUpdatedAt)) {
    throw new AttestationValidationError("자료 갱신 시각 형식이 올바르지 않습니다.");
  }
  if (!GIT_SHA_PATTERN.test(value.frontendCommitSha) || !GIT_SHA_PATTERN.test(value.backendCommitSha)) {
    throw new AttestationValidationError("Git commit SHA 형식이 올바르지 않습니다.");
  }
  if (!sameArray(value.allowedProviders, ALLOWED_PROVIDERS)
    || !sameArray(value.queryOrder, QUERY_ORDER)) {
    throw new AttestationValidationError("자료 제공자 또는 조회 순서가 운영 계약과 다릅니다.");
  }
  if (value.publicSafe !== true || value.attributionReady !== true || value.internalPathExposure !== false) {
    throw new AttestationValidationError("공개 안전성 또는 출처 표시 검증 결과가 올바르지 않습니다.");
  }
  if (!isUtcIsoTimestamp(value.verifiedAtUtc)) {
    throw new AttestationValidationError("확인 시각 형식이 올바르지 않습니다.");
  }

  requireExactFields(value.preparedData, PREPARED_DATA_FIELDS, "준비된 Web 자료 검증");
  if (!SHA256_PATTERN.test(value.preparedData.manifestSha256)
    || value.preparedData.queryVerified !== true
    || value.preparedData.dataMode !== "bias-corrected"
    || value.preparedData.publicSafe !== true
    || value.preparedData.attributionReady !== true) {
    throw new AttestationValidationError("준비된 Web 자료 검증 결과가 올바르지 않습니다.");
  }

  requireExactFields(value.rawData, RAW_DATA_FIELDS, "CMIP6 원자료 검증");
  if (!SHA256_PATTERN.test(value.rawData.rawIndexSha256)
    || value.rawData.queryVerified !== true
    || value.rawData.rawModelGrid !== true
    || value.rawData.dataMode !== "raw-model-grid"
    || value.rawData.publicSafe !== true
    || value.rawData.attributionReady !== true) {
    throw new AttestationValidationError("CMIP6 원자료 검증 결과가 올바르지 않습니다.");
  }

  requireExactFields(value.gateway, GATEWAY_FIELDS, "게이트웨이 검증");
  if (value.gateway.healthVerified !== true
    || value.gateway.frontendAssetsVerified !== true
    || value.gateway.localGatewayVerified !== true
    || value.gateway.metadataVerified !== true
    || value.gateway.sameOrigin !== true
    || value.gateway.seriesVerified !== true) {
    throw new AttestationValidationError("게이트웨이 검증 결과가 올바르지 않습니다.");
  }
  return value;
}

export function validateProductionAttestationFreshness(
  value,
  { nowMs = Date.now(), maximumAgeMs = PRODUCTION_ATTESTATION_MAX_AGE_MS } = {}
) {
  validateProductionAttestation(value);
  const verifiedAtMs = Date.parse(value.verifiedAtUtc);
  if (!Number.isFinite(nowMs)
    || !Number.isFinite(maximumAgeMs)
    || maximumAgeMs <= 0
    || !Number.isFinite(verifiedAtMs)
    || verifiedAtMs > nowMs + 60 * 1000
    || nowMs - verifiedAtMs > maximumAgeMs) {
    throw new AttestationValidationError("프로덕션 데이터 확인서가 현재 배포를 증명할 만큼 최신이 아닙니다.");
  }
  return value;
}

export function buildProductionAttestation({
  datasetUpdatedAt,
  datasetVersion,
  frontendCommitSha,
  backendCommitSha,
  manifestSha256,
  rawIndexSha256,
  verifiedAtUtc = new Date().toISOString()
}) {
  return validateProductionAttestation({
    attestationVersion: ATTESTATION_VERSION,
    datasetUpdatedAt,
    datasetVersion,
    frontendCommitSha,
    backendCommitSha,
    allowedProviders: [...ALLOWED_PROVIDERS],
    queryOrder: [...QUERY_ORDER],
    preparedData: {
      manifestSha256,
      queryVerified: true,
      dataMode: "bias-corrected",
      publicSafe: true,
      attributionReady: true
    },
    rawData: {
      rawIndexSha256,
      queryVerified: true,
      rawModelGrid: true,
      dataMode: "raw-model-grid",
      publicSafe: true,
      attributionReady: true
    },
    gateway: {
      frontendAssetsVerified: true,
      healthVerified: true,
      localGatewayVerified: true,
      metadataVerified: true,
      sameOrigin: true,
      seriesVerified: true
    },
    publicSafe: true,
    attributionReady: true,
    internalPathExposure: false,
    verifiedAtUtc
  });
}

export function validateDeploymentBaseUrl(value) {
  const text = normalizeText(value);
  if (!text) throw new AttestationValidationError("CTC_DEPLOYMENT_BASE_URL이 지정되지 않았습니다.");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new AttestationValidationError("CTC_DEPLOYMENT_BASE_URL 형식이 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:"
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new AttestationValidationError("CTC_DEPLOYMENT_BASE_URL은 인증 정보가 없는 HTTPS 프런트 URL이어야 합니다.");
  }
  return parsed;
}

export function validateLocalGatewayBaseUrl(value, expectedPort = DEFAULT_GATEWAY_PORT) {
  const text = normalizeText(value);
  if (!text) throw new AttestationValidationError("CTC_GATEWAY_LOCAL_BASE_URL이 지정되지 않았습니다.");
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new AttestationValidationError("CTC_GATEWAY_LOCAL_BASE_URL 형식이 올바르지 않습니다.");
  }
  const port = Number(expectedPort);
  if (parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.port !== String(port)
    || parsed.pathname !== "/"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new AttestationValidationError("CTC_GATEWAY_LOCAL_BASE_URL은 지정된 포트의 127.0.0.1 HTTP 주소여야 합니다.");
  }
  return parsed;
}

export function resolveStrictGitMode(env = process.env, explicitValue) {
  if (typeof explicitValue === "boolean") return explicitValue;
  const value = normalizeText(env.CTC_PRODUCTION_ATTESTATION_STRICT_GIT);
  if (!value) return true;
  if (/^(?:1|true|yes|on)$/iu.test(value)) return true;
  throw new AttestationValidationError("프로덕션 확인서의 Git 검증은 비활성화할 수 없습니다.");
}

export async function createProductionDataAttestation({
  env = process.env,
  platform = process.platform,
  fileSystem = fs,
  fetchImplementation = globalThis.fetch,
  frontendRoot = FRONTEND_ROOT,
  gitRunner = runGit,
  strictGit,
  now = () => new Date()
} = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new AttestationValidationError("운영 게이트웨이를 호출할 fetch 구현이 없습니다.");
  }
  const resolvedFrontendRoot = validateFrontendRoot(frontendRoot);
  const deployment = validateCloudOnlyDeploymentEnvironment(env, { platform });
  const outputPath = validateOutputPath(env.CTC_PRODUCTION_ATTESTATION_OUTPUT, platform);
  const baseUrl = validateDeploymentBaseUrl(env.CTC_DEPLOYMENT_BASE_URL);
  const localBaseUrl = validateLocalGatewayBaseUrl(
    env.CTC_GATEWAY_LOCAL_BASE_URL,
    env.CTC_GATEWAY_PORT ?? DEFAULT_GATEWAY_PORT
  );
  const timeoutMs = parseRequestTimeout(env.CTC_PRODUCTION_ATTESTATION_TIMEOUT_MS);
  const requireCleanGit = resolveStrictGitMode(env, strictGit);

  const gatewayFiles = await validateGatewayFiles(deployment, { fileSystem });
  const datasetEvidence = await readDatasetEvidence(gatewayFiles, {
    fileSystem,
    rawCmip6Root: deployment.rawCmip6Root
  });
  const [frontendGit, backendGit] = await Promise.all([
    inspectGitRepository(resolvedFrontendRoot, "프런트엔드", { requireCleanGit, gitRunner }),
    inspectGitRepository(deployment.backendRoot, "백엔드", { requireCleanGit, gitRunner })
  ]);

  const requestContext = {
    baseOrigin: baseUrl.origin,
    fetchImplementation,
    timeoutMs
  };
  const localRequestContext = {
    baseOrigin: localBaseUrl.origin,
    fetchImplementation,
    timeoutMs
  };
  await verifyDeployedFrontend({ requestContext, fileSystem, frontendRoot: resolvedFrontendRoot });
  const health = validateHealthResponse(await fetchJson(
    new URL("/api/climate/health", baseUrl.origin),
    { ...requestContext, label: "health" }
  ));
  const localHealth = validateHealthResponse(await fetchJson(
    new URL("/api/climate/health", localBaseUrl.origin),
    { ...localRequestContext, label: "local health" }
  ));
  requireMatchingDeploymentPayload(health, localHealth, "health");
  const metadata = validateMetadataResponse(await fetchJson(
    new URL("/api/climate/metadata", baseUrl.origin),
    { ...requestContext, label: "metadata" }
  ));
  const localMetadata = validateMetadataResponse(await fetchJson(
    new URL("/api/climate/metadata", localBaseUrl.origin),
    { ...localRequestContext, label: "local metadata" }
  ));
  requireMatchingDeploymentPayload(metadata, localMetadata, "metadata");
  if (metadata.datasetVersion !== datasetEvidence.datasetVersion) {
    throw new AttestationValidationError("배포 게이트웨이와 .ctwebui 자료 버전이 일치하지 않습니다.");
  }
  if (metadata.datasetUpdatedAt !== datasetEvidence.datasetUpdatedAt) {
    throw new AttestationValidationError("배포 게이트웨이와 .ctwebui 자료 갱신 시각이 일치하지 않습니다.");
  }

  const datasetIdentity = {
    datasetVersion: metadata.datasetVersion,
    datasetUpdatedAt: metadata.datasetUpdatedAt
  };

  const preparedProbe = await verifyPreparedQuery({
    arrayIndex: datasetEvidence.arrayIndex,
    datasetIdentity,
    requestContext
  });
  const rawProbe = await verifyRawWorldwideQuery({
    arrayIndex: datasetEvidence.arrayIndex,
    rawIndex: datasetEvidence.rawIndex,
    datasetIdentity,
    requestContext
  });
  const preparedSeriesProbe = await verifySeriesIdentity({ queryProbe: preparedProbe, datasetIdentity, requestContext });
  const rawSeriesProbe = await verifySeriesIdentity({ queryProbe: rawProbe, datasetIdentity, requestContext });
  await verifyMatchingLocalQuery({ probe: preparedProbe, datasetIdentity, requestContext: localRequestContext });
  await verifyMatchingLocalQuery({ probe: rawProbe, datasetIdentity, requestContext: localRequestContext });
  await verifyMatchingLocalSeries({ probe: preparedSeriesProbe, datasetIdentity, requestContext: localRequestContext });
  await verifyMatchingLocalSeries({ probe: rawSeriesProbe, datasetIdentity, requestContext: localRequestContext });
  validateQueryEvidence(preparedProbe.response, "bias-corrected", datasetIdentity);
  validateQueryEvidence(rawProbe.response, "raw-model-grid", datasetIdentity);

  const verifiedAtUtc = now().toISOString();
  const attestation = buildProductionAttestation({
    datasetUpdatedAt: metadata.datasetUpdatedAt,
    datasetVersion: metadata.datasetVersion,
    frontendCommitSha: frontendGit.commitSha,
    backendCommitSha: backendGit.commitSha,
    manifestSha256: datasetEvidence.manifestSha256,
    rawIndexSha256: datasetEvidence.rawIndexSha256,
    verifiedAtUtc
  });
  await writeJsonAtomic(outputPath, attestation, { fileSystem });
  return attestation;
}

export async function writeJsonAtomic(outputPath, value, { fileSystem = fs } = {}) {
  validateProductionAttestation(value);
  const directory = path.dirname(outputPath);
  const temporaryPath = path.join(directory, `.${path.basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    await fileSystem.mkdir(directory, { recursive: true });
    const directoryStat = await fileSystem.lstat(directory);
    if (!directoryStat.isDirectory()) {
      throw new AttestationValidationError("확인서 디렉터리가 일반 디렉터리가 아닙니다.");
    }
    try {
      const existing = await fileSystem.lstat(outputPath);
      if (!existing.isFile()) {
        throw new AttestationValidationError("확인서 출력 대상이 일반 파일이 아닙니다.");
      }
    } catch (error) {
      if (error instanceof AttestationValidationError) throw error;
      if (error?.code !== "ENOENT") throw new AttestationValidationError("확인서 출력 대상을 확인할 수 없습니다.");
    }
    handle = await fileSystem.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporaryPath, outputPath);
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      handle = null;
    }
    try {
      await fileSystem.unlink(temporaryPath);
    } catch {
      return Promise.reject(error instanceof AttestationValidationError
        ? error
        : new AttestationValidationError("프로덕션 데이터 확인서를 원자 저장하지 못했습니다."));
    }
    throw error instanceof AttestationValidationError
      ? error
      : new AttestationValidationError("프로덕션 데이터 확인서를 원자 저장하지 못했습니다.");
  }
}

export function isMainEntry(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  if (!argvEntry) return false;
  try {
    return pathToFileURL(path.resolve(argvEntry)).href === metaUrl;
  } catch {
    return false;
  }
}

export async function main() {
  try {
    await createProductionDataAttestation();
    process.stdout.write("프로덕션 데이터 확인서를 생성했습니다.\n");
    return 0;
  } catch (error) {
    const message = error instanceof AttestationValidationError || error instanceof ProductionDeploymentError
      ? error.message
      : "프로덕션 데이터 확인서를 생성하지 못했습니다.";
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

async function readDatasetEvidence(files, { fileSystem, rawCmip6Root }) {
  let manifestBuffer;
  let arrayIndexBuffer;
  let rawIndexBuffer;
  let metadataStats;
  try {
    [manifestBuffer, arrayIndexBuffer, rawIndexBuffer, ...metadataStats] = await Promise.all([
      fileSystem.readFile(files.manifestPath),
      fileSystem.readFile(files.arrayIndexPath),
      fileSystem.readFile(files.rawIndexPath),
      fileSystem.stat(files.manifestPath, { bigint: true }),
      fileSystem.stat(files.arrayIndexPath, { bigint: true }),
      fileSystem.stat(files.rawIndexPath, { bigint: true })
    ]);
  } catch {
    throw new AttestationValidationError(".ctwebui 메타데이터를 읽을 수 없습니다.");
  }

  const manifest = parseJsonBuffer(manifestBuffer, ".ctwebui manifest");
  const arrayIndex = parseJsonBuffer(arrayIndexBuffer, ".ctwebui array index");
  const rawIndex = validateRawCmip6Index(
    parseJsonBuffer(rawIndexBuffer, ".ctwebui raw CMIP6 index"),
    rawCmip6Root
  );
  if (!isPlainRecord(manifest)
    || manifest.format !== "Climate Time Capsule WebUI Hybrid Export"
    || !Array.isArray(manifest.artifacts)) {
    throw new AttestationValidationError(".ctwebui manifest 형식이 올바르지 않습니다.");
  }
  if (!isPlainRecord(arrayIndex)
    || !Array.isArray(arrayIndex.locations)
    || !Array.isArray(arrayIndex.dates)
    || !Array.isArray(arrayIndex.scenarios)
    || !Array.isArray(arrayIndex.models)) {
    throw new AttestationValidationError(".ctwebui array index 형식이 올바르지 않습니다.");
  }

  const manifestSha256 = sha256(manifestBuffer);
  const arrayIndexSha256 = sha256(arrayIndexBuffer);
  const rawIndexSha256 = sha256(rawIndexBuffer);
  const rawDescriptor = manifest.artifacts.find((item) => item?.path === "meta/raw_cmip6_index.json");
  if (!isPlainRecord(rawDescriptor)
    || normalizeText(rawDescriptor.sha256).toLowerCase() !== rawIndexSha256
    || rawDescriptor.size_bytes !== rawIndexBuffer.length
    || rawDescriptor.file_count !== 1) {
    throw new AttestationValidationError("manifest의 raw CMIP6 index SHA256이 실제 파일과 일치하지 않습니다.");
  }

  const componentDigests = {
    [DATASET_VERSION_PATHS[0]]: manifestSha256,
    [DATASET_VERSION_PATHS[1]]: arrayIndexSha256,
    [DATASET_VERSION_PATHS[2]]: rawIndexSha256
  };
  const datasetVersion = computeDatasetVersion(componentDigests);
  const modificationTimes = metadataStats.map((item) => item?.mtimeNs);
  if (modificationTimes.some((value) => typeof value !== "bigint" || value < 0n)) {
    throw new AttestationValidationError(".ctwebui 자료 갱신 시각을 확인할 수 없습니다.");
  }
  const latestModifiedTimeNs = modificationTimes.reduce((latest, value) => value > latest ? value : latest, 0n);
  const datasetUpdatedAt = formatDatasetUpdatedAt(latestModifiedTimeNs);
  return {
    manifest,
    arrayIndex,
    rawIndex,
    manifestSha256,
    rawIndexSha256,
    datasetVersion,
    datasetUpdatedAt
  };
}

export function computeDatasetVersion(componentDigests) {
  if (!isPlainRecord(componentDigests)
    || !sameArray(Object.keys(componentDigests).sort(), [...DATASET_VERSION_PATHS].sort())
    || Object.values(componentDigests).some((value) => !SHA256_PATTERN.test(value))) {
    throw new AttestationValidationError("자료 버전 구성 SHA256 형식이 올바르지 않습니다.");
  }
  const canonicalMap = Object.fromEntries(
    Object.entries(componentDigests).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  );
  return sha256(Buffer.from(JSON.stringify(canonicalMap), "utf8"));
}

function formatDatasetUpdatedAt(mtimeNs) {
  const roundedMicroseconds = (mtimeNs + 500n) / 1000n;
  const milliseconds = roundedMicroseconds / 1000n;
  const microsecondRemainder = roundedMicroseconds % 1000n;
  const isoMilliseconds = new Date(Number(milliseconds)).toISOString();
  return `${isoMilliseconds.slice(0, -1)}${String(microsecondRemainder).padStart(3, "0")}+00:00`;
}

async function inspectGitRepository(repositoryRoot, label, { requireCleanGit, gitRunner }) {
  let topLevel;
  let commitSha;
  let status;
  let mainSha;
  try {
    [topLevel, commitSha, status, mainSha] = await Promise.all([
      gitRunner(repositoryRoot, ["rev-parse", "--show-toplevel"]),
      gitRunner(repositoryRoot, ["rev-parse", "--verify", "HEAD"]),
      gitRunner(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"]),
      requireCleanGit
        ? gitRunner(repositoryRoot, ["rev-parse", "--verify", "refs/remotes/origin/main"])
        : Promise.resolve("")
    ]);
  } catch {
    throw new AttestationValidationError(`${label} Git 상태를 확인할 수 없습니다.`);
  }
  if (comparablePath(topLevel) !== comparablePath(repositoryRoot)) {
    throw new AttestationValidationError(`${label} 루트가 Git 저장소 루트와 일치하지 않습니다.`);
  }
  const normalizedSha = normalizeText(commitSha).toLowerCase();
  if (!GIT_SHA_PATTERN.test(normalizedSha)) {
    throw new AttestationValidationError(`${label} commit SHA 형식이 올바르지 않습니다.`);
  }
  if (requireCleanGit && normalizeText(status)) {
    throw new AttestationValidationError(`${label} Git 저장소에 커밋되지 않은 변경이 있습니다.`);
  }
  if (requireCleanGit && normalizeText(mainSha).toLowerCase() !== normalizedSha) {
    throw new AttestationValidationError(`${label}가 PR로 병합된 origin/main과 일치하지 않습니다.`);
  }
  return { commitSha: normalizedSha };
}

async function runGit(repositoryRoot, argumentsList) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", repositoryRoot, ...argumentsList],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, windowsHide: true }
  );
  return stdout;
}

function validateFrontendRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new AttestationValidationError("프런트엔드 저장소 경로가 올바르지 않습니다.");
  }
  return path.resolve(value);
}

async function verifyDeployedFrontend({ requestContext, fileSystem, frontendRoot }) {
  const distRoot = path.join(frontendRoot, "dist");
  const files = await listRegularDeploymentFiles(distRoot, { fileSystem });
  if (!files.length) {
    throw new AttestationValidationError("배포할 프런트엔드 산출물이 없습니다.");
  }
  let totalBytes = 0;
  for (const filePath of files) {
    const localBuffer = await fileSystem.readFile(filePath);
    totalBytes += localBuffer.length;
    if (localBuffer.length > MAX_FRONTEND_FILE_BYTES || totalBytes > MAX_FRONTEND_TOTAL_BYTES) {
      throw new AttestationValidationError("프런트엔드 배포 산출물 크기가 검증 범위를 벗어났습니다.");
    }
    const relativePath = path.relative(distRoot, filePath);
    const publicPath = relativePath.split(path.sep).map(encodeURIComponent).join("/");
    const remoteBuffer = await fetchBytes(
      new URL(`/${publicPath}`, requestContext.baseOrigin),
      { ...requestContext, label: "frontend asset", maximumBytes: MAX_FRONTEND_FILE_BYTES }
    );
    if (!localBuffer.equals(remoteBuffer)) {
      throw new AttestationValidationError("외부 프런트엔드 산출물이 현재 검증한 Build와 다릅니다.");
    }
  }
  for (const privatePath of PRIVATE_DEPLOYMENT_PROBE_PATHS) {
    await requirePrivateDeploymentPathUnavailable(
      new URL(privatePath, requestContext.baseOrigin),
      requestContext
    );
  }
}

async function listRegularDeploymentFiles(directory, { fileSystem }) {
  let entries;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch {
    throw new AttestationValidationError("프런트엔드 배포 산출물을 읽을 수 없습니다.");
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const files = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new AttestationValidationError("프런트엔드 배포 산출물에 심볼릭 링크를 사용할 수 없습니다.");
    }
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listRegularDeploymentFiles(filePath, { fileSystem }));
    else if (entry.isFile()) files.push(filePath);
    else throw new AttestationValidationError("프런트엔드 배포 산출물에 일반 파일이 아닌 항목이 있습니다.");
  }
  return files;
}

async function fetchBytes(url, { baseOrigin, fetchImplementation, timeoutMs, label, maximumBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: { Accept: "*/*" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    if (response.url && new URL(response.url).origin !== baseOrigin) {
      throw new AttestationValidationError("프런트엔드 배포 응답이 동일 출처를 벗어났습니다.");
    }
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
      throw new AttestationValidationError("프런트엔드 배포 응답 크기가 검증 범위를 벗어났습니다.");
    }
    if (!response.ok) throw new ProbeHttpError(response.status);
    return await readResponseBufferLimited(response, maximumBytes);
  } catch (error) {
    if (error instanceof AttestationValidationError || error instanceof ProbeHttpError) throw error;
    throw new AttestationValidationError(`${label} 운영 조회에 실패했습니다.`);
  } finally {
    clearTimeout(timer);
  }
}

async function requirePrivateDeploymentPathUnavailable(url, { baseOrigin, fetchImplementation, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      headers: { Accept: "*/*" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    if (response.url && new URL(response.url).origin !== baseOrigin) {
      throw new AttestationValidationError("비공개 배포 경로 확인이 동일 출처를 벗어났습니다.");
    }
    if ([401, 403, 404, 410].includes(response.status)) {
      await response.body?.cancel?.();
      return;
    }
    await response.body?.cancel?.();
    throw new AttestationValidationError("외부 문서 루트에 저장소 내부 파일이 노출되어 있습니다.");
  } catch (error) {
    if (error instanceof AttestationValidationError) throw error;
    throw new AttestationValidationError("외부 문서 루트의 비공개 경로 차단 여부를 확인하지 못했습니다.");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, { baseOrigin, fetchImplementation, timeoutMs, label, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await fetchImplementation(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
  } catch {
    clearTimeout(timer);
    throw new AttestationValidationError(`${label} 운영 조회에 실패했습니다.`);
  }
  try {
    if (response.url) {
      try {
        if (new URL(response.url).origin !== baseOrigin) {
          throw new AttestationValidationError("운영 게이트웨이 응답이 동일 출처를 벗어났습니다.");
        }
      } catch (error) {
        if (error instanceof AttestationValidationError) throw error;
        throw new AttestationValidationError("운영 게이트웨이 응답 출처를 확인할 수 없습니다.");
      }
    }
    const contentType = normalizeText(response.headers?.get?.("content-type")).toLowerCase();
    if (!contentType.startsWith("application/json")) {
      throw new AttestationValidationError(`${label} 응답이 JSON이 아닙니다.`);
    }
    const contentLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new AttestationValidationError(`${label} 응답 크기가 허용 범위를 벗어났습니다.`);
    }
    const text = await readResponseTextLimited(response, MAX_RESPONSE_BYTES);
    let payload;
    try {
      payload = JSON.parse(text.replace(/^\uFEFF/u, ""));
    } catch {
      throw new AttestationValidationError(`${label} 응답 JSON 형식이 올바르지 않습니다.`);
    }
    if (hasInternalPathExposure(payload)) {
      throw new AttestationValidationError(`${label} 응답에 내부 주소, 경로 또는 인증 정보가 포함되어 있습니다.`);
    }
    if (!response.ok) throw new ProbeHttpError(response.status);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseTextLimited(response, maximumBytes) {
  const buffer = await readResponseBufferLimited(response, maximumBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new AttestationValidationError("운영 게이트웨이 응답의 UTF-8 형식이 올바르지 않습니다.");
  }
}

async function readResponseBufferLimited(response, maximumBytes) {
  let buffer;
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        totalBytes += chunk.length;
        if (totalBytes > maximumBytes) {
          await reader.cancel();
          throw new AttestationValidationError("운영 게이트웨이 응답 크기가 허용 범위를 벗어났습니다.");
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    buffer = Buffer.concat(chunks, totalBytes);
  } else if (typeof response.arrayBuffer === "function") {
    buffer = Buffer.from(await response.arrayBuffer());
  } else if (typeof response.text === "function") {
    const text = await response.text();
    buffer = Buffer.from(text, "utf8");
  } else {
    throw new AttestationValidationError("운영 게이트웨이 응답 본문을 읽을 수 없습니다.");
  }
  if (buffer.length > maximumBytes) {
    throw new AttestationValidationError("운영 게이트웨이 응답 크기가 허용 범위를 벗어났습니다.");
  }
  return buffer;
}

function validateHealthResponse(value) {
  if (!isPlainRecord(value)
    || Object.keys(value).some((key) => !HEALTH_FIELDS.has(key))
    || value.ok !== true
    || value.publicSafe !== true) {
    throw new AttestationValidationError("health 응답이 공개 운영 계약과 맞지 않습니다.");
  }
  return value;
}

function validateMetadataResponse(value) {
  let metadata;
  try {
    metadata = validatePublicDatasetMetadata(value);
  } catch {
    throw new AttestationValidationError("metadata 응답이 공개 운영 계약과 맞지 않습니다.");
  }
  if (!SHA256_PATTERN.test(metadata.datasetVersion)
    || !Array.isArray(metadata.models)
    || metadata.models.length === 0
    || !Array.isArray(metadata.scenarios)
    || metadata.scenarios.length === 0) {
    throw new AttestationValidationError("metadata 응답의 자료 버전 또는 조회 축이 올바르지 않습니다.");
  }
  return metadata;
}

async function verifyPreparedQuery({ arrayIndex, datasetIdentity, requestContext }) {
  const requests = buildPreparedProbeRequests(arrayIndex);
  for (const candidate of requests) {
    const request = { ...candidate, datasetVersion: datasetIdentity.datasetVersion };
    let response;
    try {
      response = await fetchJson(
        new URL("/api/climate/query", requestContext.baseOrigin),
        { ...requestContext, label: "prepared query", body: request }
      );
    } catch (error) {
      if (error instanceof ProbeHttpError && [400, 422, 503].includes(error.status)) continue;
      throw error;
    }
    validateQueryContract(response, datasetIdentity);
    validateQueryMatchesRequest(response, request);
    if (response.dataMode === "bias-corrected"
      && response.attributionReady === true
      && hasAvailableQueryValue(response)) return { request, response };
  }
  throw new AttestationValidationError("준비된 Web 자료의 실제 조회를 검증하지 못했습니다.");
}

async function verifyRawWorldwideQuery({ arrayIndex, rawIndex, datasetIdentity, requestContext }) {
  const requests = buildRawProbeRequests(arrayIndex, rawIndex);
  for (const candidate of requests) {
    const request = { ...candidate, datasetVersion: datasetIdentity.datasetVersion };
    let response;
    try {
      response = await fetchJson(
        new URL("/api/climate/query", requestContext.baseOrigin),
        { ...requestContext, label: "raw worldwide query", body: request }
      );
    } catch (error) {
      if (error instanceof ProbeHttpError && [400, 422, 503].includes(error.status)) continue;
      throw error;
    }
    validateQueryContract(response, datasetIdentity);
    validateQueryMatchesRequest(response, request);
    if (response.dataMode === "raw-model-grid"
      && response.attributionReady === true
      && hasAvailableQueryValue(response)) return { request, response };
  }
  throw new AttestationValidationError("전 세계 CMIP6 원자료의 실제 조회를 검증하지 못했습니다.");
}

async function verifySeriesIdentity({ queryProbe, datasetIdentity, requestContext }) {
  const queryResponse = queryProbe.response;
  const availableMetricKeys = new Set((queryResponse.values ?? [])
    .filter((item) => item?.available !== false)
    .map((item) => normalizeRawMetricKey(item?.key))
    .filter(Boolean));
  const metric = ["tasmax", "tasmin", "pr", "sfcwind"].find((key) => availableMetricKeys.has(key));
  if (!metric) {
    throw new AttestationValidationError("기간 자료 검증에 사용할 기후 지표를 찾지 못했습니다.");
  }
  const request = {
    latitude: queryProbe.request.latitude,
    longitude: queryProbe.request.longitude,
    startDate: queryProbe.request.date,
    endDate: queryProbe.request.date,
    scenario: queryProbe.request.scenario,
    model: queryProbe.request.model,
    metrics: [metric],
    includeRaw: false,
    datasetVersion: datasetIdentity.datasetVersion
  };
  const response = await fetchJson(
    new URL("/api/climate/series", requestContext.baseOrigin),
    {
      ...requestContext,
      label: "series",
      body: request
    }
  );
  validateSeriesContract(response, datasetIdentity);
  validateSeriesMatchesRequest(response, request, queryResponse.dataMode);
  return { request, response };
}

async function verifyMatchingLocalQuery({ probe, datasetIdentity, requestContext }) {
  const localResponse = await fetchJson(
    new URL("/api/climate/query", requestContext.baseOrigin),
    {
      ...requestContext,
      label: "local query",
      body: probe.request
    }
  );
  validateQueryContract(localResponse, datasetIdentity);
  validateQueryMatchesRequest(localResponse, probe.request);
  requireMatchingDeploymentPayload(probe.response, localResponse, "query");
  return localResponse;
}

async function verifyMatchingLocalSeries({ probe, datasetIdentity, requestContext }) {
  const localResponse = await fetchJson(
    new URL("/api/climate/series", requestContext.baseOrigin),
    {
      ...requestContext,
      label: "local series",
      body: probe.request
    }
  );
  validateSeriesContract(localResponse, datasetIdentity);
  validateSeriesMatchesRequest(localResponse, probe.request, probe.response.dataMode);
  requireMatchingDeploymentPayload(probe.response, localResponse, "series");
  return localResponse;
}

function requireMatchingDeploymentPayload(externalValue, localValue, label) {
  const externalComparable = stableComparableJson(externalValue);
  const localComparable = stableComparableJson(localValue);
  if (externalComparable !== localComparable) {
    throw new AttestationValidationError(`외부 ${label} 응답이 로컬 운영 게이트웨이와 다릅니다.`);
  }
}

function stableComparableJson(value) {
  return JSON.stringify(normalizeComparableValue(value));
}

function normalizeComparableValue(value, key = "") {
  if (key === "requestId" || key === "generatedAt") return undefined;
  if (Array.isArray(value)) return value.map((item) => normalizeComparableValue(item));
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((nestedKey) => {
    const normalized = normalizeComparableValue(value[nestedKey], nestedKey);
    return normalized === undefined ? [] : [[nestedKey, normalized]];
  }));
}

function validateQueryContract(value, datasetIdentity) {
  try {
    validatePublicClimateQueryResponse(value);
  } catch {
    throw new AttestationValidationError("기후자료 query 응답이 공개 운영 계약과 맞지 않습니다.");
  }
  if (value.datasetVersion !== datasetIdentity.datasetVersion
    || value.datasetUpdatedAt !== datasetIdentity.datasetUpdatedAt) {
    throw new AttestationValidationError("기후자료 query 응답의 자료 기준이 metadata와 다릅니다.");
  }
  return value;
}

function validateQueryMatchesRequest(value, request) {
  if (!sameCoordinate(value.latitude, request.latitude)
    || !sameCoordinate(value.longitude, request.longitude)
    || value.date !== request.date
    || value.scenario !== request.scenario
    || value.model !== request.model) {
    throw new AttestationValidationError("기후자료 query 응답이 원래 요청 조건과 다릅니다.");
  }
}

function validateSeriesContract(value, datasetIdentity) {
  try {
    validatePublicClimateSeriesResponse(value);
  } catch {
    throw new AttestationValidationError("기후자료 series 응답이 공개 운영 계약과 맞지 않습니다.");
  }
  if (value.datasetVersion !== datasetIdentity.datasetVersion
    || value.datasetUpdatedAt !== datasetIdentity.datasetUpdatedAt) {
    throw new AttestationValidationError("기후자료 series 응답의 자료 기준이 metadata와 다릅니다.");
  }
  return value;
}

function validateSeriesMatchesRequest(value, request, expectedDataMode) {
  const responseMetricKeys = new Set((value.metrics ?? [])
    .map((metric) => normalizeRawMetricKey(metric?.key))
    .filter(Boolean));
  const requestedMetricKeys = (request.metrics ?? []).map(normalizeRawMetricKey).filter(Boolean);
  if (!sameCoordinate(value.latitude, request.latitude)
    || !sameCoordinate(value.longitude, request.longitude)
    || value.dateStart !== request.startDate
    || value.dateEnd !== request.endDate
    || value.dates?.[0] !== request.startDate
    || value.dates?.at?.(-1) !== request.endDate
    || value.scenario !== request.scenario
    || value.model !== request.model
    || value.dataMode !== expectedDataMode
    || value.includeRaw !== (request.includeRaw === true)
    || requestedMetricKeys.length !== request.metrics.length
    || !requestedMetricKeys.every((metric) => responseMetricKeys.has(metric))) {
    throw new AttestationValidationError("기간 자료 응답이 원래 요청 조건과 다릅니다.");
  }
}

function sameCoordinate(left, right) {
  return Number.isFinite(Number(left))
    && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) <= 1e-7;
}

function validateQueryEvidence(value, expectedMode, datasetIdentity) {
  validateQueryContract(value, datasetIdentity);
  if (value.dataMode !== expectedMode
    || value.publicSafe !== true
    || value.attributionReady !== true
    || !hasAvailableQueryValue(value)) {
    throw new AttestationValidationError("기후자료 실제 조회 증거가 운영 기준을 충족하지 못했습니다.");
  }
}

function buildPreparedProbeRequests(arrayIndex) {
  const locations = arrayIndex.locations
    .filter((item) => isPlainRecord(item) && isLatitude(item.lat) && isLongitude(item.lon))
    .slice(0, 4);
  const dates = sampledValues(arrayIndex.dates.map(dateOnly).filter(Boolean), 3);
  const scenarios = uniqueText(arrayIndex.scenarios).slice(0, 2);
  const models = uniqueText(["ensemble", ...arrayIndex.models]).slice(0, 3);
  if (!locations.length || !dates.length || !scenarios.length || !models.length) {
    throw new AttestationValidationError("준비된 Web 자료 조회 조건을 만들 수 없습니다.");
  }

  const requests = [];
  for (const location of locations) {
    for (const date of dates) {
      for (const scenario of scenarios) {
        for (const model of models) {
          requests.push({
            latitude: Number(location.lat),
            longitude: Number(location.lon),
            date,
            scenario,
            model
          });
          if (requests.length >= 24) return requests;
        }
      }
    }
  }
  return requests;
}

function buildRawProbeRequests(arrayIndex, rawIndex) {
  const coordinate = chooseWorldwideRawCoordinate(arrayIndex);
  const datasetDates = uniqueText(arrayIndex.dates).map(dateOnly).filter(Boolean).sort();
  const datasetStart = datasetDates[0] || "";
  const datasetEnd = datasetDates.at(-1) || "";
  const orderedEntries = [...rawIndex.entries].sort((left, right) => {
    const leftKnown = RAW_VARIABLES.has(normalizeText(left.variable).toLowerCase()) ? 0 : 1;
    const rightKnown = RAW_VARIABLES.has(normalizeText(right.variable).toLowerCase()) ? 0 : 1;
    return leftKnown - rightKnown;
  });
  const requests = [];
  const seen = new Set();
  for (const entry of orderedEntries) {
    const model = normalizeText(entry.model);
    const scenario = normalizeText(entry.scenario);
    const start = dateOnly(entry.time_start) || datasetStart;
    const end = dateOnly(entry.time_end) || datasetEnd || start;
    if (!model || !scenario || !start || !end) continue;
    const overlapStart = datasetStart && datasetStart > start ? datasetStart : start;
    const overlapEnd = datasetEnd && datasetEnd < end ? datasetEnd : end;
    const date = overlapStart <= overlapEnd ? midpointDate(overlapStart, overlapEnd) : midpointDate(start, end);
    if (!date) continue;
    const key = `${model}\u0000${scenario}\u0000${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push({
      latitude: coordinate.latitude,
      longitude: coordinate.longitude,
      date,
      scenario,
      model
    });
    if (requests.length >= 3) break;
  }
  if (!requests.length) {
    throw new AttestationValidationError("CMIP6 원자료 조회 조건을 만들 수 없습니다.");
  }
  return requests;
}

function chooseWorldwideRawCoordinate(arrayIndex) {
  const locations = arrayIndex.locations
    .filter((item) => isPlainRecord(item) && isLatitude(item.lat) && isLongitude(item.lon))
    .map((item) => ({ latitude: Number(item.lat), longitude: Number(item.lon) }));
  if (!locations.length) return { latitude: 0, longitude: 0 };

  let best = null;
  for (let latitude = -75; latitude <= 75; latitude += 15) {
    for (let longitude = -165; longitude <= 180; longitude += 15) {
      const nearestDistanceKm = Math.min(...locations.map((location) => haversineDistanceKm(
        latitude,
        longitude,
        location.latitude,
        location.longitude
      )));
      if (!best || nearestDistanceKm > best.nearestDistanceKm) {
        best = { latitude, longitude, nearestDistanceKm };
      }
    }
  }
  const materializedRadiusKm = Number(arrayIndex.capabilities?.materialized_radius_km ?? 25);
  if (!best || best.nearestDistanceKm <= Math.max(25, materializedRadiusKm)) {
    throw new AttestationValidationError("물질화 범위 밖의 전 세계 원자료 조회 좌표를 만들 수 없습니다.");
  }
  return { latitude: best.latitude, longitude: best.longitude };
}

function hasAvailableQueryValue(value) {
  return Array.isArray(value.values)
    && value.values.some((item) => isPlainRecord(item)
      && item.available === true
      && typeof item.numericValue === "number"
      && Number.isFinite(item.numericValue));
}

function inspectInternalExposure(value, ancestors) {
  if (typeof value === "string") {
    return isLocalAbsolutePath(value) || INTERNAL_TEXT_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return false;
  if (typeof value !== "object" || ancestors.has(value)) return true;
  ancestors.add(value);
  const nestedValues = Array.isArray(value) ? value : Object.values(value);
  const exposed = nestedValues.some((item) => inspectInternalExposure(item, ancestors));
  ancestors.delete(value);
  return exposed;
}

function validateOutputPath(value, platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const evidenceRoot = pathApi.join(FRONTEND_ROOT, ".release-evidence");
  const outputPath = normalizeText(value) || pathApi.join(evidenceRoot, "production-data-attestation.json");
  if (!pathApi.isAbsolute(outputPath)
    || comparablePath(pathApi.dirname(outputPath)) !== comparablePath(evidenceRoot)
    || pathApi.extname(outputPath).toLowerCase() !== ".json") {
    throw new AttestationValidationError("확인서는 저장소의 비공개 release evidence 디렉터리에 JSON으로 저장해야 합니다.");
  }
  return outputPath;
}

function parseRequestTimeout(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_REQUEST_TIMEOUT_MS;
  if (!/^\d+$/u.test(text)) {
    throw new AttestationValidationError("확인서 조회 제한시간 형식이 올바르지 않습니다.");
  }
  const timeoutMs = Number(text);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30_000 || timeoutMs > 30 * 60 * 1000) {
    throw new AttestationValidationError("확인서 조회 제한시간 범위가 올바르지 않습니다.");
  }
  return timeoutMs;
}

function parseJsonBuffer(buffer, label) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return JSON.parse(text.replace(/^\uFEFF/u, ""));
  } catch {
    throw new AttestationValidationError(`${label} JSON 형식이 올바르지 않습니다.`);
  }
}

function requireExactFields(value, expectedFields, label) {
  if (!isPlainRecord(value)) {
    throw new AttestationValidationError(`${label} 형식이 JSON 객체가 아닙니다.`);
  }
  const actualFields = Object.keys(value).sort();
  if (!sameArray(actualFields, expectedFields)) {
    throw new AttestationValidationError(`${label} 필드가 고정 스키마와 다릅니다.`);
  }
}

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && Array.isArray(expected)
    && actual.length === expected.length
    && actual.every((item, index) => item === expected[index]);
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function comparablePath(value) {
  const resolved = path.resolve(normalizeText(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isUtcIsoTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/u.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isDatasetUpdatedAt(value) {
  return DATASET_UPDATED_AT_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function normalizeRawMetricKey(value) {
  const key = normalizeText(value);
  if (key === "precipitation") return "pr";
  if (key === "wind_speed") return "sfcwind";
  return RAW_VARIABLES.has(key) ? key : "";
}

function uniqueText(values) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function sampledValues(values, maximum) {
  const unique = [...new Set(values)];
  if (unique.length <= maximum) return unique;
  const indexes = [Math.floor((unique.length - 1) / 2), 0, unique.length - 1];
  return [...new Set(indexes.map((index) => unique[index]))].slice(0, maximum);
}

function dateOnly(value) {
  const text = normalizeText(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return "";
  const timestamp = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === text ? text : "";
}

function midpointDate(start, end) {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) return "";
  return new Date(startTime + Math.floor((endTime - startTime) / 2)).toISOString().slice(0, 10);
}

function isLatitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLatitude = radians(lat2 - lat1);
  const deltaLongitude = radians(lon2 - lon1);
  const firstLatitude = radians(lat1);
  const secondLatitude = radians(lat2);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

if (isMainEntry()) {
  process.exitCode = await main();
}
