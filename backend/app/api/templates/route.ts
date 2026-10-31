import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../lib/cors";
import { listTemplates } from "../../../lib/templates/registry";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/**
 * Public capability list for the template registry.
 * Returns all templates including field type support information.
 */
export function GET(req: Request) {
  const backendTemplates = listTemplates();

  const response = NextResponse.json(
    {
      success: true,
      templates: backendTemplates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        version: t.version,
        role: t.role,
        supportedSections: t.supportedSections,
        supportedFieldTypes: t.supportedFieldTypes,
        hiddenFieldTypes: t.hiddenFieldTypes,
        identities: t.identities,
        presentation: {
          accentColor: t.presentation.accentColor,
          themeMode: t.presentation.themeMode,
          typography: t.presentation.typography,
          sectionVisibility: t.presentation.sectionVisibility,
          sectionOrder: t.presentation.sectionOrder,
          entryOrder: t.presentation.entryOrder,
        },
        media: {
          images: t.media.images,
          galleries: t.media.galleries,
          videoFile: t.media.videoFile,
          videoEmbed: t.media.videoEmbed,
          externalVideoUrl: t.media.externalVideoUrl,
          privateAssets: t.media.privateAssets,
        },
        limits: t.limits,
      })),
    },
    { status: 200 }
  );
  response.headers.set("Cache-Control", "public, max-age=300");
  return applyCorsHeaders(response, req.headers.get("origin"));
}
