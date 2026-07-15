import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEPLOYMENT_FILES = Object.freeze([
  "app.webmanifest",
  "favicon.svg",
  "index.html",
  "runtime-config.json",
  "sw.js"
]);
export const DEPLOYMENT_DIRECTORIES = Object.freeze(["assets"]);
export const DEFAULT_REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_DIST_ROOT = path.join(DEFAULT_REPOSITORY_ROOT, "dist");

export async function collectBuildArtifacts(buildRoot = DEFAULT_DIST_ROOT) {
  const entries = await readTopLevelEntries(buildRoot, "빌드 디렉터리");
  const expectedNames = new Set([...DEPLOYMENT_FILES, ...DEPLOYMENT_DIRECTORIES]);
  const actualNames = new Set(entries.map((entry) => entry.name));
  const failures = [];

  for (const expectedName of expectedNames) {
    if (!actualNames.has(expectedName)) failures.push(`빌드 산출물이 없습니다: ${expectedName}`);
  }
  for (const entry of entries) {
    if (!expectedNames.has(entry.name)) failures.push(`예상하지 않은 빌드 산출물입니다: ${entry.name}`);
  }
  for (const fileName of DEPLOYMENT_FILES) {
    const entry = entries.find((candidate) => candidate.name === fileName);
    if (entry && !entry.isFile()) failures.push(`빌드 산출물이 일반 파일이 아닙니다: ${fileName}`);
  }
  for (const directoryName of DEPLOYMENT_DIRECTORIES) {
    const entry = entries.find((candidate) => candidate.name === directoryName);
    if (entry && !entry.isDirectory()) failures.push(`빌드 산출물이 디렉터리가 아닙니다: ${directoryName}`);
  }

  if (failures.length > 0) throw new Error(failures.sort(compareNames).join("; "));

  const artifacts = [...DEPLOYMENT_FILES];
  for (const directoryName of DEPLOYMENT_DIRECTORIES) {
    const tree = await readDirectoryTree(path.join(buildRoot, directoryName), {
      label: `빌드 산출물 ${directoryName}`
    });
    artifacts.push(...tree.files.map((relativePath) => `${directoryName}/${relativePath}`));
  }

  if (!artifacts.some((relativePath) => relativePath.startsWith("assets/"))) {
    throw new Error("빌드 assets 디렉터리에 파일이 없습니다.");
  }

  return artifacts.sort(compareNames);
}

export async function inspectRootDeployment(deploymentRoot = DEFAULT_REPOSITORY_ROOT) {
  await requireDirectory(deploymentRoot, "저장소 루트");
  const artifactPaths = [];
  const failures = [];

  for (const fileName of DEPLOYMENT_FILES) {
    const filePath = path.join(deploymentRoot, fileName);
    try {
      const stat = await fs.lstat(filePath);
      if (stat.isFile()) artifactPaths.push(fileName);
      else failures.push(`루트 배포 경로가 일반 파일이 아닙니다: ${fileName}`);
    } catch (error) {
      if (isMissing(error)) failures.push(`루트 배포 파일이 없습니다: ${fileName}`);
      else throw error;
    }
  }

  for (const directoryName of DEPLOYMENT_DIRECTORIES) {
    try {
      const tree = await readDirectoryTree(path.join(deploymentRoot, directoryName), {
        label: `루트 배포 경로 ${directoryName}`
      });
      artifactPaths.push(...tree.files.map((relativePath) => `${directoryName}/${relativePath}`));
    } catch (error) {
      failures.push(errorMessage(error));
    }
  }

  return {
    artifactPaths: artifactPaths.sort(compareNames),
    failures: failures.sort(compareNames)
  };
}

export async function syncDeployArtifacts({
  deploymentRoot = DEFAULT_REPOSITORY_ROOT,
  buildRoot = DEFAULT_DIST_ROOT
} = {}) {
  await requireDirectory(deploymentRoot, "저장소 루트");
  const artifactPaths = await collectBuildArtifacts(buildRoot);
  const sourceContents = new Map();

  for (const relativePath of artifactPaths) {
    sourceContents.set(relativePath, await fs.readFile(resolveArtifact(buildRoot, relativePath)));
  }

  for (const fileName of DEPLOYMENT_FILES) {
    await requireRegularFileOrMissing(path.join(deploymentRoot, fileName), fileName);
  }

  const rootTrees = new Map();
  for (const directoryName of DEPLOYMENT_DIRECTORIES) {
    rootTrees.set(directoryName, await readDirectoryTree(path.join(deploymentRoot, directoryName), {
      allowMissing: true,
      label: `루트 배포 경로 ${directoryName}`
    }));
  }

  const copied = [];
  const unchanged = [];
  for (const relativePath of artifactPaths) {
    const currentContent = await readFileOrMissing(resolveArtifact(deploymentRoot, relativePath));
    if (currentContent?.equals(sourceContents.get(relativePath))) unchanged.push(relativePath);
    else copied.push(relativePath);
  }

  const expectedPaths = new Set(artifactPaths);
  const removed = [];
  const removedDirectories = [];
  for (const directoryName of DEPLOYMENT_DIRECTORIES) {
    const tree = rootTrees.get(directoryName);
    for (const relativePath of tree.files) {
      const deploymentPath = `${directoryName}/${relativePath}`;
      if (!expectedPaths.has(deploymentPath)) removed.push(deploymentPath);
    }
  }

  for (const relativePath of removed.sort(compareNames)) {
    await fs.unlink(resolveArtifact(deploymentRoot, relativePath));
  }

  const expectedDirectories = collectExpectedDirectories(artifactPaths);
  for (const directoryName of DEPLOYMENT_DIRECTORIES) {
    const tree = rootTrees.get(directoryName);
    const directories = tree.directories
      .map((relativePath) => `${directoryName}/${relativePath}`)
      .sort(compareDeepestFirst);
    for (const relativePath of directories) {
      if (expectedDirectories.has(relativePath)) continue;
      await fs.rmdir(resolveArtifact(deploymentRoot, relativePath));
      removedDirectories.push(relativePath);
    }
  }

  for (const relativePath of [...copied].sort(compareSyncOrder)) {
    const targetPath = resolveArtifact(deploymentRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, sourceContents.get(relativePath));
  }

  return {
    ok: true,
    artifactCount: artifactPaths.length,
    copied: copied.sort(compareNames),
    removed: removed.sort(compareNames),
    removedDirectories: removedDirectories.sort(compareNames),
    unchanged: unchanged.sort(compareNames)
  };
}

async function readTopLevelEntries(directory, label) {
  await requireDirectory(directory, label);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.sort((left, right) => compareNames(left.name, right.name));
}

async function readDirectoryTree(directory, { allowMissing = false, label = directory } = {}) {
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (allowMissing && isMissing(error)) return { files: [], directories: [] };
    if (isMissing(error)) throw new Error(`${label} 디렉터리가 없습니다.`);
    throw error;
  }

  if (!stat.isDirectory()) throw new Error(`${label}가 디렉터리가 아닙니다.`);

  const files = [];
  const directories = [];
  await visit(directory, "");
  return { files, directories };

  async function visit(currentDirectory, relativeDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => compareNames(left.name, right.name));

    for (const entry of entries) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label}에 심볼릭 링크가 있습니다: ${relativePath}`);
      if (entry.isDirectory()) {
        directories.push(relativePath);
        await visit(entryPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new Error(`${label}에 일반 파일이 아닌 항목이 있습니다: ${relativePath}`);
      }
    }
  }
}

async function requireDirectory(directory, label) {
  let stat;
  try {
    stat = await fs.lstat(directory);
  } catch (error) {
    if (isMissing(error)) throw new Error(`${label} 디렉터리가 없습니다: ${directory}`);
    throw error;
  }
  if (!stat.isDirectory()) throw new Error(`${label}가 디렉터리가 아닙니다: ${directory}`);
}

async function requireRegularFileOrMissing(filePath, relativePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) throw new Error(`루트 배포 대상이 일반 파일이 아닙니다: ${relativePath}`);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function readFileOrMissing(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if (isMissing(error) || error?.code === "EISDIR" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function collectExpectedDirectories(artifactPaths) {
  const directories = new Set(DEPLOYMENT_DIRECTORIES);
  for (const relativePath of artifactPaths) {
    let directory = path.posix.dirname(relativePath);
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  return directories;
}

function resolveArtifact(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function compareSyncOrder(left, right) {
  const leftRank = left.startsWith("assets/") ? 0 : left === "index.html" ? 2 : 1;
  const rightRank = right.startsWith("assets/") ? 0 : right === "index.html" ? 2 : 1;
  return leftRank - rightRank || compareNames(left, right);
}

function compareDeepestFirst(left, right) {
  const depthDifference = right.split("/").length - left.split("/").length;
  return depthDifference || compareNames(left, right);
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMissing(error) {
  return error?.code === "ENOENT";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const invokedPath = path.resolve(process.argv[1]);
  const modulePath = fileURLToPath(import.meta.url);
  if (process.platform === "win32") return invokedPath.toLowerCase() === modulePath.toLowerCase();
  return invokedPath === modulePath;
}

if (isMainModule()) {
  try {
    const result = await syncDeployArtifacts();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: errorMessage(error) }, null, 2));
    process.exitCode = 1;
  }
}
