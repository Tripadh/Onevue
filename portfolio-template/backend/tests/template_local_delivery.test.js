/**
 * =========================================================================
 * OneVue Phase 5.13 — Backend Artifact Storage Delivery Bridge Tests
 * =========================================================================
 *
 * Covers the backend half of the storage-to-visitor bridge:
 *
 *   1. An already-built artifact is packaged with the platform's own
 *      verifyAndPackageArtifact() and stored with the platform's own
 *      LocalFilesystemStorageAdapter.storeArtifact().
 *   2. The stored release lands in the exact layout the visitor bridge reads:
 *      <storageRoot>/templates/<templateId>/<templateVersion>/.
 *   3. The stored release passes the backend's OWN integrity validator.
 *   4. Storage is immutable: an existing version is never overwritten.
 *   5. The consumer (portfolio) resolves the SAME artifacts root.
 *   6. No build execution and no network access is performed.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

// The backend has no node_modules directory in this environment, so the
// TypeScript sources are loaded through the same transpile hook the backend
// test suite uses.
function registerTypeScriptLoader() {
  if (require.extensions[".ts"]) {
    return;
  }
  let ts;
  try {
    ts = require("typescript");
  } catch {
    ts = require(
      "/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript"
    );
  }
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

registerTypeScriptLoader();

const {
  seedLocalTemplateArtifact,
  resolveLocalDeliveryTemplatesRoot,
  verifyStoredArtifactIntegrity,
} = require(path.join(projectRoot, "lib", "template-local-delivery.ts"));

const {
  LocalFilesystemStorageAdapter,
  resolveTemplateStorageRoot,
  resolveTemplateArtifactsRoot,
} = require(path.join(projectRoot, "lib", "template-storage.ts"));

const TEMPLATE_ID = "community-template";
const TEMPLATE_VERSION = "1.1.0";

/**
 * Builds a minimal but realistic built artifact: index.html plus versioned
 * assets, exactly the shape the real build pipeline produces.
 */
function createBuiltArtifact(root, options = {}) {
  const templateId = options.templateId || TEMPLATE_ID;
  const templateVersion = options.templateVersion || TEMPLATE_VERSION;

  const dir = path.join(root, templateId, templateVersion);
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  const assetBase = `/templates/${templateId}/${templateVersion}/assets/`;
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!DOCTYPE html><html><head><link rel="stylesheet" href="${assetBase}index.css"></head>` +
      `<body><div id="root"></div><script type="module" src="${assetBase}index.js"></script></body></html>`,
    "utf8"
  );
  fs.writeFileSync(path.join(dir, "assets", "index.css"), `/* ${templateVersion} css */`, "utf8");
  fs.writeFileSync(path.join(dir, "assets", "index.js"), `// ${templateVersion} js`, "utf8");

  return dir;
}

describe("OneVue Phase 5.13 — Backend Artifact Storage Bridge", () => {
  let storageRoot;
  let sourceRoot;
  let originalStorageEnv;

  beforeEach(() => {
    originalStorageEnv = process.env.ONEVUE_TEMPLATE_STORAGE_ROOT;
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-bridge-storage-"));
    sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-bridge-source-"));
  });

  afterEach(() => {
    if (originalStorageEnv === undefined) {
      delete process.env.ONEVUE_TEMPLATE_STORAGE_ROOT;
    } else {
      process.env.ONEVUE_TEMPLATE_STORAGE_ROOT = originalStorageEnv;
    }
    fs.rmSync(storageRoot, { recursive: true, force: true });
    fs.rmSync(sourceRoot, { recursive: true, force: true });
  });

  it("stores a built artifact into the immutable release layout", async () => {
    const sourceDir = createBuiltArtifact(sourceRoot);
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);

    const result = await seedLocalTemplateArtifact({
      sourceArtifactDir: sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "a".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    assert.equal(result.outcome, "SEEDED", `Seeding failed: ${result.error}`);

    const expectedDir = path.join(storageRoot, "templates", TEMPLATE_ID, TEMPLATE_VERSION);
    assert.equal(
      result.artifactDir,
      expectedDir,
      "The release must be stored in <storageRoot>/templates/<id>/<version>/"
    );

    assert.ok(fs.existsSync(path.join(expectedDir, "index.html")), "Entrypoint must be stored");
    assert.ok(fs.existsSync(path.join(expectedDir, "assets", "index.css")), "CSS must be stored");
    assert.ok(fs.existsSync(path.join(expectedDir, "assets", "index.js")), "JS must be stored");
    assert.ok(
      fs.existsSync(path.join(expectedDir, "onevue-manifest.json")),
      "The release manifest must be stored"
    );
  });

  it("generates a release manifest with correct per-file digests", async () => {
    const sourceDir = createBuiltArtifact(sourceRoot);
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);

    await seedLocalTemplateArtifact({
      sourceArtifactDir: sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "b".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    const releaseDir = path.join(storageRoot, "templates", TEMPLATE_ID, TEMPLATE_VERSION);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(releaseDir, "onevue-manifest.json"), "utf8")
    );

    assert.equal(manifest.templateId, TEMPLATE_ID);
    assert.equal(manifest.templateVersion, TEMPLATE_VERSION);
    assert.equal(manifest.entrypoint, "index.html");
    assert.deepEqual(manifest.supportedDtoVersions, ["1.0.0"]);
    assert.equal(manifest.totalFiles, manifest.files.length);

    const crypto = require("node:crypto");
    let totalBytes = 0;
    for (const file of manifest.files) {
      const bytes = fs.readFileSync(path.join(releaseDir, file.relativePath));
      assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        file.sha256,
        `SHA-256 mismatch for ${file.relativePath}`
      );
      assert.equal(bytes.length, file.sizeBytes);
      totalBytes += bytes.length;
    }
    assert.equal(totalBytes, manifest.totalBytes);
  });

  it("passes the backend's own stored-artifact integrity validator", async () => {
    const sourceDir = createBuiltArtifact(sourceRoot);
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);

    await seedLocalTemplateArtifact({
      sourceArtifactDir: sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "c".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    const validated = await verifyStoredArtifactIntegrity(TEMPLATE_ID, TEMPLATE_VERSION, adapter);
    assert.equal(validated.valid, true, `Stored artifact failed validation: ${validated.error}`);
    assert.ok(validated.manifestSha256, "Validation must report the manifest checksum");
  });

  it("never overwrites an already stored release", async () => {
    const sourceDir = createBuiltArtifact(sourceRoot);
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);

    const first = await seedLocalTemplateArtifact({
      sourceArtifactDir: sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "d".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });
    assert.equal(first.outcome, "SEEDED");

    // Mutate the source, then re-seed. The stored release must be untouched.
    fs.writeFileSync(path.join(sourceDir, "assets", "index.css"), "/* tampered */", "utf8");

    const second = await seedLocalTemplateArtifact({
      sourceArtifactDir: sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "e".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    assert.equal(second.outcome, "ALREADY_STORED", "A stored version must never be re-seeded");

    const storedCss = fs.readFileSync(
      path.join(storageRoot, "templates", TEMPLATE_ID, TEMPLATE_VERSION, "assets", "index.css"),
      "utf8"
    );
    assert.equal(storedCss, `/* ${TEMPLATE_VERSION} css */`, "The stored release must be unchanged");
  });

  it("exposes the artifacts root the visitor bridge must read", async () => {
    const sourceDir = createBuiltArtifact(sourceRoot);
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);

    const result = await seedLocalTemplateArtifact({
      sourceArtifactDir: sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "f".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    assert.equal(
      result.artifactsRoot,
      path.join(storageRoot, "templates"),
      "The bridge must expose the storage adapter's own templates directory"
    );
    assert.equal(
      resolveLocalDeliveryTemplatesRoot(adapter),
      path.join(storageRoot, "templates"),
      "The bridge root must derive from the adapter, not a duplicated convention"
    );
  });

  it("resolves the same storage root for producer and consumer", () => {
    process.env.ONEVUE_TEMPLATE_STORAGE_ROOT = storageRoot;

    assert.equal(
      resolveTemplateStorageRoot(),
      path.resolve(storageRoot),
      "The backend must honour the explicit storage root override"
    );
    assert.equal(
      resolveTemplateArtifactsRoot(),
      path.resolve(storageRoot, "templates"),
      "The artifacts root must be the storage root's templates directory"
    );
    assert.equal(
      resolveTemplateArtifactsRoot(storageRoot),
      path.resolve(storageRoot, "templates"),
      "An explicit storage root must be honoured by the artifacts root helper"
    );
  });

  it("rejects a source directory that does not exist", async () => {
    const adapter = new LocalFilesystemStorageAdapter(storageRoot);

    const result = await seedLocalTemplateArtifact({
      sourceArtifactDir: path.join(sourceRoot, "does-not-exist"),
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "g".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    assert.equal(result.outcome, "INVALID_SOURCE");
    assert.ok(result.error, "An invalid source must carry a diagnostic error");
  });

  it("rejects a build output without the required entrypoint", async () => {
    const dir = path.join(sourceRoot, TEMPLATE_ID, TEMPLATE_VERSION);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "assets-only.txt"), "no entrypoint", "utf8");

    const adapter = new LocalFilesystemStorageAdapter(storageRoot);

    const result = await seedLocalTemplateArtifact({
      sourceArtifactDir: dir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "h".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    assert.equal(result.outcome, "INVALID_SOURCE");
    assert.match(result.error, /entrypoint/i);
  });

  it("performs no build execution and no network access", async () => {
    // The source directory contains a marker script. Seeding must never run it.
    const sourceDir = createBuiltArtifact(sourceRoot);
    const marker = path.join(sourceRoot, "build-marker.txt");
    fs.writeFileSync(marker, "not executed", "utf8");

    const adapter = new LocalFilesystemStorageAdapter(storageRoot);
    const result = await seedLocalTemplateArtifact({
      sourceArtifactDir: sourceDir,
      templateId: TEMPLATE_ID,
      templateVersion: TEMPLATE_VERSION,
      sourceCommitSha: "i".repeat(40),
      supportedDtoVersions: ["1.0.0"],
      storageAdapter: adapter,
    });

    assert.equal(result.outcome, "SEEDED");
    assert.equal(
      fs.readFileSync(marker, "utf8"),
      "not executed",
      "The bridge must not execute anything from the source directory"
    );
  });
});
