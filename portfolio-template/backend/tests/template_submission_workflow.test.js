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
const ts = require(
  "/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript"
);
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

function createFakeModel(name, store) {
  function Model(data) {
    Object.assign(this, clone(data || {}));
    this._id = this._id || `${name}_${store.length + 1}_${Math.random().toString(36).slice(2, 6)}`;
    this.createdAt = this.createdAt || new Date();
    this.updatedAt = this.updatedAt || new Date();
    this.save = async function save() {
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
    const found = store.filter((doc) => matchesQuery(doc, query));
    for (const doc of found) {
      for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
      doc.updatedAt = new Date();
    }
    return { matchedCount: found.length, modifiedCount: found.length };
  };
  Model.findOneAndUpdate = async (query, update) => {
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
const {
  LocalFilesystemStorageAdapter,
} = require("../lib/template-storage.ts");
const { FileSystemSourceSnapshotStore } = require("../lib/template-snapshot.ts");
const { getEligibleCatalogTemplates, validateEligibleTemplateSelection } = require(
  "../lib/template-registry-extension.ts"
);
const { setDefaultStorageAdapter } = require("../lib/template-artifact-delivery.ts");
const {
  resolveTemplateAsset,
  setArtifactStorageAdapter,
} = require("../../portfolio/src/lib/template-artifact-store.ts");
const ReviewModel = require("../models/TemplateIngestionReview.ts").default;
const submitRoute = require("../app/api/admin/templates/submit/route.ts");
const submissionsRoute = require("../app/api/admin/templates/submissions/route.ts");
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
    return new Response(gz, { status: 200, headers: { "Content-Type": "application/gzip" } });
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
  const provisioningExecutor = overrides.provisioningExecutor || new MockProvisioningExecutor();

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
        "AUDIT",
        "BUILD_BOUNDARY",
        "SOURCE_SNAPSHOT",
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
});
