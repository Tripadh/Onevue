import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../lib/db";
import VisitingCard, { normalizeDesignDocument } from "../../../../../models/VisitingCard";
import User from "../../../../../models/User";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

export async function GET(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await context.params;
    const cleanUsername = String(username || "").toLowerCase().trim();

    if (!cleanUsername) {
      return NextResponse.json(
        { success: false, message: "A valid username is required." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // 1. Locate the active published visiting card (prioritizing default card)
    const card = await VisitingCard.findOne({
      username: cleanUsername,
      publicationStatus: "published",
    }).sort({ isDefault: -1, updatedAt: -1 });

    if (!card || !card.publishedSnapshot) {
      return NextResponse.json(
        {
          success: false,
          message: `Public visiting card for '${cleanUsername}' was not found or is currently unpublished.`,
        },
        { status: 404 }
      );
    }

    // 2. Fetch public user info
    const UserModel = (User as any).default || User;
    const user = await UserModel.findById(card.userId);

    // 3. Return normalized double-sided snapshot & public metadata
    const normalizedDesign = normalizeDesignDocument(card.publishedSnapshot);

    return NextResponse.json(
      {
        success: true,
        card: {
          username: card.username,
          design: normalizedDesign,
          selectedTemplateId: card.selectedTemplateId,
          publishedAt: card.publishedAt,
          visibilitySettings: card.visibilitySettings,
          user: {
            name: user?.name || "Student",
            identity: user?.identity || "student",
          },
        },
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
