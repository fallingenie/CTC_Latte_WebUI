import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  computeMountedDatasetVersion,
  validateCurrentGcsDataset
} from "./release-candidate-data.mjs";
import { ProductionDeploymentError } from "./start-production-gateway.mjs";

export async function inspectCurrentGcsDataset(webDataRoot, { fileSystem = fs } = {}) {
  const root = path.resolve(String(webDataRoot || ""));
  const [manifest, completion, datasetVersion] = await Promise.all([
    readJsonObject(fileSystem, path.join(root, "manifest.json"), "manifest.json"),
    readJsonObject(fileSystem, path.join(root, "meta", "completion.json"), "meta/completion.json"),
    computeMountedDatasetVersion(root, { fileSystem })
  ]);
  const currentDataset = validateCurrentGcsDataset({ manifest, completion });
  return Object.freeze({
    datasetVersion,
    formatVersion: currentDataset.formatVersion
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

function isMainEntry() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainEntry()) {
  try {
    const result = await inspectCurrentGcsDataset(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "RC 자료판을 확인하지 못했습니다.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
