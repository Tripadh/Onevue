const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(compiled.outputText, filename);
  };
}

const { FileSystemSourceSnapshotStore } = require("../lib/template-snapshot.ts");

function createSource() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-snapshot-source-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), "{\"name\":\"snapshot\"}");
  fs.writeFileSync(path.join(dir, "src", "main.js"), "console.log('snapshot');");
  return dir;
}

describe("Phase 5.11.2 — Durable source snapshots", () => {
  it("publishes and verifies an immutable snapshot with bound provenance", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-snapshot-root-"));
    const source = createSource();
    const store = new FileSystemSourceSnapshotStore(root);
    const input = {
      snapshotId: "ing_snapshot_1",
      sourceDir: source,
      templateId: "snapshot-template",
      templateVersion: "1.0.0",
      sourceUrl: "https://github.com/qubort-tech/snapshot-template",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      auditOutcome: "PASS",
    };

    try {
      const ref = await store.create(input);
      assert.equal(ref.relativePath, "snapshots/ing_snapshot_1/source");
      assert.equal(path.isAbsolute(ref.relativePath), false);
      const verified = await store.verify(ref);
      assert.equal(fs.existsSync(verified.sourceDir), true);
      assert.equal(fs.existsSync(path.join(root, "snapshots", "ing_snapshot_1", "snapshot.json")), true);

      // Persistence layers may reorder object keys; verification must compare
      // provenance fields, not serialized key order.
      const reordered = {
        snapshotDigest: ref.snapshotDigest,
        createdAt: ref.createdAt,
        sourceDigest: ref.sourceDigest,
        auditOutcome: ref.auditOutcome,
        commitSha: ref.commitSha,
        sourceUrl: ref.sourceUrl,
        templateVersion: ref.templateVersion,
        templateId: ref.templateId,
        relativePath: ref.relativePath,
        snapshotId: ref.snapshotId,
      };
      assert.equal((await store.verify(reordered)).sourceDir, verified.sourceDir);
      await assert.rejects(() => store.verify({ ...ref, sourceDigest: "0".repeat(64) }), /provenance or digest/);

      await assert.rejects(() => store.create(input), /already exists and is immutable/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
  });

  it("rejects corruption, provenance mismatch, symlinks, and oversized snapshots", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-snapshot-root-"));
    const source = createSource();
    const store = new FileSystemSourceSnapshotStore(root, { maxBytes: 10 });
    const input = {
      snapshotId: "ing_snapshot_bad",
      sourceDir: source,
      templateId: "snapshot-template",
      templateVersion: "1.0.0",
      sourceUrl: "https://github.com/qubort-tech/snapshot-template",
      commitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      auditOutcome: "PASS",
    };

    try {
      await assert.rejects(() => store.create(input), /resource limits/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(source, { recursive: true, force: true });
    }

    const symlinkRoot = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-snapshot-root-"));
    const symlinkSource = createSource();
    const outside = path.join(os.tmpdir(), "onevue-snapshot-outside.txt");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, path.join(symlinkSource, "src", "outside.js"));
    try {
      await assert.rejects(() => new FileSystemSourceSnapshotStore(symlinkRoot).create({ ...input, snapshotId: "ing_snapshot_symlink", sourceDir: symlinkSource }), /unsupported entry/);
    } finally {
      fs.rmSync(symlinkRoot, { recursive: true, force: true });
      fs.rmSync(symlinkSource, { recursive: true, force: true });
      fs.rmSync(outside, { force: true });
    }

    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-snapshot-root-"));
    const source2 = createSource();
    const store2 = new FileSystemSourceSnapshotStore(root2);
    try {
      const ref = await store2.create({ ...input, snapshotId: "ing_snapshot_corrupt", sourceDir: source2 });
      fs.writeFileSync(path.join(root2, "snapshots", "ing_snapshot_corrupt", "source", "src", "main.js"), "tampered");
      await assert.rejects(() => store2.verify(ref), /content digest/);
      await assert.rejects(() => store2.verify({ ...ref, commitSha: "1111111111111111111111111111111111111111" }), /provenance or digest/);
      await store2.remove(ref);
      assert.equal(fs.existsSync(path.join(root2, "snapshots", "ing_snapshot_corrupt")), false);
    } finally {
      fs.rmSync(root2, { recursive: true, force: true });
      fs.rmSync(source2, { recursive: true, force: true });
    }
  });
});
