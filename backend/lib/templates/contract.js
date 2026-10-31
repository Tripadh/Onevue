/**
 * Template-neutral content catalog and the approved template registry.
 * User content is stored on identity profiles and publication snapshots.
 * A template only declares what it can display. It does not own the content.
 *
 * magicui-portfolio is the only registered template, and it is a test adapter.
 */

const identityWebsite = require("../website/identity-contract");

const IDENTITIES = identityWebsite.IDENTITIES;
const CONTENT_SECTIONS = identityWebsite.CONTENT_SECTIONS;
const RETAINED_PUBLIC_FIELDS = identityWebsite.RETAINED_PUBLIC_FIELDS;

/** `profile` is rendered by the template shell, not a toggleable section. */
const MAGICUI_SUPPORTED_SECTIONS = ["profile"].concat(identityWebsite.RENDERER_SECTION_IDS);

/** Custom-field presentations the template can draw. */
const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "url",
  "date",
  "boolean",
  "select",
  "multiselect",
  "tags",
  "image",
  "gallery",
  "video",
  "file",
];

/**
 * Legacy ordering used only when no identity is supplied (older callers and
 * stored configurations written before the identity contract existed).
 * Identity-aware callers receive the canonical order from identity-contract.js.
 */
const LEGACY_DEFAULT_SECTION_ORDER = ["about", "work", "education", "skills", "projects", "achievements", "contact"];
const DEFAULT_SECTION_ORDER = LEGACY_DEFAULT_SECTION_ORDER;

const MAGICUI = {
  id: "magicui-portfolio",
  version: "1.0.0",
  name: "Magic UI Portfolio",
  role: "test-adapter",
  description:
    "Test adapter used to exercise publishing. It is not the permanent OneVue template library. Profile content stays stored when this adapter cannot display it.",
  supportedSections: MAGICUI_SUPPORTED_SECTIONS,
  supportedBlocks: ["text", "richText", "link", "repeatable", "media", "choice"],
  supportedFieldTypes: CUSTOM_FIELD_TYPES,
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

const KNOWN_FIELD_TYPES = new Set(CUSTOM_FIELD_TYPES);

/**
 * A template may only declare sections, identities, and field types that the
 * contract knows about. An invalid registry cannot be served or persisted.
 */
function validateTemplateRegistry() {
  const rendererSections = new Set(MAGICUI_SUPPORTED_SECTIONS);
  const ids = new Set();
  TEMPLATES.forEach((template) => {
    if (ids.has(template.id)) throw new Error(`Duplicate template id '${template.id}'.`);
    ids.add(template.id);
    template.supportedSections.forEach((id) => {
      if (!rendererSections.has(id)) throw new Error(`Template '${template.id}' declares unknown section '${id}'.`);
    });
    template.identities.forEach((identity) => {
      if (!isKnownIdentity(identity)) throw new Error(`Template '${template.id}' declares unknown identity '${identity}'.`);
    });
    template.supportedFieldTypes.forEach((type) => {
      if (!KNOWN_FIELD_TYPES.has(type)) throw new Error(`Template '${template.id}' declares unknown field type '${type}'.`);
    });
  });
  return true;
}

validateTemplateRegistry();

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

function isKnownIdentity(identity) {
  return typeof identity === "string" && Boolean(identityWebsite.IDENTITY_META[identity]);
}

function identityAllowedSections(identity, template) {
  return identityWebsite.sectionControlsFor(identity)
    .filter((section) => template.supportedSections.indexOf(section.id) !== -1)
    .map((section) => section.id);
}

const LEGACY_SECTION_ALIASES = (() => {
  const aliases = new Set(["work", "achievements"]);
  identityWebsite.SECTION_CATALOG.forEach((section) => {
    section.legacyIds.forEach((id) => aliases.add(id));
  });
  return aliases;
})();

/**
 * A known section can be missing for this identity or template because the
 * configuration was written before the identity contract existed. Those are
 * migrated by normalization. Only ids that are not sections at all are errors.
 */
function unknownIdentitySections(values, allowed) {
  const allowedLower = new Set(allowed.map((id) => String(id).toLowerCase()));
  return values.filter((value) => {
    const id = String(value || "").toLowerCase().trim();
    if (LEGACY_SECTION_ALIASES.has(id)) return false;
    if (identityWebsite.canonicalSectionId(id)) return false;
    return !allowedLower.has(id);
  });
}

function presentationForTemplate(templateId, customization, identity) {
  const template = getTemplate(templateId);
  if (!template) {
    throw new Error("Template '" + templateId + "' is not registered.");
  }
  const identityAware = isKnownIdentity(identity);
  const allowed = identityAware
    ? identityAllowedSections(identity, template)
    : template.visibilityControls.map((item) => item.id);
  const fallbackOrder = identityAware
    ? identityWebsite.defaultOrderFor(identity).filter((id) => allowed.indexOf(id) !== -1)
    : uniqueAllowed(template.defaultSectionOrder || allowed, allowed);
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

  const defaultVisible = (identityAware
    ? identityWebsite.defaultVisibleFor(identity)
    : ["about", "education", "projects", "skills", "achievements", "contact"]
  ).filter((id) => allowed.indexOf(id) !== -1);
  let visibleSections = defaultVisible.slice();
  if (source.visibleSections !== undefined) {
    if (!Array.isArray(source.visibleSections)) {
      throw new Error("visibleSections must be a list of section ids.");
    }
    if (!template.presentation.sectionVisibility) {
      throw new Error("This template does not hide sections.");
    }
    if (identityAware) {
      const unknown = unknownIdentitySections(source.visibleSections, allowed);
      if (unknown.length) {
        throw new Error("Unsupported section visibility: " + unknown.join(", ") + ".");
      }
      visibleSections = identityWebsite
        .normalizeVisibleSections(identity, source.visibleSections)
        .filter((id) => allowed.indexOf(id) !== -1);
    } else {
      const unknown = source.visibleSections.filter((id) => allowed.indexOf(String(id)) === -1);
      if (unknown.length) {
        throw new Error("Unsupported section visibility: " + unknown.join(", ") + ".");
      }
      visibleSections = uniqueAllowed(source.visibleSections, allowed);
    }
  }

  let sectionOrder = fallbackOrder.slice();
  if (source.sectionOrder !== undefined) {
    if (!Array.isArray(source.sectionOrder)) {
      throw new Error("sectionOrder must be a list of section ids.");
    }
    if (!template.presentation.sectionOrder) {
      throw new Error("This template does not reorder sections.");
    }
    if (identityAware) {
      const unknownOrder = unknownIdentitySections(source.sectionOrder, allowed);
      if (unknownOrder.length) {
        throw new Error("Unsupported section order: " + unknownOrder.join(", ") + ".");
      }
      sectionOrder = identityWebsite
        .normalizeSectionOrder(identity, source.sectionOrder)
        .filter((id) => allowed.indexOf(id) !== -1);
    } else {
      const unknownOrder = source.sectionOrder.filter((id) => allowed.indexOf(String(id)) === -1);
      if (unknownOrder.length) {
        throw new Error("Unsupported section order: " + unknownOrder.join(", ") + ".");
      }
      sectionOrder = uniqueAllowed(source.sectionOrder, allowed);
      fallbackOrder.forEach((id) => {
        if (sectionOrder.indexOf(id) === -1) sectionOrder.push(id);
      });
    }
  }

  return {
    accentColor,
    themeMode,
    visibleSections,
    sectionOrder,
  };
}

function publishedCustomization(revisionPresentation, configCustomization, templateId, identity) {
  const id = templateId || "magicui-portfolio";
  const stored = revisionPresentation && typeof revisionPresentation === "object" ? revisionPresentation : null;
  if (stored && Array.isArray(stored.visibleSections)) {
    return presentationForTemplate(id, stored, identity);
  }
  const config = configCustomization && typeof configCustomization === "object" ? configCustomization : {};
  return presentationForTemplate(id, config, identity);
}

function rollbackPresentation(revisionPresentation, templateId, identity) {
  const id = templateId || "magicui-portfolio";
  const stored = revisionPresentation && typeof revisionPresentation === "object" ? revisionPresentation : null;
  if (stored && Array.isArray(stored.visibleSections)) {
    return presentationForTemplate(id, stored, identity);
  }
  return presentationForTemplate(id, {}, identity);
}

function listIdentityContracts(templateId) {
  const id = templateId || "magicui-portfolio";
  const template = getTemplate(id);
  if (!template) {
    throw new Error("Template '" + id + "' is not registered.");
  }
  return identityWebsite.allIdentityContracts(template);
}

function getIdentityContract(identity, templateId) {
  const id = templateId || "magicui-portfolio";
  const template = getTemplate(id);
  if (!template) {
    throw new Error("Template '" + id + "' is not registered.");
  }
  return identityWebsite.identityContract(identity, template);
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

const api = {
  IDENTITIES,
  CONTENT_SECTIONS,
  RETAINED_PUBLIC_FIELDS,
  CUSTOM_FIELD_TYPES,
  APPROVED_TEMPLATE_IDS: TEMPLATES.map((template) => template.id),
  listTemplates,
  getTemplate,
  validateTemplateRegistry,
  contentForIdentity,
  partitionPublication,
  retainedProfileKeys,
  sanitizeStoredText,
  presentationForTemplate,
  publishedCustomization,
  rollbackPresentation,
  listIdentityContracts,
  getIdentityContract,
  reorderEntries,
};
api.default = api;
module.exports = api;
