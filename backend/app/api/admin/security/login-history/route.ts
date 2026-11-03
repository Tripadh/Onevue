import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../lib/db";
import AdminLoginAttempt from "../../../../../models/AdminLoginAttempt";
import { verifyAdminAuth } from "../../../../../lib/admin-auth";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/**
 * GET /api/admin/security/login-history
 * View recent admin login attempts
 */
export async function GET(req: Request) {
  try {
    const auth = await verifyAdminAuth(req);
    if (auth.errorResponse) return auth.errorResponse;
    const { user } = auth;

    await connectToDatabase();
    const AttemptModel = (AdminLoginAttempt as any).default || AdminLoginAttempt;

    const query: Record<string, any> = {};
    if (user.role !== "super_admin") {
      query.email = user.email.toLowerCase();
    }

    const attempts = await AttemptModel.find(query)
      .sort({ attemptedAt: -1 })
      .limit(100)
      .lean();

    return NextResponse.json(
      {
        success: true,
        count: attempts.length,
        attempts: attempts.map((a: any) => ({
          id: a._id,
          email: a.email,
          ipAddress: a.ipAddress,
          userAgent: a.userAgent,
          success: a.success,
          failureReason: a.failureReason,
          twoFaVerified: a.twoFaVerified,
          attemptedAt: a.attemptedAt,
        })),
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

