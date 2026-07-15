import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const canonicalAssets = [
  {
    relativePath: "source/public/assets/licenses/kma_mark_1.png",
    size: 7485,
    sha256: "8248bb099a0c05b9819d60a9423673582d143cfc909cc22a9ffcb3e6770c6b06"
  },
  {
    relativePath: "source/public/assets/licenses/kma_mark_2.png",
    size: 10205,
    sha256: "4e489d7721cd2b629c28a0aebb54e3f7668f257185949e77fda9b008f35ed8f8"
  }
];

test("KMA attribution assets match the Backend origin/main canonical files", async () => {
  for (const asset of canonicalAssets) {
    const bytes = await fs.readFile(path.join(root, ...asset.relativePath.split("/")));

    assert.equal(bytes.byteLength, asset.size, `${asset.relativePath} size`);
    assert.equal(sha256(bytes), asset.sha256, `${asset.relativePath} SHA-256`);
  }
});

test("Vite 진입 자산은 고정 캐시 토큰 없이 해시 빌드에 맡긴다", async () => {
  const indexHtml = await fs.readFile(path.join(root, "source", "index.html"), "utf8");
  const publicAppSources = [...indexHtml.matchAll(/\bsrc=["']([^"']*public-app\.js[^"']*)["']/gu)]
    .map((match) => match[1]);

  assert.deepEqual(publicAppSources, ["./public-app.js"]);
  assert.doesNotMatch(indexHtml, /public-app\.js[?#]/u);
  assert.match(indexHtml, /href=["']\.\/public-app\.css["']/u);
  assert.doesNotMatch(indexHtml, /public-app\.css[?#]/u);
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
