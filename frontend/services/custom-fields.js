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
    { type: "heading", label: "Heading" },
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
  const TEXT_TYPES = { text: true, textarea: true, select: true };
  const TAG_TYPES = { tags: true, multiselect: true };

  function mapField(key, label, kind) {
    return { key, label, kind };
  }

  const MAPPABLE = {
    student: {
      education: [mapField("fieldOfStudy", "Field of study", "text"), mapField("specialization", "Specialization", "text"), mapField("honors", "Honors", "text"), mapField("coursework", "Coursework", "text"), mapField("location", "Location", "text"), mapField("website", "Website", "url"), mapField("startDate", "Start date", "date"), mapField("endDate", "End date", "date")],
      projects: [mapField("shortDescription", "Short description", "text"), mapField("detailedDescription", "Detailed description", "text"), mapField("role", "Role", "text"), mapField("repoUrl", "Repository URL", "url"), mapField("liveUrl", "Live URL", "url"), mapField("docsUrl", "Docs URL", "url"), mapField("websiteUrl", "Website URL", "url"), mapField("videoUrl", "Video URL", "url"), mapField("startDate", "Start date", "date"), mapField("endDate", "End date", "date")],
      skills: [mapField("yearsExperience", "Years of experience", "number")],
      credentials: [mapField("issuer", "Issuer", "text"), mapField("credentialId", "Credential ID", "text"), mapField("description", "Description", "text"), mapField("credentialUrl", "Credential URL", "url"), mapField("verificationUrl", "Verification URL", "url"), mapField("issueDate", "Issue date", "date"), mapField("expirationDate", "Expiration date", "date"), mapField("neverExpires", "Never expires", "boolean"), mapField("relatedSkills", "Related skills", "tags")],
      achievements: [mapField("organization", "Organization", "text"), mapField("description", "Description", "text"), mapField("awardPrize", "Award", "text"), mapField("proofUrl", "Proof URL", "url"), mapField("certificateUrl", "Certificate URL", "url"), mapField("date", "Date", "date")],
      media: [mapField("description", "Description", "text"), mapField("altText", "Alt text", "text"), mapField("mediaUrl", "Media URL", "url")],
      contacts: [mapField("city", "City", "text"), mapField("country", "Country", "text"), mapField("github", "GitHub", "url"), mapField("linkedin", "LinkedIn", "url"), mapField("portfolio", "Portfolio URL", "url")],
      links: [mapField("platform", "Platform", "text"), mapField("username", "Username", "text"), mapField("url", "URL", "url")],
    },
    professional: {
      currentEmployment: [mapField("company", "Company", "text"), mapField("jobTitle", "Job title", "text"), mapField("location", "Location", "text"), mapField("startDate", "Start date", "date"), mapField("endDate", "End date", "date"), mapField("isCurrent", "Current role", "boolean")],
      employmentHistory: [mapField("company", "Company", "text"), mapField("jobTitle", "Job title", "text"), mapField("location", "Location", "text"), mapField("startDate", "Start date", "date"), mapField("endDate", "End date", "date"), mapField("isCurrent", "Current role", "boolean")],
      skills: [mapField("yearsExperience", "Years of experience", "number")],
      certifications: [mapField("issuer", "Issuer", "text"), mapField("credentialId", "Credential ID", "text"), mapField("credentialUrl", "Credential URL", "url"), mapField("issueDate", "Issue date", "date"), mapField("expirationDate", "Expiration date", "date")],
      education: [mapField("fieldOfStudy", "Field of study", "text"), mapField("startDate", "Start date", "date"), mapField("endDate", "End date", "date")],
      portfolio: [mapField("description", "Description", "text"), mapField("role", "Role", "text"), mapField("url", "URL", "url")],
      achievements: [mapField("description", "Description", "text"), mapField("organization", "Organization", "text"), mapField("evidenceUrl", "Evidence URL", "url"), mapField("date", "Date", "date")],
      socialLinks: [mapField("label", "Label", "text"), mapField("url", "URL", "url")],
      contact: [mapField("city", "City", "text"), mapField("country", "Country", "text"), mapField("linkedin", "LinkedIn", "url"), mapField("website", "Website", "url")],
    },
    freelancer: {
      services: [mapField("description", "Description", "text")],
      workExperience: [mapField("description", "Description", "text"), mapField("startDate", "Start date", "date"), mapField("endDate", "End date", "date"), mapField("isCurrent", "Current role", "boolean")],
      skills: [mapField("yearsExperience", "Years of experience", "number")],
      portfolio: [mapField("summary", "Summary", "text"), mapField("outcome", "Outcome", "text"), mapField("url", "URL", "url")],
      testimonials: [mapField("relationship", "Relationship", "text")],
      workSamples: [mapField("url", "URL", "url")],
    },
    creator: {
      featuredContent: [mapField("summary", "Summary", "text"), mapField("category", "Category", "text"), mapField("url", "URL", "url"), mapField("publishedAt", "Published date", "date")],
      channels: [mapField("handle", "Handle", "text"), mapField("url", "URL", "url")],
      pastCollaborations: [mapField("description", "Description", "text"), mapField("outcome", "Outcome", "text"), mapField("url", "URL", "url"), mapField("date", "Date", "date")],
    },
    business: {
      products: [mapField("description", "Description", "text"), mapField("url", "URL", "url")],
      credentials: [mapField("issuer", "Issuer", "text"), mapField("description", "Description", "text"), mapField("evidenceUrl", "Evidence URL", "url"), mapField("issueDate", "Issue date", "date"), mapField("expirationDate", "Expiration date", "date")],
      services: [mapField("description", "Description", "text")],
      team: [mapField("role", "Role", "text")],
      caseStudies: [mapField("summary", "Summary", "text"), mapField("url", "URL", "url")],
      resources: [mapField("url", "URL", "url")],
      publicContact: [mapField("city", "City", "text"), mapField("country", "Country", "text")],
    },
  };

  function typeMatchesKind(type, kind) {
    if (kind === "text") return !!TEXT_TYPES[type];
    if (kind === "tags") return !!TAG_TYPES[type];
    return type === kind;
  }

  function mappableFields(identity, sectionKey, type) {
    const table = (MAPPABLE[identity] && MAPPABLE[identity][sectionKey]) || [];
    return table.filter((field) => typeMatchesKind(type, field.kind));
  }

  const EDITOR_SECTIONS = {
    student: {
      education: { key: "education", label: "Education", repeatable: true },
      projects: { key: "projects", label: "Projects", repeatable: true },
      skills: { key: "skills", label: "Skills", repeatable: true },
      credentials: { key: "credentials", label: "Credentials", repeatable: true },
      achievements: { key: "achievements", label: "Achievements", repeatable: true },
      resume: { key: "resume", label: "Resume", repeatable: false },
      media: { key: "media", label: "Media", repeatable: true },
      links: { key: "links", label: "Links", repeatable: true },
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

  function fieldsForRecord(section, recordId) {
    return activeFields(section).filter((field) => field.scope !== "record" || field.targetRecordId === recordId);
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

  function normalizeAttachment(draft, section, existing) {
    const scope = draft && (draft.scope === "record" || draft.scope === "section")
      ? draft.scope
      : (existing && existing.scope === "record" ? "record" : "section");
    const targetRecordId = draft && Object.prototype.hasOwnProperty.call(draft, "targetRecordId")
      ? String(draft.targetRecordId || "").trim()
      : ((existing && existing.targetRecordId) || "");
    const mapsTo = draft && Object.prototype.hasOwnProperty.call(draft, "mapsTo")
      ? String(draft.mapsTo || "").trim()
      : ((existing && existing.mapsTo) || "");
    if (!section || !section.builtinKey) {
      if (scope === "record" || targetRecordId) {
        return { error: "A custom section uses its own records. Link an existing record from a built-in section." };
      }
      if (mapsTo) return { error: "A custom section cannot map onto a built-in field." };
      return { error: "", scope: "section", targetRecordId: "", mapsTo: "" };
    }
    if (scope === "record") {
      if (!section.repeatable) return { error: "This section has one set of values. Attach the field to the whole section." };
      if (!targetRecordId) return { error: "Choose the record this field belongs to." };
      if (Array.isArray(draft.records) && !draft.records.some((record) => record && String(record.id) === targetRecordId)) {
        return { error: "That record is not on this profile." };
      }
    } else if (targetRecordId) {
      return { error: "A whole-section field cannot target one record." };
    }
    if (mapsTo) {
      if (draft && draft.identity) {
        const options = mappableFields(draft.identity, section.builtinKey, (draft && draft.type) || (existing && existing.type));
        if (!options.some((field) => field.key === mapsTo)) {
          return { error: "That built-in field does not match this custom field." };
        }
      } else if (!existing || existing.mapsTo !== mapsTo) {
        return { error: "That built-in field does not match this custom field." };
      }
    }
    return {
      error: "",
      scope,
      targetRecordId: scope === "record" ? targetRecordId : "",
      mapsTo,
    };
  }

  function addField(layout, sectionId, draft) {
    const message = validateFieldDraft(draft);
    if (message) return { layout, error: message };
    const currentSection = findSection(layoutOf(layout), sectionId);
    const attachment = normalizeAttachment(draft, currentSection);
    if (attachment.error) return { layout, error: attachment.error };
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
          scope: attachment.scope,
          targetRecordId: attachment.targetRecordId,
          mapsTo: attachment.mapsTo,
        });
      }),
      error: "",
    };
  }

  function updateField(layout, sectionId, fieldId, draft) {
    const message = validateFieldDraft(draft, true);
    if (message) return { layout, error: message };
    const currentSection = findSection(layoutOf(layout), sectionId);
    const currentField = currentSection && currentSection.fields.find((item) => item.id === fieldId);
    const attachment = normalizeAttachment(Object.assign({ type: currentField && currentField.type }, draft), currentSection, currentField);
    if (attachment.error) return { layout, error: attachment.error };
    return {
      layout: withLayout(layout, (next) => {
        const section = findSection(next, sectionId);
        if (!section) return;
        const field = section.fields.find((item) => item.id === fieldId);
        if (!field) return;
        const previousTarget = field.targetRecordId || "";
        field.label = String(draft.label || "").trim();
        field.required = !!draft.required;
        field.visibility = draft.visibility === "private" ? "private" : "public";
        field.helpText = String(draft.helpText || "").trim();
        field.placeholder = String(draft.placeholder || "").trim();
        field.config = draft.config || field.config;
        field.scope = attachment.scope;
        field.targetRecordId = attachment.targetRecordId;
        field.mapsTo = attachment.mapsTo;
        field.updatedAt = new Date().toISOString();
        if (attachment.scope === "record" && previousTarget && previousTarget !== attachment.targetRecordId) {
          moveFieldValue(next, section.id, field.id, previousTarget, attachment.targetRecordId);
        }
      }),
      error: "",
    };
  }

  function moveFieldValue(layout, sectionId, fieldId, fromId, toId) {
    const from = layout.bindings.find((item) => item.sectionId === sectionId && item.recordId === fromId);
    if (!from || !from.values || !Object.prototype.hasOwnProperty.call(from.values, fieldId)) return;
    const value = from.values[fieldId];
    delete from.values[fieldId];
    let to = layout.bindings.find((item) => item.sectionId === sectionId && item.recordId === toId);
    if (!to) {
      to = { sectionId, recordId: toId, values: {} };
      layout.bindings.push(to);
    }
    to.values = to.values || {};
    to.values[fieldId] = value;
  }

  function unlinkField(layout, sectionId, fieldId) {
    return withLayout(layout, (next) => {
      const section = findSection(next, sectionId);
      if (!section) return;
      const field = section.fields.find((item) => item.id === fieldId);
      if (!field) return;
      field.scope = "section";
      field.targetRecordId = "";
      field.mapsTo = "";
      field.updatedAt = new Date().toISOString();
    });
  }

  function setFieldTarget(layout, sectionId, fieldId, recordId, records) {
    const section = findSection(layoutOf(layout), sectionId);
    const field = section && section.fields.find((item) => item.id === fieldId);
    if (!field) return { layout, error: "That field is no longer on this section." };
    return updateField(layout, sectionId, fieldId, {
      label: field.label,
      type: field.type,
      required: field.required,
      visibility: field.visibility,
      helpText: field.helpText,
      placeholder: field.placeholder,
      config: field.config,
      scope: "record",
      targetRecordId: recordId,
      mapsTo: field.mapsTo || "",
      records: records,
    });
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


  function createRecordField(type, label) {
    const defaultLabels = {
      heading: "Section Heading",
      text: "Custom Field",
      textarea: "Additional Details",
      url: "Web Link",
      image: "Custom Image",
      file: "Attachment",
      tags: "Keywords",
      number: "Metric",
      date: "Date",
      boolean: "Feature Enabled",
      select: "Category",
    };
    const fType = type || "text";
    return {
      id: "fld_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7),
      label: (typeof label === "string" && label.trim()) || defaultLabels[fType] || "Custom Field",
      type: fType,
      visibility: "public",
      order: 0,
      value: null,
    };
  }

  function updateRecordField(fields, fieldId, patch) {
    if (!Array.isArray(fields)) return [];
    return fields.map((f) => (f.id === fieldId ? Object.assign({}, f, patch) : f));
  }

  function removeRecordField(fields, fieldId) {
    if (!Array.isArray(fields)) return [];
    return fields.filter((f) => f.id !== fieldId).map((f, idx) => Object.assign({}, f, { order: idx }));
  }

  function reorderRecordFields(fields, fieldId, direction) {
    if (!Array.isArray(fields)) return [];
    const index = fields.findIndex((f) => f.id === fieldId);
    if (index === -1) return fields;
    const target = index + direction;
    if (target < 0 || target >= fields.length) return fields;
    const copy = fields.slice();
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    return copy.map((f, idx) => Object.assign({}, f, { order: idx }));
  }

  return {
    FIELD_TYPES,
    createRecordField,
    updateRecordField,
    removeRecordField,
    reorderRecordFields,
    EDITOR_SECTIONS,
    MAGICUI,
    builtinFor,
    emptyLayout,
    layoutOf,
    sectionByBuiltin,
    userSections,
    activeFields,
    fieldsForRecord,
    mappableFields,
    defaultConfig,
    ensureBuiltin,
    addField,
    updateField,
    unlinkField,
    setFieldTarget,
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
