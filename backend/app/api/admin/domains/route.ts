import { NextResponse } from "next/server";
import connectToDatabase from "../../../../lib/db";
import DomainRegistry from "../../../../models/DomainRegistry";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/domains
 * Lists all registered domains in the OneVue platform
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;

    await connectToDatabase();
    const DomainModel = (DomainRegistry as any).default || DomainRegistry;
    const domains = await DomainModel.find({}).sort({ order: 1, createdAt: 1 });

    return NextResponse.json(
      { success: true, count: domains.length, domains },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * POST /api/admin/domains
 * Register a new extensible domain for future platform features
 */
export async function POST(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.security_rbac", "create");
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, message: "Permission denied: domain creation requires security_rbac create access." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    let { domainKey, name, description, allowedActions } = body;

    domainKey = String(domainKey || "").trim().toLowerCase();
    name = String(name || "").trim();
    description = String(description || "").trim();

    if (!domainKey || !name) {
      return NextResponse.json(
        { success: false, message: "domainKey (e.g. domain.ai_tools) and name are required." },
        { status: 400 }
      );
    }

    if (!domainKey.startsWith("domain.")) {
      domainKey = "domain." + domainKey;
    }

    if (!Array.isArray(allowedActions) || allowedActions.length === 0) {
      allowedActions = ["read", "write", "create", "delete", "publish", "manage"];
    }

    await connectToDatabase();
    const DomainModel = (DomainRegistry as any).default || DomainRegistry;

    const existing = await DomainModel.findOne({ domainKey });
    if (existing) {
      return NextResponse.json(
        { success: false, message: `Domain '${domainKey}' is already registered.` },
        { status: 409 }
      );
    }

    const domain = await DomainModel.create({
      domainKey,
      name,
      description,
      allowedActions,
      isSystem: false,
      isActive: true,
      order: 99,
    });

    // High-signal audit record
    await recordAuditLog({
      eventType: "DOMAIN_REGISTERED",
      domain: "domain.security_rbac",
      severity: "info",
      actor: { userId: String(user._id), email: user.email, role: user.role },
      target: { entityType: "DomainRegistry", entityId: String(domain._id), label: domainKey },
      actionSummary: `Admin ${user.email} registered new domain '${name}' (${domainKey})`,
      changes: {
        after: { domainKey, name, allowedActions },
      },
    });

    return NextResponse.json(
      { success: true, message: `Domain '${name}' successfully registered.`, domain },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/domains
 * Updates domain metadata or toggles active status
 */
export async function PATCH(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.security_rbac", "write");
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, message: "Permission denied: modifying domains requires security_rbac write access." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { domainKey, name, description, allowedActions, isActive } = body;

    if (!domainKey) {
      return NextResponse.json(
        { success: false, message: "domainKey is required to update a domain." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const DomainModel = (DomainRegistry as any).default || DomainRegistry;
    const domain = await DomainModel.findOne({ domainKey });

    if (!domain) {
      return NextResponse.json(
        { success: false, message: `Domain '${domainKey}' not found.` },
        { status: 404 }
      );
    }

    const beforeState = {
      name: domain.name,
      description: domain.description,
      isActive: domain.isActive,
    };

    if (name !== undefined) domain.name = String(name).trim();
    if (description !== undefined) domain.description = String(description).trim();
    if (isActive !== undefined) domain.isActive = Boolean(isActive);
    if (Array.isArray(allowedActions)) domain.allowedActions = allowedActions;

    await domain.save();

    await recordAuditLog({
      eventType: "DOMAIN_UPDATED",
      domain: "domain.security_rbac",
      severity: "info",
      actor: { userId: String(user._id), email: user.email, role: user.role },
      target: { entityType: "DomainRegistry", entityId: String(domain._id), label: domainKey },
      actionSummary: `Admin ${user.email} updated domain configuration for '${domainKey}'`,
      changes: {
        before: beforeState,
        after: { name: domain.name, description: domain.description, isActive: domain.isActive },
      },
    });

    return NextResponse.json(
      { success: true, message: `Domain '${domainKey}' updated.`, domain },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
