import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import { toPublicProfileDTO } from "../../../../../lib/public-profile-dto";
import { loadWebsiteSource } from "../../../../../lib/domain-profile/website-source";
import { presentationForTemplate } from "../../../../../lib/templates/registry";

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

    const templateId = (config && config.selectedTemplateId) || "magicui-portfolio";
    const templateVersion = (config && config.selectedTemplateVersion) || "1.0.0";

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

    let customization = config?.customization || {
      accentColor: "#3b82f6",
      themeMode: "system" as const,
      visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
    };
    try {
      const stored =
        config?.customization && typeof (config.customization as { toObject?: () => object }).toObject === "function"
          ? (config.customization as { toObject: () => object }).toObject()
          : config?.customization || {};
      customization = presentationForTemplate(templateId, stored);
    } catch {
      customization = config?.customization || customization;
    }

    const response = NextResponse.json(
      {
        success: true,
        preview: true,
        dto,
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
