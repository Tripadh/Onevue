import { NextResponse } from "next/server";
import connectToDatabase from "../../../../lib/db";
import RolePermission from "../../../../models/RolePermission";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/roles
 * Lists all defined system and custom roles with their permission matrices
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();
    const RoleModel = (RolePermission as any).default || RolePermission;
    const roles = await RoleModel.find({}).sort({ isSystemRole: -1, createdAt: 1 });

    return NextResponse.json(
      { success: true, count: roles.length, roles },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * PUT /api/admin/roles
 * Updates permissions for a specific role
 */
export async function PUT(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.security_rbac", "manage");
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, message: "Permission denied: modifying role permissions requires security_rbac manage access." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { role, permissions, description } = body;

    if (!role || !Array.isArray(permissions)) {
      return NextResponse.json(
        { success: false, message: "role and permissions array are required." },
        { status: 400 }
      );
    }

    // Protect super_admin from losing root privileges
    if (role === "super_admin" && user.role !== "super_admin") {
      return NextResponse.json(
        { success: false, message: "Only an active Super Administrator can modify the super_admin role." },
        { status: 403 }
      );
    }

    await connectToDatabase();
    const RoleModel = (RolePermission as any).default || RolePermission;
    const roleDoc = await RoleModel.findOne({ role });

    if (!roleDoc) {
      return NextResponse.json(
        { success: false, message: `Role '${role}' was not found.` },
        { status: 404 }
      );
    }

    const beforePermissionsCount = roleDoc.permissions?.length || 0;
    roleDoc.permissions = permissions;
    if (description !== undefined) roleDoc.description = String(description).trim();

    await roleDoc.save();

    await recordAuditLog({
      eventType: "ROLE_PERMISSION_UPDATED",
      domain: "domain.security_rbac",
      severity: "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role },
      target: { entityType: "RolePermission", entityId: String(roleDoc._id), label: role },
      actionSummary: `Admin ${user.email} updated permission matrix for role '${role}'`,
      changes: {
        before: { permissionsCount: beforePermissionsCount },
        after: { permissionsCount: permissions.length, domainsCovered: permissions.map((p: any) => p.domainKey) },
      },
    });

    return NextResponse.json(
      { success: true, message: `Role '${role}' permissions updated successfully.`, role: roleDoc },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
