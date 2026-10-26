import { NextResponse } from "next/server";
import { getProfilePhotoStorage } from "../../../../../lib/storage";
import { isAllowedProfilePhotoKey, isServableLegacyPhoto } from "../../../../../lib/storage/legacy-photo";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ key: string }> | { key: string } }
) {
  try {
    const rawParams = await context.params;
    const rawKey = rawParams?.key;

    if (!rawKey || typeof rawKey !== "string") {
      return NextResponse.json(
        { message: "Image key is required." },
        { status: 400 }
      );
    }

    let decodedKey = "";
    try {
      decodedKey = decodeURIComponent(rawKey);
    } catch {
      return NextResponse.json({ message: "Invalid image identifier." }, { status: 400 });
    }

    if (!isAllowedProfilePhotoKey(decodedKey)) {
      return NextResponse.json(
        { message: "Invalid image identifier." },
        { status: 400 }
      );
    }

    const referenced = await isServableLegacyPhoto(decodedKey);
    if (!referenced) {
      return NextResponse.json({ message: "Profile photo not found." }, { status: 404 });
    }

    const storage = getProfilePhotoStorage();
    let result: { buffer: Buffer; contentType: string } | null = null;
    try {
      result = await storage.read(decodedKey);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      if (/invalid storage key|traversal/i.test(message)) {
        return NextResponse.json({ message: "Profile photo not found." }, { status: 404 });
      }
      throw error;
    }

    if (!result) {
      return NextResponse.json(
        { message: "Profile photo not found." },
        { status: 404 }
      );
    }

    return new Response(result.buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
