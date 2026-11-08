# OneVue — Local Environment Readiness

Status of genuine local operation for the template pipeline:

```
Admin submits GitHub URL -> ingest -> snapshot -> audit -> provisioning
  -> isolated build -> immutable artifact -> catalog
  -> student selection -> visitor delivery
```

This document records the **audited state of the current Ubuntu host** and the
exact manual steps required to activate each component. Nothing here was
installed or started during the audit.

---

## 1. Environment readiness (audited)

| Component | Detected | Ready? | Notes |
| --- | --- | --- | --- |
| Node.js | v24.22.1 | yes | Next.js 16 requires Node ≥ 20.9 |
| npm | 11.19.1 | yes | |
| `backend/node_modules` | **absent** | **no** | backend cannot start; `mongoose`/`next` unavailable |
| `portfolio/node_modules` | present | yes | portfolio dev server + tests run |
| MongoDB server (`mongod`) | absent | **no** | port 27017 closed, no service |
| MongoDB shell (`mongosh`) | absent | **no** | |
| Docker CLI | 29.9.2 | partial | installed, but daemon socket absent |
| Docker daemon | not running | **no** | `/var/run/docker.sock` missing |
| Rootless Docker socket | absent | **no** | rootless extras (`rootlesskit`, `slirp4netns`, `dockerd-rootless*`) absent |
| Docker Desktop socket | absent | **no** | no VM/process running |
| Podman | absent | **no** | |
| nsjail / firecracker | absent | **no** | |
| bubblewrap | 0.11.1 | not integrated | outside the supported runtime contract |
| User namespaces | enabled (`unprivileged_userns_clone=1`) | — | `newuidmap`/`newgidmap` present |
| cgroup v2 | available (`cpuset cpu io memory pids …`) | — | required by a rootless runtime |
| GitHub credentials | **none set** | **no** | all `GITHUB_*` variables unset |
| MongoDB/JWT env | **none set** | **no** | no `.env*` files present |
| Template storage | `.local-template-storage` (740 KB, `community-template@1.1.0`) | partial | local adapter default |
| Source snapshot root | not configured | **no** | `ONEVUE_SOURCE_SNAPSHOT_ROOT` unset; ingestion returns 500 |
| Build staging dir | `backend/template-builds` (736 KB, pre-existing) | — | not the artifact store |
| Frontend SPA | `frontend/index.html` (static, hash router) | yes | must be served on `:8080` (CORS) |
| R2 | not configured | **no** | `ENABLE_LIVE_R2_STORAGE` unset |

### What this means today

- **Portfolio + visitor rendering**: runnable (`portfolio/node_modules` present).
- **Backend API**: not runnable until `npm install` is performed in `backend/`
  (not done; requires authorization).
- **MongoDB**: not available.
- **Isolated builds**: not available (no usable runtime; adapter fails closed).
- **GitHub ingestion**: code-complete and offline-tested; no credentials and no
  live calls.
- **Full pipeline**: verified with offline doubles only (see §6).

---

## 2. Prerequisites

1. Node.js ≥ 20.9 and npm (present: 24.22.1 / 11.19.1).
2. Backend dependencies: `cd backend && npm install` (not performed).
3. MongoDB ≥ 6.0 reachable (mongoose ^9.11.1). Standalone is supported; a
   replica set is recommended (publish uses transactions when available).
4. Absolute, persistent artifact and snapshot roots.
5. GitHub read token (private repos) and, only if the private-mirror flow is
   required, a write/provisioning token.
6. A rootless container runtime + digest-pinned build image for isolated builds.

---

## 3. Required environment variables

Create `backend/.env.local` (Next.js loads it) — never commit real secrets.

| Variable | Required | Secret | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | yes | Database connection (use a dedicated database) |
| `JWT_SECRET` | yes | yes | ≥ 32 bytes; signs admin/student sessions |
| `ONEVUE_TEMPLATE_STORAGE_ROOT` | yes (prod) | no | Absolute artifact root; defaults to `<repo>/.local-template-storage` |
| `ONEVUE_SOURCE_SNAPSHOT_ROOT` | yes | no | Absolute immutable source snapshot root; ingestion fails closed without it |
| `GITHUB_READ_TOKEN` or `ONEVUE_GITHUB_READ_TOKEN` | for private repos | yes | Read-only GitHub credential (server-side only) |
| `GITHUB_PROVISIONING_TOKEN` or `ONEVUE_GITHUB_TOKEN` | for provisioning | yes | Write credential for the `qubort-tech` mirror (org **Administration: write** + repo **Contents: write**) |
| `ENABLE_LIVE_GITHUB_PROVISIONING` | optional | no | Must be exactly `true` to use the live provisioning executor |
| `ENABLE_ISOLATED_BUILD_EXECUTION` | for builds | no | Must be `true` plus the full `ONEVUE_BUILD_*` contract |
| `ONEVUE_BUILD_ISOLATION_RUNTIME/BINARY/IMAGE` | for builds | no | `docker`/`podman`, absolute binary, `image@sha256:<64hex>` |
| `ONEVUE_BUILD_NETWORK_MODE=none`, `ONEVUE_BUILD_READ_ONLY_ROOTFS=true` | for builds | no | Enforced |
| `ONEVUE_BUILD_TIMEOUT_MS/MEMORY_MB/CPU_LIMIT/PIDS_LIMIT` | for builds | no | Hard limits |
| `ONEVUE_BUILD_ENV_ALLOWLIST` | optional | no | Non-sensitive names only |
| `ONEVUE_BUILD_MAX_OUTPUT_BYTES` | optional | no | Artifact byte cap (default 256 MiB) |
| `ENABLE_LIVE_R2_STORAGE` + `CLOUDFLARE_R2_*` | optional | yes | R2 transport (not verified) |
| `ONEVUE_PUBLIC_API_BASE_URL` | optional (portfolio) | no | Profile API base; defaults to `http://localhost:3000/api` |

Notes:

- Backend CORS reflects only `http://localhost:8080` / `http://127.0.0.1:8080`
  (`backend/lib/cors.ts`). Serve the SPA there.
- The frontend admin service reads `window.OV_ENV.API_BASE` (default
  `http://localhost:3000/api`) and supports a runtime override
  `window.OV_ADMIN_API_BASE` (used for local harnesses).
- Never place tokens in the frontend, repository metadata, snapshots or logs.

---

## 4. Service startup (manual)

```bash
# 1. Backend API (port 3000) — requires backend dependencies
cd backend
npm install                      # not performed by this phase
npm run dev

# 2. Portfolio (visitor + student-facing templates) — port 3001
cd portfolio
npx next dev -p 3001

# 3. Admin/student SPA — port 8080 (required by backend CORS)
cd frontend
python3 -m http.server 8080 --bind 127.0.0.1
```

Verification:

```bash
curl -s http://127.0.0.1:3000/api/public/templates | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/p/student
# Admin submission status (admin bearer token required):
curl -s -H "Authorization: Bearer <admin-token>" \
  http://127.0.0.1:3000/api/admin/templates/submissions | head -c 300
```

---

## 5. Component activation

### 5.1 Isolated build runtime (required for any real build)

Current host: Docker CLI present, **daemon absent**, no rootless socket, and the
rootless extras (`rootlesskit`, `slirp4netns`, `dockerd-rootless-setuptool.sh`)
are not installed. Podman/nsjail are absent. The adapter is implemented and fails
closed until preflight passes.

Option A — rootless Podman (recommended; requires approval to install):

```bash
sudo apt-get install -y podman
podman info --format '{{.Host.Security.Rootless}}'      # must print: true
podman pull registry.example.invalid/onevue/build@sha256:<64hex>
# On the build image: POSIX sh, cp, Node.js + npm/pnpm, and offline-resolvable
# dependencies (vendored node_modules or a package cache), because networking
# is disabled for builds.
```

Option B — rootless Docker (requires approval; rootless extras are missing):

```bash
sudo apt-get install -y uidmap dbus-user-session docker-ce-rootless-extras
dockerd-rootless-setuptool.sh install
systemctl --user enable --now docker
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
```

Enable in `backend/.env.local`:

```dotenv
ENABLE_ISOLATED_BUILD_EXECUTION=true
ONEVUE_BUILD_ISOLATION_RUNTIME=podman          # or docker
ONEVUE_BUILD_ISOLATION_BINARY=/usr/bin/podman  # absolute path
ONEVUE_BUILD_ISOLATION_IMAGE=<image>@sha256:<64hex>
ONEVUE_BUILD_NETWORK_MODE=none
ONEVUE_BUILD_READ_ONLY_ROOTFS=true
ONEVUE_BUILD_TIMEOUT_MS=300000
ONEVUE_BUILD_MEMORY_MB=512
ONEVUE_BUILD_CPU_LIMIT=1
ONEVUE_BUILD_PIDS_LIMIT=128
```

Verify (admin bearer token):

```bash
curl -s -H "Authorization: Bearer <admin-token>" \
  http://127.0.0.1:3000/api/admin/templates/build
# Expect: executable=true, rootless=true, imageDigestVerified=true,
#         smokeTestPassed=true
```

Real sandbox smoke test (explicitly authorized, harmless fixed script):

```bash
ONEVUE_TEST_REAL_ISOLATION=1 node --test backend/tests/build_runtime_real.test.js
```

Preflight refuses: unreachable daemon, non-rootless daemon, missing image,
digest mismatch, group/world-writable binary, failed smoke container.

### 5.2 MongoDB

Not installed on this host. Minimum: MongoDB ≥ 6.0 (mongoose ^9.11.1).
Standalone works; a replica set is recommended because publication uses
transactions when the deployment supports them (the publish route falls back
without a replica set, with a revision-number race window).

Manual setup (Ubuntu, requires approval):

```bash
# MongoDB official repo, then:
sudo apt-get install -y mongodb-org
sudo systemctl enable --now mongod
mongosh --eval 'db.runCommand({ ping: 1 })'
mongosh --eval 'db.getSiblingDB("onevue").createCollection("bootstrap")'
```

Then in `backend/.env.local`:

```dotenv
MONGODB_URI="mongodb://127.0.0.1:27017/onevue"
JWT_SECRET="<at least 32 random bytes>"
```

Required indexes (declared in the model; verify after first boot):

```js
// templateingestionreviews
db.templateingestionreviews.getIndexes()   // { ingestionId: 1 } must be unique
// Optional, recommended for lookups:
db.templateingestionreviews.createIndex({ repositoryKey: 1, createdAt: -1 })
```

The unique `ingestionId` index is mandatory: cross-process repository leases are
`repo_lock:<owner/repo>` documents that rely on it. No migrations are bundled.

Integration tests (dedicated TEST database only; **approval required** before
running; the suite deletes only `itest_*` documents and never touches
production):

```bash
cd backend
ONEVUE_TEST_MONGODB_URI="mongodb://127.0.0.1:27017/onevue_itest" \
  node --test tests/mongo_persistence.integration.test.js
```

The suite covers indexes, unique enforcement, real workflow (create /
no-update / new version), concurrent first-time submissions, lease
expiry/stale-release, and retry without duplicate versions.

### 5.3 GitHub credentials

- Ingestion (read): fine-grained token with **Contents: Read** (or classic
  `repo:read` / `public_repo`) scoped to the repositories you ingest.
- Provisioning (write, optional): organization administration + contents write
  for `qubort-tech`, using a **separate** token.
  - fine-grained PAT: Organization **"Administration: Read & write"** *and*
    Repository **"Contents: Read & write"** on the target organization.
  - classic PAT: `admin:org` **and** `repo`.
  - The token's user must be an organization member with a role that may
    create repositories.
- Set only server-side (`backend/.env.local`); never expose to the browser.
- Enable live provisioning only when the write token is configured:
  `ENABLE_LIVE_GITHUB_PROVISIONING=true`.
- Without credentials, public repositories still ingest; private repositories
  return a clear 401/404 authentication/access error.
- Rate limits map to distinct errors; tokens are redacted from all messages.
- The approved content is pushed with the GitHub **Git Data API**
  (`git/blobs` → `git/trees` → `git/commits` → `git/refs`), so no `git` binary
  and no on-disk credential are needed.
- A failed push rolls the created repository back so a retry is not blocked;
  an existing repository that already mirrors the same source commit is
  **adopted** instead of being overwritten.
- Optional live smoke test (explicit authorization; makes real GitHub requests):

```bash
ONEVUE_LIVE_GITHUB_SMOKE=1 ONEVUE_LIVE_GITHUB_REPO=owner/repository \
  node --test backend/tests/github_live_smoke.test.js
```

- Optional live **provisioning** test (explicit authorization; creates a real
  private repository, pushes content, verifies it, then deletes it again):

```bash
ONEVUE_LIVE_GITHUB_PROVISION=1 GITHUB_PROVISIONING_TOKEN=<token> \
  node --test backend/tests/github_provisioning_live.test.js
```

The repository name must start with `onevue-provisioning-smoke-` unless
`ONEVUE_LIVE_GITHUB_ALLOW_ANY_REPO=1` is set, and the run aborts if that
repository already exists.

### 5.4 Artifact and snapshot storage

```bash
mkdir -p /var/lib/onevue/templates /var/lib/onevue/snapshots
export ONEVUE_TEMPLATE_STORAGE_ROOT=/var/lib/onevue/templates
export ONEVUE_SOURCE_SNAPSHOT_ROOT=/var/lib/onevue/snapshots
```

The storage adapter writes immutable `templates/<id>/<version>/` releases and
never overwrites an existing version. Existing local artifact:
`.local-template-storage/templates/community-template/1.1.0` (verified intact).

---

## 6. Template submission workflow

1. Start backend, portfolio and SPA (§4); sign in as a user with
   `role: "admin"` and `identity: "admin"`.
2. Open `http://localhost:8080/#/app/admin/templates`.
3. Submit a GitHub URL (optional branch/tag, reason). The pipeline runs:
   validation → commit pin → duplicate check → snapshot → audit → build
   boundary → provisioning → isolated build → immutable store → catalog.
4. The status panel shows: repository identity, pinned commit, template
   version, audit outcome, current stage, source access mode, and retry
   eligibility (`Retry this commit` action on transient failures).
5. `NO_UPDATE` is returned for the same repository + commit; a new commit
   produces a new immutable version; retries reuse the failed version.

API equivalents (admin bearer token):

```bash
curl -s -X POST http://127.0.0.1:3000/api/admin/templates/submit \
  -H "Authorization: Bearer <admin-token>" -H "Content-Type: application/json" \
  -d '{"url":"https://github.com/owner/repo","explicitConfirmation":true}'

curl -s -H "Authorization: Bearer <admin-token>" \
  "http://127.0.0.1:3000/api/admin/templates/submissions?limit=25"
```

## 7. Catalog and visitor verification

```bash
# Catalog (dynamic, no hardcoded versions)
curl -s http://127.0.0.1:3000/api/public/templates

# Student selection: use "latest"; the resolved concrete version is persisted
curl -s -X PUT http://127.0.0.1:3000/api/student/website/config \
  -H "Authorization: Bearer <student-token>" -H "Content-Type: application/json" \
  -d '{"selectedTemplateId":"<template-id>","selectedTemplateVersion":"latest"}'

# Visitor page and immutable assets (portfolio app)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/p/<username>
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  http://127.0.0.1:3001/templates/<template-id>/<version>/index.html
```

- Only approved, fully stored and integrity-validated versions are catalogued.
- The catalog's `latestVersion` drives new selections; existing selections and
  published revisions keep their pinned version.
- Delivery goes through the backend artifact boundary (manifest + per-file
  SHA-256, immutable cache headers). Missing/tampered artifacts fail closed.
- Local nuance: in development the portfolio falls back to built-in profile
  fixtures when the **profile API** is unreachable. That affects profile data
  only, never artifact bytes.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `SOURCE_SNAPSHOT_STORAGE_UNCONFIGURED` (500) | `ONEVUE_SOURCE_SNAPSHOT_ROOT` unset | Set it to an absolute writable path |
| `BUILD_BOUNDARY_UNAVAILABLE` | No runtime / preflight failed | Check `GET /api/admin/templates/build`, activate runtime (§5.1) |
| `BUILD_EXECUTION_FAILED ... timed out` | Build exceeded timeout | Raise `ONEVUE_BUILD_TIMEOUT_MS` within limits; check image/toolchain |
| `BUILD_EXECUTION_FAILED ... ONeVUE_BUILD_NO_ARTIFACT` | Build did not emit `index.html` at root/`dist`/`build`/`out` | Ensure the build emits an HTML entrypoint; dependencies must resolve offline |
| `PROVISIONING_UNAVAILABLE` | Live provisioning not configured | Set the write token + `ENABLE_LIVE_GITHUB_PROVISIONING=true`, or inject a mock executor in tests |
| `COMMIT_RESOLUTION_FAILED` with authentication text | Bad/expired read token | Rotate `GITHUB_READ_TOKEN` |
| `EXISTING_INCOMPLETE` | Same commit previously failed | Re-submit with retry enabled |
| `CONCURRENT_SUBMISSION` (409) | Another worker holds the repository lease | Wait for the lease (10 min default) or retry later |
| `MISSING_ARTIFACT` / `INTEGRITY_FAILURE` on assets | Artifact absent/tampered | Re-run the submission; verify storage root |
| CORS errors in the SPA | SPA not on `:8080` | Serve frontend on `localhost:8080` or update `backend/lib/cors.ts` |
| MongoDB connection errors | Server down / wrong URI | Start MongoDB, verify `MONGODB_URI`, then retry |

---

## 9. Readiness checklist

**Implemented and offline-tested**
- GitHub ingestion (public; private via mock credentials), pinning, archive safety, redaction
- Submission workflow, duplicate/no-update, immutable versions, retry/recovery
- Repository lease, lifecycle, storage boundary, catalog, latest pinning, visitor delivery
- Isolated build adapter contract (fake runtime)

**Implemented, not verified on this host**
- Backend runtime itself (backend dependencies absent)
- MongoDB persistence (no server/driver)
- Real isolated builds (no usable runtime)
- Live GitHub private access (no credentials)
- R2 transport

**Required manual steps to reach genuine local operation**
1. `cd backend && npm install`.
2. Install and start MongoDB (§5.2), set `MONGODB_URI` + `JWT_SECRET`, verify the unique index.
3. Set `ONEVUE_TEMPLATE_STORAGE_ROOT` and `ONEVUE_SOURCE_SNAPSHOT_ROOT`.
4. Install a rootless runtime and a digest-pinned build image (§5.1), set the `ONEVUE_BUILD_*` contract, confirm `executable=true`, run the gated real-isolation test.
5. Configure GitHub read/write tokens as needed.
6. Start the three services (§4) and submit a test repository end to end.

---

## Phase 6.0 activation log (this host)

- Backend dependencies installed with `npm ci` (lockfile untouched): Next 16.4.0, Mongoose 9.11.1.
- Added `GET /api/health` (liveness probe, no database access).
- Added `.env.local` (git-ignored) with a generated `JWT_SECRET`, artifact root and
  source-snapshot root. MongoDB remains intentionally unconfigured (skipped).
- Fixed a genuine admin-UI disconnect: the SPA client used credentialed CORS
  (`credentials: 'include'`) while the backend is Bearer-token only and does not
  emit `Access-Control-Allow-Credentials`; browsers blocked every admin call.
  Removed credential mode from `frontend/services/_core.js` and
  `frontend/services/template-admin.js`, and cache-busted both scripts.
- Running services: backend `:3000`, portfolio `:3001`, SPA `:8080`.
- Verified live: `/api/health` 200; `/api/public/templates` 200 (static fallback
  while MongoDB is absent); artifact delivery 200 with immutable headers; admin
  endpoints 401 without a valid token (auth gate works); admin UI reaches the
  backend after the CORS fix; live GitHub pin/download/extract smoke passed
  against `octocat/Hello-World`.
- Not runnable without MongoDB: login, admin authorization success path,
  submission, catalog merge of dynamic templates, student selection, visitor
  profile rendering.
- Not runnable without a rootless runtime: isolated builds (fail closed).
