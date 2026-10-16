import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectToDatabase from "../../../../lib/db";
import User from "../../../../models/User";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(req: Request) {
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

    await connectToDatabase();
    const user = await User.findById(decoded.id);

    if (!user) {
      return NextResponse.json(
        { message: "User not found." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          identity: user.identity || "professional",
          onboarding: user.onboarding || { surveyCompleted: false },
          createdAt: user.createdAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
