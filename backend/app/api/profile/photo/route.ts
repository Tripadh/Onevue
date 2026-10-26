import { NextResponse } from "next/server";
import { verifyAuth } from "../../../../lib/auth";
import {
  getProfilePhotoStorage,
  validateProfilePhotoImage,
  MAX_PROFILE_PHOTO_SIZE,
} from "../../../../lib/storage";
import { legacyPhotoRetained } from "../../../../lib/storage/legacy-photo";

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

    const { user } = authResult;

    // Parse multipart form data
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { message: "Invalid form data. Please upload your photo as multipart/form-data." },
        { status: 400 }
      );
    }

    const file = formData.get("file") as any;
    if (
      !file ||
      typeof file === "string" ||
      typeof file !== "object" ||
      typeof file.arrayBuffer !== "function"
    ) {
      return NextResponse.json(
        { message: "No image file provided. Please choose a photo to upload." },
        { status: 400 }
      );
    }

    if (file.size > MAX_PROFILE_PHOTO_SIZE) {
      return NextResponse.json(
        {
          message: `The selected image is too large (${(file.size / (1024 * 1024)).toFixed(
            2
          )} MB). Maximum allowed size is 2 MB.`,
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Strict content validation using magic bytes
    const validation = validateProfilePhotoImage(buffer, file.type);
    if (!validation.valid) {
      return NextResponse.json(
        { message: validation.error },
        { status: 400 }
      );
    }

    const storage = getProfilePhotoStorage();
    const oldKey = user.profilePhotoKey;

    // 1. Upload new image via storage provider
    const uploadResult = await storage.upload(
      buffer,
      validation.mimeType,
      user._id.toString()
    );

    // 2. Persist to MongoDB
    user.profilePhotoKey = uploadResult.key;
    user.profilePhotoUpdatedAt = new Date();
    await user.save();

    // 3. Clean up the superseded previous photo if it exists
    if (oldKey && oldKey !== uploadResult.key && !(await legacyPhotoRetained(oldKey))) {
      try {
        await storage.delete(oldKey);
      } catch (cleanupErr) {
        console.warn(`Could not delete orphaned previous photo ${oldKey}:`, cleanupErr);
      }
    }

    return NextResponse.json(
      {
        message: "Profile photo updated successfully.",
        profilePhotoKey: uploadResult.key,
        profilePhotoUrl: uploadResult.publicUrl,
        profilePhotoUpdatedAt: user.profilePhotoUpdatedAt,
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

export async function DELETE(req: Request) {
  try {
    const authResult = await verifyAuth(req);
    if ("error" in authResult) {
      return NextResponse.json(
        { message: authResult.error },
        { status: authResult.status }
      );
    }

    const { user } = authResult;
    const oldKey = user.profilePhotoKey;

    if (!oldKey) {
      return NextResponse.json(
        { message: "No profile photo is currently set.", profilePhotoUrl: null },
        { status: 200 }
      );
    }

    // 1. Clear database reference
    user.profilePhotoKey = null;
    user.profilePhotoUpdatedAt = null;
    await user.save();

    // 2. Remove file from storage
    if (!(await legacyPhotoRetained(oldKey))) {
      const storage = getProfilePhotoStorage();
      try {
        await storage.delete(oldKey);
      } catch (cleanupErr) {
        console.warn(`Could not delete storage file ${oldKey}:`, cleanupErr);
      }
    }

    return NextResponse.json(
      {
        message: "Profile photo removed successfully.",
        profilePhotoUrl: null,
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
