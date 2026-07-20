import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../source/public-app.js", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../source/public-app.css", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("../source/public/sw.js", import.meta.url), "utf8");
const viteConfigSource = await readFile(new URL("../source/vite.config.js", import.meta.url), "utf8");
const productionPolicyVerifierSource = await readFile(new URL("../scripts/verify-production-data-policy.mjs", import.meta.url), "utf8");
const pretendardLicense = await readFile(new URL("../source/public/Pretendard-LICENSE.txt", import.meta.url), "utf8");
const runtimeConfig = JSON.parse(await readFile(new URL("../source/public/runtime-config.json", import.meta.url), "utf8"));
const productionDataPolicy = JSON.parse(await readFile(new URL("../config/production-data-policy.json", import.meta.url), "utf8"));

test("해시 기반 Web UI는 미등록 경로를 index로 우회하지 않는다", () => {
  assert.match(viteConfigSource, /appType: "mpa"/u);
});

test("한글 화면 글꼴과 배포 허가문을 함께 제공한다", () => {
  assert.match(styleSource, /@import "pretendard\/dist\/web\/variable\/pretendardvariable\.css"/u);
  assert.match(pretendardLicense, /SIL OPEN FONT LICENSE Version 1\.1/u);
  assert.match(pretendardLicense, /Reserved Font Name 'Pretendard'/u);
});

function createServiceWorkerHarness() {
  const listeners = new Map();
  const calls = { cache: 0, network: 0, respondWith: 0 };
  const context = {
    URL,
    Promise,
    self: {
      location: { href: "https://climate.example/sw.js" },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener(type, listener) {
        listeners.set(type, listener);
      }
    },
    caches: {
      async open() {
        calls.cache += 1;
        return { addAll: async () => {}, put: async () => {} };
      },
      async keys() {
        calls.cache += 1;
        return [];
      },
      async delete() {
        calls.cache += 1;
      },
      async match() {
        calls.cache += 1;
      }
    },
    async fetch() {
      calls.network += 1;
      return { ok: true, clone() { return this; } };
    }
  };
  runInNewContext(serviceWorkerSource, context);
  return { calls, fetchListener: listeners.get("fetch") };
}

test("프리셋에는 합성 기후 수치가 들어가지 않는다", () => {
  const presetStart = source.indexOf("const queryPresets = [");
  const presetEnd = source.indexOf("function routeFromHash", presetStart);
  const presetSource = source.slice(presetStart, presetEnd);
  assert.ok(presetStart >= 0 && presetEnd > presetStart);
  assert.doesNotMatch(presetSource, /\bmetrics\s*:/u);
  assert.doesNotMatch(presetSource, /\bvalue\s*:/u);
});

test("한글 CSV는 UTF-8 표식과 출처 자료를 묶어 저장한다", () => {
  assert.match(source, /buildAttributionBundle\(\{/u);
  assert.match(source, /csv: `\\uFEFF\$\{buildClimateCsv\(response\)\}`/u);
  assert.match(source, /filename: `\$\{stem\}\.zip`/u);
  assert.match(source, /datasetVersion: response\.datasetVersion/u);
  assert.match(source, /datasetUpdatedAt: response\.datasetUpdatedAt/u);
});

test("기간 자료의 모든 내보내기 형식은 출처 정보와 원본 기상청 표장을 포함한다", () => {
  assert.match(source, /buildInteractiveClimateHtml\(response, await buildInteractiveAttributionPayload\(response\)\)/u);
  assert.match(source, /buildClimatePdfBlob\(canvas, response\)/u);
  assert.match(source, /await drawKmaAttributionMarks\(context, response, width\)/u);
  assert.match(source, /loadImageAsset\("\.\/assets\/licenses\/kma_mark_1\.png"\)/u);
  assert.match(source, /loadImageAsset\("\.\/assets\/licenses\/kma_mark_2\.png"\)/u);
  assert.match(source, /Image as ImageIcon/u);
  assert.match(source, /const image = new window\.Image\(\)/u);
  assert.doesNotMatch(source, /const image = new Image\(\)/u);
  assert.match(source, /CSV·출처 문서·원본 표장/u);
});

test("배포 검증기는 검토된 공개 출처만 허용하고 비공개 저장소 위치 차단을 유지한다", () => {
  const allowlistStart = productionPolicyVerifierSource.indexOf("const ALLOWED_PUBLIC_ARTIFACT_URL_PATTERNS");
  const allowlistEnd = productionPolicyVerifierSource.indexOf("]);", allowlistStart);
  const allowlistSource = productionPolicyVerifierSource.slice(allowlistStart, allowlistEnd);
  assert.match(allowlistSource, /github\\\.com\\\/fallingenie\\\/CTC_Latte_WebUI/u);
  assert.match(allowlistSource, /www\\\.data\\\.go\\\.kr\\\/data/u);
  assert.doesNotMatch(allowlistSource, /drive\\\.google|storage\\\.googleapis|gs:/iu);
  assert.match(productionPolicyVerifierSource, /label: "Google Drive 주소"/u);
  assert.match(productionPolicyVerifierSource, /label: "GCS 주소"/u);
  assert.match(productionPolicyVerifierSource, /label: "공개 저장소 주소"/u);
});

test("학생 탐구 카드는 제목과 설명의 시작선을 같은 높이로 유지한다", () => {
  assert.match(
    styleSource,
    /\.preset-grid button:not\(\.custom-preset\)\s*\{[\s\S]*grid-template-rows:\s*minmax\(36px, auto\)\s+minmax\(30px, auto\);[\s\S]*align-content:\s*start;[\s\S]*align-items:\s*start;[\s\S]*min-height:\s*94px;/u
  );
  assert.match(
    styleSource,
    /\.preset-grid button:not\(\.custom-preset\) > span:not\(\.preset-icon\),\s*\.preset-grid button:not\(\.custom-preset\) > small\s*\{\s*align-self:\s*start;/u
  );
});

test("학생과 교사 문제는 하나의 기후 모델 자료 문제 모음에서 구성된다", () => {
  assert.match(source, /import \{ climateProblemSets \} from "\.\/climate-problem-catalog\.js"/u);
  assert.match(source, /const teacherLessonSamples = climateProblemSets\.map/u);
  assert.match(source, /\.\.\.climateProblemSets\.map\(problemToPreset\)/u);
  assert.match(source, /function StudentProblemBrief\(\{ mysteryGuess, mysteryRevealed, onOpenPeriod, problem \}\)/u);
  assert.match(source, /function TeacherLessonBlueprint\(\{ onOpenPeriod, sample \}\)/u);
  assert.match(source, /initialStartDate: period\.start/u);
  assert.match(source, /initialEndDate: period\.end/u);
  assert.match(source, /seasonMonths: period\.seasonMonths/u);
  assert.doesNotMatch(source, /appendDerivedClimateMetrics|diurnalRange/u);
  assert.match(source, /selectClimateSeriesMetrics\(displayPayload, selectedMetrics\)/u);
  assert.match(source, /filterClimateSeriesByMonths\(displayPayload, context\.seasonMonths\)/u);
  assert.match(source, /activeTeacherSample\.evidenceRequirements\.minimumModels/u);
  assert.match(source, /comparisonPeriods: activeTeacherSample\?\.comparisonPeriods/u);
  assert.match(source, /isMatchingClimateSeriesResponse\(payload/u);
  assert.match(source, /metadata\?\.scenarios\?\.length/u);
  assert.match(source, /실제 기후 자료로 확인한 수업 문제를 불러왔습니다/u);
  assert.doesNotMatch(source, /문제을 적용했습니다/u);
});

test("위치 추리 문제는 정답 공개 전 좌표와 내보내기를 가린다", () => {
  assert.match(source, /function MysteryLocationPanel/u);
  assert.match(source, /const locationConcealed = Boolean/u);
  assert.match(source, /disabled: !hasExportableMetrics \|\| locationConcealed/u);
  assert.match(source, /locationConcealed \|\| !hasCurrentDatasetResult \? undefined : exportMetric/u);
  assert.match(source, /정답을 확인하면 위치와 자료가 포함된 탐구 기록을 저장할 수 있습니다/u);
});

test("자유 조회는 문제 모음과 별개로 날짜·좌표·배출 경로·기후 모델을 선택할 수 있다", () => {
  assert.match(source, /id: "custom"/u);
  assert.match(source, /const initialPreset = queryPresets\.find\(\(preset\) => preset\.id === "custom"\)/u);
  assert.match(source, /jsx\(CoordinateInput, \{ label: "위도"/u);
  assert.match(source, /jsx\(CoordinateInput, \{ label: "경도"/u);
  assert.match(source, /"배출 경로"/u);
  assert.match(source, /"기후 모델"/u);
  assert.match(source, /setSelectedPresetId\("custom"\)/u);
});

test("문제에서 허용한 좌표 변경은 입력 확인 뒤에도 같은 탐구 문제를 유지한다", () => {
  const confirmStart = source.indexOf("const confirmQuery = () => {");
  const confirmEnd = source.indexOf("const exportMetric", confirmStart);
  const confirmSource = source.slice(confirmStart, confirmEnd);
  assert.match(confirmSource, /activePreset\.problemSetId && activePreset\.allowCustomLocation \? activePreset\.id : "custom"/u);
});

test("같은 학생 화면에서 다른 수업 링크를 열어도 조건을 다시 적용한다", () => {
  assert.match(source, /window\.addEventListener\("hashchange", applySharedLesson\)/u);
  assert.match(source, /window\.removeEventListener\("hashchange", applySharedLesson\)/u);
  assert.match(source, /setRaw\(problemPreset\?\.raw \?\? false\)/u);
  assert.match(source, /setComparisonBaseline\(void 0\)/u);
});

test("사용자 화면을 바꾸면 이전 화면의 스크롤 위치를 이어받지 않는다", () => {
  assert.match(source, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\);/u);
  assert.match(source, /\}, \[route\]\);/u);
});

test("교사용 비교 근거는 필요한 경우 여러 모델 종합값을 반드시 포함한다", () => {
  assert.match(source, /const hasRequiredEnsemble = !requiredEvidence\.includeEnsemble \|\| comparisonPoints\.some\(\(point\) => point\.model === "전체 앙상블"\)/u);
  assert.match(source, /&& hasRequiredEnsemble/u);
  assert.match(source, /여러 모델 종합값 함께 확인/u);
});

test("PNG와 PDF 그래프도 계절 사이의 긴 날짜 공백을 이어 그리지 않는다", () => {
  assert.match(source, /drawCanvasBand\(context, response\.dates, indexes/u);
  assert.match(source, /drawCanvasLine\(context, response\.dates, indexes/u);
  assert.match(source, /isContinuousSampledDateRange\(dates, previousIndex, index\)/u);
});

test("기간 자료의 체감 지표는 월에 따라 열지수와 체감기온을 구분해 표시한다", () => {
  assert.match(source, /label: apparentTemperatureSeriesLabel\(response\.dates\)/u);
  assert.match(source, /function apparentTemperatureSeriesLabel\(dates\)/u);
  assert.match(source, /return labels\.length === 1 \? labels\[0\] : "열지수·체감기온"/u);
});

test("PNG와 PDF의 긴 탐구 문장은 폭에 맞춰 여러 줄로 그린다", () => {
  assert.match(source, /function climateReportHeaderLayout/u);
  assert.match(source, /const headerHeight = headerLayout\.headerHeight/u);
  assert.match(source, /function drawWrappedCanvasText/u);
  assert.match(source, /context\.measureText\(candidate\)\.width <= maxWidth/u);
  assert.match(source, /function splitOversizedCanvasWord/u);
  assert.match(source, /drawWrappedCanvasText\(context, response\.exploration\.question/u);
  assert.match(source, /drawWrappedCanvasText\(context, `해석할 때 주의할 점:/u);
  assert.doesNotMatch(source, /exploration\.(?:title|question|interpretationLimit)[\s\S]{0,80}\.slice\(0,/u);
});

test("결측 상태는 예시값 대신 명시적인 비가용 상태를 쓴다", () => {
  assert.match(source, /value: waiting \? "조회 중" : "자료 없음"/u);
  assert.match(source, /available: false/u);
});

test("공개 앱은 허용된 실제자료 API 경로만 사용한다", () => {
  assert.match(source, /import \{[\s\S]*?\bvalidatePublicRuntimeConfig\b[\s\S]*?\} from "\.\/runtime-policy\.js"/u);
  assert.doesNotMatch(source, /drive\.google\.com|googleapis\.com\/drive|\.ctwebui|\.ctcapsule/iu);
});

test("기본 배포 설정은 로컬 동일 출처를 유지하고 공개 배포 정책은 Pages와 읽기 전용 클라우드를 선언한다", () => {
  assert.deepEqual(Object.keys(runtimeConfig).sort(), ["publicSafe", "readPath", "sourcePolicy", "timeoutMs"]);
  assert.equal(runtimeConfig.readPath, "/api/climate/query");
  assert.equal(runtimeConfig.publicSafe, true);
  assert.equal(runtimeConfig.sourcePolicy, "cloud-only");
  assert.equal(productionDataPolicy.schemaVersion, 4);
  assert.equal(productionDataPolicy.sourcePolicy, "cloud-only");
  assert.deepEqual(productionDataPolicy.allowedProviders, ["gcs"]);
  assert.deepEqual(productionDataPolicy.queryOrder, ["prepared-web-data", "raw-cmip6"]);
  assert.deepEqual(productionDataPolicy.routes, {
    "prepared-web-data": { provider: "gcs", role: "primary" },
    "raw-cmip6": { provider: "gcs", role: "coverage-fallback" }
  });
  assert.equal(productionDataPolicy.localFilesystemSourceAllowed, false);
  assert.equal(Object.hasOwn(productionDataPolicy, "verifiedEphemeralCacheAllowed"), false);
  assert.equal(productionDataPolicy.browserStorageLocatorExposure, false);
  assert.deepEqual(productionDataPolicy.delivery, {
    frontend: "github-pages",
    queryApi: "public-read-only-cloud-run",
    preparedData: "public-object-read-only-gcs",
    anonymousWriteAllowed: false
  });
});

test("학생 공유 링크에는 개발용 검색 매개변수를 포함하지 않는다", () => {
  assert.match(source, /const url = new URL\(window\.location\.href\);\s+url\.search = "";/u);
});

test("학생 기록과 교사 활동지는 모두 DOCX로 저장한다", () => {
  assert.match(source, /buildStudentNotebookDocx/u);
  assert.match(source, /buildTeacherActivityDocx/u);
  assert.match(source, /filename: "climate-exploration-note\.docx"/u);
  assert.match(source, /filename: "climate-class-activity\.docx"/u);
  assert.doesNotMatch(source, /climate-class-activity\.txt|mimeType: "text\/plain"/u);
});

test("배포 셸은 코드 자산을 네트워크에서 먼저 갱신한다", () => {
  assert.match(serviceWorkerSource, /climate-web-shell-v18/u);
  assert.match(serviceWorkerSource, /\["script", "style", "worker"\]\.includes\(request\.destination\)/u);
  assert.match(serviceWorkerSource, /fetch\(request\)[\s\S]*caches\.match\(request\)/u);
  assert.match(source, /updateViaCache: "none"/u);
});

test("실제 기후 자료 API는 서비스 워커 캐시에 저장하지 않는다", () => {
  assert.match(serviceWorkerSource, /url\.pathname\.startsWith\("\/api\/climate\/"\)\) return;/u);
  const apiBypass = serviceWorkerSource.indexOf('url.pathname.startsWith("/api/climate/")');
  const cacheLookup = serviceWorkerSource.indexOf("caches.match(request)");
  assert.ok(apiBypass >= 0 && apiBypass < cacheLookup);

  const { calls, fetchListener } = createServiceWorkerHarness();
  assert.equal(typeof fetchListener, "function");
  for (const endpoint of ["query", "series", "metadata"]) {
    fetchListener({
      request: {
        method: "GET",
        url: `https://climate.example/api/climate/${endpoint}`,
        mode: "cors",
        destination: ""
      },
      respondWith() {
        calls.respondWith += 1;
      }
    });
  }
  assert.deepEqual(calls, { cache: 0, network: 0, respondWith: 0 });
});

test("공개 앱은 창 재활성화와 저빈도 주기로 자료 버전을 다시 확인한다", () => {
  const monitorStart = source.indexOf("function usePublicDatasetMetadata()");
  const monitorEnd = source.indexOf("function App()", monitorStart);
  const monitorSource = source.slice(monitorStart, monitorEnd);
  assert.ok(monitorStart >= 0 && monitorEnd > monitorStart);
  assert.match(monitorSource, /fetchPublicClimateMetadata\(\{ signal: controller\.signal \}\)\.then\(validatePublicDatasetMetadata\)/u);
  assert.match(monitorSource, /window\.addEventListener\("focus", onFocus\)/u);
  assert.match(monitorSource, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/u);
  assert.match(monitorSource, /document\.visibilityState === "visible"/u);
  assert.match(monitorSource, /PUBLIC_DATASET_REFRESH_INTERVAL_MS/u);
  assert.match(monitorSource, /navigator\.onLine === false/u);
  assert.match(monitorSource, /refreshSequence: changed \? current\.refreshSequence \+ 1 : current\.refreshSequence/u);
  assert.match(monitorSource, /const requestRefresh = useCallback/u);
  assert.match(monitorSource, /\{ force = false, initial = false \}/u);
  assert.match(monitorSource, /createPublicMetadataRefreshQueue\(performMetadataCheck\)/u);
  assert.match(monitorSource, /refreshQueue\.hasInFlight\(\)/u);
  assert.match(monitorSource, /refreshQueue\.request\(\{ force \}\)/u);
  assert.match(monitorSource, /return useMemo\(\(\) => \(\{ \.\.\.datasetState, requestRefresh \}\)/u);
});

test("게이트웨이 메타데이터가 없으면 긴 원자료 조회를 시작하지 않고 즉시 오류로 전환한다", () => {
  assert.match(source, /PUBLIC_CLIMATE_METADATA_TIMEOUT_MS/u);
  assert.match(source, /replaceEndpoint\(config\.readPath, "metadata"\)[\s\S]{0,160}PUBLIC_CLIMATE_METADATA_TIMEOUT_MS/u);
  assert.equal(source.match(/datasetStatus: datasetState\.status/gu)?.length, 3);
  const hookStart = source.indexOf("function useRemoteMetricResponse");
  const hookEnd = source.indexOf("function buildUiRemoteChunkRequest", hookStart);
  const hookSource = source.slice(hookStart, hookEnd);
  assert.match(hookSource, /datasetStatus === "unavailable"/u);
  assert.match(hookSource, /status: "error"/u);
  assert.match(hookSource, /현재 기후자료 연결을 확인할 수 없습니다\. 잠시 후 다시 시도하세요\./u);
  assert.ok(hookSource.indexOf('datasetStatus === "unavailable"') < hookSource.indexOf("fetchPublicClimateQuery(request"));
});

test("학생·교사·일반 조회는 같은 자료 버전에 고정되고 변경 시 자동 재조회한다", () => {
  assert.equal(source.match(/refreshSequence: datasetState\.refreshSequence/gu)?.length, 3);
  assert.equal(source.match(/datasetVersion: metadata\?\.datasetVersion/gu)?.length, 3);
  assert.match(source, /buildUiRemoteChunkRequest\(\{ coordinate, date, scenario, model, datasetVersion \}\)/u);
  assert.match(source, /\.\.\.\(datasetVersion \? \{ datasetVersion \} : \{\}\)/u);
  assert.match(source, /isMatchingPublicDatasetIdentity\(response, request\.datasetVersion, expectedUpdatedAt\)/u);
  assert.match(source, /fetchPublicClimateSeries\(seriesRequest, \{ signal: controller\.signal \}\)/u);
  assert.match(source, /isMatchingPublicDatasetIdentity\(payload, seriesRequest\.datasetVersion, metadata\?\.datasetUpdatedAt\)/u);
  assert.match(source, /expectedDataModeRef\.current = undefined/u);
  assert.match(source, /dataMode: datasetRefresh \? undefined : expectedDataModeRef\.current/u);
  assert.match(source, /includeRaw: datasetRefresh \? undefined : seriesRequest\.includeRaw/u);
  assert.match(source, /expectedDataModeRef\.current = payload\.dataMode/u);
  assert.match(source, /setIncludeRaw\(payload\.includeRaw\)/u);
  assert.match(source, /observedDialogDatasetVersionRef/u);
  assert.match(source, /completedRefreshSequenceRef/u);
  assert.match(source, /controllerRef\.current\?\.abort\(\)/u);
  assert.equal(source.match(/requestDatasetRefresh: datasetState\.requestRefresh/gu)?.length, 3);
  assert.match(source, /requestDatasetRefresh\(\{ force: true \}\)/u);
  assert.match(source, /isPublicDatasetIdentityChange\(\{ datasetVersion, datasetUpdatedAt \}, nextMetadata\)/u);
  assert.match(source, /기후자료가 갱신되어 같은 조건의 결과를 다시 불러오고 있습니다/u);
  assert.match(source, /datasetState\.requestRefresh\(\{ force: true \}\)/u);
  assert.match(source, /기후자료가 갱신되어 같은 조건의 기간 결과를 다시 불러오고 있습니다/u);
  assert.match(source, /isCurrentPublicDatasetResult\(remoteState\.response, metadata, remoteState\.status\)/u);
  assert.match(source, /disabled: !hasCurrentPreview \|\| busy/u);
  assert.match(source, /cancelledConditionRef\.current === conditionKey/u);
});

test("자료 갱신 실패는 같은 조건의 기존 결과를 유지하고 내부 식별자를 안내하지 않는다", () => {
  const messageStart = source.indexOf("function datasetBasisDateSuffix");
  const messageEnd = source.indexOf("const metricOptions", messageStart);
  const messageSource = source.slice(messageStart, messageEnd);
  const hookStart = source.indexOf("function useRemoteMetricResponse");
  const hookEnd = source.indexOf("function buildUiRemoteChunkRequest", hookStart);
  const hookSource = source.slice(hookStart, hookEnd);
  assert.match(hookSource, /retainForVersionTransition && current\.conditionKey === conditionKey && current\.response/u);
  assert.match(hookSource, /Boolean\(datasetVersion && versionTransition\)/u);
  assert.match(hookSource, /datasetRefreshFailedMessage\(datasetUpdatedAt, Boolean\(retainResponse\)\)/u);
  assert.match(messageSource, /새 기후자료가 준비되어 결과를 다시 불러왔습니다/u);
  assert.match(messageSource, /자료 기준일:/u);
  assert.doesNotMatch(messageSource, /datasetVersion|drive\.google|storage\.googleapis|gcs|\.nc\b|\.zarr\b|sha-?256/iu);
});

test("원자료 조회 중에는 보정 관측지 부재와 대기 방법을 안내한다", () => {
  assert.match(source, /선택한 위치 주변에 보정에 사용할 관측소가 없어 기후 모델 원자료를 읽고 있습니다/u);
  assert.match(source, /조회가 끝날 때까지 새로고침하거나 창을 닫지 마세요/u);
  assert.doesNotMatch(source, /원본 기후모델 격자를 읽는 위치는/u);
});

test("조회 취소는 진행 중인 요청을 중단하고 취소 상태를 남긴다", () => {
  assert.match(source, /function ClimateLoadingOverlay\(\{ onCancel \}\)/u);
  assert.match(source, /className: "loading-cancel-button", onClick: onCancel/u);
  assert.match(source, /fetchPublicClimateQuery\(request, \{ signal: controller\.signal \}\)/u);
  assert.match(source, /controllerRef\.current\?\.abort\(\)/u);
  assert.match(source, /status: "cancelled"/u);
  assert.match(source, /message: "자료 불러오기를 취소했습니다\. 조건을 바꾸면 다시 시작합니다\."/u);
});

test("원자료 미완결 응답은 한 번만 자동 재시도하고 고정 안내로 끝낸다", () => {
  assert.match(source, /RETRYABLE_CLIMATE_REQUEST_ATTEMPTS = 2/u);
  assert.match(source, /response\.status === 503/u);
  assert.match(source, /validatePublicClimateRetryableError/u);
  assert.match(source, /잠시 후 같은 조건으로 다시 시도하세요/u);
  assert.doesNotMatch(source, /window\.location\.reload/u);
});

test("학생·교사 화면에는 설명 없는 내부 용어를 노출하지 않는다", () => {
  const sanitizerStart = source.indexOf("function toAudienceClimateCopy");
  const sanitizerEnd = source.indexOf("function deriveClimateMetrics", sanitizerStart);
  const userFacingSource = `${source.slice(0, sanitizerStart)}${source.slice(sanitizerEnd)}`;
  assert.doesNotMatch(userFacingSource, /대조\s*격자|원자료\s*격자|격자값|미세기후|미기후|불투수면|도시 협곡|토지피복|불투수율|가운데 값|비교 기준일|증감률|하루 온도 폭/u);
  assert.match(source, /function toAudienceClimateCopy/u);
  assert.match(source, /replace\(\/원자료\\s\*격자값\/gu, "원자료"\)/u);
  assert.match(source, /replace\(\/앙상블\\s\*중간값\/gu, "여러 모델의 중간값"\)/u);
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
  const publicPageStart = source.indexOf("function PublicPage(");
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
