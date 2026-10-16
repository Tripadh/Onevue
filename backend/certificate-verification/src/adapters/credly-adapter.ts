import type {
  IssuerVerificationAdapter,
  IssuerVerificationInput,
  IssuerVerificationResult,
} from "./issuer-verification-adapter.js";
import {
  assessCredlyUrl,
  assessResolvedAddresses,
  redirectStaysOnCredential,
} from "../utils/issuer-request-guard.js";

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

const JSON_MEDIA_TYPE = "application/json";

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
  return mediaType === JSON_MEDIA_TYPE;
}

export interface CredlyAdapterOptions {
  transport?: CredlyTransport;
  permitOutbound?: boolean;
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

function interpretTransportResult(
  result: CredlyTransportResult,
  canonicalUrl: string,
): IssuerVerificationResult {
  if (result.type === "timeout") {
    return { kind: "timeout" };
  }
  if (result.type === "rate_limited") {
    return { kind: "rate_limited" };
  }
  if (result.type === "unavailable") {
    return { kind: "issuer_unavailable" };
  }
  if (result.type === "blocked" || result.type === "unsupported_content") {
    return {
      kind: "unsupported",
      reason: CREDLY_EVIDENCE_UNSUPPORTED_REASON,
    };
  }
  if (result.type === "too_large") {
    return {
      kind: "malformed",
      reason: "Credly response body is empty, too large, or not valid JSON.",
    };
  }

  if (
    result.redirectUrl !== undefined ||
    (result.status >= 300 && result.status < 400)
  ) {
    if (
      result.redirectUrl !== undefined &&
      !redirectStaysOnCredential(canonicalUrl, result.redirectUrl)
    ) {
      return {
        kind: "unsupported",
        reason: "Redirect target failed the Credly URL allowlist.",
      };
    }
    return { kind: "unsupported", reason: CREDLY_REDIRECT_REASON };
  }

  if (result.status === 408) {
    return { kind: "timeout" };
  }
  if (result.status === 429) {
    return { kind: "rate_limited" };
  }
  if (result.status >= 500 && result.status <= 599) {
    return { kind: "issuer_unavailable" };
  }
  if (result.status !== 200) {
    return {
      kind: "unsupported",
      reason: `Credly HTTP ${result.status} is not authoritative evidence about this credential.`,
    };
  }

  if (!isSupportedIssuerContentType(result.contentType)) {
    return {
      kind: "unsupported",
      reason: CREDLY_EVIDENCE_UNSUPPORTED_REASON,
    };
  }

  return interpretCredlyResponseBody(result.bodyText);
}

export function createCredlyAdapter(
  options: CredlyAdapterOptions = {},
): IssuerVerificationAdapter {
  const permitOutbound = options.permitOutbound === true;
  const transport = options.transport;

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
        return { kind: "unsupported", reason: CREDLY_NETWORK_DISABLED_REASON };
      }

      if (transport.resolvesDns !== true) {
        const addresses = assessResolvedAddresses(input.resolvedAddresses);
        if (!addresses.ok) {
          return { kind: "unsupported", reason: addresses.reason };
        }
      }

      const outcome = await transport.exchange({
        method: "GET",
        issuer: assessment.target.issuer,
        credentialId: assessment.target.credentialId,
        canonicalUrl: assessment.target.canonicalUrl,
        timeoutMs: CREDLY_REQUEST_TIMEOUT_MS,
        maxResponseBytes: CREDLY_MAX_RESPONSE_BYTES,
      });
      return interpretTransportResult(outcome, assessment.target.canonicalUrl);
    },
  };
}
