import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../lib/cors";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/health
   Liveness probe for local development and deployment health checks.
   Deliberately does not touch MongoDB or artifact storage.
   ========================================================================= */

export async function GET(req: Request) {
  return applyCorsHeaders(
    NextResponse.json(
      {
        success: true,
        status: "ok",
        service: "onevue-backend",
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    ),
    req.headers.get("origin")
  );
}
