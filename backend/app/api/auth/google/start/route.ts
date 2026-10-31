import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleAuthorizationUrl,
  frontendOAuthRedirect,
  googleStateFromRequest,
  resolveGoogleConfig,
  setGoogleStateCookie,
} from "../../../../../lib/google-oauth";

export async function GET(request: NextRequest) {
  try {
    const config = resolveGoogleConfig();
    const state = googleStateFromRequest(request);
    const response = NextResponse.redirect(createGoogleAuthorizationUrl(config, state));
    setGoogleStateCookie(response, state);
    return response;
  } catch {
    return NextResponse.redirect(frontendOAuthRedirect("error", "google_configuration"));
  }
}
