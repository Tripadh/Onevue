/**
 * =========================================================================
 * OneVue — Phase 3: Source Inspection and Artifact Preview Separation
 * =========================================================================
 *
 * The artifact preview renders the built, DTO-adapted release a student would
 * receive. It can only answer for a release that was built, and it cannot
 * answer for a submission that is still awaiting human review.
 *
 * The source inspection endpoint is the other surface: a read-only view of the
 * retained source snapshot, which is what an administrator has to judge while
 * a submission is still pending.
 *
 * Verifies:
 * 1. Source inspection is administrator-only.
 * 2. A submission without a retained snapshot is refused, not faked.
 * 3. A snapshot that does not match the submission's provenance is refused.
 * 4. The file listing reports every file with its size and digest.
 * 5. A text file is returned as text.
 * 6. A binary file is described, never rendered.
 * 7. A path outside the snapshot is refused.
 * 8. Nothing is executed: the endpoint only reads bytes.
 * 9. The artifact preview refuses a missing artifact with a clear error and
 *    points at the source snapshot instead.
 * 10. The artifact preview still requires a DTO-adapted artifact.
 */

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.JWT_SECRET = "super_secure_test_jwt_secret_at_least_32_characters_long_123456";

// ---------------------------------------------------------------------------
// Module doubles: next/server, mongoose, /db and /auth.
// ---------------------------------------------------------------------------
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
      json: (body, init) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: init?.headers,
        }),
    },
  },
};

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;
require.cache["mock_db"] = { id: "mock_db", filename: "mock_db", loaded: true, exports: mockDbConnect };

const authState = { admin: true };
const adminUser = { _id: "admin_1", role: "admin", email: "admin@onevue.id" };
require.cache["mock_auth"] = {
  id: "mock_auth",
  filename: "mock_auth",
  loaded: true,
  exports: {
    verifyAdminAuth: async () =>
      authState.admin
        ? { user: adminUser }
        : { error: "Forbidden: Administrative access required.", status: 403 },
  },
};

let mockReviewRecords = [];

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

function MockModel(name) {
  const Model = function (data) {
    Object.assign(this, data);
    this.save = async function () {
      return this;
    };
  };
  Model.findOne = async (query) => {
    if (query?.ingestionId) {
      return mockReviewRecords.find((row) => row.ingestionId === query.ingestionId) || null;
    }
    return null;
  };
  Model.findById = async () => null;
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

// ---------------------------------------------------------------------------
// TypeScript transpile hook
// ---------------------------------------------------------------------------
const ts = require("typescript");
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

// ---------------------------------------------------------------------------
// Production modules under test
// ---------------------------------------------------------------------------
const { FileSystemSourceSnapshotStore } = require("../lib/template-snapshot.ts");
const {
  inspectSourceSnapshot,
  readSourceSnapshotFile,
} = require("../lib/template-source-inspection.ts");
const { LocalFilesystemStorageAdapter } = require("../lib/template-storage.ts");
const { verifyAndPackageArtifact } = require("../lib/template-build.ts");
const { renderTemplatePreviewDocument } = require("../lib/template-preview.ts");
const sourceRoute = require("../app/api/admin/templates/source/route.ts");

const TEMPLATE_ID = "demo-template";
const TEMPLATE_VERSION = "1.0.0";
const COMMIT_SHA = "b".repeat(40);

let tempRoots = [];

function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function sourceRequest(query) {
  const url = new URL("http://localhost:3000/api/admin/templates/source");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url.toString(), { method: "GET" });
}

describe("Phase 3 — source inspection and artifact preview separation", () => {
  let snapshotStore;
  let snapshotRoot;
  let snapshotRef;
  let storageRoot;

  beforeEach(async () => {
    mockReviewRecords = [];
    authState.admin = true;
    delete globalThis.__mockSourceSnapshotStore;

    snapshotRoot = makeTemp("onevue-source-inspection-snapshots-");
    storageRoot = makeTemp("onevue-source-inspection-storage-");
    snapshotStore = new FileSystemSourceSnapshotStore(snapshotRoot);

    // The exact source a reviewer would have to judge.
    const sourceDir = makeTemp("onevue-source-inspection-source-");
    fs.writeFileSync(
      path.join(sourceDir, "package.json"),
      JSON.stringify({ name: "demo-template", version: "1.0.0", license: "MIT" }, null, 2),
      "utf8"
    );
    fs.writeFileSync(path.join(sourceDir, "index.html"), "<!DOCTYPE html><html></html>\n", "utf8");
    fs.writeFileSync(path.join(sourceDir, "README.md"), "# Demo template\n", "utf8");
    // A binary asset: a PNG signature followed by NUL bytes.
    fs.writeFileSync(
      path.join(sourceDir, "logo.png"),
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 0)])
    );

    snapshotRef = await snapshotStore.create({
      snapshotId: "ing_demo_snapshot",
      sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceUrl: "https://github.com/demo/demo-template",
      commitSha: COMMIT_SHA,
      auditOutcome: "REVIEW_REQUIRED",
    });

    // The route reads the configured snapshot store; the test supplies one
    // instead of relying on an environment variable.
    globalThis.__mockSourceSnapshotStore = snapshotStore;
  });

  after(() => {
    for (const dir of tempRoots) {
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  function seedRecord(overrides = {}) {
    const record = {
      ingestionId: "ing_demo_snapshot",
      sourceUrl: "https://github.com/demo/demo-template",
      commitSha: COMMIT_SHA,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceSnapshot: snapshotRef,
      auditReport: { outcome: "REVIEW_REQUIRED", summary: "licence file missing" },
      status: "pending_review",
      submissionStatus: "review_required",
      ...overrides,
    };
    mockReviewRecords.push(record);
    return record;
  }

  it("1. refuses source inspection for a non-administrator", async () => {
    seedRecord();
    authState.admin = false;

    const response = await sourceRoute.GET(sourceRequest({ ingestionId: "ing_demo_snapshot" }));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.match(body.message, /Administrative access required/);
  });

  it("2. requires an ingestionId", async () => {
    const response = await sourceRoute.GET(sourceRequest({}));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "INGESTION_ID_REQUIRED");
  });

  it("3. reports an unknown submission as not found", async () => {
    const response = await sourceRoute.GET(sourceRequest({ ingestionId: "ing_missing" }));
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.code, "SUBMISSION_NOT_FOUND");
  });

  it("4. refuses a submission that retained no source snapshot", async () => {
    seedRecord({ sourceSnapshot: null });

    const response = await sourceRoute.GET(sourceRequest({ ingestionId: "ing_demo_snapshot" }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "SOURCE_SNAPSHOT_MISSING");
    assert.match(body.message, /no retained source snapshot/i);
  });

  it("5. refuses a snapshot that does not match the submission's provenance", async () => {
    seedRecord({ commitSha: "c".repeat(40) });

    const response = await sourceRoute.GET(sourceRequest({ ingestionId: "ing_demo_snapshot" }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "SOURCE_PROVENANCE_MISMATCH");
  });

  it("6. lists every retained file with its size and digest", async () => {
    seedRecord();

    const response = await sourceRoute.GET(sourceRequest({ ingestionId: "ing_demo_snapshot" }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);

    assert.equal(body.source.snapshotId, "ing_demo_snapshot");
    assert.equal(body.source.templateId, TEMPLATE_ID);
    assert.equal(body.source.templateVersion, TEMPLATE_VERSION);
    assert.equal(body.source.commitSha, COMMIT_SHA);
    assert.equal(body.source.auditOutcome, "REVIEW_REQUIRED");
    assert.equal(body.source.totalFiles, 4);

    const names = body.source.files.map((file) => file.relativePath).sort();
    assert.deepEqual(names, ["README.md", "index.html", "logo.png", "package.json"]);

    const logo = body.source.files.find((file) => file.relativePath === "logo.png");
    assert.equal(logo.binary, true, "a binary file must be described, not treated as text");
    assert.ok(/^[a-f0-9]{64}$/.test(logo.sha256));

    // Passive metadata is read as data; nothing is executed.
    assert.equal(body.metadata.manifestExists, true);
    assert.equal(body.metadata.packageManager, "unknown");
    assert.equal(body.metadata.packageJson.name, "demo-template");

    // The audit report that put this submission into review travels with it.
    assert.equal(body.auditReport.outcome, "REVIEW_REQUIRED");

    // No host path is ever exposed.
    assert.equal(JSON.stringify(body).includes(snapshotRoot), false);
  });

  it("7. returns a text file as text", async () => {
    seedRecord();

    const response = await sourceRoute.GET(
      sourceRequest({ ingestionId: "ing_demo_snapshot", path: "README.md" })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.file.relativePath, "README.md");
    assert.equal(body.file.binary, false);
    assert.equal(body.file.content, "# Demo template\n");
  });

  it("8. describes a binary file instead of rendering it", async () => {
    seedRecord();

    const response = await sourceRoute.GET(
      sourceRequest({ ingestionId: "ing_demo_snapshot", path: "logo.png" })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.file.binary, true);
    assert.equal(body.file.content, "");
    assert.ok(body.file.sizeBytes > 0);
  });

  it("9. refuses a path that escapes the snapshot", async () => {
    seedRecord();

    for (const attempt of ["../../etc/passwd", "/etc/passwd", "..\\..\\secret.txt"]) {
      const response = await sourceRoute.GET(
        sourceRequest({ ingestionId: "ing_demo_snapshot", path: attempt })
      );
      assert.equal(response.status, 409, attempt);
      const body = await response.json();
      assert.equal(body.code, "UNSAFE_PATH", attempt);
    }
  });

  it("10. refuses a file that is not part of the snapshot", async () => {
    seedRecord();

    const response = await sourceRoute.GET(
      sourceRequest({ ingestionId: "ing_demo_snapshot", path: "not-here.txt" })
    );
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "FILE_NOT_FOUND");
  });

  it("11. refuses a snapshot that no longer verifies", async () => {
    seedRecord();
    // An out-of-band modification of the retained source.
    fs.writeFileSync(
      path.join(snapshotRoot, "snapshots", "ing_demo_snapshot", "source", "README.md"),
      "tampered\n",
      "utf8"
    );

    const response = await sourceRoute.GET(sourceRequest({ ingestionId: "ing_demo_snapshot" }));
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "SOURCE_SNAPSHOT_INVALID");
  });

  it("12. the artifact preview refuses a missing artifact and points at the source snapshot", async () => {
    const storageAdapter = new LocalFilesystemStorageAdapter(storageRoot);

    const preview = await renderTemplatePreviewDocument({
      templateId: "never-built",
      templateVersion: "1.0.0",
      origin: "http://localhost:3000",
      storageAdapter,
    });

    assert.equal(preview.ok, false);
    assert.equal(preview.status, 404);
    assert.equal(preview.code, "MISSING_ARTIFACT");
    assert.match(preview.message, /No built artifact exists for 'never-built@1\.0\.0'/);
    assert.match(preview.message, /only available after a successful build/i);
    assert.match(preview.message, /inspect the retained source snapshot instead/i);
  });

  it("13. the artifact preview still refuses an artifact that was never DTO-adapted", async () => {
    const storageAdapter = new LocalFilesystemStorageAdapter(storageRoot);

    // A real, stored release whose entrypoint carries no DTO contract.
    const stagedDir = makeTemp("onevue-source-inspection-artifact-");
    fs.writeFileSync(
      path.join(stagedDir, "index.html"),
      "<!DOCTYPE html><html><body>Legacy template</body></html>",
      "utf8"
    );
    fs.mkdirSync(path.join(stagedDir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(stagedDir, "assets", "app.js"), "console.log('legacy');", "utf8");

    const packaged = verifyAndPackageArtifact(stagedDir, {
      templateId: "legacy-template",
      templateVersion: "1.0.0",
      sourceCommitSha: "d".repeat(40),
      supportedDtoVersions: ["1.0.0"],
    });
    assert.equal(packaged.valid, true, packaged.error);

    const stored = await storageAdapter.storeArtifact(
      "legacy-template",
      "1.0.0",
      stagedDir,
      packaged.manifest
    );
    assert.equal(stored.success, true, stored.error);

    const preview = await renderTemplatePreviewDocument({
      templateId: "legacy-template",
      templateVersion: "1.0.0",
      origin: "http://localhost:3000",
      storageAdapter,
    });

    assert.equal(preview.ok, false);
    assert.equal(preview.status, 409);
    assert.equal(preview.code, "ARTIFACT_NOT_DTO_ADAPTED");
  });

  it("14. returns the audit report through the same projection the submissions list uses", async () => {
    // The stored report carries evidence that is far longer than a client
    // needs, plus blocks the submissions projection does not expose. Both
    // surfaces must project it identically.
    seedRecord({
      auditReport: {
        outcome: "REVIEW_REQUIRED",
        summary: "licence file missing",
        license: {
          declaredLicense: null,
          detectedSpdx: null,
          licenseFileFound: false,
          isPermissive: false,
          isCopyleftRestricted: false,
          findings: [{ ruleId: "license.missing", severity: "medium", message: "no LICENSE", evidence: "x".repeat(900) }],
        },
        dependencies: {
          totalDependencies: 3,
          lifecycleScriptsDetected: ["postinstall"],
          lockfilePresent: false,
          findings: [],
        },
        generalFindings: [
          { ruleId: "license.missing", severity: "medium", message: "no LICENSE", evidence: "y".repeat(900) },
        ],
        // A block no administrative surface is meant to expose.
        internalNotes: "must not be returned",
      },
    });

    const response = await sourceRoute.GET(sourceRequest({ ingestionId: "ing_demo_snapshot" }));
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.ok(body.auditReport, "the audit report must still be returned");
    assert.equal(body.auditReport.outcome, "REVIEW_REQUIRED");
    assert.equal(body.auditReport.internalNotes, undefined, "unknown blocks must not be exposed");
    assert.equal(
      body.auditReport.generalFindings[0].evidence.length,
      300,
      "evidence must be truncated to the administrator projection's limit"
    );
    assert.equal(
      body.auditReport.license.findings[0].evidence.length,
      300,
      "every finding block must be truncated, not only the general ones"
    );
    assert.ok(body.auditReport.dependencies, "the dependency block must still be returned");
    assert.equal(body.auditReport.dependencies.totalDependencies, 3);
  });

  it("15. refuses a file that changed between the verification and the read", async () => {
    // The store verifies successfully, but the digest it hands back describes
    // content that is no longer on disk: the file was swapped in the window
    // between the two steps. Serving it would show a reviewer content that
    // was never part of the retained source.
    const sourceDir = makeTemp("onevue-source-inspection-toctou-");
    fs.writeFileSync(path.join(sourceDir, "README.md"), "# Original content\n", "utf8");

    const staleStore = {
      create: async () => snapshotRef,
      remove: async () => {},
      verify: async (ref) => ({
        ref,
        sourceDir,
        files: [
          {
            relativePath: "README.md",
            sizeBytes: 19,
            sha256: "0".repeat(64),
          },
        ],
      }),
    };

    const file = await readSourceSnapshotFile(staleStore, snapshotRef, "README.md");
    assert.equal(file.ok, false);
    assert.equal(file.code, "SOURCE_SNAPSHOT_INVALID");
    assert.match(file.message, /no longer matches the digest/);
  });

  it("16. refuses to list a snapshot whose content changed between the verification and the listing", async () => {
    const sourceDir = makeTemp("onevue-source-inspection-toctou-listing-");
    fs.writeFileSync(path.join(sourceDir, "README.md"), "# Original content\n", "utf8");

    const staleStore = {
      create: async () => snapshotRef,
      remove: async () => {},
      verify: async (ref) => ({
        ref,
        sourceDir,
        files: [
          {
            relativePath: "README.md",
            sizeBytes: 19,
            sha256: "0".repeat(64),
          },
        ],
      }),
    };

    const listing = await inspectSourceSnapshot(staleStore, snapshotRef);
    assert.equal(listing.ok, false);
    assert.equal(listing.code, "SOURCE_SNAPSHOT_INVALID");
    assert.match(listing.message, /changed while it was being inspected/);
  });
});
