import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { verifyAuth } from "../../../../../lib/auth";
import connectToDatabase from "../../../../../lib/db";
import VisitingCard from "../../../../../models/VisitingCard";

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
    await connectToDatabase();

    let cardId: string | null = null;
    if (req && typeof req.url === "string") {
      try {
        const { searchParams } = new URL(req.url, "http://localhost");
        cardId = searchParams.get("cardId");
      } catch (_) {}
    }

    if (!cardId) {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object" && body.cardId) {
        cardId = body.cardId;
      }
    }

    let card: any = null;
    if (cardId) {
      if (!mongoose.Types.ObjectId.isValid(cardId)) {
        return NextResponse.json(
          { message: "Invalid card ID format." },
          { status: 400 }
        );
      }
      card = await VisitingCard.findOne({ _id: cardId, userId: user._id });
      if (!card) {
        return NextResponse.json(
          { message: "Visiting card not found or unauthorized." },
          { status: 404 }
        );
      }
    } else {
      card =
        (await VisitingCard.findOne({ userId: user._id, publicationStatus: "published" })) ||
        (await VisitingCard.findOne({ userId: user._id, isDefault: true })) ||
        (await VisitingCard.findOne({ userId: user._id }));
    }

    if (!card) {
      return NextResponse.json(
        { message: "No visiting card configuration exists." },
        { status: 404 }
      );
    }

    card.publicationStatus = "unpublished";
    await card.save();

    return NextResponse.json(
      {
        success: true,
        message: "Visiting card unpublished. Public link is now inactive.",
        card,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
