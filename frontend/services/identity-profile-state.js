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
  const ENGAGEMENT = [
    ["fixed_price", "Fixed-price project"],
    ["hourly", "Hourly engagement"],
    ["contract", "Contract work"],
    ["retainer", "Retainer"],
    ["long_term", "Long-term engagement"],
  ];
  const COLLAB_TYPES = [
    ["sponsored", "Sponsored"],
    ["affiliate", "Affiliate"],
    ["guest", "Guest"],
    ["co_creation", "Co-creation"],
    ["licensing", "Licensing"],
    ["other", "Other"],
  ];
  const BUSINESS_MODELS = [
    ["", "Not specified"],
    ["b2b", "B2B"],
    ["b2c", "B2C"],
    ["b2b2c", "B2B2C"],
    ["marketplace", "Marketplace"],
    ["subscription", "Subscription"],
    ["services", "Services"],
    ["other", "Other"],
  ];
  const RECORD_TYPES = [
    ["certification", "Certification"],
    ["award", "Award"],
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
            field("assetId", "Uploaded certificate reference"),
          ],
          blank: () => ({ title: "", issuer: "", issueDate: "", expirationDate: "", credentialUrl: "", credentialId: "", assetId: "" }),
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
            field("assetId", "Uploaded image reference"),
          ],
          blank: () => ({ title: "", role: "", url: "", description: "", assetId: "" }),
        },
        {
          id: "achievements",
          title: "Achievements",
          note: "These records are separate from the achievement lines stored on each role.",
          collection: "achievements",
          fields: [
            field("title", "Title"),
            field("organization", "Organization"),
            field("date", "Date", "date"),
            field("evidenceUrl", "Evidence URL", "url"),
            field("assetId", "Uploaded evidence reference"),
            field("description", "Description", "textarea"),
          ],
          blank: () => ({ title: "", organization: "", date: "", evidenceUrl: "", description: "", assetId: "" }),
        },
        {
          id: "social",
          title: "Social links",
          note: "LinkedIn and website stay on the contact section. Add other profiles here.",
          collection: "socialLinks",
          fields: [
            field("platform", "Platform"),
            field("label", "Display label"),
            field("url", "URL", "url"),
          ],
          blank: () => ({ platform: "", label: "", url: "" }),
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
            field("assetId", "Uploaded resume reference"),
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
            field("engagementTypes", "Engagement types (one per line): fixed_price, hourly, contract, retainer, long_term", "lines"),
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
          nested: {
            key: "packages",
            title: "Packages",
            note: "A package price is a specific offer. It does not have to fall inside the service rate range. Leave the price blank when the package is quoted on request. A price needs a currency.",
            maxItems: 8,
            fields: [
              field("name", "Package name"),
              field("description", "Description", "textarea"),
              field("features", "Deliverables (one per line)", "lines"),
              field("pricingModel", "Pricing model", "select", { options: options(PRICING) }),
              field("currency", "Currency"),
              field("price", "Price", "number"),
              field("deliveryDays", "Delivery timeline (days)", "number"),
              field("revisionCount", "Revisions", "number"),
            ],
            blank: () => ({ name: "", description: "", features: [], pricingModel: "fixed", currency: "", deliveryDays: undefined, revisionCount: undefined }),
          },
          blank: () => ({ name: "", description: "", pricingModel: "hourly", currency: "USD", deliveryDays: 7, packages: [] }),
        },
        {
          id: "experience",
          title: "Work experience",
          note: "Client and employment history. This stays separate from portfolio case studies and testimonials.",
          collection: "workExperience",
          fields: [
            field("jobTitle", "Role"),
            field("company", "Company or client"),
            field("startDate", "Start date", "date"),
            field("endDate", "End date", "date"),
            field("isCurrent", "I currently work in this role", "checkbox"),
            field("description", "Description", "textarea"),
            field("responsibilities", "Responsibilities (one per line)", "lines"),
          ],
          blank: () => ({ jobTitle: "", company: "", startDate: "", endDate: "", isCurrent: false, description: "", responsibilities: [] }),
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
            field("assetId", "Uploaded image reference"),
          ],
          blank: () => ({ title: "", summary: "", outcome: "", url: "", assetId: "" }),
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
            field("assetId", "Uploaded sample reference"),
          ],
          blank: () => ({ title: "", url: "", mediaType: "link", assetId: "" }),
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
          fields: [
            field("displayName", "Display name"),
            field("headline", "Headline"),
            field("niche", "Niche"),
            field("bio", "Biography", "textarea"),
          ],
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
            field("thumbnailUrl", "Thumbnail URL", "url"),
            field("assetId", "Uploaded thumbnail reference"),
          ],
          blank: () => ({ title: "", url: "", format: "video", category: "", publishedAt: "", summary: "", thumbnailUrl: "", assetId: "" }),
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
          fields: [field("summary", "Summary", "textarea"), field("kitUrl", "Media kit URL", "url"), field("assetId", "Uploaded media kit reference")],
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
          id: "past",
          title: "Past collaborations",
          note: "Outcomes you enter are self-reported. This list does not change your collaboration preferences.",
          collection: "pastCollaborations",
          fields: [
            field("organization", "Brand or organization"),
            field("title", "Campaign title"),
            field("collaborationType", "Type", "select", { options: options(COLLAB_TYPES) }),
            field("date", "Date", "date"),
            field("url", "Reference URL", "url"),
            field("description", "Description", "textarea"),
            field("outcome", "Outcome summary"),
          ],
          blank: () => ({ organization: "", title: "", collaborationType: "sponsored", date: "", url: "", description: "", outcome: "" }),
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
            field("visibility.phone", "Phone visibility", "select", { options: options(VISIBILITY) }),
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
            field("tagline", "Tagline"),
            field("organizationType", "Organization type", "select", { options: options(ORG) }),
            field("businessModel", "Business model", "select", { options: options(BUSINESS_MODELS) }),
            field("industry", "Industry"),
            field("foundedYear", "Founding year", "number"),
            field("description", "Description", "textarea"),
            field("mission", "Mission", "textarea"),
            field("targetCustomers", "Target customers (one per line)", "lines"),
            field("website", "Website", "url"),
          ],
        },
        {
          id: "brand",
          title: "Branding",
          object: "branding",
          fields: [
            field("logoUrl", "Logo URL", "url"),
            field("assetId", "Uploaded logo reference"),
            field("primaryColor", "Primary color"),
            field("guidelinesUrl", "Guidelines URL", "url"),
          ],
        },
        {
          id: "products",
          title: "Products",
          collection: "products",
          fields: [
            field("name", "Name"),
            field("description", "Description", "textarea"),
            field("url", "URL", "url"),
            field("imageUrl", "Image URL", "url"),
            field("assetId", "Uploaded image reference"),
            field("price", "Price", "number"),
            field("currency", "Currency"),
          ],
          blank: () => ({ name: "", description: "", url: "", imageUrl: "", currency: "", assetId: "" }),
        },
        {
          id: "credentials",
          title: "Certifications and awards",
          note: "New records stay self-reported. Registration details stay on the private registration section.",
          collection: "credentials",
          fields: [
            field("recordType", "Type", "select", { options: options(RECORD_TYPES) }),
            field("title", "Title"),
            field("issuer", "Issuing organization"),
            field("issueDate", "Issue date", "date"),
            field("expirationDate", "Expiration date", "date"),
            field("evidenceUrl", "Evidence URL", "url"),
            field("assetId", "Uploaded evidence reference"),
            field("description", "Description", "textarea"),
          ],
          blank: () => ({ recordType: "certification", title: "", issuer: "", issueDate: "", expirationDate: "", evidenceUrl: "", description: "", assetId: "" }),
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
            field("assetId", "Uploaded document reference"),
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
          fields: [field("title", "Title"), field("summary", "Summary", "textarea"), field("url", "URL", "url"), field("assetId", "Uploaded image reference")],
          blank: () => ({ title: "", summary: "", url: "", assetId: "" }),
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

  const SECTION_UI = {
    professional: {
      about: {
        description: "Headline and biography used on recruiter and hiring views.",
        saveLabel: "Save profile",
      },
      current: {
        description: "The role you hold now. Saving this section leaves your employment history unchanged.",
        saveLabel: "Save current role",
      },
      history: {
        description: "Each role is stored on its own and can be edited or removed.",
        singular: "role",
        addLabel: "Add role",
        emptyTitle: "No employment history yet",
        emptyBody: "Add a company, title, dates, and the work you did there.",
        cardTitle: "jobTitle",
        cardMeta: ["company", "employmentType", "location", "startDate", "endDate", "isCurrent"],
        cardBody: "responsibilities",
        maxItems: 30,
      },
      skills: {
        description: "Name each skill and the proficiency you want shown with this identity.",
        singular: "skill",
        addLabel: "Add skill",
        emptyTitle: "No skills yet",
        emptyBody: "Add a skill with a proficiency and years of experience.",
        cardTitle: "name",
        cardMeta: ["proficiency", "yearsExperience"],
        maxItems: 60,
      },
      certs: {
        description: "Credentials you add are self-reported. OneVue controls verification status.",
        singular: "certification",
        addLabel: "Add certification",
        emptyTitle: "No certifications yet",
        emptyBody: "Add the credential, issuer, and any public credential link.",
        cardTitle: "title",
        cardMeta: ["issuer", "issueDate", "expirationDate"],
        maxItems: 30,
      },
      education: {
        description: "Degrees and programs. Each record can be edited without changing the others.",
        singular: "education record",
        addLabel: "Add education",
        emptyTitle: "No education records yet",
        emptyBody: "Add an institution, degree, and field of study.",
        cardTitle: "institution",
        cardMeta: ["degree", "fieldOfStudy", "currentStatus", "startDate", "endDate"],
        maxItems: 20,
      },
      portfolio: {
        description: "Projects and portfolio links for this professional identity.",
        singular: "project",
        addLabel: "Add project",
        emptyTitle: "No portfolio projects yet",
        emptyBody: "Add a project title, your role, and a link.",
        cardTitle: "title",
        cardMeta: ["role"],
        cardBody: "description",
        maxItems: 30,
      },
      achievements: {
        description: "Standalone achievements. Role-level results stay on each employment record.",
        singular: "achievement",
        addLabel: "Add achievement",
        emptyTitle: "No standalone achievements yet",
        emptyBody: "Add a title, organization, date, and an optional evidence link.",
        cardTitle: "title",
        cardMeta: ["organization", "date"],
        cardBody: "description",
        maxItems: 40,
      },
      social: {
        description: "Additional profiles. LinkedIn and your website stay on the contact section.",
        singular: "social link",
        addLabel: "Add link",
        emptyTitle: "No additional social links yet",
        emptyBody: "Add a platform name and an http or https URL.",
        cardTitle: "platform",
        cardMeta: ["label"],
        maxItems: 20,
      },
      resume: {
        description: "One resume reference for this identity. The storage key stays on your private profile.",
        saveLabel: "Save resume details",
      },
      contact: {
        description: "Contact details and who can see the email address and phone number.",
        saveLabel: "Save contact details",
      },
    },
    freelancer: {
      about: {
        description: "Title, specialization, biography, availability, and the kinds of engagements you take.",
        saveLabel: "Save profile",
      },
      services: {
        description: "Each service keeps its advertised rate range. Packages are optional offers with their own price.",
        singular: "service",
        addLabel: "Add service",
        emptyTitle: "No services yet",
        emptyBody: "Add a service you offer, how you price it, and a typical delivery time.",
        cardTitle: "name",
        cardMeta: ["pricingModel", "currency", "rateMin", "rateMax", "deliveryDays"],
        maxItems: 40,
      },
      experience: {
        description: "Work history. This stays separate from case studies and testimonials.",
        singular: "role",
        addLabel: "Add experience",
        emptyTitle: "No work experience yet",
        emptyBody: "Add a company or client, your role, and the dates.",
        cardTitle: "jobTitle",
        cardMeta: ["company", "startDate", "endDate", "isCurrent"],
        cardBody: "description",
        maxItems: 30,
      },
      skills: {
        description: "Skills you want clients to see, with proficiency and experience.",
        singular: "skill",
        addLabel: "Add skill",
        emptyTitle: "No skills yet",
        emptyBody: "Add a skill and how confident you are using it.",
        cardTitle: "name",
        cardMeta: ["proficiency", "yearsExperience"],
        maxItems: 60,
      },
      tech: {
        description: "Tools and technologies, one per line.",
        saveLabel: "Save technologies",
      },
      portfolio: {
        description: "Case studies and portfolio pieces. Removing one does not change your services.",
        singular: "case study",
        addLabel: "Add case study",
        emptyTitle: "No portfolio pieces yet",
        emptyBody: "Add a title, summary, outcome, and link.",
        cardTitle: "title",
        cardMeta: ["outcome"],
        cardBody: "summary",
        maxItems: 30,
      },
      testimonials: {
        description: "Quotes you enter are self-reported. OneVue does not mark them verified from this form.",
        singular: "testimonial",
        addLabel: "Add testimonial",
        emptyTitle: "No testimonials yet",
        emptyBody: "Add a client quote and the name of the person who gave it.",
        cardTitle: "authorName",
        cardMeta: ["relationship"],
        cardBody: "quote",
        maxItems: 30,
      },
      samples: {
        description: "Links to work samples. Each sample needs a title and an http or https URL.",
        singular: "work sample",
        addLabel: "Add sample",
        emptyTitle: "No work samples yet",
        emptyBody: "Add a sample title, link, and media type.",
        cardTitle: "title",
        cardMeta: ["mediaType"],
        maxItems: 30,
      },
      contact: {
        description: "How clients should reach you, and who can see those details.",
        saveLabel: "Save contact preferences",
      },
    },
    creator: {
      about: {
        description: "Display name, headline, niche, and biography. The account name stays on your login.",
        saveLabel: "Save profile",
      },
      featured: {
        description: "Featured videos, posts, or other media. Counts and analytics are not fetched for you.",
        singular: "featured item",
        addLabel: "Add featured content",
        emptyTitle: "No featured content yet",
        emptyBody: "Add a title, public URL, format, and short summary.",
        cardTitle: "title",
        cardMeta: ["format", "category", "publishedAt"],
        cardBody: "summary",
        maxItems: 30,
      },
      channels: {
        description: "Social and publishing channels you want listed on this identity.",
        singular: "channel",
        addLabel: "Add channel",
        emptyTitle: "No channels yet",
        emptyBody: "Add a platform, handle, and profile URL.",
        cardTitle: "platform",
        cardMeta: ["handle"],
        maxItems: 20,
      },
      categories: {
        description: "Content categories and the formats you publish.",
        saveLabel: "Save categories",
      },
      kit: {
        description: "A short media-kit summary and a link to the kit itself.",
        saveLabel: "Save media kit",
      },
      collab: {
        description: "Whether you are open to collaboration, and any preferences you want on the profile.",
        saveLabel: "Save collaboration preferences",
      },
      past: {
        description: "Brands and campaigns you have already worked with. Outcomes stay self-reported.",
        singular: "collaboration",
        addLabel: "Add collaboration",
        emptyTitle: "No past collaborations yet",
        emptyBody: "Add the organization, campaign title, and an optional public reference.",
        cardTitle: "organization",
        cardMeta: ["title", "collaborationType", "date"],
        cardBody: "description",
        maxItems: 30,
      },
      sponsor: {
        description: "Sponsorship availability and the rate range you want to publish. This does not take payment.",
        saveLabel: "Save sponsorship details",
      },
      audience: {
        description: "Optional audience figures you supply. They stay self-reported unless a record was already verified.",
        singular: "audience figure",
        addLabel: "Add audience figure",
        emptyTitle: "No audience figures yet",
        emptyBody: "Add a platform, metric, value, source, and the date you measured it.",
        cardTitle: "platform",
        cardMeta: ["metric", "value", "source", "measuredAt"],
        maxItems: 30,
      },
      contact: {
        description: "Partnership contact details and their visibility.",
        saveLabel: "Save contact details",
      },
    },
    business: {
      about: {
        description: "Business name, tagline, founding year, model, and the description you want partners to read.",
        saveLabel: "Save business profile",
      },
      brand: {
        description: "Logo, primary color, and a link to brand guidelines.",
        saveLabel: "Save branding",
      },
      products: {
        description: "Each product is saved on its own. Editing one does not replace the others.",
        singular: "product",
        addLabel: "Add product",
        emptyTitle: "No products yet",
        emptyBody: "Add a product name, description, and link. Price and image URL are optional.",
        cardTitle: "name",
        cardMeta: ["price", "currency"],
        cardBody: "description",
        maxItems: 40,
      },
      credentials: {
        description: "Public certifications and awards. New records stay self-reported. Registration stays private.",
        singular: "credential",
        addLabel: "Add credential",
        emptyTitle: "No certifications or awards yet",
        emptyBody: "Add a title, issuer, and an optional evidence link.",
        cardTitle: "title",
        cardMeta: ["recordType", "issuer", "issueDate"],
        cardBody: "description",
        maxItems: 40,
      },
      services: {
        description: "Services the business offers. Each service can be edited or removed on its own.",
        singular: "service",
        addLabel: "Add service",
        emptyTitle: "No services yet",
        emptyBody: "Add a service name and description.",
        cardTitle: "name",
        cardBody: "description",
        maxItems: 40,
      },
      team: {
        description: "Team members stay off public views unless you mark that person public.",
        singular: "team member",
        addLabel: "Add team member",
        emptyTitle: "No team members yet",
        emptyBody: "Add a name and role. Leave the public toggle off to keep the person private.",
        cardTitle: "name",
        cardMeta: ["role", "isPublic"],
        maxItems: 50,
      },
      location: {
        description: "Where the business operates. The street address stays on the private profile.",
        saveLabel: "Save location",
      },
      registration: {
        description: "Registration details are private. You can mark a record self-reported or pending. Verified status is controlled by OneVue.",
        saveLabel: "Save registration",
      },
      cases: {
        description: "Case studies and business outcomes.",
        singular: "case study",
        addLabel: "Add case study",
        emptyTitle: "No case studies yet",
        emptyBody: "Add a title, summary, and link.",
        cardTitle: "title",
        cardBody: "summary",
        maxItems: 30,
      },
      resources: {
        description: "Brand files and media links. New resources are private until you mark them public.",
        singular: "resource",
        addLabel: "Add resource",
        emptyTitle: "No resources yet",
        emptyBody: "Add a title, URL, and whether the link is public.",
        cardTitle: "title",
        cardMeta: ["visibility"],
        maxItems: 30,
      },
      contact: {
        description: "Business contact details and who can see the email address and phone number.",
        saveLabel: "Save contact details",
      },
    },
  };

  const REQUIRED_FIELDS = {
    professional: {
      history: ["jobTitle", "company"],
      skills: ["name"],
      certs: ["title", "issuer"],
      education: ["institution", "degree"],
      portfolio: ["title"],
      achievements: ["title"],
      social: ["platform", "url"],
    },
    freelancer: {
      services: ["name"],
      "services.packages": ["name"],
      experience: ["jobTitle", "company"],
      skills: ["name"],
      portfolio: ["title"],
      testimonials: ["quote", "authorName"],
      samples: ["title", "url"],
    },
    creator: {
      featured: ["title", "url"],
      channels: ["platform", "url"],
      audience: ["platform", "metric", "value", "source", "measuredAt"],
      past: ["organization"],
    },
    business: {
      products: ["name"],
      credentials: ["title"],
      services: ["name"],
      team: ["name", "role"],
      cases: ["title"],
      resources: ["title", "url"],
    },
  };

  const STRING_LIMITS = {
    headline: 200,
    bio: 3000,
    specialization: 150,
    niche: 150,
    businessName: 150,
    description: 3000,
    mission: 2000,
    industry: 120,
    website: 500,
    jobTitle: 150,
    company: 150,
    location: 150,
    institution: 150,
    degree: 150,
    fieldOfStudy: 150,
    title: 150,
    issuer: 150,
    credentialUrl: 500,
    credentialId: 100,
    url: 500,
    role: 120,
    fileName: 255,
    targetRole: 120,
    email: 200,
    phone: 30,
    city: 100,
    country: 100,
    linkedin: 500,
    name: 150,
    summary: 2000,
    outcome: 500,
    quote: 1000,
    authorName: 120,
    relationship: 120,
    platform: 80,
    handle: 80,
    category: 80,
    kitUrl: 500,
    preferences: 1000,
    brandSafetyNotes: 1000,
    notes: 1000,
    partnershipEmail: 200,
    logoUrl: 500,
    guidelinesUrl: 500,
    legalName: 200,
    registrationNumber: 80,
    jurisdiction: 120,
    addressLine: 200,
    state: 100,
    timezone: 80,
    operatingHours: 200,
    currency: 8,
    organization: 150,
    evidenceUrl: 500,
    label: 80,
    displayName: 80,
    tagline: 160,
    imageUrl: 500,
    thumbnailUrl: 500,
  };

  const NUMBER_LIMITS = {
    yearsExperience: { min: 0, max: 60, integer: true },
    rateMin: { min: 0, max: 10000000 },
    rateMax: { min: 0, max: 10000000 },
    deliveryDays: { min: 0, max: 3650, integer: true },
    value: { min: 0, max: 1000000000000 },
    price: { min: 0, max: 10000000 },
    revisionCount: { min: 0, max: 100, integer: true },
    foundedYear: { min: 1800, max: new Date().getUTCFullYear(), integer: true },
  };

  const ENGAGEMENT_VALUES = ["fixed_price", "hourly", "contract", "retainer", "long_term"];

  const CONTENT_FORMAT_VALUES = ["video", "article", "podcast", "newsletter", "short_form", "livestream", "other"];

  function sectionById(identity, sectionId) {
    const spec = FORM_SPECS[identity];
    if (!spec) return null;
    for (let index = 0; index < spec.sections.length; index += 1) {
      if (spec.sections[index].id === sectionId) return spec.sections[index];
    }
    return null;
  }

  function isFieldRequired(identity, sectionId, fieldKey) {
    const list = REQUIRED_FIELDS[identity] && REQUIRED_FIELDS[identity][sectionId];
    return !!(list && list.indexOf(fieldKey) !== -1);
  }

  function stringLimit(sectionId, key) {
    if (key === "name" && sectionId === "skills") return 80;
    if (key === "name" && sectionId === "team") return 120;
    if (key === "summary" && sectionId === "featured") return 1000;
    if (key === "description" && (sectionId === "products" || sectionId === "services" || sectionId === "achievements" || sectionId === "experience" || sectionId === "past" || sectionId === "credentials" || sectionId === "services.packages")) return 2000;
    if (key === "platform" && sectionId === "social") return 80;
    if (key === "outcome" && sectionId === "past") return 500;
    return STRING_LIMITS[key];
  }

  function isHttpUrl(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
      return false;
    }
  }

  function validateFieldValue(identity, sectionId, fieldDef, record) {
    const value = getField(record, fieldDef.key);
    const label = fieldDef.label;
    const required = isFieldRequired(identity, sectionId, fieldDef.key);
    if (fieldDef.type === "checkbox") return "";
    if (fieldDef.type === "lines") {
      const items = Array.isArray(value) ? value : [];
      if (required && items.length === 0) return label + " is required.";
      const itemMax = fieldDef.key === "technologies" || fieldDef.key === "engagementTypes" ? 40 : fieldDef.key === "contentCategories" ? 60 : fieldDef.key === "contentFormats" ? 40 : fieldDef.key === "features" ? 200 : fieldDef.key === "targetCustomers" ? 80 : 300;
      const maxItems = fieldDef.key === "technologies" ? 40 : fieldDef.key === "contentCategories" ? 20 : fieldDef.key === "contentFormats" ? 12 : fieldDef.key === "engagementTypes" ? 8 : 20;
      if (items.length > maxItems) return label + " cannot exceed " + maxItems + " items.";
      for (let index = 0; index < items.length; index += 1) {
        if (String(items[index]).length > itemMax) return label + " has an item that is too long.";
        if (fieldDef.key === "contentFormats" && CONTENT_FORMAT_VALUES.indexOf(items[index]) === -1) {
          return "Each format must be one of: " + CONTENT_FORMAT_VALUES.join(", ") + ".";
        }
        if (fieldDef.key === "engagementTypes" && ENGAGEMENT_VALUES.indexOf(items[index]) === -1) {
          return "Each engagement type must be one of: " + ENGAGEMENT_VALUES.join(", ") + ".";
        }
      }
      return "";
    }
    if (fieldDef.type === "number") {
      if (value === undefined || value === null || value === "") {
        return required ? label + " is required." : "";
      }
      if (typeof value !== "number" || !Number.isFinite(value)) return label + " must be a number.";
      const bounds = NUMBER_LIMITS[fieldDef.key];
      if (bounds) {
        if (bounds.integer && !Number.isInteger(value)) return label + " must be a whole number.";
        if (value < bounds.min || value > bounds.max) {
          return label + " must be between " + bounds.min + " and " + bounds.max + ".";
        }
      }
      return "";
    }
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (required && !text) return label + " is required.";
    if (!text) return "";
    const max = stringLimit(sectionId, fieldDef.key);
    if (max && text.length > max) return label + " cannot exceed " + max + " characters.";
    if (fieldDef.type === "url" && !isHttpUrl(text)) return label + " must be an http or https URL.";
    if (fieldDef.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return label + " must be a valid email address.";
    if (fieldDef.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) return label + " must be a valid date.";
    if (fieldDef.key === "phone" && !/^[0-9+().\-\s]{3,30}$/.test(text)) return label + " must be a valid phone number.";
    if (fieldDef.key === "currency" && !/^[A-Za-z]{3,8}$/.test(text)) return label + " must be a 3 to 8 letter currency code.";
    if (fieldDef.key === "primaryColor" && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(text)) {
      return label + " must be a hex color such as #1B4DFF.";
    }
    if (fieldDef.key === "assetId") {
      if (!/^ast_[a-f0-9]{24}$/.test(text)) return label + " must be an uploaded asset id.";
    }
    if (fieldDef.key === "storageKey" || fieldDef.key === "documentStorageKey") {
      if (text.length > 300 || text.indexOf("..") !== -1 || !/^[A-Za-z0-9][A-Za-z0-9/_\-.]*$/.test(text)) {
        return label + " is not a valid storage reference.";
      }
    }
    return "";
  }

  function validateRecord(identity, sectionId, record) {
    const section = sectionById(identity, sectionId);
    if (!section) return "Unknown section.";
    const source = record && typeof record === "object" ? record : {};
    for (let index = 0; index < section.fields.length; index += 1) {
      const message = validateFieldValue(identity, sectionId, section.fields[index], source);
      if (message) return message;
    }
    const start = getField(source, "startDate");
    const end = getField(source, "endDate");
    if (start && end && String(end) < String(start)) return "End date cannot be earlier than the start date.";
    const min = getField(source, "rateMin");
    const maxRate = getField(source, "rateMax");
    if (typeof min === "number" && typeof maxRate === "number" && min > maxRate) {
      return "Minimum rate cannot exceed the maximum rate.";
    }
    if (getField(source, "metric") === "engagement_rate" && typeof getField(source, "value") === "number" && getField(source, "value") > 100) {
      return "Engagement rate cannot exceed 100.";
    }
    if (sectionId === "experience" && source.isCurrent && getField(source, "endDate")) {
      return "A current role cannot also have an end date.";
    }
    const issued = getField(source, "issueDate");
    const expires = getField(source, "expirationDate");
    if (sectionId === "credentials" && issued && expires && String(expires) < String(issued)) {
      return "Expiration date cannot be earlier than the issue date.";
    }
    if ((sectionId === "products" || sectionId === "services.packages") && typeof getField(source, "price") === "number" && !String(getField(source, "currency") || "").trim()) {
      return "Currency is required when a price is set.";
    }
    if (section.nested && Array.isArray(source[section.nested.key])) {
      if (source[section.nested.key].length > (section.nested.maxItems || 8)) {
        return section.nested.title + " cannot exceed " + (section.nested.maxItems || 8) + " records.";
      }
      for (let nestedIndex = 0; nestedIndex < source[section.nested.key].length; nestedIndex += 1) {
        const nestedRecord = source[section.nested.key][nestedIndex] || {};
        const nestedSectionId = section.id + "." + section.nested.key;
        for (let fieldIndex = 0; fieldIndex < section.nested.fields.length; fieldIndex += 1) {
          const nestedMessage = validateFieldValue(identity, nestedSectionId, section.nested.fields[fieldIndex], nestedRecord);
          if (nestedMessage) return section.nested.title + ": " + nestedMessage;
        }
        const nestedPrice = getField(nestedRecord, "price");
        if (typeof nestedPrice === "number" && !String(getField(nestedRecord, "currency") || "").trim()) {
          return section.nested.title + ": Currency is required when a price is set.";
        }
      }
    }
    return "";
  }

  function buildSectionPayload(identity, sectionId, draft) {
    const section = sectionById(identity, sectionId);
    if (!section) throw new Error("Unknown profile section.");
    const slice = {};
    if (section.collection) {
      slice[section.collection] = (draft && draft[section.collection]) || [];
    } else if (section.object) {
      slice[section.object] = (draft && draft[section.object]) || {};
    } else {
      section.fields.forEach((fieldDef) => {
        const key = fieldDef.key.split(".")[0];
        if (draft && Object.prototype.hasOwnProperty.call(draft, key)) slice[key] = draft[key];
      });
    }
    const payload = buildUpdatePayload(identity, slice);
    if (draft && draft.customLayout) payload.customLayout = draft.customLayout;
    return payload;
  }

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
        const entry = { list: section.fields.map((item) => item.key) };
        if (section.nested) {
          entry.nested = {
            key: section.nested.key,
            list: section.nested.fields.map((item) => item.key),
          };
        }
        shape[section.collection] = entry;
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
        if (shape.nested && source[shape.nested.key] !== undefined && source[shape.nested.key] !== null) {
          out[shape.nested.key] = pickShape({ list: shape.nested.list }, source[shape.nested.key]);
        }
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
        return Object.assign({}, state, {
          loading: true,
          error: "",
          notice: "",
          saveError: "",
          profile: null,
          draft: null,
        });
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
      case "section_save_success": {
        const nextDraft = clone(state.draft || {});
        (action.keys || []).forEach((key) => {
          const incoming = action.profile ? action.profile[key] : undefined;
          nextDraft[key] = incoming === undefined ? incoming : clone(incoming);
        });
        return Object.assign({}, state, {
          saving: false,
          saveError: "",
          notice: "saved",
          profile: action.profile,
          draft: nextDraft,
        });
      }
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
    SECTION_UI,
    buildUpdatePayload,
    buildSectionPayload,
    validateRecord,
    isFieldRequired,
    sectionById,
    createProfileEditorState,
    profileEditorReducer,
    upsertById,
    removeById,
    newRecordId,
    getField,
    setField,
  };
});
