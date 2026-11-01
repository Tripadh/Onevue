/**
 * =========================================================================
 * OneVue Phase 5.14 — Authoritative Template Artifact Delivery Boundary
 * =========================================================================
 *
 * This module is the SINGLE implementation of artifact delivery. The backend
 * owns artifact storage (template-storage.ts); this module turns that storage
 * into a delivery decision: which bytes may be served, under which identity,
 * with which content type and cache headers, and which request must be
 * refused.
 *
 * Request path:
 *
 *   Visitor -> portfolio asset route -> backend artifact delivery API
 *             -> THIS MODULE -> TemplateStorageAdapter -> local FS / R2
 *
 * The portfolio never re-implements any of the rules below; it consumes either
 * the HTTP route (app/api/public/template-artifact/[...path]/route.ts) or,
 * when the backend app is not running as a separate process, this module
 * directly. Both entry points run identical code, so a delivery decision can
 * never differ between transports.
 *
 * Guarantees
 * ----------
 * - Identity is validated against the storage contract's own patterns before
 *   a single path segment is interpreted.
 * - Traversal, absolute paths, drive-prefixed paths, NUL bytes and symlinks
 *   are refused.
 * - A dynamically stored release is only deliverable after the storage
 *   adapter has validated its release manifest (structure, self checksum and
 *   per-file digests).
 * - Every served byte range is re-verified against the digest recorded in the
 *   validated manifest at serve time, so an adapter-level validation cache
 *   can never let a modified file through.
 * - An asset that is not inventoried in the release manifest does not exist.
 * - Failures are typed and mapped to an HTTP status. No alternative template
 *   or version is ever substituted.
 * - Framework-free: no Next.js, no database, no network. Safe to import from
 *   a test harness or from an HTTP route.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  LocalFilesystemStorageAdapter,
  type ArtifactManifest,
  type TemplateStorageAdapter,
} from "./template-storage";

export type ArtifactDeliveryFailure =
  | "INVALID_IDENTITY"
  | "UNSAFE_PATH"
  | "MISSING_ARTIFACT"
  | "MISSING_MANIFEST"
  | "INVALID_MANIFEST"
  | "MISSING_ASSET"
  | "INTEGRITY_FAILURE"
  | "STORAGE_UNAVAILABLE";

export interface ArtifactDeliveryRequest {
  templateId: string;
  templateVersion: string;
  /** POSIX-style path relative to the immutable release directory. */
  relativePath: string;
}

export interface ArtifactDeliverySuccess {
  ok: true;
  templateId: string;
  templateVersion: string;
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  contentType: string;
  cacheControl: string;
  /** Digest of the validated release manifest, for provenance reporting. */
  manifestSha256: string;
  storageLocation: string;
}

export interface ArtifactDeliveryFailureResult {
  ok: false;
  failure: ArtifactDeliveryFailure;
  httpStatus: number;
  error: string;
}

export type ArtifactDeliveryResult =
  | ArtifactDeliverySuccess
  | ArtifactDeliveryFailureResult;

export interface ArtifactDeliveryOptions {
  storageAdapter?: TemplateStorageAdapter;
}

/** Mirrors the identity contract enforced by the storage adapter. */
const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SEMVER_REGEX =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/;

/**
 * Immutable releases are content-addressed by template version, so a
 * successfully delivered asset may be cached forever.
 */
export const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const NO_STORE_CACHE_CONTROL = "no-store";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".cjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

/**
 * Failures that mean "this release cannot be delivered right now" rather than
 * "this file is not part of this release". Storage faults must never look like
 * a successful 404, otherwise a broken pipeline hides behind a cached miss.
 */
const FAILURE_HTTP_STATUS: Record<ArtifactDeliveryFailure, number> = {
  INVALID_IDENTITY: 400,
  UNSAFE_PATH: 400,
  MISSING_ARTIFACT: 404,
  MISSING_ASSET: 404,
  MISSING_MANIFEST: 503,
  INVALID_MANIFEST: 503,
  INTEGRITY_FAILURE: 503,
  STORAGE_UNAVAILABLE: 503,
};

export function contentTypeForAssetPath(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

function failure(
  kind: ArtifactDeliveryFailure,
  error: string
): ArtifactDeliveryFailureResult {
  return { ok: false, failure: kind, httpStatus: FAILURE_HTTP_STATUS[kind], error };
}

/**
 * Parses the delivery path that follows the API prefix.
 *
 *   <templateId>/<templateVersion>/<relativeAssetPath...>
 *
 * The asset path is deliberately kept as the raw remainder so that a nested
 * asset path survives; every containment rule is applied to it later.
 */
export function parseArtifactDeliveryPath(
  segments: readonly string[]
): ArtifactDeliveryRequest | null {
  if (!Array.isArray(segments) || segments.length < 3) {
    return null;
  }
  const [templateId, templateVersion, ...rest] = segments;
  const relativePath = rest.join("/");
  if (!relativePath) {
    return null;
  }
  return { templateId, templateVersion, relativePath };
}

function isNormalizedRelativePath(rawRelative: string): boolean {
  if (!rawRelative) return false;
  if (rawRelative.includes("\0")) return false;
  if (path.isAbsolute(rawRelative) || /^[a-zA-Z]:[\\/]/.test(rawRelative)) return false;
  const parts = rawRelative.split("/");
  if (parts.some((part) => part === ".." || part === "" )) return false;
  return true;
}

function computeFileSha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * The default transport. Local development uses the backend's own filesystem
 * adapter; production switches to CloudflareR2StorageAdapter behind the same
 * `TemplateStorageAdapter` interface, which is the single seam of this design.
 */
let defaultAdapter: TemplateStorageAdapter | null = null;

export function getDefaultStorageAdapter(): TemplateStorageAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new LocalFilesystemStorageAdapter();
  }
  return defaultAdapter;
}

/** Test/deployment hook: replaces the delivery transport in one place. */
export function setDefaultStorageAdapter(adapter: TemplateStorageAdapter | null): void {
  defaultAdapter = adapter;
}

/**
 * Resolves the immutable release and verifies its manifest through the
 * storage adapter. Returns the validated manifest plus the release directory,
 * or a typed failure. Never substitutes another release.
 */
export async function resolveValidatedRelease(
  templateId: string,
  templateVersion: string,
  options: ArtifactDeliveryOptions = {}
): Promise<
  | {
      ok: true;
      artifactDir: string;
      manifest: ArtifactManifest & { manifestSha256: string };
      storageLocation: string;
    }
  | ArtifactDeliveryFailureResult
> {
  const cleanId = String(templateId || "").trim();
  const cleanVersion = String(templateVersion || "").trim();

  if (!TEMPLATE_ID_REGEX.test(cleanId) || !SEMVER_REGEX.test(cleanVersion)) {
    return failure(
      "INVALID_IDENTITY",
      `Invalid template identity '${templateId}@${templateVersion}'.`
    );
  }

  const adapter = options.storageAdapter || getDefaultStorageAdapter();

  let validated;
  try {
    validated = await adapter.validateStoredArtifact(cleanId, cleanVersion);
  } catch (err) {
    return failure(
      "STORAGE_UNAVAILABLE",
      `Artifact storage is unavailable: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!validated.success) {
    if (validated.outcome === "NOT_FOUND") {
      return failure(
        "MISSING_ARTIFACT",
        `Release '${cleanId}@${cleanVersion}' is not present in artifact storage.`
      );
    }
    return failure(
      "INVALID_MANIFEST",
      validated.error ||
        `Release '${cleanId}@${cleanVersion}' failed artifact storage validation.`
    );
  }

  if (!validated.artifactDir || !validated.manifest) {
    return failure(
      "MISSING_MANIFEST",
      `Release '${cleanId}@${cleanVersion}' has no readable release manifest.`
    );
  }

  if (!validated.manifest.manifestSha256) {
    return failure(
      "INVALID_MANIFEST",
      `Release '${cleanId}@${cleanVersion}' manifest is missing its checksum.`
    );
  }

  // The adapter may answer from a short-lived validation cache. A release that
  // declares a file which is no longer on disk is an integrity failure, not a
  // client error, so the inventory is always swept before delivery.
  for (const file of validated.manifest.files) {
    const filePath = path.resolve(validated.artifactDir, file.relativePath);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(filePath);
    } catch {
      return failure(
        "INTEGRITY_FAILURE",
        `Release '${cleanId}@${cleanVersion}' declares '${file.relativePath}' but it is missing from storage.`
      );
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return failure(
        "INTEGRITY_FAILURE",
        `Release '${cleanId}@${cleanVersion}' declares '${file.relativePath}' but it is not a regular file in storage.`
      );
    }
  }

  return {
    ok: true,
    artifactDir: validated.artifactDir,
    manifest: { ...validated.manifest, manifestSha256: validated.manifest.manifestSha256 },
    storageLocation: validated.storageLocation || `file://${validated.artifactDir}`,
  };
}

/**
 * Deliverable decision for one asset of one immutable release.
 *
 * Order of operations is a security requirement: identity, then path shape,
 * then release validation, then manifest inventory, then on-disk containment,
 * then byte digest. A request is refused at the first failing step.
 */
export async function deliverTemplateAsset(
  request: ArtifactDeliveryRequest,
  options: ArtifactDeliveryOptions = {}
): Promise<ArtifactDeliveryResult> {
  const rawRelative = String(request.relativePath || "").replace(/\\/g, "/");

  // An absolute or drive-prefixed path is refused as written, never reinterpreted.
  if (path.isAbsolute(rawRelative) || /^[a-zA-Z]:[\\/]/.test(rawRelative)) {
    return failure("UNSAFE_PATH", `Rejected absolute asset path '${request.relativePath}'.`);
  }

  const cleanRelative = rawRelative.replace(/^\/+/, "");

  if (!isNormalizedRelativePath(cleanRelative)) {
    return failure("UNSAFE_PATH", `Rejected unsafe asset path '${request.relativePath}'.`);
  }

  const release = await resolveValidatedRelease(
    request.templateId,
    request.templateVersion,
    options
  );
  if (!release.ok) {
    return release;
  }

  const entry = release.manifest.files.find((file) => file.relativePath === cleanRelative);
  if (!entry) {
    return failure(
      "MISSING_ASSET",
      `Asset '${cleanRelative}' is not inventoried in release '${release.manifest.templateId}@${release.manifest.templateVersion}'.`
    );
  }

  const canonicalReleaseDir = path.resolve(release.artifactDir);
  const absolutePath = path.resolve(canonicalReleaseDir, cleanRelative);
  if (!absolutePath.startsWith(canonicalReleaseDir + path.sep)) {
    return failure(
      "UNSAFE_PATH",
      `Resolved asset path escapes the release directory: '${request.relativePath}'.`
    );
  }

  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(absolutePath);
  } catch {
    return failure(
      "INTEGRITY_FAILURE",
      `Asset '${cleanRelative}' vanished from release '${release.manifest.templateId}@${release.manifest.templateVersion}' after validation.`
    );
  }

  if (stats.isSymbolicLink() || !stats.isFile()) {
    return failure(
      "INTEGRITY_FAILURE",
      `Asset '${cleanRelative}' is not a regular file in the stored release.`
    );
  }

  // Served bytes are always re-checked against the validated manifest, so a
  // modified asset can never reach a visitor even when the adapter cached a
  // previously successful validation of the same release.
  const actualSha256 = computeFileSha256(absolutePath);
  if (actualSha256 !== entry.sha256) {
    return failure(
      "INTEGRITY_FAILURE",
      `Asset '${cleanRelative}' does not match the digest recorded in release '${release.manifest.templateId}@${release.manifest.templateVersion}'.`
    );
  }

  return {
    ok: true,
    templateId: release.manifest.templateId,
    templateVersion: release.manifest.templateVersion,
    relativePath: cleanRelative,
    absolutePath,
    sizeBytes: entry.sizeBytes,
    sha256: entry.sha256,
    contentType: contentTypeForAssetPath(cleanRelative),
    cacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
    manifestSha256: release.manifest.manifestSha256,
    storageLocation: release.storageLocation,
  };
}

/**
 * Reads the bytes of a successful delivery decision.
 */
export async function readDeliveredAsset(
  delivery: ArtifactDeliverySuccess
): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path.resolve(delivery.absolutePath));
}
