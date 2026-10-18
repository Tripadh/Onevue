import { NextResponse } from "next/server";
import { verifyAuth } from "../../../../../lib/auth";
import connectToDatabase from "../../../../../lib/db";
import VisitingCard from "../../../../../models/VisitingCard";
import {
  getProfilePhotoStorage,
  validateProfilePhotoImage,
  MAX_PROFILE_PHOTO_SIZE,
} from "../../../../../lib/storage";

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

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { message: "Invalid form data. Please upload your asset as multipart/form-data." },
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
        { message: "No image file provided." },
        { status: 400 }
      );
    }

    if (file.size > MAX_PROFILE_PHOTO_SIZE) {
      return NextResponse.json(
        {
          message: `Asset exceeds the 2 MB limit (size: ${(
            file.size /
            (1024 * 1024)
          ).toFixed(2)} MB).`,
        },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate magic bytes
    const validation = validateProfilePhotoImage(buffer, file.type);
    if (!validation.valid) {
      return NextResponse.json(
        { message: validation.error },
        { status: 400 }
      );
    }

    const storage = getProfilePhotoStorage();
    const uploadResult = await storage.upload(
      buffer,
      validation.mimeType,
      user._id.toString()
    );

    await connectToDatabase();
    const card = await VisitingCard.findOne({ userId: user._id });

    const assetRef = {
      key: uploadResult.key,
      publicUrl: uploadResult.publicUrl,
      name: (file.name || "uploaded_asset").slice(0, 100),
      size: buffer.length,
      mimeType: validation.mimeType,
      uploadedAt: new Date(),
    };

    if (card) {
      card.assetReferences.push(assetRef as any);
      await card.save();
    }

    return NextResponse.json(
      {
        success: true,
        message: "Asset uploaded successfully.",
        asset: assetRef,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
