import { adaptOneVueProfile } from "./onevue-profile-adapter.ts";
import type { AdaptedPortfolioData, PublicProfileDTO_v1, WebsiteMetadata } from "./onevue-profile-adapter.ts";

export const DRAFT_PREVIEW_MESSAGE = "onevue-draft-preview";
export const DRAFT_PREVIEW_READY = "onevue-preview-ready";

/**
 * Draft preview accepts saved DTO payloads from the local dashboard.
 * It does not publish, and it does not accept an arbitrary web origin.
 */
export function isAllowedPreviewParent(origin: string): boolean {
  if (origin === "null") return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return true;
  const allowed = (process.env.NEXT_PUBLIC_DASHBOARD_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

export function adaptDraftPreview(
  message: unknown,
  parentOrigin: string
): { data: AdaptedPortfolioData } | { error: string } {
  if (!isAllowedPreviewParent(parentOrigin)) {
    return { error: "Preview parent origin is not allowed." };
  }
  if (!message || typeof message !== "object") {
    return { error: "Preview payload is missing." };
  }
  const body = message as { type?: unknown; dto?: PublicProfileDTO_v1; website?: WebsiteMetadata };
  if (body.type !== DRAFT_PREVIEW_MESSAGE || !body.dto) {
    return { error: "Unsupported preview message." };
  }
  try {
    return { data: adaptOneVueProfile(body.dto, body.website) };
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : "Preview payload is invalid." };
  }
}
