export const PUBLIC_CLIMATE_READ_PATH = "/api/climate/query";
export const PUBLIC_DATA_SOURCE_POLICY = "cloud-only";
export const PUBLIC_DATASET_REFRESH_INTERVAL_MS = 15 * 60 * 1e3;
export const PUBLIC_DATASET_REACTIVATION_MIN_INTERVAL_MS = 60 * 1e3;
export const PUBLIC_RETRYABLE_RAW_QUERY_MESSAGE = "원자료 기후모델 조회가 시스템 부하로 완결되지 않았습니다. 잠시 후 다시 시도하세요.";
export const PUBLIC_CLIMATE_ATTRIBUTION_LABELS = Object.freeze([
  "국제기후모델 시나리오 원자료",
  "국제기후모델 시나리오 자료",
  "관측자료 기반 보정"
]);
export const PUBLIC_BACKEND_CONTRACT_PROFILE = Object.freeze({
  id: "ctc-public-climate-v1",
  additiveFields: "project-and-ignore",
  incompatibleChanges: "fail-closed"
});

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1e3;
const MINIMUM_TIMEOUT_MS = 30 * 1e3;
const ALLOWED_CONFIG_KEYS = ["publicSafe", "readPath", "sourcePolicy", "timeoutMs"];
const DATASET_VERSION_PATTERN = /^[0-9a-f]{64}$/u;
const DATASET_UPDATED_AT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})\+00:00$/u;
const PUBLIC_DATASET_METADATA_ALLOWED_FIELDS = Object.freeze([
  "publicSafe",
  "ready",
  "datasetVersion",
  "datasetUpdatedAt",
  "dateStart",
  "dateEnd",
  "models",
  "scenarios"
]);
const PUBLIC_QUERY_RESPONSE_ALLOWED_FIELDS = Object.freeze([
  "requestId",
  "sourceId",
  "stationLabel",
  "latitude",
  "longitude",
  "date",
  "scenario",
  "model",
  "coverage",
  "dataMode",
  "values",
  "values[].key",
  "values[].label",
  "values[].value",
  "values[].unit",
  "values[].caption",
  "values[].tone",
  "values[].available",
  "values[].numericValue",
  "values[].rawValue",
  "values[].rawNumericValue",
  "attributionReady",
  "publicSafe",
  "generatedAt",
  "datasetVersion",
  "datasetUpdatedAt",
  "nearestDistanceKm",
  "fallbackReason"
]);
const PUBLIC_SERIES_RESPONSE_ALLOWED_FIELDS = Object.freeze([
  "requestId",
  "sourceId",
  "latitude",
  "longitude",
  "dateStart",
  "dateEnd",
  "dates",
  "scenario",
  "model",
  "coverage",
  "dataMode",
  "metrics",
  "metrics[].key",
  "metrics[].label",
  "metrics[].unit",
  "metrics[].corrected",
  "metrics[].corrected.p10",
  "metrics[].corrected.p50",
  "metrics[].corrected.p90",
  "metrics[].raw",
  "metrics[].raw.p10",
  "metrics[].raw.p50",
  "metrics[].raw.p90",
  "metrics[].coverage",
  "metrics[].modelCounts",
  "metrics[].availableCount",
  "includeRaw",
  "attributionReady",
  "attributionLabels",
  "publicSafe",
  "generatedAt",
  "datasetVersion",
  "datasetUpdatedAt",
  "nearestDistanceKm",
  "fallbackReason"
]);
const PUBLIC_RETRYABLE_ERROR_ALLOWED_FIELDS = Object.freeze([
  "error",
  "code",
  "retryable"
]);
const PUBLIC_API_ALLOWED_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9_]*(?:\[\])?)*$/u;
const PUBLIC_API_RESPONSE_ERROR = "공개 기후 자료 응답이 허용된 공개 계약과 맞지 않습니다.";
const PUBLIC_CLIMATE_ATTRIBUTION_LABEL_SET = new Set(PUBLIC_CLIMATE_ATTRIBUTION_LABELS);
const PUBLIC_API_FORBIDDEN_EXTENSION_FIELD_PATTERN = /^(?:(?:.*_)?(?:path|url|uri|auth|authentication|authorization|credential|credentials|secret|secrets|token|tokens|password|passwords|bearer|jwt|cookie|cookies)|(?:file|folder|bucket|project|storage|repository|repo)_id|(?:api|access|secret)_key)$/u;
const PUBLIC_API_FORBIDDEN_TEXT_PATTERNS = Object.freeze([
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u,
  /\b(?:file|gs|gcs|s3|az|ssh|git):\/\//iu,
  /\bhttps?:\/\//iu,
  /\b(?:drive\.google\.com|storage\.googleapis\.com|googleapis\.com)\b/iu,
  /(?:^|[^a-z0-9])(?:[a-z]:[\\/]|\\\\[^\\\s]+[\\/])/iu,
  /\/(?:home|users|mnt|tmp|var|srv|opt|data)(?:\/|$)/iu,
  /\.(?:ctwebui|ctcapsule|zarr|parquet|nc4?|git)(?:\b|[\\/])/iu,
  /\b(?:github\.com|gitlab\.com|bitbucket\.org)(?:[/:]|$)/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:file|folder|bucket|project|repository|repo)[_-]?(?:id|path|url|uri)\b/iu,
  /(?:버킷|공유\s*링크|파일\s*식별자|내부\s*경로|비밀값|토큰|액세스\s*키)/u
]);

export function validatePublicRuntimeConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("기후 자료 연결 정보가 공개 조회 기준과 맞지 않습니다.");
  }

  const keys = Object.keys(value).sort();
  if (keys.length !== ALLOWED_CONFIG_KEYS.length
    || keys.some((key, index) => key !== ALLOWED_CONFIG_KEYS[index])) {
    throw new Error("기후 자료 연결 정보가 공개 조회 기준과 맞지 않습니다.");
  }

  if (value.readPath !== PUBLIC_CLIMATE_READ_PATH
    || value.publicSafe !== true
    || value.sourcePolicy !== PUBLIC_DATA_SOURCE_POLICY
    || typeof value.timeoutMs !== "number"
    || !Number.isFinite(value.timeoutMs)) {
    throw new Error("기후 자료 연결 정보가 공개 조회 기준과 맞지 않습니다.");
  }

  return {
    readPath: PUBLIC_CLIMATE_READ_PATH,
    sourcePolicy: PUBLIC_DATA_SOURCE_POLICY,
    timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, Math.max(MINIMUM_TIMEOUT_MS, Math.round(value.timeoutMs)))
  };
}

export function validatePublicApiResponse(value, allowedFields) {
  try {
    if (!isPlainRecord(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    const allowedFieldSet = createAllowedPublicApiFieldSet(allowedFields);
    validatePublicApiNode(value, "", allowedFieldSet, new Set());
    return value;
  } catch {
    throw new Error(PUBLIC_API_RESPONSE_ERROR);
  }
}

export function adaptCompatiblePublicApiResponse(value, allowedFields) {
  try {
    if (!isPlainRecord(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    const allowedFieldSet = createAllowedPublicApiFieldSet(allowedFields);
    return projectCompatiblePublicApiNode(value, "", allowedFieldSet, new Set());
  } catch {
    throw new Error(PUBLIC_API_RESPONSE_ERROR);
  }
}

export function validatePublicDatasetMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.publicSafe !== true || value.ready !== true) {
    throw new Error("기후 자료 기준 정보를 확인할 수 없습니다.");
  }

  try {
    value = adaptCompatiblePublicApiResponse(value, PUBLIC_DATASET_METADATA_ALLOWED_FIELDS);
  } catch {
    throw new Error("기후 자료 기준 정보를 확인할 수 없습니다.");
  }

  const datasetVersion = normalizeDatasetVersion(value.datasetVersion);
  const datasetUpdatedAt = normalizeDatasetUpdatedAt(value.datasetUpdatedAt);
  if (!datasetVersion || !datasetUpdatedAt) {
    throw new Error("기후 자료 기준 정보를 확인할 수 없습니다.");
  }

  return {
    ...value,
    datasetVersion,
    datasetUpdatedAt
  };
}

export function validatePublicClimateQueryResponse(value) {
  return validatePublicClimateResponse(value, PUBLIC_QUERY_RESPONSE_ALLOWED_FIELDS);
}

export function validatePublicClimateSeriesResponse(value) {
  const response = validatePublicClimateResponse(value, PUBLIC_SERIES_RESPONSE_ALLOWED_FIELDS);
  if (!Array.isArray(response.attributionLabels)
    || response.attributionLabels.length === 0
    || new Set(response.attributionLabels).size !== response.attributionLabels.length
    || !response.attributionLabels.every((label) => PUBLIC_CLIMATE_ATTRIBUTION_LABEL_SET.has(label))) {
    throw new Error(PUBLIC_API_RESPONSE_ERROR);
  }
  return response;
}

export function validatePublicClimateRetryableError(value) {
  validatePublicApiResponse(value, PUBLIC_RETRYABLE_ERROR_ALLOWED_FIELDS);
  if (value.code !== "raw_query_incomplete_retryable"
    || value.retryable !== true
    || value.error !== PUBLIC_RETRYABLE_RAW_QUERY_MESSAGE) {
    throw new Error(PUBLIC_API_RESPONSE_ERROR);
  }
  return value;
}

export function isPublicDatasetVersionChange(currentVersion, nextVersion) {
  const current = normalizeDatasetVersion(currentVersion);
  const next = normalizeDatasetVersion(nextVersion);
  return Boolean(current && next && current !== next);
}

export function isPublicDatasetIdentityChange(currentMetadata, nextMetadata) {
  const currentVersion = normalizeDatasetVersion(currentMetadata?.datasetVersion);
  const nextVersion = normalizeDatasetVersion(nextMetadata?.datasetVersion);
  const currentUpdatedAt = normalizeDatasetUpdatedAt(currentMetadata?.datasetUpdatedAt);
  const nextUpdatedAt = normalizeDatasetUpdatedAt(nextMetadata?.datasetUpdatedAt);
  return Boolean(currentVersion
    && nextVersion
    && currentUpdatedAt
    && nextUpdatedAt
    && (currentVersion !== nextVersion || currentUpdatedAt !== nextUpdatedAt));
}

export function isMatchingPublicDatasetVersion(response, expectedVersion) {
  const hasExpectedVersion = expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== "";
  if (!hasExpectedVersion) return true;
  const expected = normalizeDatasetVersion(expectedVersion);
  if (!expected) return false;
  return normalizeDatasetVersion(response?.datasetVersion) === expected;
}

export function isMatchingPublicDatasetIdentity(response, expectedVersion, expectedUpdatedAt) {
  const expectedVersionValue = normalizeDatasetVersion(expectedVersion);
  const expectedUpdatedAtValue = normalizeDatasetUpdatedAt(expectedUpdatedAt);
  if (!expectedVersionValue || !expectedUpdatedAtValue) return false;
  return normalizeDatasetVersion(response?.datasetVersion) === expectedVersionValue
    && normalizeDatasetUpdatedAt(response?.datasetUpdatedAt) === expectedUpdatedAtValue;
}

export function isCurrentPublicDatasetResult(response, metadata, status) {
  return status === "ready"
    && isMatchingPublicDatasetIdentity(response, metadata?.datasetVersion, metadata?.datasetUpdatedAt);
}

export function createPublicMetadataRefreshQueue(startRequest) {
  if (typeof startRequest !== "function") throw new TypeError("자료 기준 확인 함수를 지정해야 합니다.");

  let inFlight;
  let forcedFollowUp;
  const start = () => {
    let request;
    try {
      request = startRequest();
    } catch (error) {
      request = Promise.reject(error);
    }
    const pending = Promise.resolve(request).finally(() => {
      if (inFlight === pending) inFlight = void 0;
    });
    inFlight = pending;
    return pending;
  };

  return {
    hasInFlight() {
      return Boolean(inFlight);
    },
    request({ force = false } = {}) {
      if (!inFlight) return start();
      if (!force) return inFlight;
      if (forcedFollowUp) return forcedFollowUp;

      const queued = inFlight.catch(() => void 0).then(start);
      const followUp = queued.finally(() => {
        if (forcedFollowUp === followUp) forcedFollowUp = void 0;
      });
      forcedFollowUp = followUp;
      return followUp;
    }
  };
}

export function formatPublicDatasetUpdatedAt(value) {
  const normalized = normalizeDatasetUpdatedAt(value);
  if (!normalized) return "";
  const [, year, month, day] = DATASET_UPDATED_AT_PATTERN.exec(normalized);
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

function createAllowedPublicApiFieldSet(value) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
  const fields = value.map((field) => {
    if (typeof field !== "string" || field !== field.trim() || !PUBLIC_API_ALLOWED_FIELD_PATTERN.test(field)) {
      throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    }
    return field;
  });
  const fieldSet = new Set(fields);
  if (fieldSet.size !== fields.length) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
  return fieldSet;
}

function validatePublicClimateResponse(value, allowedFields) {
  const response = adaptCompatiblePublicApiResponse(value, allowedFields);
  if (response.publicSafe !== true
    || response.attributionReady !== true
    || !normalizeDatasetVersion(response.datasetVersion)
    || !normalizeDatasetUpdatedAt(response.datasetUpdatedAt)) {
    throw new Error(PUBLIC_API_RESPONSE_ERROR);
  }
  return response;
}

function validatePublicApiNode(value, path, allowedFieldSet, ancestors) {
  if (typeof value === "string") {
    if (PUBLIC_API_FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    }
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);

  ancestors.add(value);
  if (Array.isArray(value)) {
    const itemPath = `${path}[]`;
    value.forEach((item) => validatePublicApiNode(item, itemPath, allowedFieldSet, ancestors));
    ancestors.delete(value);
    return;
  }
  if (!isPlainRecord(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);

  for (const [key, nestedValue] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (!allowedFieldSet.has(fieldPath)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    validatePublicApiNode(nestedValue, fieldPath, allowedFieldSet, ancestors);
  }
  ancestors.delete(value);
}

function projectCompatiblePublicApiNode(value, path, allowedFieldSet, ancestors) {
  if (typeof value === "string") {
    validatePublicApiText(value);
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);

  ancestors.add(value);
  if (Array.isArray(value)) {
    const itemPath = `${path}[]`;
    const projected = value.map((item) => projectCompatiblePublicApiNode(item, itemPath, allowedFieldSet, ancestors));
    ancestors.delete(value);
    return projected;
  }
  if (!isPlainRecord(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);

  const projected = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key;
    if (allowedFieldSet.has(fieldPath)) {
      projected[key] = projectCompatiblePublicApiNode(nestedValue, fieldPath, allowedFieldSet, ancestors);
      continue;
    }
    validatePublicApiExtensionNode(key, nestedValue, ancestors);
  }
  ancestors.delete(value);
  return projected;
}

function validatePublicApiExtensionNode(key, value, ancestors) {
  const normalizedKey = String(key)
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Za-z0-9]+/gu, "_")
    .toLowerCase();
  if (PUBLIC_API_FORBIDDEN_EXTENSION_FIELD_PATTERN.test(normalizedKey)) {
    throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
  }
  validatePublicApiExtensionValue(value, ancestors);
}

function validatePublicApiExtensionValue(value, ancestors) {
  if (typeof value === "string") return validatePublicApiText(value);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => validatePublicApiExtensionValue(item, ancestors));
  } else {
    if (!isPlainRecord(value)) throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
    Object.entries(value).forEach(([key, nestedValue]) => validatePublicApiExtensionNode(key, nestedValue, ancestors));
  }
  ancestors.delete(value);
}

function validatePublicApiText(value) {
  if (PUBLIC_API_FORBIDDEN_TEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new TypeError(PUBLIC_API_RESPONSE_ERROR);
  }
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeDatasetVersion(value) {
  if (typeof value !== "string") return "";
  return DATASET_VERSION_PATTERN.test(value) ? value : "";
}

function normalizeDatasetUpdatedAt(value) {
  if (typeof value !== "string") return "";
  const match = DATASET_UPDATED_AT_PATTERN.exec(value);
  if (!match) return "";
  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() !== Number(month) - 1
    || parsed.getUTCDate() !== Number(day)
    || parsed.getUTCHours() !== Number(hour)
    || parsed.getUTCMinutes() !== Number(minute)
    || parsed.getUTCSeconds() !== Number(second)) return "";
  return value;
}
