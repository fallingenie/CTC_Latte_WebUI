import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLIC_CLIMATE_READ_PATH,
  validatePublicRuntimeConfig
} from "../source/runtime-policy.js";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUTPUT_PATH = path.join(REPOSITORY_ROOT, "dist", "runtime-config.json");

export function createPagesRuntimeConfig(apiOrigin) {
  const origin = validateApiOrigin(apiOrigin);
  const configuration = validatePublicRuntimeConfig({
    readPath: new URL(PUBLIC_CLIMATE_READ_PATH, `${origin}/`).toString(),
    timeoutMs: 600_000,
    publicSafe: true,
    sourcePolicy: "cloud-only"
  });
  return {
    readPath: configuration.readPath,
    timeoutMs: configuration.timeoutMs,
    publicSafe: true,
    sourcePolicy: configuration.sourcePolicy
  };
}

export async function writePagesRuntimeConfig({
  apiOrigin = process.env.CTC_PUBLIC_API_ORIGIN,
  outputPath = DEFAULT_OUTPUT_PATH,
  fileSystem = fs
} = {}) {
  const resolvedOutputPath = path.resolve(outputPath);
  if (!isPathWithin(path.join(REPOSITORY_ROOT, "dist"), resolvedOutputPath)) {
    throw new Error("GitHub Pages 연결 설정은 dist 디렉터리 안에만 만들 수 있습니다.");
  }
  const configuration = createPagesRuntimeConfig(apiOrigin);
  await fileSystem.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await fileSystem.writeFile(
    resolvedOutputPath,
    `${JSON.stringify(configuration, null, 2)}\n`,
    { encoding: "utf8", flag: "w" }
  );
  return Object.freeze({ outputPath: resolvedOutputPath, configuration });
}

function validateApiOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("CTC_PUBLIC_API_ORIGIN이 설정되지 않았습니다.");
  }
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("CTC_PUBLIC_API_ORIGIN 형식이 올바르지 않습니다.");
  }
  if (parsed.protocol !== "https:"
    || parsed.port
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash) {
    throw new Error("CTC_PUBLIC_API_ORIGIN은 경로가 없는 HTTPS 출처여야 합니다.");
  }
  const runtimeConfig = validatePublicRuntimeConfig({
    readPath: new URL(PUBLIC_CLIMATE_READ_PATH, parsed).toString(),
    timeoutMs: 600_000,
    publicSafe: true,
    sourcePolicy: "cloud-only"
  });
  return new URL(runtimeConfig.readPath).origin;
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await writePagesRuntimeConfig();
    process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
