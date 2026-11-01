# OneVue Portfolio Template Feature — Implementation Status

**Feature:** Portfolio Template pipeline (admin ingestion → catalog → student selection → publishing → visitor delivery)
**Extracted from:** OneVue monorepo at `03cc12ef` (branch `portfolio-templates`)
**Extraction date:** 2026-10-31

---

## 1. Component status

| Component | Status | Files |
|---|---|---|
| GitHub API client | **Complete** | `backend/github-ingestion/github-api-client.ts` |
| Repository ingestion + commit pinning | **Complete** | `backend/github-ingestion/github-ingestion.ts` |
| License & security audit | **Complete** | `backend/adaptation/template-audit.ts` |
| React/Vite adaptation | **Complete** | `backend/adaptation/template-adaptation.ts`, `backend/adaptation/template-adapters/react-vite.ts` |
| Isolated build execution | **Complete (code)** / **Unverified (runtime)** | `backend/build-runtime/template-build-runtime.ts` |
| Build isolation policy | **Complete** | `backend/build-runtime/template-build-isolation.ts` |
| Offline dependency cache | **Complete** | `backend/build-runtime/template-build-isolation.ts` (`ONEVUE_BUILD_DEPENDENCY_CACHE_DIR`) |
| Artifact storage (filesystem + R2) | **Complete** / R2 **unverified** | `backend/artifact-storage/template-storage.ts` |
| Artifact delivery + verification | **Complete** | `backend/artifact-storage/template-artifact-delivery.ts` |
| Local artifact serving | **Complete** | `backend/artifact-storage/template-local-delivery.ts` |
| Source snapshots | **Complete** | `backend/artifact-storage/template-snapshot.ts` |
| Central registry (static) | **Complete** | `backend/registry/template-registry.js`, `backend/registry/template-registry.ts` |
| Registry extension (DB-backed) | **Complete** | `backend/registry/template-registry-extension.ts` |
| Lifecycle orchestration | **Complete** | `backend/lifecycle/template-lifecycle.ts` |
| Reconciliation / recovery | **Complete** | `backend/lifecycle/template-reconciliation.ts` |
| Submission workflow | **Complete** | `backend/lifecycle/template-submission.ts` |
| GitHub provisioning | **Complete** | `backend/provisioning/template-provisioning.ts` |
| Ingestion review model | **Complete** | `backend/models/TemplateIngestionReview.ts` |
| Admin API (6 routes) | **Complete** | `backend/api/admin/templates/*/route.ts` |
| Public catalog + artifact routes | **Complete** | `backend/api/public/**` |
| Health route | **Complete** | `backend/api/health/route.ts` |
| Student selection + version pinning | **Complete** | `portfolio-visitor/student-selection/route.ts` |
| Publishing + rollback | **Complete** | `portfolio-visitor/publishing/**/route.ts` |
| Visitor rendering | **Complete** | `portfolio-visitor/rendering/**` |
| Artifact delivery (visitor) | **Complete** | `portfolio-visitor/artifact-delivery/**` |
| Admin UI page | **Complete** | `admin-frontend/components/TemplateSubmissionPage.jsx` |
| Admin API client | **Complete** | `admin-frontend/services/template-admin.js` |
| Tests (35 files) | **Complete — 347 pass / 0 fail** | `backend/tests/`, `portfolio-visitor/tests/` |

---

## 2. Verified working

Run in the OneVue monorepo at `03cc12ef`:

| Suite | Result |
|---|---|
| Backend feature cohort (`template_*`, `admin_*`, `github_*`, `build_runtime_*`, `dynamic_template_registry`, `phase*`) | **291 pass / 0 fail** (48 suites) |
| Portfolio feature cohort (4 files) | **56 pass / 0 fail** (26 suites) |
| **Total** | **347 pass / 0 fail** |

Also verified: `git diff --cached --check` exits 0; all 86 staged files in the monorepo remain byte-identical to their staged state; all 83 extracted files verified byte-identical to their sources.

---

## 3. Environment-blocked (code complete, runtime unverified)

| # | Item | Why blocked | Code state |
|---|---|---|---|
| 1 | **Genuine isolated build execution** | No rootless daemon available on this host. The boundary correctly **fails closed** rather than executing untrusted code without isolation | `template-build-isolation.ts` implements the full contract: digest-pinned image, rootless check, network-off, read-only rootfs, CPU/memory/PID/timeout/output caps, env allowlist. Exercised in tests via injected offline executors |
| 2 | **Cloudflare R2 artifact transport** | Not verified in this environment | `CloudflareR2StorageAdapter` is implemented with deterministic RFC3986 SigV4 signing and unit-tested with a mock transport; no live verification |
| 3 | **Live GitHub provisioning** | Requires `GITHUB_PROVISIONING_TOKEN` + `ENABLE_LIVE_GITHUB_PROVISIONING=true` | Implemented and unit-tested against a mocked GitHub API; `github_live_smoke.test.js` exists for live runs but was not executed here |

---

## 4. Known limitations in the extracted workspace

| # | Limitation | Detail |
|---|---|---|
| 1 | **Shared platform code is not included** | `auth.ts`, `db.ts`, `cors.ts`, `jwt.js`, `public-profile-dto.ts`, `User.ts`, `StudentProfile.ts`, `UserWebsiteConfig.ts`, `PublishedProfileRevision.ts`, `onevue-api.ts`, `onevue-profile-adapter.ts` — referenced, not duplicated. Deliberate: these must stay single-source |
| 2 | **Relative import paths are unchanged** | Files preserve their original import specifiers, which resolve inside the OneVue monorepo. Rewriting them here would require rewriting application code |
| 3 | **15 test files hardcode an absolute machine path** | `require("/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript")` — will not resolve in a clean checkout without editing |
| 4 | **`portfolio/src/lib/onevue-api.js` is untracked in the source** | `portfolio-visitor/tests/local_template_serving.test.js` imports it; not extracted because it is untracked shared code |
| 5 | **Not independently executable** | No `package.json` / `tsconfig.json`; see `DEVELOPMENT_SETUP.md` §2 |
| 6 | **Admin UI shell not included** | `frontend/components/core/app.jsx` and `frontend/index.html` mount the admin page; they are whole-application files, not feature files |
| 7 | **`template-sources/` is empty** | No sample template source tree bundled |
| 8 | **Unused imports in the student config route** | `APPROVED_TEMPLATES` and `ApprovedTemplateId` remain imported but unused after the registry-validation change. `noUnusedLocals` is off, so the build is unaffected. **Left as-is** — the extraction brief prohibits refactoring application code |

---

## 5. Behavioural notes worth preserving

These are design decisions that are easy to lose when reading code in isolation:

- **A child process is not an isolation boundary.** The build never falls back to host execution.
- **`latest` is resolved and pinned at selection time**, so a published portfolio cannot drift when a newer release ships.
- **Artifact entrypoints are SHA-256 re-verified at delivery**, before any bytes are served.
- **The public catalog excludes** `experimental`, `deprecated`, and `rejected` releases.
- **The visitor path never falls back** — an unresolvable release throws rather than substituting another template or demo data.
- **Sibling `/p` boundaries exist** because a segment error boundary does not catch errors raised by its own segment's layout.
- **The published snapshot checksum is deterministic** via recursive key canonicalization, so it is stable regardless of property insertion order.
- **Audit performs zero code execution** — it only reads files.
- **Retry reuses the same version** and recovers stored artifacts without rebuilding.

---

## 6. Recommended next steps

1. Provision a rootless Podman daemon with a digest-pinned build image, then verify the isolation preflight and smoke test end-to-end.
2. Populate `ONEVUE_BUILD_DEPENDENCY_CACHE_DIR` on a networked host and verify an offline build of a lockfile-bearing template.
3. Verify the Cloudflare R2 transport against a real bucket.
4. Run `github_live_smoke.test.js` with real credentials.
5. Replace the absolute `typescript` require path in the 15 test files with a resolvable lookup.
6. Decide whether to keep the extraction as a reference workspace or promote it to a first-class package with its own `package.json` and path aliases.

---

## 7. Documentation index

| Document | Purpose |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | End-to-end flow, layer map, isolation model, registry, shared dependencies, blockers |
| [`FEATURE_WORKFLOW.md`](FEATURE_WORKFLOW.md) | Stage-by-stage pipeline and visitor rendering detail |
| [`API_REFERENCE.md`](API_REFERENCE.md) | Every endpoint, request/response shape, error codes |
| [`DEVELOPMENT_SETUP.md`](DEVELOPMENT_SETUP.md) | How to work with this workspace, prerequisites, runnable commands |
| [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) | This document |
| [`../MANIFEST.md`](../MANIFEST.md) | Original → destination path for every copied file |
