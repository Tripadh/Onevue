import {
  completeCredlyEvidence,
  readCredlyAssertion,
  type CredlyEvidenceContext,
} from "./credly-open-badges.js";
import type {
  IssuerVerificationAdapter,
  IssuerVerificationInput,
  IssuerVerificationResult,
} from "./issuer-verification-adapter.js";
import { isIso8601Timestamp } from "../utils/iso-timestamp.js";
import {
  assessCredlyUrl,
  assessResolvedAddresses,
} from "../utils/issuer-request-guard.js";
import {
  assessCredlyEvidenceUrl,
  credlyAssertionUrl,
  evidenceUrlsMatch,
} from "../validation/credly-evidence-url.js";

export const CREDLY_REQUEST_TIMEOUT_MS = 5_000;
export const CREDLY_MAX_RESPONSE_BYTES = 1_048_576;

export const CREDLY_NETWORK_DISABLED_REASON =
  "Credly retrieval is disabled until an official public evidence source is confirmed.";

export const CREDLY_EVIDENCE_UNSUPPORTED_REASON =
  "The response is not accepted Credly evidence. HTTP success, a badge id, or an unrecognized document cannot verify a credential.";

export const CREDLY_REDIRECT_REASON =
  "Credly redirects are not followed. The redirect target is not used as verification evidence.";

export interface CredlyTransportRequest {
  method: "GET";
  issuer: "credly";
  credentialId: string;
  canonicalUrl: string;
  evidenceUrl: string;
  timeoutMs: number;
  maxResponseBytes: number;
}

export type CredlyTransportResult =
  | { type: "timeout" }
  | { type: "rate_limited" }
  | { type: "unavailable" }
  | { type: "blocked" }
  | { type: "too_large" }
  | { type: "unsupported_content" }
  | {
      type: "response";
      status: number;
      bodyText: string;
      contentType?: string | null;
      redirectUrl?: string;
    };

export interface CredlyTransport {
  readonly resolvesDns?: boolean;
  exchange(request: CredlyTransportRequest): Promise<CredlyTransportResult>;
}

const JSON_MEDIA_TYPES = new Set(["application/json", "application/ld+json"]);

export interface CredlyVerificationLog {
  event: "credly_verification";
  outcome: string;
  credentialId: string;
}

export type CredlyVerificationLogger = (event: CredlyVerificationLog) => void;

export function isSupportedIssuerContentType(
  contentType: string | null | undefined,
): boolean {
  if (contentType === undefined) {
    return true;
  }
  if (contentType === null) {
    return false;
  }
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType !== undefined && JSON_MEDIA_TYPES.has(mediaType);
}

export interface CredlyAdapterOptions {
  transport?: CredlyTransport;
  permitOutbound?: boolean;
  now?: () => Date;
  log?: boolean;
  logger?: CredlyVerificationLogger;
}

export function interpretCredlyResponseBody(
  bodyText: string,
  maxResponseBytes = CREDLY_MAX_RESPONSE_BYTES,
): IssuerVerificationResult {
  if (
    bodyText.length === 0 ||
    bodyText.length > maxResponseBytes ||
    bodyText.includes("\u0000")
  ) {
    return {
      kind: "malformed",
      reason: "Credly response body is empty, too large, or not valid JSON.",
    };
  }

  try {
    JSON.parse(bodyText);
  } catch {
    return {
      kind: "malformed",
      reason: "Credly response body is empty, too large, or not valid JSON.",
    };
  }

  return {
    kind: "unsupported",
    reason: CREDLY_EVIDENCE_UNSUPPORTED_REASON,
  };
}

type HttpDocument =
  | { type: "json"; bodyText: string }
  | { type: "result"; result: IssuerVerificationResult };

function interpretTransportResult(
  result: CredlyTransportResult,
  evidenceUrl: string,
  context: CredlyEvidenceContext,
): HttpDocument {
  if (result.type === "timeout") {
    return { type: "result", result: { kind: "timeout" } };
  }
  if (result.type === "rate_limited") {
    return { type: "result", result: { kind: "rate_limited" } };
  }
  if (result.type === "unavailable") {
    return { type: "result", result: { kind: "issuer_unavailable" } };
  }
  if (result.type === "blocked" || result.type === "unsupported_content") {
    return {
      type: "result",
      result: {
        kind: "unsupported",
        reason: CREDLY_EVIDENCE_UNSUPPORTED_REASON,
      },
    };
  }
  if (result.type === "too_large") {
    return {
      type: "result",
      result: {
        kind: "malformed",
        reason: "Credly response body is empty, too large, or not valid JSON.",
      },
    };
  }

  if (
    result.redirectUrl !== undefined ||
    (result.status >= 300 && result.status < 400)
  ) {
    if (
      result.redirectUrl !== undefined &&
      evidenceUrlsMatch(evidenceUrl, result.redirectUrl)
    ) {
      return {
        type: "result",
        result: { kind: "unsupported", reason: CREDLY_REDIRECT_REASON },
      };
    }
    return {
      type: "result",
      result: {
        kind: "unsupported",
        reason: "Redirect target failed the Credly URL allowlist.",
      },
    };
  }

  if (result.status === 408) {
    return { type: "result", result: { kind: "timeout" } };
  }
  if (result.status === 429) {
    return { type: "result", result: { kind: "rate_limited" } };
  }
  if (result.status === 401 || result.status === 403) {
    return { type: "result", result: { kind: "issuer_unavailable" } };
  }
  if (result.status >= 500 && result.status <= 599) {
    return { type: "result", result: { kind: "issuer_unavailable" } };
  }
  if (result.status === 410) {
    const evidence = assessCredlyEvidenceUrl(evidenceUrl, context.credentialId);
    if (evidence.ok && evidence.target.kind === "assertion") {
      return {
        type: "result",
        result: {
          kind: "rejected_evidence",
          evidence: {
            issuer: "credly",
            credentialId: context.credentialId,
            canonicalUrl: context.canonicalUrl,
            fetchedAt: context.fetchedAt,
            failure: "REVOKED",
          },
        },
      };
    }
  }
  if (result.status !== 200) {
    return {
      type: "result",
      result: {
        kind: "unsupported",
        reason: `Credly HTTP ${result.status} is not authoritative evidence about this credential.`,
      },
    };
  }

  if (!isSupportedIssuerContentType(result.contentType)) {
    return {
      type: "result",
      result: {
        kind: "unsupported",
        reason: CREDLY_EVIDENCE_UNSUPPORTED_REASON,
      },
    };
  }

  return { type: "json", bodyText: result.bodyText };
}

function parseJsonBody(
  bodyText: string,
):
  | { ok: true; value: unknown }
  | { ok: false; result: IssuerVerificationResult } {
  const inspected = interpretCredlyResponseBody(bodyText);
  if (inspected.kind === "malformed") {
    return { ok: false, result: inspected };
  }
  try {
    return { ok: true, value: JSON.parse(bodyText) as unknown };
  } catch {
    return {
      ok: false,
      result: {
        kind: "malformed",
        reason: "Credly response body is empty, too large, or not valid JSON.",
      },
    };
  }
}

function logOutcome(
  logger: CredlyVerificationLogger | undefined,
  credentialId: string,
  result: IssuerVerificationResult,
): IssuerVerificationResult {
  if (logger !== undefined && /^[0-9a-f-]{36}$/i.test(credentialId)) {
    logger({
      event: "credly_verification",
      outcome:
        result.kind === "rejected_evidence"
          ? result.evidence.failure
          : result.kind,
      credentialId: credentialId.toLowerCase(),
    });
  }
  return result;
}

export function createCredlyAdapter(
  options: CredlyAdapterOptions = {},
): IssuerVerificationAdapter {
  const permitOutbound = options.permitOutbound === true;
  const transport = options.transport;
  const logger =
    options.logger ??
    (options.log === true
      ? (event: CredlyVerificationLog) => {
          console.info(JSON.stringify(event));
        }
      : undefined);

  return {
    issuer: "credly",
    async verify(
      input: IssuerVerificationInput,
    ): Promise<IssuerVerificationResult> {
      const assessment = assessCredlyUrl(input.url);
      if (!assessment.ok) {
        return { kind: "unsupported", reason: assessment.reason };
      }

      if (!permitOutbound || transport === undefined) {
        return logOutcome(logger, assessment.target.credentialId, {
          kind: "unsupported",
          reason: CREDLY_NETWORK_DISABLED_REASON,
        });
      }

      if (transport.resolvesDns !== true) {
        const addresses = assessResolvedAddresses(input.resolvedAddresses);
        if (!addresses.ok) {
          return logOutcome(logger, assessment.target.credentialId, {
            kind: "unsupported",
            reason: addresses.reason,
          });
        }
      }

      const now = (options.now ?? (() => new Date()))();
      if (!isIso8601Timestamp(now.toISOString())) {
        return logOutcome(logger, assessment.target.credentialId, {
          kind: "malformed",
          reason: "Verification clock did not produce an ISO 8601 timestamp.",
        });
      }
      const context: CredlyEvidenceContext = {
        credentialId: assessment.target.credentialId,
        canonicalUrl: assessment.target.canonicalUrl,
        fetchedAt: now.toISOString(),
        now,
        ...(input.expectedRecipientEmail === undefined
          ? {}
          : { expectedRecipientEmail: input.expectedRecipientEmail }),
      };
      const assertionUrl = credlyAssertionUrl(assessment.target.credentialId);

      let assertionOutcome: CredlyTransportResult;
      try {
        assertionOutcome = await transport.exchange({
          method: "GET",
          issuer: assessment.target.issuer,
          credentialId: assessment.target.credentialId,
          canonicalUrl: assessment.target.canonicalUrl,
          evidenceUrl: assertionUrl,
          timeoutMs: CREDLY_REQUEST_TIMEOUT_MS,
          maxResponseBytes: CREDLY_MAX_RESPONSE_BYTES,
        });
      } catch {
        return logOutcome(logger, assessment.target.credentialId, {
          kind: "issuer_unavailable",
        });
      }

      const assertionHttp = interpretTransportResult(
        assertionOutcome,
        assertionUrl,
        context,
      );
      if (assertionHttp.type === "result") {
        return logOutcome(
          logger,
          assessment.target.credentialId,
          assertionHttp.result,
        );
      }

      const assertionJson = parseJsonBody(assertionHttp.bodyText);
      if (!assertionJson.ok) {
        return logOutcome(
          logger,
          assessment.target.credentialId,
          assertionJson.result,
        );
      }

      const assertion = readCredlyAssertion(assertionJson.value, context);
      if (assertion.type === "result") {
        return logOutcome(
          logger,
          assessment.target.credentialId,
          assertion.result,
        );
      }

      const badgeClassTarget = assessCredlyEvidenceUrl(assertion.badgeClassUrl);
      if (
        !badgeClassTarget.ok ||
        badgeClassTarget.target.kind !== "badge_class"
      ) {
        return logOutcome(logger, assessment.target.credentialId, {
          kind: "unsupported",
          reason: "Credly badge class URL is outside the issuer allowlist.",
        });
      }

      let classOutcome: CredlyTransportResult;
      try {
        classOutcome = await transport.exchange({
          method: "GET",
          issuer: assessment.target.issuer,
          credentialId: assessment.target.credentialId,
          canonicalUrl: assessment.target.canonicalUrl,
          evidenceUrl: assertion.badgeClassUrl,
          timeoutMs: CREDLY_REQUEST_TIMEOUT_MS,
          maxResponseBytes: CREDLY_MAX_RESPONSE_BYTES,
        });
      } catch {
        return logOutcome(logger, assessment.target.credentialId, {
          kind: "issuer_unavailable",
        });
      }

      const classHttp = interpretTransportResult(
        classOutcome,
        assertion.badgeClassUrl,
        context,
      );
      if (classHttp.type === "result") {
        return logOutcome(
          logger,
          assessment.target.credentialId,
          classHttp.result,
        );
      }
      const classJson = parseJsonBody(classHttp.bodyText);
      if (!classJson.ok) {
        return logOutcome(
          logger,
          assessment.target.credentialId,
          classJson.result,
        );
      }

      return logOutcome(
        logger,
        assessment.target.credentialId,
        completeCredlyEvidence(assertionJson.value, classJson.value, context),
      );
    },
  };
}
