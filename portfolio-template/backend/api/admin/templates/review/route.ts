import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   POST /api/admin/templates/review
   Secure administrative endpoint for recording a human review decision
   on an ingested template audit report.
   ========================================================================= */

export async function POST(req: Request) {
  try {
    // 1. Enforce administrative authorization
    const authResult = await verifyAdminAuth(req);
    if ("error" in authResult) {
      return json(req, { message: authResult.error }, { status: authResult.status });
    }
    const adminUser = authResult.user;

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

    const { ingestionId, decision, reason, policyOverride } = body;

    if (!ingestionId || typeof ingestionId !== "string" || !ingestionId.trim()) {
      return json(req, { message: "Missing required field: 'ingestionId'." }, { status: 400 });
    }

    const cleanDecision = String(decision || "").toLowerCase().trim();
    if (cleanDecision !== "approve" && cleanDecision !== "reject") {
      return json(req, { message: "Invalid decision value. Must be 'approve' or 'reject'." }, { status: 400 });
    }

    await connectToDatabase();

    const ReviewModel = (TemplateIngestionReview as any).default || TemplateIngestionReview;

    // 3. Locate ingestion review record
    const record = await ReviewModel.findOne({ ingestionId: ingestionId.trim() });
    if (!record) {
      return json(req, { message: `Ingestion record with ID '${ingestionId}' was not found.` }, { status: 404 });
    }

    // 4. Reject duplicate / conflicting decision attempts on finalized records
    if (record.status !== "pending_review") {
      return json(
        req,
        {
          success: false,
          code: "DECISION_ALREADY_RECORDED",
          message: `Review decision has already been finalized as '${record.status}'. Re-reviewing is prohibited.`,
        },
        { status: 409 }
      );
    }

    const auditOutcome = record.auditReport?.outcome;

    // 5. Decision Policy Enforcement
    if (cleanDecision === "reject") {
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        return json(req, { message: "A non-empty reason is required when rejecting a template." }, { status: 400 });
      }

      record.status = "rejected";
      record.reviewDecision = {
        decision: "reject",
        reviewerUserId: adminUser._id,
        reason: reason.trim(),
        timestamp: new Date(),
      };
    } else if (cleanDecision === "approve") {
      // Rule: Cannot approve a template that received REJECT audit outcome
      if (auditOutcome === "REJECT") {
        return json(
          req,
          {
            success: false,
            code: "AUDIT_REJECTED",
            message: "Cannot approve a template whose automated audit outcome is 'REJECT'. Critical policy violations must be resolved first.",
          },
          { status: 400 }
        );
      }

      // Rule: If audit outcome is REVIEW_REQUIRED, policyOverride flag and reason are mandatory
      if (auditOutcome === "REVIEW_REQUIRED") {
        if (policyOverride !== true) {
          return json(
            req,
            {
              success: false,
              code: "POLICY_OVERRIDE_REQUIRED",
              message: "Audit outcome is 'REVIEW_REQUIRED'. Explicit policy override ('policyOverride': true) and a justification reason are required to approve.",
            },
            { status: 400 }
          );
        }
        if (!reason || typeof reason !== "string" || !reason.trim()) {
          return json(
            req,
            {
              success: false,
              message: "A justification reason is required when approving a template with 'REVIEW_REQUIRED' audit outcome.",
            },
            { status: 400 }
          );
        }
      }

      record.status = "approved";
      record.reviewDecision = {
        decision: "approve",
        reviewerUserId: adminUser._id,
        reason: reason ? String(reason).trim() : undefined,
        timestamp: new Date(),
      };
    }

    await record.save();

    return json(
      req,
      {
        success: true,
        message: `Review decision '${record.status}' recorded successfully.`,
        review: {
          ingestionId: record.ingestionId,
          status: record.status,
          decision: record.reviewDecision,
          updatedAt: record.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}
