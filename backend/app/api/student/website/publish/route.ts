import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import mongoose from "mongoose";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";
import { toPublicProfileDTO, computeSnapshotChecksum } from "../../../../../lib/public-profile-dto";
import { loadWebsiteSource } from "../../../../../lib/domain-profile/website-source";
import { collectPublicAssetIds } from "../../../../../lib/storage/asset-refs";
import { presentationForTemplate } from "../../../../../lib/templates/registry";
import { isAllowedProfilePhotoKey } from "../../../../../lib/storage/legacy-photo";
import { ProfileValidationError } from "../../../../../lib/domain-profile/validate";
import { assertProfileAssetRefs } from "../../../../../lib/storage/asset-service";
import { collectCustomAssetBindings } from "../../../../../lib/custom-fields";

function collectLegacyPhotoKeys(snapshotText: string): string[] {
  const found = new Set<string>();
  const pattern = /\/api\/profile\/photo\/([^"\\\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(snapshotText))) {
    try {
      const key = decodeURIComponent(match[1]);
      if (isAllowedProfilePhotoKey(key)) found.add(key);
    } catch {
      continue;
    }
  }
  return [...found];
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
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

    // 1. Load the signed-in user's own identity profile and website configuration.
    //    The request body is ignored so a client cannot select another profile.
    const [website, config] = await Promise.all([
      loadWebsiteSource(auth.user),
      UserWebsiteConfig.findOne({ userId: auth.user._id }),
    ]);
    const profile = website
      ? (website.source as {
          preferredName?: string;
          headline?: string;
          bio?: string;
          education?: unknown;
          projects?: unknown;
          skills?: unknown;
          credentials?: unknown;
          achievements?: unknown;
          experience?: unknown;
          testimonials?: unknown;
          team?: unknown;
          media?: unknown;
        })
      : null;

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

    // 3. Validate profile existence for the authenticated identity
    if (!profile) {
      const domainIdentity = auth.user.identity && auth.user.identity !== "student";
      return NextResponse.json(
        {
          success: false,
          message: domainIdentity
            ? "Cannot publish: No identity profile record found. Please populate and save your profile first."
            : "Cannot publish: No student profile record found. Please populate and save your profile first.",
          errors: {
            profile: domainIdentity ? "Identity profile record is missing." : "Student profile record is missing.",
          },
        },
        { status: 400 }
      );
    }

    // 4. Validate minimum publication requirements
    const displayName = (profile.preferredName || "").trim() || (auth.user.name || "").trim();
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

    const hasItems = (value: unknown) => Array.isArray(value) && value.length > 0;
    const hasContent = Boolean(
      (profile.headline && profile.headline.trim()) ||
        (profile.bio && profile.bio.trim()) ||
        hasItems(profile.education) ||
        hasItems(profile.projects) ||
        hasItems(profile.skills) ||
        hasItems(profile.credentials) ||
        hasItems(profile.achievements) ||
        hasItems(profile.experience) ||
        hasItems(profile.testimonials) ||
        hasItems(profile.team) ||
        hasItems(profile.media) ||
        hasItems((profile as { customLayout?: { sections?: unknown[] } }).customLayout?.sections)
    );

    if (!hasContent) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Publication validation failed: Profile must contain at least one public section before publishing.",
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

    try {
      await assertProfileAssetRefs(
        String(auth.user._id),
        collectCustomAssetBindings((profile as { customLayout?: unknown }).customLayout)
      );
    } catch (error: unknown) {
      if (error instanceof ProfileValidationError || (error instanceof Error && error.name === "ProfileValidationError")) {
        const status = error instanceof ProfileValidationError ? error.status : 400;
        return NextResponse.json({ success: false, message: error.message }, { status });
      }
      throw error;
    }

    const dto = toPublicProfileDTO(profile, {
      username: config.username,
      canonicalUrl: publicUrl,
      publishedAt,
      templateId: config.selectedTemplateId || "magicui-portfolio",
      templateVersion: config.selectedTemplateVersion || "1.0.0",
      user: { name: auth.user.name, profilePhotoKey: auth.user.profilePhotoKey },
      identity: website?.identity,
      ownerId: String(auth.user._id),
      assetDelivery: "publish",
      recordIds: website?.recordIds,
      strictCustomFields: true,
    });

    const snapshotText = JSON.stringify(dto);
    if (snapshotText.includes("/api/assets/private/")) {
      return NextResponse.json(
        {
          success: false,
          message: "Publication refused because the snapshot included a private file reference.",
        },
        { status: 500 }
      );
    }

    // 6. Compute deterministic SHA-256 checksum
    const checksum = computeSnapshotChecksum(dto);
    const publicAssetIds = collectPublicAssetIds(dto);
    const legacyPhotoKeys = collectLegacyPhotoKeys(snapshotText);
    let presentation;
    try {
      const storedCustomization =
        config.customization && typeof (config.customization as { toObject?: () => object }).toObject === "function"
          ? (config.customization as { toObject: () => object }).toObject()
          : config.customization || {};
      presentation = presentationForTemplate(config.selectedTemplateId || "magicui-portfolio", storedCustomization);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Invalid appearance settings.";
      return NextResponse.json({ success: false, message }, { status: 400 });
    }

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
        publicAssetIds,
        legacyPhotoKeys,
        presentation,
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
    if (error instanceof ProfileValidationError || (error instanceof Error && error.name === "ProfileValidationError")) {
      const status = error instanceof ProfileValidationError ? error.status : 400;
      return NextResponse.json({ success: false, message: error.message }, { status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
