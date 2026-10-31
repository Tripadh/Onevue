import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import User from "../../../../models/User";
import { verifyAuth } from "../../../../lib/auth";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function GET(req: Request) {
  try {
    const authResult = await verifyAuth(req);
    if ("error" in authResult) return json(req, { message: authResult.error }, { status: authResult.status });
    const user = authResult.user;

    return json(req,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity: user.identity,
          onboarding: user.onboarding || { surveyCompleted: false },
          createdAt: user.createdAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}
