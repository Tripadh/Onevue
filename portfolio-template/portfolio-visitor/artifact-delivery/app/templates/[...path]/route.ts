/**
 * =========================================================================
 * OneVue Phase 5.14 — Template Asset Delivery Route
 * =========================================================================
 *
 * URL shape: /templates/<templateId>/<templateVersion>/<relativeAssetPath>
 *
 * This route is a THIN consumer of the backend artifact delivery boundary. It
 * contains no storage-root resolution, no manifest parsing and no integrity
 * rules: those live in backend/lib/template-artifact-delivery.ts and are
 * reached through the delivery API (or its in-process equivalent when the
 * backend is not running as a separate process).
 *
 *   Visitor -> this route -> backend artifact delivery -> TemplateStorageAdapter
 *
 * Consequences:
 * - The template identity and version are taken from the URL, which the
 *   renderer derives from the published revision. Nothing is guessed and
 *   nothing is substituted.
 * - A missing artifact, missing manifest, invalid manifest or failed SHA-256
 *   check is refused with the backend's own status. Another template or
 *   release is never served in its place.
 *
 * Built-in templates (magicui-portfolio) are registry-pinned and ship with
 * this application, so they keep resolving from the bundled static directory
 * through the same consumer without any backend dependency.
 */

import { NextResponse } from "next/server";
import {
  resolveTemplateAsset,
  REFUSAL_CACHE_CONTROL,
} from "@/lib/template-artifact-store";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

interface TemplateAssetRouteContext {
  params: Promise<{
    path?: string[];
  }>;
}

export async function GET(_request: Request, context: TemplateAssetRouteContext) {
  const { path: segments } = await context.params;

  if (!Array.isArray(segments) || segments.length < 3) {
    return NextResponse.json(
      { error: "Template asset not found." },
      { status: 404, headers: { "Cache-Control": REFUSAL_CACHE_CONTROL } }
    );
  }

  const [templateId, templateVersion, ...rest] = segments;
  const relativePath = rest.join("/");

  if (!relativePath) {
    return NextResponse.json(
      { error: "Template asset not found." },
      { status: 404, headers: { "Cache-Control": REFUSAL_CACHE_CONTROL } }
    );
  }

  const { asset, resolution } = await resolveTemplateAsset(
    templateId,
    templateVersion,
    relativePath
  );

  if (!asset) {
    return NextResponse.json(
      {
        error: resolution.error || "Template asset not found.",
        failure: resolution.failure,
      },
      { status: resolution.httpStatus, headers: { "Cache-Control": REFUSAL_CACHE_CONTROL } }
    );
  }

  return new NextResponse(new Uint8Array(asset.body), {
    status: 200,
    headers: {
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.body.byteLength),
      "Cache-Control": asset.cacheControl,
      "X-OneVue-Template-Id": asset.templateId,
      "X-OneVue-Template-Version": asset.templateVersion,
      "X-OneVue-Artifact-Transport": asset.transport,
    },
  });
}
