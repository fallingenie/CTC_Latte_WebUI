import test from "node:test";
import assert from "node:assert/strict";

import {
  CUSTOM_TEACHER_LESSON_ID,
  buildCustomTeacherLessonSample,
  createCustomTeacherLessonDraft,
  customLessonSharePayload,
  expectedOutputs,
  validateCustomTeacherLessonDraft
} from "../source/teacher-lesson-builder.js";

const context = {
  date: "2060-07-12",
  location: { id: "custom", label: "직접 선택", detail: "지도에서 선택", latitude: 35.18, longitude: 129.08 },
  model: "전체 앙상블",
  objective: "기후 자료를 비교하고 근거와 한계를 설명한다.",
  scenario: "고배출 경로",
  title: "남부 지역의 강수 시기 비교"
};

test("직접 수업 초안은 지원 지표와 비교 조건만 보존한다", () => {
  const draft = createCustomTeacherLessonDraft({
    metricKeys: ["tasmax", "unknown", "wind", "tasmax"],
    evidenceRequirements: { minimumSites: 3, minimumModels: 2, includeEnsemble: true }
  });
  assert.deepEqual(draft.metricKeys, ["tasmax", "wind"]);
  assert.deepEqual(draft.evidenceRequirements, { minimumSites: 3, minimumModels: 2, includeEnsemble: true });
});

test("질문, 지표, 결과물과 올바른 기간이 있어야 직접 수업을 진행할 수 있다", () => {
  const invalid = validateCustomTeacherLessonDraft({
    question: "",
    outputText: "",
    metricKeys: [],
    periodStart: "2060-10-31",
    periodEnd: "2060-06-01",
    interpretationLimit: ""
  }, context.date);
  assert.equal(invalid.valid, false);
  assert.deepEqual(new Set(invalid.errors.map((error) => error.field)), new Set([
    "question",
    "outputText",
    "metricKeys",
    "periodEnd",
    "anchorDate",
    "interpretationLimit"
  ]));
});

test("유효하지 않은 직접 수업 초안으로는 표본을 만들지 않는다", () => {
  assert.throws(
    () => buildCustomTeacherLessonSample({
      ...context,
      draft: {
        question: "",
        outputText: "",
        metricKeys: [],
        periodStart: "2060-10-31",
        periodEnd: "2060-06-01",
        interpretationLimit: ""
      }
    }),
    /직접 수업 초안이 올바르지 않습니다:.*학생이 살펴볼 질문.*학생이 완성할 결과물.*기후 지표.*탐구 종료일.*자료를 해석할 때 주의할 점/u
  );
});

test("직접 수업 표본은 원 지표와 계산 지표를 구분하고 학생 결과물을 보존한다", () => {
  const draft = createCustomTeacherLessonDraft({
    metricKeys: ["tasmax", "precipitation", "apparentTemperature"],
    outputText: "강수 집중 시기 비교표\n근거와 한계를 담은 설명",
    periodStart: "2060-06-01",
    periodEnd: "2060-10-31"
  });
  const sample = buildCustomTeacherLessonSample({ ...context, draft });
  assert.equal(sample.id, CUSTOM_TEACHER_LESSON_ID);
  assert.deepEqual(sample.variableKeys, ["tasmax", "precipitation"]);
  assert.deepEqual(sample.derivedKeys, ["apparentTemperature"]);
  assert.deepEqual(sample.output, ["강수 집중 시기 비교표", "근거와 한계를 담은 설명"]);
  assert.equal(sample.problem.dataPlan.allowCustomLocation, true);
  assert.equal(sample.problem.inquiry.question, draft.question);
});

test("학생 공유용 직접 수업 정보는 허용된 필드만 만든다", () => {
  const sample = buildCustomTeacherLessonSample({
    ...context,
    draft: createCustomTeacherLessonDraft({
      metricKeys: ["tasmin", "wind"],
      outputText: "비교표\n설명문",
      periodStart: "2060-06-01",
      periodEnd: "2060-10-31"
    })
  });
  assert.deepEqual(customLessonSharePayload(sample).metricKeys, ["tasmin", "wind"]);
  assert.deepEqual(customLessonSharePayload(sample).outputs, ["비교표", "설명문"]);
  assert.equal(expectedOutputs("첫째\n\n둘째\r\n셋째").length, 3);
});
