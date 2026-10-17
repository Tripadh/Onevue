import * as crypto from "crypto";

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
  resume?: IPublicResume;
  media: IPublicMediaItem[];
  contact: IPublicContact;
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
  };
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
        .map((p: any, idx: number) => ({
          id: String(p.id || p._id || `proj_${idx}`),
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
        }))
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
          const safeUrl = sanitizeUrl(m.mediaUrl);
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

  return {
    meta,
    profile: {
      displayName,
      preferredName,
      initials,
      headline: sanitizeString(raw.headline, 200),
      bio: sanitizeString(raw.bio, 5000),
      profilePhoto: sanitizeUrl(raw.profilePhoto),
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
    resume,
    media,
    contact,
  };
}
