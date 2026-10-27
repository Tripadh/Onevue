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

function hasContent(value) {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function readPath(source, path) {
  return String(path).split(".").reduce((current, key) => {
    if (current == null || typeof current !== "object") return undefined;
    return current[key];
  }, source);
}

function partitionPublication(templateId, dto) {
  const template = getTemplate(templateId);
  if (!template) {
    throw new Error("Template '" + templateId + "' is not registered.");
  }
  const displayed = [];
  const retained = [];
  CONTENT_SECTIONS.forEach((section) => {
    if (!section.publicKey) return;
    if (!hasContent(readPath(dto, section.publicKey))) return;
    if (template.supportedSections.indexOf(section.id) !== -1) displayed.push(section.id);
    else retained.push(section.id);
  });
  return { displayed, retained };
}

function retainedProfileKeys(templateId, identity, profile) {
  const template = getTemplate(templateId);
  if (!template) {
    throw new Error("Template '" + templateId + "' is not registered.");
  }
  if (!profile || typeof profile !== "object") return [];
  return CONTENT_SECTIONS.filter((section) => {
    return section.identities.indexOf(identity) !== -1 &&
      section.storage === "identity-profile" &&
      template.supportedSections.indexOf(section.id) === -1 &&
      hasContent(profile[section.id]);
  }).map((section) => section.id);
}

function sanitizeStoredText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/<\/?[a-zA-Z][^>\n]*>/g, "")
    .replace(/!\[[^\]]*\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, "")
    .replace(/\[([^\]]*)\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, "$1");
}

function uniqueAllowed(values, allowed) {
  const next = [];
  values.forEach((value) => {
    const key = String(value);
    if (allowed.indexOf(key) !== -1 && next.indexOf(key) === -1) next.push(key);
  });
  return next;
}

function presentationForTemplate(templateId, customization) {
  const template = getTemplate(templateId);
  if (!template) {
    throw new Error("Template '" + templateId + "' is not registered.");
  }
  const allowed = template.visibilityControls.map((item) => item.id);
  const fallbackOrder = uniqueAllowed(template.defaultSectionOrder || allowed, allowed);
  allowed.forEach((id) => {
    if (fallbackOrder.indexOf(id) === -1) fallbackOrder.push(id);
  });
  const source = customization && typeof customization === "object" ? customization : {};
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  let accentColor = "#3b82f6";
  if (source.accentColor !== undefined && source.accentColor !== null && String(source.accentColor).trim() !== "") {
    const accent = String(source.accentColor).trim();
    if (!template.presentation.accentColor) {
      throw new Error("This template does not apply an accent color.");
    }
    if (!hex.test(accent)) {
      throw new Error("Invalid hex accent color. Must be a valid 3- or 6-digit hex string (e.g. #3b82f6).");
    }
    accentColor = accent;
  }

  let themeMode = "system";
  if (source.themeMode !== undefined && source.themeMode !== null && source.themeMode !== "") {
    if (!template.presentation.themeMode) {
      throw new Error("This template does not apply a theme.");
    }
    if (source.themeMode !== "light" && source.themeMode !== "dark" && source.themeMode !== "system") {
      throw new Error("Invalid themeMode. Must be 'light', 'dark', or 'system'.");
    }
    themeMode = source.themeMode;
  }

  const defaultVisible = ["about", "education", "projects", "skills", "achievements", "contact"].filter((id) => allowed.indexOf(id) !== -1);
  let visibleSections = defaultVisible.slice();
  if (source.visibleSections !== undefined) {
    if (!Array.isArray(source.visibleSections)) {
      throw new Error("visibleSections must be a list of section ids.");
    }
    if (!template.presentation.sectionVisibility) {
      throw new Error("This template does not hide sections.");
    }
    const unknown = source.visibleSections.filter((id) => allowed.indexOf(String(id)) === -1);
    if (unknown.length) {
      throw new Error("Unsupported section visibility: " + unknown.join(", ") + ".");
    }
    visibleSections = uniqueAllowed(source.visibleSections, allowed);
  }

  let sectionOrder = fallbackOrder.slice();
  if (source.sectionOrder !== undefined) {
    if (!Array.isArray(source.sectionOrder)) {
      throw new Error("sectionOrder must be a list of section ids.");
    }
    if (!template.presentation.sectionOrder) {
      throw new Error("This template does not reorder sections.");
    }
    const unknownOrder = source.sectionOrder.filter((id) => allowed.indexOf(String(id)) === -1);
    if (unknownOrder.length) {
      throw new Error("Unsupported section order: " + unknownOrder.join(", ") + ".");
    }
    sectionOrder = uniqueAllowed(source.sectionOrder, allowed);
    fallbackOrder.forEach((id) => {
      if (sectionOrder.indexOf(id) === -1) sectionOrder.push(id);
    });
  }

  return {
    accentColor,
    themeMode,
    visibleSections,
    sectionOrder,
  };
}

function publishedCustomization(revisionPresentation, configCustomization, templateId) {
  const id = templateId || "magicui-portfolio";
  const stored = revisionPresentation && typeof revisionPresentation === "object" ? revisionPresentation : null;
  if (stored && Array.isArray(stored.visibleSections)) {
    return presentationForTemplate(id, stored);
  }
  const config = configCustomization && typeof configCustomization === "object" ? configCustomization : {};
  return presentationForTemplate(id, config);
}

function rollbackPresentation(revisionPresentation, templateId) {
  const id = templateId || "magicui-portfolio";
  const stored = revisionPresentation && typeof revisionPresentation === "object" ? revisionPresentation : null;
  if (stored && Array.isArray(stored.visibleSections)) {
    return presentationForTemplate(id, stored);
  }
  return presentationForTemplate(id, {});
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
  partitionPublication,
  retainedProfileKeys,
  sanitizeStoredText,
  presentationForTemplate,
  publishedCustomization,
  rollbackPresentation,
  reorderEntries,
};

});
