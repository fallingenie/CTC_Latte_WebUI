import { PUBLIC_ATTRIBUTION_CATALOG } from "./attribution-catalog.js";

export const RAW_MODEL_GRID_DATA_MODE = "raw-model-grid";
export const BIAS_CORRECTED_DATA_MODE = "bias-corrected";
export const ASOS_CORRECTION_USED_NOTICE = "대한민국 기상청 ASOS 보정 사용";
export const ASOS_CORRECTION_NOT_USED_NOTICE = "대한민국 기상청 ASOS 보정 미사용";

const ATTRIBUTION_SCHEMA_VERSION = 1;
const KMA_ASOS_SOURCE = Object.freeze({
  organization: "대한민국 기상청",
  title: "ASOS 시간자료 조회서비스",
  url: "https://www.data.go.kr/data/15057210/openapi.do"
});
const KMA_MARK_ASSETS = Object.freeze([
  Object.freeze({
    sourceUrl: "assets/licenses/kma_mark_1.png",
    archivePath: "licenses/kma_mark_1.png",
    alt: "공공누리 제1유형 출처표시"
  }),
  Object.freeze({
    sourceUrl: "assets/licenses/kma_mark_2.png",
    archivePath: "licenses/kma_mark_2.png",
    alt: "제3자 권리 포함 저작권 표시"
  })
]);
const MODEL_CSV_FIELDS = Object.freeze([
  "model",
  "institution",
  "activity",
  "citation_title",
  "authors",
  "doi",
  "url",
  "license",
  "changes_made"
]);
const ENSEMBLE_MODEL_NAMES = new Set(["전체 앙상블", "ensemble", "all"]);
const SUPPORTED_DATA_MODES = new Set([RAW_MODEL_GRID_DATA_MODE, BIAS_CORRECTED_DATA_MODE]);
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const FORBIDDEN_PUBLIC_EXPORT_PATTERNS = Object.freeze([
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u,
  /\b(?:file|gs|gcs):\/\//iu,
  /\b(?:drive\.google\.com|storage\.googleapis\.com|storage\.cloud\.google\.com|console\.cloud\.google\.com)\b/iu,
  /(?:^|[\s"'`(=,:])(?:[a-z]:[\\/]|\\\\[^\\\s]+[\\/])/imu,
  /(?:^|[\s"'`(=])\/(?:home|users|mnt|tmp|var|srv|opt|volumes)(?:\/|$)/imu,
  /(?:^|[\s"'`(=])~[\\/]/mu,
  /(?:\bgoogle\s+drive\b|\bmy\s+drive\b|내\s*드라이브)/iu,
  /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/iu,
  /(?:^|[\\/])(?:private|local)(?:[\\/]|$)/imu,
  /\b(?:private|local)[-_ ]?(?:path|file|folder|bucket|drive|root|uri|url)\b/iu
]);

export function buildPublicExportAttribution({
  dataMode,
  model,
  models,
  modelNames,
  datasetVersion,
  datasetUpdatedAt,
  generatedAt
} = {}) {
  const normalizedDataMode = requireDataMode(dataMode);
  const climateModels = selectClimateModels(modelNames ?? models ?? model);
  const correctionUsed = normalizedDataMode !== RAW_MODEL_GRID_DATA_MODE;
  const record = {
    schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
    catalogSchemaVersion: PUBLIC_ATTRIBUTION_CATALOG.schemaVersion,
    publicSafe: true,
    dataMode: normalizedDataMode,
    asosCorrection: {
      used: correctionUsed,
      notice: correctionUsed ? ASOS_CORRECTION_USED_NOTICE : ASOS_CORRECTION_NOT_USED_NOTICE,
      source: KMA_ASOS_SOURCE,
      marks: KMA_MARK_ASSETS.map(({ archivePath, alt }) => ({ archivePath, alt }))
    },
    project: PUBLIC_ATTRIBUTION_CATALOG.project,
    climateModels,
    methodologyReferences: PUBLIC_ATTRIBUTION_CATALOG.methodologyReferences,
    datasetIdentity: buildDatasetIdentity({ datasetVersion, datasetUpdatedAt, generatedAt })
  };

  assertPublicSafeExportText(JSON.stringify(record));
  return deepFreeze(record);
}

export function buildAttributionMarkdown(attribution) {
  const record = requireAttributionRecord(attribution);
  const { project } = record;
  const lines = [
    "# Licenses and Attribution",
    "",
    `- Project: ${project.title} ${project.version}`,
    `- Creator: ${project.creator.displayName} / GitHub ${project.creator.githubHandle}`,
    `- Repository: ${project.repositoryUrl}`,
    `- Source code license: ${project.license.title} (${project.license.identifier})`,
    `- Data mode: \`${record.dataMode}\``,
    `- ASOS correction: ${record.asosCorrection.notice}`,
    "",
    "## Korea Meteorological Administration ASOS",
    "",
    `- 보정 상태: ${record.asosCorrection.notice}`,
    `- 자료 출처: ${record.asosCorrection.source.organization} ${record.asosCorrection.source.title}`,
    `- 공공데이터포털: ${record.asosCorrection.source.url}`,
    ""
  ];

  if (record.datasetIdentity) {
    lines.push(
      "## 산출물 추적 정보",
      "",
      `- 자료판: ${record.datasetIdentity.version}`,
      `- 자료 갱신 시각: ${record.datasetIdentity.updatedAt}`,
      `- 산출물 생성 시각: ${record.datasetIdentity.generatedAt}`,
      ""
    );
  }

  for (const mark of record.asosCorrection.marks) {
    lines.push(`![${escapeMarkdown(mark.alt)}](${mark.archivePath})`, "");
  }

  lines.push(
    "## CMIP6 Model Attribution",
    "",
    "| model | author | institution | activity | title | year | DOI | license | changes made |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"
  );
  for (const row of modelCitationRows(record)) {
    lines.push(`| ${[
      row.model,
      row.authors,
      row.institution,
      row.activity,
      row.citation_title,
      row.year || "미확인",
      `[${row.doi}](${row.url})`,
      row.license || "미확인",
      row.changes_made || "미확인"
    ].map(escapeMarkdownTableCell).join(" | ")} |`);
  }

  lines.push("", "## Methodology References", "");
  lines.push(
    "저자·연도·제목·출처(DOI)를 함께 적었습니다. 라이선스와 변경 여부는 공개 인용 메타데이터에서 확인된 경우에만 표시합니다.",
    ""
  );
  record.methodologyReferences.forEach((reference, index) => {
    const authors = formatAuthors(reference.authors);
    const sourceTitle = reference.source?.title ? ` ${reference.source.title}.` : "";
    const doi = reference.source?.doi ? ` [${reference.source.doi}](${reference.source.url})` : "";
    const license = reference.license ? ` 라이선스: ${reference.license}.` : "";
    const changes = typeof reference.changesMade === "boolean"
      ? ` 변경 여부: ${reference.changesMade ? "변경함" : "변경하지 않음"}.`
      : "";
    lines.push(`${index + 1}. ${authors} (${reference.year}). ${reference.title}.${sourceTitle}${doi}${license}${changes}`);
  });

  const markdown = `${lines.join("\n").trim()}\n`;
  assertPublicSafeExportText(markdown);
  return markdown;
}

export function buildAttributionJson(attribution) {
  const record = requireAttributionRecord(attribution);
  const json = `${JSON.stringify(record, null, 2)}\n`;
  assertPublicSafeExportText(json);
  return json;
}

export function buildCmip6ModelAttributionCsv(attribution) {
  const record = requireAttributionRecord(attribution);
  const rows = [MODEL_CSV_FIELDS, ...modelCitationRows(record).map((row) => (
    MODEL_CSV_FIELDS.map((field) => row[field])
  ))];
  const csv = `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
  assertPublicSafeExportText(csv);
  return csv;
}

export async function buildAttributionBundle(
  {
    csv,
    csvFilename = "climate_data.csv",
    dataMode,
    model,
    models,
    modelNames,
    datasetVersion,
    datasetUpdatedAt,
    generatedAt
  } = {},
  environment = {}
) {
  if (typeof csv !== "string" || csv.length === 0) {
    throw new TypeError("묶음에 넣을 CSV 문자열이 필요합니다.");
  }
  assertPublicSafeExportText(csv);
  const safeCsvFilename = requireCsvFilename(csvFilename);
  const attribution = buildPublicExportAttribution({
    dataMode,
    model,
    models,
    modelNames,
    datasetVersion,
    datasetUpdatedAt,
    generatedAt
  });
  const markdown = buildAttributionMarkdown(attribution);
  const json = buildAttributionJson(attribution);
  const modelCsv = buildCmip6ModelAttributionCsv(attribution);
  const fetchImplementation = environment.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new Error("same-origin attribution 자산을 불러올 수 없습니다.");
  }

  const assetPayloads = await Promise.all(KMA_MARK_ASSETS.map(async (asset) => ({
    ...asset,
    bytes: await fetchPngAsset(asset.sourceUrl, fetchImplementation)
  })));
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(safeCsvFilename, csv);
  zip.file("LICENSES_AND_ATTRIBUTION.md", markdown);
  zip.file("cmip6_model_attribution.json", json);
  zip.file("cmip6_model_attribution.csv", modelCsv);
  for (const asset of assetPayloads) zip.file(asset.archivePath, asset.bytes);

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  return new Blob([bytes], { type: "application/zip" });
}

function requireDataMode(value) {
  if (!SUPPORTED_DATA_MODES.has(value)) {
    throw new TypeError("dataMode는 raw-model-grid 또는 bias-corrected여야 합니다.");
  }
  return value;
}

function selectClimateModels(requestedValue) {
  if (requestedValue === undefined || requestedValue === null || requestedValue === "") {
    return [...PUBLIC_ATTRIBUTION_CATALOG.climateModels];
  }

  const requestedItems = Array.isArray(requestedValue) ? requestedValue : [requestedValue];
  if (requestedItems.length === 0) return [...PUBLIC_ATTRIBUTION_CATALOG.climateModels];
  if (requestedItems.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new TypeError("기후 모델 이름은 비어 있지 않은 문자열이어야 합니다.");
  }

  const requested = requestedItems.map((value) => value.trim());
  if (requested.some((value) => ENSEMBLE_MODEL_NAMES.has(value.toLowerCase()))) {
    return [...PUBLIC_ATTRIBUTION_CATALOG.climateModels];
  }

  const requestedNames = new Set(requested);
  const selected = PUBLIC_ATTRIBUTION_CATALOG.climateModels.filter((item) => requestedNames.has(item.name));
  if (selected.length !== requestedNames.size) {
    throw new RangeError("공개 attribution catalog에 없는 기후 모델입니다.");
  }
  return selected;
}

function requireAttributionRecord(value) {
  if (!value
    || typeof value !== "object"
    || value.publicSafe !== true
    || value.schemaVersion !== ATTRIBUTION_SCHEMA_VERSION
    || !SUPPORTED_DATA_MODES.has(value.dataMode)
    || !Array.isArray(value.climateModels)
    || value.climateModels.length === 0
    || !Array.isArray(value.methodologyReferences)) {
    throw new TypeError("유효한 공개 attribution record가 필요합니다.");
  }

  const expectedUsed = value.dataMode !== RAW_MODEL_GRID_DATA_MODE;
  const expectedNotice = expectedUsed ? ASOS_CORRECTION_USED_NOTICE : ASOS_CORRECTION_NOT_USED_NOTICE;
  if (value.asosCorrection?.used !== expectedUsed || value.asosCorrection?.notice !== expectedNotice) {
    throw new TypeError("dataMode와 ASOS 보정 표기가 일치하지 않습니다.");
  }
  assertPublicSafeExportText(JSON.stringify(value));
  return value;
}

function modelCitationRows(record) {
  return record.climateModels.flatMap((model) => model.citations.map((citation) => ({
    model: model.name,
    institution: model.institution,
    activity: citation.activity ?? "",
    citation_title: citation.title ?? "",
    authors: formatAuthors(citation.authors),
    year: citation.year ?? "",
    doi: citation.source?.doi ?? "",
    url: citation.source?.url ?? "",
    license: citation.license ?? "",
    changes_made: typeof citation.changesMade === "boolean" ? String(citation.changesMade) : ""
  })));
}

function buildDatasetIdentity({ datasetVersion, datasetUpdatedAt, generatedAt }) {
  const values = [datasetVersion, datasetUpdatedAt, generatedAt];
  if (values.every((value) => value === undefined || value === null || value === "")) return null;
  if (typeof datasetVersion !== "string" || !/^[a-f0-9]{64}$/u.test(datasetVersion)) {
    throw new TypeError("자료판 식별자는 64자리 소문자 SHA-256이어야 합니다.");
  }
  return {
    version: datasetVersion,
    updatedAt: requireIsoTimestamp(datasetUpdatedAt, "자료 갱신 시각"),
    generatedAt: requireIsoTimestamp(generatedAt, "산출물 생성 시각")
  };
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label}은 ISO-8601 시각이어야 합니다.`);
  }
  return value;
}

function formatAuthors(authors) {
  if (!Array.isArray(authors)) return "";
  return authors.map((author) => {
    if (typeof author?.name === "string") return author.name;
    return [author?.givenNames, author?.familyName].filter(Boolean).join(" ");
  }).filter(Boolean).join("; ");
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
}

function escapeMarkdown(value) {
  return String(value ?? "").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function escapeMarkdownTableCell(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
}

function requireCsvFilename(value) {
  if (typeof value !== "string") throw new TypeError("CSV 파일 이름이 필요합니다.");
  const filename = value.trim();
  if (filename.length === 0
    || filename.length > 160
    || filename.startsWith(".")
    || !filename.toLowerCase().endsWith(".csv")
    || /[<>:"/\\|?*\u0000-\u001F]/u.test(filename)) {
    throw new TypeError("CSV 파일 이름은 경로가 없는 안전한 .csv 이름이어야 합니다.");
  }
  assertPublicSafeExportText(filename);
  return filename;
}

function assertPublicSafeExportText(value) {
  const text = String(value ?? "");
  if (FORBIDDEN_PUBLIC_EXPORT_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new Error("공개 내보내기에 비공개 또는 로컬 저장소 경로를 포함할 수 없습니다.");
  }
}

async function fetchPngAsset(sourceUrl, fetchImplementation) {
  const response = await fetchImplementation(sourceUrl, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-cache"
  });
  if (!response?.ok || typeof response.arrayBuffer !== "function") {
    throw new Error("same-origin attribution 자산을 불러오지 못했습니다.");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const validSignature = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (bytes.byteLength <= PNG_SIGNATURE.length || !validSignature) {
    throw new Error("same-origin attribution 자산이 유효한 PNG가 아닙니다.");
  }
  return bytes;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
  return Object.freeze(value);
}
