import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const [appSource, styleSource, citationSource] = await Promise.all([
  fs.readFile(path.join(root, "source", "public-app.js"), "utf8"),
  fs.readFile(path.join(root, "source", "public-app.css"), "utf8"),
  fs.readFile(path.join(root, "CITATION.cff"), "utf8")
]);

test("세 사용자 화면은 공통 제목행에서 출처와 인용을 확인한다", () => {
  assert.match(appSource, /function SourceCitationDisclosure/u);
  assert.match(appSource, /jsx\(SourceCitationDisclosure, \{ metadata \}\)/u);
  assert.match(appSource, /CMIP6\/downscaleCMIP6 자료 출처/u);
  assert.match(appSource, /\.\/assets\/licenses\/kma_mark_1\.png/u);
  assert.match(appSource, /\.\/assets\/licenses\/kma_mark_2\.png/u);
  assert.match(appSource, /https:\/\/www\.data\.go\.kr\/data\/15057210\/openapi\.do/u);
  assert.match(appSource, /공공누리 제1유형 출처 표시/u);
  assert.match(appSource, /제3자 권리 포함 저작권 표시/u);
  assert.match(styleSource, /\.topbar-eyebrow-row\s*\{[\s\S]*?justify-content: space-between/u);
});

test("제작자와 GitHub 정보는 고정되지 않은 공통 하단에 한 번만 표시한다", () => {
  assert.equal(appSource.match(/jsx\(SiteFooter, \{\}\)/gu)?.length, 1);
  assert.match(appSource, /function SiteFooter/u);
  assert.match(appSource, /creator\.displayName/u);
  assert.match(appSource, /creator\.githubHandle/u);
  const footerRule = styleSource.match(/\.site-footer\s*\{([\s\S]*?)\}/u)?.[1] ?? "";
  assert.match(footerRule, /position: static/u);
  assert.doesNotMatch(footerRule, /position:\s*(?:fixed|sticky)/u);
  assert.match(citationSource, /given-names: "Geonho"/u);
  assert.match(citationSource, /alias: "fallingenie"/u);
});

test("좁은 화면에서도 출처 패널과 하단 정보는 화면 너비를 넘지 않는다", () => {
  assert.match(styleSource, /@media \(max-width: 600px\)[\s\S]*?\.source-citation-panel\s*\{[\s\S]*?width: calc\(100vw - 24px\)/u);
  assert.match(styleSource, /@media \(max-width: 600px\)[\s\S]*?\.site-footer-inner\s*\{[\s\S]*?display: grid/u);
});
