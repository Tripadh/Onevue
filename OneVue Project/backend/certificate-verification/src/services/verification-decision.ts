import type {
  Certificate,
  CertificateEvidence,
  FailureReason,
} from "../db/certificate.js";
import type { CertificatePatch } from "../db/certificate-repository.js";
import type {
  IssuerNotFoundEvidence,
  IssuerRejectedEvidence,
  IssuerVerificationResult,
} from "../adapters/issuer-verification-adapter.js";
import { matchIssuerEvidence } from "./evidence-matching.js";
import { isIso8601Timestamp } from "../utils/iso-timestamp.js";
import { parseCertificateUrl } from "../validation/certificate-url.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RetryableVerificationReason =
  | "timeout"
  | "rate_limited"
  | "issuer_unavailable"
  | "malformed"
  | "unsupported";

export type VerificationDecision =
  | { kind: "verified"; patch: CertificatePatch }
  | {
      kind: "unverified";
      reason: Extract<FailureReason, "NOT_FOUND" | "FIELD_MISMATCH">;
      patch: CertificatePatch;
    }
  | { kind: "retryable"; reason: RetryableVerificationReason }
  | { kind: "rejected"; reason: "final_status" };

function absentEvidence(
  fetchedAt: string,
  summary: string,
): CertificateEvidence {
  return {
    found: false,
    holderName: null,
    courseName: null,
    issuedDate: null,
    fetchedAt,
    summary,
  };
}

function rejectedSummary(failure: IssuerRejectedEvidence["failure"]): string {
  if (failure === "EXPIRED") {
    return "Issuer evidence says this credential is expired.";
  }
  if (failure === "REVOKED") {
    return "Issuer evidence says this credential is revoked.";
  }
  return "Issuer evidence did not match the submitted recipient.";
}

function rejectedIdentifiesCertificate(
  certificate: Certificate,
  evidence: IssuerRejectedEvidence,
): boolean {
  if (
    evidence.issuer !== "credly" ||
    !UUID_PATTERN.test(evidence.credentialId) ||
    !isIso8601Timestamp(evidence.fetchedAt) ||
    certificate.issuer === null ||
    certificate.credentialId === null ||
    certificate.canonicalUrl === null
  ) {
    return false;
  }

  const parsed = parseCertificateUrl(evidence.canonicalUrl);
  return (
    parsed.ok &&
    parsed.value.issuer === certificate.issuer &&
    parsed.value.credentialId === certificate.credentialId &&
    parsed.value.canonicalUrl === certificate.canonicalUrl &&
    evidence.credentialId.toLowerCase() === certificate.credentialId
  );
}

function notFoundIdentifiesCertificate(
  certificate: Certificate,
  evidence: IssuerNotFoundEvidence,
): boolean {
  if (
    evidence.issuer !== "credly" ||
    !UUID_PATTERN.test(evidence.credentialId) ||
    !isIso8601Timestamp(evidence.fetchedAt) ||
    certificate.issuer === null ||
    certificate.credentialId === null ||
    certificate.canonicalUrl === null
  ) {
    return false;
  }

  const parsed = parseCertificateUrl(
    `https://www.credly.com/badges/${evidence.credentialId.toLowerCase()}`,
  );
  return (
    parsed.ok &&
    parsed.value.issuer === certificate.issuer &&
    parsed.value.credentialId === certificate.credentialId &&
    parsed.value.canonicalUrl === certificate.canonicalUrl
  );
}

export function decideVerificationStatus(
  certificate: Certificate,
  result: IssuerVerificationResult,
  verifiedAt: string,
): VerificationDecision {
  if (certificate.status !== "PENDING") {
    return { kind: "rejected", reason: "final_status" };
  }

  if (!isIso8601Timestamp(verifiedAt)) {
    return { kind: "retryable", reason: "malformed" };
  }

  if (
    result.kind === "timeout" ||
    result.kind === "rate_limited" ||
    result.kind === "issuer_unavailable" ||
    result.kind === "malformed" ||
    result.kind === "unsupported"
  ) {
    return { kind: "retryable", reason: result.kind };
  }

  if (result.kind === "rejected_evidence") {
    if (!rejectedIdentifiesCertificate(certificate, result.evidence)) {
      return { kind: "retryable", reason: "unsupported" };
    }

    return {
      kind: "unverified",
      reason: "FIELD_MISMATCH",
      patch: {
        status: "UNVERIFIED",
        verifiedAt,
        failureReason: "FIELD_MISMATCH",
        evidence: absentEvidence(
          result.evidence.fetchedAt,
          rejectedSummary(result.evidence.failure),
        ),
      },
    };
  }

  if (result.kind === "not_found") {
    if (!notFoundIdentifiesCertificate(certificate, result.evidence)) {
      return { kind: "retryable", reason: "unsupported" };
    }

    return {
      kind: "unverified",
      reason: "NOT_FOUND",
      patch: {
        status: "UNVERIFIED",
        verifiedAt,
        failureReason: "NOT_FOUND",
        evidence: absentEvidence(
          result.evidence.fetchedAt,
          "Issuer reported that the credential does not exist.",
        ),
      },
    };
  }

  if (result.kind !== "confirmed") {
    return { kind: "retryable", reason: "unsupported" };
  }

  const match = matchIssuerEvidence(certificate, result.evidence);
  if (match.outcome === "mismatch") {
    return {
      kind: "unverified",
      reason: "FIELD_MISMATCH",
      patch: {
        status: "UNVERIFIED",
        verifiedAt,
        failureReason: "FIELD_MISMATCH",
        evidence: absentEvidence(
          isIso8601Timestamp(result.evidence.fetchedAt)
            ? result.evidence.fetchedAt
            : verifiedAt,
          "Issuer evidence did not match the submitted credential.",
        ),
      },
    };
  }

  if (match.outcome === "insufficient") {
    return { kind: "retryable", reason: "malformed" };
  }

  return {
    kind: "verified",
    patch: {
      status: "VERIFIED",
      verifiedAt,
      failureReason: null,
      evidence: {
        found: true,
        holderName: match.holderName,
        courseName: match.courseName,
        issuedDate: match.issuedDate,
        fetchedAt: match.fetchedAt,
        summary:
          match.recipientMatch === "matched"
            ? "Issuer confirmed the credential, and the supplied earner email matches the badge recipient."
            : match.recipientMatch === "mismatched"
              ? "Issuer confirmed the credential. The supplied earner email did not match the badge recipient."
              : "Issuer confirmed the credential.",
      },
      recipientMatch: match.recipientMatch,
    },
  };
}
