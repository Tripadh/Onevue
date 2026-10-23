export const ANALYTICS_SDK_VERSION = "1";

const pageViewsThisDocument = new Set<string>();

export interface AnalyticsEventPayload {
  sdkVersion: string;
  eventId: string;
  resourceId: string;
  resourceType: "portfolio";
  eventType: string;
  path: string;
  referrer: string;
  utm: Record<string, string | null>;
  visitorId: string | null;
  sessionId: string | null;
  consent: boolean;
  metadata?: Record<string, string | number>;
  engagementMs?: number;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `ev_${Date.now().toString(36)}`;
}

function consentGranted(explicit?: boolean): boolean {
  if (explicit === false) return false;
  if (typeof window !== "undefined" && window.OV_ANALYTICS_CONSENT === false) return false;
  return true;
}

const memoryIds: { visitor: string; session: string } = { visitor: "", session: "" };

function storedId(kind: "visitor" | "session", consent: boolean): string | null {
  if (!consent) return null;
  if (typeof window === "undefined") {
    if (!memoryIds[kind]) memoryIds[kind] = randomId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 36);
    return memoryIds[kind];
  }
  const storage = kind === "visitor" ? window.localStorage : window.sessionStorage;
  const key = kind === "visitor" ? "ov_analytics_visitor" : "ov_analytics_session";
  let value = storage.getItem(key);
  if (!value || !/^[A-Za-z0-9_-]{8,80}$/.test(value)) {
    value = randomId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 36);
    storage.setItem(key, value);
  }
  return value;
}

export function buildAnalyticsEvent(input: {
  resourceId: string;
  path: string;
  eventType: string;
  consent?: boolean;
  metadata?: Record<string, string | number>;
  engagementMs?: number;
}): AnalyticsEventPayload {
  const consent = consentGranted(input.consent);
  return {
    sdkVersion: ANALYTICS_SDK_VERSION,
    eventId: randomId(),
    resourceId: input.resourceId,
    resourceType: "portfolio",
    eventType: input.eventType,
    path: input.path,
    referrer: typeof document !== "undefined" ? document.referrer : "",
    utm: {},
    visitorId: consent ? storedId("visitor", true) : null,
    sessionId: consent ? storedId("session", true) : null,
    consent,
    metadata: input.metadata,
    engagementMs: input.engagementMs,
  };
}

function send(endpoint: string, payload: AnalyticsEventPayload) {
  const body = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon(endpoint, blob)) return;
  }
  if (typeof fetch !== "undefined") {
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  }
}

export function createPortfolioTracker(options: { resourceId: string; endpoint: string; path: string }) {
  const started = Date.now();
  let flushed = false;
  const track = (eventType: string, extra?: { metadata?: Record<string, string | number>; engagementMs?: number }) => {
    send(options.endpoint, buildAnalyticsEvent({ resourceId: options.resourceId, path: options.path, eventType, ...extra }));
  };
  return {
    start() {
      const key = `${options.resourceId}|${options.path}`;
      if (!pageViewsThisDocument.has(key)) {
        pageViewsThisDocument.add(key);
        track("page_view");
      }
      const onClick = (event: MouseEvent) => {
        const target = event.target instanceof Element ? event.target.closest("a[href], [data-ov-track]") : null;
        if (!(target instanceof HTMLElement)) return;
        const href = target.getAttribute("href") || "";
        const action = target.getAttribute("data-ov-action") || "";
        const name = target.getAttribute("data-ov-track") || "";
        if (name === "download" || action === "resume" || /\.pdf($|\?)/i.test(href)) {
          track("download", { metadata: { action: action || "download" } });
          return;
        }
        if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("http")) {
          track("link_click", { metadata: { action: action || "link" } });
        }
      };
      document.addEventListener("click", onClick);
      return () => {
        document.removeEventListener("click", onClick);
        const elapsed = Date.now() - started;
        if (!flushed && elapsed >= 1000) {
          flushed = true;
          track("engagement_time", { engagementMs: Math.min(elapsed, 30 * 60 * 1000) });
        }
      };
    },
  };
}

declare global {
  interface Window {
    OV_ANALYTICS_CONSENT?: boolean;
  }
}
