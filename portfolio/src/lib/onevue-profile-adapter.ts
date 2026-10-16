/**
 * OneVue Public Profile DTO Contract v1 (Client/Template definitions)
 * Exactly mirrors the published contract from OneVue Phase 3 API:
 * GET /api/public/profile/:username
 */

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
  schemaVersion: typeof SUPPORTED_DTO_SCHEMA_VERSION;
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

export interface WebsiteCustomization {
  accentColor?: string;
  themeMode?: "light" | "dark" | "system";
  visibleSections?: string[];
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
}

/**
 * Transformed structure consumed directly by Magic UI portfolio components
 */
export interface AdaptedEducation {
  school: string;
  href: string;
  degree: string;
  logoUrl?: string;
  start: string;
  end: string;
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
}

export interface AdaptedSkill {
  name: string;
  category?: string;
  proficiency?: string;
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
}

export interface AdaptedSocialLink {
  name: string;
  url: string;
  iconName: "github" | "linkedin" | "x" | "email" | "globe" | "phone" | "instagram";
  navbar: boolean;
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
  work: AdaptedWorkItem[];
  hackathons: AdaptedHackathon[];
  contact: {
    email?: string;
    tel?: string;
    social: Record<string, AdaptedSocialLink>;
  };
  visibleSections: {
    hero: boolean;
    about: boolean;
    work: boolean;
    education: boolean;
    skills: boolean;
    projects: boolean;
    hackathons: boolean;
    contact: boolean;
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
export function adaptOneVueProfile(
  dto: PublicProfileDTO_v1,
  website?: WebsiteMetadata
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
  const avatarUrl = sanitizeSafeUrl(profile.profilePhoto);
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
            school: e.institution,
            href: sanitizeSafeUrl(e.website) || "#",
            degree: degreeText,
            start: start || "Enrolled",
            end: end || "Present",
          };
        })
    : [];

  // 4. Projects mapping
  const adaptedProjects: AdaptedProject[] = Array.isArray(projects)
    ? projects
        .filter((p) => Boolean(p && p.title))
        .map((p) => {
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

          if (safeRepoUrl) {
            links.push({ type: "Source", href: safeRepoUrl, iconName: "github" });
          }

          if (safeVideoUrl) {
            links.push({ type: "Video", href: safeVideoUrl, iconName: "video" });
          }

          if (safeDocsUrl) {
            links.push({ type: "Docs", href: safeDocsUrl, iconName: "doc" });
          }

          const primaryHref = safeLiveUrl || safeWebsiteUrl || safeRepoUrl || "#";
          const desc = p.shortDescription || p.detailedDescription || "";
          const start = p.startDate || "";
          const end = p.endDate || (p.status === "in_progress" ? "Present" : "");
          const dates = start && end ? `${start} - ${end}` : start || end || "";

          return {
            title: p.title,
            href: primaryHref,
            dates,
            active: p.status !== "archived",
            description: desc,
            technologies: Array.isArray(p.technologies) ? [...p.technologies] : [],
            links,
            image: "",
            video: safeVideoUrl || "",
          };
        })
    : [];

  // 5. Work Experience (Strict rule: No fabrication! Only genuine internship experience)
  const adaptedWork: AdaptedWorkItem[] = [];
  if (Array.isArray(projects)) {
    for (const p of projects) {
      if (
        p.projectType &&
        (p.projectType.toLowerCase() === "internship" ||
          p.projectType.toLowerCase() === "employment")
      ) {
        const safeWorkHref = sanitizeSafeUrl(p.liveUrl) || sanitizeSafeUrl(p.repoUrl) || "#";
        adaptedWork.push({
          company: p.title,
          href: safeWorkHref,
          badges: [],
          location: "Verified Experience",
          title: p.role || "Intern",
          start: p.startDate || "Date unspecified",
          end: p.endDate || "Present",
          description: p.shortDescription || p.detailedDescription || "",
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
          location: a.location || a.organization || "Hackathon",
          description: a.description || (a.awardPrize ? `Award: ${a.awardPrize}` : ""),
          links,
        });
      }
    }
  }

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

        if (!socialMap[canonicalName]) {
          socialMap[canonicalName] = {
            name: canonicalName,
            url: safeUrl,
            iconName,
            navbar: link.isPrimary !== undefined ? Boolean(link.isPrimary) : true,
          };
        }
      }
    }
  }

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
    work: adaptedWork,
    hackathons: adaptedHackathons,
    contact: {
      email: contact?.email,
      tel: contact?.phone,
      social: socialMap,
    },
    visibleSections: {
      hero: true,
      about: isVisible("about") && Boolean(summary),
      work: isVisible("work") && adaptedWork.length > 0,
      education: isVisible("education") && adaptedEducation.length > 0,
      skills: isVisible("skills") && adaptedSkills.length > 0,
      projects: isVisible("projects") && adaptedProjects.length > 0,
      hackathons: isVisible("achievements") && adaptedHackathons.length > 0,
      contact: isVisible("contact"),
    },
  };
}

function deriveInitials(name: string): string {
  if (!name) return "OV";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "OV";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
