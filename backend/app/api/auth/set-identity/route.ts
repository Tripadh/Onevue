import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectToDatabase from "../../../../lib/db";
import User, { IdentityType } from "../../../../models/User";

const VALID_IDENTITIES: IdentityType[] = [
  "student",
  "professional",
  "freelancer",
  "creator",
  "business",
];

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json(
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
      return NextResponse.json(
        { message: "Invalid or expired session token." },
        { status: 401 }
      );
    }

    const { identity } = await req.json();

    if (!identity) {
      return NextResponse.json(
        { message: "Please select an identity type." },
        { status: 400 }
      );
    }

    const canonicalIdentity = String(identity).trim().toLowerCase() as IdentityType;

    if (!VALID_IDENTITIES.includes(canonicalIdentity)) {
      return NextResponse.json(
        {
          message: `Invalid identity type. Must be one of: ${VALID_IDENTITIES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const user = await User.findById(decoded.id);

    if (!user) {
      return NextResponse.json(
        { message: "User not found." },
        { status: 404 }
      );
    }

    user.identity = canonicalIdentity;
    await user.save();

    const newToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        identity: user.identity,
        surveyCompleted: !!user.onboarding?.surveyCompleted,
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "7d" }
    );

    return NextResponse.json(
      {
        message: "Identity updated successfully",
        token: newToken,
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
