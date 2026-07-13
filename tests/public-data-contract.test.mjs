import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../source/public-app.js", import.meta.url), "utf8");

test("프리셋에는 합성 기후 수치가 들어가지 않는다", () => {
  const presetStart = source.indexOf("const queryPresets = [");
  const presetEnd = source.indexOf("function routeFromHash", presetStart);
  const presetSource = source.slice(presetStart, presetEnd);
  assert.ok(presetStart >= 0 && presetEnd > presetStart);
  assert.doesNotMatch(presetSource, /\bmetrics\s*:/u);
  assert.doesNotMatch(presetSource, /\bvalue\s*:/u);
});

test("결측 상태는 예시값 대신 명시적인 비가용 상태를 쓴다", () => {
  assert.match(source, /value: waiting \? "조회 중" : "자료 없음"/u);
  assert.match(source, /available: false/u);
});

test("공개 앱은 허용된 실제자료 API 경로만 사용한다", () => {
  assert.match(source, /const defaultReadPath = "\/api\/climate\/query"/u);
  assert.doesNotMatch(source, /drive\.google\.com|googleapis\.com\/drive|\.ctwebui|\.ctcapsule/iu);
});

test("학생 공유 링크에는 개발용 검색 매개변수를 포함하지 않는다", () => {
  assert.match(source, /const url = new URL\(window\.location\.href\);\s+url\.search = "";/u);
});

test("날짜 초안은 완전한 날짜를 확인한 뒤에만 조회 조건으로 반영한다", () => {
  const confirmedInputStart = source.indexOf("function ConfirmedDateInput(");
  const confirmedInputEnd = source.indexOf("function DateField", confirmedInputStart);
  const confirmedInputSource = source.slice(confirmedInputStart, confirmedInputEnd);
  const publicPageStart = source.indexOf("function PublicPage()");
  const publicPageEnd = source.indexOf("function useRemoteMetricResponse", publicPageStart);
  const publicPageSource = source.slice(publicPageStart, publicPageEnd);

  assert.match(confirmedInputSource, /const \[draftValue, setDraftValue\] = useState\(value\)/u);
  assert.match(confirmedInputSource, /isCompleteDateValue\(draftValue, \{ min, max \}\)/u);
  assert.match(confirmedInputSource, /onInput:/u);
  assert.match(confirmedInputSource, /onChange:/u);
  assert.match(confirmedInputSource, /onConfirm\(draftValue\)/u);
  assert.match(publicPageSource, /jsx\(ConfirmedDateInput/u);
  assert.doesNotMatch(publicPageSource, /onInput: \(event\) => setPublicDate/u);
  assert.doesNotMatch(publicPageSource, /onChange: \(event\) => setPublicDate/u);
});
