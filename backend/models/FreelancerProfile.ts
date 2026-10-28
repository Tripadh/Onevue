import { Schema, model, models } from "mongoose";
import { ENGAGEMENT_TYPES, FREELANCER_AVAILABILITY, PRICING_MODELS, TESTIMONIAL_ATTRIBUTION, CONTACT_CHANNELS } from "../lib/domain-profile/constants";
import {
  limitedArray,
  skillSchema,
  stringList,
  text,
  userIdField,
  visibilitySchema,
  workSampleSchema,
  stableId,
  customLayoutField,
  recordCustomFieldsArray,
} from "./domain/fragments";

const PackageSchema = new Schema(
  {
    id: stableId,
    name: text(150, true),
    description: text(2000),
    features: stringList(200, 20),
    pricingModel: { type: String, enum: [...PRICING_MODELS], default: "fixed" },
    currency: text(8),
    price: { type: Number, min: 0, max: 10000000 },
    deliveryDays: { type: Number, min: 0, max: 3650 },
    revisionCount: { type: Number, min: 0, max: 100 },
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const WorkExperienceSchema = new Schema(
  {
    id: stableId,
    company: text(150, true),
    jobTitle: text(150, true),
    description: text(2000),
    responsibilities: stringList(300, 20),
    startDate: text(10),
    endDate: text(10),
    isCurrent: { type: Boolean, default: false },
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const PortfolioSchema = new Schema(
  {
    id: stableId,
    title: text(150, true),
    summary: text(2000),
    url: text(500),
    outcome: text(500),
    assetId: text(32),
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const ServiceSchema = new Schema(
  {
    id: { type: String, trim: true, maxlength: 100, default: "" },
    name: text(150, true),
    description: text(2000),
    pricingModel: { type: String, enum: [...PRICING_MODELS], default: "hourly" },
    currency: text(8),
    rateMin: { type: Number, min: 0, max: 10000000 },
    rateMax: { type: Number, min: 0, max: 10000000 },
    deliveryDays: { type: Number, min: 0, max: 3650 },
    packages: limitedArray(PackageSchema, 8),
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const TestimonialSchema = new Schema(
  {
    id: { type: String, trim: true, maxlength: 100, default: "" },
    quote: text(1000, true),
    authorName: text(120, true),
    relationship: text(120),
    attribution: {
      type: String,
      enum: [...TESTIMONIAL_ATTRIBUTION],
      default: "self-reported",
    },
    customFields: recordCustomFieldsArray(),
  },
  { _id: true }
);

const ContactSchema = new Schema(
  {
    email: text(200),
    phone: text(30),
    preferredChannel: { type: String, enum: [...CONTACT_CHANNELS], default: "email" },
    visibility: { type: visibilitySchema(false), default: () => ({ email: "private", phone: "private" }) },
    customFields: recordCustomFieldsArray(),
  },
  { _id: false }
);

const FreelancerProfileSchema = new Schema(
  {
    userId: userIdField,
    headline: text(200),
    bio: text(3000),
    specialization: text(150),
    availability: { type: String, enum: [...FREELANCER_AVAILABILITY], default: "available" },
    engagementTypes: {
      type: [{ type: String, enum: [...ENGAGEMENT_TYPES], trim: true }],
      default: [],
      validate: {
        validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= 8,
        message: "Cannot exceed 8 engagement types",
      },
    },
    services: limitedArray(ServiceSchema, 40),
    workExperience: limitedArray(WorkExperienceSchema, 30),
    skills: limitedArray(skillSchema(), 60),
    technologies: {
      type: [{ type: String, trim: true, maxlength: 40 }],
      default: [],
      validate: {
        validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= 40,
        message: "Cannot exceed 40 technologies",
      },
    },
    portfolio: limitedArray(PortfolioSchema, 30),
    testimonials: limitedArray(TestimonialSchema, 30),
    workSamples: limitedArray(workSampleSchema(), 30),
    contact: {
      type: ContactSchema,
      default: () => ({
        email: "",
        phone: "",
        preferredChannel: "email",
        visibility: { email: "private", phone: "private" },
      }),
    },
    aboutCustomFields: recordCustomFieldsArray(),
    customLayout: customLayoutField,
  },
  { timestamps: true, strict: true }
);

if (models.FreelancerProfile) {
  delete (models as Record<string, unknown>).FreelancerProfile;
}

const FreelancerProfile = models.FreelancerProfile || model("FreelancerProfile", FreelancerProfileSchema);

export default FreelancerProfile;
