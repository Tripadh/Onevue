import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { verifyAuth } from "../../../../lib/auth";
import connectToDatabase from "../../../../lib/db";
import VisitingCard, {
  normalizeDesignDocument,
  IVisitingCard,
} from "../../../../models/VisitingCard";
import StudentProfile from "../../../../models/StudentProfile";
import {
  generateDefaultCardDesign,
  VISITING_CARD_TEMPLATES,
} from "../../../../lib/templates/visiting-card-templates";

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
    await connectToDatabase();

    let requestedCardId: string | null = null;
    if (req && typeof req.url === "string") {
      try {
        const { searchParams } = new URL(req.url, "http://localhost");
        requestedCardId = searchParams.get("cardId");
      } catch (_) {}
    }

    if (requestedCardId && !mongoose.Types.ObjectId.isValid(requestedCardId)) {
      return NextResponse.json(
        { message: "Invalid card ID format." },
        { status: 400 }
      );
    }

    // Fetch all cards belonging to this user
    let userCards = await VisitingCard.find({ userId: user._id }).sort({
      updatedAt: -1,
    });

    // If user has no cards yet, seed initial default card
    if (userCards.length === 0) {
      const studentProfile = await StudentProfile.findOne({ userId: user._id });
      const primaryEdu =
        studentProfile?.education && studentProfile.education.length > 0
          ? studentProfile.education[0]
          : null;

      const seedInfo = {
        name: user.name,
        headline: studentProfile?.headline,
        institution: primaryEdu?.institution,
        degree: primaryEdu?.degree,
        email: user.email,
        phone: studentProfile?.contacts?.phone,
        location: user.location,
        username: user.username || `user_${user._id.toString().slice(-6)}`,
        photoUrl: user.profilePhotoKey
          ? `/api/profile/photo/${encodeURIComponent(user.profilePhotoKey)}`
          : null,
        github: studentProfile?.contacts?.github,
        linkedin: studentProfile?.contacts?.linkedin,
      };

      const defaultDesign = generateDefaultCardDesign("academic-classic", seedInfo);

      const initialCard = await VisitingCard.create({
        userId: user._id,
        username: seedInfo.username,
        isDefault: true,
        selectedTemplateId: "academic-classic",
        designName: `${user.name}'s Visiting Card`,
        designDocument: defaultDesign,
        assetReferences: [],
        publicationStatus: "draft",
      });

      userCards = [initialCard];
    }

    // Determine active card: requested cardId, or default card, or first card
    let activeCard: IVisitingCard | null = null;
    if (requestedCardId) {
      activeCard = userCards.find(
        (c) => c._id?.toString() === requestedCardId
      ) || null;
      if (!activeCard) {
        return NextResponse.json(
          { message: "Requested visiting card not found or unauthorized." },
          { status: 404 }
        );
      }
    }
    if (!activeCard) {
      activeCard = userCards.find((c) => c.isDefault) || userCards[0];
    }

    // Ensure designDocument has normalized front and back
    if (activeCard) {
      activeCard.designDocument = normalizeDesignDocument(activeCard.designDocument);
    }

    return NextResponse.json(
      {
        success: true,
        card: activeCard,
        cards: userCards.map((c) => ({
          _id: c._id,
          designName: c.designName,
          selectedTemplateId: c.selectedTemplateId,
          publicationStatus: c.publicationStatus,
          isDefault: c.isDefault,
          updatedAt: c.updatedAt,
          createdAt: c.createdAt,
          designDocument: normalizeDesignDocument(c.designDocument),
        })),
        templates: Object.values(VISITING_CARD_TEMPLATES),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, private",
        },
      }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
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
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { message: "Invalid request payload." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const action = body.action || "create";

    if (action === "duplicate") {
      const sourceCardId = body.sourceCardId;
      if (!sourceCardId) {
        return NextResponse.json(
          { message: "sourceCardId is required to duplicate a card." },
          { status: 400 }
        );
      }

      if (!mongoose.Types.ObjectId.isValid(sourceCardId)) {
        return NextResponse.json(
          { message: "Invalid sourceCardId format." },
          { status: 400 }
        );
      }

      const sourceCard = await VisitingCard.findOne({
        _id: sourceCardId,
        userId: user._id,
      });

      if (!sourceCard) {
        return NextResponse.json(
          { message: "Source card not found or unauthorized." },
          { status: 404 }
        );
      }

      const copyName = `${sourceCard.designName || "Card"} (Copy)`.slice(0, 100);
      const clonedDesign = JSON.parse(JSON.stringify(sourceCard.designDocument));

      const newCard = await VisitingCard.create({
        userId: user._id,
        username: user.username || sourceCard.username,
        isDefault: false,
        selectedTemplateId: sourceCard.selectedTemplateId,
        designName: copyName,
        designDocument: normalizeDesignDocument(clonedDesign),
        assetReferences: sourceCard.assetReferences || [],
        visibilitySettings: sourceCard.visibilitySettings,
        publicationStatus: "draft",
        publishedSnapshot: null,
      });

      return NextResponse.json(
        {
          success: true,
          message: "Visiting card duplicated successfully.",
          card: newCard,
        },
        { status: 201 }
      );
    }

    // Default action: Create new card
    const templateId = body.templateId || "academic-classic";
    if (!VISITING_CARD_TEMPLATES[templateId]) {
      return NextResponse.json(
        { message: `Invalid template ID: '${templateId}'.` },
        { status: 400 }
      );
    }

    const studentProfile = await StudentProfile.findOne({ userId: user._id });
    const primaryEdu =
      studentProfile?.education && studentProfile.education.length > 0
        ? studentProfile.education[0]
        : null;

    const seedInfo = {
      name: user.name,
      headline: studentProfile?.headline,
      institution: primaryEdu?.institution,
      degree: primaryEdu?.degree,
      email: user.email,
      phone: studentProfile?.contacts?.phone,
      location: user.location,
      username: user.username || `user_${user._id.toString().slice(-6)}`,
      photoUrl: user.profilePhotoKey
        ? `/api/profile/photo/${encodeURIComponent(user.profilePhotoKey)}`
        : null,
      github: studentProfile?.contacts?.github,
      linkedin: studentProfile?.contacts?.linkedin,
    };

    const newDesign = generateDefaultCardDesign(templateId, seedInfo);
    const existingCardsCount = await VisitingCard.countDocuments({ userId: user._id });

    const createdCard = await VisitingCard.create({
      userId: user._id,
      username: seedInfo.username,
      isDefault: existingCardsCount === 0,
      selectedTemplateId: templateId,
      designName: (body.designName || `${VISITING_CARD_TEMPLATES[templateId].name} Card`).slice(0, 100),
      designDocument: newDesign,
      assetReferences: [],
      publicationStatus: "draft",
    });

    return NextResponse.json(
      {
        success: true,
        message: "New visiting card created.",
        card: createdCard,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
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
        { message: "Invalid request payload." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // Locate the target card: by cardId if provided, else default card, else any card
    let card: any = null;
    if (body.cardId) {
      if (!mongoose.Types.ObjectId.isValid(body.cardId)) {
        return NextResponse.json(
          { message: "Invalid card ID format." },
          { status: 400 }
        );
      }
      card = await VisitingCard.findOne({ _id: body.cardId, userId: user._id });
      if (!card) {
        return NextResponse.json(
          { message: "Visiting card record not found or unauthorized." },
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
        { message: "Visiting card record not found. Please load the card first." },
        { status: 404 }
      );
    }

    // 1. Template validation
    if (body.selectedTemplateId) {
      if (!VISITING_CARD_TEMPLATES[body.selectedTemplateId]) {
        return NextResponse.json(
          { message: `Invalid template ID: '${body.selectedTemplateId}'.` },
          { status: 400 }
        );
      }
      card.selectedTemplateId = body.selectedTemplateId;
    }

    // 2. Design name
    if (typeof body.designName === "string") {
      card.designName = body.designName.slice(0, 100);
    }

    // 3. isDefault flag update
    if (body.isDefault === true && !card.isDefault) {
      await VisitingCard.updateMany(
        { userId: user._id, _id: { $ne: card._id } },
        { $set: { isDefault: false } }
      );
      card.isDefault = true;
    }

    // 4. Design Document Validation & Sanitization
    if (body.designDocument && typeof body.designDocument === "object") {
      const doc = body.designDocument;
      const normalized = normalizeDesignDocument(doc);

      // Validate total elements count across both sides
      const totalElements =
        (normalized.front?.elements?.length || 0) +
        (normalized.back?.elements?.length || 0);

      if (totalElements > 120) {
        return NextResponse.json(
          { message: "Card cannot exceed 120 elements across both sides." },
          { status: 400 }
        );
      }

      // Sanitize elements on both sides
      const allElements = [
        ...(normalized.front?.elements || []),
        ...(normalized.back?.elements || []),
      ];

      for (const el of allElements) {
        if (!el.id || !el.type) {
          return NextResponse.json(
            { message: "Every element must possess an id and a valid type." },
            { status: 400 }
          );
        }
        if (typeof el.x !== "number" || typeof el.y !== "number") {
          return NextResponse.json(
            { message: "Element coordinates (x, y) must be numeric." },
            { status: 400 }
          );
        }
      }

      card.designDocument = normalized;
    }

    // 5. Visibility settings
    if (body.visibilitySettings && typeof body.visibilitySettings === "object") {
      card.visibilitySettings = {
        showEmail: Boolean(body.visibilitySettings.showEmail),
        showPhone: Boolean(body.visibilitySettings.showPhone),
        showSocials: Boolean(body.visibilitySettings.showSocials),
        showPortfolioLink: Boolean(body.visibilitySettings.showPortfolioLink),
      };
    }

    // Ensure username is up-to-date
    if (user.username) {
      card.username = user.username;
    }

    // Note: Saving draft explicitly does NOT change publicationStatus or publishedSnapshot
    await card.save();

    return NextResponse.json(
      {
        success: true,
        message: "Visiting card draft saved successfully.",
        card,
      },
      { status: 200 }
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
    let cardId: string | null = null;
    if (req && typeof req.url === "string") {
      try {
        const { searchParams } = new URL(req.url, "http://localhost");
        cardId = searchParams.get("cardId");
      } catch (_) {}
    }

    if (!cardId) {
      return NextResponse.json(
        { message: "Query parameter 'cardId' is required for deletion." },
        { status: 400 }
      );
    }

    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return NextResponse.json(
        { message: "Invalid card ID format." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const card = await VisitingCard.findOne({ _id: cardId, userId: user._id });
    if (!card) {
      return NextResponse.json(
        { message: "Card not found or unauthorized." },
        { status: 404 }
      );
    }

    const wasDefault = card.isDefault;
    await VisitingCard.deleteOne({ _id: card._id });

    // If deleted card was default, designate the next available card as default
    if (wasDefault) {
      const remainingCard = await VisitingCard.findOne({ userId: user._id }).sort({
        updatedAt: -1,
      });
      if (remainingCard) {
        remainingCard.isDefault = true;
        await remainingCard.save();
      }
    }

    return NextResponse.json(
      {
        success: true,
        message: "Visiting card deleted successfully.",
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
