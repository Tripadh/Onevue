/**
 * =========================================================================
 * OneVue Phase 6.3 — Real offline dependency build (explicitly gated)
 * =========================================================================
 *
 * Runs a REAL rootless Podman build that installs a dependency from a
 * read-only, pre-populated npm cache with networking disabled. Skipped unless
 * explicitly authorized:
 *
 *   # one-time cache preparation (networked host):
 *   mkdir -p /tmp/onevue-npm-cache
 *   npm cache add is-number@7.0.0 --cache /tmp/onevue-npm-cache
 *
 *   set -a; . backend/.env.local; set +a
 *   ONEVUE_TEST_REAL_OFFLINE_BUILD=1 \
 *   ONEVUE_TEST_DEPENDENCY_CACHE_DIR=/tmp/onevue-npm-cache \
 *   node --test backend/tests/build_runtime_offline_real.test.js
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ENABLED = process.env.ONEVUE_TEST_REAL_OFFLINE_BUILD === "1";

if (!ENABLED) {
  describe(
    "Phase 6.3 — real offline dependency build",
    { skip: "Set ONEVUE_TEST_REAL_OFFLINE_BUILD=1 with a populated ONEVUE_TEST_DEPENDENCY_CACHE_DIR." },
    () => {
      it("requires explicit real-build authorization", () => {});
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

  const { OciContainerIsolationRuntimeAdapter } = require("../lib/template-build-runtime.ts");
  const { readBuildIsolationConfig } = require("../lib/template-build-isolation.ts");

  const PACKAGE_LOCK = {
    name: "offline-build-fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "offline-build-fixture",
        version: "1.0.0",
        dependencies: { "is-number": "^7.0.0" },
      },
      "node_modules/is-number": {
        version: "7.0.0",
        resolved: "https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz",
        integrity:
          "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
        engines: { node: ">=0.12.0" },
      },
    },
  };

  const BUILD_JS = `const fs = require("node:fs");
const dns = require("node:dns").promises;

(async () => {
  let networkOpen = false;
  try {
    await dns.lookup("registry.npmjs.org");
    networkOpen = true;
  } catch {
    // Expected: networking is disabled inside the sandbox.
  }
  if (networkOpen) {
    console.error("NETWORK_OPEN");
    process.exit(9);
  }

  try {
    fs.writeFileSync("/src/onevue-should-not-write", "x");
    console.error("SOURCE_WRITABLE");
    process.exit(8);
  } catch {
    // Expected: the source mount is read-only.
  }

  const isNumber = require("is-number");
  const installedVersion = require("is-number/package.json").version;
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync(
    "dist/index.html",
    '<!DOCTYPE html><html><body data-dep="' + installedVersion + '">offline build ok: ' + isNumber(42) + "</body></html>"
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

  function createFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-63-offline-src-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "offline-build-fixture",
          version: "1.0.0",
          scripts: { build: "node build.js" },
          dependencies: { "is-number": "^7.0.0" },
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(PACKAGE_LOCK, null, 2));
    fs.writeFileSync(path.join(dir, "build.js"), BUILD_JS);
    return dir;
  }

  function configFor(cacheDir) {
    const env = { ...process.env, ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: cacheDir };
    const read = readBuildIsolationConfig(env);
    assert.equal(read.errors.length, 0, read.errors.join(" "));
    assert.ok(read.config, "isolation configuration must be valid");
    return read.config;
  }

  describe("Phase 6.3 — real offline dependency build", () => {
    it("installs from the read-only cache and builds with networking disabled", async () => {
      const cacheDir = process.env.ONEVUE_TEST_DEPENDENCY_CACHE_DIR;
      assert.ok(cacheDir && path.isAbsolute(cacheDir), "ONEVUE_TEST_DEPENDENCY_CACHE_DIR must be an absolute path");
      assert.ok(fs.existsSync(cacheDir), "the dependency cache directory must exist");

      const sourceDir = createFixture();
      const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-63-offline-out-"));
      const config = configFor(cacheDir);

      const adapter = new OciContainerIsolationRuntimeAdapter({ config, env: process.env });
      try {
        const result = await adapter.executeBuild({
          sourceDir,
          outputDir,
          buildScript: "node build.js",
          timeoutMs: 300000,
          config,
        });

        assert.equal(result.success, true, result.error);
        const html = fs.readFileSync(path.join(outputDir, "index.html"), "utf8");
        assert.ok(html.includes('data-dep="7.0.0"'), "the cached dependency must be installed inside the sandbox");
        assert.ok(html.includes("offline build ok: true"));
        assert.equal(
          fs.existsSync(path.join(sourceDir, "onevue-should-not-write")),
          false,
          "the source mount must remain read-only"
        );
      } finally {
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    });

    it("fails with an actionable error when the cache lacks a required package", async () => {
      const emptyCache = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-63-empty-cache-"));
      const sourceDir = createFixture();
      const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-63-offline-out-"));
      const config = configFor(emptyCache);
      const adapter = new OciContainerIsolationRuntimeAdapter({ config, env: process.env });
      try {
        const result = await adapter.executeBuild({
          sourceDir,
          outputDir,
          buildScript: "node build.js",
          timeoutMs: 300000,
          config,
        });
        assert.equal(result.success, false);
        assert.match(result.error, /missing from the cache|offline/i);
        assert.equal(
          fs.existsSync(path.join(outputDir, "index.html")),
          false,
          "no artifact may be produced when dependencies are unavailable"
        );
      } finally {
        fs.rmSync(emptyCache, { recursive: true, force: true });
        fs.rmSync(sourceDir, { recursive: true, force: true });
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
    });
  });
}
