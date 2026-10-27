import type { CustomIdentity } from "./types";

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
