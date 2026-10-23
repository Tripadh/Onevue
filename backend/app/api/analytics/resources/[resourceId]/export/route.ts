import { NextResponse } from "next/server";
import { reportToCsv } from "../../../../../../lib/analytics/aggregate";
import { analyticsJson } from "../../../../../../lib/analytics/http";
import { loadOwnedReport } from "../../../../../../lib/analytics/report-request";

export async function OPTIONS() {
  return analyticsJson({ success: true });
}

export async function GET(req: Request, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const { resourceId } = await context.params;
    const loaded = await loadOwnedReport(req, resourceId);
    if (!loaded.ok) return loaded.response;
    const format = new URL(req.url).searchParams.get("format") || "csv";
    if (format === "json") {
      return analyticsJson({ success: true, range: loaded.range, report: loaded.report });
    }
    if (format !== "csv") {
      return analyticsJson({ success: false, message: "Export format must be csv or json.", code: "invalid_query" }, 400);
    }
    const filename = `onevue-analytics-${loaded.resource.resourceType}-${loaded.range.from}-to-${loaded.range.to}.csv`;
    return new NextResponse(reportToCsv(loaded.report, loaded.range), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    console.error("analytics_export_failed");
    return analyticsJson({ success: false, message: "Analytics export could not be created.", code: "query_failed" }, 500);
  }
}
