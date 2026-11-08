/**
 * =========================================================================
 * OneVue — GitHub API client + live provisioning path (offline contract)
 * =========================================================================
 *
 * Exercises the REAL live-provisioning code path against an in-memory fake of
 * the GitHub REST API. No network calls are made and no repository is created:
 * the fake `fetchImpl` implements the endpoints the provisioner uses
 * (repository create/read/delete, Git Data API blobs/trees/commits/refs,
 * contents read).
 *
 * Covered:
 *  1. Private repository creation payload invariants.
 *  2. Distinct error categorisation (401 / 403 / 422 / 429).
 *  3. Organizational and credential guards refuse before any network call.
 *  4. Repository state read (owner / visibility / head commit).
 *  5. Content push through the Git Data API (blob -> tree -> commit -> ref).
 *  6. Branch update when the ref already exists.
 *  7. Bounded retry on transient 5xx; no retry on 429.
 *  8. Rollback deletion restricted to repositories this run created.
 *  9. Credential redaction in error messages.
 * 10. Live executor pushes the approved source plus the provenance marker.
 * 11. Idempotent adoption of an already-correct mirror.
 * 12. Collision remains fatal when the mirror belongs to another commit.
 * 13. Rollback after a failed push removes the orphaned repository.
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

const {
  GitHubApiClient,
  FIXED_GITHUB_ORG,
  DEFAULT_PROVISIONING_BRANCH,
} = require("../lib/github-api-client.ts");

const {
  createProvisioningPlan,
  executeProvisioningPlan,
  LiveGitHubProvisioningExecutor,
  PROVENANCE_MARKER_PATH,
} = require("../lib/template-provisioning.ts");

const BASE_URL = "https://api.github.test";
const TOKEN = "ghp_offline_contract_token_at_least_20_chars";

/** Real git blob SHA-1, so the fake behaves like GitHub for content identity. */
function gitBlobSha(buffer) {
  return crypto
    .createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${buffer.length}\0`), buffer]))
    .digest("hex");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * In-memory GitHub fake. Repositories are stored by "owner/repo".
 */
function createFakeGitHub(options = {}) {
  const repos = new Map();
  const requests = [];
  let counter = 0;
  const nextSha = () => (counter += 1).toString(16).padStart(40, "0");

  /**
   * Resolves the file set of the repository's default branch by walking the
   * head commit to its tree. This mirrors GitHub, where a repository's content
   * is defined by the tree the head commit points at.
   */
  const resolveFiles = (key) => {
    const repo = repos.get(key);
    const out = new Map();
    if (!repo || !repo.default_branch) return out;
    const commitSha = repo.refs.get(`refs/heads/${repo.default_branch}`);
    if (!commitSha) return out;
    const commit = repo.commits.get(commitSha);
    if (!commit) return out;
    const entries = repo.trees.get(commit.tree) || [];
    for (const entry of entries) {
      const content = repo.blobs.get(entry.sha);
      if (content !== undefined) out.set(entry.path, content);
    }
    return out;
  };

  const fetchImpl = async (rawUrl, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const url = new URL(rawUrl);
    const pathname = url.pathname;
    requests.push({ method, pathname, body: init.body ? JSON.parse(init.body) : undefined });

    const body = init.body ? JSON.parse(init.body) : undefined;

    // POST /orgs/{org}/repos
    if (method === "POST" && /^\/orgs\/[^/]+\/repos$/.test(pathname)) {
      if (options.failCreate) return jsonResponse({ message: "server error" }, 500);
      const owner = pathname.split("/")[2];
      const key = `${owner}/${body.name}`;
      if (repos.has(key)) return jsonResponse({ message: "Repository creation failed." }, 422);
      const repo = {
        owner,
        name: body.name,
        private: body.private === true,
        visibility: body.visibility || (body.private ? "private" : "public"),
        default_branch: null,
        // Git objects are immutable and content-addressed: a new tree replaces
        // the previous tree rather than mutating it.
        blobs: new Map(),
        trees: new Map(),
        commits: new Map(),
        refs: new Map(),
      };
      repos.set(key, repo);
      /**
       * GitHub seeds a repository created with auto_init=true with an initial
       * commit (a README) on the default branch. The mirror is delivered
       * through the Git Data API, which requires a repository that already has
       * at least one commit, so this seeding is not optional.
       */
      if (body.auto_init === true) {
        const readme = Buffer.from(`# ${body.name}\n`, "utf8").toString("base64");
        const blobSha = gitBlobSha(Buffer.from(readme, "base64"));
        repo.blobs.set(blobSha, readme);
        const treeSha = nextSha();
        repo.trees.set(treeSha, [{ path: "README.md", mode: "100644", type: "blob", sha: blobSha }]);
        const commitSha = nextSha();
        repo.commits.set(commitSha, { sha: commitSha, message: "Initial commit", tree: treeSha, parents: [] });
        repo.default_branch = DEFAULT_PROVISIONING_BRANCH;
        repo.refs.set(`refs/heads/${DEFAULT_PROVISIONING_BRANCH}`, commitSha);
      }
      return jsonResponse({
        html_url: `https://github.com/${key}`,
        private: repo.private,
        visibility: repo.visibility,
        owner: { login: owner },
      }, 201);
    }

    const repoMatch = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (repoMatch) {
      const [, owner, name, rest = ""] = repoMatch;
      const key = `${owner}/${name}`;
      const repo = repos.get(key);

      if (method === "DELETE" && !rest) {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        repos.delete(key);
        return new Response(null, { status: 204 });
      }

      if (method === "GET" && !rest) {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        return jsonResponse({
          html_url: `https://github.com/${key}`,
          private: repo.private,
          visibility: repo.visibility,
          owner: { login: repo.owner },
          default_branch: repo.default_branch,
        });
      }

      // GET /repos/{owner}/{repo}/commits/{branch}
      const commitMatch = rest.match(/^\/commits\/(.+)$/);
      if (method === "GET" && commitMatch) {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        const branch = decodeURIComponent(commitMatch[1]);
        const sha = repo.refs.get(`refs/heads/${branch}`);
        if (!sha) return jsonResponse({ message: "Not Found" }, 404);
        return jsonResponse({ sha });
      }

      // GET /repos/{owner}/{repo}/contents/{path}
      const contentsMatch = rest.match(/^\/contents\/(.+)$/);
      if (method === "GET" && contentsMatch) {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        const filePath = decodeURIComponent(contentsMatch[1]);
        const content = resolveFiles(key).get(filePath);
        if (content === undefined) return jsonResponse({ message: "Not Found" }, 404);
        return jsonResponse({
          type: "file",
          sha: gitBlobSha(Buffer.from(content, "base64")),
          encoding: "base64",
          content,
        });
      }

      // GET /repos/{owner}/{repo}/git/ref/heads/{branch}
      const refMatch = rest.match(/^\/git\/ref\/heads\/(.+)$/);
      if (method === "GET" && refMatch) {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        const ref = `refs/heads/${decodeURIComponent(refMatch[1])}`;
        const sha = repo.refs.get(ref);
        if (!sha) return jsonResponse({ message: "Not Found" }, 404);
        return jsonResponse({ ref, object: { sha } });
      }

      // POST /repos/{owner}/{repo}/git/refs
      if (method === "POST" && rest === "/git/refs") {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        if (repo.refs.has(body.ref)) return jsonResponse({ message: "Reference already exists" }, 422);
        repo.refs.set(body.ref, body.sha);
        if (!repo.default_branch) repo.default_branch = body.ref.replace("refs/heads/", "");
        return jsonResponse({ ref: body.ref, object: { sha: body.sha } }, 201);
      }

      // PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
      const patchRefMatch = rest.match(/^\/git\/refs\/heads\/(.+)$/);
      if (method === "PATCH" && patchRefMatch) {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        const ref = `refs/heads/${decodeURIComponent(patchRefMatch[1])}`;
        repo.refs.set(ref, body.sha);
        return jsonResponse({ ref, object: { sha: body.sha } });
      }

      // POST /repos/{owner}/{repo}/git/blobs
      if (method === "POST" && rest === "/git/blobs") {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        /**
         * GitHub refuses to create a blob in a repository that has no commits:
         * `POST /git/blobs` answers `409 "Git Repository is empty."`. This is
         * the live failure that a repository created without an initial commit
         * produces, reproduced here so the offline contract catches it.
         */
        if (repo.commits.size === 0) {
          return jsonResponse({ message: "Git Repository is empty." }, 409);
        }
        if (options.failBlob) return jsonResponse({ message: "blob rejected" }, 422);
        const buffer = Buffer.from(body.content, "base64");
        const sha = gitBlobSha(buffer);
        repo.blobs.set(sha, body.content);
        return jsonResponse({ sha }, 201);
      }

      // POST /repos/{owner}/{repo}/git/trees
      if (method === "POST" && rest === "/git/trees") {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        for (const entry of body.tree || []) {
          if (!repo.blobs.has(entry.sha)) {
            return jsonResponse({ message: "blob missing" }, 422);
          }
        }
        const sha = nextSha();
        repo.trees.set(sha, body.tree || []);
        return jsonResponse({ sha }, 201);
      }

      // POST /repos/{owner}/{repo}/git/commits
      if (method === "POST" && rest === "/git/commits") {
        if (!repo) return jsonResponse({ message: "Not Found" }, 404);
        const sha = nextSha();
        repo.commits.set(sha, { sha, message: body.message, tree: body.tree, parents: body.parents || [] });
        return jsonResponse({ sha }, 201);
      }
    }

    return jsonResponse({ message: `Unhandled fake route ${method} ${pathname}` }, 500);
  };

  return { repos, requests, fetchImpl, resolveFiles };
}

function makeClient(fake, overrides = {}) {
  return new GitHubApiClient({
    token: TOKEN,
    baseUrl: BASE_URL,
    fetchImpl: fake.fetchImpl,
    retryBaseDelayMs: 0,
    ...overrides,
  });
}

function createSourceFixture(files) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-ghclient-"));
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

const VALID_SHA = "bc1589d81640a2bb0377484df2438515cecf0c29";
const PASS_AUDIT = {
  outcome: "PASS",
  timestamp: new Date().toISOString(),
  summary: { passed: true, criticalCount: 0, highCount: 0, mediumCount: 0, lowCount: 0 },
};

function buildPlan(fixture, overrides = {}) {
  return createProvisioningPlan({
    sourceUrl: "https://github.com/onevue/magicui-portfolio",
    commitSha: VALID_SHA,
    templateId: "magicui-portfolio",
    templateVersion: "1.0.0",
    auditReport: PASS_AUDIT,
    destinationRepo: "magicui-portfolio-mirror",
    explicitConfirmation: true,
    sourceDir: fixture.dir,
    ...overrides,
  });
}

describe("OneVue — GitHub API client (offline contract)", () => {
  describe("Repository creation", () => {
    it("creates a private repository with the invariant payload", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);

      const res = await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo", {
        description: "approved template",
      });

      assert.equal(res.success, true);
      assert.equal(res.visibility, "private");
      assert.equal(res.owner, FIXED_GITHUB_ORG);
      assert.equal(res.url, `https://github.com/${FIXED_GITHUB_ORG}/mirror-repo`);

      const create = fake.requests.find((r) => r.method === "POST" && r.pathname === `/orgs/${FIXED_GITHUB_ORG}/repos`);
      assert.ok(create, "the create request must have been issued");
      assert.equal(create.body.private, true);
      assert.equal(create.body.visibility, "private");
      /**
       * The repository MUST be seeded with an initial commit. GitHub's Git
       * Data API answers `409 "Git Repository is empty."` when a blob is
       * created in a repository that has no commits, so a repository created
       * without one can never receive the mirrored files.
       */
      assert.equal(create.body.auto_init, true);
      assert.equal(create.body.name, "mirror-repo");
    });

    it("seeds the created repository with an initial commit on the default branch", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);

      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");

      const repo = fake.repos.get(`${FIXED_GITHUB_ORG}/mirror-repo`);
      assert.ok(repo, "the repository must exist");
      assert.equal(repo.commits.size, 1, "the repository must start with an initial commit");
      assert.equal(repo.default_branch, DEFAULT_PROVISIONING_BRANCH);
      assert.equal(
        repo.refs.get(`refs/heads/${DEFAULT_PROVISIONING_BRANCH}`),
        [...repo.commits.keys()][0],
        "the default branch must point at the initial commit"
      );
    });

    it("maps 422, 401, 403 and 429 to distinct error categories", async () => {
      const cases = [
        { status: 422, category: "COLLISION" },
        { status: 401, category: "AUTHENTICATION_FAILED" },
        { status: 403, category: "INSUFFICIENT_PERMISSIONS" },
        { status: 429, category: "RATE_LIMITED" },
      ];

      for (const { status, category } of cases) {
        const client = new GitHubApiClient({
          token: TOKEN,
          baseUrl: BASE_URL,
          fetchImpl: async () => new Response("denied", { status }),
        });
        const res = await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");
        assert.equal(res.success, false);
        assert.equal(res.errorCategory, category, `status ${status} must map to ${category}`);
      }
    });

    it("refuses a foreign organization without issuing any request", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);

      const res = await client.createPrivateOrgRepository("some-other-org", "mirror-repo");
      assert.equal(res.success, false);
      assert.equal(res.errorCategory, "INSUFFICIENT_PERMISSIONS");
      assert.equal(fake.requests.length, 0, "no network call may be issued for a foreign org");
    });

    it("refuses to act without a credential and without a request", async () => {
      const fake = createFakeGitHub();
      const client = new GitHubApiClient({ token: "", baseUrl: BASE_URL, fetchImpl: fake.fetchImpl });

      const res = await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(res.success, false);
      assert.equal(res.errorCategory, "CONFIG_ERROR");
      assert.equal(fake.requests.length, 0);
    });
  });

  describe("Repository state", () => {
    it("reads owner, visibility and head commit", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");
      await client.pushFiles(FIXED_GITHUB_ORG, "mirror-repo", [
        { relativePath: "README.md", contentBase64: Buffer.from("# hi", "utf8").toString("base64") },
      ]);

      const state = await client.getRepositoryState(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(state.success, true);
      assert.equal(state.exists, true);
      assert.equal(state.owner, FIXED_GITHUB_ORG);
      assert.equal(state.isPrivate, true);
      assert.equal(state.visibility, "private");
      assert.equal(state.defaultBranch, DEFAULT_PROVISIONING_BRANCH);
      assert.match(state.headCommitSha || "", /^[a-f0-9]{40}$/);

      const verified = await client.verifyRepositoryState(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(verified.verified, true);
      assert.equal(verified.visibility, "private");
    });

    it("reports a missing repository as not existing", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      const state = await client.getRepositoryState(FIXED_GITHUB_ORG, "absent-repo");
      assert.equal(state.success, true);
      assert.equal(state.exists, false);
    });
  });

  describe("Content push through the Git Data API", () => {
    it("creates blobs, a tree and a commit, and advances the seeded branch ref", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");

      const push = await client.pushFiles(FIXED_GITHUB_ORG, "mirror-repo", [
        { relativePath: "package.json", contentBase64: Buffer.from('{"name":"x"}', "utf8").toString("base64") },
        { relativePath: "src/index.js", contentBase64: Buffer.from("export default 1;", "utf8").toString("base64") },
      ]);

      assert.equal(push.success, true);
      assert.match(push.commitSha || "", /^[a-f0-9]{40}$/);
      assert.equal(push.branch, DEFAULT_PROVISIONING_BRANCH);
      // The repository was seeded with an initial commit, so the branch already
      // exists and the push advances it instead of creating a second ref.
      assert.equal(push.createdRef, false);

      const repo = fake.repos.get(`${FIXED_GITHUB_ORG}/mirror-repo`);
      const files = fake.resolveFiles(`${FIXED_GITHUB_ORG}/mirror-repo`);
      assert.equal(files.get("package.json"), Buffer.from('{"name":"x"}', "utf8").toString("base64"));
      assert.equal(files.get("src/index.js"), Buffer.from("export default 1;", "utf8").toString("base64"));
      assert.equal(repo.refs.get(`refs/heads/${DEFAULT_PROVISIONING_BRANCH}`), push.commitSha);

      const treeCall = fake.requests.find((r) => r.pathname.endsWith("/git/trees"));
      assert.deepEqual(
        treeCall.body.tree.map((e) => e.path).sort(),
        ["package.json", "src/index.js"]
      );
      assert.equal(treeCall.body.tree.every((e) => e.mode === "100644" && e.type === "blob"), true);
    });

    it("keeps the auto-created README out of the mirrored branch", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");

      // The seeded repository carries a README from the initial commit.
      assert.equal(fake.resolveFiles(`${FIXED_GITHUB_ORG}/mirror-repo`).has("README.md"), true);

      const push = await client.pushFiles(FIXED_GITHUB_ORG, "mirror-repo", [
        { relativePath: "index.html", contentBase64: Buffer.from("<h1>mirror</h1>", "utf8").toString("base64") },
      ]);
      assert.equal(push.success, true);

      // The tree is built from the mirrored files alone, so the mirror holds
      // exactly the approved source files and nothing else.
      const files = fake.resolveFiles(`${FIXED_GITHUB_ORG}/mirror-repo`);
      assert.deepEqual([...files.keys()], ["index.html"]);
    });

    it("refuses to push into a repository that has no commit", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);

      // A repository created without an initial commit has no commit at all.
      // GitHub answers `409 "Git Repository is empty."` to the first blob.
      await fake.fetchImpl(`${BASE_URL}/orgs/${FIXED_GITHUB_ORG}/repos`, {
        method: "POST",
        body: JSON.stringify({ name: "unseeded-repo", private: true, visibility: "private", auto_init: false }),
      });

      const push = await client.pushFiles(FIXED_GITHUB_ORG, "unseeded-repo", [
        { relativePath: "index.html", contentBase64: Buffer.from("<h1>mirror</h1>", "utf8").toString("base64") },
      ]);

      assert.equal(push.success, false);
      assert.match(push.error || "", /Blob creation failed with status 409/);
    });

    it("creates the branch ref when the repository has a commit but no branch", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");

      // Drop the default branch while keeping the repository's commit, which
      // is the state that requires a new ref instead of a ref update.
      const repo = fake.repos.get(`${FIXED_GITHUB_ORG}/mirror-repo`);
      repo.refs.clear();
      repo.default_branch = null;

      const push = await client.pushFiles(FIXED_GITHUB_ORG, "mirror-repo", [
        { relativePath: "index.html", contentBase64: Buffer.from("<h1>mirror</h1>", "utf8").toString("base64") },
      ]);

      assert.equal(push.success, true);
      assert.equal(push.createdRef, true);
      assert.equal(repo.refs.get(`refs/heads/${DEFAULT_PROVISIONING_BRANCH}`), push.commitSha);
    });

    it("updates the existing branch ref instead of creating a second one", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");

      const first = await client.pushFiles(FIXED_GITHUB_ORG, "mirror-repo", [
        { relativePath: "a.txt", contentBase64: Buffer.from("a", "utf8").toString("base64") },
      ]);
      const second = await client.pushFiles(FIXED_GITHUB_ORG, "mirror-repo", [
        { relativePath: "b.txt", contentBase64: Buffer.from("b", "utf8").toString("base64") },
      ]);

      assert.equal(first.success, true);
      assert.equal(second.success, true);
      assert.equal(second.createdRef, false);
      assert.notEqual(first.commitSha, second.commitSha);

      const repo = fake.repos.get(`${FIXED_GITHUB_ORG}/mirror-repo`);
      assert.equal(repo.refs.get(`refs/heads/${DEFAULT_PROVISIONING_BRANCH}`), second.commitSha);
      // The second push replaces the tree, so the mirror holds exactly the new set.
      const files = fake.resolveFiles(`${FIXED_GITHUB_ORG}/mirror-repo`);
      assert.equal(files.has("a.txt"), false);
      assert.equal(files.has("b.txt"), true);
    });

    it("reports the offending path when a blob cannot be created", async () => {
      const fake = createFakeGitHub({ failBlob: true });
      const client = makeClient(fake);
      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");

      const push = await client.pushFiles(FIXED_GITHUB_ORG, "mirror-repo", [
        { relativePath: "broken.txt", contentBase64: Buffer.from("x", "utf8").toString("base64") },
      ]);
      assert.equal(push.success, false);
      assert.ok(push.error.includes("broken.txt"));
    });
  });

  describe("Bounded retries", () => {
    it("retries a transient 503 and succeeds", async () => {
      let calls = 0;
      const client = new GitHubApiClient({
        token: TOKEN,
        baseUrl: BASE_URL,
        retryBaseDelayMs: 0,
        fetchImpl: async () => {
          calls += 1;
          if (calls < 3) return new Response("unavailable", { status: 503 });
          return jsonResponse({ html_url: "https://github.com/x/y", private: true, visibility: "private", owner: { login: FIXED_GITHUB_ORG } }, 201);
        },
      });

      const res = await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(res.success, true);
      assert.equal(calls, 3, "the 503 must be retried exactly twice before succeeding");
    });

    it("never retries a 429", async () => {
      let calls = 0;
      const client = new GitHubApiClient({
        token: TOKEN,
        baseUrl: BASE_URL,
        retryBaseDelayMs: 0,
        fetchImpl: async () => {
          calls += 1;
          return new Response("rate limited", { status: 429 });
        },
      });

      const res = await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(res.success, false);
      assert.equal(res.errorCategory, "RATE_LIMITED");
      assert.equal(calls, 1, "a rate limit must be surfaced immediately, not retried");
    });
  });

  describe("Rollback deletion", () => {
    it("refuses to delete a repository it did not create", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      fake.repos.set(`${FIXED_GITHUB_ORG}/foreign-repo`, { owner: FIXED_GITHUB_ORG, name: "foreign-repo" });

      const res = await client.deleteRepository(FIXED_GITHUB_ORG, "foreign-repo");
      assert.equal(res.success, false);
      assert.ok(res.error.includes("not created by this provisioning run"));
      assert.equal(fake.repos.has(`${FIXED_GITHUB_ORG}/foreign-repo`), true);
      assert.equal(fake.requests.some((r) => r.method === "DELETE"), false, "no DELETE may be issued");
    });

    it("deletes a repository it created", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(fake.repos.has(`${FIXED_GITHUB_ORG}/mirror-repo`), true);

      const res = await client.deleteRepository(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(res.success, true);
      assert.equal(fake.repos.has(`${FIXED_GITHUB_ORG}/mirror-repo`), false);
    });
  });

  describe("Credential hygiene", () => {
    it("never echoes the token in an error message", async () => {
      const secret = "ghp_this_is_a_secret_value_1234567890";
      const client = new GitHubApiClient({
        token: secret,
        baseUrl: BASE_URL,
        retryBaseDelayMs: 0,
        fetchImpl: async () => { throw new Error(`upstream rejected Authorization: Bearer ${secret}`); },
      });

      const res = await client.createPrivateOrgRepository(FIXED_GITHUB_ORG, "mirror-repo");
      assert.equal(res.success, false);
      assert.equal(res.error.includes(secret), false, "the token must never appear in an error");
      assert.ok(res.error.includes("[REDACTED_GITHUB_TOKEN]"));
    });
  });

  describe("Live executor end-to-end (offline fake GitHub)", () => {
    const LIVE_ENV = { ENABLE_LIVE_GITHUB_PROVISIONING: "true", GITHUB_PROVISIONING_TOKEN: TOKEN };

    it("pushes the approved source and the provenance marker, and records the commit SHA", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      const executor = new LiveGitHubProvisioningExecutor(client, LIVE_ENV);
      const fixture = createSourceFixture({
        "package.json": '{"name":"magicui-portfolio"}',
        "src/App.jsx": "export default function App() { return null; }",
      });

      try {
        const plan = buildPlan(fixture);
        assert.equal(plan.valid, true);

        const result = await executeProvisioningPlan(plan, executor);
        assert.equal(result.success, true);
        assert.equal(result.verifiedPrivate, true);
        assert.equal(result.isMock, false);
        assert.equal(result.provenance.provisionerMode, "live_github");
        assert.match(result.provenance.destinationCommitSha || "", /^[a-f0-9]{40}$/);
        assert.equal(result.provenance.adopted, false);

        const repo = fake.repos.get(`${FIXED_GITHUB_ORG}/magicui-portfolio-mirror`);
        assert.ok(repo, "the private mirror must exist");
        assert.equal(repo.private, true);
        assert.equal(repo.visibility, "private");

        const files = fake.resolveFiles(`${FIXED_GITHUB_ORG}/magicui-portfolio-mirror`);

        // The real source content must be present in the mirror.
        assert.equal(
          Buffer.from(files.get("package.json"), "base64").toString("utf8"),
          '{"name":"magicui-portfolio"}'
        );
        assert.equal(
          Buffer.from(files.get("src/App.jsx"), "base64").toString("utf8"),
          "export default function App() { return null; }"
        );

        // The provenance marker must be present and correct.
        const markerRaw = Buffer.from(files.get(PROVENANCE_MARKER_PATH), "base64").toString("utf8");
        const marker = JSON.parse(markerRaw);
        assert.equal(marker.sourceCommitSha, VALID_SHA);
        assert.equal(marker.templateId, "magicui-portfolio");
        assert.equal(marker.sourceUrl, "https://github.com/onevue/magicui-portfolio");
      } finally {
        fixture.cleanup();
      }
    });

    it("adopts an already-correct mirror instead of failing with a collision", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      const executor = new LiveGitHubProvisioningExecutor(client, LIVE_ENV);
      const fixture = createSourceFixture({ "package.json": '{"name":"x"}' });

      try {
        const plan = buildPlan(fixture);

        // First run creates and populates the mirror.
        const first = await executeProvisioningPlan(plan, executor);
        assert.equal(first.success, true);

        // Second run sees the existing mirror and must adopt it.
        const second = await executeProvisioningPlan(plan, executor);
        assert.equal(second.success, true);
        assert.equal(second.provenance.adopted, true);
        assert.equal(second.provenance.destinationCommitSha, first.provenance.destinationCommitSha);
      } finally {
        fixture.cleanup();
      }
    });

    it("keeps a collision fatal when the existing mirror belongs to another commit", async () => {
      const fake = createFakeGitHub();
      const client = makeClient(fake);
      const executor = new LiveGitHubProvisioningExecutor(client, LIVE_ENV);
      const fixture = createSourceFixture({ "package.json": '{"name":"x"}' });

      try {
        // A mirror built from a different source commit.
        const otherPlan = buildPlan(fixture, { commitSha: "a".repeat(40) });
        assert.equal((await executeProvisioningPlan(otherPlan, executor)).success, true);

        const plan = buildPlan(fixture);
        const result = await executeProvisioningPlan(plan, executor);
        assert.equal(result.success, false);
        assert.equal(result.errorCategory, "COLLISION");
      } finally {
        fixture.cleanup();
      }
    });

    it("rolls the created repository back when the content push fails", async () => {
      const fake = createFakeGitHub({ failBlob: true });
      const client = makeClient(fake);
      const executor = new LiveGitHubProvisioningExecutor(client, LIVE_ENV);
      const fixture = createSourceFixture({ "package.json": '{"name":"x"}' });

      try {
        const plan = buildPlan(fixture);
        const result = await executeProvisioningPlan(plan, executor);

        assert.equal(result.success, false);
        assert.equal(result.errorCategory, "PROVISIONING_EXECUTION");
        assert.ok(result.error.includes("rolled back"), "the rollback must be reported");
        assert.equal(
          fake.repos.has(`${FIXED_GITHUB_ORG}/magicui-portfolio-mirror`),
          false,
          "the orphaned repository must not survive the failure"
        );
      } finally {
        fixture.cleanup();
      }
    });
  });
});
