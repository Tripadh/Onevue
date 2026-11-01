import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";
import {
  createProvisioningPlan,
  executeProvisioningPlan,
  LiveGitHubProvisioningExecutor,
  MockProvisioningExecutor,
  FIXED_DESTINATION_ORG,
} from "../../../../../lib/template-provisioning";
import { getGitHubProvisioningConfig } from "../../../../../lib/github-api-client";
import * as fs from "node:fs";
import * as path from "node:path";
import { FileSystemSourceSnapshotStore } from "../../../../../lib/template-snapshot";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   POST /api/admin/templates/provision
   Secure administrative endpoint for provisioning an approved template
   into a dedicated private repository under the qubort-tech organization.
   ========================================================================= */

export async function POST(req: Request) {
  try {
    // 1. Enforce administrative authorization
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) {
      return json(req, { message: authResult.error }, { status: authResult.status });
    }

    // 2. Parse request body
    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return json(req, { message: "Malformed JSON payload in request body." }, { status: 400 });
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(req, { message: "Request body must be an object." }, { status: 400 });
    }

    const { ingestionId, destinationRepo, explicitConfirmation } = body;

    if (!ingestionId || typeof ingestionId !== "string" || !ingestionId.trim()) {
      return json(req, { message: "Missing required field: 'ingestionId'." }, { status: 400 });
    }

    const cleanIngestionId = ingestionId.trim();

    if (!destinationRepo || typeof destinationRepo !== "string" || !destinationRepo.trim()) {
      return json(req, { message: "Missing required field: 'destinationRepo'." }, { status: 400 });
    }

    const cleanDestRepo = destinationRepo.trim();

    if (explicitConfirmation !== true) {
      return json(
        req,
        {
          success: false,
          code: "CONFIRMATION_REQUIRED",
          message: "Explicit confirmation ('explicitConfirmation': true) is required to provision a repository.",
        },
        { status: 400 }
      );
    }

    await connectToDatabase();
    const ReviewModel = (TemplateIngestionReview as any).default || TemplateIngestionReview;

    // 3. Load trusted ingestion review record
    const record = await ReviewModel.findOne({ ingestionId: cleanIngestionId });
    if (!record) {
      return json(
        req,
        { success: false, message: `Ingestion record with ID '${cleanIngestionId}' was not found.` },
        { status: 404 }
      );
    }

    // 4. Verify human approval status
    if (record.status !== "approved") {
      return json(
        req,
        {
          success: false,
          code: "TEMPLATE_NOT_APPROVED",
          message: `Cannot provision template: Review status is '${record.status}'. Only 'approved' templates can be provisioned.`,
        },
        { status: 400 }
      );
    }

    // 5. Verify audit report compliance
    const auditOutcome = record.auditReport?.outcome;
    if (auditOutcome === "REJECT") {
      return json(
        req,
        {
          success: false,
          code: "AUDIT_REJECTED",
          message: "Cannot provision template: Automated security/license audit outcome is 'REJECT'.",
        },
        { status: 400 }
      );
    }

    // If REVIEW_REQUIRED, ensure human decision recorded an explicit override
    if (auditOutcome === "REVIEW_REQUIRED") {
      const decision = record.reviewDecision;
      if (!decision || !decision.reason) {
        return json(
          req,
          {
            success: false,
            code: "APPROVAL_REASON_MISSING",
            message: "Cannot provision template: Review required audit outcome lacks an approved justification reason.",
          },
          { status: 400 }
        );
      }
    }

    // 6. Check existing provisioning status (Idempotency check)
    if (record.provisioningRecord?.status === "provisioned") {
      return json(
        req,
        {
          success: false,
          code: "ALREADY_PROVISIONED",
          message: `Template has already been provisioned into '${record.provisioningRecord.destinationOrg}/${record.provisioningRecord.destinationRepo}'.`,
        },
        { status: 409 }
      );
    }

    let extractedDir = typeof (record as any).extractedDir === "string"
      ? path.resolve((record as any).extractedDir)
      : "";
    if (record.sourceSnapshot) {
      const snapshotRoot = process.env.ONEVUE_SOURCE_SNAPSHOT_ROOT;
      const snapshotStore = (globalThis as any).__mockSourceSnapshotStore || (snapshotRoot ? new FileSystemSourceSnapshotStore(snapshotRoot) : undefined);
      if (!snapshotStore) {
        return json(req, { success: false, code: "SOURCE_SNAPSHOT_STORAGE_UNCONFIGURED", message: "Configured source snapshot storage is required." }, { status: 500 });
      }
      try {
        const verifiedSnapshot = await snapshotStore.verify(record.sourceSnapshot);
        extractedDir = verifiedSnapshot.sourceDir;
      } catch (error) {
        return json(req, { success: false, code: "SOURCE_SNAPSHOT_INVALID", message: error instanceof Error ? error.message : "Source snapshot verification failed." }, { status: 409 });
      }
    }
    if (!extractedDir || !fs.existsSync(extractedDir) || !fs.statSync(extractedDir).isDirectory()) {
      return json(
        req,
        {
          success: false,
          code: "SOURCE_SNAPSHOT_REQUIRED",
          message: "Provisioning requires an explicitly owned extracted source snapshot. No temporary-directory fallback is permitted.",
        },
        { status: 409 }
      );
    }

    // 7. Atomic state transition to prevent concurrent race conditions
    const atomicClaim = await ReviewModel.findOneAndUpdate(
      {
        ingestionId: cleanIngestionId,
        status: "approved",
        $or: [
          { "provisioningRecord.status": "unprovisioned" },
          { "provisioningRecord.status": "failed" },
          { "provisioningRecord.status": { $exists: false } },
          { provisioningRecord: null },
        ],
      },
      {
        $set: {
          "provisioningRecord.status": "in_progress",
          "provisioningRecord.destinationOrg": FIXED_DESTINATION_ORG,
          "provisioningRecord.destinationRepo": cleanDestRepo,
        },
      },
      { new: true }
    );

    if (!atomicClaim) {
      return json(
        req,
        {
          success: false,
          code: "CONCURRENT_PROVISIONING",
          message: "Provisioning is already in progress or has been finalized by another request.",
        },
        { status: 409 }
      );
    }

    // 8. Generate provisioning plan server-side from the trusted extracted source
    const plan = createProvisioningPlan({
      sourceUrl: record.sourceUrl,
      commitSha: record.commitSha,
      templateId: record.templateId || cleanDestRepo,
      templateVersion: record.templateVersion || "1.0.0",
      auditReport: record.auditReport,
      destinationRepo: cleanDestRepo,
      explicitApproval: true,
      approvalReason: record.reviewDecision?.reason,
      explicitConfirmation: true,
      sourceDir: extractedDir,
    });

    if (!plan.valid) {
      await ReviewModel.updateOne(
        { ingestionId: cleanIngestionId },
        {
          $set: {
            "provisioningRecord.status": "failed",
            "provisioningRecord.error": plan.error,
            "provisioningRecord.errorCategory": "PLANNING_FAILED",
          },
        }
      );
      return json(req, { success: false, code: "PLAN_FAILED", message: plan.error }, { status: 400 });
    }

    // 9. Resolve Executor (Injected mock or Live Executor guarded by server configuration)
    let executor = (globalThis as any).__mockProvisioningExecutor;

    if (!executor) {
      const config = getGitHubProvisioningConfig();
      if (!config.liveEnabled) {
        await ReviewModel.updateOne(
          { ingestionId: cleanIngestionId },
          {
            $set: {
              "provisioningRecord.status": "unprovisioned",
              "provisioningRecord.error": "Live GitHub provisioning is disabled by server configuration.",
            },
          }
        );
        return json(
          req,
          {
            success: false,
            code: "LIVE_PROVISIONING_DISABLED",
            message: "Live GitHub provisioning is disabled by server configuration (ENABLE_LIVE_GITHUB_PROVISIONING != true).",
          },
          { status: 400 }
        );
      }

      if (!config.configured) {
        await ReviewModel.updateOne(
          { ingestionId: cleanIngestionId },
          {
            $set: {
              "provisioningRecord.status": "failed",
              "provisioningRecord.error": config.error,
              "provisioningRecord.errorCategory": "CONFIG_ERROR",
            },
          }
        );
        return json(
          req,
          {
            success: false,
            code: "CONFIG_ERROR",
            message: config.error || "GitHub provisioning credential is not configured.",
          },
          { status: 500 }
        );
      }

      executor = new LiveGitHubProvisioningExecutor();
    }

    // 10. Execute Provisioning Plan
    const result = await executeProvisioningPlan(plan, executor);

    if (!result.success) {
      await ReviewModel.updateOne(
        { ingestionId: cleanIngestionId },
        {
          $set: {
            "provisioningRecord.status": "failed",
            "provisioningRecord.error": result.error,
            "provisioningRecord.errorCategory": result.errorCategory || "EXECUTION_FAILED",
          },
        }
      );

      const status = result.errorCategory === "COLLISION" ? 409 : 400;
      return json(
        req,
        {
          success: false,
          code: result.errorCategory || "PROVISIONING_FAILED",
          message: result.error || "Repository provisioning failed.",
        },
        { status }
      );
    }

    // 11. Record Successful Provisioning State
    const destinationUrl = `https://github.com/${result.destinationOrg}/${result.destinationRepo}`;
    await ReviewModel.updateOne(
      { ingestionId: cleanIngestionId },
      {
        $set: {
          "provisioningRecord.status": "provisioned",
          "provisioningRecord.destinationOrg": result.destinationOrg,
          "provisioningRecord.destinationRepo": result.destinationRepo,
          "provisioningRecord.destinationUrl": destinationUrl,
          "provisioningRecord.visibility": "private",
          "provisioningRecord.provisionedAt": new Date(),
          "provisioningRecord.provenance": result.provenance,
          "provisioningRecord.error": "",
        },
      }
    );

    return json(
      req,
      {
        success: true,
        message: `Template successfully provisioned to private repository '${result.destinationOrg}/${result.destinationRepo}'.`,
        provisioning: {
          destinationOrg: result.destinationOrg,
          destinationRepo: result.destinationRepo,
          destinationUrl,
          visibility: "private",
          provenance: result.provenance,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    console.error("PROVISION_ROUTE_ERROR:", error);
    return json(req, { message }, { status: 500 });
  }
}
