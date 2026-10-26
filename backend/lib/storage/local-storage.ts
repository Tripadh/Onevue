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
  detectPdf,
} from "./validation";
import { assertSafeObjectKey } from "./keys";
import { ObjectHead, ObjectPutInput } from "./types";

export class LocalStorageProvider implements ProfilePhotoStorage {
  readonly providerName = "local" as const;
  private readonly storageDir: string;
  private readonly objectRoot: string;

  constructor(customStorageDir?: string, customObjectRoot?: string) {
    this.storageDir =
      customStorageDir ||
      path.resolve(process.cwd(), "storage", "profile-photos");
    this.objectRoot =
      customObjectRoot || path.resolve(process.cwd(), "storage", "objects");

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

  private resolveObjectFile(key: string): string {
    assertSafeObjectKey(key);
    const resolved = path.resolve(this.objectRoot, ...key.split("/"));
    const root = path.resolve(this.objectRoot);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error("Invalid object key.");
    }
    return resolved;
  }

  private async ensureObjectRoot(): Promise<void> {
    await fs.promises.mkdir(this.objectRoot, { recursive: true });
  }

  public async putObject(input: ObjectPutInput): Promise<void> {
    const filePath = this.resolveObjectFile(input.key);
    await this.ensureObjectRoot();
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, input.body);
    await fs.promises.writeFile(
      `${filePath}.meta.json`,
      JSON.stringify({ contentType: input.contentType, size: input.body.length })
    );
  }

  public async getObject(key: string): Promise<ProfilePhotoReadResult | null> {
    try {
      const filePath = this.resolveObjectFile(key);
      const buffer = await fs.promises.readFile(filePath);
      let contentType = "application/octet-stream";
      try {
        const meta = JSON.parse(await fs.promises.readFile(`${filePath}.meta.json`, "utf8")) as {
          contentType?: string;
        };
        if (meta.contentType) contentType = meta.contentType;
      } catch {
        contentType = detectImageMimeType(buffer) || (detectPdf(buffer) ? "application/pdf" : contentType);
      }
      return { buffer, contentType };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  public async deleteObject(key: string): Promise<boolean> {
    try {
      const filePath = this.resolveObjectFile(key);
      await fs.promises.unlink(filePath);
      await fs.promises.unlink(`${filePath}.meta.json`).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  public async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const filePath = this.resolveObjectFile(key);
      const stat = await fs.promises.stat(filePath);
      let contentType = "application/octet-stream";
      try {
        const meta = JSON.parse(await fs.promises.readFile(`${filePath}.meta.json`, "utf8")) as {
          contentType?: string;
        };
        if (meta.contentType) contentType = meta.contentType;
      } catch {
        contentType = "application/octet-stream";
      }
      return { contentType, size: stat.size };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}
