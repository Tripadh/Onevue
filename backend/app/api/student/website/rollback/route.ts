import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision, {
  DEFAULT_WEBSITE_CUSTOMIZATION,
} from "../../../../../models/PublishedProfileRevision";
import { validateEligibleTemplateSelection } from "../../../../../lib/template-registry-extension";
import {
  PUBLIC_PROFILE_SCHEMA_VERSION,
  verifyPublishedRevisionIntegrity,
} from "../../../../../lib/public-profile-dto";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   POST /api/student/website/rollback
   Activates a prior published snapshot by updating activeRevisionId without
   mutating, deleting, or fabricating historical records.
   ========================================================================= */

export async function POST(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ message: "Malformed JSON payload in request body." }, { status: 400 });
    }

    const { revisionId, revisionNumber } = body || {};

    if (!revisionId && revisionNumber === undefined) {
      return NextResponse.json(
        { message: "Target revisionId or revisionNumber is required for rollback." },
        { status: 400 }
      );
    }

    await connectToDatabase();

    const config = await UserWebsiteConfig.findOne({ userId: auth.user._id });
    if (!config) {
      return NextResponse.json(
        { message: "No website configuration found for this account." },
        { status: 404 }
      );
    }

    // Locate target revision strictly bound to the authenticated user's ID
    const query: Record<string, any> = { userId: auth.user._id };
    if (revisionId) {
      query._id = revisionId;
    } else if (typeof revisionNumber === "number") {
      query.revisionNumber = revisionNumber;
    }

    const targetRevision = await PublishedProfileRevision.findOne(query);

    if (!targetRevision) {
      return NextResponse.json(
        { message: "Target revision was not found or does not belong to your account." },
        { status: 404 }
      );
    }

    // Ensure the revision belongs to this specific website configuration
    if (String(targetRevision.websiteConfigId) !== String(config._id)) {
      return NextResponse.json(
        { message: "Target revision does not match your active website configuration." },
        { status: 400 }
      );
    }

    // Verify snapshot integrity and central template registry approval before activating
    if (
      !targetRevision.snapshot ||
      !targetRevision.snapshot.meta ||
      targetRevision.snapshot.meta.schemaVersion !== PUBLIC_PROFILE_SCHEMA_VERSION
    ) {
      return NextResponse.json(
        { message: "Target revision snapshot is corrupted or invalid." },
        { status: 400 }
      );
    }

    const templateValidation = await validateEligibleTemplateSelection(
      targetRevision.templateId,
      targetRevision.templateVersion,
      PUBLIC_PROFILE_SCHEMA_VERSION
    );

    if (!templateValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          code: templateValidation.code,
          message: `Rollback validation failed: Target template version is no longer approved or compatible: ${templateValidation.error}`,
          errors: {
            template: templateValidation.error,
          },
        },
        { status: 400 }
      );
    }

    // Verify target revision checksum integrity matches stored snapshot data
    if (!verifyPublishedRevisionIntegrity(targetRevision)) {
      return NextResponse.json(
        {
          success: false,
          code: "REVISION_INTEGRITY_MISMATCH",
          message: `Cannot rollback to revision #${targetRevision.revisionNumber}: Revision data integrity check failed.`,
        },
        { status: 400 }
      );
    }

    // Atomically activate target historical revision
    config.activeRevisionId = targetRevision._id;
    config.selectedTemplateId = targetRevision.templateId;
    config.selectedTemplateVersion = targetRevision.templateVersion;

    // Apply revision customization snapshot or explicit platform safe defaults if historical lacks customization
    config.customization = targetRevision.customization
      ? {
          accentColor: targetRevision.customization.accentColor || DEFAULT_WEBSITE_CUSTOMIZATION.accentColor,
          themeMode: targetRevision.customization.themeMode || DEFAULT_WEBSITE_CUSTOMIZATION.themeMode,
          visibleSections: Array.isArray(targetRevision.customization.visibleSections)
            ? [...targetRevision.customization.visibleSections]
            : [...(DEFAULT_WEBSITE_CUSTOMIZATION.visibleSections || [])],
        }
      : { ...DEFAULT_WEBSITE_CUSTOMIZATION };

    config.publishedAt = targetRevision.publishedAt;
    config.status = "published";

    await config.save();

    return NextResponse.json(
      {
        success: true,
        message: `Successfully rolled back to published revision #${targetRevision.revisionNumber}.`,
        activeRevision: {
          id: targetRevision._id,
          revisionNumber: targetRevision.revisionNumber,
          templateId: targetRevision.templateId,
          templateVersion: targetRevision.templateVersion,
          publishedAt: targetRevision.publishedAt,
          checksum: targetRevision.checksum,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
