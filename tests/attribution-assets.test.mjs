import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VERIFIED_LOCAL_RESULT_MARK_ASSETS } from "../source/export-attribution.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const canonicalAssets = [
  {
    name: "kma_mark_1.png",
    path: "licenses/kma_mark_1.png",
    sourceUrl: "./assets/licenses/kma_mark_1.png",
    sizeBytes: 7485,
    sha256: "8248bb099a0c05b9819d60a9423673582d143cfc909cc22a9ffcb3e6770c6b06"
  },
  {
    name: "kma_mark_2.png",
    path: "licenses/kma_mark_2.png",
    sourceUrl: "./assets/licenses/kma_mark_2.png",
    sizeBytes: 10205,
    sha256: "4e489d7721cd2b629c28a0aebb54e3f7668f257185949e77fda9b008f35ed8f8"
  }
];

test("WebUI의 로컬 결과 표장 catalog는 실제 배포 PNG의 name·path·SHA·size와 일치한다", async () => {
  assert.deepEqual(VERIFIED_LOCAL_RESULT_MARK_ASSETS.map((asset) => ({
    name: asset.name,
    path: asset.path,
    sourceUrl: asset.sourceUrl,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256
  })), canonicalAssets);

  for (const asset of canonicalAssets) {
    const relativePath = `source/public/${asset.sourceUrl.replace(/^\.\//u, "")}`;
    const bytes = await fs.readFile(path.join(root, ...relativePath.split("/")));

    assert.equal(bytes.byteLength, asset.sizeBytes, `${relativePath} size`);
    assert.equal(sha256(bytes), asset.sha256, `${relativePath} SHA-256`);
    assert.notEqual(asset.path, asset.sourceUrl, "Backend descriptor path를 fetch URL로 사용하면 안 됩니다.");
    assert.match(asset.sourceUrl, /^\.\/assets\/licenses\/[A-Za-z0-9._-]+\.png$/u);
  }
});

test("Vite 진입 자산은 인증 게이트만 직접 불러오고 본 앱은 지연 로드한다", async () => {
  const indexHtml = await fs.readFile(path.join(root, "source", "index.html"), "utf8");
  const accessGateSources = [...indexHtml.matchAll(/\bsrc=["']([^"']*access-gate\.js[^"']*)["']/gu)]
    .map((match) => match[1]);

  assert.deepEqual(accessGateSources, ["./access-gate.js"]);
  assert.doesNotMatch(indexHtml, /(?:src|href)=["'][^"']*public-app\.(?:js|css)/u);
  assert.doesNotMatch(indexHtml, /access-gate\.js[?#]/u);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
