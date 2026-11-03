import { NextResponse } from "next/server";
import connectToDatabase from "../../../../lib/db";
import User from "../../../../models/User";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/users
 * Lists platform users across all identities with search and status filtering
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "read");
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, message: "Permission denied: access to user management is restricted." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");
    const role = searchParams.get("role");
    const identity = searchParams.get("identity");
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const skip = (page - 1) * limit;

    const query: Record<string, any> = {};

    if (role) query.role = role;
    if (identity) query.identity = identity;
    if (status) query.status = status;
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: searchRegex }, { email: searchRegex }, { username: searchRegex }];
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;

    const [users, total] = await Promise.all([
      UserModel.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      UserModel.countDocuments(query),
    ]);

    return NextResponse.json(
      {
        success: true,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        users,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/users
 * Updates a user's status (active/suspended), role, or custom permissions
 */
export async function PATCH(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "write");
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, message: "Permission denied: user modification requires users write access." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { userId, status, role, customPermissions } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, message: "userId is required to modify user record." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const targetUser = await UserModel.findById(userId);

    if (!targetUser) {
      return NextResponse.json({ success: false, message: "Target user not found." }, { status: 404 });
    }

    // Protect super_admin from being demoted or suspended by non-super-admins
    if (targetUser.role === "super_admin" && user.role !== "super_admin") {
      return NextResponse.json(
        { success: false, message: "Only Super Admin can modify another Super Admin." },
        { status: 403 }
      );
    }

    const before = { status: targetUser.status, role: targetUser.role };

    if (status && ["active", "suspended", "pending"].includes(status)) {
      targetUser.status = status;
    }
    if (role && ["super_admin", "admin", "moderator", "user"].includes(role)) {
      // Only super_admin can grant super_admin or admin roles
      if ((role === "super_admin" || role === "admin") && user.role !== "super_admin") {
        return NextResponse.json(
          { success: false, message: "Only Super Admin can assign administrative roles." },
          { status: 403 }
        );
      }
      targetUser.role = role;
    }
    if (customPermissions !== undefined) {
      targetUser.customPermissions = customPermissions;
    }

    await targetUser.save();

    await recordAuditLog({
      eventType: "USER_MODIFIED_BY_ADMIN",
      domain: "domain.users",
      severity: "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role },
      target: { entityType: "User", entityId: String(targetUser._id), label: targetUser.email },
      actionSummary: `Admin ${user.email} updated account settings for ${targetUser.email}`,
      changes: {
        before,
        after: { status: targetUser.status, role: targetUser.role },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `User ${targetUser.email} updated successfully.`,
        user: {
          id: targetUser._id,
          name: targetUser.name,
          email: targetUser.email,
          role: targetUser.role,
          status: targetUser.status,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
