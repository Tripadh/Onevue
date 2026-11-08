const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let ts;
try { ts = require("typescript"); } catch { ts = require((() => { try { return require.resolve("typescript"); } catch { try { return require("node:path").resolve(__dirname, "../node_modules/typescript"); } catch { return require("node:path").resolve(__dirname, "../../portfolio/node_modules/typescript"); } } })()); }
if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
    module._compile(compiled.outputText, filename);
  };
}

const { reconcileLocalArtifacts } = require("../lib/template-reconciliation.ts");

describe("Phase 5.11.2 — Offline artifact reconciliation", () => {
  it("reports incomplete snapshots and unreferenced artifacts in dry-run mode", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-reconcile-"));
    const snapshotRoot = root;
    const artifactRoot = path.join(root, "storage");
    fs.mkdirSync(path.join(snapshotRoot, "snapshots", "snap-bad"), { recursive: true });
    fs.mkdirSync(path.join(artifactRoot, "templates", "orphan", "1.0.0"), { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, "templates", "orphan", "1.0.0", "onevue-manifest.json"), "not-json");

    try {
      const report = reconcileLocalArtifacts({ snapshotRoot, artifactRoot, lifecycleRecords: [], dryRun: true });
      assert.equal(report.dryRun, true);
      assert.equal(report.candidates.length, 2);
      assert.equal(report.removed.length, 0);
      assert.equal(fs.existsSync(path.join(snapshotRoot, "snapshots", "snap-bad")), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("protects catalog and published artifacts and makes cleanup idempotent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-reconcile-"));
    const artifactRoot = path.join(root, "storage");
    const protectedDir = path.join(artifactRoot, "templates", "protected", "1.0.0");
    const orphanDir = path.join(artifactRoot, "templates", "orphan", "1.0.0");
    fs.mkdirSync(protectedDir, { recursive: true });
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(protectedDir, "onevue-manifest.json"), JSON.stringify({ templateId: "protected", templateVersion: "1.0.0", manifestSha256: "a".repeat(64) }));
    fs.writeFileSync(path.join(orphanDir, "onevue-manifest.json"), JSON.stringify({ templateId: "wrong", templateVersion: "1.0.0", manifestSha256: "b".repeat(64) }));

    try {
      const records = [{ ingestionId: "catalog", status: "CATALOG_ELIGIBLE", templateId: "protected", templateVersion: "1.0.0", sourceCommitSha: "a".repeat(40), updatedAt: "now" }];
      const first = reconcileLocalArtifacts({ artifactRoot, lifecycleRecords: records, publishedArtifacts: [{ templateId: "protected", templateVersion: "1.0.0" }], dryRun: false });
      assert.equal(first.removed.length, 1);
      assert.equal(fs.existsSync(protectedDir), true);
      assert.equal(fs.existsSync(orphanDir), false);
      const second = reconcileLocalArtifacts({ artifactRoot, lifecycleRecords: records, publishedArtifacts: [{ templateId: "protected", templateVersion: "1.0.0" }], dryRun: false });
      assert.equal(second.removed.length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
