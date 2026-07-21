import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { buildCsvWorkspaceShareFiles } from "../source/export-share.js";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const csvSpecification = {
  filename: "climate.csv",
  mimeType: "text/csv;charset=utf-8",
  extension: ".csv",
  description: "기후 자료"
};

async function attributionBundle({ includeSecondMark = true } = {}) {
  const zip = new JSZip();
  zip.file("licenses/kma_mark_1.png", png);
  if (includeSecondMark) zip.file("licenses/kma_mark_2.png", png);
  return new Blob([await zip.generateAsync({ type: "uint8array" })], { type: "application/zip" });
}

test("Workspace용 CSV 공유는 표와 기상청 원본 표장 두 개를 함께 준비한다", async () => {
  const csvBlob = new Blob(["\uFEFFdate,value\r\n2050-08-01,33.7\r\n"], { type: csvSpecification.mimeType });
  const files = await buildCsvWorkspaceShareFiles(await attributionBundle(), csvBlob, csvSpecification);

  assert.deepEqual(files.map(({ filename, mimeType }) => ({ filename, mimeType })), [
    { filename: "climate.csv", mimeType: "text/csv" },
    { filename: "kma_mark_1.png", mimeType: "image/png" },
    { filename: "kma_mark_2.png", mimeType: "image/png" }
  ]);
  assert.equal(await files[0].blob.text(), await csvBlob.text());
  assert.deepEqual(new Uint8Array(await files[1].blob.arrayBuffer()), png);
  assert.deepEqual(new Uint8Array(await files[2].blob.arrayBuffer()), png);
});

test("출처 표장이 하나라도 없으면 불완전한 공유 파일을 만들지 않는다", async () => {
  await assert.rejects(
    buildCsvWorkspaceShareFiles(await attributionBundle({ includeSecondMark: false }), new Blob(["date,value"]), csvSpecification),
    /기상청 출처 표시 파일/u
  );
});
