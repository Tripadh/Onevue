(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.OV = root.OV || {};
    root.OV.createCustomize = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
/**
 * Template-neutral content catalog and the approved template registry.
 * User content is stored on identity profiles and publication snapshots.
 * A template only declares what it can display. It does not own the content.
 *
 * magicui-portfolio is the only registered template, and it is a test adapter.
 */

const IDENTITIES = ["student", "professional", "freelancer", "creator", "business"];

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

const MAGICUI_SUPPORTED_SECTIONS = [
  "profile",
  "about",
  "experience",
  "education",
  "skills",
  "projects",
  "services",
  "products",
  "caseStudies",
  "featured",
  "credentials",
  "highlights",
  "hackathons",
  "testimonials",
  "team",
  "media",
  "contact",
];

const DEFAULT_SECTION_ORDER = ["about", "work", "education", "skills", "projects", "achievements", "contact"];

const MAGICUI = {
  id: "magicui-portfolio",
  version: "1.0.0",
  name: "Magic UI Portfolio",
  role: "test-adapter",
  description:
    "Test adapter used to exercise publishing. It is not the permanent OneVue template library. Profile content stays stored when this adapter cannot display it.",
  supportedSections: MAGICUI_SUPPORTED_SECTIONS,
  supportedBlocks: ["text", "richText", "link", "repeatable", "media", "choice"],
  supportedFieldTypes: ["text", "textarea", "number", "url", "date", "boolean", "select", "multiselect", "tags", "image", "gallery", "video", "file"],
  hiddenFieldTypes: [],
  identities: IDENTITIES,
  requiredInputs: ["displayName", "username"],
  media: {
    images: true,
    galleries: false,
    videoFile: false,
    videoEmbed: false,
    externalVideoUrl: true,
    privateAssets: false,
  },
  presentation: {
    accentColor: true,
    themeMode: true,
    typography: false,
    sectionVisibility: true,
    sectionOrder: true,
    entryOrder: true,
  },
  defaultSectionOrder: DEFAULT_SECTION_ORDER,
  visibilityControls: [
    { id: "about", label: "About & Bio", description: "Summary, headline, location, and social links" },
    { id: "education", label: "Education", description: "Degrees, universities, honors, and GPA" },
    { id: "projects", label: "Projects Showcase", description: "Projects, services, products, and case studies saved on the profile" },
    { id: "skills", label: "Skills & Competencies", description: "Skills stored on the profile" },
    { id: "work", label: "Work Experience", description: "Employment and internship history" },
    { id: "achievements", label: "Achievements & Awards", description: "Highlights, hackathons, and credentials" },
    { id: "contact", label: "Contact Information", description: "Public email, phone, and links" },
  ],
  retainedSections: ["languages", "careerInterests", "areasOfInterest", "nationality", "currentStatus", "registration", "audienceStats"],
  limits: [
    "Does not offer typography or spacing presets.",
    "Does not render galleries or uploaded video files. One image per project is shown, and media items with an image or link are shown.",
    "Private files stay on the profile and are not placed on the public page.",
    "Renders emphasis, headings, lists, and links from stored text. HTML and scripts are not executed.",
  ],
};

const TEMPLATES = [MAGICUI];

function listTemplates() {
  return TEMPLATES.map((template) => Object.assign({}, template, {
    supportedSections: template.supportedSections.slice(),
    supportedBlocks: template.supportedBlocks.slice(),
    supportedFieldTypes: template.supportedFieldTypes.slice(),
    hiddenFieldTypes: template.hiddenFieldTypes.slice(),
    identities: template.identities.slice(),
    visibilityControls: template.visibilityControls.map((item) => Object.assign({}, item)),
    retainedSections: template.retainedSections.slice(),
    limits: template.limits.slice(),
    defaultSectionOrder: template.defaultSectionOrder.slice(),
  }));
}

function getTemplate(id) {
  return listTemplates().find((template) => template.id === id) || null;
}

function contentForIdentity(identity) {
  return CONTENT_SECTIONS.filter((section) => section.identities.indexOf(identity) !== -1)
    .map((section) => Object.assign({}, section, {
      identities: section.identities.slice(),
      blocks: section.blocks.slice(),
    }));
}

function sanitizeStoredText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, "")
    .replace(/!\[[^\]]*\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, "")
    .replace(/\[([^\]]*)\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, "$1");
}

function reorderEntries(list, index, direction) {
  const source = Array.isArray(list) ? list : [];
  const next = source.slice();
  const target = index + direction;
  if (target < 0 || target >= next.length || index < 0 || index >= next.length) return next;
  const moved = next.splice(index, 1)[0];
  next.splice(target, 0, moved);
  return next;
}

return {
  IDENTITIES,
  CONTENT_SECTIONS,
  RETAINED_PUBLIC_FIELDS,
  APPROVED_TEMPLATE_IDS: TEMPLATES.map((template) => template.id),
  listTemplates,
  getTemplate,
  contentForIdentity,
  sanitizeStoredText,
  reorderEntries,
};

});
