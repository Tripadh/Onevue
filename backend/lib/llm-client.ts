import { Buffer } from "node:buffer";

/**
 * The LLM service deadline is 60 seconds. The platform waits 10 seconds
 * longer so a completed extraction is not reported as unavailable, and
 * never waits more than 90 seconds.
 */
export const LLM_EXTRACTION_TIMEOUT_FLOOR_MS = 70_000;
export const LLM_EXTRACTION_TIMEOUT_CAP_MS = 90_000;

export type LlmServiceErrorCode =
  | "timeout"
  | "provider_failure"
  | "unavailable"
  | "invalid_response"
  | "unauthorized"
  | "invalid_file"
  | "file_too_large"
  | "unsupported_document";

export class LlmServiceError extends Error {
  readonly code: LlmServiceErrorCode;
  readonly status: number;

  constructor(code: LlmServiceErrorCode, message: string, status: number) {
    super(message);
    this.name = "LlmServiceError";
    this.code = code;
    this.status = status;
  }
}

export interface LlmClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface LlmExtractionResult {
  status: "ok" | "partial";
  schemaVersion: string;
  data: Record<string, unknown>;
  fieldMeta: Record<string, unknown>;
  warnings: Array<{ path: string; code: string; message: string }>;
  meta: Record<string, unknown>;
}

const DATA_KEYS = [
  "profile",
  "education",
  "experience",
  "skills",
  "projects",
  "achievements",
  "socialLinks",
] as const;

const PROFILE_KEYS = ["name", "headline", "email", "phone", "location", "summary"];
const EDUCATION_KEYS = [
  "institution",
  "degree",
  "fieldOfStudy",
  "startDate",
  "endDate",
  "grade",
];
const EXPERIENCE_KEYS = [
  "company",
  "title",
  "location",
  "startDate",
  "endDate",
  "isCurrent",
  "bullets",
];
const PROJECT_KEYS = ["name", "description", "technologies", "links"];
const ACHIEVEMENT_KEYS = ["title", "description"];
const SOCIAL_KEYS = ["platform", "url"];

export function resolveExtractionTimeoutMs(configured?: number): number {
  if (
    configured === undefined ||
    !Number.isFinite(configured) ||
    configured === 30_000
  ) {
    return LLM_EXTRACTION_TIMEOUT_FLOOR_MS;
  }
  if (configured < LLM_EXTRACTION_TIMEOUT_FLOOR_MS) {
    return LLM_EXTRACTION_TIMEOUT_FLOOR_MS;
  }
  return Math.min(LLM_EXTRACTION_TIMEOUT_CAP_MS, configured);
}

export function readLlmClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): LlmClientConfig | null {
  const baseUrl = env.LLM_SERVICE_URL?.trim() ?? "";
  const apiKey = env.LLM_SERVICE_API_KEY?.trim() ?? "";
  if (baseUrl.length === 0 || apiKey.length === 0) {
    return null;
  }
  const configured = Number(env.LLM_SERVICE_TIMEOUT_MS ?? "");
  return {
    baseUrl,
    apiKey,
    timeoutMs: resolveExtractionTimeoutMs(
      Number.isFinite(configured) ? configured : undefined,
    ),
  };
}

/**
 * Server-side client for resume extraction. One attempt is made per call.
 * This client does not retry: a retry could bill the provider twice or
 * leave two reviews for one upload. Extracted fields are untrusted claims.
 * Certificate verification must not call this client and must not treat an
 * extraction result as proof that a certificate is authentic.
 */
export async function requestLlmExtraction(
  file: { filename: string; bytes: Uint8Array; mediaType: string },
  config: LlmClientConfig,
): Promise<LlmExtractionResult> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from(file.bytes)], { type: file.mediaType }),
    file.filename,
  );

  let response: Response;
  try {
    response = await fetchImpl(new URL("/v1/extract", config.baseUrl), {
      method: "POST",
      redirect: "error",
      headers: {
        "x-api-key": config.apiKey,
        accept: "application/json",
      },
      body: form,
      signal: AbortSignal.timeout(
        config.timeoutMs ?? LLM_EXTRACTION_TIMEOUT_FLOOR_MS,
      ),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new LlmServiceError(
        "timeout",
        "The extraction service did not respond in time. Choose the PDF again if you want to retry. It was not retried automatically.",
        504,
      );
    }
    throw new LlmServiceError(
      "unavailable",
      "The extraction service is unavailable.",
      503,
    );
  }

  if (response.status === 401) {
    throw new LlmServiceError(
      "unauthorized",
      "The extraction service rejected the request.",
      503,
    );
  }

  if (!response.ok) {
    throw await errorFromUpstream(response);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LlmServiceError(
      "invalid_response",
      "The extraction service returned an unreadable response.",
      502,
    );
  }

  return parseExtractionPayload(payload);
}

async function errorFromUpstream(response: Response): Promise<LlmServiceError> {
  let code = "";
  try {
    const body = (await response.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    code = "";
  }

  if (response.status === 413 || code === "FILE_TOO_LARGE") {
    return new LlmServiceError(
      "file_too_large",
      "The PDF exceeds the 10 MB limit.",
      413,
    );
  }
  if (response.status === 504) {
    return new LlmServiceError(
      "timeout",
      "The extraction service did not respond in time. Choose the PDF again if you want to retry. It was not retried automatically.",
      504,
    );
  }
  if (
    code === "PROVIDER_AUTH" ||
    code === "PROVIDER_RATE_LIMITED" ||
    code === "PROVIDER_UNAVAILABLE" ||
    response.status === 429
  ) {
    return new LlmServiceError(
      "provider_failure",
      "The extraction provider could not complete this request. Choose the PDF again if you want to retry. It was not retried automatically.",
      502,
    );
  }
  if (code === "SCANNED_PDF") {
    return new LlmServiceError(
      "unsupported_document",
      "This PDF has no extractable text. Scanned resumes are not supported.",
      422,
    );
  }
  if (code === "ENCRYPTED_PDF") {
    return new LlmServiceError(
      "unsupported_document",
      "Encrypted PDFs are not supported.",
      422,
    );
  }
  if (code === "TOO_MANY_PAGES") {
    return new LlmServiceError(
      "unsupported_document",
      "The PDF has too many pages to extract.",
      422,
    );
  }
  if (response.status === 400 || code === "INVALID_FILE") {
    return new LlmServiceError(
      "invalid_file",
      "The extraction service could not read this PDF.",
      400,
    );
  }
  if (response.status === 502 || code === "INVALID_OUTPUT") {
    return new LlmServiceError(
      "invalid_response",
      "The extraction service returned an unexpected response.",
      502,
    );
  }
  return new LlmServiceError(
    "unavailable",
    "The extraction service is unavailable.",
    503,
  );
}

export function parseExtractionPayload(payload: unknown): LlmExtractionResult {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw invalidResponse();
  }
  const record = payload as Record<string, unknown>;
  if (record.status !== "ok" && record.status !== "partial") {
    throw invalidResponse();
  }
  const data = normalizeData(record.data);
  const fieldMeta = normalizeFieldMeta(record.fieldMeta);
  const warnings = normalizeWarnings(record.warnings);
  const meta = normalizeMeta(record.meta);
  const schemaVersion = meta.schemaVersion;
  if (schemaVersion !== "1.0.0") {
    throw invalidResponse();
  }
  return {
    status: record.status,
    schemaVersion,
    data,
    fieldMeta,
    warnings,
    meta,
  };
}

function invalidResponse(): LlmServiceError {
  return new LlmServiceError(
    "invalid_response",
    "The extraction service returned an unexpected response.",
    502,
  );
}

function normalizeData(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !DATA_KEYS.includes(key as (typeof DATA_KEYS)[number]))) {
    throw invalidResponse();
  }
  return {
    profile: normalizeProfile(record.profile),
    education: normalizeItems(record.education, EDUCATION_KEYS),
    experience: normalizeItems(record.experience, EXPERIENCE_KEYS),
    skills: normalizeSkills(record.skills),
    projects: normalizeItems(record.projects, PROJECT_KEYS),
    achievements: normalizeItems(record.achievements, ACHIEVEMENT_KEYS),
    socialLinks: normalizeSocial(record.socialLinks),
  };
}

function normalizeProfile(value: unknown): Record<string, string | null> {
  if (value === undefined || value === null) {
    return emptyStrings(PROFILE_KEYS);
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse();
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !PROFILE_KEYS.includes(key))) {
    throw invalidResponse();
  }
  const profile = emptyStrings(PROFILE_KEYS);
  for (const key of PROFILE_KEYS) {
    profile[key] = optionalString(record[key]);
  }
  return profile;
}

function normalizeItems(
  value: unknown,
  keys: string[],
): Array<Record<string, unknown>> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidResponse();
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => !keys.includes(key))) {
      throw invalidResponse();
    }
    const normalized: Record<string, unknown> = {};
    for (const key of keys) {
      if (key === "bullets" || key === "technologies" || key === "links") {
        normalized[key] = optionalStringList(record[key]);
      } else if (key === "isCurrent") {
        normalized[key] = record[key] === true;
      } else {
        normalized[key] = optionalString(record[key]);
      }
    }
    return normalized;
  });
}

function normalizeSkills(value: unknown): Array<{ name: string }> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidResponse();
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "name") || typeof record.name !== "string") {
      throw invalidResponse();
    }
    return { name: record.name };
  });
}

function normalizeSocial(value: unknown): Array<Record<string, string>> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidResponse();
    }
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).some((key) => !SOCIAL_KEYS.includes(key)) ||
      typeof record.platform !== "string" ||
      typeof record.url !== "string"
    ) {
      throw invalidResponse();
    }
    return { platform: record.platform, url: record.url };
  });
}

function normalizeFieldMeta(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse();
  }
  const source = value as Record<string, unknown>;
  const meta: Record<string, unknown> = {};
  for (const [path, entry] of Object.entries(source)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalidResponse();
    }
    const record = entry as Record<string, unknown>;
    const confidence = record.confidence;
    const sourceName = record.source;
    if (
      confidence !== "high" &&
      confidence !== "medium" &&
      confidence !== "low"
    ) {
      throw invalidResponse();
    }
    if (sourceName !== "rules" && sourceName !== "llm" && sourceName !== "llm+check") {
      throw invalidResponse();
    }
    if (typeof record.grounded !== "boolean") {
      throw invalidResponse();
    }
    meta[path] = {
      confidence,
      grounded: record.grounded,
      source: sourceName,
      grounding_status:
        typeof record.grounding_status === "string" ? record.grounding_status : null,
      evidence: normalizeEvidence(record.evidence),
    };
  }
  return meta;
}

function normalizeEvidence(value: unknown): Array<{ extracted_value: string }> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidResponse();
    }
    const extracted = (item as { extracted_value?: unknown }).extracted_value;
    if (typeof extracted !== "string") {
      throw invalidResponse();
    }
    return { extracted_value: extracted.slice(0, 500) };
  });
}

function normalizeWarnings(
  value: unknown,
): Array<{ path: string; code: string; message: string }> {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalidResponse();
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidResponse();
    }
    const record = item as Record<string, unknown>;
    if (typeof record.code !== "string" || typeof record.message !== "string") {
      throw invalidResponse();
    }
    return {
      path: typeof record.path === "string" ? record.path.slice(0, 200) : "",
      code: record.code.slice(0, 80),
      message: record.message.slice(0, 300),
    };
  });
}

function normalizeMeta(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse();
  }
  const record = value as Record<string, unknown>;
  if (typeof record.schemaVersion !== "string" || typeof record.provider !== "string") {
    throw invalidResponse();
  }
  return {
    schemaVersion: record.schemaVersion,
    provider: record.provider,
    fallbackUsed: record.fallbackUsed === true,
    latencyMs: typeof record.latencyMs === "number" ? record.latencyMs : 0,
    mock: record.mock === true,
  };
}

function emptyStrings(keys: string[]): Record<string, string | null> {
  return Object.fromEntries(keys.map((key) => [key, null]));
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw invalidResponse();
  }
  return value;
}

function optionalStringList(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalidResponse();
  }
  return value;
}
