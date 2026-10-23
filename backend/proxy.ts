import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { applyCorsHeaders } from "./lib/cors";

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return applyCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  return applyCorsHeaders(NextResponse.next(), origin);
}

export const config = {
  matcher: "/api/:path*",
};
