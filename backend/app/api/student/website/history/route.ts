import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/* =========================================================================
   GET /api/student/website/history
   Authenticated endpoint delivering the publication revision history
   for the signed-in student.
   ========================================================================= */

export async function GET(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    await connectToDatabase();

    const config = await UserWebsiteConfig.findOne({ userId: auth.user._id });
    if (!config) {
      return NextResponse.json(
        {
          success: true,
          revisions: [],
          activeRevisionId: null,
          activeRevisionNumber: null,
        },
        { status: 200 }
      );
    }

    // Query all published revisions belonging strictly to this user
    const rawRevisions = await PublishedProfileRevision.find({
      userId: auth.user._id,
      websiteConfigId: config._id,
    })
      .sort({ revisionNumber: -1 })
      .select("revisionNumber templateId templateVersion publishedAt checksum")
      .lean();

    const activeRevisionIdStr = config.activeRevisionId
      ? config.activeRevisionId.toString()
      : null;

    let activeRevisionNumber: number | null = null;

    const revisions = rawRevisions.map((rev) => {
      const isCurrentActive =
        activeRevisionIdStr !== null && rev._id.toString() === activeRevisionIdStr;
      if (isCurrentActive) {
        activeRevisionNumber = rev.revisionNumber;
      }
      return {
        id: rev._id.toString(),
        revisionNumber: rev.revisionNumber,
        templateId: rev.templateId,
        templateVersion: rev.templateVersion,
        publishedAt: rev.publishedAt,
        checksum: rev.checksum,
        isActive: isCurrentActive,
      };
    });

    return NextResponse.json(
      {
        success: true,
        revisions,
        activeRevisionId: activeRevisionIdStr,
        activeRevisionNumber,
        username: config.username,
        status: config.status,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
