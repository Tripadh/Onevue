import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import VisitingCard from "@/models/VisitingCard";
import UserWebsiteConfig from "@/models/UserWebsiteConfig";
import ComplianceRequest from "@/models/ComplianceRequest";
import UserAccountStatusHistory from "@/models/UserAccountStatusHistory";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * POST /api/admin/compliance/gdpr-deletion
 * Execute GDPR Right-to-Erasure: scrubs PII, unpublishes all cards & sites, records audit logs
 */
export async function POST(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "write");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { user_id, reason, immediate_scrub } = body;

    if (!user_id) {
      return NextResponse.json({ success: false, message: "user_id is required." }, { status: 400 });
    }

    const cleanReason = String(reason || "").trim();
    if (!cleanReason || cleanReason.length < 10) {
      return NextResponse.json(
        { success: false, message: "A compliance reason of at least 10 characters is required for GDPR deletion." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const CardModel = (VisitingCard as any).default || VisitingCard;
    const WebConfigModel = (UserWebsiteConfig as any).default || UserWebsiteConfig;
    const ComplianceModel = (ComplianceRequest as any).default || ComplianceRequest;
    const HistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    const targetUser = await UserModel.findById(user_id);
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
    const now = new Date();

    // 1. Soft-delete and PII scrubbing
    targetUser.status = "deleted";
    targetUser.deletedAt = now;
    targetUser.deletedByAdminId = user._id;

    if (immediate_scrub !== false) {
      targetUser.email = `deleted_${targetUser._id}@deleted.com`;
      targetUser.name = "Deleted User";
      targetUser.phone = null;
      targetUser.bio = null;
      targetUser.location = null;
      targetUser.profilePhotoKey = null;
    }
    await targetUser.save();

    // 2. Unpublish visiting cards
    await CardModel.updateMany(
      { userId: targetUser._id },
      { $set: { isPublished: false, updatedAt: now } }
    );

    // 3. Unpublish websites
    await WebConfigModel.updateMany(
      { userId: targetUser._id },
      { $set: { isPublished: false, publishedHtml: null, updatedAt: now } }
    );

    // 4. Update or complete open GDPR compliance requests
    await ComplianceModel.updateMany(
      { userId: targetUser._id, requestType: "gdpr_deletion", requestStatus: "pending" },
      {
        $set: {
          requestStatus: "completed",
          processedByAdminId: user._id,
          processedAt: now,
          completionDate: now,
        },
      }
    );

    // 5. Immutable status history record
    await HistoryModel.create({
      userId: targetUser._id,
      previousStatus,
      newStatus: "deleted",
      changedByAdminId: user._id,
      changeReason: `GDPR Right-to-Erasure: ${cleanReason}`,
      canAppeal: false,
      changedAt: now,
    });

    // 6. Record Audit Log
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await recordAuditLog({
      eventType: "COMPLIANCE_GDPR_DELETION",
      domain: "domain.users",
      severity: "critical",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "User", entityId: String(targetUser._id), label: originalEmail },
      actionSummary: `Admin ${user.email} executed GDPR deletion on account ${originalEmail}. Reason: "${cleanReason}"`,
      changes: {
        before: { status: previousStatus, email: originalEmail },
        after: {
          status: "deleted",
          piiScrubbed: immediate_scrub !== false,
          cardsUnpublished: true,
          sitesUnpublished: true,
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `GDPR erasure executed successfully for user account.`,
        deleted_user_id: targetUser._id,
        status: "deleted",
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
