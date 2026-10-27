import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";
import { rollbackPresentation } from "../../../../../lib/templates/registry";

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

    // Verify snapshot integrity before activating
    if (
      !targetRevision.snapshot ||
      !targetRevision.snapshot.meta ||
      targetRevision.snapshot.meta.schemaVersion !== "1.0.0"
    ) {
      return NextResponse.json(
        { message: "Target revision snapshot is corrupted or invalid." },
        { status: 400 }
      );
    }

    // Atomically activate target historical revision.
    // Stored appearance is restored. A revision without that record uses the
    // template defaults, so a newer draft appearance is not applied to it.
    config.activeRevisionId = targetRevision._id;
    config.selectedTemplateId = targetRevision.templateId;
    config.selectedTemplateVersion = targetRevision.templateVersion;
    config.publishedAt = targetRevision.publishedAt;
    config.status = "published";
    const storedPresentation =
      targetRevision.presentation && typeof (targetRevision.presentation as { toObject?: () => object }).toObject === "function"
        ? (targetRevision.presentation as { toObject: () => object }).toObject()
        : targetRevision.presentation;
    try {
      config.customization = rollbackPresentation(storedPresentation, targetRevision.templateId);
      config.markModified("customization");
    } catch {
      /* Leave the current appearance draft when the stored record cannot be read. */
    }

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
