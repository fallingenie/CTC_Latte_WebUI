export const TEACHER_STEP_IDS = Object.freeze({
  LESSON_SELECTION: "lesson-selection",
  LESSON_CONDITIONS: "lesson-conditions",
  ACTIVITY_COMPOSITION: "activity-composition",
  REVIEW_AND_SHARE: "review-and-share"
});

export const TEACHER_STEP_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: TEACHER_STEP_IDS.LESSON_SELECTION,
    label: "수업 선택",
    ariaLabel: "1단계: 수업 선택"
  }),
  Object.freeze({
    id: TEACHER_STEP_IDS.LESSON_CONDITIONS,
    label: "수업 조건",
    ariaLabel: "2단계: 수업 조건"
  }),
  Object.freeze({
    id: TEACHER_STEP_IDS.ACTIVITY_COMPOSITION,
    label: "활동 구성",
    ariaLabel: "3단계: 활동 구성"
  }),
  Object.freeze({
    id: TEACHER_STEP_IDS.REVIEW_AND_SHARE,
    label: "확인 및 공유",
    ariaLabel: "4단계: 확인 및 공유"
  })
]);

export const TEACHER_FLOW_ACTIONS = Object.freeze({
  SELECT_LESSON: "select-lesson",
  UPDATE_CONDITIONS: "update-conditions",
  CONFIRM_DATE: "confirm-date",
  SET_COMPARISON_MATERIALS: "set-comparison-materials",
  SET_QUERY_STATUS: "set-query-status",
  NEXT: "next",
  PREVIOUS: "previous",
  GO_TO_STEP: "go-to-step"
});

export const TEACHER_QUERY_STATUSES = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  ERROR: "error"
});

export const TEACHER_NAVIGATION_LABELS = Object.freeze({
  stepList: "교사용 수업 만들기 단계",
  previous: "이전 단계로 이동",
  next: "다음 단계로 이동",
  locked: "필수 항목을 완료해야 이동할 수 있는 단계"
});

const stepIndexById = new Map(TEACHER_STEP_DEFINITIONS.map((step, index) => [step.id, index]));
const queryStatuses = new Set(Object.values(TEACHER_QUERY_STATUSES));
const conditionKeys = ["date", "title", "objective", "location", "scenario", "model"];
const queryConditionKeys = new Set(["date", "location", "scenario", "model"]);
const emptyConditions = Object.freeze({
  date: "",
  dateConfirmed: false,
  title: "",
  objective: "",
  location: null,
  scenario: "",
  model: ""
});

/**
 * 교사용 단계 흐름의 초기 상태를 만든다. 접근할 수 없는 뒷단계에서 시작하려는 값은
 * 현재 입력으로 실제 접근 가능한 가장 뒤 단계까지만 되돌린다.
 */
export function createTeacherStepFlowState(initial = {}) {
  const source = isRecord(initial) ? initial : {};
  const sourceConditions = isRecord(source.conditions) ? source.conditions : {};
  const conditions = {
    ...emptyConditions,
    ...pickConditions(sourceConditions),
    dateConfirmed: sourceConditions.dateConfirmed === true,
    location: copyLocation(sourceConditions.location)
  };
  const state = {
    currentStep: stepIndexById.has(source.currentStep)
      ? source.currentStep
      : TEACHER_STEP_IDS.LESSON_SELECTION,
    selectedLessonId: typeof source.selectedLessonId === "string" ? source.selectedLessonId : "",
    conditions,
    comparisonMaterials: Array.isArray(source.comparisonMaterials) ? [...source.comparisonMaterials] : [],
    comparisonRequirements: normalizeComparisonRequirements(source.comparisonRequirements),
    queryStatus: queryStatuses.has(source.queryStatus) ? source.queryStatus : TEACHER_QUERY_STATUSES.IDLE
  };
  return reconcileCurrentStep(state);
}

/** 수업 선택 단계의 완료 여부와 사용자에게 보여 줄 오류를 반환한다. */
export function validateTeacherLessonSelection(state) {
  const errors = [];
  if (!isValidText(state?.selectedLessonId, 160)) {
    errors.push({ field: "selectedLessonId", message: "진행할 수업을 선택하세요." });
  }
  return validationResult(errors);
}

/** 수업 조건 단계의 모든 필수 입력을 검증한다. */
export function validateTeacherLessonConditions(state) {
  const conditions = isRecord(state?.conditions) ? state.conditions : emptyConditions;
  const errors = [];
  if (!isCompleteDate(conditions.date)) {
    errors.push({ field: "date", message: "날짜를 YYYY-MM-DD 형식의 실제 날짜로 입력하세요." });
  }
  if (conditions.dateConfirmed !== true) {
    errors.push({ field: "dateConfirmed", message: "입력한 날짜를 확인하세요." });
  }
  if (!isValidText(conditions.title, 120)) {
    errors.push({ field: "title", message: "수업 제목을 입력하세요." });
  }
  if (!isValidText(conditions.objective, 300)) {
    errors.push({ field: "objective", message: "학습 목표를 입력하세요." });
  }
  if (!isValidLocation(conditions.location)) {
    errors.push({ field: "location", message: "수업에 사용할 위치를 선택하세요." });
  }
  if (!isValidText(conditions.scenario, 80)) {
    errors.push({ field: "scenario", message: "기후 시나리오를 선택하세요." });
  }
  if (!isValidText(conditions.model, 120)) {
    errors.push({ field: "model", message: "기후 모델을 선택하세요." });
  }
  return validationResult(errors);
}

/** 비교 자료와 현재 조건의 실제 조회 성공 여부를 포함해 최종 단계 준비 상태를 검증한다. */
export function validateTeacherReviewReadiness(state) {
  const errors = [
    ...validateTeacherLessonSelection(state).errors,
    ...validateTeacherLessonConditions(state).errors
  ];
  if (!hasRequiredTeacherComparisonMaterials(state?.comparisonMaterials, state?.comparisonRequirements)) {
    errors.push({ field: "comparisonMaterials", message: "수업에서 요구한 비교 자료를 모두 추가하세요." });
  }
  if (state?.queryStatus !== TEACHER_QUERY_STATUSES.READY) {
    errors.push({ field: "queryStatus", message: "현재 수업 조건의 실제 기후 자료 조회를 완료하세요." });
  }
  return validationResult(errors);
}

/** 수업별 최소 지점·최소 모델·여러 모델 종합값 조건을 비교 자료가 충족하는지 확인한다. */
export function hasRequiredTeacherComparisonMaterials(materials, requirements = {}) {
  if (!Array.isArray(materials)) return false;
  const normalized = normalizeComparisonRequirements(requirements);
  const usable = materials.filter((item) => isComparisonMaterial(item));
  if (usable.length === 0) return false;
  const sites = new Set(usable.map((item) => `${item.latitude.toFixed(6)}:${item.longitude.toFixed(6)}`));
  const models = new Set(usable.map((item) => item.model.trim()));
  const hasEnsemble = !normalized.includeEnsemble || models.has("전체 앙상블");
  return sites.size >= normalized.minimumSites
    && models.size >= normalized.minimumModels
    && hasEnsemble;
}

/** 주어진 단계가 현재 상태에서 열려 있는지 반환한다. */
export function canEnterTeacherStep(state, stepId) {
  switch (stepId) {
    case TEACHER_STEP_IDS.LESSON_SELECTION:
      return true;
    case TEACHER_STEP_IDS.LESSON_CONDITIONS:
      return validateTeacherLessonSelection(state).valid;
    case TEACHER_STEP_IDS.ACTIVITY_COMPOSITION:
      return validateTeacherLessonSelection(state).valid
        && validateTeacherLessonConditions(state).valid;
    case TEACHER_STEP_IDS.REVIEW_AND_SHARE:
      return validateTeacherReviewReadiness(state).valid;
    default:
      return false;
  }
}

/** 단계 표시와 이전·다음 버튼에 바로 사용할 접근성 상태를 만든다. */
export function getTeacherStepNavigation(state) {
  const currentIndex = stepIndex(state?.currentStep);
  const previousStep = TEACHER_STEP_DEFINITIONS[currentIndex - 1];
  const nextStep = TEACHER_STEP_DEFINITIONS[currentIndex + 1];
  return {
    ariaLabel: TEACHER_NAVIGATION_LABELS.stepList,
    steps: TEACHER_STEP_DEFINITIONS.map((step, index) => ({
      ...step,
      current: index === currentIndex,
      locked: index > currentIndex && !canEnterTeacherStep(state, step.id),
      ariaCurrent: index === currentIndex ? "step" : undefined
    })),
    previous: {
      ariaLabel: TEACHER_NAVIGATION_LABELS.previous,
      disabled: !previousStep
    },
    next: {
      ariaLabel: TEACHER_NAVIGATION_LABELS.next,
      disabled: !nextStep || !canEnterTeacherStep(state, nextStep.id)
    }
  };
}

/**
 * 단계 이동과 입력 변경을 처리하는 순수 리듀서다. 이전·다음 이동은 입력을 초기화하지 않고,
 * 두 단계 이상을 한 번에 이동하려는 요청은 무시한다.
 */
export function teacherStepFlowReducer(state, action) {
  const current = state ?? createTeacherStepFlowState();
  if (!isRecord(action)) return current;

  switch (action.type) {
    case TEACHER_FLOW_ACTIONS.SELECT_LESSON:
      return selectLesson(current, action.lessonId, action.requirements);
    case TEACHER_FLOW_ACTIONS.UPDATE_CONDITIONS:
      return updateConditions(current, action.patch);
    case TEACHER_FLOW_ACTIONS.CONFIRM_DATE:
      return confirmDate(current, action.confirmed);
    case TEACHER_FLOW_ACTIONS.SET_COMPARISON_MATERIALS:
      return setComparisonMaterials(current, action.materials);
    case TEACHER_FLOW_ACTIONS.SET_QUERY_STATUS:
      return setQueryStatus(current, action.status);
    case TEACHER_FLOW_ACTIONS.NEXT:
      return moveByOneStep(current, 1);
    case TEACHER_FLOW_ACTIONS.PREVIOUS:
      return moveByOneStep(current, -1);
    case TEACHER_FLOW_ACTIONS.GO_TO_STEP:
      return moveToAdjacentStep(current, action.step);
    default:
      return current;
  }
}

function selectLesson(state, lessonId, requirements) {
  const selectedLessonId = typeof lessonId === "string" ? lessonId : "";
  return reconcileCurrentStep({
    ...state,
    selectedLessonId,
    comparisonMaterials: [],
    comparisonRequirements: normalizeComparisonRequirements(requirements),
    queryStatus: TEACHER_QUERY_STATUSES.IDLE
  });
}

function updateConditions(state, patch) {
  if (!isRecord(patch)) return state;
  const nextValues = pickConditions(patch);
  const changedKeys = Object.keys(nextValues).filter((key) => !sameConditionValue(state.conditions[key], nextValues[key]));
  if (changedKeys.length === 0) return state;

  const nextConditions = {
    ...state.conditions,
    ...nextValues,
    ...(hasOwn(nextValues, "location") ? { location: copyLocation(nextValues.location) } : {})
  };
  if (changedKeys.includes("date")) nextConditions.dateConfirmed = false;
  const invalidatesQuery = changedKeys.some((key) => queryConditionKeys.has(key));
  return reconcileCurrentStep({
    ...state,
    conditions: nextConditions,
    queryStatus: invalidatesQuery ? TEACHER_QUERY_STATUSES.IDLE : state.queryStatus
  });
}

function confirmDate(state, confirmed) {
  const dateConfirmed = confirmed === true && isCompleteDate(state.conditions.date);
  if (dateConfirmed === state.conditions.dateConfirmed) return state;
  return reconcileCurrentStep({
    ...state,
    conditions: { ...state.conditions, dateConfirmed }
  });
}

function setComparisonMaterials(state, materials) {
  const comparisonMaterials = Array.isArray(materials) ? [...materials] : [];
  return reconcileCurrentStep({ ...state, comparisonMaterials });
}

function setQueryStatus(state, status) {
  const queryStatus = queryStatuses.has(status) ? status : TEACHER_QUERY_STATUSES.IDLE;
  if (queryStatus === state.queryStatus) return state;
  return reconcileCurrentStep({ ...state, queryStatus });
}

function moveByOneStep(state, offset) {
  const target = TEACHER_STEP_DEFINITIONS[stepIndex(state.currentStep) + offset];
  return target ? moveToAdjacentStep(state, target.id) : state;
}

function moveToAdjacentStep(state, targetStep) {
  const currentIndex = stepIndex(state.currentStep);
  const targetIndex = stepIndexById.get(targetStep);
  if (targetIndex === undefined || Math.abs(targetIndex - currentIndex) !== 1) return state;
  if (targetIndex > currentIndex && !canEnterTeacherStep(state, targetStep)) return state;
  return { ...state, currentStep: targetStep };
}

function reconcileCurrentStep(state) {
  const currentIndex = stepIndex(state.currentStep);
  let furthestAccessibleIndex = 0;
  for (let index = 1; index < TEACHER_STEP_DEFINITIONS.length; index += 1) {
    if (!canEnterTeacherStep(state, TEACHER_STEP_DEFINITIONS[index].id)) break;
    furthestAccessibleIndex = index;
  }
  if (currentIndex <= furthestAccessibleIndex) return state;
  return { ...state, currentStep: TEACHER_STEP_DEFINITIONS[furthestAccessibleIndex].id };
}

function validationResult(errors) {
  return { valid: errors.length === 0, errors };
}

function pickConditions(value) {
  return Object.fromEntries(conditionKeys
    .filter((key) => hasOwn(value, key))
    .map((key) => [key, value[key]]));
}

function copyLocation(value) {
  return isRecord(value) ? { ...value } : value ?? null;
}

function sameConditionValue(current, next) {
  if (!isRecord(current) || !isRecord(next)) return Object.is(current, next);
  return current.label === next.label
    && current.latitude === next.latitude
    && current.longitude === next.longitude;
}

function stepIndex(stepId) {
  return stepIndexById.get(stepId) ?? 0;
}

function isCompleteDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidText(value, maximumLength) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maximumLength;
}

function isValidLocation(value) {
  return isRecord(value)
    && isValidText(value.label, 80)
    && Number.isFinite(value.latitude)
    && value.latitude >= -85.05112878
    && value.latitude <= 85.05112878
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180;
}

function normalizeComparisonRequirements(value) {
  const source = isRecord(value) ? value : {};
  return {
    minimumSites: positiveInteger(source.minimumSites, 1),
    minimumModels: positiveInteger(source.minimumModels, 1),
    includeEnsemble: source.includeEnsemble === true
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 100 ? number : fallback;
}

function isComparisonMaterial(value) {
  return isRecord(value)
    && Number.isFinite(value.latitude)
    && value.latitude >= -85.05112878
    && value.latitude <= 85.05112878
    && Number.isFinite(value.longitude)
    && value.longitude >= -180
    && value.longitude <= 180
    && isValidText(value.model, 120);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}
