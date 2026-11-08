import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";
import { FileSystemSourceSnapshotStore } from "../../../../../lib/template-snapshot";
import {
  inspectSourceSnapshot,
  readSourceSnapshotFile,
} from "../../../../../lib/template-source-inspection";
import { inspectSourceMetadata } from "../../../../../lib/github-ingestion";
import { sanitizeAuditReport } from "../../../../../lib/template-audit-report";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/admin/templates/source?ingestionId=&path=

   Read-only inspection of the source snapshot a submission retained.

   This is deliberately NOT the artifact preview. The artifact preview renders
   the built, DTO-adapted release a student would receive, so it can only
   answer for a release that was built. This endpoint answers for the source
   that was ingested, which is what an administrator has to judge while a
   submission is still awaiting review.

   Guarantees:
   - Administrator-only.
   - Nothing is executed: files are read as bytes and decoded as text.
   - The retained snapshot is verified before it is read.
   - No host filesystem path, credential or environment value is returned.
   ========================================================================= */

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
    const ingestionId = String(url.searchParams.get("ingestionId") || "").trim();
    if (!ingestionId) {
      return json(
        req,
        { success: false, code: "INGESTION_ID_REQUIRED", message: "A submission 'ingestionId' is required." },
        { status: 400 }
      );
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
            "Source snapshot storage is not configured (ONEVUE_SOURCE_SNAPSHOT_ROOT); the retained source cannot be inspected.",
        },
        { status: 500 }
      );
    }

    await connectToDatabase();
    const ReviewModel = (TemplateIngestionReview as any).default || TemplateIngestionReview;
    const record = await ReviewModel.findOne({ ingestionId });
    if (!record) {
      return json(
        req,
        { success: false, code: "SUBMISSION_NOT_FOUND", message: `Submission '${ingestionId}' was not found.` },
        { status: 404 }
      );
    }

    if (!record.sourceSnapshot) {
      return json(
        req,
        {
          success: false,
          code: "SOURCE_SNAPSHOT_MISSING",
          message: `Submission '${ingestionId}' has no retained source snapshot. The source of this submission was not retained, so it cannot be inspected.`,
        },
        { status: 409 }
      );
    }

    // The snapshot must describe the very submission that is being inspected.
    if (
      record.sourceSnapshot.commitSha !== record.commitSha ||
      record.sourceSnapshot.templateId !== record.templateId ||
      record.sourceSnapshot.templateVersion !== record.templateVersion
    ) {
      return json(
        req,
        {
          success: false,
          code: "SOURCE_PROVENANCE_MISMATCH",
          message: "The retained source snapshot does not match this submission's pinned commit and template identity.",
        },
        { status: 409 }
      );
    }

    const requestedPath = url.searchParams.get("path");
    if (requestedPath !== null) {
      const file = await readSourceSnapshotFile(snapshotStore, record.sourceSnapshot, requestedPath);
      if (!file.ok) {
        return json(req, { success: false, code: file.code, message: file.message }, { status: 409 });
      }
      return json(req, {
        success: true,
        file: {
          relativePath: file.relativePath,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          binary: file.binary,
          content: file.content,
        },
      });
    }

    const inspection = await inspectSourceSnapshot(snapshotStore, record.sourceSnapshot);
    if (!inspection.ok) {
      return json(req, { success: false, code: inspection.code, message: inspection.message }, { status: 409 });
    }

    // Passive metadata inspection only: manifests are read as data, never run.
    const metadata = inspectSourceMetadata(inspection.sourceDir);

    return json(req, {
      success: true,
      source: {
        snapshotId: inspection.summary.snapshotId,
        templateId: inspection.summary.templateId,
        templateVersion: inspection.summary.templateVersion,
        sourceUrl: inspection.summary.sourceUrl,
        commitSha: inspection.summary.commitSha,
        auditOutcome: inspection.summary.auditOutcome,
        createdAt: inspection.summary.createdAt,
        sourceDigest: inspection.summary.sourceDigest,
        totalFiles: inspection.summary.totalFiles,
        totalBytes: inspection.summary.totalBytes,
        files: inspection.summary.files,
      },
      metadata: {
        manifestExists: metadata.manifestExists,
        manifestValid: metadata.manifestValid,
        packageManager: metadata.packageManager,
        detectedFramework: metadata.detectedFramework,
        onevue: metadata.onevueMetadata || null,
        packageJson: metadata.packageJson || null,
      },
      // The same projection the submissions list returns: only known fields,
      // with quoted evidence truncated. Returning the stored report verbatim
      // would leak evidence blocks this surface was never meant to expose.
      auditReport: sanitizeAuditReport(record.auditReport) || null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to inspect the retained source.";
    return json(req, { success: false, code: "SOURCE_INSPECTION_FAILED", message }, { status: 500 });
  }
}
