import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import { verifyAuth } from "../../../../../lib/auth";
import { renderTemplatePreviewDocument } from "../../../../../lib/template-preview";
import { validateEligibleTemplateSelection } from "../../../../../lib/template-registry-extension";
import { PUBLIC_PROFILE_SCHEMA_VERSION } from "../../../../../lib/public-profile-dto";

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
   GET /api/student/website/template-preview?templateId=&templateVersion=

   Lets a student see a candidate template before selecting it.

   Guarantees:
   - The release must pass the same production catalog eligibility gate the
     public catalog uses, so a pending, rejected, build-failed or
     mock-provisioned template cannot be previewed into existence.
   - The payload is OneVue's representative sample profile, never any real
     student's data, and never the template author's content.
   - Read-only. Nothing is written: no selection change, no draft update and no
     publication. Selecting a template remains a separate explicit PUT.
   - Rendered through the shared preview contract, so what a student sees is
     the same document an administrator sees and the same delivery path a
     visitor will use.
   ========================================================================= */

export async function GET(req: Request) {
  try {
    const auth = await verifyAuth(req);
    if ("error" in auth) {
      return refusal(req, auth.status, auth.error, "AUTH_REQUIRED");
    }

    const url = new URL(req.url);
    const templateId = String(url.searchParams.get("templateId") || "").trim();
    const templateVersion = String(url.searchParams.get("templateVersion") || "").trim();

    if (!TEMPLATE_ID_REGEX.test(templateId) || !SEMVER_REGEX.test(templateVersion)) {
      return refusal(
        req,
        400,
        "A valid templateId and templateVersion are required to preview a template.",
        "INVALID_TEMPLATE_IDENTITY"
      );
    }

    const eligibility = await validateEligibleTemplateSelection(
      templateId,
      templateVersion,
      PUBLIC_PROFILE_SCHEMA_VERSION
    );
    if (!eligibility.valid) {
      return refusal(
        req,
        404,
        eligibility.error || "That template release is not available for preview.",
        eligibility.code || "TEMPLATE_UNKNOWN"
      );
    }

    const rendered = await renderTemplatePreviewDocument({
      templateId,
      templateVersion,
      origin: url.origin,
    });
    if (!rendered.ok) {
      return refusal(req, rendered.status, rendered.message, rendered.code);
    }

    return applyCorsHeaders(
      new NextResponse(rendered.html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
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
