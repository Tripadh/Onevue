import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import UserWarningHistory from "@/models/UserWarningHistory";
import { verifyAdminAuth, checkDomainAccess, logDataAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/users/[userId]/warnings
 * Retrieve the warning history for a specific user
 */
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
    const WarningModel = (UserWarningHistory as any).default || UserWarningHistory;

    const warnings = await WarningModel.find({ warnedUserId: userId })
      .populate("adminId", "name email role")
      .populate("warningTemplateId", "title category")
      .sort({ warnedAt: -1 })
      .lean();

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: userId,
      accessType: "view_warnings",
      dataFieldsAccessed: ["warning_history"],
      ipAddress,
      userAgent,
      reason: "Inspect user disciplinary warning history",
    });

    return NextResponse.json(
      {
        success: true,
        userId,
        total_warnings: warnings.length,
        warnings: warnings.map((w: any) => ({
          id: w._id,
          message: w.warningMessage,
          severity_level: w.severityLevel,
          warned_at: w.warnedAt,
          acknowledged_at: w.acknowledgedAt || null,
          is_anonymous: w.isAnonymous,
          admin: w.adminId
            ? {
                name: w.adminId.name,
                email: w.adminId.email,
              }
            : null,
          template: w.warningTemplateId
            ? {
                id: w.warningTemplateId._id,
                title: w.warningTemplateId.title,
                category: w.warningTemplateId.category,
              }
            : null,
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

