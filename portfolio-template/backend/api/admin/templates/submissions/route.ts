import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";
import { isSubmissionRetryEligible } from "../../../../../lib/template-submission";

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

function sanitizeRecord(record: any) {
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
    auditOutcome: record.auditReport?.outcome,
    reviewStatus: record.status,
    submissionStatus: record.submissionStatus || "",
    catalogEligible: record.submissionStatus === "catalog_eligible",
    currentStage: (() => {
      const stages = Array.isArray(record.stages) ? record.stages : [];
      return stages.length ? stages[stages.length - 1].stage : undefined;
    })(),
    retryEligible: isSubmissionRetryEligible(
      record,
      record.submissionStatus === "catalog_eligible"
    ),
    sourceAuthMode: record.sourceAuthMode,
    stages: Array.isArray(record.stages) ? record.stages.map(sanitizeStage) : [],
    destinationUrl: record.provisioningRecord?.destinationUrl || undefined,
    error: record.error || record.provisioningRecord?.error || undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function GET(req: Request) {
  try {
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) {
      return json(req, { success: false, message: authResult.error }, { status: authResult.status });
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
      return json(req, { success: true, submission: sanitizeRecord(record) });
    }

    // Repository lease documents are internal coordination rows, not submissions.
    const query = ReviewModel.find({ submissionStatus: { $ne: "repository_lock" } })
      .sort({ createdAt: -1 })
      .limit(limit);
    const rows = query && typeof query.lean === "function" ? await query.lean() : await query;

    return json(req, {
      success: true,
      count: Array.isArray(rows) ? rows.length : 0,
      submissions: Array.isArray(rows) ? rows.map(sanitizeRecord) : [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to read submissions.";
    return json(req, { success: false, message }, { status: 500 });
  }
}
