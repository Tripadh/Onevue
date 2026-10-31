import * as jwtLib from "jsonwebtoken";
import type { SignOptions, VerifyOptions } from "jsonwebtoken";
import connectToDatabase from "./db";
import User from "../models/User";

/* =========================================================================
   OneVue Authentication & Authorization Helper
   ========================================================================= */

export class JwtConfigError extends Error {
  constructor() {
    super("JWT secret is not configured.");
    this.name = "JwtConfigError";
  }
}

const JWT_ALGORITHM = "HS256" as const;
const DEFAULT_JWT_ISSUER = "onevue-api";
const DEFAULT_JWT_AUDIENCE = "onevue-client";

export interface AuthTokenPayload {
  id: string;
  email: string;
  identity?: string;
  surveyCompleted?: boolean;
  sid?: string;
}

export interface JwtConfig {
  secret: string;
  issuer: string;
  audience: string;
}

export function isJwtConfigError(error: unknown): boolean {
  return error instanceof JwtConfigError || (error instanceof Error && error.name === "JwtConfigError");
}

export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (typeof secret === "string" && secret.length >= 32 && secret !== "fallback_secret" && !/^(.)\1+$/.test(secret)) {
    return secret;
  }
  throw new JwtConfigError();
}

export function resolveJwtConfig(): JwtConfig {
  const secret = resolveJwtSecret();
  const issuer = process.env.JWT_ISSUER || DEFAULT_JWT_ISSUER;
  const audience = process.env.JWT_AUDIENCE || DEFAULT_JWT_AUDIENCE;
  if (!issuer || !audience) {
    throw new JwtConfigError();
  }
  return { secret, issuer, audience };
}

export function validateJwtConfiguration(): void {
  resolveJwtConfig();
}

export function signJwtToken(payload: AuthTokenPayload, options: SignOptions = {}): string {
  const config = resolveJwtConfig();
  const signer = jwtLib.sign;
  return signer(payload, config.secret, {
    ...options,
    algorithm: JWT_ALGORITHM,
    issuer: config.issuer,
    audience: config.audience,
  });
}

export function verifyJwtToken(token: string, ...unsupported: [string?]): AuthTokenPayload {
  const pkg: any = jwtLib;
  const verifier =
    (pkg && typeof pkg.verify === "function" && pkg.verify) ||
    (pkg && pkg.default && typeof pkg.default.verify === "function" && pkg.default.verify) ||
    (typeof require === "function" && require("jsonwebtoken").verify);

  if (!verifier) {
    throw new Error("JWT verify function not found.");
  }
  if (unsupported.length > 0) throw new JwtConfigError();

  const config = resolveJwtConfig();
  const options: VerifyOptions = {
    algorithms: [JWT_ALGORITHM],
  };
  options.issuer = config.issuer;
  options.audience = config.audience;
  return verifier(token, config.secret, options) as AuthTokenPayload;
}

export async function verifySessionToken(token: string): Promise<AuthTokenPayload> {
  const decoded = verifyJwtToken(token);
  if (!decoded.sid) throw new Error("Session claim missing");
  await connectToDatabase();
  const { default: AuthSession } = await import("../models/AuthSession");
  const session = await AuthSession.findOne({ sessionId: decoded.sid, userId: decoded.id, revokedAt: null });
  if (!session || session.expiresAt <= new Date()) throw new Error("Session revoked");
  return decoded;
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
  try {
    resolveJwtConfig();
  } catch (error) {
    if (isJwtConfigError(error)) {
      return { error: "Server authentication is not configured.", status: 500 };
    }
    return { error: "Server authentication is not configured.", status: 500 };
  }

  let decoded: AuthTokenPayload;
  try {
    decoded = await verifySessionToken(token);
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
