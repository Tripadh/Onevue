import { NextResponse } from "next/server";
import { getProfilePhotoStorage } from "../../../../../lib/storage";

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

    const decodedKey = decodeURIComponent(rawKey);

    // Basic defense against obvious traversal characters before passing to storage provider
    if (
      decodedKey.includes("..") ||
      decodedKey.includes("/") ||
      decodedKey.includes("\\") ||
      decodedKey.includes("\0")
    ) {
      return NextResponse.json(
        { message: "Invalid image identifier." },
        { status: 400 }
      );
    }

    const storage = getProfilePhotoStorage();
    const result = await storage.read(decodedKey);

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
