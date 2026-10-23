import { NextResponse } from "next/server";
import mongoose from "mongoose";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";
import { toPublicProfileDTO, computeSnapshotChecksum } from "../../../../../lib/public-profile-dto";
import { hasPublishableContent, loadWebsiteSource } from "../../../../../lib/domain-profile/website-source";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}

/* =========================================================================
   POST /api/student/website/publish
   Central Phase 3 operation: validates profile, generates immutable DTO
   snapshot, writes PublishedProfileRevision, and atomically activates pointer.
   ========================================================================= */

export async function POST(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    await connectToDatabase();

    // 1. Load canonical profile and website configuration
    const [websiteSource, config] = await Promise.all([
      loadWebsiteSource(auth.user),
      UserWebsiteConfig.findOne({ userId: auth.user._id }),
    ]);
    const isStudent = !websiteSource || websiteSource.identity === "student";
    const profile = websiteSource ? websiteSource.source : null;

    // 2. Validate configuration existence and username claim
    if (!config || !config.username) {
      return NextResponse.json(
        {
          success: false,
          message: "A valid claimed username is required before publishing. Please configure your website first.",
          errors: {
            username: "Username must be configured and claimed prior to publication.",
          },
        },
        { status: 400 }
      );
    }

    // 3. Validate identity profile existence
    if (!profile) {
      const studentAccount = !auth.user.identity || auth.user.identity === "student";
      return NextResponse.json(
        {
          success: false,
          message: studentAccount
            ? "Cannot publish: No student profile record found. Please populate and save your profile first."
            : "Cannot publish: No identity profile record found. Please populate and save your profile first.",
          errors: {
            profile: studentAccount ? "Student profile record is missing." : "Identity profile record is missing.",
          },
        },
        { status: 400 }
      );
    }

    // 4. Validate minimum publication requirements
    const preferredName = typeof profile.preferredName === "string" ? profile.preferredName : "";
    const displayName = preferredName.trim() || (auth.user.name || "").trim();
    if (!displayName) {
      return NextResponse.json(
        {
          success: false,
          message: "Publication validation failed: Display name or preferred name is required.",
          errors: {
            displayName: "Display name cannot be empty.",
          },
        },
        { status: 400 }
      );
    }

    const studentDoc = profile as {
      headline?: string;
      bio?: string;
      education?: unknown[];
      projects?: unknown[];
      skills?: unknown[];
    };
    const hasContent = isStudent
      ? Boolean(
          (studentDoc.headline && studentDoc.headline.trim()) ||
            (studentDoc.bio && studentDoc.bio.trim()) ||
            (Array.isArray(studentDoc.education) && studentDoc.education.length > 0) ||
            (Array.isArray(studentDoc.projects) && studentDoc.projects.length > 0) ||
            (Array.isArray(studentDoc.skills) && studentDoc.skills.length > 0)
        )
      : hasPublishableContent(profile);

    if (!hasContent) {
      return NextResponse.json(
        {
          success: false,
          message: isStudent
            ? "Publication validation failed: Profile must contain at least a headline, bio, education, project, or skill before publishing."
            : "Publication validation failed: Add a headline, bio, or at least one profile section before publishing.",
          errors: {
            content: "At least one identity section must contain saved information.",
          },
        },
        { status: 400 }
      );
    }

    // 5. Generate sanitized immutable PublicProfileDTO_v1
    const publishedAt = new Date();
    const publicUrl = `https://onevue.id/p/${config.username}`;

    const dto = toPublicProfileDTO(profile, {
      username: config.username,
      canonicalUrl: publicUrl,
      publishedAt,
      templateId: config.selectedTemplateId || "magicui-portfolio",
      templateVersion: config.selectedTemplateVersion || "1.0.0",
      user: { name: auth.user.name },
    });

    // 6. Compute deterministic SHA-256 checksum
    const checksum = computeSnapshotChecksum(dto);

    // 7. Atomic revision creation & pointer activation
    // Determine if MongoDB replica set transactions are supported in this runtime
    let session: mongoose.ClientSession | null = null;
    let useTransaction = false;

    try {
      session = await mongoose.startSession();
      session.startTransaction();
      useTransaction = true;
    } catch {
      session = null;
      useTransaction = false;
    }

    try {
      // Allocate next revision number safely
      const query = PublishedProfileRevision.findOne({ userId: auth.user._id }).sort({
        revisionNumber: -1,
      });
      if (session) query.session(session);
      const latestRev = await query;
      const nextRevisionNumber = latestRev ? latestRev.revisionNumber + 1 : 1;

      // Create immutable publication snapshot
      const revision = new PublishedProfileRevision({
        userId: auth.user._id,
        websiteConfigId: config._id,
        revisionNumber: nextRevisionNumber,
        templateId: config.selectedTemplateId || "magicui-portfolio",
        templateVersion: config.selectedTemplateVersion || "1.0.0",
        snapshot: dto,
        checksum,
        publishedAt,
      });

      await revision.save({ session: session || undefined });

      // Atomically activate the newly created revision on website configuration
      config.activeRevisionId = revision._id;
      config.publishedAt = publishedAt;
      config.status = "published";

      await config.save({ session: session || undefined });

      if (useTransaction && session) {
        await session.commitTransaction();
      }

      return NextResponse.json(
        {
          success: true,
          message: "Website published successfully.",
          revision: {
            id: revision._id,
            revisionNumber: revision.revisionNumber,
            templateId: revision.templateId,
            templateVersion: revision.templateVersion,
            checksum: revision.checksum,
            publishedAt: revision.publishedAt,
          },
          publicUrl,
        },
        { status: 200 }
      );
    } catch (saveError: any) {
      if (useTransaction && session) {
        await session.abortTransaction();
      }

      // Handle concurrent revision duplicate key conflict gracefully
      if (saveError && saveError.code === 11000) {
        return NextResponse.json(
          {
            success: false,
            message: "A concurrent publishing request occurred. Please retry in a moment.",
          },
          { status: 409 }
        );
      }

      throw saveError;
    } finally {
      if (session) {
        await session.endSession();
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
