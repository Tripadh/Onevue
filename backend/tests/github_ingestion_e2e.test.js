/**
 * =========================================================================
 * OneVue Phase 12 — GitHub Repository Integration, end to end
 * =========================================================================
 *
 * This suite drives the REAL production route handlers — not the orchestrator
 * directly — through the complete administrator ingestion flow, against the
 * LIVE GitHub API and the REAL isolated Podman build.
 *
 * Flow exercised (route level, in order):
 *   1. POST /api/admin/templates/ingest   — validate, pin, download, extract,
 *                                            audit, snapshot, persist a
 *                                            `pending_review` record.
 *   2. GET  /api/admin/templates/submissions — the admin sees the record with
 *                                            its repository identity and stages.
 *   3. POST /api/admin/templates/review    — approve (with the justification
 *                                            the REVIEW_REQUIRED audit demands).
 *   4. POST /api/admin/templates/provision  — provision to a private mirror.
 *   5. POST /api/admin/templates/build     — adapt, build in the isolated
 *                                            sandbox, package, store, validate.
 *   6. GET  /api/public/templates           — the catalog a student reads.
 *
 * Governance properties asserted:
 *   - Before approval the template is NOT in the catalog.
 *   - The artifact is stored under a versioned path with a verified manifest
 *     checksum and a file inventory.
 *   - The stored entrypoint genuinely carries the OneVue DTO contract.
 *   - After approval + a successful build the release IS discoverable.
 *   - A release whose provisioning is mock/local stays OUT of the catalog.
 *
 * ── Isolation and safety ────────────────────────────────────────────────
 *   - The GitHub repository and the stored artifact live in a temporary
 *     storage root, never in the production `.local-template-storage`.
 *   - No production artifact is read or written.
 *   - Every MongoDB record this suite creates is deleted in `after`.
 *   - Provisioning runs through the repository's Mock executor, so no private
 *     GitHub repository is ever created.
 *
 * ── How to run ──────────────────────────────────────────────────────────
 *   ONEVUE_TEST_GITHUB_E2E=1 \
 *   ONEVUE_TEST_GITHUB_REPO=owner/repository \
 *   [ONEVUE_TEST_GITHUB_REF=main] \
 *   [ONEVUE_TEST_GITHUB_TOKEN=...] \
 *   node --test backend/tests/github_ingestion_e2e.test.js
 *
 * Without the gate the suite is skipped, so it never runs in an ordinary
 * `npm test` and never makes an unexpected network call.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const ts = require(path.join(BACKEND_ROOT, "node_modules", "typescript"));

// TypeScript transpile hook (same loader the other backend suites use).
require.extensions[".ts"] = function (module, filename) {
  const content = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  module._compile(compiled.outputText, filename);
};

const ENABLED = process.env.ONEVUE_TEST_GITHUB_E2E === "1";
const REPO_SPEC = (process.env.ONEVUE_TEST_GITHUB_REPO || "").trim();
const REF = (process.env.ONEVUE_TEST_GITHUB_REF || "").trim() || undefined;
const TOKEN = (process.env.ONEVUE_TEST_GITHUB_TOKEN || "").trim() || null;

const ready = ENABLED && /^[^/]+\/[^/]+$/.test(REPO_SPEC);

if (!ready) {
  describe(
    "OneVue Phase 12 — GitHub ingestion end to end",
    {
      skip: ENABLED
        ? "ONEVUE_TEST_GITHUB_REPO must be 'owner/repository'."
        : "End-to-end GitHub ingestion is disabled. Set ONEVUE_TEST_GITHUB_E2E=1 and ONEVUE_TEST_GITHUB_REPO to authorize.",
    },
    () => {
      it("requires explicit live authorization", () => {});
    }
  );
} else {
  const { loadEnvConfig } = require(path.join(BACKEND_ROOT, "node_modules", "@next", "env"));
  const { combinedEnv } = loadEnvConfig(BACKEND_ROOT, true, { info() {}, error() {} });
  const uri = combinedEnv.MONGODB_URI || process.env.MONGODB_URI;
  const jwtSecret = combinedEnv.JWT_SECRET || process.env.JWT_SECRET;
  if (!uri) throw new Error("MONGODB_URI is not set. Define it in backend/.env.local.");
  if (!jwtSecret || Buffer.byteLength(jwtSecret, "utf8") < 32) {
    throw new Error("JWT_SECRET is missing or shorter than 32 bytes.");
  }
  process.env.MONGODB_URI = uri;
  process.env.JWT_SECRET = jwtSecret;

  const mongoose = require(path.join(BACKEND_ROOT, "node_modules", "mongoose"));
  const jwt = require(path.join(BACKEND_ROOT, "node_modules", "jsonwebtoken"));

  const ingestRoute = require(path.join(BACKEND_ROOT, "app", "api", "admin", "templates", "ingest", "route.ts"));
  const reviewRoute = require(path.join(BACKEND_ROOT, "app", "api", "admin", "templates", "review", "route.ts"));
  const provisionRoute = require(path.join(BACKEND_ROOT, "app", "api", "admin", "templates", "provision", "route.ts"));
  const buildRoute = require(path.join(BACKEND_ROOT, "app", "api", "admin", "templates", "build", "route.ts"));
  const submissionsRoute = require(path.join(BACKEND_ROOT, "app", "api", "admin", "templates", "submissions", "route.ts"));
  const publicTemplatesRoute = require(path.join(BACKEND_ROOT, "app", "api", "public", "templates", "route.ts"));

  const { MockProvisioningExecutor } = require(path.join(BACKEND_ROOT, "lib", "template-provisioning.ts"));
  const User = require(path.join(BACKEND_ROOT, "models", "User.ts")).default;
  const TemplateIngestionReview =
    require(path.join(BACKEND_ROOT, "models", "TemplateIngestionReview.ts")).default;

  const [OWNER, REPO] = REPO_SPEC.split("/");
  const STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-e2e-storage-"));
  const SNAPSHOT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "onevue-e2e-snapshots-"));

  /**
   * Provisioning double that reports the same provenance signals the live
   * executor reports (`isMock: false` and a real github.com destination)
   * WITHOUT touching GitHub. Catalog eligibility is decided by that
   * provenance, so the "approved and eligible release reaches the catalog"
   * property can only be demonstrated against it. This is the same pattern
   * tests/template_submission_workflow.test.js already uses.
   */
  class LiveProvenanceProvisioningExecutor extends MockProvisioningExecutor {
    constructor(options) {
      super(options);
      this.isMock = false;
    }
    async createPrivateRepository(org, repo, options) {
      const result = await super.createPrivateRepository(org, repo, options);
      if (!result.success) return result;
      return { ...result, url: `https://github.com/${org}/${repo}`, isMock: false };
    }
  }

  describe("OneVue Phase 12 — GitHub ingestion end to end", () => {
    let adminUser;
    let adminToken;
    let ingestionId;
    let templateId;
    let templateVersion;
    let createdRecordIds = [];

    before(async () => {
      await mongoose.connect(uri);

      const stamp = Date.now();
      adminUser = await User.create({
        name: `E2E Template Admin ${stamp}`,
        email: `onevue_e2e_admin_${stamp}@example.com`,
        password: crypto.randomBytes(24).toString("hex"),
        role: "admin",
      });
      createdRecordIds.push(String(adminUser._id));
      adminToken = jwt.sign({ id: adminUser._id.toString(), email: adminUser.email }, jwtSecret);

      // The build must run in the real isolated sandbox. The configuration is
      // read from backend/.env.local, which already pins the Podman image
      // digest and the resource limits.
      const { LocalFilesystemStorageAdapter } = require(path.join(BACKEND_ROOT, "lib", "template-storage.ts"));
      const { FileSystemSourceSnapshotStore } = require(path.join(BACKEND_ROOT, "lib", "template-snapshot.ts"));

      globalThis.__mockStorageAdapter = new LocalFilesystemStorageAdapter(STORAGE_ROOT);
      globalThis.__mockSourceSnapshotStore = new FileSystemSourceSnapshotStore(SNAPSHOT_ROOT);
      globalThis.__mockProvisioningExecutor = new LiveProvenanceProvisioningExecutor();
      globalThis.__mockFetch = TOKEN
        ? (input, init) => fetch(input, { ...init, headers: { ...(init && init.headers), Authorization: `Bearer ${TOKEN}` } })
        : undefined;
    });

    after(async () => {
      // Remove ONLY the records this suite created.
      if (ingestionId) {
        await TemplateIngestionReview.deleteMany({ ingestionId });
      }
      await TemplateIngestionReview.deleteMany({ adminUserId: adminUser?._id });
      if (adminUser) await User.deleteOne({ _id: adminUser._id });
      delete globalThis.__mockStorageAdapter;
      delete globalThis.__mockSourceSnapshotStore;
      delete globalThis.__mockProvisioningExecutor;
      delete globalThis.__mockFetch;
      try {
        fs.rmSync(STORAGE_ROOT, { recursive: true, force: true });
        fs.rmSync(SNAPSHOT_ROOT, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of the temporary roots.
      }
      await mongoose.disconnect();
    });

    function adminRequest(pathname, method, body) {
      return new Request(`http://localhost:3000${pathname}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }

    it("1. ingests the repository, pins the commit, audits it and records it for review", async () => {
      const response = await ingestRoute.POST(
        adminRequest("/api/admin/templates/ingest", "POST", {
          url: `https://github.com/${OWNER}/${REPO}`,
          requestedRef: REF,
        })
      );
      const payload = await response.json();

      assert.equal(response.status, 201, JSON.stringify(payload));
      assert.equal(payload.success, true);
      assert.equal(payload.ingestion.status, "pending_review");
      assert.match(payload.ingestion.commitSha, /^[a-f0-9]{40}$/);
      assert.equal(payload.ingestion.sourceUrl, `https://github.com/${OWNER}/${REPO}`);

      ingestionId = payload.ingestion.ingestionId;
      templateId = payload.ingestion.templateId;
      templateVersion = payload.ingestion.templateVersion;

      // The identity must be a valid OneVue template id, not the raw
      // repository name: the repository name is not guaranteed to match
      // /^[a-z0-9][a-z0-9_-]{0,63}$/.
      assert.match(templateId, /^[a-z0-9][a-z0-9_-]{0,63}$/);
      assert.match(templateVersion, /^\d+\.\d+\.\d+$/);
    });

    it("2. records the canonical repository identity and the processing stages", async () => {
      const response = await submissionsRoute.GET(
        adminRequest("/api/admin/templates/submissions?ingestionId=" + ingestionId, "GET")
      );
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);

      const submission = payload.submission;
      assert.equal(submission.ingestionId, ingestionId);
      assert.equal(submission.repositoryKey, `${OWNER}/${REPO}`.toLowerCase());
      assert.equal(submission.reviewStatus, "pending_review");
      assert.equal(submission.sourceUrl, `https://github.com/${OWNER}/${REPO}`);
      assert.match(submission.commitSha, /^[a-f0-9]{40}$/);
      assert.ok(submission.stages.length >= 3, "the admin must see the processing stages");
      assert.ok(
        submission.stages.some((stage) => stage.stage === "PIN_COMMIT" && stage.status === "succeeded"),
        "the pinned commit stage must be recorded"
      );
      assert.ok(
        submission.stages.some((stage) => stage.stage === "AUDIT" && stage.status === "succeeded"),
        "the audit stage must be recorded"
      );
      assert.equal(submission.catalogEligible, false, "an unapproved template is not catalog eligible");
    });

    it("3. keeps the unapproved template OUT of the student catalog", async () => {
      const response = await publicTemplatesRoute.GET(new Request("http://localhost:3000/api/public/templates"));
      const payload = await response.json();
      const templates = payload.templates || payload.data || [];
      const entry = templates.find((entry) => entry.id === templateId);
      assert.equal(entry, undefined, "an unapproved template must not appear in the student catalog");
    });

    it("4. records an explicit human approval with a justification", async () => {
      const response = await reviewRoute.POST(
        adminRequest("/api/admin/templates/review", "POST", {
          ingestionId,
          decision: "approve",
          policyOverride: true,
          reason: "End-to-end verification of the GitHub ingestion flow against an isolated test repository.",
        })
      );
      const payload = await response.json();

      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(payload.success, true);
      assert.equal(payload.review.status, "approved");
      assert.equal(payload.review.decision.decision, "approve");
      assert.ok(payload.review.decision.reviewerUserId, "the approving identity must be recorded");
    });

    it("5. provisions the approved template and builds it in the isolated sandbox", async () => {
      const provisionResponse = await provisionRoute.POST(
        adminRequest("/api/admin/templates/provision", "POST", {
          ingestionId,
          destinationRepo: `${templateId}-${templateVersion}`.replace(/\./g, "-"),
          explicitConfirmation: true,
        })
      );
      const provisionPayload = await provisionResponse.json();
      assert.equal(provisionResponse.status, 201, JSON.stringify(provisionPayload));
      assert.equal(provisionPayload.success, true);

      const buildResponse = await buildRoute.POST(
        adminRequest("/api/admin/templates/build", "POST", {
          ingestionId,
          explicitConfirmation: true,
        })
      );
      const buildPayload = await buildResponse.json();
      assert.equal(buildResponse.status, 201, JSON.stringify(buildPayload));
      assert.equal(buildPayload.success, true);
      assert.equal(buildPayload.lifecycle.status, "CATALOG_ELIGIBLE");
      assert.ok(buildPayload.lifecycle.manifestSha256, "the release must carry a manifest checksum");
    });

    it("6. stores a verified, versioned artifact whose entrypoint carries the DTO contract", async () => {
      const versionDir = path.join(STORAGE_ROOT, "templates", templateId, templateVersion);
      assert.ok(fs.existsSync(versionDir), "the artifact must be stored under a versioned path");

      const manifestPath = path.join(versionDir, "onevue-manifest.json");
      assert.ok(fs.existsSync(manifestPath), "the release must carry a manifest");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      assert.equal(manifest.templateId, templateId);
      assert.equal(manifest.templateVersion, templateVersion);
      assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, "the manifest must inventory the files");
      assert.ok(manifest.supportedDtoVersions.includes("1.0.0"), "the release must support DTO v1.0.0");
      assert.ok(manifest.manifestSha256, "the manifest must carry its own checksum");

      // The entrypoint must genuinely carry the DTO contract, not the
      // author's demo content.
      const entryHtml = fs.readFileSync(path.join(versionDir, manifest.entrypoint || "index.html"), "utf8");
      assert.ok(entryHtml.includes("__ONEVUE_DTO__"), "the entrypoint must carry the OneVue DTO block");
      assert.doesNotMatch(entryHtml, /Aniket/i);
      assert.doesNotMatch(entryHtml, /googletagmanager\.com/i);
    });

    it("7. publishes the approved, eligible release to the student catalog", async () => {
      const response = await publicTemplatesRoute.GET(new Request("http://localhost:3000/api/public/templates"));
      const payload = await response.json();
      const templates = payload.templates || payload.data || [];
      const entry = templates.find((entry) => entry.id === templateId);
      assert.ok(entry, "an approved, eligible release must appear in the student catalog");

      const release = entry.releases.find((release) => release.version === templateVersion);
      assert.ok(release, "the built version must be listed in the catalog");
      assert.match(release.artifact.checksum, /^[a-f0-9]{64}$/, "the catalog must publish the release checksum");
      assert.equal(release.artifact.entrypoint, "index.html");
      assert.ok(release.supportedDtoVersions.includes("1.0.0"));
      assert.ok(release.framework, "the catalog must publish the build framework");
    });

    it("8. refuses to publish a release whose provisioning provenance is the local mock", async () => {
      // Catalog governance is decided by the recorded provenance. A release
      // provisioned by the development mock is development scaffolding, and it
      // must stay out of the student catalog no matter how good the build was.
      const { evaluateCatalogEligibility } = require(path.join(BACKEND_ROOT, "lib", "template-registry-extension.ts"));
      const { LocalFilesystemStorageAdapter } = require(path.join(BACKEND_ROOT, "lib", "template-storage.ts"));

      const stored = await TemplateIngestionReview.findOne({ ingestionId }).lean();
      const validated = await new LocalFilesystemStorageAdapter(STORAGE_ROOT).validateStoredArtifact(
        templateId,
        templateVersion
      );

      const mockProvenance = {
        ...stored,
        provisioningRecord: {
          ...stored.provisioningRecord,
          provenance: { ...stored.provisioningRecord.provenance, isMock: true, provisionerMode: "mock_local" },
        },
      };
      const mockEligibility = evaluateCatalogEligibility(mockProvenance, validated);
      assert.equal(mockEligibility.eligible, false, "a mock-provisioned release must never be catalog eligible");
      assert.ok(
        mockEligibility.blockers.some((blocker) => blocker.code === "PROVISIONING_MODE_MOCK"),
        "the mock provenance must be the documented blocker"
      );

      // The release this suite actually built has live provenance and IS
      // eligible, which is what the catalog query depends on.
      const liveEligibility = evaluateCatalogEligibility(stored, validated);
      assert.equal(liveEligibility.eligible, true, JSON.stringify(liveEligibility.blockers));
      assert.deepEqual(liveEligibility.blockers, []);
    });

    it("9. reports the admin-visible lifecycle status for the built release", async () => {
      const response = await submissionsRoute.GET(
        adminRequest("/api/admin/templates/submissions?ingestionId=" + ingestionId, "GET")
      );
      const payload = await response.json();
      const submission = payload.submission;

      assert.equal(submission.reviewStatus, "approved");
      assert.equal(submission.submissionStatus, "catalog_eligible");
      assert.ok(submission.lifecycle, "the lifecycle evidence must be visible to the admin");
      assert.equal(submission.lifecycle.status, "CATALOG_ELIGIBLE");
      assert.ok(submission.adaptation, "the adaptation evidence must be visible to the admin");
      assert.ok(submission.artifact, "the artifact evidence must be visible to the admin");
      assert.match(
        submission.artifact.manifestSha256,
        /^[a-f0-9]{64}$/,
        "the admin must see the release manifest checksum"
      );

      // The checksum the admin is shown must be the checksum of the artifact
      // that is actually in storage.
      const storedManifest = JSON.parse(
        fs.readFileSync(
          path.join(STORAGE_ROOT, "templates", templateId, templateVersion, "onevue-manifest.json"),
          "utf8"
        )
      );
      assert.equal(submission.artifact.manifestSha256, storedManifest.manifestSha256);
      assert.equal(submission.artifact.totalFiles, storedManifest.files.length);
      assert.equal(submission.artifact.sourceCommitSha, submission.commitSha);

      // The release is eligible, so there is nothing blocking it.
      assert.equal(submission.catalogEligible, true);
      assert.deepEqual(submission.catalogBlockers, []);
    });
  });
}
