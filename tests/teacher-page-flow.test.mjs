import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../source/public-app.js", import.meta.url), "utf8");
const styleSource = readFileSync(new URL("../source/public-app.css", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../source/index.html", import.meta.url), "utf8");

test("교사용 화면은 상태기를 연결하고 현재 단계의 본문만 조건부로 표시한다", () => {
  assert.match(source, /from "\.\/teacher-step-flow\.js"/u);
  assert.match(source, /useReducer\(teacherStepFlowReducer, void 0, createInitialTeacherStepFlowState\)/u);
  assert.match(source, /isLessonSelection \?[\s\S]*?teacher-sample-library teacher-step-content/u);
  assert.match(source, /!isLessonSelection \?[\s\S]*?teacher-layout teacher-step-content/u);
  assert.match(source, /isActivityComposition \?[\s\S]*?className: "teacher-inquiry-flow"/u);
  assert.match(source, /isActivityComposition \?[\s\S]*?className: "teacher-data-workbench"/u);
  assert.match(source, /isReviewAndShare \?[\s\S]*?className: "teacher-review-brief"/u);
  assert.match(source, /isReviewAndShare \?[\s\S]*?className: "teacher-summary"/u);
});

test("수업 카드는 필수 비교 조건을 적용하고 수업 조건 단계로 자동 이동한다", () => {
  const start = source.indexOf("const applyTeacherSample = (sample) =>");
  const end = source.indexOf("const selectTeacherMapCoordinate", start);
  const applySource = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(applySource, /type: TEACHER_FLOW_ACTIONS\.SELECT_LESSON/u);
  assert.match(applySource, /lessonId: sample\.id/u);
  assert.match(applySource, /requirements: sample\.evidenceRequirements/u);
  assert.match(applySource, /type: TEACHER_FLOW_ACTIONS\.NEXT/u);
});

test("현재 조회 상태와 비교 자료를 최종 단계 잠금 상태에 동기화한다", () => {
  assert.match(source, /type: TEACHER_FLOW_ACTIONS\.SET_COMPARISON_MATERIALS,[\s\S]*?materials: comparisonPoints/u);
  assert.match(source, /resolveTeacherQueryStatus\(remoteState\.status, lessonMetrics, requiredTeacherMetricKeys\)/u);
  assert.match(source, /type: TEACHER_FLOW_ACTIONS\.SET_QUERY_STATUS,[\s\S]*?status: teacherQueryStatus/u);
  assert.match(source, /validateTeacherReviewReadiness\(teacherFlowState\)/u);
  assert.match(source, /messages: teacherReviewValidation\.errors\.map/u);
  assert.match(source, /disabled: !currentSnapshot \|\| teacherQueryStatus !== TEACHER_QUERY_STATUSES\.READY/u);
});

test("단계 통합 뒤에도 학생 링크와 자료 내보내기 및 DOCX 저장 계약을 유지한다", () => {
  assert.match(source, /const openStudentLesson = \(\) =>/u);
  assert.match(source, /const copyStudentLink = async \(\) =>/u);
  assert.match(source, /const exportTeacherData = \(\) =>/u);
  assert.match(source, /buildTeacherActivityDocx/u);
  assert.match(source, /filename: "climate-class-activity\.docx"/u);
  for (const label of ["학생 화면 열기", "학생용 링크 복사", "수업 자료 내보내기", "수업 활동지 저장"]) {
    assert.match(source, new RegExp(label, "u"));
  }
});

test("진행선과 이동 버튼은 좁은 화면에서도 고정된 열과 줄바꿈 규칙을 사용한다", () => {
  assert.match(styleSource, /\.teacher-step-progress ol\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/u);
  assert.match(styleSource, /\.teacher-step-progress li:not\(:last-child\)::after/u);
  assert.match(styleSource, /\.teacher-step-navigation\s*\{[\s\S]*?position: sticky;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) max-content minmax\(0, 1fr\)/u);
  assert.match(styleSource, /\.teacher-step-navigation button\s*\{[\s\S]*?white-space: normal/u);
  assert.match(styleSource, /@media \(max-width: 600px\)[\s\S]*?\.teacher-step-label small\s*\{[\s\S]*?display: none/u);
  assert.match(styleSource, /@media \(max-width: 380px\)[\s\S]*?\.teacher-step-navigation/u);
});

test("기존 학생 카드 정렬과 캐시 버스터 및 동적 자료판 전달을 보존한다", () => {
  assert.match(styleSource, /\.preset-grid button:not\(\.custom-preset\)/u);
  assert.match(indexSource, /public-app\.css\?v=20260714-card-height1/u);
  assert.match(indexSource, /public-app\.js\?v=20260713-chart6/u);
  assert.equal(source.match(/datasetVersion: metadata\?\.datasetVersion/gu)?.length, 3);
});

test("교사용 단계 문구와 접근성 레이블에는 내부 경로나 버전을 노출하지 않는다", () => {
  const copyStart = source.indexOf("const teacherStepCopy =");
  const copyEnd = source.indexOf("function TeacherPage", copyStart);
  const teacherCopySource = source.slice(copyStart, copyEnd);
  assert.match(teacherCopySource, /수업 선택|탐구 수업 선택/u);
  assert.match(teacherCopySource, /이전 단계로 이동|수업 만들기 단계 이동/u);
  assert.doesNotMatch(teacherCopySource, /(?:[A-Za-z]:[\\/]|\\\\|\/(?:source|tests|teacher)\b|datasetVersion|\bv?\d+\.\d+\.\d+\b)/u);
});
