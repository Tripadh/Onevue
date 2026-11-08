import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";
import { FileSystemSourceSnapshotStore } from "../../../../../lib/template-snapshot";
import { LocalFilesystemStorageAdapter } from "../../../../../lib/template-storage";
import { submitTemplateRepository } from "../../../../../lib/template-submission";
import type { BuildExecutor } from "../../../../../lib/template-build";
import { type ProvisioningExecutor, resolveProvisioningExecutor } from "../../../../../lib/template-provisioning";
import { createConfiguredBuildExecutor } from "../../../../../lib/template-build-runtime";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

const STATUS_BY_CODE: Record<string, number> = {
  OK: 201,
  EXISTING_INCOMPLETE: 409,
  DUPLICATE_REPOSITORY: 200,
  CONCURRENT_SUBMISSION: 409,
  BUILD_BOUNDARY_UNAVAILABLE: 503,
  PROVISIONING_UNAVAILABLE: 503,
  AUDIT_REJECTED: 422,
  REVIEW_REQUIRED: 422,
  INVALID_URL: 400,
  INVALID_INPUT: 400,
  RETRY_INELIGIBLE: 422,
  // The repository or reference could not be resolved: the source does not
  // exist, or the configured credential cannot see it.
  COMMIT_RESOLUTION_FAILED: 404,
  // The upstream source could not be retrieved: a download, timeout or
  // extraction failure. This is an infrastructure failure of the source
  // fetch, never an audit decision about the template.
  SOURCE_UNAVAILABLE: 502,
  VERSION_COLLISION: 409,
  TEMPLATE_IDENTITY_CONFLICT: 409,
};

/* =========================================================================
   POST /api/admin/templates/submit
   One administrator submission of a GitHub repository URL. Runs the whole
   workflow: validate -> pin commit -> duplicate check -> snapshot -> audit
   -> provisioning -> isolated build -> immutable storage -> catalog.
   ========================================================================= */

export async function POST(req: Request) {
  try {
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) {
      return json(req, { success: false, message: authResult.error }, { status: authResult.status });
    }
    const adminUser = authResult.user;

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return json(req, { success: false, message: "Malformed JSON payload in request body." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(req, { success: false, message: "Request body must be an object." }, { status: 400 });
    }

    const rawUrl = body.url || body.sourceUrl;
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!url) {
      return json(req, { success: false, message: "GitHub repository URL is required ('url' or 'sourceUrl')." }, { status: 400 });
    }

    const snapshotRoot = process.env.ONEVUE_SOURCE_SNAPSHOT_ROOT;
    const snapshotStore =
      (globalThis as any).__mockSourceSnapshotStore ||
      (snapshotRoot ? new FileSystemSourceSnapshotStore(snapshotRoot) : undefined);
    if (!snapshotStore) {
      return json(
        req,
        {
          success: false,
          code: "SOURCE_SNAPSHOT_STORAGE_UNCONFIGURED",
          message:
            "Source snapshot storage is not configured (ONEVUE_SOURCE_SNAPSHOT_ROOT); submissions cannot retain durable source.",
        },
        { status: 500 }
      );
    }

    // Only a preflight-verified runtime yields an executor; otherwise the
    // submission fails closed at BUILD_BOUNDARY and remains retryable.
    let buildExecutor = (globalThis as any).__mockBuildExecutor as BuildExecutor | undefined;
    if (!buildExecutor) {
      const configured = await createConfiguredBuildExecutor(process.env);
      buildExecutor = configured.executor;
    }

    let provisioningExecutor = (globalThis as any).__mockProvisioningExecutor as
      | ProvisioningExecutor
      | undefined;
    if (!provisioningExecutor) {
      const configured = resolveProvisioningExecutor(process.env);
      provisioningExecutor = configured.executor;
    }

    const result = await submitTemplateRepository(
      {
        url,
        requestedRef: typeof body.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined,
        pinnedSha: typeof body.commitSha === "string" && body.commitSha.trim() ? body.commitSha.trim() : undefined,
        explicitConfirmation: body.explicitConfirmation === true,
        policyOverride: body.policyOverride === true,
        retry: body.retry === true,
        reason: typeof body.reason === "string" ? body.reason : undefined,
        adminUserId: adminUser._id,
      },
      {
        reviewModel: (TemplateIngestionReview as any).default || TemplateIngestionReview,
        snapshotStore,
        storageAdapter: (globalThis as any).__mockStorageAdapter || new LocalFilesystemStorageAdapter(),
        fetchImpl: (globalThis as any).__mockFetch || globalThis.fetch,
        buildExecutor,
        provisioningExecutor,
        connect: connectToDatabase,
      }
    );

    const status = result.success ? STATUS_BY_CODE[result.code] || 200 : STATUS_BY_CODE[result.code] || 422;
    return json(req, result, { status });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Template submission failed.";
    return json(req, { success: false, code: "INTERNAL_ERROR", message }, { status: 500 });
  }
}
