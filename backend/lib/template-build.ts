/**
 * =========================================================================
 * OneVue Phase 5.4 — Isolated Build Worker & Immutable Artifact Packaging
 * =========================================================================
 *
 * Guarantees:
 * 1. Strict input validation: Requires verified approval, audit compliance,
 *    compatible adaptation status, semver formatting, and explicit confirmation.
 * 2. Isolated execution boundary: Untrusted build commands are NEVER executed
 *    on the host or in application processes. Real execution requires
 *    ENABLE_ISOLATED_BUILD_EXECUTION="true", a fully validated isolation
 *    configuration, and an injected verified runtime adapter; default behavior
 *    fails closed. A child process alone is not an isolation boundary.
 * 3. Deterministic artifact packaging & verification: Validates output files,
 *    requires index.html, rejects secrets, symlinks, and traversal escapes,
 *    and generates a cryptographic SHA-256 release manifest.
 * 4. Immutable versioned storage: Enforces path convention templates/<id>/<version>/,
 *    strictly rejecting silent overwrites or mutation of existing version artifacts.
 * 5. Zero live network calls, zero registry mutation, zero publication.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { AdaptationResult } from "./template-adaptation";
import { PUBLIC_PROFILE_SCHEMA_VERSION } from "./public-profile-dto";
import {
  BuildIsolationConfig,
  BuildIsolationRuntimeAdapter,
  getBuildIsolationStatus,
} from "./template-build-isolation";

/* =========================================================================
   Types and Interfaces
   ========================================================================= */

export type BuildStatus = "BUILT" | "COLLISION" | "VALIDATION_FAILED" | "BUILD_FAILED";

export interface ArtifactFileEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface ArtifactManifest {
  templateId: string;
  templateVersion: string;
  sourceCommitSha: string;
  supportedDtoVersions: string[];
  entrypoint: string;
  totalFiles: number;
  totalBytes: number;
  builtAt: string;
  manifestSha256?: string;
  files: ArtifactFileEntry[];
}

export interface BuildInput {
  templateId: string;
  templateVersion: string;
  sourceCommitSha: string;
  adaptationResult: AdaptationResult;
  approvedReviewRecord: {
    status: string;
    auditReport?: { outcome: string };
    reviewDecision?: { decision: string; reason?: string };
  };
  targetDtoVersion?: string;
  explicitConfirmation: boolean;
  stagedArtifactsDir?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BuildResult {
  success: boolean;
  status: BuildStatus;
  templateId: string;
  templateVersion: string;
  artifactDir?: string;
  manifest?: ArtifactManifest;
  manifestSha256?: string;
  cleanup?: () => Promise<void>;
  error?: string;
}

export interface BuildExecutor {
  executeBuild(options: {
    sourceDir: string;
    outputDir: string;
    buildScript?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<{ success: boolean; outputDir?: string; error?: string }>;
}

const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SEMVER_REGEX = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

const FORBIDDEN_FILE_PATTERNS = [
  /^\.env(\..*)?$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.git(\/|$)/,
  /\.DS_Store$/,
  /Thumbs\.db$/,
];

function isForbiddenArtifactFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function computeFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/* =========================================================================
   Mock and Isolated Build Executors
   ========================================================================= */

/**
 * Mock build executor for offline unit testing and development.
 */
export class MockBuildExecutor implements BuildExecutor {
  private shouldFail: boolean;
  private mockFiles: Record<string, string>;

  constructor(options: { shouldFail?: boolean; mockFiles?: Record<string, string> } = {}) {
    this.shouldFail = Boolean(options.shouldFail);
    this.mockFiles = options.mockFiles || {
      "index.html": "<!DOCTYPE html><html><head><script id='__ONEVUE_DTO__'></script></head><body>OneVue</body></html>",
      "assets/index.js": "console.log('OneVue Artifact');",
      "assets/index.css": "body { margin: 0; }",
    };
  }

  async executeBuild(options: {
    sourceDir: string;
    outputDir: string;
    buildScript?: string;
    timeoutMs?: number;
  }): Promise<{ success: boolean; outputDir?: string; error?: string }> {
    if (this.shouldFail) {
      return { success: false, error: "Mock build execution failed." };
    }

    fs.mkdirSync(options.outputDir, { recursive: true });
    for (const [relPath, content] of Object.entries(this.mockFiles)) {
      const fullPath = path.join(options.outputDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }

    return { success: true, outputDir: options.outputDir };
  }
}

export interface IsolatedSandboxBuildExecutorOptions {
  env?: Record<string, string | undefined>;
  runtimeAdapter?: BuildIsolationRuntimeAdapter;
}

/**
 * Isolated build executor boundary for Phase 5.4 / 5.11.3.
 *
 * Fails closed unless ENABLE_ISOLATED_BUILD_EXECUTION="true" AND the complete
 * isolation configuration is valid AND a verified runtime adapter is injected.
 * There is no host-execution fallback. A child process, shell command, or
 * application process is not treated as an isolation boundary.
 */
export class IsolatedSandboxBuildExecutor implements BuildExecutor {
  private env: Record<string, string | undefined>;
  private runtimeAdapter?: BuildIsolationRuntimeAdapter;

  constructor(options: IsolatedSandboxBuildExecutorOptions = {}) {
    this.env = options.env || process.env;
    this.runtimeAdapter = options.runtimeAdapter;
  }

  async executeBuild(options: {
    sourceDir: string;
    outputDir: string;
    buildScript?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {} as any): Promise<{ success: boolean; outputDir?: string; error?: string }> {
    const status = getBuildIsolationStatus(this.env, {
      runtimeAdapterIntegrated: Boolean(this.runtimeAdapter),
    });

    if (!status.enabled) {
      return { success: false, error: status.reason };
    }

    if (!status.configured || !status.config) {
      const details = status.errors.length ? ` ${status.errors.join(" ")}` : "";
      return {
        success: false,
        error: `${status.reason}${details} Host execution is strictly prohibited.`,
      };
    }

    if (!this.runtimeAdapter) {
      return {
        success: false,
        error: `${status.reason} Host execution is strictly prohibited.`,
      };
    }

    try {
      const result = await this.runtimeAdapter.executeBuild({
        sourceDir: options.sourceDir,
        outputDir: options.outputDir,
        buildScript: options.buildScript,
        timeoutMs: options.timeoutMs || status.config.timeoutMs,
        signal: options.signal,
        config: status.config as BuildIsolationConfig,
      });
      if (!result.success) {
        return {
          success: false,
          error: `Isolated build runtime failed: ${result.error || "unknown runtime error"}.`,
        };
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: `Isolated build runtime error: ${error instanceof Error ? error.message : String(error)}.`,
      };
    }
  }
}

/* =========================================================================
   Artifact Verification & Packaging
   ========================================================================= */

export interface PackagingOptions {
  maxFiles?: number;
  maxFileSizeBytes?: number;
  maxTotalSizeBytes?: number;
}

/**
 * Verifies built artifact output, computes individual and manifest SHA-256 hashes,
 * and packages into the versioned immutable layout templates/<id>/<version>/.
 */
export function verifyAndPackageArtifact(
  outputDir: string,
  metadata: {
    templateId: string;
    templateVersion: string;
    sourceCommitSha: string;
    supportedDtoVersions: string[];
  },
  options: PackagingOptions = {}
): { valid: boolean; manifest?: ArtifactManifest; manifestSha256?: string; error?: string } {
  const maxFiles = options.maxFiles || 500;
  const maxFileSizeBytes = options.maxFileSizeBytes || 10 * 1024 * 1024; // 10 MB
  const maxTotalSizeBytes = options.maxTotalSizeBytes || 50 * 1024 * 1024; // 50 MB

  if (!fs.existsSync(outputDir)) {
    return { valid: false, error: `Build output directory does not exist: '${outputDir}'.` };
  }

  const canonicalOutput = path.resolve(outputDir);
  const indexPath = path.join(canonicalOutput, "index.html");

  // Require index.html entrypoint
  if (!fs.existsSync(indexPath)) {
    return { valid: false, error: "Artifact verification failed: Missing required entrypoint 'index.html'." };
  }

  const files: ArtifactFileEntry[] = [];
  let totalBytes = 0;

  const scanArtifactDir = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(canonicalOutput, fullPath).replace(/\\/g, "/");

      // Symlink and special-file barrier. FIFOs, sockets, and device nodes
      // must never be copied or opened by the packaging pipeline.
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) {
        throw new Error(`Security violation: Artifact contains forbidden symbolic link: '${relativePath}'.`);
      }

      if (lstat.isDirectory()) {
        scanArtifactDir(fullPath);
      } else if (lstat.isFile()) {
        // Reject forbidden secret or system files
        if (isForbiddenArtifactFile(relativePath)) {
          throw new Error(`Security violation: Prohibited file found in build output: '${relativePath}'.`);
        }

        const stat = fs.statSync(fullPath);
        if (stat.size > maxFileSizeBytes) {
          throw new Error(`Artifact file '${relativePath}' (${stat.size} bytes) exceeds maximum file limit of ${maxFileSizeBytes} bytes.`);
        }

        totalBytes += stat.size;
        if (totalBytes > maxTotalSizeBytes) {
          throw new Error(`Total artifact size (${totalBytes} bytes) exceeds maximum allowable limit of ${maxTotalSizeBytes} bytes.`);
        }

        const sha256 = computeFileSha256(fullPath);
        files.push({
          relativePath,
          sizeBytes: stat.size,
          sha256,
        });

        if (files.length > maxFiles) {
          throw new Error(`Artifact exceeds maximum file count limit of ${maxFiles}.`);
        }
      } else {
        // FIFOs, sockets, block/character devices are neither files nor
        // directories. Never open or copy them: reading a FIFO can block
        // forever and devices can leak host state.
        throw new Error(
          `Security violation: Artifact contains forbidden special file (not a regular file or directory): '${relativePath}'.`
        );
      }
    }
  };

  try {
    scanArtifactDir(canonicalOutput);
  } catch (err: any) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Sort files deterministically by relativePath
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const manifestData: ArtifactManifest = {
    templateId: metadata.templateId,
    templateVersion: metadata.templateVersion,
    sourceCommitSha: metadata.sourceCommitSha,
    supportedDtoVersions: metadata.supportedDtoVersions,
    entrypoint: "index.html",
    totalFiles: files.length,
    totalBytes,
    builtAt: new Date().toISOString(),
    files,
  };

  const manifestJson = JSON.stringify(manifestData, Object.keys(manifestData).sort());
  const manifestSha256 = crypto.createHash("sha256").update(manifestJson).digest("hex");
  manifestData.manifestSha256 = manifestSha256;

  // Write manifest into artifact directory
  fs.writeFileSync(path.join(canonicalOutput, "onevue-manifest.json"), JSON.stringify(manifestData, null, 2), "utf8");

  return {
    valid: true,
    manifest: manifestData,
    manifestSha256,
  };
}

/* =========================================================================
   Main Build Worker Pipeline
   ========================================================================= */

/**
 * Builds and packages an approved, adapted template into an immutable versioned artifact.
 * Guarantees:
 * - Checks approval provenance and rejects invalid/unapproved inputs.
 * - Enforces immutable version directory conventions (templates/<id>/<version>/).
 * - Fails closed on version collisions (never silently replaces existing version).
 * - Leaves public registries and production systems unmutated.
 */
export async function buildAndPackageTemplate(
  input: BuildInput,
  executor?: BuildExecutor
): Promise<BuildResult> {
  const {
    templateId,
    templateVersion,
    sourceCommitSha,
    adaptationResult,
    approvedReviewRecord,
    targetDtoVersion = PUBLIC_PROFILE_SCHEMA_VERSION,
    explicitConfirmation,
    stagedArtifactsDir,
  } = input;

  // 1. Explicit Confirmation & Semver Check
  if (explicitConfirmation !== true) {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId,
      templateVersion,
      error: "Build rejected: Explicit confirmation flag (explicitConfirmation: true) is required.",
    };
  }

  if (!templateId || !TEMPLATE_ID_REGEX.test(templateId.trim())) {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId: templateId || "",
      templateVersion,
      error: `Build rejected: Invalid templateId format ('${templateId}').`,
    };
  }

  if (!templateVersion || !SEMVER_REGEX.test(templateVersion.trim())) {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId,
      templateVersion: templateVersion || "",
      error: `Build rejected: Invalid templateVersion semver format ('${templateVersion}').`,
    };
  }

  if (targetDtoVersion !== PUBLIC_PROFILE_SCHEMA_VERSION) {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId,
      templateVersion,
      error: `Build rejected: Target DTO version '${targetDtoVersion}' is unsupported. Only '${PUBLIC_PROFILE_SCHEMA_VERSION}' is supported.`,
    };
  }

  // 2. Ingestion & Approval Record Verification
  if (!approvedReviewRecord || approvedReviewRecord.status !== "approved") {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId,
      templateVersion,
      error: `Build rejected: Ingestion review status is '${approvedReviewRecord?.status || "missing"}'. Only 'approved' templates can be built.`,
    };
  }

  const auditOutcome = approvedReviewRecord.auditReport?.outcome;
  if (auditOutcome === "REJECT") {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId,
      templateVersion,
      error: "Build rejected: Template audit outcome is 'REJECT' due to critical policy violations.",
    };
  }

  if (auditOutcome === "REVIEW_REQUIRED") {
    const reason = approvedReviewRecord.reviewDecision?.reason;
    if (!reason || !reason.trim()) {
      return {
        success: false,
        status: "VALIDATION_FAILED",
        templateId,
        templateVersion,
        error: "Build rejected: Audit outcome is 'REVIEW_REQUIRED' and no justification reason was recorded upon approval.",
      };
    }
  }

  // 3. Adaptation Result & Readiness Verification
  if (!adaptationResult || (adaptationResult.status !== "COMPATIBLE" && adaptationResult.status !== "ADAPTED")) {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId,
      templateVersion,
      error: `Build rejected: Adaptation status '${adaptationResult?.status}' is not ready for build.`,
    };
  }

  if (!adaptationResult.buildReadiness?.readyToBuild) {
    return {
      success: false,
      status: "VALIDATION_FAILED",
      templateId,
      templateVersion,
      error: "Build rejected: Template adaptation reported buildReadiness.readyToBuild as false.",
    };
  }

  // 4. Staging Storage & Immutable Collision Verification
  const baseStorageDir = stagedArtifactsDir || path.join(os.tmpdir(), "onevue-staged-artifacts");
  const immutableVersionDir = path.resolve(baseStorageDir, "templates", templateId, templateVersion);

  if (fs.existsSync(immutableVersionDir)) {
    // Version already exists! Check manifest checksum to distinguish identical rebuild vs collision
    const existingManifestPath = path.join(immutableVersionDir, "onevue-manifest.json");
    if (fs.existsSync(existingManifestPath)) {
      try {
        const existingManifest = JSON.parse(fs.readFileSync(existingManifestPath, "utf8"));
        return {
          success: false,
          status: "COLLISION",
          templateId,
          templateVersion,
          manifestSha256: existingManifest.manifestSha256,
          error: `Immutable version collision: Artifact '${templateId}@${templateVersion}' already exists. Overwrite is strictly prohibited.`,
        };
      } catch {}
    }
    return {
      success: false,
      status: "COLLISION",
      templateId,
      templateVersion,
      error: `Immutable version collision: Artifact directory '${immutableVersionDir}' already exists. Overwrite is strictly prohibited.`,
    };
  }

  // 5. Ephemeral Build Working Directory
  const buildOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-build-out-"));

  const cleanup = async () => {
    try {
      if (fs.existsSync(buildOutputDir)) {
        fs.rmSync(buildOutputDir, { recursive: true, force: true });
      }
    } catch {}
  };

  // 6. Execute Build via Runner Boundary
  const buildRunner = executor || new IsolatedSandboxBuildExecutor();
  let publishStagingDir: string | undefined;

  try {
    const buildExecResult = await buildRunner.executeBuild({
      sourceDir: adaptationResult.adaptedDir || adaptationResult.sourceDir,
      outputDir: buildOutputDir,
      buildScript: adaptationResult.buildReadiness.buildScript,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    });

    if (!buildExecResult.success) {
      await cleanup();
      return {
        success: false,
        status: "BUILD_FAILED",
        templateId,
        templateVersion,
        error: `Build execution failed: ${buildExecResult.error}`,
      };
    }

    // 7. Verify & Package Artifact
    const packageResult = verifyAndPackageArtifact(buildOutputDir, {
      templateId,
      templateVersion,
      sourceCommitSha,
      supportedDtoVersions: [targetDtoVersion],
    });

    if (!packageResult.valid || !packageResult.manifest) {
      await cleanup();
      return {
        success: false,
        status: "BUILD_FAILED",
        templateId,
        templateVersion,
        error: `Artifact packaging failed: ${packageResult.error}`,
      };
    }

    // 8. Atomically Publish Artifact to the Immutable Version Directory
    //    Copy into a sibling staging directory first so a failed or interrupted
    //    publish never leaves a partial version that would be mistaken for a
    //    completed artifact (and would cause every retry to report COLLISION).
    fs.mkdirSync(path.dirname(immutableVersionDir), { recursive: true });
    publishStagingDir = fs.mkdtempSync(path.join(path.dirname(immutableVersionDir), ".publish-"));
    const stagingDir = publishStagingDir;
    fs.cpSync(buildOutputDir, stagingDir, { recursive: true });

    try {
      fs.renameSync(stagingDir, immutableVersionDir);
      publishStagingDir = undefined;
    } catch (publishError) {
      if (fs.existsSync(immutableVersionDir)) {
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
        publishStagingDir = undefined;
        await cleanup();
        return {
          success: false,
          status: "COLLISION",
          templateId,
          templateVersion,
          error: `Immutable version collision: Artifact '${templateId}@${templateVersion}' was created concurrently. Overwrite is strictly prohibited.`,
        };
      }
      throw publishError;
    }

    await cleanup();

    return {
      success: true,
      status: "BUILT",
      templateId,
      templateVersion,
      artifactDir: immutableVersionDir,
      manifest: packageResult.manifest,
      manifestSha256: packageResult.manifestSha256,
    };
  } catch (err: any) {
    if (publishStagingDir) {
      try { fs.rmSync(publishStagingDir, { recursive: true, force: true }); } catch {}
    }
    await cleanup();
    return {
      success: false,
      status: "BUILD_FAILED",
      templateId,
      templateVersion,
      error: `Unexpected build error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
