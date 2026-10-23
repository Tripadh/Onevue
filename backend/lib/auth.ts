import * as jwtLib from "jsonwebtoken";
import connectToDatabase from "./db";
import User from "../models/User";

/* =========================================================================
   OneVue Authentication & Authorization Helper
   ========================================================================= */

export class JwtConfigError extends Error {
  readonly status = 500;

  constructor() {
    super("Server authentication is not configured.");
    this.name = "JwtConfigError";
  }
}

export function isJwtConfigError(error: unknown): error is JwtConfigError {
  return error instanceof JwtConfigError || (error instanceof Error && error.name === "JwtConfigError");
}

const INSECURE_JWT_FALLBACK = "fallback_secret";

/**
 * Production refuses a missing secret and the insecure fallback value.
 * Local development and tests may omit JWT_SECRET; those processes set it
 * explicitly when they need a stable signing key.
 */
export function resolveJwtSecret(): string {
  const secret = (process.env.JWT_SECRET || "").trim();
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret === INSECURE_JWT_FALLBACK) {
      throw new JwtConfigError();
    }
    return secret;
  }
  return secret || INSECURE_JWT_FALLBACK;
}

export function verifyJwtToken(token: string, secret: string): { id: string; email: string } {
  const pkg: any = jwtLib;
  const verifier =
    (pkg && typeof pkg.verify === "function" && pkg.verify) ||
    (pkg && pkg.default && typeof pkg.default.verify === "function" && pkg.default.verify) ||
    (typeof require === "function" && require("jsonwebtoken").verify);

  if (!verifier) {
    throw new Error("JWT verify function not found.");
  }
  return verifier(token, secret) as { id: string; email: string };
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
  let secret: string;
  try {
    secret = resolveJwtSecret();
  } catch (error) {
    if (isJwtConfigError(error)) {
      return { error: "Server authentication is not configured.", status: 500 };
    }
    return { error: "Server authentication is not configured.", status: 500 };
  }

  let decoded: { id: string; email: string };
  try {
    decoded = verifyJwtToken(token, secret);
  } catch {
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
