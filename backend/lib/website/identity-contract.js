/**
 * Authoritative identity-to-website contract.
 *
 * This module is the single source of truth for which website sections each
 * identity can manage, how they are labelled, which stored fields feed them,
 * what is visible by default, and which template sections can render them.
 *
 * The dashboard and the public renderer consume the serialized form through
 * `/api/website/contract`. They must not re-declare per-identity sections.
 *
 * Everything here is data tables plus small pure helpers; there are no
 * per-identity conditional dashboards.
 */

"use strict";

const IDENTITIES = ["student", "professional", "freelancer", "creator", "business"];

/**
 * Stored content catalog. `publicKey` names the normalized PublicProfileDTO
 * field that a template reads. `storage: "identity-profile"` means the data is
 * intentionally retained on the profile and has no public DTO field yet.
 */
const CONTENT_SECTIONS = [
  { id: "profile", label: "Profile", identities: IDENTITIES, storage: "public-dto", publicKey: "profile.displayName", repeatable: false, blocks: ["text", "media"] },
  { id: "about", label: "About", identities: IDENTITIES, storage: "public-dto", publicKey: "profile.bio", repeatable: false, blocks: ["richText"] },
  { id: "experience", label: "Experience", identities: ["student", "professional", "freelancer"], storage: "public-dto", publicKey: "experience", repeatable: true, blocks: ["text", "richText", "repeatable"] },
  { id: "education", label: "Education", identities: ["student", "professional"], storage: "public-dto", publicKey: "education", repeatable: true, blocks: ["text", "link", "repeatable"] },
  { id: "skills", label: "Skills", identities: ["student", "professional", "freelancer", "creator"], storage: "public-dto", publicKey: "skills", repeatable: true, blocks: ["text", "choice", "repeatable"] },
  { id: "projects", label: "Projects", identities: IDENTITIES, storage: "public-dto", publicKey: "projects", repeatable: true, blocks: ["text", "richText", "link", "media", "repeatable"] },
  { id: "services", label: "Services", identities: ["freelancer", "business"], storage: "public-dto", publicKey: "projects", repeatable: true, blocks: ["text", "richText", "repeatable"] },
  { id: "products", label: "Products", identities: ["business"], storage: "public-dto", publicKey: "projects", repeatable: true, blocks: ["text", "link", "media", "repeatable"] },
  { id: "caseStudies", label: "Case studies", identities: ["freelancer", "business"], storage: "public-dto", publicKey: "projects", repeatable: true, blocks: ["text", "link", "media", "repeatable"] },
  { id: "featured", label: "Featured content", identities: ["creator"], storage: "public-dto", publicKey: "projects", repeatable: true, blocks: ["text", "link", "media", "repeatable"] },
  { id: "credentials", label: "Credentials", identities: ["student", "professional", "business"], storage: "public-dto", publicKey: "credentials", repeatable: true, blocks: ["text", "link", "media", "repeatable"] },
  { id: "highlights", label: "Highlights", identities: ["student", "professional"], storage: "public-dto", publicKey: "achievements", repeatable: true, blocks: ["text", "link", "repeatable"] },
  { id: "hackathons", label: "Hackathons", identities: ["student"], storage: "public-dto", publicKey: "achievements", repeatable: true, blocks: ["text", "link", "repeatable"] },
  { id: "testimonials", label: "Testimonials", identities: ["freelancer"], storage: "public-dto", publicKey: "testimonials", repeatable: true, blocks: ["richText", "repeatable"] },
  { id: "team", label: "Team", identities: ["business"], storage: "public-dto", publicKey: "team", repeatable: true, blocks: ["text", "repeatable"] },
  { id: "media", label: "Media", identities: ["student", "freelancer", "creator", "business"], storage: "public-dto", publicKey: "media", repeatable: true, blocks: ["text", "link", "media", "repeatable"] },
  { id: "contact", label: "Contact", identities: IDENTITIES, storage: "public-dto", publicKey: "contact", repeatable: false, blocks: ["link", "choice"] },
  { id: "languages", label: "Languages", identities: ["student"], storage: "public-dto", publicKey: "profile.languages", repeatable: true, blocks: ["text", "choice", "repeatable"] },
  { id: "careerInterests", label: "Career interests", identities: ["student", "freelancer", "creator"], storage: "public-dto", publicKey: "profile.careerInterests", repeatable: true, blocks: ["text", "repeatable"] },
  { id: "areasOfInterest", label: "Areas of interest", identities: ["student", "creator"], storage: "public-dto", publicKey: "profile.areasOfInterest", repeatable: true, blocks: ["text", "repeatable"] },
  { id: "nationality", label: "Nationality", identities: ["student"], storage: "public-dto", publicKey: "profile.nationality", repeatable: false, blocks: ["text"] },
  { id: "currentStatus", label: "Current status", identities: IDENTITIES, storage: "public-dto", publicKey: "profile.currentStatus", repeatable: false, blocks: ["text", "choice"] },
  { id: "registration", label: "Registration", identities: ["business"], storage: "identity-profile", publicKey: null, repeatable: false, blocks: ["text", "media"] },
  { id: "audienceStats", label: "Audience statistics", identities: ["creator"], storage: "identity-profile", publicKey: null, repeatable: true, blocks: ["text", "choice", "repeatable"] },
];

const RETAINED_PUBLIC_FIELDS = [
  "profile.languages",
  "profile.careerInterests",
  "profile.areasOfInterest",
  "profile.nationality",
  "profile.currentStatus",
];

/**
 * Renderer-control catalog. Every section that Magic UI can draw independently
 * has one control. `rendererSection` is the key the portfolio renderer uses in
 * `visibleSections`; `legacyIds` are accepted during migration only.
 */
const SECTION_CATALOG = [
  {
    id: "about",
    label: "About & Bio",
    description: "Headline, summary, location, and public links",
    rendererSection: "about",
    legacyIds: [],
    repeatable: false,
    recordCustomFields: false,
    sectionCustomFields: true,
    readiness: { paths: ["headline", "bio"] },
  },
  {
    id: "experience",
    label: "Work Experience",
    description: "Employment, internships, and freelance history",
    rendererSection: "experience",
    legacyIds: ["work", "jobs", "employmentHistory"],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["experience"] },
  },
  {
    id: "education",
    label: "Education",
    description: "Degrees, universities, honors, and GPA",
    rendererSection: "education",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["education"] },
  },
  {
    id: "skills",
    label: "Skills & Competencies",
    description: "Skills and technologies saved on the identity",
    rendererSection: "skills",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["skills"] },
  },
  {
    id: "projects",
    label: "Projects",
    description: "Project records saved on the identity",
    rendererSection: "projects",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["projects"] },
  },
  {
    id: "services",
    label: "Services",
    description: "Service offerings and packages",
    rendererSection: "services",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["projects"], where: { projectType: ["service"] } },
  },
  {
    id: "products",
    label: "Products",
    description: "Products and pricing",
    rendererSection: "products",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["projects"], where: { projectType: ["product"] } },
  },
  {
    id: "caseStudies",
    label: "Case Studies",
    description: "Client work and outcomes",
    rendererSection: "caseStudies",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["projects"], where: { projectType: ["case-study", "caseStudy"] } },
  },
  {
    id: "featured",
    label: "Featured Content",
    description: "Published videos, articles, and posts",
    rendererSection: "featured",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: {
      paths: ["projects"],
      where: { projectType: ["featured", "video", "article", "podcast", "newsletter", "short-form", "livestream"] },
    },
  },
  {
    id: "credentials",
    label: "Credentials",
    description: "Certifications, licenses, and verified credentials",
    rendererSection: "credentials",
    legacyIds: ["certifications", "certification"],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["credentials"] },
  },
  {
    id: "highlights",
    label: "Highlights & Awards",
    description: "Awards, honors, and notable achievements",
    rendererSection: "highlights",
    legacyIds: ["achievements"],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["achievements"] },
  },
  {
    id: "hackathons",
    label: "Hackathons",
    description: "Hackathon results and competition records",
    rendererSection: "hackathons",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["achievements"], where: { category: ["hackathon", "hackathons"] } },
  },
  {
    id: "testimonials",
    label: "Testimonials",
    description: "Client and collaborator quotes",
    rendererSection: "testimonials",
    legacyIds: ["testimonial"],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["testimonials"] },
  },
  {
    id: "team",
    label: "Team",
    description: "Public team members and roles",
    rendererSection: "team",
    legacyIds: ["team_members"],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["team"] },
    privacy: "Only members marked public are published.",
  },
  {
    id: "media",
    label: "Media",
    description: "Images, work samples, and media links",
    rendererSection: "media",
    legacyIds: [],
    repeatable: true,
    recordCustomFields: true,
    sectionCustomFields: false,
    readiness: { paths: ["media"] },
  },
  {
    id: "contact",
    label: "Contact Information",
    description: "Public email, phone, and links",
    rendererSection: "contact",
    legacyIds: [],
    repeatable: false,
    recordCustomFields: false,
    sectionCustomFields: true,
    readiness: { paths: ["contact"] },
    privacy: "Only contact fields marked public are published.",
  },
];

const DEFAULT_SECTION_ORDER = SECTION_CATALOG.map((section) => section.id);

/**
 * Sections each identity can manage. Derived from the stored-content catalog
 * above so a section cannot exist for an identity without a home in the schema.
 */
const IDENTITY_SECTION_IDS = {
  student: ["about", "experience", "education", "skills", "projects", "credentials", "highlights", "hackathons", "media", "contact"],
  professional: ["about", "experience", "education", "skills", "projects", "credentials", "highlights", "contact"],
  freelancer: ["about", "experience", "skills", "projects", "services", "caseStudies", "testimonials", "media", "contact"],
  creator: ["about", "skills", "projects", "featured", "media", "contact"],
  business: ["about", "projects", "services", "products", "caseStudies", "credentials", "team", "media", "contact"],
};

const IDENTITY_DEFAULT_VISIBLE = {
  student: ["about", "experience", "education", "skills", "projects", "credentials", "highlights", "hackathons", "contact"],
  professional: ["about", "experience", "education", "skills", "projects", "credentials", "highlights", "contact"],
  freelancer: ["about", "experience", "skills", "projects", "services", "caseStudies", "testimonials", "media", "contact"],
  creator: ["about", "skills", "projects", "featured", "media", "contact"],
  business: ["about", "projects", "services", "products", "caseStudies", "credentials", "team", "media", "contact"],
};

const IDENTITY_META = {
  student: {
    label: "Student",
    heading: "Student Portfolio Website",
    description: "Manage the public portfolio built from your student identity, preview draft changes, and publish versioned revisions.",
    identityPageLabel: "Student Identity",
    identityPagePath: "/app/student/identity",
    readinessTitle: "Identity readiness",
  },
  professional: {
    label: "Professional",
    heading: "Professional Website",
    description: "Manage the public professional profile built from your experience, education, skills, and credentials.",
    identityPageLabel: "Professional Identity",
    identityPagePath: "/app/professional/identity",
    readinessTitle: "Professional identity readiness",
  },
  freelancer: {
    label: "Freelancer",
    heading: "Freelancer Website",
    description: "Manage the public service profile built from your services, portfolio, testimonials, and work samples.",
    identityPageLabel: "Freelancer Identity",
    identityPagePath: "/app/freelancer/identity",
    readinessTitle: "Freelancer identity readiness",
  },
  creator: {
    label: "Creator",
    heading: "Creator Website",
    description: "Manage the public creator page built from your featured content, channels, and audience.",
    identityPageLabel: "Creator Identity",
    identityPagePath: "/app/creator/identity",
    readinessTitle: "Creator identity readiness",
  },
  business: {
    label: "Business",
    heading: "Business Website",
    description: "Manage the public business page built from your products, services, team, and public contact details.",
    identityPageLabel: "Business Identity",
    identityPagePath: "/app/business/identity",
    readinessTitle: "Business identity readiness",
  },
};

/**
 * Fields that feed each section, per identity. Every path must exist on the
 * corresponding Mongoose schema (verified against models/*Profile.ts).
 * These are used for documentation, dashboard tracing, and integrity checks.
 */
const IDENTITY_SOURCE_PATHS = {
  student: {
    about: ["headline", "bio"],
    experience: ["workExperience"],
    education: ["education"],
    skills: ["skills"],
    projects: ["projects"],
    credentials: ["credentials"],
    highlights: ["achievements"],
    hackathons: ["achievements"],
    media: ["media"],
    contact: ["contacts", "links"],
  },
  professional: {
    about: ["headline", "bio"],
    experience: ["currentEmployment", "employmentHistory"],
    education: ["education"],
    skills: ["skills"],
    projects: ["portfolio"],
    credentials: ["certifications"],
    highlights: ["achievements"],
    contact: ["contact"],
  },
  freelancer: {
    about: ["headline", "bio"],
    experience: ["workExperience"],
    skills: ["skills", "technologies"],
    projects: ["portfolio"],
    services: ["services"],
    caseStudies: ["portfolio"],
    testimonials: ["testimonials"],
    media: ["workSamples"],
    contact: ["contact"],
  },
  creator: {
    about: ["headline", "bio", "niche"],
    skills: ["contentCategories"],
    projects: ["featuredContent"],
    featured: ["featuredContent"],
    media: ["featuredContent"],
    contact: ["contact"],
  },
  business: {
    about: ["tagline", "description", "mission"],
    projects: ["caseStudies"],
    services: ["services"],
    products: ["products"],
    caseStudies: ["caseStudies"],
    credentials: ["credentials"],
    team: ["team"],
    media: ["branding"],
    contact: ["publicContact", "website"],
  },
};

const RENDERER_SECTION_IDS = SECTION_CATALOG.map((section) => section.rendererSection);

const SECTION_BY_ID = new Map(SECTION_CATALOG.map((section) => [section.id, section]));
// Stored configuration ids are compared case-insensitively; several catalog
// ids are camelCase (caseStudies, audienceStats) and must round-trip exactly.
const SECTION_ID_BY_LOWER = new Map(SECTION_CATALOG.map((section) => [section.id.toLowerCase(), section.id]));
const LEGACY_ALIASES = new Map();
for (const section of SECTION_CATALOG) {
  for (const legacy of section.legacyIds) {
    if (LEGACY_ALIASES.has(legacy)) {
      throw new Error(`Duplicate legacy section alias: ${legacy}`);
    }
    LEGACY_ALIASES.set(legacy, section.id);
  }
}

function assertIdentity(identity) {
  if (!IDENTITY_META[identity]) {
    throw new Error(`Unknown identity '${identity}'. Expected one of ${IDENTITIES.join(", ")}.`);
  }
  return identity;
}

/** Resolves a stored id to its canonical catalog id, ignoring case. */
function canonicalSectionId(value) {
  const id = String(value || "").toLowerCase().trim();
  if (!id) return "";
  if (LEGACY_ALIASES.has(id)) return LEGACY_ALIASES.get(id);
  return SECTION_ID_BY_LOWER.get(id) || "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sectionControlsFor(identity) {
  const ids = IDENTITY_SECTION_IDS[assertIdentity(identity)];
  return ids.map((id) => {
    const section = SECTION_BY_ID.get(id);
    return Object.assign({}, section, {
      legacyIds: section.legacyIds.slice(),
      readiness: clone(section.readiness),
      sourcePaths: (IDENTITY_SOURCE_PATHS[identity] && IDENTITY_SOURCE_PATHS[identity][id]
        ? IDENTITY_SOURCE_PATHS[identity][id]
        : []).slice(),
    });
  });
}

function defaultVisibleFor(identity) {
  return (IDENTITY_DEFAULT_VISIBLE[assertIdentity(identity)] || []).slice();
}

function defaultOrderFor(identity) {
  const available = new Set(IDENTITY_SECTION_IDS[assertIdentity(identity)]);
  const order = DEFAULT_SECTION_ORDER.filter((id) => available.has(id));
  for (const id of available) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

/** Expands legacy umbrella ids into the concrete sections this identity owns. */
function expandLegacySections(ids, identity) {
  const available = new Set(IDENTITY_SECTION_IDS[identity]);
  const out = [];
  const push = (id) => {
    if (id && available.has(id) && !out.includes(id)) out.push(id);
  };
  for (const raw of ids) {
    const id = String(raw || "").toLowerCase().trim();
    if (!id) continue;
    if (id === "achievements") {
      ["highlights", "hackathons"].forEach(push);
      push("credentials");
      continue;
    }
    if (id === "work") {
      push("experience");
      continue;
    }
    push(canonicalSectionId(id));
  }
  return out;
}
/**
 * Canonicalizes stored visibility. Existing configurations that only know the
 * old umbrella ids (`work`, `achievements`) keep their meaning; concrete ids
 * win when both are present. Unknown ids are dropped rather than failing a
 * read, so a template change cannot lock a user out of their configuration.
 */
function normalizeVisibleSections(identity, value) {
  assertIdentity(identity);
  const incoming = Array.isArray(value) ? value : defaultVisibleFor(identity);
  const normalized = [];
  for (const raw of incoming) {
    const id = String(raw || "").toLowerCase().trim();
    if (!id) continue;
    if (id === "achievements") {
      expandLegacySections(["achievements"], identity).forEach((item) => {
        if (!normalized.includes(item)) normalized.push(item);
      });
      continue;
    }
    if (id === "work") {
      if (!normalized.includes("experience")) normalized.push("experience");
      continue;
    }
    const canonical = canonicalSectionId(id);
    if (!canonical) continue;
    if (!normalized.includes(canonical)) normalized.push(canonical);
  }
  // `projects` historically represented every project bucket. If a legacy
  // configuration contains `projects` but no concrete bucket ids, preserve the
  // old meaning by enabling the buckets available to this identity.
  const projectBuckets = ["services", "products", "caseStudies", "featured"].filter((id) =>
    IDENTITY_SECTION_IDS[identity].includes(id)
  );
  const hasConcrete = normalized.some((id) => projectBuckets.includes(id));
  if (normalized.includes("projects") && !hasConcrete) {
    for (const id of projectBuckets) if (!normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

function normalizeSectionOrder(identity, value) {
  assertIdentity(identity);
  const available = IDENTITY_SECTION_IDS[identity];
  const fallback = defaultOrderFor(identity);
  const incoming = Array.isArray(value) ? value : [];
  const out = [];
  for (const raw of incoming) {
    const id = String(raw || "").toLowerCase().trim();
    const canonical = id === "work" ? "experience" : canonicalSectionId(id);
    if (available.includes(canonical) && !out.includes(canonical)) out.push(canonical);
  }
  for (const id of fallback) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function readPath(source, path) {
  return String(path)
    .split(".")
    .reduce((current, key) => {
      if (current == null || typeof current !== "object") return undefined;
      return current[key];
    }, source);
}

function hasContent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).some((key) => hasContent(value[key]));
  return true;
}

/**
 * Counts the public DTO content that feeds one section. Record sections count
 * matching array entries; scalar sections (`about`, `contact`) count populated
 * fields. `where` narrows a shared source array (for example products inside
 * `projects`) exactly as the contract declares.
 */
const DTO_PATH_ALIASES = {
  headline: "profile.headline",
  bio: "profile.bio",
};

function sectionRecordCount(section, dto) {
  const readiness = section.readiness;
  if (!readiness || !Array.isArray(readiness.paths) || readiness.paths.length === 0) {
    return { count: 0, countKind: "records" };
  }
  const values = readiness.paths.map((path) => readPath(dto, DTO_PATH_ALIASES[path] || path));
  const arrays = values.filter(Array.isArray);
  if (arrays.length > 0) {
    let items = arrays.reduce((acc, array) => acc.concat(array), []);
    if (readiness.where) {
      const where = readiness.where;
      items = items.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          Object.keys(where).every((key) => {
            const allowed = Array.isArray(where[key]) ? where[key] : [where[key]];
            return allowed.includes(item[key]);
          })
      );
    }
    return { count: items.length, countKind: "records" };
  }
  return { count: values.filter(hasContent).length, countKind: "fields" };
}

/**
 * Serialized readiness summary for one identity. Each entry distinguishes
 * content saved on the profile from content enabled for public display and
 * content the selected template can render. The caller compares a draft
 * summary with an active-revision summary to report what is actually live.
 */
function summarizeSections(identity, dto, visibleSections, supportedSections) {
  assertIdentity(identity);
  const visible = new Set(normalizeVisibleSections(identity, visibleSections));
  const supported = Array.isArray(supportedSections) ? new Set(supportedSections) : null;
  const sections = (dto && typeof dto === "object" ? sectionControlsFor(identity) : []).map((section) => {
    const { count, countKind } = sectionRecordCount(section, dto);
    return {
      id: section.id,
      label: section.label,
      description: section.description,
      rendererSection: section.rendererSection,
      savedCount: count,
      countKind,
      saved: count > 0,
      enabled: visible.has(section.id),
      templateSupported: supported ? supported.has(section.id) : null,
    };
  });
  return {
    identity,
    sections,
    savedSections: sections.filter((section) => section.saved).length,
    enabledSections: sections.filter((section) => section.enabled).length,
    liveSections: sections.filter((section) => section.saved && section.enabled && section.templateSupported !== false).length,
  };
}

function templateCompatibilityFor(identity, template) {
  const supported = new Set((template && template.supportedSections) || []);
  const sections = sectionControlsFor(identity).map((section) => ({
    id: section.id,
    rendererSection: section.rendererSection,
    supported: supported.has(section.id),
  }));
  return {
    supported: sections.every((section) => section.supported),
    sections,
    unsupportedSections: sections.filter((section) => !section.supported).map((section) => section.id),
  };
}

/** Serialized contract for one identity and one template. */
function identityContract(identity, template) {
  assertIdentity(identity);
  const meta = IDENTITY_META[identity];
  const sections = sectionControlsFor(identity).map((section) => ({
    id: section.id,
    label: section.label,
    description: section.description,
    rendererSection: section.rendererSection,
    legacyIds: section.legacyIds,
    defaultVisible: defaultVisibleFor(identity).includes(section.id),
    independentlyHideable: true,
    reorderable: true,
    recordCustomFields: section.recordCustomFields,
    sectionCustomFields: section.sectionCustomFields,
    sourcePaths: section.sourcePaths,
    readiness: section.readiness,
    ...(section.privacy ? { privacy: section.privacy } : {}),
    ...(template ? { supported: (template.supportedSections || []).includes(section.id) } : {}),
  }));
  const readiness = sections
    .filter((section) => section.readiness && section.readiness.paths.length > 0)
    .map((section) => ({
      sectionId: section.id,
      label: section.label,
      paths: section.readiness.paths,
      ...(section.readiness.where ? { where: section.readiness.where } : {}),
    }));

  return {
    identity,
    label: meta.label,
    heading: meta.heading,
    description: meta.description,
    identityPageLabel: meta.identityPageLabel,
    identityPagePath: meta.identityPagePath,
    readinessTitle: meta.readinessTitle,
    sections,
    readiness,
    defaultSections: {
      visible: defaultVisibleFor(identity),
      order: defaultOrderFor(identity),
    },
    templateCompatibility: template ? templateCompatibilityFor(identity, template) : null,
  };
}

function allIdentityContracts(template) {
  return IDENTITIES.map((identity) => identityContract(identity, template));
}

/**
 * Validates internal consistency. Throws on contradictory definitions so an
 * invalid contract cannot be served or used to persist configurations.
 */
function validateContract() {
  const sectionIds = new Set(SECTION_CATALOG.map((section) => section.id));
  if (sectionIds.size !== SECTION_CATALOG.length) {
    throw new Error("Website section ids must be unique.");
  }
  for (const section of SECTION_CATALOG) {
    if (!RENDERER_SECTION_IDS.includes(section.rendererSection)) {
      throw new Error(`Section '${section.id}' has an invalid renderer section.`);
    }
    if (!CONTENT_SECTIONS.some((entry) => entry.id === section.id)) {
      throw new Error(`Section '${section.id}' is missing from the stored content catalog.`);
    }
  }
  for (const identity of IDENTITIES) {
    const ids = IDENTITY_SECTION_IDS[identity];
    if (!ids) throw new Error(`Identity '${identity}' has no sections.`);
    for (const id of ids) {
      if (!sectionIds.has(id)) throw new Error(`Identity '${identity}' references unknown section '${id}'.`);
    }
    for (const id of IDENTITY_DEFAULT_VISIBLE[identity] || []) {
      if (!ids.includes(id)) {
        throw new Error(`Identity '${identity}' defaults to section '${id}' it cannot manage.`);
      }
    }
    const source = IDENTITY_SOURCE_PATHS[identity];
    for (const id of ids) {
      if (!source || !Array.isArray(source[id])) {
        throw new Error(`Identity '${identity}' section '${id}' has no source field map.`);
      }
    }
  }
  return true;
}

validateContract();

module.exports = {
  IDENTITIES,
  CONTENT_SECTIONS,
  RETAINED_PUBLIC_FIELDS,
  SECTION_CATALOG,
  RENDERER_SECTION_IDS,
  DEFAULT_SECTION_ORDER,
  IDENTITY_SECTION_IDS,
  IDENTITY_DEFAULT_VISIBLE,
  IDENTITY_META,
  IDENTITY_SOURCE_PATHS,
  sectionControlsFor,
  defaultVisibleFor,
  defaultOrderFor,
  canonicalSectionId,
  expandLegacySections,
  normalizeVisibleSections,
  normalizeSectionOrder,
  sectionRecordCount,
  summarizeSections,
  templateCompatibilityFor,
  identityContract,
  allIdentityContracts,
  validateContract,
};
