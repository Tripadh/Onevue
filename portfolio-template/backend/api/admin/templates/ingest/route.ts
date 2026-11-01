import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../../lib/cors";
import connectToDatabase from "../../../../../lib/db";
import { verifyAdminAuth } from "../../../../../lib/auth";
import { ingestGitHubTemplateSource } from "../../../../../lib/github-ingestion";
import { auditTemplateSource } from "../../../../../lib/template-audit";
import TemplateIngestionReview from "../../../../../models/TemplateIngestionReview";
import { FileSystemSourceSnapshotStore, SourceSnapshotRef } from "../../../../../lib/template-snapshot";
import * as crypto from "crypto";

function json(req: Request, body: unknown, init?: { status?: number }) {
  return applyCorsHeaders(NextResponse.json(body, init), req.headers.get("origin"));
}

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   POST /api/admin/templates/ingest
   Secure administrative endpoint for fetching, auditing, and recording
   a GitHub template source ingestion.
   ========================================================================= */

export async function POST(req: Request) {
  let extractedDirCleanup: (() => Promise<void>) | undefined = undefined;
  let createdSnapshot: SourceSnapshotRef | undefined;
  let snapshotStore: FileSystemSourceSnapshotStore | undefined;

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

    const { url, commitSha, requestedRef } = body;

    if (!url || typeof url !== "string" || !url.trim()) {
      return json(req, { message: "GitHub repository URL is required ('url')." }, { status: 400 });
    }

    // 3. Execute ingestion pipeline (URL validation, commit pinning, archive download, extraction)
    const ingestionResult = await ingestGitHubTemplateSource({
      url: url.trim(),
      pinnedSha: commitSha ? String(commitSha).trim() : undefined,
      requestedRef: requestedRef ? String(requestedRef).trim() : undefined,
      fetchImpl: (globalThis as any).__mockFetch || globalThis.fetch,
    });

    if (!ingestionResult.success || !ingestionResult.extractedDir || !ingestionResult.pinnedSha) {
      if (ingestionResult.cleanup) {
        await ingestionResult.cleanup();
      }
      return json(
        req,
        failingIngestionResponse(ingestionResult.stageFailed, ingestionResult.error),
        { status: 400 }
      );
    }

    extractedDirCleanup = ingestionResult.cleanup;
    const extractedDir = ingestionResult.extractedDir;
    const pinnedSha = ingestionResult.pinnedSha;
    const repoRef = ingestionResult.repoRef;

    // 4. Run static license and security audit against extracted source
    const auditReport = auditTemplateSource(extractedDir);

    // 5. Extract optional template metadata if present
    const onevueMeta = ingestionResult.metadata?.onevueMetadata;
    const templateId = onevueMeta?.templateId || repoRef?.repo;
    const templateVersion = onevueMeta?.version || "1.0.0";

    const snapshotRoot = process.env.ONEVUE_SOURCE_SNAPSHOT_ROOT;
    const configuredSnapshotStore = (globalThis as any).__mockSourceSnapshotStore;
    snapshotStore = configuredSnapshotStore || (snapshotRoot ? new FileSystemSourceSnapshotStore(snapshotRoot) : undefined);
    if (!snapshotStore) {
      if (extractedDirCleanup) await extractedDirCleanup();
      extractedDirCleanup = undefined;
      return json(req, { message: "Source snapshot storage is not configured; ingestion cannot retain durable source." }, { status: 500 });
    }

    // 6. Persist ingestion review record in MongoDB
    await connectToDatabase();

    const ingestionId = "ing_" + crypto.randomBytes(16).toString("hex");
    createdSnapshot = await snapshotStore.create({
      snapshotId: ingestionId,
      sourceDir: extractedDir,
      templateId,
      templateVersion,
      sourceUrl: repoRef?.canonicalUrl || url.trim(),
      commitSha: pinnedSha,
      auditOutcome: auditReport.outcome,
    });
    const ReviewModel = (TemplateIngestionReview as any).default || TemplateIngestionReview;

    const reviewRecord = new ReviewModel({
      ingestionId,
      adminUserId: adminUser._id,
      sourceUrl: repoRef?.canonicalUrl || url.trim(),
      commitSha: pinnedSha,
      templateId,
      templateVersion,
      sourceSnapshot: createdSnapshot,
      auditReport,
      status: "pending_review",
    });

    await reviewRecord.save();

    // 7. Cleanup temporary extraction directory
    if (extractedDirCleanup) {
      await extractedDirCleanup();
      extractedDirCleanup = undefined;
    }

    // 8. Return sanitized summary response
    return json(
      {
        success: true,
        message: "Template ingested and audited successfully.",
        ingestion: {
          ingestionId: reviewRecord.ingestionId,
          sourceUrl: reviewRecord.sourceUrl,
          commitSha: reviewRecord.commitSha,
          templateId: reviewRecord.templateId,
          templateVersion: reviewRecord.templateVersion,
          auditOutcome: auditReport.outcome,
          summary: auditReport.summary,
          status: reviewRecord.status,
          createdAt: reviewRecord.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (createdSnapshot && snapshotStore) {
      try { await snapshotStore.remove(createdSnapshot); } catch {}
    }
    if (extractedDirCleanup) {
      await extractedDirCleanup();
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return json(req, { message }, { status: 500 });
  }
}

function failingIngestionResponse(stageFailed?: string, errorMsg?: string) {
  let message = errorMsg || "Template ingestion failed.";
  let status = 400;

  if (stageFailed === "URL_VALIDATION") {
    message = `URL validation failed: ${message}`;
  } else if (stageFailed === "SHA_VALIDATION" || stageFailed === "COMMIT_RESOLUTION") {
    message = `Commit resolution failed: ${message}`;
  } else if (stageFailed === "DOWNLOAD") {
    message = `Source download failed: ${message}`;
  } else if (stageFailed === "EXTRACTION") {
    message = `Source archive extraction failed: ${message}`;
  }

  return { success: false, stageFailed: stageFailed || "UNKNOWN", message };
}
