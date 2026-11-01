/**
 * =========================================================================
 * OneVue Phase 5.18 — Real isolated build smoke test (explicitly gated)
 * =========================================================================
 *
 * Runs a REAL container build through the OCI isolation adapter. Skipped unless
 * an operator authorizes it on a host with a configured rootless runtime:
 *
 *   ENABLE_ISOLATED_BUILD_EXECUTION=true \
 *   ONEVUE_TEST_REAL_ISOLATION=1 \
 *   ONEVUE_BUILD_ISOLATION_RUNTIME=podman \
 *   ONEVUE_BUILD_ISOLATION_BINARY=/usr/bin/podman \
 *   ONEVUE_BUILD_ISOLATION_IMAGE=...@sha256:... \
 *   ONEVUE_BUILD_NETWORK_MODE=none ONEVUE_BUILD_READ_ONLY_ROOTFS=true \
 *   ONEVUE_BUILD_TIMEOUT_MS=300000 ONEVUE_BUILD_MEMORY_MB=512 \
 *   ONEVUE_BUILD_CPU_LIMIT=1 ONEVUE_BUILD_PIDS_LIMIT=128 \
 *   node --test backend/tests/build_runtime_real.test.js
 *
 * The build script is a harmless, fixed script (no template code). It asserts
 * an artifact is produced, the source mount is read-only, and network egress
 * is unavailable when a client is present in the image.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ENABLED = process.env.ONEVUE_TEST_REAL_ISOLATION === "1";

if (!ENABLED) {
  describe(
    "Phase 5.18 — real isolated build smoke",
    { skip: "Set ONEVUE_TEST_REAL_ISOLATION=1 on a host with a verified rootless runtime." },
    () => {
      it("requires explicit real-isolation authorization", () => {});
    }
  );
} else {
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

  const { validateBuildRuntimeAtStartup, OciContainerIsolationRuntimeAdapter } = require(
    "../lib/template-build-runtime.ts"
  );
  const { readBuildIsolationConfig } = require("../lib/template-build-isolation.ts");

  const HARMLESS_BUILD_SCRIPT = [
    "set -eu",
    "mkdir -p dist",
    "printf '<!DOCTYPE html><html><body>real isolated smoke</body></html>' > dist/index.html",
    'if touch /src/onevue-should-not-write 2>/dev/null; then echo "SOURCE_WRITABLE" >&2; exit 9; fi',
    'if command -v wget >/dev/null 2>&1; then if wget -q -T 2 -O /dev/null http://1.1.1.1/ 2>/dev/null; then echo "NETWORK_OPEN" >&2; exit 8; fi; fi',
  ].join("\n");

  describe("Phase 5.18 — real isolated build smoke", () => {
    it("runs a harmless build inside the configured runtime", async () => {
      const validation = await validateBuildRuntimeAtStartup(process.env);
      assert.equal(validation.executable, true, `${validation.reason} ${validation.errors.join(" ")}`);

      const read = readBuildIsolationConfig(process.env);
      assert.ok(read.config, read.errors.join(" "));

      const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-518-real-src-"));
      const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-518-real-out-"));
      fs.writeFileSync(path.join(sourceDir, "package.json"), JSON.stringify({ name: "smoke" }));
      fs.writeFileSync(path.join(sourceDir, "index.html"), "<html></html>");

      const adapter = new OciContainerIsolationRuntimeAdapter({
        config: read.config,
        env: process.env,
      });
      const result = await adapter.executeBuild({
        sourceDir,
        outputDir,
        buildScript: HARMLESS_BUILD_SCRIPT,
        timeoutMs: read.config.timeoutMs,
        config: read.config,
      });

      try {
        assert.equal(result.success, true, result.error);
        assert.equal(fs.existsSync(path.join(outputDir, "index.html")), true);
        assert.equal(fs.existsSync(path.join(sourceDir, "onevue-should-not-write")), false);
      } finally {
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    });
  });
}
