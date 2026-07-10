import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = path.join(root, "dist");
const failures = [];

compareFile("index.html");
for (const name of ["app.webmanifest", "favicon.svg", "runtime-config.json", "sw.js"]) {
  compareFile(name);
}

const rootAssets = listAssets(path.join(root, "assets"));
const distAssets = listAssets(path.join(dist, "assets"));
if (JSON.stringify(rootAssets) !== JSON.stringify(distAssets)) {
  failures.push(`에셋 목록이 다릅니다: root=${rootAssets.join(",")} dist=${distAssets.join(",")}`);
} else {
  for (const name of rootAssets) compareFile(path.join("assets", name));
}

const result = {
  ok: failures.length === 0,
  checkedAt: new Date().toISOString(),
  comparedFiles: 5 + rootAssets.length,
  assets: rootAssets,
  failures
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function compareFile(relativePath) {
  const rootPath = path.join(root, relativePath);
  const distPath = path.join(dist, relativePath);
  if (!fs.existsSync(rootPath) || !fs.existsSync(distPath)) {
    failures.push(`비교 파일이 없습니다: ${relativePath}`);
    return;
  }
  const rootHash = sha256(rootPath);
  const distHash = sha256(distPath);
  if (rootHash !== distHash) failures.push(`빌드 재현 해시가 다릅니다: ${relativePath}`);
}

function listAssets(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}
