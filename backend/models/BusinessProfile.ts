import { Schema, model, models } from "mongoose";
import { ORG_TYPES, REGISTRATION_STATUSES, RESOURCE_VISIBILITY } from "../lib/domain-profile/constants";
import { limitedArray, stableId, text, userIdField, visibilitySchema } from "./domain/fragments";

const BrandingSchema = new Schema(
  {
    logoUrl: text(500),
    primaryColor: text(7),
    guidelinesUrl: text(500),
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
  },
  { _id: false }
);

const ProductSchema = new Schema(
  {
    id: stableId,
    name: text(150, true),
    description: text(2000),
    url: text(500),
  },
  { _id: true }
);

const ServiceSchema = new Schema(
  {
    id: stableId,
    name: text(150, true),
    description: text(2000),
  },
  { _id: true }
);

const TeamSchema = new Schema(
  {
    id: stableId,
    name: text(120, true),
    role: text(120, true),
    isPublic: { type: Boolean, default: false },
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
    status: {
      type: String,
      enum: [...REGISTRATION_STATUSES],
      default: "self-reported",
    },
  },
  { _id: false }
);

const CaseStudySchema = new Schema(
  {
    id: stableId,
    title: text(150, true),
    summary: text(2000),
    url: text(500),
  },
  { _id: true }
);

const ResourceSchema = new Schema(
  {
    id: stableId,
    title: text(150, true),
    url: text(500, true),
    visibility: { type: String, enum: [...RESOURCE_VISIBILITY], default: "private" },
  },
  { _id: true }
);

const BusinessProfileSchema = new Schema(
  {
    userId: userIdField,
    businessName: text(150),
    description: text(3000),
    mission: text(2000),
    organizationType: {
      type: String,
      enum: ["", ...ORG_TYPES],
      default: "",
      trim: true,
    },
    industry: text(120),
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
  },
  { timestamps: true, strict: true }
);

if (models.BusinessProfile) {
  delete (models as Record<string, unknown>).BusinessProfile;
}

const BusinessProfile = models.BusinessProfile || model("BusinessProfile", BusinessProfileSchema);

export default BusinessProfile;
