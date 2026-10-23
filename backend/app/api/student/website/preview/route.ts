import { NextResponse } from "next/server";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import { toPublicProfileDTO } from "../../../../../lib/public-profile-dto";
import { loadWebsiteSource } from "../../../../../lib/domain-profile/website-source";

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
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

    const [websiteSource, config] = await Promise.all([
      loadWebsiteSource(auth.user),
      UserWebsiteConfig.findOne({ userId: auth.user._id }),
    ]);

    if (!websiteSource) {
      const isStudent = !auth.user.identity || auth.user.identity === "student";
      return NextResponse.json(
        {
          success: false,
          message: isStudent
            ? "Student identity profile has not yet been initialized. Please save your profile first."
            : "Your identity profile has not been saved yet. Please save your profile first.",
          errors: {
            profile: isStudent
              ? "No student profile found for this account."
              : "No identity profile found for this account.",
          },
        },
        { status: 400 }
      );
    }
    const profile = websiteSource.source;

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
      user: { name: auth.user.name },
    });

    const response = NextResponse.json(
      {
        success: true,
        preview: true,
        dto,
        config: {
          username: config?.username || null,
          selectedTemplateId: templateId,
          selectedTemplateVersion: templateVersion,
          customization: config?.customization || {
            accentColor: "#3b82f6",
            themeMode: "system",
            visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
          },
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
