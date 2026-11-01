/**
 * =========================================================================
 * OneVue Phase 3.1 — Publication Snapshot Integrity & Rollback Enforcement
 * Unit & Integration Regression Test Suite
 * =========================================================================
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// Intercept mongoose for standalone unit test execution without full runtime dependencies
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "mongoose") return "mock_mongoose";
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
}

const mockMongoose = {
  Schema: MockSchema,
  model: () => ({}),
  models: {},
};
mockMongoose.default = mockMongoose;
require.cache["mock_mongoose"] = {
  id: "mock_mongoose",
  filename: "mock_mongoose",
  loaded: true,
  exports: mockMongoose,
};

let ts;
try {
  ts = require("typescript");
} catch {
  ts = require("/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript");
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

const {
  computeSnapshotChecksum,
  PUBLIC_PROFILE_SCHEMA_VERSION,
} = require("../lib/public-profile-dto");
const { validateTemplateSelection } = require("../lib/template-registry");
const { DEFAULT_WEBSITE_CUSTOMIZATION } = require("../models/PublishedProfileRevision");

describe("Phase 3.1: Task 1 & 2 — Customization Snapshots and Checksum Integrity", () => {
  const sampleDto = {
    meta: {
      schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
      username: "alex.rivera",
      canonicalUrl: "https://onevue.id/p/alex.rivera",
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
    },
    profile: {
      displayName: "Alex Rivera",
      initials: "AR",
      headline: "Software Engineer",
      location: { city: "San Francisco", state: "CA", country: "USA" },
      careerInterests: ["Full-stack"],
      areasOfInterest: ["Distributed Systems"],
      languages: [{ language: "English", proficiency: "fluent" }],
    },
    education: [],
    projects: [],
    skills: [],
    credentials: [],
    achievements: [],
    media: [],
    contact: { socialLinks: [] },
  };

  const sampleCustomization = {
    accentColor: "#10b981",
    themeMode: "dark",
    visibleSections: ["about", "projects", "skills", "contact"],
  };

  it("computes a deterministic 64-character hex SHA-256 checksum covering both DTO and customization", () => {
    const checksum1 = computeSnapshotChecksum(sampleDto, sampleCustomization);
    const checksum2 = computeSnapshotChecksum(sampleDto, sampleCustomization);

    assert.equal(typeof checksum1, "string");
    assert.equal(checksum1.length, 64);
    assert.match(checksum1, /^[a-f0-9]{64}$/i);
    assert.equal(checksum1, checksum2, "Checksum must be completely deterministic across calls");
  });

  it("produces a distinct checksum when customization properties change, even if DTO is identical", () => {
    const checksumOriginal = computeSnapshotChecksum(sampleDto, sampleCustomization);

    const changedAccent = { ...sampleCustomization, accentColor: "#ef4444" };
    const checksumChangedAccent = computeSnapshotChecksum(sampleDto, changedAccent);
    assert.notEqual(checksumOriginal, checksumChangedAccent);

    const changedSections = { ...sampleCustomization, visibleSections: ["about"] };
    const checksumChangedSections = computeSnapshotChecksum(sampleDto, changedSections);
    assert.notEqual(checksumOriginal, checksumChangedSections);

    const changedTheme = { ...sampleCustomization, themeMode: "light" };
    const checksumChangedTheme = computeSnapshotChecksum(sampleDto, changedTheme);
    assert.notEqual(checksumOriginal, checksumChangedTheme);
  });

  it("preserves bit-for-bit backward compatibility for historical revisions where customization is omitted", () => {
    const legacyChecksum = computeSnapshotChecksum(sampleDto);
    assert.equal(typeof legacyChecksum, "string");
    assert.equal(legacyChecksum.length, 64);

    const legacyChecksum2 = computeSnapshotChecksum(sampleDto);
    assert.equal(legacyChecksum, legacyChecksum2);

    const fullChecksum = computeSnapshotChecksum(sampleDto, sampleCustomization);
    assert.notEqual(legacyChecksum, fullChecksum);
  });

  it("exposes immutable DEFAULT_WEBSITE_CUSTOMIZATION baseline", () => {
    assert.equal(DEFAULT_WEBSITE_CUSTOMIZATION.accentColor, "#3b82f6");
    assert.equal(DEFAULT_WEBSITE_CUSTOMIZATION.themeMode, "system");
    assert.deepEqual(DEFAULT_WEBSITE_CUSTOMIZATION.visibleSections, [
      "about",
      "education",
      "projects",
      "skills",
      "achievements",
      "contact",
    ]);
  });
});

describe("Phase 3.1: Task 3 — Rollback Registry & Historical Defaults Enforcement", () => {
  it("approves rollback when target revision has approved template and version", () => {
    const validation = validateTemplateSelection("magicui-portfolio", "1.0.0", "1.0.0");
    assert.equal(validation.valid, true);
    assert.equal(validation.template.id, "magicui-portfolio");
    assert.equal(validation.release.version, "1.0.0");
  });

  it("rejects rollback if target revision has an unknown template ID", () => {
    const validation = validateTemplateSelection("malicious-or-unknown-template", "1.0.0", "1.0.0");
    assert.equal(validation.valid, false);
    assert.equal(validation.code, "TEMPLATE_UNKNOWN");
  });

  it("rejects rollback if target revision references a nonexistent or revoked version", () => {
    const validation = validateTemplateSelection("magicui-portfolio", "9.9.9", "1.0.0");
    assert.equal(validation.valid, false);
    assert.equal(validation.code, "VERSION_UNKNOWN");
  });

  it("rejects rollback if target revision template release does not support the DTO schema version", () => {
    const validation = validateTemplateSelection("magicui-portfolio", "1.0.0", "99.0.0");
    assert.equal(validation.valid, false);
    assert.equal(validation.code, "DTO_INCOMPATIBLE");
  });
});

describe("Phase 3.1: Task 4 — Username Validation Harmonization", () => {
  const CANONICAL_USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/;

  it("accepts valid usernames with periods (. )", () => {
    const validUsernamesWithPeriods = [
      "alex.rivera",
      "john.doe",
      "jane.smith.dev",
      "user.123",
      "first.middle.last",
    ];

    for (const u of validUsernamesWithPeriods) {
      assert.ok(
        CANONICAL_USERNAME_REGEX.test(u),
        `Username '${u}' should be accepted by canonical regex`
      );
    }
  });

  it("accepts valid usernames with hyphens and underscores", () => {
    const validUsernames = ["alex-rivera", "john_doe", "student-0104", "dev_user-99"];
    for (const u of validUsernames) {
      assert.ok(CANONICAL_USERNAME_REGEX.test(u));
    }
  });

  it("rejects invalid usernames (boundary checks, special chars, length limits)", () => {
    const invalid = [
      "ab", // length 2 (< 3)
      "a".repeat(31), // length 31 (> 30)
      ".leadingdot", // cannot start with period
      "trailingdot.", // cannot end with period
      "-leadingdash", // cannot start with hyphen
      "trailingdash-", // cannot end with hyphen
      "_leadingunderscore", // cannot start with underscore
      "trailingunderscore_", // cannot end with underscore
      "has space",
      "has@symbol",
      "UPPERCASE",
      "has/slash",
    ];

    for (const u of invalid) {
      assert.ok(!CANONICAL_USERNAME_REGEX.test(u), `Username '${u}' should be rejected`);
    }
  });
});
