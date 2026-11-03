import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../../lib/db";
import User from "../../../../../../models/User";
import UserAccountStatusHistory from "../../../../../../models/UserAccountStatusHistory";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "../../../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "write");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const { userId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    const notes = body.notes ? String(body.notes).trim() : null;
    const durationDays = body.duration_days ? parseInt(body.duration_days, 10) : null;

    // Strict validation safeguards
    if (!reason || reason.length < 10) {
      return NextResponse.json(
        { success: false, message: "A clear reason of at least 10 characters is mandatory to block an account." },
        { status: 400 }
      );
    }

    if (durationDays !== null && (isNaN(durationDays) || durationDays < 1 || durationDays > 365)) {
      return NextResponse.json(
        { success: false, message: "Suspension duration must be between 1 and 365 days, or left null for indefinite." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const StatusHistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) {
      return NextResponse.json({ success: false, message: "Target user not found." }, { status: 404 });
    }

    // Protection: Super Admins cannot be blocked
    if (targetUser.role === "super_admin") {
      return NextResponse.json(
        { success: false, message: "Super Administrator accounts cannot be blocked." },
        { status: 403 }
      );
    }

    const previousStatus = targetUser.status || "active";
    const blockUntil = durationDays
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      : null;

    targetUser.status = "blocked";
    targetUser.blockedUntil = blockUntil;
    targetUser.blockedAt = new Date();
    targetUser.blockedByAdminId = user._id;
    await targetUser.save();

    // Immutable User Account Status History record
    await StatusHistoryModel.create({
      userId: targetUser._id,
      previousStatus,
      newStatus: "blocked",
      changedByAdminId: user._id,
      changeReason: reason,
      changeNotes: notes,
      suspensionDurationDays: durationDays,
      suspensionExpiresAt: blockUntil,
      canAppeal: true,
      changedAt: new Date(),
    });

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await recordAuditLog({
      eventType: "USER_BLOCK",
      domain: "domain.users",
      severity: "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "User", entityId: String(targetUser._id), label: targetUser.email },
      actionSummary: `Admin ${user.email} blocked account ${targetUser.email} (Duration: ${durationDays ? durationDays + "d" : "Indefinite"})`,
      changes: {
        before: { status: previousStatus },
        after: { status: "blocked", blockedUntil: blockUntil, reason },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `User ${targetUser.email} has been blocked successfully.`,
        user: {
          id: targetUser._id,
          email: targetUser.email,
          status: targetUser.status,
          blockedUntil: blockUntil,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

