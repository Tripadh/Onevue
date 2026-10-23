import { analyticsJson, rangePayload } from "../../../../../../lib/analytics/http";
import { loadOwnedReport } from "../../../../../../lib/analytics/report-request";

export async function OPTIONS() {
  return analyticsJson({ success: true });
}

export async function GET(req: Request, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const { resourceId } = await context.params;
    const loaded = await loadOwnedReport(req, resourceId);
    if (!loaded.ok) return loaded.response;
    return analyticsJson({ success: true, range: rangePayload(loaded.range), audience: loaded.report.audience });
  } catch {
    console.error("analytics_audience_failed");
    return analyticsJson({ success: false, message: "Analytics audience could not be loaded.", code: "query_failed" }, 500);
  }
}
