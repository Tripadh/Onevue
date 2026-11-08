import { NextResponse } from "next/server";
import { applyCorsHeaders, preflightResponse } from "../../../../lib/cors";
import connectToDatabase from "../../../../lib/db";
import { getEligibleCatalogTemplates } from "../../../../lib/template-registry-extension";

export function OPTIONS(req: Request) {
  return preflightResponse(req.headers.get("origin"));
}

/* =========================================================================
   GET /api/public/templates
   Public read-only catalog delivering approved portfolio template releases.
   Single source of truth: backend/lib/template-registry.js

   Guarantees:
   - Exclusively approved releases (excludes experimental, deprecated, rejected).
   - Safe public metadata (sanitizes repo credentials and excludes local filesystem paths).
   - Zero database calls or runtime Git dependencies.
   ========================================================================= */

interface PublicRepository {
  type: string;
  url: string;
  defaultBranch?: string;
}

interface PublicArtifact {
  format: string;
  entrypoint: string;
  assetBaseUrl: string;
  checksum?: string;
}

interface PublicTemplateRelease {
  version: string;
  supportedDtoVersions: readonly string[];
  supportedSections: readonly string[];
  framework?: string;
  customizationOptions: {
    supportsAccentColor: boolean;
    supportsThemeMode: boolean;
    defaultAccentColor: string;
    defaultThemeMode: string;
    allowedThemeModes: readonly string[];
  };
  artifact: PublicArtifact;
  releasedAt: string;
  notes?: string;
}

export interface PublicTemplateSummary {
  id: string;
  name: string;
  description: string;
  author: {
    name: string;
    url?: string;
  };
  repository: PublicRepository;
  tags: readonly string[];
  latestVersion: string;
  releases: PublicTemplateRelease[];
}

/**
 * Sanitizes repository metadata, stripping any embedded basic auth credentials.
 */
function sanitizePublicRepository(repo: any): PublicRepository {
  let cleanUrl = typeof repo?.url === "string" ? repo.url.trim() : "";
  // Strip userinfo (username/password/token) from URL if present: https://user:pass@host/path -> https://host/path
  cleanUrl = cleanUrl.replace(/^(https?:\/\/)[^/@]+@/, "$1");

  return {
    type: typeof repo?.type === "string" ? repo.type : "git",
    url: cleanUrl,
    defaultBranch: typeof repo?.defaultBranch === "string" ? repo.defaultBranch : "main",
  };
}

/**
 * Sanitizes artifact metadata, ensuring no internal local filesystem paths are exposed.
 */
function sanitizePublicArtifact(artifact: any): PublicArtifact {
  let assetBaseUrl = typeof artifact?.assetBaseUrl === "string" ? artifact.assetBaseUrl.trim() : "";

  // Guard against internal absolute local filesystem paths (e.g. /home/..., /tmp/..., C:\..., file://...)
  if (/^(\/home|\/tmp|\/var|\/etc|\/usr|[a-zA-Z]:\\|file:\/\/)/i.test(assetBaseUrl)) {
    assetBaseUrl = "";
  }

  return {
    format: typeof artifact?.format === "string" ? artifact.format : "static",
    entrypoint: typeof artifact?.entrypoint === "string" ? artifact.entrypoint : "index.html",
    assetBaseUrl,
    checksum: typeof artifact?.checksum === "string" ? artifact.checksum : undefined,
  };
}

/**
 * Transforms raw approved template summaries into strictly safe public catalog items.
 */
export function buildPublicCatalog(
  rawTemplates: any[],
  filters?: { dtoVersion?: string; id?: string }
): PublicTemplateSummary[] {
  const result: PublicTemplateSummary[] = [];

  for (const t of rawTemplates) {
    if (!t || typeof t.id !== "string") continue;

    // Filter by specific template ID if requested
    if (filters?.id && t.id.toLowerCase() !== filters.id.toLowerCase()) {
      continue;
    }

    if (!Array.isArray(t.releases)) continue;

    // Filter releases by DTO schema version compatibility if requested
    const filteredReleases: PublicTemplateRelease[] = [];
    for (const rel of t.releases) {
      if (!rel || typeof rel.version !== "string") continue;

      if (filters?.dtoVersion) {
        const supportsDto =
          Array.isArray(rel.supportedDtoVersions) &&
          rel.supportedDtoVersions.includes(filters.dtoVersion);
        if (!supportsDto) continue;
      }

      filteredReleases.push({
        version: rel.version,
        supportedDtoVersions: Array.isArray(rel.supportedDtoVersions) ? [...rel.supportedDtoVersions] : [],
        supportedSections: Array.isArray(rel.supportedSections) ? [...rel.supportedSections] : [],
        framework: typeof rel.framework === "string" && rel.framework ? rel.framework : undefined,
        customizationOptions: {
          supportsAccentColor: Boolean(rel.customizationOptions?.supportsAccentColor),
          supportsThemeMode: Boolean(rel.customizationOptions?.supportsThemeMode),
          defaultAccentColor: rel.customizationOptions?.defaultAccentColor || "#3b82f6",
          defaultThemeMode: rel.customizationOptions?.defaultThemeMode || "system",
          allowedThemeModes: Array.isArray(rel.customizationOptions?.allowedThemeModes)
            ? [...rel.customizationOptions.allowedThemeModes]
            : ["light", "dark", "system"],
        },
        artifact: sanitizePublicArtifact(rel.artifact),
        releasedAt: typeof rel.releasedAt === "string" ? rel.releasedAt : new Date().toISOString(),
        notes: typeof rel.notes === "string" ? rel.notes : undefined,
      });
    }

    // Only include template if it has at least one matching approved release
    if (filteredReleases.length === 0) continue;

    result.push({
      id: t.id,
      name: typeof t.name === "string" ? t.name : t.id,
      description: typeof t.description === "string" ? t.description : "",
      author: {
        name: typeof t.author?.name === "string" ? t.author.name : "OneVue Contributor",
        url: typeof t.author?.url === "string" ? t.author.url : undefined,
      },
      repository: sanitizePublicRepository(t.repository),
      tags: Array.isArray(t.tags) ? [...t.tags] : [],
      latestVersion: filteredReleases[0].version,
      releases: filteredReleases,
    });
  }

  return result;
}

export async function GET(req: Request) {
  try {
    const origin = req.headers.get("origin");
    const { searchParams } = new URL(req.url, "http://localhost");

    const dtoVersionParam = searchParams.get("dtoVersion")?.trim();
    const idParam = searchParams.get("id")?.trim();

    // Query parameter validation
    if (dtoVersionParam !== undefined && dtoVersionParam !== "") {
      if (!/^[0-9]+(\.[0-9]+)*$/.test(dtoVersionParam) || dtoVersionParam.length > 32) {
        const errorResp = NextResponse.json(
          {
            success: false,
            message: "Invalid dtoVersion query parameter. Expected semantic version format (e.g. 1.0.0).",
          },
          { status: 400 }
        );
        return applyCorsHeaders(errorResp, origin);
      }
    }

    if (idParam !== undefined && idParam !== "") {
      if (!/^[a-z0-9-_]{1,64}$/i.test(idParam)) {
        const errorResp = NextResponse.json(
          {
            success: false,
            message: "Invalid id query parameter. Expected alphanumeric identifier with dashes or underscores.",
          },
          { status: 400 }
        );
        return applyCorsHeaders(errorResp, origin);
      }
    }

    try {
      await connectToDatabase();
    } catch {
      // Graceful fallback: public catalog continues operating using static catalog if DB connection is unavailable
    }

    // Retrieve approved templates from hybrid catalog (static built-ins + eligible provisioned templates)
    const rawTemplates = await getEligibleCatalogTemplates();
    const templates = buildPublicCatalog(rawTemplates, {
      dtoVersion: dtoVersionParam || undefined,
      id: idParam || undefined,
    });

    const response = NextResponse.json(
      {
        success: true,
        count: templates.length,
        templates,
      },
      { status: 200 }
    );

    // Public catalog caching headers: fast CDN propagation with background revalidation
    response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
    return applyCorsHeaders(response, origin);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const errorResp = NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 500 }
    );
    return applyCorsHeaders(errorResp, req.headers.get("origin"));
  }
}
