import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import AuditLog from "@/models/AuditLog";
import UserAccountStatusHistory from "@/models/UserAccountStatusHistory";
import { verifyAdminAuth, checkDomainAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/analytics/activity
 * Time-series daily activity metrics (registrations, blocks, admin actions) over requested period
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
    const daysParam = parseInt(searchParams.get("days") || "30", 10);
    const days = Math.min(90, Math.max(7, isNaN(daysParam) ? 30 : daysParam));
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const AuditModel = (AuditLog as any).default || AuditLog;
    const HistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    const [registrations, adminActions, statusChanges] = await Promise.all([
      // Daily user registrations
      UserModel.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Daily admin audit events
      AuditModel.aggregate([
        { $match: { timestamp: { $gte: startDate } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
            totalActions: { $sum: 1 },
            errors: {
              $sum: { $cond: [{ $eq: ["$status", "FAILURE"] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // Daily disciplinary status actions (blocks/suspensions/deletions)
      HistoryModel.aggregate([
        { $match: { changedAt: { $gte: startDate } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: "%Y-%m-%d", date: "$changedAt" } },
              status: "$newStatus",
            },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Construct map of dates
    const dateMap: Record<
      string,
      {
        date: string;
        registrations: number;
        adminActions: number;
        securityAlerts: number;
        blocks: number;
        unblocks: number;
      }
    > = {};

    // Populate every day in the range with 0 defaults
    for (let i = days; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split("T")[0];
      dateMap[dateStr] = {
        date: dateStr,
        registrations: 0,
        adminActions: 0,
        securityAlerts: 0,
        blocks: 0,
        unblocks: 0,
      };
    }

    registrations.forEach((r: any) => {
      if (dateMap[r._id]) dateMap[r._id].registrations = r.count;
    });

    adminActions.forEach((a: any) => {
      if (dateMap[a._id]) {
        dateMap[a._id].adminActions = a.totalActions;
        dateMap[a._id].securityAlerts = a.errors;
      }
    });

    statusChanges.forEach((s: any) => {
      const date = s._id.date;
      const status = s._id.status;
      if (dateMap[date]) {
        if (status === "blocked" || status === "suspended") {
          dateMap[date].blocks += s.count;
        } else if (status === "active") {
          dateMap[date].unblocks += s.count;
        }
      }
    });

    const timeline = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json(
      {
        success: true,
        period_days: days,
        start_date: startDate.toISOString(),
        timeline,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

