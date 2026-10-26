/** Shared enums for domain profiles. Schemas and API contracts both import these. */

export const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "internship",
  "self_employed",
  "other",
] as const;

export const PROFICIENCIES = [
  "Familiar",
  "Beginner",
  "Intermediate",
  "Advanced",
  "Expert",
] as const;

export const EDUCATION_STATUSES = ["studying", "completed", "paused", "withdrawn"] as const;

export const VERIFICATION_STATUSES = ["pending", "verified", "rejected", "self-reported"] as const;

export const CLIENT_VERIFICATION = ["pending", "self-reported"] as const;

export const PRICING_MODELS = ["fixed", "hourly", "daily", "project", "retainer", "contact"] as const;

export const FREELANCER_AVAILABILITY = ["available", "limited", "booked", "unavailable"] as const;

export const CONTACT_CHANNELS = ["email", "phone", "either"] as const;

export const VISIBILITY = ["private", "recruiters", "public"] as const;

export const CONTENT_FORMATS = [
  "video",
  "article",
  "podcast",
  "newsletter",
  "short_form",
  "livestream",
  "other",
] as const;

export const AUDIENCE_SOURCES = ["platform_export", "self_reported", "third_party", "manual"] as const;

export const AUDIENCE_METRICS = [
  "followers",
  "subscribers",
  "views",
  "engagement_rate",
  "avg_views",
  "other",
] as const;

export const TESTIMONIAL_ATTRIBUTION = ["self-reported", "verified"] as const;

export const ORG_TYPES = [
  "sole_prop",
  "partnership",
  "llc",
  "corporation",
  "nonprofit",
  "government",
  "other",
] as const;

export const RESOURCE_VISIBILITY = ["public", "private"] as const;

export const MEDIA_SAMPLE_TYPES = ["image", "video", "pdf", "audio", "link", "other"] as const;

export const REGISTRATION_STATUSES = ["self-reported", "pending", "verified", "rejected"] as const;

export const RESUME_CONTENT_TYPES = ["application/pdf"] as const;

export const ENGAGEMENT_TYPES = ["fixed_price", "hourly", "contract", "retainer", "long_term"] as const;

export const COLLABORATION_TYPES = [
  "sponsored",
  "affiliate",
  "guest",
  "co_creation",
  "licensing",
  "other",
] as const;

export const BUSINESS_MODELS = [
  "b2b",
  "b2c",
  "b2b2c",
  "marketplace",
  "subscription",
  "services",
  "other",
] as const;

export const CREDENTIAL_RECORD_TYPES = ["certification", "award"] as const;
