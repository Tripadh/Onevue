import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import connectToDatabase from "../../../../lib/db";
import { ensureStudentProfile } from "../../../../lib/ensure-student-profile";
import User, { IdentityType } from "../../../../models/User";

const VALID_IDENTITIES: IdentityType[] = [
  "student",
  "professional",
  "freelancer",
  "creator",
  "business",
];

function json(req: Request, body: unknown, init: { status: number }) {
  return applyCorsHeaders(
    NextResponse.json(body, init),
    req.headers.get("origin")
  );
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export async function POST(req: Request) {
  try {
    const { name, email, password, identity } = await req.json();

    if (!name || !email || !password) {
      return json(req,
        { message: "Please provide all required fields (name, email, password)" },
        { status: 400 }
      );
    }

    let canonicalIdentity: IdentityType | undefined;
    if (identity) {
      const parsed = String(identity).trim().toLowerCase() as IdentityType;
      if (!VALID_IDENTITIES.includes(parsed)) {
        return json(req,
          {
            message: `Invalid identity type. Must be one of: ${VALID_IDENTITIES.join(", ")}`
          },
          { status: 400 }
        );
      }
      canonicalIdentity = parsed;
    }

    await connectToDatabase();

    const existingUser = await User.findOne({ email });


    if (existingUser) {
      return json(req,
        { message: "User already exists" },
        { status: 400 }
      );
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      identity: canonicalIdentity,
    });

    if (canonicalIdentity === "student") {
      await ensureStudentProfile(newUser);
    }

    const token = jwt.sign(
      {
        id: newUser._id,
        email: newUser.email,
        identity: newUser.identity,
        surveyCompleted: false,
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "7d" }
    );

    return json(req,
      {
        message: "User created successfully",
        token,
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          identity: newUser.identity,
          onboarding: { surveyCompleted: false, survey: null },
        }
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req,
      { message },
      { status: 500 }
    );
  }
}
