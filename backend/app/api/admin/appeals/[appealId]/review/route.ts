import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import BanAppeal from "@/models/BanAppeal";
import UserAccountStatusHistory from "@/models/UserAccountStatusHistory";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * POST /api/admin/appeals/[appealId]/review
 * Review and resolve a pending ban appeal (approve or reject)
 */
export async function POST(
  req: Request,
  context: { params: Promise<{ appealId: string }> }
) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "write");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const { appealId } = await context.params;
    if (!appealId) {
      return NextResponse.json({ success: false, message: "appealId parameter is required." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, review_reason } = body;

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { success: false, message: "Action must be either 'approve' or 'reject'." },
        { status: 400 }
      );
    }

    const cleanReason = String(review_reason || "").trim();
    if (!cleanReason || cleanReason.length < 5) {
      return NextResponse.json(
        { success: false, message: "A review explanation of at least 5 characters is required." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const AppealModel = (BanAppeal as any).default || BanAppeal;
    const UserModel = (User as any).default || User;
    const HistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    const appeal = await AppealModel.findById(appealId);
    if (!appeal) {
      return NextResponse.json({ success: false, message: "Ban appeal record not found." }, { status: 404 });
    }

    if (appeal.appealStatus !== "pending") {
      return NextResponse.json(
        { success: false, message: `This appeal has already been ${appeal.appealStatus}.` },
        { status: 400 }
      );
    }

    const targetUser = await UserModel.findById(appeal.appealingUserId);
    const now = new Date();

    if (action === "approve") {
      if (targetUser) {
        const previousStatus = targetUser.status || "blocked";
        targetUser.status = "active";
        targetUser.blockedUntil = null;
        targetUser.blockedAt = null;
        targetUser.blockedByAdminId = null;
        await targetUser.save();

        await HistoryModel.create({
          userId: targetUser._id,
          previousStatus,
          newStatus: "active",
          changedByAdminId: user._id,
          changeReason: `Ban Appeal Approved: ${cleanReason}`,
          suspensionDurationDays: null,
          suspensionExpiresAt: null,
          canAppeal: true,
          changedAt: now,
        });
      }

      appeal.appealStatus = "approved";
      appeal.reviewedByAdminId = user._id;
      appeal.reviewReason = cleanReason;
      appeal.reviewedAt = now;
      await appeal.save();
    } else {
      appeal.appealStatus = "rejected";
      appeal.reviewedByAdminId = user._id;
      appeal.reviewReason = cleanReason;
      appeal.reviewedAt = now;
      await appeal.save();
    }

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await recordAuditLog({
      eventType: action === "approve" ? "BAN_APPEAL_APPROVE" : "BAN_APPEAL_REJECT",
      domain: "domain.users",
      severity: action === "approve" ? "info" : "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: {
        entityType: "BanAppeal",
        entityId: String(appeal._id),
        label: targetUser ? targetUser.email : `User ${appeal.appealingUserId}`,
      },
      actionSummary: `Admin ${user.email} ${action}d ban appeal for ${targetUser ? targetUser.email : appeal.appealingUserId}. Reason: "${cleanReason}"`,
      changes: {
        before: { appealStatus: "pending" },
        after: {
          appealStatus: appeal.appealStatus,
          reviewReason: cleanReason,
          userStatus: targetUser?.status,
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `Ban appeal successfully ${action}d.`,
        appeal: {
          id: appeal._id,
          status: appeal.appealStatus,
          review_reason: appeal.reviewReason,
          reviewed_at: appeal.reviewedAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

