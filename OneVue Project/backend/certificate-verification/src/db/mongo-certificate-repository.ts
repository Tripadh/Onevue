import { randomUUID } from "node:crypto";
import {
  MongoClient,
  type Collection,
  type MongoClientOptions,
} from "mongodb";
import {
  isRecipientMatch,
  type Certificate,
  type CertificateEvidence,
  type CertificateStatus,
  type FailureReason,
  type RecipientMatch,
} from "./certificate.js";
import {
  optionalCertificateText,
  planCertificateUpdate,
  readStoredEvidence,
} from "./certificate-update.js";
import {
  CertificateConflictError,
  CertificateNotFoundError,
  CertificateRepositoryError,
  InvalidCertificateUpdateError,
  type CertificatePatch,
  type CertificateRepository,
  type CreateCertificateInput,
  type CreateCertificateResult,
} from "./certificate-repository.js";
import { actingUserId } from "./user-id.js";

const COLLECTION_NAME = "certificates";

export interface CertificateDocument {
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
  recipientMatch?: RecipientMatch;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function rethrowRepositoryError(error: unknown): never {
  if (
    error instanceof CertificateNotFoundError ||
    error instanceof InvalidCertificateUpdateError ||
    error instanceof CertificateConflictError ||
    error instanceof CertificateRepositoryError
  ) {
    throw error;
  }

  if (isDuplicateKey(error)) {
    throw new CertificateConflictError(
      "The submission conflicts with an existing certificate.",
    );
  }

  throw new CertificateRepositoryError(
    "The certificate database request failed.",
  );
}

function toCertificate(row: CertificateDocument): Certificate {
  return {
    id: row.id,
    userId: row.userId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    issuer: row.issuer,
    credentialId: row.credentialId,
    status: row.status,
    evidence: readStoredEvidence(row.evidence),
    submittedAt: row.submittedAt,
    verifiedAt: row.verifiedAt,
    attempts: row.attempts,
    failureReason: row.failureReason,
    recipientMatch: isRecipientMatch(row.recipientMatch)
      ? row.recipientMatch
      : "unchecked",
  };
}

export class MongoCertificateRepository implements CertificateRepository {
  constructor(private readonly certificates: Collection<CertificateDocument>) {}

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

    try {
      const existing = await this.findDuplicate(
        userId,
        url,
        issuer,
        credentialId,
      );
      if (existing !== null) {
        return { certificate: existing, created: false };
      }

      const document: CertificateDocument = {
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

      try {
        await this.certificates.insertOne(document);
        return { certificate: toCertificate(document), created: true };
      } catch (error) {
        if (!isDuplicateKey(error)) {
          throw error;
        }

        const duplicate = await this.findDuplicate(
          userId,
          url,
          issuer,
          credentialId,
        );
        if (duplicate === null) {
          throw new CertificateConflictError(
            "The submission conflicts with an existing certificate.",
          );
        }
        return { certificate: duplicate, created: false };
      }
    } catch (error) {
      rethrowRepositoryError(error);
    }
  }

  async findById(id: string): Promise<Certificate | null> {
    try {
      const row = await this.certificates.findOne({ id });
      return row === null ? null : toCertificate(row);
    } catch (error) {
      rethrowRepositoryError(error);
    }
  }

  async findByUserAndUrl(
    userId: string,
    url: string,
  ): Promise<Certificate | null> {
    try {
      const row = await this.certificates.findOne({ userId, url });
      return row === null ? null : toCertificate(row);
    } catch (error) {
      rethrowRepositoryError(error);
    }
  }

  async findByUserAndCredential(
    userId: string,
    issuer: string,
    credentialId: string,
  ): Promise<Certificate | null> {
    try {
      const row = await this.certificates.findOne({
        userId,
        issuer,
        credentialId,
      });
      return row === null ? null : toCertificate(row);
    } catch (error) {
      rethrowRepositoryError(error);
    }
  }

  async update(id: string, patch: CertificatePatch): Promise<Certificate> {
    try {
      const row = await this.certificates.findOne(
        patch.expectedUserId === undefined
          ? { id }
          : { id, userId: patch.expectedUserId },
      );
      if (row === null) {
        throw new CertificateNotFoundError(`Certificate ${id} was not found.`);
      }

      const current = toCertificate(row);
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
      if (
        next.issuer !== null &&
        next.credentialId !== null &&
        (next.issuer !== current.issuer ||
          next.credentialId !== current.credentialId)
      ) {
        const owner = await this.certificates.findOne({
          userId: next.userId,
          issuer: next.issuer,
          credentialId: next.credentialId,
          id: { $ne: id },
        });
        if (owner !== null) {
          throw new CertificateConflictError(
            "Another certificate already uses this issuer and credential ID.",
          );
        }
      }

      const written = await this.certificates.findOneAndUpdate(
        {
          id,
          userId: current.userId,
          status: "PENDING",
          attempts: current.attempts,
        },
        {
          $set: {
            canonicalUrl: next.canonicalUrl,
            issuer: next.issuer,
            credentialId: next.credentialId,
            evidence: next.evidence,
            attempts: next.attempts,
            status: next.status,
            verifiedAt: next.verifiedAt,
            failureReason: next.failureReason,
            recipientMatch: next.recipientMatch,
          },
        },
        { returnDocument: "after" },
      );
      if (written === null) {
        throw new InvalidCertificateUpdateError(
          "The certificate changed before the update was stored.",
        );
      }
      return toCertificate(written);
    } catch (error) {
      rethrowRepositoryError(error);
    }
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
    if (
      binding.recipientMatch === "unchecked" ||
      binding.recipientMatch === binding.expectedRecipientMatch ||
      binding.expectedRecipientMatch === "matched"
    ) {
      const current = await this.findOwned(id, binding.userId);
      if (
        current.status !== "VERIFIED" ||
        current.attempts !== binding.expectedAttempts ||
        current.recipientMatch !== binding.expectedRecipientMatch
      ) {
        throw new InvalidCertificateUpdateError(
          "The certificate changed before the recipient match was stored.",
        );
      }
      return current;
    }

    try {
      const written = await this.certificates.findOneAndUpdate(
        {
          id,
          userId: binding.userId,
          status: "VERIFIED",
          attempts: binding.expectedAttempts,
          ...(binding.expectedRecipientMatch === "unchecked"
            ? {
                $or: [
                  { recipientMatch: "unchecked" },
                  { recipientMatch: { $exists: false } },
                ],
              }
            : { recipientMatch: binding.expectedRecipientMatch }),
        },
        { $set: { recipientMatch: binding.recipientMatch } },
        { returnDocument: "after" },
      );
      if (written === null) {
        throw new InvalidCertificateUpdateError(
          "The certificate changed before the recipient match was stored.",
        );
      }
      return toCertificate(written);
    } catch (error) {
      rethrowRepositoryError(error);
    }
  }

  private async findOwned(id: string, userId: string): Promise<Certificate> {
    const row = await this.certificates.findOne({ id, userId });
    if (row === null) {
      throw new CertificateNotFoundError(`Certificate ${id} was not found.`);
    }
    return toCertificate(row);
  }

  private async findDuplicate(
    userId: string,
    url: string,
    issuer: string | null,
    credentialId: string | null,
  ): Promise<Certificate | null> {
    const byUrl = await this.certificates.findOne({ userId, url });
    const byCredential =
      issuer === null || credentialId === null
        ? null
        : await this.certificates.findOne({ userId, issuer, credentialId });

    if (byUrl !== null && byCredential !== null && byUrl.id !== byCredential.id) {
      throw new CertificateConflictError(
        "The URL and credential ID match different certificates.",
      );
    }

    const existing = byUrl ?? byCredential;
    return existing === null ? null : toCertificate(existing);
  }
}

export async function ensureCertificateIndexes(
  certificates: Collection<CertificateDocument>,
): Promise<void> {
  await certificates.createIndex(
    { id: 1 },
    { unique: true, name: "certificates_id_key" },
  );
  await certificates.createIndex(
    { userId: 1, url: 1 },
    { unique: true, name: "certificates_user_id_url_key" },
  );
  await certificates.createIndex(
    { userId: 1, issuer: 1, credentialId: 1 },
    {
      unique: true,
      name: "certificates_user_credential_key",
      partialFilterExpression: {
        issuer: { $type: "string" },
        credentialId: { $type: "string" },
      },
    },
  );
}

export interface ConnectedCertificateDatabase {
  client: MongoClient;
  repository: MongoCertificateRepository;
}

export async function connectCertificateDatabase(
  uri: string,
  options: MongoClientOptions = {},
): Promise<ConnectedCertificateDatabase> {
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    ...options,
  });

  try {
    await client.connect();
    await client.db().command({ ping: 1 });
    const certificates = client
      .db()
      .collection<CertificateDocument>(COLLECTION_NAME);
    await ensureCertificateIndexes(certificates);
    return { client, repository: new MongoCertificateRepository(certificates) };
  } catch (error) {
    await client.close().catch(() => undefined);
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === 85 || code === 86) {
      throw new Error(
        "The certificates collection has an incompatible index. It was left unchanged.",
      );
    }
    throw new Error("Could not connect to the certificate database.");
  }
}
