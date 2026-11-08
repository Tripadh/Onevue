/**
 * =========================================================================
 * OneVue Phase 5.14 — Backend Artifact Delivery Consumer (Visitor Side)
 * =========================================================================
 *
 * This module contains NO artifact storage rules. Identity validation,
 * traversal rejection, manifest validation, per-file SHA-256 verification,
 * content types and cache policy all belong to the backend and live in
 * backend/lib/template-artifact-delivery.ts, which is reached through ONE of
 * two transports:
 *
 *   1. HTTP  - Visitor -> portfolio asset route -> GET
 *              <backend>/api/public/template-artifact/<id>/<version>/<asset>
 *              -> backend delivery boundary -> TemplateStorageAdapter
 *              Used when ONEVUE_BACKEND_URL (or the explicit artifact base URL)
 *              is configured, i.e. whenever the backend runs as its own
 *              process.
 *   2. Direct - the same backend boundary module called in-process. This is
 *              local development without a separate backend process: the code
 *              executing the decision is byte-for-byte the code the backend
 *              HTTP route calls, so the two transports cannot diverge.
 *
 * Built-in templates (magicui-portfolio) are a different resource: they ship
 * inside the portfolio application bundle and have no backend storage entry.
 * They keep resolving from the bundled static directory, which is what keeps
 * MagicUI working with no backend dependency at all.
 *
 * Guarantees
 * ----------
 * - The requested template identity and immutable version are honoured
 *   exactly. A failure never resolves to another template or version.
 * - When the configured backend transport errors or is unreachable, the
 *   result is a typed STORAGE_UNAVAILABLE failure (fail closed). There is no
 *   silent substitution of a locally copied artifact.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  deliverTemplateAsset,
  resolveValidatedRelease,
  setDefaultStorageAdapter,
  contentTypeForAssetPath,
  IMMUTABLE_ASSET_CACHE_CONTROL,
  NO_STORE_CACHE_CONTROL,
  type ArtifactDeliveryFailure,
  type ArtifactDeliverySuccess,
} from "../../../backend/lib/template-artifact-delivery";
import {
  resolveTemplateArtifactsRoot,
  resolveTemplateStorageRoot,
  type ArtifactManifest,
  type TemplateStorageAdapter,
} from "../../../backend/lib/template-storage";

import {
  resolveTemplatesRootDir,
  isRegistryTemplate,
} from "./template-renderer.js";

export type { ArtifactManifest };
export { resolveTemplateStorageRoot, resolveTemplateArtifactsRoot };

export type ArtifactTransport = "http" | "direct" | "bundled";

export type ArtifactResolutionFailure = ArtifactDeliveryFailure | "BACKEND_ERROR";

export interface ArtifactResolution {
  ok: boolean;
  failure?: ArtifactResolutionFailure;
  error?: string;
  httpStatus: number;
}

export interface ResolvedTemplateRelease {
  templateId: string;
  templateVersion: string;
  /** Where the bytes came from, for provenance reporting. */
  transport: ArtifactTransport;
  /** Release manifest, when the release lives in backend artifact storage. */
  manifest: ArtifactManifest | null;
  /** Digest of the validated release manifest, when backend storage owns it. */
  manifestSha256?: string;
}

export interface DeliveredTemplateAsset extends ResolvedTemplateRelease {
  relativePath: string;
  body: Buffer;
  contentType: string;
  cacheControl: string;
  /** SHA-256 of the served bytes (empty for bundled releases). */
  sha256: string;
  /** Digest of the validated release manifest, when backend storage served it. */
  manifestSha256?: string;
}

/** Test/deployment hook: chooses the backend artifact transport. */
export function setArtifactStorageAdapter(adapter: TemplateStorageAdapter | null): void {
  setDefaultStorageAdapter(adapter);
}

/**
 * The backend base URL for artifact delivery, or null when the backend is not
 * running as a separate HTTP service. Deliberately NOT defaulted to the
 * profile API base URL, so local development without a backend process uses
 * the in-process backend boundary instead of failing on a dead socket.
 */
export function resolveBackendArtifactBaseUrl(): string | null {
  const configured =
    process.env.ONEVUE_BACKEND_ARTIFACT_BASE_URL || process.env.ONEVUE_BACKEND_URL || "";
  const trimmed = String(configured).trim().replace(/\/+$/, "");
  return trimmed || null;
}

export const BACKEND_ARTIFACT_API_PREFIX = "/api/public/template-artifact";

function storageUnavailable(error: string): ArtifactResolution {
  return {
    ok: false,
    failure: "STORAGE_UNAVAILABLE",
    error,
    httpStatus: 503,
  };
}

function encodeAssetPath(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/**
 * Asks the backend delivery API for one asset of one immutable release.
 *
 * A transport error is reported as unavailable; the response body of a
 * refused request carries the backend's own typed failure, which is forwarded
 * unchanged so the visitor sees the backend's decision rather than a second
 * opinion computed here.
 */
async function deliverThroughHttp(
  baseUrl: string,
  templateId: string,
  templateVersion: string,
  relativePath: string
): Promise<{ asset?: DeliveredTemplateAsset; resolution: ArtifactResolution }> {
  const url = `${baseUrl}${BACKEND_ARTIFACT_API_PREFIX}/${encodeAssetPath(templateId)}/${encodeAssetPath(
    templateVersion
  )}/${encodeAssetPath(relativePath)}`;

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", redirect: "manual" });
  } catch (err) {
    return {
      resolution: storageUnavailable(
        `Backend artifact delivery API at ${url} is unreachable: ${
          err instanceof Error ? err.message : String(err)
        }`
      ),
    };
  }

  if (!response.ok) {
    let failure: ArtifactResolutionFailure = "STORAGE_UNAVAILABLE";
    let error = `Backend artifact delivery API responded ${response.status} for '${templateId}@${templateVersion}/${relativePath}'.`;
    try {
      const body = (await response.json()) as { failure?: string; message?: string };
      if (body?.failure) {
        failure = body.failure as ArtifactResolutionFailure;
      }
      if (body?.message) {
        error = body.message;
      }
    } catch {
      // A non-JSON error body means the upstream is not honouring the
      // delivery contract; the typed failure above already refuses delivery.
    }
    return {
      resolution: {
        ok: false,
        failure,
        error,
        httpStatus: response.status === 404 ? 404 : response.status >= 500 ? 503 : response.status,
      },
    };
  }

  const backendContentType = response.headers.get("content-type") || "application/octet-stream";
  const backendCacheControl =
    response.headers.get("cache-control") || IMMUTABLE_ASSET_CACHE_CONTROL;

  return {
    asset: {
      templateId,
      templateVersion,
      relativePath,
      transport: "http",
      manifest: null,
      body: Buffer.from(await response.arrayBuffer()),
      contentType: backendContentType,
      cacheControl: backendCacheControl,
      sha256: (response.headers.get("etag") || "").replace(/^"|"$/g, ""),
      manifestSha256: response.headers.get("x-onevue-artifact-manifest-sha256") || undefined,
    },
    resolution: { ok: true, httpStatus: 200 },
  };
}

/**
 * Asks the backend delivery boundary directly. Same code the backend route
 * runs; chosen only when no backend HTTP service is configured.
 */
async function deliverThroughBackendBoundary(
  templateId: string,
  templateVersion: string,
  relativePath: string
): Promise<{ asset?: DeliveredTemplateAsset; resolution: ArtifactResolution }> {
  const delivery = await deliverTemplateAsset({ templateId, templateVersion, relativePath });

  if (!delivery.ok) {
    return {
      resolution: {
        ok: false,
        failure: delivery.failure,
        error: delivery.error,
        httpStatus: delivery.httpStatus,
      },
    };
  }

  return {
    asset: toDeliveredAsset(delivery, "direct"),
    resolution: { ok: true, httpStatus: 200 },
  };
}

function toDeliveredAsset(
  delivery: ArtifactDeliverySuccess,
  transport: ArtifactTransport
): DeliveredTemplateAsset {
  return {
    templateId: delivery.templateId,
    templateVersion: delivery.templateVersion,
    relativePath: delivery.relativePath,
    transport,
    manifest: null,
    body: fs.readFileSync(delivery.absolutePath),
    contentType: delivery.contentType,
    cacheControl: delivery.cacheControl,
    sha256: delivery.sha256,
    manifestSha256: delivery.manifestSha256,
  };
}

/* =========================================================================
   Built-in templates
   ========================================================================= */

/**
 * Resolves an asset of a built-in release from the portfolio's bundled static
 * directory. Built-in releases are registry-pinned (id + exact approved
 * version) and ship with the application, so they never touch backend artifact
 * storage.
 */
function resolveBundledAsset(
  templateId: string,
  templateVersion: string,
  relativePath: string
): { asset?: DeliveredTemplateAsset; resolution: ArtifactResolution } {
  const root = path.resolve(resolveTemplatesRootDir(), templateId, templateVersion);
  const rawRelative = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");

  if (
    !rawRelative ||
    path.isAbsolute(rawRelative) ||
    /^[a-zA-Z]:[\\/]/.test(rawRelative) ||
    rawRelative.includes("\0") ||
    rawRelative.split("/").some((part) => part === ".." || part === "")
  ) {
    return {
      resolution: {
        ok: false,
        failure: "UNSAFE_PATH",
        error: `Rejected unsafe built-in template asset path '${relativePath}'.`,
        httpStatus: 400,
      },
    };
  }

  const absolutePath = path.resolve(root, rawRelative);
  if (!absolutePath.startsWith(root + path.sep)) {
    return {
      resolution: {
        ok: false,
        failure: "UNSAFE_PATH",
        error: `Resolved built-in asset path escapes the template directory: '${relativePath}'.`,
        httpStatus: 400,
      },
    };
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return {
      resolution: {
        ok: false,
        failure: "MISSING_ASSET",
        error: `Asset '${rawRelative}' is missing from built-in template '${templateId}@${templateVersion}'.`,
        httpStatus: 404,
      },
    };
  }

  return {
    asset: {
      templateId,
      templateVersion,
      relativePath: rawRelative,
      transport: "bundled",
      manifest: null,
      body: fs.readFileSync(absolutePath),
      contentType: contentTypeForAssetPath(rawRelative),
      cacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
      sha256: "",
    },
    resolution: { ok: true, httpStatus: 200 },
  };
}

/* =========================================================================
   Public surface
   ========================================================================= */

/**
 * Resolves the immutable release for a visitor: validates it, without serving
 * a byte of it. Used by the route layout so a broken release commits its HTTP
 * status before the response shell is flushed.
 */
export async function resolveTemplateRelease(
  templateId: string,
  templateVersion: string
): Promise<{ release?: ResolvedTemplateRelease; resolution: ArtifactResolution }> {
  if (isRegistryTemplate(templateId)) {
    const entrypoint = path.resolve(
      resolveTemplatesRootDir(),
      templateId,
      templateVersion,
      "index.html"
    );
    if (!fs.existsSync(entrypoint)) {
      return {
        resolution: {
          ok: false,
          failure: "MISSING_ARTIFACT",
          error: `Built-in template '${templateId}@${templateVersion}' is missing its entrypoint.`,
          httpStatus: 404,
        },
      };
    }
    return {
      release: { templateId, templateVersion, transport: "bundled", manifest: null },
      resolution: { ok: true, httpStatus: 200 },
    };
  }

  const baseUrl = resolveBackendArtifactBaseUrl();
  if (baseUrl) {
    // The release-level check over HTTP uses the entrypoint, because that is
    // the document the visitor is about to be served.
    const { asset, resolution } = await deliverThroughHttp(
      baseUrl,
      templateId,
      templateVersion,
      "index.html"
    );
    if (!asset) {
      return { resolution };
    }
    return {
      release: { templateId, templateVersion, transport: "http", manifest: null },
      resolution,
    };
  }

  const validated = await resolveValidatedRelease(templateId, templateVersion);
  if (!validated.ok) {
    return {
      resolution: {
        ok: false,
        failure: validated.failure,
        error: validated.error,
        httpStatus: validated.httpStatus,
      },
    };
  }

  return {
    release: {
      templateId,
      templateVersion,
      transport: "direct",
      manifest: validated.manifest,
      manifestSha256: validated.manifest.manifestSha256,
    },
    resolution: { ok: true, httpStatus: 200 },
  };
}

/**
 * Delivers one asset of one release through the backend storage boundary.
 *
 * The bytes returned are the bytes the backend verified, so the asset route
 * can serve them without re-deriving any storage rule.
 */
export async function resolveTemplateAsset(
  templateId: string,
  templateVersion: string,
  relativePath: string
): Promise<{ asset?: DeliveredTemplateAsset; resolution: ArtifactResolution }> {
  const cleanId = String(templateId || "").trim();
  const cleanVersion = String(templateVersion || "").trim();
  const cleanRelative = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");

  if (!cleanRelative) {
    return {
      resolution: {
        ok: false,
        failure: "UNSAFE_PATH",
        error: "A template asset path is required.",
        httpStatus: 400,
      },
    };
  }

  if (isRegistryTemplate(cleanId)) {
    return resolveBundledAsset(cleanId, cleanVersion, cleanRelative);
  }

  const baseUrl = resolveBackendArtifactBaseUrl();
  if (baseUrl) {
    return deliverThroughHttp(baseUrl, cleanId, cleanVersion, cleanRelative);
  }
  return deliverThroughBackendBoundary(cleanId, cleanVersion, cleanRelative);
}

/**
 * Reads the entrypoint document of a release through the same delivery
 * surface as every other asset, so the HTML the visitor renders is exactly
 * the artifact the backend stored and verified.
 */
export async function resolveTemplateEntrypointHtml(
  templateId: string,
  templateVersion: string
): Promise<{ html?: string; release?: ResolvedTemplateRelease; resolution: ArtifactResolution }> {
  const { asset, resolution } = await resolveTemplateAsset(
    templateId,
    templateVersion,
    "index.html"
  );
  if (!asset) {
    return { resolution };
  }
  return {
    html: asset.body.toString("utf8"),
    release: {
      templateId: asset.templateId,
      templateVersion: asset.templateVersion,
      transport: asset.transport,
      manifest: asset.manifest,
      manifestSha256: asset.manifestSha256,
    },
    resolution,
  };
}

/** Cache policy for refusals: never allow an error to be cached as a release. */
export const REFUSAL_CACHE_CONTROL = NO_STORE_CACHE_CONTROL;
