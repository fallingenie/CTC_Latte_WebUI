import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  computeMountedDatasetVersion,
  createReleasePointer
} from "./release-candidate-data.mjs";
import { ProductionDeploymentError } from "./start-production-gateway.mjs";

export async function createReleasePointerFile({
  mountRoot,
  relativePath,
  pointerRelativePath = relativePath,
  releaseId,
  outputPath,
  fileSystem = fs
}) {
  const root = path.resolve(requiredText(mountRoot, "마운트 루트"));
  const output = path.resolve(requiredText(outputPath, "출력 경로"));
  const normalizedRelativePath = requiredText(relativePath, "자료판 상대경로").replaceAll("\\", "/");
  const normalizedPointerRelativePath = requiredText(pointerRelativePath, "포인터 대상 상대경로").replaceAll("\\", "/");
  const webDataRoot = path.resolve(root, ...normalizedRelativePath.split("/"));
  if (!isPathWithin(root, webDataRoot)) {
    throw new ProductionDeploymentError("자료판 경로가 마운트 루트를 벗어났습니다.");
  }
  const datasetVersion = await computeMountedDatasetVersion(webDataRoot, { fileSystem });
  const pointer = createReleasePointer({
    releaseId,
    relativePath: normalizedPointerRelativePath,
    datasetVersion
  });
  await fileSystem.mkdir(path.dirname(output), { recursive: true });
  const temporaryPath = `${output}.${process.pid}.tmp`;
  await fileSystem.writeFile(temporaryPath, `${JSON.stringify(pointer, null, 2)}\n`, "utf8");
  await fileSystem.rename(temporaryPath, output);
  return Object.freeze({ outputPath: output, pointer, webDataRoot });
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new ProductionDeploymentError("자료판 포인터 생성 인수가 올바르지 않습니다.");
    }
    values.set(key.slice(2), value);
  }
  return {
    mountRoot: values.get("mount-root"),
    relativePath: values.get("relative-path"),
    pointerRelativePath: values.get("pointer-relative-path") || values.get("relative-path"),
    releaseId: values.get("release-id"),
    outputPath: values.get("output")
  };
}

function requiredText(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new ProductionDeploymentError(`${label} 형식이 올바르지 않습니다.`);
  }
  return text;
}

function isPathWithin(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function isMainEntry(metaUrl = import.meta.url, argvEntry = process.argv[1]) {
  if (!argvEntry) return false;
  try {
    return pathToFileURL(path.resolve(argvEntry)).href === metaUrl;
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  try {
    const result = await createReleasePointerFile(parseArguments(process.argv.slice(2)));
    process.stdout.write(JSON.stringify({
      datasetVersion: result.pointer.datasetVersion,
      ok: true,
      releaseId: result.pointer.releaseId
    }, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof ProductionDeploymentError
      ? error.message
      : "자료판 포인터를 만들지 못했습니다.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
