import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import BanAppeal from "@/models/BanAppeal";
import { verifyAdminAuth, checkDomainAccess, logDataAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/appeals
 * Retrieve ban appeals with status filters and pagination
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
    const statusParam = searchParams.get("status") || "pending";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const query: any = {};
    if (statusParam && statusParam !== "all") {
      query.appealStatus = statusParam;
    }

    await connectToDatabase();
    const AppealModel = (BanAppeal as any).default || BanAppeal;

    const [appeals, total, pendingCount] = await Promise.all([
      AppealModel.find(query)
        .populate("appealingUserId", "name email username status blockedUntil blockedAt")
        .populate("originalBanningAdminId", "name email")
        .populate("reviewedByAdminId", "name email")
        .sort({ appealedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AppealModel.countDocuments(query),
      AppealModel.countDocuments({ appealStatus: "pending" }),
    ]);

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: "appeals_queue",
      accessType: "view_appeals_queue",
      dataFieldsAccessed: ["ban_appeals", "reasons", "contact_emails"],
      ipAddress,
      userAgent,
      reason: "Inspect user ban appeals queue",
    });

    return NextResponse.json(
      {
        success: true,
        total,
        page,
        limit,
        pending_count: pendingCount,
        appeals: appeals.map((a: any) => ({
          id: a._id,
          user: a.appealingUserId
            ? {
                id: a.appealingUserId._id,
                name: a.appealingUserId.name,
                email: a.appealingUserId.email,
                username: a.appealingUserId.username,
                status: a.appealingUserId.status,
                blockedUntil: a.appealingUserId.blockedUntil,
                blockedAt: a.appealingUserId.blockedAt,
              }
            : null,
          original_ban_reason: a.originalBanReason,
          original_ban_date: a.originalBanDate,
          banning_admin: a.originalBanningAdminId
            ? {
                name: a.originalBanningAdminId.name,
                email: a.originalBanningAdminId.email,
              }
            : null,
          appeal_message: a.appealMessage,
          contact_email: a.contactEmail,
          appeal_status: a.appealStatus,
          reviewed_by: a.reviewedByAdminId
            ? {
                name: a.reviewedByAdminId.name,
                email: a.reviewedByAdminId.email,
              }
            : null,
          review_reason: a.reviewReason,
          reviewed_at: a.reviewedAt,
          appealed_at: a.appealedAt,
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

