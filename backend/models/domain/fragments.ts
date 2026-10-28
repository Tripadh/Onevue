import { Schema } from "mongoose";
import { CUSTOM_FIELD_TYPES } from "../../lib/custom-fields/types";
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


export const RecordCustomFieldSchema = new Schema(
  {
    id: { type: String, required: true, trim: true, maxlength: 100 },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    type: {
      type: String,
      required: true,
      enum: [...CUSTOM_FIELD_TYPES],
      default: "text",
    },
    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    order: { type: Number, default: 0 },
    value: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

export function recordCustomFieldsArray() {
  return {
    type: [RecordCustomFieldSchema],
    default: () => [],
    validate: {
      validator: (arr: unknown[]) => Array.isArray(arr) && arr.length <= 30,
      message: "Cannot exceed 30 custom fields per record",
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
      customFields: recordCustomFieldsArray(),
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
      customFields: recordCustomFieldsArray(),
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
      customFields: recordCustomFieldsArray(),
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
      customFields: recordCustomFieldsArray(),
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
      customFields: recordCustomFieldsArray(),
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
      customFields: recordCustomFieldsArray(),
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

/** Embedded custom-field layout. Absent on profiles created before the feature. */
export const customLayoutField = {
  type: Schema.Types.Mixed,
  required: false,
};
