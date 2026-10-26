import { isAssetPurpose, PURPOSE_POLICIES } from "./purposes";

export const MAX_PROFILE_PHOTO_SIZE = 2 * 1024 * 1024; // 2 MB

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function detectImageMimeType(buffer: Buffer): AllowedMimeType | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // JPEG: Starts with FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: Starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // WebP: Starts with 'RIFF' and has 'WEBP' at offset 8
  const riffHeader = buffer.subarray(0, 4).toString("ascii");
  const webpHeader = buffer.subarray(8, 12).toString("ascii");
  if (riffHeader === "RIFF" && webpHeader === "WEBP") {
    return "image/webp";
  }

  return null;
}

export function getExtensionForMimeType(mimeType: AllowedMimeType): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

export interface ValidationSuccess {
  valid: true;
  mimeType: AllowedMimeType;
  extension: string;
}

export interface ValidationFailure {
  valid: false;
  error: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export function validateProfilePhotoImage(
  buffer: Buffer,
  clientMimeType?: string
): ValidationResult {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: "Image file is empty or missing." };
  }

  if (buffer.length > MAX_PROFILE_PHOTO_SIZE) {
    return {
      valid: false,
      error: `Image exceeds maximum allowed size of 2 MB (received ${(
        buffer.length /
        (1024 * 1024)
      ).toFixed(2)} MB).`,
    };
  }

  const detectedMime = detectImageMimeType(buffer);
  if (!detectedMime) {
    return {
      valid: false,
      error:
        "Invalid or unsupported image format. Please upload a valid JPEG, PNG, or WebP file.",
    };
  }

  if (
    clientMimeType &&
    ALLOWED_MIME_TYPES.includes(clientMimeType as AllowedMimeType) &&
    clientMimeType !== detectedMime
  ) {
    // Client supplied MIME mismatched actual binary magic bytes
    return {
      valid: false,
      error: `File content (${detectedMime}) does not match supplied format (${clientMimeType}).`,
    };
  }

  return {
    valid: true,
    mimeType: detectedMime,
    extension: getExtensionForMimeType(detectedMime),
  };
}

export function detectPdf(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "";
  }
}

export interface AssetValidationSuccess {
  valid: true;
  mimeType: string;
  extension: string;
}

export function validateAssetContent(
  buffer: Buffer,
  purpose: string,
  clientMimeType?: string
): AssetValidationSuccess | ValidationFailure {
  if (!isAssetPurpose(purpose)) {
    return { valid: false, error: "Unsupported asset purpose." };
  }
  const policy = PURPOSE_POLICIES[purpose];
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: "File is empty or missing." };
  }
  if (buffer.length > policy.maxBytes) {
    const limitMb = (policy.maxBytes / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      error: `File exceeds the ${limitMb} MB limit for ${purpose}.`,
    };
  }

  let detected: string | null = detectImageMimeType(buffer);
  if (!detected && detectPdf(buffer)) detected = "application/pdf";
  if (!detected || !policy.mimeTypes.includes(detected)) {
    return {
      valid: false,
      error: `Unsupported file type for ${purpose}. Allowed types: ${policy.mimeTypes.join(", ")}.`,
    };
  }
  if (
    clientMimeType &&
    policy.mimeTypes.includes(clientMimeType) &&
    clientMimeType !== detected
  ) {
    return {
      valid: false,
      error: `File content (${detected}) does not match supplied format (${clientMimeType}).`,
    };
  }
  const extension = extensionForMime(detected);
  if (!extension) {
    return { valid: false, error: "Unsupported file type." };
  }
  return { valid: true, mimeType: detected, extension };
}
