import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import ComplianceRequest from "@/models/ComplianceRequest";
import UserAccountStatusHistory from "@/models/UserAccountStatusHistory";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog, logDataAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  let str = String(val).replace(/\r\n/g, " ").replace(/\n/g, " ");
  if (str.includes('"') || str.includes(",") || str.includes(";")) {
    str = `"${str.replace(/"/g, '""')}"`;
  } else {
    str = `"${str}"`;
  }
  return str;
}

/**
 * GET /api/admin/reports/export
 * Export platform audit logs, user registries, and compliance logs as streaming CSV downloads
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "read");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "users";
    const startDateParam = searchParams.get("start_date");
    const endDateParam = searchParams.get("end_date");
    const limitParam = parseInt(searchParams.get("limit") || "1000", 10);
    const limit = Math.min(5000, Math.max(10, isNaN(limitParam) ? 1000 : limitParam));

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const AuditModel = (AuditLog as any).default || AuditLog;
    const ComplianceModel = (ComplianceRequest as any).default || ComplianceRequest;
    const HistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    let csvContent = "";
    let recordCount = 0;
    const now = new Date();

    const dateQuery: any = {};
    if (startDateParam || endDateParam) {
      if (startDateParam) dateQuery.$gte = new Date(startDateParam);
      if (endDateParam) dateQuery.$lte = new Date(endDateParam);
    }

    if (type === "users") {
      const filter: any = {};
      if (Object.keys(dateQuery).length > 0) filter.createdAt = dateQuery;

      const users = await UserModel.find(filter)
        .select("name email username role status identity createdAt updatedAt")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      recordCount = users.length;
      const headers = [
        "User ID",
        "Name",
        "Email",
        "Username",
        "Role",
        "Status",
        "Identity",
        "Created At",
        "Updated At",
      ];
      csvContent = headers.map(escapeCsv).join(",") + "\n";

      users.forEach((u: any) => {
        const row = [
          u._id,
          u.name,
          u.email,
          u.username || "",
          u.role || "user",
          u.status || "active",
          u.identity || "unassigned",
          u.createdAt ? new Date(u.createdAt).toISOString() : "",
          u.updatedAt ? new Date(u.updatedAt).toISOString() : "",
        ];
        csvContent += row.map(escapeCsv).join(",") + "\n";
      });
    } else if (type === "audit_logs") {
      const filter: any = {};
      if (Object.keys(dateQuery).length > 0) filter.timestamp = dateQuery;

      const logs = await AuditModel.find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();

      recordCount = logs.length;
      const headers = [
        "Log ID",
        "Timestamp",
        "Event Type",
        "Domain",
        "Severity",
        "Status",
        "Admin Email",
        "Admin Role",
        "Admin IP",
        "Target Entity",
        "Target ID",
        "Action Summary",
      ];
      csvContent = headers.map(escapeCsv).join(",") + "\n";

      logs.forEach((l: any) => {
        const row = [
          l._id,
          l.timestamp ? new Date(l.timestamp).toISOString() : "",
          l.eventType,
          l.domain,
          l.severity,
          l.status,
          l.actor?.email || "",
          l.actor?.role || "",
          l.actor?.ipAddress || "",
          l.target?.entityType || "",
          l.target?.entityId || "",
          l.actionSummary || "",
        ];
        csvContent += row.map(escapeCsv).join(",") + "\n";
      });
    } else if (type === "compliance") {
      const filter: any = {};
      if (Object.keys(dateQuery).length > 0) filter.requestedAt = dateQuery;

      const requests = await ComplianceModel.find(filter)
        .populate("userId", "name email")
        .populate("processedByAdminId", "name email")
        .sort({ requestedAt: -1 })
        .limit(limit)
        .lean();

      recordCount = requests.length;
      const headers = [
        "Request ID",
        "Request Type",
        "Status",
        "User Email",
        "Requested At",
        "Processed By",
        "Processed At",
        "Completion Date",
        "Notes",
      ];
      csvContent = headers.map(escapeCsv).join(",") + "\n";

      requests.forEach((r: any) => {
        const row = [
          r._id,
          r.requestType,
          r.requestStatus,
          r.userId?.email || "",
          r.requestedAt ? new Date(r.requestedAt).toISOString() : "",
          r.processedByAdminId?.email || "",
          r.processedAt ? new Date(r.processedAt).toISOString() : "",
          r.completionDate ? new Date(r.completionDate).toISOString() : "",
          r.notes || "",
        ];
        csvContent += row.map(escapeCsv).join(",") + "\n";
      });
    } else if (type === "status_history") {
      const filter: any = {};
      if (Object.keys(dateQuery).length > 0) filter.changedAt = dateQuery;

      const histories = await HistoryModel.find(filter)
        .populate("userId", "email")
        .populate("changedByAdminId", "email")
        .sort({ changedAt: -1 })
        .limit(limit)
        .lean();

      recordCount = histories.length;
      const headers = [
        "Record ID",
        "User Email",
        "Previous Status",
        "New Status",
        "Admin Email",
        "Reason",
        "Suspension Days",
        "Changed At",
      ];
      csvContent = headers.map(escapeCsv).join(",") + "\n";

      histories.forEach((h: any) => {
        const row = [
          h._id,
          h.userId?.email || "",
          h.previousStatus || "",
          h.newStatus,
          h.changedByAdminId?.email || "",
          h.changeReason,
          h.suspensionDurationDays || "",
          h.changedAt ? new Date(h.changedAt).toISOString() : "",
        ];
        csvContent += row.map(escapeCsv).join(",") + "\n";
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid export type. Allowed: 'users', 'audit_logs', 'compliance', 'status_history'",
        },
        { status: 400 }
      );
    }

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    // Track export in data access logs
    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: `csv_export_${type}`,
      accessType: "export",
      dataFieldsAccessed: [`report_${type}`, "csv_export"],
      ipAddress,
      userAgent,
      reason: `CSV report export for ${type} (records: ${recordCount})`,
    });

    // Record audit event
    await recordAuditLog({
      eventType: "REPORT_EXPORT",
      domain: "domain.users",
      severity: "info",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "ReportExport", entityId: type, label: `${type} CSV Export` },
      actionSummary: `Admin ${user.email} exported ${recordCount} records from ${type} report`,
      changes: {
        after: {
          exportType: type,
          recordCount,
          generatedAt: now.toISOString(),
        },
      },
    });

    const filename = `onevue_${type}_${now.toISOString().split("T")[0]}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

