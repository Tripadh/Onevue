import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../../lib/db";
import User from "../../../../../../models/User";
import VisitingCard from "../../../../../../models/VisitingCard";
import UserWebsiteConfig from "../../../../../../models/UserWebsiteConfig";
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

    const hasAccess = await checkDomainAccess(user, "domain.users", "delete");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const { userId } = await context.params;
    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!reason || reason.length < 10) {
      return NextResponse.json(
        { success: false, message: "A clear justification of at least 10 characters is mandatory to delete an account." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const CardModel = (VisitingCard as any).default || VisitingCard;
    const WebConfigModel = (UserWebsiteConfig as any).default || UserWebsiteConfig;
    const StatusHistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) {
      return NextResponse.json({ success: false, message: "Target user not found." }, { status: 404 });
    }

    if (targetUser.role === "super_admin") {
      return NextResponse.json(
        { success: false, message: "Super Administrator accounts cannot be deleted." },
        { status: 403 }
      );
    }

    const previousStatus = targetUser.status || "active";
    const originalEmail = targetUser.email;

    // 1. Soft-delete and anonymize user record
    targetUser.status = "deleted";
    targetUser.email = `deleted_${targetUser._id}@deleted.com`;
    targetUser.name = "Deleted User";
    targetUser.username = null;
    targetUser.deletedAt = new Date();
    targetUser.deletedByAdminId = user._id;
    await targetUser.save();

    // 2. Cascade unpublish and anonymize associated content
    await Promise.all([
      CardModel.updateMany(
        { userId: targetUser._id },
        { isPublished: false, publishedSnapshot: null, title: "[Deleted Card]" }
      ),
      WebConfigModel.updateMany(
        { userId: targetUser._id },
        { isPublished: false, username: `deleted_${targetUser._id}` }
      ),
    ]);

    // 3. Immutable status history record
    await StatusHistoryModel.create({
      userId: targetUser._id,
      previousStatus,
      newStatus: "deleted",
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

    // 4. Critical audit record
    await recordAuditLog({
      eventType: "USER_DELETE",
      domain: "domain.users",
      severity: "critical",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "User", entityId: String(targetUser._id), label: originalEmail },
      actionSummary: `Admin ${user.email} permanently deleted and anonymized user ${originalEmail}`,
      changes: {
        before: { email: originalEmail, status: previousStatus },
        after: { status: "deleted", reason },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `Account ${originalEmail} has been soft-deleted and anonymized.`,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

