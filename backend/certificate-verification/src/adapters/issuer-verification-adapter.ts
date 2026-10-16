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
}

export interface IssuerNotFoundEvidence {
  issuer: IssuerId;
  credentialId: string;
  fetchedAt: string;
}

export type IssuerVerificationResult =
  | { kind: "confirmed"; evidence: IssuerConfirmedEvidence }
  | { kind: "not_found"; evidence: IssuerNotFoundEvidence }
  | { kind: "malformed"; reason: string }
  | { kind: "unsupported"; reason: string }
  | { kind: "timeout" }
  | { kind: "rate_limited" }
  | { kind: "issuer_unavailable" };

export interface IssuerVerificationInput {
  url: string;
  resolvedAddresses?: readonly string[];
}

export interface IssuerVerificationAdapter {
  readonly issuer: IssuerId;
  verify(input: IssuerVerificationInput): Promise<IssuerVerificationResult>;
}
