import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../lib/db";
import DomainRegistry from "../../../../../models/DomainRegistry";
import RolePermission from "../../../../../models/RolePermission";
import { verifyAdminAuth } from "../../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) {
      return auth.errorResponse;
    }

    const { user } = auth;
    await connectToDatabase();

    const DomainModel = (DomainRegistry as any).default || DomainRegistry;
    const RoleModel = (RolePermission as any).default || RolePermission;

    // Fetch active domains and role definitions
    const domains = await DomainModel.find({ isActive: true }).sort({ order: 1 });
    const roleConfig = await RoleModel.findOne({ role: user.role });

    return NextResponse.json(
      {
        success: true,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          username: user.username || null,
          role: user.role,
          status: user.status || "active",
          customPermissions: user.customPermissions || {},
        },
        roleConfig: roleConfig || null,
        domains: domains.map((d: any) => ({
          domainKey: d.domainKey,
          name: d.name,
          description: d.description,
          allowedActions: d.allowedActions,
          isSystem: d.isSystem,
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
