import jwt from "jsonwebtoken";
import crypto from "crypto";
import { NextResponse } from "next/server";
import connectToDatabase from "./db";
import User, { IUser, UserRole } from "../models/User";
import RolePermission from "../models/RolePermission";
import AuditLog, { AuditSeverity } from "../models/AuditLog";
import AdminSession, { IAdminSession } from "../models/AdminSession";
import AdminDataAccessLog, { AdminDataAccessType } from "../models/AdminDataAccessLog";

export interface AdminJwtPayload {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isAdmin: boolean;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";
const SESSION_INACTIVITY_MS = 30 * 60 * 1000; // 30 minutes inactivity timeout

/**
 * Creates a persisted AdminSession with a rolling 30-minute expiry
 * and issues an admin-scoped JWT token containing the sessionId.
 */
export async function createAdminSession(params: {
  adminId: string;
  email: string;
  name: string;
  role: UserRole;
  ipAddress: string;
  userAgent?: string | null;
  deviceInfo?: Record<string, unknown>;
}): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  await connectToDatabase();
  const SessionModel = (AdminSession as any).default || AdminSession;

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_INACTIVITY_MS);

  const session = await SessionModel.create({
    adminId: params.adminId,
    sessionToken,
    ipAddress: params.ipAddress || "127.0.0.1",
    userAgent: params.userAgent || "unknown",
    deviceInfo: params.deviceInfo || {},
    lastActivityAt: new Date(),
    expiresAt,
    isActive: true,
  });

  const payload: AdminJwtPayload = {
    id: params.adminId,
    email: params.email,
    name: params.name,
    role: params.role,
    isAdmin: true,
    sessionId: String(session._id),
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
  return { token, sessionId: String(session._id), expiresAt };
}

/**
 * Revokes an active admin session.
 */
export async function revokeAdminSession(params: {
  sessionId: string;
  revokedByAdminId: string;
  reason?: string | null;
}): Promise<boolean> {
  await connectToDatabase();
  const SessionModel = (AdminSession as any).default || AdminSession;

  const session = await SessionModel.findById(params.sessionId);
  if (!session) return false;

  session.isActive = false;
  session.revokedAt = new Date();
  session.revokedByAdminId = params.revokedByAdminId;
  session.revokeReason = params.reason || "Revoked by administrator";
  await session.save();

  return true;
}

export interface AdminAuthResult {
  user?: any;
  payload?: AdminJwtPayload;
  session?: any;
  errorResponse?: NextResponse;
}

/**
 * Extracts and verifies the admin session from HTTP headers or cookies.
 * Enforces 30-minute inactivity auto-logout and session revocation.
 */
export async function verifyAdminAuth(req: Request): Promise<AdminAuthResult> {
  const authHeader = req.headers.get("authorization");
  let token: string | null = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.split(" ")[1];
  } else {
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(/onevue_admin_token=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    return {
      errorResponse: NextResponse.json(
        { success: false, message: "Admin authorization token required." },
        { status: 401 }
      ),
    };
  }

  let decoded: AdminJwtPayload;
  try {
    decoded = jwt.verify(token, JWT_SECRET) as AdminJwtPayload;
  } catch (err: unknown) {
    return {
      errorResponse: NextResponse.json(
        { success: false, message: "Invalid or expired admin session token." },
        { status: 401 }
      ),
    };
  }

  if (!decoded.isAdmin || (decoded.role !== "super_admin" && decoded.role !== "admin" && decoded.role !== "moderator")) {
    return {
      errorResponse: NextResponse.json(
        { success: false, message: "Access forbidden: strictly restricted to OneVue administrators." },
        { status: 403 }
      ),
    };
  }

  await connectToDatabase();
  const UserModel = (User as any).default || User;
  const user = await UserModel.findById(decoded.id);

  if (!user) {
    return {
      errorResponse: NextResponse.json(
        { success: false, message: "Admin account does not exist." },
        { status: 401 }
      ),
    };
  }

  if (user.status === "suspended") {
    return {
      errorResponse: NextResponse.json(
        { success: false, message: "Admin account has been suspended. Contact organization security." },
        { status: 403 }
      ),
    };
  }

  // Verify persistent AdminSession and enforce 30-minute inactivity timeout
  let dbSession: any = null;
  if (decoded.sessionId) {
    const SessionModel = (AdminSession as any).default || AdminSession;
    dbSession = await SessionModel.findById(decoded.sessionId);

    if (!dbSession || !dbSession.isActive) {
      return {
        errorResponse: NextResponse.json(
          { success: false, message: "Admin session has been revoked or terminated. Please sign in again." },
          { status: 401 }
        ),
      };
    }

    const now = new Date();
    if (new Date(dbSession.expiresAt) < now) {
      dbSession.isActive = false;
      await dbSession.save().catch(() => {});
      return {
        errorResponse: NextResponse.json(
          { success: false, message: "Admin session expired due to 30 minutes of inactivity. Please sign in again." },
          { status: 401 }
        ),
      };
    }

    // Rolling inactivity window: refresh expiresAt by 30 mins
    dbSession.lastActivityAt = now;
    dbSession.expiresAt = new Date(now.getTime() + SESSION_INACTIVITY_MS);
    dbSession.save().catch((err: any) => console.error("[SESSION ROLLING ERROR]", err));
  }

  return { user, payload: decoded, session: dbSession };
}

/**
 * Checks if a given admin user has permission for a specific domain and action.
 * Super Admin always has full access.
 */
export async function checkDomainAccess(
  user: any,
  domainKey: string,
  action: "read" | "write" | "create" | "delete" | "publish" | "manage"
): Promise<boolean> {
  if (user.role === "super_admin") return true;

  if (user.customPermissions && user.customPermissions[domainKey]) {
    const customActions = user.customPermissions[domainKey];
    if (customActions.includes("*") || customActions.includes("manage") || customActions.includes(action)) {
      return true;
    }
  }

  await connectToDatabase();
  const RoleModel = (RolePermission as any).default || RolePermission;
  const roleConfig = await RoleModel.findOne({ role: user.role });

  if (!roleConfig) return false;

  const domainPerm = roleConfig.permissions?.find((p: any) => p.domainKey === domainKey);
  if (!domainPerm) return false;

  return domainPerm.actions.includes("*") || domainPerm.actions.includes("manage") || domainPerm.actions.includes(action);
}

/**
 * Logs data access events (viewing, searching, exporting sensitive user data)
 * to maintain strict admin accountability and user privacy.
 */
export async function logDataAccess(params: {
  adminId: string;
  accessedUserId?: string | null;
  accessType: AdminDataAccessType;
  dataFieldsAccessed: string[];
  ipAddress: string;
  userAgent?: string | null;
  reason?: string | null;
}): Promise<void> {
  try {
    await connectToDatabase();
    const LogModel = (AdminDataAccessLog as any).default || AdminDataAccessLog;

    await LogModel.create({
      adminId: params.adminId,
      accessedUserId: params.accessedUserId || null,
      accessType: params.accessType,
      dataFieldsAccessed: params.dataFieldsAccessed || [],
      ipAddress: params.ipAddress || "127.0.0.1",
      userAgent: params.userAgent ? params.userAgent.slice(0, 150) : "unknown",
      reason: params.reason ? params.reason.slice(0, 300) : null,
      accessedAt: new Date(),
    });
  } catch (err) {
    console.error("[DATA ACCESS LOGGING ERROR]", err);
  }
}

/**
 * Helper to record high-signal security events with minimal payload to protect Free Tier DB storage.
 */
export async function recordAuditLog(params: {
  eventType: string;
  domain: string;
  severity?: AuditSeverity;
  status?: "SUCCESS" | "FAILURE";
  actor: {
    userId?: string | null;
    email: string;
    role: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  target?: {
    entityType: string;
    entityId?: string | null;
    label?: string | null;
  };
  actionSummary: string;
  changes?: {
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  };
}): Promise<void> {
  try {
    await connectToDatabase();
    const AuditModel = (AuditLog as any).default || AuditLog;

    const cleanChanges = params.changes
      ? {
          before: params.changes.before ? sanitizeLogData(params.changes.before) : null,
          after: params.changes.after ? sanitizeLogData(params.changes.after) : null,
        }
      : undefined;

    await AuditModel.create({
      timestamp: new Date(),
      eventType: params.eventType,
      domain: params.domain,
      severity: params.severity || "info",
      status: params.status || "SUCCESS",
      actor: {
        userId: params.actor.userId || null,
        email: params.actor.email,
        role: params.actor.role,
        ipAddress: params.actor.ipAddress || "unknown",
        userAgent: params.actor.userAgent ? params.actor.userAgent.slice(0, 150) : "unknown",
      },
      target: params.target || null,
      actionSummary: params.actionSummary.slice(0, 300),
      changes: cleanChanges,
    });
  } catch (err: unknown) {
    console.error("[AUDIT LOG ERROR]", err);
  }
}

function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.toLowerCase().includes("password") || k.toLowerCase().includes("secret") || k.toLowerCase().includes("token")) {
      result[k] = "[REDACTED]";
    } else if (typeof v === "string" && v.length > 200) {
      result[k] = v.slice(0, 200) + "...";
    } else {
      result[k] = v;
    }
  }
  return result;
}
