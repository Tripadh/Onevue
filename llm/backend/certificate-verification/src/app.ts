import express from "express";
import { createCredlyAdapter } from "./adapters/credly-adapter.js";
import type { IssuerVerificationAdapter } from "./adapters/issuer-verification-adapter.js";
import type { CertificateRepository } from "./db/certificate-repository.js";
import { HttpError, errorHandler } from "./http/error-response.js";
import {
  SUBMISSION_RATE_LIMIT,
  VERIFICATION_RATE_LIMIT,
  createRateLimiter,
  isSubmissionRequest,
  isVerificationRequest,
  type RateLimitRule,
} from "./http/rate-limit.js";
import { rejectUnexpectedQuery } from "./http/request-guards.js";
import { securityHeaders } from "./http/security-headers.js";
import { createCertificateRouter } from "./routes/certificates.js";
import { healthRouter } from "./routes/health.js";

export interface CreateAppOptions {
  now?: () => number;
  submissionRateLimit?: RateLimitRule;
  verificationRateLimit?: RateLimitRule;
}

export function createApp(
  repository: CertificateRepository,
  adapter: IssuerVerificationAdapter = createCredlyAdapter(),
  options: CreateAppOptions = {},
) {
  const now = options.now ?? Date.now;
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
  app.set("trust proxy", false);
  app.use(securityHeaders);
  app.use(express.json({ limit: "16kb" }));
  app.use(
    createRateLimiter(
      options.submissionRateLimit ?? SUBMISSION_RATE_LIMIT,
      now,
      isSubmissionRequest,
    ),
  );
  app.use(
    createRateLimiter(
      options.verificationRateLimit ?? VERIFICATION_RATE_LIMIT,
      now,
      isVerificationRequest,
    ),
  );
  app.use(rejectUnexpectedQuery);
  app.use(healthRouter);
  app.use(createCertificateRouter(repository, adapter));
  app.use((_req, _res, next) => {
    next(
      new HttpError(404, "NOT_FOUND", "The requested resource was not found."),
    );
  });
  app.use(errorHandler);
  return app;
}
