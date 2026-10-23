import { analyticsJson, authenticateAnalytics, rangePayload, readRange } from "../../../../lib/analytics/http";
import { buildAnalyticsReport } from "../../../../lib/analytics/aggregate";
import { listOwnedResources } from "../../../../lib/analytics/resources";

export async function OPTIONS() {
  return analyticsJson({ success: true });
}

export async function GET(req: Request) {
  try {
    const auth = await authenticateAnalytics(req);
    if (!auth.ok) return auth.response;
    const parsed = readRange(req);
    if (!parsed.ok) return parsed.response;

    const params = new URL(req.url).searchParams;
    const resourceType = params.get("type") || "all";
    if (!["all", "portfolio", "visiting_card"].includes(resourceType)) {
      return analyticsJson({ success: false, message: "Invalid resource type.", code: "invalid_query" }, 400);
    }
    const resourceId = params.get("resourceId");
    const selected = (await listOwnedResources(auth.user._id)).filter((resource) => {
      if (resourceType !== "all" && resource.resourceType !== resourceType) return false;
      if (resourceId && resource.resourceId !== resourceId) return false;
      return true;
    });
    if (resourceId && selected.length === 0) {
      return analyticsJson({ success: false, message: "Analytics resource not found.", code: "not_found" }, 404);
    }

    const report = await buildAnalyticsReport(String(auth.user._id), selected, parsed.range);
    return analyticsJson({
      success: true,
      range: rangePayload(parsed.range),
      filters: { resourceType, resourceId: resourceId || null },
      ...report,
    });
  } catch {
    console.error("analytics_overview_failed");
    return analyticsJson({ success: false, message: "Analytics could not be loaded.", code: "query_failed" }, 500);
  }
}
