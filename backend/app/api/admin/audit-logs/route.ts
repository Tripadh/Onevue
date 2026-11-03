import { NextResponse } from "next/server";
import connectToDatabase from "../../../../lib/db";
import AuditLog from "../../../../models/AuditLog";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/audit-logs
 * Queries dedicated, high-signal security and operational audit records
 * Strictly filters out noise; implements lean pagination for Atlas Free Tier
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.audit_logs", "read");
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, message: "Permission denied: access to audit logs is restricted." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const domain = searchParams.get("domain");
    const severity = searchParams.get("severity");
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const skip = (page - 1) * limit;

    const query: Record<string, any> = {};

    if (domain) query.domain = domain;
    if (severity && ["info", "warning", "critical"].includes(severity)) {
      query.severity = severity;
    }
    if (status && ["SUCCESS", "FAILURE"].includes(status)) {
      query.status = status;
    }
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { "actor.email": searchRegex },
        { actionSummary: searchRegex },
        { eventType: searchRegex },
      ];
    }

    await connectToDatabase();
    const AuditModel = (AuditLog as any).default || AuditLog;

    // Lean projection: only load essential fields to minimize network and memory on Free Tier
    const [logs, total] = await Promise.all([
      AuditModel.find(query)
        .select("timestamp eventType domain severity status actor actionSummary target changes")
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditModel.countDocuments(query),
    ]);

    return NextResponse.json(
      {
        success: true,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        logs,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/audit-logs
 * Allows Super Admin to manually purge older logs to conserve Free Tier storage if needed
 */
export async function DELETE(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    // Only Super Admin can purge logs
    if (user.role !== "super_admin") {
      return NextResponse.json(
        { success: false, message: "Permission denied: only Super Admin can purge audit logs." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const olderThanDays = Math.max(7, parseInt(searchParams.get("days") || "30", 10));
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    await connectToDatabase();
    const AuditModel = (AuditLog as any).default || AuditLog;

    const result = await AuditModel.deleteMany({ timestamp: { $lt: cutoffDate } });

    // Record the purge action itself
    await recordAuditLog({
      eventType: "AUDIT_LOGS_PURGED",
      domain: "domain.audit_logs",
      severity: "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role },
      actionSummary: `Super Admin purged ${result.deletedCount} audit logs older than ${olderThanDays} days to maintain Free Tier storage limit.`,
    });

    return NextResponse.json(
      {
        success: true,
        message: `Purged ${result.deletedCount} audit records older than ${olderThanDays} days.`,
        deletedCount: result.deletedCount,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
