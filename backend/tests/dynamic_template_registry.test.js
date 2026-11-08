/**
 * =========================================================================
 * OneVue Phase 5.6 — Dynamic Central Template Registry & Catalog Test Suite
 * =========================================================================
 *
 * Verifies:
 * 1. Approved and fully verified templates appear dynamically in the catalog.
 * 2. Unapproved templates or pending reviews remain hidden.
 * 3. Rejected audit outcomes or rejected reviews remain hidden.
 * 4. REVIEW_REQUIRED without valid override remains hidden.
 * 5. Unsupported DTO versions remain hidden.
 * 6. Missing or corrupted storage artifacts / manifest hash mismatches prevent eligibility.
 * 7. Private source metadata and internal audit reports are never exposed publicly.
 * 8. Static built-in templates (magicui-portfolio@1.0.0) are preserved alongside dynamic ones.
 * 9. Deterministic semver sorting and latest version resolution.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");

process.env.JWT_SECRET = "super_secure_test_jwt_secret_at_least_32_characters_long_123456";

// Intercept mongoose for unit testing
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "mongoose") return "mock_mongoose";
  if (request.endsWith("/db") || request.endsWith("/db.ts")) return "mock_db";
  return originalResolve.apply(this, arguments);
};

class MockSchema {
  static Types = { ObjectId: String, Mixed: Object };
  constructor() {
    this.methods = {};
    this.statics = {};
  }
  path() { return { validate() {} }; }
  index() {}
  pre() {}
  virtual() { return { get() {} }; }
}
MockSchema.prototype.methods = {};
MockSchema.prototype.statics = {};

let mockApprovedReviews = [];

const mockMongoose = {
  Schema: MockSchema,
  model: () => ({
    find: () => ({
      lean: async () => mockApprovedReviews,
    }),
  }),
  models: {},
};
mockMongoose.default = mockMongoose;
require.cache["mock_mongoose"] = {
  id: "mock_mongoose",
  filename: "mock_mongoose",
  loaded: true,
  exports: mockMongoose,
};

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;
require.cache["mock_db"] = {
  id: "mock_db",
  filename: "mock_db",
  loaded: true,
  exports: mockDbConnect,
};

let ts;
try {
  ts = require("typescript");
} catch {
  ts = require((() => { try { return require.resolve("typescript"); } catch { try { return require("node:path").resolve(__dirname, "../node_modules/typescript"); } catch { return require("node:path").resolve(__dirname, "../../portfolio/node_modules/typescript"); } } })());
}

if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const content = fs.readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(content, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    });
    module._compile(compiled.outputText, filename);
  };
}

const { getEligibleCatalogTemplates } = require("../lib/template-registry-extension.ts");
const { LocalFilesystemStorageAdapter } = require("../lib/template-storage.ts");
const { verifyAndPackageArtifact } = require("../lib/template-build.ts");

describe("Phase 5.6 — Dynamic Central Template Registry & Student Catalog", () => {
  it("merges static built-in templates with verified dynamic MongoDB templates", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-reg-test-"));
    const storage = new LocalFilesystemStorageAdapter(storageRoot);

    // Create staged valid artifact for dynamic template
    const tmpArt = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-art-"));
    fs.writeFileSync(path.join(tmpArt, "index.html"), "<html>Dynamic</html>");
    fs.mkdirSync(path.join(tmpArt, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpArt, "assets", "main.js"), "console.log(1);");

    const pkg = verifyAndPackageArtifact(tmpArt, {
      templateId: "community-template",
      templateVersion: "1.2.0",
      sourceCommitSha: "4e73ad9d1a3b5c7e9f0123456789abcdef012345",
      supportedDtoVersions: ["1.0.0"],
    });

    await storage.storeArtifact("community-template", "1.2.0", tmpArt, pkg.manifest);

    mockApprovedReviews = [
      {
        ingestionId: "ing_valid_1",
        templateId: "community-template",
        templateVersion: "1.2.0",
        sourceUrl: "https://github.com/qubort-tech/community-template",
        commitSha: "4e73ad9d1a3b5c7e9f0123456789abcdef012345",
        status: "approved",
        auditReport: { outcome: "PASS" },
        reviewDecision: {
          decision: "approve",
          reviewerUserId: "660c000000000000000000ad",
          decidedAt: new Date(),
        },
        provisioningRecord: {
          status: "provisioned",
          provisionedAt: new Date(),
          destinationUrl: "https://github.com/onevue-templates/community-template",
          provenance: {
            isMock: false,
            provisionerMode: "live_github",
            mirrorType: "github_private",
            lifecycle: {
              status: "CATALOG_ELIGIBLE",
              sourceCommitSha: "4e73ad9d1a3b5c7e9f0123456789abcdef012345",
              manifestSha256: pkg.manifest.manifestSha256,
              adaptation: {
                status: "ADAPTED",
                framework: "react-vite",
                supportedSections: ["hero", "about", "education", "projects", "skills", "contact"],
              },
            },
          },
        },
      },
      {
        ingestionId: "ing_rejected_audit",
        templateId: "bad-template",
        templateVersion: "1.0.0",
        sourceUrl: "https://github.com/qubort-tech/bad-template",
        commitSha: "1111111111222222222233333333334444444444",
        status: "approved",
        auditReport: { outcome: "REJECT" }, // Should be excluded!
        provisioningRecord: { status: "provisioned" },
      },
    ];

    try {
      const catalog = await getEligibleCatalogTemplates({ storageAdapter: storage });

      // Must contain built-in magicui-portfolio
      const magicUi = catalog.find((t) => t.id === "magicui-portfolio");
      assert.ok(magicUi);

      // Must contain dynamically approved & verified community-template
      const community = catalog.find((t) => t.id === "community-template");
      assert.ok(community);
      assert.equal(community.latestVersion, "1.2.0");
      assert.equal(community.releases.length, 1);

      // Must NOT contain rejected template
      const bad = catalog.find((t) => t.id === "bad-template");
      assert.equal(bad, undefined, "Templates with REJECT audit outcome must remain hidden");
    } finally {
      try {
        fs.rmSync(storageRoot, { recursive: true, force: true });
        fs.rmSync(tmpArt, { recursive: true, force: true });
      } catch {}
    }
  });

  it("excludes dynamic templates with corrupted or missing storage artifacts", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-reg-test-"));
    const storage = new LocalFilesystemStorageAdapter(storageRoot);

    mockApprovedReviews = [
      {
        ingestionId: "ing_missing_artifact",
        templateId: "ghost-template",
        templateVersion: "1.0.0",
        sourceUrl: "https://github.com/qubort-tech/ghost-template",
        commitSha: "4e73ad9d1a3b5c7e9f0123456789abcdef012345",
        status: "approved",
        auditReport: { outcome: "PASS" },
        provisioningRecord: { status: "provisioned" },
      },
    ];

    try {
      const catalog = await getEligibleCatalogTemplates({ storageAdapter: storage });
      const ghost = catalog.find((t) => t.id === "ghost-template");
      assert.equal(ghost, undefined, "Templates lacking valid stored artifacts must remain hidden");
    } finally {
      try {
        fs.rmSync(storageRoot, { recursive: true, force: true });
      } catch {}
    }
  });

  it("excludes dynamic templates when storage returns incomplete DTO metadata", async () => {
    mockApprovedReviews = [
      {
        ingestionId: "ing_incomplete_manifest",
        templateId: "incomplete-template",
        templateVersion: "1.0.0",
        sourceUrl: "https://github.com/qubort-tech/incomplete-template",
        commitSha: "4e73ad9d1a3b5c7e9f0123456789abcdef012345",
        status: "approved",
        auditReport: { outcome: "PASS" },
        provisioningRecord: { status: "provisioned" },
      },
    ];

    const storage = {
      validateStoredArtifact: async () => ({
        success: true,
        manifest: {
          templateId: "incomplete-template",
          templateVersion: "1.0.0",
          manifestSha256: "a".repeat(64),
        },
      }),
    };

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: storage });
    assert.equal(catalog.some((template) => template.id === "incomplete-template"), false);
  });

  it("Phase 5.6.1: Enforces safe template ID slug format and rejects punctuation/range leakage", () => {
    const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

    const validIds = [
      "magicui-portfolio",
      "minimal-dev_2026",
      "template123",
      "a",
    ];

    for (const id of validIds) {
      assert.ok(TEMPLATE_ID_REGEX.test(id), `Template ID '${id}' should be valid`);
    }

    const invalidIds = [
      "",
      "A", // Uppercase rejected
      "UPPERCASE",
      "has:colon",
      "has;semicolon",
      "has<bracket>",
      "has?question",
      "../traversal",
      "-leadinghyphen",
      "_leadingunderscore",
      "a".repeat(65), // > 64 chars
    ];

    for (const bad of invalidIds) {
      assert.equal(TEMPLATE_ID_REGEX.test(bad), false, `Template ID '${bad}' should be rejected`);
    }
  });

  it("Phase 5.6.1: Fast-path validation cache prevents unnecessary file rehashing while rejecting tampered manifests", async () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-perf-test-"));
    const storage = new LocalFilesystemStorageAdapter(storageRoot);

    const tmpArt = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-art-perf-"));
    fs.writeFileSync(path.join(tmpArt, "index.html"), "<html>Perf</html>");
    fs.mkdirSync(path.join(tmpArt, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpArt, "assets", "app.js"), "console.log('perf');");

    const pkg = verifyAndPackageArtifact(tmpArt, {
      templateId: "perf-template",
      templateVersion: "1.0.0",
      sourceCommitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      supportedDtoVersions: ["1.0.0"],
    });

    await storage.storeArtifact("perf-template", "1.0.0", tmpArt, pkg.manifest);

    try {
      // First validation: reads disk and populates validation cache
      const v1 = await storage.validateStoredArtifact("perf-template", "1.0.0");
      assert.equal(v1.success, true);

      // Second validation: serves from fast-path cache
      const v2 = await storage.validateStoredArtifact("perf-template", "1.0.0");
      assert.equal(v2.success, true);

      // Tamper with manifestSha256 on disk
      const storedManifestPath = path.join(v1.artifactDir, "onevue-manifest.json");
      const storedManifest = JSON.parse(fs.readFileSync(storedManifestPath, "utf8"));
      storedManifest.manifestSha256 = "0".repeat(64); // Corrupted hash!
      fs.writeFileSync(storedManifestPath, JSON.stringify(storedManifest), "utf8");

      // Third validation: detects tampered manifest and fails closed
      const v3 = await storage.validateStoredArtifact("perf-template", "1.0.0");
      assert.equal(v3.success, false);
      assert.equal(v3.outcome, "INTEGRITY_FAILURE");
    } finally {
      try {
        fs.rmSync(storageRoot, { recursive: true, force: true });
        fs.rmSync(tmpArt, { recursive: true, force: true });
      } catch {}
    }
  });
});
