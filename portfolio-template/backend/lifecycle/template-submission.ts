/**
 * =========================================================================
 * OneVue Phase 5.15 — GitHub Repository -> Template Submission Workflow
 * =========================================================================
 *
 * One orchestration for the product workflow:
 *
 *   GitHub URL -> validate + pin commit -> duplicate/no-update decision
 *   -> immutable source snapshot -> license/security audit
 *   -> isolated build -> manifest + immutable storage -> catalog registration
 *
 * Existing components are composed, not reimplemented:
 *   github-ingestion.ts   URL validation, commit pinning, archive fetch,
 *                         metadata inspection
 *   template-snapshot.ts  immutable source snapshots
 *   template-audit.ts     license + dependency audit policy
 *   template-lifecycle.ts adapt -> build+package -> store -> validate
 *   template-provisioning.ts controlled private mirror of the source
 *   template-storage.ts   immutable artifact storage (Phase 5.14 authority)
 *   template-registry-extension.ts dynamic public catalog
 *
 * Design rules
 * ------------
 * - New repositories create a template identity; repeated submissions of the
 *   same canonical repository reuse that identity and append versions.
 * - Same repository + same commit is idempotent: no new version is created.
 * - Same repository + new commit creates a NEW immutable version; existing
 *   versions and their stored artifacts are never touched.
 * - A version becomes catalog-eligible only after audit, provisioning, build,
 *   storage and integrity validation all succeed. Failures leave the record
 *   in a non-eligible state, so the public catalog never exposes them.
 * - Builds and provisioning run only through injected/approved executors.
 *   Without them the workflow fails closed; it never executes source directly.
 * - Concurrent submissions of one repository are serialized in-process and
 *   guarded by a persisted processing lease for the cross-record case.
 */

import * as crypto from "node:crypto";
import { validateGitHubRepoUrl, validateCommitSha } from "./github-ingestion";
import { auditTemplateSource, type TemplateAuditReport } from "./template-audit";
import {
  createProvisioningPlan,
  executeProvisioningPlan,
  type ProvisioningExecutor,
} from "./template-provisioning";
import type { SourceSnapshotStore, SourceSnapshotRef } from "./template-snapshot";
import {
  createMongoLifecyclePersistence,
  orchestrateTemplateLifecycle,
  type LifecyclePersistence,
} from "./template-lifecycle";
import type { BuildExecutor } from "./template-build";
import type { TemplateStorageAdapter } from "./template-storage";
import { getEligibleCatalogTemplates } from "./template-registry-extension";
import { getBuildIsolationStatus } from "./template-build-isolation";

export type SubmissionStageName =
  | "VALIDATE_REPOSITORY"
  | "PIN_COMMIT"
  | "DUPLICATE_CHECK"
  | "SOURCE_SNAPSHOT"
  | "AUDIT"
  | "BUILD_BOUNDARY"
  | "PROVISION"
  | "ADAPT_BUILD_STORE"
  | "CATALOG";

export type SubmissionStageStatus = "in_progress" | "succeeded" | "failed" | "skipped";

export interface SubmissionStage {
  stage: SubmissionStageName;
  status: SubmissionStageStatus;
  detail?: string;
  at: string;
}

export type SubmissionOutcome =
  | "CREATED"
  | "UPDATED"
  | "NO_UPDATE"
  | "REJECTED"
  | "FAILED";

export type SubmissionCode =
  | "OK"
  | "INVALID_INPUT"
  | "INVALID_URL"
  | "COMMIT_RESOLUTION_FAILED"
  | "SOURCE_UNAVAILABLE"
  | "DUPLICATE_REPOSITORY"
  | "CONCURRENT_SUBMISSION"
  | "AUDIT_REJECTED"
  | "REVIEW_REQUIRED"
  | "BUILD_BOUNDARY_UNAVAILABLE"
  | "BUILD_EXECUTION_FAILED"
  | "PROVISIONING_FAILED"
  | "PROVISIONING_UNAVAILABLE"
  | "STORAGE_FAILED"
  | "LIFECYCLE_FAILED"
  | "TEMPLATE_IDENTITY_CONFLICT"
  | "VERSION_DERIVATION_FAILED"
  | "VERSION_COLLISION"
  | "EXISTING_INCOMPLETE"
  | "RECORD_PERSISTENCE_FAILED";

export interface SubmissionRecordView {
  ingestionId: string;
  repositoryKey: string;
  sourceUrl: string;
  commitSha: string;
  previousCommitSha?: string;
  previousVersion?: string;
  templateId: string;
  templateVersion: string;
  requestedRef?: string;
  auditOutcome?: string;
  reviewStatus: string;
  submissionStatus: string;
  catalogEligible: boolean;
  stages: SubmissionStage[];
  currentStage?: SubmissionStageName;
  retryEligible: boolean;
  sourceAuthMode?: "public" | "credentialed";
  destinationUrl?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SubmissionResult {
  success: boolean;
  outcome: SubmissionOutcome;
  code: SubmissionCode;
  message: string;
  submission?: SubmissionRecordView;
}

/** Injectables, so the workflow can run offline against test doubles. */
export interface TemplateSubmissionDeps {
  /** Mongoose model for TemplateIngestionReview. */
  reviewModel: any;
  snapshotStore: SourceSnapshotStore;
  storageAdapter: TemplateStorageAdapter;
  fetchImpl?: typeof fetch;
  /** The only way a build may run. Absent => fail closed. */
  buildExecutor?: BuildExecutor;
  /** The only way provisioning may run. Absent => live configuration or fail closed. */
  provisioningExecutor?: ProvisioningExecutor;
  /**
   * Explicit server-side GitHub read credential for ingestion. Never logged.
   * When omitted, the environment is consulted (GITHUB_READ_TOKEN, ...).
   */
  githubAuthToken?: string | null;
  /** Lifecycle stage timeout; lets tests exercise build timeouts. */
  stageTimeoutMs?: number;
  /** Cross-process repository lease duration. */
  leaseMs?: number;
  /** Lifecycle persistence; defaults to the MongoDB-backed implementation. */
  lifecyclePersistenceFactory?: (
    reviewModel: any,
    review: {
      ingestionId: string;
      templateId: string;
      templateVersion: string;
      sourceCommitSha: string;
    }
  ) => LifecyclePersistence;
  connect?: () => Promise<void>;
  now?: () => Date;
  maxVersionAttempts?: number;
}

export interface TemplateSubmissionInput {
  url: string;
  requestedRef?: string;
  pinnedSha?: string;
  explicitConfirmation?: boolean;
  adminUserId: string;
  policyOverride?: boolean;
  reason?: string;
  /** Retry a previously failed processing attempt for the same pinned commit. */
  retry?: boolean;
}

const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SEMVER_REGEX =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

/* =========================================================================
   Pure helpers
   ========================================================================= */

/** Canonical repository identity: `owner/repo`, lowercased. */
export function buildRepositoryKey(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

/** Stable template identity derived from a repository name. */
export function deriveTemplateId(repoName: string): string {
  const cleaned = String(repoName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!TEMPLATE_ID_REGEX.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function parseSemver(value: string): [number, number, number] | null {
  if (!SEMVER_REGEX.test(value)) return null;
  const [core] = value.split(/[-+]/);
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part))) return null;
  return [parts[0], parts[1], parts[2]];
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareSemver(b, a));
}

/**
 * Chooses the version for a new immutable release.
 *
 * - The repository's declared `onevue.version` wins when it is a valid semver
 *   that is newer than every already published version.
 * - Otherwise the next minor of the highest published version is used, so a
 *   new commit always produces a new version and never a collision.
 */
export function deriveNextVersion(options: {
  declaredVersion?: string;
  publishedVersions: string[];
}): string {
  const published = sortVersionsDescending(
    options.publishedVersions.filter((version) => SEMVER_REGEX.test(version))
  );
  const declared = options.declaredVersion?.trim();

  if (declared && SEMVER_REGEX.test(declared)) {
    if (published.length === 0 || compareSemver(declared, published[0]) > 0) {
      return declared;
    }
  }
  if (published.length === 0) {
    return declared && SEMVER_REGEX.test(declared) ? declared : "1.0.0";
  }
  const [major, minor] = parseSemver(published[0])!;
  return `${major}.${minor + 1}.0`;
}

/* =========================================================================
   Per-repository serialization
   ========================================================================= */

const repositoryLocks = new Map<string, Promise<unknown>>();

async function withRepositoryLock<T>(repositoryKey: string, task: () => Promise<T>): Promise<T> {
  const previous = repositoryLocks.get(repositoryKey) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  repositoryLocks.set(
    repositoryKey,
    run.catch(() => undefined)
  );
  return run;
}

/* =========================================================================
   Cross-process repository lease

   Uses the EXISTING unique index on `ingestionId` for the lock document
   (`repo_lock:<owner/repo>`), so first-time submissions of the same
   repository are serialized across processes without a schema migration.
   The lock document is never catalog-eligible (status 'rejected').
   ========================================================================= */

export const REPOSITORY_LOCK_PREFIX = "repo_lock:";
export const REPOSITORY_LEASE_SYSTEM_USER_ID = "000000000000000000000000";
export const DEFAULT_REPOSITORY_LEASE_MS = 10 * 60 * 1000;

export interface RepositoryLease {
  token: string;
  expiresAt: Date;
}

export type RepositoryLeaseResult =
  | { acquired: true; lease: RepositoryLease }
  | { acquired: false; heldUntil?: string };

function lockDocumentId(repositoryKey: string): string {
  return REPOSITORY_LOCK_PREFIX + repositoryKey.trim().toLowerCase();
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as any).code === 11000);
}

export async function acquireRepositoryLease(
  reviewModel: any,
  repositoryKey: string,
  now: Date,
  leaseMs: number = DEFAULT_REPOSITORY_LEASE_MS
): Promise<RepositoryLeaseResult> {
  const Model = (reviewModel as any).default || reviewModel;
  const ingestionId = lockDocumentId(repositoryKey);
  const token = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + Math.max(1000, leaseMs));

  const existing = await Model.findOne({ ingestionId }).lean();
  if (!existing) {
    try {
      await new Model({
        ingestionId,
        // Reserved system identity; a valid ObjectId so the schema cast succeeds.
        adminUserId: REPOSITORY_LEASE_SYSTEM_USER_ID,
        repositoryKey: repositoryKey.toLowerCase(),
        sourceUrl: "",
        commitSha: "0".repeat(40),
        auditReport: { outcome: "LOCK" },
        status: "rejected",
        submissionStatus: "repository_lock",
        lockOwnerToken: token,
        lockLeaseExpiresAt: expiresAt,
        stages: [],
      }).save();
      return { acquired: true, lease: { token, expiresAt } };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // Another process created the lock row first; fall through to claim it.
    }
  }

  const claimed = await Model.findOneAndUpdate(
    {
      ingestionId,
      $or: [
        { lockLeaseExpiresAt: { $lte: now } },
        { lockLeaseExpiresAt: { $exists: false } },
        { lockLeaseExpiresAt: null },
      ],
    },
    {
      $set: {
        lockOwnerToken: token,
        lockLeaseExpiresAt: expiresAt,
        updatedAt: now,
      },
    },
    { new: true }
  );

  if (claimed) {
    return { acquired: true, lease: { token, expiresAt } };
  }

  const holder = await Model.findOne({ ingestionId }).lean();
  const heldUntil = holder?.lockLeaseExpiresAt
    ? new Date(holder.lockLeaseExpiresAt).toISOString()
    : undefined;
  return { acquired: false, heldUntil };
}

/**
 * Releases the lease only when this worker still owns it. A stale worker whose
 * lease expired (and was re-acquired elsewhere) cannot release or reset it.
 */
export async function releaseRepositoryLease(
  reviewModel: any,
  repositoryKey: string,
  lease: RepositoryLease,
  now: Date = new Date()
): Promise<boolean> {
  const Model = (reviewModel as any).default || reviewModel;
  const result = await Model.updateOne(
    { ingestionId: lockDocumentId(repositoryKey), lockOwnerToken: lease.token },
    { $set: { lockOwnerToken: "", lockLeaseExpiresAt: new Date(0), updatedAt: now } }
  );
  return Boolean(result && (result.matchedCount || result.modifiedCount));
}

/** Simulates lease expiry for maintenance/verification flows (tests). */
export async function expireRepositoryLease(reviewModel: any, repositoryKey: string): Promise<void> {
  const Model = (reviewModel as any).default || reviewModel;
  await Model.updateOne(
    { ingestionId: lockDocumentId(repositoryKey) },
    { $set: { lockLeaseExpiresAt: new Date(0), lockOwnerToken: "" } }
  );
}

/* =========================================================================
   Record helpers
   ========================================================================= */

function nowIso(now: () => Date): string {
  return now().toISOString();
}

const RETRYABLE_STATUSES = new Set([
  "build_failed",
  "storage_failed",
  "provisioning_failed",
  "build_boundary_unavailable",
  "provisioning_unavailable",
  "review_required",
  "catalog_registration_failed",
]);

/**
 * A failed attempt is retryable when it never reached the catalog, was not
 * rejected by policy, and its failure stage is transient or infrastructural.
 */
export function isSubmissionRetryEligible(record: any, catalogEligible = false): boolean {
  if (!record || catalogEligible) return false;
  const status = String(record.submissionStatus || "");
  // A policy rejection (audit REJECT) needs a new source; REVIEW_REQUIRED is
  // retryable once an administrator supplies the explicit override.
  if (record.status === "rejected" && status !== "review_required") return false;
  return RETRYABLE_STATUSES.has(status);
}

function toRecordView(record: any, catalogEligible: boolean): SubmissionRecordView {
  const stages: SubmissionStage[] = Array.isArray(record.stages) ? record.stages : [];
  const lastStage = stages.length > 0 ? stages[stages.length - 1] : undefined;
  const retryEligible = isSubmissionRetryEligible(record, catalogEligible);
  return {
    ingestionId: record.ingestionId,
    repositoryKey: record.repositoryKey || "",
    sourceUrl: record.sourceUrl,
    commitSha: record.commitSha,
    previousCommitSha: record.previousCommitSha || undefined,
    previousVersion: record.previousVersion || undefined,
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    requestedRef: record.requestedRef || undefined,
    auditOutcome: record.auditReport?.outcome,
    reviewStatus: record.status,
    submissionStatus: record.submissionStatus || "processing",
    catalogEligible,
    stages,
    currentStage: lastStage?.stage,
    retryEligible,
    sourceAuthMode: record.sourceAuthMode,
    destinationUrl: record.provisioningRecord?.destinationUrl || undefined,
    error: record.error || record.provisioningRecord?.error || undefined,
    createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : undefined,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : undefined,
  };
}

/* =========================================================================
   Workflow
   ========================================================================= */

export async function submitTemplateRepository(
  input: TemplateSubmissionInput,
  deps: TemplateSubmissionDeps
): Promise<SubmissionResult> {
  const now = deps.now || (() => new Date());
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const lifecyclePersistenceFactory =
    deps.lifecyclePersistenceFactory || createMongoLifecyclePersistence;

  if (deps.connect) {
    await deps.connect();
  }

  if (input.explicitConfirmation !== true) {
    return {
      success: false,
      outcome: "FAILED",
      code: "INVALID_INPUT",
      message: "Explicit confirmation is required to ingest and publish a template repository.",
    };
  }

  if (!input.adminUserId) {
    return {
      success: false,
      outcome: "FAILED",
      code: "INVALID_INPUT",
      message: "An authenticated administrator is required.",
    };
  }

  // 1. Repository URL validation
  const urlCheck = validateGitHubRepoUrl(input.url);
  if (!urlCheck.valid || !urlCheck.repoRef) {
    return {
      success: false,
      outcome: "FAILED",
      code: "INVALID_URL",
      message: urlCheck.error || "Invalid GitHub repository URL.",
    };
  }

  const { owner, repo, canonicalUrl } = urlCheck.repoRef;
  const repositoryKey = buildRepositoryKey(owner, repo);

  return withRepositoryLock(repositoryKey, async () => {
    const stages: SubmissionStage[] = [];
    const stage = (name: SubmissionStageName, status: SubmissionStageStatus, detail?: string) => {
      stages.push({ stage: name, status, detail, at: nowIso(now) });
    };
    stage("VALIDATE_REPOSITORY", "succeeded", canonicalUrl);

    // Cross-process exclusion: only one worker may process a repository at a time.
    const leaseResult = await acquireRepositoryLease(
      deps.reviewModel,
      repositoryKey,
      now(),
      deps.leaseMs ?? DEFAULT_REPOSITORY_LEASE_MS
    );
    if (!("lease" in leaseResult)) {
      return {
        success: false,
        outcome: "FAILED",
        code: "CONCURRENT_SUBMISSION",
        message: `Another worker is processing '${repositoryKey}'${
          leaseResult.heldUntil ? ` until ${leaseResult.heldUntil}` : ""
        }. No version was created.`,
      };
    }
    try {

    const existingRecords: any[] = await loadRepositoryRecords(deps.reviewModel, repositoryKey);

    // 2. Reject a submission while another one for this repository is live.
    const processingWindowMs = 15 * 60 * 1000;
    const active = existingRecords.find((record) => {
      const updatedAt = record.updatedAt ? new Date(record.updatedAt).getTime() : 0;
      const processing = record.submissionStatus === "processing";
      if (processing && updatedAt && now().getTime() - updatedAt < processingWindowMs) {
        return true;
      }
      const lifecycleLease = record.provisioningRecord?.provenance?.lifecycle?.leaseExpiresAt;
      return (
        record.provisioningRecord?.provenance?.lifecycle?.status === "IN_PROGRESS" &&
        lifecycleLease &&
        new Date(lifecycleLease) > now()
      );
    });
    if (active) {
      return {
        success: false,
        outcome: "FAILED",
        code: "CONCURRENT_SUBMISSION",
        message: `A submission for '${repositoryKey}' is already being processed (ingestion ${active.ingestionId}).`,
        submission: toRecordView(active, false),
      };
    }

    const templateId = resolveTemplateIdentity(existingRecords, repo);
    if (!templateId) {
      return {
        success: false,
        outcome: "FAILED",
        code: "TEMPLATE_IDENTITY_CONFLICT",
        message: `Repository name '${repo}' cannot be converted into a valid OneVue template identity.`,
      };
    }

    // 3. Pin the immutable commit.
    const pipeline = await ingestPinnedSource({
      url: canonicalUrl,
      repoRef: urlCheck.repoRef,
      requestedRef: input.requestedRef,
      pinnedSha: input.pinnedSha,
      fetchImpl,
      authToken: deps.githubAuthToken,
    });

    if (!pipeline.success || !pipeline.pinnedSha || !pipeline.extractedDir) {
      return {
        success: false,
        outcome: "FAILED",
        code:
          pipeline.stageFailed === "COMMIT_RESOLUTION" || pipeline.stageFailed === "SHA_VALIDATION"
            ? "COMMIT_RESOLUTION_FAILED"
            : "SOURCE_UNAVAILABLE",
        message: pipeline.error || "Repository source could not be retrieved.",
      };
    }

    const cleanup = pipeline.cleanup;
    const extractedDir = pipeline.extractedDir;
    const commitSha = pipeline.pinnedSha;
    stage(
      "PIN_COMMIT",
      "succeeded",
      `${commitSha} (${pipeline.authMode === "credentialed" ? "server credential" : "public access"})`
    );

    try {
      // 4. Duplicate / no-update decision, based on canonical identity + commit.
      const sameCommit = existingRecords.find(
        (record) => String(record.commitSha).toLowerCase() === commitSha.toLowerCase()
      );
      stage(
        "DUPLICATE_CHECK",
        "succeeded",
        sameCommit ? `commit already submitted as ${sameCommit.templateId}@${sameCommit.templateVersion}` : "new commit"
      );

      let retryingRecord: any | undefined;

      if (sameCommit) {
        const eligible = await isCatalogEligible(deps, sameCommit);
        if (eligible) {
          return {
            success: true,
            outcome: "NO_UPDATE",
            code: "DUPLICATE_REPOSITORY",
            message: `Repository '${repositoryKey}' is already processed at commit ${commitSha.slice(0, 12)} as ${sameCommit.templateId}@${sameCommit.templateVersion}. No update is needed.`,
            submission: toRecordView(sameCommit, true),
          };
        }
        const retryRequested =
          input.retry === true ||
          (input.policyOverride === true && sameCommit.submissionStatus === "review_required");
        if (!retryRequested) {
          return {
            success: false,
            outcome: "FAILED",
            code: "EXISTING_INCOMPLETE",
            message: `Commit ${commitSha.slice(0, 12)} was previously submitted for '${repositoryKey}' but did not reach the catalog (${sameCommit.submissionStatus || "failed"}). Submit again with retry enabled to retry the same version; a retry never creates a duplicate version.`,
            submission: toRecordView(sameCommit, false),
          };
        }
        retryingRecord = sameCommit;
      }

      let templateVersion: string;

      if (retryingRecord) {
        // A retry reuses the failed attempt's immutable version.
        templateVersion = String(retryingRecord.templateVersion);
        const stored = await deps.storageAdapter.validateStoredArtifact(templateId, templateVersion);
        if (stored.success && stored.manifest) {
          if (
            String(stored.manifest.sourceCommitSha || "").toLowerCase() !== commitSha.toLowerCase()
          ) {
            return {
              success: false,
              outcome: "FAILED",
              code: "VERSION_COLLISION",
              message: `Immutable version '${templateId}@${templateVersion}' is already bound to a different commit and will not be overwritten.`,
            };
          }
          if (stored.manifest.supportedDtoVersions?.includes("1.0.0") !== false) {
            return await recoverStoredVersion(deps, {
              stages,
              stage,
              now,
              input,
              repositoryKey,
              owner,
              repo,
              canonicalUrl,
              commitSha,
              templateId,
              templateVersion,
              retryingRecord,
              stored,
              existingRecords,
            });
          }
        }
      } else {
        const declaredVersion = pipeline.metadata?.onevueMetadata?.version;
        const derived = await ensureAvailableVersion(deps, {
          declaredVersion,
          existingRecords,
          templateId,
        });
        if (!derived) {
          return {
            success: false,
            outcome: "FAILED",
            code: "VERSION_DERIVATION_FAILED",
            message: `Unable to derive a free immutable version for '${templateId}'.`,
          };
        }
        templateVersion = derived;
      }

      stages[stages.length - 1] = {
        stage: "DUPLICATE_CHECK",
        status: "succeeded",
        detail: `${retryingRecord ? "retrying" : "new immutable"} version ${templateId}@${templateVersion}`,
        at: nowIso(now),
      };

      // 5. License + security audit. Failures never reach build or catalog.
      const auditReport = auditTemplateSource(extractedDir);
      if (auditReport.outcome === "REJECT") {
        const record = await persistRejectedSubmission(deps, {
          stages,
          stage: "AUDIT",
          stageDetail: "audit rejected",
          repositoryKey,
          canonicalUrl,
          commitSha,
          templateId,
          templateVersion,
          auditReport,
          adminUserId: input.adminUserId,
          error: "Automated license/security audit rejected the template.",
          submissionStatus: "audit_rejected",
          requestedRef: input.requestedRef,
          now,
        });
        return {
          success: false,
          outcome: "REJECTED",
          code: "AUDIT_REJECTED",
          message:
            "Automated license/security audit outcome is 'REJECT'. The template was not built and is not eligible for the catalog.",
          submission: toRecordView(record, false),
        };
      }
      if (
        auditReport.outcome === "REVIEW_REQUIRED" &&
        !(input.policyOverride === true && String(input.reason || "").trim())
      ) {
        const record = await persistRejectedSubmission(deps, {
          stages,
          stage: "AUDIT",
          stageDetail: "review required without override",
          repositoryKey,
          canonicalUrl,
          commitSha,
          templateId,
          templateVersion,
          auditReport,
          adminUserId: input.adminUserId,
          error: "Audit outcome is REVIEW_REQUIRED and no explicit override reason was supplied.",
          submissionStatus: "review_required",
          requestedRef: input.requestedRef,
          now,
        });
        return {
          success: false,
          outcome: "REJECTED",
          code: "REVIEW_REQUIRED",
          message:
            "Audit outcome is 'REVIEW_REQUIRED'. Supply 'policyOverride: true' with a justification reason to continue. Nothing was built or published.",
          submission: toRecordView(record, false),
        };
      }
      stage("AUDIT", "succeeded", auditReport.outcome);

      // 6. Build boundary must exist before any provisioning or build attempt.
      if (!deps.buildExecutor) {
        const isolation = getBuildIsolationStatus();
        if (!isolation.executable) {
          const record = await persistRejectedSubmission(deps, {
            stages,
            stage: "BUILD_BOUNDARY",
            stageDetail: isolation.reason,
            repositoryKey,
            canonicalUrl,
            commitSha,
            templateId,
            templateVersion,
            auditReport,
            adminUserId: input.adminUserId,
            error: isolation.reason,
            submissionStatus: "build_boundary_unavailable",
            requestedRef: input.requestedRef,
            now,
          });
          return {
            success: false,
            outcome: "FAILED",
            code: "BUILD_BOUNDARY_UNAVAILABLE",
            message: `No approved isolated build runtime is available. ${isolation.reason}`,
            submission: toRecordView(record, false),
          };
        }
      }
      stage("BUILD_BOUNDARY", "succeeded", "approved executor available");

      // 7. Immutable source snapshot of the exact pinned commit.
      const ingestionId = `ing_${crypto.randomBytes(12).toString("hex")}`;
      const snapshot = await deps.snapshotStore.create({
        snapshotId: ingestionId,
        sourceDir: extractedDir,
        templateId,
        templateVersion,
        sourceUrl: canonicalUrl,
        commitSha,
        auditOutcome: auditReport.outcome,
      });
      stage("SOURCE_SNAPSHOT", "succeeded", snapshot.snapshotId);

      // 8. Persist the submission record (approved by the submitting admin).
      const previous =
        existingRecords.find(
          (record) =>
            record !== retryingRecord &&
            record.status === "approved" &&
            record.submissionStatus === "catalog_eligible"
        ) ||
        existingRecords.find(
          (record) => record !== retryingRecord && record.status === "approved"
        );
      const reviewModel = deps.reviewModel;
      const Model = (reviewModel as any).default || reviewModel;
      const record = new Model({
        ingestionId,
        adminUserId: input.adminUserId,
        repositoryKey,
        repository: { owner, repo, canonicalUrl },
        requestedRef: input.requestedRef || "",
        sourceUrl: canonicalUrl,
        commitSha,
        previousCommitSha: previous?.commitSha,
        previousVersion: previous?.templateVersion,
        templateId,
        templateVersion,
        sourceSnapshot: snapshot,
        auditReport,
        status: "approved",
        reviewDecision: {
          decision: "approve",
          reviewerUserId: input.adminUserId,
          reason:
            String(input.reason || "").trim() ||
            "Approved through the administrator GitHub submission workflow.",
          timestamp: now(),
        },
        submissionStatus: "processing",
        sourceAuthMode: pipeline.authMode,
        stages: [...stages],
      });
      await record.save();

      const persist = async (patch: Record<string, unknown>) => {
        await Model.updateOne({ ingestionId }, { $set: patch });
        Object.assign(record, flattenForRecord(patch));
      };

      // 9. Controlled private provisioning (existing security gate).
      const destinationRepo = `${templateId}-${templateVersion.replace(/\./g, "-")}`;
      let provisioningExecutor = deps.provisioningExecutor;
      if (!provisioningExecutor) {
        const { getGitHubProvisioningConfig } = await import("./github-api-client");
        const config = getGitHubProvisioningConfig();
        if (config.liveEnabled && config.configured) {
          const { LiveGitHubProvisioningExecutor } = await import("./template-provisioning");
          provisioningExecutor = new LiveGitHubProvisioningExecutor();
        }
      }
      if (!provisioningExecutor) {
        await persist({
          submissionStatus: "provisioning_unavailable",
          error: "GitHub provisioning is not configured on this deployment.",
          stages: [...stages, failStage("PROVISION", "provisioning is not configured", now)],
        });
        return {
          success: false,
          outcome: "FAILED",
          code: "PROVISIONING_UNAVAILABLE",
          message:
            "GitHub provisioning is not configured on this deployment. Nothing was built or published; the pinned source snapshot is retained.",
          submission: toRecordView(record, false),
        };
      }

      const plan = createProvisioningPlan({
        sourceUrl: canonicalUrl,
        commitSha,
        templateId,
        templateVersion,
        auditReport,
        destinationRepo,
        explicitApproval: true,
        approvalReason: record.reviewDecision.reason,
        explicitConfirmation: true,
        sourceDir: extractedDir,
      });
      if (!plan.valid) {
        await persist({
          submissionStatus: "provisioning_failed",
          error: plan.error,
          stages: [...stages, failStage("PROVISION", plan.error, now)],
        });
        return {
          success: false,
          outcome: "FAILED",
          code: "PROVISIONING_FAILED",
          message: plan.error || "Provisioning plan was rejected.",
          submission: toRecordView(record, false),
        };
      }

      const provisioned = await executeProvisioningPlan(plan, provisioningExecutor);
      if (!provisioned.success) {
        await persist({
          submissionStatus: "provisioning_failed",
          error: provisioned.error,
          "provisioningRecord.status": "failed",
          "provisioningRecord.error": provisioned.error || "",
          "provisioningRecord.errorCategory": provisioned.errorCategory || "EXECUTION_FAILED",
          stages: [...stages, failStage("PROVISION", provisioned.error, now)],
        });
        return {
          success: false,
          outcome: "FAILED",
          code: "PROVISIONING_FAILED",
          message: provisioned.error || "Repository provisioning failed.",
          submission: toRecordView(record, false),
        };
      }
      stage("PROVISION", "succeeded", `${provisioned.destinationOrg}/${provisioned.destinationRepo}`);

      const afterProvision = [...stages];
      record.provisioningRecord = {
        status: "provisioned",
        destinationOrg: provisioned.destinationOrg,
        destinationRepo: provisioned.destinationRepo,
        destinationUrl: `https://github.com/${provisioned.destinationOrg}/${provisioned.destinationRepo}`,
        visibility: "private",
        provisionedAt: now(),
        provenance: provisioned.provenance,
      };
      await persist({
        "provisioningRecord.status": "provisioned",
        "provisioningRecord.destinationOrg": provisioned.destinationOrg,
        "provisioningRecord.destinationRepo": provisioned.destinationRepo,
        "provisioningRecord.destinationUrl": `https://github.com/${provisioned.destinationOrg}/${provisioned.destinationRepo}`,
        "provisioningRecord.visibility": "private",
        "provisioningRecord.provisionedAt": now(),
        "provisioningRecord.provenance": provisioned.provenance,
        "provisioningRecord.provenance.lifecycle": {
          ingestionId,
          status: "APPROVED",
          templateId,
          templateVersion,
          sourceCommitSha: commitSha,
          updatedAt: nowIso(now),
        },
        stages: afterProvision,
      });

      // 10. Adapt -> build -> package -> store -> validate, through the real lifecycle.
      const lifecycle = await orchestrateTemplateLifecycle({
        sourceDir: extractedDir,
        review: {
          ingestionId,
          status: "approved",
          auditReport,
          reviewDecision: record.reviewDecision,
          sourceCommitSha: commitSha,
          templateId,
          templateVersion,
        },
        explicitConfirmation: true,
        persistence: lifecyclePersistenceFactory(Model, {
          ingestionId,
          templateId,
          templateVersion,
          sourceCommitSha: commitSha,
        }),
        storageAdapter: deps.storageAdapter,
        buildExecutor: deps.buildExecutor,
        stageTimeoutMs: deps.stageTimeoutMs,
      });

      if (!lifecycle.success) {
        const failedStage = lifecycle.failedStage;
        const submissionStatus =
          failedStage === "STORED" ? "storage_failed" : "build_failed";
        await persist({
          submissionStatus,
          error: lifecycle.error || "Template lifecycle failed.",
          "provisioningRecord.provenance.lifecycle": {
            ingestionId,
            status: "FAILED",
            templateId,
            templateVersion,
            sourceCommitSha: commitSha,
            failedStage,
            error: lifecycle.error,
            updatedAt: nowIso(now),
          },
          stages: [...afterProvision, failStage("ADAPT_BUILD_STORE", lifecycle.error || String(failedStage), now)],
        });
        return {
          success: false,
          outcome: "FAILED",
          code: failedStage === "STORED" ? "STORAGE_FAILED" : "BUILD_EXECUTION_FAILED",
          message: `Template ${failedStage === "STORED" ? "storage" : "build"} stage failed: ${lifecycle.error || "unknown error"}. The version was not registered.`,
          submission: toRecordView(record, false),
        };
      }
      stage("ADAPT_BUILD_STORE", "succeeded", lifecycle.manifestSha256 || "");

      // 11. Catalog registration: only now can the release be discovered.
      await persist({
        submissionStatus: "catalog_eligible",
        "provisioningRecord.provenance.lifecycle": {
          ingestionId,
          status: "CATALOG_ELIGIBLE",
          templateId,
          templateVersion,
          sourceCommitSha: commitSha,
          manifest: lifecycle.manifest,
          manifestSha256: lifecycle.manifestSha256,
          storageLocation: lifecycle.storageLocation,
          updatedAt: nowIso(now),
        },
        stages: [...stages],
      });

      const catalogEligible = await isCatalogEligible(deps, record);
      stages.push({
        stage: "CATALOG",
        status: catalogEligible ? "succeeded" : "failed",
        detail: catalogEligible
          ? `published ${templateId}@${templateVersion}`
          : "release is not discoverable in the public catalog",
        at: nowIso(now),
      });
      await persist({ stages: [...stages] });

      if (!catalogEligible) {
        await persist({
          submissionStatus: "catalog_registration_failed",
          error: "Stored artifact is not discoverable in the public catalog.",
        });
        return {
          success: false,
          outcome: "FAILED",
          code: "LIFECYCLE_FAILED",
          message:
            "The artifact was stored but the release is not discoverable in the public catalog.",
          submission: toRecordView(record, false),
        };
      }

      return {
        success: true,
        outcome: previous ? "UPDATED" : "CREATED",
        code: "OK",
        message: `Template ${templateId}@${templateVersion} was ingested, built, stored and published to the catalog.`,
        submission: toRecordView(record, true),
      };
    } finally {
      if (cleanup) {
        try {
          await cleanup();
        } catch {
          // Extraction cleanup is best effort.
        }
      }
    }
    } finally {
      // Only the owning worker releases the lease; a stale worker cannot.
      await releaseRepositoryLease(deps.reviewModel, repositoryKey, leaseResult.lease, now());
    }
  });
}

/* =========================================================================
   Internal helpers
   ========================================================================= */

function failStage(
  stageName: SubmissionStageName,
  detail: string,
  now: () => Date
): SubmissionStage {
  return { stage: stageName, status: "failed", detail, at: nowIso(now) };
}

function flattenForRecord(patch: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!key.includes(".")) flat[key] = value;
  }
  return flat;
}

async function loadRepositoryRecords(reviewModel: any, repositoryKey: string): Promise<any[]> {
  const Model = (reviewModel as any).default || reviewModel;
  const query = Model.find({ repositoryKey });
  const sorted = query && typeof query.sort === "function" ? query.sort({ createdAt: -1 }) : query;
  const rows = sorted && typeof sorted.lean === "function" ? await sorted.lean() : await sorted;
  return Array.isArray(rows) ? rows : [];
}

function resolveTemplateIdentity(existingRecords: any[], repoName: string): string {
  const previous = existingRecords.find((record) => TEMPLATE_ID_REGEX.test(String(record.templateId || "")));
  if (previous) {
    return String(previous.templateId);
  }
  return deriveTemplateId(repoName);
}

function deriveAvailableVersion(options: {
  declaredVersion?: string;
  existingRecords: any[];
}): string {
  const published = options.existingRecords
    .filter((record) => record.status === "approved" && record.templateVersion)
    .map((record) => String(record.templateVersion));
  return deriveNextVersion({
    declaredVersion: options.declaredVersion,
    publishedVersions: published,
  });
}

/**
 * Recovers a retry whose immutable artifact already exists in storage (the
 * previous attempt failed after storage, e.g. at catalog registration). The
 * artifact is validated, never rebuilt or overwritten, and the existing
 * version is registered without creating a duplicate.
 */
async function recoverStoredVersion(
  deps: TemplateSubmissionDeps,
  context: {
    stages: SubmissionStage[];
    stage: (name: SubmissionStageName, status: SubmissionStageStatus, detail?: string) => void;
    now: () => Date;
    input: TemplateSubmissionInput;
    repositoryKey: string;
    owner: string;
    repo: string;
    canonicalUrl: string;
    commitSha: string;
    templateId: string;
    templateVersion: string;
    retryingRecord: any;
    stored: { manifest?: any; storageLocation?: string };
    existingRecords: any[];
  }
): Promise<SubmissionResult> {
  const { stages, stage, now, input, retryingRecord, stored } = context;
  const Model = (deps.reviewModel as any).default || deps.reviewModel;
  const ingestionId = `ing_${crypto.randomBytes(12).toString("hex")}`;

  if (retryingRecord.provisioningRecord?.status !== "provisioned") {
    return {
      success: false,
      outcome: "FAILED",
      code: "VERSION_COLLISION",
      message:
        "An immutable artifact already exists for this version but its provisioning record is incomplete; manual review is required.",
      submission: toRecordView(retryingRecord, false),
    };
  }

  stage("ADAPT_BUILD_STORE", "succeeded", "recovered existing immutable artifact");

  const previous =
    context.existingRecords.find(
      (record) =>
        record !== retryingRecord &&
        record.status === "approved" &&
        record.submissionStatus === "catalog_eligible"
    ) ||
    context.existingRecords.find(
      (record) => record !== retryingRecord && record.status === "approved"
    );

  const record = new Model({
    ingestionId,
    adminUserId: input.adminUserId,
    repositoryKey: context.repositoryKey,
    repository: { owner: context.owner, repo: context.repo, canonicalUrl: context.canonicalUrl },
    requestedRef: input.requestedRef || "",
    sourceUrl: context.canonicalUrl,
    commitSha: context.commitSha,
    previousCommitSha: previous?.commitSha,
    previousVersion: previous?.templateVersion,
    templateId: context.templateId,
    templateVersion: context.templateVersion,
    sourceSnapshot: retryingRecord.sourceSnapshot,
    auditReport: retryingRecord.auditReport,
    status: "approved",
    reviewDecision: {
      decision: "approve",
      reviewerUserId: input.adminUserId,
      reason:
        String(input.reason || "").trim() ||
        "Recovered existing immutable artifact after a retry.",
      timestamp: now(),
    },
    submissionStatus: "catalog_eligible",
    sourceAuthMode: retryingRecord.sourceAuthMode,
    provisioningRecord: retryingRecord.provisioningRecord,
    stages: [...stages],
  });
  await record.save();

  await Model.updateOne(
    { ingestionId },
    {
      $set: {
        "provisioningRecord.provenance.lifecycle": {
          ingestionId,
          status: "CATALOG_ELIGIBLE",
          templateId: context.templateId,
          templateVersion: context.templateVersion,
          sourceCommitSha: context.commitSha,
          manifest: stored.manifest,
          manifestSha256: stored.manifest?.manifestSha256,
          storageLocation: stored.storageLocation,
          updatedAt: nowIso(now),
        },
      },
    }
  );

  const catalogEligible = await isCatalogEligible(deps, record);
  stages.push({
    stage: "CATALOG",
    status: catalogEligible ? "succeeded" : "failed",
    detail: catalogEligible
      ? `recovered ${context.templateId}@${context.templateVersion}`
      : "recovered artifact is not discoverable in the public catalog",
    at: nowIso(now),
  });
  await Model.updateOne({ ingestionId }, { $set: { stages: [...stages] } });

  return {
    success: catalogEligible,
    outcome: "UPDATED",
    code: catalogEligible ? "OK" : "LIFECYCLE_FAILED",
    message: catalogEligible
      ? `Existing immutable version ${context.templateId}@${context.templateVersion} was recovered and registered without rebuilding.`
      : "The existing artifact could not be registered in the public catalog.",
    submission: toRecordView({ ...record, stages: [...stages] }, catalogEligible),
  };
}

async function ensureAvailableVersion(
  deps: TemplateSubmissionDeps,
  options: { declaredVersion?: string; existingRecords: any[]; templateId: string }
): Promise<string | null> {
  let candidate = deriveAvailableVersion({
    declaredVersion: options.declaredVersion,
    existingRecords: options.existingRecords,
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await deps.storageAdapter.checkVersionExists(options.templateId, candidate))) {
      return candidate;
    }
    const [major, minor] = candidate.split(".").map((part) => Number.parseInt(part, 10));
    if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) return null;
    candidate = `${major}.${minor + 1}.0`;
  }
  return null;
}

async function ingestPinnedSource(options: {
  url: string;
  repoRef: { owner: string; repo: string; canonicalUrl: string };
  requestedRef?: string;
  pinnedSha?: string;
  fetchImpl?: typeof fetch;
  authToken?: string | null;
}) {
  // Reuses the ingestion pipeline (validation, commit resolution, download,
  // extraction, metadata inspection). A pinned SHA skips branch resolution.
  const { ingestGitHubTemplateSource } = await import("./github-ingestion");
  return ingestGitHubTemplateSource({
    url: options.url,
    pinnedSha: options.pinnedSha,
    requestedRef: options.requestedRef,
    fetchImpl: options.fetchImpl,
    authToken: options.authToken,
  });
}

async function isCatalogEligible(deps: TemplateSubmissionDeps, record: any): Promise<boolean> {
  if (!record || record.status !== "approved") return false;
  try {
    const templates = await getEligibleCatalogTemplates({ storageAdapter: deps.storageAdapter });
    const template = templates.find((entry) => entry.id === record.templateId);
    if (!template) return false;
    return template.releases.some((release) => release.version === record.templateVersion);
  } catch {
    return false;
  }
}

async function persistRejectedSubmission(
  deps: TemplateSubmissionDeps,
  input: {
    stages: SubmissionStage[];
    stage: SubmissionStageName;
    stageDetail: string;
    repositoryKey: string;
    canonicalUrl: string;
    commitSha: string;
    templateId: string;
    templateVersion: string;
    auditReport: TemplateAuditReport;
    adminUserId: string;
    error: string;
    submissionStatus: string;
    requestedRef?: string;
    now: () => Date;
  }
): Promise<any> {
  const Model = (deps.reviewModel as any).default || deps.reviewModel;
  const record = new Model({
    ingestionId: `ing_${crypto.randomBytes(12).toString("hex")}`,
    adminUserId: input.adminUserId,
    repositoryKey: input.repositoryKey,
    requestedRef: input.requestedRef || "",
    sourceUrl: input.canonicalUrl,
    commitSha: input.commitSha,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    auditReport: input.auditReport,
    status: "rejected",
    submissionStatus: input.submissionStatus,
    error: input.error,
    stages: [...input.stages, failStage(input.stage, input.stageDetail, input.now)],
  });
  await record.save();
  return record;
}
