import { NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import ComplianceRequest from "@/models/ComplianceRequest";
import User from "@/models/User";
import { verifyAdminAuth, checkDomainAccess, recordAuditLog, logDataAccess } from "@/lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/compliance/requests
 * List compliance requests with status/type filtering and pagination
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

    const { searchParams } = new URL(req.url);
    const typeParam = searchParams.get("type");
    const statusParam = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const query: any = {};
    if (typeParam && typeParam !== "all") query.requestType = typeParam;
    if (statusParam && statusParam !== "all") query.requestStatus = statusParam;

    await connectToDatabase();
    const ComplianceModel = (ComplianceRequest as any).default || ComplianceRequest;

    const [requests, total, pendingCount] = await Promise.all([
      ComplianceModel.find(query)
        .populate("userId", "name email username status")
        .populate("processedByAdminId", "name email")
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ComplianceModel.countDocuments(query),
      ComplianceModel.countDocuments({ requestStatus: "pending" }),
    ]);

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await logDataAccess({
      adminId: String(user._id),
      accessedUserId: "compliance_registry",
      accessType: "view",
      dataFieldsAccessed: ["compliance_requests", "gdpr_requests", "right_to_access"],
      ipAddress,
      userAgent,
      reason: "Inspect compliance and GDPR requests queue",
    });

    return NextResponse.json(
      {
        success: true,
        total,
        page,
        limit,
        pending_count: pendingCount,
        requests: requests.map((r: any) => ({
          id: r._id,
          request_type: r.requestType,
          status: r.requestStatus,
          user: r.userId
            ? {
                id: r.userId._id,
                name: r.userId.name,
                email: r.userId.email,
                username: r.userId.username,
                status: r.userId.status,
              }
            : null,
          requested_at: r.requestedAt,
          processed_by: r.processedByAdminId
            ? {
                name: r.processedByAdminId.name,
                email: r.processedByAdminId.email,
              }
            : null,
          processed_at: r.processedAt,
          completion_date: r.completionDate,
          scheduled_deletion_date: r.scheduledDeletionDate,
          notes: r.notes,
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * POST /api/admin/compliance/requests
 * Create a new compliance request (GDPR deletion or Right-to-Access)
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
    const { user_id, request_type, notes, retention_period_days } = body;

    if (!user_id || !request_type) {
      return NextResponse.json(
        { success: false, message: "user_id and request_type are required." },
        { status: 400 }
      );
    }

    if (request_type !== "gdpr_deletion" && request_type !== "right_to_access") {
      return NextResponse.json(
        { success: false, message: "request_type must be 'gdpr_deletion' or 'right_to_access'." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const ComplianceModel = (ComplianceRequest as any).default || ComplianceRequest;

    const targetUser = await UserModel.findById(user_id);
    if (!targetUser) {
      return NextResponse.json({ success: false, message: "Target user not found." }, { status: 404 });
    }

    if (targetUser.role === "super_admin") {
      return NextResponse.json(
        { success: false, message: "Compliance requests cannot be filed on Super Administrator accounts." },
        { status: 403 }
      );
    }

    const retentionDays = parseInt(retention_period_days || "30", 10);
    const scheduledDeletionDate =
      request_type === "gdpr_deletion"
        ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
        : null;

    const newRequest = await ComplianceModel.create({
      requestType: request_type,
      userId: targetUser._id,
      requestStatus: "pending",
      requestedAt: new Date(),
      retentionPeriodDays: retentionDays,
      scheduledDeletionDate,
      notes: notes ? String(notes).trim() : null,
    });

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "unknown";

    await recordAuditLog({
      eventType: "COMPLIANCE_REQUEST_CREATE",
      domain: "domain.users",
      severity: "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role, ipAddress, userAgent },
      target: { entityType: "User", entityId: String(targetUser._id), label: targetUser.email },
      actionSummary: `Admin ${user.email} initiated ${request_type} compliance request for ${targetUser.email}`,
      changes: {
        after: {
          requestId: String(newRequest._id),
          requestType: request_type,
          scheduledDeletionDate,
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: `${request_type} request logged successfully.`,
        request: newRequest,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

