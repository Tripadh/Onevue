import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import PublishedProfileRevision from "../../../../../models/PublishedProfileRevision";
import { toPublicProfileDTO } from "../../../../../lib/public-profile-dto";
import { loadWebsiteSource } from "../../../../../lib/domain-profile/website-source";
import {
  presentationForTemplate,
  getIdentityContract,
  getTemplate,
} from "../../../../../lib/templates/registry";
import type { IdentityName } from "../../../../../lib/templates/registry";
import * as identityWebsite from "../../../../../lib/website/identity-contract.js";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/student/website/preview
   Authenticated preview of the student's live editable draft as a public DTO
   ========================================================================= */

export async function GET(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) {
      return NextResponse.json({ message: auth.error }, { status: auth.status });
    }

    await connectToDatabase();

    const [website, config] = await Promise.all([
      loadWebsiteSource(auth.user, { mode: "preview" }),
      UserWebsiteConfig.findOne({ userId: auth.user._id }),
    ]);

    if (!website) {
      const domainIdentity = auth.user.identity && auth.user.identity !== "student";
      return NextResponse.json(
        {
          success: false,
          message: domainIdentity
            ? "Identity profile has not yet been initialized. Please save your profile first."
            : "Student identity profile has not yet been initialized. Please save your profile first.",
          errors: {
            profile: domainIdentity
              ? "No identity profile found for this account."
              : "No student profile found for this account.",
          },
        },
        { status: 400 }
      );
    }

    const profile = website.source;

    // Fallback username for preview if student hasn't claimed a website username yet
    const resolvedUsername =
      (config && config.username) ||
      (auth.user.name ? auth.user.name.toLowerCase().replace(/[^a-z0-9]/g, "") : "student");

    const storedTemplateId = String((config && config.selectedTemplateId) || "magicui-portfolio");
    const templateDefinition = getTemplate(storedTemplateId);
    // A row written before the registry existed may name a template this
    // deployment does not implement. Preview with the approved adapter and
    // never echo an unregistered id back to the renderer.
    const templateId = templateDefinition ? storedTemplateId : "magicui-portfolio";
    const templateVersion = templateDefinition
      ? String((config && config.selectedTemplateVersion) || templateDefinition.version)
      : "1.0.0";

    const dto = toPublicProfileDTO(profile, {
      username: resolvedUsername,
      canonicalUrl: config?.username ? `https://onevue.id/p/${config.username}` : undefined,
      templateId,
      templateVersion,
      user: { name: auth.user.name, profilePhotoKey: auth.user.profilePhotoKey },
      identity: website.identity,
      ownerId: String(auth.user._id),
      assetDelivery: "preview",
      recordIds: website.recordIds,
    });

    let customization;
    try {
      const stored =
        config?.customization && typeof (config.customization as { toObject?: () => object }).toObject === "function"
          ? (config.customization as { toObject: () => object }).toObject()
          : config?.customization || {};
      customization = presentationForTemplate(templateId, stored, website.identity as IdentityName);
    } catch {
      try {
        customization = presentationForTemplate(templateId, {}, website.identity as IdentityName);
      } catch {
        customization = config?.customization || {
          accentColor: "#3b82f6",
          themeMode: "system" as const,
          visibleSections: [],
          sectionOrder: [],
        };
      }
    }

    const identityContract = (() => {
      try {
        return getIdentityContract(website.identity as IdentityName);
      } catch {
        return getIdentityContract("student");
      }
    })();

    const draftSummary = identityWebsite.summarizeSections(
      website.identity,
      dto,
      customization && customization.visibleSections,
      templateDefinition ? templateDefinition.supportedSections : null
    );

    let activeRevision = null;
    let activeSummary = null;
    let activeRevisionMeta = null;
    if (config?.activeRevisionId) {
      activeRevision = await PublishedProfileRevision.findOne({
        _id: config.activeRevisionId,
        userId: auth.user._id,
        websiteConfigId: config._id,
      })
        .select("revisionNumber templateId templateVersion publishedAt snapshot presentation")
        .lean();
      if (activeRevision && activeRevision.snapshot) {
        const activeTemplate = getTemplate(activeRevision.templateId);
        const storedPresentation = activeRevision.presentation;
        const revisionVisible =
          storedPresentation && Array.isArray(storedPresentation.visibleSections)
            ? storedPresentation.visibleSections
            : identityWebsite.defaultVisibleFor(website.identity);
        activeSummary = identityWebsite.summarizeSections(
          website.identity,
          activeRevision.snapshot,
          revisionVisible,
          activeTemplate ? activeTemplate.supportedSections : null
        );
        activeRevisionMeta = {
          id: String(activeRevision._id),
          revisionNumber: activeRevision.revisionNumber,
          templateId: activeRevision.templateId,
          templateVersion: activeRevision.templateVersion,
          publishedAt: activeRevision.publishedAt,
          sections: activeSummary.sections,
        };
      }
    }

    const response = NextResponse.json(
      {
        success: true,
        preview: true,
        identity: website.identity,
        contract: identityContract,
        dto,
        summary: { draft: draftSummary, active: activeSummary },
        activeRevision: activeRevisionMeta,
        config: {
          username: config?.username || null,
          selectedTemplateId: templateId,
          selectedTemplateVersion: templateVersion,
          customization,
          status: config?.status || "draft",
          activeRevisionId: config?.activeRevisionId || null,
        },
      },
      { status: 200 }
    );

    // Strict non-cacheable headers for authenticated draft preview
    response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ message }, { status: 500 });
  }
}
