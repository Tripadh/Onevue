"use strict";

/**
 * =========================================================================
 * OneVue Central Template Registry (Phase 2.1)
 *
 * Single source of truth for approved portfolio template releases.
 * Distinguishes:
 * - Template identity & source repository reference
 * - Immutable release versions
 * - Supported OneVue DTO versions
 * - Approval status (approved | deprecated | experimental | rejected)
 * - Release artifact format & location
 *
 * Guarantees zero runtime Git operations during student requests.
 * =========================================================================
 */

/**
 * Approval status enum values
 */
const APPROVAL_STATUS = Object.freeze({
  APPROVED: "approved",
  DEPRECATED: "deprecated",
  EXPERIMENTAL: "experimental",
  REJECTED: "rejected",
});

/**
 * Static registry of templates and their immutable releases
 */
const TEMPLATE_CATALOG = Object.freeze({
  "magicui-portfolio": Object.freeze({
    id: "magicui-portfolio",
    name: "Magic UI Developer Portfolio",
    description:
      "A clean, typography-focused developer portfolio featuring smooth blur-fade animations, interactive dock, and verified credential highlights.",
    author: Object.freeze({
      name: "OneVue Platform & Magic UI",
      url: "https://onevue.me",
    }),
    repository: Object.freeze({
      type: "git",
      url: "https://github.com/onevue/magicui-portfolio.git",
      defaultBranch: "main",
    }),
    tags: Object.freeze(["developer", "typography", "micro-interactions", "verified-credentials"]),
    releases: Object.freeze({
      "1.0.0": Object.freeze({
        version: "1.0.0",
        approvalStatus: APPROVAL_STATUS.APPROVED,
        supportedDtoVersions: Object.freeze(["1.0.0"]),
        supportedSections: Object.freeze([
          "hero",
          "about",
          "education",
          "skills",
          "projects",
          "work",
          "hackathons",
          "credentials",
          "contact",
        ]),
        customizationOptions: Object.freeze({
          supportsAccentColor: true,
          supportsThemeMode: true,
          defaultAccentColor: "#3b82f6",
          defaultThemeMode: "system",
          allowedThemeModes: Object.freeze(["light", "dark", "system"]),
        }),
        artifact: Object.freeze({
          format: "static",
          entrypoint: "index.html",
          assetBaseUrl: "/templates/magicui-portfolio/1.0.0/",
          checksum: "02922d68143a81daae193d94ff5a11e9c7f9315fdaaf065e8fa4a9765b1fdfaa", // SHA-256 of entrypoint index.html
        }),
        releasedAt: "2026-10-27T00:00:00.000Z",
        notes: "Initial production release supporting PublicProfileDTO_v1 (1.0.0).",
      }),
    }),
  }),
});

/**
 * Returns all approved template IDs.
 * Used for enum validation in UserWebsiteConfig and request routes.
 *
 * @returns {string[]} Array of approved template IDs
 */
function getApprovedTemplateIds(catalog = TEMPLATE_CATALOG) {
  const ids = [];
  for (const [id, template] of Object.entries(catalog)) {
    if (!template || !template.releases) continue;
    const hasApprovedRelease = Object.values(template.releases).some(
      (rel) => rel.approvalStatus === APPROVAL_STATUS.APPROVED
    );
    if (hasApprovedRelease) {
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Checks whether a template ID is recognized and has at least one approved release.
 *
 * @param {string} templateId
 * @param {object} [catalog]
 * @returns {boolean}
 */
function isTemplateApproved(templateId, catalog = TEMPLATE_CATALOG) {
  if (typeof templateId !== "string") return false;
  const cleanId = templateId.trim();
  const template = catalog[cleanId];
  if (!template || !template.releases) return false;
  return Object.values(template.releases).some(
    (rel) => rel.approvalStatus === APPROVAL_STATUS.APPROVED
  );
}

/**
 * Checks whether a specific template version is recognized and approved.
 *
 * @param {string} templateId
 * @param {string} version
 * @param {object} [catalog]
 * @returns {boolean}
 */
function isVersionApproved(templateId, version, catalog = TEMPLATE_CATALOG) {
  if (typeof templateId !== "string" || typeof version !== "string") return false;
  const template = catalog[templateId.trim()];
  if (!template || !template.releases) return false;
  const release = template.releases[version.trim()];
  if (!release) return false;
  return release.approvalStatus === APPROVAL_STATUS.APPROVED;
}

/**
 * Retrieves an approved template and a specific release version.
 * If version is omitted, resolves to the latest approved release.
 *
 * @param {string} templateId
 * @param {string} [version]
 * @param {object} [catalog]
 * @returns {object|null} { template, release } or null
 */
function getApprovedTemplate(templateId, version, catalog = TEMPLATE_CATALOG) {
  if (typeof templateId !== "string") return null;
  const template = catalog[templateId.trim()];
  if (!template || !template.releases) return null;

  if (version) {
    const cleanVersion = String(version).trim();
    const release = template.releases[cleanVersion];
    if (!release || release.approvalStatus !== APPROVAL_STATUS.APPROVED) {
      return null;
    }
    return {
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        author: template.author,
        repository: template.repository,
        tags: template.tags,
      },
      release,
    };
  }

  // Find latest approved release (semver descending sort)
  const approvedVersions = Object.keys(template.releases)
    .filter((ver) => template.releases[ver].approvalStatus === APPROVAL_STATUS.APPROVED)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" }));

  if (approvedVersions.length === 0) return null;
  const latestRelease = template.releases[approvedVersions[0]];

  return {
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      author: template.author,
      repository: template.repository,
      tags: template.tags,
    },
    release: latestRelease,
  };
}

/**
 * Validates a student's template selection against the registry.
 * Validates:
 * 1. Template existence.
 * 2. Version existence.
 * 3. Approval status.
 * 4. DTO schema version compatibility.
 *
 * @param {string} templateId
 * @param {string} [templateVersion]
 * @param {string} [dtoVersion]
 * @param {object} [catalog]
 * @returns {{ valid: boolean, error?: string, code?: string, template?: object, release?: object }}
 */
function validateTemplateSelection(
  templateId,
  templateVersion = "1.0.0",
  dtoVersion = "1.0.0",
  catalog = TEMPLATE_CATALOG
) {
  if (!templateId || typeof templateId !== "string" || !templateId.trim()) {
    return {
      valid: false,
      code: "TEMPLATE_ID_REQUIRED",
      error: "Template ID is required.",
    };
  }

  const cleanId = templateId.trim();
  const template = catalog[cleanId];

  if (!template) {
    const available = getApprovedTemplateIds(catalog).join(", ");
    return {
      valid: false,
      code: "TEMPLATE_UNKNOWN",
      error: `Template '${cleanId}' is not registered in the OneVue template catalog. Approved templates: ${available}`,
    };
  }

  if (!templateVersion || typeof templateVersion !== "string" || !templateVersion.trim()) {
    return {
      valid: false,
      code: "VERSION_REQUIRED",
      error: "Template version is required.",
    };
  }

  const cleanVersion = templateVersion.trim();
  const release = template.releases ? template.releases[cleanVersion] : undefined;

  if (!release) {
    const availableVersions = template.releases
      ? Object.keys(template.releases)
          .filter((v) => template.releases[v].approvalStatus === APPROVAL_STATUS.APPROVED)
          .join(", ")
      : "";
    return {
      valid: false,
      code: "VERSION_UNKNOWN",
      error: `Version '${cleanVersion}' of template '${cleanId}' does not exist. Available approved versions: ${availableVersions || "none"}`,
    };
  }

  if (release.approvalStatus !== APPROVAL_STATUS.APPROVED) {
    return {
      valid: false,
      code: "RELEASE_UNAPPROVED",
      error: `Version '${cleanVersion}' of template '${cleanId}' is ${release.approvalStatus} and cannot be selected.`,
    };
  }

  if (dtoVersion) {
    const cleanDtoVersion = String(dtoVersion).trim();
    const supportsDto = Array.isArray(release.supportedDtoVersions) &&
      release.supportedDtoVersions.includes(cleanDtoVersion);

    if (!supportsDto) {
      return {
        valid: false,
        code: "DTO_INCOMPATIBLE",
        error: `Template '${cleanId}@${cleanVersion}' does not support PublicProfileDTO version '${cleanDtoVersion}'. Supported DTO versions: ${release.supportedDtoVersions.join(", ")}`,
      };
    }
  }

  return {
    valid: true,
    template: {
      id: template.id,
      name: template.name,
      description: template.description,
      author: template.author,
      repository: template.repository,
      tags: template.tags,
    },
    release,
  };
}

/**
 * Returns a list of approved templates with their latest approved release metadata.
 * Safe for student dashboard or public gallery consumption.
 *
 * @param {object} [catalog]
 * @returns {Array<object>}
 */
function listApprovedTemplates(catalog = TEMPLATE_CATALOG) {
  const result = [];

  for (const [id, template] of Object.entries(catalog)) {
    if (!template || !template.releases) continue;

    const approvedReleases = Object.entries(template.releases)
      .filter(([_, rel]) => rel.approvalStatus === APPROVAL_STATUS.APPROVED)
      .map(([ver, rel]) => ({
        version: ver,
        supportedDtoVersions: rel.supportedDtoVersions,
        supportedSections: rel.supportedSections,
        customizationOptions: rel.customizationOptions,
        artifact: rel.artifact,
        releasedAt: rel.releasedAt,
        notes: rel.notes,
      }))
      .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: "base" }));

    if (approvedReleases.length === 0) continue;

    result.push({
      id: template.id,
      name: template.name,
      description: template.description,
      author: template.author,
      repository: template.repository,
      tags: template.tags,
      latestVersion: approvedReleases[0].version,
      releases: approvedReleases,
    });
  }

  return result;
}

module.exports = {
  APPROVAL_STATUS,
  TEMPLATE_CATALOG,
  getApprovedTemplateIds,
  isTemplateApproved,
  isVersionApproved,
  getApprovedTemplate,
  validateTemplateSelection,
  listApprovedTemplates,
};
