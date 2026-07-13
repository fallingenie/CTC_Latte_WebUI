import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../source/public-app.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../source/public-app.css", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../source/public/sw.js", import.meta.url), "utf8");

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

test("배포 셸은 코드 자산을 네트워크에서 먼저 갱신한다", () => {
  assert.match(serviceWorkerSource, /climate-web-shell-v12/u);
  assert.match(serviceWorkerSource, /\["script", "style", "worker"\]\.includes\(request\.destination\)/u);
  assert.match(serviceWorkerSource, /fetch\(request\)[\s\S]*caches\.match\(request\)/u);
  assert.match(source, /updateViaCache: "none"/u);
});

test("원자료 조회 중에는 보정 관측지 부재와 대기 방법을 안내한다", () => {
  assert.match(source, /선택 위치의 주변에 보정 관측지가 없어 기후 모델의 원자료를 읽는 중입니다/u);
  assert.match(source, /조회가 끝날 때까지 새로고침하거나 창을 닫지 마세요/u);
  assert.doesNotMatch(source, /원본 기후모델 격자를 읽는 위치는/u);
});

test("조회 취소는 진행 중인 요청을 중단하고 취소 상태를 남긴다", () => {
  assert.match(source, /function ClimateLoadingOverlay\(\{ onCancel \}\)/u);
  assert.match(source, /className: "loading-cancel-button", onClick: onCancel/u);
  assert.match(source, /fetchPublicClimateQuery\(request, \{ signal: controller\.signal \}\)/u);
  assert.match(source, /controllerRef\.current\.abort\(\)/u);
  assert.match(source, /status: "cancelled", message: "자료 조회를 취소했습니다\. 조건을 바꾸면 다시 조회합니다\."/u);
});

test("조회 창은 좁은 화면에서도 안내문과 취소 버튼을 독립된 열로 유지한다", () => {
  assert.match(source, /className: "climate-loading-heading"/u);
  assert.match(source, /className: "climate-loading-status"/u);
  assert.match(source, /자료를 찾고 정리하는 중/u);
  assert.match(styleSource, /\.loading-completion\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) max-content;/u);
  assert.match(styleSource, /\.loading-completion small\s*\{[\s\S]*?word-break: keep-all;[\s\S]*?overflow-wrap: normal;/u);
  assert.match(styleSource, /@media \(max-width: 600px\)[\s\S]*?\.loading-cancel-button\s*\{[\s\S]*?min-height: 44px;/u);
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
