import test from "node:test";
import assert from "node:assert/strict";
import { buildGoogleDocsImportHtml } from "../source/docx-google-docs.js";
import { buildStudentNotebookDocx } from "../source/student-docx.js";

const baseline = {
  date: "2050-08-01",
  label: "대전",
  latitude: 36.35,
  longitude: 127.38,
  model: "전체 앙상블",
  scenario: "고배출 경로",
  values: [
    { key: "tasmax", label: "최고기온", unit: "degC", value: 36.69 },
    { key: "pr", label: "강수량", unit: "mm/day", value: 1.5 }
  ]
};

test("DOCX를 Google 문서에서 가져올 수 있는 안전한 HTML로 바꾼다", async () => {
  const docx = await buildStudentNotebookDocx({
    baseline,
    conclusion: "자료는 미래에 나타날 수 있는 가능성을 보여 줍니다.",
    focusLabel: "미래 더위",
    note: "최고기온과 강수량을 함께 비교했습니다."
  });
  const htmlBlob = await buildGoogleDocsImportHtml(docx, { title: "기후 탐구 기록" });
  const html = await htmlBlob.text();

  assert.equal(htmlBlob.type, "text/html;charset=utf-8");
  assert.match(html, /<!doctype html>/iu);
  assert.match(html, /<meta charset="utf-8">/u);
  assert.match(html, /<title>기후 탐구 기록<\/title>/u);
  assert.match(html, /<table>/u);
  assert.match(html, /최고기온/u);
  assert.match(html, /36\.69℃/u);
  assert.match(html, /최고기온과 강수량을 함께 비교했습니다\./u);
  assert.doesNotMatch(html, /<script|javascript:|Codex|\.ctwebui|\.ctcapsule/iu);
});

test("DOCX가 아닌 입력은 Google 문서용 빈 파일로 바꾸지 않는다", async () => {
  await assert.rejects(
    buildGoogleDocsImportHtml(new Blob(["not-a-docx"])),
    /DOCX|zip/iu
  );
});
