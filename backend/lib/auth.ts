import connectToDatabase from "./db";
import User from "../models/User";
import {
  MIN_JWT_SECRET_LENGTH,
  getJwtSecret,
  signJwtToken,
  verifyJwtToken as rawVerifyJwtToken,
} from "./jwt";

/* =========================================================================
   OneVue Authentication & Authorization Helper
   ========================================================================= */

export { MIN_JWT_SECRET_LENGTH, getJwtSecret, signJwtToken };

export function verifyJwtToken<T = { id: string; email: string; [key: string]: any }>(
  token: string,
  secretOverride?: string
): T {
  return rawVerifyJwtToken(token, secretOverride) as T;
}

export interface AuthSuccess {
  user: any;
}

export interface AuthFailure {
  error: string;
  status: number;
}

export type AuthResult = AuthSuccess | AuthFailure;

export async function verifyAuth(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      error: "Authentication required. Please provide a valid Bearer token.",
      status: 401,
    };
  }

  const token = authHeader.split(" ")[1];
  let decoded: { id: string; email: string };
  try {
    decoded = verifyJwtToken<{ id: string; email: string }>(token);
  } catch (err: any) {
    // Propagate configuration errors rather than masking as invalid client token
    if (err?.message?.includes("JWT_SECRET") || err?.message?.includes("JWT secret")) {
      throw err;
    }
    return { error: "Invalid or expired session token.", status: 401 };
  }

  await connectToDatabase();
  const UserModel = (User as any).default || User;
  const user = await UserModel.findById(decoded.id);
  if (!user) {
    return { error: "Authenticated user no longer exists.", status: 401 };
  }

  return { user };
}

/**
 * Verifies that the request is authenticated by a valid user possessing administrative role ('admin').
 *
 * Guarantees:
 * - Returns 401 Unauthorized for missing, invalid, or expired session tokens.
 * - Resolves the user identity strictly from the trusted database record (rejecting client-spoofed claims).
 * - Returns 403 Forbidden if the authenticated user lacks 'admin' role.
 * - Fails closed if user record is missing or role cannot be verified.
 * - Never logs bearer tokens, credentials, or signing keys.
 */
export async function verifyAdminAuth(req: Request): Promise<AuthResult> {
  const authResult = await verifyAuth(req);
  if ("error" in authResult) {
    return authResult;
  }

  const { user } = authResult;
  if (!user || user.role !== "admin") {
    return {
      error: "Forbidden: Administrative access required.",
      status: 403,
    };
  }

  return { user };
}
