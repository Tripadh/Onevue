export interface ProfilePhotoUploadResult {
  key: string;
  publicUrl: string;
  contentType: string;
  size: number;
}

export interface ProfilePhotoReadResult {
  buffer: Buffer;
  contentType: string;
}

export interface ObjectPutInput {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface ObjectHead {
  contentType: string;
  size: number;
  etag?: string;
}

export interface ProfilePhotoStorage {
  readonly providerName: "local" | "r2";
  upload(
    fileBuffer: Buffer,
    contentType: string,
    userId: string
  ): Promise<ProfilePhotoUploadResult>;
  resolveUrl(key: string): string;
  delete(key: string): Promise<boolean>;
  read(key: string): Promise<ProfilePhotoReadResult | null>;
  putObject(input: ObjectPutInput): Promise<void>;
  getObject(key: string): Promise<ProfilePhotoReadResult | null>;
  deleteObject(key: string): Promise<boolean>;
  headObject(key: string): Promise<ObjectHead | null>;
}
