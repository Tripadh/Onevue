import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
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
    await connectToDatabase();

    const { name, email, password, identity } = await req.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { message: "Please provide all required fields (name, email, password)" },
        { status: 400 }
      );
    }

    let canonicalIdentity: IdentityType | undefined;
    if (identity) {
      const parsed = String(identity).trim().toLowerCase() as IdentityType;
      if (!VALID_IDENTITIES.includes(parsed)) {
        return NextResponse.json(
          {
            message: `Invalid identity type. Must be one of: ${VALID_IDENTITIES.join(", ")}`
          },
          { status: 400 }
        );
      }
      canonicalIdentity = parsed;
    }

    const existingUser = await User.findOne({ email });


    if (existingUser) {
      return NextResponse.json(
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

    return NextResponse.json(
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
    return NextResponse.json(
      { message },
      { status: 500 }
    );
  }
}
