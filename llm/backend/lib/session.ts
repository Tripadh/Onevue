import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "./db";
import { signJwtToken, verifyJwtToken, type AuthTokenPayload } from "./auth";
import AuthSession from "../models/AuthSession";

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_COOKIE = "onevue_refresh";
export const CSRF_COOKIE = "onevue_csrf";
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_RACE_WINDOW_MS = 5_000;
const COOKIE_DOMAIN =
  process.env.AUTH_COOKIE_DOMAIN ||
  (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" ? "localhost" : undefined);

export interface SessionUser {
  _id: unknown;
  email: string;
  identity?: string;
  onboarding?: { surveyCompleted?: boolean };
}

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  csrfToken?: string;
  sessionId: string;
}

export class SessionError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
    this.name = "SessionError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isRefreshRaceWindow(previousTokenHash: string | null | undefined, currentHash: string, rotatedAt: Date | null | undefined, now = Date.now()): boolean {
  return previousTokenHash === currentHash && now - (rotatedAt?.getTime() || 0) <= REFRESH_RACE_WINDOW_MS;
}

function requestIp(req?: Request): string {
  return req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
}

function setRefreshCookie(response: NextResponse, token: string, maxAge = REFRESH_TTL_MS): void {
  response.cookies.set(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: Math.floor(maxAge / 1000),
  });
}

function setCsrfCookie(response: NextResponse, token: string, maxAge = REFRESH_TTL_MS): void {
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    maxAge: Math.floor(maxAge / 1000),
  });
}

export function clearRefreshCookie(response: NextResponse): void {
  response.cookies.set(REFRESH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
  response.cookies.set(CSRF_COOKIE, "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
    maxAge: 0,
  });
  response.cookies.set(CSRF_COOKIE, "", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 0,
  });
}

export function issueSessionCookie(response: NextResponse, refreshToken: string, csrfToken?: string): void {
  setRefreshCookie(response, refreshToken);
  if (csrfToken) setCsrfCookie(response, csrfToken);
}

function accessPayload(user: SessionUser, sessionId: string): AuthTokenPayload {
  return {
    id: String(user._id),
    email: user.email,
    identity: user.identity,
    surveyCompleted: !!user.onboarding?.surveyCompleted,
    sid: sessionId,
  };
}

export async function createSession(user: SessionUser, req?: Request): Promise<SessionResult> {
  await connectToDatabase();
  const refreshToken = randomBytes(48).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const sessionId = randomUUID();
  const familyId = randomUUID();
  await AuthSession.create({
    userId: user._id,
    sessionId,
    familyId,
    tokenHash: hashToken(refreshToken),
    csrfTokenHash: hashToken(csrfToken),
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgentSummary: req?.headers.get("user-agent")?.slice(0, 300),
    ipHash: requestIp(req) ? hashToken(requestIp(req)) : undefined,
  });
  return {
    accessToken: signJwtToken(accessPayload(user, sessionId), { expiresIn: ACCESS_TOKEN_TTL }),
    refreshToken,
    csrfToken,
    sessionId,
  };
}

export async function authenticateAccessToken(token: string): Promise<AuthTokenPayload> {
  const payload = verifyJwtToken(token);
  if (!payload.sid) throw new SessionError("Invalid or expired session token.");
  await connectToDatabase();
  const session = await AuthSession.findOne({ sessionId: payload.sid, userId: payload.id, revokedAt: null });
  if (!session || session.expiresAt <= new Date()) throw new SessionError("Invalid or expired session token.");
  return payload;
}

export async function rotateRefreshToken(refreshToken: string): Promise<SessionResult> {
  if (!refreshToken) throw new SessionError("Invalid or expired refresh token.");
  await connectToDatabase();
  const currentHash = hashToken(refreshToken);
  const session = await AuthSession.findOne({ $or: [{ tokenHash: currentHash }, { previousTokenHash: currentHash }] });
  if (!session) throw new SessionError("Invalid or expired refresh token.");
  if (session.previousTokenHash === currentHash) {
    if (isRefreshRaceWindow(session.previousTokenHash, currentHash, session.previousTokenRotatedAt)) {
      throw new SessionError("Refresh token rotation already completed.");
    }
    await AuthSession.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "reuse-detected" } });
    throw new SessionError("Refresh token reuse detected.");
  }
  if (session.revokedAt || session.expiresAt <= new Date()) {
    await AuthSession.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "reuse-detected" } });
    throw new SessionError("Refresh token reuse detected.");
  }
  const nextRefreshToken = randomBytes(48).toString("base64url");
  const User = (await import("../models/User")).default;
  const user = await User.findById(session.userId);
  if (!user) throw new SessionError("Authenticated user no longer exists.");
  const rotated = await AuthSession.findOneAndUpdate(
    { _id: session._id, tokenHash: currentHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { previousTokenHash: currentHash, previousTokenRotatedAt: new Date(), tokenHash: hashToken(nextRefreshToken), lastUsedAt: new Date() } },
    { new: true }
  );
  if (!rotated) {
    const current = await AuthSession.findOne({ _id: session._id }).select("previousTokenHash previousTokenRotatedAt");
    if (
      isRefreshRaceWindow(current?.previousTokenHash, currentHash, current?.previousTokenRotatedAt)
    ) {
      throw new SessionError("Refresh token rotation already completed.");
    }
    await AuthSession.updateMany({ familyId: session.familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: "reuse-detected" } });
    throw new SessionError("Refresh token reuse detected.");
  }
  return {
    accessToken: signJwtToken(accessPayload(user, rotated.sessionId), { expiresIn: ACCESS_TOKEN_TTL }),
    refreshToken: nextRefreshToken,
    sessionId: rotated.sessionId,
  };
}

export async function revokeSession(sessionId: string, reason: "logout" | "password-changed" | "suspended" | "account-deleted" = "logout"): Promise<void> {
  await connectToDatabase();
  await AuthSession.updateOne({ sessionId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

export async function revokeAllSessions(userId: unknown, reason: "logout-all" | "password-changed" | "suspended" | "account-deleted"): Promise<void> {
  await connectToDatabase();
  await AuthSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

export function refreshTokenFromRequest(req: NextRequest): string {
  return req.cookies.get(REFRESH_COOKIE)?.value || "";
}

export async function validateCsrfRequest(req: NextRequest): Promise<boolean> {
  const refreshToken = refreshTokenFromRequest(req);
  const csrfToken = req.headers.get("x-csrf-token") || "";
  if (!refreshToken || !csrfToken) return false;
  await connectToDatabase();
  const session = await AuthSession.findOne({
    tokenHash: hashToken(refreshToken),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  }).select("csrfTokenHash");
  if (!session) return false;
  const actual = Buffer.from(session.csrfTokenHash);
  const expected = Buffer.from(hashToken(csrfToken));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
