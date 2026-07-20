import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveReleaseDataEnvironment } from "./release-candidate-data.mjs";
import {
  LOOPBACK_HOST,
  ProductionDeploymentError,
  spawnProductionGateway
} from "./start-production-gateway.mjs";

const FRONTEND_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_PUBLIC_PORT = 8080;
const DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8_000;
const API_PREFIX = "/api/climate/";
const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https://tile.openstreetmap.org; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), geolocation=(self), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
});
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"]
]);

export function validateReleaseServerEnvironment(env = process.env) {
  const publicPort = parsePort(env.PORT, "PORT", DEFAULT_PUBLIC_PORT);
  const gatewayPort = parsePort(env.CTC_GATEWAY_PORT, "CTC_GATEWAY_PORT", 8765);
  if (publicPort === gatewayPort) {
    throw new ProductionDeploymentError("공개 포트와 내부 게이트웨이 포트는 달라야 합니다.");
  }
  const distRoot = path.resolve(env.CTC_FRONTEND_DIST_ROOT?.trim() || path.join(FRONTEND_ROOT, "dist"));
  if (distRoot === FRONTEND_ROOT || !isPathWithin(FRONTEND_ROOT, distRoot)) {
    throw new ProductionDeploymentError("정적 배포 경로는 Frontend 저장소 안에 있어야 합니다.");
  }
  const allowedOrigins = parseAllowedOrigins(env.CTC_PUBLIC_WEB_ORIGINS);
  return Object.freeze({ distRoot, gatewayPort, publicPort, allowedOrigins });
}

export function createReleaseRequestHandler({
  distRoot,
  gatewayPort,
  allowedOrigins = new Set(),
  fileSystem = fs,
  fetchImplementation = globalThis.fetch
}) {
  return async function releaseRequestHandler(request, response) {
    applyHeaders(response, SECURITY_HEADERS);
    let pathname;
    try {
      pathname = new URL(request.url || "/", "http://release.local").pathname;
    } catch {
      return writeJson(response, 400, { error: "요청 주소 형식이 올바르지 않습니다." });
    }

    if (pathname === "/healthz") {
      return proxyHealth(response, gatewayPort, fetchImplementation);
    }
    if (pathname.startsWith(API_PREFIX)) {
      const cors = applyClimateCors(request, response, allowedOrigins);
      if (!cors.allowed) {
        return writeJson(response, 403, { error: "허용되지 않은 웹 출처의 요청입니다." });
      }
      if (request.method === "OPTIONS") return completePreflight(request, response);
      return proxyClimateRequest(request, response, gatewayPort);
    }
    if (!new Set(["GET", "HEAD"]).has(request.method || "GET")) {
      response.setHeader("Allow", "GET, HEAD");
      return writeJson(response, 405, { error: "허용되지 않은 요청 방식입니다." });
    }
    return serveStaticFile(request, response, pathname, distRoot, fileSystem);
  };
}

export async function startReleaseCandidateServer({
  env = process.env,
  fileSystem = fs,
  fetchImplementation = globalThis.fetch,
  spawnGateway = spawnProductionGateway,
  createServer = http.createServer,
  signalTarget = process
} = {}) {
  const serverConfiguration = validateReleaseServerEnvironment(env);
  await requireDistribution(serverConfiguration.distRoot, fileSystem);
  const release = await resolveReleaseDataEnvironment(env, { fileSystem });
  const gatewayEnvironment = {
    ...release.env,
    CTC_GATEWAY_HOST: LOOPBACK_HOST,
    CTC_GATEWAY_PORT: String(serverConfiguration.gatewayPort)
  };
  let gateway;
  let server;
  let stopPromise;
  const signalHandlers = new Map();
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) signalTarget.removeListener(signal, handler);
    signalHandlers.clear();
  };
  const stop = (exitCode = 0) => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      removeSignalHandlers();
      await Promise.allSettled([
        closeServer(server, { timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS }),
        terminateChild(gateway?.child, { timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS })
      ]);
      process.exitCode = exitCode;
    })();
    return stopPromise;
  };

  try {
    gateway = await spawnGateway({ env: gatewayEnvironment, fileSystem });
    await waitForGateway({
      child: gateway.child,
      fetchImplementation,
      port: serverConfiguration.gatewayPort,
      timeoutMs: parsePositiveInteger(env.CTC_GATEWAY_STARTUP_TIMEOUT_MS, DEFAULT_STARTUP_TIMEOUT_MS)
    });

    server = createServer(createReleaseRequestHandler({
      distRoot: serverConfiguration.distRoot,
      gatewayPort: serverConfiguration.gatewayPort,
      allowedOrigins: serverConfiguration.allowedOrigins,
      fileSystem,
      fetchImplementation
    }));
    server.requestTimeout = 620_000;
    server.headersTimeout = 30_000;
    server.keepAliveTimeout = 5_000;

    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => void stop(0);
      signalHandlers.set(signal, handler);
      signalTarget.once(signal, handler);
    }
    gateway.child.once("error", () => void stop(1));
    gateway.child.once("exit", (code) => {
      if (!stopPromise) void stop(Number.isInteger(code) && code !== 0 ? code : 1);
    });

    await listen(server, serverConfiguration.publicPort);
    process.stdout.write(JSON.stringify({
      event: "release-candidate-ready",
      releaseId: release.pointer.releaseId,
      datasetVersion: release.pointer.datasetVersion,
      port: serverConfiguration.publicPort
    }) + "\n");
    return Object.freeze({ gateway, release, server, serverConfiguration, stop });
  } catch (error) {
    await stop(1);
    throw error;
  }
}

export async function waitForGateway({
  child,
  fetchImplementation,
  port,
  timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  intervalMs = 250
}) {
  if (typeof fetchImplementation !== "function") {
    throw new ProductionDeploymentError("게이트웨이 준비 상태를 확인할 수 없습니다.");
  }
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  let spawnError = false;
  const onExit = () => { exited = true; };
  const onError = () => { spawnError = true; };
  const removeChildListeners = () => {
    child?.removeListener?.("exit", onExit);
    child?.removeListener?.("error", onError);
  };
  child?.once?.("exit", onExit);
  child?.once?.("error", onError);
  while (Date.now() < deadline && !exited && !spawnError) {
    try {
      const response = await fetchImplementation(`http://${LOOPBACK_HOST}:${port}/api/climate/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(2_000, Math.max(1, deadline - Date.now())))
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload?.ok === true && payload?.publicSafe === true) {
          removeChildListeners();
          return payload;
        }
      }
    } catch {
      // 시작 중에는 연결 거부가 정상적으로 발생할 수 있습니다.
    }
    await delay(intervalMs);
  }
  removeChildListeners();
  await terminateChild(child);
  throw new ProductionDeploymentError(
    exited || spawnError
      ? "기후자료 게이트웨이가 준비 전에 종료되었습니다."
      : "기후자료 게이트웨이 준비 시간이 초과되었습니다."
  );
}

async function serveStaticFile(request, response, pathname, distRoot, fileSystem) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return writeJson(response, 400, { error: "요청 주소 형식이 올바르지 않습니다." });
  }
  if (decodedPath.includes("\\") || decodedPath.includes("\0")) {
    return writeJson(response, 400, { error: "요청 주소 형식이 올바르지 않습니다." });
  }

  const relativePath = decodedPath === "/"
    ? "index.html"
    : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(distRoot, ...relativePath.split("/"));
  if (!isPathWithin(distRoot, filePath)) {
    return writeJson(response, 404, { error: "요청한 화면을 찾을 수 없습니다." });
  }

  let content;
  try {
    const stat = await fileSystem.lstat(filePath);
    if (!stat.isFile()) throw new Error("not-file");
    content = await fileSystem.readFile(filePath);
  } catch {
    return writeJson(response, 404, { error: "요청한 화면을 찾을 수 없습니다." });
  }

  const extension = path.extname(filePath).toLowerCase();
  response.statusCode = 200;
  response.setHeader("Content-Type", CONTENT_TYPES.get(extension) || "application/octet-stream");
  response.setHeader("Content-Length", String(content.length));
  response.setHeader("Cache-Control", staticCacheControl(relativePath));
  if (request.method === "HEAD") return response.end();
  return response.end(content);
}

function proxyClimateRequest(request, response, gatewayPort) {
  if (!new Set(["GET", "POST"]).has(request.method || "GET")) {
    response.setHeader("Allow", "GET, POST");
    return writeJson(response, 405, { error: "허용되지 않은 요청 방식입니다." });
  }
  const headers = {};
  for (const name of ["accept", "content-length", "content-type", "user-agent"]) {
    if (request.headers[name] !== undefined) headers[name] = request.headers[name];
  }
  headers.host = `${LOOPBACK_HOST}:${gatewayPort}`;
  const upstream = http.request({
    host: LOOPBACK_HOST,
    port: gatewayPort,
    method: request.method,
    path: request.url,
    headers,
    timeout: 610_000
  }, (upstreamResponse) => {
    response.statusCode = upstreamResponse.statusCode || 502;
    for (const name of ["content-length", "content-type"]) {
      const value = upstreamResponse.headers[name];
      if (value !== undefined) response.setHeader(name, value);
    }
    response.setHeader("Cache-Control", "no-store");
    upstreamResponse.pipe(response);
  });
  const abortUpstream = () => {
    if (!upstream.destroyed) upstream.destroy(new Error("client-aborted"));
  };
  request.once("aborted", abortUpstream);
  response.once("close", () => {
    if (!response.writableEnded) abortUpstream();
  });
  upstream.once("timeout", () => upstream.destroy(new Error("gateway-timeout")));
  upstream.once("error", () => {
    if (request.aborted || response.destroyed) return;
    if (!response.headersSent) {
      writeJson(response, 503, {
        error: "기후자료 서비스가 응답하지 않습니다. 잠시 후 다시 시도하세요.",
        code: "gateway_unavailable",
        retryable: true
      });
    } else {
      response.destroy();
    }
  });
  request.pipe(upstream);
}

export function parseAllowedOrigins(value) {
  const text = String(value ?? "").trim();
  if (!text) return new Set();
  const origins = text.split(/[;,]/u).map((item) => item.trim()).filter(Boolean);
  if (origins.length === 0 || origins.length > 16) {
    throw new ProductionDeploymentError("공개 웹 출처 설정이 올바르지 않습니다.");
  }
  const normalized = new Set();
  for (const origin of origins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ProductionDeploymentError("공개 웹 출처 설정이 올바르지 않습니다.");
    }
    if (parsed.protocol !== "https:"
      || parsed.port
      || parsed.username
      || parsed.password
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash) {
      throw new ProductionDeploymentError("공개 웹 출처는 경로가 없는 HTTPS 주소여야 합니다.");
    }
    normalized.add(parsed.origin);
  }
  return normalized;
}

function applyClimateCors(request, response, allowedOrigins) {
  const origin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";
  if (!origin) return { allowed: true, origin: null };
  if (!(allowedOrigins instanceof Set) || !allowedOrigins.has(origin)) {
    return { allowed: false, origin };
  }
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Expose-Headers", "Content-Type");
  return { allowed: true, origin };
}

function completePreflight(request, response) {
  const requestedMethod = String(request.headers["access-control-request-method"] ?? "").toUpperCase();
  if (!new Set(["GET", "POST"]).has(requestedMethod)) {
    return writeJson(response, 403, { error: "허용되지 않은 사전 요청 방식입니다." });
  }
  const requestedHeaders = String(request.headers["access-control-request-headers"] ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => header !== "content-type")) {
    return writeJson(response, 403, { error: "허용되지 않은 요청 헤더입니다." });
  }
  response.statusCode = 204;
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Max-Age", "3600");
  response.setHeader("Cache-Control", "no-store");
  response.end();
}

async function proxyHealth(response, gatewayPort, fetchImplementation) {
  try {
    if (typeof fetchImplementation !== "function") throw new Error("fetch-unavailable");
    const upstream = await fetchImplementation(`http://${LOOPBACK_HOST}:${gatewayPort}/api/climate/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    if (!upstream.ok) throw new Error("not-ready");
    const payload = await upstream.json();
    if (payload?.ok !== true || payload?.publicSafe !== true) throw new Error("not-ready");
    return writeJson(response, 200, { ok: true });
  } catch {
    return writeJson(response, 503, { ok: false });
  }
}

function applyHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
}

function writeJson(response, statusCode, payload) {
  const content = Buffer.from(JSON.stringify(payload), "utf8");
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", String(content.length));
  response.setHeader("Cache-Control", "no-store");
  response.end(content);
}

function staticCacheControl(relativePath) {
  if (relativePath === "index.html" || relativePath === "runtime-config.json" || relativePath === "sw.js") {
    return "no-store";
  }
  return /(?:^|\/)assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[A-Za-z0-9]+$/u.test(relativePath)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";
}

function parsePort(value, label, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (!/^\d{1,5}$/u.test(text)) throw new ProductionDeploymentError(`${label} 형식이 올바르지 않습니다.`);
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new ProductionDeploymentError(`${label} 범위가 올바르지 않습니다.`);
  }
  return port;
}

function parsePositiveInteger(value, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (!/^\d+$/u.test(text)) throw new ProductionDeploymentError("게이트웨이 준비 제한시간 형식이 올바르지 않습니다.");
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > 600_000) {
    throw new ProductionDeploymentError("게이트웨이 준비 제한시간 범위가 올바르지 않습니다.");
  }
  return number;
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function requireDistribution(distRoot, fileSystem) {
  try {
    const [rootStat, indexStat] = await Promise.all([
      fileSystem.lstat(distRoot),
      fileSystem.lstat(path.join(distRoot, "index.html"))
    ]);
    if (!rootStat.isDirectory() || !indexStat.isFile()) throw new Error("invalid-dist");
  } catch {
    throw new ProductionDeploymentError("배포할 Frontend 파일을 확인할 수 없습니다.");
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function closeServer(server, { timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (!server?.listening) return resolve();
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    timer.unref?.();
    server.close(finish);
    server.closeIdleConnections?.();
  });
}

export function terminateChild(child, { timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS } = {}) {
  if (!child || child.killed === true || child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener?.("exit", finish);
      child.removeListener?.("error", finish);
      resolve();
    };
    child.once?.("exit", finish);
    child.once?.("error", finish);
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        finish();
      }
      setTimeout(finish, 250);
    }, timeoutMs);
    try {
      child.kill("SIGTERM");
    } catch {
      finish();
    }
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function isMainEntry(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  if (!argvEntry) return false;
  try {
    return pathToFileURL(path.resolve(argvEntry)).href === metaUrl;
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  try {
    await startReleaseCandidateServer();
  } catch (error) {
    const message = error instanceof ProductionDeploymentError
      ? error.message
      : "출시 후보 서비스를 시작하지 못했습니다.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
