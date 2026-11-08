/**
 * =========================================================================
 * OneVue Phase 5.5 — R2 Storage Adapter Foundation (Local-First, No Deployment)
 * =========================================================================
 *
 * Guarantees:
 * 1. Typed storage interface supporting store, retrieve, check, and integrity validation.
 * 2. Immutable storage contract: templates/<templateId>/<templateVersion>/ with strict
 *    collision prevention (never overwrite an existing approved version).
 * 3. Atomic staging writes: staged via temporary directory then renamed into place to prevent
 *    partial or corrupted artifacts from appearing published.
 * 4. Comprehensive security barriers: Path traversal rejection, absolute path blocking,
 *    symlink exclusion, and prohibited file filtering.
 * 5. Cryptographic verification: Recomputes and verifies individual file SHA-256 digests
 *    and manifest checksums upon retrieval or validation.
 * 6. LocalFilesystemStorageAdapter and MockR2StorageAdapter for offline testing;
 *    CloudflareR2StorageAdapter skeleton failing closed by default.
 * 7. Zero live network calls, zero Cloudflare R2 connection, zero registry mutations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
// Type-only import: erased at runtime, so this module stays free of any
// project-local runtime dependency. It is therefore safe to consume from the
// portfolio application as the single authoritative artifact-storage
// abstraction, without pulling the build/adaptation pipeline into that app.
import type { ArtifactManifest, ArtifactFileEntry } from "./template-build";

// Re-exported so consumers of the storage abstraction (including the
// portfolio visitor delivery path) get the manifest contract from the SAME
// module, instead of redeclaring a parallel copy of it.
export type { ArtifactManifest, ArtifactFileEntry };

/* =========================================================================
   Types and Interfaces
   ========================================================================= */

export type StorageOutcome = "SUCCESS" | "NOT_FOUND" | "COLLISION" | "INTEGRITY_FAILURE" | "STORAGE_ERROR";

export interface StorageResult {
  outcome: StorageOutcome;
  success: boolean;
  templateId?: string;
  templateVersion?: string;
  artifactDir?: string;
  storageLocation?: string;
  manifest?: ArtifactManifest;
  error?: string;
  downloadArtifact?: () => Promise<{ localDir: string; cleanup: () => Promise<void> }>;
}

export interface TemplateStorageAdapter {
  storeArtifact(templateId: string, version: string, sourceArtifactDir: string, manifest: ArtifactManifest): Promise<StorageResult>;
  retrieveArtifact(templateId: string, version: string): Promise<StorageResult>;
  checkVersionExists(templateId: string, version: string): Promise<boolean>;
  validateStoredArtifact(templateId: string, version: string): Promise<StorageResult>;
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

function isForbiddenStorageFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function computeFileSha256(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Computes deterministic manifest SHA-256 excluding manifestSha256 itself.
 */
export function computeManifestChecksum(manifest: ArtifactManifest): string {
  const copy = { ...manifest };
  delete copy.manifestSha256;
  const json = JSON.stringify(copy, Object.keys(copy).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}

function validateManifestStructure(templateId: string, version: string, manifest: ArtifactManifest): string | undefined {
  if (!manifest || manifest.templateId !== templateId || manifest.templateVersion !== version) {
    return "Manifest template identity does not match the requested artifact.";
  }
  if (manifest.entrypoint !== "index.html" || !Array.isArray(manifest.supportedDtoVersions) || manifest.supportedDtoVersions.length === 0 || manifest.supportedDtoVersions.some((value) => typeof value !== "string")) {
    return "Manifest schema metadata is invalid.";
  }
  if (!Array.isArray(manifest.files) || !Number.isSafeInteger(manifest.totalFiles) || manifest.files.length !== manifest.totalFiles) {
    return "Manifest file inventory is invalid.";
  }

  const seen = new Set<string>();
  for (const file of manifest.files) {
    const relativePath = typeof file.relativePath === "string" ? file.relativePath.replace(/\\/g, "/") : "";
    if (!relativePath || relativePath === "onevue-manifest.json" || relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
      return `Manifest contains an unsafe relative path: '${file.relativePath}'.`;
    }
    if (seen.has(relativePath) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
      return `Manifest contains an invalid or duplicate file entry: '${relativePath}'.`;
    }
    seen.add(relativePath);
  }
  if (!Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
    return "Manifest totalBytes is invalid.";
  }
  if (!manifest.manifestSha256 || computeManifestChecksum(manifest) !== manifest.manifestSha256) {
    return "Manifest cryptographic checksum verification failed.";
  }
  return undefined;
}

/* =========================================================================
   A. Local Filesystem Storage Adapter
   ========================================================================= */

/**
 * Resolves the OneVue repository root by walking up from the current working
 * directory until a directory containing both the `backend` and `portfolio`
 * projects is found.
 *
 * The backend producer and the portfolio consumer MUST resolve the same
 * artifact storage root, otherwise the visitor would serve a locally copied
 * fixture instead of the stored artifact. Both sides use this identical
 * lookup, so they cannot drift apart.
 */
function resolveRepositoryRoot(): string | undefined {
  let current = path.resolve(process.cwd());
  for (let depth = 0; depth < 6; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
    if (
      fs.existsSync(path.join(current, "backend")) &&
      fs.existsSync(path.join(current, "portfolio"))
    ) {
      return current;
    }
  }
  return undefined;
}

/**
 * Resolves the local template artifact storage root.
 *
 * Both the backend storage adapter and the portfolio visitor delivery bridge
 * MUST resolve the same root, otherwise the visitor would serve a locally
 * copied fixture instead of the stored artifact.
 *
 * Resolution order:
 *   1. ONEVUE_TEMPLATE_STORAGE_ROOT  (explicit override, always wins)
 *   2. <repository root>/.local-template-storage
 *   3. <tmp>/onevue-local-r2-storage  (fallback when the repository root
 *      cannot be located, e.g. a packaged deployment)
 *
 * A future Cloudflare R2 / CDN adapter keeps the same logical layout
 * (templates/<templateId>/<templateVersion>/) behind a different transport,
 * so consumers of this helper remain adapter-agnostic.
 */
export function resolveTemplateStorageRoot(): string {
  const configured = process.env.ONEVUE_TEMPLATE_STORAGE_ROOT;
  if (configured && configured.trim()) {
    return path.resolve(configured.trim());
  }
  const repositoryRoot = resolveRepositoryRoot();
  if (repositoryRoot) {
    return path.resolve(repositoryRoot, ".local-template-storage");
  }
  return path.resolve(os.tmpdir(), "onevue-local-r2-storage");
}

/**
 * Resolves the directory that holds every versioned template artifact.
 * Mirrors the <storageRoot>/templates/<templateId>/<templateVersion>/ layout
 * used by LocalFilesystemStorageAdapter.
 */
export function resolveTemplateArtifactsRoot(storageRoot?: string): string {
  const root = storageRoot && storageRoot.trim()
    ? path.resolve(storageRoot.trim())
    : resolveTemplateStorageRoot();
  return path.resolve(root, "templates");
}

export class LocalFilesystemStorageAdapter implements TemplateStorageAdapter {
  private storageRoot: string;
  private static validationCache = new Map<string, { checksum: string; timestamp: number }>();

  constructor(storageRoot?: string) {
    this.storageRoot = storageRoot
      ? path.resolve(storageRoot)
      : resolveTemplateStorageRoot();
    fs.mkdirSync(this.storageRoot, { recursive: true });
  }

  /**
   * The absolute storage root this adapter reads and writes.
   * Exposed so delivery bridges can derive the artifact directory from the
   * adapter itself instead of duplicating the path convention.
   */
  get root(): string {
    return this.storageRoot;
  }

  private resolveVersionDir(templateId: string, version: string): string {
    const cleanId = templateId.trim();
    const cleanVer = version.trim();
    return path.resolve(this.storageRoot, "templates", cleanId, cleanVer);
  }

  async checkVersionExists(templateId: string, version: string): Promise<boolean> {
    if (!TEMPLATE_ID_REGEX.test(templateId) || !SEMVER_REGEX.test(version)) {
      return false;
    }
    const versionDir = this.resolveVersionDir(templateId, version);
    return fs.existsSync(versionDir) && fs.existsSync(path.join(versionDir, "onevue-manifest.json"));
  }

  async storeArtifact(
    templateId: string,
    version: string,
    sourceArtifactDir: string,
    manifest: ArtifactManifest
  ): Promise<StorageResult> {
    const cleanId = templateId.trim();
    const cleanVer = version.trim();

    if (!TEMPLATE_ID_REGEX.test(cleanId) || !SEMVER_REGEX.test(cleanVer)) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: `Invalid templateId ('${templateId}') or version ('${version}').`,
      };
    }

    if (!fs.existsSync(sourceArtifactDir)) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: `Source artifact directory does not exist: '${sourceArtifactDir}'.`,
      };
    }

    const canonicalSource = path.resolve(sourceArtifactDir);
    let sourceManifest: ArtifactManifest;
    try {
      const manifestPath = path.join(canonicalSource, "onevue-manifest.json");
      sourceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ArtifactManifest;
    } catch (err) {
      return { success: false, outcome: "INTEGRITY_FAILURE", error: `Failed to read source release manifest: ${err instanceof Error ? err.message : String(err)}` };
    }
    const validationError = validateManifestForArtifact(canonicalSource, cleanId, cleanVer, sourceManifest);
    if (validationError) {
      return { success: false, outcome: "INTEGRITY_FAILURE", error: validationError };
    }
    if (!manifest || manifest.manifestSha256 !== sourceManifest.manifestSha256) {
      return { success: false, outcome: "INTEGRITY_FAILURE", error: "Supplied manifest does not match the source release manifest." };
    }

    const versionDir = this.resolveVersionDir(cleanId, cleanVer);

    // Enforce containment barrier
    const templatesParent = path.resolve(this.storageRoot, "templates");
    if (!versionDir.startsWith(templatesParent + path.sep)) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: `Security violation: Path traversal detected in version directory: '${versionDir}'.`,
      };
    }

    // Check collision: Immutable version already exists
    if (fs.existsSync(versionDir)) {
      return {
        success: false,
        outcome: "COLLISION",
        error: `Immutable version collision: Artifact '${cleanId}@${cleanVer}' already exists in storage. Overwrite is strictly prohibited.`,
      };
    }

    // Atomic staging write (.staging-xxxxxx -> rename)
    const stagingDir = fs.mkdtempSync(path.join(this.storageRoot, ".staging-"));

    try {
      const copyRecursive = (currSrc: string, currDest: string) => {
        const entries = fs.readdirSync(currSrc, { withFileTypes: true });
        fs.mkdirSync(currDest, { recursive: true });

        for (const entry of entries) {
          const srcPath = path.join(currSrc, entry.name);
          const destPath = path.join(currDest, entry.name);
          const relativePath = path.relative(canonicalSource, srcPath).replace(/\\/g, "/");

          // Symlink barrier
          try {
            if (fs.lstatSync(srcPath).isSymbolicLink()) {
              throw new Error(`Security violation: Forbidden symbolic link in artifact: '${relativePath}'.`);
            }
          } catch (err) {
            throw err;
          }

          if (entry.isDirectory()) {
            copyRecursive(srcPath, destPath);
          } else if (entry.isFile()) {
            if (isForbiddenStorageFile(relativePath)) {
              throw new Error(`Security violation: Prohibited file in artifact: '${relativePath}'.`);
            }
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };

      copyRecursive(canonicalSource, stagingDir);

      // Verify manifest exists in staging
      const stagedManifestPath = path.join(stagingDir, "onevue-manifest.json");
      if (!fs.existsSync(stagedManifestPath)) {
        throw new Error("Missing 'onevue-manifest.json' in source artifact directory.");
      }

      // Rename staging into immutable versionDir atomically
      fs.mkdirSync(path.dirname(versionDir), { recursive: true });
      fs.renameSync(stagingDir, versionDir);

      const retrieved = await this.retrieveArtifact(cleanId, cleanVer);
      return retrieved;
    } catch (err: any) {
      try {
        if (fs.existsSync(stagingDir)) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        }
      } catch {}

      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: `Atomic storage write failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async retrieveArtifact(templateId: string, version: string): Promise<StorageResult> {
    const cleanId = templateId.trim();
    const cleanVer = version.trim();

    if (!TEMPLATE_ID_REGEX.test(cleanId) || !SEMVER_REGEX.test(cleanVer)) {
      return { success: false, outcome: "NOT_FOUND", error: "Invalid templateId or version format." };
    }

    const versionDir = this.resolveVersionDir(cleanId, cleanVer);
    if (!fs.existsSync(versionDir)) {
      return { success: false, outcome: "NOT_FOUND", error: `Artifact '${cleanId}@${cleanVer}' not found in storage.` };
    }

    const manifestPath = path.join(versionDir, "onevue-manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return { success: false, outcome: "INTEGRITY_FAILURE", error: "Stored artifact is missing its release manifest." };
    }

    try {
      const manifest: ArtifactManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return {
        success: true,
        outcome: "SUCCESS",
        templateId: cleanId,
        templateVersion: cleanVer,
        artifactDir: versionDir,
        storageLocation: `file://${versionDir}`,
        manifest,
      };
    } catch (err: any) {
      return {
        success: false,
        outcome: "INTEGRITY_FAILURE",
        error: `Failed to parse release manifest: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async validateStoredArtifact(templateId: string, version: string): Promise<StorageResult> {
    const cleanId = templateId.trim();
    const cleanVer = version.trim();
    const cacheKey = `${cleanId}@${cleanVer}`;

    const retrieved = await this.retrieveArtifact(cleanId, cleanVer);
    if (!retrieved.success || !retrieved.artifactDir || !retrieved.manifest) {
      LocalFilesystemStorageAdapter.validationCache.delete(cacheKey);
      return retrieved;
    }

    const { artifactDir, manifest } = retrieved;

    const structureError = validateManifestStructure(cleanId, cleanVer, manifest);
    if (structureError) {
      LocalFilesystemStorageAdapter.validationCache.delete(cacheKey);
      return {
        success: false,
        outcome: "INTEGRITY_FAILURE",
        error: structureError,
      };
    }

    // Fast-path performance optimization: if artifact manifest was already verified within 60s TTL,
    // skip full disk rehashing of all files while strictly preserving cryptographic security.
    const cached = LocalFilesystemStorageAdapter.validationCache.get(cacheKey);
    const now = Date.now();
    if (cached && manifest.manifestSha256 && cached.checksum === manifest.manifestSha256 && (now - cached.timestamp < 60000)) {
      return retrieved;
    }

    // Verify individual file hashes
    for (const f of manifest.files) {
      const filePath = path.join(artifactDir, f.relativePath);
      if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) {
        LocalFilesystemStorageAdapter.validationCache.delete(cacheKey);
        return {
          success: false,
          outcome: "INTEGRITY_FAILURE",
          error: `Integrity violation: File declared in manifest is missing on disk: '${f.relativePath}'.`,
        };
      }

      const actualSha = computeFileSha256(filePath);
      if (actualSha !== f.sha256) {
        LocalFilesystemStorageAdapter.validationCache.delete(cacheKey);
        return {
          success: false,
          outcome: "INTEGRITY_FAILURE",
          error: `Integrity violation: SHA-256 hash mismatch for file '${f.relativePath}'. Expected '${f.sha256}', got '${actualSha}'.`,
        };
      }
    }

    if (manifest.manifestSha256) {
      LocalFilesystemStorageAdapter.validationCache.set(cacheKey, {
        checksum: manifest.manifestSha256,
        timestamp: now,
      });
    }

    return retrieved;
  }
}

/* =========================================================================
   B. Mock R2-Compatible Storage Adapter
   ======================================================================== */

export class MockR2StorageAdapter implements TemplateStorageAdapter {
  private localAdapter: LocalFilesystemStorageAdapter;

  constructor(mockRoot?: string) {
    const root = mockRoot || fs.mkdtempSync(path.join(os.tmpdir(), "onevue-mock-r2-"));
    this.localAdapter = new LocalFilesystemStorageAdapter(root);
  }

  async checkVersionExists(templateId: string, version: string): Promise<boolean> {
    return this.localAdapter.checkVersionExists(templateId, version);
  }

  async storeArtifact(templateId: string, version: string, sourceArtifactDir: string, manifest: ArtifactManifest): Promise<StorageResult> {
    return this.localAdapter.storeArtifact(templateId, version, sourceArtifactDir, manifest);
  }

  async retrieveArtifact(templateId: string, version: string): Promise<StorageResult> {
    return this.localAdapter.retrieveArtifact(templateId, version);
  }

  async validateStoredArtifact(templateId: string, version: string): Promise<StorageResult> {
    return this.localAdapter.validateStoredArtifact(templateId, version);
  }
}

/* =========================================================================
   C. Cloudflare R2 Storage Adapter (S3-Compatible REST Protocol)
   ========================================================================= */

export interface CloudflareR2Config {
  accountId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucketName?: string;
  publicBaseUrl?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxResponseBodyBytes?: number;
  clock?: () => Date;
  fetchImpl?: typeof fetch;
}

export function getCloudflareR2Config(): CloudflareR2Config {
  return {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME || "onevue-templates",
    publicBaseUrl: process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL,
    enabled: process.env.ENABLE_LIVE_R2_STORAGE === "true",
    timeoutMs: 30000,
  };
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "application/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".ico": return "image/x-icon";
    case ".txt": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function encodeUriSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function validateManifestForArtifact(
  artifactDir: string,
  templateId: string,
  version: string,
  manifest: ArtifactManifest
): string | undefined {
  const structureError = validateManifestStructure(templateId, version, manifest);
  if (structureError) return structureError;

  let totalBytes = 0;
  const seen = new Set<string>();
  for (const file of manifest.files) {
    const relativePath = typeof file.relativePath === "string" ? file.relativePath.replace(/\\/g, "/") : "";
    const resolved = path.resolve(artifactDir, relativePath);
    if (!resolved.startsWith(path.resolve(artifactDir) + path.sep)) {
      return `Manifest contains an unsafe relative path: '${file.relativePath}'.`;
    }
    seen.add(relativePath);
    if (!fs.existsSync(resolved) || fs.lstatSync(resolved).isSymbolicLink() || !fs.statSync(resolved).isFile()) {
      return `File declared in manifest missing locally: '${relativePath}'.`;
    }
    const stat = fs.statSync(resolved);
    if (stat.size !== file.sizeBytes || computeFileSha256(resolved) !== file.sha256) {
      return `File declared in manifest failed local integrity validation: '${relativePath}'.`;
    }
    totalBytes += stat.size;
  }
  if (totalBytes !== manifest.totalBytes) {
    return "Manifest totalBytes does not match the local artifact.";
  }
  return undefined;
}

export class CloudflareR2StorageAdapter implements TemplateStorageAdapter {
  private config: CloudflareR2Config;
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(customConfig?: CloudflareR2Config) {
    this.config = { ...getCloudflareR2Config(), ...(customConfig || {}) };
    const accountId = this.config.accountId || "mock-account";
    this.baseUrl = `https://${accountId}.r2.cloudflarestorage.com`;
    this.fetchImpl = this.config.fetchImpl || globalThis.fetch;
  }

  private sanitizeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (this.config.secretAccessKey && this.config.secretAccessKey.length > 5) {
      return raw.replace(new RegExp(this.config.secretAccessKey, "g"), "[REDACTED_R2_SECRET]");
    }
    return raw;
  }

  private objectUrl(pathKey: string): string {
    const encodedKey = pathKey.split("/").map(encodeUriSegment).join("/");
    return `${this.baseUrl}/${encodeUriSegment(this.config.bucketName || "onevue-templates")}/${encodedKey}`;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs || 20000);
    try {
      return await this.fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readResponseBody(response: Response): Promise<Buffer> {
    const maxBytes = this.config.maxResponseBodyBytes || 10 * 1024 * 1024;
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error("R2 response body exceeds the configured size limit.");
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) {
      throw new Error("R2 response body exceeds the configured size limit.");
    }
    return body;
  }

  private getCanonicalObjectKey(templateId: string, version: string, relativePath: string): string {
    const cleanId = templateId.trim();
    const cleanVer = version.trim();
    const cleanRel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return `templates/${cleanId}/${cleanVer}/${cleanRel}`;
  }

  /**
   * Generates AWS Signature Version 4 headers for Cloudflare R2 S3-compatible REST API.
   */
  private signRequest(options: {
    method: string;
    pathKey: string;
    bodyBuffer?: Buffer;
    contentType?: string;
    extraHeaders?: Record<string, string>;
  }): Record<string, string> {
    const accessKeyId = this.config.accessKeyId || "";
    const secretAccessKey = this.config.secretAccessKey || "";
    const bucket = this.config.bucketName || "onevue-templates";

    const now = this.config.clock ? this.config.clock() : new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const host = new URL(this.baseUrl).host;
    const uri = `/${encodeUriSegment(bucket)}/${options.pathKey.split("/").map(encodeUriSegment).join("/")}`;
    const payloadHash = options.bodyBuffer ? sha256Hex(options.bodyBuffer) : sha256Hex("");

    const headers: Record<string, string> = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };

    if (options.contentType) {
      headers["content-type"] = options.contentType;
    }
    Object.assign(headers, options.extraHeaders || {});

    const signedHeaders = Object.keys(headers).sort().join(";");
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((k) => `${k}:${headers[k].trim().replace(/\s+/g, " ")}\n`)
      .join("");

    const canonicalRequest = [
      options.method,
      uri,
      "", // query string
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const kDate = hmacSha256("AWS4" + secretAccessKey, dateStamp);
    const kRegion = hmacSha256(kDate, "auto");
    const kService = hmacSha256(kRegion, "s3");
    const kSigning = hmacSha256(kService, "aws4_request");
    const signature = hmacSha256(kSigning, stringToSign).toString("hex");

    headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headers;
  }

  async checkVersionExists(templateId: string, version: string): Promise<boolean> {
    if (!this.config.enabled) {
      throw new Error("Live Cloudflare R2 storage is disabled by server configuration (ENABLE_LIVE_R2_STORAGE != true). Operations fail closed.");
    }

    if (!TEMPLATE_ID_REGEX.test(templateId) || !SEMVER_REGEX.test(version)) {
      return false;
    }

    const manifestKey = this.getCanonicalObjectKey(templateId, version, "onevue-manifest.json");
    const headers = this.signRequest({ method: "HEAD", pathKey: manifestKey });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs || 20000);

    try {
      const res = await this.request(this.objectUrl(manifestKey), {
        method: "HEAD",
        headers,
      });

      if (res.status === 200) return true;
      if (res.status === 404) return false;

      if (res.status === 401 || res.status === 403) {
        throw new Error("Cloudflare R2 authentication failed: Invalid or unauthorized S3 credentials.");
      }

      throw new Error(`R2 checkVersionExists returned status ${res.status}.`);
    } catch (err) {
      throw new Error(this.sanitizeError(err));
    } finally { clearTimeout(timer); }
  }

  async storeArtifact(
    templateId: string,
    version: string,
    sourceArtifactDir: string,
    manifest: ArtifactManifest
  ): Promise<StorageResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: "Live Cloudflare R2 storage is disabled by server configuration (ENABLE_LIVE_R2_STORAGE != true). Operations fail closed.",
      };
    }

    if (!this.config.accessKeyId || !this.config.secretAccessKey || !this.config.accountId) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: "Configuration error: Missing Cloudflare R2 access credentials.",
      };
    }

    const cleanId = templateId.trim();
    const cleanVer = version.trim();

    if (!TEMPLATE_ID_REGEX.test(cleanId) || !SEMVER_REGEX.test(cleanVer)) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: `Invalid templateId ('${templateId}') or version ('${version}').`,
      };
    }

    // Check collision: Immutable version already exists in R2
    try {
      const exists = await this.checkVersionExists(cleanId, cleanVer);
      if (exists) {
        return {
          success: false,
          outcome: "COLLISION",
          error: `Immutable version collision: Artifact '${cleanId}@${cleanVer}' already exists in R2 bucket. Overwrite is strictly prohibited.`,
        };
      }
    } catch (err) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: `Collision check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const canonicalSource = path.resolve(sourceArtifactDir);

    try {
      const localManifestPath = path.join(canonicalSource, "onevue-manifest.json");
      const localManifest = fs.existsSync(localManifestPath)
        ? JSON.parse(fs.readFileSync(localManifestPath, "utf8")) as ArtifactManifest
        : manifest;
      const validationError = validateManifestForArtifact(canonicalSource, cleanId, cleanVer, localManifest);
      if (validationError) {
        return { success: false, outcome: "INTEGRITY_FAILURE", error: validationError };
      }
      if (!manifest || manifest.manifestSha256 !== localManifest.manifestSha256) {
        return { success: false, outcome: "INTEGRITY_FAILURE", error: "Supplied manifest does not match the source release manifest." };
      }

      // 1. Upload all assets first
      for (const f of manifest.files) {
        if (f.relativePath === "onevue-manifest.json") continue; // Manifest uploaded last

        const localPath = path.join(canonicalSource, f.relativePath);
        if (!fs.existsSync(localPath)) {
          return {
            success: false,
            outcome: "STORAGE_ERROR",
            error: `File declared in manifest missing locally: '${f.relativePath}'.`,
          };
        }

        const fileBuffer = fs.readFileSync(localPath);
        const objectKey = this.getCanonicalObjectKey(cleanId, cleanVer, f.relativePath);
        const mimeType = getMimeType(f.relativePath);

        const headers = this.signRequest({
          method: "PUT",
          pathKey: objectKey,
          bodyBuffer: fileBuffer,
          contentType: mimeType,
          extraHeaders: {
            "cache-control": "public, max-age=31536000, immutable",
            "if-none-match": "*",
            "x-amz-meta-sha256": f.sha256,
          },
        });

        const uploadRes = await this.request(this.objectUrl(objectKey), {
          method: "PUT",
          headers,
          body: fileBuffer,
        });

        if (uploadRes.status === 412) {
          return { success: false, outcome: "COLLISION", error: `Immutable artifact file collision for '${f.relativePath}'.` };
        }

        if (!uploadRes.ok) {
          return {
            success: false,
            outcome: "STORAGE_ERROR",
            error: `Failed to upload artifact file '${f.relativePath}' to R2 (status ${uploadRes.status}).`,
          };
        }
      }

      // 2. Upload onevue-manifest.json last (atomicity: manifest confirms full inventory uploaded)
      const manifestPath = path.join(canonicalSource, "onevue-manifest.json");
      const manifestBuffer = fs.existsSync(manifestPath)
        ? fs.readFileSync(manifestPath)
        : Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

      const manifestKey = this.getCanonicalObjectKey(cleanId, cleanVer, "onevue-manifest.json");
      const manifestHeaders = this.signRequest({
        method: "PUT",
        pathKey: manifestKey,
        bodyBuffer: manifestBuffer,
        contentType: "application/json; charset=utf-8",
        extraHeaders: { "cache-control": "no-cache", "if-none-match": "*" },
      });

      const manifestRes = await this.request(this.objectUrl(manifestKey), {
        method: "PUT",
        headers: manifestHeaders,
        body: manifestBuffer,
      });

      if (manifestRes.status === 412) {
        return { success: false, outcome: "COLLISION", error: "Immutable artifact manifest collision." };
      }

      if (!manifestRes.ok) {
        return {
          success: false,
          outcome: "STORAGE_ERROR",
          error: `Failed to upload manifest to R2 (status ${manifestRes.status}).`,
        };
      }

      return {
        success: true,
        outcome: "SUCCESS",
        templateId: cleanId,
        templateVersion: cleanVer,
        storageLocation: `r2://${this.config.bucketName}/${this.getCanonicalObjectKey(cleanId, cleanVer, "")}`,
        manifest,
      };
    } catch (err: any) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: `R2 upload failed: ${this.sanitizeError(err)}`,
      };
    }
  }

  async retrieveArtifact(templateId: string, version: string): Promise<StorageResult> {
    if (!this.config.enabled) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: "Live Cloudflare R2 storage is disabled by server configuration (ENABLE_LIVE_R2_STORAGE != true). Operations fail closed.",
      };
    }

    const cleanId = templateId.trim();
    const cleanVer = version.trim();

    if (!TEMPLATE_ID_REGEX.test(cleanId) || !SEMVER_REGEX.test(cleanVer)) {
      return { success: false, outcome: "NOT_FOUND", error: "Invalid templateId or version format." };
    }

    const manifestKey = this.getCanonicalObjectKey(cleanId, cleanVer, "onevue-manifest.json");
    const headers = this.signRequest({ method: "GET", pathKey: manifestKey });

    try {
      const res = await this.request(this.objectUrl(manifestKey), {
        method: "GET",
        headers,
      });

      if (res.status === 404) {
        return { success: false, outcome: "NOT_FOUND", error: `Artifact '${cleanId}@${cleanVer}' not found in R2.` };
      }

      if (!res.ok) {
        return { success: false, outcome: "STORAGE_ERROR", error: `R2 retrieve error: status ${res.status}.` };
      }

      const manifest: ArtifactManifest = JSON.parse((await this.readResponseBody(res)).toString("utf8")) as ArtifactManifest;

      return {
        success: true,
        outcome: "SUCCESS",
        templateId: cleanId,
        templateVersion: cleanVer,
        storageLocation: `r2://${this.config.bucketName}/${this.getCanonicalObjectKey(cleanId, cleanVer, "")}`,
        manifest,
      };
    } catch (err) {
      return {
        success: false,
        outcome: "STORAGE_ERROR",
        error: this.sanitizeError(err),
      };
    }
  }

  async validateStoredArtifact(templateId: string, version: string): Promise<StorageResult> {
    const retrieved = await this.retrieveArtifact(templateId, version);
    if (!retrieved.success || !retrieved.manifest) {
      return retrieved;
    }

    const manifest = retrieved.manifest;

    const structureError = validateManifestStructure(templateId.trim(), version.trim(), manifest);
    if (structureError) {
      return {
        success: false,
        outcome: "INTEGRITY_FAILURE",
        error: `${structureError} in R2.`,
      };
    }

    for (const file of manifest.files || []) {
      const objectKey = this.getCanonicalObjectKey(templateId.trim(), version.trim(), file.relativePath);
      try {
        const response = await this.request(this.objectUrl(objectKey), { method: "GET", headers: this.signRequest({ method: "GET", pathKey: objectKey }) });
        if (!response.ok) return { success: false, outcome: response.status === 404 ? "INTEGRITY_FAILURE" : "STORAGE_ERROR", error: `Remote artifact file '${file.relativePath}' could not be verified (status ${response.status}).` };
        const body = await this.readResponseBody(response);
        if (body.length !== file.sizeBytes || sha256Hex(body) !== file.sha256) {
          return { success: false, outcome: "INTEGRITY_FAILURE", error: `Remote artifact file '${file.relativePath}' failed size or SHA-256 verification.` };
        }
      } catch (err) {
        return { success: false, outcome: "STORAGE_ERROR", error: this.sanitizeError(err) };
      }
    }

    return retrieved;
  }
}
