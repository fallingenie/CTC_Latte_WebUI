import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ProductionDeploymentError } from "./start-production-gateway.mjs";

export const RELEASE_POINTER_SCHEMA_VERSION = 1;
export const LEGACY_TEST_DATASET_MODE = "legacy-unsealed";

const DATASET_IDENTITY_PATHS = Object.freeze([
  "manifest.json",
  "meta/array_index.json",
  "meta/raw_cmip6_index.json"
]);
const POINTER_FIELDS = Object.freeze([
  "datasetVersion",
  "relativePath",
  "releaseId",
  "schemaVersion"
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ALLOWED_PYTHON_EXECUTABLES = new Set(["py", "py.exe", "python", "python.exe", "python3", "python3.exe"]);
const PUBLICATION_VALIDATOR_PATH = fileURLToPath(
  new URL("./validate_ctwebui_publication.py", import.meta.url)
);

export async function resolveReleaseDataEnvironment(
  env = process.env,
  { fileSystem = fs, platform = process.platform } = {}
) {
  const requestedTestMode = optionalText(env.CTC_TEST_DATASET_MODE);
  if (requestedTestMode) {
    if (requestedTestMode !== LEGACY_TEST_DATASET_MODE) {
      throw new ProductionDeploymentError("시험 자료판 실행 방식이 올바르지 않습니다.");
    }
    return resolveLegacyTestDataEnvironment(env, { fileSystem, platform });
  }

  const mountRoot = requiredText(env.CTC_PREPARED_DATA_MOUNT_ROOT, "CTC_PREPARED_DATA_MOUNT_ROOT");
  const pointerPath = requiredText(env.CTC_RELEASE_POINTER, "CTC_RELEASE_POINTER");
  if (!isAbsolutePathForPlatform(mountRoot, platform) || !isAbsolutePathForPlatform(pointerPath, platform)) {
    throw new ProductionDeploymentError("GCS 마운트와 자료판 포인터는 절대경로여야 합니다.");
  }
  if (!isPathWithin(mountRoot, pointerPath, platform)) {
    throw new ProductionDeploymentError("자료판 포인터는 지정된 GCS 마운트 안에 있어야 합니다.");
  }
  if (String(env.CTC_WEB_DATA_ROOT || "").trim()) {
    throw new ProductionDeploymentError("자료판 포인터와 CTC_WEB_DATA_ROOT를 동시에 지정할 수 없습니다.");
  }

  const [mountRealPath, pointerRealPath] = await resolveExistingPaths(
    fileSystem,
    mountRoot,
    pointerPath
  );
  if (!isPathWithin(mountRealPath, pointerRealPath, platform)) {
    throw new ProductionDeploymentError("자료판 포인터의 실제 경로가 GCS 마운트를 벗어났습니다.");
  }

  const pointer = parseReleasePointer(await readText(fileSystem, pointerPath));
  const webDataRoot = pathForPlatform(platform).resolve(
    mountRoot,
    ...pointer.relativePath.split("/")
  );
  if (!isPathWithin(mountRoot, webDataRoot, platform)) {
    throw new ProductionDeploymentError("자료판 경로가 GCS 마운트를 벗어났습니다.");
  }

  const webDataRealPath = await resolveExistingPath(
    fileSystem,
    webDataRoot,
    "자료판 실제 경로를 확인할 수 없습니다."
  );
  if (!isPathWithin(mountRealPath, webDataRealPath, platform)) {
    throw new ProductionDeploymentError("자료판 실제 경로가 GCS 마운트를 벗어났습니다.");
  }

  await validateMountedDatasetPublication(webDataRealPath, { mode: "startup" });
  const actualDatasetVersion = await computeMountedDatasetVersion(webDataRealPath, { fileSystem });
  if (actualDatasetVersion !== pointer.datasetVersion) {
    throw new ProductionDeploymentError("자료판 포인터와 실제 .ctwebui SHA-256이 일치하지 않습니다.");
  }

  return Object.freeze({
    env: Object.freeze({ ...env, CTC_WEB_DATA_ROOT: webDataRealPath }),
    pointer,
    pointerPath,
    webDataRoot: webDataRealPath
  });
}

export async function resolveLegacyTestDataEnvironment(
  env = process.env,
  { fileSystem = fs, platform = process.platform } = {}
) {
  if (optionalText(env.CTC_TEST_DATASET_MODE) !== LEGACY_TEST_DATASET_MODE) {
    throw new ProductionDeploymentError("구형 자료판 시험 모드가 명시되지 않았습니다.");
  }
  if (optionalText(env.CTC_RELEASE_POINTER) || optionalText(env.CTC_RELEASE_TOKEN)) {
    throw new ProductionDeploymentError("시험 자료판은 운영 포인터 또는 출시 토큰과 함께 사용할 수 없습니다.");
  }

  const mountRoot = requiredText(env.CTC_PREPARED_DATA_MOUNT_ROOT, "CTC_PREPARED_DATA_MOUNT_ROOT");
  const webDataRoot = requiredText(env.CTC_WEB_DATA_ROOT, "CTC_WEB_DATA_ROOT");
  const expectedDatasetVersion = requiredSha256(
    env.CTC_TEST_EXPECTED_DATASET_VERSION,
    "CTC_TEST_EXPECTED_DATASET_VERSION"
  );
  const expectedGenerationId = requiredSha256(
    env.CTC_TEST_EXPECTED_GENERATION_ID,
    "CTC_TEST_EXPECTED_GENERATION_ID"
  );
  const expectedManifestBinding = requiredSha256(
    env.CTC_TEST_EXPECTED_MANIFEST_BINDING_SHA256,
    "CTC_TEST_EXPECTED_MANIFEST_BINDING_SHA256"
  );
  const acknowledgedIntegrityGapBytes = requiredPositiveInteger(
    env.CTC_TEST_ACKNOWLEDGED_INTEGRITY_GAP_BYTES,
    "CTC_TEST_ACKNOWLEDGED_INTEGRITY_GAP_BYTES"
  );

  if (!isAbsolutePathForPlatform(mountRoot, platform)
    || !isAbsolutePathForPlatform(webDataRoot, platform)) {
    throw new ProductionDeploymentError("시험 GCS 마운트와 자료판 경로는 절대경로여야 합니다.");
  }
  if (!webDataRoot.toLowerCase().endsWith(".ctwebui")) {
    throw new ProductionDeploymentError("시험 자료판 경로는 .ctwebui 디렉터리여야 합니다.");
  }
  if (!isPathWithin(mountRoot, webDataRoot, platform)) {
    throw new ProductionDeploymentError("시험 자료판은 지정된 GCS 마운트 안에 있어야 합니다.");
  }

  const [mountRealPath, webDataRealPath] = await resolveExistingDirectories(
    fileSystem,
    mountRoot,
    webDataRoot
  );
  if (!isPathWithin(mountRealPath, webDataRealPath, platform)) {
    throw new ProductionDeploymentError("시험 자료판의 실제 경로가 GCS 마운트를 벗어났습니다.");
  }

  const [manifest, completion] = await Promise.all([
    readJsonObject(fileSystem, path.join(webDataRealPath, "manifest.json"), "시험 자료판 manifest"),
    readJsonObject(
      fileSystem,
      path.join(webDataRealPath, "meta", "completion.json"),
      "시험 자료판 완료 표식"
    )
  ]);
  validateLegacyTestPublication({
    manifest,
    completion,
    expectedGenerationId,
    expectedManifestBinding
  });

  const actualDatasetVersion = await computeMountedDatasetVersion(webDataRealPath, { fileSystem });
  if (actualDatasetVersion !== expectedDatasetVersion) {
    throw new ProductionDeploymentError("시험 자료판 SHA-256이 승인한 값과 일치하지 않습니다.");
  }

  const relativePath = pathForPlatform(platform)
    .relative(pathForPlatform(platform).resolve(mountRoot), pathForPlatform(platform).resolve(webDataRoot))
    .split(pathForPlatform(platform).sep)
    .join("/");
  return Object.freeze({
    env: Object.freeze({ ...env, CTC_WEB_DATA_ROOT: webDataRealPath }),
    pointer: Object.freeze({
      schemaVersion: RELEASE_POINTER_SCHEMA_VERSION,
      releaseId: `test-${actualDatasetVersion.slice(0, 12)}`,
      relativePath,
      datasetVersion: actualDatasetVersion
    }),
    pointerPath: "",
    webDataRoot: webDataRealPath,
    testOnly: true,
    acknowledgedIntegrityGapBytes
  });
}

export function validateLegacyTestPublication({
  manifest,
  completion,
  expectedGenerationId,
  expectedManifestBinding
}) {
  if (!isPlainRecord(manifest) || !isPlainRecord(completion)) {
    throw new ProductionDeploymentError("시험 자료판 설명 형식이 올바르지 않습니다.");
  }
  if (manifest.format !== "Climate Time Capsule WebUI Hybrid Export"
    || manifest.format_version !== 3
    || manifest.publication_contract !== "atomic-directory-v2"
    || manifest.observation_contract_version !== 1) {
    throw new ProductionDeploymentError("시험 자료판의 WebUI 계약이 올바르지 않습니다.");
  }
  if (manifest.dataset_seal !== undefined || completion.contract_version !== 2) {
    throw new ProductionDeploymentError("봉인된 최신 자료판은 시험 예외가 아닌 정상 배포 절차를 사용해야 합니다.");
  }
  if (completion.status !== "complete"
    || completion.atomic_publish !== true
    || completion.observation_contract_version !== 1
    || !Number.isSafeInteger(completion.artifact_count)
    || completion.artifact_count < 1
    || !Number.isSafeInteger(completion.table_count)
    || completion.table_count < 1) {
    throw new ProductionDeploymentError("시험 자료판 완료 표식이 올바르지 않습니다.");
  }
  if (manifest.generation_id !== expectedGenerationId
    || completion.generation_id !== expectedGenerationId
    || completion.manifest_binding_sha256 !== expectedManifestBinding) {
    throw new ProductionDeploymentError("시험 자료판 세대 또는 manifest 결합값이 승인한 값과 다릅니다.");
  }
  if (!Array.isArray(manifest.artifacts)
    || manifest.artifacts.length !== completion.artifact_count
    || !isPlainRecord(manifest.table_row_counts)
    || Object.keys(manifest.table_row_counts).length !== completion.table_count) {
    throw new ProductionDeploymentError("시험 자료판의 선언된 artifact 또는 표 개수가 맞지 않습니다.");
  }
  if (!isPlainRecord(manifest.completion)) {
    throw new ProductionDeploymentError("시험 자료판 manifest에 완료 계약이 없습니다.");
  }
  for (const key of [
    "artifact_count",
    "atomic_publish",
    "completed_at_unix_ns",
    "contract_version",
    "generation_id",
    "manifest_binding_sha256",
    "observation_contract_version",
    "status",
    "table_count"
  ]) {
    if (manifest.completion[key] !== completion[key]) {
      throw new ProductionDeploymentError("시험 자료판 manifest와 완료 표식이 일치하지 않습니다.");
    }
  }
  return Object.freeze({
    generationId: expectedGenerationId,
    manifestBindingSha256: expectedManifestBinding
  });
}

export function parseReleasePointer(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value.replace(/^\uFEFF/u, ""));
    } catch {
      throw new ProductionDeploymentError("자료판 포인터 JSON 형식이 올바르지 않습니다.");
    }
  }
  if (!isPlainRecord(parsed)) {
    throw new ProductionDeploymentError("자료판 포인터는 JSON 객체여야 합니다.");
  }
  if (!sameArray(Object.keys(parsed).sort(), POINTER_FIELDS)) {
    throw new ProductionDeploymentError("자료판 포인터에 허용되지 않은 필드가 있습니다.");
  }
  if (parsed.schemaVersion !== RELEASE_POINTER_SCHEMA_VERSION) {
    throw new ProductionDeploymentError("자료판 포인터 버전이 올바르지 않습니다.");
  }
  if (!RELEASE_ID_PATTERN.test(String(parsed.releaseId || ""))) {
    throw new ProductionDeploymentError("자료판 식별자 형식이 올바르지 않습니다.");
  }
  if (!SHA256_PATTERN.test(String(parsed.datasetVersion || ""))) {
    throw new ProductionDeploymentError("자료판 SHA-256 형식이 올바르지 않습니다.");
  }
  if (!isSafeCtWebUiRelativePath(parsed.relativePath)) {
    throw new ProductionDeploymentError("자료판 상대경로 형식이 올바르지 않습니다.");
  }
  return Object.freeze({
    schemaVersion: RELEASE_POINTER_SCHEMA_VERSION,
    releaseId: parsed.releaseId,
    relativePath: parsed.relativePath,
    datasetVersion: parsed.datasetVersion
  });
}

export async function computeMountedDatasetVersion(webDataRoot, { fileSystem = fs } = {}) {
  const digests = {};
  for (const relativePath of DATASET_IDENTITY_PATHS) {
    const target = path.join(webDataRoot, ...relativePath.split("/"));
    let content;
    try {
      content = await fileSystem.readFile(target);
    } catch {
      throw new ProductionDeploymentError(`자료판 식별 파일을 읽을 수 없습니다: ${relativePath}`);
    }
    digests[relativePath] = createHash("sha256").update(content).digest("hex");
  }
  return createHash("sha256").update(JSON.stringify(digests), "utf8").digest("hex");
}

export function validateMountedDatasetReady(webDataRoot, options = {}) {
  return validateMountedDatasetPublication(webDataRoot, {
    ...options,
    mode: "full"
  });
}

export function validateMountedDatasetPublication(
  webDataRoot,
  {
    env = process.env,
    platform = process.platform,
    spawnProcess = spawn,
    mode = "full",
    timeoutMs
  } = {}
) {
  if (mode !== "full" && mode !== "startup") {
    throw new ProductionDeploymentError("자료 게시 검증 방식이 올바르지 않습니다.");
  }
  const effectiveTimeoutMs = timeoutMs ?? (mode === "full" ? 30 * 60_000 : 10 * 60_000);
  if (!Number.isSafeInteger(effectiveTimeoutMs) || effectiveTimeoutMs < 1_000) {
    throw new ProductionDeploymentError("자료 게시 검증 제한 시간이 올바르지 않습니다.");
  }
  const configuredExecutable = typeof env.CTC_PYTHON_EXECUTABLE === "string"
    ? env.CTC_PYTHON_EXECUTABLE.trim()
    : "";
  const pythonExecutable = configuredExecutable || (platform === "win32" ? "python" : "python3");
  if (!ALLOWED_PYTHON_EXECUTABLES.has(pythonExecutable.toLowerCase())) {
    throw new ProductionDeploymentError("자료 게시 검증용 Python 실행기 이름이 올바르지 않습니다.");
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      pythonExecutable,
      [PUBLICATION_VALIDATOR_PATH, "--root", path.resolve(webDataRoot), "--mode", mode],
      {
        env: { ...env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout?.on("data", (chunk) => appendBoundedOutput(stdout, chunk));
    child.stderr?.on("data", (chunk) => appendBoundedOutput(stderr, chunk));
    child.once("error", () => finish(() => reject(
      new ProductionDeploymentError("자료 게시 완료 검증기를 실행할 수 없습니다.")
    )));
    child.once("close", (code) => finish(() => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(new ProductionDeploymentError(
          detail || "자료 게시 완료 계약을 확인할 수 없습니다."
        ));
        return;
      }
      try {
        const result = JSON.parse(Buffer.concat(stdout).toString("utf8").replace(/^\uFEFF/u, ""));
        if (!isPlainRecord(result) || result.ok !== true || result.status !== "complete") {
          throw new Error("invalid-result");
        }
        resolve(Object.freeze({ ...result }));
      } catch {
        reject(new ProductionDeploymentError("자료 게시 완료 검증 결과가 올바르지 않습니다."));
      }
    }));
    timer = setTimeout(() => {
      child.kill?.("SIGKILL");
      finish(() => reject(new ProductionDeploymentError("자료 게시 완료 검증 시간이 초과되었습니다.")));
    }, effectiveTimeoutMs);
    timer.unref?.();
  });
}

export function createReleasePointer({ releaseId, relativePath, datasetVersion }) {
  return parseReleasePointer({
    schemaVersion: RELEASE_POINTER_SCHEMA_VERSION,
    releaseId,
    relativePath,
    datasetVersion
  });
}

function appendBoundedOutput(chunks, value) {
  const currentSize = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (currentSize >= 64 * 1024) return;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  chunks.push(buffer.subarray(0, 64 * 1024 - currentSize));
}

function isSafeCtWebUiRelativePath(value) {
  if (typeof value !== "string" || !value.endsWith(".ctwebui") || value.includes("\\")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  const segments = value.split("/");
  return segments.length > 0 && segments.every((segment) => segment && segment !== "." && segment !== "..");
}

async function resolveExistingPaths(fileSystem, mountRoot, pointerPath) {
  try {
    const mountStat = await fileSystem.lstat(mountRoot);
    const pointerStat = await fileSystem.lstat(pointerPath);
    if (!mountStat.isDirectory() || !pointerStat.isFile()) throw new Error("invalid-path-kind");
    return await Promise.all([fileSystem.realpath(mountRoot), fileSystem.realpath(pointerPath)]);
  } catch {
    throw new ProductionDeploymentError("GCS 마운트 또는 자료판 포인터를 확인할 수 없습니다.");
  }
}

async function resolveExistingDirectories(fileSystem, mountRoot, webDataRoot) {
  try {
    const mountStat = await fileSystem.lstat(mountRoot);
    const webDataStat = await fileSystem.lstat(webDataRoot);
    if (!mountStat.isDirectory() || !webDataStat.isDirectory()
      || mountStat.isSymbolicLink() || webDataStat.isSymbolicLink()) {
      throw new Error("invalid-path-kind");
    }
    return await Promise.all([fileSystem.realpath(mountRoot), fileSystem.realpath(webDataRoot)]);
  } catch {
    throw new ProductionDeploymentError("시험 GCS 마운트 또는 자료판 디렉터리를 확인할 수 없습니다.");
  }
}

async function resolveExistingPath(fileSystem, target, message) {
  try {
    const stat = await fileSystem.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("invalid-path-kind");
    return await fileSystem.realpath(target);
  } catch {
    throw new ProductionDeploymentError(message);
  }
}

async function readText(fileSystem, filePath) {
  try {
    return await fileSystem.readFile(filePath, "utf8");
  } catch {
    throw new ProductionDeploymentError("자료판 포인터를 읽을 수 없습니다.");
  }
}

async function readJsonObject(fileSystem, filePath, label) {
  let value;
  try {
    value = JSON.parse((await fileSystem.readFile(filePath, "utf8")).replace(/^\uFEFF/u, ""));
  } catch {
    throw new ProductionDeploymentError(`${label} JSON을 읽을 수 없습니다.`);
  }
  if (!isPlainRecord(value)) {
    throw new ProductionDeploymentError(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function requiredText(value, key) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ProductionDeploymentError(`${key}가 지정되지 않았습니다.`);
  if (/[\u0000-\u001f\u007f]/u.test(text)) {
    throw new ProductionDeploymentError(`${key} 형식이 올바르지 않습니다.`);
  }
  return text;
}

function optionalText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredSha256(value, key) {
  const text = requiredText(value, key).toLowerCase();
  if (!SHA256_PATTERN.test(text)) {
    throw new ProductionDeploymentError(`${key}는 64자 SHA-256이어야 합니다.`);
  }
  return text;
}

function requiredPositiveInteger(value, key) {
  const text = requiredText(value, key);
  if (!/^[1-9][0-9]*$/u.test(text)) {
    throw new ProductionDeploymentError(`${key}는 1 이상의 정수여야 합니다.`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) {
    throw new ProductionDeploymentError(`${key} 범위가 올바르지 않습니다.`);
  }
  return parsed;
}

function isAbsolutePathForPlatform(value, platform) {
  return pathForPlatform(platform).isAbsolute(value);
}

function isPathWithin(rootPath, candidatePath, platform) {
  const pathApi = pathForPlatform(platform);
  const relative = pathApi.relative(pathApi.resolve(rootPath), pathApi.resolve(candidatePath));
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${pathApi.sep}`)
    && !pathApi.isAbsolute(relative);
}

function pathForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameArray(actual, expected) {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}
