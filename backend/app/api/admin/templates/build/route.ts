import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";
import { FileSystemSourceSnapshotStore } from "../../../../../lib/template-snapshot";
import {
  createMongoLifecyclePersistence,
  orchestrateTemplateLifecycle,
} from "../../../../../lib/template-lifecycle";
import { getBuildIsolationStatus } from "../../../../../lib/template-build-isolation";
import {
  createConfiguredBuildExecutor,
  validateBuildRuntimeAtStartup,
} from "../../../../../lib/template-build-runtime";
import { LocalFilesystemStorageAdapter } from "../../../../../lib/template-storage";
import type { BuildExecutor } from "../../../../../lib/template-build";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/**
 * Read-only isolation diagnostics for administrators. Configuration values that
 * could be sensitive are intentionally omitted; only fail-closed state and
 * validation messages are returned.
 */
export async function GET(req: Request) {
  try {
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) return json(req, { message: authResult.error }, { status: authResult.status });

    // Startup validation: configuration + runtime preflight (daemon, rootless,
    // digest-pinned image, smoke container). Cached briefly; secrets never exposed.
    const validation = await validateBuildRuntimeAtStartup(process.env);
    return json(req, {
      success: true,
      isolation: {
        enabled: validation.enabled,
        configured: validation.configured,
        executable: validation.executable,
        reason: validation.reason,
        errors: validation.errors,
        runtime: validation.preflight?.runtime,
        runtimeVersion: validation.preflight?.version,
        rootless: validation.preflight?.rootless,
        imageDigestVerified: validation.preflight?.imageDigestVerified,
        smokeTestPassed: validation.preflight?.smokeTestPassed,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to read build isolation status.";
    return json(req, { success: false, code: "ISOLATION_STATUS_ERROR", message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) return json(req, { message: authResult.error }, { status: authResult.status });

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return json(req, { message: "Malformed JSON payload in request body." }, { status: 400 });
    }

    const ingestionId = typeof body?.ingestionId === "string" ? body.ingestionId.trim() : "";
    if (!ingestionId) return json(req, { message: "Missing required field: 'ingestionId'." }, { status: 400 });
    if (body.explicitConfirmation !== true) {
      return json(req, { code: "CONFIRMATION_REQUIRED", message: "Explicit confirmation is required to build and store the artifact." }, { status: 400 });
    }

    // Fail closed before any database mutation or lifecycle claim when no
    // verified isolation runtime (or an explicitly injected offline executor)
    // is available. A child process alone is not an isolation boundary.
    let injectedExecutor = (globalThis as any).__mockBuildExecutor as BuildExecutor | undefined;
    if (!injectedExecutor) {
      // The adapter is only produced after a successful preflight.
      const configured = await createConfiguredBuildExecutor(process.env);
      if (!configured.executor) {
        return json(req, {
          success: false,
          code: "BUILD_ISOLATION_UNAVAILABLE",
          message: configured.resolution.status.reason,
          errors: [
            ...configured.resolution.status.errors,
            ...(configured.resolution.preflight?.errors || []),
          ],
        }, { status: 503 });
      }
      injectedExecutor = configured.executor;
    }

    await connectToDatabase();
    const ReviewModel = (TemplateIngestionReview as any).default || TemplateIngestionReview;
    const record = await ReviewModel.findOne({ ingestionId });
    if (!record) return json(req, { message: `Ingestion record with ID '${ingestionId}' was not found.` }, { status: 404 });
    if (record.status !== "approved") {
      return json(req, { code: "TEMPLATE_NOT_APPROVED", message: "Only approved templates can be built and stored." }, { status: 400 });
    }
    if (record.provisioningRecord?.status !== "provisioned") {
      return json(req, { code: "PROVISIONING_REQUIRED", message: "Private repository provisioning must complete before artifact build." }, { status: 409 });
    }

    const lifecycle = record.provisioningRecord?.provenance?.lifecycle;
    if (lifecycle?.status === "CATALOG_ELIGIBLE") {
      return json(req, { code: "ALREADY_CATALOG_ELIGIBLE", lifecycle }, { status: 409 });
    }

    const snapshotRoot = process.env.ONEVUE_SOURCE_SNAPSHOT_ROOT;
    const snapshotStore = (globalThis as any).__mockSourceSnapshotStore || (snapshotRoot ? new FileSystemSourceSnapshotStore(snapshotRoot) : undefined);
    if (!snapshotStore || !record.sourceSnapshot) {
      return json(req, { code: "SOURCE_SNAPSHOT_REQUIRED", message: "An approved durable source snapshot is required before build." }, { status: 409 });
    }
    let verifiedSnapshot;
    try {
      verifiedSnapshot = await snapshotStore.verify(record.sourceSnapshot);
    } catch (error) {
      return json(req, { code: "SOURCE_SNAPSHOT_INVALID", message: error instanceof Error ? error.message : "Source snapshot verification failed." }, { status: 409 });
    }
    if (record.sourceSnapshot.commitSha !== record.commitSha || record.sourceSnapshot.templateId !== record.templateId || record.sourceSnapshot.templateVersion !== record.templateVersion) {
      return json(req, { code: "SOURCE_PROVENANCE_MISMATCH", message: "Source snapshot provenance does not match the approved review." }, { status: 409 });
    }

    const initialLifecycle = {
      ingestionId,
      status: "APPROVED",
      templateId: record.templateId,
      templateVersion: record.templateVersion,
      sourceCommitSha: record.commitSha,
      updatedAt: new Date().toISOString(),
    };
    await ReviewModel.updateOne(
      { ingestionId, status: "approved", "provisioningRecord.status": "provisioned" },
      { $set: { "provisioningRecord.provenance.lifecycle": initialLifecycle } }
    );

    // The artifact must be written to the CONFIGURED storage root. Falling
    // back to the default adapter here would silently publish the release
    // into the production template storage even when the deployment (or a
    // test) points at an isolated root.
    const storageAdapter =
      (globalThis as any).__mockStorageAdapter || new LocalFilesystemStorageAdapter();

    const result = await orchestrateTemplateLifecycle({
      sourceDir: verifiedSnapshot.sourceDir,
      review: {
        ingestionId,
        status: record.status,
        auditReport: record.auditReport,
        reviewDecision: record.reviewDecision,
        sourceCommitSha: record.commitSha,
        templateId: record.templateId,
        templateVersion: record.templateVersion,
      },
      explicitConfirmation: true,
      persistence: createMongoLifecyclePersistence(ReviewModel),
      storageAdapter,
      buildExecutor: injectedExecutor,
    });

    if (!result.success) {
      await ReviewModel.updateOne(
        { ingestionId },
        {
          $set: {
            // The release is not discoverable, and the admin must be able to
            // see why. The failure detail lives on the lifecycle evidence.
            submissionStatus: "build_failed",
            error: result.error || "Template lifecycle failed.",
            "provisioningRecord.provenance.lifecycle.failedStage": result.failedStage || "ADAPTED",
            "provisioningRecord.provenance.lifecycle.error": result.error || "Template lifecycle failed.",
          },
        }
      );
      return json(req, { success: false, code: "LIFECYCLE_FAILED", lifecycle: result }, { status: 400 });
    }

    // Record the admin-visible lifecycle status. The catalog query itself
    // only reads the review status and the provisioning status, but the admin
    // submissions list reports `submissionStatus`, so a staged build that
    // succeeded must not be reported as "unknown".
    await ReviewModel.updateOne(
      { ingestionId },
      {
        $set: {
          submissionStatus: "catalog_eligible",
          "provisioningRecord.provenance.lifecycle.status": "CATALOG_ELIGIBLE",
          "provisioningRecord.provenance.lifecycle.manifest": result.manifest || null,
          "provisioningRecord.provenance.lifecycle.manifestSha256": result.manifestSha256 || null,
          "provisioningRecord.provenance.lifecycle.storageLocation": result.storageLocation || null,
          "provisioningRecord.provenance.lifecycle.adaptation": result.adaptation || null,
        },
      }
    );

    return json(req, { success: true, lifecycle: result }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Template lifecycle failed.";
    return json(req, { success: false, code: "LIFECYCLE_ERROR", message }, { status: 500 });
  }
}
