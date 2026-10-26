import * as crypto from "crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
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

export class R2StorageProvider implements ProfilePhotoStorage {
  readonly providerName = "r2" as const;
  private readonly client: S3Client;
  private readonly bucketName: string;

  constructor() {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;

    const missingVars: string[] = [];
    if (!accountId) missingVars.push("CLOUDFLARE_ACCOUNT_ID");
    if (!accessKeyId) missingVars.push("CLOUDFLARE_R2_ACCESS_KEY_ID");
    if (!secretAccessKey) missingVars.push("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
    if (!bucketName) missingVars.push("CLOUDFLARE_R2_BUCKET_NAME");

    if (missingVars.length > 0) {
      throw new Error(
        `Cloudflare R2 is configured as the active storage provider (PROFILE_PHOTO_STORAGE=r2), but the following required environment variable(s) are missing: ${missingVars.join(
          ", "
        )}. Either provide these credentials or set PROFILE_PHOTO_STORAGE=local for local development.`
      );
    }

    this.bucketName = bucketName!;

    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
      },
      // R2 rejects the default flexible checksums added in recent AWS SDK releases.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
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
    const key = `profile-photos/${cleanUserId}_${timestamp}_${randomHex}.${validation.extension}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: validation.mimeType,
      Metadata: {
        userId: cleanUserId,
        uploadedAt: new Date().toISOString(),
      },
    });

    await this.client.send(command);

    return {
      key,
      publicUrl: this.resolveUrl(key),
      contentType: validation.mimeType,
      size: fileBuffer.length,
    };
  }

  public resolveUrl(key: string): string {
    // The bucket stays private. Profile photos are served by the app, never by a public R2 URL.
    return `/api/profile/photo/${encodeURIComponent(key)}`;
  }

  public async delete(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (err) {
      console.error(`Failed to delete object from R2 (${key}):`, err);
      throw err;
    }
  }

  public async read(key: string): Promise<ProfilePhotoReadResult | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      const response = await this.client.send(command);
      if (!response.Body) return null;

      const byteArray = await response.Body.transformToByteArray();
      const buffer = Buffer.from(byteArray);
      const detectedMime =
        (response.ContentType as any) ||
        detectImageMimeType(buffer) ||
        "image/jpeg";

      return {
        buffer,
        contentType: detectedMime,
      };
    } catch (err: any) {
      if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  private assertObjectKey(key: string): string {
    assertSafeObjectKey(key);
    return key;
  }

  public async putObject(input: ObjectPutInput): Promise<void> {
    const key = this.assertObjectKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      })
    );
  }

  public async getObject(key: string): Promise<ProfilePhotoReadResult | null> {
    try {
      const safeKey = this.assertObjectKey(key);
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: safeKey })
      );
      if (!response.Body) return null;
      const byteArray = await response.Body.transformToByteArray();
      const buffer = Buffer.from(byteArray);
      const contentType =
        response.ContentType ||
        detectImageMimeType(buffer) ||
        (detectPdf(buffer) ? "application/pdf" : "application/octet-stream");
      return { buffer, contentType };
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === "NoSuchKey" || error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  public async deleteObject(key: string): Promise<boolean> {
    const safeKey = this.assertObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: safeKey }));
    return true;
  }

  public async headObject(key: string): Promise<ObjectHead | null> {
    try {
      const safeKey = this.assertObjectKey(key);
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName, Key: safeKey })
      );
      return {
        contentType: response.ContentType || "application/octet-stream",
        size: Number(response.ContentLength || 0),
        etag: response.ETag,
      };
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (error.name === "NoSuchKey" || error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }
}
