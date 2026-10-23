import { credlyIssuer, type IssuerId } from "./issuers.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENCODED_SEPARATOR = /%(?:2f|5c)/i;
const WELL_FORMED_ENCODING = /^(?:[^%]|%[0-9a-fA-F]{2})*$/;

export const UNTRUSTED_CERTIFICATE_URL_MESSAGE =
  "url is not a trusted issuer certificate link.";

export interface ParsedCertificateUrl {
  issuer: IssuerId;
  credentialId: string;
  canonicalUrl: string;
}

export interface CertificateUrlFailure {
  path: "url";
  message: typeof UNTRUSTED_CERTIFICATE_URL_MESSAGE;
}

export type CertificateUrlResult =
  | { ok: true; value: ParsedCertificateUrl }
  | { ok: false; error: CertificateUrlFailure };

interface SubmittedParts {
  authority: string;
  path: string;
}

function failure(): CertificateUrlResult {
  return {
    ok: false,
    error: { path: "url", message: UNTRUSTED_CERTIFICATE_URL_MESSAGE },
  };
}

function submittedParts(input: string): SubmittedParts | null {
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(input);
  if (scheme === null || scheme[1].toLowerCase() !== "https") {
    return null;
  }

  const rest = scheme[2];
  if (!rest.startsWith("//")) {
    return null;
  }

  let hierarchical = rest.slice(2);
  const fragmentAt = hierarchical.indexOf("#");
  if (fragmentAt !== -1) {
    hierarchical = hierarchical.slice(0, fragmentAt);
  }
  const queryAt = hierarchical.indexOf("?");
  if (queryAt !== -1) {
    hierarchical = hierarchical.slice(0, queryAt);
  }

  const slashAt = hierarchical.indexOf("/");
  if (slashAt <= 0) {
    return null;
  }

  return {
    authority: hierarchical.slice(0, slashAt),
    path: hierarchical.slice(slashAt),
  };
}

function authorityHostname(authority: string): string | null {
  if (
    authority.length === 0 ||
    authority.includes("@") ||
    authority.includes(":") ||
    authority.includes("%") ||
    authority.includes("\\") ||
    authority.includes("/") ||
    authority.endsWith(".")
  ) {
    return null;
  }

  const hostname = authority.toLowerCase();
  if (hostname !== credlyIssuer.hostname) {
    return null;
  }

  return hostname;
}

function decodePathSegment(segment: string): string | null {
  if (
    segment.length === 0 ||
    segment.includes("/") ||
    segment.includes("\\") ||
    ENCODED_SEPARATOR.test(segment) ||
    !WELL_FORMED_ENCODING.test(segment)
  ) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }

  if (
    decoded.includes("/") ||
    decoded.includes("\\") ||
    decoded.includes("\u0000") ||
    ENCODED_SEPARATOR.test(decoded)
  ) {
    return null;
  }

  return decoded;
}

export function parseCertificateUrl(input: string): CertificateUrlResult {
  const parts = submittedParts(input);
  if (parts === null) {
    return failure();
  }

  const hostname = authorityHostname(parts.authority);
  if (hostname === null || parts.path.includes("\\")) {
    return failure();
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return failure();
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hostname !== hostname ||
    parsed.pathname !== parts.path
  ) {
    return failure();
  }

  const segments = parts.path.split("/");
  if (segments.length !== 3 || segments[0] !== "") {
    return failure();
  }

  const badgeSegment = decodePathSegment(segments[1]);
  const credentialSegment = decodePathSegment(segments[2]);
  if (
    badgeSegment !== credlyIssuer.badgeSegment ||
    credentialSegment === null ||
    !UUID_PATTERN.test(credentialSegment)
  ) {
    return failure();
  }

  const credentialId = credentialSegment.toLowerCase();
  return {
    ok: true,
    value: {
      issuer: credlyIssuer.id,
      credentialId,
      canonicalUrl: `https://${hostname}/${credlyIssuer.badgeSegment}/${credentialId}`,
    },
  };
}
