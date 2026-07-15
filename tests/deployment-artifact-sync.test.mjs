import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEPLOYMENT_FILES,
  syncDeployArtifacts
} from "../scripts/sync-deploy-artifacts.mjs";
import { verifyReproducibleBuild } from "../scripts/verify-reproducible-build.mjs";

const newAssetPath = "assets/index-current.js";
const nestedAssetPath = "assets/chunks/chart-current.js";
const staleAssetPath = "assets/legacy/index-stale.js";

test("배포 산출물 동기화는 stale asset을 제거하고 새 asset을 복사한다", async (context) => {
  const fixture = await createFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  const result = await syncDeployArtifacts({
    deploymentRoot: fixture.deploymentRoot,
    buildRoot: fixture.buildRoot
  });

  assert.equal(result.ok, true);
  assert.ok(result.removed.includes(staleAssetPath));
  assert.ok(result.removedDirectories.includes("assets/legacy"));
  assert.ok(result.copied.includes(newAssetPath));
  await assert.rejects(
    () => fs.access(resolveArtifact(fixture.deploymentRoot, staleAssetPath)),
    { code: "ENOENT" }
  );
  assert.equal(
    await fs.readFile(resolveArtifact(fixture.deploymentRoot, newAssetPath), "utf8"),
    fixture.contents.get(newAssetPath)
  );
  assert.equal(
    await fs.readFile(resolveArtifact(fixture.deploymentRoot, nestedAssetPath), "utf8"),
    fixture.contents.get(nestedAssetPath)
  );
});

test("동기화한 산출물은 재현 검증에 성공하고 루트 파일 변조 후 실패한다", async (context) => {
  const fixture = await createFixture();
  context.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  await syncDeployArtifacts({
    deploymentRoot: fixture.deploymentRoot,
    buildRoot: fixture.buildRoot
  });

  const verified = await verifyReproducibleBuild({
    deploymentRoot: fixture.deploymentRoot,
    buildRoot: fixture.buildRoot
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.artifactCount, fixture.contents.size);
  assert.equal(verified.comparedFiles, fixture.contents.size);
  assert.deepEqual(verified.failures, []);

  await fs.writeFile(path.join(fixture.deploymentRoot, "index.html"), "tampered root file\n", "utf8");

  const tampered = await verifyReproducibleBuild({
    deploymentRoot: fixture.deploymentRoot,
    buildRoot: fixture.buildRoot
  });
  assert.equal(tampered.ok, false);
  assert.ok(tampered.failures.some((failure) => failure.includes("index.html")));
});

async function createFixture() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctc-webui-deploy-sync-"));
  const buildRoot = path.join(tempRoot, "dist");
  const deploymentRoot = path.join(tempRoot, "repository");
  const contents = new Map();

  await fs.mkdir(buildRoot, { recursive: true });
  await fs.mkdir(deploymentRoot, { recursive: true });

  for (const fileName of DEPLOYMENT_FILES) {
    contents.set(fileName, `current build: ${fileName}\n`);
  }
  contents.set(newAssetPath, "export const current = true;\n");
  contents.set(nestedAssetPath, "export const chart = true;\n");

  for (const [relativePath, content] of contents) {
    await writeArtifact(buildRoot, relativePath, content);
  }
  await writeArtifact(deploymentRoot, staleAssetPath, "export const stale = true;\n");

  return { tempRoot, buildRoot, deploymentRoot, contents };
}

async function writeArtifact(root, relativePath, content) {
  const filePath = resolveArtifact(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function resolveArtifact(root, relativePath) {
  return path.join(root, ...relativePath.split("/"));
}
