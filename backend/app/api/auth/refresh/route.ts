import { NextRequest, NextResponse } from "next/server";
import { applyCorsHeaders, isTrustedStateChangingRequest, preflightResponse } from "../../../../lib/cors";
import { clearRefreshCookie, issueSessionCookie, refreshTokenFromRequest, rotateRefreshToken, SessionError, validateCsrfRequest } from "../../../../lib/session";

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
  try {
    const result = await rotateRefreshToken(refreshTokenFromRequest(req));
    const response = json(req, { token: result.accessToken }, { status: 200 });
    issueSessionCookie(response, result.refreshToken, result.csrfToken);
    return response;
  } catch (error) {
    const response = json(req, { message: error instanceof SessionError ? error.message : "Unable to refresh session." }, { status: 401 });
    clearRefreshCookie(response);
    return response;
  }
}
