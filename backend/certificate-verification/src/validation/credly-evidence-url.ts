export const CREDLY_EVIDENCE_HOSTNAME = "api.credly.com";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CredlyEvidenceKind = "assertion" | "badge_class" | "issuer";

export interface CredlyEvidenceTarget {
  kind: CredlyEvidenceKind;
  hostname: typeof CREDLY_EVIDENCE_HOSTNAME;
  path: string;
  credentialId: string | null;
  organizationId: string | null;
  badgeClassId: string | null;
}

export type CredlyEvidenceAssessment =
  { ok: true; target: CredlyEvidenceTarget } | { ok: false; reason: string };

function failure(reason: string): CredlyEvidenceAssessment {
  return { ok: false, reason };
}

function uuid(value: string): string | null {
  if (!UUID_PATTERN.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

export function assessCredlyEvidenceUrl(
  input: string,
  requestedCredentialId?: string,
): CredlyEvidenceAssessment {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return failure("Credly evidence URL is not a valid URL.");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hostname !== CREDLY_EVIDENCE_HOSTNAME ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname.includes("\\") ||
    parsed.pathname.includes("%") ||
    parsed.pathname.split("/").includes("..")
  ) {
    return failure("Credly evidence URL is outside the issuer allowlist.");
  }

  const assertion = /^\/(?:api\/)?v1\/obi\/v2\/badge_assertions\/([^/]+)$/.exec(
    parsed.pathname,
  );
  if (assertion !== null) {
    const credentialId = uuid(assertion[1] ?? "");
    if (credentialId === null) {
      return failure("Credly evidence URL is outside the issuer allowlist.");
    }
    if (
      requestedCredentialId !== undefined &&
      credentialId !== requestedCredentialId.toLowerCase()
    ) {
      return failure("Credly evidence URL does not match the requested badge.");
    }
    return {
      ok: true,
      target: {
        kind: "assertion",
        hostname: CREDLY_EVIDENCE_HOSTNAME,
        path: parsed.pathname,
        credentialId,
        organizationId: null,
        badgeClassId: null,
      },
    };
  }

  const badgeClass =
    /^\/(?:api\/)?v1\/obi\/v2\/issuers\/([^/]+)\/badge_classes\/([^/]+)$/.exec(
      parsed.pathname,
    );
  if (badgeClass !== null) {
    const organizationId = uuid(badgeClass[1] ?? "");
    const badgeClassId = uuid(badgeClass[2] ?? "");
    if (organizationId === null || badgeClassId === null) {
      return failure("Credly evidence URL is outside the issuer allowlist.");
    }
    return {
      ok: true,
      target: {
        kind: "badge_class",
        hostname: CREDLY_EVIDENCE_HOSTNAME,
        path: parsed.pathname,
        credentialId: null,
        organizationId,
        badgeClassId,
      },
    };
  }

  const issuer = /^\/(?:api\/)?v1\/obi\/v2\/issuers\/([^/]+)$/.exec(
    parsed.pathname,
  );
  if (issuer !== null) {
    const organizationId = uuid(issuer[1] ?? "");
    if (organizationId === null) {
      return failure("Credly evidence URL is outside the issuer allowlist.");
    }
    return {
      ok: true,
      target: {
        kind: "issuer",
        hostname: CREDLY_EVIDENCE_HOSTNAME,
        path: parsed.pathname,
        credentialId: null,
        organizationId,
        badgeClassId: null,
      },
    };
  }

  return failure("Credly evidence URL is outside the issuer allowlist.");
}

export function credlyAssertionUrl(credentialId: string): string {
  return `https://${CREDLY_EVIDENCE_HOSTNAME}/v1/obi/v2/badge_assertions/${credentialId.toLowerCase()}`;
}

export function evidenceUrlsMatch(left: string, right: string): boolean {
  const first = assessCredlyEvidenceUrl(left);
  const second = assessCredlyEvidenceUrl(right);
  return (
    first.ok &&
    second.ok &&
    first.target.kind === second.target.kind &&
    first.target.path.replace(/^\/api(?=\/v1\/)/, "") ===
      second.target.path.replace(/^\/api(?=\/v1\/)/, "") &&
    first.target.credentialId === second.target.credentialId &&
    first.target.organizationId === second.target.organizationId &&
    first.target.badgeClassId === second.target.badgeClassId
  );
}
