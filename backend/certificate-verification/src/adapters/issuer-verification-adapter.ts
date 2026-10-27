import type { IssuerId } from "../validation/issuers.js";

export interface IssuerConfirmedEvidence {
  issuer: IssuerId;
  credentialId: string;
  canonicalUrl: string;
  found: true;
  holderName: string;
  courseName: string;
  issuedDate: string;
  fetchedAt: string;
  /**
   * False when Credly's public assertion only contains a hashed recipient
   * and this service has no earner email to compare. The hash is not stored.
   */
  recipientDisclosed: boolean;
  issuerName: string;
  recipientMatch: "unchecked" | "matched" | "mismatched";
}

export interface IssuerNotFoundEvidence {
  issuer: IssuerId;
  credentialId: string;
  fetchedAt: string;
}

export interface IssuerRejectedEvidence {
  issuer: IssuerId;
  credentialId: string;
  canonicalUrl: string;
  fetchedAt: string;
  failure: "RECIPIENT_MISMATCH" | "EXPIRED" | "REVOKED";
}

export type IssuerVerificationResult =
  | { kind: "confirmed"; evidence: IssuerConfirmedEvidence }
  | { kind: "not_found"; evidence: IssuerNotFoundEvidence }
  | { kind: "rejected_evidence"; evidence: IssuerRejectedEvidence }
  | { kind: "malformed"; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "timeout" }
  | { kind: "rate_limited" }
  | { kind: "issuer_unavailable" };

export interface IssuerVerificationInput {
  url: string;
  resolvedAddresses?: readonly string[];
  expectedRecipientEmail?: string;
}

export interface IssuerVerificationAdapter {
  readonly issuer: IssuerId;
  verify(input: IssuerVerificationInput): Promise<IssuerVerificationResult>;
}
