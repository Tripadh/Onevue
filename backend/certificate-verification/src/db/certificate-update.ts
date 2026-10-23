import {
  CERTIFICATE_STATUSES,
  FAILURE_REASONS,
  isRecipientMatch,
  type Certificate,
  type CertificateEvidence,
  type CertificateStatus,
  type FailureReason,
  type RecipientMatch,
} from "./certificate.js";
import {
  CertificateRepositoryError,
  InvalidCertificateUpdateError,
  type CertificatePatch,
} from "./certificate-repository.js";
import { isIso8601Timestamp } from "../utils/iso-timestamp.js";

const STATUS_VALUES = new Set<string>(CERTIFICATE_STATUSES);
const FAILURE_REASON_VALUES = new Set<string>(FAILURE_REASONS);

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InvalidCertificateUpdateError(
      `${field} must be a non-empty string.`,
    );
  }

  return value;
}

export function optionalCertificateText(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireText(value, field);
}

function copyEvidence(evidence: CertificateEvidence): CertificateEvidence {
  if (typeof evidence !== "object" || evidence === null) {
    throw new InvalidCertificateUpdateError(
      "evidence must be an object or null.",
    );
  }

  const { found, holderName, courseName, issuedDate, fetchedAt, summary } =
    evidence;

  if (typeof found !== "boolean") {
    throw new InvalidCertificateUpdateError(
      "evidence.found must be a boolean.",
    );
  }

  for (const [field, value] of [
    ["evidence.holderName", holderName],
    ["evidence.courseName", courseName],
    ["evidence.issuedDate", issuedDate],
  ] as const) {
    if (value !== null && typeof value !== "string") {
      throw new InvalidCertificateUpdateError(
        `${field} must be a string or null.`,
      );
    }
  }

  if (typeof fetchedAt !== "string" || fetchedAt.length === 0) {
    throw new InvalidCertificateUpdateError(
      "evidence.fetchedAt must be a non-empty string.",
    );
  }

  if (typeof summary !== "string") {
    throw new InvalidCertificateUpdateError(
      "evidence.summary must be a string.",
    );
  }

  return {
    found,
    holderName,
    courseName,
    issuedDate,
    fetchedAt,
    summary,
  };
}

function requireTimestamp(value: string | undefined, field: string): string {
  if (value === undefined || !isIso8601Timestamp(value)) {
    throw new InvalidCertificateUpdateError(
      `${field} must be an ISO 8601 timestamp.`,
    );
  }

  return value;
}

function isFailureReason(value: string): value is FailureReason {
  return FAILURE_REASON_VALUES.has(value);
}

function resolveAttempts(current: number, patch: number | undefined): number {
  if (patch === undefined) {
    return current;
  }

  if (!Number.isInteger(patch) || patch < current) {
    throw new InvalidCertificateUpdateError(
      "attempts can only stay the same or increase.",
    );
  }

  return patch;
}

export function readStoredEvidence(value: unknown): CertificateEvidence | null {
  if (value === null) {
    return null;
  }

  try {
    return copyEvidence(value as CertificateEvidence);
  } catch (error) {
    if (error instanceof InvalidCertificateUpdateError) {
      throw new CertificateRepositoryError(
        "Stored certificate evidence is invalid.",
      );
    }
    throw error;
  }
}

export function planCertificateUpdate(
  current: Certificate,
  patch: CertificatePatch,
): Certificate {
  if (patch.status !== undefined && !STATUS_VALUES.has(patch.status)) {
    throw new InvalidCertificateUpdateError("Unsupported certificate status.");
  }

  const status: CertificateStatus = patch.status ?? "PENDING";
  const attempts = resolveAttempts(current.attempts, patch.attempts);
  const canonicalUrl =
    patch.canonicalUrl !== undefined
      ? optionalCertificateText(patch.canonicalUrl, "canonicalUrl")
      : current.canonicalUrl;
  const issuer =
    patch.issuer !== undefined
      ? optionalCertificateText(patch.issuer, "issuer")
      : current.issuer;
  const credentialId =
    patch.credentialId !== undefined
      ? optionalCertificateText(patch.credentialId, "credentialId")
      : current.credentialId;
  const evidence =
    patch.evidence === undefined
      ? current.evidence === null
        ? null
        : copyEvidence(current.evidence)
      : patch.evidence === null
        ? null
        : copyEvidence(patch.evidence);
  const recipientMatch = recipientMatchForStatus(
    status,
    current.recipientMatch,
    patch.recipientMatch,
  );

  if (status === "PENDING") {
    if (patch.verifiedAt !== undefined) {
      throw new InvalidCertificateUpdateError(
        "verifiedAt is set only when a final decision is recorded.",
      );
    }

    if (patch.failureReason != null) {
      throw new InvalidCertificateUpdateError(
        "failureReason is stored only with UNVERIFIED.",
      );
    }

    return {
      ...current,
      canonicalUrl,
      issuer,
      credentialId,
      evidence,
      attempts,
      status: "PENDING",
      verifiedAt: null,
      failureReason: null,
      recipientMatch,
    };
  }

  const verifiedAt = requireTimestamp(patch.verifiedAt, "verifiedAt");

  if (status === "VERIFIED") {
    if (patch.failureReason != null) {
      throw new InvalidCertificateUpdateError(
        "VERIFIED requires an empty failureReason.",
      );
    }

    return {
      ...current,
      canonicalUrl,
      issuer,
      credentialId,
      evidence,
      attempts,
      status: "VERIFIED",
      verifiedAt,
      failureReason: null,
      recipientMatch,
    };
  }

  if (patch.failureReason == null || !isFailureReason(patch.failureReason)) {
    throw new InvalidCertificateUpdateError(
      "UNVERIFIED requires a failure reason.",
    );
  }

  return {
    ...current,
    canonicalUrl,
    issuer,
    credentialId,
    evidence,
    attempts,
    status: "UNVERIFIED",
    verifiedAt,
    failureReason: patch.failureReason,
    recipientMatch,
  };
}

function recipientMatchForStatus(
  status: CertificateStatus,
  current: RecipientMatch | undefined,
  requested: RecipientMatch | undefined,
): RecipientMatch {
  if (status !== "VERIFIED") {
    return "unchecked";
  }
  if (isRecipientMatch(requested)) {
    return requested;
  }
  return isRecipientMatch(current) ? current : "unchecked";
}
