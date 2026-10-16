import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  LOCAL_DEV_USER_ID,
  type Certificate,
  type CertificateStatus,
  type FailureReason,
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

type CertificateRow = {
  id: string;
  userId: string;
  url: string;
  canonicalUrl: string | null;
  issuer: string | null;
  credentialId: string | null;
  status: CertificateStatus;
  evidence: Prisma.JsonValue | null;
  submittedAt: string;
  verifiedAt: string | null;
  attempts: number;
  failureReason: FailureReason | null;
};

type CertificateDelegate = Prisma.TransactionClient["certificate"];

const UPDATE_ATTEMPTS = 3;

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
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

  if (isPrismaCode(error, "P2002")) {
    throw new CertificateConflictError(
      "The submission conflicts with an existing certificate.",
    );
  }

  throw new CertificateRepositoryError(
    "The certificate database request failed.",
  );
}

function toCertificate(row: CertificateRow): Certificate {
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
  };
}

function evidenceInput(
  evidence: Certificate["evidence"],
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (evidence === null) {
    return Prisma.DbNull;
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

async function withDatabaseRetries<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (isPrismaCode(error, "P2034") && attempt < UPDATE_ATTEMPTS - 1) {
        continue;
      }
      rethrowRepositoryError(error);
    }
  }

  throw new CertificateRepositoryError(
    "The certificate database request failed.",
  );
}

export class PostgresCertificateRepository implements CertificateRepository {
  constructor(private readonly prisma: PrismaClient) {}

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
    const userId = LOCAL_DEV_USER_ID;

    return withDatabaseRetries(() =>
      this.prisma.$transaction(async (tx) => {
        const existing = await this.findDuplicate(
          tx.certificate,
          userId,
          url,
          issuer,
          credentialId,
        );
        if (existing !== null) {
          return { certificate: existing, created: false };
        }

        try {
          const created = await tx.certificate.create({
            data: {
              id: randomUUID(),
              userId,
              url,
              canonicalUrl,
              issuer,
              credentialId,
              status: "PENDING",
              evidence: Prisma.DbNull,
              submittedAt: new Date().toISOString(),
              verifiedAt: null,
              attempts: 0,
              failureReason: null,
            },
          });
          return { certificate: toCertificate(created), created: true };
        } catch (error) {
          if (!isPrismaCode(error, "P2002")) {
            throw error;
          }

          const duplicate = await this.findDuplicate(
            tx.certificate,
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
      }),
    );
  }

  async findById(id: string): Promise<Certificate | null> {
    try {
      const row = await this.prisma.certificate.findUnique({ where: { id } });
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
      const row = await this.prisma.certificate.findUnique({
        where: { userId_url: { userId, url } },
      });
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
      const row = await this.prisma.certificate.findFirst({
        where: { userId, issuer, credentialId },
      });
      return row === null ? null : toCertificate(row);
    } catch (error) {
      rethrowRepositoryError(error);
    }
  }

  async update(id: string, patch: CertificatePatch): Promise<Certificate> {
    return withDatabaseRetries(() =>
      this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM certificates WHERE id = ${id} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new CertificateNotFoundError(
            `Certificate ${id} was not found.`,
          );
        }

        const row = await tx.certificate.findUnique({ where: { id } });
        if (row === null) {
          throw new CertificateNotFoundError(
            `Certificate ${id} was not found.`,
          );
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
          const owner = await tx.certificate.findFirst({
            where: {
              userId: next.userId,
              issuer: next.issuer,
              credentialId: next.credentialId,
              NOT: { id },
            },
          });
          if (owner !== null) {
            throw new CertificateConflictError(
              "Another certificate already uses this issuer and credential ID.",
            );
          }
        }

        const written = await tx.certificate.updateMany({
          where: {
            id,
            status: "PENDING",
            attempts: current.attempts,
          },
          data: {
            canonicalUrl: next.canonicalUrl,
            issuer: next.issuer,
            credentialId: next.credentialId,
            evidence: evidenceInput(next.evidence),
            attempts: next.attempts,
            status: next.status,
            verifiedAt: next.verifiedAt,
            failureReason: next.failureReason,
          },
        });
        if (written.count !== 1) {
          throw new InvalidCertificateUpdateError(
            "The certificate changed before the update was stored.",
          );
        }

        const stored = await tx.certificate.findUnique({ where: { id } });
        if (stored === null) {
          throw new CertificateNotFoundError(
            `Certificate ${id} was not found.`,
          );
        }
        return toCertificate(stored);
      }),
    );
  }

  private async findDuplicate(
    certificates: CertificateDelegate,
    userId: string,
    url: string,
    issuer: string | null,
    credentialId: string | null,
  ): Promise<Certificate | null> {
    const byUrl = await certificates.findUnique({
      where: { userId_url: { userId, url } },
    });
    const byCredential =
      issuer === null || credentialId === null
        ? null
        : await certificates.findFirst({
            where: { userId, issuer, credentialId },
          });

    if (
      byUrl !== null &&
      byCredential !== null &&
      byUrl.id !== byCredential.id
    ) {
      throw new CertificateConflictError(
        "The URL and credential ID match different certificates.",
      );
    }

    const existing = byUrl ?? byCredential;
    return existing === null ? null : toCertificate(existing);
  }
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
}
