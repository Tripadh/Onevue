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
