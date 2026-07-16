import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  ACCESS_PASSWORD_SHA256,
  ACCESS_SESSION_KEY,
  grantAccess,
  isAccessGranted,
  sha256Hex,
  timingSafeHexEqual,
  verifyAccessPassword
} from "../source/access-policy.js";

const gateSource = await readFile(new URL("../source/access-gate.js", import.meta.url), "utf8");
const gateStyle = await readFile(new URL("../source/access-gate.css", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../source/index.html", import.meta.url), "utf8");
const publicAppSource = await readFile(new URL("../source/public-app.js", import.meta.url), "utf8");

test("접근 암호 정책은 SHA-256 해시와 고정 길이 비교를 사용한다", async () => {
  const sample = "검증용 암호";
  const expected = createHash("sha256").update(sample).digest("hex");

  assert.match(ACCESS_PASSWORD_SHA256, /^[0-9a-f]{64}$/u);
  assert.equal(await sha256Hex(sample, webcrypto), expected);
  assert.equal(timingSafeHexEqual(expected, expected), true);
  const changedLastCharacter = expected.at(-1) === "0" ? "1" : "0";
  assert.equal(timingSafeHexEqual(expected, `${expected.slice(0, -1)}${changedLastCharacter}`), false);
  assert.equal(await verifyAccessPassword(sample, webcrypto), false);
});

test("접근 승인은 브라우저 탭의 세션 저장소에만 기록한다", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };

  assert.equal(isAccessGranted(storage), false);
  assert.equal(grantAccess(storage), true);
  assert.equal(values.has(ACCESS_SESSION_KEY), true);
  assert.equal(isAccessGranted(storage), true);
});

test("index는 본 앱 대신 접근 게이트만 시작한다", () => {
  assert.match(indexSource, /src="\.\/access-gate\.js"/u);
  assert.doesNotMatch(indexSource, /(?:src|href)="\.\/public-app\.(?:js|css)"/u);
  assert.match(gateSource, /import\("\.\/public-app\.js"\)/u);
  assert.match(publicAppSource, /^import "\.\/public-app\.css";/u);
});

test("접근 화면은 한국어 입력 안내와 오류 상태를 제공한다", () => {
  assert.match(gateSource, /비공개 시험 운영/u);
  assert.match(gateSource, /초대받은 사용자만 접속할 수 있습니다\./u);
  assert.match(gateSource, /label for="access-password">접속 암호/u);
  assert.match(gateSource, /autocomplete="current-password"/u);
  assert.match(gateSource, /aria-live="polite"/u);
  assert.match(gateSource, /role", "alert"/u);
  assert.match(gateStyle, /@media \(max-width: 480px\)/u);
  assert.match(gateStyle, /@media \(max-width: 320px\)/u);
  assert.match(gateStyle, /html\[data-theme="dark"\]/u);
  assert.match(gateStyle, /min-width: 0/u);
});
