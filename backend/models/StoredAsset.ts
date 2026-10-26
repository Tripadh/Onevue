import { Schema, model, models, Types } from "mongoose";
import { ASSET_PURPOSES, type AssetClassification, type AssetPurpose } from "../lib/storage/purposes";

export interface IStoredAsset {
  _id?: Types.ObjectId;
  assetId: string;
  ownerId: Types.ObjectId;
  objectKey: string;
  purpose: AssetPurpose;
  classification: AssetClassification;
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  status: "verified" | "deleted";
  idempotencyKey?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const StoredAssetSchema = new Schema<IStoredAsset>(
  {
    assetId: {
      type: String,
      required: true,
      unique: true,
      match: /^ast_[a-f0-9]{24}$/,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    objectKey: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      required: true,
      enum: [...ASSET_PURPOSES],
    },
    classification: {
      type: String,
      required: true,
      enum: ["private", "public-eligible"],
    },
    fileName: {
      type: String,
      required: true,
      maxlength: 120,
    },
    mimeType: {
      type: String,
      required: true,
      maxlength: 100,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    checksum: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
    },
    status: {
      type: String,
      required: true,
      enum: ["verified", "deleted"],
      default: "verified",
    },
    idempotencyKey: {
      type: String,
      default: null,
      maxlength: 80,
    },
  },
  { timestamps: true }
);

StoredAssetSchema.index({ ownerId: 1, purpose: 1, createdAt: -1 });
StoredAssetSchema.index(
  { ownerId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);

if (models.StoredAsset) {
  delete (models as Record<string, unknown>).StoredAsset;
}

const StoredAsset = models.StoredAsset || model<IStoredAsset>("StoredAsset", StoredAssetSchema);

export default StoredAsset;
