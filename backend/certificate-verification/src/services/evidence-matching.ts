import type { Certificate } from "../db/certificate.js";
import type { IssuerConfirmedEvidence } from "../adapters/issuer-verification-adapter.js";
import { isIso8601Timestamp } from "../utils/iso-timestamp.js";
import { parseCertificateUrl } from "../validation/certificate-url.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

export type EvidenceMismatchField = "issuer" | "credentialId" | "canonicalUrl";

export type EvidenceMatch =
  | {
      outcome: "match";
      holderName: string;
      courseName: string;
      issuedDate: string;
      fetchedAt: string;
    }
  | { outcome: "mismatch"; fields: EvidenceMismatchField[] }
  | { outcome: "insufficient"; reason: string };

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

function requiredDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  return value;
}

function readConsistentEvidence(
  value: unknown,
): IssuerConfirmedEvidence | null {
  const record = asRecord(value);
  if (record === null || record.found !== true || record.issuer !== "credly") {
    return null;
  }

  if (
    typeof record.credentialId !== "string" ||
    typeof record.canonicalUrl !== "string" ||
    typeof record.fetchedAt !== "string" ||
    !UUID_PATTERN.test(record.credentialId) ||
    !isIso8601Timestamp(record.fetchedAt)
  ) {
    return null;
  }

  const parsed = parseCertificateUrl(record.canonicalUrl);
  if (!parsed.ok) {
    return null;
  }

  const credentialId = record.credentialId.toLowerCase();
  if (
    parsed.value.issuer !== "credly" ||
    parsed.value.credentialId !== credentialId ||
    parsed.value.canonicalUrl !==
      `https://www.credly.com/badges/${credentialId}`
  ) {
    return null;
  }

  return {
    issuer: "credly",
    credentialId,
    canonicalUrl: parsed.value.canonicalUrl,
    found: true,
    holderName: typeof record.holderName === "string" ? record.holderName : "",
    courseName: typeof record.courseName === "string" ? record.courseName : "",
    issuedDate: typeof record.issuedDate === "string" ? record.issuedDate : "",
    fetchedAt: record.fetchedAt,
  };
}

export function matchIssuerEvidence(
  certificate: Certificate,
  evidence: unknown,
): EvidenceMatch {
  const confirmed = readConsistentEvidence(evidence);
  if (confirmed === null) {
    return {
      outcome: "insufficient",
      reason: "Issuer evidence is incomplete or internally inconsistent.",
    };
  }

  if (
    certificate.issuer === null ||
    certificate.credentialId === null ||
    certificate.canonicalUrl === null
  ) {
    return {
      outcome: "insufficient",
      reason: "The certificate record has no issuer credential to compare.",
    };
  }

  const fields: EvidenceMismatchField[] = [];
  if (confirmed.issuer !== certificate.issuer) {
    fields.push("issuer");
  }
  if (confirmed.credentialId !== certificate.credentialId) {
    fields.push("credentialId");
  }
  if (confirmed.canonicalUrl !== certificate.canonicalUrl) {
    fields.push("canonicalUrl");
  }
  if (fields.length > 0) {
    return { outcome: "mismatch", fields };
  }

  const holderName = requiredText(confirmed.holderName, 200);
  const courseName = requiredText(confirmed.courseName, 300);
  const issuedDate = requiredDate(confirmed.issuedDate);
  if (holderName === null || courseName === null || issuedDate === null) {
    return {
      outcome: "insufficient",
      reason: "Issuer evidence is missing a holder, course, or issued date.",
    };
  }

  return {
    outcome: "match",
    holderName,
    courseName,
    issuedDate,
    fetchedAt: confirmed.fetchedAt,
  };
}
