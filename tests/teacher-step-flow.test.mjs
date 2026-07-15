import test from "node:test";
import assert from "node:assert/strict";
import {
  TEACHER_FLOW_ACTIONS,
  TEACHER_NAVIGATION_LABELS,
  TEACHER_QUERY_STATUSES,
  TEACHER_STEP_DEFINITIONS,
  TEACHER_STEP_IDS,
  canEnterTeacherStep,
  createTeacherStepFlowState,
  getTeacherStepNavigation,
  hasRequiredTeacherComparisonMaterials,
  teacherStepFlowReducer,
  validateTeacherLessonConditions,
  validateTeacherReviewReadiness
} from "../source/teacher-step-flow.js";

const validConditions = {
  date: "2050-08-01",
  title: "우리 지역의 미래 기후",
  objective: "기후 자료를 비교하고 근거와 한계를 설명한다.",
  location: { label: "학교", latitude: 37.57, longitude: 126.98 },
  scenario: "고배출 경로",
  model: "전체 앙상블"
};

const comparisonMaterial = (overrides = {}) => ({
  id: "school-2050",
  label: "학교",
  latitude: 37.57,
  longitude: 126.98,
  model: "전체 앙상블",
  ...overrides
});

function reduce(state, type, values = {}) {
  return teacherStepFlowReducer(state, { type, ...values });
}

function createConditionsStep(overrides = {}) {
  let state = createTeacherStepFlowState();
  state = reduce(state, TEACHER_FLOW_ACTIONS.SELECT_LESSON, { lessonId: "regional-heat" });
  state = reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
  state = reduce(state, TEACHER_FLOW_ACTIONS.UPDATE_CONDITIONS, {
    patch: { ...validConditions, ...overrides }
  });
  return state;
}

function createActivityStep() {
  let state = createConditionsStep();
  state = reduce(state, TEACHER_FLOW_ACTIONS.CONFIRM_DATE, { confirmed: true });
  return reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
}

test("유효한 입력은 네 단계를 순서대로 진행한다", () => {
  let state = createTeacherStepFlowState();
  state = reduce(state, TEACHER_FLOW_ACTIONS.SELECT_LESSON, { lessonId: "regional-heat" });
  state = reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
  assert.equal(state.currentStep, TEACHER_STEP_IDS.LESSON_CONDITIONS);

  state = reduce(state, TEACHER_FLOW_ACTIONS.UPDATE_CONDITIONS, { patch: validConditions });
  state = reduce(state, TEACHER_FLOW_ACTIONS.CONFIRM_DATE, { confirmed: true });
  state = reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
  assert.equal(state.currentStep, TEACHER_STEP_IDS.ACTIVITY_COMPOSITION);

  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_COMPARISON_MATERIALS, {
    materials: [comparisonMaterial()]
  });
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS, {
    status: TEACHER_QUERY_STATUSES.READY
  });
  state = reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
  assert.equal(state.currentStep, TEACHER_STEP_IDS.REVIEW_AND_SHARE);
  assert.equal(validateTeacherReviewReadiness(state).valid, true);
});

test("인접하지 않은 단계로 건너뛸 수 없다", () => {
  let state = createTeacherStepFlowState();
  state = reduce(state, TEACHER_FLOW_ACTIONS.SELECT_LESSON, { lessonId: "regional-heat" });
  state = reduce(state, TEACHER_FLOW_ACTIONS.GO_TO_STEP, {
    step: TEACHER_STEP_IDS.ACTIVITY_COMPOSITION
  });
  assert.equal(state.currentStep, TEACHER_STEP_IDS.LESSON_SELECTION);

  state = reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
  state = reduce(state, TEACHER_FLOW_ACTIONS.UPDATE_CONDITIONS, { patch: validConditions });
  state = reduce(state, TEACHER_FLOW_ACTIONS.CONFIRM_DATE, { confirmed: true });
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_COMPARISON_MATERIALS, {
    materials: [comparisonMaterial()]
  });
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS, {
    status: TEACHER_QUERY_STATUSES.READY
  });
  state = reduce(state, TEACHER_FLOW_ACTIONS.GO_TO_STEP, {
    step: TEACHER_STEP_IDS.REVIEW_AND_SHARE
  });
  assert.equal(state.currentStep, TEACHER_STEP_IDS.LESSON_CONDITIONS);
});

test("수업을 선택하기 전에는 수업 조건 단계로 이동할 수 없다", () => {
  const state = createTeacherStepFlowState();
  assert.equal(canEnterTeacherStep(state, TEACHER_STEP_IDS.LESSON_CONDITIONS), false);
  assert.equal(getTeacherStepNavigation(state).next.disabled, true);
  assert.equal(reduce(state, TEACHER_FLOW_ACTIONS.NEXT), state);
});

test("제목·목표·위치·시나리오·모델은 모두 유효해야 한다", () => {
  const invalidConditions = [
    ["title", "   "],
    ["objective", ""],
    ["location", { label: "학교", latitude: 91, longitude: 126.98 }],
    ["scenario", ""],
    ["model", ""]
  ];

  for (const [field, value] of invalidConditions) {
    let state = createConditionsStep({ [field]: value });
    state = reduce(state, TEACHER_FLOW_ACTIONS.CONFIRM_DATE, { confirmed: true });
    const validation = validateTeacherLessonConditions(state);
    assert.equal(validation.valid, false, `${field} 검증이 누락되었습니다.`);
    assert.ok(validation.errors.some((error) => error.field === field));
    assert.equal(canEnterTeacherStep(state, TEACHER_STEP_IDS.ACTIVITY_COMPOSITION), false);
  }
});

test("불완전하거나 실제로 존재하지 않는 날짜는 활동 구성 진입을 막는다", () => {
  let state = createConditionsStep({ date: "2050-08" });
  state = reduce(state, TEACHER_FLOW_ACTIONS.CONFIRM_DATE, { confirmed: true });
  assert.equal(validateTeacherLessonConditions(state).valid, false);
  assert.equal(canEnterTeacherStep(state, TEACHER_STEP_IDS.ACTIVITY_COMPOSITION), false);
  assert.equal(reduce(state, TEACHER_FLOW_ACTIONS.NEXT).currentStep, TEACHER_STEP_IDS.LESSON_CONDITIONS);

  state = reduce(state, TEACHER_FLOW_ACTIONS.UPDATE_CONDITIONS, { patch: { date: "2050-02-30" } });
  state = reduce(state, TEACHER_FLOW_ACTIONS.CONFIRM_DATE, { confirmed: true });
  assert.equal(validateTeacherLessonConditions(state).valid, false);
});

test("이전 단계로 돌아갔다가 다시 와도 입력과 비교 자료를 보존한다", () => {
  let state = createActivityStep();
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_COMPARISON_MATERIALS, {
    materials: [comparisonMaterial({ note: "첫 번째 비교 자료" })]
  });
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS, {
    status: TEACHER_QUERY_STATUSES.READY
  });
  const savedConditions = state.conditions;
  const savedMaterials = state.comparisonMaterials;

  state = reduce(state, TEACHER_FLOW_ACTIONS.PREVIOUS);
  assert.equal(state.currentStep, TEACHER_STEP_IDS.LESSON_CONDITIONS);
  assert.deepEqual(state.conditions, savedConditions);
  assert.deepEqual(state.comparisonMaterials, savedMaterials);

  state = reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
  assert.equal(state.currentStep, TEACHER_STEP_IDS.ACTIVITY_COMPOSITION);
  assert.deepEqual(state.conditions, savedConditions);
  assert.deepEqual(state.comparisonMaterials, savedMaterials);
});

test("비교 자료와 실제 조회 성공이 모두 갖춰져야 최종 단계 잠금이 해제된다", () => {
  let state = createActivityStep();
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS, {
    status: TEACHER_QUERY_STATUSES.LOADING
  });
  assert.equal(canEnterTeacherStep(state, TEACHER_STEP_IDS.REVIEW_AND_SHARE), false);
  assert.equal(getTeacherStepNavigation(state).next.disabled, true);

  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_COMPARISON_MATERIALS, {
    materials: [comparisonMaterial()]
  });
  assert.equal(canEnterTeacherStep(state, TEACHER_STEP_IDS.REVIEW_AND_SHARE), false);

  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS, {
    status: TEACHER_QUERY_STATUSES.READY
  });
  assert.equal(canEnterTeacherStep(state, TEACHER_STEP_IDS.REVIEW_AND_SHARE), true);
  assert.equal(getTeacherStepNavigation(state).next.disabled, false);
});

test("조회 조건을 바꾸면 이전 조회 성공을 무효화하고 최종 단계 잠금을 복원한다", () => {
  let state = createActivityStep();
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_COMPARISON_MATERIALS, {
    materials: [comparisonMaterial()]
  });
  state = reduce(state, TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS, {
    status: TEACHER_QUERY_STATUSES.READY
  });
  state = reduce(state, TEACHER_FLOW_ACTIONS.NEXT);
  assert.equal(state.currentStep, TEACHER_STEP_IDS.REVIEW_AND_SHARE);

  state = reduce(state, TEACHER_FLOW_ACTIONS.UPDATE_CONDITIONS, {
    patch: { model: "다른 기후 모델" }
  });
  assert.equal(state.queryStatus, TEACHER_QUERY_STATUSES.IDLE);
  assert.equal(state.currentStep, TEACHER_STEP_IDS.ACTIVITY_COMPOSITION);
  assert.equal(canEnterTeacherStep(state, TEACHER_STEP_IDS.REVIEW_AND_SHARE), false);
});

test("수업별 필수 지점·모델·여러 모델 종합값을 모두 충족해야 한다", () => {
  const requirements = { minimumSites: 2, minimumModels: 2, includeEnsemble: true };
  const first = comparisonMaterial();
  const secondSiteSameModel = comparisonMaterial({ id: "coast-2050", latitude: 35.18, longitude: 129.08 });
  const secondModel = comparisonMaterial({ id: "coast-model", latitude: 35.18, longitude: 129.08, model: "개별 기후 모델" });

  assert.equal(hasRequiredTeacherComparisonMaterials([first], requirements), false);
  assert.equal(hasRequiredTeacherComparisonMaterials([first, secondSiteSameModel], requirements), false);
  assert.equal(hasRequiredTeacherComparisonMaterials([first, secondModel], requirements), true);
});

test("단계와 이동 제어의 접근성 레이블은 한국어이며 내부 경로나 버전을 노출하지 않는다", () => {
  const visibleLabels = JSON.stringify({
    steps: TEACHER_STEP_DEFINITIONS.map(({ label, ariaLabel }) => ({ label, ariaLabel })),
    navigation: TEACHER_NAVIGATION_LABELS
  });
  assert.match(visibleLabels, /수업 선택/u);
  assert.match(visibleLabels, /확인 및 공유/u);
  assert.match(visibleLabels, /이전 단계로 이동/u);
  assert.doesNotMatch(visibleLabels, /(?:[A-Za-z]:[\\/]|\\\\|\/(?:source|tests|teacher)\b|\bv?\d+\.\d+\.\d+\b)/u);
});
