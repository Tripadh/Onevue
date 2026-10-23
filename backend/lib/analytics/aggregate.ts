import mongoose, { PipelineStage } from "mongoose";
import AnalyticsEvent from "../../models/AnalyticsEvent";
import { MAX_BREAKDOWN_ITEMS, MAX_EVENT_PAGE_SIZE, MAX_EVENT_PAGE_SKIP, METRIC_DEFINITIONS } from "./constants";
import { AnalyticsRange, buildBucketKeys, formatBucket, mongoBucketExpression } from "./dates";
import { ensureAnalyticsIndexes } from "./ingest";
import { AnalyticsResourceRecord } from "./resources";

export interface MetricTotals {
  pageViews: number;
  visitors: number;
  sessions: number;
  linkClicks: number;
  downloads: number;
  engagementEvents: number;
  engagementRate: number | null;
  averageEngagementSeconds: number | null;
  engagementTimeSamples: number;
}

interface FacetRow {
  _id: string | null;
  pageViews?: number;
  visitors?: unknown[];
  sessions?: unknown[];
  qualifyingSessions?: unknown[];
  timedSessions?: unknown[];
  engagementMs?: number;
  linkClicks?: number;
  downloads?: number;
  engagements?: number;
  count?: number;
  visits?: number;
  conversions?: number;
}

interface StoredAnalyticsEvent {
  eventId: string;
  eventType: string;
  resourceId: unknown;
  resourceType: "portfolio" | "visiting_card";
  occurredAt: Date | string;
  path: string;
  referrerDomain?: string | null;
  deviceCategory: string;
  browserFamily: string;
  osFamily: string;
  country?: string | null;
  region?: string | null;
  metadata?: { action?: string };
}

function objectId(value: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(value);
}

function cleanSet(values: unknown[] | undefined): string[] {
  return (values || []).filter((value): value is string => typeof value === "string" && value.length > 0);
}

function ratio(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 10000) / 10000;
}

export function relativeChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 10000) / 10000;
}

function eventMatch(ownerId: string, resourceIds: string[], start: Date, end: Date) {
  return {
    ownerId: objectId(ownerId),
    resourceId: { $in: resourceIds.map(objectId) },
    occurredAt: { $gte: start, $lt: end },
  };
}

function countedSet(condition: Record<string, unknown>, field: string) {
  return { $addToSet: { $cond: [condition, field, null] } };
}

function pageViewCondition(extra: Record<string, unknown>) {
  return { $and: [{ $eq: ["$eventType", "page_view"] }, extra] };
}

function breakdown(field: string): PipelineStage.FacetPipelineStage[] {
  return [
    { $match: { eventType: "page_view", [field]: { $nin: [null, ""] } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: MAX_BREAKDOWN_ITEMS },
  ];
}

async function runFacet(match: Record<string, unknown>, range: AnalyticsRange) {
  await ensureAnalyticsIndexes();
  const [result] = await AnalyticsEvent.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
              linkClicks: { $sum: { $cond: [{ $eq: ["$eventType", "link_click"] }, 1, 0] } },
              downloads: { $sum: { $cond: [{ $eq: ["$eventType", "download"] }, 1, 0] } },
              engagements: { $sum: { $cond: [{ $eq: ["$eventType", "engagement"] }, 1, 0] } },
              visitors: countedSet(pageViewCondition({ $gt: ["$visitorId", ""] }), "$visitorId"),
              sessions: countedSet(pageViewCondition({ $gt: ["$sessionId", ""] }), "$sessionId"),
              qualifyingSessions: countedSet(
                {
                  $and: [
                    { $gt: ["$sessionId", ""] },
                    {
                      $or: [
                        { $in: ["$eventType", ["link_click", "download", "engagement"]] },
                        { $and: [{ $eq: ["$eventType", "engagement_time"] }, { $gte: ["$metadata.engagementMs", 1000] }] },
                      ],
                    },
                  ],
                },
                "$sessionId"
              ),
              engagementMs: {
                $sum: {
                  $cond: [
                    { $and: [{ $eq: ["$eventType", "engagement_time"] }, { $gte: ["$metadata.engagementMs", 1000] }] },
                    "$metadata.engagementMs",
                    0,
                  ],
                },
              },
              timedSessions: countedSet(
                {
                  $and: [
                    { $eq: ["$eventType", "engagement_time"] },
                    { $gte: ["$metadata.engagementMs", 1000] },
                    { $gt: ["$sessionId", ""] },
                  ],
                },
                "$sessionId"
              ),
            },
          },
        ],
        series: [
          {
            $group: {
              _id: mongoBucketExpression(range.granularity, range.timezone),
              pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
              visitors: countedSet(pageViewCondition({ $gt: ["$visitorId", ""] }), "$visitorId"),
              sessions: countedSet(pageViewCondition({ $gt: ["$sessionId", ""] }), "$sessionId"),
              linkClicks: { $sum: { $cond: [{ $eq: ["$eventType", "link_click"] }, 1, 0] } },
            },
          },
        ],
        resources: [
          {
            $group: {
              _id: "$resourceId",
              pageViews: { $sum: { $cond: [{ $eq: ["$eventType", "page_view"] }, 1, 0] } },
              visitors: countedSet(pageViewCondition({ $gt: ["$visitorId", ""] }), "$visitorId"),
              linkClicks: { $sum: { $cond: [{ $eq: ["$eventType", "link_click"] }, 1, 0] } },
              downloads: { $sum: { $cond: [{ $eq: ["$eventType", "download"] }, 1, 0] } },
            },
          },
        ],
        devices: breakdown("deviceCategory"),
        browsers: breakdown("browserFamily"),
        operatingSystems: breakdown("osFamily"),
        countries: breakdown("country"),
        referrers: breakdown("referrerDomain"),
        campaigns: [
          { $match: { eventType: "page_view", utmSource: { $nin: [null, ""] } } },
          {
            $group: {
              _id: { source: "$utmSource", medium: "$utmMedium", campaign: "$utmCampaign", resourceId: "$resourceId" },
              visits: { $sum: 1 },
            },
          },
          { $sort: { visits: -1 } },
          { $limit: MAX_BREAKDOWN_ITEMS },
        ],
        conversions: [
          { $match: { eventType: { $in: ["download", "link_click"] }, utmSource: { $nin: [null, ""] } } },
          {
            $group: {
              _id: { source: "$utmSource", medium: "$utmMedium", campaign: "$utmCampaign", resourceId: "$resourceId" },
              conversions: { $sum: 1 },
            },
          },
        ],
        engagement: [
          { $match: { eventType: { $in: ["link_click", "download", "engagement"] } } },
          {
            $group: {
              _id: { eventType: "$eventType", action: { $ifNull: ["$metadata.action", "unspecified"] } },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: MAX_BREAKDOWN_ITEMS },
        ],
        recent: [{ $sort: { occurredAt: -1 } }, { $limit: 8 }, { $project: { visitorId: 0, sessionId: 0, ownerId: 0 } }],
      },
    },
  ]);
  return result || {};
}

export function shapeTotals(row: FacetRow | undefined): MetricTotals {
  const sessions = cleanSet(row?.sessions);
  const sessionSet = new Set(sessions);
  const qualifying = cleanSet(row?.qualifyingSessions).filter((id) => sessionSet.has(id));
  const timed = cleanSet(row?.timedSessions);
  const average =
    timed.length > 0 && row?.engagementMs
      ? Math.round(row.engagementMs / timed.length / 100) / 10
      : timed.length > 0
        ? 0
        : null;
  return {
    pageViews: row?.pageViews || 0,
    visitors: cleanSet(row?.visitors).length,
    sessions: sessions.length,
    linkClicks: row?.linkClicks || 0,
    downloads: row?.downloads || 0,
    engagementEvents: row?.engagements || 0,
    engagementRate: ratio(qualifying.length, sessions.length),
    averageEngagementSeconds: average,
    engagementTimeSamples: timed.length,
  };
}

function comparison(current: MetricTotals, previous: MetricTotals | null) {
  if (!previous) return { ...current, previous: null, changes: null };
  return {
    ...current,
    previous,
    changes: {
      pageViews: relativeChange(current.pageViews, previous.pageViews),
      visitors: relativeChange(current.visitors, previous.visitors),
      sessions: relativeChange(current.sessions, previous.sessions),
      linkClicks: relativeChange(current.linkClicks, previous.linkClicks),
      downloads: relativeChange(current.downloads, previous.downloads),
      engagementRate:
        current.engagementRate == null || previous.engagementRate == null
          ? null
          : Math.round((current.engagementRate - previous.engagementRate) * 10000) / 10000,
      averageEngagementSeconds:
        current.averageEngagementSeconds == null || previous.averageEngagementSeconds == null
          ? null
          : relativeChange(current.averageEngagementSeconds, previous.averageEngagementSeconds),
    },
  };
}

function shapeSeries(rows: FacetRow[], keys: string[], previousRows: FacetRow[], previousKeys: string[]) {
  const current = new Map(rows.map((row) => [String(row._id), row]));
  const previous = new Map(previousRows.map((row) => [String(row._id), row]));
  return keys.map((key, index) => {
    const row = current.get(key);
    const previousRow = previousKeys[index] ? previous.get(previousKeys[index]) : undefined;
    return {
      bucket: key,
      pageViews: row?.pageViews || 0,
      visitors: cleanSet(row?.visitors).length,
      sessions: cleanSet(row?.sessions).length,
      linkClicks: row?.linkClicks || 0,
      previousPageViews: previousRow?.pageViews || 0,
    };
  });
}

function shapeBreakdown(rows: FacetRow[] | undefined, total: number) {
  return (rows || []).map((row) => ({
    label: String(row._id),
    count: row.count || 0,
    share: ratio(row.count || 0, total),
  }));
}

function campaignKey(value: { source?: string; medium?: string; campaign?: string; resourceId?: unknown }) {
  return [value.source || "", value.medium || "", value.campaign || "", String(value.resourceId || "")].join("|");
}

function presentEvent(row: StoredAnalyticsEvent, resources: Map<string, AnalyticsResourceRecord>) {
  const resource = resources.get(String(row.resourceId));
  return {
    eventId: row.eventId,
    eventType: row.eventType,
    resourceId: String(row.resourceId),
    resourceName: resource?.displayName || "Unknown resource",
    resourceType: row.resourceType,
    occurredAt: new Date(row.occurredAt).toISOString(),
    path: row.path,
    referrerDomain: row.referrerDomain || null,
    deviceCategory: row.deviceCategory,
    browserFamily: row.browserFamily,
    osFamily: row.osFamily,
    country: row.country || null,
    region: row.region || null,
    action: row.metadata?.action || null,
  };
}

function emptyTotals(): MetricTotals {
  return {
    pageViews: 0,
    visitors: 0,
    sessions: 0,
    linkClicks: 0,
    downloads: 0,
    engagementEvents: 0,
    engagementRate: null,
    averageEngagementSeconds: null,
    engagementTimeSamples: 0,
  };
}

function emptyAudience() {
  return { devices: [], browsers: [], operatingSystems: [], countries: [] };
}

function buildPreviousKeys(range: AnalyticsRange): string[] {
  const count = buildBucketKeys(range).length;
  if (range.granularity === "day") {
    const start = new Date(`${range.from}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - count);
    return Array.from({ length: count }, (_, index) => {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
  }
  const keys: string[] = [];
  for (let time = range.previousStart.getTime(); time < range.previousEnd.getTime(); time += 3600000) {
    keys.push(formatBucket(new Date(time), "hour", range.timezone));
  }
  return keys.slice(0, count);
}

export async function buildAnalyticsReport(ownerId: string, resources: AnalyticsResourceRecord[], range: AnalyticsRange) {
  const resourceMap = new Map(resources.map((resource) => [resource.resourceId, resource]));
  const keys = buildBucketKeys(range);
  const previousKeys = range.compare ? buildPreviousKeys(range) : [];
  if (resources.length === 0) {
    return {
      totals: comparison(emptyTotals(), range.compare ? emptyTotals() : null),
      timeseries: { granularity: range.granularity, points: shapeSeries([], keys, [], previousKeys) },
      resources: [],
      audience: emptyAudience(),
      sources: { referrers: [], campaigns: [] },
      engagement: [],
      recentEvents: [],
      definitions: METRIC_DEFINITIONS,
    };
  }

  const ids = resources.map((resource) => resource.resourceId);
  const currentFacet = await runFacet(eventMatch(ownerId, ids, range.start, range.end), range);
  const previousFacet = range.compare
    ? await runFacet(eventMatch(ownerId, ids, range.previousStart, range.previousEnd), range)
    : null;
  const totals = comparison(shapeTotals(currentFacet.totals?.[0]), previousFacet ? shapeTotals(previousFacet.totals?.[0]) : null);
  const previousResourceCounts = new Map<string, FacetRow>((previousFacet?.resources || []).map((row: FacetRow) => [String(row._id), row]));
  const currentResourceCounts = new Map<string, FacetRow>((currentFacet.resources || []).map((row: FacetRow) => [String(row._id), row]));
  const conversionMap = new Map<string, number>();
  for (const row of currentFacet.conversions || []) conversionMap.set(campaignKey(row._id || {}), row.conversions || 0);

  return {
    totals,
    timeseries: {
      granularity: range.granularity,
      points: shapeSeries(currentFacet.series || [], keys, previousFacet?.series || [], previousKeys),
    },
    resources: resources.map((resource) => {
      const current = currentResourceCounts.get(resource.resourceId);
      const previous = previousResourceCounts.get(resource.resourceId);
      const pageViews = current?.pageViews || 0;
      const previousPageViews = previous?.pageViews || 0;
      return {
        ...resource,
        publishedAt: resource.publishedAt ? new Date(resource.publishedAt).toISOString() : null,
        updatedAt: resource.updatedAt ? new Date(resource.updatedAt).toISOString() : null,
        pageViews,
        visitors: cleanSet(current?.visitors).length,
        linkClicks: current?.linkClicks || 0,
        downloads: current?.downloads || 0,
        previousPageViews,
        pageViewChange: range.compare ? relativeChange(pageViews, previousPageViews) : null,
      };
    }),
    audience: {
      devices: shapeBreakdown(currentFacet.devices, totals.pageViews),
      browsers: shapeBreakdown(currentFacet.browsers, totals.pageViews),
      operatingSystems: shapeBreakdown(currentFacet.operatingSystems, totals.pageViews),
      countries: shapeBreakdown(currentFacet.countries, totals.pageViews),
    },
    sources: {
      referrers: shapeBreakdown(currentFacet.referrers, totals.pageViews),
      campaigns: (currentFacet.campaigns || []).map((row: FacetRow) => {
        const id = (row._id || {}) as { source?: string; medium?: string; campaign?: string; resourceId?: unknown };
        return {
          source: id.source || "unknown",
          medium: id.medium || "(none)",
          campaign: id.campaign || "(none)",
          resourceId: String(id.resourceId || ""),
          resourceName: resourceMap.get(String(id.resourceId || ""))?.displayName || "Unknown resource",
          visits: row.visits || 0,
          conversions: conversionMap.get(campaignKey(id)) || 0,
        };
      }),
    },
    engagement: (currentFacet.engagement || []).map((row: FacetRow) => ({
      eventType: (row._id as { eventType?: string } | null)?.eventType || "engagement",
      action: (row._id as { action?: string } | null)?.action || "unspecified",
      count: row.count || 0,
    })),
    recentEvents: ((currentFacet.recent || []) as StoredAnalyticsEvent[]).map((row) => presentEvent(row, resourceMap)),
    definitions: METRIC_DEFINITIONS,
  };
}

export async function listResourceEvents(
  ownerId: string,
  resource: AnalyticsResourceRecord,
  range: AnalyticsRange,
  page: number,
  pageSize: number
) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeSize = Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, MAX_EVENT_PAGE_SIZE) : 20;
  const skip = (safePage - 1) * safeSize;
  if (skip > MAX_EVENT_PAGE_SKIP) {
    throw new Error("Page is too deep. Narrow the date range or request an earlier page.");
  }
  const query = eventMatch(ownerId, [resource.resourceId], range.start, range.end);
  const [total, rows] = await Promise.all([
    AnalyticsEvent.countDocuments(query),
    AnalyticsEvent.find(query).sort({ occurredAt: -1 }).skip(skip).limit(safeSize).select("-visitorId -sessionId -ownerId").lean(),
  ]);
  return {
    page: safePage,
    pageSize: safeSize,
    total,
    events: (rows as StoredAnalyticsEvent[]).map((row) => presentEvent(row, new Map([[resource.resourceId, resource]]))),
  };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(report: Awaited<ReturnType<typeof buildAnalyticsReport>>, range: AnalyticsRange): string {
  const lines = [
    ["section", "label", "value", "previous", "change"].join(","),
    ["range", "from", range.from, "", ""].map(csvCell).join(","),
    ["range", "to", range.to, "", ""].map(csvCell).join(","),
    ["range", "timezone", range.timezone, "", ""].map(csvCell).join(","),
  ];
  const metrics: Array<[string, number | null, number | null, number | null]> = [
    ["page_views", report.totals.pageViews, report.totals.previous?.pageViews ?? null, report.totals.changes?.pageViews ?? null],
    ["estimated_visitors", report.totals.visitors, report.totals.previous?.visitors ?? null, report.totals.changes?.visitors ?? null],
    ["sessions", report.totals.sessions, report.totals.previous?.sessions ?? null, report.totals.changes?.sessions ?? null],
    ["link_clicks", report.totals.linkClicks, report.totals.previous?.linkClicks ?? null, report.totals.changes?.linkClicks ?? null],
    ["downloads", report.totals.downloads, report.totals.previous?.downloads ?? null, report.totals.changes?.downloads ?? null],
    ["engagement_rate", report.totals.engagementRate, report.totals.previous?.engagementRate ?? null, report.totals.changes?.engagementRate ?? null],
    ["average_engagement_seconds", report.totals.averageEngagementSeconds, report.totals.previous?.averageEngagementSeconds ?? null, report.totals.changes?.averageEngagementSeconds ?? null],
  ];
  for (const metric of metrics) lines.push(["metric", ...metric].map(csvCell).join(","));
  for (const resource of report.resources) {
    lines.push(["resource", resource.displayName, resource.pageViews, resource.previousPageViews, resource.pageViewChange].map(csvCell).join(","));
  }
  for (const campaign of report.sources.campaigns) {
    lines.push(["campaign", `${campaign.source} / ${campaign.medium} / ${campaign.campaign}`, campaign.visits, "", campaign.conversions].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
