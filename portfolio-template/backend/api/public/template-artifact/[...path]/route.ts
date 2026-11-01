import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import {
  deliverTemplateAsset,
  NO_STORE_CACHE_CONTROL,
  parseArtifactDeliveryPath,
  readDeliveredAsset,
} from "../../../../../lib/template-artifact-delivery";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/public/template-artifact/[...path]
   OneVue Phase 5.14 — the backend's artifact delivery API.

   Path shape: <templateId>/<templateVersion>/<relativeAssetPath...>

   This is the only endpoint that turns stored template artifacts into served
   bytes. It delegates every decision to backend/lib/template-artifact-delivery
   (identity, traversal, manifest validation, per-file SHA-256, content type,
   cache headers), so the portfolio visitor path can be a thin consumer of it
   instead of a second implementation of the same rules.

   Guarantees:
   - Delivers bytes only from the artifact storage adapter.
   - Refuses traversal, absolute paths, malformed identities, unknown
     templates, unknown versions, uninventoried assets and tampered files.
   - Fails closed: no alternative release is ever substituted.
   ========================================================================= */

interface TemplateArtifactRouteContext {
  params: Promise<{ path?: string[] }>;
}

export async function GET(req: Request, context: TemplateArtifactRouteContext) {
  const { path: segments } = await context.params;

  const request = parseArtifactDeliveryPath(segments || []);
  if (!request) {
    return NextResponse.json(
      {
        success: false,
        failure: "UNSAFE_PATH",
        message:
          "Template artifact requests must be addressed as <templateId>/<templateVersion>/<assetPath>.",
      },
      { status: 400, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }

  const delivery = await deliverTemplateAsset(request);

  if (!delivery.ok) {
    return NextResponse.json(
      { success: false, failure: delivery.failure, message: delivery.error },
      { status: delivery.httpStatus, headers: { "Cache-Control": NO_STORE_CACHE_CONTROL } }
    );
  }

  const body = await readDeliveredAsset(delivery);

  return applyCorsHeaders(
    new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": delivery.contentType,
        "Content-Length": String(body.byteLength),
        "Cache-Control": delivery.cacheControl,
        ETag: `"${delivery.sha256}"`,
        "X-OneVue-Template-Id": delivery.templateId,
        "X-OneVue-Template-Version": delivery.templateVersion,
        "X-OneVue-Artifact-Manifest-Sha256": delivery.manifestSha256,
      },
    }),
    req.headers.get("origin")
  );
}
