import test from "node:test";
import assert from "node:assert/strict";
import { climateProblemById, climateProblemSets } from "../source/climate-problem-catalog.js";

const allowedCategories = new Set(["heat", "rain", "temperature", "wind"]);
const allowedVariables = new Set(["apparentTemperature", "precipitation", "tasmax", "tasmin", "wind"]);

function isCompleteDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

test("문제 모음은 여러 기후 요소와 역할별 활동을 포함한다", () => {
  assert.ok(climateProblemSets.length >= 10);
  assert.deepEqual(new Set(climateProblemSets.map((problem) => problem.category)), allowedCategories);
  const usedVariables = new Set(climateProblemSets.flatMap((problem) => problem.dataPlan.variableKeys));
  for (const variable of allowedVariables) assert.ok(usedVariables.has(variable), `${variable} 지표 문제가 없습니다.`);
});

test("모든 문제는 고유 식별자와 실제 조회 조건, 학생·교사 검수 기준을 갖는다", () => {
  const ids = new Set();
  for (const problem of climateProblemSets) {
    assert.ok(!ids.has(problem.id), `중복 문제 식별자: ${problem.id}`);
    ids.add(problem.id);
    assert.equal(problem.status, "verified");
    assert.ok(Number.isInteger(problem.revision) && problem.revision > 0);
    assert.ok(allowedCategories.has(problem.category));
    assert.ok(problem.presentation.title.length > 5);
    assert.ok(problem.inquiry.question.endsWith("?"));
    assert.ok(problem.inquiry.hypothesisChoices.length >= 3);
    assert.ok(problem.inquiry.interpretationLimit.length > 20);
    assert.ok(isCompleteDate(problem.dataPlan.anchorDate));
    assert.ok(isCompleteDate(problem.dataPlan.periodStart));
    assert.ok(isCompleteDate(problem.dataPlan.periodEnd));
    assert.ok(problem.dataPlan.periodStart <= problem.dataPlan.periodEnd);
    assert.ok(problem.dataPlan.variableKeys.length > 0);
    for (const variable of problem.dataPlan.variableKeys) assert.ok(allowedVariables.has(variable), `${problem.id}: 알 수 없는 지표 ${variable}`);
    assert.ok(problem.dataPlan.sites.length > 0);
    for (const site of problem.dataPlan.sites) {
      assert.ok(Number.isFinite(site.latitude) && site.latitude >= -85.05112878 && site.latitude <= 85.05112878);
      assert.ok(Number.isFinite(site.longitude) && site.longitude >= -180 && site.longitude <= 180);
      assert.ok(site.label && site.detail);
    }
    for (const period of problem.dataPlan.comparisonPeriods ?? []) {
      assert.ok(isCompleteDate(period.start));
      assert.ok(isCompleteDate(period.end));
      assert.ok(period.start <= period.end);
      if (period.seasonMonths) {
        assert.ok(period.seasonMonths.every((month) => Number.isInteger(month) && month >= 1 && month <= 12));
      }
    }
    assert.ok(problem.roles.student.prompt.length > 20);
    assert.ok(problem.roles.student.output.length >= 3);
    assert.ok(problem.roles.teacher.assessmentCriteria.length >= 3);
    assert.doesNotMatch(JSON.stringify(problem.roles), /\b\d+(?:\.\d+)?\s*(?:℃|mm(?:\/day)?|m\/s)\b/u, `${problem.id}: 산출물에 정답 수치를 고정하면 안 됩니다.`);
    assert.equal(climateProblemById(problem.id), problem);
  }
});

test("열지수·체감 탐구는 계산에 쓰는 값과 주변 환경 요인을 구분한다", () => {
  const extensions = climateProblemSets.filter((problem) => problem.microclimateExtension);
  assert.ok(extensions.length >= 2);
  for (const problem of extensions) {
    assert.deepEqual(problem.microclimateExtension.directIndexInputs, ["기온", "상대습도"]);
    assert.ok(problem.microclimateExtension.backgroundFactors.length >= 3);
    assert.ok(problem.microclimateExtension.unavailableVariables.length >= 2);
    assert.match(problem.inquiry.interpretationLimit, /공개|원자료|상대습도/u);
  }
});

test("아틀라스 위치 추리 문제는 검증된 두 비교 위치를 사용한다", () => {
  const problem = climateProblemById("atlas-climate-mystery");
  assert.ok(problem?.mystery?.hiddenLocation);
  assert.deepEqual(problem.dataPlan.sites.map(({ latitude, longitude }) => [latitude, longitude]), [[34, 3], [30, 5]]);
  assert.equal(problem.dataPlan.raw, true);
  assert.deepEqual(problem.dataPlan.variableKeys, ["tasmax", "tasmin", "precipitation", "wind"]);
  assert.equal(problem.mystery.studentSiteAliases.length, problem.dataPlan.sites.length);
  assert.match(problem.validationEvidence.modelAvailability, /6개 모델.*4개 모델/u);
  assert.doesNotMatch(JSON.stringify(problem), /이프란|모로코|W5|W8/u);
});

test("하루 기온 차이 문제는 날짜별 차이를 먼저 계산하도록 안내한다", () => {
  const problem = climateProblemById("regional-diurnal-range");
  assert.equal(problem.presentation.shortLabel, "하루 기온 차이");
  assert.match(problem.inquiry.objective, /같은 날짜의 최고기온에서 최저기온을 빼/u);
  assert.match(problem.roles.student.prompt, /날짜별 하루 기온 차이를 구한 뒤 월별로 평균/u);
  assert.doesNotMatch(JSON.stringify(problem), /하루 온도 폭/u);
  assert.doesNotMatch(JSON.stringify(problem), /장마는 사라졌을까, 시기가/u);
});

test("학생·교사 문장에는 설명 없는 내부 용어를 노출하지 않는다", () => {
  const visibleCopy = JSON.stringify(climateProblemSets);
  assert.doesNotMatch(visibleCopy, /대조\s*격자|원자료\s*격자|격자값|판단 유보|자료 가용성|미세기후|미기후|극단일수|중기·후기|결측|불투수면|도시 협곡|토지피복|불투수율|장마의 틀|기존 틀|하루 온도 폭|복합 지표|복합 더위|낮 기온|아틀라스 고원 인접|월간 하루 평균 강수량|최고 열지수|두 겨울 주간|두 여름 주간|앞뒤 두 주간|월 강수량 비교표|모델별 범위/u);
});
