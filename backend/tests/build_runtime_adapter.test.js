/**
 * =========================================================================
 * OneVue Phase 5.18 — OCI build runtime adapter (contract tests)
 * =========================================================================
 *
 * These tests drive the adapter against a FAKE runtime executable that mimics
 * the docker/podman CLI. They verify command construction, preflight gating,
 * timeouts, cancellation, cleanup, environment filtering and artifact output
 * validation.
 *
 * IMPORTANT: a fake runtime proves the adapter CONTRACT only. It does not
 * prove real kernel/container isolation. Real-isolation evidence requires
 * `build_runtime_real.test.js` on a host with a rootless runtime.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Module = require("node:module");

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

const {
  OciContainerIsolationRuntimeAdapter,
  preflightRuntime,
  resolveBuildRuntime,
  createConfiguredBuildExecutor,
  validateBuildRuntimeAtStartup,
  clearRuntimePreflightCache,
} = require("../lib/template-build-runtime.ts");
const { readBuildIsolationConfig } = require("../lib/template-build-isolation.ts");
const { IsolatedSandboxBuildExecutor } = require("../lib/template-build.ts");
const {
  orchestrateTemplateLifecycle,
  InMemoryLifecyclePersistence,
} = require("../lib/template-lifecycle.ts");
const { LocalFilesystemStorageAdapter } = require("../lib/template-storage.ts");

const IMAGE_DIGEST = `registry.example.invalid/onevue/build@sha256:${"a".repeat(64)}`;
const DIGEST = "a".repeat(64);

/* =========================================================================
   Fake runtime executable
   ========================================================================= */

function createFakeRuntime(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-518-fake-runtime-"));
  const binary = path.join(dir, "fake-oci");
  const logFile = path.join(dir, "calls.log");
  fs.writeFileSync(logFile, "");

  const mode = options.mode || "success";
  const infoMode = options.infoMode || "rootless";
  const imageDigest = options.imageDigest || `registry.example.invalid/onevue/build@sha256:${DIGEST}`;
  const exitCode = options.exitCode || 0;

  const script = `#!/bin/sh
LOG="${logFile}"
{
  echo "---CALL---"
  printf '%s\\n' "$@"
} >> "$LOG"

case "$1" in
  --version)
    echo "fake-runtime 9.9.9"
    exit 0
    ;;
  info)
    ${infoMode === "down" ? 'echo "cannot connect to the daemon" >&2; exit 1' : ""}
    ${infoMode === "rootful" ? 'echo \'29.0.0|["name=seccomp,profile=builtin"]\'; exit 0' : ""}
    echo '29.0.0|["name=rootless"]'
    exit 0
    ;;
  image)
    ${
      options.imageMissing
        ? 'echo "Error: No such image" >&2; exit 1'
        : `echo '["${imageDigest}"]'; exit 0`
    }
    ;;
  rm)
    exit 0
    ;;
  run)
    mount_out=""
    mount_work=""
    mount_src=""
    read_only_src=0
    for arg in "$@"; do
      case "$arg" in
        *dst=/out*) mount_out=$(printf '%s' "$arg" | sed -n 's/.*src=\\([^,]*\\).*/\\1/p');;
        *dst=/work*) mount_work=$(printf '%s' "$arg" | sed -n 's/.*src=\\([^,]*\\).*/\\1/p');;
        *dst=/src*) mount_src=$(printf '%s' "$arg" | sed -n 's/.*src=\\([^,]*\\).*/\\1/p');
                    case "$arg" in *readonly*) read_only_src=1;; esac;;
      esac
    done
    if [ "$read_only_src" = "1" ] && [ -n "$mount_src" ]; then
      echo "ONVUE_FAKE_SRC_READONLY=1" >> "$mount_work/.fake-src-mode"
    fi
    ${mode === "sleep" ? 'if [ -n "$mount_out" ]; then sleep 5; fi; exit 0' : ""}
    ${mode === "fail" ? `if [ -n "$mount_out" ]; then echo "simulated build failure" >&2; exit ${exitCode || 7}; fi; exit 0` : ""}
    ${mode === "fail-tail" ? `if [ -n "$mount_out" ]; then i=0; while [ "$i" -lt 40 ]; do echo "npm WARN deprecated simulated-package-$i" >&2; i=$((i + 1)); done; echo "FATAL_WEBPACK_ERROR: Module not found: Error: Can't resolve './missing-module'" >&2; exit 1; fi; exit 0` : ""}
    ${
      mode === "missing-cache"
        ? 'if [ -n "$mount_out" ]; then echo "ONeVUE_DEPENDENCY_CACHE_MISSING: a package lock is present but no dependency cache was mounted (ONEVUE_BUILD_DEPENDENCY_CACHE_DIR)." >&2; exit 6; fi; exit 0'
        : ""
    }
    ${
      mode === "missing-deps"
        ? 'if [ -n "$mount_out" ]; then echo "npm ERR! code ENOTCACHED" >&2; echo "npm ERR! request to https://registry.npmjs.org/is-number failed: cache mode is offline" >&2; exit 1; fi; exit 0'
        : ""
    }
    ${mode === "empty" ? "exit 0" : ""}
    ${
      mode === "symlink"
        ? `if [ -n "$mount_out" ]; then printf '<html></html>' > "$mount_out/index.html"; ln -s /etc/passwd "$mount_out/evil"; fi; exit 0`
        : ""
    }
    ${
      mode === "oversize"
        ? `if [ -n "$mount_out" ]; then mkdir -p "$mount_out"; dd if=/dev/zero of="$mount_out/big.bin" bs=1024 count=2048 2>/dev/null; fi; exit 0`
        : ""
    }
    ${
      mode === "success"
        ? `if [ -n "$mount_out" ]; then
             mkdir -p "$mount_out/assets"
             printf '<!DOCTYPE html><html><body>fake build</body></html>' > "$mount_out/index.html"
             printf 'console.log("fake");' > "$mount_out/assets/index.js"
             printf 'ok' > "$mount_work/marker.txt"
           fi
           exit 0`
        : ""
    }
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
`;
  fs.writeFileSync(binary, script, { mode: 0o755 });
  fs.chmodSync(binary, 0o755);
  return { dir, binary, logFile };
}

function readCalls(logFile) {
  const raw = fs.readFileSync(logFile, "utf8");
  return raw
    .split("---CALL---\n")
    .filter((block) => block.trim())
    .map((block) => block.split("\n").filter((line) => line.length > 0));
}

function buildEnv(binary, overrides = {}) {
  return {
    ENABLE_ISOLATED_BUILD_EXECUTION: "true",
    ONEVUE_BUILD_ISOLATION_RUNTIME: "docker",
    ONEVUE_BUILD_ISOLATION_BINARY: binary,
    ONEVUE_BUILD_ISOLATION_IMAGE: IMAGE_DIGEST,
    ONEVUE_BUILD_NETWORK_MODE: "none",
    ONEVUE_BUILD_READ_ONLY_ROOTFS: "true",
    ONEVUE_BUILD_TIMEOUT_MS: "5000",
    ONEVUE_BUILD_MEMORY_MB: "256",
    ONEVUE_BUILD_CPU_LIMIT: "1",
    ONEVUE_BUILD_PIDS_LIMIT: "64",
    ONEVUE_BUILD_ENV_ALLOWLIST: "SAFE_BUILD_FLAG",
    ONEVUE_BUILD_MAX_OUTPUT_BYTES: String(1024 * 1024),
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SAFE_BUILD_FLAG: "safe-value",
    JWT_SECRET: "super-secret-host-value-do-not-pass",
    MONGODB_URI: "mongodb://secret-host/db",
    ...overrides,
  };
}

function configFrom(env) {
  const read = readBuildIsolationConfig(env);
  assert.equal(read.errors.length, 0, read.errors.join(" "));
  return read.config;
}

function makeSource() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-518-source-"));
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fake-template", scripts: { build: "vite build" } })
  );
  fs.writeFileSync(path.join(dir, "vite.config.js"), "export default {};\n");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "main.js"), "console.log('source');\n");
  return dir;
}

const tempDirs = [];
function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Phase 5.18 — OCI isolation runtime adapter (contract)", () => {
  beforeEach(() => {
    const owner = fs.statSync(process.execPath);
    assert.ok(owner);
    clearRuntimePreflightCache();
  });

  afterEach(() => {
    clearRuntimePreflightCache();
  });

  it("detects that builds are disabled by default", async () => {
    const resolution = await resolveBuildRuntime({});
    assert.equal(resolution.status.enabled, false);
    assert.equal(resolution.adapter, undefined);

    const validation = await validateBuildRuntimeAtStartup({});
    assert.equal(validation.executable, false);
  });

  it("passes preflight only for a rootless runtime with a matching pinned image", async () => {
    const fake = createFakeRuntime();
    const config = configFrom(buildEnv(fake.binary));
    const result = await preflightRuntime(config, buildEnv(fake.binary), { force: true });

    assert.equal(result.ok, true, result.errors.join(" "));
    assert.equal(result.rootless, true);
    assert.equal(result.imageDigestVerified, true);
    assert.equal(result.smokeTestPassed, true);
    assert.match(result.version, /fake-runtime/);

    const resolution = await resolveBuildRuntime(buildEnv(fake.binary));
    assert.ok(resolution.adapter, resolution.status.reason);
  });

  it("refuses an unreachable daemon (real host state today)", async () => {
    const fake = createFakeRuntime({ infoMode: "down" });
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const result = await preflightRuntime(config, env, { force: true });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /daemon is not reachable/i.test(error)));

    const resolution = await resolveBuildRuntime(env);
    assert.equal(resolution.adapter, undefined);
    assert.equal(resolution.status.executable, false);
  });

  it("refuses a rootful daemon", async () => {
    const fake = createFakeRuntime({ infoMode: "rootful" });
    const env = buildEnv(fake.binary);
    const result = await preflightRuntime(configFrom(env), env, { force: true });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => /not rootless/i.test(error)));
  });

  it("refuses a missing image or a digest mismatch", async () => {
    const missing = createFakeRuntime({ imageMissing: true });
    const missingEnv = buildEnv(missing.binary);
    const missingResult = await preflightRuntime(configFrom(missingEnv), missingEnv, { force: true });
    assert.equal(missingResult.ok, false);
    assert.ok(missingResult.errors.some((error) => /not present locally/i.test(error)));

    const mismatch = createFakeRuntime({ imageDigest: `repo@sha256:${"b".repeat(64)}` });
    const mismatchEnv = buildEnv(mismatch.binary);
    const mismatchResult = await preflightRuntime(configFrom(mismatchEnv), mismatchEnv, { force: true });
    assert.equal(mismatchResult.ok, false);
    assert.ok(mismatchResult.errors.some((error) => /does not match the pinned digest/i.test(error)));
  });

  it("executes with network none, read-only rootfs/source, limits and a filtered environment", async () => {
    const fake = createFakeRuntime();
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const sourceDir = makeSource();
    const outputDir = makeTemp("onevue-518-out-");

    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });
    const result = await adapter.executeBuild({
      sourceDir,
      outputDir,
      buildScript: "vite build",
      timeoutMs: 3000,
      config,
    });

    assert.equal(result.success, true, result.error);
    assert.equal(fs.existsSync(path.join(outputDir, "index.html")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "assets", "index.js")), true);

    const calls = readCalls(fake.logFile);
    const runCall = calls.find(
      (call) => call[0] === "run" && call.some((arg) => arg.includes("dst=/out"))
    );
    assert.ok(runCall, `a build container must be executed: ${JSON.stringify(calls)}`);

    const joined = runCall.join(" ");
    assert.ok(joined.includes("--network none"));
    assert.ok(joined.includes("--read-only"));
    assert.ok(joined.includes("--cap-drop ALL"));
    assert.ok(joined.includes("--security-opt no-new-privileges"));
    assert.ok(joined.includes("--pids-limit 64"));
    assert.ok(joined.includes(`--memory ${256 * 1024 * 1024}`));
    assert.ok(joined.includes("--cpus 1"));
    assert.ok(/src=[^,]+,dst=\/src,readonly/.test(joined), "source must be mounted read-only");
    assert.ok(/src=[^,]+,dst=\/work(?:\s|,|$)/.test(joined), "a separate writable workspace is mounted");
    assert.ok(/src=[^,]+,dst=\/out(?:\s|,|$)/.test(joined), "a separate output mount is required");
    assert.ok(joined.includes("-e SAFE_BUILD_FLAG=safe-value"));
    assert.ok(!joined.includes("JWT_SECRET"), "host secrets must never be passed");
    assert.ok(!joined.includes("super-secret-host-value-do-not-pass"));
    assert.ok(!joined.includes("MONGODB_URI"));
    assert.ok(joined.includes(IMAGE_DIGEST), "the digest-pinned image reference must be used");

    // Container cleanup is requested even after a normal exit.
    assert.ok(calls.some((call) => call[0] === "rm" && call.some((arg) => arg === "-f")));
  });

  it("kills the sandbox and cleans up on timeout", async () => {
    const fake = createFakeRuntime({ mode: "sleep" });
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });
    const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("onevue-build-work-"));

    const started = Date.now();
    const result = await adapter.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 100,
      config,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /timed out/i);
    assert.ok(Date.now() - started < 3000, "timeout must terminate promptly");
    const calls = readCalls(fake.logFile);
    assert.ok(calls.some((call) => call[0] === "rm"), "the container must be removed after a timeout");
    const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("onevue-build-work-"));
    assert.deepEqual(after, before, "the workspace must be removed");
  });

  it("cancels via an AbortSignal and cleans up", async () => {
    const fake = createFakeRuntime({ mode: "sleep" });
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);

    const result = await adapter.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 5000,
      signal: controller.signal,
      config,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /cancelled/i);
    assert.ok(readCalls(fake.logFile).some((call) => call[0] === "rm"));
  });

  it("rejects symbolic links and oversized output from the sandbox", async () => {
    const symlinkRuntime = createFakeRuntime({ mode: "symlink" });
    const symlinkEnv = buildEnv(symlinkRuntime.binary);
    const symlinkResult = await new OciContainerIsolationRuntimeAdapter({
      config: configFrom(symlinkEnv),
      env: symlinkEnv,
    }).executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 3000,
      config: configFrom(symlinkEnv),
    });
    assert.equal(symlinkResult.success, false);
    assert.match(symlinkResult.error, /symbolic link/i);

    const oversizeRuntime = createFakeRuntime({ mode: "oversize" });
    const oversizeEnv = buildEnv(oversizeRuntime.binary);
    const oversizeResult = await new OciContainerIsolationRuntimeAdapter({
      config: configFrom(oversizeEnv),
      env: oversizeEnv,
    }).executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 3000,
      config: configFrom(oversizeEnv),
    });
    assert.equal(oversizeResult.success, false);
    assert.match(oversizeResult.error, /byte limit/i);
  });

  it("rejects an empty artifact and a missing build command", async () => {
    const emptyRuntime = createFakeRuntime({ mode: "empty" });
    const env = buildEnv(emptyRuntime.binary);
    const emptyResult = await new OciContainerIsolationRuntimeAdapter({
      config: configFrom(env),
      env,
    }).executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 3000,
      config: configFrom(env),
    });
    assert.equal(emptyResult.success, false);
    assert.match(emptyResult.error, /index\.html/i);

    const noCommand = await new OciContainerIsolationRuntimeAdapter({
      config: configFrom(env),
      env,
    }).executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "   ",
      timeoutMs: 3000,
      config: configFrom(env),
    });
    assert.equal(noCommand.success, false);
    assert.match(noCommand.error, /build command/i);
  });

  it("fails closed through the executor when preflight fails", async () => {
    const fake = createFakeRuntime({ infoMode: "down" });
    const env = buildEnv(fake.binary);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config: configFrom(env), env });
    const executor = new IsolatedSandboxBuildExecutor({ env, runtimeAdapter: adapter });

    const result = await executor.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 1000,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /preflight failed/i);
    assert.ok(
      !readCalls(fake.logFile).some(
        (call) => call[0] === "run" && call.some((arg) => arg.includes("dst=/out"))
      )
    );
  });

  it("integrates with the lifecycle and only publishes on success", async () => {
    const fake = createFakeRuntime();
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });
    const executor = new IsolatedSandboxBuildExecutor({ env, runtimeAdapter: adapter });

    const sourceDir = makeSource();
    const storageRoot = makeTemp("onevue-518-storage-");
    const storage = new LocalFilesystemStorageAdapter(storageRoot);
    const review = {
      ingestionId: "ing_518_lifecycle",
      status: "approved",
      auditReport: { outcome: "PASS" },
      reviewDecision: { reason: "approved for isolated build test" },
      sourceCommitSha: "bc1589d81640a2bb0377484df2438515cecf0c29",
      templateId: "isolated-build-template",
      templateVersion: "1.0.0",
    };

    const result = await orchestrateTemplateLifecycle({
      sourceDir,
      review,
      explicitConfirmation: true,
      persistence: new InMemoryLifecyclePersistence([
        {
          ingestionId: review.ingestionId,
          status: "APPROVED",
          templateId: review.templateId,
          templateVersion: review.templateVersion,
          sourceCommitSha: review.sourceCommitSha,
          updatedAt: new Date(0).toISOString(),
        },
      ]),
      storageAdapter: storage,
      buildExecutor: executor,
      stagedArtifactsRoot: makeTemp("onevue-518-stage-"),
    });

    assert.equal(result.success, true, result.error);
    assert.equal(result.status, "CATALOG_ELIGIBLE");
    assert.equal(
      fs.existsSync(path.join(storageRoot, "templates", review.templateId, review.templateVersion, "index.html")),
      true
    );

    // A failing sandbox must not produce a stored artifact.
    const failingRuntime = createFakeRuntime({ mode: "fail" });
    const failEnv = buildEnv(failingRuntime.binary);
    const failingExecutor = new IsolatedSandboxBuildExecutor({
      env: failEnv,
      runtimeAdapter: new OciContainerIsolationRuntimeAdapter({
        config: configFrom(failEnv),
        env: failEnv,
      }),
    });
    const failingReview = { ...review, ingestionId: "ing_518_fail", templateVersion: "1.0.1" };
    const failed = await orchestrateTemplateLifecycle({
      sourceDir: makeSource(),
      review: failingReview,
      explicitConfirmation: true,
      persistence: new InMemoryLifecyclePersistence([
        {
          ingestionId: failingReview.ingestionId,
          status: "APPROVED",
          templateId: failingReview.templateId,
          templateVersion: failingReview.templateVersion,
          sourceCommitSha: failingReview.sourceCommitSha,
          updatedAt: new Date(0).toISOString(),
        },
      ]),
      storageAdapter: storage,
      buildExecutor: failingExecutor,
      stagedArtifactsRoot: makeTemp("onevue-518-stage-"),
    });
    assert.equal(failed.success, false);
    assert.equal(
      fs.existsSync(path.join(storageRoot, "templates", failingReview.templateId, failingReview.templateVersion)),
      false,
      "a failed isolated build must not register an artifact"
    );
  });

  it("produces an executor only after preflight (route integration contract)", async () => {
    const fake = createFakeRuntime();
    const env = buildEnv(fake.binary);
    const ok = await createConfiguredBuildExecutor(env);
    assert.ok(ok.executor, ok.resolution.status.reason);

    const down = createFakeRuntime({ infoMode: "down" });
    const badEnv = buildEnv(down.binary);
    const rejected = await createConfiguredBuildExecutor(badEnv);
    assert.equal(rejected.executor, undefined);
    assert.equal(rejected.resolution.status.executable, false);
  });

  it("validates the offline dependency cache directory (absolute, existing, directory)", () => {
    const fake = createFakeRuntime();
    const cacheDir = makeTemp("onevue-518-npm-cache-");
    const cacheFile = path.join(makeTemp("onevue-518-cache-file-"), "cache.txt");
    fs.writeFileSync(cacheFile, "not-a-directory");

    const valid = readBuildIsolationConfig(buildEnv(fake.binary, { ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: cacheDir }));
    assert.equal(valid.errors.length, 0, valid.errors.join(" "));
    assert.equal(valid.config.dependencyCacheDir, path.resolve(cacheDir));

    const relative = readBuildIsolationConfig(
      buildEnv(fake.binary, { ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: "relative/cache" })
    );
    assert.ok(relative.errors.some((error) => /absolute directory path/i.test(error)));

    const missing = readBuildIsolationConfig(
      buildEnv(fake.binary, { ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: path.join(os.tmpdir(), "onevue-does-not-exist-cache") })
    );
    assert.ok(missing.errors.some((error) => /does not exist or is not accessible/i.test(error)));

    const notDir = readBuildIsolationConfig(
      buildEnv(fake.binary, { ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: cacheFile })
    );
    assert.ok(notDir.errors.some((error) => /must point at a directory/i.test(error)));

    // No cache configured remains valid (with a warning), preserving old behavior.
    const absent = readBuildIsolationConfig(buildEnv(fake.binary));
    assert.equal(absent.errors.length, 0, absent.errors.join(" "));
    assert.equal(absent.config.dependencyCacheDir, undefined);
    assert.ok(absent.warnings.some((warning) => /No offline dependency cache/i.test(warning)));
  });

  it("mounts the cache read-only at /deps and installs dependencies offline", async () => {
    const fake = createFakeRuntime();
    const cacheDir = makeTemp("onevue-518-npm-cache-");
    const env = buildEnv(fake.binary, { ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: cacheDir });
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });

    const result = await adapter.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 3000,
      config,
    });
    assert.equal(result.success, true, result.error);

    const calls = readCalls(fake.logFile);
    const runCall = calls.find(
      (call) => call[0] === "run" && call.some((arg) => arg.includes("dst=/out"))
    );
    assert.ok(runCall, "a build container must be executed");
    const depsMount = runCall.filter((arg) => arg.includes("dst=/deps"));
    assert.equal(depsMount.length, 1, "the cache must be mounted exactly once");
    assert.match(depsMount[0], new RegExp(`src=${cacheDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},dst=/deps,readonly`));

    // Multi-line arguments are logged line by line; join them back.
    const script = runCall.join("\n");
    assert.ok(script.includes("npm ci --offline --ignore-scripts --no-audit --no-fund --cache /deps"));
    assert.ok(script.includes("pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir /deps"));
    assert.ok(script.includes("yarn install --offline --frozen-lockfile --ignore-scripts --cache-folder /deps"));
    assert.ok(script.includes("ONeVUE_DEPENDENCY_CACHE_MISSING"));
    assert.ok(!script.includes("npm ci ") || script.includes("--offline"), "npm install must never run online");
  });

  it("does not mount /deps when no cache is configured, and the script fails closed on lockfiles", async () => {
    const fake = createFakeRuntime();
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });

    const result = await adapter.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 3000,
      config,
    });
    assert.equal(result.success, true, result.error);

    const runCall = readCalls(fake.logFile).find(
      (call) => call[0] === "run" && call.some((arg) => arg.includes("dst=/out"))
    );
    assert.ok(runCall);
    assert.ok(!runCall.some((arg) => arg.includes("dst=/deps")), "no cache mount may be added");
    const script = runCall.join("\n");
    assert.ok(script.includes("ONeVUE_DEPENDENCY_CACHE_MISSING"));
    assert.ok(script.includes("[ ! -d /deps ]"));
  });

  it("fails closed with an actionable error when sandbox reports missing dependency cache", async () => {
    const fake = createFakeRuntime({ mode: "missing-cache" });
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });

    const result = await adapter.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 3000,
      config,
    });
    assert.equal(result.success, false);
    assert.match(
      result.error,
      /Dependency installation is unavailable: the template has a lockfile but no offline dependency cache is configured/i
    );
  });

  it("reports an actionable error when required packages are missing offline", async () => {
    const fake = createFakeRuntime({ mode: "missing-deps" });
    const cacheDir = makeTemp("onevue-518-npm-cache-");
    const env = buildEnv(fake.binary, { ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: cacheDir });
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });

    const result = await adapter.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "vite build",
      timeoutMs: 3000,
      config,
    });
    assert.equal(result.success, false);
    assert.match(result.error, /missing from the cache/i);
    assert.match(result.error, /Populate ONEVUE_BUILD_DEPENDENCY_CACHE_DIR/i);
  });

  it("preserves the final build error after verbose npm warnings", async () => {
    const fake = createFakeRuntime({ mode: "fail-tail" });
    const env = buildEnv(fake.binary);
    const config = configFrom(env);
    const adapter = new OciContainerIsolationRuntimeAdapter({ config, env });
    const result = await adapter.executeBuild({
      sourceDir: makeSource(),
      outputDir: makeTemp("onevue-518-out-"),
      buildScript: "react-scripts --openssl-legacy-provider build",
      timeoutMs: 3000,
      config,
    });

    assert.equal(result.success, false);
    assert.match(result.error, /FATAL_WEBPACK_ERROR: Module not found/);
    assert.match(result.error, /npm WARN deprecated simulated-package-39/);
  });

  it("fails closed when the configured cache disappears after configuration", async () => {
    const fake = createFakeRuntime();
    const cacheDir = makeTemp("onevue-518-npm-cache-");
    const env = buildEnv(fake.binary, { ONEVUE_BUILD_DEPENDENCY_CACHE_DIR: cacheDir });
    const config = configFrom(env);
    fs.rmSync(cacheDir, { recursive: true, force: true });

    const resolution = await resolveBuildRuntime(env);
    assert.equal(resolution.adapter, undefined);
    assert.equal(resolution.status.executable, false);
    assert.ok(
      (resolution.preflight?.errors || []).some((error) => /does not exist|not accessible|absolute/i.test(error)) ||
        resolution.status.errors.some((error) => /does not exist|not accessible|absolute/i.test(error))
    );
  });
});
