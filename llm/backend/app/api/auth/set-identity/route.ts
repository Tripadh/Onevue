import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import connectToDatabase from "../../../../lib/db";
import { ensureStudentProfile } from "../../../../lib/ensure-student-profile";
import User, { IdentityType } from "../../../../models/User";
import { verifySessionToken } from "../../../../lib/auth";
import { createSession, issueSessionCookie } from "../../../../lib/session";

const VALID_IDENTITIES: IdentityType[] = [
  "student",
  "professional",
  "freelancer",
  "creator",
  "business",
];

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json(req,
        { message: "Authentication required." },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    let decoded: { id: string; email: string };
    try {
      decoded = await verifySessionToken(token);
    } catch {
      return json(req,
        { message: "Invalid or expired session token." },
        { status: 401 }
      );
    }

    const { identity } = await req.json();

    if (!identity) {
      return json(req,
        { message: "Please select an identity type." },
        { status: 400 }
      );
    }

    const canonicalIdentity = String(identity).trim().toLowerCase() as IdentityType;

    if (!VALID_IDENTITIES.includes(canonicalIdentity)) {
      return json(req,
        {
          message: `Invalid identity type. Must be one of: ${VALID_IDENTITIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const user = await User.findById(decoded.id);

    if (!user) {
      return json(req,
        { message: "User not found." },
        { status: 404 }
      );
    }

    user.identity = canonicalIdentity;
    await user.save();

    if (canonicalIdentity === "student") {
      await ensureStudentProfile(user);
    }

    const session = await createSession(user, req);
    const response = json(req,
      {
        message: "Identity updated successfully",
        token: session.accessToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity: user.identity,
          onboarding: user.onboarding || { surveyCompleted: false },
        },
      },
      { status: 200 }
    );
    issueSessionCookie(response, session.refreshToken, session.csrfToken);
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}
