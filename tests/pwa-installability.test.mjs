import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { createAppShellAssetManifestPlugin } from "../source/vite.config.js";

const indexBytes = await readFile(new URL("../source/index.html", import.meta.url));
const manifestBytes = await readFile(new URL("../source/public/app.webmanifest", import.meta.url));
const indexSource = indexBytes.toString("utf8");
const manifestSource = manifestBytes.toString("utf8");
const manifest = JSON.parse(manifestSource);
const serviceWorkerSource = await readFile(new URL("../source/public/sw.js", import.meta.url), "utf8");
const viteConfigSource = await readFile(new URL("../source/vite.config.js", import.meta.url), "utf8");
const deploySyncSource = await readFile(new URL("../scripts/sync-deploy-artifacts.mjs", import.meta.url), "utf8");

test("설치 화면의 한글과 manifest는 BOM 없는 UTF-8 정본이다", () => {
  assert.deepEqual([...indexBytes.subarray(0, 3)], [0x3c, 0x21, 0x64]);
  assert.deepEqual([...manifestBytes.subarray(0, 3)], [0x7b, 0x0a, 0x20]);
  assert.doesNotMatch(indexSource, /\uFFFD/u);
  assert.doesNotMatch(manifestSource, /\uFFFD/u);
  assert.match(indexSource, /<title>기후 타임캡슐 웹 앱<\/title>/u);
  assert.equal(manifest.name, "기후 타임캡슐 웹 앱");
  assert.equal(manifest.description, "학생, 교사, 일반 사용자가 미래 기후 자료를 지도와 카드로 확인하는 웹 앱");
});

test("Android 설치판은 일반 요약에서 시작하고 역할별 바로가기를 제공한다", () => {
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./#/public");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "ko-KR");
  assert.deepEqual(manifest.shortcuts.map(({ url }) => url), ["./#/query", "./#/teacher", "./#/public"]);
  assert.match(indexSource, /name="mobile-web-app-capable" content="yes"/u);
  assert.match(indexSource, /rel="apple-touch-icon" sizes="192x192"/u);
});

test("Android 아이콘은 192px, 512px와 마스크형 512px PNG를 갖는다", async () => {
  const requiredIcons = [
    ["./assets/icons/app-icon-192.png", 192, "any"],
    ["./assets/icons/app-icon-512.png", 512, "any"],
    ["./assets/icons/app-icon-maskable-512.png", 512, "maskable"]
  ];

  for (const [src, expectedSize, purpose] of requiredIcons) {
    const icon = manifest.icons.find((candidate) => candidate.src === src);
    assert.ok(icon, `manifest 아이콘이 없습니다: ${src}`);
    assert.equal(icon.type, "image/png");
    assert.equal(icon.purpose, purpose);
    assert.equal(icon.sizes, `${expectedSize}x${expectedSize}`);

    const bytes = await readFile(new URL(`../source/public/${src.slice(2)}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), expectedSize);
    assert.equal(bytes.readUInt32BE(20), expectedSize);
  }
});

test("설치용 셸은 실제 기후자료 API를 오프라인 캐시에 저장하지 않는다", () => {
  assert.match(serviceWorkerSource, /const CACHE_NAME = "climate-web-shell-v19";/u);
  assert.match(viteConfigSource, /fileName: "app-shell-assets\.json"/u);
  assert.match(deploySyncSource, /"app-shell-assets\.json"/u);
  assert.match(serviceWorkerSource, /"assets\/icons\/app-icon-192\.png"/u);
  assert.match(serviceWorkerSource, /"assets\/icons\/app-icon-512\.png"/u);
  assert.match(serviceWorkerSource, /"assets\/icons\/app-icon-maskable-512\.png"/u);
  assert.match(serviceWorkerSource, /url\.pathname\.startsWith\("\/api\/climate\/"\)\) return;/u);
  assert.match(serviceWorkerSource, /"app\.webmanifest"/u);
  assert.match(serviceWorkerSource, /cache\.put\(SHELL_ASSET_MANIFEST, response\)/u);
  assert.doesNotMatch(serviceWorkerSource, /clients\.claim/u);
  assert.doesNotMatch(serviceWorkerSource, /caches\.put\([^\n]*api\/climate/u);
});

test("빌드는 해시 실행 자산만 정렬된 앱 셸 목록으로 만든다", () => {
  const emitted = [];
  const plugin = createAppShellAssetManifestPlugin();
  plugin.generateBundle.call({
    emitFile(asset) {
      emitted.push(asset);
    },
    error(message) {
      throw new Error(message);
    }
  }, {}, {
    css: { fileName: "assets/app-Z.css" },
    html: { fileName: "index.html" },
    js: { fileName: "assets/app-A.js" },
    map: { fileName: "assets/app-A.js.map" }
  });

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].fileName, "app-shell-assets.json");
  assert.deepEqual(JSON.parse(emitted[0].source), {
    schemaVersion: 1,
    assets: ["assets/app-A.js", "assets/app-Z.css"]
  });
});

test("서비스 워커 설치는 해시 실행 자산을 저장한 뒤에만 활성화된다", async () => {
  const listeners = new Map();
  const added = [];
  const stored = [];
  let skippedWaiting = false;
  const response = {
    ok: true,
    clone() {
      return this;
    },
    async json() {
      return {
        schemaVersion: 1,
        assets: ["assets/app-A.js", "assets/app-Z.css"]
      };
    }
  };
  const context = {
    URL,
    Promise,
    Set,
    Error,
    self: {
      location: new URL("https://climate.example/app/sw.js"),
      async skipWaiting() {
        skippedWaiting = true;
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      }
    },
    caches: {
      async open() {
        return {
          async put(url) {
            stored.push(url);
          },
          async addAll(urls) {
            added.push(...urls);
          }
        };
      },
      async keys() {
        return [];
      },
      async delete() {},
      async match() {}
    },
    async fetch() {
      return response;
    }
  };
  runInNewContext(serviceWorkerSource, context);

  let installWork;
  listeners.get("install")({
    waitUntil(promise) {
      installWork = promise;
    }
  });
  await installWork;

  assert.equal(skippedWaiting, true);
  assert.deepEqual(stored, ["https://climate.example/app/app-shell-assets.json"]);
  assert.ok(added.includes("https://climate.example/app/assets/app-A.js"));
  assert.ok(added.includes("https://climate.example/app/assets/app-Z.css"));
  assert.ok(added.includes("https://climate.example/app/index.html"));
  assert.ok(added.includes("https://climate.example/app/assets/icons/app-icon-512.png"));
});
