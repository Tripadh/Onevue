# OneVue Template Pipeline — Production Readiness

Status: **not production-ready**. The pipeline is implemented and verified offline; the
three infrastructure boundaries below are unavailable in the current environment and
remain unverified in production:

1. A genuine isolated build runtime (no Docker/nsjail/microVM, adapter not integrated).
2. MongoDB persistence (no MongoDB server or driver installed here).
3. Live GitHub and Cloudflare R2 (explicitly out of scope; never called).

This document is the deployment contract. Nothing here is a claim of production
verification unless it appears under "Production-verified".

---

## 1. Current architecture

```
Admin UI (frontend/components/dashboard/admin/TemplateSubmissionPage.jsx)
  -> POST /api/admin/templates/submit            (verifyAdminAuth)
     -> backend/lib/template-submission.ts
        1. validate URL + canonical repository identity   (github-ingestion)
        2. repository lease (MongoDB, repo_lock:<owner/repo>)
        3. resolve branch/tag -> immutable commit SHA     (GitHub API)
        4. duplicate / no-update decision (same repo + commit)
        5. download pinned tarball, safe extraction       (no symlinks/traversal)
        6. immutable source snapshot                      (FileSystemSourceSnapshotStore)
        7. license + dependency audit                     (template-audit)
        8. failure gates: audit, build boundary, provisioning
        9. provisioning plan -> private mirror            (template-provisioning)
       10. orchestrateTemplateLifecycle:
             adapt -> isolated build+package -> store -> validate
             (template-lifecycle, template-build, template-storage)
       11. catalog registration (Mongo record + stored artifact)
  -> GET /api/admin/templates/submissions         (status, stages, retry eligibility)

Public catalog: GET /api/public/templates        (template-registry-extension)
Student selection: PUT /api/student/website/config
  -> validateEligibleTemplateSelection (supports "latest", persists the concrete version)
Visitor delivery: portfolio /p/:username + /templates/:id/:version/:asset
  -> backend/lib/template-artifact-delivery.ts (Phase 5.14 boundary)
  -> TemplateStorageAdapter (local filesystem now, R2 later)
```

Self-contained payloads for every state are persisted on the
`TemplateIngestionReview` document (`stages`, `submissionStatus`, lifecycle,
provisioning, lease fields).

---

## 2. Environment variables and secrets

Required:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Production database. Include a dedicated database name. |
| `JWT_SECRET` | ≥ 32 bytes; validates admin/student sessions. |
| `ONEVUE_TEMPLATE_STORAGE_ROOT` | Absolute artifact storage root (must be on persistent storage). |
| `ONEVUE_SOURCE_SNAPSHOT_ROOT` | Absolute root for immutable source snapshots. |
| `ONEVUE_GITHUB_READ_TOKEN` **or** `GITHUB_READ_TOKEN` | Read-only GitHub credential (preferred). Never sent to browsers. |
| `GITHUB_PROVISIONING_TOKEN` (or `ONEVUE_GITHUB_TOKEN`) | Write credential for the `qubort-tech` private mirror; enable with `ENABLE_LIVE_GITHUB_PROVISIONING=true`. |

Optional / gated:

| Variable | Purpose |
| --- | --- |
| `ENABLE_LIVE_GITHUB_PROVISIONING=true` | Enables the live provisioning executor. Anything else fails closed. |
| `ENABLE_LIVE_R2_STORAGE=true` + `CLOUDFLARE_R2_ACCOUNT_ID`, `..._ACCESS_KEY_ID`, `..._SECRET_ACCESS_KEY`, `..._BUCKET_NAME`, `..._PUBLIC_BASE_URL` | Switches artifact storage to R2. Not verified. |
| `ENABLE_ISOLATED_BUILD_EXECUTION=true` + `ONEVUE_BUILD_*` | See §5. Required for any build. |
| `ONEVUE_BUILD_DEPENDENCY_CACHE_DIR` | Absolute, pre-populated package cache mounted read-only at `/deps`; required for templates with a lockfile (offline install). |

Credential handling invariants (implemented):

- Tokens are read only from server-side environment variables; the admin API and
  the frontend never accept or return credentials.
- `Authorization` is attached to GitHub API and tarball requests only.
- Errors are redacted (`redactGitHubCredential`); tokens are not stored in
  repository metadata, snapshots, manifests, stage details or logs.
- `authMode` (`public` / `credentialed`) is recorded for observability.

---

## 3. MongoDB index requirements

The submission model is `TemplateIngestionReview`
(`templateingestionreviews`).

Required (declared in the schema):

```js
{ ingestionId: 1 }   // unique
```

This index is a hard requirement: cross-process repository leases are documents
whose `ingestionId` is `repo_lock:<owner/repo>`, and their exclusivity relies on
the unique index. Verify after deployment:

```js
db.templateingestionreviews.getIndexes()
// expect an index with key { ingestionId: 1 } and unique: true
```

Recommended (non-unique, safe online build, not applied by this repository):

```js
db.templateingestionreviews.createIndex({ repositoryKey: 1, createdAt: -1 })
```

Deliberately **not** proposed: a unique `(repositoryKey, commitSha)` index.
Retries intentionally add a second record for the same pinned commit while
reusing the same artifact version; version uniqueness is enforced by immutable
storage and version derivation, not by a record-level constraint.

Migration plan (operator-run, no application migration scripts):

1. Back up the collection.
2. Confirm the unique `ingestionId` index exists; create it if absent
   (`createIndex({ingestionId:1},{unique:true})`). If duplicates exist, resolve
   them first — the lock feature requires uniqueness.
3. Optionally create the recommended non-unique index.
4. Roll out the application after the index is in place.

No migrations are run by this repository, and no production data is touched.

---

## 4. GitHub permissions

- Ingestion (read): repository contents and commit metadata. A **read-only**
  fine-grained token scoped to the repositories being ingested is sufficient.
  Classic tokens need only `repo:read` (or `public_repo` for public only).
- Provisioning (write): create repositories under `qubort-tech` and push the
  approved content into them. The token needs **Organization "Administration:
  Read & write"** (to create the repository) **and Repository "Contents: Read
  & write"** (to push the template content) on the target organization. The
  classic-token equivalent is `admin:org` **and** `repo`. The token's user must
  be an organization member with a role that may create repositories. Keep this
  credential separate from the read token.
- Content delivery uses the GitHub **Git Data API** (`git/blobs` → `git/trees`
  → `git/commits` → `git/refs`): no `git` binary, no on-disk credential, and no
  credential ever placed in a URL or argument list.
- Rate limits: the client maps 401/403/429 to distinct errors. Transient 5xx
  responses are retried with bounded exponential backoff (at most 3 attempts);
  a 429 is surfaced immediately, because retrying into a global rate limit is
  wasteful — the reset time is read from `Retry-After` / `X-RateLimit-Reset`.
- Archive handling: only the pinned SHA tarball endpoint is used; extraction
  rejects absolute paths, traversal, symlinks/hardlinks and size/count limits.
- Private repositories: supported by the read credential path; offline-verified
  with mocked credentials. Not verified against live GitHub.

### 4.1 Provisioning failure, rollback and idempotency

- **Collision** — an existing destination repository is never overwritten. The
  live executor inspects it instead: if the repository is private, owned by the
  target organization, and its `.onevue/provenance.json` marker proves it
  mirrors the *same* source commit, it is **adopted** as a success. Any other
  existing repository is a hard `COLLISION` failure.
- **Rollback** — if the content push or the post-creation verification fails
  after the repository was created, the repository is deleted again so the
  retry is not blocked by an orphan. The client refuses to delete a repository
  it did not create itself, and if the deletion fails the exact repository name
  is reported for manual removal.
- **Verification** — privacy and ownership are confirmed by *reading the
  repository back* (`private === true`, `visibility === "private"`,
  `owner.login === "qubort-tech"`), not by trusting the creation response.
- **Identity** — the mirror commit SHA is persisted as
  `provisioningRecord.destinationCommitSha`, alongside the source commit SHA in
  `provisioningRecord.provenance`.

Live smoke tests (optional, explicitly authorized):

```bash
# Read-only: resolve a ref, download and safely extract a pinned archive.
ONEVUE_LIVE_GITHUB_SMOKE=1 \
ONEVUE_LIVE_GITHUB_REPO=owner/repository \
node --test backend/tests/github_live_smoke.test.js

# Write: creates a real private repository, pushes content, verifies privacy,
# then deletes it again. The repository name must start with
# "onevue-provisioning-smoke-" unless ONEVUE_LIVE_GITHUB_ALLOW_ANY_REPO=1.
ONEVUE_LIVE_GITHUB_PROVISION=1 \
GITHUB_PROVISIONING_TOKEN=<fine-grained PAT> \
node --test backend/tests/github_provisioning_live.test.js
```

---

## 5. Build isolation requirements

Default state: **disabled and fail-closed**. The OCI adapter is implemented
(`backend/lib/template-build-runtime.ts`) and is only produced after a successful
preflight: binary permissions, daemon reachability, **rootless** mode,
digest-pinned image present locally, and a harmless smoke container. If any check
fails, no executor exists, the submission ends at `BUILD_BOUNDARY` with
`BUILD_BOUNDARY_UNAVAILABLE` (retryable), and no host execution occurs.
`GET /api/admin/templates/build` reports the cached preflight diagnostics.

Required environment contract (validated in `template-build-isolation.ts`):

```text
ENABLE_ISOLATED_BUILD_EXECUTION=true
ONEVUE_BUILD_ISOLATION_RUNTIME=docker|podman|nsjail|firecracker
ONEVUE_BUILD_ISOLATION_BINARY=<absolute path>
ONEVUE_BUILD_ISOLATION_IMAGE=<image>@sha256:<64 hex>
ONEVUE_BUILD_NETWORK_MODE=none
ONEVUE_BUILD_READ_ONLY_ROOTFS=true
ONEVUE_BUILD_TIMEOUT_MS=1000..1800000
ONEVUE_BUILD_MEMORY_MB=64..8192
ONEVUE_BUILD_CPU_LIMIT=0.1..8
ONEVUE_BUILD_PIDS_LIMIT=16..4096
ONEVUE_BUILD_ENV_ALLOWLIST=<non-sensitive names>   # optional
ONEVUE_BUILD_MAX_OUTPUT_BYTES=<1MiB..1GiB>          # optional
ONEVUE_BUILD_DEPENDENCY_CACHE_DIR=<absolute cache>  # optional; read-only /deps
```

Smallest supported integration path (choose one, in order of effort):

1. **Rootless Podman/Docker** with a digest-pinned image:
   - fresh container per build; source mounted read-only; output mounted separately;
   - `--network none`, `--read-only`, `--user <non-root>`, `--cap-drop ALL`,
     `--security-opt no-new-privileges`, `--pids-limit`, `--memory`, `--cpus`;
   - kill the whole container on timeout/abort; copy and verify only the output dir.
   Implement it as a `BuildIsolationRuntimeAdapter.executeBuild(...)` and pass it
   to `IsolatedSandboxBuildExecutor({ runtimeAdapter })` inside the build route.
2. **nsjail** for hosts without a container runtime, with the same mount, namespace
   and rlimit guarantees.
3. **MicroVM** (firecracker) for strongest isolation.

Until one is integrated and verified, template builds must remain disabled.
No Docker/nsjail was installed or run in this phase.

---

## 6. Cloudflare R2 requirements

`CloudflareR2StorageAdapter` implements the same `TemplateStorageAdapter`
interface as the local filesystem adapter. The delivery boundary and lifecycle
are transport-agnostic. R2 is currently **not exercised**.

Requirements to enable:

- A bucket plus an S3-compatible endpoint and credentials (env names in §2).
- Immutable object keys: `templates/<templateId>/<templateVersion>/...`.
- Bucket policy that allows the backend to read/write but denies public list;
  public read either via signed URLs or the backend delivery route.
- Server-side encryption and versioning enabled.
- Verify `storeArtifact` atomicity/collision behavior and the retrieval path with
  a dedicated integration test before enabling `ENABLE_LIVE_R2_STORAGE=true`.

---

## 7. Failure and retry behavior

| Condition | Result | Retryable |
| --- | --- | --- |
| Invalid URL / identity | `INVALID_URL` | No (fix input) |
| Invalid/expired credential | `COMMIT_RESOLUTION_FAILED` | After credential fix |
| Repository/ref not found | `COMMIT_RESOLUTION_FAILED` | After fixing ref/access |
| Audit `REJECT` | `AUDIT_REJECTED`, record `rejected` | No (new source needed) |
| Audit `REVIEW_REQUIRED` | `REVIEW_REQUIRED`, record `review_required` | Yes, with `policyOverride` + reason |
| Build boundary unavailable | `BUILD_BOUNDARY_UNAVAILABLE` | Yes (after runtime is enabled) |
| Build failure / timeout | `BUILD_EXECUTION_FAILED` | Yes |
| Storage failure | `STORAGE_FAILED` | Yes |
| Catalog registration failure | `catalog_registration_failed` | Yes |
| Same commit, already published | `NO_UPDATE` | N/A |
| Same commit, previously failed | `EXISTING_INCOMPLETE` | Yes, with `retry: true` |
| Concurrent worker | `CONCURRENT_SUBMISSION` (HTTP 409) | Yes, later |
| Provisioning collision (unrelated existing repository) | `COLLISION` (HTTP 409) | No (different name needed) |
| Provisioning content push failed | `PROVISIONING_FAILED`, repository rolled back | Yes |
| GitHub 5xx during provisioning | retried up to 3 attempts | Yes, later |
| GitHub 429 during provisioning | `RATE_LIMITED` | Yes, after the reset time |

Retry semantics:

- A retry reuses the failed attempt's immutable version; it never creates a new
  version for the same commit.
- If the artifact was already stored before the failure, retry validates and
  registers it without rebuilding (`recoverStoredVersion`).
- A successful retry makes further retries `NO_UPDATE`.
- Leases expire after 10 minutes by default (`leaseMs`), and only the owning
  worker can release its lease; stale workers cannot mutate shared state
  (lifecycle stages also enforce owner-token leases).

---

## 8. Operational monitoring

Persisted per submission (queryable via `GET /api/admin/templates/submissions`):

- `repositoryKey`, `sourceUrl`, `requestedRef`, `commitSha`, `previousCommitSha`
- `templateId`, `templateVersion`, `previousVersion`
- `auditReport.outcome`
- `stages[]` with per-stage status/detail/timestamp and `currentStage`
- `submissionStatus` (`processing`, `catalog_eligible`, `build_failed`, ...)
- `provisioningRecord.status`, destination, error
- `retryEligible`, `sourceAuthMode`
- lifecycle record (`provisioningRecord.provenance.lifecycle`) including manifest
  checksum and failed stage

Recommended alerts:

- submissions stuck in `processing` longer than the lease window;
- repeated `BUILD_EXECUTION_FAILED` / `STORAGE_FAILED`;
- `CONCURRENT_SUBMISSION` rate;
- catalog size vs. storage artifact count divergence;
- delivery boundary 5xx rate (integrity/storage failures).

Never log request bodies containing credentials; the ingestion layer redacts
tokens by construction.

---

## 9. Deployment prerequisites

1. MongoDB reachable; `ingestionId` unique index present; dedicated database.
2. `JWT_SECRET` (≥32 bytes), CORS origins configured for the admin UI origin.
3. Persistent, backed-up artifact and snapshot roots (or R2 equivalent).
4. Read-only GitHub token installed server-side; write/provisioning token if the
   private mirror flow is required (`ENABLE_LIVE_GITHUB_PROVISIONING=true`).
5. A verified isolated build runtime configured and its adapter integrated.
6. Node.js with the backend dependencies installed (`next`, `mongoose`, etc.).
7. R2 not enabled until its integration test passes.

---

## 10. Readiness checklist

### Implemented

- [x] GitHub URL validation + canonical repository identity
- [x] Branch/tag → immutable SHA; exact pinned tarball download
- [x] Archive safety (traversal, symlink/hardlink, size/count limits)
- [x] Public and credentialed (private) read paths; redaction; no token leakage
- [x] Immutable source snapshots (content-digested)
- [x] License/dependency audit gate
- [x] Provisioning plan/executor with fixed org + private visibility
- [x] Live content push to the private mirror (Git Data API: blob → tree → commit → ref)
- [x] Post-creation verification by reading the repository back (privacy + ownership)
- [x] Rollback of a partially created repository; idempotent adoption of an identical mirror
- [x] Lifecycle orchestration (adapt → build/package → store → validate)
- [x] Immutable artifact storage + manifest (structure, checksum, per-file SHA-256)
- [x] Catalog eligibility only after storage integrity validation
- [x] Student selection with `latest` pinned to a concrete version
- [x] Visitor delivery through the Phase 5.14 backend boundary (exact bytes)
- [x] Duplicate/no-update, new-version, retry, recovery semantics
- [x] Cross-process repository lease (reuses unique `ingestionId`)
- [x] Admin status API + UI with stages, retry eligibility, current stage
- [x] Fail-closed build boundary (no host execution)
- [x] OCI (Docker/Podman) isolation adapter with rootless + digest preflight
- [x] Production-readiness document (this file)

### Tested offline (this environment)

- [x] Full pipeline URL → catalog → selection → delivery (31 workflow tests)
- [x] Public + mocked-credential private ingestion; invalid credentials
- [x] Token never appears in snapshots/manifests/records/errors
- [x] GitHub API client contract against an in-memory fake of the REST API:
      create/read/delete, Git Data API push, error mapping, bounded retry,
      rollback deletion, credential redaction
- [x] Live provisioning path end-to-end against the fake: content pushed, mirror
      verified private, identical mirror adopted, foreign mirror still collides,
      failed push rolled back
- [x] Same commit → `NO_UPDATE`; new commit → new version; old version served
- [x] Concurrent first-time and concurrent updates (single version)
- [x] Expired lease reclaim; stale-worker release rejected
- [x] Build failure, timeout, isolation unavailable, storage failure (no publish)
- [x] Retry reuses version; post-storage recovery without rebuild
- [x] Pinned published version remains selectable and delivered
- [x] `latest` resolution and persistence through the config route
- [x] Portfolio suite 79/79; affected backend suites green

### Prepared but skipped (environment unavailable)

- [ ] Real MongoDB persistence (indexes, lease atomicity, workflow, retries):
      `ONEVUE_TEST_MONGODB_URI=... node --test backend/tests/mongo_persistence.integration.test.js`
- [ ] Live GitHub smoke (explicitly gated):
      `ONEVUE_LIVE_GITHUB_SMOKE=1 ONEVUE_LIVE_GITHUB_REPO=owner/repo node --test backend/tests/github_live_smoke.test.js`
- [ ] Live private-repository provisioning (explicitly gated, creates and deletes a
      real repository):
      `ONEVUE_LIVE_GITHUB_PROVISION=1 GITHUB_PROVISIONING_TOKEN=... node --test backend/tests/github_provisioning_live.test.js`

### Not production-verified

- [ ] Genuine isolated build execution on this host (no running rootless daemon;
      adapter contract verified offline, real sandbox not executed)
- [ ] MongoDB production behavior (no server/driver here)
- [ ] Live GitHub private-repository access
- [ ] Live GitHub private-repository *provisioning* (creation, content push,
      verification and rollback are verified offline against a fake of the
      GitHub REST API; no real repository has been created yet)
- [ ] Cloudflare R2 storage transport
- [ ] Multi-instance deployment behind a load balancer (leases rely on the
      unique index; no live multi-process run performed)
