export const ASSET_PURPOSES = [
  "profile-photo",
  "visiting-card",
  "portfolio-image",
  "portfolio-media",
  "resume",
  "evidence",
  "certificate",
] as const;

export type AssetPurpose = (typeof ASSET_PURPOSES)[number];

export type AssetClassification = "private" | "public-eligible";

export interface PurposePolicy {
  purpose: AssetPurpose;
  classification: AssetClassification;
  maxBytes: number;
  mimeTypes: readonly string[];
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const DOCUMENT_TYPES = ["application/pdf"] as const;

export const PURPOSE_POLICIES: Record<AssetPurpose, PurposePolicy> = {
  "profile-photo": {
    purpose: "profile-photo",
    classification: "private",
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_TYPES,
  },
  "visiting-card": {
    purpose: "visiting-card",
    classification: "private",
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: IMAGE_TYPES,
  },
  "portfolio-image": {
    purpose: "portfolio-image",
    classification: "public-eligible",
    maxBytes: 5 * 1024 * 1024,
    mimeTypes: IMAGE_TYPES,
  },
  "portfolio-media": {
    purpose: "portfolio-media",
    classification: "public-eligible",
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: [...IMAGE_TYPES, ...DOCUMENT_TYPES],
  },
  resume: {
    purpose: "resume",
    classification: "private",
    maxBytes: 10 * 1024 * 1024,
    mimeTypes: DOCUMENT_TYPES,
  },
  evidence: {
    purpose: "evidence",
    classification: "private",
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: [...IMAGE_TYPES, ...DOCUMENT_TYPES],
  },
  certificate: {
    purpose: "certificate",
    classification: "private",
    maxBytes: 8 * 1024 * 1024,
    mimeTypes: [...IMAGE_TYPES, ...DOCUMENT_TYPES],
  },
};

export function isAssetPurpose(value: string): value is AssetPurpose {
  return Object.prototype.hasOwnProperty.call(PURPOSE_POLICIES, value);
}

export function isPublicEligible(purpose: AssetPurpose): boolean {
  return PURPOSE_POLICIES[purpose].classification === "public-eligible";
}
