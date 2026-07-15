import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";
import {
  formatCoordinatePair,
  formatPublicMetricValue,
  metricDisplayUnit
} from "./workbench-logic.js";

const colors = {
  accent: "126B52",
  accentSoft: "EAF5F0",
  border: "CBD9D3",
  ink: "14211C",
  muted: "5A6B64",
  surface: "F5F8F7",
  white: "FFFFFF"
};

const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: colors.border },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: colors.border },
  left: { style: BorderStyle.SINGLE, size: 4, color: colors.border },
  right: { style: BorderStyle.SINGLE, size: 4, color: colors.border },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: colors.border },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: colors.border }
};

function cleanText(value, maximumLength = 2000) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .trim()
    .slice(0, maximumLength);
}

function textParagraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment,
    children: [new TextRun({
      bold: options.bold,
      color: options.color ?? colors.ink,
      font: "Malgun Gothic",
      size: options.size ?? 21,
      text: cleanText(text, 4000)
    })],
    heading: options.heading,
    pageBreakBefore: options.pageBreakBefore,
    spacing: options.spacing ?? { after: 100, line: 300 }
  });
}

function bulletParagraph(text) {
  return new Paragraph({
    bullet: { level: 0 },
    children: [new TextRun({
      color: colors.ink,
      font: "Malgun Gothic",
      size: 20,
      text: cleanText(text, 2000)
    })],
    spacing: { after: 70, line: 290 }
  });
}

function checkboxParagraph(text) {
  return textParagraph(`□ ${cleanText(text, 2000)}`, {
    size: 20,
    spacing: { after: 70, line: 290 }
  });
}

function sectionHeading(text) {
  return textParagraph(text, {
    color: colors.accent,
    heading: HeadingLevel.HEADING_2,
    size: 28,
    bold: true,
    spacing: { before: 260, after: 120 }
  });
}

function tableCell(text, { fill = colors.white, bold = false, color = colors.ink, width = 50 } = {}) {
  return new TableCell({
    children: [textParagraph(text, { bold, color, size: 19, spacing: { after: 0, line: 280 } })],
    margins: { top: 110, bottom: 110, left: 140, right: 140 },
    shading: { type: ShadingType.CLEAR, color: "auto", fill },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: width, type: WidthType.PERCENTAGE }
  });
}

function keyValueTable(rows) {
  return new Table({
    borders: tableBorders,
    layout: TableLayoutType.FIXED,
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        tableCell(label, { fill: colors.surface, bold: true, width: 25 }),
        tableCell(value, { width: 75 })
      ]
    })),
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

function outputPlanTable(outputs) {
  const rows = [new TableRow({
    tableHeader: true,
    children: [
      tableCell("만들 결과물", { fill: colors.accent, bold: true, color: colors.white, width: 38 }),
      tableCell("자료에서 확인한 내용", { fill: colors.accent, bold: true, color: colors.white, width: 62 })
    ]
  })];
  outputs.forEach((output) => rows.push(new TableRow({
    children: [
      tableCell(cleanText(output, 200), { bold: true, width: 38 }),
      tableCell("관련 그래프·표와 확인한 근거를 함께 적으세요.", { width: 62 })
    ]
  })));
  return new Table({
    borders: tableBorders,
    layout: TableLayoutType.FIXED,
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

function metricTable(snapshot) {
  const rows = [new TableRow({
    tableHeader: true,
    children: [
      tableCell("기후 지표", { fill: colors.accent, bold: true, color: colors.white, width: 45 }),
      tableCell("선택한 자료의 값", { fill: colors.accent, bold: true, color: colors.white, width: 55 })
    ]
  })];
  snapshot.values.forEach((metric) => {
    rows.push(new TableRow({
      children: [
        tableCell(cleanText(metric.label, 80), { width: 45 }),
        tableCell(formatMetricValue(metric), { width: 55 })
      ]
    }));
  });
  return new Table({
    borders: tableBorders,
    layout: TableLayoutType.FIXED,
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

function conditionSection(title, snapshot, { pageBreakBefore = false } = {}) {
  return [
    textParagraph(title, {
      color: colors.accent,
      heading: HeadingLevel.HEADING_2,
      size: 28,
      bold: true,
      pageBreakBefore,
      spacing: { before: 260, after: 120 }
    }),
    keyValueTable([
      ["지점", cleanText(snapshot.label, 80)],
      ["날짜", cleanText(snapshot.date, 20)],
      ["좌표", formatCoordinatePair(snapshot.latitude, snapshot.longitude)],
      ["시나리오", cleanText(snapshot.scenario, 80)],
      ["기후 모델(CMIP6)", cleanText(snapshot.model, 120)]
    ]),
    textParagraph("기후 지표", {
      bold: true,
      size: 22,
      spacing: { before: 180, after: 80 }
    }),
    metricTable(snapshot)
  ];
}

function formatMetricValue(metric) {
  return formatPublicMetricValue({
    key: metric.key,
    numericValue: metric.value,
    unit: metric.unit
  });
}

function formatDelta(metric, delta) {
  const unit = metricDisplayUnit(metric);
  const value = Number(delta).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const prefix = delta > 0 ? "+" : "";
  return unit === "℃" ? `${prefix}${value}${unit}` : `${prefix}${value}${unit ? ` ${unit}` : ""}`;
}

function comparisonTable(baseline, comparison) {
  const rows = [new TableRow({
    tableHeader: true,
    children: [
      tableCell("기후 지표", { fill: colors.accent, bold: true, color: colors.white, width: 28 }),
      tableCell("첫 번째 자료", { fill: colors.accent, bold: true, color: colors.white, width: 24 }),
      tableCell("두 번째 자료", { fill: colors.accent, bold: true, color: colors.white, width: 24 }),
      tableCell("변화", { fill: colors.accent, bold: true, color: colors.white, width: 24 })
    ]
  })];

  baseline.values.forEach((previous) => {
    const current = comparison.values.find((metric) => metric.key === previous.key);
    if (!current) return;
    rows.push(new TableRow({
      children: [
        tableCell(cleanText(current.label, 80), { width: 28 }),
        tableCell(formatMetricValue(previous), { width: 24 }),
        tableCell(formatMetricValue(current), { width: 24 }),
        tableCell(formatDelta(current, current.value - previous.value), { width: 24 })
      ]
    }));
  });

  return new Table({
    borders: tableBorders,
    layout: TableLayoutType.FIXED,
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

export async function buildStudentNotebookDocx({ baseline, comparison, conclusion, focusLabel, note, problem }) {
  if (!baseline) {
    throw new TypeError("학생 탐구 기록을 만들려면 먼저 비교할 자료가 필요합니다.");
  }

  const overviewRows = [["탐구 주제", cleanText(focusLabel, 80) || "자유 탐구"]];
  if (problem?.presentation?.title) overviewRows.push(["탐구 제목", cleanText(problem.presentation.title, 200)]);
  if (problem?.inquiry?.question) overviewRows.push(["살펴볼 질문", cleanText(problem.inquiry.question, 800)]);
  if (problem?.dataPlan?.comparisonPeriods?.length) {
    problem.dataPlan.comparisonPeriods.forEach((period) => {
      const months = period.seasonMonths?.length ? ` · ${period.seasonMonths.join(", ")}월만` : "";
      overviewRows.push([cleanText(period.label, 80), `${cleanText(period.start, 20)} ~ ${cleanText(period.end, 20)}${months}`]);
    });
  } else if (problem?.dataPlan?.periodStart || problem?.dataPlan?.periodEnd) {
    overviewRows.push(["탐구 기간", `${cleanText(problem.dataPlan.periodStart, 20)} ~ ${cleanText(problem.dataPlan.periodEnd, 20)}`]);
  }
  if (problem?.roles?.student?.output?.length) {
    overviewRows.push(["만들 결과물", problem.roles.student.output.map((item) => cleanText(item, 200)).join(" · ")]);
  }
  if (problem?.inquiry?.interpretationLimit) {
    overviewRows.push(["해석할 때 주의할 점", cleanText(problem.inquiry.interpretationLimit, 1200)]);
  }
  if (problem?.microclimateExtension) {
    overviewRows.push(["열지수 계산에 직접 쓰는 값", problem.microclimateExtension.directIndexInputs.map((item) => cleanText(item, 100)).join(" · ")]);
    overviewRows.push(["주변의 더위에 영향을 줄 수 있는 환경", problem.microclimateExtension.backgroundFactors.map((item) => cleanText(item, 150)).join(" · ")]);
    overviewRows.push(["추가로 필요한 자료", problem.microclimateExtension.unavailableVariables.map((item) => cleanText(item, 150)).join(" · ")]);
  }
  const expectedOutputs = problem?.roles?.student?.output ?? [];

  const children = [
    textParagraph("기후 타임캡슐", {
      color: colors.accent,
      bold: true,
      size: 22,
      spacing: { after: 40 }
    }),
    textParagraph("기후 탐구 기록", {
      heading: HeadingLevel.TITLE,
      bold: true,
      size: 42,
      spacing: { after: 90 }
    }),
    textParagraph("실제 기후 시나리오에서 가져온 두 자료를 비교하는 활동", {
      color: colors.muted,
      size: 21,
      spacing: { after: 220 }
    }),
    keyValueTable(overviewRows),
    ...(expectedOutputs.length ? [
      textParagraph("결과 정리 계획", {
        bold: true,
        size: 22,
        spacing: { before: 180, after: 80 }
      }),
      outputPlanTable(expectedOutputs)
    ] : []),
    ...conditionSection("1. 첫 번째 자료", baseline)
  ];

  if (comparison) {
    children.push(...conditionSection("2. 두 번째 자료", comparison));
    children.push(
      textParagraph("3. 두 자료의 차이", {
        color: colors.accent,
        heading: HeadingLevel.HEADING_2,
        size: 28,
        bold: true,
        spacing: { before: 260, after: 120 }
      }),
      comparisonTable(baseline, comparison)
    );
  }

  let nextSectionNumber = comparison ? 4 : 2;
  if (cleanText(conclusion, 200)) {
    children.push(
      textParagraph(`${nextSectionNumber}. 자료가 보여주는 가능성`, {
        color: colors.accent,
        heading: HeadingLevel.HEADING_2,
        size: 28,
        bold: true,
        spacing: { before: 260, after: 120 }
      }),
      keyValueTable([["나의 판단", cleanText(conclusion, 200)]])
    );
    nextSectionNumber += 1;
  }

  children.push(
    textParagraph(`${nextSectionNumber}. 나의 발견`, {
      color: colors.accent,
      heading: HeadingLevel.HEADING_2,
      size: 28,
      bold: true,
      spacing: { before: 260, after: 120 }
    }),
    new Table({
      borders: tableBorders,
      rows: [new TableRow({
        children: [new TableCell({
          children: [textParagraph(cleanText(note) || "아직 작성한 내용이 없습니다.", {
            size: 21,
            spacing: { after: 0, line: 320 }
          })],
          margins: { top: 180, bottom: 180, left: 180, right: 180 },
          shading: { type: ShadingType.CLEAR, color: "auto", fill: colors.accentSoft },
          verticalAlign: VerticalAlign.CENTER
        })]
      })],
      width: { size: 100, type: WidthType.PERCENTAGE }
    }),
    textParagraph("자료를 읽을 때 주의할 점", {
      bold: true,
      color: colors.muted,
      size: 18,
      spacing: { before: 260, after: 60 }
    }),
    textParagraph("이 문서의 값은 기후 시나리오 자료에서 가져왔으며, 며칠 뒤의 날씨를 알려 주는 일기예보가 아닙니다.", {
      color: colors.muted,
      size: 18,
      spacing: { after: 0, line: 280 }
    })
  );

  const document = new Document({
    creator: "기후 타임캡슐",
    description: "실제 기후 시나리오 자료를 이용한 학생 탐구 기록",
    styles: {
      default: {
        document: {
          paragraph: { spacing: { after: 100, line: 300 } },
          run: { color: colors.ink, font: "Malgun Gothic", size: 21 }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 900, right: 900, bottom: 900, left: 900 }
        }
      },
      children
    }],
    title: "기후 타임캡슐 탐구 기록"
  });

  return Packer.toBlob(document);
}

const problemVariableLabels = {
  apparentTemperature: "월에 따라 열지수 또는 체감기온",
  precipitation: "강수량",
  tasmax: "최고기온",
  tasmin: "최저기온",
  wind: "풍속"
};

function pageSectionHeading(text) {
  return textParagraph(text, {
    bold: true,
    color: colors.accent,
    heading: HeadingLevel.HEADING_2,
    pageBreakBefore: true,
    size: 30,
    spacing: { after: 140 }
  });
}

function subsectionHeading(text) {
  return textParagraph(text, {
    bold: true,
    color: colors.ink,
    heading: HeadingLevel.HEADING_3,
    size: 23,
    spacing: { before: 180, after: 80 }
  });
}

function structuredTable(headers, rows, widths) {
  const tableRows = [new TableRow({
    tableHeader: true,
    children: headers.map((header, index) => tableCell(header, {
      bold: true,
      color: colors.white,
      fill: colors.accent,
      width: widths[index]
    }))
  })];
  rows.forEach((row) => tableRows.push(new TableRow({
    children: row.map((value, index) => tableCell(cleanText(value, 2000), { width: widths[index] }))
  })));
  return new Table({
    borders: tableBorders,
    layout: TableLayoutType.FIXED,
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

function formatPeriod(period) {
  const months = period?.seasonMonths?.length ? ` · ${period.seasonMonths.join(", ")}월만` : "";
  return `${cleanText(period?.start, 20)} ~ ${cleanText(period?.end, 20)}${months}`;
}

function plannedPeriodRows(problem, periodStart, periodEnd) {
  const periods = problem?.dataPlan?.comparisonPeriods;
  if (Array.isArray(periods) && periods.length > 0) {
    return periods.map((period) => [cleanText(period.label, 100) || "비교 기간", formatPeriod(period)]);
  }
  return [["탐구 기간", `${cleanText(problem?.dataPlan?.periodStart ?? periodStart, 20)} ~ ${cleanText(problem?.dataPlan?.periodEnd ?? periodEnd, 20)}`]];
}

function plannedSiteTable(sites) {
  return structuredTable(
    ["비교 지점", "장소 특징", "좌표"],
    sites.map((site) => [
      cleanText(site.label, 100),
      cleanText(site.detail, 200) || "직접 선택한 위치",
      formatCoordinatePair(site.latitude, site.longitude)
    ]),
    [25, 35, 40]
  );
}

function evidenceRequirementTable(requirements = {}) {
  const minimumSites = Number.isFinite(requirements.minimumSites) ? requirements.minimumSites : 1;
  const minimumModels = Number.isFinite(requirements.minimumModels) ? requirements.minimumModels : 1;
  return structuredTable(
    ["확인할 근거", "수업에서 지킬 기준"],
    [
      ["비교 지점", `${minimumSites}곳 이상`],
      ["기후 모델(CMIP6)", `${minimumModels}개 이상`],
      ["여러 모델 종합값", requirements.includeEnsemble ? "개별 모델과 함께 확인" : "필요할 때 참고"]
    ],
    [38, 62]
  );
}

function teachingFlowTable({ inquiryQuestion, studentPrompt, requirements }) {
  const minimumSites = Number.isFinite(requirements?.minimumSites) ? requirements.minimumSites : 1;
  const minimumModels = Number.isFinite(requirements?.minimumModels) ? requirements.minimumModels : 1;
  return structuredTable(
    ["단계", "학생 활동", "교사가 확인할 점"],
    [
      ["질문 이해", cleanText(inquiryQuestion, 1000) || "탐구 질문을 읽고 알고 싶은 점을 정합니다.", "처음 생각과 그 까닭을 먼저 적게 합니다."],
      ["가설 세우기", "자료를 보기 전에 나타날 수 있는 결과를 예상합니다.", "정답을 고르게 하기보다 여러 가능성을 열어 둡니다."],
      ["자료 비교", cleanText(studentPrompt, 1200) || "위치·기간·기후 모델을 바꾸어 자료를 비교합니다.", `서로 다른 지점 ${minimumSites}곳과 기후 모델 ${minimumModels}개 이상을 확인하게 합니다.`],
      ["근거 정리", "그래프와 표에서 결론을 뒷받침하는 값을 고릅니다.", "자료가 없는 경우를 0으로 바꾸지 않았는지 확인합니다."],
      ["결론 쓰기", "주장·근거·한계가 드러나도록 결과를 정리합니다.", "한 가지 결과를 미래 전체의 확정된 사실처럼 쓰지 않게 합니다."]
    ],
    [18, 43, 39]
  );
}

function studentResponseTable() {
  const prompts = [
    "나의 가설과 그렇게 생각한 까닭",
    "비교한 위치·기간·배출 경로·기후 모델",
    "그래프나 표에서 찾은 가장 중요한 값",
    "다른 기후 모델에서 같거나 다르게 나타난 점",
    "자료만으로 설명하기 어려운 점과 추가로 필요한 자료",
    "자료가 보여 주는 가능성과 최종 결론"
  ];
  const rows = [new TableRow({
    tableHeader: true,
    children: [
      tableCell("기록할 내용", { bold: true, color: colors.white, fill: colors.accent, width: 38 }),
      tableCell("학생 기록", { bold: true, color: colors.white, fill: colors.accent, width: 62 })
    ]
  })];
  prompts.forEach((prompt) => rows.push(new TableRow({
    children: [
      tableCell(prompt, { bold: true, width: 38 }),
      new TableCell({
        children: [textParagraph("", { spacing: { after: 180, line: 320 } }), textParagraph("", { spacing: { after: 180, line: 320 } })],
        margins: { top: 140, bottom: 140, left: 160, right: 160 },
        verticalAlign: VerticalAlign.TOP,
        width: { size: 62, type: WidthType.PERCENTAGE }
      })
    ]
  })));
  return new Table({
    borders: tableBorders,
    layout: TableLayoutType.FIXED,
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE }
  });
}

function assessmentTable(criteria) {
  return structuredTable(
    ["확인 기준", "확인 결과", "교사 기록"],
    criteria.map((criterion) => [criterion, "□ 충분  □ 보완", ""]),
    [52, 28, 20]
  );
}

function extensionSections(problem) {
  const sections = [];
  if (problem?.microclimateExtension) {
    sections.push(
      subsectionHeading("장소별 기후 차이 조사"),
      textParagraph(problem.microclimateExtension.prompt, { spacing: { after: 100, line: 300 } }),
      keyValueTable([
        ["열지수 계산에 직접 쓰는 요소", problem.microclimateExtension.directIndexInputs.join(" · ")],
        ["주변의 더위에 영향을 줄 수 있는 환경", problem.microclimateExtension.backgroundFactors.join(" · ")],
        ["추가로 필요한 자료", problem.microclimateExtension.unavailableVariables.join(" · ")]
      ])
    );
  }
  if (problem?.mystery) {
    sections.push(
      subsectionHeading("생각을 바로잡는 수업 진행"),
      ...[
        "좌표와 지명을 숨긴 네 가지 기후 지표를 먼저 보여 줍니다.",
        "학생이 후보를 고르고 자료에서 찾은 근거를 말하게 합니다.",
        "두 비교 지점의 계절별 자료를 나란히 살펴봅니다.",
        `위치를 공개한 뒤 ‘${cleanText(problem.mystery.reveal?.answer, 100)}’이라고 판단할 수 있는 범위와 한계를 구분합니다.`
      ].map(bulletParagraph),
      subsectionHeading("교사가 먼저 확인한 자료"),
      ...Object.values(problem.validationEvidence ?? {}).map((item) => bulletParagraph(item))
    );
  }
  return sections;
}

export async function buildTeacherActivityDocx({
  lessonTitle,
  objective,
  snapshots,
  studentLink,
  inquiryQuestion,
  comparisonPeriods,
  hypothesisChoices,
  periodStart,
  periodEnd,
  expectedOutputs,
  assessmentCriteria,
  interpretationLimit,
  problem
}) {
  const usableSnapshots = Array.isArray(snapshots) ? snapshots.filter((snapshot) => snapshot && Array.isArray(snapshot.values)) : [];
  if (usableSnapshots.length === 0) {
    throw new TypeError("수업 활동지를 만들려면 비교할 기후 자료가 하나 이상 필요합니다.");
  }

  const resolvedQuestion = cleanText(inquiryQuestion ?? problem?.inquiry?.question, 1000);
  const resolvedObjective = cleanText(objective ?? problem?.inquiry?.objective, 1000) || "기후 자료를 비교하고 근거와 한계를 설명합니다.";
  const resolvedHypotheses = hypothesisChoices?.length ? hypothesisChoices : problem?.inquiry?.hypothesisChoices ?? [];
  const resolvedOutputs = expectedOutputs?.length ? expectedOutputs : problem?.roles?.student?.output ?? [];
  const resolvedAssessment = assessmentCriteria?.length ? assessmentCriteria : problem?.roles?.teacher?.assessmentCriteria ?? [];
  const resolvedLimit = cleanText(interpretationLimit ?? problem?.inquiry?.interpretationLimit, 2000)
    || "기후 시나리오 자료는 미래에 나타날 수 있는 가능성을 살펴보는 자료이며 특정 날짜의 일기예보가 아닙니다.";
  const resolvedStudentPrompt = cleanText(problem?.roles?.student?.prompt, 1200);
  const resolvedRequirements = problem?.evidenceRequirements ?? {};
  const resolvedPeriods = problem?.dataPlan?.comparisonPeriods ?? comparisonPeriods ?? [];
  const resolvedPeriodStart = problem?.dataPlan?.periodStart ?? periodStart;
  const resolvedPeriodEnd = problem?.dataPlan?.periodEnd ?? periodEnd;
  const resolvedSites = problem?.dataPlan?.sites?.length
    ? problem.dataPlan.sites
    : usableSnapshots.map((snapshot) => ({
      detail: "저장된 비교 자료",
      label: snapshot.label,
      latitude: snapshot.latitude,
      longitude: snapshot.longitude
    }));
  const resolvedVariableKeys = problem?.dataPlan?.variableKeys?.length
    ? [...problem.dataPlan.variableKeys, ...(problem.dataPlan.derivedKeys ?? [])]
    : usableSnapshots[0].values.map((metric) => metric.key);
  const planningProblem = {
    dataPlan: {
      comparisonPeriods: resolvedPeriods,
      periodEnd: resolvedPeriodEnd,
      periodStart: resolvedPeriodStart
    }
  };

  const overviewRows = [
    ["수업명", cleanText(lessonTitle, 200) || cleanText(problem?.presentation?.title, 200) || "기후 자료 탐구 수업"],
    ["학습 목표", resolvedObjective]
  ];
  if (resolvedQuestion) overviewRows.push(["탐구 질문", resolvedQuestion]);
  plannedPeriodRows(planningProblem, resolvedPeriodStart, resolvedPeriodEnd).forEach((row) => overviewRows.push(row));
  if (cleanText(studentLink, 2000)) overviewRows.push(["학생 화면 주소", cleanText(studentLink, 2000)]);

  const children = [
    textParagraph("기후 타임캡슐", {
      color: colors.accent,
      bold: true,
      size: 22,
      spacing: { after: 40 }
    }),
    textParagraph("기후 탐구 수업 활동지", {
      heading: HeadingLevel.TITLE,
      bold: true,
      size: 42,
      spacing: { after: 90 }
    }),
    textParagraph("실제 기후 시나리오 자료를 바탕으로 수업 흐름과 비교 근거를 정리한 문서", {
      color: colors.muted,
      size: 21,
      spacing: { after: 220 }
    }),
    keyValueTable(overviewRows),
    textParagraph("문서 구성", { bold: true, size: 22, spacing: { before: 220, after: 80 } }),
    ...[
      "탐구 설계와 비교 기준",
      "기간·지점·기후 지표를 포함한 자료 계획",
      "현재 수업에서 저장한 실제 기후 자료",
      "학생 기록지와 교사 평가표",
      "자료 해석 범위와 확장 활동"
    ].map(bulletParagraph),
    pageSectionHeading("1. 탐구 설계"),
    subsectionHeading("학생에게 제시할 질문"),
    textParagraph(resolvedQuestion || "위치·기간·기후 모델에 따라 기후 자료는 어떻게 다르게 나타날까요?", { spacing: { after: 120, line: 310 } }),
    subsectionHeading("학생이 수행할 탐구"),
    textParagraph(resolvedStudentPrompt || "위치·기간·기후 모델을 바꾸어 두 개 이상의 자료를 비교하고, 근거와 한계를 함께 정리합니다.", { spacing: { after: 120, line: 310 } }),
    subsectionHeading("자료를 보기 전에 세울 수 있는 가설"),
    ...(resolvedHypotheses.length ? resolvedHypotheses : ["자료를 비교한 뒤 판단합니다."]).map(checkboxParagraph),
    subsectionHeading("결론에 필요한 근거"),
    evidenceRequirementTable(resolvedRequirements),
    pageSectionHeading("2. 수업 진행 흐름"),
    teachingFlowTable({ inquiryQuestion: resolvedQuestion, studentPrompt: resolvedStudentPrompt, requirements: resolvedRequirements }),
    pageSectionHeading("3. 자료 준비 계획"),
    subsectionHeading("살펴볼 기간과 기후 지표"),
    structuredTable(
      ["구분", "수업 조건"],
      [
        ...plannedPeriodRows(planningProblem, resolvedPeriodStart, resolvedPeriodEnd),
        ["기후 지표", resolvedVariableKeys.map((key) => problemVariableLabels[key] ?? cleanText(key, 80)).join(" · ")],
        ["배출 경로", cleanText(problem?.dataPlan?.scenario ?? usableSnapshots[0].scenario, 120)],
        ["기본 기후 모델", cleanText(problem?.dataPlan?.defaultModel ?? usableSnapshots[0].model, 160)]
      ],
      [28, 72]
    ),
    subsectionHeading("비교할 지점"),
    plannedSiteTable(resolvedSites),
    textParagraph("아래 실제 비교 자료에는 수업 화면에서 직접 확인하고 저장한 값만 들어갑니다. 계획에 있는 다른 지점의 값은 임의로 채우지 않습니다.", {
      color: colors.muted,
      size: 18,
      spacing: { before: 160, after: 0, line: 280 }
    })
  ];

  let sectionNumber = 4;

  usableSnapshots.forEach((snapshot, index) => {
    children.push(...conditionSection(`${sectionNumber}. 실제 비교 자료 ${index + 1}`, snapshot, { pageBreakBefore: true }));
    children.push(
      subsectionHeading("이 자료에서 확인할 내용"),
      ...[
        "선택한 날짜의 값이 탐구 기간 전체를 대표한다고 단정하지 않습니다.",
        "같은 지점에서 날짜나 기후 모델을 바꾸었을 때 값이 어떻게 달라지는지 확인합니다.",
        "자료가 제공되지 않은 기후 지표는 0이 아니라 ‘자료 없음’으로 기록합니다."
      ].map(bulletParagraph)
    );
    sectionNumber += 1;
  });

  if (usableSnapshots.length >= 2) {
    children.push(
      pageSectionHeading(`${sectionNumber}. 첫 번째 자료와 두 번째 자료의 차이`),
      comparisonTable(usableSnapshots[0], usableSnapshots[1]),
      subsectionHeading("차이를 읽을 때 확인할 질문"),
      ...[
        "두 자료에서 같은 기후 지표를 비교했나요?",
        "위치·날짜·배출 경로·기후 모델 가운데 무엇이 달라졌나요?",
        "이 차이가 다른 날짜와 다른 기후 모델에서도 나타나는지 확인했나요?"
      ].map(checkboxParagraph)
    );
    sectionNumber += 1;
  }

  children.push(
    pageSectionHeading(`${sectionNumber}. 학생 활동 기록지`),
    textParagraph("그래프와 표에서 직접 확인한 값을 근거로 작성하세요. 자료가 보여 주지 않는 원인은 추측과 확인된 사실을 구분해 적습니다.", {
      color: colors.muted,
      size: 19,
      spacing: { after: 120, line: 300 }
    }),
    studentResponseTable()
  );
  sectionNumber += 1;

  children.push(
    pageSectionHeading(`${sectionNumber}. 학생 결과물 정리`),
    textParagraph("각 결과물에는 사용한 위치·기간·배출 경로·기후 모델과 그래프 또는 표에서 확인한 근거를 함께 적습니다.", {
      color: colors.muted,
      size: 19,
      spacing: { after: 120, line: 300 }
    }),
    outputPlanTable(resolvedOutputs.length ? resolvedOutputs : ["비교표", "근거가 드러나는 결론"])
  );
  sectionNumber += 1;

  children.push(
    pageSectionHeading(`${sectionNumber}. 교사 지도와 평가`),
    subsectionHeading("평가 기준"),
    assessmentTable(resolvedAssessment.length ? resolvedAssessment : ["자료에서 확인한 근거와 해석의 한계를 함께 적는다"]),
    subsectionHeading("학생에게 되물을 질문"),
    ...[
      "그 결론을 뒷받침하는 날짜와 값은 무엇인가요?",
      "다른 지점이나 기후 모델에서도 같은 결과가 나타났나요?",
      "자료가 없는 경우와 값이 0인 경우를 구분했나요?",
      "이 자료만으로 알 수 없는 것은 무엇인가요?"
    ].map(bulletParagraph)
  );
  sectionNumber += 1;

  children.push(
    pageSectionHeading(`${sectionNumber}. 자료 해석 범위와 확장 활동`),
    subsectionHeading("자료를 읽을 때 주의할 점"),
    textParagraph(resolvedLimit, { color: colors.muted, size: 19, spacing: { after: 90, line: 300 } }),
    textParagraph("자료가 없는 경우를 0으로 바꾸지 말고, 선택한 위치·기간·배출 경로·기후 모델을 결과물에 함께 적으세요.", {
      color: colors.muted,
      size: 19,
      spacing: { after: 140, line: 300 }
    }),
    ...extensionSections(problem),
    subsectionHeading("다음 탐구로 이어 가기"),
    ...[
      "다른 배출 경로 또는 다른 시기의 자료에서도 같은 경향이 나타나는지 확인합니다.",
      "여러 기후 모델의 공통점뿐 아니라 서로 다른 결과도 함께 기록합니다.",
      "기후 모델 자료와 지역 관측 자료가 나타내는 공간 규모의 차이를 구분합니다."
    ].map(bulletParagraph)
  );

  const document = new Document({
    creator: "기후 타임캡슐",
    description: "실제 기후 시나리오 자료를 이용한 교사용 탐구 수업 활동지",
    styles: {
      default: {
        document: {
          paragraph: { spacing: { after: 100, line: 300 } },
          run: { color: colors.ink, font: "Malgun Gothic", size: 21 }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 900, right: 900, bottom: 720, left: 900 }
        }
      },
      children
    }],
    title: "기후 타임캡슐 수업 활동지"
  });

  return Packer.toBlob(document);
}
