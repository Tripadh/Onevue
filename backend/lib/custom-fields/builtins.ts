import type { CustomFieldType, CustomIdentity } from "./types";

/**
 * Built-in sections that can host shared field definitions.
 * Education is the first acceptance path. The same list drives every identity,
 * and identities without Education simply do not list it.
 */
export interface BuiltinSection {
  key: string;
  label: string;
  repeatable: boolean;
  /** Profile array that owns record ids. Empty for a single set of values. */
  collection: string;
}

const ABOUT: BuiltinSection = { key: "about", label: "Profile", repeatable: false, collection: "" };
const CONTACT: BuiltinSection = { key: "contact", label: "Contact", repeatable: false, collection: "" };

export const BUILTIN_SECTIONS: Record<CustomIdentity, readonly BuiltinSection[]> = {
  student: [
    ABOUT,
    { key: "education", label: "Education", repeatable: true, collection: "education" },
    { key: "projects", label: "Projects", repeatable: true, collection: "projects" },
    { key: "skills", label: "Skills", repeatable: true, collection: "skills" },
    { key: "credentials", label: "Credentials", repeatable: true, collection: "credentials" },
    { key: "achievements", label: "Achievements", repeatable: true, collection: "achievements" },
    { key: "resume", label: "Resume", repeatable: false, collection: "" },
    { key: "media", label: "Media", repeatable: true, collection: "media" },
    { key: "links", label: "Links", repeatable: true, collection: "links" },
    { key: "contacts", label: "Contacts", repeatable: false, collection: "" },
  ],
  professional: [
    ABOUT,
    { key: "currentEmployment", label: "Current employment", repeatable: false, collection: "" },
    { key: "employmentHistory", label: "Employment history", repeatable: true, collection: "employmentHistory" },
    { key: "skills", label: "Skills", repeatable: true, collection: "skills" },
    { key: "certifications", label: "Certifications", repeatable: true, collection: "certifications" },
    { key: "education", label: "Education", repeatable: true, collection: "education" },
    { key: "portfolio", label: "Portfolio", repeatable: true, collection: "portfolio" },
    { key: "achievements", label: "Achievements", repeatable: true, collection: "achievements" },
    { key: "socialLinks", label: "Social links", repeatable: true, collection: "socialLinks" },
    { key: "resume", label: "Resume", repeatable: false, collection: "" },
    CONTACT,
  ],
  freelancer: [
    ABOUT,
    { key: "services", label: "Services", repeatable: true, collection: "services" },
    { key: "workExperience", label: "Experience", repeatable: true, collection: "workExperience" },
    { key: "skills", label: "Skills", repeatable: true, collection: "skills" },
    { key: "portfolio", label: "Portfolio", repeatable: true, collection: "portfolio" },
    { key: "testimonials", label: "Testimonials", repeatable: true, collection: "testimonials" },
    { key: "workSamples", label: "Work samples", repeatable: true, collection: "workSamples" },
    CONTACT,
  ],
  creator: [
    ABOUT,
    { key: "featuredContent", label: "Featured content", repeatable: true, collection: "featuredContent" },
    { key: "channels", label: "Channels", repeatable: true, collection: "channels" },
    { key: "mediaKit", label: "Media kit", repeatable: false, collection: "" },
    { key: "pastCollaborations", label: "Past collaborations", repeatable: true, collection: "pastCollaborations" },
    { key: "audienceStats", label: "Audience statistics", repeatable: true, collection: "audienceStats" },
    CONTACT,
  ],
  business: [
    ABOUT,
    { key: "branding", label: "Branding", repeatable: false, collection: "" },
    { key: "products", label: "Products", repeatable: true, collection: "products" },
    { key: "credentials", label: "Credentials", repeatable: true, collection: "credentials" },
    { key: "services", label: "Services", repeatable: true, collection: "services" },
    { key: "team", label: "Team", repeatable: true, collection: "team" },
    { key: "caseStudies", label: "Case studies", repeatable: true, collection: "caseStudies" },
    { key: "resources", label: "Resources", repeatable: true, collection: "resources" },
    { key: "publicContact", label: "Contact", repeatable: false, collection: "" },
  ],
};

export function isCustomIdentity(value: string): value is CustomIdentity {
  return Object.prototype.hasOwnProperty.call(BUILTIN_SECTIONS, value);
}

export function builtinSections(identity: CustomIdentity): readonly BuiltinSection[] {
  return BUILTIN_SECTIONS[identity];
}

export function builtinByKey(identity: CustomIdentity, key: string): BuiltinSection | undefined {
  return BUILTIN_SECTIONS[identity].find((section) => section.key === key);
}

export function recordIdsForIdentity(
  identity: CustomIdentity,
  profile: Record<string, unknown> | null | undefined
): Record<string, string[]> {
  const source = profile || {};
  const ids: Record<string, string[]> = {};
  for (const section of BUILTIN_SECTIONS[identity]) {
    if (!section.repeatable || !section.collection) continue;
    const list = source[section.collection];
    ids[section.key] = Array.isArray(list)
      ? list
          .map((row) => {
            if (!row || typeof row !== "object") return "";
            const record = row as Record<string, unknown>;
            const id = record.id ?? record._id;
            return typeof id === "string" || typeof id === "number" ? String(id) : "";
          })
          .filter(Boolean)
      : [];
  }
  return ids;
}

export function patchTouchesBuiltinRecords(identity: CustomIdentity, patch: Record<string, unknown> | undefined): boolean {
  if (!patch) return false;
  return BUILTIN_SECTIONS[identity].some(
    (section) => section.repeatable && section.collection && Object.prototype.hasOwnProperty.call(patch, section.collection)
  );
}

export type BuiltinValueKind = "text" | "url" | "date" | "boolean" | "number" | "tags";

export interface MappableBuiltinField {
  key: string;
  label: string;
  kind: BuiltinValueKind;
  /** Public DTO key when it differs from the stored profile field. */
  publicKey?: string;
}

/**
 * Built-in fields a custom value may fill. The list is taken from the stored
 * profile schemas and the public DTO. Internal asset ids, storage keys, and
 * verification state are omitted so a mapping cannot replace those values.
 * Student credentials have no public image field, so an image stays on the record.
 */
const MAPPABLE: Record<CustomIdentity, Record<string, readonly MappableBuiltinField[]>> = {
  student: {
    education: [
      { key: "fieldOfStudy", label: "Field of study", kind: "text" },
      { key: "specialization", label: "Specialization", kind: "text" },
      { key: "honors", label: "Honors", kind: "text" },
      { key: "coursework", label: "Coursework", kind: "text" },
      { key: "location", label: "Location", kind: "text" },
      { key: "website", label: "Website", kind: "url" },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "endDate", label: "End date", kind: "date" },
    ],
    projects: [
      { key: "shortDescription", label: "Short description", kind: "text" },
      { key: "detailedDescription", label: "Detailed description", kind: "text" },
      { key: "role", label: "Role", kind: "text" },
      { key: "repoUrl", label: "Repository URL", kind: "url" },
      { key: "liveUrl", label: "Live URL", kind: "url" },
      { key: "docsUrl", label: "Docs URL", kind: "url" },
      { key: "websiteUrl", label: "Website URL", kind: "url" },
      { key: "videoUrl", label: "Video URL", kind: "url" },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "endDate", label: "End date", kind: "date" },
    ],
    skills: [{ key: "yearsExperience", label: "Years of experience", kind: "number" }],
    credentials: [
      { key: "issuer", label: "Issuer", kind: "text" },
      { key: "credentialId", label: "Credential ID", kind: "text" },
      { key: "description", label: "Description", kind: "text" },
      { key: "credentialUrl", label: "Credential URL", kind: "url" },
      { key: "verificationUrl", label: "Verification URL", kind: "url" },
      { key: "issueDate", label: "Issue date", kind: "date" },
      { key: "expirationDate", label: "Expiration date", kind: "date" },
      { key: "neverExpires", label: "Never expires", kind: "boolean" },
      { key: "relatedSkills", label: "Related skills", kind: "tags" },
    ],
    achievements: [
      { key: "organization", label: "Organization", kind: "text" },
      { key: "description", label: "Description", kind: "text" },
      { key: "awardPrize", label: "Award", kind: "text" },
      { key: "proofUrl", label: "Proof URL", kind: "url" },
      { key: "certificateUrl", label: "Certificate URL", kind: "url" },
      { key: "date", label: "Date", kind: "date" },
    ],
    media: [
      { key: "description", label: "Description", kind: "text" },
      { key: "altText", label: "Alt text", kind: "text" },
      { key: "mediaUrl", label: "Media URL", kind: "url" },
    ],
    contacts: [
      { key: "city", label: "City", kind: "text" },
      { key: "country", label: "Country", kind: "text" },
      { key: "github", label: "GitHub", kind: "url" },
      { key: "linkedin", label: "LinkedIn", kind: "url" },
      { key: "portfolio", label: "Portfolio URL", kind: "url" },
    ],
    links: [
      { key: "platform", label: "Platform", kind: "text" },
      { key: "username", label: "Username", kind: "text" },
      { key: "url", label: "URL", kind: "url" },
    ],
  },
  professional: {
    currentEmployment: [
      { key: "company", label: "Company", kind: "text", publicKey: "organization" },
      { key: "jobTitle", label: "Job title", kind: "text", publicKey: "title" },
      { key: "location", label: "Location", kind: "text" },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "endDate", label: "End date", kind: "date" },
      { key: "isCurrent", label: "Current role", kind: "boolean" },
    ],
    employmentHistory: [
      { key: "company", label: "Company", kind: "text", publicKey: "organization" },
      { key: "jobTitle", label: "Job title", kind: "text", publicKey: "title" },
      { key: "location", label: "Location", kind: "text" },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "endDate", label: "End date", kind: "date" },
      { key: "isCurrent", label: "Current role", kind: "boolean" },
    ],
    skills: [{ key: "yearsExperience", label: "Years of experience", kind: "number" }],
    certifications: [
      { key: "issuer", label: "Issuer", kind: "text" },
      { key: "credentialId", label: "Credential ID", kind: "text" },
      { key: "credentialUrl", label: "Credential URL", kind: "url" },
      { key: "issueDate", label: "Issue date", kind: "date" },
      { key: "expirationDate", label: "Expiration date", kind: "date" },
    ],
    education: [
      { key: "fieldOfStudy", label: "Field of study", kind: "text" },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "endDate", label: "End date", kind: "date" },
    ],
    portfolio: [
      { key: "description", label: "Description", kind: "text", publicKey: "shortDescription" },
      { key: "role", label: "Role", kind: "text" },
      { key: "url", label: "URL", kind: "url", publicKey: "liveUrl" },
    ],
    achievements: [
      { key: "description", label: "Description", kind: "text" },
      { key: "organization", label: "Organization", kind: "text" },
      { key: "evidenceUrl", label: "Evidence URL", kind: "url", publicKey: "proofUrl" },
      { key: "date", label: "Date", kind: "date" },
    ],
    socialLinks: [
      { key: "label", label: "Label", kind: "text", publicKey: "username" },
      { key: "url", label: "URL", kind: "url" },
    ],
    contact: [
      { key: "city", label: "City", kind: "text" },
      { key: "country", label: "Country", kind: "text" },
      { key: "linkedin", label: "LinkedIn", kind: "url" },
      { key: "website", label: "Website", kind: "url", publicKey: "portfolio" },
    ],
  },
  freelancer: {
    services: [{ key: "description", label: "Description", kind: "text", publicKey: "shortDescription" }],
    workExperience: [
      { key: "description", label: "Description", kind: "text" },
      { key: "startDate", label: "Start date", kind: "date" },
      { key: "endDate", label: "End date", kind: "date" },
      { key: "isCurrent", label: "Current role", kind: "boolean" },
    ],
    skills: [{ key: "yearsExperience", label: "Years of experience", kind: "number" }],
    portfolio: [
      { key: "summary", label: "Summary", kind: "text", publicKey: "shortDescription" },
      { key: "outcome", label: "Outcome", kind: "text", publicKey: "impact" },
      { key: "url", label: "URL", kind: "url", publicKey: "liveUrl" },
    ],
    testimonials: [{ key: "relationship", label: "Relationship", kind: "text" }],
    workSamples: [{ key: "url", label: "URL", kind: "url", publicKey: "mediaUrl" }],
  },
  creator: {
    featuredContent: [
      { key: "summary", label: "Summary", kind: "text", publicKey: "shortDescription" },
      { key: "category", label: "Category", kind: "text" },
      { key: "url", label: "URL", kind: "url", publicKey: "liveUrl" },
      { key: "publishedAt", label: "Published date", kind: "date", publicKey: "startDate" },
    ],
    channels: [
      { key: "handle", label: "Handle", kind: "text", publicKey: "username" },
      { key: "url", label: "URL", kind: "url" },
    ],
    pastCollaborations: [
      { key: "description", label: "Description", kind: "text" },
      { key: "outcome", label: "Outcome", kind: "text" },
      { key: "url", label: "URL", kind: "url", publicKey: "proofUrl" },
      { key: "date", label: "Date", kind: "date" },
    ],
  },
  business: {
    products: [
      { key: "description", label: "Description", kind: "text", publicKey: "shortDescription" },
      { key: "url", label: "URL", kind: "url", publicKey: "liveUrl" },
    ],
    credentials: [
      { key: "issuer", label: "Issuer", kind: "text" },
      { key: "description", label: "Description", kind: "text" },
      { key: "evidenceUrl", label: "Evidence URL", kind: "url", publicKey: "credentialUrl" },
      { key: "issueDate", label: "Issue date", kind: "date" },
      { key: "expirationDate", label: "Expiration date", kind: "date" },
    ],
    services: [{ key: "description", label: "Description", kind: "text", publicKey: "shortDescription" }],
    team: [{ key: "role", label: "Role", kind: "text" }],
    caseStudies: [
      { key: "summary", label: "Summary", kind: "text", publicKey: "shortDescription" },
      { key: "url", label: "URL", kind: "url", publicKey: "liveUrl" },
    ],
    resources: [{ key: "url", label: "URL", kind: "url" }],
    publicContact: [
      { key: "city", label: "City", kind: "text" },
      { key: "country", label: "Country", kind: "text" },
    ],
  },
};

export function mappableFields(identity: CustomIdentity, sectionKey: string): readonly MappableBuiltinField[] {
  return MAPPABLE[identity][sectionKey] || [];
}

export function mappingCompatible(type: CustomFieldType, kind: BuiltinValueKind): boolean {
  if (kind === "text") return type === "text" || type === "textarea" || type === "select";
  if (kind === "url") return type === "url";
  if (kind === "date") return type === "date";
  if (kind === "boolean") return type === "boolean";
  if (kind === "number") return type === "number";
  if (kind === "tags") return type === "tags" || type === "multiselect";
  return false;
}
