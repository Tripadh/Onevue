import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "../../../../../lib/db";
import User from "../../../../../models/User";
import AuthAccount from "../../../../../models/AuthAccount";
import {
  clearGoogleStateCookie,
  frontendOAuthRedirect,
  getGoogleCallbackState,
  resolveGoogleConfig,
  exchangeGoogleCode,
  verifyGoogleIdToken,
} from "../../../../../lib/google-oauth";
import { createSession, issueSessionCookie } from "../../../../../lib/session";

export async function GET(request: NextRequest) {
  let response: NextResponse;
  let createdUserId: string | null = null;
  let callbackStage = "callback_validation";
  try {
    const error = request.nextUrl.searchParams.get("error");
    if (error) throw new Error("Google sign-in was cancelled.");
    const code = request.nextUrl.searchParams.get("code");
    const returnedState = request.nextUrl.searchParams.get("state");
    if (!code || !returnedState) throw new Error("Google callback is missing required parameters.");
    callbackStage = "state_validation";
    const state = getGoogleCallbackState(request);
    if (state.state !== returnedState) throw new Error("Invalid OAuth state.");
    callbackStage = "google_configuration";
    const config = resolveGoogleConfig();
    callbackStage = "google_code_exchange";
    const idToken = await exchangeGoogleCode(config, code, state.verifier);
    callbackStage = "google_identity_verification";
    const identity = await verifyGoogleIdToken(idToken, config, state.nonce);
    callbackStage = "database_connection";
    await connectToDatabase();

    callbackStage = "account_lookup";
    const existingAccount = await AuthAccount.findOne({ provider: "google", providerSubject: identity.subject });
    if (state.linkUserId) {
      callbackStage = "account_linking";
      if (existingAccount) throw new Error("Google account is already linked.");
      const owner = await User.findById(state.linkUserId);
      if (!owner) throw new Error("Authenticated account no longer exists.");
      await AuthAccount.create({
        userId: owner._id,
        provider: "google",
        providerSubject: identity.subject,
        providerEmail: identity.email,
        emailVerified: true,
      });
      response = NextResponse.redirect(frontendOAuthRedirect("success"));
      clearGoogleStateCookie(response);
      return response;
    }

    callbackStage = "account_lookup";
    let user = existingAccount ? await User.findById(existingAccount.userId) : null;
    if (!existingAccount) {
      const sameEmail = await User.findOne({ email: identity.email });
      if (sameEmail) {
        callbackStage = "account_conflict";
        throw new Error("An account already exists for this email. Sign in and explicitly link Google.");
      }
      callbackStage = "account_creation";
      user = await User.create({ email: identity.email, name: identity.name });
      createdUserId = String(user._id);
      callbackStage = "account_linking";
      await AuthAccount.create({
        userId: user._id,
        provider: "google",
        providerSubject: identity.subject,
        providerEmail: identity.email,
        emailVerified: true,
      });
    }
    if (!user) throw new Error("Google account owner no longer exists.");
    callbackStage = "session_creation";
    const session = await createSession(user, request);
    response = NextResponse.redirect(frontendOAuthRedirect("success"));
    issueSessionCookie(response, session.refreshToken, session.csrfToken);
    clearGoogleStateCookie(response);
    return response;
  } catch (error) {
    if (createdUserId) {
      try {
        await User.deleteOne({ _id: createdUserId });
      } catch {
        // Preserve the generic OAuth error response if cleanup is unavailable.
      }
    }
    if (callbackStage !== "callback_validation") {
      console.error(`[Google OAuth] callback failed at stage: ${callbackStage}`);
    }
    response = NextResponse.redirect(frontendOAuthRedirect("error", `google_callback_${callbackStage}`));
    clearGoogleStateCookie(response);
    return response;
  }
}
