import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../cors";
import { ProfileValidationError } from "../domain-profile/validate";

const PRIVATE_CACHE = "private, no-store";

export function assetOptions(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

export function assetJson(req: Request, body: unknown, status = 200, cache = PRIVATE_CACHE) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", cache);
  if (cache.startsWith("private")) response.headers.set("Vary", "Authorization");
  return applyCorsHeaders(response, req.headers.get("origin"));
}

export function assetBytes(
  req: Request,
  body: Buffer,
  contentType: string,
  fileName: string,
  visibility: "public" | "private"
) {
  const safeName = fileName.replace(/["\r\n\\]/g, "") || "file";
  const cache = visibility === "public" ? "public, max-age=31536000, immutable" : PRIVATE_CACHE;
  const response = new Response(body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${visibility === "public" ? "inline" : "attachment"}; filename="${safeName}"`,
    },
  });
  if (visibility === "private") response.headers.set("Vary", "Authorization");
  return applyCorsHeaders(response, req.headers.get("origin"));
}

export function assetError(req: Request, error: unknown) {
  if (error instanceof ProfileValidationError || (error instanceof Error && error.name === "ProfileValidationError")) {
    const status = error instanceof ProfileValidationError ? error.status : 400;
    return assetJson(req, { message: error.message }, status);
  }
  const message = error instanceof Error ? error.message : "Internal server error";
  if (/Cloudflare R2|PROFILE_PHOTO_STORAGE|production storage/i.test(message)) {
    console.error(message);
    return assetJson(req, { message: "Object storage is not configured." }, 500);
  }
  console.error("Asset request failed:", message);
  return assetJson(req, { message: "Internal server error" }, 500);
}
