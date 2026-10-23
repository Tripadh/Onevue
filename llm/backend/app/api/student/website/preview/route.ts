import { NextResponse } from "next/server";
import { preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAuth } from "../../../../../lib/auth";
import StudentProfile from "../../../../../models/StudentProfile";
import UserWebsiteConfig from "../../../../../models/UserWebsiteConfig";
import { toPublicProfileDTO } from "../../../../../lib/public-profile-dto";

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

    const [profile, config] = await Promise.all([
      StudentProfile.findOne({ userId: auth.user._id }),
      UserWebsiteConfig.findOne({ userId: auth.user._id }),
    ]);

    if (!profile) {
      return NextResponse.json(
        {
          success: false,
          message: "Student identity profile has not yet been initialized. Please save your profile first.",
          errors: {
            profile: "No student profile found for this account.",
          },
        },
        { status: 400 }
      );
    }

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
