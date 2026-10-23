export const ANALYTICS_SDK_VERSION = "1";

export const ANALYTICS_RESOURCE_TYPES = ["portfolio", "visiting_card"] as const;
export type AnalyticsResourceType = (typeof ANALYTICS_RESOURCE_TYPES)[number];

export const ANALYTICS_EVENT_TYPES = [
  "page_view",
  "link_click",
  "download",
  "engagement",
  "engagement_time",
] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

export const MAX_EVENT_BYTES = 8192;
export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_EVENT_PAGE_SIZE = 50;
export const MAX_EVENT_PAGE_SKIP = 1000;
export const MAX_BREAKDOWN_ITEMS = 12;
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const MIN_ENGAGEMENT_MS = 1000;
export const MAX_ENGAGEMENT_MS = 30 * 60 * 1000;

export const METRIC_DEFINITIONS = {
  pageViews: "Accepted page-view events during the selected period.",
  visitors:
    "Estimated distinct visitors, based on a privacy-preserving first-party identifier. This is not an exact count of people.",
  sessions:
    "Sessions inferred from a first-party session identifier. A new session starts after 30 minutes of inactivity.",
  linkClicks: "Accepted internal or outbound link-click events.",
  downloads: "Accepted download events, including resume and card-export actions.",
  engagementRate:
    "Share of page-view sessions that also include a link click, download, explicit engagement, or measured engagement time.",
  averageEngagementTime:
    "Average measured foreground time among sessions that reported it. Time is unavailable when no reliable sample was received.",
} as const;
