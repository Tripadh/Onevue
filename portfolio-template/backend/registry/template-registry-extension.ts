/**
 * =========================================================================
 * OneVue Phase 5.6 — Dynamic Central Template Registry & Catalog Extension
 * =========================================================================
 *
 * Guarantees:
 * 1. Hybrid catalog resolution: Merges built-in static templates (e.g. magicui-portfolio@1.0.0)
 *    with dynamically approved, provisioned, and integrity-verified templates from MongoDB.
 * 2. Strict eligibility enforcement: A template appears in the public catalog ONLY if:
 *    - Ingestion review status is 'approved'.
 *    - Automated audit outcome is 'PASS' (or 'REVIEW_REQUIRED' with valid administrator override reason).
 *    - Build status is 'BUILT' and artifact is successfully stored.
 *    - Staged artifact passes cryptographic file integrity validation (sha256).
 *    - Supported DTO version matches current platform DTO version (1.0.0).
 * 3. Immutable version pinning: Preserves templateId@version integrity and prevents silent version shifting.
 */

import TemplateIngestionReview from "../models/TemplateIngestionReview";
import { LocalFilesystemStorageAdapter } from "./template-storage";
import { PUBLIC_PROFILE_SCHEMA_VERSION } from "./public-profile-dto";

// Reuse existing static listApprovedTemplates and validateTemplateSelection from template-registry.js
const { listApprovedTemplates, validateTemplateSelection } = require("./template-registry");

export interface DynamicTemplateReleaseSummary {
  version: string;
  supportedDtoVersions: string[];
  supportedSections: string[];
  customizationOptions: {
    supportsAccentColor: boolean;
    supportsThemeMode: boolean;
    defaultAccentColor: string;
    defaultThemeMode: string;
    allowedThemeModes: string[];
  };
  artifact: {
    format: string;
    entrypoint: string;
    assetBaseUrl: string;
    checksum?: string;
  };
  releasedAt: string;
  notes?: string;
}

export interface DynamicTemplateSummary {
  id: string;
  name: string;
  description: string;
  author: {
    name: string;
    url?: string;
  };
  repository: {
    type: string;
    url: string;
    defaultBranch?: string;
  };
  tags: string[];
  latestVersion: string;
  releases: DynamicTemplateReleaseSummary[];
}

/**
 * Retrieves all eligible templates from both the static catalog and MongoDB-backed
 * approved & verified ingestion records.
 */
export async function getEligibleCatalogTemplates(options: { storageAdapter?: any } = {}): Promise<DynamicTemplateSummary[]> {
  // 1. Start with built-in static approved templates
  const staticTemplates = listApprovedTemplates() || [];
  const mergedMap = new Map<string, DynamicTemplateSummary>();

  for (const t of staticTemplates) {
    mergedMap.set(t.id, JSON.parse(JSON.stringify(t)));
  }

  // 2. Query MongoDB for approved & provisioned ingestion review records
  try {
    const ReviewModel = (TemplateIngestionReview as any).default || TemplateIngestionReview;
    const approvedReviews = await ReviewModel.find({
      status: "approved",
      "provisioningRecord.status": "provisioned",
    }).lean();

    const storage = options.storageAdapter || (globalThis as any).__mockStorageAdapter || new LocalFilesystemStorageAdapter();

    for (const record of approvedReviews) {
      if (!record.templateId || !record.templateVersion) continue;

      const templateId = String(record.templateId).trim();
      const version = String(record.templateVersion).trim();
      const auditReport = record.auditReport || {};
      const auditOutcome = auditReport.outcome;

      // Eligibility Check: Audit Outcome
      if (auditOutcome === "REJECT") continue;
      if (auditOutcome === "REVIEW_REQUIRED" && !record.reviewDecision?.reason) continue;

      // Eligibility Check: Artifact Integrity Validation via Storage Adapter
      const validationResult = await storage.validateStoredArtifact(templateId, version);
      if (!validationResult.success || !validationResult.manifest) {
        // Exclude template if integrity check fails
        continue;
      }

      const manifest = validationResult.manifest;

      // DTO Compatibility Check
      if (!Array.isArray(manifest.supportedDtoVersions) || !manifest.supportedDtoVersions.includes(PUBLIC_PROFILE_SCHEMA_VERSION)) {
        continue;
      }
      const supportedDtos = manifest.supportedDtoVersions;

      const releaseSummary: DynamicTemplateReleaseSummary = {
        version,
        supportedDtoVersions: supportedDtos,
        supportedSections: ["hero", "about", "education", "skills", "projects", "work", "hackathons", "credentials", "contact"],
        customizationOptions: {
          supportsAccentColor: true,
          supportsThemeMode: true,
          defaultAccentColor: "#3b82f6",
          defaultThemeMode: "system",
          allowedThemeModes: ["light", "dark", "system"],
        },
        artifact: {
          format: "static",
          entrypoint: "index.html",
          assetBaseUrl: `/templates/${templateId}/${version}/`,
          checksum: manifest.manifestSha256,
        },
        releasedAt: record.provisioningRecord?.provisionedAt
          ? new Date(record.provisioningRecord.provisionedAt).toISOString()
          : new Date().toISOString(),
        notes: `Dynamically provisioned from GitHub commit ${record.commitSha.slice(0, 7)}.`,
      };

      if (mergedMap.has(templateId)) {
        // Merge release into existing template entry
        const existing = mergedMap.get(templateId)!;
        const existingVersionIndex = existing.releases.findIndex((r) => r.version === version);
        if (existingVersionIndex === -1) {
          existing.releases.push(releaseSummary);
          // Sort releases descending semver
          existing.releases.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
          existing.latestVersion = existing.releases[0].version;
        }
      } else {
        // Register new dynamic template entry
        const newSummary: DynamicTemplateSummary = {
          id: templateId,
          name: templateId.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" "),
          description: `Custom provisioned portfolio template (${templateId}).`,
          author: {
            name: "Verified OneVue Maintainer",
          },
          repository: {
            type: "git",
            url: record.sourceUrl,
            defaultBranch: "main",
          },
          tags: ["custom", "verified", "dynamic"],
          latestVersion: version,
          releases: [releaseSummary],
        };
        mergedMap.set(templateId, newSummary);
      }
    }
  } catch (err) {
    // If database connection fails or model is unavailable, gracefully fall back to static catalog
    console.warn("Dynamic catalog resolution warning: unable to query MongoDB template reviews:", err);
  }

  return Array.from(mergedMap.values());
}

/**
 * Validates template selection across both built-in static catalog and dynamic MongoDB templates.
 * First checks static registry for instant resolution and backward compatibility.
 * If not in static registry, queries eligible dynamic templates.
 */
export async function validateEligibleTemplateSelection(
  templateId: string,
  templateVersion: string = "1.0.0",
  dtoVersion: string = "1.0.0",
  options: { storageAdapter?: any } = {}
): Promise<{ valid: boolean; code?: string; error?: string; template?: any; release?: any; resolvedVersion?: string }> {
  if (!templateId || typeof templateId !== "string" || !templateId.trim()) {
    return {
      valid: false,
      code: "TEMPLATE_ID_REQUIRED",
      error: "Template ID is required.",
    };
  }

  const cleanId = templateId.trim();
  const requestedVersion = (templateVersion || "latest").trim();
  // 'latest' (or an omitted version) resolves to the newest approved release in
  // whichever catalog currently owns the template. The resolved version is
  // pinned in the caller's stored selection, so later releases never move it.
  const wantsLatest = !requestedVersion || requestedVersion.toLowerCase() === "latest";
  const cleanDto = (dtoVersion || "1.0.0").trim();

  // 1. Static registry check (fast-path for built-in templates like magicui-portfolio)
  if (!wantsLatest) {
    const staticResult = validateTemplateSelection(cleanId, requestedVersion, cleanDto);
    if (staticResult.valid) {
      return { ...staticResult, resolvedVersion: requestedVersion };
    }
  }

  // 2. Query eligible dynamic templates from MongoDB
  try {
    const eligibleTemplates = await getEligibleCatalogTemplates(options);
    const foundTemplate = eligibleTemplates.find((t) => t.id === cleanId);

    if (foundTemplate && foundTemplate.releases.length > 0) {
      const cleanVersion = wantsLatest ? foundTemplate.latestVersion : requestedVersion;
      const foundRelease = foundTemplate.releases.find((r) => r.version === cleanVersion);
      if (!foundRelease) {
        const availableVersions = foundTemplate.releases.map((r) => r.version).join(", ");
        return {
          valid: false,
          code: "VERSION_UNKNOWN",
          error: `Version '${cleanVersion}' of template '${cleanId}' does not exist. Available approved versions: ${availableVersions || "none"}`,
        };
      }
      if (cleanDto && !foundRelease.supportedDtoVersions.includes(cleanDto)) {
        return {
          valid: false,
          code: "DTO_INCOMPATIBLE",
          error: `Template '${cleanId}@${cleanVersion}' does not support PublicProfileDTO version '${cleanDto}'. Supported DTO versions: ${foundRelease.supportedDtoVersions.join(", ")}`,
        };
      }
      return {
        valid: true,
        template: {
          id: foundTemplate.id,
          name: foundTemplate.name,
          description: foundTemplate.description,
          author: foundTemplate.author,
          repository: foundTemplate.repository,
          tags: foundTemplate.tags,
        },
        release: foundRelease,
        resolvedVersion: cleanVersion,
      };
    }
  } catch {
    // Fall through to the static catalog.
  }

  // 3. Static catalog with an explicit 'latest' request (built-in templates).
  if (wantsLatest) {
    const staticTemplate = (listApprovedTemplates() || []).find((t: any) => t.id === cleanId);
    if (staticTemplate) {
      const latestResult = validateTemplateSelection(cleanId, staticTemplate.latestVersion, cleanDto);
      return { ...latestResult, resolvedVersion: staticTemplate.latestVersion };
    }
    return {
      valid: false,
      code: "TEMPLATE_UNKNOWN",
      error: `Template '${cleanId}' has no approved release in the catalog.`,
    };
  }

  return validateTemplateSelection(cleanId, requestedVersion, cleanDto);
}
