import type {
  Certificate,
  CertificateEvidence,
  CertificateStatus,
  FailureReason,
} from "./certificate.js";

export interface CreateCertificateInput {
  url: string;
  canonicalUrl?: string | null;
  issuer?: string | null;
  credentialId?: string | null;
}

export interface CreateCertificateResult {
  certificate: Certificate;
  created: boolean;
}

export interface CertificatePatch {
  canonicalUrl?: string | null;
  issuer?: string | null;
  credentialId?: string | null;
  evidence?: CertificateEvidence | null;
  attempts?: number;
  expectedAttempts?: number;
  status?: CertificateStatus;
  verifiedAt?: string;
  failureReason?: FailureReason | null;
}

export interface CertificateRepository {
  create(input: CreateCertificateInput): Promise<CreateCertificateResult>;
  findById(id: string): Promise<Certificate | null>;
  findByUserAndUrl(userId: string, url: string): Promise<Certificate | null>;
  findByUserAndCredential(
    userId: string,
    issuer: string,
    credentialId: string,
  ): Promise<Certificate | null>;
  update(id: string, patch: CertificatePatch): Promise<Certificate>;
}

export class CertificateRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class CertificateNotFoundError extends CertificateRepositoryError {}

export class InvalidCertificateUpdateError extends CertificateRepositoryError {}

export class CertificateConflictError extends CertificateRepositoryError {}
