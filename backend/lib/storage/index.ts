import { ProfilePhotoStorage } from "./types";
import { LocalStorageProvider } from "./local-storage";
import { R2StorageProvider } from "./r2-storage";

export * from "./types";
export * from "./validation";
export * from "./local-storage";
export * from "./r2-storage";

let cachedStorageInstance: ProfilePhotoStorage | null = null;

function selectedProvider(): "local" | "r2" {
  const provider = (process.env.PROFILE_PHOTO_STORAGE || "local").toLowerCase().trim();
  if (provider !== "local" && provider !== "r2") {
    throw new Error(
      `Unsupported PROFILE_PHOTO_STORAGE configuration: '${provider}'. Supported values are 'local' or 'r2'.`
    );
  }
  if (process.env.NODE_ENV === "production" && provider !== "r2") {
    throw new Error(
      "Production storage requires PROFILE_PHOTO_STORAGE=r2 and Cloudflare R2 credentials. Refusing to use local disk storage in production."
    );
  }
  return provider;
}

export function getProfilePhotoStorage(): ProfilePhotoStorage {
  const provider = selectedProvider();

  // If already instantiated for the same provider, reuse instance
  if (cachedStorageInstance && cachedStorageInstance.providerName === provider) {
    return cachedStorageInstance;
  }

  if (provider === "local") {
    cachedStorageInstance = new LocalStorageProvider();
    return cachedStorageInstance;
  }

  cachedStorageInstance = new R2StorageProvider();
  return cachedStorageInstance;
}

/** Same provider instance used for profile photos and general objects. */
export function getObjectStorage(): ProfilePhotoStorage {
  return getProfilePhotoStorage();
}
