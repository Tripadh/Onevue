import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import connectToDatabase from "../../../../lib/db";
import { verifyJwtToken } from "../../../../lib/auth";
import User from "../../../../models/User";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function GET(req: Request) {
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
      decoded = verifyJwtToken<{ id: string; email: string }>(token);
    } catch (err: any) {
      if (err?.message?.includes("JWT_SECRET") || err?.message?.includes("JWT secret")) {
        throw err;
      }
      return json(req,
        { message: "Invalid or expired session token." },
        { status: 401 }
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

    return json(req,
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity: user.identity || "professional",
          role: user.role,
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
