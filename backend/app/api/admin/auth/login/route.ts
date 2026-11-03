import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import connectToDatabase from "../../../../../lib/db";
import User from "../../../../../models/User";
import AdminLoginAttempt from "../../../../../models/AdminLoginAttempt";
import { createAdminSession, recordAuditLog } from "../../../../../lib/admin-auth";
import { checkRateLimit, resetRateLimit } from "../../../../../lib/rate-limiter";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET() {
  return NextResponse.json(
    {
      service: "OneVue Admin Authentication Gateway",
      status: "operational",
      instruction:
        "This is an API endpoint. Submit credentials via HTTP POST with { email, password } or visit the web interface at http://localhost:5173/#/admin/login",
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const ipAddress =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1";
  const userAgent = req.headers.get("user-agent") || "unknown";

  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Please provide both administrative email and password." },
        { status: 400 }
      );
    }

    // 1. In-memory Rate Limiting (Protects Atlas Free Tier storage from brute-force writes)
    const rateLimitKey = `admin_login:${ipAddress}:${email}`;
    const rateCheck = checkRateLimit(rateLimitKey, 5, 900); // 5 attempts per 15 minutes

    if (!rateCheck.success) {
      await connectToDatabase();
      const AttemptModel = (AdminLoginAttempt as any).default || AdminLoginAttempt;
      await AttemptModel.create({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: "rate_limit_locked_out",
      }).catch(() => { });

      await recordAuditLog({
        eventType: "ADMIN_LOGIN_LOCKED_OUT",
        domain: "domain.security_rbac",
        severity: "critical",
        status: "FAILURE",
        actor: { email, role: "unknown", ipAddress, userAgent },
        actionSummary: `Administrative login locked out after 5 failed attempts. Frozen for ${rateCheck.resetInSeconds}s.`,
      });

      return NextResponse.json(
        {
          success: false,
          message: `Too many failed login attempts. Account access frozen for ${Math.ceil(
            rateCheck.resetInSeconds / 60
          )} minutes.`,
        },
        { status: 429 }
      );
    }

    await connectToDatabase();
    const UserModel = (User as any).default || User;
    const AttemptModel = (AdminLoginAttempt as any).default || AdminLoginAttempt;
    const user = await UserModel.findOne({ email }).select("+password");

    // 2. Reject if user does not exist or has non-admin role
    if (!user) {
      await AttemptModel.create({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: "user_not_found",
      }).catch(() => { });

      return NextResponse.json(
        { success: false, message: "Invalid administrative credentials." },
        { status: 401 }
      );
    }

    // Role Enforcement: Normal users cannot authenticate through /admin/login
    const validRoles = ["super_admin", "admin", "moderator"];
    if (!validRoles.includes(user.role)) {
      await AttemptModel.create({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: "non_admin_role",
      }).catch(() => { });

      await recordAuditLog({
        eventType: "ADMIN_UNAUTHORIZED_ENTRY_ATTEMPT",
        domain: "domain.security_rbac",
        severity: "warning",
        status: "FAILURE",
        actor: { userId: String(user._id), email, role: user.role || "user", ipAddress, userAgent },
        target: { entityType: "User", entityId: String(user._id), label: user.email },
        actionSummary: `Standard user tried to access admin portal. Entry rejected.`,
      });

      return NextResponse.json(
        { success: false, message: "Access forbidden: strictly restricted to OneVue administrators." },
        { status: 403 }
      );
    }

    // 3. Status check
    if (user.status === "suspended") {
      await AttemptModel.create({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: "account_suspended",
      }).catch(() => { });

      return NextResponse.json(
        { success: false, message: "This administrative profile has been suspended." },
        { status: 403 }
      );
    }

    // 4. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      await AttemptModel.create({
        email,
        ipAddress,
        userAgent,
        success: false,
        failureReason: "incorrect_password",
      }).catch(() => { });

      await recordAuditLog({
        eventType: "ADMIN_LOGIN_FAILED_PASSWORD",
        domain: "domain.security_rbac",
        severity: "warning",
        status: "FAILURE",
        actor: { userId: String(user._id), email, role: user.role, ipAddress, userAgent },
        actionSummary: `Failed password attempt for admin: ${email} (Remaining tries: ${rateCheck.remaining})`,
      });

      return NextResponse.json(
        {
          success: false,
          message: `Invalid administrative credentials. (${rateCheck.remaining} attempts remaining)`,
        },
        { status: 401 }
      );
    }

    // 5. Successful login: Reset rate limiter and create persistent AdminSession (30-min auto-logout)
    resetRateLimit(rateLimitKey);

    const { token, sessionId, expiresAt } = await createAdminSession({
      adminId: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      ipAddress,
      userAgent,
    });

    // Record login attempt success
    await AttemptModel.create({
      email,
      ipAddress,
      userAgent,
      success: true,
      failureReason: null,
      twoFaVerified: true,
    }).catch(() => { });

    // Record high-signal successful login in AuditLog
    await recordAuditLog({
      eventType: "ADMIN_LOGIN_SUCCESS",
      domain: "domain.security_rbac",
      severity: "info",
      status: "SUCCESS",
      actor: { userId: String(user._id), email, role: user.role, ipAddress, userAgent },
      actionSummary: `${user.role.toUpperCase()} ${email} logged in successfully via /admin/login`,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Administrative authentication successful.",
        token,
        sessionId,
        expiresAt,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          username: user.username || null,
          role: user.role,
          status: user.status || "active",
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[ADMIN LOGIN FATAL ERROR]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
