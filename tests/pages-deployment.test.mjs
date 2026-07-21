import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createPagesRuntimeConfig,
  writePagesRuntimeConfig
} from "../scripts/create-pages-runtime-config.mjs";

test("Pages 연결 설정은 공개 Cloud Run API만 가리킨다", () => {
  const configuration = createPagesRuntimeConfig(
    "https://ctc-latte-rc-123456789012.asia-northeast3.run.app"
  );
  assert.deepEqual(configuration, {
    readPath: "https://ctc-latte-rc-123456789012.asia-northeast3.run.app/api/climate/query",
    timeoutMs: 600_000,
    publicSafe: true,
    sourcePolicy: "cloud-only"
  });
  assert.throws(() => createPagesRuntimeConfig("https://example.com"), /공개 조회 기준/u);
  assert.throws(
    () => createPagesRuntimeConfig("https://ctc-latte-rc.example.run.app/private"),
    /경로가 없는 HTTPS/u
  );
});

test("Pages 연결 설정은 UTF-8 JSON으로만 저장한다", async (context) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ctc-pages-config-"));
  const outputPath = path.join(tempRoot, "runtime-config.json");
  context.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const fileSystem = {
    mkdir: fs.mkdir,
    async writeFile(_filePath, content, options) {
      assert.deepEqual(options, { encoding: "utf8", flag: "w" });
      await fs.writeFile(outputPath, content, options);
    }
  };
  const result = await writePagesRuntimeConfig({
    apiOrigin: "https://ctc-latte-rc.example.run.app",
    outputPath: path.join(path.resolve("dist"), "runtime-config.json"),
    fileSystem
  });
  const content = await fs.readFile(outputPath);
  assert.notDeepEqual([...content.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(result.configuration.readPath, "https://ctc-latte-rc.example.run.app/api/climate/query");
});

test("Pages 작업 흐름은 검증 뒤 dist만 게시한다", async () => {
  const workflow = await fs.readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.match(workflow, /vars\.CTC_PUBLIC_API_ORIGIN/u);
  assert.match(workflow, /pnpm test/u);
  assert.match(workflow, /verify-reproducible-build\.mjs/u);
  assert.match(workflow, /pnpm verify:public-data --samples 3 --seed pages-/u);
  assert.doesNotMatch(workflow, /verify:public-data -- --/u);
  assert.match(workflow, /pnpm prepare:pages/u);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/u);
  assert.match(workflow, /actions\/deploy-pages@v4/u);
  assert.match(workflow, /path: dist/u);
});

test("Pages 게시 스크립트는 공개 전환 뒤 작업 성공과 실제 연결 설정을 확인한다", async () => {
  const script = await fs.readFile(new URL("../deploy/publish-github-pages.ps1", import.meta.url), "utf8");
  assert.match(script, /variable', 'set', 'CTC_PUBLIC_API_ORIGIN/u);
  assert.match(script, /--visibility', 'public'/u);
  assert.match(script, /--accept-visibility-change-consequences/u);
  assert.match(script, /build_type=workflow/u);
  assert.match(script, /workflow', 'run'/u);
  assert.match(script, /run', 'watch'/u);
  assert.match(script, /runtime-config\.json/u);
  assert.match(script, /sourcePolicy\s*-eq\s*'cloud-only'/u);
});
