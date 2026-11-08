/**
 * =========================================================================
 * OneVue Phase 5.17 — MongoDB persistence & workflow integration tests
 * =========================================================================
 *
 * These tests run against a REAL MongoDB database and the REAL Mongoose model,
 * including the production lifecycle persistence and repository leases. They
 * are skipped unless both are available:
 *
 *   GD  ONEVUE_TEST_MONGODB_URI="mongodb://127.0.0.1:27017/onevue_itest" \
 *       node --test backend/tests/mongo_persistence.integration.test.js
 *
 * Requirements:
 *   - a dedicated TEST database (never production);
 *   - the backend's dependencies installed (`mongoose` resolvable).
 *
 * Safety: the suite only touches documents whose ingestionId starts with
 * `itest_` or the lock document `repo_lock:itest-org/*`. It never drops the
 * collection and never calls migrations.
 *
 * GitHub, the build runtime and provisioning are replaced by the repository's
 * offline doubles; MongoDB and the storage adapter are real (temporary dirs).
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const MONGO_URI = process.env.ONEVUE_TEST_MONGODB_URI;
let mongoose = null;
try {
  // eslint-disable-next-line global-require
  mongoose = require("mongoose");
} catch {
  mongoose = null;
}

const available = Boolean(MONGO_URI && mongoose);

if (!available) {
  describe(
    "Phase 5.17 — MongoDB persistence (integration)",
    { skip: "ONEVUE_TEST_MONGODB_URI or mongoose unavailable" },
    () => {
      it("requires a real MongoDB environment and installed backend dependencies", () => {});
    }
  );
} else {
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

  const TemplateIngestionReview = require("../models/TemplateIngestionReview.ts").default;
  const {
    submitTemplateRepository,
    acquireRepositoryLease,
    releaseRepositoryLease,
    expireRepositoryLease,
    buildRepositoryKey,
  } = require("../lib/template-submission.ts");
  const {
    LocalFilesystemStorageAdapter,
  } = require("../lib/template-storage.ts");
  const { FileSystemSourceSnapshotStore } = require("../lib/template-snapshot.ts");
  const { MockBuildExecutor } = require("../lib/template-build.ts");
  const { MockProvisioningExecutor } = require("../lib/template-provisioning.ts");
  const { getEligibleCatalogTemplates } = require("../lib/template-registry-extension.ts");

  const PREFIX = "itest_";
  const OWNER = "itest-org";
  const REPO = "itest-repo";
  const REPO_KEY = buildRepositoryKey(OWNER, REPO);

  // ------------------------------------------------------------ GitHub double
  function tarBlock(name, content, isDir) {
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "utf8");
    header.write("0001000\0", 108, 8, "utf8");
    header.write("0001000\0", 116, 8, "utf8");
    const body = Buffer.from(content || "", "utf8");
    header.write(body.length.toString(8).padStart(11, "0") + " ", 124, 12, "utf8");
    header.write("14000000000\0", 136, 12, "utf8");
    header.write(isDir ? "5" : "0", 156, 1, "utf8");
    header.write("ustar\0", 257, 6, "utf8");
    header.write("00", 263, 2, "utf8");
    header.write("        ", 148, 8, "utf8");
    let sum = 0;
    for (let i = 0; i < 512; i += 1) sum += header[i];
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf8");
    const blocks = [header];
    if (body.length) blocks.push(Buffer.concat([body, Buffer.alloc((512 - (body.length % 512)) % 512, 0)]));
    return blocks;
  }

  const MIT = "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy.\n";

  function filesFor(marker) {
    return {
      "package.json": JSON.stringify({
        name: REPO,
        version: "1.0.0",
        license: "MIT",
        scripts: { build: "vite build" },
        dependencies: {},
        devDependencies: { vite: "5.0.0" },
      }),
      "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
      LICENSE: MIT,
      "vite.config.js": "export default {};\n",
      "src/main.js": "console.log('itest');\n",
      "TEMPLATE_MARKER": marker,
    };
  }

  const state = { sha: "", marker: "v1", requests: [] };

  async function githubFetch(url, init) {
    const target = String(url);
    state.requests.push({ url: target, authorized: Boolean(init?.headers?.Authorization) });
    if (target.includes("/commits/")) {
      return new Response(JSON.stringify({ sha: state.sha }), { status: 200 });
    }
    const tarball = target.match(/tarball\/([a-f0-9]{40})$/);
    if (tarball) {
      if (tarball[1] !== state.sha) return new Response("Not Found", { status: 404 });
      const prefix = `${OWNER}-${REPO}-${state.sha.slice(0, 7)}`;
      const parts = tarBlock(`${prefix}/`, "", true);
      for (const [name, content] of Object.entries(filesFor(state.marker))) {
        parts.push(...tarBlock(`${prefix}/${name}`, content, false));
      }
      parts.push(Buffer.alloc(1024, 0));
      const response = new Response(zlib.gzipSync(Buffer.concat(parts)), { status: 200 });
      Object.defineProperty(response, "url", {
        value: `https://codeload.github.com/${encodeURIComponent(OWNER)}/${encodeURIComponent(REPO)}/legacy.tar.gz/${tarball[1]}`,
      });
      return response;
    }
    return new Response("Not Found", { status: 404 });
  }

  // ---------------------------------------------------------------- harness
  let storageRoot;
  let snapshotRoot;
  let storageAdapter;
  let snapshotStore;
  const tempDirs = [];

  function makeTemp(prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function depsFor(overrides = {}) {
    return {
      reviewModel: TemplateIngestionReview,
      snapshotStore,
      storageAdapter,
      fetchImpl: githubFetch,
      githubAuthToken: null,
      buildExecutor: overrides.buildExecutor || new MockBuildExecutor(),
      provisioningExecutor: overrides.provisioningExecutor || new MockProvisioningExecutor(),
      // Production default (createMongoLifecyclePersistence) is used here.
    };
  }

  function input(overrides = {}) {
    return {
      url: `https://github.com/${OWNER}/${REPO}`,
      explicitConfirmation: true,
      adminUserId: new mongoose.Types.ObjectId(),
      ...overrides,
    };
  }

  function setCommit(marker) {
    state.marker = marker;
    state.sha = crypto.createHash("sha1").update(`${REPO_KEY}:${marker}`).digest("hex");
  }

  async function cleanup() {
    await TemplateIngestionReview.deleteMany({
      $or: [
        { ingestionId: { $regex: `^${PREFIX}` } },
        { ingestionId: `repo_lock:${REPO_KEY}` },
      ],
    });
  }

  describe("Phase 5.17 — MongoDB persistence (integration)", () => {
    before(async () => {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await cleanup();
      await TemplateIngestionReview.init();

      storageRoot = makeTemp("onevue-517-itest-storage-");
      snapshotRoot = makeTemp("onevue-517-itest-snapshots-");
      storageAdapter = new LocalFilesystemStorageAdapter(storageRoot);
      snapshotStore = new FileSystemSourceSnapshotStore(snapshotRoot);
      setCommit("v1");
    });

    after(async () => {
      await cleanup();
      await mongoose.disconnect();
      for (const dir of tempDirs) {
        if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("verifies the declared indexes (unique ingestionId) and unique enforcement", async () => {
      const indexes = await TemplateIngestionReview.collection.indexes();
      const ingestionIndex = indexes.find((index) => index.key && index.key.ingestionId === 1);
      assert.ok(ingestionIndex, "the ingestionId index must exist");
      assert.equal(ingestionIndex.unique, true, "ingestionId must be unique (repository locks depend on it)");

      const doc = {
        ingestionId: `${PREFIX}duplicate`,
        adminUserId: new mongoose.Types.ObjectId(),
        sourceUrl: "https://github.com/itest-org/itest-repo",
        commitSha: "a".repeat(40),
        auditReport: { outcome: "PASS" },
        status: "approved",
        templateId: "itest-template",
        templateVersion: "9.9.9",
      };
      await new TemplateIngestionReview(doc).save();
      await assert.rejects(
        () => new TemplateIngestionReview(doc).save(),
        (error) => error && error.code === 11000
      );
    });

    it("runs the real workflow against MongoDB: create, no-update, new version", async () => {
      const first = await submitTemplateRepository(input(), depsFor());
      assert.equal(first.success, true, first.message);
      assert.equal(first.outcome, "CREATED");
      const version = first.submission.templateVersion;

      const stored = await TemplateIngestionReview.findOne({
        ingestionId: first.submission.ingestionId,
      }).lean();
      assert.ok(stored, "the submission record must be persisted");
      assert.equal(stored.status, "approved");
      assert.equal(stored.submissionStatus, "catalog_eligible");
      assert.equal(stored.provisioningRecord.provenance.lifecycle.status, "CATALOG_ELIGIBLE");
      assert.ok(stored.stages.length >= 9, "stage history must be persisted");

      const noUpdate = await submitTemplateRepository(input(), depsFor());
      assert.equal(noUpdate.outcome, "NO_UPDATE");
      assert.equal(noUpdate.submission.templateVersion, version);

      setCommit("v2");
      const updated = await submitTemplateRepository(input(), depsFor());
      assert.equal(updated.outcome, "UPDATED");
      assert.notEqual(updated.submission.templateVersion, version);

      const catalog = await getEligibleCatalogTemplates({ storageAdapter });
      const template = catalog.find((entry) => entry.id === updated.submission.templateId);
      assert.deepEqual(
        template.releases.map((release) => release.version).sort(),
        [version, updated.submission.templateVersion].sort()
      );
    });

    it("serializes concurrent first-time submissions for the same repository", async () => {
      await cleanup();
      setCommit("concurrent");
      const [a, b] = await Promise.all([
        submitTemplateRepository(input(), depsFor()),
        submitTemplateRepository(input(), depsFor()),
      ]);
      const outcomes = [a.outcome, b.outcome].sort();
      assert.deepEqual(outcomes, ["CREATED", "NO_UPDATE"]);

      const approved = await TemplateIngestionReview.countDocuments({
        repositoryKey: REPO_KEY,
        status: "approved",
      });
      assert.equal(approved, 1, "exactly one submission record may be created");
    });

    it("recovers an expired lease and rejects a stale worker's release", async () => {
      const now = new Date();
      const first = await acquireRepositoryLease(TemplateIngestionReview, REPO_KEY, now, 60_000);
      assert.equal(first.acquired, true);
      assert.equal((await acquireRepositoryLease(TemplateIngestionReview, REPO_KEY, now, 60_000)).acquired, false);

      await expireRepositoryLease(TemplateIngestionReview, REPO_KEY);
      const winner = await acquireRepositoryLease(TemplateIngestionReview, REPO_KEY, new Date(), 60_000);
      assert.equal(winner.acquired, true);
      assert.equal(await releaseRepositoryLease(TemplateIngestionReview, REPO_KEY, first.lease), false);
      assert.equal(await releaseRepositoryLease(TemplateIngestionReview, REPO_KEY, winner.lease), true);
    });

    it("does not create duplicate versions when a failed build is retried", async () => {
      await cleanup();
      setCommit("retry");

      const failed = await submitTemplateRepository(
        input(),
        depsFor({ buildExecutor: new MockBuildExecutor({ shouldFail: true }) })
      );
      assert.equal(failed.code, "BUILD_EXECUTION_FAILED");
      assert.equal(failed.submission.retryEligible, true);

      const blockedRepeat = await submitTemplateRepository(input(), depsFor());
      assert.equal(blockedRepeat.code, "EXISTING_INCOMPLETE");

      const retried = await submitTemplateRepository(input({ retry: true }), depsFor());
      assert.equal(retried.success, true, retried.message);
      assert.equal(retried.submission.templateVersion, failed.submission.templateVersion);

      const eligibleVersions = await TemplateIngestionReview.distinct("templateVersion", {
        repositoryKey: REPO_KEY,
        status: "approved",
        submissionStatus: "catalog_eligible",
      });
      assert.deepEqual(eligibleVersions, [failed.submission.templateVersion]);

      const again = await submitTemplateRepository(input({ retry: true }), depsFor());
      assert.equal(again.outcome, "NO_UPDATE");
    });
  });
}
