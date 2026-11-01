/**
 * OneVue Phase 2.1 — Central Template Registry Test Suite
 *
 * Verifies:
 * 1. Registry lookup (approved template and specific release metadata).
 * 2. Version compatibility (DTO 1.0.0 support, section coverage, customization options).
 * 3. Unknown template rejection (missing, null, or unregistered template IDs).
 * 4. Unknown version rejection (unregistered release versions).
 * 5. Unapproved release handling (deprecated, experimental, and rejected releases).
 * 6. DTO schema version incompatibility rejection.
 * 7. Template gallery listing (filters unapproved versions, reports latest version).
 * 8. Alignment with UserWebsiteConfig model constraints (no database migrations needed).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  APPROVAL_STATUS,
  TEMPLATE_CATALOG,
  getApprovedTemplateIds,
  isTemplateApproved,
  isVersionApproved,
  getApprovedTemplate,
  validateTemplateSelection,
  listApprovedTemplates,
} = require("../lib/template-registry");

describe("Phase 2.1 — OneVue Central Template Registry", () => {
  describe("1. Registry Lookup & Metadata Conformity", () => {
    it("retrieves the canonical 'magicui-portfolio' template at version 1.0.0", () => {
      const result = getApprovedTemplate("magicui-portfolio", "1.0.0");
      assert.ok(result, "Expected template result to be non-null");

      // Verify template identity
      assert.equal(result.template.id, "magicui-portfolio");
      assert.equal(result.template.name, "Magic UI Developer Portfolio");
      assert.ok(result.template.description.includes("developer portfolio"));
      assert.equal(result.template.repository.type, "git");
      assert.equal(result.template.repository.url, "https://github.com/onevue/magicui-portfolio.git");
      assert.equal(result.template.repository.defaultBranch, "main");

      // Verify release metadata
      assert.equal(result.release.version, "1.0.0");
      assert.equal(result.release.approvalStatus, APPROVAL_STATUS.APPROVED);
      assert.deepEqual(result.release.supportedDtoVersions, ["1.0.0"]);
      assert.ok(result.release.supportedSections.includes("credentials"));
      assert.ok(result.release.supportedSections.includes("projects"));
      assert.ok(result.release.supportedSections.includes("education"));

      // Verify release artifact location
      assert.equal(result.release.artifact.format, "static");
      assert.equal(result.release.artifact.entrypoint, "index.html");
      assert.equal(result.release.artifact.assetBaseUrl, "/templates/magicui-portfolio/1.0.0/");
    });

    it("resolves the latest approved version when version parameter is omitted", () => {
      const result = getApprovedTemplate("magicui-portfolio");
      assert.ok(result, "Expected result when omitting version");
      assert.equal(result.release.version, "1.0.0");
      assert.equal(result.release.approvalStatus, APPROVAL_STATUS.APPROVED);
    });

    it("confirms fast approval status checks", () => {
      assert.equal(isTemplateApproved("magicui-portfolio"), true);
      assert.equal(isVersionApproved("magicui-portfolio", "1.0.0"), true);
      assert.equal(isVersionApproved("magicui-portfolio", "9.9.9"), false);
      assert.equal(isTemplateApproved("non-existent"), false);
    });
  });

  describe("2. Version Compatibility & DTO Validation", () => {
    it("validates successful selection for magicui-portfolio 1.0.0 with DTO 1.0.0", () => {
      const validation = validateTemplateSelection("magicui-portfolio", "1.0.0", "1.0.0");
      assert.equal(validation.valid, true);
      assert.equal(validation.error, undefined);
      assert.ok(validation.template);
      assert.ok(validation.release);
      assert.equal(validation.release.version, "1.0.0");
    });

    it("verifies customization capabilities declared in release metadata", () => {
      const result = getApprovedTemplate("magicui-portfolio", "1.0.0");
      const opts = result.release.customizationOptions;
      assert.equal(opts.supportsAccentColor, true);
      assert.equal(opts.supportsThemeMode, true);
      assert.equal(opts.defaultAccentColor, "#3b82f6");
      assert.equal(opts.defaultThemeMode, "system");
      assert.deepEqual(opts.allowedThemeModes, ["light", "dark", "system"]);
    });

    it("rejects when DTO schema version is incompatible", () => {
      const validation = validateTemplateSelection("magicui-portfolio", "1.0.0", "2.0.0");
      assert.equal(validation.valid, false);
      assert.equal(validation.code, "DTO_INCOMPATIBLE");
      assert.ok(validation.error.includes("does not support PublicProfileDTO version '2.0.0'"));
    });
  });

  describe("3. Unknown Template Rejection", () => {
    it("rejects missing, null, or empty template ID", () => {
      const emptyCheck = validateTemplateSelection("");
      assert.equal(emptyCheck.valid, false);
      assert.equal(emptyCheck.code, "TEMPLATE_ID_REQUIRED");

      const nullCheck = validateTemplateSelection(null);
      assert.equal(nullCheck.valid, false);
      assert.equal(nullCheck.code, "TEMPLATE_ID_REQUIRED");
    });

    it("rejects unknown template ID and provides approved alternatives", () => {
      const validation = validateTemplateSelection("unknown-fancy-template", "1.0.0");
      assert.equal(validation.valid, false);
      assert.equal(validation.code, "TEMPLATE_UNKNOWN");
      assert.ok(validation.error.includes("not registered in the OneVue template catalog"));
      assert.ok(validation.error.includes("magicui-portfolio"));
    });

    it("returns null on getApprovedTemplate for unknown template", () => {
      const result = getApprovedTemplate("unknown-template", "1.0.0");
      assert.equal(result, null);
    });
  });

  describe("4. Unknown Version Rejection", () => {
    it("rejects unregistered version for an existing template", () => {
      const validation = validateTemplateSelection("magicui-portfolio", "2.5.0");
      assert.equal(validation.valid, false);
      assert.equal(validation.code, "VERSION_UNKNOWN");
      assert.ok(validation.error.includes("Version '2.5.0' of template 'magicui-portfolio' does not exist"));
      assert.ok(validation.error.includes("1.0.0"));
    });

    it("returns null on getApprovedTemplate for unregistered version", () => {
      const result = getApprovedTemplate("magicui-portfolio", "9.0.0");
      assert.equal(result, null);
    });
  });

  describe("5. Unapproved Releases Handling (Deprecated / Experimental / Rejected)", () => {
    const fixtureCatalog = {
      "multi-status-template": {
        id: "multi-status-template",
        name: "Multi Status Template",
        description: "Template with various release states",
        author: { name: "Test Author" },
        repository: { type: "git", url: "https://example.com/repo.git" },
        tags: ["test"],
        releases: {
          "1.0.0": {
            version: "1.0.0",
            approvalStatus: APPROVAL_STATUS.APPROVED,
            supportedDtoVersions: ["1.0.0"],
            supportedSections: ["hero"],
            artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/v1/" },
          },
          "2.0.0-beta": {
            version: "2.0.0-beta",
            approvalStatus: APPROVAL_STATUS.EXPERIMENTAL,
            supportedDtoVersions: ["1.0.0"],
            supportedSections: ["hero"],
            artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/v2-beta/" },
          },
          "0.9.0": {
            version: "0.9.0",
            approvalStatus: APPROVAL_STATUS.DEPRECATED,
            supportedDtoVersions: ["1.0.0"],
            supportedSections: ["hero"],
            artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/v0.9/" },
          },
          "3.0.0-bad": {
            version: "3.0.0-bad",
            approvalStatus: APPROVAL_STATUS.REJECTED,
            supportedDtoVersions: ["1.0.0"],
            supportedSections: ["hero"],
            artifact: { format: "static", entrypoint: "index.html", assetBaseUrl: "/v3-bad/" },
          },
        },
      },
      "fully-unapproved-template": {
        id: "fully-unapproved-template",
        name: "Unapproved Template",
        description: "Template with zero approved releases",
        releases: {
          "1.0.0": {
            version: "1.0.0",
            approvalStatus: APPROVAL_STATUS.EXPERIMENTAL,
            supportedDtoVersions: ["1.0.0"],
          },
        },
      },
    };

    it("rejects experimental release selection", () => {
      const res = validateTemplateSelection("multi-status-template", "2.0.0-beta", "1.0.0", fixtureCatalog);
      assert.equal(res.valid, false);
      assert.equal(res.code, "RELEASE_UNAPPROVED");
      assert.ok(res.error.includes("experimental and cannot be selected"));
    });

    it("rejects deprecated release selection", () => {
      const res = validateTemplateSelection("multi-status-template", "0.9.0", "1.0.0", fixtureCatalog);
      assert.equal(res.valid, false);
      assert.equal(res.code, "RELEASE_UNAPPROVED");
      assert.ok(res.error.includes("deprecated and cannot be selected"));
    });

    it("rejects rejected release selection", () => {
      const res = validateTemplateSelection("multi-status-template", "3.0.0-bad", "1.0.0", fixtureCatalog);
      assert.equal(res.valid, false);
      assert.equal(res.code, "RELEASE_UNAPPROVED");
      assert.ok(res.error.includes("rejected and cannot be selected"));
    });

    it("allows approved release from multi-status template", () => {
      const res = validateTemplateSelection("multi-status-template", "1.0.0", "1.0.0", fixtureCatalog);
      assert.equal(res.valid, true);
    });

    it("excludes templates with zero approved releases from getApprovedTemplateIds", () => {
      const ids = getApprovedTemplateIds(fixtureCatalog);
      assert.ok(ids.includes("multi-status-template"));
      assert.equal(ids.includes("fully-unapproved-template"), false);
    });
  });

  describe("6. Template Gallery Listing", () => {
    it("lists approved templates and excludes unapproved versions", () => {
      const list = listApprovedTemplates();
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 1);

      const magicUi = list.find((t) => t.id === "magicui-portfolio");
      assert.ok(magicUi, "Expected magicui-portfolio in gallery");
      assert.equal(magicUi.latestVersion, "1.0.0");
      assert.equal(magicUi.releases.length, 1);
      assert.equal(magicUi.releases[0].version, "1.0.0");
    });
  });

  describe("7. UserWebsiteConfig Model Compatibility", () => {
    it("ensures approved template IDs align with UserWebsiteConfig model enum", () => {
      const approvedIds = getApprovedTemplateIds();
      assert.deepEqual(approvedIds, ["magicui-portfolio"]);
    });
  });
});
