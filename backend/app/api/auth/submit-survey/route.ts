import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import connectToDatabase from "../../../../lib/db";
import User, { DiscoverySourceType } from "../../../../models/User";

const ALLOWED_DISCOVERY_SOURCES: DiscoverySourceType[] = [
  "google_search",
  "instagram",
  "youtube",
  "linkedin",
  "facebook",
  "x_twitter",
  "reddit",
  "friend_family",
  "college_university",
  "online_advertisement",
  "blog_article",
  "developer_community",
  "other",
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
      decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "fallback_secret"
      ) as { id: string; email: string };
    } catch {
      return json(req,
        { message: "Invalid or expired session token." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { discoverySource, otherDetails } = body;

    if (!discoverySource) {
      return json(req,
        { message: "Please select how you discovered OneVue." },
        { status: 400 }
      );
    }

    const canonicalSource = String(discoverySource).trim().toLowerCase() as DiscoverySourceType;

    if (!ALLOWED_DISCOVERY_SOURCES.includes(canonicalSource)) {
      return json(req,
        {
          message: `Invalid discovery source. Must be one of the supported options.`,
        },
        { status: 400 }
      );
    }

    let trimmedOther: string | null = null;
    if (canonicalSource === "other") {
      const details = String(otherDetails || "").trim();
      if (!details) {
        return json(req,
          { message: "Please specify where you discovered OneVue." },
          { status: 400 }
        );
      }
      if (details.length > 500) {
        return json(req,
          { message: "Additional details cannot exceed 500 characters." },
          { status: 400 }
        );
      }
      trimmedOther = details;
    }

    await connectToDatabase();
    const user = await User.findById(decoded.id);

    if (!user) {
      return json(req,
        { message: "User not found." },
        { status: 404 }
      );
    }

    const completedAt = new Date();

    const updatedUser = await User.findByIdAndUpdate(
      decoded.id,
      {
        $set: {
          onboarding: {
            surveyCompleted: true,
            survey: {
              discoverySource: canonicalSource,
              otherDetails: trimmedOther,
              completedAt,
            },
          },
        },
      },
      { new: true }
    );

    if (!updatedUser) {
      return json(req,
        { message: "Failed to update user survey." },
        { status: 500 }
      );
    }

    const newToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        identity: user.identity,
        surveyCompleted: true,
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "7d" }
    );

    return json(req,
      {
        message: "Survey response saved successfully",
        token: newToken,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity: user.identity,
          onboarding: {
            surveyCompleted: true,
            survey: {
              discoverySource: canonicalSource,
              otherDetails: trimmedOther,
              completedAt,
            },
          },
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}
