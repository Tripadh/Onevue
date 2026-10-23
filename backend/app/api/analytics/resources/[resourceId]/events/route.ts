import { AnalyticsQueryError } from "../../../../../../lib/analytics/dates";
import { analyticsJson, rangePayload } from "../../../../../../lib/analytics/http";
import { listResourceEvents } from "../../../../../../lib/analytics/aggregate";
import { authorizeResource, readRange } from "../../../../../../lib/analytics/http";

export async function OPTIONS() {
  return analyticsJson({ success: true });
}

export async function GET(req: Request, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const { resourceId } = await context.params;
    const auth = await authorizeResource(req, resourceId);
    if (!auth.ok) return auth.response;
    const parsed = readRange(req);
    if (!parsed.ok) return parsed.response;
    const params = new URL(req.url).searchParams;
    const page = params.get("page") ? Number(params.get("page")) : 1;
    const pageSize = params.get("pageSize") ? Number(params.get("pageSize")) : 20;
    if (!Number.isInteger(page) || !Number.isInteger(pageSize)) {
      return analyticsJson({ success: false, message: "Page values must be integers.", code: "invalid_query" }, 400);
    }
    const events = await listResourceEvents(String(auth.user._id), auth.resource, parsed.range, page, pageSize);
    return analyticsJson({ success: true, range: rangePayload(parsed.range), ...events });
  } catch (error) {
    if (error instanceof Error && error.message.includes("too deep")) {
      return analyticsJson({ success: false, message: error.message, code: "invalid_query" }, 400);
    }
    if (error instanceof AnalyticsQueryError) {
      return analyticsJson({ success: false, message: error.message, code: error.code }, error.status);
    }
    console.error("analytics_events_failed");
    return analyticsJson({ success: false, message: "Analytics events could not be loaded.", code: "query_failed" }, 500);
  }
}
