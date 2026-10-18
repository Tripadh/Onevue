import { ProfilePhotoStorage } from "./types";
import { LocalStorageProvider } from "./local-storage";
import { R2StorageProvider } from "./r2-storage";

export * from "./types";
export * from "./validation";
export * from "./local-storage";
export * from "./r2-storage";

let cachedStorageInstance: ProfilePhotoStorage | null = null;

export function getProfilePhotoStorage(): ProfilePhotoStorage {
  const provider = (process.env.PROFILE_PHOTO_STORAGE || "local").toLowerCase().trim();

  // If already instantiated for the same provider, reuse instance
  if (cachedStorageInstance && cachedStorageInstance.providerName === provider) {
    return cachedStorageInstance;
  }

  if (provider === "local") {
    cachedStorageInstance = new LocalStorageProvider();
    return cachedStorageInstance;
  }

  if (provider === "r2") {
    cachedStorageInstance = new R2StorageProvider();
    return cachedStorageInstance;
  }

  throw new Error(
    `Unsupported PROFILE_PHOTO_STORAGE configuration: '${provider}'. Supported values are 'local' or 'r2'.`
  );
}
