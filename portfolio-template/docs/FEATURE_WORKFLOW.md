# OneVue Portfolio Template Feature — Workflow

Stage-by-stage reference for the ingestion pipeline and the visitor delivery path.

---

## 1. Admin ingestion pipeline

Driven by `backend/lifecycle/template-submission.ts`. Each stage is recorded on the submission record with a `status` of `succeeded`, `in_progress`, `failed`, or `skipped`.

### Stage 1 — `VALIDATE_REPOSITORY`

**Module:** `backend/github-ingestion/github-ingestion.ts`

Parses and validates the submitted GitHub repository URL. Rejects anything that is not a supported public or private GitHub repository reference. No network access is performed for a syntactically invalid URL.

### Stage 2 — `PIN_COMMIT`

**Module:** `backend/github-ingestion/github-ingestion.ts`

Resolves the repository's current head to an immutable commit SHA. Everything downstream keys off the SHA, never a branch name — a branch can move, a commit cannot. This is the property that makes the whole pipeline reproducible.

### Stage 3 — `DUPLICATE_CHECK`

**Module:** `backend/lifecycle/template-submission.ts`

If the same commit was already ingested, the existing release is reused (`recoverStoredVersion`) instead of rebuilding. Avoids redundant isolation-runtime spend and duplicate storage.

### Stage 4 — `SOURCE_SNAPSHOT`

**Module:** `backend/artifact-storage/template-snapshot.ts`

Writes a durable snapshot of the source tree and returns a verifiable descriptor (`commitSha`, `templateId`, `templateVersion`). The build refuses to proceed unless the snapshot's provenance exactly matches the approved review record:

```text
record.sourceSnapshot.commitSha    === record.commitSha
record.sourceSnapshot.templateId   === record.templateId
record.sourceSnapshot.templateVersion === record.templateVersion
```

Mismatch → `SOURCE_PROVENANCE_MISMATCH` (HTTP 409).

`ONEVUE_SOURCE_SNAPSHOT_ROOT` has no default — **ingestion fails closed without it**.

### Stage 5 — `AUDIT`

**Module:** `backend/adaptation/template-audit.ts`

Deterministic audit with three outcomes: `PASS`, `REVIEW_REQUIRED`, `REJECT`.

- **License inspection** — SPDX recognition, root license file verification, restrictive copyleft detection (GPL/AGPL), declaration conflict checks.
- **Dependency audit** — flags `preinstall` / `install` / `postinstall` lifecycle scripts.
- **Security inspection** — bounded resource inspection and path-traversal checks, with explicit cleanup.

The auditor performs **zero code execution, zero package-manager invocation, and zero network requests**. It only reads files.

### Stage 6 — `BUILD_BOUNDARY`

**Module:** `backend/build-runtime/template-build-isolation.ts`

Validates that a genuine isolation runtime is configured and preflighted (daemon reachable, rootless, digest-pinned image, smoke container passing). If not, the pipeline stops here with `BUILD_BOUNDARY_UNAVAILABLE` / `BUILD_ISOLATION_UNAVAILABLE`.

**A child process is not an isolation boundary.** The build never falls back to running untrusted template code directly on the host.

### Stage 7 — `PROVISION`

**Module:** `backend/provisioning/template-provisioning.ts`

For private repositories, provisions access through the GitHub API using `GITHUB_PROVISIONING_TOKEN` (separate from the read token). Uses `backend/github-ingestion/github-api-client.ts` for the transport.

### Stage 8 — `ADAPT_BUILD_STORE`

**Modules:** `backend/adaptation/template-adaptation.ts` → `backend/adaptation/template-adapters/react-vite.ts` → `backend/build-runtime/template-build.ts` → `backend/artifact-storage/template-storage.ts`

The adaptation step rewrites a generic React/Vite template into the OneVue contract:

- Injects the `__ONEVUE_DTO__` placeholder into `index.html`.
- Adds the `src/onevue/runtime.js` shim (`@onevue-generated`) exposing `getOneVueProfile` and `DEFAULT_PROFILE`.
- Normalises the router.
- Generates a content map.
- Emits `MANUAL_CONTENT_WIRING_REQUIRED` — the adapter cannot infer which template sections map to which DTO fields, so a human must wire them.

Reported audit codes include `DTO_PLACEHOLDER_ADDED`, `ROUTER_NORMALIZED`, `CONTENT_MAP_GENERATED`, `MANUAL_CONTENT_WIRING_REQUIRED`.

The build then executes inside the isolation boundary (network-off, read-only rootfs, resource-capped, offline dependency cache) and the output is packaged and written to immutable storage with per-file SHA-256 digests.

### Stage 9 — `CATALOG`

**Module:** `backend/registry/template-registry-extension.ts`

Registers the built release in the central registry. The lifecycle status becomes `CATALOG_ELIGIBLE`. Only then does the release become visible to the public catalog and selectable by students.

---

## 2. Student selection

**Endpoint:** `PUT /api/student/website/config`
**Module:** `portfolio-visitor/student-selection/route.ts`

1. Rejects an empty template id or version (`TEMPLATE_ID_REQUIRED`, `VERSION_REQUIRED`).
2. Validates the selection against the central registry via `validateEligibleTemplateSelection(id, version, PUBLIC_PROFILE_SCHEMA_VERSION)`.
3. Resolves `latest` to a **concrete immutable version**.
4. Persists that concrete version on `UserWebsiteConfig`.

**Why pinning matters.** If `latest` stayed symbolic, a published portfolio would silently change content the moment a new release shipped. Persisting the resolved version means the release a student selected is the release they keep.

The admin frontend's template tab (`frontend/components/dashboard/student/StudentWebsitePage.jsx`, not extracted — shared student UI) consumes `GET /api/public/templates` to populate the catalogue.

---

## 3. Publishing

**Endpoint:** `POST /api/student/website/publish`
**Module:** `portfolio-visitor/publishing/publish/route.ts`

1. Loads the student's `UserWebsiteConfig` and `StudentProfile`.
2. **Validates the selected template and version against the central registry** — an unapproved or no-longer-compatible template blocks publication with HTTP 400.
3. Builds the immutable `PublicProfileDTO_v1` (`toPublicProfileDTO`).
4. Builds the immutable customization snapshot (accent colour, theme mode, visible sections) with explicit platform defaults — never the mutable draft config.
5. Computes a **deterministic SHA-256 checksum** over DTO + customization. The checksum function canonicalizes object keys recursively, so it is stable regardless of property insertion order.
6. Creates a new `PublishedProfileRevision` and atomically activates it, using a MongoDB transaction when the deployment supports replica-set sessions, with a non-transactional fallback otherwise.

**Rollback** (`POST /api/student/website/rollback`) verifies snapshot integrity and central registry approval for the target revision before reactivating it — a revision whose template has since been deapproved cannot be restored.

**Integrity verification** (`verifyPublishedRevisionIntegrity` in `public-profile-dto.ts`) supports both the current full-revision format (DTO + customization) and the legacy DTO-only format, so historical revisions remain verifiable and restorable.

---

## 4. Public DTO API

**Endpoint:** `GET /api/public/profile/:username`
**Module:** `backend/app/api/public/profile/[username]/route.ts` (shared — not extracted)

1. Resolves the active published revision.
2. **Verifies the stored checksum matches the snapshot data**; mismatch → HTTP 404 (integrity violation, not a soft error).
3. Returns only the approved public DTO and safe public metadata.
4. Never falls back to the mutable draft `config.customization` — historical revisions without a customization snapshot use `DEFAULT_WEBSITE_CUSTOMIZATION`.

---

## 5. Visitor rendering

**Route:** `portfolio/src/app/p/[username]/page.tsx` → `portfolio-visitor/rendering/app/p/[username]/page.tsx`

```text
getPublishedProfile(username)      # request-scoped, deduplicated via React cache()
        │
        ├─ not published / missing → notFound()
        │
        ▼
resolveVisitorEntrypoint(templateId, templateVersion)
        │  resolves the release, verifies against the central registry,
        │  enforces path-traversal containment, re-verifies the entrypoint
        │  SHA-256, and confirms the production entrypoint exists on disk
        │
        ├─ unresolved → throws (HTTP 500) — never falls back
        ▼
renderPublicTemplateHtml({ dto, website, entrypointHtml })
        │  injects the DTO into the __ONEVUE_DTO__ placeholder,
        │  escaping '<' as '\u003c' to prevent </script> breakout
        ▼
<iframe srcDoc={renderedHtml} />
```

**No fallback, ever.** If the published release cannot be resolved, the page throws rather than substituting another template, a hardcoded demo profile, or a legacy layout.

The route is composed of four boundaries:

| File | Role |
|---|---|
| `app/p/[username]/layout.tsx` | Resolves the published snapshot **before** the loading boundary flushes the response shell, so an unpublished profile commits HTTP 404 |
| `app/p/[username]/loading.tsx` | Loading shell |
| `app/p/error.tsx` | Sibling error boundary — a segment error boundary does **not** catch errors raised by its own segment's layout |
| `app/p/not-found.tsx` | Sibling not-found boundary — same reason, for `notFound()` raised by the layout |

The parent-segment (`/p`) siblings exist precisely because of that Next.js boundary-scoping rule.

---

## 6. Artifact delivery

**Endpoint:** `GET /api/public/template-artifact/*`
**Module:** `backend/api/public/template-artifact/[...path]/route.ts`

Serves versioned artifact files, verifying integrity before delivery. Sanitises artifact metadata so internal absolute filesystem paths (`/home/...`, `/tmp/...`, `C:\...`, `file://...`) are never exposed to the public catalog.

**Asset route:** `portfolio/src/app/templates/[...path]/route.ts` serves versioned static assets under `/templates/<templateId>/<version>/assets/`.

---

## 7. Public catalog

**Endpoint:** `GET /api/public/templates`
**Module:** `backend/api/public/templates/route.ts`

Read-only. Returns approved releases only — `experimental`, `deprecated`, and `rejected` are excluded. Sanitises repository credentials and strips local filesystem paths from artifact metadata. Makes zero database calls and has no runtime Git dependency.

---

## 8. Health

**Endpoint:** `GET /api/health`
**Module:** `backend/api/health/route.ts`

---

## 9. Failure and retry behaviour

- Every stage records its own outcome; a failure does not lose the stages already completed.
- **Retry reuses the same version** — a failed build does not create a new version.
- **Post-storage recovery without rebuild** — if storage succeeded but catalog registration failed, the stored version is recovered rather than rebuilt.
- `latest` resolution and persistence happen through the config route and survive restarts.
