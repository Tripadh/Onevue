/**
 * OneVue — Template Provisioning Resolution Test Suite
 *
 * Verifies:
 * 1. Local development uses mock provisioning without a token when live provisioning is disabled.
 * 2. Explicit live provisioning uses the real executor when configured.
 * 3. Explicit live provisioning fails closed when credentials are missing or invalid.
 * 4. Production never selects mock provisioning under any circumstances.
 * 5. Production missing credentials fails closed.
 * 6. Mock records clearly identify mock/local provisioning (destinationUrl, provenance, stages)
 *    and cannot be mistaken for a real GitHub mirror.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

// TypeScript hook
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
  resolveProvisioningExecutor,
  MockProvisioningExecutor,
  LiveGitHubProvisioningExecutor,
  createProvisioningPlan,
  executeProvisioningPlan,
} = require("../lib/template-provisioning");

describe("Template Provisioning Resolution", () => {
  describe("Local Development (Non-Production)", () => {
    it("1. selects MockProvisioningExecutor in development when live provisioning is disabled", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "development",
        ENABLE_LIVE_GITHUB_PROVISIONING: "false",
      });
      assert.equal(res.mode, "mock");
      assert.equal(res.isMock, true);
      assert.ok(res.executor instanceof MockProvisioningExecutor);
      assert.match(res.reason, /local development mock provisioning selected/i);
    });

    it("2. selects MockProvisioningExecutor when ENABLE_LIVE_GITHUB_PROVISIONING is unset", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "development",
      });
      assert.equal(res.mode, "mock");
      assert.equal(res.isMock, true);
      assert.ok(res.executor instanceof MockProvisioningExecutor);
    });

    it("3. operates without any GITHUB_PROVISIONING_TOKEN in development", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "development",
        GITHUB_PROVISIONING_TOKEN: "",
        ONEVUE_GITHUB_TOKEN: "",
      });
      assert.equal(res.mode, "mock");
      assert.ok(res.executor);
    });
  });

  describe("Explicit Live Provisioning", () => {
    it("4. selects LiveGitHubProvisioningExecutor when explicitly enabled with a valid token", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "development",
        ENABLE_LIVE_GITHUB_PROVISIONING: "true",
        GITHUB_PROVISIONING_TOKEN: "ghp_super_valid_token_at_least_20_chars_long",
      });
      assert.equal(res.mode, "live");
      assert.equal(res.isMock, false);
      assert.ok(res.executor instanceof LiveGitHubProvisioningExecutor);
    });

    it("5. fails closed when live provisioning is explicitly enabled but token is missing", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "development",
        ENABLE_LIVE_GITHUB_PROVISIONING: "true",
        GITHUB_PROVISIONING_TOKEN: "",
      });
      assert.equal(res.mode, "unavailable");
      assert.equal(res.isMock, false);
      assert.equal(res.executor, undefined);
      assert.match(res.reason, /credential.*missing or invalid/i);
    });

    it("6. fails closed when live provisioning is explicitly enabled but token is too short (< 20 chars)", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "development",
        ENABLE_LIVE_GITHUB_PROVISIONING: "true",
        GITHUB_PROVISIONING_TOKEN: "too_short_tok",
      });
      assert.equal(res.mode, "unavailable");
      assert.equal(res.isMock, false);
      assert.equal(res.executor, undefined);
    });
  });

  describe("Production Environment Enforcement", () => {
    it("7. never selects MockProvisioningExecutor in production even when live provisioning is disabled", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "production",
        ENABLE_LIVE_GITHUB_PROVISIONING: "false",
      });
      assert.equal(res.mode, "unavailable");
      assert.equal(res.isMock, false);
      assert.equal(res.executor, undefined);
      assert.match(res.reason, /required in production but disabled/i);
    });

    it("8. fails closed in production when live provisioning is unset", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "production",
      });
      assert.equal(res.mode, "unavailable");
      assert.equal(res.executor, undefined);
    });

    it("9. fails closed in production when live token is missing", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "production",
        ENABLE_LIVE_GITHUB_PROVISIONING: "true",
        GITHUB_PROVISIONING_TOKEN: "",
      });
      assert.equal(res.mode, "unavailable");
      assert.equal(res.executor, undefined);
      assert.match(res.reason, /missing or invalid/i);
    });

    it("10. allows LiveGitHubProvisioningExecutor in production only when live enabled and valid token present", () => {
      const res = resolveProvisioningExecutor({
        NODE_ENV: "production",
        ENABLE_LIVE_GITHUB_PROVISIONING: "true",
        GITHUB_PROVISIONING_TOKEN: "ghp_prod_valid_token_at_least_20_chars_long",
      });
      assert.equal(res.mode, "live");
      assert.equal(res.isMock, false);
      assert.ok(res.executor instanceof LiveGitHubProvisioningExecutor);
    });
  });

  describe("Mock Record Identification Contract", () => {
    it("11. MockProvisioningExecutor flags repositories as local development mock", async () => {
      const executor = new MockProvisioningExecutor();
      assert.equal(executor.isMock, true);

      const created = await executor.createPrivateRepository("qubort-tech", "test-template-1-0-0");
      assert.equal(created.success, true);
      assert.equal(created.isMock, true);
      assert.equal(created.url, "mock://local-development/qubort-tech/test-template-1-0-0");
      assert.ok(!created.url.startsWith("https://github.com/"), "Mock URL must not look like real GitHub");
    });

    it("12. executeProvisioningPlan tags provenance with mockProvisioning: true for mock executor", async () => {
      const executor = new MockProvisioningExecutor();
      const plan = {
        valid: true,
        destinationOrg: "qubort-tech",
        destinationRepo: "test-template-1-0-0",
        visibility: "private",
        provenance: {
          sourceUrl: "https://github.com/owner/repo",
          commitSha: "a".repeat(40),
          templateId: "test-template",
          templateVersion: "1.0.0",
          auditOutcome: "PASS",
          auditTimestamp: new Date().toISOString(),
          destinationOrg: "qubort-tech",
          destinationRepo: "test-template-1-0-0",
          provisionedAt: new Date().toISOString(),
        },
        filesToCopy: [],
        excludedFiles: [],
      };

      const result = await executeProvisioningPlan(plan, executor);
      assert.equal(result.success, true);
      assert.equal(result.isMock, true);
      assert.equal(result.provenance.mockProvisioning, true);
      assert.equal(result.provenance.provisionerMode, "mock_local");
    });
  });
});
