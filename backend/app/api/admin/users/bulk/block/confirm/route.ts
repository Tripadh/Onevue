import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import UserAccountStatusHistory from "@/models/UserAccountStatusHistory";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "@/lib/admin-auth";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * POST /api/admin/users/bulk/block/confirm
 * Verify confirmation token and execute the bulk block action
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
    const { confirmation_token } = body;

    if (!confirmation_token || typeof confirmation_token !== "string") {
      return NextResponse.json(
        { success: false, message: "A valid confirmation_token is required to execute bulk action." },
        { status: 400 }
      );
    }

    let payload: any;
    try {
      payload = jwt.verify(confirmation_token, JWT_SECRET);
    } catch (err: any) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired confirmation token. Please request a new preview." },
        { status: 400 }
      );
    }

    if (payload.action !== "bulk_block") {
      return NextResponse.json(
        { success: false, message: "Token is not valid for bulk block action." },
        { status: 400 }
      );
    }

    if (String(payload.adminId) !== String(user._id)) {
      return NextResponse.json(
        { success: false, message: "Confirmation token can only be executed by the issuing administrator." },
        { status: 403 }
      );
    }

    const userIds: string[] = payload.user_ids || [];
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { success: false, message: "No target users found in confirmation token." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const StatusHistoryModel = (UserAccountStatusHistory as any).default || UserAccountStatusHistory;

    // Fetch existing users to record their previous status
    const targetUsers = await UserModel.find({
      _id: { $in: userIds },
      role: { $ne: "super_admin" },
    }).select("_id email status");

    if (targetUsers.length === 0) {
      return NextResponse.json(
        { success: false, message: "No eligible users found to execute bulk block." },
        { status: 404 }
      );
    }

    const durationDays = payload.duration_days ? parseInt(payload.duration_days, 10) : null;
    const blockUntil = durationDays
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      : null;
    const now = new Date();

    const eligibleIds = targetUsers.map((u: any) => u._id);

    // 1. Bulk update users
    await UserModel.updateMany(
      { _id: { $in: eligibleIds } },
      {
        $set: {
          status: "blocked",
          blockedUntil: blockUntil,
          blockedAt: now,
          blockedByAdminId: user._id,
        },
      }
    );

    // 2. Insert immutable history records
    const historyEntries = targetUsers.map((u: any) => ({
      userId: u._id,
      previousStatus: u.status || "active",
      newStatus: "blocked",
      changedByAdminId: user._id,
      changeReason: payload.reason,
      changeNotes: payload.notes || undefined,
      suspensionDurationDays: durationDays,
      suspensionExpiresAt: blockUntil,
      canAppeal: true,
      changedAt: now,
    }));
    await StatusHistoryModel.insertMany(historyEntries);

    // 3. Record Audit Log for the bulk action
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await recordAuditLog({
      eventType: "USER_BULK_BLOCK",
      domain: "domain.users",
      severity: "critical",
      actor: {
        userId: String(user._id),
        email: user.email,
        role: user.role,
        ipAddress,
        userAgent,
      },
      target: {
        entityType: "UserBatch",
        entityId: `${targetUsers.length}_users`,
        label: `${targetUsers.length} user accounts`,
      },
      actionSummary: `Admin ${user.email} executed bulk block on ${targetUsers.length} accounts. Reason: "${payload.reason}"`,
      changes: {
        before: { affectedCount: targetUsers.length },
        after: {
          status: "blocked",
          blockedUntil: blockUntil ? blockUntil.toISOString() : "indefinite",
          targetIds: eligibleIds.map(String),
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `Successfully blocked ${targetUsers.length} accounts.`,
        affected_count: targetUsers.length,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("Bulk block confirm error:", err);
    return NextResponse.json(
      { success: false, message: "Internal server error during bulk block execution.", error: err.message },
      { status: 500 }
    );
  }
}
