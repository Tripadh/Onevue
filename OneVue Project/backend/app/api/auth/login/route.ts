import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import connectToDatabase from "../../../../lib/db";
import User, { IdentityType } from "../../../../models/User";

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
    const { email, password } = await req.json();

    if (!email || !password) {
      return json(req,
        { message: "Please provide both email and password" },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return json(req,
        { message: "Invalid email or password" },
        { status: 401 }
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return json(req,
        { message: "Invalid email or password" },
        { status: 401 }
      );
    }

    const identity: IdentityType | undefined = user.identity;
    const surveyCompleted = !!user.onboarding?.surveyCompleted;

    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        identity,
        surveyCompleted,
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "7d" }
    );

    return json(req,
      {
        message: "Login successful",
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity,
          onboarding: user.onboarding || { surveyCompleted: false },
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req,
      { message },
      { status: 500 }
    );
  }
}
