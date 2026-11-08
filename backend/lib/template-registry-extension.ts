/**
 * =========================================================================
 * OneVue Phase 5.6 — Dynamic Central Template Registry & Catalog Extension
 * =========================================================================
 *
 * Guarantees:
 * 1. Hybrid catalog resolution: Merges built-in static templates (e.g. magicui-portfolio@1.0.0)
 *    with dynamically approved, provisioned, and integrity-verified templates from MongoDB.
 * 2. Strict eligibility enforcement, evaluated by `evaluateCatalogEligibility` below. A
 *    dynamic release reaches a student ONLY when every one of these is independently true:
 *    - a human approved it, and the approving identity is recorded;
 *    - the audit outcome permits approval (REVIEW_REQUIRED needs a justification);
 *    - provisioning really happened against GitHub, not the local mock executor;
 *    - the lifecycle reached CATALOG_ELIGIBLE, i.e. adaptation, build and store all
 *      completed for this exact release;
 *    - adaptation evidence is present, so the bytes are an adapted template and not a
 *      raw upstream build;
 *    - the stored artifact has a manifest, files and an entrypoint, and its checksum
 *      still equals the checksum the lifecycle recorded (no stale or swapped release);
 *    - the manifest's pinned commit equals the ingestion's pinned commit;
 *    - the release supports the current DTO schema version.
 *    Missing, malformed or inconsistent evidence is a blocker: the release stays hidden.
 *    A valid checksum alone is never sufficient — it proves bytes, not a pipeline.
 * 3. Fail closed: any absent field or mismatch hides the release and is reported to
 *    administrators as a named blocker instead of throwing.
 * 4. Immutable version pinning: Preserves templateId@version integrity and prevents silent version shifting.
 */

import TemplateIngestionReview from "../models/TemplateIngestionReview";
import { LocalFilesystemStorageAdapter } from "./template-storage";
import { PUBLIC_PROFILE_SCHEMA_VERSION } from "./public-profile-dto";

// Reuse existing static listApprovedTemplates and validateTemplateSelection from template-registry.js
const { listApprovedTemplates, validateTemplateSelection } = require("./template-registry");

export type CatalogBlockerCode =
  | "REVIEW_NOT_APPROVED"
  | "REVIEWER_IDENTITY_MISSING"
  | "AUDIT_OUTCOME_MISSING"
  | "AUDIT_REJECTED"
  | "REVIEW_OVERRIDE_REASON_MISSING"
  | "PROVISIONING_NOT_COMPLETED"
  | "PROVISIONING_MODE_MOCK"
  | "LIFECYCLE_EVIDENCE_MISSING"
  | "LIFECYCLE_NOT_COMPLETED"
  | "ADAPTATION_EVIDENCE_MISSING"
  | "ARTIFACT_MANIFEST_MISSING"
  | "ARTIFACT_EMPTY"
  | "ARTIFACT_IDENTITY_MISMATCH"
  | "ARTIFACT_COMMIT_MISMATCH"
  | "MANIFEST_CHECKSUM_MISMATCH"
  | "DTO_VERSION_UNSUPPORTED"
  | "ARTIFACT_INTEGRITY_FAILED";

export interface CatalogBlocker {
  code: CatalogBlockerCode;
  message: string;
}

export interface CatalogEligibility {
  eligible: boolean;
  blockers: CatalogBlocker[];
}

/**
 * The provisioning mode a record actually establishes. Provenance has carried
 * different field names over time, so every signal is consulted and an
 * unestablished mode is reported as `unknown` rather than assumed live.
 */
export function deriveProvisioningMode(record: any): "live_github" | "mock_local" | "unknown" {
  const provenance = record?.provisioningRecord?.provenance || {};
  const destinationUrl = typeof record?.provisioningRecord?.destinationUrl === "string"
    ? record.provisioningRecord.destinationUrl
    : "";
  const declared = provenance.provisionerMode || null;

  if (
    provenance.isMock === true ||
    declared === "mock_local" ||
    provenance.mirrorType === "local_mock" ||
    /^mock:/i.test(destinationUrl)
  ) {
    return "mock_local";
  }
  if (
    provenance.isMock === false &&
    (declared === "live_github" ||
      provenance.mirrorType === "github_private" ||
      /^https:\/\/github\.com\//.test(destinationUrl))
  ) {
    return "live_github";
  }
  return "unknown";
}

/**
 * The full eligibility decision for one ingestion record, given the artifact
 * validation the storage adapter already performed. Pure and side-effect free
 * so that administrators can show the same verdict students implicitly receive.
 */
export function evaluateCatalogEligibility(
  record: any,
  validated: { success: boolean; manifest?: any; error?: string } | undefined
): CatalogEligibility {
  const blockers: CatalogBlocker[] = [];
  const push = (code: CatalogBlockerCode, message: string) => blockers.push({ code, message });

  if (!record || typeof record !== "object") {
    return { eligible: false, blockers: [{ code: "REVIEW_NOT_APPROVED", message: "No ingestion record was supplied." }] };
  }

  const reviewDecision = record.reviewDecision || {};
  const provisioning = record.provisioningRecord || {};
  const provenance = provisioning.provenance || {};
  const lifecycle = provenance.lifecycle || null;
  const auditOutcome = record.auditReport?.outcome;

  // 1. Human approval, by a recorded identity.
  if (record.status !== "approved" || reviewDecision.decision !== "approve") {
    push("REVIEW_NOT_APPROVED", `Review status is '${record.status || "unset"}' with decision '${reviewDecision.decision || "none"}'; approval is required.`);
  }
  if (!reviewDecision.reviewerUserId) {
    push("REVIEWER_IDENTITY_MISSING", "The approving reviewer identity is not recorded, so the approval cannot be attributed.");
  }

  // 2. Audit outcome permits the approval, with justification when required.
  if (!auditOutcome) {
    push("AUDIT_OUTCOME_MISSING", "No automated audit outcome was recorded for this ingestion.");
  } else if (auditOutcome === "REJECT") {
    push("AUDIT_REJECTED", "The automated audit outcome is REJECT; this release may never be catalogued.");
  } else if (auditOutcome === "REVIEW_REQUIRED" && !String(reviewDecision.reason || "").trim()) {
    push("REVIEW_OVERRIDE_REASON_MISSING", "Audit outcome REVIEW_REQUIRED requires a recorded justification reason.");
  }

  // 3. Real provisioning, not the local mock executor.
  if (provisioning.status !== "provisioned") {
    push("PROVISIONING_NOT_COMPLETED", `Provisioning status is '${provisioning.status || "unprovisioned"}'.`);
  }
  const provisioningMode = deriveProvisioningMode(record);
  if (provisioningMode === "mock_local") {
    push(
      "PROVISIONING_MODE_MOCK",
      `Provenance records mock provisioning (destination ${provisioning.destinationUrl || "unset"}), which is development scaffolding and not production storage.`
    );
  } else if (provisioningMode === "unknown") {
    push(
      "PROVISIONING_MODE_MOCK",
      "Provenance does not establish live GitHub provisioning, so production artifact storage cannot be assumed."
    );
  }

  // 4. The lifecycle actually completed for this release.
  if (!lifecycle || typeof lifecycle !== "object") {
    push("LIFECYCLE_EVIDENCE_MISSING", "No production lifecycle evidence exists for this ingestion; nothing has been built and stored by the pipeline.");
  } else if (lifecycle.status !== "CATALOG_ELIGIBLE") {
    push("LIFECYCLE_NOT_COMPLETED", `Lifecycle status is '${lifecycle.status}'${lifecycle.failedStage ? ` (failed at ${lifecycle.failedStage})` : ""}; the release never completed build and store.`);
  }

  // 5. Adaptation evidence: without it the artifact is a raw upstream build.
  const adaptation = lifecycle?.adaptation;
  if (!adaptation || typeof adaptation !== "object") {
    push("ADAPTATION_EVIDENCE_MISSING", "No adaptation evidence was recorded, so the artifact cannot be shown to carry OneVue DTO rendering or delivery-path compatibility.");
  } else if (adaptation.status !== "ADAPTED" && adaptation.status !== "COMPATIBLE") {
    push("ADAPTATION_EVIDENCE_MISSING", `Adaptation status is '${adaptation.status}'.`);
  } else if (!adaptation.framework || adaptation.framework === "unknown") {
    push("ADAPTATION_EVIDENCE_MISSING", "Adaptation recorded an unknown framework.");
  }

  // 6-9. Artifact presence, identity, commit pinning and checksum freshness.
  const manifest = validated?.manifest;
  if (!validated || !validated.success || !manifest) {
    push("ARTIFACT_MANIFEST_MISSING", validated?.error || "The stored artifact has no readable, valid release manifest.");
  } else {
    const fileCount = Array.isArray(manifest.files) ? manifest.files.length : 0;
    if (fileCount === 0 || !manifest.entrypoint) {
      push("ARTIFACT_EMPTY", `The release manifest inventories ${fileCount} file(s) with entrypoint '${manifest.entrypoint || "unset"}'.`);
    }
    if (manifest.templateId !== record.templateId || manifest.templateVersion !== record.templateVersion) {
      push("ARTIFACT_IDENTITY_MISMATCH", `Stored release is '${manifest.templateId}@${manifest.templateVersion}' but the ingestion claims '${record.templateId}@${record.templateVersion}'.`);
    }
    const pinned = String(record.commitSha || "").toLowerCase();
    const manifestCommit = String(manifest.sourceCommitSha || "").toLowerCase();
    const lifecycleCommit = String(lifecycle?.sourceCommitSha || "").toLowerCase();
    if (!pinned || !manifestCommit || manifestCommit !== pinned) {
      push("ARTIFACT_COMMIT_MISMATCH", `The artifact pins '${manifestCommit || "unset"}' but the ingestion pinned '${pinned || "unset"}'.`);
    } else if (lifecycleCommit && lifecycleCommit !== pinned) {
      push("ARTIFACT_COMMIT_MISMATCH", `The lifecycle pins '${lifecycleCommit}' but the ingestion pinned '${pinned}'.`);
    }
    if (!manifest.manifestSha256 || (lifecycle?.manifestSha256 && lifecycle.manifestSha256 !== manifest.manifestSha256)) {
      push("MANIFEST_CHECKSUM_MISMATCH", "The lifecycle's recorded manifest checksum does not match the artifact now in storage, so the release is stale or was replaced.");
    }
    if (!Array.isArray(manifest.supportedDtoVersions) || !manifest.supportedDtoVersions.includes(PUBLIC_PROFILE_SCHEMA_VERSION)) {
      push("DTO_VERSION_UNSUPPORTED", `The release supports [${(manifest.supportedDtoVersions || []).join(", ")}] but the platform serves DTO v${PUBLIC_PROFILE_SCHEMA_VERSION}.`);
    }
  }

  if (validated && validated.success === false) {
    push("ARTIFACT_INTEGRITY_FAILED", validated.error || "Artifact integrity validation failed.");
  }

  return { eligible: blockers.length === 0, blockers };
}

export interface DynamicTemplateReleaseSummary {
  version: string;
  supportedDtoVersions: string[];
  supportedSections: string[];
  /** Build framework recorded by adaptation; null when the pipeline never recorded one. */
  framework?: string | null;
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
    if (typeof ReviewModel?.find !== "function") {
      return Array.from(mergedMap.values());
    }
    const approvedReviews = await ReviewModel.find({
      status: "approved",
      "provisioningRecord.status": "provisioned",
    }).lean();

    const storage = options.storageAdapter || (globalThis as any).__mockStorageAdapter || new LocalFilesystemStorageAdapter();

    for (const record of approvedReviews) {
      if (!record.templateId || !record.templateVersion) continue;

      const templateId = String(record.templateId).trim();
      const version = String(record.templateVersion).trim();

      const storageValidation = await storage.validateStoredArtifact(templateId, version);
      const eligibility = evaluateCatalogEligibility(record, storageValidation);
      if (!eligibility.eligible) continue;

      const manifest = storageValidation.manifest;
      const supportedDtos = manifest.supportedDtoVersions;
      const lifecycle = record.provisioningRecord?.provenance?.lifecycle || null;

      const releaseSummary: DynamicTemplateReleaseSummary = {
        version,
        supportedDtoVersions: supportedDtos,
        // Taken from the adaptation evidence, never assumed. A release with no
        // declared sections advertises none rather than a plausible-looking list.
        supportedSections: Array.isArray(lifecycle?.adaptation?.supportedSections)
          ? [...lifecycle.adaptation.supportedSections]
          : [],
        framework: lifecycle?.adaptation?.framework || null,
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
 * The same verdict `getEligibleCatalogTemplates` applies, explained. Administrators
 * use this to see why a release is not reaching students; students never receive it.
 */
export async function describeCatalogEligibility(
  record: any,
  options: { storageAdapter?: any } = {}
): Promise<CatalogEligibility> {
  if (!record?.templateId || !record?.templateVersion) {
    return {
      eligible: false,
      blockers: [{ code: "ARTIFACT_IDENTITY_MISMATCH", message: "The ingestion record has no template identity." }],
    };
  }
  const storage = options.storageAdapter || (globalThis as any).__mockStorageAdapter || new LocalFilesystemStorageAdapter();
  let validation: { success: boolean; manifest?: any; error?: string } | undefined;
  try {
    validation = await storage.validateStoredArtifact(
      String(record.templateId).trim(),
      String(record.templateVersion).trim()
    );
  } catch (err) {
    validation = { success: false, error: err instanceof Error ? err.message : String(err) };
  }
  return evaluateCatalogEligibility(record, validation);
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
