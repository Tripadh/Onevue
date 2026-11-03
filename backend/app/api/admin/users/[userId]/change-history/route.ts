import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../../lib/db";
import UserAccountStatusHistory from "../../../../../../models/UserAccountStatusHistory";
import { verifyAdminAuth, checkDomainAccess, logDataAccess } from "../../../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "read");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const { userId } = await context.params;
    if (!userId) {
      return NextResponse.json({ success: false, message: "userId parameter is required." }, { status: 400 });
    }

    await connectToDatabase();
    const HistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    const changes = await HistoryModel.find({ userId })
      .populate("changedByAdminId", "name email role")
      .sort({ changedAt: -1 })
      .limit(50)
      .lean();

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: userId,
      accessType: "view_change_history",
      dataFieldsAccessed: ["status_history"],
      ipAddress,
      userAgent,
      reason: "Inspect user account change timeline",
    });

    return NextResponse.json(
      {
        success: true,
        userId,
        total_changes: changes.length,
        changes: changes.map((c: any) => ({
          id: c._id,
          previousStatus: c.previousStatus,
          newStatus: c.newStatus,
          changedByAdmin: {
            id: c.changedByAdminId?._id || c.changedByAdminId,
            email: c.changedByAdminId?.email || "Unknown",
            name: c.changedByAdminId?.name || "Administrator",
            role: c.changedByAdminId?.role || "admin",
          },
          changeReason: c.changeReason,
          changeNotes: c.changeNotes,
          suspensionDurationDays: c.suspensionDurationDays,
          suspensionExpiresAt: c.suspensionExpiresAt,
          canAppeal: c.canAppeal,
          changedAt: c.changedAt,
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

