import { verifyAuth } from "./auth";
import StudentProfile, { SKILL_CATEGORIES, SKILL_PROFICIENCIES } from "../models/StudentProfile";
import {
  claimResumeReview,
  consumeResumeReview,
  profileRevisionFrom,
  readResumeReview,
  releaseResumeReview,
  REVIEW_LOST_MESSAGE,
  sameProfileSection,
  type ReviewRow,
  type StoredResumeReview,
} from "./resume-review";

const SECTIONS = [
  "profile",
  "education",
  "skills",
  "projects",
  "credentials",
  "achievements",
  "socialLinks",
] as const;

const SUPPLEMENT_KEYS = ["category", "proficiency", "issuer"] as const;

interface Selection {
  section: (typeof SECTIONS)[number];
  index: number;
  fields: string[];
  category?: string;
  proficiency?: string;
  issuer?: string;
}

export class ResumeApplyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ResumeApplyError";
    this.status = status;
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function applyStudentResume(req: Request, now = Date.now()): Promise<Response> {
  const auth = await verifyAuth(req);
  if ("error" in auth) {
    return json({ message: auth.error }, auth.status);
  }
  if (String(auth.user.identity ?? "").trim().toLowerCase() !== "student") {
    return json({ message: "Resume extraction is available to student accounts." }, 403);
  }
  const userId = String(auth.user._id);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ message: "Request validation failed." }, 400);
  }

  let selections: Selection[];
  let reviewId: string;
  try {
    ({ reviewId, selections } = parseApplyRequest(body));
  } catch (error) {
    if (error instanceof ResumeApplyError) {
      return json({ message: error.message }, error.status);
    }
    throw error;
  }

  const review = readResumeReview(userId, reviewId, now);
  if (review === null) {
    return json({ message: REVIEW_LOST_MESSAGE }, 404);
  }

  let plan: ReturnType<typeof planApply>;
  try {
    plan = planApply(review, selections);
  } catch (error) {
    if (error instanceof ResumeApplyError) {
      return json({ message: error.message }, error.status);
    }
    throw error;
  }

  const claimed = claimResumeReview(userId, reviewId, now);
  if (claimed === "missing") {
    return json({ message: REVIEW_LOST_MESSAGE }, 404);
  }
  if (claimed === "busy") {
    return json({ message: "This review is already being applied." }, 409);
  }

  try {
    const profile = await StudentProfile.findOne({ userId });
    if (profile === null) {
      throw new ResumeApplyError(404, "Student profile was not found.");
    }
    const currentRevision = profileRevisionFrom(profile.toObject());
    const stale = plan.sections.some(
      (section) => !sameProfileSection(review.profileRevision, currentRevision, section),
    );
    if (stale) {
      throw new ResumeApplyError(
        409,
        "The profile changed after this review. Reconcile the profile before applying these fields.",
      );
    }

    const merged = mergeProfile(profile.toObject(), plan.groups);
    if (Object.keys(merged.patch).length === 0) {
      consumeResumeReview(userId, reviewId);
      return json({
        applied: true,
        reviewId,
        skipped: merged.skipped,
        profile: profile.toObject(),
      }, 200);
    }
    const updated = await StudentProfile.findOneAndUpdate(
      { _id: profile._id, updatedAt: profile.updatedAt },
      { $set: merged.patch },
      { returnDocument: "after", runValidators: true, timestamps: true },
    );
    if (updated === null) {
      throw new ResumeApplyError(
        409,
        "The profile changed after this review. Reconcile the profile before applying these fields.",
      );
    }
    consumeResumeReview(userId, reviewId);
    return json({
      applied: true,
      reviewId,
      skipped: merged.skipped,
      profile: updated.toObject(),
    }, 200);
  } catch (error) {
    releaseResumeReview(reviewId);
    if (error instanceof ResumeApplyError) {
      return json({ message: error.message }, error.status);
    }
    const name = error instanceof Error ? error.name : "";
    if (name === "ValidationError") {
      return json({ message: "The selected resume fields do not fit the profile." }, 400);
    }
    return json({ message: "The resume review could not be applied." }, 500);
  }
}

function parseApplyRequest(body: unknown): { reviewId: string; selections: Selection[] } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ResumeApplyError(400, "Request validation failed.");
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "reviewId" && key !== "selections")) {
    throw new ResumeApplyError(400, "The request contains fields that cannot be applied.");
  }
  if (typeof record.reviewId !== "string" || record.reviewId.trim().length === 0) {
    throw new ResumeApplyError(400, "A review id is required.");
  }
  if (!Array.isArray(record.selections) || record.selections.length === 0) {
    throw new ResumeApplyError(400, "Select at least one extracted field.");
  }
  return {
    reviewId: record.reviewId,
    selections: record.selections.map(parseSelection),
  };
}

function parseSelection(value: unknown): Selection {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ResumeApplyError(400, "A selection is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => key !== "section" && key !== "index" && key !== "fields" && !SUPPLEMENT_KEYS.includes(key as (typeof SUPPLEMENT_KEYS)[number]))) {
    throw new ResumeApplyError(400, "A selection contains a value that cannot override the stored review.");
  }
  if (!SECTIONS.includes(record.section as (typeof SECTIONS)[number])) {
    throw new ResumeApplyError(400, "The selection does not match a supported profile section.");
  }
  if (typeof record.index !== "number" || !Number.isInteger(record.index) || record.index < 0) {
    throw new ResumeApplyError(400, "The selection index is invalid.");
  }
  if (!Array.isArray(record.fields) || record.fields.length === 0 || record.fields.some((field) => typeof field !== "string")) {
    throw new ResumeApplyError(400, "The selection fields are invalid.");
  }
  const fields = [...new Set(record.fields)];
  const selection: Selection = {
    section: record.section as Selection["section"],
    index: record.index,
    fields,
  };
  if (record.category !== undefined) {
    if (typeof record.category !== "string" || !SKILL_CATEGORIES.includes(record.category as (typeof SKILL_CATEGORIES)[number])) {
      throw new ResumeApplyError(400, "Choose a skill category before saving a skill.");
    }
    selection.category = record.category;
  }
  if (record.proficiency !== undefined) {
    if (typeof record.proficiency !== "string" || !SKILL_PROFICIENCIES.includes(record.proficiency as (typeof SKILL_PROFICIENCIES)[number])) {
      throw new ResumeApplyError(400, "Choose a skill proficiency before saving a skill.");
    }
    selection.proficiency = record.proficiency;
  }
  if (record.issuer !== undefined) {
    if (typeof record.issuer !== "string" || record.issuer.trim().length === 0 || record.issuer.trim().length > 150) {
      throw new ResumeApplyError(400, "An issuer is required before a resume credential can be saved.");
    }
    selection.issuer = record.issuer.trim();
  }
  return selection;
}

interface PlannedGroup {
  section: Selection["section"];
  index: number;
  rows: ReviewRow[];
  category?: string;
  proficiency?: string;
  issuer?: string;
}

function planApply(review: StoredResumeReview, selections: Selection[]): { sections: string[]; groups: PlannedGroup[] } {
  const groups = selections.map((selection) => {
    const rows = review.rows.filter(
      (row) => row.section === selection.section && row.entryIndex === selection.index && selection.fields.includes(row.field),
    );
    if (rows.length !== selection.fields.length) {
      throw new ResumeApplyError(400, "The selection does not match the stored review.");
    }
    if (rows.some((row) => row.section !== "skills" && row.applicable !== true)) {
      throw new ResumeApplyError(400, "The selection includes a field the profile cannot store.");
    }
    if (selection.section === "skills") {
      if (selection.category === undefined || selection.proficiency === undefined) {
        throw new ResumeApplyError(400, "A category and proficiency are required before a skill can be saved.");
      }
    }
    if (selection.section === "credentials" && selection.issuer === undefined) {
      throw new ResumeApplyError(400, "An issuer is required before a resume credential can be saved.");
    }
    if (selection.section === "education") {
      const names = new Set(rows.map((row) => row.field));
      const entryRows = review.rows.filter((row) => row.section === "education" && row.entryIndex === selection.index);
      const hasInstitution = names.has("institution") || entryRows.every((row) => row.field !== "institution");
      const hasDegree = names.has("degree") || entryRows.every((row) => row.field !== "degree");
      if (!hasInstitution || !hasDegree) {
        throw new ResumeApplyError(400, "Education needs both the institution and the degree.");
      }
    }
    if (selection.section === "socialLinks") {
      const names = new Set(rows.map((row) => row.field));
      if (!names.has("platform") || !names.has("url")) {
        throw new ResumeApplyError(400, "A social link needs both the platform and the URL.");
      }
    }
    if (selection.section === "projects" && !rows.some((row) => row.field === "name")) {
      const entryHasName = review.rows.some(
        (row) => row.section === "projects" && row.entryIndex === selection.index && row.field === "name",
      );
      if (entryHasName) {
        throw new ResumeApplyError(400, "A project needs its name before other project fields can be saved.");
      }
    }
    return {
      section: selection.section,
      index: selection.index,
      rows,
      category: selection.category,
      proficiency: selection.proficiency,
      issuer: selection.issuer,
    };
  });
  return {
    sections: [...new Set(groups.map((group) => group.section))],
    groups,
  };
}

function mergeProfile(
  profile: Record<string, unknown>,
  groups: PlannedGroup[],
): { patch: Record<string, unknown>; skipped: Array<{ section: string; index: number; reason: string }> } {
  const patch: Record<string, unknown> = {};
  const skipped: Array<{ section: string; index: number; reason: string }> = [];
  const education = cloneList(profile.education);
  const projects = cloneList(profile.projects);
  const skills = cloneList(profile.skills);
  const credentials = cloneList(profile.credentials);
  const achievements = cloneList(profile.achievements);
  const links = cloneList(profile.links);
  const contacts = { ...asRecord(profile.contacts) };
  const before = {
    education: JSON.stringify(education),
    projects: JSON.stringify(projects),
    skills: JSON.stringify(skills),
    credentials: JSON.stringify(credentials),
    achievements: JSON.stringify(achievements),
    links: JSON.stringify(links),
  };
  let contactsChanged = false;

  for (const group of groups) {
    const values = Object.fromEntries(group.rows.map((row) => [row.field, row.value]));
    if (group.section === "profile") {
      contactsChanged = applyProfile(profile, contacts, values, patch) || contactsChanged;
    } else if (group.section === "education") {
      applyEducation(education, group, values, skipped);
    } else if (group.section === "projects") {
      applyProject(projects, group, values, skipped);
    } else if (group.section === "skills") {
      applySkill(skills, group, values, skipped);
    } else if (group.section === "credentials") {
      applyCredential(credentials, group, values, skipped);
    } else if (group.section === "achievements") {
      applyAchievement(achievements, group, values, skipped);
    } else {
      applyLink(links, group, values, skipped);
    }
  }

  if (JSON.stringify(education) !== before.education) patch.education = education;
  if (JSON.stringify(projects) !== before.projects) patch.projects = projects;
  if (JSON.stringify(skills) !== before.skills) patch.skills = skills;
  if (JSON.stringify(credentials) !== before.credentials) patch.credentials = credentials;
  if (JSON.stringify(achievements) !== before.achievements) patch.achievements = achievements;
  if (JSON.stringify(links) !== before.links) patch.links = links;
  if (contactsChanged) patch.contacts = contacts;
  return { patch, skipped };
}

function applyProfile(
  profile: Record<string, unknown>,
  contacts: Record<string, unknown>,
  values: Record<string, string>,
  patch: Record<string, unknown>,
): boolean {
  let contactsChanged = false;
  if (values.headline !== undefined) {
    assignScalar(profile.headline, values.headline, "headline", (value) => {
      patch.headline = value;
    });
  }
  if (values.summary !== undefined) {
    assignScalar(profile.bio, values.summary, "summary", (value) => {
      patch.bio = value;
    });
  }
  if (values.email !== undefined) {
    assignScalar(contacts.email, values.email, "email", (value) => {
      contacts.email = value;
      contactsChanged = true;
    });
  }
  if (values.phone !== undefined) {
    assignScalar(contacts.phone, values.phone, "phone", (value) => {
      contacts.phone = value;
      contactsChanged = true;
    });
  }
  return contactsChanged;
}

function applyEducation(
  education: Array<Record<string, unknown>>,
  group: PlannedGroup,
  values: Record<string, string>,
  skipped: Array<{ section: string; index: number; reason: string }>,
): void {
  const institution = values.institution;
  const degree = values.degree;
  if (institution === undefined || degree === undefined) {
    throw new ResumeApplyError(400, "Education needs both the institution and the degree.");
  }
  const matches = education.filter(
    (item) => same(item.institution, institution) && same(item.degree, degree),
  );
  if (matches.length > 1) {
    throw new ResumeApplyError(409, "More than one education record matches this resume entry.");
  }
  if (matches.length === 1) {
    const target = matches[0];
    const before = JSON.stringify(target);
    fillOrMatch(target, "fieldOfStudy", values.fieldOfStudy);
    fillOrMatch(target, "startDate", values.startDate);
    fillOrMatch(target, "endDate", values.endDate);
    const grade = group.rows.find((row) => row.field === "grade");
    if (grade?.profileField === "education.gpa") fillOrMatch(target, "gpa", grade.value);
    if (grade?.profileField === "education.percentage") fillOrMatch(target, "percentage", grade.value);
    if (JSON.stringify(target) === before) {
      skipped.push({ section: "education", index: group.index, reason: "This education record is already on the profile." });
    }
    return;
  }
  const created: Record<string, unknown> = {
    institution,
    degree,
    fieldOfStudy: values.fieldOfStudy ?? "",
    startDate: values.startDate ?? "",
    endDate: values.endDate ?? "",
    verificationStatus: "self-reported",
  };
  const grade = group.rows.find((row) => row.field === "grade");
  if (grade?.profileField === "education.gpa") created.gpa = grade.value;
  if (grade?.profileField === "education.percentage") created.percentage = grade.value;
  education.push(created);
}

function applyProject(
  projects: Array<Record<string, unknown>>,
  group: PlannedGroup,
  values: Record<string, string>,
  skipped: Array<{ section: string; index: number; reason: string }>,
): void {
  const title = values.name;
  if (title === undefined) {
    throw new ResumeApplyError(400, "A project needs its name before other project fields can be saved.");
  }
  const matches = projects.filter((item) => same(item.title, title));
  if (matches.length > 1) {
    throw new ResumeApplyError(409, "More than one project matches this resume entry.");
  }
  const link = group.rows.find((row) => row.field === "links");
  if (matches.length === 1) {
    const target = matches[0];
    const before = JSON.stringify(target);
    fillOrMatch(target, "shortDescription", values.description);
    if (values.technologies !== undefined) {
      const existing = stringList(target.technologies);
      const incoming = values.technologies.split(",").map((item) => item.trim()).filter(Boolean);
      target.technologies = [...new Set([...existing, ...incoming])];
    }
    if (link?.profileField === "projects.repoUrl") fillOrMatch(target, "repoUrl", link.value);
    if (link?.profileField === "projects.liveUrl") fillOrMatch(target, "liveUrl", link.value);
    if (JSON.stringify(target) === before) {
      skipped.push({ section: "projects", index: group.index, reason: "This project is already on the profile." });
    }
    return;
  }
  const created: Record<string, unknown> = {
    title,
    shortDescription: values.description ?? "",
    technologies: values.technologies
      ? values.technologies.split(",").map((item) => item.trim()).filter(Boolean)
      : [],
  };
  if (link?.profileField === "projects.repoUrl") created.repoUrl = link.value;
  if (link?.profileField === "projects.liveUrl") created.liveUrl = link.value;
  projects.push(created);
}

function applySkill(
  skills: Array<Record<string, unknown>>,
  group: PlannedGroup,
  values: Record<string, string>,
  skipped: Array<{ section: string; index: number; reason: string }>,
): void {
  const name = values.name;
  if (name === undefined || group.category === undefined || group.proficiency === undefined) {
    throw new ResumeApplyError(400, "A category and proficiency are required before a skill can be saved.");
  }
  if (skills.some((item) => same(item.name, name))) {
    skipped.push({ section: "skills", index: group.index, reason: "This skill is already on the profile." });
    return;
  }
  skills.push({ name, category: group.category, proficiency: group.proficiency, level: group.proficiency });
}

function applyCredential(
  credentials: Array<Record<string, unknown>>,
  group: PlannedGroup,
  values: Record<string, string>,
  skipped: Array<{ section: string; index: number; reason: string }>,
): void {
  const title = values.title;
  if (title === undefined || group.issuer === undefined) {
    throw new ResumeApplyError(400, "An issuer is required before a resume credential can be saved.");
  }
  const matches = credentials.filter((item) => same(item.title, title));
  if (matches.some((item) => item.verificationStatus === "verified")) {
    throw new ResumeApplyError(409, "An existing verified credential cannot be replaced by a resume claim.");
  }
  if (matches.length > 1) {
    throw new ResumeApplyError(409, "More than one credential matches this resume entry.");
  }
  if (matches.length === 1) {
    const target = matches[0];
    const before = JSON.stringify(target);
    if (values.description !== undefined) fillOrMatch(target, "description", values.description);
    if (JSON.stringify(target) === before) {
      skipped.push({ section: "credentials", index: group.index, reason: "This self-reported credential is already on the profile." });
    }
    return;
  }
  credentials.push({
    title,
    issuer: group.issuer,
    description: values.description ?? "",
    credentialType: "other",
    verificationStatus: "self-reported",
    verificationMethod: "self-reported",
    certificateVerificationId: "",
  });
}

function applyAchievement(
  achievements: Array<Record<string, unknown>>,
  group: PlannedGroup,
  values: Record<string, string>,
  skipped: Array<{ section: string; index: number; reason: string }>,
): void {
  const title = values.title;
  if (title === undefined) {
    throw new ResumeApplyError(400, "An achievement needs its title.");
  }
  const matches = achievements.filter((item) => same(item.title, title));
  if (matches.some((item) => item.verificationStatus === "verified")) {
    throw new ResumeApplyError(409, "An existing verified achievement cannot be replaced by a resume claim.");
  }
  if (matches.length > 1) {
    throw new ResumeApplyError(409, "More than one achievement matches this resume entry.");
  }
  if (matches.length === 1) {
    const before = JSON.stringify(matches[0]);
    fillOrMatch(matches[0], "description", values.description);
    if (JSON.stringify(matches[0]) === before) {
      skipped.push({ section: "achievements", index: group.index, reason: "This achievement is already on the profile." });
    }
    return;
  }
  achievements.push({
    title,
    description: values.description ?? "",
    category: "other",
    verificationStatus: "self-reported",
  });
}

function applyLink(
  links: Array<Record<string, unknown>>,
  group: PlannedGroup,
  values: Record<string, string>,
  skipped: Array<{ section: string; index: number; reason: string }>,
): void {
  const platform = values.platform;
  const url = values.url;
  if (platform === undefined || url === undefined) {
    throw new ResumeApplyError(400, "A social link needs both the platform and the URL.");
  }
  if (links.some((item) => same(item.platform, platform) && same(item.url, url))) {
    skipped.push({ section: "socialLinks", index: group.index, reason: "This link is already on the profile." });
    return;
  }
  if (links.some((item) => same(item.platform, platform) && text(item.url) !== "" && !same(item.url, url))) {
    throw new ResumeApplyError(409, "This platform already has a different URL. It was left unchanged.");
  }
  links.push({
    platform,
    url,
    category: linkCategory(platform),
    verificationStatus: "unverified",
  });
}

function assignScalar(
  current: unknown,
  incoming: string,
  label: string,
  write: (value: string) => void,
): void {
  if (text(current).trim().length === 0) {
    write(incoming);
    return;
  }
  if (!same(current, incoming)) {
    throw new ResumeApplyError(409, `The profile already has a different ${label}. It was left unchanged.`);
  }
}

function fillOrMatch(target: Record<string, unknown>, field: string, incoming: string | undefined): boolean {
  if (incoming === undefined) return true;
  const current = text(target[field]).trim();
  if (current.length === 0) {
    target[field] = incoming;
    return true;
  }
  if (!same(current, incoming)) {
    throw new ResumeApplyError(409, `The profile already has a different ${field}. It was left unchanged.`);
  }
  return true;
}

function linkCategory(platform: string): string {
  const name = platform.toLowerCase();
  if (/(github|gitlab|bitbucket)/.test(name)) return "coding";
  if (/linkedin/.test(name)) return "professional";
  if (/(twitter|^x$|instagram|facebook)/.test(name)) return "social";
  return "other";
}

function cloneList(value: unknown): Array<Record<string, unknown>> {
  return asList(value).map((item) => ({ ...item }));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function same(left: unknown, right: unknown): boolean {
  return text(left).trim().toLowerCase().replace(/\s+/g, " ") === text(right).trim().toLowerCase().replace(/\s+/g, " ");
}
