import { Schema, model, models } from "mongoose";
import { BUSINESS_MODELS, CREDENTIAL_RECORD_TYPES, ORG_TYPES, REGISTRATION_STATUSES, RESOURCE_VISIBILITY, VERIFICATION_STATUSES } from "../lib/domain-profile/constants";
import { customLayoutField, limitedArray, stableId, text, userIdField, visibilitySchema, recordCustomFieldsArray } from "./domain/fragments";

const BrandingSchema = new Schema(
  {
    logoUrl: text(500),
    assetId: text(32),
    primaryColor: text(7),
    guidelinesUrl: text(500),
    customFields: recordCustomFieldsArray(),
  },
  { _id: false }
);

const PublicContactSchema = new Schema(
  {
    email: text(200),
    phone: text(30),
    city: text(100),
    country: text(100),
    visibility: { type: visibilitySchema(false), default: () => ({ email: "private", phone: "private" }) },
    customFields: recordCustomFieldsArray(),
  },
  { _id: false }
);

const ProductSchema = new Schema(
  {
    id: stableId,
    name: text(150, true),
    description: text(2000),
    url: text(500),
    price: { type: Number, min: 0, max: 10000000 },
    currency: text(8),
    imageUrl: text(500),
    assetId: text(32),
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const CredentialSchema = new Schema(
  {
    id: stableId,
    recordType: { type: String, enum: [...CREDENTIAL_RECORD_TYPES], default: "certification" },
    title: text(150, true),
    issuer: text(150),
    issueDate: text(10),
    expirationDate: text(10),
    evidenceUrl: text(500),
    assetId: text(32),
    description: text(2000),
    verificationStatus: {
      type: String,
      enum: [...VERIFICATION_STATUSES],
      default: "self-reported",
    },
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const ServiceSchema = new Schema(
  {
    id: stableId,
    name: text(150, true),
    description: text(2000),
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const TeamSchema = new Schema(
  {
    id: stableId,
    name: text(120, true),
    role: text(120, true),
    isPublic: { type: Boolean, default: false },
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const LocationSchema = new Schema(
  {
    city: text(100),
    state: text(100),
    country: text(100),
    addressLine: text(200),
    timezone: text(80),
    operatingHours: text(200),
  },
  { _id: false }
);

const RegistrationSchema = new Schema(
  {
    legalName: text(200),
    registrationNumber: text(80),
    jurisdiction: text(120),
    issuedAt: text(10),
    documentStorageKey: text(300),
    assetId: text(32),
    status: {
      type: String,
      enum: [...REGISTRATION_STATUSES],
      default: "self-reported",
    },
    customFields: recordCustomFieldsArray(),
  },
  { _id: false }
);

const CaseStudySchema = new Schema(
  {
    id: stableId,
    title: text(150, true),
    summary: text(2000),
    url: text(500),
    assetId: text(32),
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const ResourceSchema = new Schema(
  {
    id: stableId,
    title: text(150, true),
    url: text(500, true),
    visibility: { type: String, enum: [...RESOURCE_VISIBILITY], default: "private" },
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const BusinessProfileSchema = new Schema(
  {
    userId: userIdField,
    businessName: text(150),
    tagline: text(160),
    description: text(3000),
    mission: text(2000),
    organizationType: {
      type: String,
      enum: ["", ...ORG_TYPES],
      default: "",
      trim: true,
    },
    industry: text(120),
    foundedYear: { type: Number, min: 1800, max: 2100 },
    businessModel: {
      type: String,
      enum: ["", ...BUSINESS_MODELS],
      default: "",
      trim: true,
    },
    targetCustomers: {
      type: [{ type: String, trim: true, maxlength: 80 }],
      default: [],
      validate: {
        validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= 20,
        message: "Cannot exceed 20 target customers",
      },
    },
    branding: { type: BrandingSchema, default: () => ({ logoUrl: "", primaryColor: "", guidelinesUrl: "" }) },
    website: text(500),
    publicContact: {
      type: PublicContactSchema,
      default: () => ({
        email: "",
        phone: "",
        city: "",
        country: "",
        visibility: { email: "private", phone: "private" },
      }),
    },
    products: limitedArray(ProductSchema, 40),
    credentials: limitedArray(CredentialSchema, 40),
    services: limitedArray(ServiceSchema, 40),
    team: limitedArray(TeamSchema, 50),
    location: {
      type: LocationSchema,
      default: () => ({
        city: "",
        state: "",
        country: "",
        addressLine: "",
        timezone: "",
        operatingHours: "",
      }),
    },
    registration: {
      type: RegistrationSchema,
      default: () => ({
        legalName: "",
        registrationNumber: "",
        jurisdiction: "",
        issuedAt: "",
        documentStorageKey: "",
        status: "self-reported",
      }),
    },
    caseStudies: limitedArray(CaseStudySchema, 30),
    resources: limitedArray(ResourceSchema, 30),
    aboutCustomFields: recordCustomFieldsArray(),
    customLayout: customLayoutField,
  },
  { timestamps: true, strict: true }
);

if (models.BusinessProfile) {
  delete (models as Record<string, unknown>).BusinessProfile;
}

const BusinessProfile = models.BusinessProfile || model("BusinessProfile", BusinessProfileSchema);

export default BusinessProfile;
