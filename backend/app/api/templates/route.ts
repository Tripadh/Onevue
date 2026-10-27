import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../lib/cors";
import { listTemplates } from "../../../lib/templates/registry";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/**
 * Public capability list for the template registry.
 * Only registered templates are returned. magicui-portfolio is the test adapter.
 */
export function GET(req: Request) {
  const response = NextResponse.json(
    {
      success: true,
      templates: listTemplates(),
    },
    { status: 200 }
  );
  response.headers.set("Cache-Control", "public, max-age=300");
  return applyCorsHeaders(response, req.headers.get("origin"));
}
