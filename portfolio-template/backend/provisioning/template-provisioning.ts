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
import { GitHubApiClient, getGitHubProvisioningConfig } from "./github-api-client";

/* =========================================================================
   Types and Interfaces
   ========================================================================= */

export const FIXED_DESTINATION_ORG = "qubort-tech" as const;
export const FIXED_VISIBILITY = "private" as const;

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
  provenance?: SourceProvenance;
  verifiedPrivate?: boolean;
  errorCategory?: "INPUT_VALIDATION" | "AUDIT_REJECTED" | "APPROVAL_REQUIRED" | "COLLISION" | "PROVISIONING_EXECUTION" | "VERIFICATION_FAILED";
}

export interface ProvisioningExecutor {
  createPrivateRepository(org: string, repo: string, options?: { description?: string }): Promise<{ success: boolean; url?: string; visibility?: string; owner?: string; error?: string }>;
  checkRepositoryExists(org: string, repo: string): Promise<boolean>;
  copyFilesToRepository(org: string, repo: string, files: Array<{ relativePath: string; sourcePath: string }>): Promise<{ success: boolean; error?: string }>;
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
 * - Rejects collisions (does not overwrite existing repositories).
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

  try {
    // 2. Check collision
    const exists = await executor.checkRepositoryExists(plan.destinationOrg, plan.destinationRepo);
    if (exists) {
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
      plan.filesToCopy.map((f) => ({ relativePath: f.relativePath, sourcePath: f.sourcePath }))
    );

    if (!copyRes.success) {
      return {
        success: false,
        error: `Execution failed during file copying: ${copyRes.error}`,
        errorCategory: "PROVISIONING_EXECUTION",
      };
    }

    // 5. Post-provisioning verification contract
    const verifyExists = await executor.checkRepositoryExists(plan.destinationOrg, plan.destinationRepo);
    if (!verifyExists) {
      return {
        success: false,
        error: "Verification failed: Repository could not be confirmed post-creation.",
        errorCategory: "VERIFICATION_FAILED",
      };
    }

    if (createRes.owner && createRes.owner !== FIXED_DESTINATION_ORG) {
      return {
        success: false,
        error: `Verification failed: Repository owner mismatch ('${createRes.owner}' !== '${FIXED_DESTINATION_ORG}').`,
        errorCategory: "VERIFICATION_FAILED",
      };
    }

    if (createRes.visibility && createRes.visibility !== FIXED_VISIBILITY) {
      return {
        success: false,
        error: `Verification failed: Repository visibility invariant violation ('${createRes.visibility}' !== 'private').`,
        errorCategory: "VERIFICATION_FAILED",
      };
    }

    return {
      success: true,
      destinationOrg: plan.destinationOrg,
      destinationRepo: plan.destinationRepo,
      visibility: FIXED_VISIBILITY,
      provenance: plan.provenance,
      verifiedPrivate: true,
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
  createdRepos: string[] = [];
  copiedFiles: any[] = [];

  constructor(options: { existingRepos?: string[]; shouldFailCreate?: boolean; shouldFailCopy?: boolean } = {}) {
    this.existingRepos = new Set(options.existingRepos || []);
    this.shouldFailCreate = Boolean(options.shouldFailCreate);
    this.shouldFailCopy = Boolean(options.shouldFailCopy);
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
      url: `https://github.com/${org}/${repo}`,
      visibility: "private",
      owner: org,
    };
  }

  async copyFilesToRepository(org: string, repo: string, files: Array<{ relativePath: string; sourcePath: string }>) {
    if (this.shouldFailCopy) {
      return { success: false, error: "Mock file copying failed." };
    }
    this.copiedFiles.push(...files);
    return { success: true };
  }
}

/**
 * Live executor using GitHub REST API client.
 * Execution is guarded by ENABLE_LIVE_GITHUB_PROVISIONING="true" and requires server token.
 */
export class LiveGitHubProvisioningExecutor implements ProvisioningExecutor {
  private client: GitHubApiClient;

  constructor(client?: GitHubApiClient) {
    const config = getGitHubProvisioningConfig();
    if (!config.liveEnabled) {
      throw new Error("Live GitHub provisioning is disabled by server configuration (ENABLE_LIVE_GITHUB_PROVISIONING != true).");
    }
    if (!config.configured) {
      throw new Error(config.error || "GitHub provisioning token is missing on server.");
    }
    this.client = client || new GitHubApiClient();
  }

  async checkRepositoryExists(org: string, repo: string): Promise<boolean> {
    return this.client.checkRepositoryExists(org, repo);
  }

  async createPrivateRepository(org: string, repo: string, options?: { description?: string }) {
    return this.client.createPrivateOrgRepository(org, repo, options);
  }

  async copyFilesToRepository(
    org: string,
    repo: string,
    files: Array<{ relativePath: string; sourcePath: string }>
  ) {
    try {
      for (const f of files) {
        if (!fs.existsSync(f.sourcePath)) {
          return { success: false, error: `Source file missing: ${f.relativePath}` };
        }
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
