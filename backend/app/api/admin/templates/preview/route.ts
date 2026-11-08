import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import { verifyAdminAuth } from "../../../../../lib/auth";
import { renderTemplatePreviewDocument } from "../../../../../lib/template-preview";

const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SEMVER_REGEX =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

function refusal(req: Request, status: number, message: string, code: string) {
  return applyCorsHeaders(
    NextResponse.json({ success: false, code, message }, { status }),
    req.headers.get("origin")
  );
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/admin/templates/preview?templateId=&templateVersion=

   Renders the stored release the way a student would receive it: the exact
   bytes the artifact delivery boundary released, with a representative DTO
   injected and asset URLs pointed back at the delivery API.

   Guarantees:
   - Administrator-only. The DTO is synthetic, so the endpoint adds no access
     beyond what the already-public artifact delivery route provides.
   - Read-only. No lifecycle, review, catalog or storage state is written.
   - Fail closed. An unverifiable release, a missing entrypoint or an injection
     integrity problem returns a typed refusal instead of a partial document.
   - No host paths or credentials appear in the response.
   ========================================================================= */

export async function GET(req: Request) {
  try {
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) {
      // The code matches the status: a caller who could not be authenticated is
      // told to authenticate, a caller who is authenticated but is not an
      // administrator is told they are not permitted.
      return refusal(
        req,
        authResult.status,
        authResult.error,
        authResult.status === 401 ? "UNAUTHENTICATED" : "ADMIN_ONLY"
      );
    }

    const url = new URL(req.url);
    const templateId = String(url.searchParams.get("templateId") || "").trim();
    const templateVersion = String(url.searchParams.get("templateVersion") || "").trim();

    if (!TEMPLATE_ID_REGEX.test(templateId) || !SEMVER_REGEX.test(templateVersion)) {
      return refusal(
        req,
        400,
        "A valid templateId and templateVersion are required to preview a release.",
        "INVALID_TEMPLATE_IDENTITY"
      );
    }

    const rendered = await renderTemplatePreviewDocument({
      templateId,
      templateVersion,
      origin: new URL(req.url).origin,
    });
    if (!rendered.ok) {
      return refusal(req, rendered.status, rendered.message, rendered.code);
    }

    return applyCorsHeaders(
      new NextResponse(rendered.html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // A preview is never cacheable and never indexable: it is not a
          // student-facing document and its payload is not a real profile.
          "Cache-Control": "no-store, max-age=0",
          "X-Robots-Tag": "noindex, nofollow, noarchive",
          "X-OneVue-Preview": "representative-dto",
          "X-OneVue-Template-Id": templateId,
          "X-OneVue-Template-Version": templateVersion,
          "X-OneVue-Artifact-Manifest-Sha256": rendered.manifestSha256,
          "X-OneVue-Preview-Assets-Rebased": String(rendered.assetsRebased),
        },
      }),
      req.headers.get("origin")
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to build the template preview.";
    return refusal(req, 500, message, "PREVIEW_FAILED");
  }
}
