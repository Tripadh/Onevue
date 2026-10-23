import { analyticsJson, rangePayload } from "../../../../../lib/analytics/http";
import { loadOwnedReport } from "../../../../../lib/analytics/report-request";

export async function OPTIONS() {
  return analyticsJson({ success: true });
}

export async function GET(req: Request, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const { resourceId } = await context.params;
    const loaded = await loadOwnedReport(req, resourceId);
    if (!loaded.ok) return loaded.response;
    return analyticsJson({
      success: true,
      range: rangePayload(loaded.range),
      resource: loaded.report.resources[0] || null,
      totals: loaded.report.totals,
      definitions: loaded.report.definitions,
    });
  } catch {
    console.error("analytics_resource_failed");
    return analyticsJson({ success: false, message: "Analytics resource could not be loaded.", code: "query_failed" }, 500);
  }
}
