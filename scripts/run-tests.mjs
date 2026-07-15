import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const testsRoot = path.join(root, "tests");
const testFiles = await findTestFiles(testsRoot);

if (testFiles.length === 0) {
  throw new Error("실행할 *.test.mjs 파일을 찾지 못했습니다.");
}

const relativeTestFiles = testFiles.map((filePath) => toPortablePath(path.relative(root, filePath)));
console.log(JSON.stringify({ testFileCount: relativeTestFiles.length, testFiles: relativeTestFiles }, null, 2));

const result = spawnSync(
  process.execPath,
  ["--test", ...process.argv.slice(2), ...testFiles],
  {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: "inherit",
    windowsHide: true
  }
);

if (result.error) throw result.error;
if (result.signal) {
  console.error(`테스트 실행기가 신호로 종료되었습니다: ${result.signal}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}

async function findTestFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`테스트 경로에 심볼릭 링크를 사용할 수 없습니다: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(entryPath);
    }
  }
  return files;
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
