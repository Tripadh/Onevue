import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import connectToDatabase from "../../../../lib/db";
import User, { IdentityType } from "../../../../models/User";

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

export async function GET(
  req: Request,
  context: { params: Promise<{ role: string }> }
) {
  try {
    const { role } = await context.params;
    const requestedRole = (role || "").toLowerCase() as IdentityType;

    if (!VALID_IDENTITIES.includes(requestedRole)) {
      return json(req,
        { message: `Invalid dashboard identity: ${role}` },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json(req,
        { message: "Authentication required. Please provide a valid Bearer token." },
        { status: 401 }
      );
    }

    const token = authHeader.split(" ")[1];
    let decoded: { id: string; email: string; identity?: string };
    try {
      decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "fallback_secret"
      ) as { id: string; email: string; identity?: string };
    } catch {
      return json(req,
        { message: "Invalid or expired session token." },
        { status: 401 }
      );
    }

    await connectToDatabase();
    const user = await User.findById(decoded.id);

    if (!user) {
      return json(req,
        { message: "Authenticated user no longer exists." },
        { status: 401 }
      );
    }

    const userRole = (user.identity || "professional").toLowerCase();

    // Enforce role-based authorization: user can only access their own role dashboard
    if (userRole !== requestedRole) {
      return json(req,
        {
          message: `Access denied. Your identity is '${userRole}', but this dashboard is reserved for '${requestedRole}'.`,
          requiredRole: requestedRole,
          userRole,
        },
        { status: 403 }
      );
    }

    // Role-specific baseline configuration
    const roleBaselines: Record<IdentityType, { title: string; defaultAudience: string; checklistCount: number }> = {
      student: { title: "Student Dashboard", defaultAudience: "college", checklistCount: 5 },
      professional: { title: "Professional Dashboard", defaultAudience: "recruiter", checklistCount: 5 },
      freelancer: { title: "Freelancer Dashboard", defaultAudience: "client", checklistCount: 5 },
      creator: { title: "Creator Dashboard", defaultAudience: "media", checklistCount: 5 },
      business: { title: "Business Dashboard", defaultAudience: "partner", checklistCount: 5 },
    };

    return json(req,
      {
        authorized: true,
        role: requestedRole,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity: userRole,
        },
        baseline: roleBaselines[requestedRole],
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}
