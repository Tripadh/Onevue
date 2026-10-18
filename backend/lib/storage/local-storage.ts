import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import {
  ProfilePhotoStorage,
  ProfilePhotoUploadResult,
  ProfilePhotoReadResult,
} from "./types";
import {
  validateProfilePhotoImage,
  detectImageMimeType,
} from "./validation";

export class LocalStorageProvider implements ProfilePhotoStorage {
  readonly providerName = "local" as const;
  private readonly storageDir: string;

  constructor(customStorageDir?: string) {
    this.storageDir =
      customStorageDir ||
      path.resolve(process.cwd(), "storage", "profile-photos");

    // Ensure the storage directory exists
    try {
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }
    } catch (err) {
      console.error("Failed to initialize local profile photo storage directory:", err);
    }
  }

  /**
   * Validates and sanitizes a storage key against path traversal attacks.
   */
  public sanitizeKey(key: string): string {
    if (!key || typeof key !== "string") {
      throw new Error("Invalid storage key: key must be a non-empty string.");
    }

    const base = path.basename(key);
    if (
      base !== key ||
      key.includes("..") ||
      key.includes("/") ||
      key.includes("\\") ||
      key.includes("\0")
    ) {
      throw new Error("Invalid storage key: directory traversal characters detected.");
    }

    // Resolve full path and guarantee it is inside this.storageDir
    const resolvedPath = path.resolve(this.storageDir, base);
    if (!resolvedPath.startsWith(path.resolve(this.storageDir) + path.sep)) {
      throw new Error("Invalid storage key: path escapes storage boundary.");
    }

    return base;
  }

  public getFilePath(key: string): string {
    const safeKey = this.sanitizeKey(key);
    return path.join(this.storageDir, safeKey);
  }

  public async upload(
    fileBuffer: Buffer,
    contentType: string,
    userId: string
  ): Promise<ProfilePhotoUploadResult> {
    const validation = validateProfilePhotoImage(fileBuffer, contentType);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const cleanUserId = (userId || "anonymous").replace(/[^a-zA-Z0-9]/g, "");
    const randomHex = crypto.randomBytes(8).toString("hex");
    const timestamp = Date.now();
    const key = `user_${cleanUserId}_${timestamp}_${randomHex}.${validation.extension}`;

    const filePath = this.getFilePath(key);
    await fs.promises.writeFile(filePath, fileBuffer);

    return {
      key,
      publicUrl: this.resolveUrl(key),
      contentType: validation.mimeType,
      size: fileBuffer.length,
    };
  }

  public resolveUrl(key: string): string {
    const safeKey = this.sanitizeKey(key);
    return `/api/profile/photo/${encodeURIComponent(safeKey)}`;
  }

  public async delete(key: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(key);
      await fs.promises.unlink(filePath);
      return true;
    } catch (err: unknown) {
      // If the file already doesn't exist, treat it as safely removed
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      console.error(`Failed to delete profile photo ${key}:`, err);
      throw err;
    }
  }

  public async read(key: string): Promise<ProfilePhotoReadResult | null> {
    try {
      const filePath = this.getFilePath(key);
      const buffer = await fs.promises.readFile(filePath);
      const detectedMime = detectImageMimeType(buffer) || "image/jpeg";
      return {
        buffer,
        contentType: detectedMime,
      };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }
}
