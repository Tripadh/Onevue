import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import connectToDatabase from "../../../../lib/db";
import User, { IdentityType } from "../../../../models/User";
import { getProfilePhotoStorage } from "../../../../lib/storage";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(req: Request) {
  try {
    await connectToDatabase();
    
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { message: "Please provide both email and password" },
        { status: 400 }
      );
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return NextResponse.json(
        { message: "Invalid email or password" },
        { status: 401 }
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return NextResponse.json(
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

    const storage = getProfilePhotoStorage();
    const profilePhotoUrl = user.profilePhotoKey
      ? storage.resolveUrl(user.profilePhotoKey)
      : null;

    return NextResponse.json(
      {
        message: "Login successful",
        token,
        user: { 
          id: user._id, 
          name: user.name, 
          email: user.email,
          username: user.username || null,
          identity,
          bio: user.bio || "",
          location: user.location || "",
          profilePhotoKey: user.profilePhotoKey || null,
          profilePhotoUrl,
          profilePhotoUpdatedAt: user.profilePhotoUpdatedAt || null,
          onboarding: user.onboarding || { surveyCompleted: false },
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { message },
      { status: 500 }
    );
  }
}

