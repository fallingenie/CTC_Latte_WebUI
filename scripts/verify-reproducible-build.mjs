import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DIST_ROOT,
  DEFAULT_REPOSITORY_ROOT,
  collectBuildArtifacts,
  inspectRootDeployment
} from "./sync-deploy-artifacts.mjs";

export async function verifyReproducibleBuild({
  deploymentRoot = DEFAULT_REPOSITORY_ROOT,
  buildRoot = DEFAULT_DIST_ROOT
} = {}) {
  const failures = [];
  let buildArtifacts = [];
  let rootArtifacts = [];
  let comparedFiles = 0;

  try {
    buildArtifacts = await collectBuildArtifacts(buildRoot);
  } catch (error) {
    failures.push(errorMessage(error));
  }

  try {
    const inspection = await inspectRootDeployment(deploymentRoot);
    rootArtifacts = inspection.artifactPaths;
    failures.push(...inspection.failures);
  } catch (error) {
    failures.push(errorMessage(error));
  }

  if (buildArtifacts.length > 0) {
    const buildSet = new Set(buildArtifacts);
    const rootSet = new Set(rootArtifacts);

    for (const relativePath of buildArtifacts) {
      if (!rootSet.has(relativePath)) {
        failures.push(`루트 배포본에 파일이 없습니다: ${relativePath}`);
      }
    }

    for (const relativePath of rootArtifacts) {
      if (!buildSet.has(relativePath)) {
        failures.push(`루트 배포본에 stale 파일이 있습니다: ${relativePath}`);
      }
    }

    for (const relativePath of buildArtifacts) {
      if (!rootSet.has(relativePath)) continue;

      try {
        const rootHash = await sha256(resolveArtifact(deploymentRoot, relativePath));
        const distHash = await sha256(resolveArtifact(buildRoot, relativePath));
        comparedFiles += 1;
        if (rootHash !== distHash) {
          failures.push(`빌드 재현 해시가 다릅니다: ${relativePath}`);
        }
      } catch (error) {
        failures.push(`${relativePath} 해시 계산 실패: ${errorMessage(error)}`);
      }
    }
  }

  const uniqueFailures = [...new Set(failures)].sort(compareNames);
  return {
    ok: uniqueFailures.length === 0,
    artifactCount: buildArtifacts.length,
    comparedFiles,
    artifacts: buildArtifacts,
    failures: uniqueFailures
  };
}

async function sha256(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function resolveArtifact(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const invokedPath = path.resolve(process.argv[1]);
  const modulePath = fileURLToPath(import.meta.url);
  if (process.platform === "win32") return invokedPath.toLowerCase() === modulePath.toLowerCase();
  return invokedPath === modulePath;
}

if (isMainModule()) {
  const result = await verifyReproducibleBuild();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
