import { randomUUID } from "node:crypto";
import type {
  Certificate,
  CertificateEvidence,
  RecipientMatch,
} from "./certificate.js";
import {
  optionalCertificateText,
  planCertificateUpdate,
} from "./certificate-update.js";
import {
  CertificateConflictError,
  CertificateNotFoundError,
  InvalidCertificateUpdateError,
  type CertificatePatch,
  type CertificateRepository,
  type CreateCertificateInput,
  type CreateCertificateResult,
} from "./certificate-repository.js";
import { actingUserId } from "./user-id.js";

function urlKey(userId: string, url: string): string {
  return JSON.stringify(["url", userId, url]);
}

function credentialKey(
  userId: string,
  issuer: string,
  credentialId: string,
): string {
  return JSON.stringify(["credential", userId, issuer, credentialId]);
}

function cloneEvidence(
  evidence: CertificateEvidence | null,
): CertificateEvidence | null {
  if (evidence === null) {
    return null;
  }

  return {
    found: evidence.found,
    holderName: evidence.holderName,
    courseName: evidence.courseName,
    issuedDate: evidence.issuedDate,
    fetchedAt: evidence.fetchedAt,
    summary: evidence.summary,
  };
}

function cloneCertificate(certificate: Certificate): Certificate {
  return {
    id: certificate.id,
    userId: certificate.userId,
    url: certificate.url,
    canonicalUrl: certificate.canonicalUrl,
    issuer: certificate.issuer,
    credentialId: certificate.credentialId,
    status: certificate.status,
    evidence: cloneEvidence(certificate.evidence),
    submittedAt: certificate.submittedAt,
    verifiedAt: certificate.verifiedAt,
    attempts: certificate.attempts,
    failureReason: certificate.failureReason,
    recipientMatch: certificate.recipientMatch,
  };
}

export class InMemoryCertificateRepository implements CertificateRepository {
  private readonly records = new Map<string, Certificate>();
  private readonly urlIndex = new Map<string, string>();
  private readonly credentialIndex = new Map<string, string>();

  async create(
    input: CreateCertificateInput,
  ): Promise<CreateCertificateResult> {
    const url = optionalCertificateText(input.url, "url");
    if (url === null) {
      throw new InvalidCertificateUpdateError(
        "url must be a non-empty string.",
      );
    }
    const canonicalUrl = optionalCertificateText(
      input.canonicalUrl,
      "canonicalUrl",
    );
    const issuer = optionalCertificateText(input.issuer, "issuer");
    const credentialId = optionalCertificateText(
      input.credentialId,
      "credentialId",
    );
    const userId = actingUserId(input.userId);
    const existingId = this.findExistingId(userId, url, issuer, credentialId);

    if (existingId !== null) {
      return {
        certificate: this.requireRecord(existingId),
        created: false,
      };
    }

    const certificate: Certificate = {
      id: randomUUID(),
      userId,
      url,
      canonicalUrl,
      issuer,
      credentialId,
      status: "PENDING",
      evidence: null,
      submittedAt: new Date().toISOString(),
      verifiedAt: null,
      attempts: 0,
      failureReason: null,
      recipientMatch: "unchecked",
    };

    this.records.set(certificate.id, certificate);
    this.urlIndex.set(urlKey(userId, url), certificate.id);
    this.writeCredentialKey(null, userId, issuer, credentialId, certificate.id);

    return {
      certificate: cloneCertificate(certificate),
      created: true,
    };
  }

  async findById(id: string): Promise<Certificate | null> {
    const certificate = this.records.get(id);
    return certificate === undefined ? null : cloneCertificate(certificate);
  }

  async findByUserAndUrl(
    userId: string,
    url: string,
  ): Promise<Certificate | null> {
    const id = this.urlIndex.get(urlKey(userId, url));
    return id === undefined ? null : this.requireRecord(id);
  }

  async findByUserAndCredential(
    userId: string,
    issuer: string,
    credentialId: string,
  ): Promise<Certificate | null> {
    const id = this.credentialIndex.get(
      credentialKey(userId, issuer, credentialId),
    );
    return id === undefined ? null : this.requireRecord(id);
  }

  async update(id: string, patch: CertificatePatch): Promise<Certificate> {
    const current = this.records.get(id);

    if (current === undefined) {
      throw new CertificateNotFoundError(`Certificate ${id} was not found.`);
    }

    if (
      patch.expectedUserId !== undefined &&
      patch.expectedUserId !== current.userId
    ) {
      throw new CertificateNotFoundError(`Certificate ${id} was not found.`);
    }

    if (current.status !== "PENDING") {
      throw new InvalidCertificateUpdateError(
        "A final certificate status cannot be changed.",
      );
    }

    if (
      patch.expectedAttempts !== undefined &&
      patch.expectedAttempts !== current.attempts
    ) {
      throw new InvalidCertificateUpdateError(
        "The certificate changed before the update was stored.",
      );
    }

    const next = planCertificateUpdate(current, patch);
    const owner = this.sameCredential(current, next)
      ? undefined
      : this.credentialOwner(next);

    if (owner !== undefined && owner !== id) {
      throw new CertificateConflictError(
        "Another certificate already uses this issuer and credential ID.",
      );
    }

    this.records.set(id, next);
    this.writeCredentialKey(
      this.credentialIdentity(current),
      next.userId,
      next.issuer,
      next.credentialId,
      id,
    );

    return cloneCertificate(next);
  }

  async recordRecipientMatch(
    id: string,
    binding: {
      userId: string;
      recipientMatch: RecipientMatch;
      expectedRecipientMatch: RecipientMatch;
      expectedAttempts: number;
    },
  ): Promise<Certificate> {
    const current = this.records.get(id);
    if (current === undefined || current.userId !== binding.userId) {
      throw new CertificateNotFoundError(`Certificate ${id} was not found.`);
    }
    if (
      current.status !== "VERIFIED" ||
      current.attempts !== binding.expectedAttempts ||
      current.recipientMatch !== binding.expectedRecipientMatch
    ) {
      throw new InvalidCertificateUpdateError(
        "The certificate changed before the recipient match was stored.",
      );
    }
    if (
      binding.recipientMatch === "unchecked" ||
      current.recipientMatch === "matched" ||
      current.recipientMatch === binding.recipientMatch
    ) {
      return cloneCertificate(current);
    }
    const next = { ...current, recipientMatch: binding.recipientMatch };
    this.records.set(id, next);
    return cloneCertificate(next);
  }

  private findExistingId(
    userId: string,
    url: string,
    issuer: string | null,
    credentialId: string | null,
  ): string | null {
    const urlMatch = this.urlIndex.get(urlKey(userId, url));
    const credentialMatch =
      issuer === null || credentialId === null
        ? undefined
        : this.credentialIndex.get(credentialKey(userId, issuer, credentialId));

    if (
      urlMatch !== undefined &&
      credentialMatch !== undefined &&
      urlMatch !== credentialMatch
    ) {
      throw new CertificateConflictError(
        "The URL and credential ID match different certificates.",
      );
    }

    return urlMatch ?? credentialMatch ?? null;
  }

  private requireRecord(id: string): Certificate {
    const certificate = this.records.get(id);

    if (certificate === undefined) {
      throw new CertificateConflictError(
        "A duplicate index points at a missing certificate.",
      );
    }

    return cloneCertificate(certificate);
  }

  private credentialIdentity(
    certificate: Pick<Certificate, "userId" | "issuer" | "credentialId">,
  ): string | null {
    if (certificate.issuer === null || certificate.credentialId === null) {
      return null;
    }

    return credentialKey(
      certificate.userId,
      certificate.issuer,
      certificate.credentialId,
    );
  }

  private sameCredential(left: Certificate, right: Certificate): boolean {
    return this.credentialIdentity(left) === this.credentialIdentity(right);
  }

  private credentialOwner(certificate: Certificate): string | undefined {
    const key = this.credentialIdentity(certificate);
    return key === null ? undefined : this.credentialIndex.get(key);
  }

  private writeCredentialKey(
    previousKey: string | null,
    userId: string,
    issuer: string | null,
    credentialId: string | null,
    id: string,
  ): void {
    const nextKey =
      issuer === null || credentialId === null
        ? null
        : credentialKey(userId, issuer, credentialId);

    if (previousKey !== null && previousKey !== nextKey) {
      if (this.credentialIndex.get(previousKey) === id) {
        this.credentialIndex.delete(previousKey);
      }
    }

    if (nextKey !== null && nextKey !== previousKey) {
      this.credentialIndex.set(nextKey, id);
    }
  }
}
