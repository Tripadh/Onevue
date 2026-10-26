import { Schema } from "mongoose";
import {
  EDUCATION_STATUSES,
  EMPLOYMENT_TYPES,
  MEDIA_SAMPLE_TYPES,
  PROFICIENCIES,
  VERIFICATION_STATUSES,
  VISIBILITY,
} from "../../lib/domain-profile/constants";

export function text(max: number, required = false) {
  return required
    ? { type: String, required: true, trim: true, maxlength: max }
    : { type: String, trim: true, maxlength: max, default: "" };
}

export function stringList(itemMax: number, maxItems: number) {
  return {
    type: [{ type: String, trim: true, maxlength: itemMax }],
    default: [] as string[],
    validate: {
      validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= maxItems,
      message: `Cannot exceed ${maxItems} items`,
    },
  };
}

export function limitedArray(sub: Schema, maxItems: number) {
  return {
    type: [sub],
    default: [],
    validate: {
      validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= maxItems,
      message: `Cannot exceed ${maxItems} items`,
    },
  };
}

export const stableId = { type: String, trim: true, maxlength: 100, default: "" };

export function employmentSchema(withId: boolean, requireCore: boolean) {
  return new Schema(
    {
      id: stableId,
      company: text(150, requireCore),
      jobTitle: text(150, requireCore),
      employmentType: {
        type: String,
        enum: requireCore ? [...EMPLOYMENT_TYPES] : ["", ...EMPLOYMENT_TYPES],
        default: requireCore ? "full_time" : "",
        trim: true,
      },
      location: text(150),
      startDate: text(10),
      endDate: text(10),
      isCurrent: { type: Boolean, default: false },
      responsibilities: stringList(300, 20),
      achievements: stringList(300, 20),
    },
    { _id: withId }
  );
}

export function skillSchema() {
  return new Schema(
    {
      id: stableId,
      name: text(80, true),
      proficiency: {
        type: String,
        enum: [...PROFICIENCIES],
        default: "Intermediate",
      },
      yearsExperience: { type: Number, min: 0, max: 60, default: 0 },
    },
    { _id: true }
  );
}

export function certificationSchema() {
  return new Schema(
    {
      id: stableId,
      title: text(150, true),
      issuer: text(150, true),
      issueDate: text(10),
      expirationDate: text(10),
      credentialUrl: text(500),
      credentialId: text(100),
      assetId: text(32),
      verificationStatus: {
        type: String,
        enum: [...VERIFICATION_STATUSES],
        default: "self-reported",
      },
    },
    { _id: true }
  );
}

export function educationSchema() {
  return new Schema(
    {
      id: stableId,
      institution: text(150, true),
      degree: text(150, true),
      fieldOfStudy: text(150),
      startDate: text(10),
      endDate: text(10),
      currentStatus: {
        type: String,
        enum: [...EDUCATION_STATUSES],
        default: "studying",
      },
    },
    { _id: true }
  );
}

export function portfolioSchema() {
  return new Schema(
    {
      id: stableId,
      title: text(150, true),
      description: text(2000),
      url: text(500),
      role: text(120),
      assetId: text(32),
    },
    { _id: true }
  );
}

export function visibilitySchema(includePartnership = false) {
  const fields: Record<string, unknown> = {
    email: { type: String, enum: [...VISIBILITY], default: "private" },
    phone: { type: String, enum: [...VISIBILITY], default: "private" },
  };
  if (includePartnership) {
    fields.partnershipEmail = { type: String, enum: [...VISIBILITY], default: "private" };
  }
  return new Schema(fields, { _id: false });
}

export function workSampleSchema() {
  return new Schema(
    {
      id: stableId,
      title: text(150, true),
      url: text(500, true),
      assetId: text(32),
      mediaType: {
        type: String,
        enum: [...MEDIA_SAMPLE_TYPES],
        default: "link",
      },
    },
    { _id: true }
  );
}

export const userIdField = {
  type: Schema.Types.ObjectId,
  ref: "User",
  required: true,
  unique: true,
};
