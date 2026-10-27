export const LOCAL_DEV_USER_ID = "local-dev-user";

export const CERTIFICATE_STATUSES = [
  "PENDING",
  "VERIFIED",
  "UNVERIFIED",
] as const;

export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const FAILURE_REASONS = [
  "NOT_FOUND",
  "FIELD_MISMATCH",
  "ISSUER_UNAVAILABLE",
  "MAX_ATTEMPTS",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export const RECIPIENT_MATCHES = [
  "unchecked",
  "matched",
  "mismatched",
] as const;

export type RecipientMatch = (typeof RECIPIENT_MATCHES)[number];

export function isRecipientMatch(value: unknown): value is RecipientMatch {
  return (
    value === "unchecked" || value === "matched" || value === "mismatched"
  );
}

export interface CertificateEvidence {
  found: boolean;
  holderName: string | null;
  courseName: string | null;
  issuedDate: string | null;
  fetchedAt: string;
  summary: string;
}

export interface Certificate {
  id: string;
  userId: string;
  url: string;
  canonicalUrl: string | null;
  issuer: string | null;
  credentialId: string | null;
  status: CertificateStatus;
  evidence: CertificateEvidence | null;
  submittedAt: string;
  verifiedAt: string | null;
  attempts: number;
  failureReason: FailureReason | null;
  recipientMatch: RecipientMatch;
}
