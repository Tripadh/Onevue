import { Schema, model, models } from "mongoose";
import {
  AUDIENCE_METRICS,
  AUDIENCE_SOURCES,
  CONTENT_FORMATS,
  VERIFICATION_STATUSES,
} from "../lib/domain-profile/constants";
import { limitedArray, stableId, text, userIdField, visibilitySchema } from "./domain/fragments";

const FeaturedSchema = new Schema(
  {
    id: stableId,
    title: text(150, true),
    url: text(500, true),
    format: { type: String, enum: [...CONTENT_FORMATS], default: "video" },
    category: text(80),
    publishedAt: text(10),
    summary: text(1000),
  },
  { _id: true }
);

const ChannelSchema = new Schema(
  {
    id: stableId,
    platform: text(80, true),
    url: text(500, true),
    handle: text(80),
  },
  { _id: true }
);

const AudienceSchema = new Schema(
  {
    id: stableId,
    platform: text(80, true),
    metric: { type: String, enum: [...AUDIENCE_METRICS], required: true },
    value: { type: Number, required: true, min: 0, max: 1000000000000 },
    source: { type: String, enum: [...AUDIENCE_SOURCES], required: true },
    measuredAt: text(10, true),
    verificationStatus: {
      type: String,
      enum: [...VERIFICATION_STATUSES],
      default: "self-reported",
    },
  },
  { _id: true }
);

const MediaKitSchema = new Schema(
  { summary: text(2000), kitUrl: text(500) },
  { _id: false }
);

const CollaborationSchema = new Schema(
  {
    openToCollab: { type: Boolean, default: false },
    preferences: text(1000),
    brandSafetyNotes: text(1000),
  },
  { _id: false }
);

const SponsorshipSchema = new Schema(
  {
    available: { type: Boolean, default: false },
    rateMin: { type: Number, min: 0, max: 10000000 },
    rateMax: { type: Number, min: 0, max: 10000000 },
    currency: text(8),
    notes: text(1000),
  },
  { _id: false }
);

const ContactSchema = new Schema(
  {
    email: text(200),
    partnershipEmail: text(200),
    visibility: {
      type: visibilitySchema(true),
      default: () => ({ email: "private", phone: "private", partnershipEmail: "private" }),
    },
  },
  { _id: false }
);

const CreatorProfileSchema = new Schema(
  {
    userId: userIdField,
    bio: text(3000),
    niche: text(150),
    featuredContent: limitedArray(FeaturedSchema, 30),
    channels: limitedArray(ChannelSchema, 20),
    contentCategories: {
      type: [{ type: String, trim: true, maxlength: 60 }],
      default: [],
      validate: {
        validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= 20,
        message: "Cannot exceed 20 categories",
      },
    },
    contentFormats: {
      type: [{ type: String, enum: [...CONTENT_FORMATS] }],
      default: [],
      validate: {
        validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= 12,
        message: "Cannot exceed 12 formats",
      },
    },
    mediaKit: { type: MediaKitSchema, default: () => ({ summary: "", kitUrl: "" }) },
    collaboration: {
      type: CollaborationSchema,
      default: () => ({ openToCollab: false, preferences: "", brandSafetyNotes: "" }),
    },
    sponsorship: {
      type: SponsorshipSchema,
      default: () => ({ available: false, currency: "", notes: "" }),
    },
    audienceStats: limitedArray(AudienceSchema, 30),
    contact: {
      type: ContactSchema,
      default: () => ({
        email: "",
        partnershipEmail: "",
        visibility: { email: "private", phone: "private", partnershipEmail: "private" },
      }),
    },
  },
  { timestamps: true, strict: true }
);

if (models.CreatorProfile) {
  delete (models as Record<string, unknown>).CreatorProfile;
}

const CreatorProfile = models.CreatorProfile || model("CreatorProfile", CreatorProfileSchema);

export default CreatorProfile;
