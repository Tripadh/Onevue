import AnalyticsEvent from "../../models/AnalyticsEvent";
import { ANALYTICS_EVENT_TYPES, ANALYTICS_RESOURCE_TYPES, ANALYTICS_SDK_VERSION, MIN_ENGAGEMENT_MS } from "./constants";
import {
  hashIdentifier,
  hashRateLimitKey,
  isObviousBot,
  isPrefetch,
  networkRateLimitMaterial,
  normalizeEngagementMs,
  normalizePath,
  normalizeUtm,
  parseUserAgent,
  referrerDomain,
  sanitizeMetadata,
  trustedGeo,
} from "./privacy";
import { consumeAnalyticsRateLimit } from "./rate-limit";
import { findPublishedResource } from "./resources";

export interface IngestOutcome {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

let indexPromise: Promise<unknown> | null = null;

export async function ensureAnalyticsIndexes(): Promise<void> {
  try {
    if (!indexPromise) indexPromise = AnalyticsEvent.createIndexes();
    await indexPromise;
  } catch {
    indexPromise = null;
  }
}

function retentionDate(now: Date): Date | null {
  const days = Number(process.env.ANALYTICS_RETENTION_DAYS || 0);
  if (!Number.isInteger(days) || days <= 0) return null;
  return new Date(now.getTime() + days * 86400000);
}

function invalid(message: string, code: string, status = 400): IngestOutcome {
  return { status, body: { success: false, message, code } };
}

function mongoCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

export async function ingestAnalyticsEvent(req: Request): Promise<IngestOutcome> {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 8192) return invalid("Event payload is too large.", "payload_too_large", 413);

  const rate = consumeAnalyticsRateLimit(hashRateLimitKey(networkRateLimitMaterial(req.headers)));
  if (!rate.allowed) {
    return {
      status: 429,
      headers: { "Retry-After": String(rate.retryAfterSeconds) },
      body: { success: false, message: "Event rate limit exceeded. Retry later.", code: "rate_limited" },
    };
  }

  if (isPrefetch(req.headers)) return { status: 202, body: { success: true, accepted: false, filtered: "prefetch" } };
  if (isObviousBot(req.headers.get("user-agent"))) {
    return { status: 202, body: { success: true, accepted: false, filtered: "bot" } };
  }

  let text = "";
  try {
    text = await req.text();
  } catch {
    return invalid("Event payload could not be read.", "invalid_payload");
  }
  if (text.length > 8192) return invalid("Event payload is too large.", "payload_too_large", 413);

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return invalid("Event payload must be a JSON object.", "invalid_payload");
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return invalid("Event payload must be valid JSON.", "invalid_payload");
  }

  if (body.sdkVersion !== ANALYTICS_SDK_VERSION) return invalid("Unsupported analytics SDK version.", "unsupported_sdk");
  if (typeof body.eventId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(body.eventId)) {
    return invalid("A valid eventId is required.", "invalid_event_id");
  }
  if (!ANALYTICS_RESOURCE_TYPES.includes(body.resourceType as (typeof ANALYTICS_RESOURCE_TYPES)[number])) {
    return invalid("Unsupported resource type.", "invalid_resource");
  }
  if (!ANALYTICS_EVENT_TYPES.includes(body.eventType as (typeof ANALYTICS_EVENT_TYPES)[number])) {
    return invalid("Unsupported event type.", "invalid_event_type");
  }

  const resource = await findPublishedResource(body.resourceId, body.resourceType);
  if (!resource) return invalid("Published analytics resource was not found.", "unknown_resource", 404);

  const consent = body.consent !== false;
  const engagementMs = body.eventType === "engagement_time" ? normalizeEngagementMs(body.engagementMs) : undefined;
  if (body.eventType === "engagement_time" && (engagementMs === undefined || engagementMs < MIN_ENGAGEMENT_MS)) {
    return { status: 202, body: { success: true, accepted: false, filtered: "insufficient_engagement" } };
  }

  const utm = normalizeUtm(body.utm);
  const hints = parseUserAgent(req.headers.get("user-agent"));
  const geo = trustedGeo(req.headers);
  const now = new Date();

  try {
    await ensureAnalyticsIndexes();
    await AnalyticsEvent.create({
      eventId: body.eventId,
      resourceId: resource.resourceId,
      ownerId: resource.ownerId,
      resourceType: resource.resourceType,
      eventType: body.eventType,
      occurredAt: now,
      path: normalizePath(body.path),
      referrerDomain: referrerDomain(body.referrer),
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmCampaign: utm.campaign,
      utmContent: utm.content,
      utmTerm: utm.term,
      deviceCategory: hints.deviceCategory,
      browserFamily: hints.browserFamily,
      osFamily: hints.osFamily,
      country: geo.country,
      region: geo.region,
      sessionId: consent ? hashIdentifier(body.sessionId) : null,
      visitorId: consent ? hashIdentifier(body.visitorId) : null,
      metadata: sanitizeMetadata(body.metadata, engagementMs),
      ingestedAt: now,
      expiresAt: retentionDate(now),
    });
    return { status: 202, body: { success: true, accepted: true, duplicate: false } };
  } catch (error: unknown) {
    if (mongoCode(error) === 11000) {
      const existing = await AnalyticsEvent.findOne({ eventId: body.eventId }).select("resourceId").lean();
      if (existing && String(existing.resourceId) !== resource.resourceId) {
        return invalid("Event ID is already used by another resource.", "event_conflict", 409);
      }
      return { status: 202, body: { success: true, accepted: true, duplicate: true } };
    }
    console.error("analytics_ingest_failed");
    return invalid("Analytics event could not be stored.", "ingest_failed", 503);
  }
}
