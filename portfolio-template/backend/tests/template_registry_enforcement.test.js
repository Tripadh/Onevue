/**
 * OneVue Phase 2.4.1 — Central Template Registry Enforcement Test Suite
 *
 * Verifies end-to-end enforcement across configuration and publishing routes:
 * 1. Valid approved magicui-portfolio@1.0.0 configuration is accepted.
 * 2. Unknown template IDs are rejected (TEMPLATE_UNKNOWN).
 * 3. Unknown versions such as 99.9.9 are rejected (VERSION_UNKNOWN).
 * 4. Experimental, deprecated, or rejected versions are rejected (RELEASE_UNAPPROVED).
 * 5. DTO-incompatible versions are rejected (DTO_INCOMPATIBLE).
 * 6. Publishing rejects an invalid selection before revision creation.
 * 7. Rejected publishing leaves the active revision unchanged.
 * 8. Valid publishing records exact validated template ID and version in revision snapshot.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// --- 1. Setup TypeScript Transpiler Hook using repository-available TypeScript ---
let ts;
try {
  ts = require("typescript");
} catch {
  try {
    ts = require("/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript");
  } catch {
    throw new Error("TypeScript module could not be found for test execution.");
  }
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

// State trackers for mock database and authentication
let mockUserConfig = null;
let mockStudentProfile = null;
let mockCreatedRevisions = [];
let mockAuthUser = { _id: "user_student_123", name: "Alex Rivera", email: "alex@example.com" };

// --- 2. Module resolution interception for Next.js, Mongoose, and internal helpers ---
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "next/server") return "next/server";
  if (request === "mongoose") return "mongoose";
  if (request.endsWith("/db") || request.endsWith("/db.ts")) return "mock_db";
  if (request.endsWith("/auth") || request.endsWith("/auth.ts")) return "mock_auth";
  return originalResolve.apply(this, arguments);
};

require.cache["next/server"] = {
  id: "next/server",
  filename: "next/server",
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

require.cache["mock_auth"] = {
  id: "mock_auth",
  filename: "mock_auth",
  loaded: true,
  exports: {
    verifyAuth: async (req) => {
      const authHeader = req.headers.get("authorization");
      if (authHeader && authHeader.includes("invalid")) {
        return { error: "Invalid token.", status: 401 };
      }
      return { user: mockAuthUser };
    },
  },
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

function MockModel(name) {
  const Model = function (data) {
    Object.assign(this, data);
    this._id = this._id || `id_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    this.save = async function () {
      if (name === "PublishedProfileRevision") {
        mockCreatedRevisions.push(this);
      }
      return this;
    };
  };
  function createChainableQuery(resolver) {
    const promise = (async () => resolver())();
    promise.sort = () => promise;
    promise.session = () => promise;
    promise.select = () => promise;
    return promise;
  }

  Model.findOne = function (query) {
    return createChainableQuery(() => {
      if (name === "UserWebsiteConfig") return mockUserConfig;
      if (name === "StudentProfile") return mockStudentProfile;
      if (name === "PublishedProfileRevision") {
        if (mockCreatedRevisions.length === 0) return null;
        return mockCreatedRevisions[mockCreatedRevisions.length - 1];
      }
      return null;
    });
  };
  Model.findById = function (id) {
    return createChainableQuery(() => {
      if (name === "PublishedProfileRevision") {
        return mockCreatedRevisions.find((r) => String(r._id) === String(id)) || null;
      }
      return null;
    });
  };
  Model.schema = {
    path: () => ({ enumValues: ["magicui-portfolio"] }),
  };
  return Model;
}

require.cache["mongoose"] = {
  id: "mongoose",
  filename: "mongoose",
  loaded: true,
  exports: {
    Schema: MockSchema,
    model: (name) => MockModel(name),
    models: {},
    connect: async () => {},
    startSession: async () => {
      throw new Error("Transactions not supported in test mock");
    },
  },
};

// Load routes & registry modules under test
const {
  validateTemplateSelection,
  APPROVAL_STATUS,
  TEMPLATE_CATALOG,
} = require("../lib/template-registry");

const { PUBLIC_PROFILE_SCHEMA_VERSION } = require("../lib/public-profile-dto");

const configRoute = require("../app/api/student/website/config/route.ts");
const publishRoute = require("../app/api/student/website/publish/route.ts");

describe("Phase 2.4.1 — Enforce Central Template Registry in Platform APIs", () => {
  beforeEach(() => {
    mockCreatedRevisions = [];
    mockAuthUser = { _id: "user_student_123", name: "Alex Rivera", email: "alex@example.com" };

    mockUserConfig = {
      _id: "cfg_123",
      userId: "user_student_123",
      username: "alexrivera",
      selectedTemplateId: "magicui-portfolio",
      selectedTemplateVersion: "1.0.0",
      customization: {
        accentColor: "#3b82f6",
        themeMode: "system",
        visibleSections: ["about", "education", "projects", "skills", "achievements", "contact"],
      },
      activeRevisionId: null,
      publishedAt: null,
      status: "draft",
      save: async function () {
        return this;
      },
    };

    mockStudentProfile = {
      _id: "prof_123",
      userId: "user_student_123",
      preferredName: "Alex Rivera",
      headline: "Full-Stack Engineer & Systems Researcher",
      bio: "Passionate about distributed systems and verified portfolio platforms.",
      education: [
        {
          id: "edu_1",
          institution: "University of Waterloo",
          degree: "B.S. Computer Science",
          currentStatus: "studying",
        },
      ],
      projects: [
        {
          id: "proj_1",
          title: "Nebula KV",
          technologies: ["Go", "Raft"],
          liveUrl: "https://nebulakv.io",
        },
      ],
      skills: [{ id: "sk_1", name: "Go", category: "Languages", proficiency: "Expert" }],
      toObject: function () {
        return this;
      },
    };
  });

  describe("1. Configuration API Registry Enforcement (PUT /api/student/website/config)", () => {
    it("accepts valid approved 'magicui-portfolio@1.0.0' and persists exact version", async () => {
      const req = new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selectedTemplateId: "magicui-portfolio",
          selectedTemplateVersion: "1.0.0",
        }),
      });

      const res = await configRoute.PUT(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.config.selectedTemplateId, "magicui-portfolio");
      assert.equal(json.config.selectedTemplateVersion, "1.0.0");
      assert.equal(mockUserConfig.selectedTemplateId, "magicui-portfolio");
      assert.equal(mockUserConfig.selectedTemplateVersion, "1.0.0");
    });

    it("rejects unknown template ID with TEMPLATE_UNKNOWN", async () => {
      const req = new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selectedTemplateId: "cyberpunk-neon-portfolio",
          selectedTemplateVersion: "1.0.0",
        }),
      });

      const res = await configRoute.PUT(req);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.code, "TEMPLATE_UNKNOWN");
      assert.ok(json.message.includes("not registered in the OneVue template catalog"));
      assert.ok(json.message.includes("magicui-portfolio"));
    });

    it("rejects unknown template version with VERSION_UNKNOWN (e.g. 99.9.9)", async () => {
      const req = new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          selectedTemplateId: "magicui-portfolio",
          selectedTemplateVersion: "99.9.9",
        }),
      });

      const res = await configRoute.PUT(req);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.code, "VERSION_UNKNOWN");
      assert.ok(json.message.includes("Version '99.9.9' of template 'magicui-portfolio' does not exist"));
      assert.ok(json.message.includes("Available approved versions: 1.0.0"));
    });

    it("rejects empty or whitespace template ID and version", async () => {
      const emptyIdReq = new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: { Authorization: "Bearer valid_token", "Content-Type": "application/json" },
        body: JSON.stringify({ selectedTemplateId: "   " }),
      });
      const emptyIdRes = await configRoute.PUT(emptyIdReq);
      assert.equal(emptyIdRes.status, 400);
      assert.equal((await emptyIdRes.json()).code, "TEMPLATE_ID_REQUIRED");

      const emptyVerReq = new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: { Authorization: "Bearer valid_token", "Content-Type": "application/json" },
        body: JSON.stringify({ selectedTemplateId: "magicui-portfolio", selectedTemplateVersion: "" }),
      });
      const emptyVerRes = await configRoute.PUT(emptyVerReq);
      assert.equal(emptyVerRes.status, 400);
      assert.equal((await emptyVerRes.json()).code, "VERSION_REQUIRED");
    });

    it("preserves customization and username updates when template is not updated", async () => {
      const req = new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: {
          Authorization: "Bearer valid_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customization: {
            accentColor: "#10b981",
            themeMode: "dark",
          },
        }),
      });

      const res = await configRoute.PUT(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.config.customization.accentColor, "#10b981");
      assert.equal(json.config.customization.themeMode, "dark");
      assert.equal(json.config.selectedTemplateId, "magicui-portfolio");
      assert.equal(json.config.selectedTemplateVersion, "1.0.0");
    });
  });

  describe("2. Unapproved & Incompatible Release Handling (Registry Rules)", () => {
    const fixtureCatalog = {
      "test-template": {
        id: "test-template",
        name: "Test Template",
        releases: {
          "1.0.0": {
            version: "1.0.0",
            approvalStatus: APPROVAL_STATUS.APPROVED,
            supportedDtoVersions: ["1.0.0"],
          },
          "2.0.0-experimental": {
            version: "2.0.0-experimental",
            approvalStatus: APPROVAL_STATUS.EXPERIMENTAL,
            supportedDtoVersions: ["1.0.0"],
          },
          "0.9.0-deprecated": {
            version: "0.9.0-deprecated",
            approvalStatus: APPROVAL_STATUS.DEPRECATED,
            supportedDtoVersions: ["1.0.0"],
          },
          "3.0.0-rejected": {
            version: "3.0.0-rejected",
            approvalStatus: APPROVAL_STATUS.REJECTED,
            supportedDtoVersions: ["1.0.0"],
          },
          "1.1.0-dto-incompatible": {
            version: "1.1.0-dto-incompatible",
            approvalStatus: APPROVAL_STATUS.APPROVED,
            supportedDtoVersions: ["2.0.0"], // Only supports DTO 2.0.0, incompatible with current 1.0.0
          },
        },
      },
    };

    it("rejects experimental release selection", () => {
      const res = validateTemplateSelection("test-template", "2.0.0-experimental", "1.0.0", fixtureCatalog);
      assert.equal(res.valid, false);
      assert.equal(res.code, "RELEASE_UNAPPROVED");
      assert.ok(res.error.includes("experimental and cannot be selected"));
    });

    it("rejects deprecated release selection", () => {
      const res = validateTemplateSelection("test-template", "0.9.0-deprecated", "1.0.0", fixtureCatalog);
      assert.equal(res.valid, false);
      assert.equal(res.code, "RELEASE_UNAPPROVED");
      assert.ok(res.error.includes("deprecated and cannot be selected"));
    });

    it("rejects rejected release selection", () => {
      const res = validateTemplateSelection("test-template", "3.0.0-rejected", "1.0.0", fixtureCatalog);
      assert.equal(res.valid, false);
      assert.equal(res.code, "RELEASE_UNAPPROVED");
      assert.ok(res.error.includes("rejected and cannot be selected"));
    });

    it("rejects DTO-incompatible release selection", () => {
      const res = validateTemplateSelection("test-template", "1.1.0-dto-incompatible", PUBLIC_PROFILE_SCHEMA_VERSION, fixtureCatalog);
      assert.equal(res.valid, false);
      assert.equal(res.code, "DTO_INCOMPATIBLE");
      assert.ok(res.error.includes("does not support PublicProfileDTO version '1.0.0'"));
    });
  });

  describe("3. Publishing Route Registry Enforcement (POST /api/student/website/publish)", () => {
    it("successfully publishes when template and version are approved and valid", async () => {
      const req = new Request("http://localhost:3000/api/student/website/publish", {
        method: "POST",
        headers: { Authorization: "Bearer valid_token" },
      });

      const res = await publishRoute.POST(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.revision.templateId, "magicui-portfolio");
      assert.equal(json.revision.templateVersion, "1.0.0");
      assert.equal(json.revision.revisionNumber, 1);

      // Verify revision creation
      assert.equal(mockCreatedRevisions.length, 1);
      const createdRev = mockCreatedRevisions[0];
      assert.equal(createdRev.templateId, "magicui-portfolio");
      assert.equal(createdRev.templateVersion, "1.0.0");
      assert.equal(createdRev.snapshot.meta.templateId, "magicui-portfolio");
      assert.equal(createdRev.snapshot.meta.templateVersion, "1.0.0");
      assert.equal(createdRev.snapshot.meta.schemaVersion, PUBLIC_PROFILE_SCHEMA_VERSION);

      // Verify activeRevisionId was activated on config
      assert.equal(mockUserConfig.activeRevisionId, createdRev._id);
      assert.equal(mockUserConfig.status, "published");
    });

    it("rejects publishing when config has an unknown template ID and creates no revision", async () => {
      mockUserConfig.selectedTemplateId = "unregistered-template";
      mockUserConfig.selectedTemplateVersion = "1.0.0";
      const initialActiveRevisionId = "original_active_rev_id";
      mockUserConfig.activeRevisionId = initialActiveRevisionId;

      const req = new Request("http://localhost:3000/api/student/website/publish", {
        method: "POST",
        headers: { Authorization: "Bearer valid_token" },
      });

      const res = await publishRoute.POST(req);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, "TEMPLATE_UNKNOWN");
      assert.ok(json.message.includes("Publication validation failed"));

      // Verify NO revision was created
      assert.equal(mockCreatedRevisions.length, 0);

      // Verify active revision remains unchanged
      assert.equal(mockUserConfig.activeRevisionId, initialActiveRevisionId);
    });

    it("rejects publishing when config has an unknown version and leaves active revision unchanged", async () => {
      mockUserConfig.selectedTemplateId = "magicui-portfolio";
      mockUserConfig.selectedTemplateVersion = "99.9.9"; // Invalid version
      const originalRevId = "prior_active_revision_id_456";
      mockUserConfig.activeRevisionId = originalRevId;

      const req = new Request("http://localhost:3000/api/student/website/publish", {
        method: "POST",
        headers: { Authorization: "Bearer valid_token" },
      });

      const res = await publishRoute.POST(req);
      assert.equal(res.status, 400);

      const json = await res.json();
      assert.equal(json.success, false);
      assert.equal(json.code, "VERSION_UNKNOWN");
      assert.ok(json.message.includes("Version '99.9.9' of template 'magicui-portfolio' does not exist"));

      // Zero revisions created
      assert.equal(mockCreatedRevisions.length, 0);

      // Active revision untouched
      assert.equal(mockUserConfig.activeRevisionId, originalRevId);
    });

    it("rejects publishing when profile is empty or missing content", async () => {
      mockStudentProfile.headline = "";
      mockStudentProfile.bio = "";
      mockStudentProfile.education = [];
      mockStudentProfile.projects = [];
      mockStudentProfile.skills = [];

      const req = new Request("http://localhost:3000/api/student/website/publish", {
        method: "POST",
        headers: { Authorization: "Bearer valid_token" },
      });

      const res = await publishRoute.POST(req);
      assert.equal(res.status, 400);
      const json = await res.json();
      assert.equal(json.success, false);
      assert.ok(json.message.includes("Profile must contain at least a headline"));
      assert.equal(mockCreatedRevisions.length, 0);
    });
  });

  describe("4. Authentication and Rollback Integrity", () => {
    const rollbackRoute = require("../app/api/student/website/rollback/route.ts");

    it("rejects unauthenticated or invalid token requests to config and publish", async () => {
      const badReqConfig = new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: { Authorization: "Bearer invalid_token" },
        body: JSON.stringify({ selectedTemplateId: "magicui-portfolio" }),
      });
      const resConfig = await configRoute.PUT(badReqConfig);
      assert.equal(resConfig.status, 401);

      const badReqPublish = new Request("http://localhost:3000/api/student/website/publish", {
        method: "POST",
        headers: { Authorization: "Bearer invalid_token" },
      });
      const resPublish = await publishRoute.POST(badReqPublish);
      assert.equal(resPublish.status, 401);
    });

    it("restores historical revision templateId and templateVersion during rollback", async () => {
      const { computeSnapshotChecksum } = require("../lib/public-profile-dto");
      const snapshot = {
        meta: { schemaVersion: "1.0.0", templateId: "magicui-portfolio", templateVersion: "1.0.0" },
        profile: { displayName: "Alex" },
      };
      const historicalRev = {
        _id: "rev_hist_1",
        userId: "user_student_123",
        websiteConfigId: "cfg_123",
        revisionNumber: 1,
        templateId: "magicui-portfolio",
        templateVersion: "1.0.0",
        publishedAt: new Date("2026-10-01T00:00:00Z"),
        checksum: computeSnapshotChecksum(snapshot),
        snapshot,
      };
      mockCreatedRevisions.push(historicalRev);

      // Mutate draft config to different template settings
      mockUserConfig.activeRevisionId = "rev_hist_2";
      mockUserConfig.selectedTemplateId = "magicui-portfolio";
      mockUserConfig.selectedTemplateVersion = "1.0.0";

      const req = new Request("http://localhost:3000/api/student/website/rollback", {
        method: "POST",
        headers: { Authorization: "Bearer valid_token", "Content-Type": "application/json" },
        body: JSON.stringify({ revisionId: "rev_hist_1" }),
      });

      const res = await rollbackRoute.POST(req);
      assert.equal(res.status, 200);

      const json = await res.json();
      assert.equal(json.success, true);
      assert.equal(json.activeRevision.id, "rev_hist_1");
      assert.equal(json.activeRevision.templateId, "magicui-portfolio");
      assert.equal(json.activeRevision.templateVersion, "1.0.0");

      assert.equal(mockUserConfig.activeRevisionId, "rev_hist_1");
      assert.equal(mockUserConfig.selectedTemplateId, "magicui-portfolio");
      assert.equal(mockUserConfig.selectedTemplateVersion, "1.0.0");
    });
  });
});
