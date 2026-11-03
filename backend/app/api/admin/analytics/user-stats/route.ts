import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import VisitingCard from "@/models/VisitingCard";
import UserWebsiteConfig from "@/models/UserWebsiteConfig";
import BanAppeal from "@/models/BanAppeal";
import ComplianceRequest from "@/models/ComplianceRequest";
import AdminSession from "@/models/AdminSession";
import { verifyAdminAuth, checkDomainAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/analytics/user-stats
 * High-level system statistics and account distribution metrics
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

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const CardModel = (VisitingCard as any).default || VisitingCard;
    const WebConfigModel = (UserWebsiteConfig as any).default || UserWebsiteConfig;
    const AppealModel = (BanAppeal as any).default || BanAppeal;
    const ComplianceModel = (ComplianceRequest as any).default || ComplianceRequest;
    const SessionModel = (AdminSession as any).default || AdminSession;

    const now = new Date();

    const [
      statusAggregation,
      identityAggregation,
      totalCards,
      totalWebsites,
      pendingAppeals,
      pendingCompliance,
      activeSessions,
      totalUsers,
    ] = await Promise.all([
      UserModel.aggregate([
        { $group: { _id: { $ifNull: ["$status", "active"] }, count: { $sum: 1 } } },
      ]),
      UserModel.aggregate([
        { $group: { _id: { $ifNull: ["$identity", "unassigned"] }, count: { $sum: 1 } } },
      ]),
      CardModel.countDocuments(),
      WebConfigModel.countDocuments(),
      AppealModel.countDocuments({ appealStatus: "pending" }),
      ComplianceModel.countDocuments({ requestStatus: "pending" }),
      SessionModel.countDocuments({ isActive: true, expiresAt: { $gt: now } }),
      UserModel.countDocuments(),
    ]);

    const statusBreakdown: Record<string, number> = {
      active: 0,
      blocked: 0,
      suspended: 0,
      deleted: 0,
      pending: 0,
    };
    statusAggregation.forEach((item: any) => {
      statusBreakdown[item._id] = item.count;
    });

    const identityBreakdown: Record<string, number> = {};
    identityAggregation.forEach((item: any) => {
      identityBreakdown[item._id] = item.count;
    });

    return NextResponse.json(
      {
        success: true,
        metrics: {
          total_users: totalUsers,
          active_users: statusBreakdown.active || 0,
          blocked_users: statusBreakdown.blocked || 0,
          suspended_users: statusBreakdown.suspended || 0,
          deleted_users: statusBreakdown.deleted || 0,
          status_breakdown: statusBreakdown,
          identity_breakdown: identityBreakdown,
          total_visiting_cards: totalCards,
          total_websites: totalWebsites,
          pending_appeals: pendingAppeals,
          pending_compliance_requests: pendingCompliance,
          active_admin_sessions: activeSessions,
          calculated_at: now.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

