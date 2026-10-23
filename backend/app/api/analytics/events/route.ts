import connectToDatabase from "../../../../lib/db";
import { analyticsJson } from "../../../../lib/analytics/http";
import { ingestAnalyticsEvent } from "../../../../lib/analytics/ingest";

export async function OPTIONS() {
  return analyticsJson({ success: true });
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    const result = await ingestAnalyticsEvent(req);
    return analyticsJson(result.body, result.status, result.headers);
  } catch {
    console.error("analytics_ingest_failed");
    return analyticsJson({ success: false, message: "Analytics event could not be stored.", code: "ingest_failed" }, 503);
  }
}
