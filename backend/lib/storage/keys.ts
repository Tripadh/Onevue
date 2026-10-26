import { randomBytes } from "crypto";

/** Stable public identifier. This is not an object key and contains no bucket path. */
export const ASSET_ID_PATTERN = /^ast_[a-f0-9]{24}$/;

const OBJECT_KEY_PATTERN =
  /^(profile-photo|visiting-card|portfolio-image|portfolio-media|resume|evidence|certificate)\/[a-f0-9]{24}\/ast_[a-f0-9]{24}\.[a-z0-9]{1,8}$/;

const LEGACY_PHOTO_KEY = /^user_[A-Za-z0-9]+_[0-9]+_[a-f0-9]+\.(jpg|png|webp)$/;

const PREFIXED_PHOTO_KEY =
  /^profile-photos\/[A-Za-z0-9]{1,64}_[0-9]{10,16}_[a-f0-9]{16}\.(jpg|png|webp)$/;

export function createAssetId(): string {
  return `ast_${randomBytes(12).toString("hex")}`;
}

export function isAssetId(value: string): boolean {
  return ASSET_ID_PATTERN.test(value);
}

export function buildObjectKey(
  purpose: string,
  ownerId: string,
  assetId: string,
  extension: string
): string {
  const owner = String(ownerId || "").toLowerCase();
  const ext = String(extension || "").toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(purpose)) {
    throw new Error("Invalid storage purpose.");
  }
  if (!/^[a-f0-9]{24}$/.test(owner)) {
    throw new Error("Invalid owner id.");
  }
  if (!isAssetId(assetId)) {
    throw new Error("Invalid asset id.");
  }
  if (!/^[a-z0-9]{1,8}$/.test(ext)) {
    throw new Error("Invalid file extension.");
  }
  const key = `${purpose}/${owner}/${assetId}.${ext}`;
  assertSafeObjectKey(key);
  return key;
}

export function assertSafeObjectKey(key: string): void {
  if (typeof key !== "string" || !OBJECT_KEY_PATTERN.test(key) || key.includes("..") || key.includes("\\") || key.includes("\0")) {
    throw new Error("Invalid object key.");
  }
}

export function isLegacyProfilePhotoKey(key: string): boolean {
  return LEGACY_PHOTO_KEY.test(key);
}

export function isPrefixedProfilePhotoKey(key: string): boolean {
  return PREFIXED_PHOTO_KEY.test(key);
}

export function sanitizeFileName(name: string): string {
  const base = String(name || "file")
    .replace(/\\/g, "/")
    .split("/")
    .pop() || "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned || "file";
}
