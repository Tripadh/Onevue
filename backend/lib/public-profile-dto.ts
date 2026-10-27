import * as crypto from "crypto";
import { isLegacyProfilePhotoKey, isPrefixedProfilePhotoKey } from "./storage/keys";
import { previewAssetPath, publicAssetPath } from "./storage/asset-refs";
import { isCustomIdentity } from "./custom-fields/builtins";
import { projectCustomLayout, sanitizePublicCustomSections } from "./custom-fields/publish";
import { normalizeCustomLayout } from "./custom-fields/validate";
import type { CustomIdentity, PublicCustomSection } from "./custom-fields/types";

/* =========================================================================
   OneVue Public Profile Contract — Schema Version 1.0.0
   ========================================================================= */

export const PUBLIC_PROFILE_SCHEMA_VERSION = "1.0.0" as const;

export interface IPublicLocation {
  city?: string;
  state?: string;
  country?: string;
  formatted?: string;
}

export interface IPublicLanguage {
  language: string;
  proficiency: "basic" | "conversational" | "fluent" | "native";
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
  currentStatus: "studying" | "completed" | "paused" | "withdrawn";
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
  /** Safe http(s) URL or an authorized asset delivery path. Storage keys are never accepted. */
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

/** Employment or other work history. Optional so schema 1.0.0 snapshots published before this field still validate. */
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

/** A quoted recommendation. Optional on older 1.0.0 snapshots. */
export interface IPublicTestimonial {
  id: string;
  quote: string;
  authorName: string;
  relationship?: string;
  /** "verified" or "self-reported". Never treated as an independent check by itself. */
  attribution?: string;
}

/** A public team member. Private members are removed before this list is built. */
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
  schemaVersion: typeof PUBLIC_PROFILE_SCHEMA_VERSION;
  username?: string;
  canonicalUrl?: string;
  publishedAt?: string;
  templateId?: string;
  templateVersion?: string;
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
  /** Omitted on snapshots published before identity-specific sections were first-class. */
  experience?: IPublicExperience[];
  testimonials?: IPublicTestimonial[];
  team?: IPublicTeamMember[];
  resume?: IPublicResume;
  media: IPublicMediaItem[];
  contact: IPublicContact;
  /** Public custom fields copied into the revision. Omitted when the profile has none. */
  customSections?: PublicCustomSection[];
}

/* =========================================================================
   Security & Validation Helpers
   ========================================================================= */

/**
 * Validates that an external URL has an allowed safe protocol (http or https).
 * Rejects javascript:, data:, file:, and malformed URIs.
 */
export function sanitizeUrl(val: unknown): string | undefined {
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

/** HTTP(S) links plus stable published asset paths and short-lived owner preview paths. */
export function sanitizeDeliveryUrl(val: unknown): string | undefined {
  const external = sanitizeUrl(val);
  if (external) return external;
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (/^\/api\/assets\/public\/ast_[a-f0-9]{24}$/.test(trimmed)) return trimmed;
  if (/^\/api\/assets\/private\/ast_[a-f0-9]{24}\?exp=\d{1,12}&sig=[a-f0-9]{64}$/.test(trimmed)) {
    return trimmed;
  }
  if (accountProfilePhotoPath(photoKeyFromDeliveryPath(trimmed))) return trimmed;
  return undefined;
}

/** Public path for an uploaded account photo. Rejects any other storage key. */
export function accountProfilePhotoPath(key: unknown): string | undefined {
  if (typeof key !== "string") return undefined;
  const trimmed = key.trim();
  if (!trimmed || trimmed.length > 180) return undefined;
  if (!isLegacyProfilePhotoKey(trimmed) && !isPrefixedProfilePhotoKey(trimmed)) return undefined;
  return `/api/profile/photo/${encodeURIComponent(trimmed)}`;
}

function photoKeyFromDeliveryPath(path: string): string | undefined {
  const prefix = "/api/profile/photo/";
  if (!path.startsWith(prefix)) return undefined;
  try {
    return decodeURIComponent(path.slice(prefix.length));
  } catch {
    return undefined;
  }
}

/**
 * The uploaded account photo is the public avatar. An explicit profile URL is
 * used only when the account has no uploaded photo. Relative delivery paths
 * are expanded against the API origin so a portfolio on another port can load them.
 */
export function resolvePublicProfilePhoto(
  snapshotPhoto: unknown,
  accountKey: unknown,
  origin?: string
): string | undefined {
  const accountPath = accountProfilePhotoPath(accountKey);
  const chosen = accountPath || sanitizeDeliveryUrl(snapshotPhoto);
  if (!chosen) return undefined;
  if (chosen.startsWith("/")) {
    const base = typeof origin === "string" ? origin.trim().replace(/\/+$/, "") : "";
    if (!base) return chosen;
    return `${base}${chosen}`;
  }
  return chosen;
}

/**
 * Safe string trimmer with length capping.
 */
function sanitizeString(val: unknown, maxLen = 1000): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

/**
 * Derives uppercase 1-2 letter initials from a display name.
 */
function deriveInitials(name: string): string {
  if (!name || typeof name !== "string") return "OV";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OV";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Computes a deterministic SHA-256 checksum of the public DTO.
 */
export function computeSnapshotChecksum(dto: PublicProfileDTO_v1): string {
  const json = JSON.stringify(dto, Object.keys(dto).sort());
  const c: any = crypto;
  const hasher =
    (c && typeof c.createHash === "function" && c.createHash) ||
    (c && c.default && typeof c.default.createHash === "function" && c.default.createHash) ||
    (typeof require === "function" && require("crypto").createHash);
  return hasher("sha256").update(json).digest("hex");
}

/* =========================================================================
   DTO Transformation Options
   ========================================================================= */

export interface ToPublicProfileDTOOptions {
  username?: string;
  canonicalUrl?: string;
  publishedAt?: Date | string;
  templateId?: string;
  templateVersion?: string;
  user?: {
    name?: string;
    profilePhotoKey?: string | null;
  };
  /** Identity that owns the draft. Required when strict custom-field checks run. */
  identity?: string;
  ownerId?: string;
  assetDelivery?: "publish" | "preview";
  recordIds?: Record<string, string[]>;
  /** Reject incomplete required custom fields instead of omitting them. */
  strictCustomFields?: boolean;
}

/* =========================================================================
   Pure Server-Side Mapper (Strict Whitelist Security Boundary)
   ========================================================================= */

/**
 * Transforms a canonical StudentProfile document into an immutable,
 * sanitized PublicProfileDTO_v1.
 *
 * Security guarantee:
 * - Employs an explicit allowlist (never serializes the source and deletes keys).
 * - Original source profile is never mutated.
 * - dob, gender, rollNumber, internal storage keys, passwords, private media,
 *   and private contact details are physically impossible to output.
 */
export function toPublicProfileDTO(
  studentProfile: any,
  options: ToPublicProfileDTOOptions = {}
): PublicProfileDTO_v1 {
  // Extract POJO without mutating input
  const raw =
    studentProfile && typeof studentProfile.toObject === "function"
      ? studentProfile.toObject()
      : studentProfile || {};

  // 1. Meta Construction
  const meta: IPublicProfileMetadata = {
    schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
  };
  if (options.username && typeof options.username === "string") {
    meta.username = options.username.trim().toLowerCase();
  }
  if (options.canonicalUrl && typeof options.canonicalUrl === "string") {
    const safeCanonical = sanitizeUrl(options.canonicalUrl);
    if (safeCanonical) meta.canonicalUrl = safeCanonical;
  }
  if (options.publishedAt) {
    meta.publishedAt =
      options.publishedAt instanceof Date
        ? options.publishedAt.toISOString()
        : new Date(options.publishedAt).toISOString();
  }
  if (options.templateId && typeof options.templateId === "string") {
    meta.templateId = options.templateId.trim();
  }
  if (options.templateVersion && typeof options.templateVersion === "string") {
    meta.templateVersion = options.templateVersion.trim();
  }

  // 2. Personal Profile Construction
  const preferredName = sanitizeString(raw.preferredName, 100);
  const userName = options.user ? sanitizeString(options.user.name, 100) : undefined;
  const displayName = preferredName || userName || meta.username || "Student";
  const initials = deriveInitials(displayName);

  const locCity = sanitizeString(raw.city, 100);
  const locState = sanitizeString(raw.state, 100);
  const locCountry = sanitizeString(raw.country, 100);
  const formattedLocation = [locCity, locState, locCountry].filter(Boolean).join(", ");

  const location: IPublicLocation = {
    city: locCity,
    state: locState,
    country: locCountry,
    formatted: formattedLocation || undefined,
  };

  const languages: IPublicLanguage[] = Array.isArray(raw.languages)
    ? raw.languages
        .filter((l: any) => l && typeof l.language === "string" && l.language.trim())
        .map((l: any) => ({
          language: sanitizeString(l.language, 80) || "",
          proficiency: ["basic", "conversational", "fluent", "native"].includes(l.proficiency)
            ? l.proficiency
            : "conversational",
        }))
    : [];

  const careerInterests = Array.isArray(raw.careerInterests)
    ? raw.careerInterests
        .map((c: any) => sanitizeString(c, 100))
        .filter((c: any): c is string => Boolean(c))
    : [];

  const areasOfInterest = Array.isArray(raw.areasOfInterest)
    ? raw.areasOfInterest
        .map((a: any) => sanitizeString(a, 100))
        .filter((a: any): a is string => Boolean(a))
    : [];

  // 3. Education Construction (rollNumber omitted by security allowlist)
  const education: IPublicEducation[] = Array.isArray(raw.education)
    ? raw.education
        .filter((e: any) => e && e.institution && e.degree)
        .map((e: any, idx: number) => ({
          id: String(e.id || e._id || `edu_${idx}`),
          institution: sanitizeString(e.institution, 150) || "",
          degree: sanitizeString(e.degree, 150) || "",
          fieldOfStudy: sanitizeString(e.fieldOfStudy, 150),
          specialization: sanitizeString(e.specialization, 150),
          department: sanitizeString(e.department, 150),
          startDate: sanitizeString(e.startDate, 50),
          endDate: sanitizeString(e.endDate, 50),
          expectedGradDate: sanitizeString(e.expectedGradDate, 50),
          currentStatus: ["studying", "completed", "paused", "withdrawn"].includes(e.currentStatus)
            ? e.currentStatus
            : "studying",
          gpa: sanitizeString(e.gpa, 50),
          gpaScale: sanitizeString(e.gpaScale, 20),
          percentage: sanitizeString(e.percentage, 20),
          gradeClass: sanitizeString(e.gradeClass, 50),
          rank: sanitizeString(e.rank, 50),
          location: sanitizeString(e.location, 150),
          website: sanitizeUrl(e.website),
          coursework: sanitizeString(e.coursework, 1000),
          honors: sanitizeString(e.honors, 500),
        }))
    : [];

  // 4. Projects Construction (aiDetails omitted by security allowlist)
  const projects: IPublicProject[] = Array.isArray(raw.projects)
    ? raw.projects
        .filter((p: any) => p && p.title)
        .map((p: any, idx: number) => {
          const id = String(p.id || p._id || `proj_${idx}`);
          const imageUrl =
            sanitizeDeliveryUrl(p.imageUrl) || relatedProjectImage(raw.media, id);
          const project: IPublicProject = {
            id,
            title: sanitizeString(p.title, 200) || "",
            shortDescription: sanitizeString(p.shortDescription, 500),
            detailedDescription: sanitizeString(p.detailedDescription, 5000),
            projectType: sanitizeString(p.projectType, 50),
            role: sanitizeString(p.role, 100),
            status: sanitizeString(p.status, 50),
            isTeam: typeof p.isTeam === "boolean" ? p.isTeam : undefined,
            teamSize: typeof p.teamSize === "number" && p.teamSize > 0 ? p.teamSize : undefined,
            startDate: sanitizeString(p.startDate, 50),
            endDate: sanitizeString(p.endDate, 50),
            technologies: Array.isArray(p.technologies)
              ? p.technologies
                  .map((t: any) => sanitizeString(t, 100))
                  .filter((t: any): t is string => Boolean(t))
              : [],
            techStack: sanitizeString(p.techStack, 500),
            repoUrl: sanitizeUrl(p.repoUrl),
            liveUrl: sanitizeUrl(p.liveUrl),
            docsUrl: sanitizeUrl(p.docsUrl),
            videoUrl: sanitizeUrl(p.videoUrl),
            websiteUrl: sanitizeUrl(p.websiteUrl),
            problemSolved: sanitizeString(p.problemSolved, 2000),
            keyFeatures: sanitizeString(p.keyFeatures, 2000),
            challengesSolutions: sanitizeString(p.challengesSolutions, 2000),
            metricsResults: sanitizeString(p.metricsResults, 2000),
            impact: sanitizeString(p.impact, 2000),
          };
          if (imageUrl) project.imageUrl = imageUrl;
          return project;
        })
    : [];

  // 5. Skills Construction
  const skills: IPublicSkill[] = Array.isArray(raw.skills)
    ? raw.skills
        .filter((s: any) => s && s.name)
        .map((s: any, idx: number) => ({
          id: String(s.id || s._id || `skill_${idx}`),
          name: sanitizeString(s.name, 100) || "",
          category: sanitizeString(s.category, 100) || "Other Skills",
          proficiency: sanitizeString(s.proficiency, 50) || "Intermediate",
          yearsExperience:
            typeof s.yearsExperience === "number" && s.yearsExperience >= 0
              ? s.yearsExperience
              : undefined,
          level: sanitizeString(s.level, 50),
        }))
    : [];

  // 6. Credentials Construction (internal storage keys omitted)
  const credentials: IPublicCredential[] = Array.isArray(raw.credentials)
    ? raw.credentials
        .filter((c: any) => c && c.title)
        .map((c: any, idx: number) => ({
          id: String(c.id || c._id || `cred_${idx}`),
          title: sanitizeString(c.title, 200) || "",
          credentialType: sanitizeString(c.credentialType, 100) || "certification",
          issuer: sanitizeString(c.issuer, 150) || "",
          issueDate: sanitizeString(c.issueDate, 50),
          expirationDate: sanitizeString(c.expirationDate, 50),
          neverExpires: typeof c.neverExpires === "boolean" ? c.neverExpires : undefined,
          credentialUrl: sanitizeUrl(c.credentialUrl),
          verificationUrl: sanitizeUrl(c.verificationUrl),
          verificationStatus: sanitizeString(c.verificationStatus, 50),
          description: sanitizeString(c.description, 2000),
          relatedSkills: Array.isArray(c.relatedSkills)
            ? c.relatedSkills
                .map((sk: any) => sanitizeString(sk, 100))
                .filter((sk: any): sk is string => Boolean(sk))
            : undefined,
        }))
    : [];

  // 6b. Identity-specific sections. Empty lists are omitted so older student snapshots stay stable.
  const experience = mapExperience(raw.experience);
  const testimonials = mapTestimonials(raw.testimonials);
  const team = mapTeam(raw.team);

  // 7. Achievements Construction (evidenceStorageKey omitted by allowlist)
  const achievements: IPublicAchievement[] = Array.isArray(raw.achievements)
    ? raw.achievements
        .filter((a: any) => a && a.title)
        .map((a: any, idx: number) => ({
          id: String(a.id || a._id || `ach_${idx}`),
          title: sanitizeString(a.title, 200) || "",
          category: sanitizeString(a.category, 100) || "award",
          organization: sanitizeString(a.organization, 150),
          date: sanitizeString(a.date, 50),
          year: sanitizeString(a.year, 20),
          description: sanitizeString(a.description, 2000),
          positionRank: sanitizeString(a.positionRank, 100),
          awardPrize: sanitizeString(a.awardPrize, 150),
          teamSize: typeof a.teamSize === "number" && a.teamSize > 0 ? a.teamSize : undefined,
          role: sanitizeString(a.role, 100),
          location: sanitizeString(a.location, 150),
          proofUrl: sanitizeUrl(a.proofUrl),
          certificateUrl: sanitizeUrl(a.certificateUrl),
        }))
    : [];

  // 8. Resume Construction (storageKey omitted by allowlist)
  let resume: IPublicResume | undefined = undefined;
  const safeResumeUrl = sanitizeUrl(raw.resumeUrl);
  if (safeResumeUrl) {
    resume = {
      url: safeResumeUrl,
      fileName: sanitizeString(raw.resumeFileName || (raw.resume && raw.resume.fileName), 255),
      uploadedAt: raw.resumeLastUpdated
        ? new Date(raw.resumeLastUpdated).toISOString()
        : raw.resume && raw.resume.uploadedAt
        ? new Date(raw.resume.uploadedAt).toISOString()
        : undefined,
      targetRole: raw.resume ? sanitizeString(raw.resume.targetRole, 100) : undefined,
    };
  }

  // 9. Media Construction (private media strictly filtered out)
  const media: IPublicMediaItem[] = Array.isArray(raw.media)
    ? raw.media
        .filter((m: any) => m && m.mediaUrl && m.visibility !== "private")
        .map((m: any, idx: number) => {
          const safeUrl = sanitizeDeliveryUrl(m.mediaUrl);
          if (!safeUrl) return null;
          return {
            id: String(m.id || m._id || `media_${idx}`),
            mediaUrl: safeUrl,
            mediaType: sanitizeString(m.mediaType, 50) || "image",
            title: sanitizeString(m.title, 150) || "Portfolio Media",
            description: sanitizeString(m.description, 1000),
            category: sanitizeString(m.category, 100) || "project",
            isFeatured: typeof m.isFeatured === "boolean" ? m.isFeatured : undefined,
            altText: sanitizeString(m.altText, 200),
          };
        })
        .filter((m: any): m is IPublicMediaItem => m !== null)
    : [];

  // 10. Contacts & Visibility Enforcement
  const contactsObj = raw.contacts || {};
  const emailVis = contactsObj.visibility && contactsObj.visibility.email;
  const phoneVis = contactsObj.visibility && contactsObj.visibility.phone;

  // Email and phone appear ONLY if visibility is explicitly "public"
  const publicEmail = emailVis === "public" ? sanitizeString(contactsObj.email, 150) : undefined;
  const publicPhone = phoneVis === "public" ? sanitizeString(contactsObj.phone, 50) : undefined;
  const publicCountryCode =
    publicPhone && contactsObj.countryCode ? sanitizeString(contactsObj.countryCode, 10) : undefined;

  // Social Links (filter visibility !== 'private')
  const socialLinks: IPublicSocialLink[] = Array.isArray(raw.links)
    ? raw.links
        .filter((l: any) => l && l.url && l.visibility !== "private")
        .map((l: any, idx: number) => {
          const safeUrl = sanitizeUrl(l.url);
          if (!safeUrl) return null;
          return {
            id: String(l.id || l._id || `link_${idx}`),
            platform: sanitizeString(l.platform, 100) || "link",
            url: safeUrl,
            category: sanitizeString(l.category, 50) || "social",
            username: sanitizeString(l.username, 100),
            isPrimary: typeof l.isPrimary === "boolean" ? l.isPrimary : undefined,
          };
        })
        .filter((l: any): l is IPublicSocialLink => l !== null)
    : [];

  const contact: IPublicContact = {
    email: publicEmail,
    phone: publicPhone,
    countryCode: publicCountryCode,
    city: locCity,
    state: locState,
    country: locCountry,
    github: sanitizeUrl(contactsObj.github),
    linkedin: sanitizeUrl(contactsObj.linkedin),
    twitter: sanitizeUrl(contactsObj.twitter),
    portfolio: sanitizeUrl(contactsObj.portfolio),
    socialLinks,
  };

  const customSections = publicCustomSections(raw.customLayout, options);

  return {
    meta,
    profile: {
      displayName,
      preferredName,
      initials,
      headline: sanitizeString(raw.headline, 200),
      bio: sanitizeString(raw.bio, 5000),
      profilePhoto:
        accountProfilePhotoPath(options.user?.profilePhotoKey) ||
        sanitizeDeliveryUrl(raw.profilePhoto),
      location,
      nationality: sanitizeString(raw.nationality, 80),
      currentStatus: sanitizeString(raw.currentStatus, 100),
      careerInterests,
      areasOfInterest,
      languages,
    },
    education,
    projects,
    skills,
    credentials,
    achievements,
    ...(experience.length ? { experience } : {}),
    ...(testimonials.length ? { testimonials } : {}),
    ...(team.length ? { team } : {}),
    resume,
    media,
    contact,
    ...(customSections.length ? { customSections } : {}),
  };
}

function publicCustomSections(layout: unknown, options: ToPublicProfileDTOOptions): PublicCustomSection[] {
  let source = layout;
  const identity = typeof options.identity === "string" ? options.identity : "";
  if (options.strictCustomFields && layout && isCustomIdentity(identity)) {
    source = normalizeCustomLayout(layout, {
      identity: identity as CustomIdentity,
      existing: layout,
      recordIds: options.recordIds,
      enforceRequired: true,
    });
  }
  return projectCustomLayout(source, {
    templateId: options.templateId || "magicui-portfolio",
    strict: options.strictCustomFields === true,
    assetHref: (assetId) => {
      try {
        if (options.assetDelivery === "preview" && options.ownerId) {
          return previewAssetPath(assetId, options.ownerId);
        }
        return publicAssetPath(assetId);
      } catch {
        return "";
      }
    },
  });
}

function relatedProjectImage(media: unknown, projectId: string): string | undefined {
  if (!Array.isArray(media) || !projectId) return undefined;
  for (const item of media) {
    if (!item || typeof item !== "object") continue;
    const row = item as { relatedProject?: unknown; visibility?: unknown; mediaUrl?: unknown };
    if (row.visibility === "private") continue;
    if (String(row.relatedProject || "") !== projectId) continue;
    const safeUrl = sanitizeDeliveryUrl(row.mediaUrl);
    if (safeUrl) return safeUrl;
  }
  return undefined;
}

function mapExperience(value: unknown): IPublicExperience[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && (item.title || item.organization || item.company || item.jobTitle))
    .slice(0, 40)
    .map((item: any, idx: number) => ({
      id: String(item.id || item._id || `exp_${idx}`),
      title: sanitizeString(item.title || item.jobTitle, 200) || "",
      organization: sanitizeString(item.organization || item.company, 200) || "",
      employmentType: sanitizeString(item.employmentType, 50),
      location: sanitizeString(item.location, 150),
      startDate: sanitizeString(item.startDate, 50),
      endDate: sanitizeString(item.endDate, 50),
      isCurrent: typeof item.isCurrent === "boolean" ? item.isCurrent : undefined,
      description: sanitizeString(item.description, 4000),
    }))
    .filter((item) => item.title || item.organization);
}

function mapTestimonials(value: unknown): IPublicTestimonial[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && item.quote && item.authorName)
    .slice(0, 40)
    .map((item: any, idx: number) => ({
      id: String(item.id || item._id || `testimonial_${idx}`),
      quote: sanitizeString(item.quote, 1000) || "",
      authorName: sanitizeString(item.authorName, 150) || "",
      relationship: sanitizeString(item.relationship, 150),
      attribution: sanitizeString(item.attribution, 40),
    }))
    .filter((item) => item.quote && item.authorName);
}

function mapTeam(value: unknown): IPublicTeamMember[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && item.name)
    .slice(0, 50)
    .map((item: any, idx: number) => ({
      id: String(item.id || item._id || `team_${idx}`),
      name: sanitizeString(item.name, 150) || "",
      role: sanitizeString(item.role, 150),
    }))
    .filter((item) => item.name);
}

/**
 * Copies a stored 1.0.0 snapshot onto the public allowlist.
 * Unknown keys, storage keys, and unsafe URLs are dropped.
 * Snapshots published before the optional identity sections simply omit those keys.
 * Returns null when the payload is not a readable 1.0.0 profile.
 */
export function allowlistPublicSnapshot(snapshot: unknown): PublicProfileDTO_v1 | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const raw = snapshot as Record<string, any>;
  if (raw.meta?.schemaVersion !== PUBLIC_PROFILE_SCHEMA_VERSION) return null;
  if (typeof raw.profile?.displayName !== "string" || !raw.profile.displayName.trim()) return null;

  const profile = raw.profile;
  const location = profile.location && typeof profile.location === "object" ? profile.location : {};
  const photo = sanitizeDeliveryUrl(profile.profilePhoto);

  const dto: PublicProfileDTO_v1 = {
    meta: compact({
      schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
      username: sanitizeString(raw.meta.username, 80),
      canonicalUrl: sanitizeUrl(raw.meta.canonicalUrl),
      publishedAt: sanitizeString(raw.meta.publishedAt, 40),
      templateId: sanitizeString(raw.meta.templateId, 80),
      templateVersion: sanitizeString(raw.meta.templateVersion, 40),
    }) as IPublicProfileMetadata,
    profile: compact({
      displayName: sanitizeString(profile.displayName, 150) || "Student",
      preferredName: sanitizeString(profile.preferredName, 100),
      initials: sanitizeString(profile.initials, 8) || deriveInitials(profile.displayName),
      headline: sanitizeString(profile.headline, 200),
      bio: sanitizeString(profile.bio, 5000),
      profilePhoto: photo,
      location: compact({
        city: sanitizeString(location.city, 100),
        state: sanitizeString(location.state, 100),
        country: sanitizeString(location.country, 100),
        formatted: sanitizeString(location.formatted, 300),
      }),
      nationality: sanitizeString(profile.nationality, 80),
      currentStatus: sanitizeString(profile.currentStatus, 100),
      careerInterests: stringList(profile.careerInterests, 100),
      areasOfInterest: stringList(profile.areasOfInterest, 100),
      languages: Array.isArray(profile.languages)
        ? profile.languages
            .filter((item: any) => item && item.language)
            .map((item: any) => ({
              language: sanitizeString(item.language, 80) || "",
              proficiency: sanitizeString(item.proficiency, 40) || "conversational",
            }))
        : [],
    }) as PublicProfileDTO_v1["profile"],
    education: mapStoredEducation(raw.education),
    projects: mapStoredProjects(raw.projects),
    skills: mapStoredSkills(raw.skills),
    credentials: mapStoredCredentials(raw.credentials),
    achievements: mapStoredAchievements(raw.achievements),
    media: mapStoredMedia(raw.media),
    contact: mapStoredContact(raw.contact),
  };

  const experience = mapExperience(raw.experience);
  const testimonials = mapTestimonials(raw.testimonials);
  const team = mapTeam(raw.team);
  if (experience.length) dto.experience = experience;
  if (testimonials.length) dto.testimonials = testimonials;
  if (team.length) dto.team = team;

  const resumeUrl = sanitizeUrl(raw.resume?.url);
  if (resumeUrl) {
    dto.resume = compact({
      url: resumeUrl,
      fileName: sanitizeString(raw.resume.fileName, 255),
      uploadedAt: sanitizeString(raw.resume.uploadedAt, 40),
      targetRole: sanitizeString(raw.resume.targetRole, 100),
    }) as IPublicResume;
  }

  const customSections = sanitizePublicCustomSections(raw.customSections, (href) => sanitizeDeliveryUrl(href));
  if (customSections.length) dto.customSections = customSections;

  return dto;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const copy = {} as T;
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) copy[key] = value[key];
  }
  return copy;
}

function stringList(value: unknown, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeString(item, maxLen))
    .filter((item): item is string => Boolean(item));
}

function mapStoredEducation(value: unknown): IPublicEducation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && item.institution && item.degree)
    .map((item: any, idx: number) =>
      compact({
        id: String(item.id || `edu_${idx}`),
        institution: sanitizeString(item.institution, 150) || "",
        degree: sanitizeString(item.degree, 150) || "",
        fieldOfStudy: sanitizeString(item.fieldOfStudy, 150),
        specialization: sanitizeString(item.specialization, 150),
        department: sanitizeString(item.department, 150),
        startDate: sanitizeString(item.startDate, 50),
        endDate: sanitizeString(item.endDate, 50),
        expectedGradDate: sanitizeString(item.expectedGradDate, 50),
        currentStatus: sanitizeString(item.currentStatus, 40) || "studying",
        gpa: sanitizeString(item.gpa, 50),
        gpaScale: sanitizeString(item.gpaScale, 20),
        percentage: sanitizeString(item.percentage, 20),
        gradeClass: sanitizeString(item.gradeClass, 50),
        rank: sanitizeString(item.rank, 50),
        location: sanitizeString(item.location, 150),
        website: sanitizeUrl(item.website),
        coursework: sanitizeString(item.coursework, 1000),
        honors: sanitizeString(item.honors, 500),
      })
    ) as IPublicEducation[];
}

function mapStoredProjects(value: unknown): IPublicProject[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && item.title)
    .map((item: any, idx: number) => {
      const project = compact({
        id: String(item.id || `proj_${idx}`),
        title: sanitizeString(item.title, 200) || "",
        shortDescription: sanitizeString(item.shortDescription, 500),
        detailedDescription: sanitizeString(item.detailedDescription, 5000),
        projectType: sanitizeString(item.projectType, 50),
        role: sanitizeString(item.role, 100),
        status: sanitizeString(item.status, 50),
        isTeam: typeof item.isTeam === "boolean" ? item.isTeam : undefined,
        teamSize: typeof item.teamSize === "number" && item.teamSize > 0 ? item.teamSize : undefined,
        startDate: sanitizeString(item.startDate, 50),
        endDate: sanitizeString(item.endDate, 50),
        technologies: stringList(item.technologies, 100),
        techStack: sanitizeString(item.techStack, 500),
        repoUrl: sanitizeUrl(item.repoUrl),
        liveUrl: sanitizeUrl(item.liveUrl),
        docsUrl: sanitizeUrl(item.docsUrl),
        videoUrl: sanitizeUrl(item.videoUrl),
        websiteUrl: sanitizeUrl(item.websiteUrl),
        problemSolved: sanitizeString(item.problemSolved, 2000),
        keyFeatures: sanitizeString(item.keyFeatures, 2000),
        challengesSolutions: sanitizeString(item.challengesSolutions, 2000),
        metricsResults: sanitizeString(item.metricsResults, 2000),
        impact: sanitizeString(item.impact, 2000),
        imageUrl: sanitizeDeliveryUrl(item.imageUrl),
      }) as IPublicProject;
      return project;
    });
}

function mapStoredSkills(value: unknown): IPublicSkill[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && item.name)
    .map((item: any, idx: number) =>
      compact({
        id: String(item.id || `skill_${idx}`),
        name: sanitizeString(item.name, 100) || "",
        category: sanitizeString(item.category, 100) || "Other Skills",
        proficiency: sanitizeString(item.proficiency, 50) || "Intermediate",
        yearsExperience:
          typeof item.yearsExperience === "number" && item.yearsExperience >= 0
            ? item.yearsExperience
            : undefined,
        level: sanitizeString(item.level, 50),
      })
    );
}

function mapStoredCredentials(value: unknown): IPublicCredential[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && item.title)
    .map((item: any, idx: number) =>
      compact({
        id: String(item.id || `cred_${idx}`),
        title: sanitizeString(item.title, 200) || "",
        credentialType: sanitizeString(item.credentialType, 100) || "certification",
        issuer: sanitizeString(item.issuer, 150) || "",
        issueDate: sanitizeString(item.issueDate, 50),
        expirationDate: sanitizeString(item.expirationDate, 50),
        neverExpires: typeof item.neverExpires === "boolean" ? item.neverExpires : undefined,
        credentialUrl: sanitizeUrl(item.credentialUrl),
        verificationUrl: sanitizeUrl(item.verificationUrl),
        verificationStatus: sanitizeString(item.verificationStatus, 50),
        description: sanitizeString(item.description, 2000),
        relatedSkills: Array.isArray(item.relatedSkills) ? stringList(item.relatedSkills, 100) : undefined,
      })
    );
}

function mapStoredAchievements(value: unknown): IPublicAchievement[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => item && item.title)
    .map((item: any, idx: number) =>
      compact({
        id: String(item.id || `ach_${idx}`),
        title: sanitizeString(item.title, 200) || "",
        category: sanitizeString(item.category, 100) || "award",
        organization: sanitizeString(item.organization, 150),
        date: sanitizeString(item.date, 50),
        year: sanitizeString(item.year, 20),
        description: sanitizeString(item.description, 2000),
        positionRank: sanitizeString(item.positionRank, 100),
        awardPrize: sanitizeString(item.awardPrize, 150),
        teamSize: typeof item.teamSize === "number" && item.teamSize > 0 ? item.teamSize : undefined,
        role: sanitizeString(item.role, 100),
        location: sanitizeString(item.location, 150),
        proofUrl: sanitizeUrl(item.proofUrl),
        certificateUrl: sanitizeUrl(item.certificateUrl),
      })
    );
}

function mapStoredMedia(value: unknown): IPublicMediaItem[] {
  if (!Array.isArray(value)) return [];
  const media: IPublicMediaItem[] = [];
  value.forEach((item: any, idx: number) => {
    if (!item || !item.mediaUrl) return;
    const mediaUrl = sanitizeDeliveryUrl(item.mediaUrl);
    if (!mediaUrl) return;
    media.push(
      compact({
        id: String(item.id || `media_${idx}`),
        mediaUrl,
        mediaType: sanitizeString(item.mediaType, 50) || "image",
        title: sanitizeString(item.title, 150) || "Portfolio Media",
        description: sanitizeString(item.description, 1000),
        category: sanitizeString(item.category, 100) || "project",
        isFeatured: typeof item.isFeatured === "boolean" ? item.isFeatured : undefined,
        altText: sanitizeString(item.altText, 200),
      }) as IPublicMediaItem
    );
  });
  return media;
}

function mapStoredContact(value: unknown): IPublicContact {
  const contact = value && typeof value === "object" ? (value as Record<string, any>) : {};
  return compact({
    email: sanitizeString(contact.email, 150),
    phone: sanitizeString(contact.phone, 50),
    countryCode: sanitizeString(contact.countryCode, 10),
    city: sanitizeString(contact.city, 100),
    state: sanitizeString(contact.state, 100),
    country: sanitizeString(contact.country, 100),
    github: sanitizeUrl(contact.github),
    linkedin: sanitizeUrl(contact.linkedin),
    twitter: sanitizeUrl(contact.twitter),
    portfolio: sanitizeUrl(contact.portfolio),
    socialLinks: Array.isArray(contact.socialLinks)
      ? contact.socialLinks
          .filter((item: any) => item && item.url)
          .map((item: any, idx: number) => {
            const url = sanitizeUrl(item.url);
            if (!url) return null;
            return compact({
              id: String(item.id || `link_${idx}`),
              platform: sanitizeString(item.platform, 100) || "link",
              url,
              category: sanitizeString(item.category, 50) || "social",
              username: sanitizeString(item.username, 100),
              isPrimary: typeof item.isPrimary === "boolean" ? item.isPrimary : undefined,
            });
          })
          .filter((item: IPublicSocialLink | null): item is IPublicSocialLink => item !== null)
      : [],
  }) as IPublicContact;
}
