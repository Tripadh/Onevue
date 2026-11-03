import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import WarningTemplate, { DEFAULT_WARNING_TEMPLATES } from "@/models/WarningTemplate";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/warning-templates
 * List available warning templates (seeds initial defaults if empty)
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const hasAccess = await checkDomainAccess(user, "domain.users", "read");
    if (!hasAccess) {
      return NextResponse.json({ success: false, message: "Permission denied." }, { status: 403 });
    }

    await connectToDatabase();
    const TemplateModel = (WarningTemplate as any).default || WarningTemplate;

    let templates = await TemplateModel.find({ isActive: true }).sort({ category: 1, severityLevel: 1 }).lean();

    if (templates.length === 0) {
      // Seed default templates
      await TemplateModel.insertMany(
        DEFAULT_WARNING_TEMPLATES.map((t) => ({
          ...t,
          createdByAdminId: user._id,
        }))
      );
      templates = await TemplateModel.find({ isActive: true }).sort({ category: 1, severityLevel: 1 }).lean();
    }

    return NextResponse.json({ success: true, count: templates.length, templates }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * POST /api/admin/warning-templates
 * Create a new standardized warning template
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
    const { title, category, message, severity_level } = body;

    if (!title || !message) {
      return NextResponse.json(
        { success: false, message: "Template title and message are required." },
        { status: 400 }
      );
    }

    const validCategories = ["terms_of_service", "spam", "inappropriate_content", "harassment", "general"];
    if (category && !validCategories.includes(category)) {
      return NextResponse.json(
        { success: false, message: `Invalid category. Must be one of: ${validCategories.join(", ")}` },
        { status: 400 }
      );
    }

    const validSeverities = ["low", "medium", "high"];
    if (severity_level && !validSeverities.includes(severity_level)) {
      return NextResponse.json(
        { success: false, message: `Invalid severity level. Must be one of: ${validSeverities.join(", ")}` },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const TemplateModel = (WarningTemplate as any).default || WarningTemplate;

    const newTemplate = await TemplateModel.create({
      title: String(title).trim(),
      category: category || "general",
      message: String(message).trim(),
      severityLevel: severity_level || "medium",
      createdByAdminId: user._id,
      isActive: true,
    });

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await recordAuditLog({
      eventType: "WARNING_TEMPLATE_CREATE",
      domain: "domain.users",
      severity: "info",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "WarningTemplate", entityId: String(newTemplate._id), label: newTemplate.title },
      actionSummary: `Admin ${user.email} created warning template: "${newTemplate.title}"`,
      changes: {
        after: {
          title: newTemplate.title,
          category: newTemplate.category,
          severityLevel: newTemplate.severityLevel,
        },
      },
    });

    return NextResponse.json({ success: true, template: newTemplate }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

