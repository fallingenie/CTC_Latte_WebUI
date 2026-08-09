import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  computeMountedDatasetVersion,
  validateLegacyTestPublication
} from "./release-candidate-data.mjs";
import { ProductionDeploymentError } from "./start-production-gateway.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export async function inspectLegacyRcDataset(webDataRoot, { fileSystem = fs } = {}) {
  const root = path.resolve(String(webDataRoot || ""));
  const [manifest, completion, datasetVersion] = await Promise.all([
    readJsonObject(fileSystem, path.join(root, "manifest.json"), "manifest.json"),
    readJsonObject(fileSystem, path.join(root, "meta", "completion.json"), "meta/completion.json"),
    computeMountedDatasetVersion(root, { fileSystem })
  ]);
  const generationId = String(manifest.generation_id || "").toLowerCase();
  const manifestBindingSha256 = String(completion.manifest_binding_sha256 || "").toLowerCase();
  if (!SHA256_PATTERN.test(generationId) || !SHA256_PATTERN.test(manifestBindingSha256)) {
    throw new ProductionDeploymentError("RC 자료판의 generation 또는 manifest 결합값이 올바르지 않습니다.");
  }
  validateLegacyTestPublication({
    manifest,
    completion,
    expectedGenerationId: generationId,
    expectedManifestBinding: manifestBindingSha256
  });
  const acknowledgedIntegrityGapBytes = sumDeclaredArtifactBytes(manifest.artifacts);
  return Object.freeze({
    acknowledgedIntegrityGapBytes,
    datasetVersion,
    generationId,
    manifestBindingSha256
  });
}

async function readJsonObject(fileSystem, target, label) {
  let parsed;
  try {
    parsed = JSON.parse((await fileSystem.readFile(target, "utf8")).replace(/^\uFEFF/u, ""));
  } catch {
    throw new ProductionDeploymentError(`${label}을 JSON 객체로 읽을 수 없습니다.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProductionDeploymentError(`${label}은 JSON 객체여야 합니다.`);
  }
  return parsed;
}

function sumDeclaredArtifactBytes(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length < 1) {
    throw new ProductionDeploymentError("RC 자료판에 선언된 artifact가 없습니다.");
  }
  let total = 0;
  for (const artifact of artifacts) {
    const size = artifact?.size_bytes;
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(total + size)) {
      throw new ProductionDeploymentError("RC 자료판의 artifact 크기 선언이 올바르지 않습니다.");
    }
    total += size;
  }
  if (total < 1) {
    throw new ProductionDeploymentError("RC 자료판의 선언된 전체 크기는 1바이트 이상이어야 합니다.");
  }
  return total;
}

function isMainEntry() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainEntry()) {
  try {
    const result = await inspectLegacyRcDataset(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "RC 자료판을 확인하지 못했습니다.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
