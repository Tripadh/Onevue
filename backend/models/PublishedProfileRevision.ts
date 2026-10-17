import { Schema, model, models } from "mongoose";
import { PublicProfileDTO_v1, PUBLIC_PROFILE_SCHEMA_VERSION } from "../lib/public-profile-dto";

/* =========================================================================
   OneVue Published Profile Revision Model (Immutable Publication Snapshot)
   ========================================================================= */

export interface IPublishedProfileRevision {
  _id?: Schema.Types.ObjectId | string;
  userId: Schema.Types.ObjectId;
  websiteConfigId: Schema.Types.ObjectId;
  revisionNumber: number;
  templateId: string;
  templateVersion: string;
  snapshot: PublicProfileDTO_v1;
  checksum: string;
  publishedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const PublishedProfileRevisionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "userId is required"],
      index: true,
    },
    websiteConfigId: {
      type: Schema.Types.ObjectId,
      ref: "UserWebsiteConfig",
      required: [true, "websiteConfigId is required"],
      index: true,
    },
    revisionNumber: {
      type: Number,
      required: [true, "revisionNumber is required"],
      min: [1, "revisionNumber must be at least 1"],
    },
    templateId: {
      type: String,
      required: [true, "templateId is required"],
      trim: true,
    },
    templateVersion: {
      type: String,
      required: [true, "templateVersion is required"],
      trim: true,
    },
    snapshot: {
      type: Schema.Types.Mixed,
      required: [true, "snapshot is required"],
    },
    checksum: {
      type: String,
      required: [true, "checksum is required"],
      trim: true,
      match: [/^[a-f0-9]{64}$/i, "Checksum must be a valid 64-character SHA-256 hexadecimal string"],
    },
    publishedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Validate snapshot conformity to PublicProfileDTO
PublishedProfileRevisionSchema.path("snapshot").validate(function (v: any) {
  return Boolean(
    v &&
    typeof v === "object" &&
    v.meta &&
    v.meta.schemaVersion === PUBLIC_PROFILE_SCHEMA_VERSION &&
    v.profile &&
    typeof v.profile.displayName === "string"
  );
}, `Snapshot must conform to PublicProfileDTO_${PUBLIC_PROFILE_SCHEMA_VERSION}`);

// Enforce unique revision numbers per user
PublishedProfileRevisionSchema.index({ userId: 1, revisionNumber: -1 }, { unique: true });

// Enforce application-level snapshot immutability
PublishedProfileRevisionSchema.pre("save", function () {
  if (!this.isNew) {
    throw new Error("PublishedProfileRevision is immutable. Existing revisions cannot be modified.");
  }
});

PublishedProfileRevisionSchema.pre("updateOne", function () {
  throw new Error("PublishedProfileRevision is immutable. Direct updates are prohibited.");
});

PublishedProfileRevisionSchema.pre("updateMany", function () {
  throw new Error("PublishedProfileRevision is immutable. Direct updates are prohibited.");
});

PublishedProfileRevisionSchema.pre("findOneAndUpdate", function () {
  throw new Error("PublishedProfileRevision is immutable. Direct updates are prohibited.");
});

// Hot-reload-safe model registration
if (models.PublishedProfileRevision) {
  delete (models as Record<string, unknown>).PublishedProfileRevision;
}

const PublishedProfileRevision =
  models.PublishedProfileRevision ||
  model("PublishedProfileRevision", PublishedProfileRevisionSchema);

export default PublishedProfileRevision;
