import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { ProductionDeploymentError } from "./start-production-gateway.mjs";

export const RELEASE_POINTER_SCHEMA_VERSION = 1;

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

export async function resolveReleaseDataEnvironment(
  env = process.env,
  { fileSystem = fs, platform = process.platform } = {}
) {
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

  const actualDatasetVersion = await computeMountedDatasetVersion(webDataRoot, { fileSystem });
  if (actualDatasetVersion !== pointer.datasetVersion) {
    throw new ProductionDeploymentError("자료판 포인터와 실제 .ctwebui SHA-256이 일치하지 않습니다.");
  }

  return Object.freeze({
    env: Object.freeze({ ...env, CTC_WEB_DATA_ROOT: webDataRoot }),
    pointer,
    pointerPath,
    webDataRoot
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

export function createReleasePointer({ releaseId, relativePath, datasetVersion }) {
  return parseReleasePointer({
    schemaVersion: RELEASE_POINTER_SCHEMA_VERSION,
    releaseId,
    relativePath,
    datasetVersion
  });
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

async function readText(fileSystem, filePath) {
  try {
    return await fileSystem.readFile(filePath, "utf8");
  } catch {
    throw new ProductionDeploymentError("자료판 포인터를 읽을 수 없습니다.");
  }
}

function requiredText(value, key) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ProductionDeploymentError(`${key}가 지정되지 않았습니다.`);
  if (/[\u0000-\u001f\u007f]/u.test(text)) {
    throw new ProductionDeploymentError(`${key} 형식이 올바르지 않습니다.`);
  }
  return text;
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
