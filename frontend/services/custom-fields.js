/**
 * Browser-side custom field helpers. The API validates every save again.
 * Field ids stay stable when a label changes. Nothing here executes user input.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.OV = root.OV || {};
    root.OV.customFields = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FIELD_TYPES = [
    { type: "text", label: "Text" },
    { type: "textarea", label: "Long text" },
    { type: "number", label: "Number" },
    { type: "url", label: "Link" },
    { type: "date", label: "Date" },
    { type: "boolean", label: "Yes / no" },
    { type: "select", label: "Dropdown" },
    { type: "multiselect", label: "Multiple choice" },
    { type: "tags", label: "Tags" },
    { type: "image", label: "Image" },
    { type: "gallery", label: "Image gallery" },
    { type: "video", label: "Video link" },
    { type: "file", label: "File" },
  ];

  const MEDIA_TYPES = { image: true, gallery: true, video: true, file: true };
  const MAGICUI = "magicui-portfolio";

  const EDITOR_SECTIONS = {
    student: {
      education: { key: "education", label: "Education", repeatable: true },
      projects: { key: "projects", label: "Projects", repeatable: true },
      skills: { key: "skills", label: "Skills", repeatable: true },
      credentials: { key: "credentials", label: "Credentials", repeatable: true },
      achievements: { key: "achievements", label: "Achievements", repeatable: true },
      resume: { key: "resume", label: "Resume", repeatable: false },
      media: { key: "media", label: "Media", repeatable: true },
      contacts: { key: "contacts", label: "Contacts", repeatable: false },
    },
    professional: {
      current: { key: "currentEmployment", label: "Current employment", repeatable: false },
      history: { key: "employmentHistory", label: "Employment history", repeatable: true },
      skills: { key: "skills", label: "Skills", repeatable: true },
      certs: { key: "certifications", label: "Certifications", repeatable: true },
      education: { key: "education", label: "Education", repeatable: true },
      portfolio: { key: "portfolio", label: "Portfolio", repeatable: true },
      achievements: { key: "achievements", label: "Achievements", repeatable: true },
      social: { key: "socialLinks", label: "Social links", repeatable: true },
      resume: { key: "resume", label: "Resume", repeatable: false },
      contact: { key: "contact", label: "Contact", repeatable: false },
    },
    freelancer: {
      services: { key: "services", label: "Services", repeatable: true },
      experience: { key: "workExperience", label: "Experience", repeatable: true },
      skills: { key: "skills", label: "Skills", repeatable: true },
      portfolio: { key: "portfolio", label: "Portfolio", repeatable: true },
      testimonials: { key: "testimonials", label: "Testimonials", repeatable: true },
      samples: { key: "workSamples", label: "Work samples", repeatable: true },
      contact: { key: "contact", label: "Contact", repeatable: false },
    },
    creator: {
      featured: { key: "featuredContent", label: "Featured content", repeatable: true },
      channels: { key: "channels", label: "Channels", repeatable: true },
      kit: { key: "mediaKit", label: "Media kit", repeatable: false },
      past: { key: "pastCollaborations", label: "Past collaborations", repeatable: true },
      audience: { key: "audienceStats", label: "Audience statistics", repeatable: true },
      contact: { key: "contact", label: "Contact", repeatable: false },
    },
    business: {
      brand: { key: "branding", label: "Branding", repeatable: false },
      products: { key: "products", label: "Products", repeatable: true },
      credentials: { key: "credentials", label: "Credentials", repeatable: true },
      services: { key: "services", label: "Services", repeatable: true },
      team: { key: "team", label: "Team", repeatable: true },
      cases: { key: "caseStudies", label: "Case studies", repeatable: true },
      resources: { key: "resources", label: "Resources", repeatable: true },
      contact: { key: "publicContact", label: "Contact", repeatable: false },
    },
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createId(prefix) {
    const bytes = new Uint8Array(8);
    if (rootCrypto()) rootCrypto().getRandomValues(bytes);
    else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    let hex = "";
    for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
    return prefix + "_" + hex;
  }

  function rootCrypto() {
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) return globalThis.crypto;
    return null;
  }

  function emptyLayout() {
    return { schemaVersion: 1, revision: 0, sections: [], bindings: [], entries: [] };
  }

  function layoutOf(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.sections)) return emptyLayout();
    return value;
  }

  function slug(label) {
    const text = String(label || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    return /^[a-z]/.test(text) ? text : ("field_" + text).replace(/_+$/g, "").slice(0, 40) || "field";
  }

  function uniqueKey(base, taken) {
    let key = base || "field";
    let n = 2;
    while (taken[key]) {
      const suffix = "_" + n;
      key = base.slice(0, 40 - suffix.length) + suffix;
      n += 1;
    }
    taken[key] = true;
    return key;
  }

  function builtinFor(identity, sectionId) {
    const table = EDITOR_SECTIONS[identity] || {};
    return table[sectionId] || null;
  }

  function sectionByBuiltin(layout, key) {
    return layoutOf(layout).sections.find((section) => section && section.builtinKey === key) || null;
  }

  function userSections(layout) {
    return layoutOf(layout).sections.filter((section) => section && !section.builtinKey);
  }

  function activeFields(section) {
    if (!section || !Array.isArray(section.fields)) return [];
    return section.fields.filter((field) => field && !field.retired).slice().sort((a, b) => a.order - b.order);
  }

  function defaultConfig(type) {
    if (type === "text") return { minLength: 0, maxLength: 200 };
    if (type === "textarea") return { minLength: 0, maxLength: 2000 };
    if (type === "number") return { integer: false };
    if (type === "select" || type === "multiselect") {
      const config = { options: [{ value: "option_1", label: "Option 1" }, { value: "option_2", label: "Option 2" }] };
      if (type === "multiselect") config.maxSelections = 2;
      return config;
    }
    if (type === "tags") return { maxItems: 10, itemMaxLength: 40 };
    if (type === "image" || type === "gallery") {
      const config = { accept: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024 };
      if (type === "gallery") config.maxItems = 6;
      return config;
    }
    if (type === "file") {
      return { accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"], maxBytes: 8 * 1024 * 1024 };
    }
    return {};
  }

  function withLayout(layout, mutate) {
    const next = clone(layoutOf(layout));
    mutate(next);
    return next;
  }

  function ensureBuiltin(layout, spec) {
    return withLayout(layout, (next) => {
      if (next.sections.some((section) => section.builtinKey === spec.key)) return;
      const taken = {};
      next.sections.forEach((section) => { taken[section.key] = true; });
      next.sections.push({
        id: createId("sec"),
        key: uniqueKey(slug(spec.label), taken),
        title: spec.label,
        description: "",
        builtinKey: spec.key,
        visibility: "public",
        order: next.sections.length,
        repeatable: !!spec.repeatable,
        hidden: false,
        fields: [],
      });
    });
  }

  function findSection(layout, sectionId) {
    return layout.sections.find((section) => section.id === sectionId) || null;
  }

  function addField(layout, sectionId, draft) {
    const message = validateFieldDraft(draft);
    if (message) return { layout, error: message };
    return {
      layout: withLayout(layout, (next) => {
        const section = findSection(next, sectionId);
        if (!section) return;
        const taken = {};
        section.fields.forEach((field) => { taken[field.key] = true; });
        const now = new Date().toISOString();
        section.fields.push({
          id: createId("fld"),
          key: uniqueKey(slug(draft.label), taken),
          label: String(draft.label || "").trim(),
          type: draft.type,
          required: !!draft.required,
          visibility: draft.visibility === "private" ? "private" : "public",
          order: section.fields.length,
          helpText: String(draft.helpText || "").trim(),
          placeholder: String(draft.placeholder || "").trim(),
          retired: false,
          config: draft.config || defaultConfig(draft.type),
          createdAt: now,
          updatedAt: now,
        });
      }),
      error: "",
    };
  }

  function updateField(layout, sectionId, fieldId, draft) {
    const message = validateFieldDraft(draft, true);
    if (message) return { layout, error: message };
    return {
      layout: withLayout(layout, (next) => {
        const section = findSection(next, sectionId);
        if (!section) return;
        const field = section.fields.find((item) => item.id === fieldId);
        if (!field) return;
        field.label = String(draft.label || "").trim();
        field.required = !!draft.required;
        field.visibility = draft.visibility === "private" ? "private" : "public";
        field.helpText = String(draft.helpText || "").trim();
        field.placeholder = String(draft.placeholder || "").trim();
        field.config = draft.config || field.config;
        field.updatedAt = new Date().toISOString();
      }),
      error: "",
    };
  }

  function removeField(layout, sectionId, fieldId) {
    return withLayout(layout, (next) => {
      const section = findSection(next, sectionId);
      if (!section) return;
      section.fields = section.fields.filter((field) => field.id !== fieldId);
      section.fields.forEach((field, index) => { field.order = index; });
      next.bindings.forEach((binding) => {
        if (binding.sectionId === sectionId && binding.values) delete binding.values[fieldId];
      });
      next.entries.forEach((entry) => {
        if (entry.sectionId === sectionId && entry.values) delete entry.values[fieldId];
      });
    });
  }

  function reorderField(layout, sectionId, fieldId, direction) {
    return withLayout(layout, (next) => {
      const section = findSection(next, sectionId);
      if (!section) return;
      const visible = section.fields.filter((field) => !field.retired);
      const index = visible.findIndex((field) => field.id === fieldId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= visible.length) return;
      const moving = visible[index];
      const other = visible[target];
      const from = section.fields.findIndex((field) => field.id === moving.id);
      const to = section.fields.findIndex((field) => field.id === other.id);
      const copy = section.fields[from];
      section.fields.splice(from, 1);
      section.fields.splice(to, 0, copy);
      section.fields.forEach((field, order) => { field.order = order; });
    });
  }

  function setRetired(layout, sectionId, fieldId, retired) {
    return withLayout(layout, (next) => {
      const section = findSection(next, sectionId);
      if (!section) return;
      const field = section.fields.find((item) => item.id === fieldId);
      if (field) field.retired = !!retired;
    });
  }

  function valuesFor(layout, section, recordId) {
    const source = layoutOf(layout);
    if (!section) return {};
    if (section.repeatable && !section.builtinKey) {
      const entry = source.entries.find((item) => item.sectionId === section.id && item.id === recordId);
      return (entry && entry.values) || {};
    }
    const binding = source.bindings.find((item) => item.sectionId === section.id && item.recordId === (recordId || ""));
    return (binding && binding.values) || {};
  }

  function setValue(layout, section, recordId, fieldId, value) {
    return withLayout(layout, (next) => {
      const stored = findSection(next, section.id);
      if (!stored) return;
      if (stored.repeatable && !stored.builtinKey) {
        let entry = next.entries.find((item) => item.id === recordId);
        if (!entry) return;
        entry.values = entry.values || {};
        if (value === undefined || value === null || value === "") delete entry.values[fieldId];
        else entry.values[fieldId] = value;
        return;
      }
      const id = recordId || "";
      let binding = next.bindings.find((item) => item.sectionId === stored.id && item.recordId === id);
      if (!binding) {
        binding = { sectionId: stored.id, recordId: id, values: {} };
        next.bindings.push(binding);
      }
      if (value === undefined || value === null || value === "") delete binding.values[fieldId];
      else binding.values[fieldId] = value;
    });
  }

  function addUserSection(layout, draft) {
    const title = String((draft && draft.title) || "").trim();
    if (!title) return { layout, error: "A section title is required." };
    if (title.length > 80) return { layout, error: "Section title cannot exceed 80 characters." };
    return {
      error: "",
      layout: withLayout(layout, (next) => {
        if (next.sections.length >= 24) return;
        const taken = {};
        next.sections.forEach((section) => { taken[section.key] = true; });
        next.sections.push({
          id: createId("sec"),
          key: uniqueKey(slug(title), taken),
          title,
          description: String((draft && draft.description) || "").trim().slice(0, 300),
          builtinKey: null,
          visibility: draft && draft.visibility === "private" ? "private" : "public",
          order: next.sections.length,
          repeatable: !draft || draft.repeatable !== false,
          hidden: false,
          fields: [],
        });
      }),
    };
  }

  function updateUserSection(layout, sectionId, draft) {
    const title = String((draft && draft.title) || "").trim();
    if (!title) return { layout, error: "A section title is required." };
    return {
      error: "",
      layout: withLayout(layout, (next) => {
        const section = findSection(next, sectionId);
        if (!section || section.builtinKey) return;
        section.title = title.slice(0, 80);
        section.description = String((draft && draft.description) || "").trim().slice(0, 300);
        section.visibility = draft && draft.visibility === "private" ? "private" : "public";
        section.hidden = !!(draft && draft.hidden);
      }),
    };
  }

  function removeUserSection(layout, sectionId) {
    return withLayout(layout, (next) => {
      next.sections = next.sections.filter((section) => section.id !== sectionId);
      next.bindings = next.bindings.filter((binding) => binding.sectionId !== sectionId);
      next.entries = next.entries.filter((entry) => entry.sectionId !== sectionId);
      next.sections.forEach((section, index) => { section.order = index; });
    });
  }

  function addEntry(layout, sectionId) {
    return withLayout(layout, (next) => {
      const section = findSection(next, sectionId);
      if (!section || section.builtinKey || !section.repeatable) return;
      const count = next.entries.filter((entry) => entry.sectionId === sectionId).length;
      if (count >= 40) return;
      next.entries.push({ id: createId("ent"), sectionId, order: count, values: {} });
    });
  }

  function removeEntry(layout, entryId) {
    return withLayout(layout, (next) => {
      next.entries = next.entries.filter((entry) => entry.id !== entryId);
    });
  }

  function entriesFor(layout, sectionId) {
    return layoutOf(layout).entries.filter((entry) => entry.sectionId === sectionId);
  }

  function validateFieldDraft(draft, editing) {
    if (!draft || typeof draft !== "object") return "Describe the field before saving it.";
    const label = String(draft.label || "").trim();
    if (!label) return "A field label is required.";
    if (label.length > 80) return "Field label cannot exceed 80 characters.";
    if (!editing && !FIELD_TYPES.some((item) => item.type === draft.type)) return "Choose a supported field type.";
    if (draft.type === "select" || draft.type === "multiselect") {
      const options = draft.config && draft.config.options;
      if (!Array.isArray(options) || options.filter((option) => option && String(option.label || "").trim()).length === 0) {
        return "Add at least one option.";
      }
    }
    return "";
  }

  function compatibility(templateId, type) {
    if (templateId === MAGICUI || !templateId) {
      return { state: "supported", message: "" };
    }
    if (MEDIA_TYPES[type]) {
      return {
        state: "hidden",
        message: "This template hides this field on the public page. The value stays on your profile.",
      };
    }
    return { state: "fallback", message: "This template shows the value as plain text." };
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(String(value || "").trim());
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  return {
    FIELD_TYPES,
    EDITOR_SECTIONS,
    MAGICUI,
    builtinFor,
    emptyLayout,
    layoutOf,
    sectionByBuiltin,
    userSections,
    activeFields,
    defaultConfig,
    ensureBuiltin,
    addField,
    updateField,
    removeField,
    reorderField,
    setRetired,
    valuesFor,
    setValue,
    addUserSection,
    updateUserSection,
    removeUserSection,
    addEntry,
    removeEntry,
    entriesFor,
    validateFieldDraft,
    compatibility,
    isHttpUrl,
    slug,
  };
});
