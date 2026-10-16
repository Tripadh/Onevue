import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../lib/db";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/* =========================================================================
   GET /api/public/profile/[username]
   Public endpoint delivering the frozen, approved PublicProfileDTO_v1 snapshot.
   Strict rule: Never queries live StudentProfile. Never exposes unpublished edits.
   ========================================================================= */

export async function GET(
  req: Request,
  context: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await context.params;
    const cleanUsername = String(username || "").toLowerCase().trim();

    if (!cleanUsername) {
      return NextResponse.json(
        { success: false, message: "A valid username parameter is required." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    // 1. Locate the active published website configuration
    const config = await UserWebsiteConfig.findOne({
      username: cleanUsername,
      status: "published",
    });

    if (!config || !config.activeRevisionId) {
      return NextResponse.json(
        {
          success: false,
          message: `Public portfolio for '${cleanUsername}' was not found or is not currently published.`,
        },
        { status: 404 }
      );
    }

    // 2. Fetch the active published revision snapshot
    const revision = await PublishedProfileRevision.findById(config.activeRevisionId);

    if (!revision) {
      return NextResponse.json(
        {
          success: false,
          message: "The active published revision snapshot is missing or unavailable.",
        },
        { status: 404 }
      );
    }

    // 3. Verify integrity: revision must belong to the matching websiteConfig and user
    if (
      String(revision.userId) !== String(config.userId) ||
      String(revision.websiteConfigId) !== String(config._id)
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "Website revision integrity violation.",
        },
        { status: 404 }
      );
    }

    // 4. Return exclusively the approved public DTO and safe public metadata
    const response = NextResponse.json(
      {
        success: true,
        dto: revision.snapshot,
        website: {
          username: config.username,
          templateId: revision.templateId,
          templateVersion: revision.templateVersion,
          publishedAt: revision.publishedAt,
          revisionNumber: revision.revisionNumber,
          customization: config.customization || {
            accentColor: "#3b82f6",
            themeMode: "system",
            visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
          },
        },
      },
      { status: 200 }
    );

    // Initial safe caching policy: no-store until CDN surrogate tag invalidation is active
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
