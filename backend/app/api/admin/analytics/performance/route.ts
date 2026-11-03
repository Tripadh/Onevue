import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import AuditLog from "@/models/AuditLog";
import AdminLoginAttempt from "@/models/AdminLoginAttempt";
import AdminSession from "@/models/AdminSession";
import { verifyAdminAuth, checkDomainAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/analytics/performance
 * Operational velocities, login attempt ratios, and top security event distributions
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.security_rbac", "read");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    await connectToDatabase();
    const AuditModel = (AuditLog as any).default || AuditLog;
    const LoginAttemptModel = (AdminLoginAttempt as any).default || AdminLoginAttempt;
    const SessionModel = (AdminSession as any).default || AdminSession;

    const past30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      topEventTypes,
      topAdminActors,
      loginAttemptStats,
      activeSessionsCount,
      totalAuditLogsCount,
    ] = await Promise.all([
      // Top 8 audit event types
      AuditModel.aggregate([
        { $match: { timestamp: { $gte: past30Days } } },
        { $group: { _id: "$eventType", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),

      // Most active admins
      AuditModel.aggregate([
        { $match: { timestamp: { $gte: past30Days } } },
        { $group: { _id: "$actor.email", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),

      // Login attempt success vs failure
      LoginAttemptModel.aggregate([
        { $match: { attemptedAt: { $gte: past30Days } } },
        { $group: { _id: "$success", count: { $sum: 1 } } },
      ]),

      SessionModel.countDocuments({ isActive: true, expiresAt: { $gt: new Date() } }),
      AuditModel.countDocuments({ timestamp: { $gte: past30Days } }),
    ]);

    let successfulLogins = 0;
    let failedLogins = 0;
    loginAttemptStats.forEach((stat: any) => {
      if (stat._id === true) successfulLogins = stat.count;
      else failedLogins = stat.count;
    });

    const totalLogins = successfulLogins + failedLogins;
    const loginSuccessRate = totalLogins > 0 ? ((successfulLogins / totalLogins) * 100).toFixed(1) : "100.0";

    return NextResponse.json(
      {
        success: true,
        performance: {
          period: "Last 30 Days",
          total_audit_events: totalAuditLogsCount,
          active_sessions: activeSessionsCount,
          login_metrics: {
            total_attempts: totalLogins,
            successful_logins: successfulLogins,
            failed_attempts: failedLogins,
            success_rate_percent: parseFloat(loginSuccessRate),
          },
          top_event_types: topEventTypes.map((e: any) => ({
            event: e._id,
            count: e.count,
          })),
          top_admin_actors: topAdminActors.map((a: any) => ({
            admin: a._id,
            actions_count: a.count,
          })),
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

