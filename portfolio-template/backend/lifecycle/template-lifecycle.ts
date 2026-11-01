import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { adaptTemplateSource, AdaptationResult } from "./template-adaptation";
import { buildAndPackageTemplate, BuildExecutor, BuildResult } from "./template-build";
import { LocalFilesystemStorageAdapter, StorageResult, TemplateStorageAdapter } from "./template-storage";
import { ArtifactManifest } from "./template-build";

export type LifecycleStatus =
  | "INGESTED"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "IN_PROGRESS"
  | "ADAPTED"
  | "BUILT"
  | "STORED"
  | "CATALOG_ELIGIBLE"
  | "FAILED";

export interface LifecycleReviewSnapshot {
  ingestionId: string;
  status: "pending_review" | "approved" | "rejected";
  auditReport?: { outcome?: string };
  reviewDecision?: { reason?: string };
  sourceCommitSha: string;
  templateId: string;
  templateVersion: string;
}

export interface LifecycleRecord {
  ingestionId: string;
  status: LifecycleStatus;
  templateId: string;
  templateVersion: string;
  sourceCommitSha: string;
  manifest?: ArtifactManifest;
  manifestSha256?: string;
  storageLocation?: string;
  failedStage?: LifecycleStatus;
  error?: string;
  ownerToken?: string;
  leaseStartedAt?: string;
  maxLeaseExpiresAt?: string;
  leaseExpiresAt?: string;
  updatedAt: string;
}

export interface LifecycleClaim {
  ownerToken: string;
  leaseExpiresAt: string;
}

export interface LifecyclePersistence {
  get(ingestionId: string): Promise<LifecycleRecord | undefined>;
  claim(ingestionId: string, allowedStatuses: LifecycleStatus[], now: Date, leaseMs: number): Promise<LifecycleClaim | false>;
  renew(ingestionId: string, ownerToken: string, now: Date, leaseMs: number): Promise<boolean>;
  update(ingestionId: string, ownerToken: string, patch: Partial<LifecycleRecord>, now: Date): Promise<boolean>;
  isOwner(ingestionId: string, ownerToken: string, now: Date): Promise<boolean>;
}

const DIRECT_RETRY_STATUSES = new Set<LifecycleStatus>(["APPROVED", "FAILED"]);
const RESUMABLE_LIFECYCLE_STATUSES: LifecycleStatus[] = ["IN_PROGRESS", "ADAPTED", "BUILT", "STORED"];
const MAX_LEASE_WINDOW_MS = 30 * 60 * 1000;

export class LifecycleLeaseLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleLeaseLostError";
  }
}

export class LifecycleStageTimeoutError extends Error {
  constructor(stage: LifecycleStatus, timeoutMs: number) {
    super(`Lifecycle stage '${stage}' timed out after ${timeoutMs}ms.`);
    this.name = "LifecycleStageTimeoutError";
  }
}

export class LifecycleStageCancelledError extends Error {
  constructor(stage: LifecycleStatus) {
    super(`Lifecycle stage '${stage}' was cancelled.`);
    this.name = "LifecycleStageCancelledError";
  }
}

export interface LifecycleInput {
  sourceDir: string;
  sourceCleanup?: () => Promise<void>;
  review: LifecycleReviewSnapshot;
  explicitConfirmation: boolean;
  persistence: LifecyclePersistence;
  storageAdapter?: TemplateStorageAdapter;
  buildExecutor?: BuildExecutor;
  stagedArtifactsRoot?: string;
  now?: () => Date;
  leaseMs?: number;
  leaseRenewIntervalMs?: number;
  stageTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface LifecycleResult {
  success: boolean;
  status: LifecycleStatus;
  idempotent?: boolean;
  manifest?: ArtifactManifest;
  manifestSha256?: string;
  storageLocation?: string;
  failedStage?: LifecycleStatus;
  error?: string;
}

export class InMemoryLifecyclePersistence implements LifecyclePersistence {
  private records = new Map<string, LifecycleRecord>();

  constructor(initialRecords: LifecycleRecord[] = []) {
    for (const record of initialRecords) this.records.set(record.ingestionId, { ...record });
  }

  async get(ingestionId: string): Promise<LifecycleRecord | undefined> {
    const record = this.records.get(ingestionId);
    return record ? { ...record } : undefined;
  }

  async claim(ingestionId: string, allowedStatuses: LifecycleStatus[], now: Date, leaseMs: number): Promise<LifecycleClaim | false> {
    const record = this.records.get(ingestionId);
    if (!record) return false;

    const hasActiveLease = Boolean(record.leaseExpiresAt && new Date(record.leaseExpiresAt) > now);
    // APPROVED and FAILED are safe to retry immediately. Every other allowed
    // status may only be reclaimed after its owner's lease has actually expired.
    const directlyClaimable =
      allowedStatuses.includes(record.status) &&
      (DIRECT_RETRY_STATUSES.has(record.status) || !hasActiveLease);
    const resumable =
      allowedStatuses.includes(record.status) &&
      RESUMABLE_LIFECYCLE_STATUSES.includes(record.status) &&
      !hasActiveLease;
    // Preserve crash recovery for a stage that died while IN_PROGRESS even if
    // the caller only lists terminal retry statuses.
    const expiredInProgress = record.status === "IN_PROGRESS" && !hasActiveLease;
    if (!directlyClaimable && !resumable && !expiredInProgress) return false;

    const ownerToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    record.status = "IN_PROGRESS";
    record.ownerToken = ownerToken;
    record.leaseStartedAt = now.toISOString();
    record.maxLeaseExpiresAt = new Date(now.getTime() + Math.max(leaseMs, MAX_LEASE_WINDOW_MS)).toISOString();
    record.leaseExpiresAt = leaseExpiresAt;
    record.error = undefined;
    record.failedStage = undefined;
    return { ownerToken, leaseExpiresAt };
  }

  async update(ingestionId: string, ownerToken: string, patch: Partial<LifecycleRecord>, now: Date): Promise<boolean> {
    const record = this.records.get(ingestionId);
    if (!record || record.ownerToken !== ownerToken || !record.leaseExpiresAt || new Date(record.leaseExpiresAt) <= now) return false;
    Object.assign(record, patch);
    return true;
  }

  async renew(ingestionId: string, ownerToken: string, now: Date, leaseMs: number): Promise<boolean> {
    const record = this.records.get(ingestionId);
    if (!record || record.ownerToken !== ownerToken || !record.leaseExpiresAt || new Date(record.leaseExpiresAt) <= now || !record.maxLeaseExpiresAt) return false;
    const nextExpiry = Math.min(now.getTime() + leaseMs, new Date(record.maxLeaseExpiresAt).getTime());
    record.leaseExpiresAt = new Date(nextExpiry).toISOString();
    return nextExpiry > now.getTime();
  }

  async isOwner(ingestionId: string, ownerToken: string, now: Date): Promise<boolean> {
    const record = this.records.get(ingestionId);
    return Boolean(record?.ownerToken === ownerToken && record.leaseExpiresAt && new Date(record.leaseExpiresAt) > now);
  }

  snapshot(ingestionId: string): LifecycleRecord | undefined {
    const record = this.records.get(ingestionId);
    return record ? { ...record } : undefined;
  }
}

export function createMongoLifecyclePersistence(ReviewModel: any): LifecyclePersistence {
  return {
    async get(ingestionId) {
      const record = await ReviewModel.findOne({ ingestionId }).lean();
      const lifecycle = record?.provisioningRecord?.provenance?.lifecycle;
      if (!record || !lifecycle) return undefined;
      return lifecycle as LifecycleRecord;
    },
    async claim(ingestionId, allowedStatuses, now, leaseMs) {
      const lifecyclePath = "provisioningRecord.provenance.lifecycle";
      const ownerToken = crypto.randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const maxLeaseExpiresAt = new Date(now.getTime() + Math.max(leaseMs, MAX_LEASE_WINDOW_MS));

      const directlyAllowed = allowedStatuses.filter((status) => DIRECT_RETRY_STATUSES.has(status));
      const leaseGatedAllowed = allowedStatuses.filter((status) => !DIRECT_RETRY_STATUSES.has(status));
      // IN_PROGRESS is always recoverable when its lease has expired; other
      // interrupted stages must be explicitly listed by the caller.
      const leaseGatedStatuses = Array.from(new Set([...leaseGatedAllowed, "IN_PROGRESS" as LifecycleStatus]));
      const claimClauses: Record<string, unknown>[] = [];
      if (directlyAllowed.length > 0) {
        claimClauses.push({ [`${lifecyclePath}.status`]: { $in: directlyAllowed } });
      }
      for (const status of leaseGatedStatuses) {
        claimClauses.push({ [`${lifecyclePath}.status`]: status, [`${lifecyclePath}.leaseExpiresAt`]: { $lte: now } });
        claimClauses.push({ [`${lifecyclePath}.status`]: status, [`${lifecyclePath}.leaseExpiresAt`]: { $exists: false } });
        claimClauses.push({ [`${lifecyclePath}.status`]: status, [`${lifecyclePath}.leaseExpiresAt`]: null });
      }
      if (claimClauses.length === 0) return false;

      const result = await ReviewModel.findOneAndUpdate(
        {
          ingestionId,
          status: "approved",
          $or: claimClauses,
        },
        {
          $set: {
            [`${lifecyclePath}.status`]: "IN_PROGRESS",
            [`${lifecyclePath}.ownerToken`]: ownerToken,
            [`${lifecyclePath}.leaseStartedAt`]: now,
            [`${lifecyclePath}.maxLeaseExpiresAt`]: maxLeaseExpiresAt,
            [`${lifecyclePath}.leaseExpiresAt`]: leaseExpiresAt,
            [`${lifecyclePath}.error`]: "",
            [`${lifecyclePath}.failedStage`]: null,
          },
        },
        { new: true }
      );
      return result ? { ownerToken, leaseExpiresAt: leaseExpiresAt.toISOString() } : false;
    },
    async update(ingestionId, ownerToken, patch, now) {
      const update: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(patch)) {
        update[`provisioningRecord.provenance.lifecycle.${key}`] = value;
      }
      const result = await ReviewModel.updateOne(
        {
          ingestionId,
          "provisioningRecord.provenance.lifecycle.ownerToken": ownerToken,
          "provisioningRecord.provenance.lifecycle.leaseExpiresAt": { $gt: now },
          "provisioningRecord.provenance.lifecycle.maxLeaseExpiresAt": { $gt: now },
        },
        { $set: update }
      );
      return Boolean(result.modifiedCount || result.matchedCount);
    },
    async renew(ingestionId, ownerToken, now, leaseMs) {
      const current = await ReviewModel.findOne({
        ingestionId,
        "provisioningRecord.provenance.lifecycle.ownerToken": ownerToken,
        "provisioningRecord.provenance.lifecycle.leaseExpiresAt": { $gt: now },
        "provisioningRecord.provenance.lifecycle.maxLeaseExpiresAt": { $gt: now },
      }).lean();
      if (!current) return false;
      const currentMax = new Date(current.provisioningRecord.provenance.lifecycle.maxLeaseExpiresAt).getTime();
      const nextExpiry = new Date(Math.min(now.getTime() + leaseMs, currentMax));
      const result = await ReviewModel.updateOne({
        ingestionId,
        "provisioningRecord.provenance.lifecycle.ownerToken": ownerToken,
        "provisioningRecord.provenance.lifecycle.leaseExpiresAt": { $gt: now },
      }, { $set: { "provisioningRecord.provenance.lifecycle.leaseExpiresAt": nextExpiry } });
      return Boolean(result.modifiedCount || result.matchedCount);
    },
    async isOwner(ingestionId, ownerToken, now) {
      const record = await ReviewModel.findOne({
        ingestionId,
        "provisioningRecord.provenance.lifecycle.ownerToken": ownerToken,
        "provisioningRecord.provenance.lifecycle.leaseExpiresAt": { $gt: now },
      }).lean();
      return Boolean(record);
    },
  };
}

function failureResult(status: LifecycleStatus, error: unknown): LifecycleResult {
  return {
    success: false,
    status: "FAILED",
    failedStage: status,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function safeUpdate(persistence: LifecyclePersistence, ingestionId: string, ownerToken: string, patch: Partial<LifecycleRecord>, now: Date): Promise<void> {
  if (!(await persistence.update(ingestionId, ownerToken, patch, now))) {
    throw new Error("Lifecycle ownership lease was lost before state update.");
  }
}

interface StageLeaseOptions<T> {
  persistence: LifecyclePersistence;
  ingestionId: string;
  ownerToken: string;
  now: () => Date;
  leaseMs: number;
  renewIntervalMs: number;
  timeoutMs: number;
  stage: LifecycleStatus;
  externalSignal?: AbortSignal;
  operation: (signal: AbortSignal) => Promise<T>;
}

/**
 * Runs one long-running lifecycle stage while a heartbeat renews the owner's
 * lease. Lease loss or a stage timeout aborts the stage signal, and the result
 * is only accepted while this worker is still the current owner. This prevents
 * an expired owner from publishing eligibility or treating a stolen stage as
 * successful.
 */
async function runStageWithLease<T>(options: StageLeaseOptions<T>): Promise<T> {
  const { persistence, ingestionId, ownerToken, now, leaseMs, renewIntervalMs, timeoutMs, stage, externalSignal, operation } = options;
  const controller = new AbortController();
  let renewTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let leaseError: Error | undefined;
  let timeoutError: LifecycleStageTimeoutError | undefined;
  let cancellationError: LifecycleStageCancelledError | undefined;
  let stopped = false;
  let renewInFlight = false;
  let rejectLeaseLoss: ((error: Error) => void) | undefined;
  const leaseLossPromise = new Promise<never>((_, reject) => {
    rejectLeaseLoss = reject;
  });
  let rejectCancellation: ((error: Error) => void) | undefined;
  const cancellationPromise = new Promise<never>((_, reject) => {
    rejectCancellation = reject;
  });
  const onExternalAbort = () => {
    cancellationError = new LifecycleStageCancelledError(stage);
    controller.abort(cancellationError);
    rejectCancellation?.(cancellationError);
  };
  if (externalSignal) {
    if (externalSignal.aborted) onExternalAbort();
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const failLease = (error: LifecycleLeaseLostError) => {
    leaseError = error;
    controller.abort(error);
    rejectLeaseLoss?.(error);
  };

  const scheduleRenewal = () => {
    if (stopped) return;
    renewTimer = setTimeout(() => { void renewOnce(); }, renewIntervalMs);
  };

  const renewOnce = async () => {
    if (stopped || renewInFlight) return;
    renewInFlight = true;
    try {
      const renewed = await persistence.renew(ingestionId, ownerToken, now(), leaseMs);
      if (!renewed) {
        failLease(new LifecycleLeaseLostError(`Lifecycle ownership lease was lost during stage '${stage}'.`));
      }
    } catch (error) {
      failLease(new LifecycleLeaseLostError(
        `Lifecycle lease renewal failed during stage '${stage}': ${error instanceof Error ? error.message : String(error)}`
      ));
    } finally {
      renewInFlight = false;
      if (!stopped && !leaseError) scheduleRenewal();
    }
  };

  scheduleRenewal();

  const timeoutPromise = new Promise<never>((_, reject) => {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    timeoutTimer = setTimeout(() => {
      timeoutError = new LifecycleStageTimeoutError(stage, timeoutMs);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    // Never start a stage that was already cancelled, timed out, or lost its
    // lease before the operation began.
    if (cancellationError) throw cancellationError;
    if (leaseError) throw leaseError;
    const operationPromise = Promise.resolve().then(() => operation(controller.signal));
    const result = await Promise.race([operationPromise, timeoutPromise, leaseLossPromise, cancellationPromise]);
    if (leaseError) throw leaseError;
    if (cancellationError) throw cancellationError;
    if (!(await persistence.isOwner(ingestionId, ownerToken, now()))) {
      throw new LifecycleLeaseLostError(`Lifecycle ownership was lost before stage '${stage}' completed.`);
    }
    return result;
  } catch (error) {
    if (timeoutError) throw timeoutError;
    if (cancellationError) throw cancellationError;
    if (leaseError) throw leaseError;
    throw error;
  } finally {
    stopped = true;
    if (renewTimer) clearTimeout(renewTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

export async function orchestrateTemplateLifecycle(input: LifecycleInput): Promise<LifecycleResult> {
  const {
    sourceDir,
    sourceCleanup,
    review,
    explicitConfirmation,
    persistence,
    storageAdapter = new LocalFilesystemStorageAdapter(),
    buildExecutor,
    stagedArtifactsRoot,
    now = () => new Date(),
    leaseMs = 5 * 60 * 1000,
    stageTimeoutMs = 10 * 60 * 1000,
    leaseRenewIntervalMs,
    abortSignal,
  } = input;

  const effectiveLeaseMs = Math.max(1, Math.floor(leaseMs));
  const heartbeatIntervalMs = Math.max(
    1,
    Math.min(
      leaseRenewIntervalMs && Number.isFinite(leaseRenewIntervalMs)
        ? Math.floor(leaseRenewIntervalMs)
        : Math.floor(effectiveLeaseMs / 3),
      effectiveLeaseMs - 1
    )
  );

  let adaptation: AdaptationResult | undefined;
  let build: BuildResult | undefined;
  let stageRoot: string | undefined;
  let primaryFailure: LifecycleResult | undefined;
  let currentStage: LifecycleStatus = "APPROVED";
  let ownsSource = false;
  let claim: LifecycleClaim | false = false;

  const recordFailure = async (stage: LifecycleStatus, error: unknown): Promise<LifecycleResult> => {
    const result = failureResult(stage, error);
    primaryFailure = result;
    try {
      if (claim) await safeUpdate(persistence, review.ingestionId, claim.ownerToken, {
        status: "FAILED",
        failedStage: stage,
        error: result.error,
        updatedAt: now().toISOString(),
      }, now());
    } catch (persistenceError) {
      result.error = `${result.error}; lifecycle persistence failed: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`;
    }
    return result;
  };

  try {
    if (!review || review.status !== "approved") {
      return failureResult("APPROVED", "Lifecycle requires an approved ingestion review.");
    }
    if (review.auditReport?.outcome === "REJECT") {
      return failureResult("APPROVED", "Lifecycle refuses templates rejected by the audit.");
    }
    if (review.auditReport?.outcome === "REVIEW_REQUIRED" && !review.reviewDecision?.reason?.trim()) {
      return failureResult("APPROVED", "Lifecycle requires an approval reason for REVIEW_REQUIRED audits.");
    }
    if (explicitConfirmation !== true) {
      return failureResult("APPROVED", "Lifecycle requires explicit confirmation.");
    }
    if (abortSignal?.aborted) {
      return failureResult("APPROVED", "Lifecycle was cancelled before a build claim was made.");
    }
    const existing = await persistence.get(review.ingestionId);
    if (existing?.status === "CATALOG_ELIGIBLE") {
      return {
        success: true,
        status: existing.status,
        idempotent: true,
        manifest: existing.manifest,
        manifestSha256: existing.manifestSha256,
        storageLocation: existing.storageLocation,
      };
    }
    claim = await persistence.claim(
      review.ingestionId,
      ["APPROVED", "FAILED", "ADAPTED", "BUILT", "STORED"],
      now(),
      effectiveLeaseMs
    );
    if (!claim) {
      return failureResult("APPROVED", "Lifecycle is already running or has not reached an approved state.");
    }
    ownsSource = true;

    if (!sourceDir || !fs.existsSync(sourceDir)) {
      return await recordFailure("INGESTED", "Lifecycle source directory does not exist.");
    }

    await safeUpdate(persistence, review.ingestionId, claim.ownerToken, { updatedAt: now().toISOString() }, now());

    currentStage = "ADAPTED";
    adaptation = await runStageWithLease({
      persistence,
      ingestionId: review.ingestionId,
      ownerToken: claim.ownerToken,
      now,
      leaseMs: effectiveLeaseMs,
      renewIntervalMs: heartbeatIntervalMs,
      timeoutMs: stageTimeoutMs,
      stage: "ADAPTED",
      externalSignal: abortSignal,
      operation: () => adaptTemplateSource({
        sourceDir,
        templateId: review.templateId,
        templateVersion: review.templateVersion,
        provenance: { sourceCommitSha: review.sourceCommitSha, ingestionId: review.ingestionId },
        approvedReviewRecord: {
          status: review.status,
          auditReport: review.auditReport,
          reviewDecision: review.reviewDecision,
        },
      }),
    });
    if (adaptation.status !== "COMPATIBLE" && adaptation.status !== "ADAPTED") {
      return await recordFailure("ADAPTED", adaptation.error || "Template adaptation failed.");
    }
    await safeUpdate(persistence, review.ingestionId, claim.ownerToken, { status: "ADAPTED", updatedAt: now().toISOString() }, now());

    stageRoot = fs.mkdtempSync(path.join(stagedArtifactsRoot || os.tmpdir(), "onevue-lifecycle-"));
    currentStage = "BUILT";
    build = await runStageWithLease({
      persistence,
      ingestionId: review.ingestionId,
      ownerToken: claim.ownerToken,
      now,
      leaseMs: effectiveLeaseMs,
      renewIntervalMs: heartbeatIntervalMs,
      timeoutMs: stageTimeoutMs,
      stage: "BUILT",
      externalSignal: abortSignal,
      operation: (signal) => buildAndPackageTemplate(
        {
          templateId: review.templateId,
          templateVersion: review.templateVersion,
          sourceCommitSha: review.sourceCommitSha,
          adaptationResult: adaptation!,
          approvedReviewRecord: {
            status: review.status,
            auditReport: review.auditReport,
            reviewDecision: review.reviewDecision,
          },
          explicitConfirmation: true,
          stagedArtifactsDir: stageRoot,
          timeoutMs: stageTimeoutMs,
          signal,
        },
        buildExecutor
      ),
    });
    if (!build.success || !build.manifest || !build.artifactDir) {
      return await recordFailure("BUILT", build.error || "Template build failed.");
    }
    await safeUpdate(persistence, review.ingestionId, claim.ownerToken, {
      status: "BUILT",
      manifest: build.manifest,
      manifestSha256: build.manifestSha256,
      updatedAt: now().toISOString(),
    }, now());

    currentStage = "STORED";
    const stored = await runStageWithLease({
      persistence,
      ingestionId: review.ingestionId,
      ownerToken: claim.ownerToken,
      now,
      leaseMs: effectiveLeaseMs,
      renewIntervalMs: heartbeatIntervalMs,
      timeoutMs: stageTimeoutMs,
      stage: "STORED",
      externalSignal: abortSignal,
      operation: () => storageAdapter.storeArtifact(
        review.templateId,
        review.templateVersion,
        build!.artifactDir!,
        build!.manifest!
      ),
    });
    if (!stored.success || !stored.manifest) {
      return await recordFailure("STORED", stored.error || "Artifact storage failed.");
    }
    await safeUpdate(persistence, review.ingestionId, claim.ownerToken, {
      status: "STORED",
      storageLocation: stored.storageLocation,
      updatedAt: now().toISOString(),
    }, now());

    const validated = await runStageWithLease({
      persistence,
      ingestionId: review.ingestionId,
      ownerToken: claim.ownerToken,
      now,
      leaseMs: effectiveLeaseMs,
      renewIntervalMs: heartbeatIntervalMs,
      timeoutMs: stageTimeoutMs,
      stage: "STORED",
      externalSignal: abortSignal,
      operation: () => storageAdapter.validateStoredArtifact(review.templateId, review.templateVersion),
    });
    if (!validated.success || !validated.manifest || !validated.manifest.manifestSha256) {
      return await recordFailure("STORED", validated.error || "Stored artifact integrity validation failed.");
    }

    const eligible: LifecycleRecord = {
      ingestionId: review.ingestionId,
      status: "CATALOG_ELIGIBLE",
      templateId: review.templateId,
      templateVersion: review.templateVersion,
      sourceCommitSha: review.sourceCommitSha,
      manifest: validated.manifest,
      manifestSha256: validated.manifest.manifestSha256,
      storageLocation: validated.storageLocation || stored.storageLocation,
      updatedAt: now().toISOString(),
    };
    await safeUpdate(persistence, review.ingestionId, claim.ownerToken, eligible, now());
    return {
      success: true,
      status: eligible.status,
      manifest: eligible.manifest,
      manifestSha256: eligible.manifestSha256,
      storageLocation: eligible.storageLocation,
    };
  } catch (error) {
    return await recordFailure(currentStage, error);
  } finally {
    if (adaptation?.cleanup) {
      try { await adaptation.cleanup(); } catch {}
    }
    if (build?.artifactDir && stageRoot) {
      // Only remove artifacts that belong to this invocation's private staging
      // root. Never delete a path outside it, even if an executor returned one.
      const resolvedArtifact = path.resolve(build.artifactDir);
      if (resolvedArtifact.startsWith(path.resolve(stageRoot) + path.sep)) {
        try { fs.rmSync(resolvedArtifact, { recursive: true, force: true }); } catch {}
      }
    }
    if (stageRoot) {
      try { fs.rmSync(stageRoot, { recursive: true, force: true }); } catch {}
    }
    if (ownsSource && claim && sourceCleanup) {
      // An expired owner must not remove source files that may now belong to a
      // newer owner. Ownership is re-checked immediately before cleanup.
      try {
        if (await persistence.isOwner(review.ingestionId, claim.ownerToken, now())) {
          await sourceCleanup();
        }
      } catch {}
    }
  }
}
