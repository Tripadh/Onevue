import { Router, type RequestHandler } from "express";
import type { ZodError } from "zod";
import { resolveActingUserId } from "../auth/acting-user.js";
import { createCredlyAdapter } from "../adapters/credly-adapter.js";
import type { IssuerVerificationAdapter } from "../adapters/issuer-verification-adapter.js";
import type {
  Certificate,
  CertificateEvidence,
  CertificateStatus,
  FailureReason,
} from "../db/certificate.js";
import type { CertificateRepository } from "../db/certificate-repository.js";
import { HttpError } from "../http/error-response.js";
import { verifyPendingCertificate } from "../services/verify-certificate.js";
import { parseCertificateUrl } from "../validation/certificate-url.js";
import {
  certificateIdSchema,
  fieldErrors,
  submitCertificateBodySchema,
  verifyCertificateBodySchema,
} from "../validation/certificate-input.js";

interface CertificateEvidenceResponse {
  found: boolean;
  holderName: string | null;
  courseName: string | null;
  issuedDate: string | null;
  fetchedAt: string;
  summary: string;
}

interface CertificateResponse {
  id: string;
  url: string;
  canonicalUrl: string | null;
  issuer: string | null;
  credentialId: string | null;
  status: CertificateStatus;
  evidence: CertificateEvidenceResponse | null;
  submittedAt: string;
  verifiedAt: string | null;
  attempts: number;
  failureReason: FailureReason | null;
  recipientMatch: "unchecked" | "matched" | "mismatched";
}

function toEvidenceResponse(
  evidence: CertificateEvidence,
): CertificateEvidenceResponse {
  return {
    found: evidence.found,
    holderName: evidence.holderName,
    courseName: evidence.courseName,
    issuedDate: evidence.issuedDate,
    fetchedAt: evidence.fetchedAt,
    summary: evidence.summary,
  };
}

export function toCertificateResponse(
  certificate: Certificate,
): CertificateResponse {
  return {
    id: certificate.id,
    url: certificate.url,
    canonicalUrl: certificate.canonicalUrl,
    issuer: certificate.issuer,
    credentialId: certificate.credentialId,
    status: certificate.status,
    evidence:
      certificate.evidence === null
        ? null
        : toEvidenceResponse(certificate.evidence),
    submittedAt: certificate.submittedAt,
    verifiedAt: certificate.verifiedAt,
    attempts: certificate.attempts,
    failureReason: certificate.failureReason,
    recipientMatch: certificate.recipientMatch,
  };
}

function mediaType(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(";", 1)[0]?.trim().toLowerCase();
}

function validationFailure(error: ZodError): HttpError {
  return new HttpError(
    400,
    "VALIDATION_ERROR",
    "Request validation failed.",
    fieldErrors(error),
  );
}

export function createCertificateRouter(
  repository: CertificateRepository,
  adapter: IssuerVerificationAdapter = createCredlyAdapter(),
): Router {
  const router = Router();

  const submitCertificate: RequestHandler = async (req, res) => {
    const contentType = mediaType(req.headers["content-type"]);
    if (contentType !== undefined && contentType !== "application/json") {
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type must be application/json.",
      );
    }

    const body = req.body === undefined || req.body === null ? {} : req.body;
    const parsed = submitCertificateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw validationFailure(parsed.error);
    }

    const certificateUrl = parseCertificateUrl(parsed.data.url);
    if (!certificateUrl.ok) {
      throw new HttpError(
        400,
        "VALIDATION_ERROR",
        "Request validation failed.",
        [certificateUrl.error],
      );
    }

    const actingUserId = resolveActingUserId(req.headers);
    const result = await repository.create({
      userId: actingUserId,
      url: parsed.data.url,
      canonicalUrl: certificateUrl.value.canonicalUrl,
      issuer: certificateUrl.value.issuer,
      credentialId: certificateUrl.value.credentialId,
    });
    res.status(result.created ? 202 : 200).json({
      created: result.created,
      certificate: toCertificateResponse(result.certificate),
    });
  };

  const readCertificate: RequestHandler = async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsed = certificateIdSchema.safeParse({ id });
    if (!parsed.success) {
      throw validationFailure(parsed.error);
    }

    const certificate = await repository.findById(parsed.data.id);
    if (
      certificate === null ||
      certificate.userId !== resolveActingUserId(req.headers)
    ) {
      throw new HttpError(404, "NOT_FOUND", "Certificate was not found.");
    }

    res.status(200).json({
      certificate: toCertificateResponse(certificate),
    });
  };

  const verifyCertificate: RequestHandler = async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const parsedId = certificateIdSchema.safeParse({ id });
    if (!parsedId.success) {
      throw validationFailure(parsedId.error);
    }

    const contentType = mediaType(req.headers["content-type"]);
    if (contentType !== undefined && contentType !== "application/json") {
      throw new HttpError(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "Content-Type must be application/json.",
      );
    }

    const body = req.body === undefined || req.body === null ? {} : req.body;
    const parsedBody = verifyCertificateBodySchema.safeParse(body);
    if (!parsedBody.success) {
      throw validationFailure(parsedBody.error);
    }

    const existing = await repository.findById(parsedId.data.id);
    if (
      existing === null ||
      existing.userId !== resolveActingUserId(req.headers)
    ) {
      throw new HttpError(404, "NOT_FOUND", "Certificate was not found.");
    }

    const outcome = await verifyPendingCertificate(
      repository,
      adapter,
      existing.id,
      {
        userId: existing.userId,
        ...(parsedBody.data.earnerEmail === undefined
          ? {}
          : { earnerEmail: parsedBody.data.earnerEmail }),
      },
    );
    res.status(200).json({
      certificate: toCertificateResponse(outcome.certificate),
    });
  };

  router.post("/certificates", submitCertificate);
  router.get("/certificates/:id", readCertificate);
  router.post("/certificates/:id/verify", verifyCertificate);
  return router;
}
