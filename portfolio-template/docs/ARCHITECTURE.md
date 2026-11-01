# OneVue Portfolio Template Feature — Architecture

> **Scope of this workspace.** This folder is an *organised extraction* of the Portfolio Template feature from the OneVue monorepo. It is a **reference workspace**, not a standalone application. Every file here is a byte-identical copy of its source (see `MANIFEST.md`). Shared OneVue platform code is deliberately **not** duplicated — see [Shared Dependencies](#shared-dependencies).

---

## 1. End-to-end feature flow

```text
Admin (browser)
  │  submits GitHub repository URL
  ▼
POST /api/admin/templates/submit
  │
  ├─▶ VALIDATE_REPOSITORY   github-ingestion.ts       parse + validate URL
  ├─▶ PIN_COMMIT             github-ingestion.ts       resolve & pin immutable commit SHA
  ├─▶ DUPLICATE_CHECK        template-submission.ts    reuse existing version if known
  ├─▶ SOURCE_SNAPSHOT        template-snapshot.ts      durable, verifiable source snapshot
  ├─▶ AUDIT                  template-audit.ts         license + dependency security audit
  ├─▶ BUILD_BOUNDARY         template-build-isolation.ts  fail closed without isolation runtime
  ├─▶ PROVISION              template-provisioning.ts  private repo provisioning (GitHub API)
  ├─▶ ADAPT_BUILD_STORE      template-adaptation.ts → template-build.ts → template-storage.ts
  │                          react-vite.ts             React/Vite adapter
  │                                                 adapt → isolated build → package → store
  └─▶ CATALOG                template-registry-extension.ts  register release in central registry
                                     │
                                     ▼
                        GET /api/public/templates        public catalog (approved releases only)
                                     │
Student selects template                │
  ▼                                   │
PUT /api/student/website/config ◀─────┘
  │  validates against central registry; pins a concrete immutable version
  ▼
POST /api/student/website/publish
  │  builds immutable PublicProfileDTO_v1 + customization snapshot
  │  computes deterministic SHA-256 checksum
  ▼
PublishedProfileRevision (MongoDB)
  │
Visitor requests /p/:username
  ▼
portfolio/src/app/p/[username]/page.tsx
  │  resolves release → artifact entrypoint (SHA-256 re-verified)
  │  injects DTO into __ONEVUE_DTO__ placeholder
  ▼
rendered HTML served in sandboxed iframe
```

---

## 2. Backend layers

The backend is organised by **pipeline stage**, not by file type.

| Folder | Responsibility | Key files |
|---|---|---|
| `backend/github-ingestion/` | GitHub API client, repository ingestion, commit pinning | `github-api-client.ts`, `github-ingestion.ts` |
| `backend/adaptation/` | License/security audit; React/Vite template adaptation | `template-audit.ts`, `template-adaptation.ts`, `template-adapters/react-vite.ts` |
| `backend/build-runtime/` | Isolated build execution, isolation policy, offline dependency cache | `template-build-isolation.ts`, `template-build-runtime.ts`, `template-build.ts` |
| `backend/artifact-storage/` | Immutable artifact storage, delivery, local serving, source snapshots | `template-storage.ts`, `template-artifact-delivery.ts`, `template-local-delivery.ts`, `template-snapshot.ts` |
| `backend/registry/` | Central template registry, typed facade, DB-backed extension | `template-registry.js`, `template-registry.ts`, `template-registry-extension.ts` |
| `backend/lifecycle/` | Stage orchestration, reconciliation, submission workflow | `template-lifecycle.ts`, `template-reconciliation.ts`, `template-submission.ts` |
| `backend/provisioning/` | Private repository provisioning via GitHub API | `template-provisioning.ts` |
| `backend/api/` | Admin + public HTTP routes | see [API Reference](API_REFERENCE.md) |
| `backend/models/` | MongoDB model for ingestion review records | `TemplateIngestionReview.ts` |

### Data flow between layers

```text
template-submission.ts
   ├──▶ github-ingestion.ts ──▶ github-api-client.ts
   ├──▶ template-audit.ts
   ├──▶ template-snapshot.ts
   ├──▶ template-build-isolation.ts ──▶ template-build-runtime.ts ──▶ template-build.ts
   │                                          │
   │                                          └──▶ template-adaptation.ts ──▶ react-vite.ts
   ├──▶ template-provisioning.ts ──▶ github-api-client.ts
   ├──▶ template-lifecycle.ts ──▶ template-storage.ts
   └──▶ template-registry-extension.ts ──▶ template-storage.ts, TemplateIngestionReview.ts
```

### Module systems

`template-registry.js` and `template-renderer.js` are **CommonJS** (`module.exports = {...}`) with `.ts` facades layered on top (`template-registry.ts`, `template-renderer.ts`) that provide typed access. All other backend modules are ESM TypeScript. This split is intentional in the source and was preserved verbatim.

---

## 3. Isolation model

`backend/build-runtime/template-build-isolation.ts` implements the security boundary. **A child process is not an isolation boundary** — the module enforces a container/VM runtime contract:

| Guarantee | Mechanism |
|---|---|
| Image pinning | `ONEVUE_BUILD_ISOLATION_IMAGE` must be `<image>@sha256:<64 hex>` — floating tags are rejected |
| Rootless runtime | Preflight verifies the daemon runs rootless (`SUPPORTED_ISOLATION_RUNTIMES` = `docker`, `podman`, `nsjail`, `firecracker`) |
| Network | `ONEVUE_BUILD_NETWORK_MODE=none` supported |
| Read-only rootfs | `ONEVUE_BUILD_READ_ONLY_ROOTFS=true` supported |
| Resource caps | Timeout, memory, CPU, and PID limits all bounded and validated |
| Output cap | `ONEVUE_BUILD_MAX_OUTPUT_BYTES` (1 MiB–1 GiB, default 256 MiB) |
| Env allowlist | Only explicitly allowlisted variable names reach the build |
| Offline deps | `ONEVUE_BUILD_DEPENDENCY_CACHE_DIR` — absolute path, mounted read-only; templates with a lockfile **fail closed** rather than reaching the network |
| Fail-closed | If no verified runtime is available, the build boundary returns `BUILD_BOUNDARY_UNAVAILABLE` and refuses to execute |

Details and threat model: [`backend/build-runtime/BUILD_RUNTIME_ISOLATION.md`](../backend/build-runtime/BUILD_RUNTIME_ISOLATION.md).

---

## 4. Artifact immutability

Artifacts are content-addressed and version-pinned:

1. The adapted source is built inside the isolation boundary.
2. Output is packaged and written to an immutable storage root.
3. Every file is recorded with its **size** and **SHA-256** digest.
4. The registry release stores the entrypoint checksum.
5. On delivery, the entrypoint is **re-verified** against its recorded digest before a single byte is served.
6. Releases are immutable — `latest` is resolved to a concrete version at selection time and that concrete version is persisted, so a published portfolio never drifts when a newer release appears.

---

## 5. Central registry

`backend/registry/template-registry.js` is the single source of truth.

- Catalog of templates → immutable releases.
- Each release declares `approvalStatus`, `supportedDtoVersions`, `supportedSections`, `customizationOptions`, and an `artifact` block (format, entrypoint, `assetBaseUrl`, checksum).
- Currently one approved release: `magicui-portfolio` @ `1.0.0`, supporting DTO schema `1.0.0`.
- Approval statuses: `approved`, `deprecated`, `experimental`, `rejected`.
- `template-registry-extension.ts` adds the **database-backed** layer: eligibility validation against live artifacts plus MongoDB-backed catalog extension.

**Registry enforcement points:** student selection (`config`), publishing (`publish`), rollback (`rollback`), the public catalog route, and the visitor delivery path.

---

## 6. Admin frontend

`admin-frontend/` contains the extracted admin UI.

- `components/TemplateSubmissionPage.jsx` — submits a GitHub repository URL and renders the live ingestion stage list (`VALIDATE_REPOSITORY` → `CATALOG`) with status tones and short SHAs.
- `services/template-admin.js` — the admin API client (`submit`, `list`, `get`), attaching the admin bearer token.

**Integration note:** the page is a global browser script, not a module. It is mounted by the OneVue SPA via `window.TemplateSubmissionPage` and is routed at `/app/admin/templates` by `frontend/components/core/app.jsx`. Those two integration files were **not** copied — they are the whole-application shell, not the feature. See [Shared Dependencies](#shared-dependencies).

---

## 7. Portfolio visitor

`portfolio-visitor/` is the Next.js application surface.

| Folder | Route / entry | Purpose |
|---|---|---|
| `student-selection/` | `backend` `PUT /api/student/website/config` | Validate selection against the registry; persist a pinned version |
| `publishing/` | `POST /api/student/website/publish`, `.../rollback` | Create / revert immutable published revisions |
| `rendering/` | `portfolio/src/app/p/[username]/{page,layout,loading}.tsx` | Resolve release → entrypoint → inject DTO → serve HTML |
| `rendering/` | `portfolio/src/app/p/{error,not-found}.tsx` | Segment error / not-found boundaries |
| `rendering/` | `portfolio/src/lib/template-renderer.{js,ts}` | DTO injection, `__ONEVUE_DTO__` placeholder, `'<` → `'\u003c'` escaping |
| `rendering/` | `portfolio/src/lib/template-manifest.ts` | Release manifest / version resolution types |
| `artifact-delivery/` | `portfolio/src/lib/template-artifact-store.ts` | Server-side artifact store bridging to backend storage |
| `artifact-delivery/` | `portfolio/src/lib/template-visitor-release.ts` | Visitor-side release resolution |
| `artifact-delivery/` | `portfolio/src/app/templates/[...path]/route.ts` | Serves versioned static assets |
| `artifact-delivery/` | `portfolio/src/lib/onevue-profile-route.ts` | Request-scoped deduplicated profile lookup |

**Path-traversal barriers** are enforced at the artifact-resolution boundary: resolved paths must remain inside the artifact root, and the production entrypoint must exist on disk — there is no silent fallback to another template or to demo data.

---

## 8. Shared dependencies

These OneVue platform modules are referenced by the extracted code but are **not** duplicated here. Duplicating them would fork auth, the database layer, and the DTO contract — three things that must stay single-source.

| Module | Origin | Needed by |
|---|---|---|
| `backend/lib/auth.ts` | `backend/lib/auth.ts` | Every admin/student route — `verifyAdminAuth`, `verifyAuth` |
| `backend/lib/db.ts` | `backend/lib/db.ts` | `connectToDatabase` in all routes |
| `backend/lib/cors.ts` | `backend/lib/cors.ts` | `applyCorsHeaders`, `preflightResponse` |
| `backend/lib/jwt.js` | `backend/lib/jwt.js` | Token verification (via `auth.ts`) |
| `backend/lib/public-profile-dto.ts` | `backend/lib/public-profile-dto.ts` | `PublicProfileDTO_v1`, `PUBLIC_PROFILE_SCHEMA_VERSION`, `computeSnapshotChecksum`, `verifyPublishedRevisionIntegrity` |
| `backend/models/User.ts` | `backend/models/User.ts` | Admin identity + role checks |
| `backend/models/StudentProfile.ts` | `backend/models/StudentProfile.ts` | Publishing payload source |
| `backend/models/UserWebsiteConfig.ts` | `backend/models/UserWebsiteConfig.ts` | Selected template + version persistence |
| `backend/models/PublishedProfileRevision.ts` | `backend/models/PublishedProfileRevision.ts` | Immutable published revisions |
| `portfolio/src/lib/onevue-api.ts` | `portfolio/src/lib/onevue-api.ts` | `fetchPublishedProfile` (via `onevue-profile-route.ts`) |
| `portfolio/src/lib/onevue-profile-adapter.ts` | `portfolio/src/lib/onevue-profile-adapter.ts` | DTO type definitions used by `template-renderer.ts` |

**Integration surface that was not copied:**

| File | Why |
|---|---|
| `frontend/components/core/app.jsx` | SPA route table; mounts `window.TemplateSubmissionPage` at `/app/admin/templates` |
| `frontend/index.html` | Loads `services/template-admin.js` and `components/dashboard/admin/TemplateSubmissionPage.jsx` as browser scripts |
| `backend/app/api/auth/register/route.ts` | Referenced by `backend/tests/admin_auth.test.js` |
| `backend/app/api/public/profile/[username]/route.ts` | Public profile API — shared endpoint, not template-owned |

---

## 9. Environment contract

No `.env` files are included in this workspace. The feature reads the following variables from the host process.

**Isolation runtime** — all optional; builds fail closed when unset.

```
ONEVUE_BUILD_ISOLATION_RUNTIME=docker|podman|nsjail|firecracker
ONEVUE_BUILD_ISOLATION_BINARY=<absolute path>
ONEVUE_BUILD_ISOLATION_IMAGE=<image>@sha256:<64 hex>
ONEVUE_BUILD_NETWORK_MODE=none
ONEVUE_BUILD_READ_ONLY_ROOTFS=true
ONEVUE_BUILD_TIMEOUT_MS=<1000..1800000>
ONEVUE_BUILD_MEMORY_MB=<64..8192>
ONEVUE_BUILD_CPU_LIMIT=<0.1..8>
ONEVUE_BUILD_PIDS_LIMIT=<16..4096>
ONEVUE_BUILD_ENV_ALLOWLIST=<comma-separated names>
ONEVUE_BUILD_MAX_OUTPUT_BYTES=<1MiB..1GiB>
ONEVUE_BUILD_DEPENDENCY_CACHE_DIR=<absolute dir>
ENABLE_ISOLATED_BUILD_EXECUTION=false
```

**Pipeline storage.**

```
ONEVUE_TEMPLATE_STORAGE_ROOT=<absolute dir>
ONEVUE_SOURCE_SNAPSHOT_ROOT=<absolute dir>   # ingestion fails closed without it
```

**GitHub credentials** — server-side only, never exposed to the browser.

```
GITHUB_READ_TOKEN=<fine-grained, contents:read>
GITHUB_PROVISIONING_TOKEN=<separate write token>
ENABLE_LIVE_GITHUB_PROVISIONING=false
```

**Optional object storage (Cloudflare R2)** — not verified in this environment.

```
ENABLE_LIVE_R2_STORAGE=false
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET_NAME=onevue-templates
CLOUDFLARE_R2_PUBLIC_BASE_URL=
```

**MongoDB test database.**

```
ONEVUE_TEST_MONGODB_URI=<dedicated test DB URI>
```

---

## 10. Remaining blockers

| # | Blocker | Impact | Reference |
|---|---|---|---|
| 1 | **No verified isolated build runtime on this host** — no rootless daemon available | Isolated build execution is unavailable; the boundary correctly fails closed. `template-build` is exercised only through injected offline executors in tests | `TEMPLATE_PIPELINE_PRODUCTION_READINESS.md` §10 |
| 2 | **Cloudflare R2 transport unverified** | Artifact transport falls back to the local filesystem adapter; the R2 path has no live verification | `TEMPLATE_PIPELINE_PRODUCTION_READINESS.md` §6 |
| 3 | **15 test files hardcode an absolute machine-specific path** — `require("/home/ram-pranai-teja/Desktop/Onevue-templates/magicui-portfolio/node_modules/typescript")` | These tests cannot run in a clean checkout without editing the path | `IMPLEMENTATION_STATUS.md` §4 |
| 4 | **Shared platform code is not present in this workspace** | The extracted code is not independently compilable or runnable here — see [Shared Dependencies](#shared-dependencies) | `DEVELOPMENT_SETUP.md` |
| 5 | **Relative import paths point at the original monorepo layout** | Files are preserved verbatim per the extraction brief, so imports resolve only inside the OneVue tree. Resolving them here would require rewriting application code | `IMPLEMENTATION_STATUS.md` §5 |
| 6 | **`template-sources/` is empty** | No sample template source tree is bundled; a real ingestion needs a reachable GitHub repository | this task brief |
| 7 | **`portfolio/src/lib/onevue-api.js` is untracked in the source** | `portfolio-visitor/tests/local_template_serving.test.js` imports it; it was not extracted because it is untracked shared code | `IMPLEMENTATION_STATUS.md` §4 |
