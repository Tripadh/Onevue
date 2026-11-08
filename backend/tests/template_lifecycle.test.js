const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");

let ts;
try {
  ts = require("typescript");
} catch {
  ts = require((() => { try { return require.resolve("typescript"); } catch { try { return require("node:path").resolve(__dirname, "../node_modules/typescript"); } catch { return require("node:path").resolve(__dirname, "../../portfolio/node_modules/typescript"); } } })());
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

class MockSchema {
  static Types = { ObjectId: String, Mixed: Object };
  constructor() {}
  path() { return { validate() {} }; }
  index() {}
  pre() {}
}

let mockReviews = [];
const mockMongoose = {
  Schema: MockSchema,
  model: () => ({ find: () => ({ lean: async () => mockReviews }) }),
  models: {},
};
mockMongoose.default = mockMongoose;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "mongoose") return "lifecycle_mock_mongoose";
  return originalResolve.apply(this, arguments);
};
require.cache["lifecycle_mock_mongoose"] = {
  id: "lifecycle_mock_mongoose",
  filename: "lifecycle_mock_mongoose",
  loaded: true,
  exports: mockMongoose,
};

const {
  InMemoryLifecyclePersistence,
  createMongoLifecyclePersistence,
  orchestrateTemplateLifecycle,
} = require("../lib/template-lifecycle.ts");
const { MockBuildExecutor } = require("../lib/template-build.ts");
const { LocalFilesystemStorageAdapter } = require("../lib/template-storage.ts");
const { getEligibleCatalogTemplates } = require("../lib/template-registry-extension.ts");

function createSource() {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-lifecycle-source-"));
  fs.mkdirSync(path.join(sourceDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "package.json"), JSON.stringify({
    name: "offline-lifecycle-template",
    version: "1.0.0",
    scripts: { build: "vite build" },
  }));
  fs.writeFileSync(path.join(sourceDir, "vite.config.js"), "export default {};\n");
  fs.writeFileSync(path.join(sourceDir, "src", "main.js"), "console.log('offline lifecycle');\n");
  return sourceDir;
}

function review(overrides = {}) {
  return {
    ingestionId: "ing_lifecycle_1",
    status: "approved",
    auditReport: { outcome: "PASS" },
    reviewDecision: { reason: "approved by offline test" },
    sourceCommitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
    templateId: "offline-lifecycle-template",
    templateVersion: "1.0.0",
    ...overrides,
  };
}

function initialRecord(inputReview) {
  return {
    ingestionId: inputReview.ingestionId,
    status: "APPROVED",
    templateId: inputReview.templateId,
    templateVersion: inputReview.templateVersion,
    sourceCommitSha: inputReview.sourceCommitSha,
    updatedAt: new Date(0).toISOString(),
  };
}

async function runLifecycle(options = {}) {
  const sourceDir = options.sourceDir || createSource();
  const storageRoot = options.storageRoot || fs.mkdtempSync(path.join(os.tmpdir(), "onevue-lifecycle-storage-"));
  const sourceCleanup = options.sourceCleanup || (() => {
    fs.rmSync(sourceDir, { recursive: true, force: true });
    return Promise.resolve();
  });
  const lifecycleReview = options.review || review();
  const persistence = options.persistence || new InMemoryLifecyclePersistence([initialRecord(lifecycleReview)]);
  const storage = options.storage || new LocalFilesystemStorageAdapter(storageRoot);

  const result = await orchestrateTemplateLifecycle({
    sourceDir,
    sourceCleanup,
    review: lifecycleReview,
    explicitConfirmation: options.explicitConfirmation === undefined ? true : options.explicitConfirmation,
    persistence,
    storageAdapter: storage,
    buildExecutor: options.buildExecutor || new MockBuildExecutor(),
    stagedArtifactsRoot: fs.mkdtempSync(path.join(os.tmpdir(), "onevue-lifecycle-stage-root-")),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  return { result, persistence, storage, storageRoot, sourceDir, lifecycleReview };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Phase 5.11 — Offline template lifecycle orchestration", () => {
  it("adapts, builds, stores, validates, and becomes catalog-eligible", async () => {
    const run = await runLifecycle();
    try {
      assert.equal(run.result.success, true);
      assert.equal(run.result.status, "CATALOG_ELIGIBLE");
      assert.ok(run.result.manifestSha256);
      assert.equal(fs.existsSync(run.sourceDir), false);

      const persisted = run.persistence.snapshot("ing_lifecycle_1");
      assert.equal(persisted.status, "CATALOG_ELIGIBLE");
      assert.equal(persisted.templateVersion, "1.0.0");

      mockReviews = [{
        ingestionId: "ing_lifecycle_1",
        templateId: "offline-lifecycle-template",
        templateVersion: "1.0.0",
        commitSha: run.lifecycleReview.sourceCommitSha,
        sourceUrl: "https://github.com/qubort-tech/offline-lifecycle-template",
        status: "approved",
        auditReport: { outcome: "PASS" },
        reviewDecision: {
          decision: "approve",
          reason: "approved by offline test",
          reviewerUserId: "660c000000000000000000ad",
        },
        provisioningRecord: {
          status: "provisioned",
          destinationUrl: "https://github.com/onevue-templates/offline-lifecycle-template",
          provenance: {
            isMock: false,
            provisionerMode: "live_github",
            mirrorType: "github_private",
            lifecycle: persisted,
          },
        },
      }];
      const catalog = await getEligibleCatalogTemplates({ storageAdapter: run.storage });
      assert.ok(catalog.some((template) => template.id === "offline-lifecycle-template"));
    } finally {
      fs.rmSync(run.storageRoot, { recursive: true, force: true });
    }
  });

  it("rejects unapproved and incompatible templates before storage", async () => {
    let cleanupCalls = 0;
    const sourceDir = createSource();
    const rejected = await runLifecycle({
      sourceDir,
      review: review({ status: "rejected" }),
      sourceCleanup: async () => { cleanupCalls += 1; fs.rmSync(sourceDir, { recursive: true, force: true }); },
    });
    assert.equal(rejected.result.success, false);
    assert.equal(rejected.result.status, "FAILED");
    assert.equal(cleanupCalls, 0);

    const incompatibleSource = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-incompatible-source-"));
    const incompatible = await runLifecycle({ sourceDir: incompatibleSource });
    try {
      assert.equal(incompatible.result.success, false);
      assert.equal(incompatible.result.failedStage, "ADAPTED");
      assert.equal(incompatible.persistence.snapshot("ing_lifecycle_1").status, "FAILED");
    } finally {
      fs.rmSync(incompatibleSource, { recursive: true, force: true });
      fs.rmSync(incompatible.storageRoot, { recursive: true, force: true });
    }
  });

  it("records build and storage failures and allows a controlled retry", async () => {
    const failedBuild = await runLifecycle({
      buildExecutor: new MockBuildExecutor({ shouldFail: true }),
    });
    try {
      assert.equal(failedBuild.result.success, false);
      assert.equal(failedBuild.result.failedStage, "BUILT");
      assert.equal(failedBuild.persistence.snapshot("ing_lifecycle_1").status, "FAILED");
    } finally {
      fs.rmSync(failedBuild.storageRoot, { recursive: true, force: true });
    }

    const failingStorage = {
      storeArtifact: async () => ({ success: false, outcome: "STORAGE_ERROR", error: "offline storage failure" }),
      retrieveArtifact: async () => ({ success: false, outcome: "NOT_FOUND" }),
      checkVersionExists: async () => false,
      validateStoredArtifact: async () => ({ success: false, outcome: "INTEGRITY_FAILURE", error: "not stored" }),
    };
    const failedStorage = await runLifecycle({ storage: failingStorage });
    try {
      assert.equal(failedStorage.result.success, false);
      assert.equal(failedStorage.result.failedStage, "STORED");
      assert.equal(failedStorage.persistence.snapshot("ing_lifecycle_1").status, "FAILED");
    } finally {
      fs.rmSync(failedStorage.storageRoot, { recursive: true, force: true });
    }
  });

  it("allows only one concurrent owner and makes completed retries idempotent", async () => {
    const sourceDir = createSource();
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-concurrent-storage-"));
    const persistence = new InMemoryLifecyclePersistence([initialRecord(review())]);
    const sourceCleanup = async () => fs.rmSync(sourceDir, { recursive: true, force: true });
    const input = {
      sourceDir,
      sourceCleanup,
      review: review(),
      explicitConfirmation: true,
      persistence,
      storageAdapter: new LocalFilesystemStorageAdapter(storageRoot),
      buildExecutor: new MockBuildExecutor(),
      stagedArtifactsRoot: fs.mkdtempSync(path.join(os.tmpdir(), "onevue-concurrent-stage-")),
    };

    try {
      const results = await Promise.all([
        orchestrateTemplateLifecycle(input),
        orchestrateTemplateLifecycle(input),
      ]);
      assert.equal(results.filter((item) => item.success).length, 1);
      assert.equal(results.filter((item) => !item.success).length, 1);

      const retry = await orchestrateTemplateLifecycle(input);
      assert.equal(retry.success, true);
      assert.equal(retry.idempotent, true);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it("reclaims expired work and rejects stale-owner writes", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const persistence = new InMemoryLifecyclePersistence([{
      ...initialRecord(review()),
      status: "IN_PROGRESS",
      ownerToken: "stale-owner",
      leaseExpiresAt: new Date(now.getTime() - 1).toISOString(),
    }]);
    const staleClaim = await persistence.claim("ing_lifecycle_1", ["APPROVED", "FAILED"], now, 60_000);
    assert.ok(staleClaim);
    assert.notEqual(staleClaim.ownerToken, "stale-owner");
    assert.equal(await persistence.renew("ing_lifecycle_1", staleClaim.ownerToken, now, 60_000), true);
    assert.equal(await persistence.update("ing_lifecycle_1", "stale-owner", { status: "BUILT" }, now), false);
    assert.equal(await persistence.isOwner("ing_lifecycle_1", "stale-owner", now), false);
    assert.equal(await persistence.isOwner("ing_lifecycle_1", staleClaim.ownerToken, now), true);
    assert.equal(await persistence.renew("ing_lifecycle_1", staleClaim.ownerToken, new Date(now.getTime() + 30 * 60 * 1000), 60_000), false);
  });

  it("renews the ownership lease during a long-running build stage", async () => {
    const sourceDir = createSource();
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-heartbeat-storage-"));
    const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-heartbeat-stage-"));
    const persistence = new InMemoryLifecyclePersistence([initialRecord(review())]);
    const originalRenew = persistence.renew.bind(persistence);
    let renewCount = 0;
    let renewsSeenByBuild = 0;
    persistence.renew = async (...args) => {
      renewCount += 1;
      return originalRenew(...args);
    };

    class SlowBuildExecutor extends MockBuildExecutor {
      async executeBuild(options) {
        await delay(500);
        renewsSeenByBuild = renewCount;
        return super.executeBuild(options);
      }
    }

    try {
      const result = await orchestrateTemplateLifecycle({
        sourceDir,
        sourceCleanup: async () => {},
        review: review(),
        explicitConfirmation: true,
        persistence,
        storageAdapter: new LocalFilesystemStorageAdapter(storageRoot),
        buildExecutor: new SlowBuildExecutor(),
        stagedArtifactsRoot: stagedRoot,
        leaseMs: 300,
        leaseRenewIntervalMs: 50,
        stageTimeoutMs: 5000,
      });

      assert.equal(result.success, true);
      assert.equal(result.status, "CATALOG_ELIGIBLE");
      assert.ok(renewsSeenByBuild >= 3, `expected at least 3 renewals during the build, saw ${renewsSeenByBuild}`);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
      fs.rmSync(stagedRoot, { recursive: true, force: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("times out a stalled build, aborts the stage, and removes its staging", async () => {
    const sourceDir = createSource();
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-timeout-storage-"));
    const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-timeout-stage-"));
    const persistence = new InMemoryLifecyclePersistence([initialRecord(review())]);
    let aborted = false;
    const stalledExecutor = {
      executeBuild(options) {
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("executor aborted"));
          });
        });
      },
    };

    try {
      const result = await orchestrateTemplateLifecycle({
        sourceDir,
        sourceCleanup: async () => {},
        review: review(),
        explicitConfirmation: true,
        persistence,
        storageAdapter: new LocalFilesystemStorageAdapter(storageRoot),
        buildExecutor: stalledExecutor,
        stagedArtifactsRoot: stagedRoot,
        leaseMs: 60_000,
        leaseRenewIntervalMs: 1000,
        stageTimeoutMs: 120,
      });

      assert.equal(result.success, false);
      assert.equal(result.failedStage, "BUILT");
      assert.match(result.error, /timed out after 120ms/);
      assert.equal(aborted, true);
      assert.equal(persistence.snapshot("ing_lifecycle_1").status, "FAILED");
      assert.deepEqual(fs.readdirSync(stagedRoot), []);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
      fs.rmSync(stagedRoot, { recursive: true, force: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("cancels a running stage and stops lease renewal cleanly", async () => {
    const sourceDir = createSource();
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-cancel-storage-"));
    const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-cancel-stage-"));
    const persistence = new InMemoryLifecyclePersistence([initialRecord(review())]);
    const originalRenew = persistence.renew.bind(persistence);
    let renewCount = 0;
    persistence.renew = async (...args) => {
      renewCount += 1;
      return originalRenew(...args);
    };
    const controller = new AbortController();
    let aborted = false;
    const executor = {
      executeBuild(options) {
        return new Promise((_resolve, reject) => {
          setTimeout(() => controller.abort(), 30);
          options.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("executor cancelled"));
          });
        });
      },
    };

    try {
      const result = await orchestrateTemplateLifecycle({
        sourceDir,
        sourceCleanup: async () => {},
        review: review(),
        explicitConfirmation: true,
        persistence,
        storageAdapter: new LocalFilesystemStorageAdapter(storageRoot),
        buildExecutor: executor,
        stagedArtifactsRoot: stagedRoot,
        abortSignal: controller.signal,
        leaseMs: 60_000,
        leaseRenewIntervalMs: 20,
        stageTimeoutMs: 5000,
      });

      assert.equal(result.success, false);
      assert.equal(result.failedStage, "BUILT");
      assert.match(result.error, /was cancelled/);
      assert.equal(aborted, true);
      assert.equal(persistence.snapshot("ing_lifecycle_1").status, "FAILED");
      assert.deepEqual(fs.readdirSync(stagedRoot), []);

      const renewsAfterCancel = renewCount;
      await delay(80);
      assert.equal(renewCount, renewsAfterCancel, "lease renewal must stop after cancellation");
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
      fs.rmSync(stagedRoot, { recursive: true, force: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("rejects stale-owner eligibility and source cleanup after the lease is lost", async () => {
    class LosingPersistence extends InMemoryLifecyclePersistence {
      constructor(records) {
        super(records);
        this.lost = false;
      }
      loseLease() {
        this.lost = true;
      }
      async renew(...args) {
        return this.lost ? false : super.renew(...args);
      }
      async update(...args) {
        return this.lost ? false : super.update(...args);
      }
      async isOwner(...args) {
        return this.lost ? false : super.isOwner(...args);
      }
    }

    const sourceDir = createSource();
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-lost-lease-storage-"));
    const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-lost-lease-stage-"));
    const persistence = new LosingPersistence([initialRecord(review())]);
    let sourceCleanupCalls = 0;
    let storeCalls = 0;

    class LosingExecutor extends MockBuildExecutor {
      executeBuild(options) {
        return new Promise((_resolve, reject) => {
          const timer = setTimeout(() => persistence.loseLease(), 60);
          options.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("executor stopped after lease loss"));
          });
        });
      }
    }

    const storage = {
      async storeArtifact() {
        storeCalls += 1;
        return { success: false, outcome: "STORAGE_ERROR", error: "must not be reached" };
      },
      async retrieveArtifact() { return { success: false, outcome: "NOT_FOUND" }; },
      async checkVersionExists() { return false; },
      async validateStoredArtifact() { return { success: false, outcome: "INTEGRITY_FAILURE" }; },
    };

    try {
      const result = await orchestrateTemplateLifecycle({
        sourceDir,
        sourceCleanup: async () => { sourceCleanupCalls += 1; },
        review: review(),
        explicitConfirmation: true,
        persistence,
        storageAdapter: storage,
        buildExecutor: new LosingExecutor(),
        stagedArtifactsRoot: stagedRoot,
        leaseMs: 60_000,
        leaseRenewIntervalMs: 20,
        stageTimeoutMs: 5000,
      });

      assert.equal(result.success, false);
      assert.equal(result.failedStage, "BUILT");
      assert.notEqual(persistence.snapshot("ing_lifecycle_1").status, "CATALOG_ELIGIBLE");
      assert.equal(storeCalls, 0);
      assert.equal(sourceCleanupCalls, 0);
      assert.deepEqual(fs.readdirSync(stagedRoot), []);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
      fs.rmSync(stagedRoot, { recursive: true, force: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("reclaims expired interrupted stages but never steals an active lease", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const active = new InMemoryLifecyclePersistence([{
      ...initialRecord(review()),
      status: "BUILT",
      ownerToken: "active-owner",
      leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    }]);
    assert.equal(await active.claim("ing_lifecycle_1", ["APPROVED", "FAILED"], now, 1000), false);

    const expired = new InMemoryLifecyclePersistence([{
      ...initialRecord(review()),
      status: "STORED",
      ownerToken: "expired-owner",
      leaseExpiresAt: new Date(now.getTime() - 1).toISOString(),
    }]);
    assert.equal(await expired.claim("ing_lifecycle_1", ["APPROVED", "FAILED"], now, 1000), false);
    const reclaimed = await expired.claim("ing_lifecycle_1", ["APPROVED", "FAILED", "STORED"], now, 1000);
    assert.ok(reclaimed);
    assert.notEqual(reclaimed.ownerToken, "expired-owner");

    const sourceDir = createSource();
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-resume-storage-"));
    const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-resume-stage-"));
    const persistence = new InMemoryLifecyclePersistence([{
      ...initialRecord(review()),
      status: "BUILT",
      ownerToken: "crashed-owner",
      leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    }]);

    try {
      const result = await orchestrateTemplateLifecycle({
        sourceDir,
        sourceCleanup: async () => {},
        review: review(),
        explicitConfirmation: true,
        persistence,
        storageAdapter: new LocalFilesystemStorageAdapter(storageRoot),
        buildExecutor: new MockBuildExecutor(),
        stagedArtifactsRoot: stagedRoot,
        leaseMs: 60_000,
      });
      assert.equal(result.success, true);
      assert.equal(result.status, "CATALOG_ELIGIBLE");
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
      fs.rmSync(stagedRoot, { recursive: true, force: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("builds Mongo claim and update filters with owner and lease barriers", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const calls = {};
    const Model = {
      findOne: (filter) => ({
        lean: async () => {
          calls.findOne = filter;
          return null;
        },
      }),
      findOneAndUpdate: async (filter, update, options) => {
        calls.claim = { filter, update, options };
        return { ingestionId: "ing_lifecycle_1" };
      },
      updateOne: async (filter, update) => {
        calls.update = { filter, update };
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
    const persistence = createMongoLifecyclePersistence(Model);

    const claim = await persistence.claim("ing_lifecycle_1", ["APPROVED", "FAILED", "BUILT"], now, 60_000);
    assert.ok(claim);
    assert.equal(calls.claim.filter.status, "approved");
    const claimFilter = JSON.stringify(calls.claim.filter);
    assert.match(claimFilter, /APPROVED/);
    assert.match(claimFilter, /FAILED/);
    assert.match(claimFilter, /BUILT/);
    assert.match(claimFilter, /leaseExpiresAt/);
    assert.match(claimFilter, /\$lte/);
    assert.match(JSON.stringify(calls.claim.update), /IN_PROGRESS/);

    assert.equal(await persistence.update("ing_lifecycle_1", claim.ownerToken, { status: "BUILT" }, now), true);
    assert.equal(calls.update.filter["provisioningRecord.provenance.lifecycle.ownerToken"], claim.ownerToken);
    assert.match(JSON.stringify(calls.update.filter), /leaseExpiresAt/);
    assert.equal(calls.update.update.$set["provisioningRecord.provenance.lifecycle.status"], "BUILT");

    // renew/isOwner cannot succeed without a matching owner+lease record.
    assert.equal(await persistence.renew("ing_lifecycle_1", claim.ownerToken, now, 60_000), false);
    assert.equal(await persistence.isOwner("ing_lifecycle_1", claim.ownerToken, now), false);
  });

  it("retries a failed build idempotently without duplicating artifacts", async () => {
    const sourceDir = createSource();
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-retry-storage-"));
    const stagedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-retry-stage-"));
    const persistence = new InMemoryLifecyclePersistence([initialRecord(review())]);
    const input = {
      sourceDir,
      sourceCleanup: async () => {},
      review: review(),
      explicitConfirmation: true,
      persistence,
      storageAdapter: new LocalFilesystemStorageAdapter(storageRoot),
      stagedArtifactsRoot: stagedRoot,
      leaseMs: 60_000,
    };

    try {
      const failed = await orchestrateTemplateLifecycle({
        ...input,
        buildExecutor: new MockBuildExecutor({ shouldFail: true }),
      });
      assert.equal(failed.success, false);
      assert.equal(failed.failedStage, "BUILT");

      const retried = await orchestrateTemplateLifecycle({
        ...input,
        buildExecutor: new MockBuildExecutor(),
      });
      assert.equal(retried.success, true);
      assert.equal(retried.status, "CATALOG_ELIGIBLE");

      const idempotent = await orchestrateTemplateLifecycle({
        ...input,
        buildExecutor: new MockBuildExecutor(),
      });
      assert.equal(idempotent.success, true);
      assert.equal(idempotent.idempotent, true);
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
      fs.rmSync(stagedRoot, { recursive: true, force: true });
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("regression: orchestrates lifecycle end-to-end for Create React App template", async () => {
    const craSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-cra-lifecycle-"));
    fs.mkdirSync(path.join(craSourceDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(craSourceDir, "public"), { recursive: true });
    fs.writeFileSync(
      path.join(craSourceDir, "package.json"),
      JSON.stringify({
        name: "developer-portfolio",
        version: "1.0.0",
        private: true,
        dependencies: {
          react: "^16.10.2",
          "react-dom": "^16.10.2",
          "react-scripts": "3.2.0",
        },
        scripts: {
          build: "react-scripts --openssl-legacy-provider build",
          start: "react-scripts --openssl-legacy-provider start",
        },
      })
    );
    fs.writeFileSync(path.join(craSourceDir, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(craSourceDir, "public", "index.html"), "<!DOCTYPE html><html><head><title>CRA</title></head><body><div id='root'></div></body></html>");
    fs.writeFileSync(path.join(craSourceDir, "src", "index.js"), "console.log('cra entry');");

    const craReview = review({
      templateId: "developer-portfolio",
      templateVersion: "1.0.0",
      sourceCommitSha: "f869083ff3edb61eb417581197947bdb0ce408e2",
    });

    const run = await runLifecycle({
      sourceDir: craSourceDir,
      review: craReview,
      sourceCleanup: async () => {
        fs.rmSync(craSourceDir, { recursive: true, force: true });
      },
    });

    try {
      assert.equal(run.result.success, true);
      assert.equal(run.result.status, "CATALOG_ELIGIBLE");
      assert.ok(run.result.manifestSha256);
      assert.ok(run.result.storageLocation);
    } finally {
      fs.rmSync(run.storageRoot, { recursive: true, force: true });
      if (fs.existsSync(craSourceDir)) {
        fs.rmSync(craSourceDir, { recursive: true, force: true });
      }
    }
  });
});
