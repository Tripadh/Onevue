import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import User from "@/models/User";
import WarningTemplate from "@/models/WarningTemplate";
import UserWarningHistory from "@/models/UserWarningHistory";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog, logDataAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * POST /api/admin/users/[userId]/warn
 * Issue an official policy or behavioral warning to a user
 */
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
    if (!userId) {
      return NextResponse.json({ success: false, message: "userId parameter is required." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { template_id, message, severity_level, is_anonymous } = body;

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const WarningModel = (UserWarningHistory as any).default || UserWarningHistory;
    const TemplateModel = (WarningTemplate as any).default || WarningTemplate;

    const targetUser = await UserModel.findById(userId).select("email role status");
    if (!targetUser) {
      return NextResponse.json({ success: false, message: "User not found." }, { status: 404 });
    }

    if (targetUser.role === "super_admin") {
      return NextResponse.json(
        { success: false, message: "Super Administrator accounts cannot be warned." },
        { status: 403 }
      );
    }

    let warningMessage = String(message || "").trim();
    let severity = severity_level || "medium";

    if (template_id) {
      const template = await TemplateModel.findById(template_id);
      if (template) {
        if (!warningMessage) warningMessage = template.message;
        if (!severity_level) severity = template.severityLevel;
      }
    }

    if (!warningMessage || warningMessage.length < 5) {
      return NextResponse.json(
        { success: false, message: "A clear warning message of at least 5 characters is required." },
        { status: 400 }
      );
    }

    const validSeverities = ["low", "medium", "high"];
    if (!validSeverities.includes(severity)) {
      severity = "medium";
    }

    const warning = await WarningModel.create({
      warnedUserId: targetUser._id,
      warningTemplateId: template_id || null,
      warningMessage,
      adminId: user._id,
      isAnonymous: is_anonymous !== false, // default true to protect admin identity from user retaliation
      severityLevel: severity,
      warnedAt: new Date(),
    });

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: userId,
      accessType: "send_warning",
      dataFieldsAccessed: ["email", "status"],
      ipAddress,
      userAgent,
      reason: `Issued ${severity}-level warning to user`,
    });

    await recordAuditLog({
      eventType: "USER_WARN",
      domain: "domain.users",
      severity: severity === "high" ? "critical" : "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "User", entityId: String(targetUser._id), label: targetUser.email },
      actionSummary: `Admin ${user.email} issued a ${severity}-severity warning to ${targetUser.email}`,
      changes: {
        after: {
          warningId: String(warning._id),
          severity,
          isAnonymous: warning.isAnonymous,
          warningMessage,
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `Warning issued successfully to ${targetUser.email}.`,
        warning: {
          id: warning._id,
          warnedUserId: warning.warnedUserId,
          severityLevel: warning.severityLevel,
          warnedAt: warning.warnedAt,
          isAnonymous: warning.isAnonymous,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

