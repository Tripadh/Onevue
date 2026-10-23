import { createHash, createHmac, randomUUID } from "crypto";
import { MAX_ENGAGEMENT_MS } from "./constants";

const METADATA_KEYS = ["action", "label", "targetHost", "targetPath", "element", "side"] as const;

export interface NormalizedUtm {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
}

export interface ClientHints {
  deviceCategory: "desktop" | "mobile" | "tablet" | "unknown";
  browserFamily: string;
  osFamily: string;
}

function hashSecret(): string {
  return process.env.ANALYTICS_HASH_SECRET || process.env.JWT_SECRET || "onevue-analytics-development";
}

export function hashIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(normalized)) return null;
  return createHmac("sha256", hashSecret()).update(normalized).digest("hex").slice(0, 32);
}

export function hashRateLimitKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function newEventId(): string {
  return randomUUID();
}

export function parseUserAgent(userAgent: string | null): ClientHints {
  const source = userAgent || "";
  let deviceCategory: ClientHints["deviceCategory"] = source ? "desktop" : "unknown";
  if (/ipad|tablet/i.test(source)) deviceCategory = "tablet";
  else if (/mobile|iphone|android/i.test(source)) deviceCategory = "mobile";

  let osFamily = "Unknown";
  if (/Windows/i.test(source)) osFamily = "Windows";
  else if (/Android/i.test(source)) osFamily = "Android";
  else if (/iPhone|iPad|iOS/i.test(source)) osFamily = "iOS";
  else if (/Mac OS X|Macintosh/i.test(source)) osFamily = "macOS";
  else if (/Linux/i.test(source)) osFamily = "Linux";

  let browserFamily = "Unknown";
  if (/Edg\//i.test(source)) browserFamily = "Edge";
  else if (/Firefox\//i.test(source)) browserFamily = "Firefox";
  else if (/Chrome\//i.test(source)) browserFamily = "Chrome";
  else if (/Safari\//i.test(source)) browserFamily = "Safari";

  return { deviceCategory, browserFamily, osFamily };
}

export function isObviousBot(userAgent: string | null): boolean {
  const source = (userAgent || "").toLowerCase();
  if (!source) return false;
  return [
    "bot",
    "crawler",
    "spider",
    "slurp",
    "facebookexternalhit",
    "whatsapp",
    "telegrambot",
    "headlesschrome",
    "phantomjs",
    "lighthouse",
    "pingdom",
    "uptimerobot",
    "wget",
    "curl/",
    "python-requests",
    "go-http-client",
  ].some((token) => source.includes(token));
}

export function isPrefetch(headers: Headers): boolean {
  const purpose = `${headers.get("purpose") || ""} ${headers.get("sec-purpose") || ""} ${headers.get("x-purpose") || ""}`;
  return /prefetch|preview/i.test(purpose);
}

export function referrerDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/\.$/, "").slice(0, 120) || null;
  } catch {
    return null;
  }
}

function cleanToken(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_").slice(0, max);
  if (!normalized || !/^[a-z0-9._:-]+$/.test(normalized)) return null;
  return normalized;
}

export function normalizeUtm(input: unknown): NormalizedUtm {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    source: cleanToken(source.source),
    medium: cleanToken(source.medium),
    campaign: cleanToken(source.campaign),
    content: cleanToken(source.content),
    term: cleanToken(source.term),
  };
}

export function normalizePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "/";
  const withoutQuery = value.trim().split(/[?#]/)[0];
  const path = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return path.replace(/\/{2,}/g, "/").slice(0, 200) || "/";
}

export function sanitizeMetadata(input: unknown, engagementMs?: number): Record<string, string | number> {
  const output: Record<string, string | number> = {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const source = input as Record<string, unknown>;
    for (const key of METADATA_KEYS) {
      const token = cleanToken(source[key], 120);
      if (token) output[key] = token;
    }
  }
  if (engagementMs !== undefined) output.engagementMs = engagementMs;
  return output;
}

export function normalizeEngagementMs(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > MAX_ENGAGEMENT_MS) return undefined;
  return rounded;
}

export function trustedGeo(headers: Headers): { country: string | null; region: string | null } {
  const country = (headers.get("x-vercel-ip-country") || headers.get("cf-ipcountry") || "").trim().toUpperCase();
  const region = (headers.get("x-vercel-ip-country-region") || "").trim().slice(0, 80);
  return {
    country: /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null,
    region: country && region && !/unknown/i.test(region) ? region : null,
  };
}

export function networkRateLimitMaterial(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${forwarded}|${(headers.get("user-agent") || "").slice(0, 120)}`;
}
