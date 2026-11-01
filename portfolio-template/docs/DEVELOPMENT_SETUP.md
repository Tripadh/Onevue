# OneVue Portfolio Template Feature — Development Setup

> **Read this first.** This workspace is a **reference extraction**, not an independently runnable application. See [Executable Status](#executable-status) before attempting to run anything.

---

## 1. What this workspace is

`portfolio-template/` contains byte-identical copies of the Portfolio Template feature files, organised by pipeline stage. It exists to make the feature legible and reviewable as a unit.

It is **not** a build target. Three independent reasons:

1. **Shared platform code is absent.** Auth, the database layer, the DTO contract, and the shared models live in the OneVue monorepo and are referenced, not duplicated. See [ARCHITECTURE.md §8](ARCHITECTURE.md#8-shared-dependencies).
2. **Import paths are unchanged.** The files preserve their original relative import specifiers, which resolve inside the OneVue tree. Rewriting them here would mean rewriting application code, which the extraction brief prohibits.
3. **No package manifest.** There is no `package.json`, `tsconfig.json`, or lockfile here, so no toolchain can resolve or build this tree.

To work on the feature, work in the OneVue monorepo. Use this workspace as the map.

---

## 2. Executable status

| Capability | Status | Evidence |
|---|---|---|
| Type-checking this tree standalone | **Not possible** | No `tsconfig.json`; shared modules absent; import paths point outside this tree |
| Running backend tests here | **Not possible** | Tests `require("../lib/...")` relative to the original monorepo layout |
| Running portfolio tests here | **Not possible** | Tests import `../src/lib/...` and `../../backend/...` |
| Tests passing **in the OneVue monorepo** | **Verified** | 347 pass / 0 fail (291 backend, 56 portfolio) at commit `03cc12ef` |
| Running the full application | **Verified in the monorepo** | See `backend/LOCAL_ENVIRONMENT_READINESS.md` |

**Do not treat this workspace as independently executable.** It is not.

---

## 3. Working in the OneVue monorepo

The feature lives in the original tree. Nothing needs to be moved.

```text
backend/lib/template-*.ts              pipeline modules
backend/lib/template-adapters/          react-vite adapter
backend/lib/github-*.ts                 ingestion + GitHub client
backend/models/TemplateIngestionReview.ts
backend/app/api/admin/templates/        admin routes
backend/app/api/public/templates/       public catalog
backend/app/api/public/template-artifact/  artifact delivery
backend/app/api/student/website/        config / publish / rollback
frontend/components/dashboard/admin/    admin UI
frontend/services/template-admin.js     admin API client
portfolio/src/app/p/                    visitor routes
portfolio/src/app/templates/            asset route
portfolio/src/lib/template-*.ts         rendering + delivery
backend/tests/                          feature tests
portfolio/tests/                        feature tests
```

### Run the feature test suites

```bash
cd backend
node --experimental-strip-types --test \
  tests/template_*.test.js tests/admin_*.test.js tests/github_*.test.js \
  tests/build_runtime_*.test.js tests/dynamic_template_registry.test.js \
  tests/phase*.test.js
# → 291 pass / 0 fail

cd ../portfolio
node --experimental-strip-types --test \
  tests/dynamic_template_delivery.test.js tests/local_template_serving.test.js \
  tests/template_artifact_storage_delivery.test.js tests/p2_portfolio_template.test.js
# → 56 pass / 0 fail
```

Requires **Node.js ≥ 22** for `--experimental-strip-types` (verified on v24.22.1).

### Type-check

```bash
cd backend && npx tsc --noEmit
cd portfolio && npx tsc --noEmit
```

Both use `strict: true`. `noUnusedLocals` is **not** enabled — which is why the unused `APPROVED_TEMPLATES` / `ApprovedTemplateId` imports in the student config route do not fail the build.

---

## 4. Runtime prerequisites

Full detail: [`backend/LOCAL_ENVIRONMENT_READINESS.md`](../backend/LOCAL_ENVIRONMENT_READINESS.md).

| Service | Port | Notes |
|---|---|---|
| Backend API | 3000 | Requires MongoDB + backend deps |
| Portfolio (visitor + student) | 3001 | Next.js |
| Admin/student SPA | 8080 | **Required** — backend CORS reflects only ports 8080 / 127.0.0.1:8080 |
| MongoDB | 27017 | Replica set required for publish transactions |

### Environment variables

No `.env` file is included here (correctly — see [ARCHITECTURE.md §9](ARCHITECTURE.md#9-environment-contract) for the full list).

Minimum to exercise ingestion:

```bash
export ONEVUE_SOURCE_SNAPSHOT_ROOT=/abs/path/snapshots
export ONEVUE_TEMPLATE_STORAGE_ROOT=/abs/path/templates
export ENABLE_ISOLATED_BUILD_EXECUTION=false   # builds fail closed without a runtime
```

To actually build, you additionally need a **verified isolation runtime** — a rootless Podman or Docker daemon with a digest-pinned image. The build boundary will not fall back to running template code directly on the host.

---

## 5. Build isolation prerequisites

Full detail: [`backend/build-runtime/BUILD_RUNTIME_ISOLATION.md`](../backend/build-runtime/BUILD_RUNTIME_ISOLATION.md).

On the build image you need: POSIX `sh`, `cp`, Node.js with npm/pnpm, and **offline-resolvable** dependencies (vendored `node_modules` or a populated package cache) — because the build runs with networking disabled.

To populate the offline cache on a networked host:

```bash
npm cache add <pkg>@<version> --cache /var/lib/onevue/npm-cache
export ONEVUE_BUILD_DEPENDENCY_CACHE_DIR=/var/lib/onevue/npm-cache
```

Templates with a lockfile **fail closed** rather than reaching the network.

---

## 6. Admin UI integration

The admin page is a **global browser script**, not a module. To mount it in the SPA:

```html
<!-- index.html -->
<script src="services/template-admin.js?v=2"></script>
<script type="text/babel" src="components/dashboard/admin/TemplateSubmissionPage.jsx?v=1"></script>
```

The page exposes `window.TemplateSubmissionPage`. Route it in `frontend/components/core/app.jsx`:

```jsx
<Route path="/app/admin/templates" element={<AdminTemplateRoute />} />
```

The route guard checks `session.user.identity === 'admin'` and redirects otherwise.

---

## 7. MongoDB indexes

Required by the template pipeline — see `TEMPLATE_PIPELINE_PRODUCTION_READINESS.md` §3. The ingestion review model is indexed on `ingestionId`, `templateId`, `templateVersion`, and `commitSha`.

---

## 8. GitHub permissions

| Token | Permission | Used by |
|---|---|---|
| `GITHUB_READ_TOKEN` | Fine-grained, `contents: read` | Repository ingestion, commit pinning |
| `GITHUB_PROVISIONING_TOKEN` | Separate **write** token | Private repository provisioning |

Never expose either to the frontend. The admin service attaches only the session bearer token.

---

## 9. Working with this workspace

- **This workspace is the map; the monorepo is the source of truth.** Edits belong in the monorepo. If you change a file here, you have diverged from the feature.
- **Keep `MANIFEST.md` in sync** if files are added or removed.
- **`template-sources/` is intentionally empty.** It is reserved for sample template source trees.
- **Never commit secrets** into this workspace.

---

## 10. Verification checklist

```bash
# every extracted file matches its source byte-for-byte
cmp <source> <destination>

# nothing forbidden was copied
find portfolio-template -name '.env*' -o -name 'node_modules' -o -name 'dist' \
  -o -name '*.map' -o -name '*.log'

# the monorepo index is untouched
git diff --cached --name-only | wc -l    # → 86
git status --porcelain | wc -l
```

See [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) for current results.
