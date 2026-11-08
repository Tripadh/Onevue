/**
 * =========================================================================
 * OneVue Phase 5.17 — GitHub live smoke test (explicitly gated)
 * =========================================================================
 *
 * This suite makes REAL network requests to github.com. It is skipped by
 * default and runs only when an operator explicitly authorizes it:
 *
 *   ONEVUE_LIVE_GITHUB_SMOKE=1 \
 *   ONEVUE_LIVE_GITHUB_REPO=owner/repository \
 *   [ONEVUE_LIVE_GITHUB_REF=main] \
 *   [ONEVUE_LIVE_GITHUB_TOKEN=...]        # optional, for a private repo \
 *   node --test backend/tests/github_live_smoke.test.js
 *
 * The token is read only from the environment and is never printed. The test
 * asserts that pinning, download and safe extraction work against the live
 * API; it performs no writes, no provisioning and no build.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const ENABLED = process.env.ONEVUE_LIVE_GITHUB_SMOKE === "1";
const REPO_SPEC = (process.env.ONEVUE_LIVE_GITHUB_REPO || "").trim();
const REF = (process.env.ONEVUE_LIVE_GITHUB_REF || "").trim() || undefined;
const TOKEN = (process.env.ONEVUE_LIVE_GITHUB_TOKEN || "").trim() || null;
const EXPECTED_SHA = (process.env.ONEVUE_LIVE_GITHUB_SHA || "").trim() || undefined;

const ready = ENABLED && /^[^/]+\/[^/]+$/.test(REPO_SPEC);

if (!ready) {
  describe(
    "Phase 5.17 — GitHub live smoke",
    {
      skip: ENABLED
        ? "ONEVUE_LIVE_GITHUB_REPO must be 'owner/repository'"
        : "Live GitHub calls are disabled. Set ONEVUE_LIVE_GITHUB_SMOKE=1 and ONEVUE_LIVE_GITHUB_REPO to authorize.",
    },
    () => {
      it("requires explicit live authorization", () => {});
    }
  );
} else {
  const ts = require("typescript");
  const fs = require("node:fs");
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
    resolveGitHubCommitSha,
    downloadSourceArchive,
    inspectSourceArchive,
    validateGitHubRepoUrl,
    resolveGitHubReadToken,
    redactGitHubCredential,
  } = require("../lib/github-ingestion.ts");

  const [OWNER, REPO] = REPO_SPEC.split("/");

  describe("Phase 5.17 — GitHub live smoke", () => {
    it("resolves a branch to an immutable SHA, downloads and safely extracts it", async () => {
      const urlCheck = validateGitHubRepoUrl(`https://github.com/${OWNER}/${REPO}`);
      assert.equal(urlCheck.valid, true, urlCheck.error);

      const resolved = await resolveGitHubCommitSha({
        owner: OWNER,
        repo: REPO,
        ref: REF,
        authToken: TOKEN,
      });
      assert.equal(resolved.success, true, redactGitHubCredential(resolved.error, TOKEN));
      assert.match(resolved.sha, /^[a-f0-9]{40}$/);
      if (EXPECTED_SHA) assert.equal(resolved.sha, EXPECTED_SHA);

      const archive = await downloadSourceArchive({
        owner: OWNER,
        repo: REPO,
        sha: resolved.sha,
        authToken: TOKEN,
      });
      assert.equal(archive.success, true, redactGitHubCredential(archive.error, TOKEN));
      assert.ok(archive.buffer.length > 0);

      const extraction = await inspectSourceArchive(archive.buffer, { maxExtractedSizeBytes: 50 * 1024 * 1024 });
      try {
        assert.equal(extraction.success, true, extraction.error);
        assert.ok(extraction.fileCount > 0, "the archive must contain files");
        assert.equal(fs.existsSync(extraction.extractedDir), true);
      } finally {
        if (extraction.cleanup) await extraction.cleanup();
      }

      // Report which credential source was used without ever revealing it.
      const credential = resolveGitHubReadToken();
      assert.ok(["read_token", "provisioning_token", "none"].includes(credential.source));
    });
  });
}
