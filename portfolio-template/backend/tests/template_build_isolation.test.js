const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

let ts;
try {
  ts = require("typescript");
} catch {
  ts = require("/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript");
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

const {
  getBuildIsolationStatus,
  readBuildIsolationConfig,
  SUPPORTED_ISOLATION_RUNTIMES,
} = require("../lib/template-build-isolation.ts");
const { IsolatedSandboxBuildExecutor } = require("../lib/template-build.ts");

function validIsolationEnv(overrides = {}) {
  return {
    ENABLE_ISOLATED_BUILD_EXECUTION: "true",
    ONEVUE_BUILD_ISOLATION_RUNTIME: "docker",
    ONEVUE_BUILD_ISOLATION_BINARY: "/usr/bin/docker",
    ONEVUE_BUILD_ISOLATION_IMAGE: `registry.example.test/onevue/build@sha256:${"a".repeat(64)}`,
    ONEVUE_BUILD_NETWORK_MODE: "none",
    ONEVUE_BUILD_READ_ONLY_ROOTFS: "true",
    ONEVUE_BUILD_TIMEOUT_MS: "120000",
    ONEVUE_BUILD_MEMORY_MB: "512",
    ONEVUE_BUILD_CPU_LIMIT: "1.5",
    ONEVUE_BUILD_PIDS_LIMIT: "128",
    ONEVUE_BUILD_ENV_ALLOWLIST: "NODE_ENV",
    ...overrides,
  };
}

function inertAdapter() {
  const calls = [];
  return {
    calls,
    async executeBuild(invocation) {
      calls.push(invocation);
      return { success: true, outputDir: invocation.outputDir };
    },
  };
}

describe("Phase 5.11.3 — Build runtime isolation configuration and fail-closed diagnostics", () => {
  it("is disabled by default and never falls back to host execution", async () => {
    const status = getBuildIsolationStatus({});
    assert.equal(status.enabled, false);
    assert.equal(status.configured, false);
    assert.equal(status.executable, false);
    assert.match(status.reason, /disabled by server policy/);
    assert.match(status.reason, /Host execution is strictly prohibited/);

    const executor = new IsolatedSandboxBuildExecutor({ env: {} });
    const result = await executor.executeBuild();
    assert.equal(result.success, false);
    assert.match(result.error, /Host execution is strictly prohibited/);
  });

  it("fails closed with actionable diagnostics when enabled configuration is incomplete", async () => {
    const env = { ENABLE_ISOLATED_BUILD_EXECUTION: "true" };
    const status = getBuildIsolationStatus(env);
    assert.equal(status.enabled, true);
    assert.equal(status.configured, false);
    assert.equal(status.executable, false);
    assert.match(status.errors.join(" "), /ONEVUE_BUILD_ISOLATION_RUNTIME/);
    assert.match(status.errors.join(" "), /ONEVUE_BUILD_ISOLATION_BINARY/);
    assert.match(status.errors.join(" "), /ONEVUE_BUILD_ISOLATION_IMAGE/);
    assert.match(status.errors.join(" "), /ONEVUE_BUILD_NETWORK_MODE/);
    assert.match(status.errors.join(" "), /ONEVUE_BUILD_TIMEOUT_MS/);

    const adapter = inertAdapter();
    const executor = new IsolatedSandboxBuildExecutor({ env, runtimeAdapter: adapter });
    const result = await executor.executeBuild({ sourceDir: "/tmp/source", outputDir: "/tmp/output" });
    assert.equal(result.success, false);
    assert.match(result.error, /configuration is invalid/);
    assert.match(result.error, /Host execution is strictly prohibited/);
    assert.equal(adapter.calls.length, 0);
  });

  it("rejects mutable images, permissive networking, writable roots, and unsafe limits", () => {
    const status = getBuildIsolationStatus(validIsolationEnv({
      ONEVUE_BUILD_ISOLATION_IMAGE: "registry.example.test/onevue/build:latest",
      ONEVUE_BUILD_NETWORK_MODE: "host",
      ONEVUE_BUILD_READ_ONLY_ROOTFS: "false",
      ONEVUE_BUILD_TIMEOUT_MS: "0",
      ONEVUE_BUILD_MEMORY_MB: "1",
      ONEVUE_BUILD_CPU_LIMIT: "0",
      ONEVUE_BUILD_PIDS_LIMIT: "1",
    }));

    assert.equal(status.configured, false);
    const errors = status.errors.join(" ");
    assert.match(errors, /immutable @sha256/);
    assert.match(errors, /exactly 'none'/);
    assert.match(errors, /exactly 'true'/);
    assert.match(errors, /ONEVUE_BUILD_TIMEOUT_MS/);
    assert.match(errors, /ONEVUE_BUILD_MEMORY_MB/);
    assert.match(errors, /ONEVUE_BUILD_CPU_LIMIT/);
    assert.match(errors, /ONEVUE_BUILD_PIDS_LIMIT/);
  });

  it("rejects unsupported runtimes, relative binaries, and credential-like environment allowlists", () => {
    const status = getBuildIsolationStatus(validIsolationEnv({
      ONEVUE_BUILD_ISOLATION_RUNTIME: "shell",
      ONEVUE_BUILD_ISOLATION_BINARY: "docker",
      ONEVUE_BUILD_ENV_ALLOWLIST: "NODE_ENV,GITHUB_TOKEN,PATH,LD_PRELOAD",
    }));

    assert.equal(status.configured, false);
    const errors = status.errors.join(" ");
    assert.match(errors, new RegExp(SUPPORTED_ISOLATION_RUNTIMES.join(", ")));
    assert.match(errors, /absolute filesystem path/);
    assert.match(errors, /GITHUB_TOKEN/);
    assert.match(errors, /PATH/);
    assert.match(errors, /LD_PRELOAD/);
    // Unknown or sensitive names are rejected, but safe names remain valid.
    assert.doesNotMatch(errors, /'NODE_ENV'/);
  });

  it("validates a complete configuration but still refuses to execute without a verified runtime adapter", async () => {
    const env = validIsolationEnv();
    const read = readBuildIsolationConfig(env);
    assert.equal(read.errors.length, 0);
    assert.equal(read.config.timeoutMs, 120000);
    assert.equal(read.config.memoryBytes, 512 * 1024 * 1024);
    assert.equal(read.config.cpus, 1.5);
    assert.equal(read.config.pidsLimit, 128);
    assert.deepEqual(read.config.envAllowlist, ["NODE_ENV"]);

    const status = getBuildIsolationStatus(env);
    assert.equal(status.enabled, true);
    assert.equal(status.configured, true);
    assert.equal(status.executable, false);
    assert.match(status.reason, /no verified isolation runtime adapter/);

    const executor = new IsolatedSandboxBuildExecutor({ env });
    const result = await executor.executeBuild({ sourceDir: "/tmp/source", outputDir: "/tmp/output" });
    assert.equal(result.success, false);
    assert.match(result.error, /no verified isolation runtime adapter/);
    assert.match(result.error, /Host execution is strictly prohibited/);
  });

  it("does not expose credential values in diagnostics", () => {
    const secret = "super-secret-value-that-must-not-leak";
    const status = getBuildIsolationStatus(validIsolationEnv({
      GITHUB_TOKEN: secret,
      ONEVUE_BUILD_ENV_ALLOWLIST: "GITHUB_TOKEN",
    }));
    assert.equal(status.configured, false);
    assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
    assert.match(status.errors.join(" "), /GITHUB_TOKEN/);
  });
});
