import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "../../../../../../lib/auth";
import {
  createGoogleAuthorizationUrl,
  googleStateFromRequest,
  resolveGoogleConfig,
  setGoogleStateCookie,
} from "../../../../../../lib/google-oauth";

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if ("error" in auth) return NextResponse.json({ message: auth.error }, { status: auth.status });
  try {
    const config = resolveGoogleConfig();
    const state = googleStateFromRequest(request, String(auth.user._id));
    const response = NextResponse.json({ authorizationUrl: createGoogleAuthorizationUrl(config, state) });
    setGoogleStateCookie(response, state);
    return response;
  } catch {
    return NextResponse.json({ message: "Google account linking is not configured." }, { status: 503 });
  }
}
