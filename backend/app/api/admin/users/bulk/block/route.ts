import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectToDatabase from "../../../../../../lib/db";
import User from "../../../../../../models/User";
import { verifyAdminAuth, checkDomainAccess } from "../../../../../../lib/admin-auth";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * POST /api/admin/users/bulk/block
 * Preview bulk block action and issue a short-lived confirmation token
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
    const { user_ids, duration_days, reason, notes } = body;

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return NextResponse.json(
        { success: false, message: "Please select at least one user to block." },
        { status: 400 }
      );
    }

    if (user_ids.length > 100) {
      return NextResponse.json(
        { success: false, message: "Bulk operations are capped at 100 users per batch." },
        { status: 400 }
      );
    }

    const cleanReason = String(reason || "").trim();
    if (!cleanReason || cleanReason.length < 10) {
      return NextResponse.json(
        { success: false, message: "A clear reason of at least 10 characters is required for bulk actions." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;

    // Filter out super_admin accounts from being targeted
    const users = await UserModel.find({ _id: { $in: user_ids }, role: { $ne: "super_admin" } })
      .select("id email name status username role createdAt")
      .lean();

    if (users.length === 0) {
      return NextResponse.json(
        { success: false, message: "No eligible users found for bulk block." },
        { status: 400 }
      );
    }

    const eligibleUserIds = users.map((u: any) => String(u._id));

    // Sign a 5-minute confirmation token binding the exact user IDs and parameters
    const confirmation_token = jwt.sign(
      {
        action: "bulk_block",
        adminId: String(user._id),
        user_ids: eligibleUserIds,
        duration_days: duration_days || null,
        reason: cleanReason,
        notes: notes || null,
      },
      JWT_SECRET,
      { expiresIn: "5m" }
    );

    return NextResponse.json(
      {
        success: true,
        preview: users.map((u: any) => ({
          id: u._id,
          name: u.name,
          email: u.email,
          username: u.username,
          current_status: u.status,
          join_date: u.createdAt,
        })),
        affected_count: users.length,
        requires_confirmation: true,
        action_type: "bulk_block",
        confirmation_token,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

