import {
  AUDIENCE_METRICS,
  AUDIENCE_SOURCES,
  BUSINESS_MODELS,
  CLIENT_VERIFICATION,
  COLLABORATION_TYPES,
  CONTACT_CHANNELS,
  CONTENT_FORMATS,
  CREDENTIAL_RECORD_TYPES,
  EDUCATION_STATUSES,
  EMPLOYMENT_TYPES,
  ENGAGEMENT_TYPES,
  FREELANCER_AVAILABILITY,
  MEDIA_SAMPLE_TYPES,
  ORG_TYPES,
  PRICING_MODELS,
  PROFICIENCIES,
  RESOURCE_VISIBILITY,
  RESUME_CONTENT_TYPES,
  VISIBILITY,
} from "./constants";
import type { DomainContract, ObjectField, ScalarField } from "./types";

const verification = {
  key: "verificationStatus",
  allowed: CLIENT_VERIFICATION,
  defaultValue: "self-reported",
};

const attribution = {
  key: "attribution",
  allowed: ["self-reported"] as const,
  defaultValue: "self-reported",
};

const registrationStatus = {
  key: "status",
  allowed: ["self-reported", "pending"] as const,
  defaultValue: "self-reported",
};

function visibilityFields(includePartnership = false): ObjectField {
  const fields: ObjectField["fields"] = {
    email: { kind: "enum", values: VISIBILITY, allowEmpty: false, defaultValue: "private" },
    phone: { kind: "enum", values: VISIBILITY, allowEmpty: false, defaultValue: "private" },
  };
  if (includePartnership) {
    fields.partnershipEmail = {
      kind: "enum",
      values: VISIBILITY,
      allowEmpty: false,
      defaultValue: "private",
    };
  }
  return { kind: "object", fields };
}

function employmentFields(required: boolean): Record<string, ScalarField> {
  return {
    company: { kind: "string", max: 150, required },
    jobTitle: { kind: "string", max: 150, required },
    employmentType: {
      kind: "enum",
      values: EMPLOYMENT_TYPES,
      required,
      allowEmpty: !required,
    },
    location: { kind: "string", max: 150 },
    startDate: { kind: "date" },
    endDate: { kind: "date" },
    isCurrent: { kind: "boolean", defaultValue: false },
    responsibilities: { kind: "stringList", maxItems: 20, itemMax: 300 },
    achievements: { kind: "stringList", maxItems: 20, itemMax: 300 },
  };
}

const skillFields: Record<string, ScalarField> = {
  name: { kind: "string", max: 80, required: true },
  proficiency: { kind: "enum", values: PROFICIENCIES, defaultValue: "Intermediate" },
  yearsExperience: { kind: "number", min: 0, max: 60, integer: true, defaultValue: 0 },
};

export const professionalContract: DomainContract = {
  identity: "professional",
  fields: {
    headline: { kind: "string", max: 200 },
    bio: { kind: "string", max: 3000 },
    currentEmployment: {
      kind: "object",
      fields: employmentFields(false),
      rules: ["dateOrder"],
    },
    employmentHistory: {
      kind: "collection",
      maxItems: 30,
      fields: employmentFields(true),
      rules: ["dateOrder"],
    },
    skills: { kind: "collection", maxItems: 60, fields: skillFields },
    certifications: {
      kind: "collection",
      maxItems: 30,
      managed: [verification],
      fields: {
        title: { kind: "string", max: 150, required: true },
        issuer: { kind: "string", max: 150, required: true },
        issueDate: { kind: "date" },
        expirationDate: { kind: "date" },
        credentialUrl: { kind: "url" },
        credentialId: { kind: "string", max: 100 },
        assetId: { kind: "assetId" },
      },
    },
    education: {
      kind: "collection",
      maxItems: 20,
      rules: ["dateOrder"],
      fields: {
        institution: { kind: "string", max: 150, required: true },
        degree: { kind: "string", max: 150, required: true },
        fieldOfStudy: { kind: "string", max: 150 },
        startDate: { kind: "date" },
        endDate: { kind: "date" },
        currentStatus: { kind: "enum", values: EDUCATION_STATUSES, defaultValue: "studying" },
      },
    },
    portfolio: {
      kind: "collection",
      maxItems: 30,
      fields: {
        title: { kind: "string", max: 150, required: true },
        description: { kind: "string", max: 2000 },
        url: { kind: "url" },
        role: { kind: "string", max: 120 },
        assetId: { kind: "assetId" },
      },
    },
    achievements: {
      kind: "collection",
      maxItems: 40,
      fields: {
        title: { kind: "string", max: 150, required: true },
        description: { kind: "string", max: 2000 },
        organization: { kind: "string", max: 150 },
        date: { kind: "date" },
        evidenceUrl: { kind: "url" },
        assetId: { kind: "assetId" },
      },
    },
    socialLinks: {
      kind: "collection",
      maxItems: 20,
      fields: {
        platform: { kind: "string", max: 80, required: true },
        url: { kind: "url", required: true },
        label: { kind: "string", max: 80 },
      },
    },
    resume: {
      kind: "object",
      rules: ["touchUploadedAt"],
      fields: {
        fileName: { kind: "string", max: 255 },
        storageKey: { kind: "storageKey" },
        assetId: { kind: "assetId" },
        contentType: { kind: "enum", values: RESUME_CONTENT_TYPES, allowEmpty: true },
        targetRole: { kind: "string", max: 120 },
      },
    },
    contact: {
      kind: "object",
      fields: {
        email: { kind: "email" },
        phone: { kind: "phone" },
        city: { kind: "string", max: 100 },
        country: { kind: "string", max: 100 },
        linkedin: { kind: "url" },
        website: { kind: "url" },
        visibility: visibilityFields(),
      },
    },
  },
};

export const freelancerContract: DomainContract = {
  identity: "freelancer",
  fields: {
    headline: { kind: "string", max: 200 },
    bio: { kind: "string", max: 3000 },
    specialization: { kind: "string", max: 150 },
    availability: { kind: "enum", values: FREELANCER_AVAILABILITY, defaultValue: "available" },
    engagementTypes: { kind: "stringList", maxItems: 8, itemMax: 40, enumValues: ENGAGEMENT_TYPES },
    services: {
      kind: "collection",
      maxItems: 40,
      rules: ["rateOrder"],
      fields: {
        name: { kind: "string", max: 150, required: true },
        description: { kind: "string", max: 2000 },
        pricingModel: { kind: "enum", values: PRICING_MODELS, defaultValue: "hourly" },
        currency: { kind: "currency" },
        rateMin: { kind: "number", min: 0, max: 10000000 },
        rateMax: { kind: "number", min: 0, max: 10000000 },
        deliveryDays: { kind: "number", min: 0, max: 3650, integer: true },
        packages: {
          kind: "collection",
          maxItems: 8,
          rules: ["priceCurrency"],
          fields: {
            name: { kind: "string", max: 150, required: true },
            description: { kind: "string", max: 2000 },
            features: { kind: "stringList", maxItems: 20, itemMax: 200 },
            pricingModel: { kind: "enum", values: PRICING_MODELS, defaultValue: "fixed" },
            currency: { kind: "currency" },
            price: { kind: "number", min: 0, max: 10000000 },
            deliveryDays: { kind: "number", min: 0, max: 3650, integer: true },
            revisionCount: { kind: "number", min: 0, max: 100, integer: true },
          },
        },
      },
    },
    workExperience: {
      kind: "collection",
      maxItems: 30,
      rules: ["dateOrder", "currentEnd"],
      fields: {
        company: { kind: "string", max: 150, required: true },
        jobTitle: { kind: "string", max: 150, required: true },
        description: { kind: "string", max: 2000 },
        responsibilities: { kind: "stringList", maxItems: 20, itemMax: 300 },
        startDate: { kind: "date" },
        endDate: { kind: "date" },
        isCurrent: { kind: "boolean", defaultValue: false },
      },
    },
    skills: { kind: "collection", maxItems: 60, fields: skillFields },
    technologies: { kind: "stringList", maxItems: 40, itemMax: 40 },
    portfolio: {
      kind: "collection",
      maxItems: 30,
      fields: {
        title: { kind: "string", max: 150, required: true },
        summary: { kind: "string", max: 2000 },
        url: { kind: "url" },
        outcome: { kind: "string", max: 500 },
        assetId: { kind: "assetId" },
      },
    },
    testimonials: {
      kind: "collection",
      maxItems: 30,
      managed: [attribution],
      fields: {
        quote: { kind: "string", max: 1000, required: true },
        authorName: { kind: "string", max: 120, required: true },
        relationship: { kind: "string", max: 120 },
      },
    },
    workSamples: {
      kind: "collection",
      maxItems: 30,
      fields: {
        title: { kind: "string", max: 150, required: true },
        url: { kind: "url", required: true },
        mediaType: { kind: "enum", values: MEDIA_SAMPLE_TYPES, defaultValue: "link" },
        assetId: { kind: "assetId" },
      },
    },
    contact: {
      kind: "object",
      fields: {
        email: { kind: "email" },
        phone: { kind: "phone" },
        preferredChannel: { kind: "enum", values: CONTACT_CHANNELS, defaultValue: "email" },
        visibility: visibilityFields(),
      },
    },
  },
};

export const creatorContract: DomainContract = {
  identity: "creator",
  fields: {
    displayName: { kind: "string", max: 80 },
    headline: { kind: "string", max: 200 },
    bio: { kind: "string", max: 3000 },
    niche: { kind: "string", max: 150 },
    featuredContent: {
      kind: "collection",
      maxItems: 30,
      fields: {
        title: { kind: "string", max: 150, required: true },
        url: { kind: "url", required: true },
        format: { kind: "enum", values: CONTENT_FORMATS, defaultValue: "video" },
        category: { kind: "string", max: 80 },
        publishedAt: { kind: "date" },
        summary: { kind: "string", max: 1000 },
        thumbnailUrl: { kind: "url" },
        assetId: { kind: "assetId" },
      },
    },
    channels: {
      kind: "collection",
      maxItems: 20,
      fields: {
        platform: { kind: "string", max: 80, required: true },
        url: { kind: "url", required: true },
        handle: { kind: "string", max: 80 },
      },
    },
    contentCategories: { kind: "stringList", maxItems: 20, itemMax: 60 },
    contentFormats: { kind: "stringList", maxItems: 12, itemMax: 40, enumValues: CONTENT_FORMATS },
    mediaKit: {
      kind: "object",
      fields: {
        summary: { kind: "string", max: 2000 },
        kitUrl: { kind: "url" },
        assetId: { kind: "assetId" },
      },
    },
    collaboration: {
      kind: "object",
      fields: {
        openToCollab: { kind: "boolean", defaultValue: false },
        preferences: { kind: "string", max: 1000 },
        brandSafetyNotes: { kind: "string", max: 1000 },
      },
    },
    pastCollaborations: {
      kind: "collection",
      maxItems: 30,
      fields: {
        organization: { kind: "string", max: 150, required: true },
        title: { kind: "string", max: 150 },
        description: { kind: "string", max: 2000 },
        collaborationType: { kind: "enum", values: COLLABORATION_TYPES, defaultValue: "sponsored" },
        date: { kind: "date" },
        url: { kind: "url" },
        outcome: { kind: "string", max: 500 },
      },
    },
    sponsorship: {
      kind: "object",
      rules: ["rateOrder"],
      fields: {
        available: { kind: "boolean", defaultValue: false },
        rateMin: { kind: "number", min: 0, max: 10000000 },
        rateMax: { kind: "number", min: 0, max: 10000000 },
        currency: { kind: "currency" },
        notes: { kind: "string", max: 1000 },
      },
    },
    audienceStats: {
      kind: "collection",
      maxItems: 30,
      managed: [verification],
      rules: ["engagementRate"],
      fields: {
        platform: { kind: "string", max: 80, required: true },
        metric: { kind: "enum", values: AUDIENCE_METRICS, required: true },
        value: { kind: "number", min: 0, max: 1000000000000, required: true },
        source: { kind: "enum", values: AUDIENCE_SOURCES, required: true },
        measuredAt: { kind: "date", required: true },
      },
    },
    contact: {
      kind: "object",
      fields: {
        email: { kind: "email" },
        partnershipEmail: { kind: "email" },
        visibility: visibilityFields(true),
      },
    },
  },
};

export const businessContract: DomainContract = {
  identity: "business",
  fields: {
    businessName: { kind: "string", max: 150 },
    tagline: { kind: "string", max: 160 },
    description: { kind: "string", max: 3000 },
    mission: { kind: "string", max: 2000 },
    organizationType: { kind: "enum", values: ORG_TYPES, allowEmpty: true },
    industry: { kind: "string", max: 120 },
    foundedYear: { kind: "year", min: 1800 },
    businessModel: { kind: "enum", values: BUSINESS_MODELS, allowEmpty: true },
    targetCustomers: { kind: "stringList", maxItems: 20, itemMax: 80 },
    branding: {
      kind: "object",
      fields: {
        logoUrl: { kind: "url" },
        assetId: { kind: "assetId" },
        primaryColor: { kind: "hex" },
        guidelinesUrl: { kind: "url" },
      },
    },
    website: { kind: "url" },
    publicContact: {
      kind: "object",
      fields: {
        email: { kind: "email" },
        phone: { kind: "phone" },
        city: { kind: "string", max: 100 },
        country: { kind: "string", max: 100 },
        visibility: visibilityFields(),
      },
    },
    products: {
      kind: "collection",
      maxItems: 40,
      rules: ["priceCurrency"],
      fields: {
        name: { kind: "string", max: 150, required: true },
        description: { kind: "string", max: 2000 },
        url: { kind: "url" },
        price: { kind: "number", min: 0, max: 10000000 },
        currency: { kind: "currency" },
        imageUrl: { kind: "url" },
        assetId: { kind: "assetId" },
      },
    },
    credentials: {
      kind: "collection",
      maxItems: 40,
      managed: [verification],
      rules: ["expiryOrder"],
      fields: {
        recordType: { kind: "enum", values: CREDENTIAL_RECORD_TYPES, defaultValue: "certification" },
        title: { kind: "string", max: 150, required: true },
        issuer: { kind: "string", max: 150 },
        issueDate: { kind: "date" },
        expirationDate: { kind: "date" },
        evidenceUrl: { kind: "url" },
        assetId: { kind: "assetId" },
        description: { kind: "string", max: 2000 },
      },
    },
    services: {
      kind: "collection",
      maxItems: 40,
      fields: {
        name: { kind: "string", max: 150, required: true },
        description: { kind: "string", max: 2000 },
      },
    },
    team: {
      kind: "collection",
      maxItems: 50,
      fields: {
        name: { kind: "string", max: 120, required: true },
        role: { kind: "string", max: 120, required: true },
        isPublic: { kind: "boolean", defaultValue: false },
      },
    },
    location: {
      kind: "object",
      fields: {
        city: { kind: "string", max: 100 },
        state: { kind: "string", max: 100 },
        country: { kind: "string", max: 100 },
        addressLine: { kind: "string", max: 200 },
        timezone: { kind: "string", max: 80 },
        operatingHours: { kind: "string", max: 200 },
      },
    },
    registration: {
      kind: "object",
      managed: [registrationStatus],
      fields: {
        legalName: { kind: "string", max: 200 },
        registrationNumber: { kind: "string", max: 80 },
        jurisdiction: { kind: "string", max: 120 },
        issuedAt: { kind: "date" },
        documentStorageKey: { kind: "storageKey" },
        assetId: { kind: "assetId" },
      },
    },
    caseStudies: {
      kind: "collection",
      maxItems: 30,
      fields: {
        title: { kind: "string", max: 150, required: true },
        summary: { kind: "string", max: 2000 },
        url: { kind: "url" },
        assetId: { kind: "assetId" },
      },
    },
    resources: {
      kind: "collection",
      maxItems: 30,
      fields: {
        title: { kind: "string", max: 150, required: true },
        url: { kind: "url", required: true },
        visibility: { kind: "enum", values: RESOURCE_VISIBILITY, defaultValue: "private" },
      },
    },
  },
};
