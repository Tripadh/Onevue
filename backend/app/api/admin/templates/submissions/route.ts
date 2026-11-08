import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";
import User from "../../../../../models/User";
import { isSubmissionRetryEligible } from "../../../../../lib/template-submission";
import {
  describeCatalogEligibility,
  deriveProvisioningMode,
} from "../../../../../lib/template-registry-extension";
import { sanitizeAuditReport } from "../../../../../lib/template-audit-report";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/admin/templates/submissions
   Read-only status surface for the administrator submission workflow.
   Returns repository identity, pinned commit, processing stages, audit
   outcome, produced version and failure reasons. Never exposes GitHub
   credentials or internal filesystem paths.
   ========================================================================= */

function sanitizeStage(stage: any) {
  return {
    stage: stage?.stage,
    status: stage?.status,
    detail: typeof stage?.detail === "string" ? stage.detail : undefined,
    at: stage?.at,
  };
}

/**
 * Production evidence, read off the persisted lifecycle record. `framework` and
 * adaptation evidence only exist for releases the pipeline actually processed,
 * so an absent block here is itself the finding an admin needs.
 */
function summarizeEvidence(record: any) {
  const provisioning = record.provisioningRecord || {};
  const provenance = provisioning.provenance || {};
  const lifecycle = provenance.lifecycle || null;
  const adaptation = lifecycle?.adaptation || null;
  const manifest = lifecycle?.manifest || null;
  const provisioningMode = deriveProvisioningMode(record);

  return {
    provisioningMode,
    provisioningIsMock: provisioningMode === "mock_local",
    lifecycle: lifecycle
      ? {
          status: lifecycle.status || null,
          failedStage: lifecycle.failedStage || null,
          error: typeof lifecycle.error === "string" && lifecycle.error ? lifecycle.error.slice(0, 500) : null,
          sourceCommitSha: lifecycle.sourceCommitSha || null,
          updatedAt: lifecycle.updatedAt || null,
        }
      : null,
    adaptation: adaptation
      ? {
          status: adaptation.status,
          framework: adaptation.framework || null,
          packageManager: adaptation.packageManager || null,
          entrypoint: adaptation.entrypoint || null,
          expectedArtifactPath: adaptation.expectedArtifactPath || null,
          targetDtoVersion: adaptation.targetDtoVersion || null,
          createdFileCount: adaptation.createdFileCount ?? null,
          modifiedFileCount: adaptation.modifiedFileCount ?? null,
          completedAt: adaptation.completedAt || null,
        }
      : null,
    artifact: manifest
      ? {
          manifestSha256: lifecycle?.manifestSha256 || manifest.manifestSha256 || null,
          totalFiles: typeof manifest.totalFiles === "number" ? manifest.totalFiles : (Array.isArray(manifest.files) ? manifest.files.length : null),
          totalBytes: typeof manifest.totalBytes === "number" ? manifest.totalBytes : null,
          entrypoint: manifest.entrypoint || null,
          supportedDtoVersions: Array.isArray(manifest.supportedDtoVersions) ? manifest.supportedDtoVersions : [],
          sourceCommitSha: manifest.sourceCommitSha || null,
          builtAt: manifest.builtAt || null,
          // The release-relative path only: never a host filesystem location.
          artifactPath: `templates/${record.templateId}/${record.templateVersion}`,
        }
      : null,
  };
}

function sanitizeRecord(record: any, extras: { reviewer?: any; eligibility?: any } = {}) {
  const evidence = summarizeEvidence(record);
  const reviewDecision = record.reviewDecision
    ? {
        decision: record.reviewDecision.decision,
        reason: record.reviewDecision.reason,
        reviewerUserId: record.reviewDecision.reviewerUserId ? String(record.reviewDecision.reviewerUserId) : undefined,
        timestamp: record.reviewDecision.timestamp,
      }
    : undefined;

  return {
    ingestionId: record.ingestionId,
    repositoryKey: record.repositoryKey || "",
    sourceUrl: record.sourceUrl,
    requestedRef: record.requestedRef || undefined,
    commitSha: record.commitSha,
    previousCommitSha: record.previousCommitSha || undefined,
    previousVersion: record.previousVersion || undefined,
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    framework: evidence.adaptation?.framework ?? null,
    auditOutcome: record.auditReport?.outcome,
    auditReport: sanitizeAuditReport(record.auditReport),
    reviewStatus: record.status,
    reviewDecision,
    reviewer: extras.reviewer
      ? {
          id: String(extras.reviewer._id),
          name: extras.reviewer.name || null,
          email: extras.reviewer.email || null,
          role: extras.reviewer.role || null,
        }
      : undefined,
    decidedAt: record.reviewDecision?.timestamp || null,
    submissionStatus: record.submissionStatus || "",
    catalogEligible: extras.eligibility ? extras.eligibility.eligible : record.submissionStatus === "catalog_eligible",
    catalogBlockers: extras.eligibility ? extras.eligibility.blockers : undefined,
    provisioningMode: evidence.provisioningMode,
    provisioningIsMock: evidence.provisioningIsMock,
    lifecycle: evidence.lifecycle,
    adaptation: evidence.adaptation,
    artifact: evidence.artifact,
    currentStage: (() => {
      const stages = Array.isArray(record.stages) ? record.stages : [];
      return stages.length ? stages[stages.length - 1].stage : undefined;
    })(),
    retryEligible: isSubmissionRetryEligible(
      record,
      Boolean(extras.eligibility?.eligible ?? record.submissionStatus === "catalog_eligible")
    ),
    sourceAuthMode: record.sourceAuthMode,
    // The retained source snapshot is inspected read-only; only its identity
    // is exposed, never a host path.
    sourceSnapshotId: record.sourceSnapshot?.snapshotId || undefined,
    stages: Array.isArray(record.stages) ? record.stages.map(sanitizeStage) : [],
    destinationUrl: record.provisioningRecord?.destinationUrl || undefined,
    error: record.error || record.provisioningRecord?.error || undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Reviewer identities are resolved in one query for the whole page. Only the
 * name, email and role are returned — never hashes or tokens.
 */
async function loadReviewers(records: any[]): Promise<Map<string, any>> {
  const UserModel = (User as any).default || User;
  const ids = [...new Set(
    records
      .map((r) => r.reviewDecision?.reviewerUserId)
      .filter(Boolean)
      .map((id) => String(id))
  )];
  if (ids.length === 0 || typeof UserModel?.find !== "function") return new Map();
  try {
    const rows = await UserModel.find({ _id: { $in: ids } }).select("name email role").lean();
    return new Map((rows || []).map((u: any) => [String(u._id), u]));
  } catch {
    return new Map();
  }
}

/**
 * Eligibility is only worth computing at full cost for releases a student could
 * possibly see; every other record already has a decisive blocker upstream.
 */
async function loadEligibilities(records: any[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (const record of records) {
    if (record.status !== "approved") {
      map.set(record.ingestionId, {
        eligible: false,
        blockers: [{ code: "REVIEW_NOT_APPROVED", message: `Review status is '${record.status}'; the release was never approved.` }],
        storageValidated: false,
      });
      continue;
    }
    try {
      map.set(record.ingestionId, await describeCatalogEligibility(record));
    } catch (err) {
      map.set(record.ingestionId, {
        eligible: false,
        blockers: [{ code: "ARTIFACT_MANIFEST_MISSING", message: err instanceof Error ? err.message : String(err) }],
        storageValidated: false,
      });
    }
  }
  return map;
}

export async function GET(req: Request) {
  try {
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) {
      // The code matches the status: a caller who could not be authenticated is
      // told to authenticate, a caller who is authenticated but is not an
      // administrator is told they are not permitted.
      return json(
        req,
        {
          success: false,
          code: authResult.status === 401 ? "UNAUTHENTICATED" : "ADMIN_ONLY",
          message: authResult.error,
        },
        { status: authResult.status }
      );
    }

    const url = new URL(req.url);
    const ingestionId = url.searchParams.get("ingestionId");
    const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") || "25", 10) || 25, 1), 100);

    await connectToDatabase();
    const ReviewModel = (TemplateIngestionReview as any).default || TemplateIngestionReview;

    if (ingestionId) {
      const record = await ReviewModel.findOne({ ingestionId }).lean();
      if (!record) {
        return json(req, { success: false, message: `Submission '${ingestionId}' was not found.` }, { status: 404 });
      }
      const reviewers = await loadReviewers([record]);
      const eligibilities = await loadEligibilities([record]);
      return json(req, {
        success: true,
        submission: sanitizeRecord(record, {
          reviewer: record.reviewDecision?.reviewerUserId
            ? reviewers.get(String(record.reviewDecision.reviewerUserId))
            : undefined,
          eligibility: eligibilities.get(record.ingestionId),
        }),
      });
    }

    // Repository lease documents are internal coordination rows, not submissions.
    const query = ReviewModel.find({ submissionStatus: { $ne: "repository_lock" } })
      .sort({ createdAt: -1 })
      .limit(limit);
    const rows = query && typeof query.lean === "function" ? await query.lean() : await query;
    const list = Array.isArray(rows) ? rows : [];
    const reviewers = await loadReviewers(list);
    const eligibilities = await loadEligibilities(list);

    return json(req, {
      success: true,
      count: list.length,
      submissions: list.map((record: any) => sanitizeRecord(record, {
        reviewer: record.reviewDecision?.reviewerUserId
          ? reviewers.get(String(record.reviewDecision.reviewerUserId))
          : undefined,
        eligibility: eligibilities.get(record.ingestionId),
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to read submissions.";
    return json(req, { success: false, message }, { status: 500 });
  }
}
