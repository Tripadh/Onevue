/**
 * =========================================================================
 * OneVue Phase 5.15 — GitHub URL -> Dynamic Template Workflow
 * =========================================================================
 *
 * Exercises the real orchestration (backend/lib/template-submission.ts) end to
 * end with offline doubles for the only three externals:
 *   - MongoDB (in-memory model preserving the production query/update shapes)
 *   - GitHub (a fetch double serving commit metadata + a real .tar.gz archive)
 *   - build/provisioning (the repository's existing Mock executors; no Docker,
 *     no live GitHub — the isolation boundary is never bypassed)
 *
 * Everything else is production code: URL validation, commit pinning, tar
 * extraction, license/security audit, source snapshots, adaptation, packaging,
 * immutable storage, the Phase 5.14 delivery boundary and the dynamic catalog.
 */

const { describe, it, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const Module = require("node:module");

process.env.JWT_SECRET = "super_secure_test_jwt_secret_at_least_32_characters_long_123456";

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
// Fake persistence with the query shapes the production code uses.
// ---------------------------------------------------------------------------
function getPath(target, dotted) {
  return String(dotted)
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), target);
}

function setPath(target, dotted, value) {
  const keys = String(dotted).split(".");
  let cursor = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cursor[keys[i]] == null || typeof cursor[keys[i]] !== "object") cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
}

function matchesQuery(doc, query) {
  for (const [key, expected] of Object.entries(query || {})) {
    if (key === "$or") {
      if (!Array.isArray(expected) || !expected.some((clause) => matchesQuery(doc, clause))) return false;
      continue;
    }
    const actual = getPath(doc, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ("$in" in expected && !expected.$in.includes(actual)) return false;
      if ("$ne" in expected && actual === expected.$ne) return false;
      if ("$gt" in expected && !(actual > expected.$gt)) return false;
      if ("$lte" in expected && !(actual <= expected.$lte)) return false;
      if ("$exists" in expected) {
        const exists = actual !== undefined && actual !== null;
        if (exists !== expected.$exists) return false;
      }
      if (!["$in", "$ne", "$gt", "$lte", "$exists"].some((op) => op in expected)) {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
      }
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}

function assertNoUpdatePathConflicts(update) {
  for (const op of Object.keys(update || {})) {
    if (op.startsWith("$")) {
      const keys = Object.keys(update[op] || {});
      for (let i = 0; i < keys.length; i++) {
        for (let j = 0; j < keys.length; j++) {
          if (i === j) continue;
          const k1 = keys[i];
          const k2 = keys[j];
          if (k2.startsWith(k1 + ".")) {
            const err = new Error(`Updating the path '${k2}' would create a conflict at '${k1}'`);
            err.name = "MongoServerError";
            err.code = 40;
            throw err;
          }
        }
      }
    }
  }
}

function createFakeModel(name, store) {
  function Model(data) {
    Object.assign(this, clone(data || {}));
    this._id = this._id || `${name}_${store.length + 1}_${Math.random().toString(36).slice(2, 6)}`;
    this.createdAt = this.createdAt || new Date();
    this.updatedAt = this.updatedAt || new Date();
    this.save = async function save() {
      if (name === "TemplateIngestionReview") {
        if (!this.sourceUrl || typeof this.sourceUrl !== "string" || !this.sourceUrl.trim()) {
          const error = new Error("TemplateIngestionReview validation failed: sourceUrl: sourceUrl is required");
          error.name = "ValidationError";
          throw error;
        }
      }
      const duplicate = store.find(
        (row) => row.ingestionId && row.ingestionId === this.ingestionId && row._id !== this._id
      );
      if (duplicate) {
        const error = new Error("E11000 duplicate key error: ingestionId");
        error.code = 11000;
        throw error;
      }
      const existing = store.findIndex((row) => row._id === this._id);
      if (existing >= 0) store[existing] = this;
      else store.push(this);
      return this;
    };
  }

  function chainable(rows) {
    let output = rows;
    const chain = {
      sort() {
        output = [...output].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return chain;
      },
      limit(count) {
        output = output.slice(0, count);
        return chain;
      },
      lean() {
        return Promise.resolve(output.map(clone));
      },
      then(resolve, reject) {
        return Promise.resolve(output.map(clone)).then(resolve, reject);
      },
      catch(reject) {
        return Promise.resolve(output.map(clone)).catch(reject);
      },
    };
    return chain;
  }

  Model.find = (query = {}) => chainable(store.filter((doc) => matchesQuery(doc, query)));
  Model.findOne = (query = {}) => {
    const found = store.find((doc) => matchesQuery(doc, query));
    const materialize = () => {
      if (!found) return null;
      const doc = clone(found);
      doc.save = async function save() {
        const index = store.indexOf(found);
        if (index >= 0) store[index] = { ...found, ...this };
        return this;
      };
      return doc;
    };
    // Mongoose returns a Query: awaitable, and .lean()-able.
    return {
      lean: async () => (found ? clone(found) : null),
      then: (resolve, reject) => Promise.resolve(materialize()).then(resolve, reject),
      catch: (reject) => Promise.resolve(materialize()).catch(reject),
    };
  };
  Model.updateOne = async (query, update) => {
    assertNoUpdatePathConflicts(update);
    const found = store.filter((doc) => matchesQuery(doc, query));
    for (const doc of found) {
      for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
      doc.updatedAt = new Date();
    }
    return { matchedCount: found.length, modifiedCount: found.length };
  };
  Model.findOneAndUpdate = async (query, update) => {
    assertNoUpdatePathConflicts(update);
    const doc = store.find((row) => matchesQuery(row, query));
    if (!doc) return null;
    for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
    return clone(doc);
  };
  Model.deleteMany = async (query = {}) => {
    for (let i = store.length - 1; i >= 0; i -= 1) {
      if (matchesQuery(store[i], query)) store.splice(i, 1);
    }
  };
  return Model;
}

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

const modelStores = {
  TemplateIngestionReview: [],
  UserWebsiteConfig: [],
  User: [],
};

const mockMongoose = {
  Schema: MockSchema,
  models: {},
  model: (name) => {
    if (!modelStores[name]) modelStores[name] = [];
    return createFakeModel(name, modelStores[name]);
  },
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "mongoose") return "mock_mongoose";
  if (request === "next/server") return "mock_next_server";
  if (request.endsWith("/db") || request.endsWith("/db.ts")) return "mock_db";
  if (request.endsWith("/auth") || request.endsWith("/auth.ts")) return "mock_auth";
  return originalResolve.call(this, request, ...rest);
};

require.cache["mock_mongoose"] = { id: "mock_mongoose", filename: "mock_mongoose", loaded: true, exports: mockMongoose };

require.cache["mock_next_server"] = {
  id: "mock_next_server",
  filename: "mock_next_server",
  loaded: true,
  exports: {
    NextResponse: {
      json: (body, init) =>
        new Response(JSON.stringify(body), { status: init?.status || 200, headers: init?.headers }),
    },
  },
};

const mockDbConnect = async () => {};
mockDbConnect.default = mockDbConnect;
require.cache["mock_db"] = { id: "mock_db", filename: "mock_db", loaded: true, exports: mockDbConnect };

const authState = { admin: true, user: null };
const adminUser = { _id: "admin_1", role: "admin", identity: "admin", email: "admin@onevue.id" };
const studentUser = { _id: "student_1", role: "student", identity: "student", email: "student@onevue.id" };
require.cache["mock_auth"] = {
  id: "mock_auth",
  filename: "mock_auth",
  loaded: true,
  exports: {
    verifyAuth: async () => ({ user: authState.user || studentUser }),
    verifyAdminAuth: async () =>
      authState.admin ? { user: adminUser } : { error: "Forbidden: Administrative access required.", status: 403 },
    signJwtToken: () => "mock_token",
  },
};

// ---------------------------------------------------------------------------
// Production modules under test
// ---------------------------------------------------------------------------
const {
  submitTemplateRepository,
  deriveTemplateId,
  deriveNextVersion,
  buildRepositoryKey,
  acquireRepositoryLease,
  releaseRepositoryLease,
  expireRepositoryLease,
} = require("../lib/template-submission.ts");
const {
  orchestrateTemplateLifecycle, // imported to prove a real lifecycle runs
  InMemoryLifecyclePersistence,
} = require("../lib/template-lifecycle.ts");
const { MockBuildExecutor } = require("../lib/template-build.ts");
const { MockProvisioningExecutor } = require("../lib/template-provisioning.ts");

/**
 * Provisioning double for the production path. It reports the same signals
 * LiveGitHubProvisioningExecutor does — `isMock: false` and a real
 * github.com destination — without touching GitHub.
 *
 * Catalog eligibility now depends on that provenance, so every workflow test
 * that asserts a release becomes student-visible has to run against it. The
 * mock executor remains available for the tests that specifically verify
 * development-mode provenance.
 */
class ProductionProvisioningExecutor extends MockProvisioningExecutor {
  constructor(options) {
    super(options);
    this.isMock = false;
  }

  async createPrivateRepository(org, repo, options) {
    const result = await super.createPrivateRepository(org, repo, options);
    if (!result.success) return result;
    return { ...result, url: `https://github.com/${org}/${repo}`, isMock: false };
  }
}
const {
  LocalFilesystemStorageAdapter,
} = require("../lib/template-storage.ts");
const { FileSystemSourceSnapshotStore } = require("../lib/template-snapshot.ts");
const {
  getEligibleCatalogTemplates,
  validateEligibleTemplateSelection,
  describeCatalogEligibility,
} = require("../lib/template-registry-extension.ts");
const { setDefaultStorageAdapter } = require("../lib/template-artifact-delivery.ts");
const {
  resolveTemplateAsset,
  setArtifactStorageAdapter,
} = require("../../portfolio/src/lib/template-artifact-store.ts");
const ReviewModel = require("../models/TemplateIngestionReview.ts").default;
const submitRoute = require("../app/api/admin/templates/submit/route.ts");
const submissionsRoute = require("../app/api/admin/templates/submissions/route.ts");
const reviewRoute = require("../app/api/admin/templates/review/route.ts");
const configRoute = require("../app/api/student/website/config/route.ts");

assert.equal(typeof orchestrateTemplateLifecycle, "function", "the real lifecycle must be available");

/* =========================================================================
   Fixtures
   ========================================================================= */

function tarBlock(entry) {
  const header = Buffer.alloc(512, 0);
  header.write(entry.path, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "utf8");
  header.write("0001000\0", 108, 8, "utf8");
  header.write("0001000\0", 116, 8, "utf8");
  const body = Buffer.from(entry.content || "", "utf8");
  header.write(body.length.toString(8).padStart(11, "0") + " ", 124, 12, "utf8");
  header.write("14000000000\0", 136, 12, "utf8");
  header.write(entry.isDirectory ? "5" : "0", 156, 1, "utf8");
  header.write("ustar\0", 257, 6, "utf8");
  header.write("00", 263, 2, "utf8");
  header.write("        ", 148, 8, "utf8");
  let checksum = 0;
  for (let i = 0; i < 512; i += 1) checksum += header[i];
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
  return body.length ? [header, Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512, 0)])] : [header];
}

const MIT_LICENSE = `MIT License

Copyright (c) 2026 OneVue Template Author

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`;

const GPL_LICENSE = `GNU GENERAL PUBLIC LICENSE
Version 3, 29 June 2007

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later version.
`;

function repoFiles(options) {
  const license = options.license || "MIT";
  const pkg = {
    name: options.name || "demo-template",
    version: "1.0.0",
    license,
    scripts: { build: "vite build" },
    dependencies: {},
    devDependencies: { vite: "5.0.0" },
    ...(options.onevue ? { onevue: options.onevue } : {}),
  };
  const files = {
    "package.json": JSON.stringify(pkg, null, 2),
    "package-lock.json": JSON.stringify({ name: pkg.name, lockfileVersion: 3, packages: {} }),
    "vite.config.js": "export default {};\n",
    "src/main.js": "console.log('template source');\n",
    "TEMPLATE_MARKER": options.marker || "marker",
  };
  if (!options.omitLicense) {
    files.LICENSE = license === "GPL-3.0-only" ? GPL_LICENSE : MIT_LICENSE;
  }
  return files;
}

const repoState = new Map();
const githubRequests = [];
const PRIVATE_REPOSITORIES = new Set(["private-org/secret-template"]);
const VALID_READ_TOKEN = "ghp_valid_read_only_token_0123456789abcdef";

function setRepository(owner, repo, options = {}) {
  const key = buildRepositoryKey(owner, repo);
  const sha = options.sha || crypto.createHash("sha1").update(`${key}:${options.marker || "1"}`).digest("hex");
  repoState.set(key, {
    owner,
    repo,
    sha,
    files: repoFiles({ name: repo, ...options }),
  });
  return sha;
}

function authHeader(init) {
  const headers = (init && init.headers) || {};
  return headers.Authorization || headers.authorization || "";
}

async function githubFetch(url, init) {
  const target = String(url);
  const authorization = authHeader(init);
  githubRequests.push({ url: target, authorization: Boolean(authorization) });

  // Private repositories are only visible with a valid server-side credential.
  const repoMatch = target.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\//);
  if (repoMatch) {
    const key = buildRepositoryKey(repoMatch[1], repoMatch[2]);
    if (PRIVATE_REPOSITORIES.has(key)) {
      if (!authorization) return new Response("Not Found", { status: 404 });
      if (authorization !== `Bearer ${VALID_READ_TOKEN}`) {
        return new Response("Bad credentials", { status: 401 });
      }
    }
  }

  const commitMatch = target.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/commits\/(.+)$/);
  if (commitMatch) {
    const state = repoState.get(buildRepositoryKey(commitMatch[1], commitMatch[2]));
    if (!state) return new Response("Not Found", { status: 404 });
    return new Response(JSON.stringify({ sha: state.sha }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const tarballMatch = target.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/tarball\/([a-f0-9]{40})$/);
  if (tarballMatch) {
    const state = repoState.get(buildRepositoryKey(tarballMatch[1], tarballMatch[2]));
    if (!state || state.sha !== tarballMatch[3]) return new Response("Not Found", { status: 404 });
    const prefix = `${state.owner}-${state.repo}-${state.sha.slice(0, 7)}`;
    const blocks = [ {
      path: `${prefix}/`,
      isDirectory: true,
    } ];
    for (const [name, content] of Object.entries(state.files)) {
      blocks.push({ path: `${prefix}/${name}`, content });
    }
    const parts = [{ path: blocks[0].path, isDirectory: true, content: "" }, ...blocks.slice(1)].flatMap((entry) =>
      tarBlock(entry)
    );
    parts.push(Buffer.alloc(1024, 0));
    const gz = zlib.gzipSync(Buffer.concat(parts));
    const response = new Response(gz, { status: 200, headers: { "Content-Type": "application/gzip" } });
    Object.defineProperty(response, "url", {
      value: `https://codeload.github.com/${encodeURIComponent(tarballMatch[1])}/${encodeURIComponent(tarballMatch[2])}/legacy.tar.gz/${tarballMatch[3]}`,
    });
    return response;
  }
  return new Response("Not Found", { status: 404 });
}

/** Trusted prebuilt artifact generator: never executes repository code. */
class TrustedPrebuiltExecutor {
  constructor() {
    this.calls = 0;
  }
  async executeBuild({ sourceDir, outputDir }) {
    this.calls += 1;
    const marker = fs.readFileSync(path.join(sourceDir, "TEMPLATE_MARKER"), "utf8").trim();
    fs.mkdirSync(path.join(outputDir, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "index.html"),
      `<!DOCTYPE html><html><head><!-- <script type="application/json" id="__ONEVUE_DTO__">{}</script> --><script type="module" src="/templates/__ID__/__VERSION__/assets/index.js"></script></head><body><div id="root" data-marker="${marker}"></div></body></html>`
    );
    fs.writeFileSync(path.join(outputDir, "assets/index.js"), `console.log("marker:${marker}");`);
    fs.writeFileSync(path.join(outputDir, "assets/index.css"), `body{--marker:"${marker}"}`);
    return { success: true, outputDir };
  }
}

function failingStoreAdapter(inner) {
  return {
    checkVersionExists: (id, version) => inner.checkVersionExists(id, version),
    retrieveArtifact: (id, version) => inner.retrieveArtifact(id, version),
    validateStoredArtifact: (id, version) => inner.validateStoredArtifact(id, version),
    storeArtifact: async () => ({
      success: false,
      outcome: "STORAGE_ERROR",
      error: "simulated storage outage",
    }),
  };
}

/* =========================================================================
   Harness
   ========================================================================= */

const OWNER = "qubort-tech";
const REPO = "studio-portfolio-template";

let tempRoots = [];

function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function buildDeps(overrides = {}) {
  const storageRoot = overrides.storageRoot || makeTemp("onevue-515-storage-");
  const snapshotRoot = overrides.snapshotRoot || makeTemp("onevue-515-snapshots-");
  const storageAdapter =
    overrides.storageAdapter ||
    (overrides.harness && overrides.harness.storageAdapter) ||
    new LocalFilesystemStorageAdapter(storageRoot);
  const snapshotStore =
    overrides.snapshotStore ||
    (overrides.harness && overrides.harness.snapshotStore) ||
    new FileSystemSourceSnapshotStore(snapshotRoot);
  const buildExecutor = overrides.noBuildExecutor
    ? undefined
    : overrides.buildExecutor || new TrustedPrebuiltExecutor();
  const provisioningExecutor = overrides.provisioningExecutor || new ProductionProvisioningExecutor();

  return {
    storageRoot: overrides.storageRoot || (overrides.harness && overrides.harness.storageRoot) || storageRoot,
    snapshotRoot: overrides.snapshotRoot || (overrides.harness && overrides.harness.snapshotRoot) || snapshotRoot,
    storageAdapter,
    snapshotStore,
    deps: {
      reviewModel: ReviewModel,
      snapshotStore,
      storageAdapter,
      fetchImpl: githubFetch,
      githubAuthToken: overrides.githubAuthToken === undefined ? null : overrides.githubAuthToken,
      stageTimeoutMs: overrides.stageTimeoutMs,
      leaseMs: overrides.leaseMs,
      buildExecutor,
      provisioningExecutor,
      lifecyclePersistenceFactory: (_model, review) =>
        new InMemoryLifecyclePersistence([
          {
            ingestionId: review.ingestionId,
            status: "APPROVED",
            templateId: review.templateId,
            templateVersion: review.templateVersion,
            sourceCommitSha: review.sourceCommitSha,
            updatedAt: new Date(0).toISOString(),
          },
        ]),
      now: () => new Date("2026-10-30T12:00:00.000Z"),
    },
  };
}

function submissionInput(overrides = {}) {
  return {
    url: `https://github.com/${OWNER}/${REPO}`,
    explicitConfirmation: true,
    adminUserId: adminUser._id,
    ...overrides,
  };
}

function resetState() {
  for (const key of Object.keys(modelStores)) modelStores[key].length = 0;
  repoState.clear();
  authState.admin = true;
  authState.user = null;
  delete globalThis.__mockBuildExecutor;
  delete globalThis.__mockProvisioningExecutor;
  delete globalThis.__mockStorageAdapter;
  delete globalThis.__mockSourceSnapshotStore;
  delete globalThis.__mockFetch;
  githubRequests.length = 0;
  setDefaultStorageAdapter(null);
  setArtifactStorageAdapter(null);
}

function templateRecords(repositoryKey) {
  return modelStores.TemplateIngestionReview.filter(
    (record) =>
      record.submissionStatus !== "repository_lock" &&
      (repositoryKey ? record.repositoryKey === repositoryKey : true)
  );
}

/* =========================================================================
   Tests
   ========================================================================= */

describe("Phase 5.15 — GitHub submission workflow", () => {
  beforeEach(() => resetState());

  after(() => {
    setDefaultStorageAdapter(null);
    setArtifactStorageAdapter(null);
    for (const dir of tempRoots) {
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  it("1. a new GitHub URL is ingested, built, stored and appears in the catalog", async () => {
    const sha = setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();

    const result = await submitTemplateRepository(submissionInput(), harness.deps);

    assert.equal(result.success, true, result.message);
    assert.equal(result.outcome, "CREATED");
    assert.equal(result.submission.templateId, deriveTemplateId(REPO));
    assert.equal(result.submission.templateVersion, "1.0.0");
    assert.equal(result.submission.commitSha, sha);
    assert.equal(result.submission.catalogEligible, true);
    assert.deepEqual(
      result.submission.stages.map((stage) => stage.stage),
      [
        "VALIDATE_REPOSITORY",
        "PIN_COMMIT",
        "DUPLICATE_CHECK",
        // The source snapshot is taken before the audit outcome is acted on, so
        // a REVIEW_REQUIRED result still retains the exact reviewed source.
        "SOURCE_SNAPSHOT",
        "AUDIT",
        "BUILD_BOUNDARY",
        "PROVISION",
        "ADAPT_BUILD_STORE",
        "CATALOG",
      ]
    );

    // Artifact really exists in immutable storage.
    const stored = path.join(harness.storageRoot, "templates", deriveTemplateId(REPO), "1.0.0", "index.html");
    assert.equal(fs.existsSync(stored), true);
    assert.ok(fs.readFileSync(stored, "utf8").includes("v1"));

    // Catalog discovers it dynamically.
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    const template = catalog.find((entry) => entry.id === deriveTemplateId(REPO));
    assert.ok(template, "the template must appear in the public catalog");
    assert.equal(template.latestVersion, "1.0.0");
    assert.deepEqual(template.releases.map((release) => release.version), ["1.0.0"]);
  });

  it("2. the same repository and commit is idempotent (no duplicate version)", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();

    const first = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(first.outcome, "CREATED");
    const recordsAfterFirst = templateRecords().length;

    const second = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(second.success, true);
    assert.equal(second.outcome, "NO_UPDATE");
    assert.equal(second.code, "DUPLICATE_REPOSITORY");
    assert.equal(second.submission.templateVersion, "1.0.0");
    assert.equal(templateRecords().length, recordsAfterFirst, "no new record may be created");

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    const template = catalog.find((entry) => entry.id === deriveTemplateId(REPO));
    assert.deepEqual(template.releases.map((release) => release.version), ["1.0.0"]);
  });

  it("3 & 4. a new commit creates a new immutable version and the old version survives", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    const first = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(first.outcome, "CREATED");

    setRepository(OWNER, REPO, { marker: "v2" });
    const second = await submitTemplateRepository(submissionInput(), harness.deps);

    assert.equal(second.success, true, second.message);
    assert.equal(second.outcome, "UPDATED");
    assert.equal(second.submission.templateVersion, "1.1.0");
    assert.equal(second.submission.previousVersion, "1.0.0");
    assert.notEqual(second.submission.commitSha, first.submission.commitSha);

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    const template = catalog.find((entry) => entry.id === deriveTemplateId(REPO));
    assert.deepEqual(
      template.releases.map((release) => release.version).sort(),
      ["1.0.0", "1.1.0"]
    );
    assert.equal(template.latestVersion, "1.1.0");

    // Both immutable releases are still on disk with their own content.
    const v1 = fs.readFileSync(
      path.join(harness.storageRoot, "templates", deriveTemplateId(REPO), "1.0.0", "index.html"),
      "utf8"
    );
    const v2 = fs.readFileSync(
      path.join(harness.storageRoot, "templates", deriveTemplateId(REPO), "1.1.0", "index.html"),
      "utf8"
    );
    assert.ok(v1.includes("v1"));
    assert.ok(v2.includes("v2"));
    assert.notEqual(v1, v2);
  });

  it("5. an existing published selection keeps its pinned version after an update", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    await submitTemplateRepository(submissionInput(), harness.deps);

    const templateId = deriveTemplateId(REPO);
    // A published snapshot pinned community-style to 1.0.0 validates and serves 1.0.0.
    const pinned = await validateEligibleTemplateSelection(templateId, "1.0.0", "1.0.0", {
      storageAdapter: harness.storageAdapter,
    });
    assert.equal(pinned.valid, true, pinned.error);

    setRepository(OWNER, REPO, { marker: "v2" });
    await submitTemplateRepository(submissionInput(), harness.deps);

    const stillPinned = await validateEligibleTemplateSelection(templateId, "1.0.0", "1.0.0", {
      storageAdapter: harness.storageAdapter,
    });
    assert.equal(stillPinned.valid, true, "the previously published version must remain selectable");

    setArtifactStorageAdapter(harness.storageAdapter);
    const pinnedAsset = await resolveTemplateAsset(templateId, "1.0.0", "index.html");
    const latestAsset = await resolveTemplateAsset(templateId, "1.1.0", "index.html");
    assert.equal(pinnedAsset.resolution.ok, true, pinnedAsset.resolution.error);
    assert.equal(latestAsset.resolution.ok, true, latestAsset.resolution.error);
    assert.ok(pinnedAsset.asset.body.toString("utf8").includes("v1"));
    assert.ok(latestAsset.asset.body.toString("utf8").includes("v2"));
  });

  it("6. a new student selection with 'latest' resolves and pins the newest approved version", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    await submitTemplateRepository(submissionInput(), harness.deps);
    setRepository(OWNER, REPO, { marker: "v2" });
    await submitTemplateRepository(submissionInput(), harness.deps);

    const templateId = deriveTemplateId(REPO);
    const latest = await validateEligibleTemplateSelection(templateId, "latest", "1.0.0", {
      storageAdapter: harness.storageAdapter,
    });
    assert.equal(latest.valid, true, latest.error);
    assert.equal(latest.resolvedVersion, "1.1.0");

    // The student config route persists the resolved version, not the keyword.
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    authState.admin = false;
    authState.user = studentUser;
    const response = await configRoute.PUT(
      new Request("http://localhost:3000/api/student/website/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "lateststudent",
          selectedTemplateId: templateId,
          selectedTemplateVersion: "latest",
        }),
      })
    );
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal(payload.config.selectedTemplateVersion, "1.1.0");
    assert.equal(payload.config.selectedTemplateId, templateId);
  });

  it("7. an invalid repository URL is rejected without side effects", async () => {
    const harness = buildDeps();
    for (const url of [
      "http://github.com/a/b",
      "https://gitlab.com/a/b",
      "https://github.com/only-owner",
      "https://github.com/a/b?ref=main",
      "not-a-url",
    ]) {
      const result = await submitTemplateRepository(submissionInput({ url }), harness.deps);
      assert.equal(result.success, false, url);
      assert.equal(result.code, "INVALID_URL", url);
    }
    assert.equal(templateRecords().length, 0);
    assert.equal(fs.readdirSync(harness.storageRoot).length, 0, "no artifact may be written");
  });

  it("8. a failed license/security audit does not publish anything", async () => {
    setRepository(OWNER, REPO, { marker: "gpl", license: "GPL-3.0-only" });
    const harness = buildDeps();

    const result = await submitTemplateRepository(submissionInput(), harness.deps);

    assert.equal(result.success, false);
    assert.equal(result.code, "AUDIT_REJECTED");
    assert.equal(result.submission.reviewStatus, "rejected");
    assert.equal(result.submission.submissionStatus, "audit_rejected");
    assert.equal(
      fs.existsSync(path.join(harness.storageRoot, "templates", deriveTemplateId(REPO))),
      false,
      "no artifact may be stored"
    );
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    assert.equal(catalog.some((entry) => entry.id === deriveTemplateId(REPO)), false);
  });

  it("9. a failed build does not publish anything", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps({ buildExecutor: new MockBuildExecutor({ shouldFail: true }) });

    const result = await submitTemplateRepository(submissionInput(), harness.deps);

    assert.equal(result.success, false);
    assert.equal(result.code, "BUILD_EXECUTION_FAILED");
    assert.equal(result.submission.submissionStatus, "build_failed");
    assert.equal(
      fs.existsSync(path.join(harness.storageRoot, "templates", deriveTemplateId(REPO))),
      false
    );
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    assert.equal(catalog.some((entry) => entry.id === deriveTemplateId(REPO)), false);
  });

  it("10. failed storage does not publish anything", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const base = buildDeps();
    const harness = buildDeps({ storageAdapter: failingStoreAdapter(base.storageAdapter) });

    const result = await submitTemplateRepository(submissionInput(), harness.deps);

    assert.equal(result.success, false);
    assert.equal(result.code, "STORAGE_FAILED");
    assert.equal(result.submission.submissionStatus, "storage_failed");
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: base.storageAdapter });
    assert.equal(catalog.some((entry) => entry.id === deriveTemplateId(REPO)), false);
  });

  it("11. concurrent submissions of the same update create exactly one new version", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    await submitTemplateRepository(submissionInput(), harness.deps);

    setRepository(OWNER, REPO, { marker: "v2" });
    const [a, b] = await Promise.all([
      submitTemplateRepository(submissionInput(), harness.deps),
      submitTemplateRepository(submissionInput(), harness.deps),
    ]);

    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepEqual(outcomes, ["NO_UPDATE", "UPDATED"]);
    const versions = templateRecords()
      .filter((record) => record.status === "approved")
      .map((record) => record.templateVersion)
      .sort();
    assert.deepEqual(versions, ["1.0.0", "1.1.0"], "no inconsistent duplicate version may exist");

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    const template = catalog.find((entry) => entry.id === deriveTemplateId(REPO));
    assert.deepEqual(template.releases.map((release) => release.version).sort(), ["1.0.0", "1.1.0"]);
  });

  it("12. visitor delivery serves the exact selected immutable version", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    await submitTemplateRepository(submissionInput(), harness.deps);
    setRepository(OWNER, REPO, { marker: "v2" });
    await submitTemplateRepository(submissionInput(), harness.deps);

    const templateId = deriveTemplateId(REPO);
    setDefaultStorageAdapter(harness.storageAdapter);
    setArtifactStorageAdapter(harness.storageAdapter);

    const v1 = await resolveTemplateAsset(templateId, "1.0.0", "assets/index.js");
    const v2 = await resolveTemplateAsset(templateId, "1.1.0", "assets/index.js");
    assert.equal(v1.resolution.ok, true, v1.resolution.error);
    assert.equal(v2.resolution.ok, true, v2.resolution.error);
    assert.equal(v1.asset.body.toString("utf8"), 'console.log("marker:v1");');
    assert.equal(v2.asset.body.toString("utf8"), 'console.log("marker:v2");');

    // The served bytes equal the stored bytes for each pinned version.
    for (const version of ["1.0.0", "1.1.0"]) {
      const stored = fs.readFileSync(
        path.join(harness.storageRoot, "templates", templateId, version, "assets", "index.js")
      );
      const served = await resolveTemplateAsset(templateId, version, "assets/index.js");
      assert.deepEqual(served.asset.body, stored);
    }

    // No silent fallback for an unknown version.
    const unknown = await resolveTemplateAsset(templateId, "9.9.9", "assets/index.js");
    assert.equal(unknown.resolution.ok, false);
    assert.equal(unknown.resolution.failure, "MISSING_ARTIFACT");
  });

  it("rejects submissions without explicit confirmation or admin identity", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();

    const noConfirmation = await submitTemplateRepository(
      submissionInput({ explicitConfirmation: false }),
      harness.deps
    );
    assert.equal(noConfirmation.code, "INVALID_INPUT");

    const noAdmin = await submitTemplateRepository(submissionInput({ adminUserId: "" }), harness.deps);
    assert.equal(noAdmin.code, "INVALID_INPUT");
    assert.equal(templateRecords().length, 0);
  });

  it("keeps the version derivation deterministic and collision free", () => {
    assert.equal(deriveTemplateId("My Cool.Repo!!"), "my-cool-repo");
    assert.equal(deriveTemplateId("@@@"), "");
    assert.equal(deriveNextVersion({ publishedVersions: [] }), "1.0.0");
    assert.equal(deriveNextVersion({ publishedVersions: ["1.0.0"] }), "1.1.0");
    assert.equal(deriveNextVersion({ publishedVersions: ["1.1.0", "1.0.0"] }), "1.2.0");
    assert.equal(
      deriveNextVersion({ declaredVersion: "2.0.0", publishedVersions: ["1.2.0"] }),
      "2.0.0"
    );
    assert.equal(
      deriveNextVersion({ declaredVersion: "1.0.0", publishedVersions: ["1.2.0"] }),
      "1.3.0"
    );
  });
});

describe("Phase 5.16 — production hardening", () => {
  beforeEach(() => resetState());

  it("2. private repository ingestion requires a server-side credential", async () => {
    setRepository("private-org", "secret-template", { marker: "private-1" });
    const anonymous = buildDeps();
    const denied = await submitTemplateRepository(
      submissionInput({ url: "https://github.com/private-org/secret-template" }),
      anonymous.deps
    );
    assert.equal(denied.success, false);
    assert.equal(denied.code, "COMMIT_RESOLUTION_FAILED");
    assert.ok(!denied.message.includes(VALID_READ_TOKEN));

    githubRequests.length = 0;
    const credentialed = buildDeps({ githubAuthToken: VALID_READ_TOKEN });
    const allowed = await submitTemplateRepository(
      submissionInput({ url: "https://github.com/private-org/secret-template" }),
      credentialed.deps
    );
    assert.equal(allowed.success, true, allowed.message);
    assert.equal(allowed.submission.sourceAuthMode, "credentialed");
    assert.ok(githubRequests.length > 0);
    assert.ok(
      githubRequests.every((request) => request.authorization),
      "every GitHub request must carry the server-side credential"
    );
  });

  it("3. invalid credentials fail clearly without leaking the token", async () => {
    setRepository("private-org", "secret-template", { marker: "private-2" });
    const invalidToken = "ghp_invalid_but_long_enough_token_value_123456";
    const harness = buildDeps({ githubAuthToken: invalidToken });
    const result = await submitTemplateRepository(
      submissionInput({ url: "https://github.com/private-org/secret-template" }),
      harness.deps
    );
    assert.equal(result.success, false);
    assert.equal(result.code, "COMMIT_RESOLUTION_FAILED");
    assert.match(result.message, /authentication failed/i);
    assert.ok(!JSON.stringify(result).includes(invalidToken), "the credential must never be echoed");
  });

  it("keeps the credential out of snapshots, manifests and records", async () => {
    setRepository("private-org", "secret-template", { marker: "private-3" });
    const harness = buildDeps({ githubAuthToken: VALID_READ_TOKEN });
    const result = await submitTemplateRepository(
      submissionInput({ url: "https://github.com/private-org/secret-template" }),
      harness.deps
    );
    assert.equal(result.success, true, result.message);

    const snapshotFiles = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else snapshotFiles.push(full);
      }
    };
    walk(harness.snapshotRoot);
    for (const file of snapshotFiles) {
      assert.ok(!fs.readFileSync(file, "utf8").includes(VALID_READ_TOKEN), `token leaked into ${file}`);
    }
    for (const record of templateRecords("private-org/secret-template")) {
      assert.ok(!JSON.stringify(record).includes(VALID_READ_TOKEN), "token leaked into a review record");
    }
    const manifestPath = path.join(
      harness.storageRoot,
      "templates",
      deriveTemplateId("secret-template"),
      "1.0.0",
      "onevue-manifest.json"
    );
    assert.ok(!fs.readFileSync(manifestPath, "utf8").includes(VALID_READ_TOKEN));
  });

  it("5. a branch or tag resolves to the immutable commit that is processed", async () => {
    const sha = setRepository(OWNER, REPO, { marker: "v-ref" });
    const harness = buildDeps();
    const result = await submitTemplateRepository(
      submissionInput({ requestedRef: "release/v1" }),
      harness.deps
    );
    assert.equal(result.success, true, result.message);
    assert.equal(result.submission.commitSha, sha);
    assert.ok(
      githubRequests.some((request) => request.url.includes("/commits/release%2Fv1")),
      "the requested ref must be resolved through the GitHub commits API"
    );
  });

  it("8. concurrent first-time submissions create exactly one template version", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    const [a, b] = await Promise.all([
      submitTemplateRepository(submissionInput(), harness.deps),
      submitTemplateRepository(submissionInput(), harness.deps),
    ]);
    const outcomes = [a.outcome, b.outcome].sort();
    assert.deepEqual(outcomes, ["CREATED", "NO_UPDATE"]);
    const approved = templateRecords(buildRepositoryKey(OWNER, REPO)).filter(
      (record) => record.status === "approved"
    );
    assert.equal(approved.length, 1, "only one submission record may be created");
    assert.equal(approved[0].templateVersion, "1.0.0");
  });

  it("10 & 11. expired leases are recoverable and stale workers cannot release", async () => {
    const key = buildRepositoryKey("lease-org", "lease-repo");
    const now = new Date("2026-10-30T12:00:00.000Z");

    const first = await acquireRepositoryLease(ReviewModel, key, now, 60_000);
    assert.equal(first.acquired, true);
    const blocked = await acquireRepositoryLease(ReviewModel, key, now, 60_000);
    assert.equal(blocked.acquired, false, "an active lease must exclude other workers");

    await expireRepositoryLease(ReviewModel, key);
    const recovered = await acquireRepositoryLease(ReviewModel, key, now, 60_000);
    assert.equal(recovered.acquired, true, "an expired lease must be reclaimable");

    assert.equal(
      await releaseRepositoryLease(ReviewModel, key, first.lease, now),
      false,
      "a stale worker must not release a lease it no longer owns"
    );
    assert.equal(await releaseRepositoryLease(ReviewModel, key, recovered.lease, now), true);
  });

  it("12. an unavailable isolation boundary fails closed before building", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const previous = process.env.ENABLE_ISOLATED_BUILD_EXECUTION;
    delete process.env.ENABLE_ISOLATED_BUILD_EXECUTION;
    try {
      const harness = buildDeps({ noBuildExecutor: true });
      const result = await submitTemplateRepository(submissionInput(), harness.deps);
      assert.equal(result.success, false);
      assert.equal(result.code, "BUILD_BOUNDARY_UNAVAILABLE");
      assert.equal(
        fs.existsSync(path.join(harness.storageRoot, "templates", deriveTemplateId(REPO))),
        false
      );
    } finally {
      if (previous === undefined) delete process.env.ENABLE_ISOLATED_BUILD_EXECUTION;
      else process.env.ENABLE_ISOLATED_BUILD_EXECUTION = previous;
    }
  });

  it("12b. a build timeout fails the submission and keeps it out of the catalog", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    class SlowExecutor {
      async executeBuild({ outputDir }) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { success: true, outputDir };
      }
    }
    const harness = buildDeps({ buildExecutor: new SlowExecutor(), stageTimeoutMs: 60 });
    const result = await submitTemplateRepository(submissionInput(), harness.deps);

    assert.equal(result.success, false);
    assert.equal(result.code, "BUILD_EXECUTION_FAILED");
    assert.match(result.message, /timed out/i);
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    assert.equal(catalog.some((entry) => entry.id === deriveTemplateId(REPO)), false);
  });

  it("15. retrying a failed commit reuses the same version instead of creating a duplicate", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const base = buildDeps();
    const failing = buildDeps({
      harness: base,
      buildExecutor: new MockBuildExecutor({ shouldFail: true }),
    });

    const first = await submitTemplateRepository(submissionInput(), failing.deps);
    assert.equal(first.code, "BUILD_EXECUTION_FAILED");
    assert.equal(first.submission.retryEligible, true);
    const version = first.submission.templateVersion;

    const withoutRetry = await submitTemplateRepository(submissionInput(), failing.deps);
    assert.equal(withoutRetry.code, "EXISTING_INCOMPLETE");
    assert.equal(templateRecords().filter((r) => r.status === "approved").length, 1);

    const retry = buildDeps({ harness: base, buildExecutor: new TrustedPrebuiltExecutor() });
    const second = await submitTemplateRepository(submissionInput({ retry: true }), retry.deps);
    assert.equal(second.success, true, second.message);
    assert.equal(second.submission.templateVersion, version, "retry must reuse the failed version");

    const versions = templateRecords()
      .filter((record) => record.status === "approved" && record.submissionStatus === "catalog_eligible")
      .map((record) => record.templateVersion);
    assert.deepEqual(versions, [version], "no duplicate version may be created by a retry");

    const again = await submitTemplateRepository(submissionInput({ retry: true }), retry.deps);
    assert.equal(again.outcome, "NO_UPDATE", "a successful retry must then be idempotent");

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: retry.storageAdapter });
    const template = catalog.find((entry) => entry.id === deriveTemplateId(REPO));
    assert.deepEqual(template.releases.map((release) => release.version), [version]);
  });

  it("15b. a retry after a post-storage crash recovers the artifact without rebuilding", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const base = buildDeps();
    const first = await submitTemplateRepository(submissionInput(), base.deps);
    assert.equal(first.success, true, first.message);
    const version = first.submission.templateVersion;

    // Simulate a worker that stored the artifact and then crashed before the
    // record reached an approved/catalog-eligible state.
    const record = templateRecords(buildRepositoryKey(OWNER, REPO))[0];
    record.status = "pending_review";
    record.submissionStatus = "build_failed";
    record.error = "simulated crash after storage";

    const recovery = buildDeps({ harness: base });
    const executor = recovery.deps.buildExecutor;
    const buildsBefore = executor.calls;

    const second = await submitTemplateRepository(submissionInput({ retry: true }), recovery.deps);
    assert.equal(second.success, true, JSON.stringify(second));
    assert.equal(second.submission.templateVersion, version, "recovery must reuse the stored version");
    assert.equal(
      second.submission.stages.find((stage) => stage.stage === "ADAPT_BUILD_STORE").detail,
      "recovered existing immutable artifact"
    );
    assert.equal(executor.calls, buildsBefore, "recovery must not rebuild the artifact");

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: base.storageAdapter });
    const template = catalog.find((entry) => entry.id === deriveTemplateId(REPO));
    assert.deepEqual(
      template.releases.map((release) => release.version),
      [version],
      "recovery registers exactly one version"
    );
  });

  it("13 & 14. a failed update keeps the previously published version active", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const base = buildDeps();
    const first = await submitTemplateRepository(submissionInput(), base.deps);
    assert.equal(first.success, true);

    setRepository(OWNER, REPO, { marker: "v2" });
    const failing = buildDeps({
      harness: base,
      buildExecutor: new MockBuildExecutor({ shouldFail: true }),
    });
    const second = await submitTemplateRepository(submissionInput(), failing.deps);
    assert.equal(second.success, false);

    const catalog = await getEligibleCatalogTemplates({ storageAdapter: base.storageAdapter });
    const template = catalog.find((entry) => entry.id === deriveTemplateId(REPO));
    assert.deepEqual(template.releases.map((release) => release.version), ["1.0.0"]);
    assert.equal(template.latestVersion, "1.0.0");

    const latest = await validateEligibleTemplateSelection(
      deriveTemplateId(REPO),
      "latest",
      "1.0.0",
      { storageAdapter: base.storageAdapter }
    );
    assert.equal(latest.valid, true);
    assert.equal(latest.resolvedVersion, "1.0.0");
  });
});

describe("Phase 5.17 — full pipeline and admin experience", () => {
  beforeEach(() => resetState());

  it("runs the complete pipeline: URL -> audit -> provisioning -> isolated build boundary -> artifact -> catalog -> selection -> visitor", async () => {
    setRepository(OWNER, REPO, { marker: "pipeline-v1" });
    const harness = buildDeps();

    const submission = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(submission.success, true, submission.message);
    assert.equal(submission.outcome, "CREATED");

    const stageNames = submission.submission.stages.map((stage) => stage.stage);
    const ordered = [
      "VALIDATE_REPOSITORY",
      "PIN_COMMIT",
      "DUPLICATE_CHECK",
      "AUDIT",
      "BUILD_BOUNDARY",
      "SOURCE_SNAPSHOT",
      "PROVISION",
      "ADAPT_BUILD_STORE",
      "CATALOG",
    ];
    for (const stage of ordered) {
      assert.ok(stageNames.includes(stage), `stage ${stage} must be reported`);
    }
    assert.ok(
      stageNames.indexOf("PROVISION") < stageNames.indexOf("ADAPT_BUILD_STORE"),
      "provisioning precedes the artifact build"
    );
    assert.ok(
      stageNames.indexOf("ADAPT_BUILD_STORE") < stageNames.indexOf("CATALOG"),
      "catalog registration happens last"
    );
    for (const stage of submission.submission.stages) {
      assert.equal(stage.status, "succeeded", `${stage.stage} must succeed`);
    }

    const templateId = submission.submission.templateId;
    const version = submission.submission.templateVersion;

    // Catalog discovery (no hardcoded ids or versions).
    const catalog = await getEligibleCatalogTemplates({ storageAdapter: harness.storageAdapter });
    const template = catalog.find((entry) => entry.id === templateId);
    assert.ok(template, "the template must be discoverable");
    assert.equal(template.latestVersion, version);

    // Student selection resolves the latest approved release and pins it.
    const selection = await validateEligibleTemplateSelection(templateId, "latest", "1.0.0", {
      storageAdapter: harness.storageAdapter,
    });
    assert.equal(selection.valid, true, selection.error);
    assert.equal(selection.resolvedVersion, version);

    // Visitor delivery serves exactly the stored immutable bytes.
    setDefaultStorageAdapter(harness.storageAdapter);
    setArtifactStorageAdapter(harness.storageAdapter);
    const storedIndex = fs.readFileSync(
      path.join(harness.storageRoot, "templates", templateId, version, "index.html")
    );
    const delivered = await resolveTemplateAsset(templateId, version, "index.html");
    assert.equal(delivered.resolution.ok, true, delivered.resolution.error);
    assert.deepEqual(delivered.asset.body, storedIndex);
    assert.ok(delivered.asset.body.toString("utf8").includes("pipeline-v1"));
    assert.match(delivered.asset.cacheControl, /immutable/);
  });

  it("a REVIEW_REQUIRED audit is retryable with an explicit override and reuses the version", async () => {
    setRepository(OWNER, REPO, { marker: "no-license", omitLicense: true });
    const base = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), base.deps);
    assert.equal(blocked.success, false);
    assert.equal(blocked.code, "REVIEW_REQUIRED");
    assert.equal(blocked.submission.retryEligible, true, "review-required must be retryable");

    const stillBlocked = await submitTemplateRepository(
      submissionInput({ policyOverride: true, reason: "Approved after manual license review" }),
      base.deps
    );
    assert.equal(stillBlocked.success, true, stillBlocked.message);
    assert.equal(stillBlocked.submission.templateVersion, blocked.submission.templateVersion);
    assert.equal(stillBlocked.submission.auditOutcome, "REVIEW_REQUIRED");

    const versions = templateRecords()
      .filter((record) => record.submissionStatus === "catalog_eligible")
      .map((record) => record.templateVersion);
    assert.deepEqual(versions, [blocked.submission.templateVersion]);
  });

  it("admin status surfaces retry eligibility and the current stage after a failure", async () => {
    setRepository(OWNER, REPO, { marker: "admin-fail" });
    const base = buildDeps();
    const failing = buildDeps({
      harness: base,
      buildExecutor: new MockBuildExecutor({ shouldFail: true }),
    });
    globalThis.__mockStorageAdapter = base.storageAdapter;
    globalThis.__mockSourceSnapshotStore = base.snapshotStore;
    globalThis.__mockBuildExecutor = failing.deps.buildExecutor;
    globalThis.__mockProvisioningExecutor = failing.deps.provisioningExecutor;
    globalThis.__mockFetch = githubFetch;

    const submitResponse = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true }),
      })
    );
    const submitted = await submitResponse.json();
    assert.equal(submitResponse.status, 422, JSON.stringify(submitted));
    assert.equal(submitted.submission.retryEligible, true);
    assert.equal(submitted.submission.currentStage, "ADAPT_BUILD_STORE");

    const list = await submissionsRoute.GET(
      new Request("http://localhost:3000/api/admin/templates/submissions")
    );
    const body = await list.json();
    const entry = body.submissions.find((row) => row.ingestionId === submitted.submission.ingestionId);
    assert.ok(entry, "the failed submission must be listed");
    assert.equal(entry.retryEligible, true);
    assert.equal(entry.submissionStatus, "build_failed");
    assert.equal(entry.currentStage, "ADAPT_BUILD_STORE");
    assert.ok(entry.stages.every((stage) => stage.stage !== "CATALOG" || stage.status === "failed"));
  });
});

describe("Phase 5.15 — admin submission API", () => {
  beforeEach(() => resetState());

  it("runs the workflow through POST /api/admin/templates/submit", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockProvisioningExecutor = harness.deps.provisioningExecutor;
    globalThis.__mockFetch = githubFetch;

    const response = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${OWNER}/${REPO}`,
          explicitConfirmation: true,
          reason: "Approved for the public catalog",
        }),
      })
    );

    const payload = await response.json();
    assert.equal(response.status, 201, JSON.stringify(payload));
    assert.equal(payload.success, true);
    assert.equal(payload.outcome, "CREATED");
    assert.equal(payload.submission.templateVersion, "1.0.0");
    assert.equal(payload.submission.commitSha, repoState.get(buildRepositoryKey(OWNER, REPO)).sha);
    assert.equal(payload.submission.auditOutcome, "PASS");
    assert.equal(payload.submission.catalogEligible, true);
  });

  it("returns status and processing stages through GET /api/admin/templates/submissions", async () => {
    setRepository(OWNER, REPO, { marker: "v1" });
    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockProvisioningExecutor = harness.deps.provisioningExecutor;
    globalThis.__mockFetch = githubFetch;

    await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true }),
      })
    );

    const list = await submissionsRoute.GET(
      new Request("http://localhost:3000/api/admin/templates/submissions")
    );
    assert.equal(list.status, 200);
    const body = await list.json();
    assert.equal(body.success, true);
    assert.ok(body.count >= 1);
    const entry = body.submissions[0];
    assert.equal(entry.repositoryKey, buildRepositoryKey(OWNER, REPO));
    assert.equal(entry.templateVersion, "1.0.0");
    assert.equal(entry.submissionStatus, "catalog_eligible");
    assert.equal(entry.catalogEligible, true);
    assert.ok(entry.stages.some((stage) => stage.stage === "AUDIT" && stage.status === "succeeded"));
    assert.ok(entry.stages.some((stage) => stage.stage === "CATALOG" && stage.status === "succeeded"));
  });

  it("rejects non-admin submissions with HTTP 403", async () => {
    authState.admin = false;
    const response = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true }),
      })
    );
    assert.equal(response.status, 403);
    assert.equal(templateRecords().length, 0);
  });

  it("requires explicit confirmation at the API boundary", async () => {
    const harness = buildDeps();
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    const response = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `https://github.com/${OWNER}/${REPO}` }),
      })
    );
    assert.equal(response.status, 400);
    const payload = await response.json();
    assert.equal(payload.code, "INVALID_INPUT");
  });

  it("regression: submits https://github.com/codewithsadee/vcard-personal-portfolio.git on master branch with valid sourceUrl on lock document", async () => {
    const vcardOwner = "codewithsadee";
    const vcardRepo = "vcard-personal-portfolio";
    setRepository(vcardOwner, vcardRepo, { marker: "vcard-master" });
    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockProvisioningExecutor = harness.deps.provisioningExecutor;
    globalThis.__mockFetch = githubFetch;

    const response = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://github.com/codewithsadee/vcard-personal-portfolio.git",
          ref: "master",
          explicitConfirmation: true,
          reason: "Testing vcard-personal-portfolio master branch submission",
        }),
      })
    );

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.outcome, "CREATED");
    assert.equal(payload.submission.sourceUrl, "https://github.com/codewithsadee/vcard-personal-portfolio");

    // Verify repository lease lock document has valid non-empty sourceUrl
    const lockKey = `repo_lock:${buildRepositoryKey(vcardOwner, vcardRepo)}`;
    const lockRecord = modelStores.TemplateIngestionReview.find((r) => r.ingestionId === lockKey);
    assert.ok(lockRecord, "Lock record must exist");
    assert.equal(lockRecord.sourceUrl, "https://github.com/codewithsadee/vcard-personal-portfolio");
    assert.notEqual(lockRecord.sourceUrl, "");
    assert.equal(typeof lockRecord.sourceUrl, "string");
  });

  it("regression: accepts sourceUrl in payload and submits successfully", async () => {
    const vcardOwner = "codewithsadee";
    const vcardRepo = "vcard-personal-portfolio-alt";
    setRepository(vcardOwner, vcardRepo, { marker: "vcard-alt" });
    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockProvisioningExecutor = harness.deps.provisioningExecutor;
    globalThis.__mockFetch = githubFetch;

    const response = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: "https://github.com/codewithsadee/vcard-personal-portfolio-alt.git",
          ref: "master",
          explicitConfirmation: true,
        }),
      })
    );

    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.outcome, "CREATED");
  });

  it("regression: retry flow handles review_required with retry and policyOverride, prevents duplicates, and blocks ineligible retries", async () => {
    const owner = "codewithsadee";
    const repo = "vcard-retry-suite";
    const key = buildRepositoryKey(owner, repo);
    setRepository(owner, repo, { marker: "v1", license: "MIT" });

    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockProvisioningExecutor = harness.deps.provisioningExecutor;
    globalThis.__mockFetch = githubFetch;

    // Simulate an initial submission that reached review_required (e.g. license or dependency flagged)
    const initialRecord = {
      ingestionId: "ing_initial_review_req",
      adminUserId: "000000000000000000000000",
      repositoryKey: key,
      sourceUrl: `https://github.com/${owner}/${repo}`,
      commitSha: repoState.get(key).sha,
      templateId: "vcard-retry-suite",
      templateVersion: "1.0.0",
      auditReport: { outcome: "REVIEW_REQUIRED", summary: "Dependencies need review" },
      status: "rejected",
      submissionStatus: "review_required",
      stages: [{ stage: "AUDIT", status: "review_required", at: new Date().toISOString() }],
    };
    modelStores.TemplateIngestionReview.push(initialRecord);

    // 1. Submitting without retry or policyOverride returns HTTP 409 EXISTING_INCOMPLETE
    const resWithoutRetry = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${owner}/${repo}`,
          explicitConfirmation: true,
        }),
      })
    );
    assert.equal(resWithoutRetry.status, 409);
    const bodyIncomplete = await resWithoutRetry.json();
    assert.equal(bodyIncomplete.code, "EXISTING_INCOMPLETE");
    assert.equal(bodyIncomplete.submission.retryEligible, true);

    // 2. Retry with retry: true AND policyOverride: true succeeds and reuses version 1.0.0
    const resWithRetry = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${owner}/${repo}`,
          policyOverride: true,
          retry: true,
          reason: "Approved dependencies after administrative inspection",
          explicitConfirmation: true,
        }),
      })
    );
    assert.equal(resWithRetry.status, 201);
    const bodySuccess = await resWithRetry.json();
    assert.equal(bodySuccess.success, true);
    assert.equal(bodySuccess.submission.templateVersion, "1.0.0");
    assert.equal(bodySuccess.submission.submissionStatus, "catalog_eligible");

    // 3. Submitting again with retry: true is idempotent (NO_UPDATE, duplicate prevented)
    const resDuplicate = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${owner}/${repo}`,
          retry: true,
          explicitConfirmation: true,
        }),
      })
    );
    assert.equal(resDuplicate.status, 200);
    const bodyDuplicate = await resDuplicate.json();
    assert.equal(bodyDuplicate.outcome, "NO_UPDATE");
    assert.equal(bodyDuplicate.code, "DUPLICATE_REPOSITORY");

    // 4. Ineligible retry: retry: true on a fresh commit with NO prior submission returns HTTP 422 RETRY_INELIGIBLE
    const freshOwner = "codewithsadee";
    const freshRepo = "vcard-fresh-repo";
    setRepository(freshOwner, freshRepo, { marker: "fresh" });
    const resFreshRetry = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${freshOwner}/${freshRepo}`,
          retry: true,
          explicitConfirmation: true,
        }),
      })
    );
    assert.equal(resFreshRetry.status, 422);
    const bodyFreshRetry = await resFreshRetry.json();
    assert.equal(bodyFreshRetry.code, "RETRY_INELIGIBLE");

    // 5. Ineligible retry: retry: true on an audit_rejected submission returns HTTP 422 RETRY_INELIGIBLE
    const rejectedOwner = "codewithsadee";
    const rejectedRepo = "vcard-rejected-repo";
    const rejectedKey = buildRepositoryKey(rejectedOwner, rejectedRepo);
    setRepository(rejectedOwner, rejectedRepo, { marker: "rejected" });
    modelStores.TemplateIngestionReview.push({
      ingestionId: "ing_audit_rejected",
      adminUserId: "000000000000000000000000",
      repositoryKey: rejectedKey,
      sourceUrl: `https://github.com/${rejectedOwner}/${rejectedRepo}`,
      commitSha: repoState.get(rejectedKey).sha,
      templateId: "vcard-rejected-repo",
      templateVersion: "1.0.0",
      auditReport: { outcome: "REJECT", summary: "Copyleft GPL restricted license" },
      status: "rejected",
      submissionStatus: "audit_rejected",
      stages: [{ stage: "AUDIT", status: "failed", at: new Date().toISOString() }],
    });

    const resIneligibleRetry = await submitRoute.POST(
      new Request("http://localhost:3000/api/admin/templates/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${rejectedOwner}/${rejectedRepo}`,
          retry: true,
          explicitConfirmation: true,
        }),
      })
    );
    assert.equal(resIneligibleRetry.status, 422);
    const bodyIneligibleRetry = await resIneligibleRetry.json();
    assert.equal(bodyIneligibleRetry.code, "RETRY_INELIGIBLE");
  });

  it("regression: local development without token resolves mock provisioning and clearly marks mock URL and stages", async () => {
    const owner = "mockdev";
    const repo = "template-local-mock";
    setRepository(owner, repo, { marker: "mock-dev-v1" });
    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockFetch = githubFetch;
    // Explicitly delete mockProvisioningExecutor so route resolves through resolveProvisioningExecutor(process.env)
    delete globalThis.__mockProvisioningExecutor;

    const prevEnv = process.env.NODE_ENV;
    const prevLive = process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
    const prevToken = process.env.GITHUB_PROVISIONING_TOKEN;
    try {
      process.env.NODE_ENV = "development";
      delete process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
      delete process.env.GITHUB_PROVISIONING_TOKEN;

      const res = await submitRoute.POST(
        new Request("http://localhost:3000/api/admin/templates/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: `https://github.com/${owner}/${repo}`,
            explicitConfirmation: true,
            reason: "Local dev test with mock provisioning",
          }),
        })
      );
      // Development mode still resolves the mock executor and still labels the
      // destination and stage as mock, but mock provisioning can no longer
      // satisfy production catalog eligibility, so the release is withheld.
      assert.equal(res.status, 422);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.submission.catalogEligible, false);
      assert.equal(data.submission.submissionStatus, "catalog_registration_failed");
      assert.match(data.submission.destinationUrl, /^mock:\/\/local-development\//);

      const provStage = data.submission.stages.find((s) => s.stage === "PROVISION");
      assert.ok(provStage);
      assert.equal(provStage.status, "succeeded");
      assert.match(provStage.detail, /local development mock/i);

      // The gate must say so, rather than silently omitting the release.
      const eligibility = await describeCatalogEligibility(
        {
          ...data.submission,
          provisioningRecord: {
            status: "provisioned",
            destinationUrl: data.submission.destinationUrl,
            provenance: { isMock: true, mirrorType: "local_mock" },
          },
        },
        { storageAdapter: harness.storageAdapter }
      );
      assert.equal(eligibility.eligible, false);
      assert.ok(
        eligibility.blockers.some((b) => b.code === "PROVISIONING_MODE_MOCK"),
        `expected a mock-provisioning blocker, got ${JSON.stringify(eligibility.blockers)}`
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevLive !== undefined) process.env.ENABLE_LIVE_GITHUB_PROVISIONING = prevLive;
      else delete process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
      if (prevToken !== undefined) process.env.GITHUB_PROVISIONING_TOKEN = prevToken;
      else delete process.env.GITHUB_PROVISIONING_TOKEN;
    }
  });

  it("regression: production mode without live credentials fails closed with HTTP 503 PROVISIONING_UNAVAILABLE", async () => {
    const owner = "prodsafe";
    const repo = "template-prod-fail";
    setRepository(owner, repo, { marker: "prod-safe-v1" });
    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockFetch = githubFetch;
    delete globalThis.__mockProvisioningExecutor;

    const prevEnv = process.env.NODE_ENV;
    const prevLive = process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
    const prevToken = process.env.GITHUB_PROVISIONING_TOKEN;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
      delete process.env.GITHUB_PROVISIONING_TOKEN;

      const res = await submitRoute.POST(
        new Request("http://localhost:3000/api/admin/templates/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: `https://github.com/${owner}/${repo}`,
            explicitConfirmation: true,
          }),
        })
      );
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, "PROVISIONING_UNAVAILABLE");
      assert.equal(data.submission.submissionStatus, "provisioning_unavailable");
      assert.match(data.message, /GitHub provisioning is not configured/i);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevLive !== undefined) process.env.ENABLE_LIVE_GITHUB_PROVISIONING = prevLive;
      else delete process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
      if (prevToken !== undefined) process.env.GITHUB_PROVISIONING_TOKEN = prevToken;
      else delete process.env.GITHUB_PROVISIONING_TOKEN;
    }
  });

  it("regression: explicit live provisioning with missing credentials in development fails closed", async () => {
    const owner = "explicitlive";
    const repo = "template-live-fail";
    setRepository(owner, repo, { marker: "live-fail-v1" });
    const harness = buildDeps();
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockFetch = githubFetch;
    delete globalThis.__mockProvisioningExecutor;

    const prevEnv = process.env.NODE_ENV;
    const prevLive = process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
    const prevToken = process.env.GITHUB_PROVISIONING_TOKEN;
    try {
      process.env.NODE_ENV = "development";
      process.env.ENABLE_LIVE_GITHUB_PROVISIONING = "true";
      delete process.env.GITHUB_PROVISIONING_TOKEN;

      const res = await submitRoute.POST(
        new Request("http://localhost:3000/api/admin/templates/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: `https://github.com/${owner}/${repo}`,
            explicitConfirmation: true,
          }),
        })
      );
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.equal(data.code, "PROVISIONING_UNAVAILABLE");
      assert.equal(data.submission.submissionStatus, "provisioning_unavailable");
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevLive !== undefined) process.env.ENABLE_LIVE_GITHUB_PROVISIONING = prevLive;
      else delete process.env.ENABLE_LIVE_GITHUB_PROVISIONING;
      if (prevToken !== undefined) process.env.GITHUB_PROVISIONING_TOKEN = prevToken;
      else delete process.env.GITHUB_PROVISIONING_TOKEN;
    }
  });

  it("regression: reproduces and prevents MongoDB update path conflict at provisioningRecord.provenance", async () => {
    // 1. Direct path conflict reproduction: MongoDB forbids updating both a parent and its subfield in the same $set
    await assert.rejects(
      async () => {
        await ReviewModel.updateOne(
          { ingestionId: "ing_conflict_test" },
          {
            $set: {
              "provisioningRecord.provenance": { isMock: true },
              "provisioningRecord.provenance.lifecycle": { status: "APPROVED" },
            },
          }
        );
      },
      (err) => {
        assert.equal(err.name, "MongoServerError");
        assert.match(err.message, /Updating the path 'provisioningRecord\.provenance\.lifecycle' would create a conflict at 'provisioningRecord\.provenance'/);
        return true;
      }
    );

    // 2. End-to-end workflow execution executes non-overlapping updates without path conflict
    const owner = "crypticani";
    const repo = "portfolio";
    const sha = setRepository(owner, repo, { marker: "crypticani-v1" });
    const harness = buildDeps();

    const res = await submitTemplateRepository(
      submissionInput({ url: `https://github.com/${owner}/${repo}` }),
      harness.deps
    );

    assert.equal(res.success, true);
    assert.equal(res.outcome, "CREATED");
    assert.equal(res.submission.submissionStatus, "catalog_eligible");

    const record = await ReviewModel.findOne({ ingestionId: res.submission.ingestionId }).lean();
    assert.ok(record);
    assert.equal(record.provisioningRecord.status, "provisioned");
    assert.ok(record.provisioningRecord.provenance);
    assert.equal(record.provisioningRecord.provenance.isMock, false);
    assert.equal(record.provisioningRecord.provenance.provisioner, "LiveGitHubProvisioningExecutor");
    assert.equal(record.provisioningRecord.provenance.mirrorType, "github_private");
    assert.ok(record.provisioningRecord.provenance.lifecycle);
    assert.equal(record.provisioningRecord.provenance.lifecycle.status, "CATALOG_ELIGIBLE");
    assert.equal(record.provisioningRecord.provenance.lifecycle.sourceCommitSha, sha);

    // 3. Subsequent lifecycle update does not conflict with provenance
    await ReviewModel.updateOne(
      { ingestionId: res.submission.ingestionId },
      {
        $set: {
          "provisioningRecord.provenance.lifecycle.status": "VERIFIED",
        },
      }
    );
    const updated = await ReviewModel.findOne({ ingestionId: res.submission.ingestionId }).lean();
    assert.equal(updated.provisioningRecord.provenance.lifecycle.status, "VERIFIED");
    assert.equal(updated.provisioningRecord.provenance.provisioner, "LiveGitHubProvisioningExecutor");
  });
});

// ---------------------------------------------------------------------------
// Phase 5.15 — stale-processing recovery regression suite
// ---------------------------------------------------------------------------
const {
  isStaleProcessing,
  isSubmissionRetryEligible: isSubmissionRetryEligibleFn,
  STALE_PROCESSING_WINDOW_MS,
} = require("../lib/template-submission.ts");

describe("Phase 5.15 — stale-processing recovery", () => {
  beforeEach(() => resetState());

  after(() => {
    setDefaultStorageAdapter(null);
    setArtifactStorageAdapter(null);
    for (const dir of tempRoots) {
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  // ---------------------------------------------------------------------------
  // Helper: seed a stuck processing record with a configurable age and lease.
  // ---------------------------------------------------------------------------
  function seedProcessingRecord(options = {}) {
    const owner = options.owner || "stale-org";
    const repo = options.repo || "stale-repo";
    const key = buildRepositoryKey(owner, repo);
    const sha = options.sha || setRepository(owner, repo, { marker: options.marker || "stale-v1" });
    const updatedAt = options.updatedAt || new Date(Date.now() - (STALE_PROCESSING_WINDOW_MS + 60_000));
    const record = {
      ingestionId: options.ingestionId || `ing_stale_${Math.random().toString(36).slice(2)}`,
      adminUserId: "000000000000000000000000",
      repositoryKey: key,
      sourceUrl: `https://github.com/${owner}/${repo}`,
      commitSha: sha,
      templateId: options.templateId || repo,
      templateVersion: options.templateVersion || "1.0.0",
      auditReport: { outcome: "REVIEW_REQUIRED", summary: { passed: false, mediumCount: 1 } },
      status: "approved",
      submissionStatus: "processing",
      requestedRef: "main",
      sourceAuthMode: "public",
      stages: [
        { stage: "VALIDATE_REPOSITORY", status: "succeeded", at: updatedAt.toISOString() },
        { stage: "PIN_COMMIT", status: "succeeded", detail: sha, at: updatedAt.toISOString() },
        { stage: "DUPLICATE_CHECK", status: "succeeded", at: updatedAt.toISOString() },
        { stage: "AUDIT", status: "succeeded", detail: "REVIEW_REQUIRED", at: updatedAt.toISOString() },
        { stage: "BUILD_BOUNDARY", status: "succeeded", at: updatedAt.toISOString() },
        { stage: "SOURCE_SNAPSHOT", status: "succeeded", at: updatedAt.toISOString() },
      ],
      provisioningRecord: {
        status: "unprovisioned",
        destinationOrg: "qubort-tech",
        destinationRepo: "",
        destinationUrl: "",
        visibility: "private",
        provisionedAt: null,
        error: "",
        provenance: options.provenance || null,
      },
      createdAt: updatedAt,
      updatedAt,
    };
    modelStores.TemplateIngestionReview.push(record);
    return { owner, repo, key, sha, record };
  }

  // ---------------------------------------------------------------------------
  // Test 1: Active processing (within the 15-min window) cannot be retried.
  // ---------------------------------------------------------------------------
  it("regression: active processing (within 15-min window) is not retry-eligible", () => {
    const now = new Date();
    const activeRecord = {
      submissionStatus: "processing",
      status: "approved",
      updatedAt: new Date(now.getTime() - 5 * 60 * 1000), // 5 min ago — still active
      provisioningRecord: { provenance: null },
    };
    assert.equal(
      isStaleProcessing(activeRecord, now),
      false,
      "a record updated 5 min ago must not be classified as stale"
    );
    assert.equal(
      isSubmissionRetryEligibleFn(activeRecord, false, now),
      false,
      "an active processing record must not be retry-eligible"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 2: Stale processing (outside 15-min window, no lease) is retry-eligible.
  // ---------------------------------------------------------------------------
  it("regression: stale processing (outside 15-min window, no lease) is retry-eligible", () => {
    const now = new Date();
    const staleRecord = {
      submissionStatus: "processing",
      status: "approved",
      updatedAt: new Date(now.getTime() - (STALE_PROCESSING_WINDOW_MS + 60_000)), // 16 min ago
      provisioningRecord: { provenance: null },
    };
    assert.equal(
      isStaleProcessing(staleRecord, now),
      true,
      "a record updated 16 min ago with no lease must be classified as stale"
    );
    assert.equal(
      isSubmissionRetryEligibleFn(staleRecord, false, now),
      true,
      "a stale processing record with no active lease must be retry-eligible"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3: Stale processing with a valid lifecycle lease cannot be recovered.
  // ---------------------------------------------------------------------------
  it("regression: stale processing with a live lifecycle lease is not retry-eligible", () => {
    const now = new Date();
    const liveLeaseRecord = {
      submissionStatus: "processing",
      status: "approved",
      updatedAt: new Date(now.getTime() - (STALE_PROCESSING_WINDOW_MS + 60_000)), // 16 min ago
      provisioningRecord: {
        provenance: {
          lifecycle: {
            status: "IN_PROGRESS",
            leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(), // lease valid for 5 more min
          },
        },
      },
    };
    assert.equal(
      isStaleProcessing(liveLeaseRecord, now),
      false,
      "a record with a live IN_PROGRESS lifecycle lease must not be classified as stale"
    );
    assert.equal(
      isSubmissionRetryEligibleFn(liveLeaseRecord, false, now),
      false,
      "a processing record with a live lease must not be retry-eligible"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: End-to-end — stale processing record is recovered by retry=true.
  //          The retry reuses the original version and completes the pipeline.
  // ---------------------------------------------------------------------------
  it("regression: retry=true on a stale processing record resumes the pipeline end-to-end", async () => {
    const owner = "stale-org";
    const repo = "stale-repo";
    const { sha } = seedProcessingRecord({ owner, repo, templateId: repo, templateVersion: "1.0.0" });
    const harness = buildDeps();

    // The harness now() must be far enough ahead that the stuck record is stale.
    // The record's updatedAt is STALE_PROCESSING_WINDOW_MS + 60s in the past.
    // The harness already uses a fixed now; override to ensure staleness.
    const staleNow = new Date(Date.now());
    const deps = {
      ...harness.deps,
      now: () => staleNow,
    };

    const result = await submitTemplateRepository(
      {
        url: `https://github.com/${owner}/${repo}`,
        retry: true,
        policyOverride: true,
        reason: "Approved after admin review of MIT license evidence",
        explicitConfirmation: true,
        adminUserId: adminUser._id,
      },
      deps
    );

    assert.equal(result.success, true, `Expected success, got: ${result.message}`);
    assert.equal(result.outcome, "CREATED", "recovery of stale processing should produce CREATED outcome");
    assert.equal(result.submission.templateVersion, "1.0.0", "retry must reuse the original version");
    assert.equal(result.submission.submissionStatus, "catalog_eligible");

    // The new record must exist in the store.
    const allRecords = templateRecords(buildRepositoryKey(owner, repo));
    assert.ok(
      allRecords.some((r) => r.submissionStatus === "catalog_eligible" && r.templateVersion === "1.0.0"),
      "a catalog_eligible record for 1.0.0 must exist after recovery"
    );

    // The original stuck record must still exist (not deleted or mutated to catalog_eligible).
    assert.ok(
      allRecords.some((r) => r.submissionStatus === "processing"),
      "the original stuck processing record must still exist as a historical artifact"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 5: Concurrent recovery — only one of two simultaneous retry attempts succeeds.
  //         The repository lock prevents both from creating duplicate versions.
  // ---------------------------------------------------------------------------
  it("regression: concurrent recovery attempts are serialized; only one succeeds", async () => {
    const owner = "stale-concurrent-org";
    const repo = "stale-concurrent-repo";
    seedProcessingRecord({ owner, repo, templateId: repo, templateVersion: "1.0.0" });
    const staleNow = new Date(Date.now());

    const makeAttempt = () => {
      const harness = buildDeps();
      const deps = { ...harness.deps, now: () => staleNow };
      return submitTemplateRepository(
        {
          url: `https://github.com/${owner}/${repo}`,
          retry: true,
          policyOverride: true,
          reason: "Concurrent recovery test",
          explicitConfirmation: true,
          adminUserId: adminUser._id,
        },
        deps
      );
    };

    const [first, second] = await Promise.all([makeAttempt(), makeAttempt()]);

    const successes = [first, second].filter((r) => r.success);
    const failures = [first, second].filter((r) => !r.success);

    assert.equal(successes.length, 1, "exactly one concurrent recovery attempt must succeed");
    assert.equal(failures.length, 1, "exactly one concurrent recovery attempt must be blocked");
    assert.equal(successes[0].submission.templateVersion, "1.0.0", "the successful recovery must use version 1.0.0");

    // Verify no duplicate catalog-eligible records were created.
    const eligible = templateRecords(buildRepositoryKey(owner, repo)).filter(
      (r) => r.submissionStatus === "catalog_eligible" && r.templateVersion === "1.0.0"
    );
    assert.equal(eligible.length, 1, "exactly one catalog_eligible record for 1.0.0 must exist");
  });

  // ---------------------------------------------------------------------------
  // Test 6: Failed recovery (e.g. build failure) leaves the new record in a
  //         retryable state, not the original stuck record.
  // ---------------------------------------------------------------------------
  it("regression: a failed recovery leaves the new record retryable (not the stuck original)", async () => {
    const owner = "stale-fail-org";
    const repo = "stale-fail-repo";
    seedProcessingRecord({ owner, repo, templateId: repo, templateVersion: "1.0.0" });
    const staleNow = new Date(Date.now());

    class AlwaysFailBuildExecutor {
      async executeBuild() {
        return { success: false, error: "simulated build failure during recovery test" };
      }
    }

    const harness = buildDeps({ buildExecutor: new AlwaysFailBuildExecutor() });
    const deps = { ...harness.deps, now: () => staleNow };

    const result = await submitTemplateRepository(
      {
        url: `https://github.com/${owner}/${repo}`,
        retry: true,
        policyOverride: true,
        reason: "Recovery attempt that will fail at build",
        explicitConfirmation: true,
        adminUserId: adminUser._id,
      },
      deps
    );

    // Recovery attempt fails at build.
    assert.equal(result.success, false);
    assert.equal(result.code, "BUILD_EXECUTION_FAILED");

    // The NEW record (from the recovery attempt) should have submissionStatus=build_failed.
    // The ORIGINAL stuck record should still have submissionStatus=processing.
    const key = buildRepositoryKey(owner, repo);
    const all = templateRecords(key);
    assert.ok(
      all.some((r) => r.submissionStatus === "build_failed" && r.templateVersion === "1.0.0"),
      "the failed recovery record must have submissionStatus=build_failed"
    );
    assert.ok(
      all.some((r) => r.submissionStatus === "processing"),
      "the original stuck record must still be present"
    );

    // The build_failed record must itself be retry-eligible (can retry again).
    const failedRecord = all.find((r) => r.submissionStatus === "build_failed");
    assert.ok(failedRecord, "a build_failed record must exist");
    assert.equal(
      isSubmissionRetryEligibleFn(failedRecord, false),
      true,
      "a build_failed record must be retry-eligible (no now needed)"
    );
  });
});

/* =========================================================================
   Phase 1 & 2 — Source snapshot retention and the human review state machine
   =========================================================================

   Phase 1: a submission must keep the exact source a reviewer has to judge,
   even when the audit outcome is not a clean pass, and a retry of the same
   commit must not write a second, identical copy.

   Phase 2: REVIEW_REQUIRED is a human-review state, so the record must stay
   'pending_review' and the administrator's Approve/Reject interface must be
   able to act on it. Every decision is justified, no decision can be made
   twice, and the audit history survives.
   ========================================================================= */

describe("Phase 1 & 2 — source snapshot retention and human review state", () => {
  beforeEach(() => resetState());

  after(() => {
    for (const dir of tempRoots) {
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  /** The snapshot directories that exist under a snapshot root. */
  function snapshotIds(root) {
    const dir = path.join(root, "snapshots");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort();
  }

  function reviewRequest(body) {
    return new Request("http://localhost:3000/api/admin/templates/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * A model whose save() always fails, used to exercise the rollback of a
   * snapshot whose submission record could not be persisted.
   */
  function withFailingSave(Model) {
    function Failing(data) {
      const doc = new Model(data);
      doc.save = async function () {
        const error = new Error("simulated persistence failure");
        error.name = "ValidationError";
        throw error;
      };
      return doc;
    }
    Failing.find = Model.find;
    Failing.findOne = Model.findOne;
    Failing.updateOne = Model.updateOne;
    Failing.findOneAndUpdate = Model.findOneAndUpdate;
    Failing.deleteMany = Model.deleteMany;
    return Failing;
  }

  function recordFor(ingestionId) {
    return templateRecords().find((record) => record.ingestionId === ingestionId);
  }

  it("keeps a REVIEW_REQUIRED submission in pending_review and retains its reviewed source", async () => {
    setRepository(OWNER, REPO, { marker: "review-required", omitLicense: true });
    const harness = buildDeps();

    const result = await submitTemplateRepository(submissionInput(), harness.deps);

    assert.equal(result.success, false);
    assert.equal(result.code, "REVIEW_REQUIRED");
    assert.equal(
      result.submission.reviewStatus,
      "pending_review",
      "a REVIEW_REQUIRED result is a human-review state, not a rejection"
    );
    assert.notEqual(result.submission.reviewStatus, "rejected");
    assert.ok(result.submission.sourceSnapshotId, "the retained snapshot must be referenced");

    const record = recordFor(result.submission.ingestionId);
    assert.ok(record);
    assert.equal(record.status, "pending_review");
    assert.equal(record.submissionStatus, "review_required");
    assert.equal(record.sourceSnapshot.snapshotId, result.submission.sourceSnapshotId);

    // The snapshot exists on disk and still verifies against its own digest.
    assert.deepEqual(snapshotIds(harness.snapshotRoot), [result.submission.sourceSnapshotId]);
    const verified = await harness.snapshotStore.verify(record.sourceSnapshot);
    assert.equal(verified.ref.snapshotId, result.submission.sourceSnapshotId);
    assert.equal(verified.ref.commitSha, result.submission.commitSha);
    assert.equal(verified.ref.auditOutcome, "REVIEW_REQUIRED");

    // The snapshot holds the exact source that was audited.
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(verified.sourceDir, "package.json"), "utf8")
    );
    assert.equal(packageJson.name, REPO);
    assert.equal(
      fs.existsSync(path.join(verified.sourceDir, "LICENSE")),
      false,
      "the audited source had no licence file, so the snapshot must not have one"
    );
  });

  it("reuses the retained snapshot on a retry instead of writing a second copy", async () => {
    setRepository(OWNER, REPO, { marker: "review-required", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(blocked.code, "REVIEW_REQUIRED");
    const snapshotId = blocked.submission.sourceSnapshotId;
    assert.deepEqual(snapshotIds(harness.snapshotRoot), [snapshotId]);

    const continued = await submitTemplateRepository(
      submissionInput({ policyOverride: true, reason: "Licence absence reviewed and accepted." }),
      harness.deps
    );
    assert.equal(continued.success, true, continued.message);

    // One snapshot only: the retry reused the source that was already retained.
    assert.deepEqual(snapshotIds(harness.snapshotRoot), [snapshotId]);
    assert.equal(continued.submission.sourceSnapshotId, snapshotId);

    const record = recordFor(continued.submission.ingestionId);
    const verified = await harness.snapshotStore.verify(record.sourceSnapshot);
    assert.equal(verified.ref.snapshotId, snapshotId);
  });

  it("replaces a snapshot that no longer verifies instead of trusting it", async () => {
    setRepository(OWNER, REPO, { marker: "tampered", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(blocked.code, "REVIEW_REQUIRED");
    const snapshotId = blocked.submission.sourceSnapshotId;
    const original = recordFor(blocked.submission.ingestionId).sourceSnapshot;

    // Tamper with the retained source, the way an out-of-band modification would.
    fs.writeFileSync(
      path.join(harness.snapshotRoot, "snapshots", snapshotId, "source", "TEMPLATE_MARKER"),
      "tampered\n",
      "utf8"
    );
    await assert.rejects(() => harness.snapshotStore.verify(original));

    const continued = await submitTemplateRepository(
      submissionInput({ policyOverride: true, reason: "Reviewed after inspection." }),
      harness.deps
    );
    assert.equal(continued.success, true, continued.message);
    assert.notEqual(
      continued.submission.sourceSnapshotId,
      snapshotId,
      "a snapshot that no longer verifies must not be reused"
    );
    assert.equal(snapshotIds(harness.snapshotRoot).length, 2);

    const record = recordFor(continued.submission.ingestionId);
    const verified = await harness.snapshotStore.verify(record.sourceSnapshot);
    assert.equal(verified.ref.snapshotId, continued.submission.sourceSnapshotId);
  });

  it("rolls back the snapshot it created when the submission record cannot be persisted", async () => {
    setRepository(OWNER, REPO, { marker: "rollback" });
    const harness = buildDeps();
    const Failing = withFailingSave(ReviewModel);

    await assert.rejects(
      () => submitTemplateRepository(submissionInput(), { ...harness.deps, reviewModel: Failing }),
      /simulated persistence failure/
    );

    assert.deepEqual(
      snapshotIds(harness.snapshotRoot),
      [],
      "the snapshot created by the failed run must be rolled back"
    );
  });

  it("never rolls back a snapshot that an earlier attempt already persisted", async () => {
    setRepository(OWNER, REPO, { marker: "keep-snapshot", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(blocked.code, "REVIEW_REQUIRED");
    const snapshotId = blocked.submission.sourceSnapshotId;
    assert.deepEqual(snapshotIds(harness.snapshotRoot), [snapshotId]);

    const Failing = withFailingSave(ReviewModel);
    await assert.rejects(
      () =>
        submitTemplateRepository(
          submissionInput({ policyOverride: true, reason: "Reviewed and accepted." }),
          { ...harness.deps, reviewModel: Failing }
        ),
      /simulated persistence failure/
    );

    assert.deepEqual(
      snapshotIds(harness.snapshotRoot),
      [snapshotId],
      "the retained snapshot of the earlier attempt must survive a later failure"
    );
  });

  it("lets an administrator approve a REVIEW_REQUIRED submission through the review interface", async () => {
    setRepository(OWNER, REPO, { marker: "approve-me", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(blocked.code, "REVIEW_REQUIRED");

    const response = await reviewRoute.POST(
      reviewRequest({
        ingestionId: blocked.submission.ingestionId,
        decision: "approve",
        policyOverride: true,
        reason: "Licence absence reviewed manually and accepted.",
      })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.review.status, "approved");
    assert.equal(body.review.decision.decision, "approve");
    assert.equal(body.review.auditOutcome, "REVIEW_REQUIRED");

    const record = recordFor(blocked.submission.ingestionId);
    assert.equal(record.status, "approved");
    assert.equal(record.submissionStatus, "approved");
    assert.equal(record.error, "");

    // The audit history survives the decision: the hand-off and the decision.
    assert.equal(record.reviewHistory.length, 2);
    assert.equal(record.reviewHistory[0].decision, "review_required");
    assert.equal(record.reviewHistory[0].auditOutcome, "REVIEW_REQUIRED");
    assert.equal(record.reviewHistory[1].decision, "approve");
    assert.equal(record.reviewHistory[1].auditOutcome, "REVIEW_REQUIRED");
    assert.equal(record.reviewHistory[1].reason, "Licence absence reviewed manually and accepted.");
  });

  it("lets an administrator reject a REVIEW_REQUIRED submission with a reason", async () => {
    setRepository(OWNER, REPO, { marker: "reject-me", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(blocked.code, "REVIEW_REQUIRED");

    const reason = "The template has no licence and must not be published.";
    const response = await reviewRoute.POST(
      reviewRequest({ ingestionId: blocked.submission.ingestionId, decision: "reject", reason })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.review.status, "rejected");
    assert.equal(body.review.decision.reason, reason);

    const record = recordFor(blocked.submission.ingestionId);
    assert.equal(record.status, "rejected");
    assert.equal(record.submissionStatus, "rejected");
    assert.equal(record.error, reason);
    assert.equal(record.reviewHistory.length, 2);
    assert.equal(record.reviewHistory[1].decision, "reject");
  });

  it("refuses an approval that has no justification reason", async () => {
    setRepository(OWNER, REPO, { marker: "no-reason", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    const response = await reviewRoute.POST(
      reviewRequest({
        ingestionId: blocked.submission.ingestionId,
        decision: "approve",
        policyOverride: true,
        reason: "   ",
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "REASON_REQUIRED");

    // The record is untouched: a refused decision changes nothing.
    const record = recordFor(blocked.submission.ingestionId);
    assert.equal(record.status, "pending_review");
    assert.equal(record.reviewHistory.length, 1);
  });

  it("refuses a rejection that has no justification reason", async () => {
    setRepository(OWNER, REPO, { marker: "no-reason-reject", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    const response = await reviewRoute.POST(
      reviewRequest({ ingestionId: blocked.submission.ingestionId, decision: "reject" })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.message, /reason is required when rejecting/i);
    // Every refusal on this route carries the same machine-readable shape, so
    // a client can branch on the code instead of on the message text.
    assert.equal(body.success, false);
    assert.equal(body.code, "REASON_REQUIRED");

    const record = recordFor(blocked.submission.ingestionId);
    assert.equal(record.status, "pending_review");
    assert.equal(record.reviewHistory.length, 1);
  });

  it("refuses a second, conflicting decision on the same submission", async () => {
    setRepository(OWNER, REPO, { marker: "decide-once", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    const first = await reviewRoute.POST(
      reviewRequest({
        ingestionId: blocked.submission.ingestionId,
        decision: "approve",
        policyOverride: true,
        reason: "Reviewed and accepted.",
      })
    );
    assert.equal(first.status, 200);

    const second = await reviewRoute.POST(
      reviewRequest({
        ingestionId: blocked.submission.ingestionId,
        decision: "reject",
        reason: "Trying to flip the decision.",
      })
    );
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.code, "DECISION_ALREADY_RECORDED");

    const record = recordFor(blocked.submission.ingestionId);
    assert.equal(record.status, "approved");
    assert.equal(record.reviewHistory.length, 2, "the refused decision must not be recorded");
  });

  it("refuses to approve a submission whose audit outcome is a hard rejection", async () => {
    setRepository(OWNER, REPO, { marker: "gpl", license: "GPL-3.0-only" });
    const harness = buildDeps();

    const rejected = await submitTemplateRepository(submissionInput(), harness.deps);
    assert.equal(rejected.code, "AUDIT_REJECTED");
    assert.equal(rejected.submission.reviewStatus, "rejected");

    // A hard rejection is already final: no decision can be recorded on it.
    const finalized = await reviewRoute.POST(
      reviewRequest({
        ingestionId: rejected.submission.ingestionId,
        decision: "approve",
        policyOverride: true,
        reason: "Trying to override a hard rejection.",
      })
    );
    assert.equal(finalized.status, 409);
    assert.equal((await finalized.json()).code, "DECISION_ALREADY_RECORDED");

    // A submission that is still awaiting review but whose audit outcome is a
    // hard rejection can never be approved, whatever the override says.
    const hardRejection = {
      ingestionId: "ing_hard_rejection_pending",
      sourceUrl: `https://github.com/${OWNER}/${REPO}`,
      commitSha: "a".repeat(40),
      templateId: deriveTemplateId(REPO),
      templateVersion: "1.0.0",
      auditReport: { outcome: "REJECT" },
      status: "pending_review",
      submissionStatus: "review_required",
      save: async function () { return this; },
    };
    modelStores.TemplateIngestionReview.push(hardRejection);

    const response = await reviewRoute.POST(
      reviewRequest({
        ingestionId: hardRejection.ingestionId,
        decision: "approve",
        policyOverride: true,
        reason: "Trying to override a hard rejection.",
      })
    );
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "AUDIT_REJECTED");
    assert.equal(hardRejection.status, "pending_review");
  });

  it("refuses a review decision from a non-administrator", async () => {
    setRepository(OWNER, REPO, { marker: "not-an-admin", omitLicense: true });
    const harness = buildDeps();

    const blocked = await submitTemplateRepository(submissionInput(), harness.deps);
    authState.admin = false;

    const response = await reviewRoute.POST(
      reviewRequest({
        ingestionId: blocked.submission.ingestionId,
        decision: "approve",
        policyOverride: true,
        reason: "Reviewed and accepted.",
      })
    );
    assert.equal(response.status, 403);

    const record = recordFor(blocked.submission.ingestionId);
    assert.equal(record.status, "pending_review");
  });
});

/* =========================================================================
   Phase 5 — Error mapping at the submission API boundary
   =========================================================================

   A source that could not be retrieved and a template that was rejected by
   the audit are different failures and must never be reported as one another:
   one is a retryable infrastructure problem, the other is a decision about
   the template. The HTTP status of each must say which one it is.
   ========================================================================= */

describe("Phase 5 — submission error mapping", () => {
  beforeEach(() => resetState());

  after(() => {
    for (const dir of tempRoots) {
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  function prepare(harness) {
    globalThis.__mockStorageAdapter = harness.storageAdapter;
    globalThis.__mockSourceSnapshotStore = harness.snapshotStore;
    globalThis.__mockBuildExecutor = harness.deps.buildExecutor;
    globalThis.__mockProvisioningExecutor = harness.deps.provisioningExecutor;
  }

  function submitRequest(body) {
    return new Request("http://localhost:3000/api/admin/templates/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("maps an unresolvable repository to 404 COMMIT_RESOLUTION_FAILED", async () => {
    const harness = buildDeps();
    prepare(harness);
    globalThis.__mockFetch = githubFetch;
    // No repository was registered, so the commit cannot be resolved.
    const response = await submitRoute.POST(
      submitRequest({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true })
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.code, "COMMIT_RESOLUTION_FAILED");
    assert.match(body.message, /Nothing was audited, built or published/);
    assert.notEqual(body.code, "SOURCE_UNAVAILABLE");
  });

  it("maps an unreachable source archive to 502 SOURCE_UNAVAILABLE", async () => {
    setRepository(OWNER, REPO, { marker: "unreachable" });
    const harness = buildDeps();
    prepare(harness);
    // The commit resolves, but the archive itself cannot be fetched.
    globalThis.__mockFetch = async (url) => {
      const target = String(url);
      if (target.includes("/commits/")) {
        const state = repoState.get(buildRepositoryKey(OWNER, REPO));
        return new Response(JSON.stringify({ sha: state.sha }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    const response = await submitRoute.POST(
      submitRequest({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true })
    );

    assert.equal(response.status, 502);
    const body = await response.json();
    assert.equal(body.code, "SOURCE_UNAVAILABLE");
    assert.match(body.message, /Nothing was audited, built or published/);
    assert.match(body.message, /can be retried/);
    // A source failure is never an audit decision.
    assert.notEqual(body.code, "AUDIT_REJECTED");
    assert.notEqual(body.code, "REVIEW_REQUIRED");
    assert.equal(templateRecords().length, 0, "a source failure records no submission");
  });

  it("maps a malformed commit SHA to 400 INVALID_INPUT", async () => {
    setRepository(OWNER, REPO, { marker: "bad-sha" });
    const harness = buildDeps();
    prepare(harness);
    globalThis.__mockFetch = githubFetch;

    const response = await submitRoute.POST(
      submitRequest({
        url: `https://github.com/${OWNER}/${REPO}`,
        commitSha: "not-a-commit-sha",
        explicitConfirmation: true,
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "INVALID_INPUT");
    assert.equal(templateRecords().length, 0);
  });

  it("maps a missing repository URL to 400", async () => {
    const harness = buildDeps();
    prepare(harness);

    const response = await submitRoute.POST(submitRequest({ explicitConfirmation: true }));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.message, /repository URL is required/i);
  });

  it("maps a policy rejection to 422 AUDIT_REJECTED", async () => {
    setRepository(OWNER, REPO, { marker: "gpl", license: "GPL-3.0-only" });
    const harness = buildDeps();
    prepare(harness);
    globalThis.__mockFetch = githubFetch;

    const response = await submitRoute.POST(
      submitRequest({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true })
    );

    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.code, "AUDIT_REJECTED");
    assert.equal(body.submission.reviewStatus, "rejected");
  });

  it("maps a review-required outcome to 422 REVIEW_REQUIRED and keeps it reviewable", async () => {
    setRepository(OWNER, REPO, { marker: "no-license", omitLicense: true });
    const harness = buildDeps();
    prepare(harness);
    globalThis.__mockFetch = githubFetch;

    const response = await submitRoute.POST(
      submitRequest({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true })
    );

    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.code, "REVIEW_REQUIRED");
    assert.equal(body.submission.reviewStatus, "pending_review");
    assert.equal(body.submission.retryEligible, true);
    assert.ok(body.submission.sourceSnapshotId, "the source to review is retained");
  });

  it("never reports a source failure as an audit rejection", async () => {
    setRepository(OWNER, REPO, { marker: "mixed" });
    const harness = buildDeps();
    prepare(harness);
    globalThis.__mockFetch = async () => new Response("Not Found", { status: 404 });

    const response = await submitRoute.POST(
      submitRequest({ url: `https://github.com/${OWNER}/${REPO}`, explicitConfirmation: true })
    );

    const body = await response.json();
    assert.equal(body.success, false);
    assert.notEqual(body.code, "AUDIT_REJECTED");
    assert.notEqual(body.code, "REVIEW_REQUIRED");
    assert.ok(
      ["SOURCE_UNAVAILABLE", "COMMIT_RESOLUTION_FAILED"].includes(body.code),
      `unexpected failure code '${body.code}'`
    );
    assert.equal(response.status >= 400 && response.status < 600, true);
  });
});
