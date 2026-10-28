/**
 * OneVue Public Profile DTO Contract v1 (Client/Template definitions)
 * Exactly mirrors the published contract from OneVue Phase 3 API:
 * GET /api/public/profile/:username
 */

import { MAGICUI_TEMPLATE_ID, retainedPublicFields } from "./template-registry.ts";

export const SUPPORTED_DTO_SCHEMA_VERSION = "1.0.0" as const;

export interface IPublicLocation {
  city?: string;
  state?: string;
  country?: string;
  formatted?: string;
}

export interface IPublicLanguage {
  language: string;
  proficiency: "basic" | "conversational" | "fluent" | "native" | string;
}

export interface IPublicEducation {
  id: string;
  institution: string;
  degree: string;
  fieldOfStudy?: string;
  specialization?: string;
  department?: string;
  startDate?: string;
  endDate?: string;
  expectedGradDate?: string;
  currentStatus: "studying" | "completed" | "paused" | "withdrawn" | string;
  gpa?: string;
  gpaScale?: string;
  percentage?: string;
  gradeClass?: string;
  rank?: string;
  location?: string;
  website?: string;
  coursework?: string;
  honors?: string;
}

export interface IPublicProject {
  id: string;
  title: string;
  shortDescription?: string;
  detailedDescription?: string;
  projectType?: string;
  role?: string;
  status?: string;
  isTeam?: boolean;
  teamSize?: number;
  startDate?: string;
  endDate?: string;
  technologies: string[];
  techStack?: string;
  repoUrl?: string;
  liveUrl?: string;
  docsUrl?: string;
  videoUrl?: string;
  websiteUrl?: string;
  problemSolved?: string;
  keyFeatures?: string;
  challengesSolutions?: string;
  metricsResults?: string;
  impact?: string;
  imageUrl?: string;
}

export interface IPublicSkill {
  id: string;
  name: string;
  category: string;
  proficiency: string;
  yearsExperience?: number;
  level?: string;
}

export interface IPublicCredential {
  id: string;
  title: string;
  credentialType: string;
  issuer: string;
  issueDate?: string;
  expirationDate?: string;
  neverExpires?: boolean;
  credentialUrl?: string;
  verificationUrl?: string;
  verificationStatus?: string;
  description?: string;
  relatedSkills?: string[];
}

export interface IPublicAchievement {
  id: string;
  title: string;
  category: string;
  organization?: string;
  date?: string;
  year?: string;
  description?: string;
  positionRank?: string;
  awardPrize?: string;
  teamSize?: number;
  role?: string;
  location?: string;
  proofUrl?: string;
  certificateUrl?: string;
}

export interface IPublicExperience {
  id: string;
  title: string;
  organization: string;
  employmentType?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  isCurrent?: boolean;
  description?: string;
}

export interface IPublicTestimonial {
  id: string;
  quote: string;
  authorName: string;
  relationship?: string;
  attribution?: string;
}

export interface IPublicTeamMember {
  id: string;
  name: string;
  role?: string;
}

export interface IPublicResume {
  url: string;
  fileName?: string;
  uploadedAt?: string;
  targetRole?: string;
}

export interface IPublicMediaItem {
  id: string;
  mediaUrl: string;
  mediaType: string;
  title: string;
  description?: string;
  category: string;
  isFeatured?: boolean;
  altText?: string;
}

export interface IPublicSocialLink {
  id: string;
  platform: string;
  url: string;
  category: string;
  username?: string;
  isPrimary?: boolean;
}

export interface IPublicContact {
  email?: string;
  phone?: string;
  countryCode?: string;
  city?: string;
  state?: string;
  country?: string;
  github?: string;
  linkedin?: string;
  twitter?: string;
  portfolio?: string;
  socialLinks: IPublicSocialLink[];
}

export interface IPublicProfileMetadata {
  schemaVersion: typeof SUPPORTED_DTO_SCHEMA_VERSION;
  username?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  templateId?: string;
  templateVersion?: string;
}

export interface IPublicCustomField {
  id: string;
  key: string;
  label: string;
  type: string;
  order: number;
  helpText?: string;
  presentation: string;
  value: unknown;
  mapsTo?: string;
  /** Present only on a leaked or legacy field. Public snapshots omit private fields. */
  visibility?: "public" | "private";
}

export interface IPublicCustomSection {
  id: string;
  key: string;
  title: string;
  description?: string;
  builtinKey?: string;
  order: number;
  repeatable: boolean;
  records: { id: string; fields: IPublicCustomField[] }[];
}

export interface PublicProfileDTO_v1 {
  meta: IPublicProfileMetadata;
  profile: {
    displayName: string;
    preferredName?: string;
    initials: string;
    headline?: string;
    bio?: string;
    profilePhoto?: string;
    location: IPublicLocation;
    nationality?: string;
    currentStatus?: string;
    careerInterests: string[];
    areasOfInterest: string[];
    languages: IPublicLanguage[];
  };
  education: IPublicEducation[];
  projects: IPublicProject[];
  skills: IPublicSkill[];
  credentials: IPublicCredential[];
  achievements: IPublicAchievement[];
  experience?: IPublicExperience[];
  testimonials?: IPublicTestimonial[];
  team?: IPublicTeamMember[];
  resume?: IPublicResume;
  media: IPublicMediaItem[];
  contact: IPublicContact;
  customSections?: IPublicCustomSection[];
}

export interface WebsiteCustomization {
  accentColor?: string;
  themeMode?: "light" | "dark" | "system";
  visibleSections?: string[];
  sectionOrder?: string[];
}

export interface WebsiteMetadata {
  username: string;
  templateId: string;
  templateVersion: string;
  publishedAt: string;
  revisionNumber: number;
  customization: WebsiteCustomization;
}

export interface OneVuePublicApiResponse {
  success: boolean;
  dto: PublicProfileDTO_v1;
  website: WebsiteMetadata;
  analytics?: {
    resourceId: string;
    resourceType: "portfolio" | "visiting_card";
  };
}

/**
 * Transformed structure consumed directly by Magic UI portfolio components
 */
export interface AdaptedCustomField {
  id: string;
  label: string;
  presentation: string;
  text?: string;
  href?: string;
  images?: { href: string; fileName?: string }[];
  tags?: string[];
  checked?: boolean;
  embed?: boolean;
  mapsTo?: string;
}

export interface AdaptedCustomSection {
  id: string;
  title: string;
  description?: string;
  records: { id: string; fields: AdaptedCustomField[] }[];
}

export interface AdaptedEducation {
  school: string;
  href: string;
  degree: string;
  logoUrl?: string;
  start: string;
  end: string;
  id?: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedProjectLink {
  type: string;
  href: string;
  iconName: "globe" | "github" | "video" | "doc";
}

export interface AdaptedProject {
  title: string;
  href: string;
  dates: string;
  active: boolean;
  description: string;
  technologies: string[];
  links: AdaptedProjectLink[];
  image: string;
  video: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedSkill {
  name: string;
  category?: string;
  proficiency?: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedWorkItem {
  company: string;
  href: string;
  badges: string[];
  location: string;
  title: string;
  logoUrl?: string;
  start: string;
  end: string;
  description: string;
  /** Stable id of the profile record this row was projected from. */
  sourceRecordId?: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedHackathonLink {
  title: string;
  href: string;
  iconName: "globe" | "github";
}

export interface AdaptedHackathon {
  title: string;
  dates: string;
  location: string;
  description: string;
  image?: string;
  links: AdaptedHackathonLink[];
  customFields?: AdaptedCustomField[];
}

export interface AdaptedHighlight {
  title: string;
  date: string;
  description: string;
  href: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedCredential {
  id?: string;
  title: string;
  issuer: string;
  date: string;
  href: string;
  description: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedTestimonial {
  quote: string;
  author: string;
  relationship: string;
  note: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedTeamMember {
  name: string;
  role: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedMediaItem {
  title: string;
  href: string;
  mediaType: string;
  alt: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedSocialLink {
  name: string;
  url: string;
  iconName: "github" | "linkedin" | "x" | "email" | "globe" | "phone" | "instagram";
  navbar: boolean;
  sourceId?: string;
  customFields?: AdaptedCustomField[];
}

export interface AdaptedPortfolioData {
  name: string;
  initials: string;
  url: string;
  location?: string;
  description: string;
  summary: string;
  avatarUrl?: string;
  skills: AdaptedSkill[];
  education: AdaptedEducation[];
  projects: AdaptedProject[];
  services: AdaptedProject[];
  products: AdaptedProject[];
  caseStudies: AdaptedProject[];
  featured: AdaptedProject[];
  work: AdaptedWorkItem[];
  hackathons: AdaptedHackathon[];
  highlights: AdaptedHighlight[];
  credentials: AdaptedCredential[];
  testimonials: AdaptedTestimonial[];
  team: AdaptedTeamMember[];
  media: AdaptedMediaItem[];
  customSections: AdaptedCustomSection[];
  aboutFields?: AdaptedCustomField[];
  resumeFields?: AdaptedCustomField[];
  contact: {
    email?: string;
    tel?: string;
    social: Record<string, AdaptedSocialLink>;
    customFields?: AdaptedCustomField[];
  };
  resumeUrl?: string;
  /** Test adapter that rendered this view. Stored content is not removed when it cannot be shown. */
  templateId: string;
  retainedFields: string[];
  accentColor?: string;
  themeMode: "light" | "dark" | "system";
  sectionOrder: string[];
  visibleSections: {
    hero: boolean;
    about: boolean;
    work: boolean;
    education: boolean;
    skills: boolean;
    projects: boolean;
    services: boolean;
    products: boolean;
    caseStudies: boolean;
    featured: boolean;
    hackathons: boolean;
    highlights: boolean;
    credentials: boolean;
    testimonials: boolean;
    team: boolean;
    media: boolean;
    contact: boolean;
    custom: boolean;
  };
}

/**
 * Validates that an external URL has an allowed safe protocol (http or https).
 * Strictly rejects javascript:, data:, vbscript:, and malformed URIs.
 */
export function sanitizeSafeUrl(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pure, non-mutating adapter that converts a validated OneVue PublicProfileDTO_v1
 * into the exact data shape required by Magic UI components.
 */
const DEFAULT_SECTION_ORDER = ["about", "work", "education", "skills", "projects", "achievements", "contact"];
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Keeps a stored section order and appends any group this adapter can place. */
export function normalizeSectionOrder(value: unknown): string[] {
  const next: string[] = [];
  const incoming = Array.isArray(value) ? value : [];
  for (const item of incoming) {
    const id = String(item);
    if (DEFAULT_SECTION_ORDER.includes(id) && !next.includes(id)) next.push(id);
  }
  for (const id of DEFAULT_SECTION_ORDER) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

export function resolveAvatarUrl(val: unknown, assetOrigin?: string): string | undefined {
  const absolute = sanitizeSafeUrl(val);
  if (absolute) return absolute;
  if (typeof val !== "string" || !assetOrigin) return undefined;
  const trimmed = val.trim();
  const relativePhoto =
    /^\/api\/profile\/photo\/[A-Za-z0-9._~%-]+$/.test(trimmed) ||
    /^\/api\/assets\/public\/ast_[a-f0-9]{24}$/.test(trimmed) ||
    /^\/api\/assets\/private\/ast_[a-f0-9]{24}\?exp=\d{1,12}&sig=[a-f0-9]{64}$/.test(trimmed);
  if (!relativePhoto) return undefined;
  try {
    return `${new URL(assetOrigin).origin}${trimmed}`;
  } catch {
    return undefined;
  }
}

/**
 * Older snapshots used these section keys for the same stored records.
 * A legacy key is used only when the current key is absent and exactly one
 * section contains the requested record id.
 */
const LEGACY_SECTION_KEYS: Record<string, readonly string[]> = {
  employmentHistory: ["experience", "work", "jobs"],
  workExperience: ["experience", "work", "jobs"],
  achievements: ["highlights"],
  pastCollaborations: ["highlights"],
  audienceStats: ["highlights"],
  credentials: ["certifications", "certification"],
  certifications: ["credentials"],
  projects: ["project"],
  portfolio: ["project"],
  products: ["project"],
  services: ["project"],
  caseStudies: ["project"],
  featuredContent: ["featured"],
  socialLinks: ["social", "social_links"],
  links: ["social", "social_links"],
  channels: ["social"],
  resources: ["social"],
  testimonials: ["testimonial"],
  team: ["team_members"],
};

function fieldsOnSection(section: IPublicCustomSection, recordId: string): IPublicCustomField[] {
  const record = (section.records || []).find((item) => item && item.id === recordId);
  return record && Array.isArray(record.fields) ? record.fields : [];
}

function customFieldsFor(dto: PublicProfileDTO_v1, builtinKey: string, recordId: string): IPublicCustomField[] {
  const sections = (Array.isArray(dto.customSections) ? dto.customSections : []).filter(
    (item): item is IPublicCustomSection => Boolean(item)
  );
  const exact = sections.filter((section) => section.builtinKey === builtinKey || section.key === builtinKey);
  for (const section of exact) {
    const fields = fieldsOnSection(section, recordId);
    if (fields.length) return fields;
  }
  if (exact.length) return [];
  const aliases = LEGACY_SECTION_KEYS[builtinKey] || [];
  const matches = sections
    .filter((section) => aliases.includes(section.builtinKey || section.key))
    .map((section) => fieldsOnSection(section, recordId))
    .filter((fields) => fields.length > 0);
  return matches.length === 1 ? matches[0] : [];
}

function safeFieldHref(value: unknown, assetOrigin?: string): string | undefined {
  return sanitizeSafeUrl(value) || resolveAvatarUrl(value, assetOrigin);
}

function adaptCustomFields(fields: IPublicCustomField[] | undefined, assetOrigin?: string): AdaptedCustomField[] {
  if (!Array.isArray(fields)) return [];
  const adapted: AdaptedCustomField[] = [];
  for (const field of fields) {
    if (!field || field.presentation === "hidden" || typeof field.label !== "string") continue;
    if ((field as { visibility?: string }).visibility === "private") continue;
    const base = {
      id: String(field.id || field.key || field.label),
      label: field.label,
      presentation: field.presentation,
      ...(typeof field.mapsTo === "string" && field.mapsTo ? { mapsTo: field.mapsTo } : {}),
    };
    if (field.presentation === "link" || field.type === "url") {
      const href = safeFieldHref(field.value, assetOrigin);
      if (!href) continue;
      adapted.push({ ...base, href, text: href });
      continue;
    }
    if (field.presentation === "image" || field.presentation === "file") {
      const row = field.value && typeof field.value === "object" ? field.value as { href?: unknown; fileName?: unknown } : {};
      const href = safeFieldHref(row.href, assetOrigin);
      if (!href) continue;
      adapted.push({ ...base, href, text: typeof row.fileName === "string" ? row.fileName : field.label });
      continue;
    }
    if (field.presentation === "gallery" && Array.isArray(field.value)) {
      const images: { href: string; fileName?: string }[] = [];
      for (const item of field.value) {
        const row = item && typeof item === "object" ? item as { href?: unknown; fileName?: unknown } : {};
        const href = safeFieldHref(row.href, assetOrigin);
        if (!href) continue;
        images.push(typeof row.fileName === "string" ? { href, fileName: row.fileName } : { href });
      }
      if (!images.length) continue;
      adapted.push({ ...base, images });
      continue;
    }
    if (field.presentation === "video") {
      const row = field.value && typeof field.value === "object" ? field.value as { href?: unknown; embed?: unknown } : {};
      const href = safeFieldHref(row.href, assetOrigin);
      if (!href) continue;
      adapted.push({ ...base, href, embed: row.embed === true, text: href });
      continue;
    }
    if (field.presentation === "tags" && Array.isArray(field.value)) {
      const tags = field.value.filter((item): item is string => typeof item === "string" && Boolean(item));
      if (!tags.length) continue;
      adapted.push({ ...base, tags });
      continue;
    }
    if (field.presentation === "boolean") {
      adapted.push({ ...base, checked: field.value === true, text: field.value === true ? "Yes" : "No" });
      continue;
    }
    if (field.presentation === "number" && typeof field.value === "number") {
      adapted.push({ ...base, text: String(field.value) });
      continue;
    }
    if (typeof field.value === "string" && field.value.trim()) {
      adapted.push({ ...base, text: field.value });
    }
  }
  return adapted;
}

const STORED_TO_PUBLIC: Record<string, string[]> = {
  company: ["organization"],
  jobTitle: ["title"],
  evidenceUrl: ["proofUrl", "credentialUrl"],
  website: ["portfolio"],
  description: ["shortDescription"],
  summary: ["shortDescription"],
  url: ["liveUrl", "mediaUrl"],
  publishedAt: ["startDate"],
  outcome: ["impact"],
  label: ["username"],
  handle: ["username"],
};

function shownOnRecord(field: AdaptedCustomField, source: Record<string, unknown> | undefined): boolean {
  if (!field.mapsTo || !source) return true;
  const direct = source[field.mapsTo];
  const alias = (STORED_TO_PUBLIC[field.mapsTo] || [])
    .map((key) => source[key])
    .find((value) => value !== undefined && value !== null && value !== "");
  const current = direct !== undefined && direct !== null && direct !== "" ? direct : alias;
  if (current === undefined || current === null || current === "") return true;
  if (field.href && current === field.href) return false;
  if (field.text && String(current) === field.text) return false;
  if (typeof current === "boolean" && field.checked === current) return false;
  if (Array.isArray(current) && field.tags && current.join("\u0000") === field.tags.join("\u0000")) return false;
  return true;
}

function recordCustomFields(
  dto: PublicProfileDTO_v1,
  builtinKeys: string[],
  recordId: string,
  assetOrigin: string | undefined,
  source?: Record<string, unknown>
): AdaptedCustomField[] {
  const seen = new Set<string>();
  const direct = Array.isArray(source?.customFields) ? (source!.customFields as IPublicCustomField[]) : [];
  const fromSections = builtinKeys.flatMap((key) => customFieldsFor(dto, key, recordId));
  const raw = [...direct, ...fromSections].filter((field) => {
    const id = String(field.id || field.key || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return adaptCustomFields(raw, assetOrigin).filter((field) => shownOnRecord(field, source));
}

function adaptCustomSections(dto: PublicProfileDTO_v1, assetOrigin?: string): AdaptedCustomSection[] {
  const sections = Array.isArray(dto.customSections) ? dto.customSections : [];
  return sections
    .filter((section) => section && !section.builtinKey && section.title)
    .map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      records: (section.records || [])
        .map((record) => ({
          id: record.id,
          fields: adaptCustomFields(record.fields, assetOrigin),
        }))
        .filter((record) => record.fields.length > 0),
    }))
    .filter((section) => section.records.length > 0);
}

export function adaptOneVueProfile(
  dto: PublicProfileDTO_v1,
  website?: WebsiteMetadata,
  options?: { assetOrigin?: string }
): AdaptedPortfolioData {
  if (!dto || !dto.meta || !dto.profile) {
    throw new Error("Invalid OneVue profile payload: missing root metadata or profile.");
  }

  // Schema version validation
  if (dto.meta.schemaVersion !== SUPPORTED_DTO_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported profile schema version: '${dto.meta.schemaVersion}'. Expected '${SUPPORTED_DTO_SCHEMA_VERSION}'.`
    );
  }

  const { profile, education, projects, skills, achievements, contact } = dto;

  // 1. Visible sections evaluation
  const configuredVisible = Array.isArray(website?.customization?.visibleSections)
    ? website!.customization.visibleSections.map((s) => s.toLowerCase().trim())
    : ["about", "education", "projects", "skills", "achievements", "contact"];

  const isVisible = (sectionName: string) => configuredVisible.includes(sectionName.toLowerCase());

  // 2. Profile / Hero data
  const name = (profile.displayName || dto.meta.username || "Student").trim();
  const initials = profile.initials || deriveInitials(name);
  const description = profile.headline || "";
  const summary = profile.bio || "";
  const avatarUrl = resolveAvatarUrl(profile.profilePhoto, options?.assetOrigin);
  const safeCanonical = sanitizeSafeUrl(dto.meta.canonicalUrl);
  const canonicalUrl = safeCanonical || `https://onevue.me/p/${encodeURIComponent(dto.meta.username || "")}`;

  const locationFormatted =
    profile.location?.formatted ||
    [profile.location?.city, profile.location?.state, profile.location?.country]
      .filter(Boolean)
      .join(", ") ||
    undefined;

  // 3. Education mapping
  const adaptedEducation: AdaptedEducation[] = Array.isArray(education)
    ? education
        .filter((e) => Boolean(e && e.institution && e.degree))
        .map((e) => {
          const degreeText = e.fieldOfStudy ? `${e.degree} in ${e.fieldOfStudy}` : e.degree;
          const start = e.startDate || "";
          const end =
            e.endDate ||
            (e.currentStatus === "studying" ? "Present" : e.expectedGradDate || "");
          return {
            id: e.id,
            school: e.institution,
            href: sanitizeSafeUrl(e.website) || "#",
            degree: degreeText,
            start: start || "Enrolled",
            end: end || "Present",
            customFields: recordCustomFields(dto, ["education"], e.id, options?.assetOrigin, e as unknown as Record<string, unknown>),
          };
        })
    : [];

  // 4. Projects mapping. Identity-specific types stay in their own groups.
  const projectBuckets: Record<"projects" | "services" | "products" | "caseStudies" | "featured", AdaptedProject[]> = {
    projects: [],
    services: [],
    products: [],
    caseStudies: [],
    featured: [],
  };
  const consumedMediaUrls = new Set<string>();
  const mediaItems = Array.isArray(dto.media) ? dto.media : [];
  if (Array.isArray(projects)) {
    projects.filter((p) => Boolean(p && p.title)).forEach((p, index) => {
      const links: AdaptedProjectLink[] = [];
      const safeLiveUrl = sanitizeSafeUrl(p.liveUrl);
      const safeWebsiteUrl = sanitizeSafeUrl(p.websiteUrl);
      const safeRepoUrl = sanitizeSafeUrl(p.repoUrl);
      const safeVideoUrl = sanitizeSafeUrl(p.videoUrl);
      const safeDocsUrl = sanitizeSafeUrl(p.docsUrl);

      if (safeLiveUrl) {
        links.push({ type: "Website", href: safeLiveUrl, iconName: "globe" });
      } else if (safeWebsiteUrl) {
        links.push({ type: "Website", href: safeWebsiteUrl, iconName: "globe" });
      }
      if (safeRepoUrl) links.push({ type: "Source", href: safeRepoUrl, iconName: "github" });
      if (safeVideoUrl) links.push({ type: "Video", href: safeVideoUrl, iconName: "video" });
      if (safeDocsUrl) links.push({ type: "Docs", href: safeDocsUrl, iconName: "doc" });

      const primaryHref = safeLiveUrl || safeWebsiteUrl || safeRepoUrl || "#";
      const desc = p.shortDescription || p.detailedDescription || "";
      const start = p.startDate || "";
      const end = p.endDate || (p.status === "in_progress" ? "Present" : "");
      const dates = start && end ? `${start} - ${end}` : start || end || "";
      const directImage = resolveAvatarUrl(p.imageUrl, options?.assetOrigin);
      if (typeof p.imageUrl === "string" && p.imageUrl) consumedMediaUrls.add(p.imageUrl);
      const legacy = mediaItems.find((item) => item && item.id === `project_asset_${index}`);
      const legacyImage = directImage ? undefined : resolveAvatarUrl(legacy?.mediaUrl, options?.assetOrigin);
      if (legacyImage && legacy?.mediaUrl) consumedMediaUrls.add(legacy.mediaUrl);
      if (directImage) consumedMediaUrls.add(directImage);

      const adapted: AdaptedProject = {
        title: p.title,
        href: primaryHref,
        dates,
        active: p.status !== "archived",
        description: desc,
        technologies: Array.isArray(p.technologies) ? [...p.technologies] : [],
        links,
        image: directImage || legacyImage || "",
        video: safeVideoUrl || "",
        customFields: recordCustomFields(
          dto,
          ["projects", "portfolio", "products", "caseStudies", "featuredContent", "services"],
          p.id,
          options?.assetOrigin,
          p as unknown as Record<string, unknown>
        ),
      };
      projectBuckets[projectGroup(p.projectType)].push(adapted);
    });
  }
  const adaptedProjects = projectBuckets.projects;

  // 5. Work experience. Explicit employment wins. Older 1.0.0 snapshots that
  // stored jobs as achievements are still rendered, and are not invented when absent.
  const adaptedWork: AdaptedWorkItem[] = [];
  const explicitExperience = Array.isArray(dto.experience) ? dto.experience : [];
  for (const job of explicitExperience) {
    if (!job || (!job.title && !job.organization)) continue;
    const end = job.isCurrent ? "Present" : job.endDate || "";
    const roleFields = recordCustomFields(
      dto,
      ["employmentHistory", "workExperience"],
      job.id,
      options?.assetOrigin,
      job as unknown as Record<string, unknown>
    );
    const currentRoleFields = job.id === "currentEmployment"
      ? recordCustomFields(
          dto,
          ["currentEmployment"],
          "",
          options?.assetOrigin,
          job as unknown as Record<string, unknown>
        )
      : [];
    adaptedWork.push({
      company: job.organization || job.title,
      href: "#",
      badges: job.employmentType ? [job.employmentType.replace(/_/g, " ")] : [],
      location: job.location || "",
      title: job.title || job.organization,
      start: job.startDate || "",
      end,
      description: job.description || "",
      customFields: [...currentRoleFields, ...roleFields],
    });
  }
  if (explicitExperience.length === 0 && Array.isArray(achievements)) {
    for (const item of achievements) {
      if (String(item?.category || "").toLowerCase() !== "experience") continue;
      if (!item.title) continue;
      adaptedWork.push({
        company: item.organization || item.title,
        href: sanitizeSafeUrl(item.proofUrl) || "#",
        badges: [],
        location: item.location || "",
        title: item.role || item.title,
        start: "",
        end: item.date || item.year || "",
        description: item.description || "",
        sourceRecordId: item.id,
        customFields: recordCustomFields(
          dto,
          ["achievements"],
          item.id,
          options?.assetOrigin,
          item as unknown as Record<string, unknown>
        ),
      });
    }
  }
  if (Array.isArray(projects)) {
    for (const p of projects) {
      if (
        p.projectType &&
        (p.projectType.toLowerCase() === "internship" || p.projectType.toLowerCase() === "employment")
      ) {
        const sourceId = typeof p.id === "string" ? p.id : "";
        adaptedWork.push({
          company: p.title,
          href: sanitizeSafeUrl(p.liveUrl) || sanitizeSafeUrl(p.repoUrl) || "#",
          badges: [],
          location: "",
          title: p.role || "Intern",
          start: p.startDate || "",
          end: p.endDate || "Present",
          description: p.shortDescription || p.detailedDescription || "",
          ...(sourceId ? { sourceRecordId: sourceId } : {}),
          customFields: sourceId
            ? recordCustomFields(
                dto,
                ["projects", "portfolio", "products", "caseStudies", "featuredContent", "services"],
                sourceId,
                options?.assetOrigin,
                p as unknown as Record<string, unknown>
              )
            : [],
        });
      }
    }
  }

  // 6. Skills mapping
  const adaptedSkills: AdaptedSkill[] = Array.isArray(skills)
    ? skills
        .filter((s) => Boolean(s && s.name))
        .map((s) => ({
          name: s.name,
          category: s.category || "General",
          proficiency: s.proficiency,
          customFields: recordCustomFields(dto, ["skills"], s.id, options?.assetOrigin, s as unknown as Record<string, unknown>),
        }))
    : [];

  // 7. Hackathons mapping (Strict rule: Only genuine achievements marked as hackathons)
  const adaptedHackathons: AdaptedHackathon[] = [];
  if (Array.isArray(achievements)) {
    for (const a of achievements) {
      const category = String(a.category || "").toLowerCase();
      if (category.includes("hackathon") || category.includes("competition")) {
        const links: AdaptedHackathonLink[] = [];
        const safeProof = sanitizeSafeUrl(a.proofUrl);
        const safeCert = sanitizeSafeUrl(a.certificateUrl);

        if (safeProof) {
          links.push({
            title: a.awardPrize ? `${a.awardPrize}` : "Devpost / Proof",
            href: safeProof,
            iconName: safeProof.includes("github.com") ? "github" : "globe",
          });
        }
        if (safeCert) {
          links.push({
            title: "Certificate",
            href: safeCert,
            iconName: "globe",
          });
        }

        adaptedHackathons.push({
          title: a.title,
          dates: a.date || a.year || "",
          location: a.location || a.organization || "",
          description: a.description || (a.awardPrize ? `Award: ${a.awardPrize}` : ""),
          links,
          customFields: recordCustomFields(
            dto,
            ["achievements", "pastCollaborations", "audienceStats"],
            a.id,
            options?.assetOrigin,
            a as unknown as Record<string, unknown>
          ),
        });
      }
    }
  }

  const achievementList = Array.isArray(achievements) ? achievements : [];
  const highlights: AdaptedHighlight[] = achievementList
    .filter((item) => {
      const category = String(item?.category || "").toLowerCase();
      if (!item?.title) return false;
      return !["hackathon", "competition", "experience", "testimonial", "team"].some((name) =>
        category.includes(name)
      );
    })
    .map((item) => ({
      title: item.title,
      date: item.date || item.year || "",
      description: item.description || "",
      href: sanitizeSafeUrl(item.proofUrl) || sanitizeSafeUrl(item.certificateUrl) || "#",
      customFields: recordCustomFields(
        dto,
        ["achievements", "pastCollaborations", "audienceStats"],
        item.id,
        options?.assetOrigin,
        item as unknown as Record<string, unknown>
      ),
    }));

  const credentials: AdaptedCredential[] = (Array.isArray(dto.credentials) ? dto.credentials : [])
    .filter((item) => Boolean(item && item.title))
    .map((item) => ({
      id: item.id,
      title: item.title,
      issuer: item.issuer || "",
      date: item.issueDate || "",
      href: sanitizeSafeUrl(item.credentialUrl) || sanitizeSafeUrl(item.verificationUrl) || "#",
      description: item.description || "",
      customFields: recordCustomFields(
        dto,
        ["credentials", "certifications"],
        item.id,
        options?.assetOrigin,
        item as unknown as Record<string, unknown>
      ),
    }));

  const explicitTestimonials = Array.isArray(dto.testimonials) ? dto.testimonials : [];
  const testimonials: AdaptedTestimonial[] = explicitTestimonials.length
    ? explicitTestimonials
        .filter((item) => Boolean(item && item.quote && item.authorName))
        .map((item) => ({
          quote: item.quote,
          author: item.authorName,
          relationship: item.relationship || "",
          note: item.attribution === "verified" ? "Verified" : "Self-reported",
          customFields: recordCustomFields(
            dto,
            ["testimonials"],
            item.id,
            options?.assetOrigin,
            item as unknown as Record<string, unknown>
          ),
        }))
    : achievementList
        .filter((item) => String(item?.category || "").toLowerCase() === "testimonial" && item.title)
        .map((item) => ({
          quote: item.title.replace(/^["“]|["”]$/g, ""),
          author: item.organization || "",
          relationship: item.role || "",
          note: item.description || "",
          customFields: recordCustomFields(
            dto,
            ["achievements"],
            item.id,
            options?.assetOrigin,
            item as unknown as Record<string, unknown>
          ),
        }));

  const explicitTeam = Array.isArray(dto.team) ? dto.team : [];
  const team: AdaptedTeamMember[] = explicitTeam.length
    ? explicitTeam
        .filter((item) => Boolean(item && item.name))
        .map((item) => ({
          name: item.name,
          role: item.role || "",
          customFields: recordCustomFields(
            dto,
            ["team"],
            item.id,
            options?.assetOrigin,
            item as unknown as Record<string, unknown>
          ),
        }))
    : achievementList
        .filter((item) => String(item?.category || "").toLowerCase() === "team" && item.title)
        .map((item) => ({
          name: item.title,
          role: item.role || "",
          customFields: recordCustomFields(
            dto,
            ["achievements"],
            item.id,
            options?.assetOrigin,
            item as unknown as Record<string, unknown>
          ),
        }));

  const media: AdaptedMediaItem[] = mediaItems.flatMap((item) => {
    if (!item?.mediaUrl) return [];
    if (typeof item.id === "string" && item.id.startsWith("project_asset_")) return [];
    const href = resolveAvatarUrl(item.mediaUrl, options?.assetOrigin);
    if (!href) return [];
    if (consumedMediaUrls.has(item.mediaUrl) || consumedMediaUrls.has(href) || href === avatarUrl) return [];
    return [
      {
        title: item.title || "Media",
        href,
        mediaType: item.mediaType || "link",
        alt: item.altText || item.title || "Media",
        customFields: recordCustomFields(
          dto,
          ["media", "workSamples"],
          item.id,
          options?.assetOrigin,
          item as unknown as Record<string, unknown>
        ),
      },
    ];
  });

  // 8. Contact and Social links
  const socialMap: Record<string, AdaptedSocialLink> = {};

  const safeGithub = sanitizeSafeUrl(contact?.github);
  if (safeGithub) {
    socialMap["GitHub"] = {
      name: "GitHub",
      url: safeGithub,
      iconName: "github",
      navbar: true,
    };
  }

  const safeLinkedin = sanitizeSafeUrl(contact?.linkedin);
  if (safeLinkedin) {
    socialMap["LinkedIn"] = {
      name: "LinkedIn",
      url: safeLinkedin,
      iconName: "linkedin",
      navbar: true,
    };
  }

  const safeTwitter = sanitizeSafeUrl(contact?.twitter);
  if (safeTwitter) {
    socialMap["X"] = {
      name: "X",
      url: safeTwitter,
      iconName: "x",
      navbar: true,
    };
  }

  if (contact?.email) {
    socialMap["email"] = {
      name: "Send Email",
      url: `mailto:${contact.email}`,
      iconName: "email",
      navbar: true,
    };
  }

  if (contact?.phone) {
    socialMap["phone"] = {
      name: "Phone",
      url: `tel:${contact.phone}`,
      iconName: "phone",
      navbar: false,
    };
  }

  if (Array.isArray(contact?.socialLinks)) {
    for (const link of contact.socialLinks) {
      const safeUrl = sanitizeSafeUrl(link?.url);
      if (link && safeUrl && link.platform) {
        const plat = link.platform.trim();
        const platLower = plat.toLowerCase();
        let iconName: "github" | "linkedin" | "x" | "email" | "globe" | "phone" | "instagram" = "globe";
        let canonicalName = plat;
        if (platLower.includes("github") || platLower === "git") {
          iconName = "github";
          canonicalName = "GitHub";
        } else if (platLower.includes("linkedin")) {
          iconName = "linkedin";
          canonicalName = "LinkedIn";
        } else if (platLower.includes("twitter") || platLower === "x") {
          iconName = "x";
          canonicalName = "X";
        } else if (platLower.includes("instagram") || platLower === "insta") {
          iconName = "instagram";
          canonicalName = "Instagram";
        } else if (platLower.includes("mail") || platLower.includes("email")) {
          iconName = "email";
          canonicalName = "Email";
        }

        const sourceId = typeof link.id === "string" ? link.id : "";
        const linkedFields = sourceId
          ? recordCustomFields(
              dto,
              ["socialLinks", "channels", "links", "resources"],
              sourceId,
              options?.assetOrigin,
              link as unknown as Record<string, unknown>
            )
          : [];
        const current = socialMap[canonicalName];
        const sameLink = current && current.url.replace(/\/+$/, "") === safeUrl.replace(/\/+$/, "");
        if (!current) {
          socialMap[canonicalName] = {
            name: canonicalName,
            url: safeUrl,
            iconName,
            navbar: link.isPrimary !== undefined ? Boolean(link.isPrimary) : true,
            ...(sourceId ? { sourceId } : {}),
            ...(linkedFields.length ? { customFields: linkedFields } : {}),
          };
        } else if (sameLink && (!current.sourceId || current.sourceId === sourceId)) {
          const existing = current.customFields || [];
          socialMap[canonicalName] = {
            ...current,
            ...(sourceId ? { sourceId } : {}),
            ...(linkedFields.length ? { customFields: [...existing, ...linkedFields] } : {}),
          };
        } else if (sourceId && !socialMap[`link:${sourceId}`]) {
          socialMap[`link:${sourceId}`] = {
            name: canonicalName,
            url: safeUrl,
            iconName,
            navbar: false,
            sourceId,
            ...(linkedFields.length ? { customFields: linkedFields } : {}),
          };
        }
      }
    }
  }

  const aboutFields = recordCustomFields(dto, ["about", "branding"], "", options?.assetOrigin);
  const resumeFields = recordCustomFields(dto, ["resume"], "", options?.assetOrigin);
  const contactFields = [
    ...recordCustomFields(
      dto,
      ["contacts", "contact", "publicContact"],
      "",
      options?.assetOrigin,
      contact as unknown as Record<string, unknown>
    ),
    ...recordCustomFields(dto, ["mediaKit"], "", options?.assetOrigin),
  ];

  const projectSectionVisible = isVisible("projects");
  const achievementSectionVisible = isVisible("achievements") || isVisible("credentials");
  const workVisible =
    adaptedWork.length > 0 && (isVisible("work") || isHistoricalSectionDefault(configuredVisible));
  const customSections = adaptCustomSections(dto, options?.assetOrigin);

  return {
    name,
    initials,
    url: canonicalUrl,
    location: locationFormatted,
    description,
    summary,
    avatarUrl,
    skills: adaptedSkills,
    education: adaptedEducation,
    projects: adaptedProjects,
    services: projectBuckets.services,
    products: projectBuckets.products,
    caseStudies: projectBuckets.caseStudies,
    featured: projectBuckets.featured,
    work: adaptedWork,
    hackathons: adaptedHackathons,
    highlights,
    credentials,
    testimonials,
    team,
    media,
    customSections,
    aboutFields,
    resumeFields,
    contact: {
      email: contact?.email,
      tel: contact?.phone,
      social: socialMap,
      customFields: contactFields,
    },
    resumeUrl: sanitizeSafeUrl(dto.resume?.url),
    templateId: website?.templateId || dto.meta.templateId || MAGICUI_TEMPLATE_ID,
    retainedFields: retainedPublicFields(dto),
    accentColor: HEX_COLOR.test(String(website?.customization?.accentColor || ""))
      ? website?.customization?.accentColor
      : undefined,
    themeMode:
      website?.customization?.themeMode === "light" ||
      website?.customization?.themeMode === "dark" ||
      website?.customization?.themeMode === "system"
        ? website.customization.themeMode
        : "system",
    sectionOrder: normalizeSectionOrder(website?.customization?.sectionOrder),
    visibleSections: {
      hero: true,
      about: isVisible("about") && (Boolean(summary) || aboutFields.length > 0),
      work: workVisible,
      education: isVisible("education") && adaptedEducation.length > 0,
      skills: isVisible("skills") && adaptedSkills.length > 0,
      projects: projectSectionVisible && adaptedProjects.length > 0,
      services: projectSectionVisible && projectBuckets.services.length > 0,
      products: projectSectionVisible && projectBuckets.products.length > 0,
      caseStudies: projectSectionVisible && projectBuckets.caseStudies.length > 0,
      featured: projectSectionVisible && projectBuckets.featured.length > 0,
      hackathons: achievementSectionVisible && adaptedHackathons.length > 0,
      highlights: achievementSectionVisible && highlights.length > 0,
      credentials: achievementSectionVisible && credentials.length > 0,
      testimonials: testimonials.length > 0,
      team: team.length > 0,
      media: media.length > 0,
      contact: isVisible("contact"),
      custom: customSections.length > 0,
    },
  };
}

const FEATURED_PROJECT_TYPES = new Set([
  "featured",
  "video",
  "article",
  "podcast",
  "newsletter",
  "short-form",
  "livestream",
]);

function projectGroup(
  projectType: string | undefined
): "projects" | "services" | "products" | "caseStudies" | "featured" {
  const normalized = String(projectType || "").toLowerCase().replace(/_/g, "-");
  if (normalized === "product") return "products";
  if (normalized === "service") return "services";
  if (normalized === "case-study") return "caseStudies";
  if (FEATURED_PROJECT_TYPES.has(normalized)) return "featured";
  return "projects";
}

function isHistoricalSectionDefault(sections: string[]): boolean {
  const historical = ["about", "education", "projects", "skills", "achievements", "contact"];
  return sections.length === historical.length && historical.every((name) => sections.includes(name));
}

function deriveInitials(name: string): string {
  if (!name) return "OV";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OV";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
