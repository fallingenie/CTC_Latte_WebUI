import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { climateProblemSets } from "../source/climate-problem-catalog.js";
import { buildStudentNotebookDocx, buildTeacherActivityDocx } from "../source/student-docx.js";

const baseline = {
  date: "2050-08-01",
  label: "남반구 비교 지점",
  latitude: -33.8651,
  longitude: -151.2099,
  scenario: "고배출 경로 · SSP5-8.5",
  model: "MIROC6",
  values: [
    { key: "tasmax", label: "최고기온", unit: "도", value: 33.78 },
    { key: "precipitation", label: "강수량", unit: "밀리미터/일", value: 0.89 },
    { key: "wind", label: "풍속", unit: "미터/초", value: 4.1 }
  ]
};

const comparison = {
  ...baseline,
  date: "2050-08-15",
  label: "현재 선택 지점",
  latitude: 36.35,
  longitude: 127.38,
  values: [
    { key: "tasmax", label: "최고기온", unit: "도", value: 35.78 },
    { key: "precipitation", label: "강수량", unit: "밀리미터/일", value: 1.09 },
    { key: "wind", label: "풍속", unit: "미터/초", value: 3.6 }
  ]
};

test("학생 탐구 문서는 내용이 있는 DOCX 패키지로 생성된다", async () => {
  const blob = await buildStudentNotebookDocx({
    baseline,
    comparison,
    focusLabel: "더워지는 날",
    conclusion: "모델마다 결과가 다름",
    note: "현재 조건의 최고기온이 비교 기준보다 2℃ 높습니다.",
    problem: {
      presentation: { title: "같은 기온에도 체감 더위가 다를까?" },
      inquiry: {
        question: "최고기온과 체감 더위의 순위가 같을까?",
        interpretationLimit: "공개되지 않은 상대습도를 임의로 추정하지 않습니다."
      },
      dataPlan: { periodStart: "2050-08-01", periodEnd: "2050-08-31" },
      roles: { student: { output: ["도시별 비교표", "자료 한계"] } }
    }
  });

  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(blob.size > 5_000, `DOCX 크기가 너무 작습니다: ${blob.size}`);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);

  const archive = await JSZip.loadAsync(bytes);
  for (const path of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"]) {
    assert.ok(archive.file(path), `${path}가 DOCX에 없습니다.`);
  }

  const documentXml = await archive.file("word/document.xml").async("string");
  assert.match(documentXml, /기후 탐구 기록/u);
  assert.match(documentXml, /더워지는 날/u);
  assert.match(documentXml, /같은 기온에도 체감 더위가 다를까\?/u);
  assert.match(documentXml, /최고기온과 체감 더위의 순위가 같을까\?/u);
  assert.match(documentXml, /2050-08-01 ~ 2050-08-31/u);
  assert.match(documentXml, /도시별 비교표 · 자료 한계/u);
  assert.match(documentXml, /공개되지 않은 상대습도를 임의로 추정하지 않습니다\./u);
  assert.match(documentXml, /모델마다 결과가 다름/u);
  assert.match(documentXml, /S\(남위\) 33\.8651, W\(서경\) 151\.2099/u);
  assert.match(documentXml, /N\(북위\) 36\.3500, E\(동경\) 127\.3800/u);
  assert.match(documentXml, /33\.78℃/u);
  assert.match(documentXml, /0\.89 mm\/day/u);
  assert.match(documentXml, /4\.1 m\/s/u);
  assert.match(documentXml, /\+2℃/u);
  assert.match(documentXml, /현재 조건의 최고기온이 비교 기준보다 2℃ 높습니다\./u);
  assert.doesNotMatch(documentXml, /Codex/iu);
});

test("첫 번째 조건 없이 DOCX 생성을 요청하면 빈 문서를 만들지 않는다", async () => {
  await assert.rejects(
    buildStudentNotebookDocx({ focusLabel: "더워지는 날", note: "" }),
    /먼저 비교할 자료가 필요합니다/u
  );
});

test("교사용 수업 활동지는 수업 설계와 실제 비교 자료가 들어 있는 안전한 DOCX로 생성된다", async () => {
  const blob = await buildTeacherActivityDocx({
    lessonTitle: "남부 지방 강수 집중 시기 탐구",
    objective: "여러 지역과 기후 모델의 강수량을 비교하고 가능성과 한계를 설명한다.",
    snapshots: [baseline, comparison],
    studentLink: "https://example.test/#/query?lesson=verified",
    inquiryQuestion: "우리가 알고 있던 장마 시기가 달라질 가능성이 있을까?",
    comparisonPeriods: [
      { label: "여름부터 가을", start: "2060-06-01", end: "2060-10-31", seasonMonths: [6, 7, 8, 9, 10] }
    ],
    hypothesisChoices: ["6~7월에 비가 집중될 가능성", "8월 이후에 비가 집중될 가능성"],
    expectedOutputs: ["기후 모델별 강수량 변화 그래프", "주장·근거·한계가 드러나는 결론"],
    assessmentCriteria: ["한 날짜만 보고 결론을 내리지 않는다", "자료가 없는 경우를 0으로 처리하지 않는다"],
    interpretationLimit: "여러 가능성을 살펴보는 자료이며 특정 날짜의 일기예보가 아닙니다.",
    problem: climateProblemSets[0]
  });

  assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(blob.size > 5_000, `교사용 DOCX 크기가 너무 작습니다: ${blob.size}`);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  const archive = await JSZip.loadAsync(bytes);
  const archivePaths = Object.keys(archive.files);
  assert.deepEqual(archivePaths.filter((path) => /vbaProject|macros|activeX|embeddings|oleObject/iu.test(path)), []);

  const contentTypesXml = await archive.file("[Content_Types].xml").async("string");
  assert.doesNotMatch(contentTypesXml, /macroEnabled|vbaProject/iu);
  const relationshipFiles = archivePaths.filter((path) => path.endsWith(".rels"));
  for (const path of relationshipFiles) {
    const relationshipsXml = await archive.file(path).async("string");
    assert.doesNotMatch(relationshipsXml, /TargetMode="External"|vbaProject|oleObject/iu, `${path}에 외부 실행 관계가 있습니다.`);
  }

  const documentXml = await archive.file("word/document.xml").async("string");
  assert.match(documentXml, /기후 탐구 수업 활동지/u);
  assert.match(documentXml, /남부 지방 강수 집중 시기 탐구/u);
  assert.match(documentXml, /우리가 알고 있던 장마 시기가 달라질 가능성이 있을까\?/u);
  assert.match(documentXml, /2060-06-01 ~ 2060-10-31 · 6, 7, 8, 9, 10월만/u);
  assert.match(documentXml, /비교 자료 1/u);
  assert.match(documentXml, /비교 자료 2/u);
  assert.match(documentXml, /S\(남위\) 33\.8651, W\(서경\) 151\.2099/u);
  assert.match(documentXml, /N\(북위\) 36\.3500, E\(동경\) 127\.3800/u);
  assert.match(documentXml, /기후 모델별 강수량 변화 그래프/u);
  assert.match(documentXml, /관련 그래프·표와 확인한 근거를 함께 적으세요/u);
  assert.doesNotMatch(documentXml, /기간 자료에서 확인한 그래프와 표를 넣고/u);
  assert.match(documentXml, /자료가 없는 경우를 0으로 처리하지 않는다/u);
  assert.match(documentXml, /탐구 설계/u);
  assert.match(documentXml, /자료 준비 계획/u);
  assert.match(documentXml, /부산/u);
  assert.match(documentXml, /광주/u);
  assert.match(documentXml, /기후 모델\(CMIP6\)/u);
  assert.match(documentXml, /학생 활동 기록지/u);
  assert.match(documentXml, /교사 지도와 평가/u);
  assert.match(documentXml, /자료 해석 범위와 확장 활동/u);
  assert.ok((documentXml.match(/w:pageBreakBefore/gu) ?? []).length >= 6, "교사용 활동지가 독립된 여러 쪽으로 구성되지 않았습니다.");
  assert.doesNotMatch(documentXml, /Codex|\.ctwebui|\.ctcapsule|drive\.google\.com/iu);
});

test("비교 자료 없이 교사용 DOCX 생성을 요청하면 빈 활동지를 만들지 않는다", async () => {
  await assert.rejects(
    buildTeacherActivityDocx({ lessonTitle: "빈 활동지", snapshots: [] }),
    /비교할 기후 자료가 하나 이상 필요합니다/u
  );
});
