/**
 * =========================================================================
 * OneVue Phase 8 — Catalog governance, admin preview and admin evidence
 * =========================================================================
 *
 * Regression coverage for the finding that a release with
 * `submissionStatus=build_failed`, mock provisioning provenance and an
 * unadapted artifact reached the student catalog.
 *
 * Layer under test: the real `evaluateCatalogEligibility` gate, the real
 * `getEligibleCatalogTemplates` / `validateEligibleTemplateSelection`
 * resolution, the real artifact delivery boundary behind the real admin
 * preview handler, and the real admin submissions handler. Only MongoDB,
 * Next's HTTP layer and the authenticated identity are stubbed.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
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
 * Stubs: database, Next response, and the authenticated caller.
 * ------------------------------------------------------------------------ */

const store = { reviews: [], users: [] };
const authState = { mode: "admin" }; // "admin" | "student" | "anonymous"

function matchesQuery(doc, query) {
  for (const [key, expected] of Object.entries(query || {})) {
    if (key === "$ne") continue;
    const actual = key.split(".").reduce((current, part) => (current == null ? undefined : current[part]), doc);
    if (expected && typeof expected === "object" && "$ne" in expected) {
      if (actual === expected.$ne) return false;
      continue;
    }
    if (expected && typeof expected === "object" && "$in" in expected) {
      if (!expected.$in.map(String).includes(String(actual))) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function chainable(rows) {
  const api = {
    sort() { return api; },
    limit() { return api; },
    select() { return api; },
    async lean() { return rows; },
    then(resolve, reject) { return Promise.resolve(rows).then(resolve, reject); },
  };
  return api;
}

/** Mongoose query stand-in: awaitable, and `.lean()` returns the row. */
function queryable(row) {
  if (row === null || row === undefined) return null;
  const api = {
    sort() { return api; },
    limit() { return api; },
    select() { return api; },
    lean() { return Promise.resolve(row); },
    then(resolve, reject) { return Promise.resolve(row).then(resolve, reject); },
  };
  return api;
}

const fakeReviewModel = {
  findOne(query) { return queryable(store.reviews.find((d) => matchesQuery(d, query)) || null); },
  find(query) { return chainable(store.reviews.filter((d) => matchesQuery(d, query))); },
};
const fakeUserModel = {
  findOne(query) { return queryable(store.users.find((u) => matchesQuery(u, query)) || null); },
  find(query) { return chainable(store.users.filter((u) => matchesQuery(u, query))); },
};

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;

const mockAuth = {
  async verifyAdminAuth() {
    if (authState.mode === "anonymous") return { error: "Unauthorized: valid JWT token required.", status: 401 };
    if (authState.mode === "student") return { error: "Forbidden: Administrative access required.", status: 403 };
    return { user: { _id: "admin-user-1", role: "admin", email: "admin@onevue.test", name: "Test Admin" } };
  },
  async verifyAuth() {
    if (authState.mode === "anonymous") return { error: "Unauthorized: valid JWT token required.", status: 401 };
    return { user: { _id: "user-1", role: authState.mode } };
  },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "mongoose") return "mock_mongoose";
  if (request === "next/server") return "mock_next_server";
  if (/\/db(\.ts)?$/.test(request)) return "mock_db";
  if (/\/auth(\.ts)?$/.test(request)) return "mock_auth";
  if (request.endsWith("models/TemplateIngestionReview") || request.endsWith("models/TemplateIngestionReview.ts")) {
    return "mock_review_model";
  }
  if (request.endsWith("models/User") || request.endsWith("models/User.ts")) return "mock_user_model";
  return originalResolve.call(this, request, ...rest);
};

require.cache.mock_mongoose = { id: "mock_mongoose", filename: "mock_mongoose", loaded: true, exports: {} };
require.cache.mock_next_server = {
  id: "mock_next_server",
  filename: "mock_next_server",
  loaded: true,
  exports: {
    // Real route handlers use both `NextResponse.json(...)` and
    // `new NextResponse(body, { headers })`, so the stub must support both.
    NextResponse: class MockNextResponse extends Response {
      static json(body, init) {
        return new MockNextResponse(JSON.stringify(body), {
          status: init?.status || 200,
          headers: init?.headers,
        });
      }
    },
  },
};
require.cache.mock_db = { id: "mock_db", filename: "mock_db", loaded: true, exports: mockDbConnect };
require.cache.mock_auth = { id: "mock_auth", filename: "mock_auth", loaded: true, exports: mockAuth };
require.cache.mock_review_model = {
  id: "mock_review_model", filename: "mock_review_model", loaded: true,
  exports: { default: fakeReviewModel, __esModule: true },
};
require.cache.mock_user_model = {
  id: "mock_user_model", filename: "mock_user_model", loaded: true,
  exports: { default: fakeUserModel, __esModule: true },
};

/* --------------------------------------------------------------------------
 * Modules under test.
 * ------------------------------------------------------------------------ */

const {
  evaluateCatalogEligibility,
  describeCatalogEligibility,
  getEligibleCatalogTemplates,
  validateEligibleTemplateSelection,
} = require("../lib/template-registry-extension.ts");
const { verifyAndPackageArtifact } = require("../lib/template-build.ts");
const { LocalFilesystemStorageAdapter } = require("../lib/template-storage.ts");
const { setDefaultStorageAdapter } = require("../lib/template-artifact-delivery.ts");
const previewRoute = require("../app/api/admin/templates/preview/route.ts");
const submissionsRoute = require("../app/api/admin/templates/submissions/route.ts");
const { PUBLIC_PROFILE_SCHEMA_VERSION } = require("../lib/public-profile-dto.ts");

/* --------------------------------------------------------------------------
 * Fixture builders.
 * ------------------------------------------------------------------------ */

const COMMIT = "f869083ff3edb61eb417581197947bdb0ce408e2";

function goodLifecycle(overrides = {}) {
  return {
    status: "CATALOG_ELIGIBLE",
    templateId: "governed-template",
    templateVersion: "1.0.0",
    sourceCommitSha: COMMIT,
    manifestSha256: "a".repeat(64),
    storageLocation: "templates/governed-template/1.0.0",
    adaptation: {
      status: "ADAPTED",
      framework: "create-react-app",
      packageManager: "npm",
      entrypoint: "index.html",
      expectedArtifactPath: "build/index.html",
      targetDtoVersion: PUBLIC_PROFILE_SCHEMA_VERSION,
      sourceCommitSha: COMMIT,
      createdFileCount: 4,
      modifiedFileCount: 7,
      completedAt: "2026-11-05T00:00:00.000Z",
    },
    updatedAt: "2026-11-05T00:00:00.000Z",
    ...overrides,
  };
}

/** The exact shape of the record that was previously student-visible. */
function badRecord() {
  return {
    ingestionId: "ing_real_bad",
    repositoryKey: "crypticani/portfolio",
    sourceUrl: "https://github.com/crypticani/portfolio",
    commitSha: COMMIT,
    templateId: "portfolio",
    templateVersion: "1.0.0",
    status: "approved",
    submissionStatus: "build_failed",
    auditReport: { outcome: "REVIEW_REQUIRED" },
    reviewDecision: { decision: "approve", reason: "licensing justification", reviewerUserId: "admin-user-1" },
    provisioningRecord: {
      status: "provisioned",
      destinationUrl: "mock://local-development/qubort-tech/portfolio-1-0-0",
      provenance: { isMock: true, provisionerMode: "mock_local", sourceCommitSha: COMMIT },
    },
  };
}

function fullyValidRecord(overrides = {}) {
  return {
    ingestionId: "ing_valid",
    repositoryKey: "onevue/governed-template",
    sourceUrl: "https://github.com/onevue/governed-template",
    commitSha: COMMIT,
    templateId: "governed-template",
    templateVersion: "1.0.0",
    status: "approved",
    submissionStatus: "catalog_eligible",
    auditReport: { outcome: "PASS" },
    reviewDecision: {
      decision: "approve",
      reason: "Reviewed license and code safety.",
      reviewerUserId: "admin-user-1",
      timestamp: "2026-11-05T01:02:03.000Z",
    },
    provisioningRecord: {
      status: "provisioned",
      destinationUrl: "https://github.com/qubort-tech/governed-template-1-0-0",
      provenance: { isMock: false, provisionerMode: "live_github", sourceCommitSha: COMMIT, lifecycle: goodLifecycle() },
    },
    ...overrides,
  };
}

function validationFor(manifest, success = true) {
  return { success, manifest, storageLocation: "templates/x/1.0.0", error: success ? undefined : "integrity failed" };
}

function manifestOf(overrides = {}) {
  return {
    templateId: "governed-template",
    templateVersion: "1.0.0",
    sourceCommitSha: COMMIT,
    supportedDtoVersions: [PUBLIC_PROFILE_SCHEMA_VERSION],
    entrypoint: "index.html",
    totalFiles: 2,
    totalBytes: 2048,
    manifestSha256: "a".repeat(64),
    files: [{ relativePath: "index.html", sizeBytes: 1024, sha256: "b".repeat(64) }],
    ...overrides,
  };
}

const codes = (eligibility) => eligibility.blockers.map((b) => b.code);

/* --------------------------------------------------------------------------
 * 1. The gate itself.
 * ------------------------------------------------------------------------ */

describe("Phase 8 — catalog eligibility gate fails closed", () => {
  it("hides the real build-failed, mock-provisioned, unadapted record", () => {
    const result = evaluateCatalogEligibility(badRecord(), validationFor(manifestOf({ templateId: "portfolio" })));
    assert.equal(result.eligible, false);
    const found = codes(result);
    assert.ok(found.includes("PROVISIONING_MODE_MOCK"), "mock provisioning must be a blocker");
    assert.ok(found.includes("LIFECYCLE_EVIDENCE_MISSING"), "absent lifecycle evidence must be a blocker");
    assert.ok(found.includes("ADAPTATION_EVIDENCE_MISSING"), "an unadapted artifact must be a blocker");
  });

  it("treats a valid checksum alone as insufficient", () => {
    const record = fullyValidRecord();
    delete record.provisioningRecord.provenance.lifecycle.adaptation;
    const result = evaluateCatalogEligibility(record, validationFor(manifestOf()));
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("ADAPTATION_EVIDENCE_MISSING"));
  });

  it("accepts a release with every condition satisfied", () => {
    const result = evaluateCatalogEligibility(fullyValidRecord(), validationFor(manifestOf()));
    assert.deepEqual(result.blockers, []);
    assert.equal(result.eligible, true);
  });

  it("blocks a build that never reached CATALOG_ELIGIBLE", () => {
    const record = fullyValidRecord();
    record.provisioningRecord.provenance.lifecycle = goodLifecycle({
      status: "FAILED",
      failedStage: "BUILT",
      error: "Isolated build exited with code 1",
    });
    const result = evaluateCatalogEligibility(record, validationFor(manifestOf()));
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("LIFECYCLE_NOT_COMPLETED"));
  });

  it("blocks mock provisioning even when the lifecycle claims success", () => {
    const record = fullyValidRecord();
    record.provisioningRecord.provenance = {
      isMock: true,
      provisionerMode: "mock_local",
      lifecycle: goodLifecycle(),
    };
    record.provisioningRecord.destinationUrl = "mock://local-development/qubort-tech/x";
    const result = evaluateCatalogEligibility(record, validationFor(manifestOf()));
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("PROVISIONING_MODE_MOCK"));
  });

  it("blocks provisioning whose destination establishes nothing", () => {
    const record = fullyValidRecord();
    record.provisioningRecord.provenance.provisionerMode = undefined;
    record.provisioningRecord.provenance.mirrorType = undefined;
    record.provisioningRecord.destinationUrl = "";
    const result = evaluateCatalogEligibility(record, validationFor(manifestOf()));
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("PROVISIONING_MODE_MOCK"));
  });

  it("accepts a GitHub destination even when the mode field itself is absent", () => {
    const record = fullyValidRecord();
    record.provisioningRecord.provenance.provisionerMode = undefined;
    const result = evaluateCatalogEligibility(record, validationFor(manifestOf()));
    assert.equal(result.eligible, true, JSON.stringify(result.blockers));
  });

  it("treats an isMock flag alone as decisive even with a github-looking URL", () => {
    const record = fullyValidRecord();
    record.provisioningRecord.provenance.isMock = true;
    const result = evaluateCatalogEligibility(record, validationFor(manifestOf()));
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("PROVISIONING_MODE_MOCK"));
  });

  it("blocks a stale manifest whose checksum differs from the lifecycle record", () => {
    const result = evaluateCatalogEligibility(
      fullyValidRecord(),
      validationFor(manifestOf({ manifestSha256: "c".repeat(64) }))
    );
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("MANIFEST_CHECKSUM_MISMATCH"));
  });

  it("blocks an artifact pinned to a different commit than the ingestion", () => {
    const result = evaluateCatalogEligibility(
      fullyValidRecord(),
      validationFor(manifestOf({ sourceCommitSha: "0".repeat(40) }))
    );
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("ARTIFACT_COMMIT_MISMATCH"));
  });

  it("blocks an artifact stored for a different identity", () => {
    const result = evaluateCatalogEligibility(
      fullyValidRecord(),
      validationFor(manifestOf({ templateId: "someone-else" }))
    );
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("ARTIFACT_IDENTITY_MISMATCH"));
  });

  it("blocks an empty or entrypoint-less manifest", () => {
    const result = evaluateCatalogEligibility(
      fullyValidRecord(),
      validationFor(manifestOf({ totalFiles: 0, files: [], entrypoint: "" }))
    );
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("ARTIFACT_EMPTY"));
  });

  it("blocks an unsupported DTO version", () => {
    const result = evaluateCatalogEligibility(
      fullyValidRecord(),
      validationFor(manifestOf({ supportedDtoVersions: ["0.9.0"] }))
    );
    assert.equal(result.eligible, false);
    assert.ok(codes(result).includes("DTO_VERSION_UNSUPPORTED"));
  });

  it("blocks a missing human approval and an unattributed approver", () => {
    const notApproved = evaluateCatalogEligibility(
      { ...fullyValidRecord(), status: "pending_review", reviewDecision: undefined },
      validationFor(manifestOf())
    );
    assert.ok(codes(notApproved).includes("REVIEW_NOT_APPROVED"));
    assert.ok(codes(notApproved).includes("REVIEWER_IDENTITY_MISSING"));

    const noReviewer = evaluateCatalogEligibility(
      { ...fullyValidRecord(), reviewDecision: { decision: "approve", reason: "ok" } },
      validationFor(manifestOf())
    );
    assert.ok(codes(noReviewer).includes("REVIEWER_IDENTITY_MISSING"));
  });

  it("blocks REVIEW_REQUIRED without a recorded justification, and an audit REJECT absolutely", () => {
    const noReason = evaluateCatalogEligibility(
      { ...fullyValidRecord(), auditReport: { outcome: "REVIEW_REQUIRED" }, reviewDecision: { decision: "approve", reason: "", reviewerUserId: "a" } },
      validationFor(manifestOf())
    );
    assert.ok(codes(noReason).includes("REVIEW_OVERRIDE_REASON_MISSING"));

    const auditedReject = evaluateCatalogEligibility(
      { ...fullyValidRecord(), auditReport: { outcome: "REJECT" } },
      validationFor(manifestOf())
    );
    assert.ok(codes(auditedReject).includes("AUDIT_REJECTED"));

    const noAudit = evaluateCatalogEligibility(
      { ...fullyValidRecord(), auditReport: undefined },
      validationFor(manifestOf())
    );
    assert.ok(codes(noAudit).includes("AUDIT_OUTCOME_MISSING"));
  });

  it("blocks when storage integrity fails or the manifest is unreadable", () => {
    const failed = evaluateCatalogEligibility(fullyValidRecord(), { success: false, error: "manifest missing" });
    assert.ok(codes(failed).includes("ARTIFACT_MANIFEST_MISSING"));
    assert.ok(codes(failed).includes("ARTIFACT_INTEGRITY_FAILED"));

    const missing = evaluateCatalogEligibility(fullyValidRecord(), undefined);
    assert.ok(codes(missing).includes("ARTIFACT_MANIFEST_MISSING"));
  });

  it("blocks an adaptation that recorded an unknown framework", () => {
    const record = fullyValidRecord();
    record.provisioningRecord.provenance.lifecycle.adaptation.framework = "unknown";
    const result = evaluateCatalogEligibility(record, validationFor(manifestOf()));
    assert.ok(codes(result).includes("ADAPTATION_EVIDENCE_MISSING"));
  });
});

/* --------------------------------------------------------------------------
 * 2. Catalog resolution and student selection.
 * ------------------------------------------------------------------------ */

describe("Phase 8 — student catalog and selection", () => {
  let root;
  let adapter;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-governance-"));
    // A real artifact on disk, packaged by the real packaging code.
    const artifactDir = path.join(root, "templates", "governed-template", "1.0.0");
    fs.mkdirSync(path.join(artifactDir, "static", "js"), { recursive: true });
    fs.mkdirSync(path.join(artifactDir, "static", "css"), { recursive: true });
    fs.writeFileSync(path.join(artifactDir, "index.html"), "<html><head></head><body><div id=root></div></body></html>");
    fs.writeFileSync(path.join(artifactDir, "static", "js", "main.js"), "console.log(1)");
    const packaged = verifyAndPackageArtifact(artifactDir, {
      templateId: "governed-template",
      templateVersion: "1.0.0",
      sourceCommitSha: COMMIT,
      supportedDtoVersions: [PUBLIC_PROFILE_SCHEMA_VERSION],
    });
    assert.equal(packaged.valid, true, packaged.error);
    adapter = new LocalFilesystemStorageAdapter(root);
    store.reviews = [];
  });

  afterEach(() => {
    setDefaultStorageAdapter(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function realManifest() {
    const file = path.join(root, "templates", "governed-template", "1.0.0", "onevue-manifest.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  it("exposes a fully evidenced approved release and keeps it selectable", async () => {
    const manifest = realManifest();
    store.reviews = [fullyValidRecord({
      provisioningRecord: {
        status: "provisioned",
        destinationUrl: "https://github.com/qubort-tech/governed-template-1-0-0",
        provenance: {
          isMock: false,
          provisionerMode: "live_github",
          lifecycle: goodLifecycle({ manifestSha256: manifest.manifestSha256, manifest }),
        },
      },
    })];

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: adapter });
    assert.ok(catalog.some((t) => t.id === "governed-template"), "valid release must be catalogued");

    const selection = await validateEligibleTemplateSelection(
      "governed-template", "1.0.0", PUBLIC_PROFILE_SCHEMA_VERSION, { storageAdapter: adapter }
    );
    assert.equal(selection.valid, true, selection.error);
    assert.equal(selection.resolvedVersion, "1.0.0");
  });

  it("never lists a build-failed, mock-provisioned record even when approved", async () => {
    store.reviews = [badRecord()];
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: adapter });
    assert.equal(catalog.some((t) => t.id === "portfolio"), false, "the bad record reached the student catalog");

    const selection = await validateEligibleTemplateSelection(
      "portfolio", "1.0.0", PUBLIC_PROFILE_SCHEMA_VERSION, { storageAdapter: adapter }
    );
    assert.equal(selection.valid, false);
    assert.equal(selection.code, "TEMPLATE_UNKNOWN");
  });

  it("keeps built-in static templates available while withholding dynamic ones", async () => {
    store.reviews = [badRecord()];
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: adapter });
    assert.ok(catalog.some((t) => t.id === "magicui-portfolio"), "static catalog must be unaffected");
  });

  it("reports the gate's own reasons through describeCatalogEligibility", async () => {
    store.reviews = [badRecord()];
    const report = await describeCatalogEligibility(badRecord(), { storageAdapter: adapter });
    assert.equal(report.eligible, false);
    assert.ok(codes(report).length >= 3, "expected several independent blockers");
    assert.ok(codes(report).includes("PROVISIONING_MODE_MOCK"));
  });
});

/* --------------------------------------------------------------------------
 * 3. Admin preview handler.
 * ------------------------------------------------------------------------ */

describe("Phase 8 — administrator preview", () => {
  let root;
  let adapter;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-preview-"));
    const artifactDir = path.join(root, "templates", "governed-template", "1.0.0");
    fs.mkdirSync(path.join(artifactDir, "static", "js"), { recursive: true });
    fs.mkdirSync(path.join(artifactDir, "static", "css"), { recursive: true });
    // An adapted entrypoint: release-prefixed asset URLs and a DTO block.
    fs.writeFileSync(
      path.join(artifactDir, "index.html"),
      [
        "<!doctype html><html><head>",
        '<link href="/templates/governed-template/1.0.0/static/css/main.css" rel="stylesheet">',
        '<script type="application/json" id="__ONEVUE_DTO__">{}</script>',
        "</head><body><div id=root></div>",
        '<script src="/templates/governed-template/1.0.0/static/js/main.js"></script>',
        "</body></html>",
      ].join("")
    );
    fs.writeFileSync(path.join(artifactDir, "static", "js", "main.js"), 'l.p="/templates/governed-template/1.0.0/";');
    fs.writeFileSync(path.join(artifactDir, "static", "css", "main.css"), "body{color:red}");
    const packaged = verifyAndPackageArtifact(artifactDir, {
      templateId: "governed-template",
      templateVersion: "1.0.0",
      sourceCommitSha: COMMIT,
      supportedDtoVersions: [PUBLIC_PROFILE_SCHEMA_VERSION],
    });
    assert.equal(packaged.valid, true, packaged.error);
    adapter = new LocalFilesystemStorageAdapter(root);
    setDefaultStorageAdapter(adapter);
    authState.mode = "admin";
  });

  afterEach(() => {
    setDefaultStorageAdapter(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function request(query = "templateId=governed-template&templateVersion=1.0.0") {
    return new Request(`http://onevue.test/api/admin/templates/preview?${query}`, {
      headers: { origin: "http://onevue.test" },
    });
  }

  it("renders the artifact with a representative DTO and rebased assets", async () => {
    const response = await previewRoute.GET(request());
    assert.equal(response.status, 200, await response.clone().text());
    const html = await response.text();

    assert.match(html, /id="__ONEVUE_DTO__"/);
    assert.ok(html.includes("Preview Student"), "representative profile data must be injected");
    assert.ok(!html.includes(">{}<"), "the empty placeholder block must be replaced");

    // Every release-prefixed URL, including the webpack publicPath literal,
    // must resolve through the delivery API on this origin.
    assert.ok(html.includes("http://onevue.test/api/public/template-artifact/governed-template/1.0.0/static/css/main.css"));
    assert.ok(html.includes("http://onevue.test/api/public/template-artifact/governed-template/1.0.0/static/js/main.js"));
    assert.equal(html.includes('l.p="/templates/governed-template/1.0.0/"'), false, "publicPath was not rebased");
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    assert.equal(response.headers.get("x-onevue-preview"), "representative-dto");
  });

  it("exposes no credentials or host filesystem paths", async () => {
    const html = await (await previewRoute.GET(request())).text();
    assert.equal(html.includes(root), false, "the storage root leaked into the preview");
    assert.equal(html.includes(os.tmpdir()), false, "a temp filesystem path leaked into the preview");
    assert.equal(/Bearer |password|token/i.test(html), false, "a credential-looking string appeared in the preview");
  });

  it("refuses anonymous and student callers", async () => {
    authState.mode = "anonymous";
    const anon = await previewRoute.GET(request());
    assert.equal(anon.status, 401);

    authState.mode = "student";
    const student = await previewRoute.GET(request());
    assert.equal(student.status, 403);
    assert.match((await student.json()).message, /Administrative access/);

    authState.mode = "admin";
    assert.equal((await previewRoute.GET(request())).status, 200);
  });

  it("fails closed on an unknown identity or a missing release", async () => {
    const bad = await previewRoute.GET(request("templateId=..%2Fetc&templateVersion=nope"));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, "INVALID_TEMPLATE_IDENTITY");

    const missing = await previewRoute.GET(request("templateId=not-stored&templateVersion=1.0.0"));
    assert.ok([404, 503].includes(missing.status), `unexpected status ${missing.status}`);
  });

  it("does not write: the artifact bytes are unchanged after previewing", async () => {
    const file = path.join(root, "templates", "governed-template", "1.0.0", "index.html");
    const before = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    await previewRoute.GET(request());
    const after = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(after, before);
  });
});

/* --------------------------------------------------------------------------
 * 4. Admin evidence surface.
 * ------------------------------------------------------------------------ */

describe("Phase 8 — admin submissions evidence", () => {
  beforeEach(() => {
    store.reviews = [];
    store.users = [{ _id: "admin-user-1", name: "Test Admin", email: "admin@onevue.test", role: "admin" }];
    authState.mode = "admin";
  });

  function getSubmission(ingestionId) {
    return submissionsRoute.GET(
      new Request(`http://onevue.test/api/admin/templates/submissions?ingestionId=${ingestionId}`, {
        headers: { origin: "http://onevue.test" },
      })
    );
  }

  it("exposes framework, manifest checksum, file count, size and reviewer identity", async () => {
    const manifest = manifestOf();
    const record = fullyValidRecord({
      provisioningRecord: {
        status: "provisioned",
        destinationUrl: "https://github.com/qubort-tech/governed-template-1-0-0",
        provenance: { isMock: false, provisionerMode: "live_github", lifecycle: goodLifecycle({ manifest }) },
      },
    });
    store.reviews = [record];

    const response = await getSubmission("ing_valid");
    assert.equal(response.status, 200, await response.clone().text());
    const submission = (await response.json()).submission;

    assert.equal(submission.framework, "create-react-app");
    assert.equal(submission.artifact.manifestSha256, "a".repeat(64));
    assert.equal(submission.artifact.totalFiles, 2);
    assert.equal(submission.artifact.totalBytes, 2048);
    assert.equal(submission.artifact.entrypoint, "index.html");
    assert.deepEqual(submission.artifact.supportedDtoVersions, [PUBLIC_PROFILE_SCHEMA_VERSION]);
    assert.equal(submission.adaptation.createdFileCount, 4);
    assert.equal(submission.adaptation.modifiedFileCount, 7);
    assert.equal(submission.reviewer.email, "admin@onevue.test");
    assert.equal(submission.reviewer.name, "Test Admin");
    assert.ok(submission.decidedAt, "decision timestamp missing");
    assert.equal(submission.provisioningMode, "live_github");
    assert.equal(submission.lifecycle.status, "CATALOG_ELIGIBLE");
  });

  it("names the unmet conditions on the withheld record instead of leaving them implicit", async () => {
    store.reviews = [badRecord()];
    const submission = (await (await getSubmission("ing_real_bad")).json()).submission;

    assert.equal(submission.catalogEligible, false);
    assert.ok(Array.isArray(submission.catalogBlockers) && submission.catalogBlockers.length >= 3);
    const found = submission.catalogBlockers.map((b) => b.code);
    assert.ok(found.includes("PROVISIONING_MODE_MOCK"));
    assert.ok(found.includes("LIFECYCLE_EVIDENCE_MISSING"));
    assert.ok(found.includes("ADAPTATION_EVIDENCE_MISSING"));
    assert.equal(submission.framework, null, "framework must be absent, not invented");
    assert.equal(submission.provisioningIsMock, true);
  });

  it("never leaks the storage root or reviewer credentials", async () => {
    store.reviews = [badRecord()];
    const body = JSON.stringify(await (await getSubmission("ing_real_bad")).json());
    assert.equal(body.includes(os.tmpdir()), false);
    assert.equal(/password|passwordHash|Bearer /.test(body), false);
  });

  it("refuses students and anonymous callers on the evidence surface", async () => {
    authState.mode = "student";
    assert.equal((await getSubmission("ing_real_bad")).status, 403);
    authState.mode = "anonymous";
    assert.equal((await getSubmission("ing_real_bad")).status, 401);
    authState.mode = "admin";
  });
});
