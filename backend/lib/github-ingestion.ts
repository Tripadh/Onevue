/**
 * =========================================================================
 * OneVue Phase 4.3 — GitHub Source Ingestion and Commit Pinning Foundation
 * =========================================================================
 *
 * Core architectural guarantees:
 * 1. Scope A: Strict HTTPS GitHub URL validation and immutable commit SHA pinning.
 * 2. Scope B: Safe source archive retrieval via fixed, derived GitHub endpoints with
 *    strict size limits, timeouts, and comprehensive path-traversal / link barriers.
 * 3. Scope C: Static manifest and metadata inspection without executing untrusted code.
 * 4. Scope D: Zero automated code execution, zero private repo creation, zero catalog mutation.
 *    Isolated temporary directory with explicit cleanup.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as zlib from "node:zlib";
import { Readable } from "node:stream";

/* =========================================================================
   Types and Interfaces
   ========================================================================= */

export interface GitHubRepoReference {
  owner: string;
  repo: string;
  canonicalUrl: string;
}

export interface UrlValidationResult {
  valid: boolean;
  error?: string;
  repoRef?: GitHubRepoReference;
}

export interface ShaValidationResult {
  valid: boolean;
  error?: string;
  sha?: string;
}

export interface CommitResolutionOptions {
  owner: string;
  repo: string;
  ref?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Server-side read credential. Resolved from the environment when omitted;
   * when `null`, the request is explicitly anonymous. Never logged or stored.
   */
  authToken?: string | null;
}

export interface CommitResolutionResult {
  success: boolean;
  sha?: string;
  resolvedRef?: string;
  error?: string;
  status?: number;
}

export interface ArchiveDownloadOptions {
  owner: string;
  repo: string;
  sha: string;
  maxSizeBytes?: number;
  /** Total wall-clock budget for the whole download, across every attempt. */
  timeoutMs?: number;
  /** Per-attempt wall-clock cap. Derived from `timeoutMs` when omitted. */
  attemptTimeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  authToken?: string | null;
}

export interface ArchiveDownloadResult {
  success: boolean;
  buffer?: Buffer;
  error?: string;
  status?: number;
}

export interface ArchiveInspectionOptions {
  maxExtractedSizeBytes?: number;
  maxFileCount?: number;
  destinationDir?: string;
}

export interface ArchiveInspectionResult {
  success: boolean;
  extractedDir?: string;
  fileCount?: number;
  totalBytes?: number;
  error?: string;
  cleanup?: () => Promise<void>;
}

export interface OneVueManifestMetadata {
  templateId?: string;
  version?: string;
  supportedDtoVersions?: string[];
  artifact?: {
    format?: string;
    entrypoint?: string;
  };
}

export interface SourceMetadataResult {
  success: boolean;
  manifestExists: boolean;
  manifestValid: boolean;
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  detectedFramework: string;
  packageJson?: Record<string, unknown>;
  onevueMetadata?: OneVueManifestMetadata;
  error?: string;
}

export interface IngestionPipelineOptions {
  url: string;
  pinnedSha?: string;
  requestedRef?: string;
  maxArchiveSizeBytes?: number;
  maxExtractedSizeBytes?: number;
  /**
   * Total archive download budget in milliseconds. When omitted the download
   * falls back to `ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS` and then to the module
   * default; it is never hardcoded to a fixed 30 seconds.
   */
  timeoutMs?: number;
  /** Number of archive download attempts; forwarded explicitly to the downloader. */
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  authToken?: string | null;
}

export interface IngestionPipelineResult {
  success: boolean;
  repoRef?: GitHubRepoReference;
  /** 'credentialed' when a server-side read credential was used; never the token. */
  authMode?: "public" | "credentialed";
  pinnedSha?: string;
  metadata?: SourceMetadataResult;
  extractedDir?: string;
  cleanup?: () => Promise<void>;
  error?: string;
  stageFailed?: "URL_VALIDATION" | "SHA_VALIDATION" | "COMMIT_RESOLUTION" | "DOWNLOAD" | "EXTRACTION" | "METADATA_INSPECTION";
}

/* =========================================================================
   Scope A: URL and Source Reference Validation
   ========================================================================= */

const GITHUB_OWNER_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const GITHUB_REPO_REGEX = /^[a-zA-Z0-9_.-]{1,100}$/;
const COMMIT_SHA_REGEX = /^[a-f0-9]{40}$/i;

/** Environment variables holding a server-side GitHub read credential. */
export const GITHUB_READ_TOKEN_ENV = ["GITHUB_READ_TOKEN", "ONEVUE_GITHUB_READ_TOKEN"] as const;
const MIN_CREDENTIAL_LENGTH = 20;

/**
 * Resolves the server-side GitHub read credential. Only explicitly configured
 * environment variables are consulted; request input can never supply a token.
 * A read-only token (`GITHUB_READ_TOKEN`) is preferred over the provisioning
 * token so ingestion never needs write permissions.
 */
export function resolveGitHubReadToken(
  env: Record<string, string | undefined> = process.env
): { token: string | null; source: "read_token" | "provisioning_token" | "none" } {
  for (const key of GITHUB_READ_TOKEN_ENV) {
    const value = env[key]?.trim();
    if (value && value.length >= MIN_CREDENTIAL_LENGTH) return { token: value, source: "read_token" };
  }
  for (const key of ["GITHUB_PROVISIONING_TOKEN", "ONEVUE_GITHUB_TOKEN"] as const) {
    const value = env[key]?.trim();
    if (value && value.length >= MIN_CREDENTIAL_LENGTH) {
      return { token: value, source: "provisioning_token" };
    }
  }
  return { token: null, source: "none" };
}

/** Removes any occurrence of the credential from error text. */
export function redactGitHubCredential(message: unknown, token: string | null): string {
  const raw = message instanceof Error ? message.message : String(message);
  if (!token || token.length < 5) return raw;
  return raw.split(token).join("[REDACTED_GITHUB_CREDENTIAL]");
}

function githubReadHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "OneVue-Template-Ingestion/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Validates a GitHub repository URL strictly according to platform security invariants:
 * - Protocol must be HTTPS.
 * - Host must strictly be github.com.
 * - No credentials, query parameters, fragments, or path traversal.
 * - Path must resolve to /{owner}/{repo}.
 */
export function validateGitHubRepoUrl(rawUrl: string): UrlValidationResult {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return { valid: false, error: "Repository URL is required." };
  }

  const trimmed = rawUrl.trim();

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, error: "Malformed URL format." };
  }

  // 1. Enforce HTTPS
  if (parsed.protocol !== "https:") {
    return { valid: false, error: "Only HTTPS repository URLs are permitted." };
  }

  // 2. Enforce github.com host
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "github.com") {
    return { valid: false, error: `Unsupported repository host '${parsed.hostname}'. Only 'github.com' is allowed.` };
  }

  // 3. Reject credentials
  if (parsed.username || parsed.password) {
    return { valid: false, error: "Embedded credentials in repository URLs are strictly prohibited." };
  }

  // 4. Reject query parameters and fragments
  if (parsed.search) {
    return { valid: false, error: "Repository URLs must not contain query parameters." };
  }
  if (parsed.hash) {
    return { valid: false, error: "Repository URLs must not contain fragments/hashes." };
  }

  // 5. Inspect path segments
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    return {
      valid: false,
      error: `Invalid repository path structure '${parsed.pathname}'. Expected format: /owner/repository`,
    };
  }

  const [rawOwner, rawRepo] = segments;

  // Clean trailing .git if present
  let cleanRepo = rawRepo;
  if (cleanRepo.toLowerCase().endsWith(".git")) {
    cleanRepo = cleanRepo.slice(0, -4);
  }

  // Validate owner and repo identifiers
  if (!GITHUB_OWNER_REGEX.test(rawOwner)) {
    return { valid: false, error: `Invalid GitHub owner identifier: '${rawOwner}'.` };
  }
  if (!GITHUB_REPO_REGEX.test(cleanRepo)) {
    return { valid: false, error: `Invalid GitHub repository identifier: '${cleanRepo}'.` };
  }

  const canonicalUrl = `https://github.com/${rawOwner}/${cleanRepo}`;

  return {
    valid: true,
    repoRef: {
      owner: rawOwner,
      repo: cleanRepo,
      canonicalUrl,
    },
  };
}

/**
 * Validates a 40-character hexadecimal commit SHA format.
 */
export function validateCommitSha(rawSha: string): ShaValidationResult {
  if (typeof rawSha !== "string" || !rawSha.trim()) {
    return { valid: false, error: "Commit SHA is required." };
  }

  const cleanSha = rawSha.trim().toLowerCase();
  if (!COMMIT_SHA_REGEX.test(cleanSha)) {
    return {
      valid: false,
      error: "Invalid commit SHA format. Expected exactly 40 lowercase hexadecimal characters.",
    };
  }

  return { valid: true, sha: cleanSha };
}

/**
 * Resolves a moving Git reference (branch or HEAD) to an immutable commit SHA via GitHub API.
 * Never treats a moving branch name as the final source identity.
 */
export async function resolveGitHubCommitSha(options: CommitResolutionOptions): Promise<CommitResolutionResult> {
  const { owner, repo, ref, timeoutMs = 15000, fetchImpl = globalThis.fetch } = options;
  const token = options.authToken === undefined ? resolveGitHubReadToken().token : options.authToken;

  const targetRef = ref ? encodeURIComponent(ref.trim()) : "HEAD";
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${targetRef}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(apiUrl, {
      method: "GET",
      headers: githubReadHeaders(token),
      signal: controller.signal,
    });

    if (response.status === 401) {
      return {
        success: false,
        status: 401,
        error: "GitHub authentication failed: the configured read credential is invalid or expired.",
      };
    }
    if (response.status === 404) {
      return {
        success: false,
        status: 404,
        error: token
          ? `Repository or reference '${owner}/${repo}@${ref || "HEAD"}' was not found, or the configured credential cannot access it.`
          : `Repository or reference '${owner}/${repo}@${ref || "HEAD"}' was not found. Private repositories require a server-side read credential.`,
      };
    }
    if (response.status === 403 || response.status === 429) {
      return {
        success: false,
        status: response.status,
        error: "GitHub API rate limit exceeded, access forbidden, or insufficient credential permissions.",
      };
    }
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        error: `GitHub API error: status ${response.status}.`,
      };
    }

    const data: any = await response.json();
    const sha = data?.sha;

    if (!sha || typeof sha !== "string") {
      return {
        success: false,
        error: "Malformed GitHub API response: missing commit SHA.",
      };
    }

    const shaValidation = validateCommitSha(sha);
    if (!shaValidation.valid) {
      return {
        success: false,
        error: `Resolved SHA from GitHub is invalid: ${shaValidation.error}`,
      };
    }

    return {
      success: true,
      sha: shaValidation.sha,
      resolvedRef: ref || "HEAD",
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return {
        success: false,
        error: `Commit resolution timed out after ${timeoutMs}ms.`,
      };
    }
    return {
      success: false,
      error: `Network error during commit resolution: ${redactGitHubCredential(err, token)}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/* =========================================================================
   Scope B: Safe Source Archive Retrieval & Extraction
   ========================================================================= */

const DEFAULT_MAX_ARCHIVE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB archive limit
const DEFAULT_MAX_EXTRACTED_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB extracted limit
const DEFAULT_MAX_FILE_COUNT = 2500;
const DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS = 120000;
const DEFAULT_ARCHIVE_DOWNLOAD_ATTEMPTS = 3;
const RETRYABLE_ARCHIVE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);
const TRUSTED_ARCHIVE_HOSTS = new Set(["api.github.com", "codeload.github.com"]);

function archiveRetryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.min(200 * 2 ** (attempt - 1), 1000)));
}

/**
 * Downloads a source tarball for a validated repository and pinned SHA.
 * Guarantees:
 * - Derived exclusively from trusted GitHub API endpoint: https://api.github.com/repos/{owner}/{repo}/tarball/{sha}
 * - Enforces streaming size limits and strict HTTP status handling.
 *
 * Retry semantics: `timeoutMs` is the TOTAL wall-clock budget for the whole
 * download, not a per-attempt value. Every attempt is additionally capped by
 * its own slice of that budget (`attemptTimeoutMs`, or `timeoutMs / attempts`
 * by default), so a retry always has real wall-clock left to work with
 * instead of inheriting an already-expired deadline. The total budget is
 * always authoritative and can never be exceeded.
 */
export async function downloadSourceArchive(options: ArchiveDownloadOptions): Promise<ArchiveDownloadResult> {
  const {
    owner,
    repo,
    sha,
    maxSizeBytes = DEFAULT_MAX_ARCHIVE_SIZE_BYTES,
    timeoutMs = Number.parseInt(process.env.ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS || "", 10) || DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS,
    maxAttempts = DEFAULT_ARCHIVE_DOWNLOAD_ATTEMPTS,
    fetchImpl = globalThis.fetch,
  } = options;
  const shaValidation = validateCommitSha(sha);
  if (!shaValidation.valid || !shaValidation.sha) {
    return { success: false, error: shaValidation.error || "Invalid commit SHA." };
  }
  const token = options.authToken === undefined ? resolveGitHubReadToken().token : options.authToken;

  const trustedEndpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(shaValidation.sha)}`;

  const attempts = Math.max(1, Math.min(4, Math.floor(maxAttempts)));
  const totalBudgetMs = Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : DEFAULT_ARCHIVE_DOWNLOAD_TIMEOUT_MS;
  const deadline = Date.now() + totalBudgetMs;
  // Per-attempt slice of the total budget: bounded, so one slow attempt can
  // never silently consume the whole budget and starve the retries.
  const derivedAttemptMs = Math.max(1, Math.floor(totalBudgetMs / attempts));
  const configuredAttemptMs = Number.isFinite(options.attemptTimeoutMs)
    ? Math.max(1, Math.floor(options.attemptTimeoutMs as number))
    : undefined;
  const attemptBudgetMs = Math.min(
    configuredAttemptMs ?? derivedAttemptMs,
    Math.max(1, totalBudgetMs)
  );
  const timeoutSummary = `timed out after ${totalBudgetMs}ms (${attempts} attempt(s), ${attemptBudgetMs}ms per attempt)`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { success: false, error: `Archive download ${timeoutSummary}.` };
    }
    // An attempt never runs past the total deadline, and never past its own slice.
    const attemptDeadline = Date.now() + Math.min(attemptBudgetMs, remainingMs);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min(attemptBudgetMs, remainingMs));
    let response: Response | undefined;
    let bodyConsumed = false;
    let bodyReader: Readable | undefined;
    const cancelBody = async () => {
      if (bodyConsumed) return;
      if (bodyReader) {
        try { bodyReader.destroy(); } catch { /* Preserve the original result or error. */ }
      } else if (response?.body) {
        try { await response.body.cancel(); } catch { /* Preserve the original result or error. */ }
      }
    };
    try {
      response = await fetchImpl(trustedEndpoint, {
        method: "GET",
        headers: githubReadHeaders(token),
        signal: controller.signal,
        redirect: "follow",
      });

      if (controller.signal.aborted || Date.now() >= attemptDeadline) {
        await cancelBody();
        return { success: false, error: `Archive download ${timeoutSummary}.` };
      }

      const finalUrlText = (response as Response & { url?: string }).url;
      let finalUrl: URL;
      try {
        if (typeof finalUrlText !== "string" || !finalUrlText) throw new Error("missing final URL");
        finalUrl = new URL(finalUrlText);
      } catch {
        await cancelBody();
        return { success: false, error: "GitHub archive response did not provide a valid final URL." };
      }
      if (
        finalUrl.protocol !== "https:" ||
        !TRUSTED_ARCHIVE_HOSTS.has(finalUrl.hostname.toLowerCase()) ||
        finalUrl.port !== "" ||
        finalUrl.username !== "" ||
        finalUrl.password !== ""
      ) {
        await cancelBody();
        return { success: false, error: "GitHub archive redirect resolved to an untrusted URL." };
      }
      if (finalUrl.hostname.toLowerCase() === "api.github.com") {
        const expectedPath = new URL(trustedEndpoint).pathname;
        if (finalUrl.pathname !== expectedPath) {
          await cancelBody();
          return { success: false, error: "GitHub archive API response URL does not match the pinned archive endpoint." };
        }
      }

    if (response.status === 401) {
      await cancelBody();
      return {
        success: false,
        status: 401,
        error: "GitHub authentication failed while downloading the source archive.",
      };
    }
    if (response.status === 404) {
      await cancelBody();
      return {
        success: false,
        status: 404,
        error: token
          ? "Source archive not found, or the configured credential cannot access it."
          : "Source archive not found. Private repositories require a server-side read credential.",
      };
    }
    if (response.status === 403 || response.status === 429) {
      await cancelBody();
      return {
        success: false,
        status: response.status,
        error: "GitHub rate limit exceeded, access forbidden, or insufficient credential permissions.",
      };
    }
    if (!response.ok) {
      if (RETRYABLE_ARCHIVE_STATUSES.has(response.status) && attempt < attempts) {
        await cancelBody();
        const delayMs = Math.min(200 * 2 ** (attempt - 1), 1000);
        if (Date.now() + delayMs + 1 >= deadline) {
          return { success: false, status: response.status, error: `Archive download ${timeoutSummary}.` };
        }
        await archiveRetryDelay(attempt);
        if (Date.now() >= deadline) return { success: false, status: response.status, error: `Archive download ${timeoutSummary}.` };
        continue;
      }
      await cancelBody();
      return { success: false, status: response.status, error: `GitHub archive request failed with status ${response.status}.` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.toLowerCase().includes("text/html")) {
      await cancelBody();
      return { success: false, error: "Unexpected HTML response from GitHub archive endpoint." };
    }

    // Size limit check on Content-Length header if reported
    const contentLength = response.headers.get("content-length");
    if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxSizeBytes)) {
      await cancelBody();
      return {
        success: false,
        error: `Archive size (${contentLength} bytes) exceeds permitted maximum limit of ${maxSizeBytes} bytes or is invalid.`,
      };
    }

    if (!response.body) return { success: false, error: "GitHub archive response did not include a readable body." };
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    bodyReader = Readable.fromWeb(response.body as any);
    for await (const chunk of bodyReader) {
      if (controller.signal.aborted || Date.now() >= attemptDeadline) throw Object.assign(new Error("Archive download timed out."), { name: "AbortError" });
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += part.length;
      if (totalBytes > maxSizeBytes) {
        bodyConsumed = true;
        await cancelBody();
        return { success: false, error: `Downloaded archive exceeds permitted maximum limit of ${maxSizeBytes} bytes.` };
      }
      chunks.push(part);
    }
    bodyConsumed = true;
    if (controller.signal.aborted || Date.now() >= attemptDeadline) throw Object.assign(new Error("Archive download timed out."), { name: "AbortError" });
    return { success: true, buffer: Buffer.concat(chunks, totalBytes) };
  } catch (err: any) {
    await cancelBody();
    if (err?.name === "AbortError") {
      const delayMs = Math.min(200 * 2 ** (attempt - 1), 1000);
      if (attempt < attempts && Date.now() + delayMs + 1 < deadline) {
        await archiveRetryDelay(attempt);
        if (Date.now() >= deadline) return { success: false, error: `Archive download ${timeoutSummary}.` };
        continue;
      }
      return { success: false, error: `Archive download ${timeoutSummary}.` };
    }
    if (attempt < attempts && (err?.name === "TypeError" || err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT")) {
      const delayMs = Math.min(200 * 2 ** (attempt - 1), 1000);
      if (Date.now() + delayMs + 1 >= deadline) {
        return { success: false, error: `Archive download ${timeoutSummary}.` };
      }
      await archiveRetryDelay(attempt);
      if (Date.now() >= deadline) return { success: false, error: `Archive download ${timeoutSummary}.` };
      continue;
    }
    return {
      success: false,
      error: `Network error during archive download: ${redactGitHubCredential(err, token)}`,
    };
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return { success: false, error: "GitHub archive download failed." };
}

/**
 * Safely parses and unpacks a gzipped tar archive without external dependencies.
 *
 * Security controls:
 * - Gunzips buffer into raw tar stream.
 * - Parses POSIX ustar 512-byte header blocks.
 * - Rejects any entry containing '..' (path traversal).
 * - Rejects absolute paths (starting with '/' or Windows drive letters).
 * - Rejects hard links ('1') and symbolic links ('2').
 * - Enforces cumulative uncompressed size limits and maximum file count (zip-bomb barrier).
 * - Strips GitHub's top-level directory wrapper (e.g. 'owner-repo-sha/').
 * - Extracts only into an isolated, dedicated temporary directory.
 */
export async function inspectSourceArchive(
  archiveBuffer: Buffer,
  options: ArchiveInspectionOptions = {}
): Promise<ArchiveInspectionResult> {
  const {
    maxExtractedSizeBytes = DEFAULT_MAX_EXTRACTED_SIZE_BYTES,
    maxFileCount = DEFAULT_MAX_FILE_COUNT,
    destinationDir,
  } = options;

  // 1. Decompress gzip stream
  let tarBuffer: Buffer;
  try {
    tarBuffer = zlib.gunzipSync(archiveBuffer);
  } catch (err) {
    return {
      success: false,
      error: `Decompression failed: archive is not a valid gzip tarball (${err instanceof Error ? err.message : String(err)}).`,
    };
  }

  // 2. Prepare isolated destination directory
  const targetDir = destinationDir || fs.mkdtempSync(path.join(os.tmpdir(), "onevue-ingest-"));
  const canonicalTargetDir = path.resolve(targetDir);

  const cleanup = async () => {
    try {
      if (fs.existsSync(canonicalTargetDir)) {
        fs.rmSync(canonicalTargetDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  };

  let offset = 0;
  let fileCount = 0;
  let totalBytes = 0;

  try {
    while (offset + 512 <= tarBuffer.length) {
      const header = tarBuffer.subarray(offset, offset + 512);

      // End of archive is marked by two consecutive 512-byte zero blocks
      if (header.every((b) => b === 0)) {
        break;
      }

      // Read filename (null-terminated string, 100 bytes)
      let name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "").trim();

      // Read prefix (for ustar format, 155 bytes at offset 345)
      const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "").trim();
      if (prefix) {
        name = `${prefix}/${name}`;
      }

      // Read file size (12 bytes octal string at offset 124)
      const sizeStr = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
      const fileSize = parseInt(sizeStr, 8) || 0;

      // Read type flag at offset 156
      const typeFlag = String.fromCharCode(header[156] || 0);

      offset += 512;

      // Reject symlinks ('2') and hardlinks ('1') to avoid arbitrary file writes outside sandbox
      if (typeFlag === "1" || typeFlag === "2") {
        throw new Error(`Security violation: Archive contains forbidden link entry: '${name}'.`);
      }

      // Path traversal security verification
      const normalizedPath = path.normalize(name).replace(/\\/g, "/");

      if (
        normalizedPath.includes("..") ||
        normalizedPath.startsWith("/") ||
        /^[a-zA-Z]:/.test(normalizedPath)
      ) {
        throw new Error(`Security violation: Path traversal detected in archive entry: '${name}'.`);
      }

      // GitHub tarballs prepend a top-level folder: owner-repo-sha/...
      // Strip the top-level segment to extract root files into targetDir
      const pathParts = normalizedPath.split("/").filter(Boolean);
      if (pathParts.length <= 1) {
        // Skip top-level directory root
        offset += Math.ceil(fileSize / 512) * 512;
        continue;
      }

      const relativePath = pathParts.slice(1).join("/");
      const destPath = path.resolve(canonicalTargetDir, relativePath);

      // Barrier check: must strictly reside inside canonicalTargetDir
      if (!destPath.startsWith(canonicalTargetDir + path.sep)) {
        throw new Error(`Security violation: Archive entry resolves outside extraction boundary: '${destPath}'.`);
      }

      if (typeFlag === "5" || name.endsWith("/")) {
        // Directory entry
        fs.mkdirSync(destPath, { recursive: true });
      } else {
        // Regular file entry
        fileCount++;
        if (fileCount > maxFileCount) {
          throw new Error(`Security violation: Archive exceeds maximum allowable file count of ${maxFileCount}.`);
        }

        totalBytes += fileSize;
        if (totalBytes > maxExtractedSizeBytes) {
          throw new Error(`Security violation: Uncompressed archive exceeds maximum size limit of ${maxExtractedSizeBytes} bytes.`);
        }

        fs.mkdirSync(path.dirname(destPath), { recursive: true });

        const fileData = tarBuffer.subarray(offset, offset + fileSize);
        fs.writeFileSync(destPath, fileData);
      }

      // Advance offset to next 512-byte boundary
      offset += Math.ceil(fileSize / 512) * 512;
    }

    return {
      success: true,
      extractedDir: canonicalTargetDir,
      fileCount,
      totalBytes,
      cleanup,
    };
  } catch (err: any) {
    await cleanup();
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* =========================================================================
   Scope C: Minimal Metadata Inspection
   ========================================================================= */

/**
 * Inspects source repository files without executing any code.
 * Reads package.json and onevue metadata block strictly as passive JSON data.
 */
export function inspectSourceMetadata(sourceDir: string): SourceMetadataResult {
  if (!fs.existsSync(sourceDir)) {
    return {
      success: false,
      manifestExists: false,
      manifestValid: false,
      packageManager: "unknown",
      detectedFramework: "unknown",
      error: `Directory does not exist: '${sourceDir}'.`,
    };
  }

  // 1. Detect package manager lockfile
  let packageManager: "npm" | "pnpm" | "yarn" | "unknown" = "unknown";
  if (fs.existsSync(path.join(sourceDir, "pnpm-lock.yaml"))) {
    packageManager = "pnpm";
  } else if (fs.existsSync(path.join(sourceDir, "package-lock.json"))) {
    packageManager = "npm";
  } else if (fs.existsSync(path.join(sourceDir, "yarn.lock"))) {
    packageManager = "yarn";
  }

  // 2. Detect framework indicators
  let detectedFramework = "unknown";
  if (
    fs.existsSync(path.join(sourceDir, "vite.config.ts")) ||
    fs.existsSync(path.join(sourceDir, "vite.config.js")) ||
    fs.existsSync(path.join(sourceDir, "vite.config.mjs"))
  ) {
    detectedFramework = "vite";
  } else if (
    fs.existsSync(path.join(sourceDir, "next.config.ts")) ||
    fs.existsSync(path.join(sourceDir, "next.config.js")) ||
    fs.existsSync(path.join(sourceDir, "next.config.mjs"))
  ) {
    detectedFramework = "nextjs";
  }

  // 3. Inspect package.json
  const pkgPath = path.join(sourceDir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return {
      success: true,
      manifestExists: false,
      manifestValid: false,
      packageManager,
      detectedFramework,
    };
  }

  let packageJson: any;
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    packageJson = JSON.parse(raw);
  } catch (err) {
    return {
      success: false,
      manifestExists: true,
      manifestValid: false,
      packageManager,
      detectedFramework,
      error: `Malformed package.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Detect Create React App indicators if not already identified by config
  if (detectedFramework === "unknown" && packageJson) {
    const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
    if (
      typeof deps["react-scripts"] === "string" ||
      (typeof packageJson.scripts?.build === "string" && /\breact-scripts\b/.test(packageJson.scripts.build)) ||
      (typeof packageJson.scripts?.start === "string" && /\breact-scripts\b/.test(packageJson.scripts.start))
    ) {
      detectedFramework = "create-react-app";
    }
  }

  // 4. Inspect optional OneVue metadata block
  let onevueMetadata: OneVueManifestMetadata | undefined = undefined;
  if (packageJson?.onevue && typeof packageJson.onevue === "object") {
    onevueMetadata = {
      templateId: typeof packageJson.onevue.templateId === "string" ? packageJson.onevue.templateId.trim() : undefined,
      version: typeof packageJson.onevue.version === "string" ? packageJson.onevue.version.trim() : undefined,
      supportedDtoVersions: Array.isArray(packageJson.onevue.supportedDtoVersions)
        ? packageJson.onevue.supportedDtoVersions.map(String)
        : undefined,
      artifact: packageJson.onevue.artifact && typeof packageJson.onevue.artifact === "object"
        ? {
            format: typeof packageJson.onevue.artifact.format === "string" ? packageJson.onevue.artifact.format : undefined,
            entrypoint: typeof packageJson.onevue.artifact.entrypoint === "string" ? packageJson.onevue.artifact.entrypoint : undefined,
          }
        : undefined,
    };
  }

  return {
    success: true,
    manifestExists: true,
    manifestValid: true,
    packageManager,
    detectedFramework,
    packageJson,
    onevueMetadata,
  };
}

/* =========================================================================
   Orchestration Pipeline
   ========================================================================= */

/**
 * End-to-end foundation pipeline for Phase 4.3:
 * 1. Validate GitHub repository URL.
 * 2. Pin source commit SHA (using provided SHA or resolving via GitHub metadata).
 * 3. Safely fetch source archive from fixed trusted endpoint.
 * 4. Unpack into an isolated sandbox temporary directory with traversal barriers.
 * 5. Passively inspect manifests and metadata without code execution.
 *
 * Guarantees:
 * - Does NOT create a private repository.
 * - Does NOT mutate catalog or registry.
 * - Does NOT execute scripts or build commands.
 */
export async function ingestGitHubTemplateSource(
  options: IngestionPipelineOptions
): Promise<IngestionPipelineResult> {
  const {
    url,
    pinnedSha,
    requestedRef,
    maxArchiveSizeBytes = DEFAULT_MAX_ARCHIVE_SIZE_BYTES,
    maxExtractedSizeBytes = DEFAULT_MAX_EXTRACTED_SIZE_BYTES,
    // Left undefined on purpose: the downloader then honours
    // `ONEVUE_GITHUB_ARCHIVE_TIMEOUT_MS` and finally the module default. A
    // hardcoded 30s here silently overrode the operator's configuration and
    // made large archives impossible to fetch.
    timeoutMs,
    maxAttempts = DEFAULT_ARCHIVE_DOWNLOAD_ATTEMPTS,
    fetchImpl = globalThis.fetch,
  } = options;

  // Server-side read credential: explicit override (tests) or environment.
  const token = options.authToken === undefined ? resolveGitHubReadToken().token : options.authToken;
  const authMode: "public" | "credentialed" = token ? "credentialed" : "public";

  // Step 1: URL Validation
  const urlCheck = validateGitHubRepoUrl(url);
  if (!urlCheck.valid || !urlCheck.repoRef) {
    return {
      success: false,
      stageFailed: "URL_VALIDATION",
      error: urlCheck.error,
    };
  }

  const { owner, repo } = urlCheck.repoRef;

  // Step 2: Commit SHA Pinning
  let finalSha: string;
  if (pinnedSha) {
    const shaCheck = validateCommitSha(pinnedSha);
    if (!shaCheck.valid || !shaCheck.sha) {
      return {
        success: false,
        stageFailed: "SHA_VALIDATION",
        error: shaCheck.error,
        repoRef: urlCheck.repoRef,
      };
    }
    finalSha = shaCheck.sha;
  } else {
    const resolveResult = await resolveGitHubCommitSha({
      owner,
      repo,
      ref: requestedRef,
      timeoutMs,
      fetchImpl,
      authToken: token,
    });
    if (!resolveResult.success || !resolveResult.sha) {
      return {
        success: false,
        stageFailed: "COMMIT_RESOLUTION",
        error: resolveResult.error,
        repoRef: urlCheck.repoRef,
        authMode,
      };
    }
    finalSha = resolveResult.sha;
  }

  // Step 3: Download Source Archive
  const downloadResult = await downloadSourceArchive({
    owner,
    repo,
    sha: finalSha,
    maxSizeBytes: maxArchiveSizeBytes,
    timeoutMs,
    maxAttempts,
    fetchImpl,
    authToken: token,
  });

  if (!downloadResult.success || !downloadResult.buffer) {
    return {
      success: false,
      stageFailed: "DOWNLOAD",
      error: downloadResult.error,
      repoRef: urlCheck.repoRef,
      pinnedSha: finalSha,
    };
  }

  // Step 4: Safe Extraction
  const extractionResult = await inspectSourceArchive(downloadResult.buffer, {
    maxExtractedSizeBytes,
  });

  if (!extractionResult.success || !extractionResult.extractedDir) {
    return {
      success: false,
      stageFailed: "EXTRACTION",
      error: extractionResult.error,
      repoRef: urlCheck.repoRef,
      pinnedSha: finalSha,
      authMode,
    };
  }

  // Step 5: Metadata Inspection
  const metadata = inspectSourceMetadata(extractionResult.extractedDir);

  return {
    success: true,
    repoRef: urlCheck.repoRef,
    authMode,
    pinnedSha: finalSha,
    metadata,
    extractedDir: extractionResult.extractedDir,
    cleanup: extractionResult.cleanup,
  };
}
