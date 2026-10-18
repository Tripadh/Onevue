import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { verifyAuth } from "../../../../../lib/auth";
import connectToDatabase from "../../../../../lib/db";
import VisitingCard, { normalizeDesignDocument } from "../../../../../models/VisitingCard";

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
        (await VisitingCard.findOne({ userId: user._id, isDefault: true })) ||
        (await VisitingCard.findOne({ userId: user._id }));
    }

    if (!card) {
      return NextResponse.json(
        { message: "No visiting card configuration exists to publish." },
        { status: 404 }
      );
    }

    // D1: Maximum 3 published cards per user
    const MAX_PUBLISHED_CARDS = 3;
    if (card.publicationStatus !== "published") {
      const publishedCount = await VisitingCard.countDocuments({
        userId: user._id,
        publicationStatus: "published",
      });
      if (publishedCount >= MAX_PUBLISHED_CARDS) {
        return NextResponse.json(
          {
            message: `Maximum limit of ${MAX_PUBLISHED_CARDS} published cards reached. Please unpublish an existing card before publishing a new one.`,
            code: "PUBLISHED_LIMIT_REACHED",
          },
          { status: 400 }
        );
      }
    }

    const normalizedDoc = normalizeDesignDocument(card.designDocument);
    const totalElements =
      (normalizedDoc.front?.elements?.length || 0) +
      (normalizedDoc.back?.elements?.length || 0);

    if (totalElements === 0) {
      return NextResponse.json(
        { message: "Cannot publish an empty card. Please add elements or choose a template." },
        { status: 400 }
      );
    }

    // Unmark any previous default card if this card is being published
    await VisitingCard.updateMany(
      { userId: user._id, _id: { $ne: card._id } },
      { $set: { isDefault: false } }
    );

    // Freeze draft into publishedSnapshot with both sides
    card.isDefault = true;
    card.designDocument = normalizedDoc;
    card.publishedSnapshot = JSON.parse(JSON.stringify(normalizedDoc));
    card.publicationStatus = "published";
    card.publishedAt = new Date();
    if (user.username) {
      card.username = user.username;
    }

    await card.save();

    // Concurrency safety check: verify published count does not exceed limit under race conditions
    const verifiedPublishedCount = await VisitingCard.countDocuments({
      userId: user._id,
      publicationStatus: "published",
    });
    if (verifiedPublishedCount > MAX_PUBLISHED_CARDS) {
      card.publicationStatus = "draft";
      card.publishedSnapshot = null;
      card.publishedAt = null;
      await card.save();
      return NextResponse.json(
        {
          message: `Maximum limit of ${MAX_PUBLISHED_CARDS} published cards reached due to concurrent request. Please unpublish an existing card.`,
          code: "PUBLISHED_LIMIT_REACHED",
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: "Visiting card published successfully!",
        publicUrl: `onevue.id/card/${card.username}`,
        card,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
