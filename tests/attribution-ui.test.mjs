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

test("공통 제목행은 정적 CMIP6 인용만 표시하고 관측자료 사용 여부를 추정하지 않는다", () => {
  assert.match(appSource, /function SourceCitationDisclosure/u);
  assert.match(appSource, /jsx\(SourceCitationDisclosure, \{ metadata \}\)/u);
  assert.match(appSource, /CMIP6\/downscaleCMIP6 자료 출처/u);
  assert.match(appSource, /실제 사용된 관측자료 출처는 각 조회 결과에 표시됩니다/u);
  assert.doesNotMatch(appSource, /대한민국 기상청|\bKMA\b|\bASOS\b|kma_mark_|data\.go\.kr/u);
  assert.match(styleSource, /\.topbar-eyebrow-row\s*\{[\s\S]*?justify-content: space-between/u);
});

test("관측자료 패널은 canonical query와 series 응답의 실제 provider만 표시한다", () => {
  assert.match(appSource, /function canonicalObservationAttributionForResult\(response\)/u);
  assert.match(appSource, /validatePublicObservationAttribution\(response\?\.observationAttribution\)/u);
  assert.match(appSource, /function ObservationAttributionPanel\(\{ response \}\)/u);
  assert.match(appSource, /observationAttribution\.providers\.map\(\(provider\)/u);
  assert.match(appSource, /provider\.name/u);
  assert.match(appSource, /provider\.dataset/u);
  assert.match(appSource, /provider\.attributionText/u);
  assert.match(appSource, /provider\.citation/u);
  assert.match(appSource, /provider\.licenseUrl \?/u);
  assert.match(appSource, /resolveVerifiedObservationMarkAssets\(observationAttribution\)/u);
  assert.match(appSource, /src: asset\.sourceUrl/u);
  assert.ok((appSource.match(/jsx\(ObservationAttributionPanel, \{ response(?:: remoteState\.response)? \}\)/gu) ?? []).length >= 4);
  assert.match(styleSource, /\.observation-attribution-panel\s*\{/u);
  assert.match(styleSource, /\.observation-provider-marks img\s*\{/u);
});

test("raw 결과는 canonical 무관측 record로 준비 상태를 통과하고 provider와 mark를 만들지 않는다", () => {
  const canonicalStart = appSource.indexOf("function canonicalObservationAttributionForResult");
  const canonicalEnd = appSource.indexOf("function ObservationAttributionPanel", canonicalStart);
  const canonicalSource = appSource.slice(canonicalStart, canonicalEnd);
  assert.ok(canonicalStart >= 0 && canonicalEnd > canonicalStart);
  assert.match(canonicalSource, /response\?\.dataMode === "raw-model-grid"[\s\S]*?response\.attributionReady === false/u);
  assert.match(canonicalSource, /observationAttribution\.usesObservationData === false/u);
  assert.match(canonicalSource, /observationAttribution\.providerIds\.length === 0/u);
  assert.match(canonicalSource, /observationAttribution\.providers\.length === 0/u);
  assert.match(appSource, /const hasAttribution = canonicalObservationAttributionForResult\(response\) !== undefined/u);
  assert.doesNotMatch(appSource, /const hasAttribution = response\.attributionReady/u);
  assert.match(appSource, /if \(!observationAttribution\?\.usesObservationData\) return null/u);
  assert.match(appSource, /if \(!observationAttribution\.usesObservationData\) return;/u);
});

test("모든 기간 export와 DOCX snapshot은 series 또는 query의 canonical 관측 출처 record를 전달한다", () => {
  assert.match(appSource, /buildAttributionBundle\(\{[\s\S]*?observationAttribution: response\.observationAttribution/u);
  assert.match(appSource, /buildCsvWorkspaceShareFiles\(blob, csvBlob, csvSpecification, response\.observationAttribution\)/u);
  assert.match(appSource, /buildPublicExportAttribution\(\{[\s\S]*?observationAttribution: response\.observationAttribution/u);
  assert.match(appSource, /resolveVerifiedObservationMarkAssets\(response\.observationAttribution\)/u);
  assert.match(appSource, /verifyLocalObservationMarkAssetBytes\(asset, await response\.arrayBuffer\(\)\)/u);
  assert.match(appSource, /name: asset\.name,[\s\S]*?dataUrl: await imageAssetDataUrl\(asset\)/u);
  assert.match(appSource, /function withSnapshotObservationAttribution\(snapshot, response\)[\s\S]*?dataMode: response\.dataMode,[\s\S]*?observationAttribution/u);
  assert.equal(appSource.match(/withSnapshotObservationAttribution\(/gu)?.length, 3);
  assert.match(appSource, /buildStudentNotebookDocx\(\{[\s\S]*?baseline: comparisonBaseline \?\? currentSnapshot/u);
  assert.match(appSource, /buildTeacherActivityDocx\(\{[\s\S]*?snapshots/u);
});

test("유효하지 않은 custom lesson 편집은 builder를 호출하지 않고 공유 준비 상태가 되지 않는다", () => {
  const validationIndex = appSource.indexOf("const customLessonValidation = useMemo");
  const builderIndex = appSource.indexOf("const sample = buildCustomTeacherLessonSample", validationIndex);
  assert.ok(validationIndex >= 0 && builderIndex > validationIndex);
  assert.match(appSource.slice(validationIndex, builderIndex), /if \(!customLessonValidation\.valid\) return lastValidCustomTeacherSampleRef\.current/u);
  assert.equal(appSource.match(/buildCustomTeacherLessonSample\(/gu)?.length, 1);
  assert.match(appSource, /const customLessonErrors = isCustomTeacherLesson \? \[\.\.\.customLessonValidation\.errors/u);
  assert.match(appSource, /const customLessonReadyForShare = isCustomTeacherLesson && teacherConditionValidation\.valid/u);
  assert.match(appSource, /const teacherShareBlocked = isCustomTeacherLesson && !customLessonReadyForShare/u);
  assert.match(appSource, /customLesson: customLessonReadyForShare \? customLessonSharePayload\(activeTeacherSample\) : undefined/u);
  assert.match(appSource, /const copyStudentLink = async \(\) => \{[\s\S]*?if \(teacherShareBlocked\)[\s\S]*?return;/u);
  assert.match(appSource, /disabled: !started \|\| teacherShareBlocked/u);
});

test("제작자와 GitHub 정보는 고정되지 않은 공통 하단에 한 번만 표시한다", () => {
  assert.equal(appSource.match(/jsx\(SiteFooter, \{ datasetVersion: datasetState\.metadata\?\.datasetVersion \}\)/gu)?.length, 1);
  assert.match(appSource, /function SiteFooter/u);
  assert.match(appSource, /creator\.displayName/u);
  assert.match(appSource, /creator\.githubHandle/u);
  assert.match(appSource, /ctwebui 자료판/u);
  assert.match(appSource, /datasetVersion\.slice\(0, 12\)/u);
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
