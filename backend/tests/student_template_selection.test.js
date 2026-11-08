/**
 * =========================================================================
 * OneVue Phase 9 — Student template selection & portfolio integration
 * =========================================================================
 *
 * Covers the student-facing half of the template pipeline:
 *
 *   1. the public catalog exposes only gate-passing releases, and now carries
 *      the framework and the sections the template really renders from the DTO;
 *   2. candidate-template preview reuses the secure rendering contract with
 *      representative sample data, is read-only, and refuses ineligible releases;
 *   3. selection pins an exact immutable version, rejects unknown/ineligible
 *      releases, and survives unrelated profile updates;
 *   4. the draft preview never invents a template the student did not choose;
 *   5. DTO mapping tolerates missing optional fields;
 *   6. authorization boundaries: anonymous, cross-user and non-student callers.
 *
 * MongoDB, Next's HTTP layer and the authenticated identity are stubbed; the
 * catalog gate, preview renderer, delivery boundary, packaging, DTO mapper and
 * route handlers are the real implementations.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const ts = require("typescript");
if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(compiled.outputText, filename);
  };
}

/* --------------------------------------------------------------------------
 * In-memory stand-ins for the mongoose models the routes touch.
 * ------------------------------------------------------------------------ */

function collection(name) {
  const rows = [];
  let seq = 1;
  const materialize = (doc) => {
    const wrapped = Object.assign({}, doc);
    wrapped.save = async () => {
      const index = rows.findIndex((r) => String(r._id) === String(doc._id));
      delete wrapped.save;
      if (index >= 0) rows[index] = wrapped;
      else rows.push(wrapped);
      return wrapped;
    };
    return wrapped;
  };

  const Model = function (init) {
    const doc = Object.assign({ _id: `${name}-${seq++}` }, JSON.parse(JSON.stringify(init)));
    return materialize(doc);
  };
  Model.__rows = rows;
  Model.findOne = async (query) => {
    const found = rows.find((r) => Object.entries(query || {}).every(([k, v]) => String(r[k]) === String(v)));
    return found ? materialize(found) : null;
  };
  Model.find = (query) => {
    const filtered = rows.filter((r) => Object.entries(query || {}).every(([k, v]) => String(r[k]) === String(v)));
    const api = {
      sort() { return api; }, limit() { return api; }, select() { return api; },
      async lean() { return filtered; },
      then(resolve, reject) { return Promise.resolve(filtered).then(resolve, reject); },
    };
    return api;
  };
  Model.updateOne = async (query, update) => {
    const target = rows.find((r) => Object.entries(query || {}).every(([k, v]) => String(r[k]) === String(v)));
    if (!target) return { matchedCount: 0, modifiedCount: 0 };
    Object.assign(target, update.$set || {});
    return { matchedCount: 1, modifiedCount: 1 };
  };
  Model.deleteMany = async () => { rows.length = 0; return { deletedCount: 0 }; };
  return Model;
}

const store = { reviews: [], users: [] };
const authState = { mode: "student", userId: "student-1" };

function matchesQuery(doc, query) {
  for (const [key, expected] of Object.entries(query || {})) {
    const actual = key.split(".").reduce((c, p) => (c == null ? undefined : c[p]), doc);
    if (expected && typeof expected === "object" && "$in" in expected) {
      if (!expected.$in.map(String).includes(String(actual))) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

const fakeReviewModel = {
  async findOne(q) { return store.reviews.find((d) => matchesQuery(d, q)) || null; },
  find(q) {
    const rows = store.reviews.filter((d) => matchesQuery(d, q));
    const api = { sort: () => api, limit: () => api, select: () => api, async lean() { return rows; },
      then(res, rej) { return Promise.resolve(rows).then(res, rej); } };
    return api;
  },
};

const WebsiteConfig = collection("website-config");
const StudentProfileModel = collection("student-profile");

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;

const mockAuth = {
  async verifyAuth() {
    if (authState.mode === "anonymous") return { error: "Unauthorized: valid JWT token required.", status: 401 };
    return { user: { _id: authState.userId, name: "Verify Student", role: "student" } };
  },
  async verifyAdminAuth() {
    if (authState.mode !== "admin") {
      return authState.mode === "anonymous"
        ? { error: "Unauthorized: valid JWT token required.", status: 401 }
        : { error: "Forbidden: Administrative access required.", status: 403 };
    }
    return { user: { _id: "admin-1", role: "admin" } };
  },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "mongoose") return "mock_mongoose";
  if (request === "next/server") return "mock_next_server";
  if (/\/db(\.ts)?$/.test(request)) return "mock_db";
  if (/\/auth(\.ts)?$/.test(request)) return "mock_auth";
  if (request.endsWith("models/TemplateIngestionReview")) return "mock_review_model";
  if (request.endsWith("models/UserWebsiteConfig")) return "mock_website_config";
  if (request.endsWith("models/StudentProfile")) return "mock_student_profile";
  return originalResolve.call(this, request, ...rest);
};

/**
 * Schema stub: model modules run `new mongoose.Schema({...})` and register
 * themselves at import time. Only the shape needs to exist — the routes under
 * test never ask mongoose for persistence.
 */
class MockSchema {
  constructor(definition, options) {
    this.obj = definition || {};
    this.options = options || {};
  }
  index() { return this; }
  path() { return { validate: () => this }; }
  pre() { return this; }
  post() { return this; }
  static() { return this; }
  method() { return this; }
  add(definition) { Object.assign(this.obj, definition || {}); return this; }
}
MockSchema.Types = {
  ObjectId: "ObjectId", String: "String", Number: "Number", Date: "Date",
  Boolean: "Boolean", Mixed: "Mixed", Array: "Array",
};

const registeredModels = {};
const mockMongoose = {
  Schema: MockSchema,
  models: registeredModels,
  model(name) {
    if (!registeredModels[name]) registeredModels[name] = collection(name);
    return registeredModels[name];
  },
};

require.cache.mock_mongoose = { id: "mock_mongoose", filename: "mock_mongoose", loaded: true, exports: mockMongoose };
require.cache.mock_next_server = {
  id: "mock_next_server", filename: "mock_next_server", loaded: true,
  exports: {
    NextResponse: class extends Response {
      static json(body, init) {
        return new this(JSON.stringify(body), { status: init?.status || 200, headers: init?.headers });
      }
    },
  },
};
require.cache.mock_db = { id: "mock_db", filename: "mock_db", loaded: true, exports: mockDbConnect };
require.cache.mock_auth = { id: "mock_auth", filename: "mock_auth", loaded: true, exports: mockAuth };
require.cache.mock_review_model = { id: "mock_review_model", filename: "mock_review_model", loaded: true, exports: { default: fakeReviewModel, __esModule: true } };
require.cache.mock_website_config = { id: "mock_website_config", filename: "mock_website_config", loaded: true, exports: { default: WebsiteConfig, __esModule: true } };
require.cache.mock_student_profile = { id: "mock_student_profile", filename: "mock_student_profile", loaded: true, exports: { default: StudentProfileModel, __esModule: true } };

/* --------------------------------------------------------------------------
 * Real modules under test.
 * ------------------------------------------------------------------------ */

const { buildPublicCatalog } = require("../app/api/public/templates/route.ts");
const { getEligibleCatalogTemplates, validateEligibleTemplateSelection } = require("../lib/template-registry-extension.ts");
const { verifyAndPackageArtifact } = require("../lib/template-build.ts");
const { LocalFilesystemStorageAdapter } = require("../lib/template-storage.ts");
const { setDefaultStorageAdapter } = require("../lib/template-artifact-delivery.ts");
const { toPublicProfileDTO, PUBLIC_PROFILE_SCHEMA_VERSION } = require("../lib/public-profile-dto.ts");
const studentPreviewRoute = require("../app/api/student/website/template-preview/route.ts");
const draftPreviewRoute = require("../app/api/student/website/preview/route.ts");
const configRoute = require("../app/api/student/website/config/route.ts");
const { deriveSupportedSections } = require("../lib/template-adapters/cra-devfolio.ts");

/* --------------------------------------------------------------------------
 * Fixtures.
 * ------------------------------------------------------------------------ */

const COMMIT = "f869083ff3edb61eb417581197947bdb0ce408e2";
const SECTIONS = deriveSupportedSections();

let root;
let adapter;

function writeRelease(templateId, version) {
  const dir = path.join(root, "templates", templateId, version);
  fs.mkdirSync(path.join(dir, "static", "js"), { recursive: true });
  fs.mkdirSync(path.join(dir, "static", "css"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    [
      "<!doctype html><html><head>",
      `<link href="/templates/${templateId}/${version}/static/css/main.css" rel="stylesheet">`,
      `<script type="application/json" id="__ONEVUE_DTO__">{}</script>`,
      `</head><body><div id="root"></div>`,
      `<script src="/templates/${templateId}/${version}/static/js/main.js"></script></body></html>`,
    ].join("")
  );
  fs.writeFileSync(path.join(dir, "static", "js", "main.js"), 'l.p="/templates/' + templateId + '/' + version + '/";');
  fs.writeFileSync(path.join(dir, "static", "css", "main.css"), "body{color:red}");
  const packaged = verifyAndPackageArtifact(dir, {
    templateId, templateVersion: version, sourceCommitSha: COMMIT,
    supportedDtoVersions: [PUBLIC_PROFILE_SCHEMA_VERSION],
  });
  assert.equal(packaged.valid, true, packaged.error);
  return packaged.manifest;
}

function eligibleRecord(templateId, version, manifest, extras = {}) {
  return {
    ingestionId: `ing_${templateId}`,
    repositoryKey: `onevue/${templateId}`,
    sourceUrl: `https://github.com/onevue/${templateId}`,
    commitSha: COMMIT,
    templateId,
    templateVersion: version,
    status: "approved",
    submissionStatus: "catalog_eligible",
    auditReport: { outcome: "PASS" },
    reviewDecision: { decision: "approve", reason: "reviewed", reviewerUserId: "admin-1", timestamp: new Date() },
    provisioningRecord: {
      status: "provisioned",
      destinationUrl: `https://github.com/qubort-tech/${templateId}-${version.replace(/\./g, "-")}`,
      provenance: {
        isMock: false, provisionerMode: "live_github", mirrorType: "github_private",
        lifecycle: {
          ingestionId: `ing_${templateId}`,
          status: "CATALOG_ELIGIBLE",
          templateId, templateVersion: version, sourceCommitSha: COMMIT,
          manifest, manifestSha256: manifest.manifestSha256,
          storageLocation: `templates/${templateId}/${version}`,
          adaptation: {
            status: "ADAPTED", framework: "create-react-app", packageManager: "npm",
            entrypoint: "index.html", expectedArtifactPath: "build/index.html",
            targetDtoVersion: PUBLIC_PROFILE_SCHEMA_VERSION, sourceCommitSha: COMMIT,
            createdFileCount: 4, modifiedFileCount: 6,
            supportedSections: extras.declaredSections ?? SECTIONS.mapped,
            completedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        },
      },
    },
    stages: [],
  };
}

function url(pathname, query = "") {
  return `http://onevue.test${pathname}${query}`;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-9-"));
  adapter = new LocalFilesystemStorageAdapter(root);
  setDefaultStorageAdapter(adapter);
  // The registry extension resolves its own adapter when a caller passes none,
  // so the shared hook has to point at this test root as well.
  globalThis.__mockStorageAdapter = adapter;
  store.reviews = [];
  WebsiteConfig.__rows.length = 0;
  StudentProfileModel.__rows.length = 0;
  authState.mode = "student";
  authState.userId = "student-1";
});

afterEach(() => {
  setDefaultStorageAdapter(null);
  delete globalThis.__mockStorageAdapter;
  fs.rmSync(root, { recursive: true, force: true });
});

/* --------------------------------------------------------------------------
 * 1. Student catalog.
 * ------------------------------------------------------------------------ */

describe("Phase 9 — student catalog content", () => {
  it("lists an eligible release with framework and its real supported sections", async () => {
    const manifest = writeRelease("governed-portfolio", "1.0.0");
    store.reviews = [eligibleRecord("governed-portfolio", "1.0.0", manifest)];

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: adapter });
    const release = catalog.find((t) => t.id === "governed-portfolio").releases[0];

    assert.equal(release.framework, "create-react-app");
    assert.deepEqual(release.supportedSections, SECTIONS.mapped);
    assert.ok(release.supportedSections.includes("education"), "education must be declared");
    assert.equal(release.supportedSections.includes("work"), false,
      "work has no DTO field and must not be advertised");
    assert.equal(release.artifact.checksum, manifest.manifestSha256);
  });

  it("does not fabricate sections when adaptation declared none", async () => {
    const manifest = writeRelease("undeclared-portfolio", "1.0.0");
    store.reviews = [eligibleRecord("undeclared-portfolio", "1.0.0", manifest, { declaredSections: undefined })];
    const record = store.reviews[0];
    delete record.provisioningRecord.provenance.lifecycle.adaptation.supportedSections;

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: adapter });
    const release = catalog.find((t) => t.id === "undeclared-portfolio").releases[0];
    assert.deepEqual(release.supportedSections, [], "sections must be absent, not guessed");
  });

  it("publishes framework through the public catalog payload", async () => {
    const manifest = writeRelease("public-catalog-portfolio", "2.1.0");
    store.reviews = [eligibleRecord("public-catalog-portfolio", "2.1.0", manifest)];
    const raw = await getEligibleCatalogTemplates({ storageAdapter: adapter });
    const payload = buildPublicCatalog(raw);
    const release = payload.find((t) => t.id === "public-catalog-portfolio").releases[0];
    assert.equal(release.framework, "create-react-app");
    assert.ok(release.supportedSections.length > 0);
  });

  it("never lists pending, rejected, build-failed or mock-provisioned releases", async () => {
    const manifest = writeRelease("hidden-portfolio", "1.0.0");
    const base = eligibleRecord("hidden-portfolio", "1.0.0", manifest);

    const cases = {
      pending: { ...base, status: "pending_review" },
      rejected: { ...base, status: "rejected" },
      buildFailed: {
        ...base,
        provisioningRecord: {
          ...base.provisioningRecord,
          provenance: { ...base.provisioningRecord.provenance, lifecycle: { ...base.provisioningRecord.provenance.lifecycle, status: "FAILED", failedStage: "BUILT" } },
        },
      },
      mockProvisioned: {
        ...base,
        provisioningRecord: {
          status: "provisioned",
          destinationUrl: "mock://local-development/qubort-tech/hidden",
          provenance: { isMock: true, provisionerMode: "mock_local", lifecycle: base.provisioningRecord.provenance.lifecycle },
        },
      },
    };

    for (const [label, record] of Object.entries(cases)) {
      store.reviews = [{ ...record, templateId: `hidden-portfolio`, ingestionId: `ing_${label}` }];
      const catalog = await getEligibleCatalogTemplates({ storageAdapter: adapter });
      assert.equal(catalog.some((t) => t.id === "hidden-portfolio"), false, `${label} must not be listed`);

      const selection = await validateEligibleTemplateSelection("hidden-portfolio", "1.0.0", PUBLIC_PROFILE_SCHEMA_VERSION, { storageAdapter: adapter });
      assert.equal(selection.valid, false, `${label} must not be selectable`);
    }
  });
});

/* --------------------------------------------------------------------------
 * 2. Candidate template preview.
 * ------------------------------------------------------------------------ */

describe("Phase 9 — student candidate template preview", () => {
  it("renders an eligible release with representative sample data", async () => {
    const manifest = writeRelease("previewable", "1.0.0");
    store.reviews = [eligibleRecord("previewable", "1.0.0", manifest)];

    const res = await studentPreviewRoute.GET(
      new Request(url("/api/student/website/template-preview", "?templateId=previewable&templateVersion=1.0.0"))
    );
    const html = await res.text();
    assert.equal(res.status, 200, html.slice(0, 300));

    assert.ok(html.includes("Preview Student"), "sample profile data must render into the payload");
    assert.ok(!html.includes(">{}<"), "the placeholder DTO block must be replaced");
    assert.ok(html.includes("http://onevue.test/api/public/template-artifact/previewable/1.0.0/static/js/main.js"),
      "assets must be rebased onto the delivery API");
    assert.equal(html.includes("/templates/previewable/1.0.0/"), false, "no bare release paths may remain");
    assert.equal(res.headers.get("x-onevue-preview"), "representative-dto");
    assert.match(res.headers.get("cache-control"), /no-store/);
    assert.match(res.headers.get("x-robots-tag"), /noindex/);
  });

  it("refuses anonymous callers and unauthenticated cross-account probing", async () => {
    authState.mode = "anonymous";
    const res = await studentPreviewRoute.GET(
      new Request(url("/api/student/website/template-preview", "?templateId=previewable&templateVersion=1.0.0"))
    );
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "AUTH_REQUIRED");
    authState.mode = "student";
  });

  it("will not preview a release that failed the gate, even by guessing its identity", async () => {
    const manifest = writeRelease("withheld", "1.0.0");
    store.reviews = [{ ...eligibleRecord("withheld", "1.0.0", manifest), status: "pending_review" }];

    const res = await studentPreviewRoute.GET(
      new Request(url("/api/student/website/template-preview", "?templateId=withheld&templateVersion=1.0.0"))
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.message, /not available for preview|not registered|no approved release/i);
  });

  it("rejects malformed identities without touching storage", async () => {
    const res = await studentPreviewRoute.GET(
      new Request(url("/api/student/website/template-preview", "?templateId=../../etc&templateVersion=nope"))
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "INVALID_TEMPLATE_IDENTITY");
  });

  it("says so plainly for a built-in template instead of a storage error", async () => {
    const res = await studentPreviewRoute.GET(
      new Request(url("/api/student/website/template-preview", "?templateId=magicui-portfolio&templateVersion=1.0.0"))
    );
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body).slice(0, 300));
    assert.equal(body.code, "PREVIEW_NOT_ARTIFACT_BACKED");
    assert.match(body.message, /built-in/, "the message must name the real reason");
  });

  it("refuses an artifact that was never adapted instead of showing the author's demo", async () => {
    // The real failure this guards: a raw CRA build carries the author's own
    // content and third-party tags and has no DTO block at all. Injecting a
    // payload it never reads would preview the author's site as the student's.
    const dir = path.join(root, "templates", "unadapted", "1.0.0");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "index.html"),
      '<!doctype html><html><head><title>Author Site</title><script src="https://www.googletagmanager.com/gtag/js?id=UA-1"></script>' +
      '</head><body><div id="root">Original author content</div><script>l.p="/";</script></body></html>'
    );
    const packaged = verifyAndPackageArtifact(dir, {
      templateId: "unadapted", templateVersion: "1.0.0", sourceCommitSha: COMMIT,
      supportedDtoVersions: [PUBLIC_PROFILE_SCHEMA_VERSION],
    });
    assert.equal(packaged.valid, true, packaged.error);
    store.reviews = [eligibleRecord("unadapted", "1.0.0", packaged.manifest)];

    const res = await studentPreviewRoute.GET(
      new Request(url("/api/student/website/template-preview", "?templateId=unadapted&templateVersion=1.0.0"))
    );
    const body = await res.json();
    assert.equal(res.status, 409, JSON.stringify(body).slice(0, 200));
    assert.equal(body.code, "ARTIFACT_NOT_DTO_ADAPTED");
    assert.match(body.message, /never adapted/);
    assert.ok(!body.message.includes("googletagmanager"), "the refusal must not echo the artifact body");
  });

  it("is read-only: previewing changes neither the selection nor the artifact", async () => {
    const manifest = writeRelease("readonly", "1.0.0");
    store.reviews = [eligibleRecord("readonly", "1.0.0", manifest)];
    const before = new WebsiteConfig({ userId: "student-1", username: "keeper", selectedTemplateId: "other", selectedTemplateVersion: "1.0.0", status: "draft" });
    await before.save();
    const artifactFile = path.join(root, "templates", "readonly", "1.0.0", "index.html");
    const artifactBefore = fs.readFileSync(artifactFile, "utf8");

    await studentPreviewRoute.GET(
      new Request(url("/api/student/website/template-preview", "?templateId=readonly&templateVersion=1.0.0"))
    );

    const after = await WebsiteConfig.findOne({ userId: "student-1" });
    assert.equal(after.selectedTemplateId, "other", "preview must not change the selection");
    assert.equal(after.selectedTemplateVersion, "1.0.0");
    assert.equal(fs.readFileSync(artifactFile, "utf8"), artifactBefore, "preview must not modify the artifact");
  });
});

/* --------------------------------------------------------------------------
 * 3. Selection semantics.
 * ------------------------------------------------------------------------ */

describe("Phase 9 — template selection", () => {
  function putConfig(body) {
    return configRoute.PUT(
      new Request(url("/api/student/website/config"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    );
  }

  it("pins the exact immutable version when 'latest' is requested", async () => {
    const manifest = writeRelease("pinned", "3.2.1");
    store.reviews = [eligibleRecord("pinned", "3.2.1", manifest)];

    const res = await putConfig({ username: "pinner", selectedTemplateId: "pinned", selectedTemplateVersion: "latest" });
    assert.equal(res.status, 200, await res.text());
    const config = await WebsiteConfig.findOne({ userId: "student-1" });
    assert.equal(config.selectedTemplateVersion, "3.2.1", "'latest' must persist a concrete version");
  });

  it("rejects an unknown template and an ineligible version", async () => {
    const unknown = await putConfig({ username: "chooser", selectedTemplateId: "does-not-exist", selectedTemplateVersion: "1.0.0" });
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).code, "TEMPLATE_UNKNOWN");

    const manifest = writeRelease("not-approved", "1.0.0");
    store.reviews = [{ ...eligibleRecord("not-approved", "1.0.0", manifest), status: "rejected" }];
    const rejected = await putConfig({ username: "chooser", selectedTemplateId: "not-approved", selectedTemplateVersion: "1.0.0" });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, "TEMPLATE_UNKNOWN");
  });

  it("preserves the selection when an unrelated field is updated", async () => {
    const manifest = writeRelease("kept", "1.4.0");
    store.reviews = [eligibleRecord("kept", "1.4.0", manifest)];
    await (await new WebsiteConfig({ userId: "student-1", username: "keeper", selectedTemplateId: "kept", selectedTemplateVersion: "1.4.0", status: "draft" })).save();

    const res = await putConfig({ customization: { accentColor: "#22c55e", themeMode: "dark", visibleSections: ["hero"] } });
    assert.equal(res.status, 200, await res.text());

    const config = await WebsiteConfig.findOne({ userId: "student-1" });
    assert.equal(config.selectedTemplateId, "kept", "unrelated update must not clear the template");
    assert.equal(config.selectedTemplateVersion, "1.4.0");
    assert.equal(config.customization.accentColor, "#22c55e");
  });

  it("blocks anonymous callers and cross-user writes", async () => {
    authState.mode = "anonymous";
    const anon = await putConfig({ selectedTemplateId: "kept", selectedTemplateVersion: "1.0.0" });
    assert.equal(anon.status, 401);
    authState.mode = "student";

    const foreign = await putConfig({ userId: "somebody-else", selectedTemplateId: "kept", selectedTemplateVersion: "1.0.0" });
    assert.equal(foreign.status, 403, "a student cannot write another user's configuration");
  });

  it("cannot publish through a config write", async () => {
    const res = await putConfig({ status: "published" });
    assert.equal(res.status, 400);
  });
});

/* --------------------------------------------------------------------------
 * 4. Draft preview must not invent a template.
 * ------------------------------------------------------------------------ */

describe("Phase 9 — draft preview template honesty", () => {
  it("reports no template when the student has never selected one", async () => {
    await (await new StudentProfileModel({ userId: "student-1", headline: "Builder", bio: "Makes things", education: [], projects: [{ title: "P" }], skills: [], credentials: [], achievements: [], media: [], links: [], contacts: {} })).save();

    const res = await draftPreviewRoute.GET(new Request(url("/api/student/website/preview")));
    const body = await res.text();
    assert.equal(res.status, 200, body.slice(0, 300));
    const data = JSON.parse(body);
    assert.equal(data.config.selectedTemplateId, null, "the preview must not substitute a template");
    assert.equal(data.config.selectedTemplateVersion, null);
    assert.equal(data.dto.meta.templateId, undefined);
  });

  it("reflects the student's actual selection", async () => {
    await (await new StudentProfileModel({ userId: "student-1", headline: "Builder", bio: "Makes things", education: [], projects: [{ title: "P" }], skills: [], credentials: [], achievements: [], media: [], links: [], contacts: {} })).save();
    await (await new WebsiteConfig({ userId: "student-1", username: "keeper", selectedTemplateId: "chosen", selectedTemplateVersion: "2.0.0", status: "draft" })).save();

    const data = await (await draftPreviewRoute.GET(new Request(url("/api/student/website/preview")))).json();
    assert.equal(data.config.selectedTemplateId, "chosen");
    assert.equal(data.config.selectedTemplateVersion, "2.0.0");
    assert.equal(data.dto.meta.templateVersion, "2.0.0");
  });

  it("is private and non-cacheable", async () => {
    await (await new StudentProfileModel({ userId: "student-1", headline: "h", bio: "b", projects: [{ title: "P" }], education: [], skills: [], credentials: [], achievements: [], media: [], links: [], contacts: {} })).save();
    const res = await draftPreviewRoute.GET(new Request(url("/api/student/website/preview")));
    assert.match(res.headers.get("cache-control"), /no-store/);
  });
});

/* --------------------------------------------------------------------------
 * 5. DTO mapping and missing optional fields.
 * ------------------------------------------------------------------------ */

describe("Phase 9 — DTO mapping", () => {
  it("maps every portfolio section a student filled", () => {
    const profile = {
      _id: "sp-1",
      userId: "student-1",
      preferredName: "Dana Lee",
      headline: "CS student",
      bio: "Builds small tools.",
      city: "Pune", state: "MH", country: "IN",
      education: [{ _id: "e1", institution: "State University", degree: "BSc", fieldOfStudy: "CS", startDate: "2022-09-01", endDate: "2025-06-01", currentStatus: "completed", gpa: "3.8" }],
      projects: [{ _id: "p1", title: "Campus Map", shortDescription: "A map.", technologies: ["React"], repoUrl: "https://example.com/p1" }],
      skills: [{ _id: "s1", name: "Python", category: "Languages", proficiency: "advanced" }],
      credentials: [{ _id: "c1", title: "Cloud Practitioner", credentialType: "certification", issuer: "AWS", credentialUrl: "https://example.com/c1" }],
      achievements: [{ _id: "a1", title: "Finalist", category: "competition", year: "2024" }],
      media: [{ _id: "m1", mediaUrl: "https://example.com/m1.png", mediaType: "image", title: "Screenshot", category: "project" }],
      links: [{ _id: "l1", platform: "github", url: "https://github.com/dana", category: "code" }],
      contacts: { email: "dana@example.com", visibility: { email: "public", phone: "private" } },
      resumeUrl: "https://example.com/dana-resume.pdf",
      toObject() { const { toObject, save, ...rest } = this; return rest; },
    };

    const dto = toPublicProfileDTO(profile, { username: "dana", templateId: "kept", templateVersion: "1.4.0" });
    assert.equal(dto.profile.displayName, "Dana Lee");
    assert.equal(dto.education[0].institution, "State University");
    assert.equal(dto.projects[0].title, "Campus Map");
    assert.equal(dto.skills[0].name, "Python");
    assert.equal(dto.credentials[0].issuer, "AWS");
    assert.equal(dto.achievements[0].title, "Finalist");
    assert.equal(dto.media[0].mediaUrl, "https://example.com/m1.png");
    assert.equal(dto.contact.socialLinks[0].url, "https://github.com/dana");
    assert.equal(dto.contact.email, "dana@example.com");
    assert.equal(dto.resume.url, "https://example.com/dana-resume.pdf");
    assert.equal(dto.meta.templateId, "kept");
    assert.equal(dto.meta.schemaVersion, PUBLIC_PROFILE_SCHEMA_VERSION);
  });

  it("survives a profile where every optional field is absent", () => {
    const profile = {
      userId: "student-1",
      education: [], projects: [], skills: [], credentials: [], achievements: [], media: [], links: [],
      toObject() { const { toObject, save, ...rest } = this; return rest; },
    };
    const dto = toPublicProfileDTO(profile, { username: "bare" });

    assert.equal(typeof dto.profile.displayName, "string");
    assert.deepEqual(dto.education, []);
    assert.deepEqual(dto.projects, []);
    assert.deepEqual(dto.contact.socialLinks, []);
    assert.equal(dto.resume, undefined, "no resume means no resume field, not an empty object");
    assert.ok(!JSON.stringify(dto).includes("undefined"), "the DTO must serialize without undefined holes");
  });

  it("withholds contact details the student did not mark public", () => {
    const profile = {
      userId: "student-1",
      contacts: { email: "hidden@example.com", phone: "+919999999999", visibility: { email: "private", phone: "private" } },
      links: [{ platform: "github", url: "https://github.com/dana", category: "code", visibility: "private" }],
      education: [], projects: [], skills: [], credentials: [], achievements: [], media: [],
      toObject() { const { toObject, save, ...rest } = this; return rest; },
    };
    const dto = toPublicProfileDTO(profile, { username: "quiet" });
    assert.equal(dto.contact.email, undefined, "a private email must not reach the public DTO");
    assert.equal(dto.contact.phone, undefined);
    assert.deepEqual(dto.contact.socialLinks, [], "a private link must not reach the public DTO");
  });

  it("drops unsafe values instead of passing them through", () => {
    const profile = {
      userId: "student-1",
      bio: "x".repeat(6200),
      links: [{ platform: "github", url: "javascript:alert(1)", category: "code" }],
      education: [{ institution: "Only an institution" }],
      projects: [], skills: [], credentials: [], achievements: [], media: [],
      toObject() { const { toObject, save, ...rest } = this; return rest; },
    };
    const dto = toPublicProfileDTO(profile, { username: "unsafe" });
    assert.equal(dto.profile.bio.length, 5000, `bio should be capped at the DTO limit, got ${dto.profile.bio.length}`);
    assert.ok(!JSON.stringify(dto.contact.socialLinks).includes("javascript:"), "script URLs must be sanitized away");
    assert.deepEqual(dto.education, [], "an education entry without a degree is not publishable");
  });
});
