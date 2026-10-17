import { createHash, timingSafeEqual } from "node:crypto";
import type { IssuerVerificationResult } from "./issuer-verification-adapter.js";
import { isIso8601Timestamp } from "../utils/iso-timestamp.js";
import {
  assessCredlyEvidenceUrl,
  evidenceUrlsMatch,
} from "../validation/credly-evidence-url.js";

const OPEN_BADGES_V2 = "https://w3id.org/openbadges/v2";
const SHA256_IDENTITY = /^sha256\$([0-9a-f]{64})$/i;

export interface CredlyEvidenceContext {
  credentialId: string;
  canonicalUrl: string;
  fetchedAt: string;
  now: Date;
  expectedRecipientEmail?: string;
}

export type RecipientAgreement = "unchecked" | "matched" | "mismatched";

export type CredlyAssertionRead =
  | { type: "result"; result: IssuerVerificationResult }
  | {
      type: "needs_badge_class";
      badgeClassUrl: string;
      recipientMatch: RecipientAgreement;
    };

interface RejectedEvidence {
  kind: "rejected_evidence";
  evidence: {
    issuer: "credly";
    credentialId: string;
    canonicalUrl: string;
    fetchedAt: string;
    failure: "RECIPIENT_MISMATCH" | "EXPIRED" | "REVOKED";
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    record[key] = entry;
  }
  return record;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function requiredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    hasControlCharacter(normalized)
  ) {
    return null;
  }
  return normalized;
}

function hasType(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    return value === expected;
  }
  return Array.isArray(value) && value.some((entry) => entry === expected);
}

function hasOpenBadgesContext(value: unknown): boolean {
  if (value === OPEN_BADGES_V2) {
    return true;
  }
  return Array.isArray(value) && value.includes(OPEN_BADGES_V2);
}

function unsupported(reason: string): CredlyAssertionRead {
  return { type: "result", result: { kind: "unsupported", reason } };
}

function malformed(reason: string): CredlyAssertionRead {
  return { type: "result", result: { kind: "malformed", reason } };
}

function identifiesRequestedBadge(
  context: CredlyEvidenceContext,
  credentialId: string,
): boolean {
  return credentialId === context.credentialId.toLowerCase();
}

function rejected(
  context: CredlyEvidenceContext,
  credentialId: string,
  failure: RejectedEvidence["evidence"]["failure"],
): CredlyAssertionRead {
  if (!identifiesRequestedBadge(context, credentialId)) {
    return unsupported(
      "Credly evidence identifies a different badge and was not accepted.",
    );
  }
  const result: RejectedEvidence = {
    kind: "rejected_evidence",
    evidence: {
      issuer: "credly",
      credentialId,
      canonicalUrl: context.canonicalUrl,
      fetchedAt: context.fetchedAt,
      failure,
    },
  };
  return { type: "result", result };
}

export function hashOpenBadgesEmail(email: string, salt?: string): string {
  const material = salt === undefined ? email : `${email}${salt}`;
  return createHash("sha256").update(Buffer.from(material, "utf8")).digest("hex");
}

function digestsEqual(actualHex: string, expectedHex: string): boolean {
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return (
    actual.length === 32 &&
    expected.length === 32 &&
    timingSafeEqual(actual, expected)
  );
}

function bytesEqual(left: string, right: string): boolean {
  const actual = Buffer.from(left, "utf8");
  const expected = Buffer.from(right, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function recipientAgrees(
  recipient: Record<string, unknown>,
  expectedEmail: string | undefined,
): RecipientAgreement | "malformed" {
  if (recipient.hashed === true) {
    if (typeof recipient.identity !== "string") {
      return "malformed";
    }
    const identity = SHA256_IDENTITY.exec(recipient.identity);
    if (identity === null) {
      return "malformed";
    }
    if (expectedEmail === undefined) {
      return "unchecked";
    }
    const salt = recipient.salt;
    if (salt !== undefined && (typeof salt !== "string" || salt.length > 256 || hasControlCharacter(salt))) {
      return "malformed";
    }
    const digest = hashOpenBadgesEmail(
      expectedEmail,
      typeof salt === "string" ? salt : undefined,
    );
    return digestsEqual(digest, identity[1] ?? "") ? "matched" : "mismatched";
  }

  if (recipient.hashed !== false || typeof recipient.identity !== "string") {
    return "malformed";
  }
  if (hasControlCharacter(recipient.identity) || recipient.identity.length > 254) {
    return "malformed";
  }
  if (expectedEmail === undefined) {
    return "unchecked";
  }
  return bytesEqual(recipient.identity, expectedEmail) ? "matched" : "mismatched";
}

function usableEmail(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const email = value.trim();
  if (
    email.length < 3 ||
    email.length > 254 ||
    hasControlCharacter(email) ||
    !/^[^@\s]+@[^@\s]+$/.test(email)
  ) {
    return undefined;
  }
  return email;
}

export function readCredlyAssertion(
  body: unknown,
  context: CredlyEvidenceContext,
): CredlyAssertionRead {
  const record = asRecord(body);
  if (
    record === null ||
    !hasOpenBadgesContext(record["@context"]) ||
    !hasType(record.type, "Assertion")
  ) {
    return unsupported(
      "The response is not an Open Badges 2.0 assertion hosted by Credly.",
    );
  }

  const verification = asRecord(record.verification);
  if (verification === null || verification.type !== "hosted") {
    return unsupported(
      "Credly did not provide hosted Open Badges verification for this badge.",
    );
  }

  if (typeof record.id !== "string") {
    return malformed("Credly assertion id is missing.");
  }
  const assertion = assessCredlyEvidenceUrl(record.id);
  if (!assertion.ok || assertion.target.kind !== "assertion") {
    return unsupported(
      "Credly assertion id is not a hosted Credly badge assertion.",
    );
  }
  const credentialId = assertion.target.credentialId;
  if (credentialId === null) {
    return malformed("Credly assertion id is missing.");
  }

  if (record.revoked === true || typeof record.revocationReason === "string") {
    return rejected(context, credentialId, "REVOKED");
  }
  if (record.revoked !== undefined && record.revoked !== false) {
    return malformed("Credly revocation flag is not authoritative.");
  }

  if (
    typeof record.issuedOn !== "string" ||
    !isIso8601Timestamp(record.issuedOn)
  ) {
    return malformed("Credly assertion issuedOn is not an ISO 8601 timestamp.");
  }

  if (record.expires !== undefined && record.expires !== null) {
    if (
      typeof record.expires !== "string" ||
      !isIso8601Timestamp(record.expires)
    ) {
      return malformed(
        "Credly assertion expires is not an ISO 8601 timestamp.",
      );
    }
    if (Date.parse(record.expires) <= context.now.getTime()) {
      return rejected(context, credentialId, "EXPIRED");
    }
  }

  const recipient = asRecord(record.recipient);
  if (recipient === null || !hasType(recipient.type, "email")) {
    return malformed("Credly assertion recipient is missing.");
  }
  const expectedEmail = usableEmail(context.expectedRecipientEmail);
  if (
    context.expectedRecipientEmail !== undefined &&
    expectedEmail === undefined
  ) {
    return unsupported(
      "The expected recipient could not be compared with Credly evidence.",
    );
  }
  const agreement = recipientAgrees(recipient, expectedEmail);
  if (agreement === "malformed") {
    return malformed("Credly recipient identity is not a usable email hash.");
  }
  const recipientMatch = agreement;

  if (typeof record.badge !== "string") {
    return unsupported(
      "Credly assertion did not link a hosted badge class URL.",
    );
  }
  const badgeClass = assessCredlyEvidenceUrl(record.badge);
  if (!badgeClass.ok || badgeClass.target.kind !== "badge_class") {
    return unsupported(
      "Credly badge class URL is outside the issuer allowlist.",
    );
  }

  return {
    type: "needs_badge_class",
    badgeClassUrl: record.badge,
    recipientMatch: identifiesRequestedBadge(context, credentialId)
      ? recipientMatch
      : "unchecked",
  };
}

function issuedDate(issuedOn: string): string | null {
  const parsed = Date.parse(issuedOn);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function readIssuer(
  value: unknown,
  organizationId: string,
): { name: string } | null {
  const issuer = asRecord(value);
  if (
    issuer === null ||
    !hasOpenBadgesContext(issuer["@context"]) ||
    (!hasType(issuer.type, "Profile") && !hasType(issuer.type, "Issuer")) ||
    typeof issuer.id !== "string"
  ) {
    return null;
  }
  const id = assessCredlyEvidenceUrl(issuer.id);
  if (
    !id.ok ||
    id.target.kind !== "issuer" ||
    id.target.organizationId !== organizationId
  ) {
    return null;
  }
  const name = requiredText(issuer.name, 300);
  if (name === null) {
    return null;
  }
  return { name };
}

export function completeCredlyEvidence(
  assertionBody: unknown,
  badgeClassBody: unknown,
  context: CredlyEvidenceContext,
): IssuerVerificationResult {
  const assertion = readCredlyAssertion(assertionBody, context);
  if (assertion.type === "result") {
    return assertion.result;
  }

  const badgeClass = asRecord(badgeClassBody);
  if (
    badgeClass === null ||
    !hasOpenBadgesContext(badgeClass["@context"]) ||
    !hasType(badgeClass.type, "BadgeClass") ||
    typeof badgeClass.id !== "string" ||
    !evidenceUrlsMatch(badgeClass.id, assertion.badgeClassUrl)
  ) {
    return {
      kind: "unsupported",
      reason: "Credly badge class did not match the assertion.",
    };
  }

  const classTarget = assessCredlyEvidenceUrl(badgeClass.id);
  if (!classTarget.ok || classTarget.target.organizationId === null) {
    return {
      kind: "unsupported",
      reason: "Credly badge class id is outside the issuer allowlist.",
    };
  }

  const issuer = readIssuer(
    badgeClass.issuer,
    classTarget.target.organizationId,
  );
  if (issuer === null) {
    return {
      kind: "unsupported",
      reason:
        "Credly badge class issuer is missing or does not match the badge class.",
    };
  }

  const assertionRecord = asRecord(assertionBody);
  const issuedOn =
    assertionRecord !== null && typeof assertionRecord.issuedOn === "string"
      ? assertionRecord.issuedOn
      : "";
  const date = issuedDate(issuedOn);
  const courseName = requiredText(badgeClass.name, 300);
  if (date === null || courseName === null) {
    return {
      kind: "malformed",
      reason: "Credly evidence is missing a course name or issued date.",
    };
  }

  const assertionId = assessCredlyEvidenceUrl(
    typeof assertionRecord?.id === "string" ? assertionRecord.id : "",
  );
  if (!assertionId.ok || assertionId.target.credentialId === null) {
    return {
      kind: "malformed",
      reason: "Credly assertion id is missing.",
    };
  }

  return {
    kind: "confirmed",
    evidence: {
      issuer: "credly",
      credentialId: assertionId.target.credentialId,
      canonicalUrl: `https://www.credly.com/badges/${assertionId.target.credentialId}`,
      found: true,
      holderName: "",
      courseName,
      issuedDate: date,
      fetchedAt: context.fetchedAt,
      recipientDisclosed: false,
      issuerName: issuer.name,
      recipientMatch: assertion.recipientMatch,
    },
  };
}
