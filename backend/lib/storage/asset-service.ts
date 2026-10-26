import { createHash } from "crypto";
import { Types } from "mongoose";
import connectToDatabase from "../db";
import { ProfileValidationError } from "../domain-profile/validate";
import StoredAsset, { IStoredAsset } from "../../models/StoredAsset";
import StudentProfile from "../../models/StudentProfile";
import ProfessionalProfile from "../../models/ProfessionalProfile";
import FreelancerProfile from "../../models/FreelancerProfile";
import CreatorProfile from "../../models/CreatorProfile";
import BusinessProfile from "../../models/BusinessProfile";
import PublishedProfileRevision from "../../models/PublishedProfileRevision";
import { getObjectStorage } from "./index";
import { buildObjectKey, createAssetId, isAssetId, sanitizeFileName } from "./keys";
import { publicAssetPath } from "./asset-refs";
import { isAssetPurpose, isPublicEligible, PURPOSE_POLICIES, type AssetPurpose } from "./purposes";
import { validateAssetContent } from "./validation";

export interface AssetMetadata {
  assetId: string;
  purpose: AssetPurpose;
  classification: "private" | "public-eligible";
  fileName: string;
  mimeType: string;
  size: number;
  checksum: string;
  status: "verified" | "deleted";
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AssetBinding {
  assetId: string;
  purpose: AssetPurpose;
}

const PURPOSE_BY_PATH: { test: RegExp; purpose: AssetPurpose }[] = [
  { test: /(^|\.)resume\.assetId$/, purpose: "resume" },
  { test: /(^|\.)registration\.assetId$/, purpose: "evidence" },
  { test: /(^|\.)achievements(?:\.\d+)?\.assetId$/, purpose: "evidence" },
  { test: /(^|\.)certifications(?:\.\d+)?\.assetId$/, purpose: "certificate" },
  { test: /(^|\.)credentials(?:\.\d+)?\.assetId$/, purpose: "certificate" },
  { test: /(^|\.)workSamples(?:\.\d+)?\.assetId$/, purpose: "portfolio-media" },
  { test: /(^|\.)mediaKit\.assetId$/, purpose: "portfolio-media" },
  { test: /(^|\.)featuredContent(?:\.\d+)?\.assetId$/, purpose: "portfolio-image" },
  { test: /(^|\.)products(?:\.\d+)?\.assetId$/, purpose: "portfolio-image" },
  { test: /(^|\.)branding\.assetId$/, purpose: "portfolio-image" },
  { test: /(^|\.)caseStudies(?:\.\d+)?\.assetId$/, purpose: "portfolio-image" },
  { test: /(^|\.)portfolio(?:\.\d+)?\.assetId$/, purpose: "portfolio-image" },
  { test: /(^|\.)projects(?:\.\d+)?\.assetId$/, purpose: "portfolio-image" },
  { test: /(^|\.)media(?:\.\d+)?\.assetId$/, purpose: "portfolio-media" },
];

function asModel<T>(model: T): T {
  if (model && typeof model === "object" && "default" in (model as object)) {
    const wrapped = model as { default?: T };
    if (wrapped.default) return wrapped.default;
  }
  return model;
}

function assetModel() {
  return asModel(StoredAsset);
}

export function toAssetMetadata(asset: IStoredAsset): AssetMetadata {
  return {
    assetId: asset.assetId,
    purpose: asset.purpose,
    classification: asset.classification,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    size: asset.size,
    checksum: asset.checksum,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function purposeForPath(path: string): AssetPurpose | null {
  for (const rule of PURPOSE_BY_PATH) {
    if (rule.test.test(path)) return rule.purpose;
  }
  return null;
}

export function collectAssetBindings(value: unknown, path = ""): AssetBinding[] {
  const found: AssetBinding[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      found.push(...collectAssetBindings(entry, `${path}.${index}`));
    });
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if ((key === "assetId" || key.endsWith(".assetId")) && typeof child === "string" && child.trim()) {
      const purpose = purposeForPath(childPath);
      if (!purpose) {
        throw new ProfileValidationError(`Field '${childPath}' cannot store an uploaded file.`);
      }
      if (!isAssetId(child.trim())) {
        throw new ProfileValidationError(`Field '${childPath}' is not a valid asset reference.`);
      }
      found.push({ assetId: child.trim(), purpose });
      continue;
    }
    found.push(...collectAssetBindings(child, childPath));
  }
  return found;
}

export async function assertProfileAssetRefs(ownerId: string, bindings: AssetBinding[]): Promise<void> {
  if (bindings.length === 0) return;
  await connectToDatabase();
  const Model = assetModel();
  for (const binding of bindings) {
    const asset = await Model.findOne({ assetId: binding.assetId, status: "verified" });
    if (!asset || String(asset.ownerId) !== String(ownerId) || asset.purpose !== binding.purpose) {
      throw new ProfileValidationError(
        "That uploaded file is not available for this profile field.",
        403
      );
    }
  }
}

async function profileStillReferences(ownerId: string, assetId: string): Promise<boolean> {
  const owner = new Types.ObjectId(ownerId);
  const checks = [
    asModel(StudentProfile).exists({
      userId: owner,
      $or: [
        { "resume.assetId": assetId },
        { "projects.assetId": assetId },
        { "media.assetId": assetId },
        { "achievements.assetId": assetId },
        { "credentials.assetId": assetId },
      ],
    }),
    asModel(ProfessionalProfile).exists({
      userId: owner,
      $or: [
        { "resume.assetId": assetId },
        { "portfolio.assetId": assetId },
        { "achievements.assetId": assetId },
        { "certifications.assetId": assetId },
      ],
    }),
    asModel(FreelancerProfile).exists({
      userId: owner,
      $or: [{ "portfolio.assetId": assetId }, { "workSamples.assetId": assetId }],
    }),
    asModel(CreatorProfile).exists({
      userId: owner,
      $or: [{ "featuredContent.assetId": assetId }, { "mediaKit.assetId": assetId }],
    }),
    asModel(BusinessProfile).exists({
      userId: owner,
      $or: [
        { "branding.assetId": assetId },
        { "products.assetId": assetId },
        { "credentials.assetId": assetId },
        { "caseStudies.assetId": assetId },
        { "registration.assetId": assetId },
      ],
    }),
  ];
  const results = await Promise.all(checks);
  return results.some(Boolean);
}

export async function isAssetPublished(ownerId: string, assetId: string): Promise<boolean> {
  await connectToDatabase();
  const Revision = asModel(PublishedProfileRevision);
  const listed = await Revision.exists({ userId: ownerId, publicAssetIds: assetId });
  if (listed) return true;
  const needle = publicAssetPath(assetId);
  const revisions = await Revision.find({ userId: ownerId }).select("snapshot").limit(30).lean();
  return revisions.some((revision) => JSON.stringify(revision.snapshot).includes(needle));
}

export async function uploadAsset(input: {
  ownerId: string;
  purpose: string;
  buffer: Buffer;
  clientMimeType?: string;
  fileName?: string;
  idempotencyKey?: string | null;
}): Promise<AssetMetadata> {
  if (!Types.ObjectId.isValid(input.ownerId)) {
    throw new ProfileValidationError("Authenticated user is invalid.", 401);
  }
  if (!isAssetPurpose(input.purpose)) {
    throw new ProfileValidationError("Unsupported asset purpose.");
  }
  const validation = validateAssetContent(input.buffer, input.purpose, input.clientMimeType);
  if (!validation.valid) {
    throw new ProfileValidationError(validation.error);
  }
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const checksum = createHash("sha256").update(input.buffer).digest("hex");
  await connectToDatabase();
  const Model = assetModel();

  if (idempotencyKey) {
    const existing = await Model.findOne({
      ownerId: input.ownerId,
      idempotencyKey,
      status: "verified",
    });
    if (existing) {
      if (existing.checksum !== checksum || existing.purpose !== input.purpose) {
        throw new ProfileValidationError(
          "This idempotency key was already used for a different upload.",
          409
        );
      }
      return toAssetMetadata(existing);
    }
  }

  const assetId = createAssetId();
  const objectKey = buildObjectKey(input.purpose, input.ownerId, assetId, validation.extension);
  const storage = getObjectStorage();
  await storage.putObject({
    key: objectKey,
    body: input.buffer,
    contentType: validation.mimeType,
    metadata: { purpose: input.purpose, assetId },
  });

  try {
    const created = await Model.create({
      assetId,
      ownerId: input.ownerId,
      objectKey,
      purpose: input.purpose,
      classification: PURPOSE_POLICIES[input.purpose].classification,
      fileName: sanitizeFileName(input.fileName || "file"),
      mimeType: validation.mimeType,
      size: input.buffer.length,
      checksum,
      status: "verified",
      idempotencyKey,
    });
    return toAssetMetadata(created);
  } catch (error) {
    try {
      await storage.deleteObject(objectKey);
    } catch (cleanupError) {
      console.error("Failed to remove object after asset record save failed:", cleanupError);
    }
    const code = (error as { code?: number }).code;
    if (code === 11000 && idempotencyKey) {
      const existing = await Model.findOne({
        ownerId: input.ownerId,
        idempotencyKey,
        status: "verified",
      });
      if (existing && existing.checksum === checksum && existing.purpose === input.purpose) {
        return toAssetMetadata(existing);
      }
    }
    throw error;
  }
}

export async function listOwnedAssets(ownerId: string): Promise<AssetMetadata[]> {
  await connectToDatabase();
  const assets = await assetModel()
    .find({ ownerId, status: "verified" })
    .sort({ createdAt: -1 })
    .limit(200);
  return assets.map((asset) => toAssetMetadata(asset));
}

export async function getOwnedAsset(ownerId: string, assetId: string): Promise<IStoredAsset | null> {
  if (!isAssetId(assetId)) return null;
  await connectToDatabase();
  return assetModel().findOne({ assetId, ownerId, status: "verified" });
}

export async function readOwnedAsset(ownerId: string, assetId: string) {
  const asset = await getOwnedAsset(ownerId, assetId);
  if (!asset) return null;
  const stored = await getObjectStorage().getObject(asset.objectKey);
  if (!stored) return null;
  const checked = validateAssetContent(stored.buffer, asset.purpose, asset.mimeType);
  if (!checked.valid || checked.mimeType !== asset.mimeType) return null;
  return { asset, body: stored.buffer, contentType: asset.mimeType };
}

export async function readPublishedAsset(assetId: string) {
  if (!isAssetId(assetId)) return null;
  await connectToDatabase();
  const asset = await assetModel().findOne({ assetId, status: "verified" });
  if (!asset || !isPublicEligible(asset.purpose)) return null;
  const published = await isAssetPublished(String(asset.ownerId), asset.assetId);
  if (!published) return null;
  const stored = await getObjectStorage().getObject(asset.objectKey);
  if (!stored) return null;
  const checked = validateAssetContent(stored.buffer, asset.purpose, asset.mimeType);
  if (!checked.valid || checked.mimeType !== asset.mimeType) return null;
  return { asset, body: stored.buffer, contentType: asset.mimeType };
}

export async function deleteOwnedAsset(ownerId: string, assetId: string): Promise<"deleted" | "missing" | "in-use"> {
  if (!isAssetId(assetId)) return "missing";
  await connectToDatabase();
  const Model = assetModel();
  const asset = await Model.findOne({ assetId, ownerId });
  if (!asset) return "missing";
  if (asset.status === "deleted") {
    await getObjectStorage().deleteObject(asset.objectKey).catch((error: { name?: string }) => {
      if (error?.name === "NoSuchKey" || error?.name === "NotFound") return false;
      throw error;
    });
    return "deleted";
  }
  if (await profileStillReferences(ownerId, assetId)) return "in-use";
  if (await isAssetPublished(ownerId, assetId)) return "in-use";
  const objectKey = asset.objectKey;
  asset.status = "deleted";
  asset.idempotencyKey = null;
  await asset.save();
  try {
    await getObjectStorage().deleteObject(objectKey);
  } catch (error) {
    console.error("Asset record was marked deleted but the object could not be removed:", error);
    throw error;
  }
  return "deleted";
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(trimmed)) {
    throw new ProfileValidationError("Idempotency-Key must be 8 to 80 letters, numbers, dashes, or underscores.");
  }
  return trimmed;
}
