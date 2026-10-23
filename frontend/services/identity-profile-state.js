/* Identity profile editor state. Safe to load in the browser and in Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.OV = root.OV || {};
    root.OV.identityProfileState = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const EMPLOYMENT = [
    ["full_time", "Full-time"],
    ["part_time", "Part-time"],
    ["contract", "Contract"],
    ["internship", "Internship"],
    ["self_employed", "Self-employed"],
    ["other", "Other"],
  ];
  const PROFICIENCY = ["Familiar", "Beginner", "Intermediate", "Advanced", "Expert"].map((value) => [value, value]);
  const EDUCATION = [
    ["studying", "Studying"],
    ["completed", "Completed"],
    ["paused", "Paused"],
    ["withdrawn", "Withdrawn"],
  ];
  const VISIBILITY = [
    ["private", "Private"],
    ["recruiters", "Recruiters"],
    ["public", "Public"],
  ];
  const PRICING = [
    ["fixed", "Fixed"],
    ["hourly", "Hourly"],
    ["daily", "Daily"],
    ["project", "Project"],
    ["retainer", "Retainer"],
    ["contact", "Contact for price"],
  ];
  const AVAILABILITY = [
    ["available", "Available"],
    ["limited", "Limited"],
    ["booked", "Booked"],
    ["unavailable", "Unavailable"],
  ];
  const CHANNEL = [
    ["email", "Email"],
    ["phone", "Phone"],
    ["either", "Either"],
  ];
  const FORMATS = [
    ["video", "Video"],
    ["article", "Article"],
    ["podcast", "Podcast"],
    ["newsletter", "Newsletter"],
    ["short_form", "Short form"],
    ["livestream", "Livestream"],
    ["other", "Other"],
  ];
  const METRICS = [
    ["followers", "Followers"],
    ["subscribers", "Subscribers"],
    ["views", "Views"],
    ["engagement_rate", "Engagement rate"],
    ["avg_views", "Average views"],
    ["other", "Other"],
  ];
  const SOURCES = [
    ["self_reported", "Self-reported"],
    ["platform_export", "Platform export"],
    ["third_party", "Third party"],
    ["manual", "Manual count"],
  ];
  const ORG = [
    ["", "Not specified"],
    ["sole_prop", "Sole proprietorship"],
    ["partnership", "Partnership"],
    ["llc", "LLC"],
    ["corporation", "Corporation"],
    ["nonprofit", "Nonprofit"],
    ["government", "Government"],
    ["other", "Other"],
  ];
  const RESOURCE_VIS = [
    ["private", "Private"],
    ["public", "Public"],
  ];
  const SAMPLE = [
    ["link", "Link"],
    ["image", "Image"],
    ["video", "Video"],
    ["pdf", "PDF"],
    ["audio", "Audio"],
    ["other", "Other"],
  ];

  function options(pairs) {
    return pairs.map(([value, label]) => ({ value, label }));
  }

  function field(key, label, type, extra) {
    return Object.assign({ key, label, type: type || "text" }, extra || {});
  }

  const employmentFields = [
    field("jobTitle", "Job title"),
    field("company", "Company"),
    field("employmentType", "Employment type", "select", { options: options([["", "Not specified"]].concat(EMPLOYMENT)) }),
    field("location", "Location"),
    field("startDate", "Start date", "date"),
    field("endDate", "End date", "date"),
    field("isCurrent", "I currently work in this role", "checkbox"),
    field("responsibilities", "Responsibilities (one per line)", "lines"),
    field("achievements", "Measurable achievements (one per line)", "lines"),
  ];

  const skillFields = [
    field("name", "Skill"),
    field("proficiency", "Proficiency", "select", { options: options(PROFICIENCY) }),
    field("yearsExperience", "Years of experience", "number"),
  ];

  const FORM_SPECS = {
    professional: {
      sections: [
        {
          id: "about",
          title: "Professional profile",
          fields: [field("headline", "Headline"), field("bio", "Biography", "textarea")],
        },
        {
          id: "current",
          title: "Current employment",
          object: "currentEmployment",
          fields: employmentFields,
        },
        {
          id: "history",
          title: "Employment history",
          collection: "employmentHistory",
          fields: employmentFields,
          blank: () => ({
            jobTitle: "",
            company: "",
            employmentType: "full_time",
            location: "",
            startDate: "",
            endDate: "",
            isCurrent: false,
            responsibilities: [],
            achievements: [],
          }),
        },
        {
          id: "skills",
          title: "Skills",
          collection: "skills",
          fields: skillFields,
          blank: () => ({ name: "", proficiency: "Intermediate", yearsExperience: 0 }),
        },
        {
          id: "certs",
          title: "Certifications",
          note: "Verification status is controlled by OneVue. New credentials are self-reported.",
          collection: "certifications",
          fields: [
            field("title", "Credential"),
            field("issuer", "Issuer"),
            field("issueDate", "Issue date", "date"),
            field("expirationDate", "Expiration date", "date"),
            field("credentialUrl", "Credential URL", "url"),
            field("credentialId", "Credential ID"),
          ],
          blank: () => ({ title: "", issuer: "", issueDate: "", expirationDate: "", credentialUrl: "", credentialId: "" }),
        },
        {
          id: "education",
          title: "Education",
          collection: "education",
          fields: [
            field("institution", "Institution"),
            field("degree", "Degree"),
            field("fieldOfStudy", "Field of study"),
            field("startDate", "Start date", "date"),
            field("endDate", "End date", "date"),
            field("currentStatus", "Status", "select", { options: options(EDUCATION) }),
          ],
          blank: () => ({ institution: "", degree: "", fieldOfStudy: "", startDate: "", endDate: "", currentStatus: "studying" }),
        },
        {
          id: "portfolio",
          title: "Portfolio",
          collection: "portfolio",
          fields: [
            field("title", "Title"),
            field("role", "Your role"),
            field("url", "Link", "url"),
            field("description", "Description", "textarea"),
          ],
          blank: () => ({ title: "", role: "", url: "", description: "" }),
        },
        {
          id: "resume",
          title: "Resume metadata",
          note: "The storage reference stays on your private profile and is not part of a public page.",
          object: "resume",
          fields: [
            field("fileName", "File name"),
            field("targetRole", "Target role"),
            field("contentType", "Content type", "select", { options: options([["", "Not set"], ["application/pdf", "PDF"]]) }),
            field("storageKey", "Private storage reference"),
          ],
        },
        {
          id: "contact",
          title: "Contact and visibility",
          object: "contact",
          fields: [
            field("email", "Contact email", "email"),
            field("phone", "Phone"),
            field("city", "City"),
            field("country", "Country"),
            field("linkedin", "LinkedIn URL", "url"),
            field("website", "Website", "url"),
            field("visibility.email", "Email visibility", "select", { options: options(VISIBILITY) }),
            field("visibility.phone", "Phone visibility", "select", { options: options(VISIBILITY) }),
          ],
        },
      ],
    },
    freelancer: {
      sections: [
        {
          id: "about",
          title: "Freelancer profile",
          fields: [
            field("headline", "Headline"),
            field("specialization", "Specialization"),
            field("bio", "Biography", "textarea"),
            field("availability", "Availability", "select", { options: options(AVAILABILITY) }),
          ],
        },
        {
          id: "services",
          title: "Services",
          collection: "services",
          fields: [
            field("name", "Service"),
            field("description", "Description", "textarea"),
            field("pricingModel", "Pricing model", "select", { options: options(PRICING) }),
            field("currency", "Currency"),
            field("rateMin", "Minimum rate", "number"),
            field("rateMax", "Maximum rate", "number"),
            field("deliveryDays", "Delivery timeline (days)", "number"),
          ],
          blank: () => ({ name: "", description: "", pricingModel: "hourly", currency: "USD", deliveryDays: 7 }),
        },
        {
          id: "skills",
          title: "Skills",
          collection: "skills",
          fields: skillFields,
          blank: () => ({ name: "", proficiency: "Intermediate", yearsExperience: 0 }),
        },
        {
          id: "tech",
          title: "Technologies",
          fields: [field("technologies", "Technologies (one per line)", "lines")],
        },
        {
          id: "portfolio",
          title: "Portfolio and case studies",
          collection: "portfolio",
          fields: [
            field("title", "Title"),
            field("summary", "Summary", "textarea"),
            field("outcome", "Outcome"),
            field("url", "Link", "url"),
          ],
          blank: () => ({ title: "", summary: "", outcome: "", url: "" }),
        },
        {
          id: "testimonials",
          title: "Testimonials",
          note: "Testimonials you enter are self-reported. OneVue does not mark them verified unless that status already exists on the record.",
          collection: "testimonials",
          fields: [
            field("quote", "Quote", "textarea"),
            field("authorName", "Client name"),
            field("relationship", "Relationship"),
          ],
          blank: () => ({ quote: "", authorName: "", relationship: "" }),
        },
        {
          id: "samples",
          title: "Work samples",
          collection: "workSamples",
          fields: [
            field("title", "Title"),
            field("url", "URL", "url"),
            field("mediaType", "Type", "select", { options: options(SAMPLE) }),
          ],
          blank: () => ({ title: "", url: "", mediaType: "link" }),
        },
        {
          id: "contact",
          title: "Contact preferences",
          object: "contact",
          fields: [
            field("email", "Email", "email"),
            field("phone", "Phone"),
            field("preferredChannel", "Preferred channel", "select", { options: options(CHANNEL) }),
            field("visibility.email", "Email visibility", "select", { options: options(VISIBILITY) }),
            field("visibility.phone", "Phone visibility", "select", { options: options(VISIBILITY) }),
          ],
        },
      ],
    },
    creator: {
      sections: [
        {
          id: "about",
          title: "Creator profile",
          fields: [field("niche", "Niche"), field("bio", "Biography", "textarea")],
        },
        {
          id: "featured",
          title: "Featured content",
          collection: "featuredContent",
          fields: [
            field("title", "Title"),
            field("url", "URL", "url"),
            field("format", "Format", "select", { options: options(FORMATS) }),
            field("category", "Category"),
            field("publishedAt", "Published date", "date"),
            field("summary", "Summary", "textarea"),
          ],
          blank: () => ({ title: "", url: "", format: "video", category: "", publishedAt: "", summary: "" }),
        },
        {
          id: "channels",
          title: "Channels",
          collection: "channels",
          fields: [field("platform", "Platform"), field("handle", "Handle"), field("url", "URL", "url")],
          blank: () => ({ platform: "", handle: "", url: "" }),
        },
        {
          id: "categories",
          title: "Categories and formats",
          fields: [
            field("contentCategories", "Categories (one per line)", "lines"),
            field("contentFormats", "Formats: video, article, podcast, newsletter, short_form, livestream, other", "lines"),
          ],
        },
        {
          id: "kit",
          title: "Media kit",
          object: "mediaKit",
          fields: [field("summary", "Summary", "textarea"), field("kitUrl", "Media kit URL", "url")],
        },
        {
          id: "collab",
          title: "Collaboration",
          object: "collaboration",
          fields: [
            field("openToCollab", "Open to collaboration", "checkbox"),
            field("preferences", "Preferences", "textarea"),
            field("brandSafetyNotes", "Brand-safety notes", "textarea"),
          ],
        },
        {
          id: "sponsor",
          title: "Sponsorship",
          object: "sponsorship",
          fields: [
            field("available", "Available for sponsorship", "checkbox"),
            field("currency", "Currency"),
            field("rateMin", "Minimum rate", "number"),
            field("rateMax", "Maximum rate", "number"),
            field("notes", "Notes", "textarea"),
          ],
        },
        {
          id: "audience",
          title: "Audience statistics",
          note: "Numbers you enter are self-reported. They are not independently verified facts unless a record already carries a verified status.",
          collection: "audienceStats",
          fields: [
            field("platform", "Platform"),
            field("metric", "Metric", "select", { options: options(METRICS) }),
            field("value", "Value", "number"),
            field("source", "Source", "select", { options: options(SOURCES) }),
            field("measuredAt", "Measured on", "date"),
          ],
          blank: () => ({ platform: "", metric: "followers", value: 0, source: "self_reported", measuredAt: "" }),
        },
        {
          id: "contact",
          title: "Partnership contact",
          object: "contact",
          fields: [
            field("email", "Email", "email"),
            field("partnershipEmail", "Partnership email", "email"),
            field("visibility.email", "Email visibility", "select", { options: options(VISIBILITY) }),
            field("visibility.partnershipEmail", "Partnership email visibility", "select", { options: options(VISIBILITY) }),
          ],
        },
      ],
    },
    business: {
      sections: [
        {
          id: "about",
          title: "Business profile",
          fields: [
            field("businessName", "Business name"),
            field("organizationType", "Organization type", "select", { options: options(ORG) }),
            field("industry", "Industry"),
            field("description", "Description", "textarea"),
            field("mission", "Mission", "textarea"),
            field("website", "Website", "url"),
          ],
        },
        {
          id: "brand",
          title: "Branding",
          object: "branding",
          fields: [
            field("logoUrl", "Logo URL", "url"),
            field("primaryColor", "Primary color"),
            field("guidelinesUrl", "Guidelines URL", "url"),
          ],
        },
        {
          id: "products",
          title: "Products",
          collection: "products",
          fields: [field("name", "Name"), field("description", "Description", "textarea"), field("url", "URL", "url")],
          blank: () => ({ name: "", description: "", url: "" }),
        },
        {
          id: "services",
          title: "Services",
          collection: "services",
          fields: [field("name", "Name"), field("description", "Description", "textarea")],
          blank: () => ({ name: "", description: "" }),
        },
        {
          id: "team",
          title: "Team",
          note: "Team members stay off any public projection unless you mark them public.",
          collection: "team",
          fields: [field("name", "Name"), field("role", "Role"), field("isPublic", "Show on a public profile", "checkbox")],
          blank: () => ({ name: "", role: "", isPublic: false }),
        },
        {
          id: "location",
          title: "Location and operations",
          object: "location",
          fields: [
            field("city", "City"),
            field("state", "State"),
            field("country", "Country"),
            field("addressLine", "Street address (private)"),
            field("timezone", "Timezone"),
            field("operatingHours", "Operating hours"),
          ],
        },
        {
          id: "registration",
          title: "Registration",
          note: "Registration numbers and document references are private. They are not returned by public profile APIs. You cannot mark a registration verified.",
          object: "registration",
          fields: [
            field("legalName", "Legal name"),
            field("registrationNumber", "Registration number (private)"),
            field("jurisdiction", "Jurisdiction"),
            field("issuedAt", "Issued on", "date"),
            field("documentStorageKey", "Private document reference"),
            field("status", "Status you can set", "select", {
              options: options([
                ["self-reported", "Self-reported"],
                ["pending", "Pending review"],
              ]),
            }),
          ],
        },
        {
          id: "cases",
          title: "Case studies",
          collection: "caseStudies",
          fields: [field("title", "Title"), field("summary", "Summary", "textarea"), field("url", "URL", "url")],
          blank: () => ({ title: "", summary: "", url: "" }),
        },
        {
          id: "resources",
          title: "Resources",
          collection: "resources",
          fields: [
            field("title", "Title"),
            field("url", "URL", "url"),
            field("visibility", "Visibility", "select", { options: options(RESOURCE_VIS) }),
          ],
          blank: () => ({ title: "", url: "", visibility: "private" }),
        },
        {
          id: "contact",
          title: "Public contact details",
          object: "publicContact",
          fields: [
            field("email", "Email", "email"),
            field("phone", "Phone"),
            field("city", "City"),
            field("country", "Country"),
            field("visibility.email", "Email visibility", "select", { options: options(VISIBILITY) }),
            field("visibility.phone", "Phone visibility", "select", { options: options(VISIBILITY) }),
          ],
        },
      ],
    },
  };

  function fieldsToShape(fields) {
    const shape = {};
    fields.forEach((fieldDef) => {
      if (fieldDef.key.indexOf(".") !== -1) {
        const parts = fieldDef.key.split(".");
        const parent = parts[0];
        const child = parts[1];
        if (!shape[parent] || !shape[parent].fields) shape[parent] = { fields: {} };
        shape[parent].fields[child] = "scalar";
        return;
      }
      shape[fieldDef.key] = "scalar";
    });
    return shape;
  }

  function writableShape(identity) {
    const spec = FORM_SPECS[identity];
    const shape = {};
    if (!spec) return shape;
    spec.sections.forEach((section) => {
      if (section.collection) {
        shape[section.collection] = { list: section.fields.map((item) => item.key) };
        return;
      }
      if (section.object) {
        shape[section.object] = { fields: fieldsToShape(section.fields) };
        return;
      }
      Object.assign(shape, fieldsToShape(section.fields));
    });
    return shape;
  }

  function pickShape(shape, value) {
    if (shape === "scalar") return value;
    if (shape && shape.list) {
      if (!Array.isArray(value)) return [];
      return value.map((item) => {
        const source = item && typeof item === "object" ? item : {};
        const out = {};
        if (source.id) out.id = String(source.id);
        shape.list.forEach((key) => {
          if (key.indexOf(".") !== -1) return;
          if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
        });
        return out;
      });
    }
    if (shape && shape.fields) {
      const source = value && typeof value === "object" ? value : {};
      const out = {};
      Object.keys(shape.fields).forEach((key) => {
        if (source[key] === undefined || source[key] === null) return;
        out[key] = pickShape(shape.fields[key], source[key]);
      });
      if (out.status === "verified" || out.status === "rejected") delete out.status;
      return out;
    }
    return value;
  }

  function buildUpdatePayload(identity, draft) {
    if (!draft || typeof draft !== "object") {
      throw new Error("Profile draft is missing.");
    }
    const shape = writableShape(identity);
    const payload = {};
    Object.keys(shape).forEach((key) => {
      if (draft[key] !== undefined) payload[key] = pickShape(shape[key], draft[key]);
    });
    delete payload.userId;
    delete payload.ownerId;
    delete payload._id;
    return payload;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createProfileEditorState() {
    return {
      loading: false,
      saving: false,
      error: "",
      saveError: "",
      notice: "",
      profile: null,
      draft: null,
    };
  }

  function profileEditorReducer(state, action) {
    switch (action.type) {
      case "load_start":
        return Object.assign({}, state, { loading: true, error: "", notice: "" });
      case "load_success":
        return {
          loading: false,
          saving: false,
          error: "",
          saveError: "",
          notice: "",
          profile: action.profile,
          draft: clone(action.profile),
        };
      case "load_error":
        return Object.assign({}, state, {
          loading: false,
          error: action.message || "Could not load profile.",
          notice: "",
        });
      case "edit":
        return Object.assign({}, state, { draft: action.draft, notice: "", saveError: "" });
      case "save_start":
        if (state.saving) return state;
        return Object.assign({}, state, { saving: true, saveError: "", notice: "" });
      case "save_success":
        return Object.assign({}, state, {
          saving: false,
          saveError: "",
          notice: "saved",
          profile: action.profile,
          draft: clone(action.profile),
        });
      case "save_error":
        return Object.assign({}, state, {
          saving: false,
          notice: "",
          saveError: action.message || "Save failed.",
        });
      default:
        return state;
    }
  }

  function upsertById(list, record) {
    if (!record || !record.id) throw new Error("Record id is required.");
    const next = Array.isArray(list) ? list.slice() : [];
    const index = next.findIndex((item) => item && item.id === record.id);
    if (index === -1) next.push(record);
    else next[index] = Object.assign({}, next[index], record, { id: record.id });
    return next;
  }

  function removeById(list, id) {
    return (Array.isArray(list) ? list : []).filter((item) => item && item.id !== id);
  }

  function newRecordId() {
    return "rec_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function getField(object, key) {
    if (!object) return undefined;
    if (key.indexOf(".") === -1) return object[key];
    const parts = key.split(".");
    return object[parts[0]] ? object[parts[0]][parts[1]] : undefined;
  }

  function setField(object, key, value) {
    const next = Object.assign({}, object || {});
    if (key.indexOf(".") === -1) {
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    }
    const parts = key.split(".");
    const parent = Object.assign({}, next[parts[0]] || {});
    if (value === undefined) delete parent[parts[1]];
    else parent[parts[1]] = value;
    next[parts[0]] = parent;
    return next;
  }

  return {
    FORM_SPECS,
    buildUpdatePayload,
    createProfileEditorState,
    profileEditorReducer,
    upsertById,
    removeById,
    newRecordId,
    getField,
    setField,
  };
});
