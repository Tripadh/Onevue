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
    const resources = await listOwnedResources(auth.user._id);
    const report = await buildAnalyticsReport(String(auth.user._id), resources, parsed.range);
    return analyticsJson({ success: true, range: rangePayload(parsed.range), resources: report.resources });
  } catch {
    console.error("analytics_resources_failed");
    return analyticsJson({ success: false, message: "Analytics resources could not be loaded.", code: "query_failed" }, 500);
  }
}
