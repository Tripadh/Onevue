/**
 * =========================================================================
 * OneVue Phase 12 — Staged ingestion identity regression
 * =========================================================================
 *
 * The staged administrator flow is:
 *   POST /api/admin/templates/ingest -> POST .../review -> POST .../provision
 *   -> POST .../build
 *
 * Each stage resolves the release identity from the same rules. When the
 * staged ingest path derived the template id from the RAW repository name
 * instead of the shared resolver, the two paths disagreed for any repository
 * whose name is not already a valid OneVue template id:
 *
 *   repo "My-Portfolio"  staged -> "My-Portfolio"  (INVALID template id)
 *                        one-shot -> "my-portfolio" (valid)
 *
 * Two consequences, both covered below:
 *   - The staged path produced an invalid template id, so the immutable
 *     storage layer and the snapshot store rejected it.
 *   - The staged path produced a DIFFERENT id from the one-shot path, so the
 *     same repository became two unrelated templates.
 *
 * The staged path also omitted the canonical repository identity, which made
 * its records invisible to duplicate detection, to version derivation and to
 * the admin submissions list.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const ts = require(path.join(BACKEND_ROOT, "node_modules", "typescript"));

require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  module._compile(compiled.outputText, filename);
};

const {
  buildRepositoryKey,
  deriveTemplateId,
  deriveNextVersion,
  resolveTemplateIdentity,
} = require(path.join(BACKEND_ROOT, "lib", "template-submission.ts"));

const INGEST_ROUTE = path.join(BACKEND_ROOT, "app", "api", "admin", "templates", "ingest", "route.ts");
const BUILD_ROUTE = path.join(BACKEND_ROOT, "app", "api", "admin", "templates", "build", "route.ts");

const TEMPLATE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;

describe("OneVue Phase 12 — staged ingestion identity", () => {
  describe("resolveTemplateIdentity", () => {
    it("derives a valid identity from a repository name that is not already valid", () => {
      const id = resolveTemplateIdentity([], "My-Portfolio");
      assert.equal(id, "my-portfolio");
      assert.match(id, TEMPLATE_ID_REGEX);
    });

    it("produces the SAME identity as the one-shot submission path", () => {
      for (const repo of ["portfolio", "My-Portfolio", "My.Portfolio", "web_portfolio"]) {
        assert.equal(
          resolveTemplateIdentity([], repo),
          deriveTemplateId(repo),
          `the staged and one-shot paths must agree for '${repo}'`
        );
      }
    });

    it("never produces an identity that the immutable storage layer would reject", () => {
      for (const repo of ["My-Portfolio", "My.Portfolio", "UPPER", "a b c"]) {
        const id = resolveTemplateIdentity([], repo);
        assert.match(id, TEMPLATE_ID_REGEX, `'${repo}' produced an invalid template id`);
      }
    });

    it("keeps the existing identity when the repository already has a release", () => {
      const prior = [{ templateId: "already-published" }];
      assert.equal(resolveTemplateIdentity(prior, "My-Portfolio"), "already-published");
    });

    it("ignores a prior record whose identity is not a valid template id", () => {
      const prior = [{ templateId: "NOT VALID" }];
      assert.equal(resolveTemplateIdentity(prior, "My-Portfolio"), "my-portfolio");
    });

    it("returns an empty identity when the repository name cannot be normalized", () => {
      assert.equal(resolveTemplateIdentity([], "---"), "");
    });
  });

  describe("buildRepositoryKey", () => {
    it("is the canonical lowercased owner/repo identity", () => {
      assert.equal(buildRepositoryKey("Crypticani", "Portfolio"), "crypticani/portfolio");
    });

    it("is stable for the same repository regardless of casing", () => {
      assert.equal(
        buildRepositoryKey("Owner", "Repo"),
        buildRepositoryKey("owner", "repo")
      );
    });
  });

  describe("deriveNextVersion", () => {
    it("keeps a declared version that is newer than every published version", () => {
      assert.equal(
        deriveNextVersion({ declaredVersion: "2.0.0", publishedVersions: ["1.0.0"] }),
        "2.0.0"
      );
    });

    it("bumps the minor version when the declared version is already published", () => {
      assert.equal(
        deriveNextVersion({ declaredVersion: "1.0.0", publishedVersions: ["1.0.0"] }),
        "1.1.0"
      );
    });

    it("ignores a declared version that is not valid semver", () => {
      assert.equal(
        deriveNextVersion({ declaredVersion: "not-a-version", publishedVersions: [] }),
        "1.0.0"
      );
    });
  });

  describe("the staged ingest route", () => {
    const source = fs.readFileSync(INGEST_ROUTE, "utf8");

    it("resolves the identity through the shared resolver", () => {
      assert.match(source, /resolveTemplateIdentity\(priorList,\s*repo\)/);
      assert.doesNotMatch(
        source,
        /const templateId = onevueMeta\?\.templateId \|\| repoRef\?\.repo/,
        "the raw repository name must not be used as the template id"
      );
    });

    it("records the canonical repository identity on the review record", () => {
      assert.match(source, /repositoryKey,\s*\n\s*repository: \{ owner, repo, canonicalUrl/);
      assert.match(source, /const repositoryKey = buildRepositoryKey\(owner, repo\)/);
    });

    it("derives a version that does not collide with an already-stored version", () => {
      assert.match(source, /storageAdapter\.checkVersionExists\(templateId, templateVersion\)/);
      assert.match(source, /deriveNextVersion\(/);
    });

    it("records the processing stages the admin UI renders", () => {
      assert.match(source, /stage: "VALIDATE_REPOSITORY"/);
      assert.match(source, /stage: "PIN_COMMIT"/);
      assert.match(source, /stage: "AUDIT"/);
      assert.match(source, /stage: "SOURCE_SNAPSHOT"/);
    });

    it("records the submission status and the source auth mode", () => {
      assert.match(source, /submissionStatus: "pending_review"/);
      assert.match(source, /sourceAuthMode: ingestionResult\.authMode/);
    });
  });

  describe("the staged build route", () => {
    const source = fs.readFileSync(BUILD_ROUTE, "utf8");

    it("records the admin-visible lifecycle status on success", () => {
      assert.match(source, /submissionStatus: "catalog_eligible"/);
      assert.match(source, /"provisioningRecord\.provenance\.lifecycle\.status": "CATALOG_ELIGIBLE"/);
    });

    it("records the failure reason when the lifecycle fails", () => {
      assert.match(source, /submissionStatus: "build_failed"/);
    });
  });
});
