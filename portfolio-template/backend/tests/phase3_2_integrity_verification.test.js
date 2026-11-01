/**
 * =========================================================================
 * OneVue Phase 3.2 — Published Revision Integrity Verification Test Suite
 * =========================================================================
 *
 * Verifies:
 * 1. Valid new full-revision checksums (DTO + customization).
 * 2. Valid legacy DTO-only checksums (backward compatibility).
 * 3. Tampered DTO detection (fails verification).
 * 4. Tampered customization detection (fails verification).
 * 5. Missing and malformed checksum rejection (fails verification).
 * 6. Public read route rejection for invalid/tampered revisions (HTTP 404).
 * 7. Rollback route rejection for invalid/tampered revisions without changing active pointer (HTTP 400).
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// Module resolution mocking for standalone unit test execution without live MongoDB
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "next/server") return "mock_next_server";
  if (request === "mongoose") return "mock_mongoose";
  if (request.endsWith("/db") || request.endsWith("/db.ts")) return "mock_db";
  if (request.endsWith("/auth") || request.endsWith("/auth.ts")) return "mock_auth";
  return originalResolve.apply(this, arguments);
};

require.cache["mock_next_server"] = {
  id: "mock_next_server",
  filename: "mock_next_server",
  loaded: true,
  exports: {
    NextResponse: {
      json: (body, init) => ({
        status: init?.status || 200,
        headers: new Headers(init?.headers),
        json: async () => body,
      }),
    },
  },
};

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;
require.cache["mock_db"] = {
  id: "mock_db",
  filename: "mock_db",
  loaded: true,
  exports: mockDbConnect,
};

let mockAuthUser = { _id: "user_student_123", name: "Alex Rivera", email: "alex@example.com" };
require.cache["mock_auth"] = {
  id: "mock_auth",
  filename: "mock_auth",
  loaded: true,
  exports: {
    verifyAuth: async () => ({ user: mockAuthUser }),
  },
};

let mockUserConfig = null;
let mockPublishedRevision = null;
let savedConfigCalled = false;

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

function createChainableQuery(resolver) {
  const promise = (async () => resolver())();
  promise.sort = () => promise;
  promise.session = () => promise;
  promise.select = () => promise;
  return promise;
}

function MockModel(name) {
  const Model = function (data) {
    Object.assign(this, data);
    this._id = this._id || `id_${Date.now()}`;
    this.save = async function () {
      savedConfigCalled = true;
      return this;
    };
  };

  Model.findOne = function () {
    return createChainableQuery(() => {
      if (name === "UserWebsiteConfig") return mockUserConfig;
      if (name === "PublishedProfileRevision") return mockPublishedRevision;
      return null;
    });
  };

  Model.findById = function () {
    return createChainableQuery(() => {
      if (name === "PublishedProfileRevision") return mockPublishedRevision;
      return null;
    });
  };

  Model.schema = {
    path: () => ({ enumValues: ["magicui-portfolio"] }),
  };

  return Model;
}

const mockMongoose = {
  Schema: MockSchema,
  model: (name) => MockModel(name),
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
  verifyPublishedRevisionIntegrity,
  PUBLIC_PROFILE_SCHEMA_VERSION,
} = require("../lib/public-profile-dto");

describe("Phase 3.2: 1. Core Revision Checksum Integrity Helper", () => {
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
    accentColor: "#3b82f6",
    themeMode: "system",
    visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
  };

  it("verifies a valid new full-revision checksum covering both DTO and customization", () => {
    const validChecksum = computeSnapshotChecksum(sampleDto, sampleCustomization);
    const revision = {
      snapshot: sampleDto,
      customization: sampleCustomization,
      checksum: validChecksum,
    };

    const isValid = verifyPublishedRevisionIntegrity(revision);
    assert.equal(isValid, true, "Valid full-revision checksum must be verified as true");
  });

  it("verifies a valid legacy DTO-only checksum where customization is omitted", () => {
    const legacyChecksum = computeSnapshotChecksum(sampleDto);
    const revision = {
      snapshot: sampleDto,
      checksum: legacyChecksum,
    };

    const isValid = verifyPublishedRevisionIntegrity(revision);
    assert.equal(isValid, true, "Valid legacy DTO-only checksum must be verified as true");
  });

  it("detects tampered DTO data and rejects verification", () => {
    const validChecksum = computeSnapshotChecksum(sampleDto, sampleCustomization);
    const tamperedDto = JSON.parse(JSON.stringify(sampleDto));
    tamperedDto.profile.displayName = "Attacker Name Spoof";

    const revision = {
      snapshot: tamperedDto,
      customization: sampleCustomization,
      checksum: validChecksum,
    };

    const isValid = verifyPublishedRevisionIntegrity(revision);
    assert.equal(isValid, false, "Tampered DTO content must cause verification failure");
  });

  it("detects tampered customization and rejects verification", () => {
    const validChecksum = computeSnapshotChecksum(sampleDto, sampleCustomization);
    const tamperedCustomization = { ...sampleCustomization, accentColor: "#ff0000" };

    const revision = {
      snapshot: sampleDto,
      customization: tamperedCustomization,
      checksum: validChecksum,
    };

    const isValid = verifyPublishedRevisionIntegrity(revision);
    assert.equal(isValid, false, "Tampered customization must cause verification failure");
  });

  it("rejects missing, null, or undefined checksum", () => {
    assert.equal(verifyPublishedRevisionIntegrity({ snapshot: sampleDto, checksum: null }), false);
    assert.equal(verifyPublishedRevisionIntegrity({ snapshot: sampleDto, checksum: undefined }), false);
    assert.equal(verifyPublishedRevisionIntegrity({ snapshot: sampleDto, checksum: "" }), false);
  });

  it("rejects malformed checksum strings", () => {
    assert.equal(verifyPublishedRevisionIntegrity({ snapshot: sampleDto, checksum: "not-a-valid-sha256" }), false);
    assert.equal(verifyPublishedRevisionIntegrity({ snapshot: sampleDto, checksum: "12345" }), false);
    assert.equal(verifyPublishedRevisionIntegrity({ snapshot: sampleDto, checksum: "a".repeat(63) }), false);
    assert.equal(verifyPublishedRevisionIntegrity({ snapshot: sampleDto, checksum: "a".repeat(65) }), false);
  });
});

describe("Phase 3.2: 2. Route-Level Integrity Verification (Public Profile & Rollback)", () => {
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
      careerInterests: [],
      areasOfInterest: [],
      languages: [],
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
    accentColor: "#3b82f6",
    themeMode: "system",
    visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
  };

  it("public profile route rejects tampered revision with 404 integrity violation", async () => {
    const validChecksum = computeSnapshotChecksum(sampleDto, sampleCustomization);
    const tamperedDto = JSON.parse(JSON.stringify(sampleDto));
    tamperedDto.profile.displayName = "Forged Display Name";

    mockUserConfig = {
      _id: "config_123",
      userId: "user_student_123",
      username: "alex.rivera",
      status: "published",
      activeRevisionId: "rev_1",
    };

    mockPublishedRevision = {
      _id: "rev_1",
      userId: "user_student_123",
      websiteConfigId: "config_123",
      revisionNumber: 1,
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      snapshot: tamperedDto, // tampered data
      customization: sampleCustomization,
      checksum: validChecksum,
      publishedAt: new Date(),
    };

    const publicRoute = require("../app/api/public/profile/[username]/route.ts");
    const req = new Request("http://localhost:3000/api/public/profile/alex.rivera");
    const res = await publicRoute.GET(req, {
      params: Promise.resolve({ username: "alex.rivera" }),
    });

    assert.equal(res.status, 404, "Tampered revision must return 404");
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.message, "Website revision integrity violation.");
  });

  it("rollback route rejects tampered revision without changing the active pointer", async () => {
    const validChecksum = computeSnapshotChecksum(sampleDto, sampleCustomization);
    const tamperedDto = JSON.parse(JSON.stringify(sampleDto));
    tamperedDto.profile.headline = "Forged Headline";

    savedConfigCalled = false;
    mockUserConfig = {
      _id: "config_123",
      userId: "user_student_123",
      username: "alex.rivera",
      activeRevisionId: "rev_current",
      selectedTemplateId: "magicui-portfolio",
      selectedTemplateVersion: "1.0.0",
      save: async function () {
        savedConfigCalled = true;
      },
    };

    mockPublishedRevision = {
      _id: "rev_historical",
      userId: "user_student_123",
      websiteConfigId: "config_123",
      revisionNumber: 1,
      templateId: "magicui-portfolio",
      templateVersion: "1.0.0",
      snapshot: tamperedDto, // tampered data
      customization: sampleCustomization,
      checksum: validChecksum,
      publishedAt: new Date(),
    };

    const rollbackRoute = require("../app/api/student/website/rollback/route.ts");
    const req = new Request("http://localhost:3000/api/student/website/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId: "rev_historical" }),
    });

    const res = await rollbackRoute.POST(req);

    assert.equal(res.status, 400, "Rollback with tampered revision must return 400");
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "REVISION_INTEGRITY_MISMATCH");
    assert.ok(body.message.includes("Revision data integrity check failed"));

    // Verify pointer was NOT changed and config was NOT saved
    assert.equal(savedConfigCalled, false, "Config.save() must NOT be called on integrity failure");
    assert.equal(mockUserConfig.activeRevisionId, "rev_current", "Active pointer must remain unchanged");
  });
});
