import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import {
  getIdentityContract,
  listIdentityContracts,
  listTemplates,
} from "../../../../lib/templates/registry";
import * as identityWebsite from "../../../../lib/website/identity-contract.js";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/**
 * GET /api/website/contract
 * Public, validated description of each identity's website sections, defaults,
 * readiness rules, and template compatibility. The dashboard and renderer read
 * this instead of declaring their own per-identity section lists.
 */
export function GET(req: Request) {
  try {
    identityWebsite.validateContract();
    const url = new URL(req.url);
    const requestedIdentity = url.searchParams.get("identity");
    const requestedTemplate = url.searchParams.get("templateId");
    const templates = listTemplates();
    const template = requestedTemplate
      ? templates.find((item) => item.id === requestedTemplate)
      : templates[0];
    if (!template) {
      return NextResponse.json(
        { success: false, message: `Template '${requestedTemplate}' is not registered.` },
        { status: 400 }
      );
    }

    const contracts = requestedIdentity
      ? [getIdentityContract(requestedIdentity as never, template.id)]
      : listIdentityContracts(template.id);

    const response = NextResponse.json(
      {
        success: true,
        version: 1,
        template: {
          id: template.id,
          version: template.version,
          supportedSections: template.supportedSections,
        },
        identities: identityWebsite.IDENTITIES,
        sections: identityWebsite.SECTION_CATALOG.map((section) => ({
          id: section.id,
          label: section.label,
          description: section.description,
          rendererSection: section.rendererSection,
          legacyIds: section.legacyIds,
          repeatable: section.repeatable,
          recordCustomFields: section.recordCustomFields,
          sectionCustomFields: section.sectionCustomFields,
        })),
        contracts,
      },
      { status: 200 }
    );
    response.headers.set("Cache-Control", "public, max-age=300");
    return applyCorsHeaders(response, req.headers.get("origin"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid contract request.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
