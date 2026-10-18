import { NextResponse } from "next/server";
import { verifyAuth } from "../../../lib/auth";
import User from "../../../models/User";
import { getProfilePhotoStorage } from "../../../lib/storage";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(req: Request) {
  try {
    const authResult = await verifyAuth(req);
    if ("error" in authResult) {
      return NextResponse.json(
        { message: authResult.error },
        { status: authResult.status }
      );
    }

    const { user } = authResult;
    const storage = getProfilePhotoStorage();

    const profilePhotoUrl = user.profilePhotoKey
      ? storage.resolveUrl(user.profilePhotoKey)
      : null;

    return NextResponse.json(
      {
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          username: user.username || null,
          identity: user.identity || "student",
          bio: user.bio || "",
          location: user.location || "",
          profilePhotoKey: user.profilePhotoKey || null,
          profilePhotoUrl,
          profilePhotoUpdatedAt: user.profilePhotoUpdatedAt || null,
          isEmailVerified: true,
          surveyCompleted: !!user.onboarding?.surveyCompleted,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, private",
        },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const authResult = await verifyAuth(req);
    if ("error" in authResult) {
      return NextResponse.json(
        { message: authResult.error },
        { status: authResult.status }
      );
    }

    const { user } = authResult;
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { message: "Invalid request payload. Expected a JSON object." },
        { status: 400 }
      );
    }

    // 1. Validate 'name'
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return NextResponse.json(
          { message: "Display name cannot be empty." },
          { status: 400 }
        );
      }
      if (body.name.trim().length > 100) {
        return NextResponse.json(
          { message: "Display name cannot exceed 100 characters." },
          { status: 400 }
        );
      }
      user.name = body.name.trim();
    }

    // 2. Validate 'username'
    if (body.username !== undefined) {
      if (body.username === null || body.username === "") {
        user.username = null;
      } else if (typeof body.username === "string") {
        const rawUsername = body.username.trim().toLowerCase();
        
        // Username constraints: 3-30 chars, lowercase letters, numbers, dot, dash, underscore
        if (rawUsername.length < 3 || rawUsername.length > 30) {
          return NextResponse.json(
            { message: "Username must be between 3 and 30 characters long." },
            { status: 400 }
          );
        }

        if (!/^[a-z0-9]/.test(rawUsername)) {
          return NextResponse.json(
            { message: "Username must begin with a letter or number." },
            { status: 400 }
          );
        }

        if (!/[a-z0-9]$/.test(rawUsername)) {
          return NextResponse.json(
            { message: "Username cannot end with a symbol." },
            { status: 400 }
          );
        }

        if (!/^[a-z0-9._-]+$/.test(rawUsername)) {
          return NextResponse.json(
            { message: "Username can only contain letters, numbers, dots, hyphens, and underscores." },
            { status: 400 }
          );
        }

        if (/[._-]{2,}/.test(rawUsername)) {
          return NextResponse.json(
            { message: "Username cannot contain consecutive symbols." },
            { status: 400 }
          );
        }

        // Check uniqueness against other users
        const UserModel = (User as any).default || User;
        const existing = await UserModel.findOne({
          username: rawUsername,
          _id: { $ne: user._id },
        });

        if (existing) {
          return NextResponse.json(
            { message: `Username '${rawUsername}' is already claimed by another user.` },
            { status: 409 }
          );
        }

        user.username = rawUsername;
      } else {
        return NextResponse.json(
          { message: "Username must be a string." },
          { status: 400 }
        );
      }
    }

    // 3. Validate 'bio'
    if (body.bio !== undefined) {
      if (body.bio === null || body.bio === "") {
        user.bio = null;
      } else if (typeof body.bio === "string") {
        if (body.bio.trim().length > 500) {
          return NextResponse.json(
            { message: "Bio cannot exceed 500 characters." },
            { status: 400 }
          );
        }
        user.bio = body.bio.trim();
      } else {
        return NextResponse.json(
          { message: "Bio must be a string." },
          { status: 400 }
        );
      }
    }

    // 4. Validate 'location'
    if (body.location !== undefined) {
      if (body.location === null || body.location === "") {
        user.location = null;
      } else if (typeof body.location === "string") {
        if (body.location.trim().length > 100) {
          return NextResponse.json(
            { message: "Location cannot exceed 100 characters." },
            { status: 400 }
          );
        }
        user.location = body.location.trim();
      } else {
        return NextResponse.json(
          { message: "Location must be a string." },
          { status: 400 }
        );
      }
    }

    // Persist changes
    await user.save();

    const storage = getProfilePhotoStorage();
    const profilePhotoUrl = user.profilePhotoKey
      ? storage.resolveUrl(user.profilePhotoKey)
      : null;

    return NextResponse.json(
      {
        message: "Profile updated successfully.",
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          username: user.username || null,
          identity: user.identity || "student",
          bio: user.bio || "",
          location: user.location || "",
          profilePhotoKey: user.profilePhotoKey || null,
          profilePhotoUrl,
          profilePhotoUpdatedAt: user.profilePhotoUpdatedAt || null,
          isEmailVerified: true,
          surveyCompleted: !!user.onboarding?.surveyCompleted,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
