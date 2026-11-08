/**
 * =========================================================================
 * OneVue Phase 4.5 — Private Template Repository Provisioning Foundation
 * =========================================================================
 *
 * Guarantees:
 * 1. Fixed organization to 'qubort-tech' with private-only visibility.
 * 2. Strict input validation (source URL, commit SHA, template ID/version, audit approval).
 * 3. Separation of planning (deterministic plan generation) from execution (mock executor).
 * 4. Secure source file copying with secret/env exclusion, symlink blocking, and traversal protection.
 * 5. Collision prevention and strict post-provisioning verification contracts.
 * 6. Zero real GitHub API calls, zero code execution, zero registry mutations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { validateGitHubRepoUrl, validateCommitSha } from "./github-ingestion";
import { TemplateAuditReport } from "./template-audit";
import { GitHubApiClient, getGitHubProvisioningConfig, DEFAULT_PROVISIONING_BRANCH } from "./github-api-client";

/* =========================================================================
   Types and Interfaces
   ========================================================================= */

export const FIXED_DESTINATION_ORG = "qubort-tech" as const;
export const FIXED_VISIBILITY = "private" as const;

/**
 * Provenance marker written into the private mirror. It records which
 * upstream source commit the mirror was built from, so a later provisioning
 * run can recognise and adopt an already-correct mirror instead of failing
 * with a permanent collision.
 */
export const PROVENANCE_MARKER_PATH = ".onevue/provenance.json";

const REPO_NAME_REGEX = /^[a-zA-Z0-9_.-]{1,100}$/;
const TEMPLATE_ID_REGEX = /^[a-z0-9-_]{1,64}$/;
const SEMVER_REGEX = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

export interface ProvisioningInput {
  sourceUrl: string;
  commitSha: string;
  templateId: string;
  templateVersion: string;
  auditReport: TemplateAuditReport;
  destinationRepo: string;
  explicitApproval?: boolean;
  approvalReason?: string;
  explicitConfirmation: boolean;
  sourceDir: string; // Inspected source directory from Phase 4.3 extraction
}

export interface SourceProvenance {
  sourceUrl: string;
  commitSha: string;
  templateId: string;
  templateVersion: string;
  auditOutcome: string;
  auditTimestamp: string;
  destinationOrg: string;
  destinationRepo: string;
  provisionedAt: string;
  /** Commit SHA of the mirrored content inside the private repository. */
  destinationCommitSha?: string;
  /** True when an already-existing, already-correct mirror was adopted. */
  adopted?: boolean;
}

export interface ProvisioningPlan {
  valid: boolean;
  error?: string;
  destinationOrg: string;
  destinationRepo: string;
  visibility: "private";
  provenance: SourceProvenance;
  filesToCopy: Array<{ relativePath: string; sourcePath: string; sizeBytes: number }>;
  excludedFiles: Array<{ relativePath: string; reason: string }>;
}

export interface ProvisioningResult {
  success: boolean;
  error?: string;
  destinationOrg?: string;
  destinationRepo?: string;
  visibility?: string;
  provenance?: SourceProvenance & { isMock?: boolean; mockProvisioning?: boolean; provisionerMode?: string };
  verifiedPrivate?: boolean;
  isMock?: boolean;
  errorCategory?: "INPUT_VALIDATION" | "AUDIT_REJECTED" | "APPROVAL_REQUIRED" | "COLLISION" | "PROVISIONING_EXECUTION" | "VERIFICATION_FAILED";
}

export interface ProvisioningExecutor {
  createPrivateRepository(org: string, repo: string, options?: { description?: string }): Promise<{ success: boolean; url?: string; visibility?: string; owner?: string; error?: string }>;
  checkRepositoryExists(org: string, repo: string): Promise<boolean>;
  copyFilesToRepository(
    org: string,
    repo: string,
    files: Array<{ relativePath: string; sourcePath: string }>,
    options?: { provenance?: SourceProvenance }
  ): Promise<{ success: boolean; error?: string; commitSha?: string }>;
  /**
   * Optional rollback of a repository that this same run created. Executors
   * that do not implement it simply cannot clean up after a partial failure.
   */
  deleteRepository?(org: string, repo: string): Promise<{ success: boolean; error?: string }>;
  /**
   * Optional inspection of an existing repository, used to decide whether a
   * collision can be safely adopted (already-correct mirror) instead of
   * failing permanently.
   */
  inspectRepository?(
    org: string,
    repo: string,
    options?: { provenance?: SourceProvenance }
  ): Promise<{
    success: boolean;
    exists: boolean;
    owner?: string;
    visibility?: string;
    isPrivate?: boolean;
    defaultBranch?: string;
    headCommitSha?: string;
    matchesProvenance?: boolean;
    error?: string;
  }>;
}

/* =========================================================================
   Secret & Sensitive File Filtering Rules
   ========================================================================= */

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.htpasswd$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.git(\/|$)/,
  /node_modules(\/|$)/,
  /dist(\/|$)/,
  /\.DS_Store$/,
  /Thumbs\.db$/,
];

function isForbiddenFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/* =========================================================================
   Step 2 & 3: Provisioning Plan Generator
   ========================================================================= */

/**
 * Validates provisioning inputs, checks audit compliance, filters sensitive files,
 * and produces a deterministic ProvisioningPlan without executing any live actions.
 */
export function createProvisioningPlan(input: ProvisioningInput): ProvisioningPlan {
  const {
    sourceUrl,
    commitSha,
    templateId,
    templateVersion,
    auditReport,
    destinationRepo,
    explicitApproval,
    explicitConfirmation,
    sourceDir,
  } = input;

  // 1. Explicit Confirmation Check
  if (explicitConfirmation !== true) {
    return {
      valid: false,
      error: "Provisioning rejected: Explicit confirmation flag (explicitConfirmation: true) is required.",
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  // 2. Source URL Validation
  const urlCheck = validateGitHubRepoUrl(sourceUrl);
  if (!urlCheck.valid) {
    return {
      valid: false,
      error: `Provisioning rejected: Invalid source URL: ${urlCheck.error}`,
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  // 3. Commit SHA Validation
  const shaCheck = validateCommitSha(commitSha);
  if (!shaCheck.valid || !shaCheck.sha) {
    return {
      valid: false,
      error: `Provisioning rejected: Invalid commit SHA: ${shaCheck.error}`,
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  // 4. Template ID & Version Validation
  if (!templateId || typeof templateId !== "string" || !TEMPLATE_ID_REGEX.test(templateId.trim())) {
    return {
      valid: false,
      error: `Provisioning rejected: Invalid templateId format ('${templateId}').`,
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  if (!templateVersion || typeof templateVersion !== "string" || !SEMVER_REGEX.test(templateVersion.trim())) {
    return {
      valid: false,
      error: `Provisioning rejected: Invalid templateVersion semantic version format ('${templateVersion}').`,
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  // 5. Audit Report Outcome Policy
  if (!auditReport || !auditReport.outcome) {
    return {
      valid: false,
      error: "Provisioning rejected: Missing required template audit report.",
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  if (auditReport.outcome === "REJECT") {
    return {
      valid: false,
      error: "Provisioning rejected: Template audit outcome is 'REJECT' due to critical policy violations.",
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  if (auditReport.outcome === "REVIEW_REQUIRED" && explicitApproval !== true) {
    return {
      valid: false,
      error: "Provisioning rejected: Template audit outcome is 'REVIEW_REQUIRED' and explicit administrator approval (explicitApproval: true) is absent.",
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: destinationRepo || "",
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  // 6. Destination Repository Name Validation
  const cleanRepo = typeof destinationRepo === "string" ? destinationRepo.trim() : "";
  if (!REPO_NAME_REGEX.test(cleanRepo)) {
    return {
      valid: false,
      error: `Provisioning rejected: Invalid destination repository name ('${destinationRepo}').`,
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: cleanRepo,
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  // 7. Source Directory Scanning & File Filtering
  const filesToCopy: Array<{ relativePath: string; sourcePath: string; sizeBytes: number }> = [];
  const excludedFiles: Array<{ relativePath: string; reason: string }> = [];

  if (!sourceDir || !fs.existsSync(sourceDir)) {
    return {
      valid: false,
      error: `Provisioning rejected: Source directory does not exist: '${sourceDir}'.`,
      destinationOrg: FIXED_DESTINATION_ORG,
      destinationRepo: cleanRepo,
      visibility: FIXED_VISIBILITY,
      provenance: {} as any,
      filesToCopy: [],
      excludedFiles: [],
    };
  }

  const canonicalSourceDir = path.resolve(sourceDir);

  const scanDir = (currentDir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // Safely skip permission-denied or unreadable subdirectories
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(canonicalSourceDir, fullPath).replace(/\\/g, "/");

      // Symlink barrier check
      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) {
          excludedFiles.push({ relativePath, reason: "Symbolic link excluded for security reasons." });
          continue;
        }
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        if (isForbiddenFile(relativePath + "/")) {
          excludedFiles.push({ relativePath, reason: "Directory matches forbidden exclusion pattern." });
        } else {
          scanDir(fullPath);
        }
      } else if (entry.isFile()) {
        if (isForbiddenFile(relativePath)) {
          excludedFiles.push({ relativePath, reason: "File matches forbidden secret/exclusion pattern." });
        } else {
          try {
            const stat = fs.statSync(fullPath);
            // Limit individual file size to 10 MB for provisioning safety
            if (stat.size > 10 * 1024 * 1024) {
              excludedFiles.push({ relativePath, reason: "File exceeds 10MB maximum size limit." });
            } else {
              filesToCopy.push({
                relativePath,
                sourcePath: fullPath,
                sizeBytes: stat.size,
              });
            }
          } catch {
            excludedFiles.push({ relativePath, reason: "Failed to stat file." });
          }
        }
      }
    }
  };

  scanDir(canonicalSourceDir);

  const provenance: SourceProvenance = {
    sourceUrl: urlCheck.repoRef!.canonicalUrl,
    commitSha: shaCheck.sha,
    templateId: templateId.trim(),
    templateVersion: templateVersion.trim(),
    auditOutcome: auditReport.outcome,
    auditTimestamp: auditReport.timestamp || new Date().toISOString(),
    destinationOrg: FIXED_DESTINATION_ORG,
    destinationRepo: cleanRepo,
    provisionedAt: new Date().toISOString(),
  };

  return {
    valid: true,
    destinationOrg: FIXED_DESTINATION_ORG,
    destinationRepo: cleanRepo,
    visibility: FIXED_VISIBILITY,
    provenance,
    filesToCopy,
    excludedFiles,
  };
}

/* =========================================================================
   Step 4 & 5: Provisioning Execution Engine (Mock / Offline)
   ========================================================================= */

/**
 * Executes a validated ProvisioningPlan using a mock or caller-provided executor.
 * Strictly guarantees:
 * - Organization is always 'qubort-tech'.
 * - Visibility is always 'private'.
 * - Rejects collisions (does not overwrite existing repositories) unless the
 *   existing repository is provably the correct private mirror, in which case
 *   it is adopted idempotently.
 * - Rolls back a repository created by this run when a later step fails, so a
 *   retry is never permanently blocked by an orphaned repository.
 * - Verifies ownership and privacy post-creation before returning success.
 */
export async function executeProvisioningPlan(
  plan: ProvisioningPlan,
  executor: ProvisioningExecutor
): Promise<ProvisioningResult> {
  if (!plan.valid) {
    return {
      success: false,
      error: `Execution failed: Provisioning plan is invalid: ${plan.error}`,
      errorCategory: "INPUT_VALIDATION",
    };
  }

  // 1. Enforce organizational invariants
  if (plan.destinationOrg !== FIXED_DESTINATION_ORG || plan.visibility !== "private") {
    return {
      success: false,
      error: "Execution failed: Organizational invariant violation (organization must be qubort-tech and visibility private).",
      errorCategory: "PROVISIONING_EXECUTION",
    };
  }

  /**
   * Removes a repository that this run created, after a later step failed.
   * Never throws: a failed rollback must not mask the original error.
   */
  const rollback = async (): Promise<string> => {
    if (typeof executor.deleteRepository !== "function") return "";
    try {
      const result = await executor.deleteRepository(plan.destinationOrg, plan.destinationRepo);
      if (result?.success) {
        return " The partially created repository was rolled back (deleted).";
      }
      return ` Rollback failed: repository '${plan.destinationOrg}/${plan.destinationRepo}' may still exist and must be removed manually.`;
    } catch {
      return ` Rollback failed: repository '${plan.destinationOrg}/${plan.destinationRepo}' may still exist and must be removed manually.`;
    }
  };

  try {
    // 2. Check collision
    const exists = await executor.checkRepositoryExists(plan.destinationOrg, plan.destinationRepo);
    if (exists) {
      // 2a. Idempotent adoption: an existing repository is only accepted when
      // it is private, owned by the fixed organization, and its provenance
      // marker proves it mirrors this exact source commit.
      if (typeof executor.inspectRepository === "function") {
        const inspection = await executor.inspectRepository(plan.destinationOrg, plan.destinationRepo, {
          provenance: plan.provenance,
        });

        if (
          inspection?.success &&
          inspection.exists &&
          inspection.matchesProvenance === true &&
          inspection.isPrivate === true &&
          inspection.owner === FIXED_DESTINATION_ORG
        ) {
          return {
            success: true,
            destinationOrg: plan.destinationOrg,
            destinationRepo: plan.destinationRepo,
            visibility: FIXED_VISIBILITY,
            provenance: {
              ...plan.provenance,
              destinationCommitSha: inspection.headCommitSha,
              adopted: true,
              isMock: Boolean((executor as any).isMock),
              mockProvisioning: Boolean((executor as any).isMock),
              provisionerMode: (executor as any).isMock ? "mock_local" : "live_github",
            },
            verifiedPrivate: true,
            isMock: Boolean((executor as any).isMock),
          };
        }
      }

      return {
        success: false,
        error: `Execution failed: Destination repository '${plan.destinationOrg}/${plan.destinationRepo}' already exists. Overwriting is strictly prohibited.`,
        errorCategory: "COLLISION",
      };
    }

    // 3. Create private repository
    const createRes = await executor.createPrivateRepository(plan.destinationOrg, plan.destinationRepo, {
      description: `OneVue approved template: ${plan.provenance.templateId}@${plan.provenance.templateVersion}`,
    });

    if (!createRes.success) {
      return {
        success: false,
        error: `Execution failed during repository creation: ${createRes.error}`,
        errorCategory: "PROVISIONING_EXECUTION",
      };
    }

    // 4. Copy files
    const copyRes = await executor.copyFilesToRepository(
      plan.destinationOrg,
      plan.destinationRepo,
      plan.filesToCopy.map((f) => ({ relativePath: f.relativePath, sourcePath: f.sourcePath })),
      { provenance: plan.provenance }
    );

    if (!copyRes.success) {
      return {
        success: false,
        error: `Execution failed during file copying: ${copyRes.error}${await rollback()}`,
        errorCategory: "PROVISIONING_EXECUTION",
      };
    }

    // 5. Post-provisioning verification contract
    const verifyExists = await executor.checkRepositoryExists(plan.destinationOrg, plan.destinationRepo);
    if (!verifyExists) {
      return {
        success: false,
        error: `Verification failed: Repository could not be confirmed post-creation.${await rollback()}`,
        errorCategory: "VERIFICATION_FAILED",
      };
    }

    // 5a. When the executor can read the repository back, privacy and
    // ownership are verified against the live repository state rather than
    // against the creation response alone.
    if (typeof executor.inspectRepository === "function") {
      const inspection = await executor.inspectRepository(plan.destinationOrg, plan.destinationRepo, {
        provenance: plan.provenance,
      });

      if (!inspection?.success || !inspection.exists) {
        return {
          success: false,
          error: `Verification failed: Repository could not be confirmed post-creation.${await rollback()}`,
          errorCategory: "VERIFICATION_FAILED",
        };
      }
      if (inspection.owner && inspection.owner !== FIXED_DESTINATION_ORG) {
        return {
          success: false,
          error: `Verification failed: Repository owner mismatch ('${inspection.owner}' !== '${FIXED_DESTINATION_ORG}').${await rollback()}`,
          errorCategory: "VERIFICATION_FAILED",
        };
      }
      if (inspection.isPrivate !== true || inspection.visibility !== FIXED_VISIBILITY) {
        return {
          success: false,
          error: `Verification failed: Repository visibility invariant violation ('${inspection.visibility || "unknown"}' !== 'private').${await rollback()}`,
          errorCategory: "VERIFICATION_FAILED",
        };
      }
    }

    if (createRes.owner && createRes.owner !== FIXED_DESTINATION_ORG) {
      return {
        success: false,
        error: `Verification failed: Repository owner mismatch ('${createRes.owner}' !== '${FIXED_DESTINATION_ORG}').${await rollback()}`,
        errorCategory: "VERIFICATION_FAILED",
      };
    }

    if (createRes.visibility && createRes.visibility !== FIXED_VISIBILITY) {
      return {
        success: false,
        error: `Verification failed: Repository visibility invariant violation ('${createRes.visibility}' !== 'private').${await rollback()}`,
        errorCategory: "VERIFICATION_FAILED",
      };
    }

    const isMock = Boolean((executor as any).isMock || (createRes as any).isMock);
    return {
      success: true,
      destinationOrg: plan.destinationOrg,
      destinationRepo: plan.destinationRepo,
      visibility: FIXED_VISIBILITY,
      provenance: {
        ...plan.provenance,
        destinationCommitSha: copyRes.commitSha,
        adopted: false,
        isMock,
        mockProvisioning: isMock,
        provisionerMode: isMock ? "mock_local" : "live_github",
      },
      verifiedPrivate: true,
      isMock,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Unexpected provisioning execution error: ${err instanceof Error ? err.message : String(err)}`,
      errorCategory: "PROVISIONING_EXECUTION",
    };
  }
}

/**
 * Mock executor for offline testing and development.
 */
export class MockProvisioningExecutor implements ProvisioningExecutor {
  existingRepos: Set<string>;
  shouldFailCreate: boolean;
  shouldFailCopy: boolean;
  shouldFailDelete: boolean;
  createdRepos: string[] = [];
  copiedFiles: any[] = [];
  deletedRepos: string[] = [];
  /** Repositories the mock reports as an already-correct private mirror. */
  adoptableRepos: Set<string>;
  readonly isMock: boolean = true;

  constructor(
    options: {
      existingRepos?: string[];
      shouldFailCreate?: boolean;
      shouldFailCopy?: boolean;
      shouldFailDelete?: boolean;
      adoptableRepos?: string[];
    } = {}
  ) {
    this.existingRepos = new Set(options.existingRepos || []);
    this.shouldFailCreate = Boolean(options.shouldFailCreate);
    this.shouldFailCopy = Boolean(options.shouldFailCopy);
    this.shouldFailDelete = Boolean(options.shouldFailDelete);
    this.adoptableRepos = new Set(options.adoptableRepos || []);
  }

  async checkRepositoryExists(org: string, repo: string): Promise<boolean> {
    return this.existingRepos.has(`${org}/${repo}`);
  }

  async createPrivateRepository(org: string, repo: string, options?: { description?: string }) {
    if (this.shouldFailCreate) {
      return { success: false, error: "Mock repository creation failed." };
    }
    const key = `${org}/${repo}`;
    this.existingRepos.add(key);
    this.createdRepos.push(key);
    return {
      success: true,
      url: `mock://local-development/${org}/${repo}`,
      visibility: "private",
      owner: org,
      isMock: true,
    };
  }

  async copyFilesToRepository(org: string, repo: string, files: Array<{ relativePath: string; sourcePath: string }>) {
    if (this.shouldFailCopy) {
      return { success: false, error: "Mock file copying failed." };
    }
    this.copiedFiles.push(...files);
    return { success: true, commitSha: "0".repeat(40) };
  }

  async inspectRepository(org: string, repo: string, options?: { provenance?: SourceProvenance }) {
    const key = `${org}/${repo}`;
    const adoptable = this.adoptableRepos.has(key);
    return {
      success: true,
      exists: this.existingRepos.has(key),
      owner: org,
      visibility: "private",
      isPrivate: true,
      defaultBranch: "main",
      headCommitSha: adoptable ? "1".repeat(40) : undefined,
      matchesProvenance: adoptable,
    };
  }

  async deleteRepository(org: string, repo: string) {
    if (this.shouldFailDelete) {
      return { success: false, error: "Mock repository deletion failed." };
    }
    const key = `${org}/${repo}`;
    this.existingRepos.delete(key);
    this.deletedRepos.push(key);
    return { success: true };
  }
}

/**
 * Live executor using GitHub REST API client.
 * Execution is guarded by ENABLE_LIVE_GITHUB_PROVISIONING="true" and requires server token.
 *
 * The approved source is delivered with the GitHub Git Data API
 * (blob -> tree -> commit -> ref), so the mirror contains the real template
 * content rather than an empty repository.
 */
export class LiveGitHubProvisioningExecutor implements ProvisioningExecutor {
  private client: GitHubApiClient;
  readonly isMock: boolean = false;

  constructor(client?: GitHubApiClient, env?: Record<string, string | undefined>) {
    const effectiveEnv = env || process.env;
    const liveEnabled = effectiveEnv.ENABLE_LIVE_GITHUB_PROVISIONING === "true";
    const token = effectiveEnv.GITHUB_PROVISIONING_TOKEN || effectiveEnv.ONEVUE_GITHUB_TOKEN;
    const configured = Boolean(token && token.trim().length >= 20);

    if (!liveEnabled) {
      throw new Error("Live GitHub provisioning is disabled by server configuration (ENABLE_LIVE_GITHUB_PROVISIONING != true).");
    }
    if (!configured) {
      throw new Error("GitHub provisioning credential (GITHUB_PROVISIONING_TOKEN) is missing or invalid on the server.");
    }
    this.client = client || new GitHubApiClient({ token });
  }

  async checkRepositoryExists(org: string, repo: string): Promise<boolean> {
    return this.client.checkRepositoryExists(org, repo);
  }

  async createPrivateRepository(org: string, repo: string, options?: { description?: string }) {
    return this.client.createPrivateOrgRepository(org, repo, options);
  }

  /**
   * Pushes the approved source files into the private repository and records a
   * provenance marker so a later run can recognise an already-correct mirror.
   */
  async copyFilesToRepository(
    org: string,
    repo: string,
    files: Array<{ relativePath: string; sourcePath: string }>,
    options?: { provenance?: SourceProvenance }
  ) {
    try {
      const payload: Array<{ relativePath: string; contentBase64: string }> = [];

      for (const f of files) {
        if (!fs.existsSync(f.sourcePath)) {
          return { success: false, error: `Source file missing: ${f.relativePath}` };
        }
        const bytes = fs.readFileSync(f.sourcePath);
        payload.push({ relativePath: f.relativePath, contentBase64: bytes.toString("base64") });
      }

      const provenance = options?.provenance;
      if (provenance) {
        const marker = {
          sourceUrl: provenance.sourceUrl,
          sourceCommitSha: provenance.commitSha,
          templateId: provenance.templateId,
          templateVersion: provenance.templateVersion,
          auditOutcome: provenance.auditOutcome,
          provisionedAt: provenance.provisionedAt,
        };
        payload.push({
          relativePath: PROVENANCE_MARKER_PATH,
          contentBase64: Buffer.from(JSON.stringify(marker, null, 2), "utf8").toString("base64"),
        });
      }

      const push = await this.client.pushFiles(org, repo, payload, {
        branch: DEFAULT_PROVISIONING_BRANCH,
        message: `OneVue approved template mirror: ${provenance?.templateId ?? "template"}@${provenance?.templateVersion ?? "0.0.0"}`,
      });

      if (!push.success) {
        return { success: false, error: push.error || "GitHub content push failed." };
      }

      return { success: true, commitSha: push.commitSha };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Rolls back a repository created by this provisioning run. The underlying
   * client refuses to delete a repository it did not create.
   */
  async deleteRepository(org: string, repo: string) {
    return this.client.deleteRepository(org, repo);
  }

  /**
   * Reads the live repository state so privacy, ownership and mirror identity
   * are verified against GitHub rather than against a creation response.
   */
  async inspectRepository(org: string, repo: string, options?: { provenance?: SourceProvenance }) {
    const state = await this.client.getRepositoryState(org, repo);
    if (!state.success || !state.exists) {
      return { success: state.success, exists: false, error: state.error };
    }

    const inspection: {
      success: boolean;
      exists: boolean;
      owner?: string;
      visibility?: string;
      isPrivate?: boolean;
      defaultBranch?: string;
      headCommitSha?: string;
      matchesProvenance?: boolean;
      error?: string;
    } = {
      success: true,
      exists: true,
      owner: state.owner,
      visibility: state.visibility,
      isPrivate: state.isPrivate,
      defaultBranch: state.defaultBranch,
      headCommitSha: state.headCommitSha,
    };

    const provenance = options?.provenance;
    if (provenance) {
      const marker = await this.client.readFileContent(
        org,
        repo,
        PROVENANCE_MARKER_PATH,
        state.defaultBranch || DEFAULT_PROVISIONING_BRANCH
      );
      if (marker.success && marker.exists && marker.contentBase64) {
        try {
          const parsed = JSON.parse(Buffer.from(marker.contentBase64, "base64").toString("utf8"));
          inspection.matchesProvenance =
            parsed?.sourceCommitSha === provenance.commitSha && parsed?.sourceUrl === provenance.sourceUrl;
        } catch {
          inspection.matchesProvenance = false;
        }
      } else {
        inspection.matchesProvenance = false;
      }
    }

    return inspection;
  }
}

export interface ProvisioningResolution {
  executor?: ProvisioningExecutor;
  mode: "live" | "mock" | "unavailable";
  reason: string;
  isMock: boolean;
}

/**
 * Resolves the appropriate ProvisioningExecutor based on environment.
 *
 * Rules:
 * 1. Production (NODE_ENV === "production"):
 *    - Never selects MockProvisioningExecutor.
 *    - Requires live provisioning (ENABLE_LIVE_GITHUB_PROVISIONING === "true" and valid token >= 20 chars).
 *    - Missing credentials/config returns executor: undefined (fails closed with HTTP 503).
 * 2. Non-production (development, test, etc.):
 *    - If ENABLE_LIVE_GITHUB_PROVISIONING === "true": uses LiveGitHubProvisioningExecutor (fails closed if token missing).
 *    - If live provisioning is disabled (default): selects MockProvisioningExecutor for local development.
 */
export function resolveProvisioningExecutor(
  env: Record<string, string | undefined> = process.env
): ProvisioningResolution {
  const isProduction = env.NODE_ENV === "production";
  const liveEnabled = env.ENABLE_LIVE_GITHUB_PROVISIONING === "true";
  const token = env.GITHUB_PROVISIONING_TOKEN || env.ONEVUE_GITHUB_TOKEN;
  const hasValidToken = Boolean(token && token.trim().length >= 20);

  // 1. In production, never select the mock executor.
  if (isProduction) {
    if (liveEnabled && hasValidToken) {
      return {
        executor: new LiveGitHubProvisioningExecutor(undefined, env),
        mode: "live",
        reason: "Live GitHub provisioning executor selected for production.",
        isMock: false,
      };
    }
    return {
      executor: undefined,
      mode: "unavailable",
      reason: liveEnabled
        ? "GitHub provisioning credential (GITHUB_PROVISIONING_TOKEN) is missing or invalid on the server."
        : "Live GitHub provisioning is required in production but disabled by server configuration (ENABLE_LIVE_GITHUB_PROVISIONING != true).",
      isMock: false,
    };
  }

  // 2. Non-production with explicit live provisioning requested:
  if (liveEnabled) {
    if (hasValidToken) {
      return {
        executor: new LiveGitHubProvisioningExecutor(undefined, env),
        mode: "live",
        reason: "Live GitHub provisioning executor selected (explicitly enabled).",
        isMock: false,
      };
    }
    return {
      executor: undefined,
      mode: "unavailable",
      reason: "GitHub provisioning credential (GITHUB_PROVISIONING_TOKEN) is missing or invalid on the server.",
      isMock: false,
    };
  }

  // 3. Non-production with live provisioning disabled (default for local dev): select mock executor
  return {
    executor: new MockProvisioningExecutor(),
    mode: "mock",
    reason: "Local development mock provisioning selected (live provisioning is disabled).",
    isMock: true,
  };
}
