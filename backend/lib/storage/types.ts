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
}
