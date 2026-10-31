import { NextRequest, NextResponse } from "next/server";
import { applyCorsHeaders, isTrustedStateChangingRequest, preflightResponse } from "../../../../lib/cors";
import { clearRefreshCookie, refreshTokenFromRequest, revokeSession, validateCsrfRequest } from "../../../../lib/session";
import { verifyJwtToken } from "../../../../lib/auth";

function json(req: NextRequest, body: unknown, init: { status: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: NextRequest) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: NextRequest) {
  if (!isTrustedStateChangingRequest(req.headers.get("origin"))) {
    return json(req, { message: "Origin is not allowed." }, { status: 403 });
  }
  if (!(await validateCsrfRequest(req))) {
    return json(req, { message: "Invalid CSRF token." }, { status: 403 });
  }
  const authorization = req.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (token) {
    try {
      const payload = verifyJwtToken(token);
      if (payload.sid) await revokeSession(payload.sid);
    } catch {
      // Logout is intentionally idempotent; the refresh cookie is still cleared.
    }
  }
  const response = json(req, { message: "Logged out successfully." }, { status: 200 });
  clearRefreshCookie(response);
  return response;
}
