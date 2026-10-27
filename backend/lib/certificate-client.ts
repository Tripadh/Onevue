export const CERTIFICATE_SERVICE_STATUSES = [
  "PENDING",
  "VERIFIED",
  "UNVERIFIED",
] as const;

export type CertificateServiceStatus =
  (typeof CERTIFICATE_SERVICE_STATUSES)[number];

const FAILURE_REASONS = new Set([
  "NOT_FOUND",
  "FIELD_MISMATCH",
  "ISSUER_UNAVAILABLE",
  "MAX_ATTEMPTS",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CertificateServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CertificateServiceError";
    this.status = status;
  }
}

export interface CertificateEvidenceRecord {
  found: boolean;
  holderName: string | null;
  courseName: string | null;
  issuedDate: string | null;
  fetchedAt: string;
  summary: string;
}

export interface CertificateServiceRecord {
  id: string;
  url: string;
  canonicalUrl: string | null;
  issuer: string | null;
  credentialId: string | null;
  status: CertificateServiceStatus;
  evidence: CertificateEvidenceRecord | null;
  submittedAt: string;
  verifiedAt: string | null;
  attempts: number;
  failureReason: string | null;
  recipientMatch: "unchecked" | "matched" | "mismatched";
}

export interface CertificateClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const UNAVAILABLE = "Certificate verification is temporarily unavailable.";
const SERVICE_AUTH = "Certificate service authentication failed.";
const UNEXPECTED = "Certificate verification returned an unexpected response.";
const VALIDATION = "Request validation failed.";

export function readCertificateClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): CertificateClientConfig | null {
  const baseUrl = env.CERTIFICATE_SERVICE_URL?.trim() ?? "";
  const token = env.CERTIFICATE_SERVICE_TOKEN?.trim() ?? "";
  if (baseUrl.length === 0 || token.length === 0) {
    return null;
  }

  // Two sequential issuer requests can each use a 5s timeout.
  const timeoutRaw = Number(env.CERTIFICATE_SERVICE_TIMEOUT_MS ?? "20000");
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 60000
      ? timeoutRaw
      : 20000;

  return { baseUrl, token, timeoutMs };
}

function validationError(): CertificateServiceError {
  return new CertificateServiceError(400, VALIDATION);
}

export function parseCertificateSubmitBody(body: unknown): { url: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationError();
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "url" || typeof record.url !== "string") {
    throw validationError();
  }

  const url = record.url.trim();
  if (url.length === 0 || url.length > 2048) {
    throw validationError();
  }

  return { url };
}

export function parseCertificateVerifyBody(
  body: unknown,
): { earnerEmail?: string } {
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw validationError();
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return {};
  }
  if (keys.length !== 1 || keys[0] !== "earnerEmail" || typeof record.earnerEmail !== "string") {
    throw validationError();
  }
  const earnerEmail = record.earnerEmail.trim();
  if (
    earnerEmail.length < 3 ||
    earnerEmail.length > 254 ||
    !/^[^@\s]+@[^@\s]+$/.test(earnerEmail)
  ) {
    throw validationError();
  }
  return { earnerEmail };
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function readEvidence(value: unknown): CertificateEvidenceRecord | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    return undefined;
  }
  const evidence = value as Record<string, unknown>;
  const holderName = nullableString(evidence.holderName);
  const courseName = nullableString(evidence.courseName);
  const issuedDate = nullableString(evidence.issuedDate);
  if (
    typeof evidence.found !== "boolean" ||
    holderName === undefined ||
    courseName === undefined ||
    issuedDate === undefined ||
    typeof evidence.fetchedAt !== "string" ||
    typeof evidence.summary !== "string"
  ) {
    return undefined;
  }

  return {
    found: evidence.found,
    holderName,
    courseName,
    issuedDate,
    fetchedAt: evidence.fetchedAt,
    summary: evidence.summary,
  };
}

export function readCertificateRecord(value: unknown): CertificateServiceRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const canonicalUrl = nullableString(record.canonicalUrl);
  const issuer = nullableString(record.issuer);
  const credentialId = nullableString(record.credentialId);
  const verifiedAt = nullableString(record.verifiedAt);
  const evidence = readEvidence(record.evidence);
  const failureReason = nullableString(record.failureReason);
  const recipientMatch =
    record.recipientMatch === undefined
      ? "unchecked"
      : record.recipientMatch === "unchecked" ||
          record.recipientMatch === "matched" ||
          record.recipientMatch === "mismatched"
        ? record.recipientMatch
        : undefined;
  if (
    typeof record.id !== "string" ||
    !UUID_PATTERN.test(record.id) ||
    typeof record.url !== "string" ||
    canonicalUrl === undefined ||
    issuer === undefined ||
    credentialId === undefined ||
    typeof record.status !== "string" ||
    !CERTIFICATE_SERVICE_STATUSES.includes(
      record.status as CertificateServiceStatus,
    ) ||
    evidence === undefined ||
    typeof record.submittedAt !== "string" ||
    verifiedAt === undefined ||
    typeof record.attempts !== "number" ||
    !Number.isInteger(record.attempts) ||
    failureReason === undefined ||
    (failureReason !== null && !FAILURE_REASONS.has(failureReason)) ||
    recipientMatch === undefined
  ) {
    return null;
  }

  return {
    id: record.id,
    url: record.url,
    canonicalUrl,
    issuer,
    credentialId,
    status: record.status as CertificateServiceStatus,
    evidence,
    submittedAt: record.submittedAt,
    verifiedAt,
    attempts: record.attempts,
    failureReason,
    recipientMatch,
  };
}

function safeServiceMessage(status: number, body: unknown): string {
  if (status === 404) {
    return "Certificate was not found.";
  }
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return status === 400 ? VALIDATION : UNAVAILABLE;
  }
  const error = (body as { error?: { message?: unknown } }).error;
  const message = error?.message;
  if (
    typeof message !== "string" ||
    message.length === 0 ||
    message.length > 300 ||
    message.includes("://") ||
    message.includes("\n") ||
    message.toLowerCase().includes("mongodb")
  ) {
    return status === 400 ? VALIDATION : UNAVAILABLE;
  }
  return message;
}

export async function callCertificateService(
  config: CertificateClientConfig,
  userId: string,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<{ status: number; certificate: CertificateServiceRecord; created?: boolean }> {
  const fetchImpl = config.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(new URL(path, config.baseUrl), {
      method,
      redirect: "error",
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${config.token}`,
        "x-onevue-user-id": userId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error instanceof CertificateServiceError) {
      throw error;
    }
    console.error("certificate-service stage=connection outcome=unreachable");
    throw new CertificateServiceError(503, UNAVAILABLE);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.status === 429) {
    throw new CertificateServiceError(429, "Too many certificate requests.");
  }

  if (response.status === 401) {
    console.error("certificate-service stage=authentication outcome=rejected");
    throw new CertificateServiceError(503, SERVICE_AUTH);
  }

  if (response.status >= 500) {
    console.error(
      `certificate-service stage=upstream outcome=error status=${response.status}`,
    );
    throw new CertificateServiceError(503, UNAVAILABLE);
  }

  if (!response.ok) {
    throw new CertificateServiceError(
      response.status,
      safeServiceMessage(response.status, payload),
    );
  }

  const envelope =
    typeof payload === "object" && payload !== null
      ? (payload as { created?: unknown; certificate?: unknown })
      : null;
  const certificate = readCertificateRecord(envelope?.certificate);
  if (certificate === null) {
    throw new CertificateServiceError(502, UNEXPECTED);
  }

  if (method === "POST" && path === "/certificates") {
    if (typeof envelope?.created !== "boolean") {
      throw new CertificateServiceError(502, UNEXPECTED);
    }
    return { status: response.status, created: envelope.created, certificate };
  }

  return { status: response.status, certificate };
}
