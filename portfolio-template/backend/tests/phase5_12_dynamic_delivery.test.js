/**
 * =========================================================================
 * OneVue Phase 5.12 — Dynamic Template Selection, Publishing, Rollback & Visitor Delivery
 * =========================================================================
 *
 * Covers:
 * 1. Dynamic catalog selection and config persistence with exact version pinning.
 * 2. Rejection of ineligible, unapproved, or incompatible templates.
 * 3. Publish and rollback with pinned dynamic versions.
 * 4. Public visitor profile resolution delivering verified dynamic templates and snapshots.
 * 5. Backward compatibility with built-in static template (magicui-portfolio@1.0.0).
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");

process.env.JWT_SECRET = "super_secure_test_jwt_secret_at_least_32_characters_long_123456";

// Module resolution interception for mock DB, next/server, and mongoose
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

let mockAuthUser = {
  _id: "user_student_123",
  name: "Alex Rivera",
  email: "alex@onevue.id",
  identity: "student",
};

require.cache["mock_auth"] = {
  id: "mock_auth",
  filename: "mock_auth",
  loaded: true,
  exports: {
    verifyAuth: async () => ({ user: mockAuthUser }),
    verifyAdminAuth: async () => ({ user: mockAuthUser }),
    signJwtToken: (payload) => "mock_token_" + (payload?.id || "user"),
  },
};

let mockUserConfig = null;
let mockStudentProfile = null;
let mockPublishedRevisions = [];
let mockApprovedReviews = [];

class MockSchema {
  static Types = { ObjectId: String, Mixed: Object };
  constructor() { this.methods = {}; this.statics = {}; }
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
  promise.lean = async () => resolver();
  return promise;
}

function MockModel(name) {
  const Model = function (data) {
    Object.assign(this, data);
    this._id = this._id || `id_${Date.now()}_${Math.random()}`;
    this.save = async function () {
      if (name === "PublishedProfileRevision") {
        mockPublishedRevisions.push(this);
      } else if (name === "UserWebsiteConfig") {
        mockUserConfig = this;
      }
      return this;
    };
  };

  Model.findOne = function (query) {
    return createChainableQuery(() => {
      if (name === "UserWebsiteConfig") {
        if (query?.userId?.$ne && mockUserConfig && String(query.userId.$ne) === String(mockUserConfig.userId)) {
          return null; // No conflict with other users
        }
        return mockUserConfig;
      }
      if (name === "StudentProfile") return mockStudentProfile;
      if (name === "PublishedProfileRevision") {
        if (query?._id) return mockPublishedRevisions.find((r) => String(r._id) === String(query._id)) || null;
        if (query?.userId) {
          const revs = mockPublishedRevisions.filter((r) => String(r.userId) === String(query.userId));
          return revs.length > 0 ? revs[revs.length - 1] : null;
        }
        return mockPublishedRevisions[mockPublishedRevisions.length - 1] || null;
      }
      return null;
    });
  };

  Model.findById = function (id) {
    return createChainableQuery(() => {
      if (name === "PublishedProfileRevision") {
        return mockPublishedRevisions.find((r) => String(r._id) === String(id)) || null;
      }
      return null;
    });
  };

  Model.find = function (query) {
    return createChainableQuery(() => {
      if (name === "TemplateIngestionReview") return mockApprovedReviews;
      return [];
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

const { signJwtToken } = require("../lib/auth.ts");
const { LocalFilesystemStorageAdapter } = require("../lib/template-storage.ts");
const { verifyAndPackageArtifact } = require("../lib/template-build.ts");
const { getEligibleCatalogTemplates, validateEligibleTemplateSelection } = require("../lib/template-registry-extension.ts");

describe("Phase 5.12 — Dynamic Template Integration, Publishing & Visitor Delivery", () => {
  const studentUser = {
    _id: "user_student_123",
    name: "Alex Rivera",
    email: "alex@onevue.id",
    identity: "student",
  };

  let configRoute, publishRoute, rollbackRoute, publicProfileRoute;
  let storageRoot, storage, stagedArtifact;

  beforeEach(async () => {
    mockPublishedRevisions = [];
    mockApprovedReviews = [];
    mockStudentProfile = {
      userId: studentUser._id,
      preferredName: "Alex",
      headline: "Full-Stack Developer",
      bio: "Building resilient web applications.",
      education: [{ institution: "Stanford", degree: "B.S." }],
      projects: [{ title: "Engine" }],
      skills: [{ name: "TypeScript" }],
    };

    mockUserConfig = {
      _id: "cfg_123",
      userId: studentUser._id,
      username: "alexrivera",
      selectedTemplateId: "magicui-portfolio",
      selectedTemplateVersion: "1.0.0",
      status: "draft",
      activeRevisionId: null,
      save: async function () { return this; },
    };

    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-p512-storage-"));
    storage = new LocalFilesystemStorageAdapter(storageRoot);

    // Stage valid artifact for dynamic community template
    const tmpArt = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-p512-art-"));
    fs.writeFileSync(path.join(tmpArt, "index.html"), "<html>Community Template</html>");
    fs.mkdirSync(path.join(tmpArt, "assets"), { recursive: true });
    fs.writeFileSync(path.join(tmpArt, "assets", "index.js"), "console.log('community');");

    const pkg = verifyAndPackageArtifact(tmpArt, {
      templateId: "community-template",
      templateVersion: "1.1.0",
      sourceCommitSha: "4e73ad9d1a3b5c7e9f0123456789abcdef012345",
      supportedDtoVersions: ["1.0.0"],
    });

    await storage.storeArtifact("community-template", "1.1.0", tmpArt, pkg.manifest);

    mockApprovedReviews = [
      {
        ingestionId: "ing_comm_1",
        templateId: "community-template",
        templateVersion: "1.1.0",
        sourceUrl: "https://github.com/qubort-tech/community-template",
        commitSha: "4e73ad9d1a3b5c7e9f0123456789abcdef012345",
        status: "approved",
        auditReport: { outcome: "PASS" },
        provisioningRecord: { status: "provisioned", provisionedAt: new Date() },
      },
    ];

    globalThis.__mockStorageAdapter = storage;
    configRoute = require("../app/api/student/website/config/route.ts");
    publishRoute = require("../app/api/student/website/publish/route.ts");
    rollbackRoute = require("../app/api/student/website/rollback/route.ts");
    publicProfileRoute = require("../app/api/public/profile/[username]/route.ts");
  });

  afterEach(() => {
    delete globalThis.__mockStorageAdapter;
    try {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    } catch {}
  });

  function createAuthRequest(url, method, token, body) {
    return new Request(url, {
      method: method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  it("1. Validates and selects a dynamic template successfully via configuration API", async () => {
    const token = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const req = createAuthRequest("http://localhost:3000/api/student/website/config", "PUT", token, {
      username: "alexrivera",
      selectedTemplateId: "community-template",
      selectedTemplateVersion: "1.1.0",
    });

    const res = await configRoute.PUT(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.config.selectedTemplateId, "community-template");
    assert.equal(body.config.selectedTemplateVersion, "1.1.0");
  });

  it("2. Rejects selection of an unknown or unapproved template version", async () => {
    const token = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const req = createAuthRequest("http://localhost:3000/api/student/website/config", "PUT", token, {
      username: "alexrivera",
      selectedTemplateId: "community-template",
      selectedTemplateVersion: "9.9.9", // Unregistered version
    });

    const res = await configRoute.PUT(req);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, "VERSION_UNKNOWN");
  });

  it("3 & 4. Publishes a dynamic template with exact version pinning and snapshot integrity", async () => {
    mockUserConfig.selectedTemplateId = "community-template";
    mockUserConfig.selectedTemplateVersion = "1.1.0";

    const token = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const reqPublish = createAuthRequest("http://localhost:3000/api/student/website/publish", "POST", token, {});

    const resPublish = await publishRoute.POST(reqPublish);
    assert.equal(resPublish.status, 200);
    const bodyPublish = await resPublish.json();
    assert.equal(bodyPublish.success, true);
    assert.equal(bodyPublish.revision.templateId, "community-template");
    assert.equal(bodyPublish.revision.templateVersion, "1.1.0");

    // Verify public visitor endpoint resolves the pinned dynamic template and snapshot correctly
    const reqPublic = new Request("http://localhost:3000/api/public/profile/alexrivera");
    const resPublic = await publicProfileRoute.GET(reqPublic, {
      params: Promise.resolve({ username: "alexrivera" }),
    });

    assert.equal(resPublic.status, 200);
    const bodyPublic = await resPublic.json();
    assert.equal(bodyPublic.success, true);
    assert.equal(bodyPublic.website.templateId, "community-template");
    assert.equal(bodyPublic.website.templateVersion, "1.1.0");
    assert.equal(bodyPublic.dto.profile.displayName, "Alex");
  });

  it("5. Preserves backward compatibility with built-in static template (magicui-portfolio@1.0.0)", async () => {
    mockUserConfig.selectedTemplateId = "magicui-portfolio";
    mockUserConfig.selectedTemplateVersion = "1.0.0";

    const validation = await validateEligibleTemplateSelection("magicui-portfolio", "1.0.0", "1.0.0");
    assert.equal(validation.valid, true);
    assert.equal(validation.template.id, "magicui-portfolio");
  });

  it("6. Phase 5.13: Proves complete local user journey end-to-end", async () => {
    // 1. Approved dynamic template appears in catalog
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: storage });
    const commTmpl = catalog.find((t) => t.id === "community-template");
    assert.ok(commTmpl, "Step 1: Dynamic template must appear in catalog");
    assert.equal(commTmpl.latestVersion, "1.1.0");

    // 2 & 3. Student selects specific template ID and immutable version
    const token = signJwtToken({ id: studentUser._id, email: studentUser.email });
    const reqSelect = createAuthRequest("http://localhost:3000/api/student/website/config", "PUT", token, {
      username: "alexrivera",
      selectedTemplateId: "community-template",
      selectedTemplateVersion: "1.1.0",
      customization: {
        accentColor: "#10b981",
        themeMode: "dark",
        visibleSections: ["about", "projects", "contact"],
      },
    });
    const resSelect = await configRoute.PUT(reqSelect);
    assert.equal(resSelect.status, 200, "Step 2 & 3: Selection must persist in config");

    // 4. Publishing creates an immutable revision that pins the exact template ID and version
    const reqPublish = createAuthRequest("http://localhost:3000/api/student/website/publish", "POST", token, {});
    const resPublish = await publishRoute.POST(reqPublish);
    assert.equal(resPublish.status, 200, "Step 4: Publish must succeed");
    const pubBody = await resPublish.json();
    assert.equal(pubBody.revision.templateId, "community-template");
    assert.equal(pubBody.revision.templateVersion, "1.1.0");
    const rev1Id = pubBody.revision.id;

    // 5. Public visitor endpoint resolves that published revision
    const reqVisitor = new Request("http://localhost:3000/api/public/profile/alexrivera");
    const resVisitor = await publicProfileRoute.GET(reqVisitor, {
      params: Promise.resolve({ username: "alexrivera" }),
    });
    assert.equal(resVisitor.status, 200, "Step 5: Public endpoint must resolve revision");
    const visitorBody = await resVisitor.json();
    assert.equal(visitorBody.website.templateId, "community-template");
    assert.equal(visitorBody.website.templateVersion, "1.1.0");
    assert.equal(visitorBody.website.customization.accentColor, "#10b981");

    // 6. Visitor page renders the correct template and profile data: the
    // entrypoint document is delivered through the backend artifact delivery
    // boundary and then rendered with the DTO injected.
    const { renderPublicTemplateHtml } = require("../../portfolio/src/lib/template-renderer.js");
    const {
      resolveTemplateEntrypointHtml,
      setArtifactStorageAdapter,
    } = require("../../portfolio/src/lib/template-artifact-store.ts");

    setArtifactStorageAdapter(storage);
    try {
      const entrypoint = await resolveTemplateEntrypointHtml("community-template", "1.1.0");
      assert.equal(entrypoint.resolution.ok, true, entrypoint.resolution.error);
      assert.ok(entrypoint.html, "Step 6: The boundary must deliver the stored entrypoint");

      const renderedHtml = renderPublicTemplateHtml({
        dto: visitorBody.dto,
        website: visitorBody.website,
        entrypointHtml: entrypoint.html,
      });
      assert.ok(renderedHtml.includes("Community Template"), "Step 6: Rendered HTML must contain template artifact content");
      assert.ok(renderedHtml.includes('id="__ONEVUE_DTO__"'), "Step 6: Rendered HTML must contain injected DTO script");
      assert.ok(renderedHtml.includes("Alex"), "Step 6: Rendered HTML must contain profile data");
    } finally {
      setArtifactStorageAdapter(null);
    }

    // 7. Editing draft does not change existing published portfolio
    const reqEditDraft = createAuthRequest("http://localhost:3000/api/student/website/config", "PUT", token, {
      username: "alexrivera",
      selectedTemplateId: "community-template",
      selectedTemplateVersion: "1.1.0",
      customization: {
        accentColor: "#ff0000", // Changed draft accent color to red!
        themeMode: "light",
        visibleSections: ["about"],
      },
    });
    await configRoute.PUT(reqEditDraft);

    const resVisitorAfterDraftEdit = await publicProfileRoute.GET(reqVisitor, {
      params: Promise.resolve({ username: "alexrivera" }),
    });
    const visitorBodyAfterDraftEdit = await resVisitorAfterDraftEdit.json();
    assert.equal(visitorBodyAfterDraftEdit.website.customization.accentColor, "#10b981", "Step 7: Draft edits must not leak onto live site");

    // 8. Rollback restores historical revision and exact template version
    const reqRollback = createAuthRequest("http://localhost:3000/api/student/website/rollback", "POST", token, {
      revisionId: rev1Id,
    });
    const resRollback = await rollbackRoute.POST(reqRollback);
    assert.equal(resRollback.status, 200, "Step 8: Rollback must succeed");
    const rollbackBody = await resRollback.json();
    assert.equal(rollbackBody.activeRevision.templateId, "community-template");
    assert.equal(rollbackBody.activeRevision.templateVersion, "1.1.0");

    // 9. Built-in magicui-portfolio@1.0.0 continues to work
    const staticValidation = await validateEligibleTemplateSelection("magicui-portfolio", "1.0.0", "1.0.0");
    assert.equal(staticValidation.valid, true, "Step 9: Built-in template must continue to work");
  });
});
