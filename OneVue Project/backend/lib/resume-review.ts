import { createHash, randomUUID } from "node:crypto";
import type { LlmExtractionResult } from "./llm-client";

/**
 * Process-local review store. Reviews disappear when this Node process
 * restarts. They are not written to MongoDB and they do not include the PDF.
 * Every review has an expiry. A restart drops reviews that have not expired yet.
 */
export const REVIEW_TTL_MS = 15 * 60 * 1000;

export const REVIEW_LOST_MESSAGE =
  "This review expired or is no longer available. Choose the PDF again to start a new extraction. Reviews are kept in memory and disappear when the server restarts.";

export interface ReviewRow {
  id: string;
  section:
    | "profile"
    | "education"
    | "experience"
    | "skills"
    | "projects"
    | "credentials"
    | "achievements"
    | "socialLinks";
  entryIndex: number;
  field: string;
  value: string;
  profileField: string | null;
  evidence: string | null;
  confidence: "high" | "medium" | "low" | null;
  groundingStatus: string | null;
  applicable: boolean;
  note: string | null;
}

export interface ProfileRevision {
  updatedAt: string | null;
  sections: Record<string, string>;
}

export interface ReviewSection {
  id: ReviewRow["section"];
  label: string;
  rows: ReviewRow[];
}

export interface StoredResumeReview {
  reviewId: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  status: "ok" | "partial";
  schemaVersion: string;
  persistence: "memory";
  warnings: Array<{ path: string; code: string; message: string }>;
  rows: ReviewRow[];
  sections: ReviewSection[];
  profileRevision: ProfileRevision;
  applying?: boolean;
}

const reviews = new Map<string, StoredResumeReview>();

const SECTION_LABELS: Record<ReviewRow["section"], string> = {
  profile: "Personal information",
  education: "Education",
  experience: "Experience",
  skills: "Skills",
  projects: "Projects",
  credentials: "Certifications",
  achievements: "Achievements",
  socialLinks: "Social links",
};

const SECTION_ORDER: ReviewRow["section"][] = [
  "profile",
  "education",
  "experience",
  "skills",
  "projects",
  "credentials",
  "achievements",
  "socialLinks",
];

export function createResumeReview(
  userId: string,
  extraction: LlmExtractionResult,
  now = Date.now(),
  ttlMs = REVIEW_TTL_MS,
  profileRevision: ProfileRevision = emptyProfileRevision(),
): StoredResumeReview {
  purgeExpiredReviews(now);
  const boundedTtl = Number.isFinite(ttlMs) && ttlMs >= 1
    ? Math.min(Math.floor(ttlMs), REVIEW_TTL_MS)
    : REVIEW_TTL_MS;
  const review: StoredResumeReview = {
    reviewId: randomUUID(),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + boundedTtl).toISOString(),
    status: extraction.status,
    schemaVersion: extraction.schemaVersion,
    persistence: "memory",
    warnings: extraction.warnings,
    rows: mapExtractionToRows(extraction),
    sections: [],
    profileRevision,
  };
  review.sections = groupRows(review.rows);
  reviews.set(review.reviewId, review);
  return review;
}

export function readResumeReview(
  userId: string,
  reviewId: string,
  now = Date.now(),
): StoredResumeReview | null {
  purgeExpiredReviews(now);
  const review = reviews.get(reviewId);
  if (review !== undefined && !reviewIsCurrent(review, now)) {
    reviews.delete(reviewId);
    return null;
  }
  if (review === undefined || review.userId !== userId) {
    return null;
  }
  return review;
}

export function discardResumeReview(
  userId: string,
  reviewId: string,
  now = Date.now(),
): "discarded" | "missing" | "busy" {
  const review = reviews.get(reviewId);
  if (review === undefined || review.userId !== userId) {
    return "missing";
  }
  if (!reviewIsCurrent(review, now)) {
    reviews.delete(reviewId);
    return "missing";
  }
  if (review.applying === true) {
    return "busy";
  }
  reviews.delete(reviewId);
  return "discarded";
}

export function claimResumeReview(
  userId: string,
  reviewId: string,
  now = Date.now(),
): StoredResumeReview | "missing" | "busy" {
  const review = reviews.get(reviewId);
  if (review !== undefined && !reviewIsCurrent(review, now)) {
    reviews.delete(reviewId);
    return "missing";
  }
  if (review === undefined || review.userId !== userId) {
    return "missing";
  }
  if (review.applying === true) {
    return "busy";
  }
  review.applying = true;
  return review;
}

export function releaseResumeReview(reviewId: string): void {
  const review = reviews.get(reviewId);
  if (review !== undefined) {
    review.applying = false;
  }
}

export function consumeResumeReview(userId: string, reviewId: string): void {
  const review = reviews.get(reviewId);
  if (review !== undefined && review.userId === userId) {
    reviews.delete(reviewId);
  }
}

export function purgeExpiredReviews(now = Date.now()): number {
  let removed = 0;
  for (const [id, review] of reviews) {
    if (!reviewIsCurrent(review, now)) {
      reviews.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function clearResumeReviewsForTests(): void {
  reviews.clear();
}

export function publicReview(review: StoredResumeReview) {
  return {
    reviewId: review.reviewId,
    status: review.status,
    schemaVersion: review.schemaVersion,
    persistence: review.persistence,
    createdAt: review.createdAt,
    expiresAt: review.expiresAt,
    applyAvailable: true,
    warning:
      "Extracted information is unverified and needs your review. It has not been saved to your profile. This review is kept in memory and disappears if the server restarts.",
    warnings: review.warnings,
    rows: review.rows,
    sections: review.sections,
  };
}

export function mapExtractionToRows(extraction: LlmExtractionResult): ReviewRow[] {
  const data = extraction.data;
  const rows: ReviewRow[] = [];
  const profile = asRecord(data.profile);
  pushText(rows, extraction, "profile", "name", profile.name, null, false, "The account name is not changed from a resume.");
  pushText(rows, extraction, "profile", "headline", profile.headline, "headline", true, null);
  pushText(rows, extraction, "profile", "email", profile.email, "contacts.email", true, null);
  pushText(rows, extraction, "profile", "phone", profile.phone, "contacts.phone", true, null);
  pushText(rows, extraction, "profile", "location", profile.location, null, false, "Location is not a single profile field.");
  pushText(rows, extraction, "profile", "summary", profile.summary, "bio", true, null);

  asList(data.education).forEach((item, index) => {
    const prefix = `education[${index}]`;
    pushText(rows, extraction, "education", "institution", item.institution, "education.institution", true, null, prefix);
    pushText(rows, extraction, "education", "degree", item.degree, "education.degree", true, null, prefix);
    pushText(rows, extraction, "education", "fieldOfStudy", item.fieldOfStudy, "education.fieldOfStudy", true, null, prefix);
    pushText(rows, extraction, "education", "startDate", item.startDate, "education.startDate", true, null, prefix);
    pushText(rows, extraction, "education", "endDate", item.endDate, "education.endDate", true, null, prefix);
    const grade = typeof item.grade === "string" ? gradeDestination(item.grade) : null;
    pushText(
      rows,
      extraction,
      "education",
      "grade",
      item.grade,
      grade === null ? null : `education.${grade.field}`,
      grade !== null,
      grade === null ? "A grade is not saved until it is clearly a CGPA or a percentage." : null,
      prefix,
    );
  });

  asList(data.experience).forEach((item, index) => {
    const prefix = `experience[${index}]`;
    const note = "Work experience and internships are not saved on the student profile yet.";
    pushText(rows, extraction, "experience", "company", item.company, null, false, note, prefix);
    pushText(rows, extraction, "experience", "title", item.title, null, false, note, prefix);
    pushText(rows, extraction, "experience", "location", item.location, null, false, note, prefix);
    pushText(rows, extraction, "experience", "startDate", item.startDate, null, false, note, prefix);
    pushText(rows, extraction, "experience", "endDate", item.endDate, null, false, note, prefix);
    if (item.isCurrent === true) {
      pushText(rows, extraction, "experience", "isCurrent", "true", null, false, note, prefix);
    }
    const bullets = stringList(item.bullets);
    if (bullets.length > 0) {
      pushText(rows, extraction, "experience", "responsibilities", bullets.join("\n"), null, false, note, prefix);
    }
  });

  asList(data.skills).forEach((item, index) => {
    pushText(
      rows,
      extraction,
      "skills",
      "name",
      item.name,
      "skills.name",
      false,
      "A category and proficiency are required before a skill can be saved.",
      `skills[${index}]`,
    );
  });

  asList(data.projects).forEach((item, index) => {
    const prefix = `projects[${index}]`;
    pushText(rows, extraction, "projects", "name", item.name, "projects.title", true, null, prefix);
    pushText(rows, extraction, "projects", "description", item.description, "projects.shortDescription", true, null, prefix);
    const technologies = stringList(item.technologies);
    if (technologies.length > 0) {
      pushText(rows, extraction, "projects", "technologies", technologies.join(", "), "projects.technologies", true, null, prefix);
    }
    const links = stringList(item.links);
    if (links.length === 1) {
      const destination = projectLinkField(links[0]);
      pushText(
        rows,
        extraction,
        "projects",
        "links",
        links[0],
        destination,
        destination !== null,
        destination === null ? "This project link is not a usable http or https URL." : null,
        prefix,
      );
    } else if (links.length > 1) {
      pushText(rows, extraction, "projects", "links", links.join("\n"), null, false, "Project links are not assigned to a specific URL field.", prefix);
    }
  });

  asList(data.achievements).forEach((item, index) => {
    const prefix = `achievements[${index}]`;
    const title = typeof item.title === "string" ? item.title : "";
    const credential = /certif|certificate|license|licence|badge|credential/i.test(title);
    const section = credential ? "credentials" : "achievements";
    const note = credential
      ? "This is a resume claim, not a verified credential."
      : null;
    pushText(
      rows,
      extraction,
      section,
      "title",
      item.title,
      credential ? "credentials.title" : "achievements.title",
      true,
      note,
      prefix,
    );
    pushText(
      rows,
      extraction,
      section,
      "description",
      item.description,
      credential ? "credentials.description" : "achievements.description",
      true,
      note,
      prefix,
    );
  });

  asList(data.socialLinks).forEach((item, index) => {
    const prefix = `socialLinks[${index}]`;
    const url = typeof item.url === "string" ? item.url : "";
    const usable = isHttpUrl(url);
    pushText(rows, extraction, "socialLinks", "platform", item.platform, "links.platform", usable, usable ? null : "A social link needs an http or https URL.", prefix);
    pushText(rows, extraction, "socialLinks", "url", item.url, "links.url", usable, usable ? null : "A social link needs an http or https URL.", prefix);
  });

  assignEntryIndexes(rows);
  return rows;
}

export function profileRevisionFrom(profile: unknown): ProfileRevision {
  const record = asRecord(profile);
  const updated = record.updatedAt;
  return {
    updatedAt: updated instanceof Date
      ? updated.toISOString()
      : typeof updated === "string"
        ? updated
        : null,
    sections: Object.fromEntries(
      REVISION_SECTIONS.map((section) => [section, hashSection(section, record)]),
    ),
  };
}

export function emptyProfileRevision(): ProfileRevision {
  return profileRevisionFrom(null);
}

export function sameProfileSection(left: ProfileRevision, right: ProfileRevision, section: string): boolean {
  return left.sections[section] === right.sections[section];
}

function pushText(
  rows: ReviewRow[],
  extraction: LlmExtractionResult,
  section: ReviewRow["section"],
  field: string,
  value: unknown,
  profileField: string | null,
  applicable: boolean,
  note: string | null,
  prefix: string = section,
): void {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return;
  }
  const path = prefix ? `${prefix}.${field === "responsibilities" ? "bullets" : field}` : `${section}.${field}`;
  const meta = asRecord(extraction.fieldMeta[path]);
  const provenance = trustedProvenance(meta);
  rows.push({
    id: `${section}:${path}`,
    section,
    entryIndex: 0,
    field,
    value: trimmed.slice(0, 4000),
    profileField,
    evidence: provenance.evidence,
    confidence: provenance.confidence,
    groundingStatus: provenance.groundingStatus,
    applicable,
    note,
  });
}

/**
 * Model-supplied confidence and evidence are shown only after the
 * extractor's grounding check. Unsupported or unchecked values stay low
 * confidence and do not carry quoted evidence.
 */
function trustedProvenance(meta: Record<string, unknown>): {
  evidence: string | null;
  confidence: ReviewRow["confidence"];
  groundingStatus: string | null;
} {
  const groundingStatus = typeof meta.grounding_status === "string" ? meta.grounding_status : null;
  const grounded = meta.grounded === true;
  const trusted = grounded && (groundingStatus === "grounded" || groundingStatus === "partially_grounded");
  if (!trusted) {
    return {
      evidence: null,
      confidence: groundingStatus === null && meta.grounded !== false ? null : "low",
      groundingStatus,
    };
  }
  let confidence = confidenceOf(meta.confidence);
  if (groundingStatus === "partially_grounded" && confidence === "high") {
    confidence = "medium";
  }
  const evidenceList = Array.isArray(meta.evidence) ? meta.evidence : [];
  const firstEvidence = asRecord(evidenceList[0]);
  const evidence = typeof firstEvidence.extracted_value === "string" ? firstEvidence.extracted_value : null;
  return { evidence, confidence, groundingStatus };
}

function assignEntryIndexes(rows: ReviewRow[]): void {
  const nextIndex = new Map<string, number>();
  const assigned = new Map<string, number>();
  for (const row of rows) {
    const entryKey = row.id.slice(row.id.indexOf(":") + 1).replace(/\.[^.]+$/, "");
    const key = `${row.section}|${entryKey}`;
    if (!assigned.has(key)) {
      const index = nextIndex.get(row.section) ?? 0;
      assigned.set(key, index);
      nextIndex.set(row.section, index + 1);
    }
    row.entryIndex = assigned.get(key) ?? 0;
  }
}

function gradeDestination(value: string): { field: "gpa" | "percentage" } | null {
  const text = value.trim();
  if (/^\d{1,3}(?:\.\d+)?\s*%$/.test(text)) {
    const number = Number(text.replace("%", "").trim());
    if (number >= 0 && number <= 100) return { field: "percentage" };
  }
  if (/^(?:cgpa|gpa)\s*:?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/i.test(text)) {
    return { field: "gpa" };
  }
  if (/^\d(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?$/.test(text)) {
    const number = Number(text.split("/")[0]);
    if (number <= 10) return { field: "gpa" };
  }
  return null;
}

function projectLinkField(value: string): string | null {
  if (!isHttpUrl(value)) return null;
  const host = new URL(value).hostname.toLowerCase();
  if (host === "github.com" || host.endsWith(".github.com") || host === "gitlab.com" || host === "bitbucket.org") {
    return "projects.repoUrl";
  }
  return "projects.liveUrl";
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const REVISION_SECTIONS = [
  "profile",
  "education",
  "projects",
  "skills",
  "credentials",
  "achievements",
  "socialLinks",
] as const;

function hashSection(section: string, profile: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(sectionSnapshot(section, profile))).digest("hex");
}

function sectionSnapshot(section: string, profile: Record<string, unknown>): unknown {
  const contacts = asRecord(profile.contacts);
  if (section === "profile") {
    return {
      headline: text(profile.headline),
      bio: text(profile.bio),
      email: text(contacts.email),
      phone: text(contacts.phone),
    };
  }
  if (section === "education") {
    return asList(profile.education).map((item) => ({
      institution: text(item.institution),
      degree: text(item.degree),
      fieldOfStudy: text(item.fieldOfStudy),
      startDate: text(item.startDate),
      endDate: text(item.endDate),
      gpa: text(item.gpa),
      percentage: text(item.percentage),
    }));
  }
  if (section === "projects") {
    return asList(profile.projects).map((item) => ({
      title: text(item.title),
      shortDescription: text(item.shortDescription),
      technologies: stringList(item.technologies),
      repoUrl: text(item.repoUrl),
      liveUrl: text(item.liveUrl),
    }));
  }
  if (section === "skills") {
    return asList(profile.skills).map((item) => ({
      name: text(item.name),
      category: text(item.category),
      proficiency: text(item.proficiency),
    }));
  }
  if (section === "credentials") {
    return asList(profile.credentials).map((item) => ({
      title: text(item.title),
      issuer: text(item.issuer),
      description: text(item.description),
      verificationStatus: text(item.verificationStatus),
      certificateVerificationId: text(item.certificateVerificationId),
    }));
  }
  if (section === "achievements") {
    return asList(profile.achievements).map((item) => ({
      title: text(item.title),
      description: text(item.description),
      verificationStatus: text(item.verificationStatus),
    }));
  }
  return asList(profile.links).map((item) => ({
    platform: text(item.platform),
    url: text(item.url),
  }));
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function reviewIsCurrent(review: StoredResumeReview, now: number): boolean {
  const expires = Date.parse(review.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

function groupRows(rows: ReviewRow[]): ReviewSection[] {
  return SECTION_ORDER.flatMap((id) => {
    const sectionRows = rows.filter((row) => row.section === id);
    if (sectionRows.length === 0) {
      return [];
    }
    return [{ id, label: SECTION_LABELS[id], rows: sectionRows }];
  });
}

function confidenceOf(value: unknown): ReviewRow["confidence"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
