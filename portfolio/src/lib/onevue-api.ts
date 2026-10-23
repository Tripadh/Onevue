import type { OneVuePublicApiResponse } from "./onevue-profile-adapter.ts";

export interface FetchPublicProfileResult {
  success: boolean;
  data?: OneVuePublicApiResponse;
  notFound?: boolean;
  errorMessage?: string;
}

/**
 * Gets the validated upstream OneVue API base URL.
 * Falls back safely to localhost:3000 in development if unconfigured.
 */
export function getAnalyticsEventsEndpoint(): string {
  return `${getApiBaseUrl()}/analytics/events`;
}

function getApiBaseUrl(): string {
  const envUrl = process.env.ONEVUE_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_ONEVUE_API_BASE_URL;
  const baseUrl = envUrl ? envUrl.trim().replace(/\/+$/, "") : "http://localhost:3000/api";

  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Invalid protocol '${parsed.protocol}' in ONEVUE_PUBLIC_API_BASE_URL`);
    }
    return baseUrl;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Malformed base URL";
    throw new Error(`Configuration error: ONEVUE_PUBLIC_API_BASE_URL is invalid: ${msg}`);
  }
}

/**
 * Fetches the active published snapshot from the OneVue Phase 3 public API.
 * Guarantees:
 * - Uncached server-side fetch (cache: 'no-store').
 * - Strictly calls the public endpoint: /api/public/profile/[username].
 * - Forwards NO student authentication cookies or auth headers.
 * - Safely handles 404 for non-existent or unpublished profiles.
 */
export async function fetchPublishedProfile(
  rawUsername: string
): Promise<FetchPublicProfileResult> {
  const username = String(rawUsername || "").toLowerCase().trim();

  // Validate username format (alphanumeric, hyphens, underscores, 3-30 chars)
  if (!username || !/^[a-z0-9_-]{3,30}$/.test(username)) {
    return {
      success: false,
      notFound: true,
      errorMessage: "Invalid username format.",
    };
  }

  try {
    const baseUrl = getApiBaseUrl();
    const endpoint = `${baseUrl}/public/profile/${encodeURIComponent(username)}`;

    const res = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status === 404) {
      return {
        success: false,
        notFound: true,
        errorMessage: `Profile for '${username}' was not found or is not currently published.`,
      };
    }

    if (!res.ok) {
      return {
        success: false,
        errorMessage: `Upstream service returned status ${res.status}.`,
      };
    }

    const json = (await res.json()) as OneVuePublicApiResponse;

    if (!json || !json.success || !json.dto) {
      return {
        success: false,
        errorMessage: "Malformed profile payload received from OneVue public API.",
      };
    }

    return {
      success: true,
      data: json,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown network error";
    return {
      success: false,
      errorMessage: `Failed to connect to OneVue public API: ${message}`,
    };
  }
}
