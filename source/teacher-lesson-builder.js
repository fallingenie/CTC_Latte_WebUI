export const CUSTOM_TEACHER_LESSON_ID = "teacher-custom-lesson";

export const CUSTOM_TEACHER_METRIC_KEYS = Object.freeze([
  "tasmax",
  "tasmin",
  "precipitation",
  "wind",
  "apparentTemperature"
]);

export const DEFAULT_CUSTOM_TEACHER_LESSON = Object.freeze({
  question: "선택한 위치와 다른 위치의 미래 기후는 어떻게 다르게 나타날까요?",
  outputText: "두 자료의 차이를 수치로 비교한 설명\n자료로 알 수 있는 점과 알기 어려운 점",
  metricKeys: Object.freeze(["tasmax", "tasmin", "precipitation"]),
  periodStart: "2050-08-01",
  periodEnd: "2051-07-31",
  interpretationLimit: "기후 시나리오 자료는 미래에 나타날 수 있는 가능성을 살펴보는 자료이며 특정 날짜의 일기예보가 아닙니다.",
  evidenceRequirements: Object.freeze({
    minimumSites: 2,
    minimumModels: 1,
    includeEnsemble: false
  })
});

export function createCustomTeacherLessonDraft(value = {}) {
  const source = isRecord(value) ? value : {};
  const evidenceSource = isRecord(source.evidenceRequirements) ? source.evidenceRequirements : {};
  return {
    question: boundedText(source.question ?? DEFAULT_CUSTOM_TEACHER_LESSON.question, 500),
    outputText: boundedText(source.outputText ?? DEFAULT_CUSTOM_TEACHER_LESSON.outputText, 800),
    metricKeys: normalizeMetricKeys(source.metricKeys ?? DEFAULT_CUSTOM_TEACHER_LESSON.metricKeys),
    periodStart: boundedText(source.periodStart ?? DEFAULT_CUSTOM_TEACHER_LESSON.periodStart, 10),
    periodEnd: boundedText(source.periodEnd ?? DEFAULT_CUSTOM_TEACHER_LESSON.periodEnd, 10),
    interpretationLimit: boundedText(source.interpretationLimit ?? DEFAULT_CUSTOM_TEACHER_LESSON.interpretationLimit, 1000),
    evidenceRequirements: {
      minimumSites: boundedInteger(evidenceSource.minimumSites, 1, 4, DEFAULT_CUSTOM_TEACHER_LESSON.evidenceRequirements.minimumSites),
      minimumModels: boundedInteger(evidenceSource.minimumModels, 1, 4, DEFAULT_CUSTOM_TEACHER_LESSON.evidenceRequirements.minimumModels),
      includeEnsemble: evidenceSource.includeEnsemble === true
    }
  };
}

export function validateCustomTeacherLessonDraft(value, anchorDate) {
  const draft = createCustomTeacherLessonDraft(value);
  const errors = [];
  if (!draft.question.trim()) errors.push({ field: "question", message: "학생이 살펴볼 질문을 입력하세요." });
  if (expectedOutputs(draft.outputText).length === 0) errors.push({ field: "outputText", message: "학생이 완성할 결과물을 한 가지 이상 입력하세요." });
  if (draft.metricKeys.length === 0) errors.push({ field: "metricKeys", message: "수업에서 살펴볼 기후 지표를 한 가지 이상 선택하세요." });
  if (!isCompleteDate(draft.periodStart)) errors.push({ field: "periodStart", message: "탐구 시작일을 YYYY-MM-DD 형식으로 입력하세요." });
  if (!isCompleteDate(draft.periodEnd)) errors.push({ field: "periodEnd", message: "탐구 종료일을 YYYY-MM-DD 형식으로 입력하세요." });
  if (isCompleteDate(draft.periodStart) && isCompleteDate(draft.periodEnd) && draft.periodStart > draft.periodEnd) {
    errors.push({ field: "periodEnd", message: "탐구 종료일은 시작일보다 빠를 수 없습니다." });
  }
  if (isCompleteDate(anchorDate) && isCompleteDate(draft.periodStart) && isCompleteDate(draft.periodEnd)
      && (anchorDate < draft.periodStart || anchorDate > draft.periodEnd)) {
    errors.push({ field: "anchorDate", message: "살펴볼 날짜가 탐구 기간 안에 들어오도록 조정하세요." });
  }
  if (!draft.interpretationLimit.trim()) errors.push({ field: "interpretationLimit", message: "자료를 해석할 때 주의할 점을 입력하세요." });
  return { draft, errors, valid: errors.length === 0 };
}

export function buildCustomTeacherLessonSample({
  date,
  draft: draftValue,
  location,
  model,
  objective,
  scenario,
  title
}) {
  const { draft } = validateCustomTeacherLessonDraft(draftValue, date);
  const derivedKeys = draft.metricKeys.includes("apparentTemperature") ? ["apparentTemperature"] : [];
  const variableKeys = draft.metricKeys.filter((key) => key !== "apparentTemperature");
  const output = expectedOutputs(draft.outputText);
  const focus = lessonFocus(draft.metricKeys);
  const site = normalizeLocation(location);
  const comparisonPeriods = [{
    id: "teacher-custom-period",
    label: "교사가 정한 탐구 기간",
    start: draft.periodStart,
    end: draft.periodEnd
  }];
  const problem = {
    id: CUSTOM_TEACHER_LESSON_ID,
    revision: 1,
    category: focus,
    presentation: {
      title: boundedText(title, 120),
      shortLabel: boundedText(title, 40),
      detail: "교사가 직접 구성한 탐구 수업",
      tags: draft.metricKeys.map((key) => metricLabel(key)),
      iconKey: focus,
      mapTone: focus
    },
    inquiry: {
      objective: boundedText(objective, 300),
      question: draft.question,
      hypothesisChoices: [],
      interpretationLimit: draft.interpretationLimit
    },
    dataPlan: {
      anchorDate: date,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      comparisonPeriods,
      scenario,
      defaultModel: model,
      raw: false,
      allowCustomLocation: true,
      variableKeys,
      derivedKeys,
      sites: [site]
    },
    evidenceRequirements: { ...draft.evidenceRequirements },
    roles: {
      student: {
        prompt: "위치·날짜·기후 모델을 바꾸어 자료를 비교하고, 수치로 확인한 근거와 자료의 한계를 함께 정리합니다.",
        output
      },
      teacher: {
        assessmentCriteria: [
          "선택한 기후 지표의 값을 단위와 함께 비교했는가",
          "자료로 확인한 근거와 해석의 한계를 구분했는가",
          "미래 기후를 확정된 예측이 아닌 가능성으로 설명했는가"
        ]
      }
    }
  };
  return {
    id: CUSTOM_TEACHER_LESSON_ID,
    revision: 1,
    label: "직접 구성한 수업",
    title: problem.presentation.title,
    objective: problem.inquiry.objective,
    question: draft.question,
    guardrail: draft.interpretationLimit,
    conclusionOptions: [],
    date,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    scenario,
    model,
    focus,
    variableKeys,
    derivedKeys,
    comparisonPeriods,
    evidenceRequirements: { ...draft.evidenceRequirements },
    location: site,
    sites: [site],
    output,
    assessmentCriteria: problem.roles.teacher.assessmentCriteria,
    problem
  };
}

export function customLessonSharePayload(sample) {
  if (!sample || sample.id !== CUSTOM_TEACHER_LESSON_ID) return undefined;
  return {
    title: boundedText(sample.title, 120),
    objective: boundedText(sample.objective, 300),
    question: boundedText(sample.question, 500),
    outputs: Array.isArray(sample.output) ? sample.output.map((item) => boundedText(item, 200)).filter(Boolean).slice(0, 6) : [],
    metricKeys: normalizeMetricKeys([...(sample.variableKeys ?? []), ...(sample.derivedKeys ?? [])]),
    interpretationLimit: boundedText(sample.guardrail, 1000),
    evidenceRequirements: {
      minimumSites: boundedInteger(sample.evidenceRequirements?.minimumSites, 1, 4, 1),
      minimumModels: boundedInteger(sample.evidenceRequirements?.minimumModels, 1, 4, 1),
      includeEnsemble: sample.evidenceRequirements?.includeEnsemble === true
    }
  };
}

export function expectedOutputs(value) {
  return String(value ?? "")
    .split(/\r?\n/u)
    .map((item) => boundedText(item, 200).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeMetricKeys(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(CUSTOM_TEACHER_METRIC_KEYS);
  return [...new Set(value.filter((key) => allowed.has(key)))];
}

function lessonFocus(keys) {
  if (keys.includes("precipitation")) return "rain";
  if (keys.includes("wind")) return "wind";
  if (keys.includes("apparentTemperature")) return "heat";
  return "temperature";
}

function metricLabel(key) {
  return ({
    tasmax: "최고기온",
    tasmin: "최저기온",
    precipitation: "강수량",
    wind: "풍속",
    apparentTemperature: "체감 지표"
  })[key] ?? key;
}

function normalizeLocation(value) {
  const source = isRecord(value) ? value : {};
  return {
    id: boundedText(source.id ?? "custom", 80),
    label: boundedText(source.label ?? "직접 선택", 80),
    detail: boundedText(source.detail ?? "지도에서 선택", 120),
    latitude: boundedNumber(source.latitude, -85.05112878, 85.05112878, 0),
    longitude: boundedNumber(source.longitude, -180, 180, 0)
  };
}

function isCompleteDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function boundedText(value, maximumLength) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "").slice(0, maximumLength);
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : fallback;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
