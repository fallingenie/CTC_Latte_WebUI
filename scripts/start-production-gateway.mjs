import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const LOOPBACK_HOST = "127.0.0.1";
export const DEFAULT_GATEWAY_PORT = 8765;

const GATEWAY_SCRIPT_RELATIVE_PATH = path.join("scripts", "serve_webui_data_gateway.py");
const DATASET_FILE_RELATIVE_PATHS = Object.freeze({
  manifest: "manifest.json",
  arrayIndex: path.join("meta", "array_index.json"),
  rawIndex: path.join("meta", "raw_cmip6_index.json")
});
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const ALLOWED_PYTHON_EXECUTABLES = new Set(["py", "py.exe", "python", "python.exe", "python3", "python3.exe"]);
const LOCAL_FALLBACK_ENVIRONMENT_KEYS = Object.freeze([
  "CLIMATE_CMIP6_LOCAL_ZARR_ROOT",
  "CLIMATE_CMIP6_EXTRACTION_CACHE_ROOT",
  "CLIMATE_TIME_CAPSULE_RAW_ZARR_POINT_CACHE",
  "CLIMATE_TIME_CAPSULE_RAW_ZARR_POINT_CACHE_DIR",
  "CLIMATE_TIME_CAPSULE_RAW_ZARR_POINT_CACHE_ROOT",
  "CLIMATE_TIME_CAPSULE_SSD_SCRATCH_DIR",
  "CMIP6_CACHE_ROOT",
  "CTC_WEB_DATA_PARENT",
  "CTC_WEBUI_RAW_CMIP6_CLOUD_CACHE_ROOT",
  "CTC_WEBUI_RAW_CMIP6_INDEX_CACHE_ROOT",
  "CTC_WEBUI_RAW_CMIP6_SOURCE_MANIFEST_SHA256"
]);
const LAUNCHER_ONLY_ENVIRONMENT_KEYS = Object.freeze([
  "CTC_DEPLOYMENT_BASE_URL",
  "CTC_GOOGLE_DRIVE_MOUNT_ROOT",
  "CTC_PRODUCTION_ATTESTATION_OUTPUT",
  "CTC_PRODUCTION_ATTESTATION_STRICT_GIT",
  "CTC_PRODUCTION_DATA_ATTESTATION",
  "CTC_PRODUCTION_EVIDENCE_ROOT"
]);

export class ProductionDeploymentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionDeploymentError";
  }
}

export function isGcsRoot(value) {
  const text = normalizeText(value);
  return /^gs:\/\/[^/?#\s]+(?:\/[^?#\s]*)?$/u.test(text);
}

export function isLocalAbsolutePath(value) {
  const text = normalizeText(value);
  if (!text || isGcsRoot(text)) return false;
  return /^file:\/{1,3}/iu.test(text)
    || path.win32.isAbsolute(text)
    || path.posix.isAbsolute(text);
}

export function validateCloudOnlyDeploymentEnvironment(env = process.env, { platform = process.platform } = {}) {
  const backendRoot = requiredEnvironmentValue(env, "CTC_BACKEND_ROOT");
  const driveMountRoot = requiredEnvironmentValue(env, "CTC_GOOGLE_DRIVE_MOUNT_ROOT");
  const webDataRoot = requiredEnvironmentValue(env, "CTC_WEB_DATA_ROOT");
  const rawCmip6Root = requiredEnvironmentValue(env, "CTC_WEBUI_CMIP6_ZARR_ROOT");

  if (!isAbsolutePathForPlatform(backendRoot, platform)) {
    throw new ProductionDeploymentError("CTC_BACKEND_ROOT는 절대경로여야 합니다.");
  }
  if (!isAbsolutePathForPlatform(driveMountRoot, platform)) {
    throw new ProductionDeploymentError("CTC_GOOGLE_DRIVE_MOUNT_ROOT는 절대경로여야 합니다.");
  }
  if (!isAbsolutePathForPlatform(webDataRoot, platform)) {
    throw new ProductionDeploymentError("CTC_WEB_DATA_ROOT는 절대경로여야 합니다.");
  }
  if (!webDataRoot.toLowerCase().endsWith(".ctwebui")) {
    throw new ProductionDeploymentError("CTC_WEB_DATA_ROOT는 .ctwebui 자료 폴더여야 합니다.");
  }
  if (!isPathWithin(driveMountRoot, webDataRoot, platform)) {
    throw new ProductionDeploymentError("CTC_WEB_DATA_ROOT는 지정된 Google Drive 마운트 안에 있어야 합니다.");
  }
  if (!isGcsRoot(rawCmip6Root)) {
    throw new ProductionDeploymentError("CTC_WEBUI_CMIP6_ZARR_ROOT는 gs:// GCS 루트여야 합니다.");
  }
  if (normalizeText(env.CLIMATE_CMIP6_LOCAL_ZARR_ROOT)) {
    throw new ProductionDeploymentError("legacy CLIMATE_CMIP6_LOCAL_ZARR_ROOT는 비어 있어야 합니다.");
  }

  return Object.freeze({ backendRoot, driveMountRoot, webDataRoot, rawCmip6Root, platform });
}

export function validateGatewayEnvironment(env = process.env, options = {}) {
  const deployment = validateCloudOnlyDeploymentEnvironment(env, options);
  const configuredHost = normalizeText(env.CTC_GATEWAY_HOST);
  if (configuredHost && !LOOPBACK_HOSTS.has(configuredHost.toLowerCase())) {
    throw new ProductionDeploymentError("운영 게이트웨이는 loopback 주소에서만 실행할 수 있습니다.");
  }

  const port = parseGatewayPort(env.CTC_GATEWAY_PORT ?? env.PORT);
  const defaultPythonExecutable = (options.platform ?? process.platform) === "win32" ? "python" : "python3";
  const pythonExecutable = normalizeText(env.CTC_PYTHON_EXECUTABLE) || defaultPythonExecutable;
  if (!ALLOWED_PYTHON_EXECUTABLES.has(pythonExecutable.toLowerCase())) {
    throw new ProductionDeploymentError("CTC_PYTHON_EXECUTABLE은 허용된 Python 실행기 이름이어야 합니다.");
  }

  return Object.freeze({
    ...deployment,
    host: LOOPBACK_HOST,
    port,
    pythonExecutable
  });
}

export function validateRawCmip6Index(value, rawCmip6Root) {
  if (!isPlainRecord(value)) {
    throw new ProductionDeploymentError("raw CMIP6 index가 JSON 객체가 아닙니다.");
  }
  if (!Array.isArray(value.entries) || value.entries.length === 0) {
    throw new ProductionDeploymentError("raw CMIP6 index 항목이 비어 있습니다.");
  }
  if (!Number.isSafeInteger(value.entry_count) || value.entry_count !== value.entries.length) {
    throw new ProductionDeploymentError("raw CMIP6 index 항목 수가 일치하지 않습니다.");
  }

  value.entries.forEach((entry) => {
    if (!isPlainRecord(entry)) {
      throw new ProductionDeploymentError("raw CMIP6 index 항목 형식이 올바르지 않습니다.");
    }
    const entryPath = normalizeText(entry.path);
    const pathMode = normalizeText(entry.path_mode);
    if (!entryPath) {
      throw new ProductionDeploymentError("raw CMIP6 index 경로가 비어 있습니다.");
    }
    if (isLocalAbsolutePath(entryPath)) {
      throw new ProductionDeploymentError("raw CMIP6 index에 로컬 절대경로가 포함되어 있습니다.");
    }
    if (pathMode === "absolute_uri") {
      if (!isGcsRoot(entryPath) || !isGcsPathWithin(rawCmip6Root, entryPath)) {
        throw new ProductionDeploymentError("raw CMIP6 index의 절대 URI가 승인된 GCS 루트를 벗어났습니다.");
      }
      return;
    }
    if (pathMode !== "relative_to_raw_cmip6_root" || !isSafeRelativeRawPath(entryPath)) {
      throw new ProductionDeploymentError("raw CMIP6 index의 상대경로 형식이 올바르지 않습니다.");
    }
  });

  return value;
}

export async function validateGatewayFiles(configuration, { fileSystem = fs } = {}) {
  const gatewayScript = path.join(configuration.backendRoot, GATEWAY_SCRIPT_RELATIVE_PATH);
  const manifestPath = path.join(configuration.webDataRoot, DATASET_FILE_RELATIVE_PATHS.manifest);
  const arrayIndexPath = path.join(configuration.webDataRoot, DATASET_FILE_RELATIVE_PATHS.arrayIndex);
  const rawIndexPath = path.join(configuration.webDataRoot, DATASET_FILE_RELATIVE_PATHS.rawIndex);

  await requireDirectory(fileSystem, configuration.backendRoot, "백엔드 루트");
  await requireDirectory(fileSystem, configuration.driveMountRoot, "Google Drive 마운트 루트");
  await requireDirectory(fileSystem, configuration.webDataRoot, ".ctwebui 자료 루트");
  await requireRegularFile(fileSystem, gatewayScript, "백엔드 게이트웨이 스크립트");
  await requireRegularFile(fileSystem, manifestPath, ".ctwebui manifest");
  await requireRegularFile(fileSystem, arrayIndexPath, ".ctwebui array index");
  await requireRegularFile(fileSystem, rawIndexPath, ".ctwebui raw CMIP6 index");

  let realPaths;
  try {
    realPaths = await Promise.all([
      fileSystem.realpath(configuration.backendRoot),
      fileSystem.realpath(configuration.driveMountRoot),
      fileSystem.realpath(configuration.webDataRoot),
      fileSystem.realpath(gatewayScript),
      fileSystem.realpath(manifestPath),
      fileSystem.realpath(arrayIndexPath),
      fileSystem.realpath(rawIndexPath)
    ]);
  } catch {
    throw new ProductionDeploymentError("운영 게이트웨이의 실제 파일 경로를 확인할 수 없습니다.");
  }
  const [backendRealPath, driveRealPath, webDataRealPath, gatewayRealPath, ...dataFileRealPaths] = realPaths;
  if (!isPathWithin(driveRealPath, webDataRealPath, configuration.platform)
    || !isPathWithin(backendRealPath, gatewayRealPath, configuration.platform)
    || dataFileRealPaths.some((filePath) => !isPathWithin(webDataRealPath, filePath, configuration.platform))) {
    throw new ProductionDeploymentError("운영 자료 또는 실행 파일이 승인된 루트 밖을 가리킵니다.");
  }

  let rawIndex;
  try {
    rawIndex = parseJsonText(await fileSystem.readFile(rawIndexPath, "utf8"));
  } catch (error) {
    if (error instanceof ProductionDeploymentError) throw error;
    throw new ProductionDeploymentError(".ctwebui raw CMIP6 index를 읽을 수 없습니다.");
  }
  validateRawCmip6Index(rawIndex, configuration.rawCmip6Root);

  return Object.freeze({ gatewayScript, manifestPath, arrayIndexPath, rawIndexPath });
}

export function buildGatewayChildEnvironment(parentEnv, configuration) {
  const childEnv = {
    ...parentEnv,
    CTC_BACKEND_ROOT: configuration.backendRoot,
    CTC_WEB_DATA_ROOT: configuration.webDataRoot,
    CTC_WEBUI_CMIP6_ZARR_ROOT: configuration.rawCmip6Root,
    CTC_WEBUI_RAW_CMIP6_INDEX_CACHE: "0",
    CTC_WEBUI_RAW_CMIP6_QUERY_CACHE: "0",
    CTC_WEBUI_RAW_CMIP6_MAX_CONCURRENT_WORKERS: "1",
    CTC_WEBUI_RAW_CMIP6_QUERY_WORKER: "1"
  };
  for (const key of LOCAL_FALLBACK_ENVIRONMENT_KEYS) delete childEnv[key];
  for (const key of LAUNCHER_ONLY_ENVIRONMENT_KEYS) delete childEnv[key];
  return childEnv;
}

export function buildGatewayArguments(configuration, files) {
  return [
    files.gatewayScript,
    "--root",
    configuration.webDataRoot,
    "--host",
    LOOPBACK_HOST,
    "--port",
    String(configuration.port),
    "--raw-cmip6-root",
    configuration.rawCmip6Root
  ];
}

export async function startProductionGateway({
  env = process.env,
  platform = process.platform,
  fileSystem = fs,
  spawnProcess = spawn,
  signalTarget = process
} = {}) {
  const configuration = validateGatewayEnvironment(env, { platform });
  const files = await validateGatewayFiles(configuration, { fileSystem });
  const child = spawnProcess(
    configuration.pythonExecutable,
    buildGatewayArguments(configuration, files),
    {
      cwd: configuration.backendRoot,
      env: buildGatewayChildEnvironment(env, configuration),
      shell: false,
      stdio: ["ignore", "ignore", "inherit"],
      windowsHide: true
    }
  );
  return waitForChildProcess(child, { platform, signalTarget });
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
    return await startProductionGateway();
  } catch (error) {
    const message = error instanceof ProductionDeploymentError
      ? error.message
      : "운영 게이트웨이를 시작하지 못했습니다.";
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredEnvironmentValue(env, key) {
  const value = normalizeText(env[key]);
  if (!value) throw new ProductionDeploymentError(`${key}가 지정되지 않았습니다.`);
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ProductionDeploymentError(`${key} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function isAbsolutePathForPlatform(value, platform) {
  return platform === "win32" ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
}

function isPathWithin(rootPath, candidatePath, platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const relative = pathApi.relative(pathApi.resolve(rootPath), pathApi.resolve(candidatePath));
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${pathApi.sep}`)
    && !pathApi.isAbsolute(relative);
}

function parseGatewayPort(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_GATEWAY_PORT;
  if (!/^\d{1,5}$/u.test(text)) {
    throw new ProductionDeploymentError("게이트웨이 포트 형식이 올바르지 않습니다.");
  }
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ProductionDeploymentError("게이트웨이 포트 범위가 올바르지 않습니다.");
  }
  return port;
}

function isSafeRelativeRawPath(value) {
  if (value === ".") return true;
  if (!value || value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function isGcsPathWithin(rootValue, candidateValue) {
  if (!isGcsRoot(rootValue) || !isGcsRoot(candidateValue)) return false;
  try {
    const root = new URL(rootValue);
    const candidate = new URL(candidateValue);
    if (root.hostname.toLowerCase() !== candidate.hostname.toLowerCase()) return false;
    const rootPath = normalizeGcsPath(root.pathname);
    const candidatePath = normalizeGcsPath(candidate.pathname);
    return rootPath === "/"
      || candidatePath === rootPath
      || candidatePath.startsWith(`${rootPath}/`);
  } catch {
    return false;
  }
}

function normalizeGcsPath(value) {
  const decoded = decodeURIComponent(value);
  if (/[\u0000-\u001f\u007f]/u.test(decoded)) throw new TypeError("invalid GCS path");
  const normalized = path.posix.normalize(`/${decoded}`).replace(/\/+$/u, "");
  return normalized || "/";
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseJsonText(text) {
  const normalized = String(text).replace(/^\uFEFF/u, "");
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ProductionDeploymentError("JSON 형식이 올바르지 않습니다.");
  }
}

async function requireDirectory(fileSystem, targetPath, label) {
  try {
    const stat = await fileSystem.lstat(targetPath);
    if (!stat.isDirectory()) throw new Error("not-directory");
  } catch {
    throw new ProductionDeploymentError(`${label}를 확인할 수 없습니다.`);
  }
}

async function requireRegularFile(fileSystem, targetPath, label) {
  try {
    const stat = await fileSystem.lstat(targetPath);
    if (!stat.isFile()) throw new Error("not-file");
  } catch {
    throw new ProductionDeploymentError(`${label} 파일을 확인할 수 없습니다.`);
  }
}

function waitForChildProcess(child, { platform, signalTarget }) {
  return new Promise((resolve, reject) => {
    const signals = platform === "win32"
      ? ["SIGINT", "SIGTERM", "SIGBREAK"]
      : ["SIGINT", "SIGTERM", "SIGHUP"];
    const handlers = new Map();
    let settled = false;

    const cleanup = () => {
      for (const [signal, handler] of handlers) signalTarget.removeListener(signal, handler);
    };
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    for (const signal of signals) {
      const handler = () => {
        try {
          child.kill(signal === "SIGBREAK" ? "SIGTERM" : signal);
        } catch {
          try {
            child.kill();
          } catch {
            return;
          }
        }
      };
      handlers.set(signal, handler);
      signalTarget.once(signal, handler);
    }

    child.once("error", () => {
      finish(() => reject(new ProductionDeploymentError("Python 게이트웨이 프로세스를 실행하지 못했습니다.")));
    });
    child.once("exit", (code) => {
      finish(() => resolve(Number.isInteger(code) ? code : 1));
    });
  });
}

if (isMainEntry()) {
  process.exitCode = await main();
}
