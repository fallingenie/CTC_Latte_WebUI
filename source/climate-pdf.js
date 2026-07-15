import {
  PUBLIC_ATTRIBUTION_CATALOG,
  findClimateModelAttribution,
  isCompleteCcByAttribution
} from "./attribution-catalog.js";
import {
  BIAS_CORRECTED_DATA_MODE,
  RAW_MODEL_GRID_DATA_MODE,
  buildPublicExportAttribution
} from "./export-attribution.js";

const A4_LANDSCAPE = [841.89, 595.28];
const A4_PORTRAIT = [595.28, 841.89];
const MARK_PATHS = Object.freeze([
  "./assets/licenses/kma_mark_1.png",
  "./assets/licenses/kma_mark_2.png"
]);
const FONT_PATH = new URL(
  "../node_modules/pretendard/dist/public/static/alternative/Pretendard-Regular.ttf",
  import.meta.url
).href;
const MISSING_YEAR_LABEL = "저장소 메타데이터 미기재";
const DATASET_VERSION_PATTERN = /^[0-9a-f]{64}$/u;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const PRIVATE_PATH_PATTERNS = Object.freeze([
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u,
  /\b(?:file|gs|gcs|s3|az|ssh):\/\//iu,
  /(?:^|[\s"'`(=,:])(?:[a-z]:[\\/]|\\\\[^\\\s]+[\\/])/imu,
  /(?:^|[\s"'`(=])\/(?:home|users|mnt|tmp|var|srv|opt|volumes)(?:\/|$)/imu,
  /(?:^|[\s"'`(=])~[\\/]/mu,
  /\b(?:drive\.google\.com|storage\.googleapis\.com|storage\.cloud\.google\.com|console\.cloud\.google\.com)\b/iu,
  /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/iu
]);
const APPENDIX_LAYOUT = Object.freeze({
  left: 44,
  right: 551,
  top: 746,
  bottom: 48,
  width: 507
});

export function selectPdfAttributionModels(modelName) {
  if (modelName === "전체 앙상블") return [...PUBLIC_ATTRIBUTION_CATALOG.climateModels];
  const selected = findClimateModelAttribution(modelName);
  if (!selected) throw new TypeError(`인용 정보를 확인할 수 없는 기후 모델입니다: ${String(modelName ?? "")}`);
  return [selected];
}

export function pdfSourceStatement(response) {
  if (response?.dataMode === RAW_MODEL_GRID_DATA_MODE) {
    return "선택 좌표의 CMIP6 기후 모델 격자 원자료(raw grid)를 사용했으며, 대한민국 기상청(KMA) ASOS 관측 보정은 적용하지 않았습니다.";
  }
  if (response?.dataMode === BIAS_CORRECTED_DATA_MODE) {
    return "CMIP6 기후 모델 원자료를 대한민국 기상청(KMA) ASOS 관측자료로 보정한 결과입니다.";
  }
  throw new TypeError("PDF 자료 유형은 raw-model-grid 또는 bias-corrected여야 합니다.");
}

export function verifiedPdfCcByLicense(citation) {
  const candidate = {
    author: formatCitationCreators(citation?.authors),
    title: citation?.title,
    year: citation?.year,
    source: citation?.source,
    license: citation?.license,
    changesMade: citation?.changesMade
  };
  return isCompleteCcByAttribution(candidate) ? candidate.license.trim() : null;
}

export function pdfImageDimensionsAtWidth(image, width) {
  const sourceWidth = Number(image?.width);
  const sourceHeight = Number(image?.height);
  const targetWidth = Number(width);
  if (![sourceWidth, sourceHeight, targetWidth].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("PDF 원본 이미지 크기를 확인할 수 없습니다.");
  }
  return { width: targetWidth, height: targetWidth * sourceHeight / sourceWidth };
}

export function buildPdfAttributionContent(response) {
  const context = normalizePdfResponse(response);
  const attribution = buildPublicExportAttribution({
    dataMode: context.dataMode,
    model: context.model
  });
  const content = {
    context,
    sourceStatement: pdfSourceStatement(context),
    asosCorrection: {
      used: attribution.asosCorrection.used,
      notice: attribution.asosCorrection.notice,
      source: attribution.asosCorrection.source
    },
    project: {
      title: attribution.project.title,
      version: attribution.project.version,
      year: attribution.project.year,
      creator: attribution.project.creator,
      repositoryUrl: attribution.project.repositoryUrl,
      license: attribution.project.license
    },
    modelGroups: attribution.climateModels.map((model) => ({
      name: requireCatalogText(model.name, "기후 모델 이름"),
      institution: requireCatalogText(model.institution, "기후 모델 기관"),
      citations: model.citations.map((citation) => buildPdfCitation(citation, {
        activity: requireCatalogText(citation.activity, "기후 모델 활동")
      }))
    })),
    methodologyCitations: attribution.methodologyReferences.map((citation) => buildPdfCitation(citation, {
      sourceTitle: requireCatalogText(citation.source?.title, "방법론 출판처")
    }))
  };
  assertPublicPdfContent(content);
  return deepFreeze(content);
}

export async function buildClimatePdfBlob(canvas, response) {
  validateReportCanvas(canvas);
  const content = buildPdfAttributionContent(response);
  const [{ PDFDocument, rgb }, fontkitModule, fontBytes, markOneBytes, markTwoBytes] = await Promise.all([
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
    fetchBytes(FONT_PATH),
    fetchBytes(MARK_PATHS[0]),
    fetchBytes(MARK_PATHS[1])
  ]);
  assertPngBytes(markOneBytes);
  assertPngBytes(markTwoBytes);

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitModule.default ?? fontkitModule);
  const font = await pdf.embedFont(fontBytes, { subset: false });
  const [markOne, markTwo] = await Promise.all([
    pdf.embedPng(markOneBytes),
    pdf.embedPng(markTwoBytes)
  ]);
  const generatedDate = new Date(content.context.generatedAt);
  pdf.setTitle("기후 변화 기간 자료 보고서");
  pdf.setAuthor(content.project.creator.displayName);
  pdf.setCreator(content.project.creator.displayName);
  pdf.setSubject("CMIP6 격자 원자료와 대한민국 기상청 KMA ASOS 보정 자료의 출처 및 인용 부록 포함");
  pdf.setKeywords(["CMIP6", "ScenarioMIP", "기후 시나리오", "KMA", "ASOS", "attribution"]);
  pdf.setCreationDate(generatedDate);
  pdf.setModificationDate(generatedDate);

  await appendCanvasPages(pdf, canvas);
  appendAttributionPages(pdf, content, font, markOne, markTwo, rgb);
  return new Blob([await pdf.save()], { type: "application/pdf" });
}

async function appendCanvasPages(pdf, canvas) {
  const [pageWidth, pageHeight] = A4_LANDSCAPE;
  const margin = 22;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const sourcePageHeight = Math.max(1, Math.floor(canvas.width * contentHeight / contentWidth));
  const documentObject = globalThis.document;
  if (!documentObject || typeof documentObject.createElement !== "function") {
    throw new Error("PDF 보고서 면을 만들 브라우저 문서가 없습니다.");
  }

  for (let sourceY = 0; sourceY < canvas.height; sourceY += sourcePageHeight) {
    const sliceHeight = Math.min(sourcePageHeight, canvas.height - sourceY);
    const slice = documentObject.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHeight;
    const context = slice.getContext("2d");
    if (!context) throw new Error("PDF 보고서 면을 만들 수 없습니다.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, slice.width, slice.height);
    context.drawImage(canvas, 0, sourceY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    const jpeg = new Uint8Array(await (await canvasBlob(slice, "image/jpeg", 0.94)).arrayBuffer());
    const image = await pdf.embedJpg(jpeg);
    const page = pdf.addPage(A4_LANDSCAPE);
    const drawnHeight = Math.min(contentHeight, contentWidth * sliceHeight / canvas.width);
    page.drawImage(image, {
      x: margin,
      y: pageHeight - margin - drawnHeight,
      width: contentWidth,
      height: drawnHeight
    });
  }
}

function appendAttributionPages(pdf, content, font, markOne, markTwo, rgb) {
  const colors = {
    ink: rgb(0.06, 0.12, 0.1),
    muted: rgb(0.34, 0.41, 0.38),
    green: rgb(0.09, 0.42, 0.33),
    line: rgb(0.83, 0.87, 0.85)
  };
  const writer = createAppendixWriter(pdf, font, colors);

  writer.startSection("보고서 및 자료 식별");
  writer.heading("보고서 및 자료 식별", 14);
  writer.paragraph(`조회 조건: ${content.context.dateStart} ~ ${content.context.dateEnd} · ${content.context.scenario} · ${content.context.model}`);
  writer.paragraph(`좌표: ${formatSignedCoordinates(content.context.latitude, content.context.longitude)}`, { color: colors.muted });
  writer.paragraph(content.sourceStatement);
  writer.paragraph(`datasetVersion: ${content.context.datasetVersion}`, { size: 8.5, lineHeight: 12, color: colors.muted });
  writer.paragraph(`datasetUpdatedAt: ${content.context.datasetUpdatedAt}`, { size: 8.5, lineHeight: 12, color: colors.muted });
  writer.paragraph(`generatedAt: ${content.context.generatedAt}`, { size: 8.5, lineHeight: 12, color: colors.muted, after: 12 });

  writer.heading("대한민국 기상청(KMA) ASOS", 13);
  writer.paragraph(`보정 상태: ${content.asosCorrection.notice}`, { color: colors.green });
  const sourcePrefix = content.asosCorrection.used ? "관측자료 출처" : "참고 출처(이 결과 계산에는 미사용)";
  writer.paragraph(`${sourcePrefix}: ${content.asosCorrection.source.organization} · ${content.asosCorrection.source.title}`);
  writer.paragraph(content.asosCorrection.source.url, { size: 8.5, lineHeight: 12, color: colors.muted, after: 10 });
  writer.imageRow([
    { image: markOne, width: 120 },
    { image: markTwo, width: 100 }
  ]);

  writer.rule();
  writer.heading("프로젝트와 이용 조건", 13);
  writer.paragraph(`프로젝트: ${content.project.title} ${content.project.version}`);
  writer.paragraph(`공개 제작자: ${content.project.creator.displayName}`);
  writer.paragraph(`GitHub: ${content.project.creator.githubHandle} · ${content.project.creator.githubUrl}`, { size: 9, lineHeight: 13 });
  writer.paragraph(`공개 저장소: ${content.project.repositoryUrl}`, { size: 9, lineHeight: 13 });
  writer.paragraph(`소스 코드 라이선스: ${content.project.license.title} (${content.project.license.identifier})`, { size: 9, lineHeight: 13 });
  writer.paragraph("데이터셋·논문·기상청 자료의 이용 조건은 각 원 출처와 저장소 attribution 메타데이터를 우선합니다. 확인되지 않은 별도 라이선스는 부여하지 않습니다.", { size: 9, lineHeight: 13, color: colors.muted });

  writer.startSection("CMIP6 / ScenarioMIP 데이터셋 인용", { newPage: true });
  writer.heading("CMIP6 / ScenarioMIP 데이터셋 인용", 14);
  for (const model of content.modelGroups) {
    writer.heading(`${model.name} · ${model.institution}`, 10.5);
    for (const citation of model.citations) drawCitation(writer, citation, colors);
  }

  writer.startSection("자료 처리 방법론 인용", { newPage: true });
  writer.heading("자료 처리 방법론 인용", 14);
  for (const citation of content.methodologyCitations) drawCitation(writer, citation, colors);
  writer.paragraph("위 인용은 저장소의 공개 attribution 메타데이터를 그대로 사용했습니다. 모델 데이터셋 연도가 등록되지 않은 경우 그 사실을 명시하며 임의의 연도를 만들지 않습니다.", { size: 8.5, lineHeight: 12, color: colors.muted, before: 4 });
  writer.finish();
}

function drawCitation(writer, citation, colors) {
  const activity = citation.activity ? `활동: ${citation.activity} · ` : "";
  writer.paragraph(`${activity}생성자: ${citation.creator} · 연도: ${citation.year}`, { size: 8.8, lineHeight: 12 });
  writer.paragraph(`제목: ${citation.title}`, { size: 8.8, lineHeight: 12 });
  if (citation.sourceTitle) {
    writer.paragraph(`출판처: ${citation.sourceTitle}`, { size: 8.5, lineHeight: 12, color: colors.muted });
  }
  writer.paragraph(`DOI: ${citation.doi}`, { size: 8.5, lineHeight: 12, color: colors.muted });
  if (citation.verifiedLicense) {
    const changes = citation.changesMade ? "변경함" : "변경하지 않음";
    writer.paragraph(`라이선스: ${citation.verifiedLicense} · 변경 여부: ${changes}`, { size: 8.5, lineHeight: 12, color: colors.green });
  }
  writer.spacer(7);
}

function createAppendixWriter(pdf, font, colors) {
  const pages = [];
  let current;
  let sectionTitle = "자료 출처와 인용";

  const addPage = () => {
    current = {
      page: pdf.addPage(A4_PORTRAIT),
      sectionTitle,
      y: APPENDIX_LAYOUT.top
    };
    pages.push(current);
  };
  const ensureSpace = (height) => {
    if (!current || current.y - height < APPENDIX_LAYOUT.bottom) addPage();
  };
  const startSection = (title, { newPage = false } = {}) => {
    sectionTitle = String(title);
    if (!current || newPage) addPage();
  };
  const paragraph = (text, options = {}) => {
    const size = options.size ?? 9.5;
    const lineHeight = options.lineHeight ?? 14;
    const after = options.after ?? 4;
    const before = options.before ?? 0;
    const color = options.color ?? colors.ink;
    const lines = wrapPdfText(font, String(text ?? ""), size, APPENDIX_LAYOUT.width);
    const blockHeight = before + lines.length * lineHeight + after;
    const pageCapacity = APPENDIX_LAYOUT.top - APPENDIX_LAYOUT.bottom;
    if (blockHeight <= pageCapacity) ensureSpace(blockHeight);
    current.y -= before;
    for (const line of lines) {
      ensureSpace(lineHeight);
      current.page.drawText(line, {
        x: APPENDIX_LAYOUT.left,
        y: current.y,
        size,
        font,
        color
      });
      current.y -= lineHeight;
    }
    current.y -= after;
  };
  const heading = (text, size = 13) => {
    const height = size + 15;
    ensureSpace(height);
    current.page.drawText(String(text), {
      x: APPENDIX_LAYOUT.left,
      y: current.y,
      size,
      font,
      color: colors.green
    });
    current.y -= height;
  };
  const spacer = (height) => {
    ensureSpace(height);
    current.y -= height;
  };
  const rule = () => {
    ensureSpace(20);
    current.y -= 7;
    drawSectionRule(current.page, current.y, colors.line);
    current.y -= 13;
  };
  const imageRow = (items) => {
    const positioned = items.map((item) => ({
      ...item,
      dimensions: pdfImageDimensionsAtWidth(item.image, item.width)
    }));
    const maximumHeight = Math.max(...positioned.map((item) => item.dimensions.height));
    ensureSpace(maximumHeight + 10);
    let x = APPENDIX_LAYOUT.left;
    for (const item of positioned) {
      current.page.drawImage(item.image, {
        x,
        y: current.y - item.dimensions.height,
        width: item.dimensions.width,
        height: item.dimensions.height
      });
      x += item.dimensions.width + 18;
    }
    current.y -= maximumHeight + 10;
  };
  const finish = () => {
    pages.forEach((record, index) => {
      drawAppendixHeader(
        record.page,
        font,
        colors,
        record.sectionTitle,
        `${index + 1} / ${pages.length}`
      );
    });
  };

  return { finish, heading, imageRow, paragraph, rule, spacer, startSection };
}

function drawAppendixHeader(page, font, colors, sectionTitle, pageNumber) {
  page.drawText("자료 출처와 인용 부록", { x: 44, y: 796, size: 20, font, color: colors.ink });
  page.drawText(sectionTitle, { x: 44, y: 776, size: 9, font, color: colors.green });
  const pageNumberWidth = font.widthOfTextAtSize(pageNumber, 9);
  page.drawText(pageNumber, { x: 551 - pageNumberWidth, y: 796, size: 9, font, color: colors.muted });
  drawSectionRule(page, 767, colors.line);
}

function drawSectionRule(page, y, color) {
  page.drawLine({ start: { x: 44, y }, end: { x: 551, y }, thickness: 0.7, color });
}

function buildPdfCitation(citation, extensions = {}) {
  return {
    ...extensions,
    creator: requireCatalogText(formatCitationCreators(citation.authors), "인용 생성자"),
    year: Number.isInteger(citation.year) ? String(citation.year) : MISSING_YEAR_LABEL,
    title: requireCatalogText(citation.title, "인용 제목"),
    doi: requireCatalogText(citation.source?.doi, "인용 DOI"),
    verifiedLicense: verifiedPdfCcByLicense(citation),
    changesMade: citation.changesMade
  };
}

function normalizePdfResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new TypeError("PDF에 넣을 공개 기후 자료가 없습니다.");
  }
  const dataMode = response.dataMode;
  pdfSourceStatement({ dataMode });
  const datasetVersion = requirePublicText(response.datasetVersion, "datasetVersion");
  if (!DATASET_VERSION_PATTERN.test(datasetVersion)) {
    throw new TypeError("PDF datasetVersion을 확인할 수 없습니다.");
  }
  const datasetUpdatedAt = requireTimestamp(response.datasetUpdatedAt, "datasetUpdatedAt");
  const generatedAt = requireTimestamp(response.generatedAt, "generatedAt");
  return {
    dataMode,
    model: requirePublicText(response.model, "기후 모델"),
    scenario: requirePublicText(response.scenario, "기후 시나리오"),
    dateStart: requirePublicText(response.dateStart, "조회 시작일"),
    dateEnd: requirePublicText(response.dateEnd, "조회 종료일"),
    latitude: requireCoordinate(response.latitude, -90, 90, "위도"),
    longitude: requireCoordinate(response.longitude, -180, 180, "경도"),
    datasetVersion,
    datasetUpdatedAt,
    generatedAt
  };
}

function requireTimestamp(value, label) {
  const timestamp = requirePublicText(value, label);
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError(`PDF ${label}을 확인할 수 없습니다.`);
  return timestamp;
}

function requireCoordinate(value, minimum, maximum, label) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new TypeError(`PDF ${label}를 확인할 수 없습니다.`);
  }
  return number;
}

function requirePublicText(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new TypeError(`PDF ${label}에 공개할 수 없는 값이 있습니다.`);
  }
  return text;
}

function requireCatalogText(value, label) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new TypeError(`저장소 ${label} 메타데이터가 없습니다.`);
  return text;
}

function assertPublicPdfContent(value) {
  for (const text of collectStrings(value)) {
    if (PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(text))) {
      throw new TypeError("PDF 공개 내용에 비공개 경로를 포함할 수 없습니다.");
    }
  }
}

function collectStrings(value, found = []) {
  if (typeof value === "string") {
    found.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, found));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, found));
  }
  return found;
}

function formatCitationCreators(authors) {
  if (!Array.isArray(authors)) return "";
  return authors.map((author) => {
    if (typeof author?.name === "string") return author.name.trim();
    return [author?.givenNames, author?.familyName].filter(Boolean).join(" ").trim();
  }).filter(Boolean).join("; ");
}

export function wrapPdfText(font, text, size, maxWidth) {
  const tokens = String(text ?? "").split(/(\s+)/u).filter(Boolean);
  const lines = [];
  let line = "";
  const pushLongToken = (token) => {
    let chunk = "";
    for (const character of Array.from(token)) {
      const candidate = `${chunk}${character}`;
      if (chunk && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk = candidate;
      }
    }
    return chunk;
  };
  for (const token of tokens) {
    if (!line) {
      line = font.widthOfTextAtSize(token, size) <= maxWidth ? token : pushLongToken(token);
      continue;
    }
    const candidate = `${line}${token}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line.trimEnd());
    line = font.widthOfTextAtSize(token, size) <= maxWidth ? token.trimStart() : pushLongToken(token.trim());
  }
  if (line) lines.push(line.trimEnd());
  return lines.length ? lines : [""];
}

function formatSignedCoordinates(latitude, longitude) {
  const latitudeDirection = latitude < 0 ? "남위" : "북위";
  const longitudeDirection = longitude < 0 ? "서경" : "동경";
  return `${latitudeDirection} ${Math.abs(latitude).toFixed(4)}, ${longitudeDirection} ${Math.abs(longitude).toFixed(4)}`;
}

function validateReportCanvas(canvas) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("PDF에 넣을 기후 보고서 화면이 없습니다.");
  }
  if (![canvas.width, canvas.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("PDF에 넣을 기후 보고서 화면 크기를 확인할 수 없습니다.");
  }
}

async function fetchBytes(path) {
  const response = await fetch(path, {
    method: "GET",
    credentials: "same-origin",
    cache: "force-cache"
  });
  if (!response?.ok || typeof response.arrayBuffer !== "function") {
    throw new Error("출처 표시 자산을 불러오지 못해 PDF 생성을 중단했습니다.");
  }
  return new Uint8Array(await response.arrayBuffer());
}

function assertPngBytes(bytes) {
  const valid = bytes.byteLength > PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!valid) throw new Error("출처 표시 원본 자산이 유효한 PNG가 아닙니다.");
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("PDF 보고서 이미지를 만들지 못했습니다.")),
      type,
      quality
    );
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
  return Object.freeze(value);
}
