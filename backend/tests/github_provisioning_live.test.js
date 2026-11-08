/**
 * =========================================================================
 * OneVue — Live private-repository provisioning test (explicitly gated)
 * =========================================================================
 *
 * Creates a REAL private repository in a GitHub organization, pushes real
 * content into it through the Git Data API, verifies that it is private and
 * owned by the organization, and then deletes it again.
 *
 * It is skipped unless an operator explicitly authorizes it:
 *
 *   ONEVUE_LIVE_GITHUB_PROVISION=1 \
 *   GITHUB_PROVISIONING_TOKEN=<fine-grained PAT for the org> \
 *   [ONEVUE_LIVE_GITHUB_ORG=qubort-tech] \
 *   [ONEVUE_LIVE_GITHUB_REPO=onevue-provisioning-smoke-<unique>] \
 *   node --test backend/tests/github_provisioning_live.test.js
 *
 * Safety rules enforced by this suite:
 *   - The repository name must start with "onevue-provisioning-smoke-",
 *     unless ONEVUE_LIVE_GITHUB_ALLOW_ANY_REPO=1 is set.
 *   - The run ABORTS if the repository already exists; it never touches a
 *     pre-existing repository.
 *   - The repository is deleted in a `finally` block. If the deletion fails,
 *     the exact repository name is printed for manual cleanup.
 *   - The token is read only from the environment and is never printed.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let ts;
try {
  ts = require("typescript");
} catch {
  ts = require((() => { try { return require.resolve("typescript"); } catch { try { return require("node:path").resolve(__dirname, "../node_modules/typescript"); } catch { return require("node:path").resolve(__dirname, "../../portfolio/node_modules/typescript"); } } })());
}

if (!require.extensions[".ts"]) {
  require.extensions[".ts"] = function (module, filename) {
    const fs2 = require("node:fs");
    const content = fs2.readFileSync(filename, "utf8");
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

const { GitHubApiClient } = require("../lib/github-api-client.ts");
const {
  createProvisioningPlan,
  executeProvisioningPlan,
  LiveGitHubProvisioningExecutor,
  PROVENANCE_MARKER_PATH,
} = require("../lib/template-provisioning.ts");

const ENABLED = process.env.ONEVUE_LIVE_GITHUB_PROVISION === "1";
const ORG = (process.env.ONEVUE_LIVE_GITHUB_ORG || "qubort-tech").trim();
const ALLOW_ANY_REPO = process.env.ONEVUE_LIVE_GITHUB_ALLOW_ANY_REPO === "1";
const SMOKE_PREFIX = "onevue-provisioning-smoke-";
const REPO =
  (process.env.ONEVUE_LIVE_GITHUB_REPO || "").trim() ||
  `${SMOKE_PREFIX}${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
const TOKEN = (process.env.GITHUB_PROVISIONING_TOKEN || process.env.ONEVUE_GITHUB_TOKEN || "").trim();

const nameAllowed = ALLOW_ANY_REPO || REPO.startsWith(SMOKE_PREFIX);
const ready = ENABLED && Boolean(TOKEN) && Boolean(ORG) && Boolean(REPO) && nameAllowed;

if (!ready) {
  describe(
    "OneVue — live private-repository provisioning",
    {
      skip: !ENABLED
        ? "Live provisioning is disabled. Set ONEVUE_LIVE_GITHUB_PROVISION=1 to authorize."
        : !TOKEN
          ? "GITHUB_PROVISIONING_TOKEN (or ONEVUE_GITHUB_TOKEN) is required."
          : !nameAllowed
            ? `The repository name must start with '${SMOKE_PREFIX}' (or set ONEVUE_LIVE_GITHUB_ALLOW_ANY_REPO=1).`
            : "Live provisioning is not configured.",
    },
    () => {
      it("requires explicit live authorization", () => {});
    }
  );
} else {
  const VALID_SHA = "bc1589d81640a2bb0377484df2438515cecf0c29";

  function createSourceFixture(files) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-live-provision-"));
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }
    return {
      dir: tmpDir,
      cleanup: () => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      },
    };
  }

  describe("OneVue — live private-repository provisioning", () => {
    it("creates a real private repository, pushes content, verifies privacy, and deletes it", async () => {
      const client = new GitHubApiClient({ token: TOKEN });
      const executor = new LiveGitHubProvisioningExecutor(client, {
        ENABLE_LIVE_GITHUB_PROVISIONING: "true",
        GITHUB_PROVISIONING_TOKEN: TOKEN,
      });

      const fixture = createSourceFixture({
        "package.json": '{"name":"onevue-live-provisioning-smoke"}',
        "README.md": "# OneVue live provisioning smoke\n",
        "src/index.js": "export const smoke = true;\n",
      });

      let created = false;

      try {
        // 1. Refuse to touch a repository that already exists.
        const preExisting = await client.checkRepositoryExists(ORG, REPO);
        assert.equal(
          preExisting,
          false,
          `Refusing to run: '${ORG}/${REPO}' already exists. Choose a different repository name.`
        );

        // 2. Provision for real.
        const plan = createProvisioningPlan({
          sourceUrl: "https://github.com/onevue/live-provisioning-smoke-source",
          commitSha: VALID_SHA,
          templateId: "live-provisioning-smoke",
          templateVersion: "1.0.0",
          auditReport: {
            outcome: "PASS",
            timestamp: new Date().toISOString(),
            summary: { passed: true, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0 },
          },
          destinationRepo: REPO,
          explicitConfirmation: true,
          sourceDir: fixture.dir,
        });
        assert.equal(plan.valid, true, plan.error);

        const result = await executeProvisioningPlan(plan, executor);
        assert.equal(result.success, true, result.error);
        assert.equal(result.verifiedPrivate, true);
        assert.equal(result.isMock, false);
        assert.match(result.provenance.destinationCommitSha || "", /^[a-f0-9]{40}$/);
        created = true;

        // 3. Verify independently, with a second client, against live GitHub.
        const verifier = new GitHubApiClient({ token: TOKEN });
        const state = await verifier.getRepositoryState(ORG, REPO);
        assert.equal(state.success, true, state.error);
        assert.equal(state.exists, true);
        assert.equal(state.owner, ORG, "the repository must be owned by the target organization");
        assert.equal(state.isPrivate, true, "the repository must be private");
        assert.equal(state.visibility, "private");
        assert.match(state.headCommitSha || "", /^[a-f0-9]{40}$/);

        const verified = await verifier.verifyRepositoryState(ORG, REPO);
        assert.equal(verified.verified, true, verified.error);

        // The pushed content must actually be there.
        const readme = await verifier.readFileContent(ORG, REPO, "README.md", state.defaultBranch);
        assert.equal(readme.success, true, readme.error);
        assert.equal(readme.exists, true);
        assert.equal(
          Buffer.from(readme.contentBase64 || "", "base64").toString("utf8"),
          "# OneVue live provisioning smoke\n"
        );

        const marker = await verifier.readFileContent(ORG, REPO, PROVENANCE_MARKER_PATH, state.defaultBranch);
        assert.equal(marker.success, true, marker.error);
        assert.equal(marker.exists, true, "the provenance marker must be present in the mirror");
        const parsedMarker = JSON.parse(Buffer.from(marker.contentBase64 || "", "base64").toString("utf8"));
        assert.equal(parsedMarker.sourceCommitSha, VALID_SHA);

        // 4. A second provisioning attempt must adopt the existing mirror.
        const adopted = await executeProvisioningPlan(plan, executor);
        assert.equal(adopted.success, true, adopted.error);
        assert.equal(adopted.provenance.adopted, true, "an identical mirror must be adopted, not recreated");
      } finally {
        fixture.cleanup();

        // 5. Always clean up. The client refuses to delete a repository it did
        //    not create, so an unrelated repository can never be removed here.
        if (created) {
          const removal = await client.deleteRepository(ORG, REPO);
          if (removal.success) {
            const stillThere = await client.checkRepositoryExists(ORG, REPO);
            assert.equal(stillThere, false, "the test repository must be gone after cleanup");
          } else {
            console.error(
              `\n[ONEVUE LIVE PROVISIONING] Cleanup failed for '${ORG}/${REPO}': ${removal.error}\n` +
                `[ONEVUE LIVE PROVISIONING] Remove it manually: gh repo delete ${ORG}/${REPO} --yes`
            );
          }
        }
      }
    });
  });
}
