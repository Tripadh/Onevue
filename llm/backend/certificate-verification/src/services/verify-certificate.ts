import type { Certificate } from "../db/certificate.js";
import {
  CertificateNotFoundError,
  InvalidCertificateUpdateError,
  type CertificatePatch,
  type CertificateRepository,
} from "../db/certificate-repository.js";
import type { IssuerVerificationAdapter } from "../adapters/issuer-verification-adapter.js";
import type { RecipientMatch } from "../db/certificate.js";
import {
  decideVerificationStatus,
  type VerificationDecision,
} from "./verification-decision.js";
import { matchIssuerEvidence } from "./evidence-matching.js";

const verificationTails = new Map<string, Promise<void>>();

function serializeVerification<T>(
  certificateId: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = verificationTails.get(certificateId) ?? Promise.resolve();
  const outcome = previous.then(work, work);
  const tail = outcome.then(
    () => undefined,
    () => undefined,
  );
  verificationTails.set(certificateId, tail);
  void tail.then(() => {
    if (verificationTails.get(certificateId) === tail) {
      verificationTails.delete(certificateId);
    }
  });
  return outcome;
}

export interface VerificationOutcome {
  decision: VerificationDecision;
  certificate: Certificate;
}

export interface VerifyCertificateOptions {
  now?: () => Date;
  userId?: string;
  earnerEmail?: string;
}

async function readCertificate(
  repository: CertificateRepository,
  certificateId: string,
  userId?: string,
): Promise<Certificate> {
  const certificate = await repository.findById(certificateId);
  if (
    certificate === null ||
    (userId !== undefined && certificate.userId !== userId)
  ) {
    throw new CertificateNotFoundError(
      `Certificate ${certificateId} was not found.`,
    );
  }

  return certificate;
}

function storedDecision(
  decision: VerificationDecision,
  certificate: Certificate,
): VerificationOutcome {
  if (
    decision.kind === "verified" &&
    certificate.status === "VERIFIED" &&
    certificate.failureReason === null
  ) {
    return { decision, certificate };
  }

  if (
    decision.kind === "unverified" &&
    certificate.status === "UNVERIFIED" &&
    certificate.failureReason === decision.reason
  ) {
    return { decision, certificate };
  }

  if (decision.kind === "retryable" && certificate.status === "PENDING") {
    return { decision, certificate };
  }

  return {
    decision: { kind: "rejected", reason: "final_status" },
    certificate,
  };
}

const CONDITIONAL_UPDATE_ATTEMPTS = 5;

async function commitVerification(
  repository: CertificateRepository,
  certificateId: string,
  decision: Exclude<VerificationDecision, { kind: "rejected" }>,
  userId?: string,
): Promise<VerificationOutcome> {
  let lastError: InvalidCertificateUpdateError | undefined;

  for (let attempt = 0; attempt < CONDITIONAL_UPDATE_ATTEMPTS; attempt += 1) {
    const latest = await readCertificate(repository, certificateId, userId);
    if (latest.status !== "PENDING") {
      return {
        decision: { kind: "rejected", reason: "final_status" },
        certificate: latest,
      };
    }

    const owner =
      userId === undefined ? {} : { expectedUserId: userId };
    const patch: CertificatePatch =
      decision.kind === "retryable"
        ? {
            attempts: latest.attempts + 1,
            expectedAttempts: latest.attempts,
            ...owner,
          }
        : {
            ...decision.patch,
            attempts: latest.attempts + 1,
            expectedAttempts: latest.attempts,
            ...owner,
          };

    try {
      const certificate = await repository.update(certificateId, patch);
      return storedDecision(decision, certificate);
    } catch (error) {
      if (!(error instanceof InvalidCertificateUpdateError)) {
        throw error;
      }
      lastError = error;
    }
  }

  const current = await readCertificate(repository, certificateId, userId);
  if (current.status !== "PENDING") {
    return {
      decision: { kind: "rejected", reason: "final_status" },
      certificate: current,
    };
  }

  throw (
    lastError ??
    new InvalidCertificateUpdateError(
      "The certificate changed before the update was stored.",
    )
  );
}

function progressedRecipientMatch(
  current: RecipientMatch,
  observed: RecipientMatch,
): RecipientMatch | null {
  if (observed === "unchecked" || observed === current || current === "matched") {
    return null;
  }
  if (current === "unchecked") {
    return observed;
  }
  if (current === "mismatched" && observed === "matched") {
    return "matched";
  }
  return null;
}

async function bindVerifiedRecipient(
  repository: CertificateRepository,
  adapter: IssuerVerificationAdapter,
  current: Certificate,
  earnerEmail: string,
): Promise<VerificationOutcome> {
  const unchanged = {
    decision: { kind: "rejected" as const, reason: "final_status" as const },
    certificate: current,
  };
  let result;
  try {
    result = await adapter.verify({
      url: current.url,
      expectedRecipientEmail: earnerEmail,
    });
  } catch {
    return unchanged;
  }
  if (result.kind !== "confirmed") {
    return unchanged;
  }
  const match = matchIssuerEvidence(current, result.evidence);
  if (match.outcome !== "match") {
    return unchanged;
  }
  const next = progressedRecipientMatch(
    current.recipientMatch,
    match.recipientMatch,
  );
  if (next === null) {
    return unchanged;
  }
  try {
    const certificate = await repository.recordRecipientMatch(current.id, {
      userId: current.userId,
      recipientMatch: next,
      expectedRecipientMatch: current.recipientMatch,
      expectedAttempts: current.attempts,
    });
    return {
      decision: {
        kind: "verified",
        patch: {
          status: "VERIFIED",
          verifiedAt: certificate.verifiedAt ?? current.verifiedAt ?? "",
          failureReason: null,
          recipientMatch: certificate.recipientMatch,
          evidence: certificate.evidence ?? undefined,
        },
      },
      certificate,
    };
  } catch (error) {
    if (
      !(error instanceof InvalidCertificateUpdateError) &&
      !(error instanceof CertificateNotFoundError)
    ) {
      throw error;
    }
    return {
      decision: { kind: "rejected", reason: "final_status" },
      certificate: await readCertificate(repository, current.id, current.userId),
    };
  }
}

async function runVerification(
  repository: CertificateRepository,
  adapter: IssuerVerificationAdapter,
  certificateId: string,
  options: VerifyCertificateOptions,
): Promise<VerificationOutcome> {
  const current = await readCertificate(
    repository,
    certificateId,
    options.userId,
  );
  if (current.status === "VERIFIED" && options.earnerEmail !== undefined) {
    return bindVerifiedRecipient(
      repository,
      adapter,
      current,
      options.earnerEmail,
    );
  }
  if (current.status !== "PENDING") {
    return {
      decision: { kind: "rejected", reason: "final_status" },
      certificate: current,
    };
  }

  let result;
  try {
    result = await adapter.verify({
      url: current.url,
      ...(options.earnerEmail === undefined
        ? {}
        : { expectedRecipientEmail: options.earnerEmail }),
    });
  } catch {
    result = { kind: "issuer_unavailable" as const };
  }

  const decision = decideVerificationStatus(
    current,
    result,
    (options.now ?? (() => new Date()))().toISOString(),
  );

  if (decision.kind === "rejected") {
    return { decision, certificate: current };
  }

  return commitVerification(repository, current.id, decision, options.userId);
}

export async function verifyPendingCertificate(
  repository: CertificateRepository,
  adapter: IssuerVerificationAdapter,
  certificateId: string,
  options: VerifyCertificateOptions = {},
): Promise<VerificationOutcome> {
  return serializeVerification(certificateId, () =>
    runVerification(repository, adapter, certificateId, options),
  );
}
