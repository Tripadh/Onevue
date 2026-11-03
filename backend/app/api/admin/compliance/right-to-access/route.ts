import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import StudentProfile from "@/models/StudentProfile";
import VisitingCard from "@/models/VisitingCard";
import UserWebsiteConfig from "@/models/UserWebsiteConfig";
import UserWarningHistory from "@/models/UserWarningHistory";
import UserAccountStatusHistory from "@/models/UserAccountStatusHistory";
import BanAppeal from "@/models/BanAppeal";
import ComplianceRequest from "@/models/ComplianceRequest";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog, logDataAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * POST /api/admin/compliance/right-to-access
 * Generate complete GDPR Right-to-Access data archive for a user
 */
export async function POST(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "read");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { user_id, reason } = body;

    if (!user_id) {
      return NextResponse.json({ success: false, message: "user_id is required." }, { status: 400 });
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const StudentModel = (StudentProfile as any).default || StudentProfile;
    const CardModel = (VisitingCard as any).default || VisitingCard;
    const WebConfigModel = (UserWebsiteConfig as any).default || UserWebsiteConfig;
    const WarningModel = (UserWarningHistory as any).default || UserWarningHistory;
    const HistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;
    const AppealModel = (BanAppeal as any).default || BanAppeal;
    const ComplianceModel = (ComplianceRequest as any).default || ComplianceRequest;

    const targetUser = await UserModel.findById(user_id).select("-password").lean();
    if (!targetUser) {
      return NextResponse.json({ success: false, message: "Target user not found." }, { status: 404 });
    }

    // Parallel fetch of all user data
    const [
      studentProfile,
      cards,
      webConfig,
      warnings,
      statusHistory,
      appeals,
    ] = await Promise.all([
      StudentModel.findOne({ userId: targetUser._id }).lean().catch(() => null),
      CardModel.find({ userId: targetUser._id }).lean().catch(() => []),
      WebConfigModel.findOne({ userId: targetUser._id }).lean().catch(() => null),
      WarningModel.find({ warnedUserId: targetUser._id })
        .select("-adminId") // Keep sender admin confidential
        .sort({ warnedAt: -1 })
        .lean()
        .catch(() => []),
      HistoryModel.find({ userId: targetUser._id })
        .select("-changedByAdminId")
        .sort({ changedAt: -1 })
        .lean()
        .catch(() => []),
      AppealModel.find({ appealingUserId: targetUser._id }).sort({ appealedAt: -1 }).lean().catch(() => []),
    ]);

    const now = new Date();

    // Mark pending right-to-access compliance requests as completed
    await ComplianceModel.updateMany(
      { userId: targetUser._id, requestType: "right_to_access", requestStatus: "pending" },
      {
        $set: {
          requestStatus: "completed",
          processedByAdminId: user._id,
          processedAt: now,
          completionDate: now,
        },
      }
    );

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: String(targetUser._id),
      accessType: "export",
      dataFieldsAccessed: [
        "account_profile",
        "student_profile",
        "cards",
        "website_configs",
        "warning_history",
        "status_history",
        "appeals",
      ],
      ipAddress,
      userAgent,
      reason: reason ? String(reason).slice(0, 200) : "GDPR Article 15 Right of Access Data Export",
    });

    await recordAuditLog({
      eventType: "COMPLIANCE_DATA_EXPORT",
      domain: "domain.users",
      severity: "info",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "User", entityId: String(targetUser._id), label: targetUser.email },
      actionSummary: `Admin ${user.email} exported GDPR data archive for ${targetUser.email}`,
      changes: {
        after: {
          cardsCount: cards.length,
          hasWebsiteConfig: !!webConfig,
          hasStudentProfile: !!studentProfile,
          warningsCount: warnings.length,
        },
      },
    });

    const exportBundle = {
      compliance_standard: "GDPR Article 15 (Right of Access)",
      exported_at: now.toISOString(),
      account: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        username: targetUser.username,
        role: targetUser.role,
        status: targetUser.status,
        identity: targetUser.identity,
        phone: targetUser.phone,
        bio: targetUser.bio,
        location: targetUser.location,
        created_at: targetUser.createdAt,
        updated_at: targetUser.updatedAt,
      },
      student_profile: studentProfile,
      visiting_cards: cards,
      website_configuration: webConfig,
      disciplinary_warnings: warnings.map((w: any) => ({
        id: w._id,
        message: w.warningMessage,
        severity: w.severityLevel,
        warned_at: w.warnedAt,
        acknowledged_at: w.acknowledgedAt,
      })),
      status_history: statusHistory.map((s: any) => ({
        id: s._id,
        previous_status: s.previousStatus,
        new_status: s.newStatus,
        reason: s.changeReason,
        changed_at: s.changedAt,
      })),
      appeals: appeals.map((a: any) => ({
        id: a._id,
        appeal_message: a.appealMessage,
        status: a.appealStatus,
        review_reason: a.reviewReason,
        appealed_at: a.appealedAt,
        reviewed_at: a.reviewedAt,
      })),
    };

    return NextResponse.json(
      {
        success: true,
        message: "Data archive generated successfully.",
        data_archive: exportBundle,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

