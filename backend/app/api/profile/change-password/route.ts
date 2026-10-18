import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { verifyAuth } from "../../../../lib/auth";
import User from "../../../../models/User";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function POST(req: Request) {
  try {
    const authResult = await verifyAuth(req);
    if ("error" in authResult) {
      return NextResponse.json(
        { message: authResult.error },
        { status: authResult.status }
      );
    }

    const { user: authUser } = authResult;
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { message: "Invalid request payload." },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword, confirmPassword } = body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { message: "Please provide current password, new password, and confirmation." },
        { status: 400 }
      );
    }

    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return NextResponse.json(
        { message: "New password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { message: "New password and confirm password do not match." },
        { status: 400 }
      );
    }

    const UserModel = (User as any).default || User;
    const userWithPassword = await UserModel.findById(authUser._id).select("+password");

    if (!userWithPassword || !userWithPassword.password) {
      return NextResponse.json(
        { message: "User account credentials not found." },
        { status: 404 }
      );
    }

    const isMatch = await bcrypt.compare(
      currentPassword,
      userWithPassword.password
    );

    if (!isMatch) {
      return NextResponse.json(
        { message: "The current password you entered is incorrect." },
        { status: 400 }
      );
    }

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { message: "New password cannot be identical to the current password." },
        { status: 400 }
      );
    }

    const salt = await bcrypt.genSalt(10);
    userWithPassword.password = await bcrypt.hash(newPassword, salt);
    await userWithPassword.save();

    return NextResponse.json(
      { message: "Password updated successfully." },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
