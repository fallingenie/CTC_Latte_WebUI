import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTESTATION_VERSION,
  PRODUCTION_ATTESTATION_FIELDS,
  validateProductionAttestationFreshness
} from "./create-production-data-attestation.mjs";

const EXPECTED_ALLOWED_PROVIDERS = Object.freeze(["google-drive", "gcs"]);
const EXPECTED_QUERY_ORDER = Object.freeze(["prepared-web-data", "raw-cmip6"]);
const EXPECTED_ATTESTATION_FIELDS = PRODUCTION_ATTESTATION_FIELDS;
const EXPECTED_ATTESTATION_CONTRACT_FIELDS = Object.freeze([
  "attestationVersion",
  "requiredFields",
  "internalPathExposureAllowed"
]);

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];
const requireAttestation = process.argv.includes("--require-attestation");

const policy = readJson(path.join(root, "config", "production-data-policy.json"), "프로덕션 자료 정책");
const runtimeConfig = readJson(path.join(root, "dist", "runtime-config.json"), "배포 연결 설정");

verifyPolicy(policy, "프로덕션 자료 정책");
verifyRuntimeConfig(runtimeConfig);
scanPublicArtifacts(path.join(root, "dist"));

let deploymentAttestation = null;
if (requireAttestation) {
  const attestationPath = process.env.CTC_PRODUCTION_DATA_ATTESTATION?.trim()
    || path.join(root, ".release-evidence", "production-data-attestation.json");
  const attestation = readJson(path.resolve(attestationPath), "서버 자료 원본 확인서");
  deploymentAttestation = verifyDeploymentAttestation(attestation, policy, "서버 자료 원본 확인서");
}

const result = {
  ok: failures.length === 0,
  checkedAt: new Date().toISOString(),
  sourcePolicy: policy?.sourcePolicy ?? null,
  allowedProviders: policy?.allowedProviders ?? null,
  queryOrder: policy?.queryOrder ?? null,
  localFilesystemSourceAllowed: policy?.localFilesystemSourceAllowed ?? null,
  attestationRequired: requireAttestation,
  attestationVerified: deploymentAttestation !== null,
  datasetUpdatedAt: deploymentAttestation?.datasetUpdatedAt ?? null,
  datasetVersion: deploymentAttestation?.datasetVersion ?? null,
  frontendCommitSha: deploymentAttestation?.frontendCommitSha ?? null,
  backendCommitSha: deploymentAttestation?.backendCommitSha ?? null,
  publicSafe: deploymentAttestation?.publicSafe ?? null,
  attributionReady: deploymentAttestation?.attributionReady ?? null,
  internalPathExposure: deploymentAttestation?.internalPathExposure ?? null,
  failures
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    failures.push(`${label}을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function verifyPolicy(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label}의 형식이 올바르지 않습니다.`);
    return;
  }
  if (value.schemaVersion !== 2) failures.push(`${label}의 schemaVersion은 2여야 합니다.`);
  if (value.sourcePolicy !== "cloud-only") failures.push(`${label}은 cloud-only여야 합니다.`);
  if (!isSameArray(value.allowedProviders, EXPECTED_ALLOWED_PROVIDERS)) {
    failures.push(`${label}은 Google Drive와 GCS만 허용해야 합니다.`);
  }
  if (!isSameArray(value.queryOrder, EXPECTED_QUERY_ORDER)) {
    failures.push(`${label}은 준비된 Web 자료를 먼저 읽고 CMIP6 원자료로 범위를 보완해야 합니다.`);
  }
  if (value.routes?.["prepared-web-data"]?.provider !== "google-drive"
    || value.routes?.["prepared-web-data"]?.role !== "primary") {
    failures.push(`${label}은 Google Drive의 준비된 Web 자료를 기본 조회 경로로 사용해야 합니다.`);
  }
  if (value.routes?.["raw-cmip6"]?.provider !== "gcs"
    || value.routes?.["raw-cmip6"]?.role !== "coverage-fallback") {
    failures.push(`${label}은 GCS의 CMIP6 원자료를 범위 보완 경로로 사용해야 합니다.`);
  }
  if (value.localFilesystemSourceAllowed !== false) {
    failures.push(`${label}은 로컬 파일시스템을 원본으로 사용하는 경로를 금지해야 합니다.`);
  }
  if (value.browserStorageLocatorExposure !== false) {
    failures.push(`${label}은 브라우저 저장소 위치 노출을 금지해야 합니다.`);
  }
  const attestationContract = value.deploymentAttestation;
  if (!attestationContract || typeof attestationContract !== "object" || Array.isArray(attestationContract)
    || !isSameArray(Object.keys(attestationContract).sort(), [...EXPECTED_ATTESTATION_CONTRACT_FIELDS].sort())
    || attestationContract.attestationVersion !== ATTESTATION_VERSION
    || !isSameArray(attestationContract.requiredFields, EXPECTED_ATTESTATION_FIELDS)
    || attestationContract.internalPathExposureAllowed !== false) {
    failures.push(`${label}의 실제 배포 확인서 계약이 고정된 공개 검증 항목과 맞지 않습니다.`);
  }
}

function verifyDeploymentAttestation(value, policyValue, label) {
  const failureCount = failures.length;
  try {
    validateProductionAttestationFreshness(value);
  } catch (error) {
    failures.push(`${label}가 고정된 v2 운영 계약을 충족하지 않습니다: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  if (value.attestationVersion !== policyValue?.deploymentAttestation?.attestationVersion
    || value.attestationVersion !== ATTESTATION_VERSION) {
    failures.push(`${label}의 attestationVersion은 ${ATTESTATION_VERSION}여야 합니다.`);
  }
  if (!isSameArray(value.allowedProviders, EXPECTED_ALLOWED_PROVIDERS)
    || !isSameArray(value.allowedProviders, policyValue?.allowedProviders)) {
    failures.push(`${label}는 실제 배포에서 Google Drive와 GCS만 사용했음을 증명해야 합니다.`);
  }
  if (!isSameArray(value.queryOrder, EXPECTED_QUERY_ORDER)
    || !isSameArray(value.queryOrder, policyValue?.queryOrder)) {
    failures.push(`${label}는 준비된 Web 자료와 CMIP6 원자료 순서로 조회했음을 증명해야 합니다.`);
  }
  if (value.publicSafe !== true) failures.push(`${label}는 publicSafe를 증명해야 합니다.`);
  if (value.attributionReady !== true) failures.push(`${label}는 attributionReady를 증명해야 합니다.`);
  if (value.internalPathExposure !== false) failures.push(`${label}는 내부 경로가 노출되지 않았음을 증명해야 합니다.`);

  if (failures.length !== failureCount) return null;
  return {
    datasetUpdatedAt: value.datasetUpdatedAt,
    datasetVersion: value.datasetVersion,
    frontendCommitSha: value.frontendCommitSha,
    backendCommitSha: value.backendCommitSha,
    publicSafe: true,
    attributionReady: true,
    internalPathExposure: false
  };
}

function verifyRuntimeConfig(value) {
  const expectedKeys = ["publicSafe", "readPath", "sourcePolicy", "timeoutMs"];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push("배포 연결 설정의 형식이 올바르지 않습니다.");
    return;
  }
  const actualKeys = Object.keys(value).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    failures.push(`배포 연결 설정의 허용되지 않은 항목을 확인했습니다: ${actualKeys.join(", ")}`);
  }
  if (value.readPath !== "/api/climate/query") failures.push("브라우저 API 경로는 동일 출처 상대 경로여야 합니다.");
  if (value.publicSafe !== true) failures.push("배포 연결 설정은 publicSafe여야 합니다.");
  if (value.sourcePolicy !== "cloud-only") failures.push("배포 연결 설정은 cloud-only여야 합니다.");
}

function scanPublicArtifacts(directory) {
  if (!fs.existsSync(directory)) {
    failures.push("배포 산출물 디렉터리가 없습니다. 먼저 빌드해야 합니다.");
    return;
  }

  const forbiddenPatterns = [
    { label: "로컬 호스트 주소", pattern: /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/iu },
    { label: "로컬 파일 주소", pattern: /file:\/{2,}/iu },
    { label: "윈도우 절대 경로", pattern: /["'][A-Za-z]:[\\/](?![\\/])/u },
    { label: "네트워크 공유 경로", pattern: /["']\\\\(?!u[0-9a-f]{4}\b)[A-Za-z0-9._-]+\\[A-Za-z0-9$._-]+/iu },
    { label: "POSIX 내부 경로", pattern: /\/(?:home|users|mnt|tmp|var|srv|opt|data)(?:\/|$)/iu },
    { label: "Google Drive 주소", pattern: /(?:drive\.google\.com|googleapis\.com\/drive)/iu },
    { label: "GCS 주소", pattern: /(?:storage\.googleapis\.com|gs:\/\/)/iu },
    { label: "공개 저장소 주소", pattern: /(?:github\.com|gitlab\.com|bitbucket\.org)[/:]/iu },
    { label: "내부 자료 확장자", pattern: /\.(?:ctwebui|ctcapsule|zarr|parquet|nc4?)\b/iu }
  ];

  for (const filePath of listFiles(directory)) {
    if (!/\.(?:css|html|js|json|svg|webmanifest)$/iu.test(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const { label, pattern } of forbiddenPatterns) {
      if (pattern.test(content)) failures.push(`${path.relative(root, filePath)}에 ${label}가 포함되어 있습니다.`);
    }
  }
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(filePath) : [filePath];
  });
}

function isSameArray(actual, expected) {
  return Array.isArray(actual)
    && Array.isArray(expected)
    && actual.length === expected.length
    && actual.every((item, index) => item === expected[index]);
}
