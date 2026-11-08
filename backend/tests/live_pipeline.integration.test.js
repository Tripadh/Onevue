/**
 * =========================================================================
 * OneVue Phase 6.5 — Live end-to-end pipeline validation (explicitly gated)
 * =========================================================================
 *
 * Drives the REAL running backend over HTTP (no mocks, no direct database or
 * storage access). Skipped unless explicitly authorized and fully configured:
 *
 *   ONEVUE_TEST_LIVE_PIPELINE=1
 *   ONEVUE_TEST_BACKEND_URL=http://127.0.0.1:3000
 *   ONEVUE_TEST_TEMPLATE_REPO=https://github.com/<owner>/<adapted-repo>
 *   # Admin authentication (one of):
 *   ONEVUE_TEST_ADMIN_TOKEN=<jwt>
 *   ONEVUE_TEST_ADMIN_EMAIL=... ONEVUE_TEST_ADMIN_PASSWORD=...
 *   # Optional:
 *   ONEVUE_TEST_TEMPLATE_ID=react-portfolio
 *   ONEVUE_TEST_EXPECTED_VERSION=1.0.0
 *   ONEVUE_TEST_PORTFOLIO_URL=http://127.0.0.1:3001
 *
 * Requirements before running:
 *   - MongoDB Atlas configured in backend/.env.local (dedicated dev database);
 *   - an admin user with role "admin";
 *   - the adapted template source hosted at ONEVUE_TEST_TEMPLATE_REPO;
 *   - live provisioning credentials + ENABLE_LIVE_GITHUB_PROVISIONING=true,
 *     with explicit approval to create the private mirror repository.
 *
 * The suite performs real catalog/student/public requests and publishes a real
 * revision for the test student. It never prints tokens or credentials.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const ENABLED = process.env.ONEVUE_TEST_LIVE_PIPELINE === "1";
const BASE = (process.env.ONEVUE_TEST_BACKEND_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const REPO_URL = (process.env.ONEVUE_TEST_TEMPLATE_REPO || "").trim();
const ADMIN_TOKEN = (process.env.ONEVUE_TEST_ADMIN_TOKEN || "").trim();
const ADMIN_EMAIL = (process.env.ONEVUE_TEST_ADMIN_EMAIL || "").trim();
const ADMIN_PASSWORD = process.env.ONEVUE_TEST_ADMIN_PASSWORD || "";
const TEMPLATE_ID = (process.env.ONEVUE_TEST_TEMPLATE_ID || "react-portfolio").trim();
const EXPECTED_VERSION = (process.env.ONEVUE_TEST_EXPECTED_VERSION || "1.0.0").trim();
const PORTFOLIO_URL = (process.env.ONEVUE_TEST_PORTFOLIO_URL || "").trim().replace(/\/+$/, "");

const configured =
  ENABLED &&
  /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(REPO_URL) &&
  (ADMIN_TOKEN || (ADMIN_EMAIL && ADMIN_PASSWORD));

if (!configured) {
  describe(
    "Phase 6.5 — live pipeline validation",
    {
      skip: ENABLED
        ? "Set ONEVUE_TEST_TEMPLATE_REPO and admin credentials (token or email/password)."
        : "Live pipeline validation is disabled. Set ONEVUE_TEST_LIVE_PIPELINE=1 with the adapted template repo and admin credentials.",
    },
    () => {
      it("requires explicit live authorization and configured inputs", () => {});
    }
  );
} else {
  const student = {
    email: process.env.ONEVUE_TEST_STUDENT_EMAIL || `onevue.e2e.${Date.now()}@example.com`,
    password: process.env.ONEVUE_TEST_STUDENT_PASSWORD || `E2e-${Math.random().toString(36).slice(2)}-pass`,
    username: process.env.ONEVUE_TEST_STUDENT_USERNAME || `e2e${String(Date.now()).slice(-6)}`,
  };

  async function api(pathname, options = {}) {
    const response = await fetch(`${BASE}${pathname}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // Non-JSON responses are reported through the status assertion.
    }
    return { status: response.status, body };
  }

  let adminToken = ADMIN_TOKEN;

  async function ensureAdminToken() {
    if (adminToken) return adminToken;
    const login = await api("/api/auth/login", {
      method: "POST",
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.body)}`);
    adminToken = login.body.token || (login.body.data && login.body.data.token);
    assert.ok(adminToken, "admin login did not return a token");
    return adminToken;
  }

  async function ensureStudent() {
    let response = await api("/api/auth/login", {
      method: "POST",
      body: { email: student.email, password: student.password },
    });
    if (response.status !== 200) {
      const registered = await api("/api/auth/register", {
        method: "POST",
        body: {
          name: "E2E Student",
          email: student.email,
          password: student.password,
          identity: "student",
        },
      });
      assert.ok([200, 201].includes(registered.status), `student registration failed: ${JSON.stringify(registered.body)}`);
      response = await api("/api/auth/login", {
        method: "POST",
        body: { email: student.email, password: student.password },
      });
    }
    assert.equal(response.status, 200, `student login failed: ${JSON.stringify(response.body)}`);
    const token = response.body.token || (response.body.data && response.body.data.token);
    assert.ok(token, "student login did not return a token");
    const me = await api("/api/auth/me", { token });
    assert.equal(me.status, 200);
    return { token, user: me.body.user || me.body.data?.user };
  }

  async function fetchAsset(url, token) {
    const response = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    return { status: response.status, headers: response.headers, body: await response.text() };
  }

  describe("Phase 6.5 — live pipeline validation", () => {
    it("health, admin auth, ingestion, idempotency, catalog, selection, publish, visitor", async () => {
      // 1. Health
      const health = await api("/api/health");
      assert.equal(health.status, 200, "backend health check failed");

      // 2. Admin authentication + status API
      const token = await ensureAdminToken();
      const before = await api("/api/admin/templates/submissions?limit=5", { token });
      assert.equal(before.status, 200, `admin status API failed: ${JSON.stringify(before.body)}`);

      // 3. Real submission through the admin workflow
      const submitted = await api("/api/admin/templates/submit", {
        method: "POST",
        token,
        body: { url: REPO_URL, explicitConfirmation: true, reason: "Phase 6.5 live validation" },
      });
      assert.ok([200, 201].includes(submitted.status), `submission failed: ${JSON.stringify(submitted.body)}`);
      const submission = submitted.body.submission;
      assert.ok(submission, "submission response is missing its record");
      assert.equal(submission.catalogEligible, true, `submission is not catalog eligible (stage: ${submission.submissionStatus})`);
      assert.ok(submission.commitSha, "a pinned commit SHA is required");
      const version = submission.templateVersion;
      if (EXPECTED_VERSION) assert.equal(version, EXPECTED_VERSION);

      // 4. Idempotent resubmission of the same commit
      const repeated = await api("/api/admin/templates/submit", {
        method: "POST",
        token,
        body: { url: REPO_URL, explicitConfirmation: true },
      });
      assert.ok([200, 201].includes(repeated.status), `repeat submission failed: ${JSON.stringify(repeated.body)}`);
      assert.equal(repeated.body.outcome, "NO_UPDATE", "the same commit must not create a new version");
      assert.equal(repeated.body.submission.templateVersion, version);

      // 5. Catalog registration (exact template/version, discoverable once)
      const catalog = await api("/api/public/templates");
      assert.equal(catalog.status, 200);
      const template = (catalog.body.templates || []).find((entry) => entry.id === TEMPLATE_ID);
      assert.ok(template, `template '${TEMPLATE_ID}' is not in the public catalog`);
      const matches = template.releases.filter((release) => release.version === version);
      assert.equal(matches.length, 1, "the approved version must appear exactly once");

      // 6. Student selection pins the concrete version
      const session = await ensureStudent();
      const configuredWebsite = await api("/api/student/website/config", {
        method: "PUT",
        token: session.token,
        body: {
          username: student.username,
          selectedTemplateId: TEMPLATE_ID,
          selectedTemplateVersion: "latest",
        },
      });
      assert.equal(configuredWebsite.status, 200, `student selection failed: ${JSON.stringify(configuredWebsite.body)}`);
      assert.equal(configuredWebsite.body.config.selectedTemplateVersion, version, "selection must persist the concrete version");

      // 7. Publish a revision pinned to that version
      const published = await api("/api/student/website/publish", { method: "POST", token: session.token, body: {} });
      assert.equal(published.status, 200, `publish failed: ${JSON.stringify(published.body)}`);
      assert.equal(published.body.revision.templateId, TEMPLATE_ID);
      assert.equal(published.body.revision.templateVersion, version);

      // 8. Public profile pins the same immutable version
      const profile = await api(`/api/public/profile/${student.username}`);
      assert.equal(profile.status, 200, `public profile failed: ${JSON.stringify(profile.body)}`);
      assert.equal(profile.body.website.templateId, TEMPLATE_ID);
      assert.equal(profile.body.website.templateVersion, version);

      // 9. Visitor delivery serves the exact immutable artifact and its assets
      const entrypoint = await fetchAsset(`${BASE}/api/public/template-artifact/${TEMPLATE_ID}/${version}/index.html`);
      assert.equal(entrypoint.status, 200, "artifact entrypoint was not delivered");
      assert.match(entrypoint.headers.get("cache-control") || "", /immutable/);
      assert.equal(entrypoint.headers.get("x-onevue-template-version"), version);
      const assetPaths = [...entrypoint.body.matchAll(/\/templates\/[^"')\s]+\/assets\/[^"')\s]+/g)].map((m) => m[0]);
      assert.ok(assetPaths.length > 0, "the delivered entrypoint must reference built assets");
      for (const assetPath of new Set(assetPaths)) {
        const asset = await fetchAsset(`${BASE}/api/public/template-artifact/${TEMPLATE_ID}/${version}/${assetPath.replace(`/templates/${TEMPLATE_ID}/${version}/`, "")}`);
        assert.equal(asset.status, 200, `asset delivery failed: ${assetPath}`);
        assert.match(asset.headers.get("cache-control") || "", /immutable/);
      }

      // 10. Portfolio visitor page (when the portfolio app is running)
      if (PORTFOLIO_URL) {
        const page = await fetch(`${PORTFOLIO_URL}/p/${student.username}`);
        assert.equal(page.status, 200, "portfolio visitor page failed");
        const html = await page.text();
        assert.ok(!/Unable to Load Portfolio/.test(html), "portfolio visitor page rendered the error boundary");
      }
    });
  });
}
