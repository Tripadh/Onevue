import type { ErrorRequestHandler } from "express";
import {
  CertificateConflictError,
  CertificateNotFoundError,
  InvalidCertificateUpdateError,
} from "../db/certificate-repository.js";

export interface ErrorDetail {
  path: string;
  message: string;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorBody(
  code: string,
  message: string,
  details?: ErrorDetail[],
): ErrorBody {
  const body: ErrorBody = { error: { code, message } };
  if (details !== undefined) {
    body.error.details = details;
  }
  return body;
}

function errorType(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("type" in error)) {
    return undefined;
  }

  return typeof error.type === "string" ? error.type : undefined;
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res
      .status(error.status)
      .json(errorBody(error.code, error.message, error.details));
    return;
  }

  if (errorType(error) === "entity.parse.failed") {
    res
      .status(400)
      .json(errorBody("MALFORMED_JSON", "Request JSON is malformed."));
    return;
  }

  if (errorType(error) === "entity.too.large") {
    res
      .status(413)
      .json(errorBody("PAYLOAD_TOO_LARGE", "Request body is too large."));
    return;
  }

  if (error instanceof CertificateNotFoundError) {
    res.status(404).json(errorBody("NOT_FOUND", "Certificate was not found."));
    return;
  }

  if (error instanceof CertificateConflictError) {
    res
      .status(409)
      .json(
        errorBody(
          "CONFLICT",
          "The submission conflicts with an existing certificate.",
        ),
      );
    return;
  }

  if (error instanceof InvalidCertificateUpdateError) {
    res
      .status(400)
      .json(errorBody("VALIDATION_ERROR", "Request validation failed."));
    return;
  }

  console.error("Unexpected certificate API error.");
  res
    .status(500)
    .json(errorBody("INTERNAL_ERROR", "An unexpected error occurred."));
};
