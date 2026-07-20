import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream
} from "pdf-lib";
import {
  buildClimatePdfBlob,
  buildPdfAttributionContent,
  pdfCanvasSliceRanges,
  pdfImageDimensionsAtWidth,
  pdfSourceStatement,
  selectPdfAttributionModels,
  verifiedPdfCcByLicense,
  wrapPdfText
} from "../source/climate-pdf.js";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = await fs.readFile(path.join(root, "source", "climate-pdf.js"), "utf8");
const publicAppSource = await fs.readFile(path.join(root, "source", "public-app.js"), "utf8");
const pretendardTtfUrl = new URL(
  "../node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf",
  import.meta.url
).href;
const validResponse = Object.freeze({
  dataMode: "bias-corrected",
  model: "MIROC6",
  scenario: "SSP5-8.5",
  dateStart: "2030-01-01",
  dateEnd: "2030-12-31",
  latitude: 37.5665,
  longitude: 126.978,
  datasetVersion: "a".repeat(64),
  datasetUpdatedAt: "2026-07-15T02:30:40.123456+00:00",
  generatedAt: "2026-07-15T12:34:56.000Z"
});
const tinyJpeg = new Uint8Array(Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////"
  + "2wBDAf//////////////////////////////////////////////////////////////////////////////////////"
  + "wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/"
  + "9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/"
  + "aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/"
  + "aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/"
  + "xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/"
  + "9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==",
  "base64"
));

test("PDF 보고서 면은 지표 그래프 사이에서만 나뉜다", () => {
  const ranges = pdfCanvasSliceRanges({
    width: 1600,
    height: 1825,
    pageBreaks: [390, 620, 850, 1080, 1310, 1540]
  });
  assert.deepEqual(ranges, [
    { sourceY: 0, sliceHeight: 1080 },
    { sourceY: 1080, sliceHeight: 745 }
  ]);
  assert.match(publicAppSource, /Object\.defineProperty\(canvas, "pdfPageBreaks"/u);
  assert.match(source, /pageBreaks:\s*canvas\.pdfPageBreaks/u);
});

test("PDF 인용 부록은 단일 모델과 전체 앙상블의 DOI 범위를 구분한다", () => {
  assert.equal(selectPdfAttributionModels("MIROC6").length, 1);
  assert.equal(selectPdfAttributionModels("전체 앙상블").length, 6);
  assert.throws(() => selectPdfAttributionModels("알 수 없는 모델"), /인용 정보/u);

  const single = buildPdfAttributionContent(validResponse);
  const ensemble = buildPdfAttributionContent({ ...validResponse, model: "전체 앙상블" });
  assert.equal(single.modelGroups.length, 1);
  assert.equal(single.modelGroups.flatMap((model) => model.citations).length, 2);
  assert.equal(ensemble.modelGroups.length, 6);
  assert.equal(ensemble.modelGroups.flatMap((model) => model.citations).length, 13);
});

test("PDF는 원자료와 KMA ASOS 보정 자료를 엄격히 구분한다", () => {
  const raw = pdfSourceStatement({ dataMode: "raw-model-grid" });
  const corrected = pdfSourceStatement({ dataMode: "bias-corrected" });
  assert.match(raw, /CMIP6 기후 모델 격자 원자료/u);
  assert.match(raw, /KMA\) ASOS 관측 보정은 적용하지 않았/u);
  assert.match(corrected, /KMA\) ASOS 관측자료로 보정한 결과/u);
  assert.doesNotMatch(corrected, /적용하지 않았/u);
  assert.throws(() => pdfSourceStatement({ dataMode: "unknown-mode" }), /자료 유형/u);
});

test("PDF attribution content는 creator·year·title·DOI와 공개 식별 정보를 완결한다", () => {
  const content = buildPdfAttributionContent(validResponse);
  const modelCitations = content.modelGroups.flatMap((model) => model.citations);
  assert.equal(content.context.datasetVersion, validResponse.datasetVersion);
  assert.equal(content.context.datasetUpdatedAt, validResponse.datasetUpdatedAt);
  assert.equal(content.context.generatedAt, validResponse.generatedAt);
  assert.equal(content.project.creator.displayName, "Geonho Kim (김건호)");
  assert.equal(content.project.creator.githubHandle, "@fallingenie");
  assert.equal(content.project.creator.githubUrl, "https://github.com/fallingenie");
  assert.equal(content.project.repositoryUrl, "https://github.com/fallingenie/CTC_Latte_WebUI");
  assert.equal(content.project.license.identifier, "GPL-3.0-only");

  for (const citation of [...modelCitations, ...content.methodologyCitations]) {
    assert.ok(citation.creator);
    assert.ok(citation.year);
    assert.ok(citation.title);
    assert.match(citation.doi, /^10\./u);
  }
  assert.ok(modelCitations.every((citation) => citation.year === "저장소 메타데이터 미기재"));
  assert.deepEqual(
    content.methodologyCitations.map((citation) => citation.year),
    ["2020", "2015", "1968", "2024"]
  );

  const serialized = JSON.stringify(content);
  assert.doesNotMatch(serialized, /CC BY-NC-SA/iu);
  assert.doesNotMatch(serialized, /CC BY(?:\s|$)/iu);
});

test("PDF는 완전한 저장소 attribution 메타데이터가 있을 때만 CC BY를 표시한다", () => {
  const complete = {
    authors: [{ name: "Public Dataset Creator" }],
    title: "Public climate dataset",
    year: 2025,
    source: { doi: "10.1234/public.dataset" },
    license: "CC BY 4.0",
    changesMade: false
  };
  assert.equal(verifiedPdfCcByLicense(complete), "CC BY 4.0");
  assert.equal(verifiedPdfCcByLicense({ ...complete, year: null }), null);
  assert.equal(verifiedPdfCcByLicense({ ...complete, changesMade: null }), null);
  assert.equal(verifiedPdfCcByLicense({ ...complete, license: "CC BY-NC-SA 4.0" }), null);
});

test("PDF 공개 content는 비공개 경로와 불완전한 자료 식별자를 거부한다", () => {
  assert.throws(
    () => buildPdfAttributionContent({ ...validResponse, scenario: "E:\\private\\model.nc" }),
    /공개할 수 없는/u
  );
  assert.throws(
    () => buildPdfAttributionContent({ ...validResponse, scenario: "/srv/private/model.nc" }),
    /공개할 수 없는/u
  );
  assert.throws(
    () => buildPdfAttributionContent({ ...validResponse, datasetVersion: "short" }),
    /datasetVersion/u
  );
  assert.throws(
    () => buildPdfAttributionContent({ ...validResponse, generatedAt: "not-a-date" }),
    /generatedAt/u
  );
});

test("PDF는 저장소 원본 KMA PNG를 직접 사용하고 종횡비를 보존한다", async () => {
  const markOne = await readPngDimensions(path.join(root, "source", "public", "assets", "licenses", "kma_mark_1.png"));
  const markTwo = await readPngDimensions(path.join(root, "source", "public", "assets", "licenses", "kma_mark_2.png"));
  assert.deepEqual(markOne, { width: 200, height: 70 });
  assert.deepEqual(markTwo, { width: 149, height: 54 });
  assert.equal(pdfImageDimensionsAtWidth(markOne, 120).height, 42);
  assert.equal(pdfImageDimensionsAtWidth(markTwo, 100).height, 100 * 54 / 149);
  assert.match(source, /\.\/assets\/licenses\/kma_mark_1\.png/u);
  assert.match(source, /\.\/assets\/licenses\/kma_mark_2\.png/u);
  assert.match(source, /pdf\.embedPng\(markOneBytes\)/u);
  assert.match(source, /pdf\.embedPng\(markTwoBytes\)/u);
  assert.doesNotMatch(source, /CC BY-NC-SA 4\.0/u);
});

test("PDF 줄바꿈은 긴 DOI처럼 공백이 없는 문자열도 폭 안에서 나눈다", () => {
  const font = { widthOfTextAtSize: (value) => Array.from(value).length * 10 };
  const lines = wrapPdfText(font, "10.22033/ESGF/CMIP6.11249", 10, 60);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => Array.from(line).length <= 6));
});

test("생성 PDF는 보고서 면과 동적 한글 텍스트 부록, 원본 PNG, 공개 메타데이터를 가진다", async () => {
  const fetchedPaths = [];
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  globalThis.document = {
    createElement(elementName) {
      assert.equal(elementName, "canvas");
      return {
        width: 0,
        height: 0,
        getContext(contextName) {
          assert.equal(contextName, "2d");
          return {
            fillStyle: "",
            fillRect() {},
            drawImage() {}
          };
        },
        toBlob(callback, mimeType) {
          assert.equal(mimeType, "image/jpeg");
          callback(new Blob([tinyJpeg], { type: mimeType }));
        }
      };
    }
  };
  globalThis.fetch = async (assetPath) => {
    fetchedPaths.push(String(assetPath));
    const filePath = publicAssetPath(assetPath);
    const bytes = await fs.readFile(filePath);
    return {
      ok: true,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
    };
  };

  try {
    const reportCanvas = { width: 100, height: 50, getContext() { return {}; } };
    const blob = await buildClimatePdfBlob(reportCanvas, { ...validResponse, model: "전체 앙상블" });
    assert.equal(blob.type, "application/pdf");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    const pages = pdf.getPages();

    assert.ok(pages.length >= 5, `보고서 1면과 동적 부록 4면 이상이 필요하지만 ${pages.length}면입니다.`);
    assert.ok(pages[0].getWidth() > pages[0].getHeight());
    assert.ok(pages.slice(1).every((page) => page.getHeight() > page.getWidth()));
    assert.equal(pdf.getTitle(), "기후 변화 기간 자료 보고서");
    assert.equal(pdf.getAuthor(), "Geonho Kim (김건호)");
    assert.equal(pdf.getCreator(), "Geonho Kim (김건호)");
    assert.match(pdf.getSubject(), /KMA ASOS/u);
    assert.equal(pdf.getCreationDate().toISOString(), validResponse.generatedAt);

    const appendixOperators = pages.slice(1).map(decodedPageOperators);
    assert.ok(appendixOperators.every((operators) => /\bBT\b/u.test(operators)));
    assert.ok(appendixOperators.every((operators) => /\bTf\b/u.test(operators)));
    assert.ok(appendixOperators.every((operators) => /\bTj\b/u.test(operators)));
    assert.equal(hasToUnicodeFont(pdf), true);

    const imageDimensions = embeddedImageDimensions(pdf);
    assert.ok(imageDimensions.some(({ width, height }) => width === 200 && height === 70));
    assert.ok(imageDimensions.some(({ width, height }) => width === 149 && height === 54));
    assert.deepEqual(
      new Set(fetchedPaths),
      new Set([
        pretendardTtfUrl,
        "./assets/licenses/kma_mark_1.png",
        "./assets/licenses/kma_mark_2.png"
      ])
    );
    assert.doesNotMatch(Buffer.from(bytes).toString("latin1"), /E:\\|\/srv\/|\/home\//iu);
  } finally {
    restoreGlobal("document", originalDocument);
    restoreGlobal("fetch", originalFetch);
  }
});

async function readPngDimensions(filePath) {
  const bytes = await fs.readFile(filePath);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function publicAssetPath(assetPath) {
  if (String(assetPath).startsWith("file:")) {
    const resolved = fileURLToPath(assetPath);
    assert.equal(resolved, fileURLToPath(pretendardTtfUrl));
    return resolved;
  }
  const normalized = String(assetPath).replace(/^\.\/assets\//u, "");
  const resolved = path.resolve(root, "source", "public", "assets", normalized);
  const publicRoot = path.resolve(root, "source", "public", "assets");
  assert.ok(resolved.startsWith(`${publicRoot}${path.sep}`));
  return resolved;
}

function decodedPageOperators(page) {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, index) => contents.lookup(index, PDFRawStream))
    : [contents];
  return streams.map((stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1")).join("\n");
}

function embeddedImageDimensions(pdf) {
  const dimensions = [];
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    const dictionary = object instanceof PDFRawStream
      ? object.dict
      : object instanceof PDFDict ? object : undefined;
    if (!dictionary) continue;
    const subtype = dictionary.lookupMaybe(PDFName.of("Subtype"), PDFName);
    if (subtype?.toString() !== "/Image") continue;
    const width = dictionary.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = dictionary.lookup(PDFName.of("Height"), PDFNumber).asNumber();
    dimensions.push({ width, height });
  }
  return dimensions;
}

function hasToUnicodeFont(pdf) {
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    const type = object.lookupMaybe(PDFName.of("Type"), PDFName);
    if (type?.toString() === "/Font" && object.has(PDFName.of("ToUnicode"))) return true;
  }
  return false;
}

function restoreGlobal(name, value) {
  if (value === undefined) {
    delete globalThis[name];
  } else {
    globalThis[name] = value;
  }
}
