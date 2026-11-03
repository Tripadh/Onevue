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

    if (!reason || reason.length < 10) {
      return NextResponse.json(
        { success: false, message: "A clear justification of at least 10 characters is required to restore an account." },
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

    const previousStatus = targetUser.status || "blocked";
    targetUser.status = "active";
    targetUser.blockedUntil = null;
    targetUser.blockedAt = null;
    await targetUser.save();

    await StatusHistoryModel.create({
      userId: targetUser._id,
      previousStatus,
      newStatus: "active",
      changedByAdminId: user._id,
      changeReason: reason,
      changeNotes: notes,
      canAppeal: false,
      changedAt: new Date(),
    });

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await recordAuditLog({
      eventType: "USER_UNBLOCK",
      domain: "domain.users",
      severity: "info",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "User", entityId: String(targetUser._id), label: targetUser.email },
      actionSummary: `Admin ${user.email} restored account ${targetUser.email}`,
      changes: {
        before: { status: previousStatus },
        after: { status: "active", reason },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `User ${targetUser.email} has been unblocked successfully.`,
        user: {
          id: targetUser._id,
          email: targetUser.email,
          status: "active",
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

