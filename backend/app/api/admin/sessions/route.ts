import { NextResponse } from "next/server";
import connectToDatabase from "../../../../lib/db";
import AdminSession from "../../../../models/AdminSession";
import { verifyAdminAuth, revokeAdminSession, recordAuditLog } from "../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/sessions
 * List active sessions for the current admin (or all active sessions if super_admin)
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user, payload } = auth;

    await connectToDatabase();
    const SessionModel = (AdminSession as any).default || AdminSession;

    const query: Record<string, any> = {
      isActive: true,
      expiresAt: { $gt: new Date() },
    };

    // If not super_admin, only view own sessions
    if (user.role !== "super_admin") {
      query.adminId = user._id;
    }

    const sessions = await SessionModel.find(query)
      .populate("adminId", "name email role")
      .sort({ lastActivityAt: -1 })
      .limit(50)
      .lean();

    return NextResponse.json(
      {
        success: true,
        currentSessionId: payload?.sessionId || null,
        count: sessions.length,
        sessions: sessions.map((s: any) => ({
          id: s._id,
          adminId: s.adminId?._id || s.adminId,
          adminEmail: s.adminId?.email || "Unknown",
          adminName: s.adminId?.name || "Unknown",
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          deviceInfo: s.deviceInfo,
          lastActivityAt: s.lastActivityAt,
          expiresAt: s.expiresAt,
          isCurrent: String(s._id) === String(payload?.sessionId),
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
 * POST /api/admin/sessions
 * Revokes a session
 * Body: { sessionId: string, reason?: string }
 */
export async function POST(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    const body = await req.json().catch(() => ({}));
    const { sessionId, reason } = body;

    if (!sessionId) {
      return NextResponse.json(
        { success: false, message: "sessionId is required." },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const SessionModel = (AdminSession as any).default || AdminSession;
    const targetSession = await SessionModel.findById(sessionId);

    if (!targetSession) {
      return NextResponse.json(
        { success: false, message: "Session not found." },
        { status: 404 }
      );
    }

    // Admins can only revoke their own sessions unless super_admin
    if (user.role !== "super_admin" && String(targetSession.adminId) !== String(user._id)) {
      return NextResponse.json(
        { success: false, message: "Permission denied: you can only revoke your own sessions." },
        { status: 403 }
      );
    }

    await revokeAdminSession({
      sessionId,
      revokedByAdminId: String(user._id),
      reason: reason || "Terminated by administrator",
    });

    await recordAuditLog({
      eventType: "ADMIN_SESSION_REVOKED",
      domain: "domain.security_rbac",
      severity: "warning",
      actor: { userId: String(user._id), email: user.email, role: user.role },
      target: { entityType: "AdminSession", entityId: sessionId, label: `Session ${sessionId}` },
      actionSummary: `Admin ${user.email} revoked session ${sessionId}`,
    });

    return NextResponse.json(
      { success: true, message: "Session successfully revoked." },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

