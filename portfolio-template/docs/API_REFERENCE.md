# OneVue Portfolio Template Feature — API Reference

All routes are Next.js App Router route handlers. Responses are JSON unless noted.

**CORS** — the platform API reflects only `http://127.0.0.1:8080` and `http://localhost:8080`. Allowed methods: `GET, POST, PUT, DELETE, OPTIONS`. Allowed headers: `Content-Type, Authorization`. See `backend/lib/cors.ts` (shared).

**Authentication** — admin routes use `verifyAdminAuth`; student routes use `verifyAuth`. Both are Bearer-token based. The backend sets **no cookies** — there is no cookie-based session anywhere in the platform.

---

## Admin API

### `POST /api/admin/templates/submit`

Submit a GitHub repository URL and run the full ingestion workflow.

**Source:** `backend/api/admin/templates/submit/route.ts`

**Auth:** admin required (HTTP 403 for non-admin).

**Request**

```json
{ "repositoryUrl": "https://github.com/owner/repo" }
```

**Behaviour**

Runs the whole pipeline: validate → pin commit → duplicate check → snapshot → audit → build boundary → provision → adapt/build/store → catalog.

**Responses**

| Status | Code | Meaning |
|---|---|---|
| 200 | — | Submission accepted; body carries the submission record with per-stage status |
| 400 | `CONFIRMATION_REQUIRED` | Explicit confirmation absent where required |
| 400 | `TEMPLATE_NOT_APPROVED` | Target review record is not in `approved` state |
| 403 | — | Caller is not an administrator |
| 409 | `PROVISIONING_REQUIRED` | Private repository provisioning has not completed |
| 409 | `SOURCE_SNAPSHOT_REQUIRED` / `SOURCE_SNAPSHOT_INVALID` / `SOURCE_PROVENANCE_MISMATCH` | Snapshot missing, unverifiable, or provenance does not match the approved review |
| 409 | `ALREADY_CATALOG_ELIGIBLE` | Release is already registered |
| 503 | `BUILD_ISOLATION_UNAVAILABLE` | No verified isolation runtime — the boundary fails closed |

---

### `GET /api/admin/templates/submissions`

List recent submissions with their processing stages, or fetch one by id.

**Source:** `backend/api/admin/templates/submissions/route.ts`

**Query**

| Param | Type | Notes |
|---|---|---|
| `ingestionId` | string | Fetch a single submission. Optional. |
| `limit` | number | Page size. Default 25. |

**Response** — submission records, each with a `stages` array of `{ stage, status, detail, at }`. Stage names: `VALIDATE_REPOSITORY`, `PIN_COMMIT`, `DUPLICATE_CHECK`, `SOURCE_SNAPSHOT`, `AUDIT`, `BUILD_BOUNDARY`, `PROVISION`, `ADAPT_BUILD_STORE`, `CATALOG`. Status values: `succeeded`, `in_progress`, `failed`, `skipped`.

---

### `POST /api/admin/templates/ingest`

Ingest a repository directly (validate + pin + snapshot + audit).

**Source:** `backend/api/admin/templates/ingest/route.ts`

**Request** — `{ repositoryUrl }`

**Responses** — 200 on success; 400 for a malformed URL or a failed audit; 409 for snapshot/provenance failures.

---

### `POST /api/admin/templates/review`

Record an administrator review decision on an ingestion record.

**Source:** `backend/api/admin/templates/review/route.ts`

**Request**

```json
{
  "ingestionId": "...",
  "decision": "approved",
  "notes": "..."
}
```

**Responses** — 200 on success; 400 for an invalid decision; 404 if the ingestion record does not exist.

---

### `POST /api/admin/templates/provision`

Provision a private repository.

**Source:** `backend/api/admin/templates/provision/route.ts`

Requires `GITHUB_PROVISIONING_TOKEN` and `ENABLE_LIVE_GITHUB_PROVISIONING=true`.

**Responses** — 200 on success; 400/409 for an invalid repository state or a failed provisioning attempt.

---

### `GET /api/admin/templates/build`

Read-only isolation diagnostics. Reports only fail-closed state and validation messages — **no sensitive configuration values are returned**.

**Source:** `backend/api/admin/templates/build/route.ts`

**Response**

```json
{
  "success": true,
  "isolation": {
    "enabled": false,
    "configured": false,
    "executable": false,
    "reason": "...",
    "errors": [],
    "runtime": "podman",
    "runtimeVersion": "5.1.2",
    "rootless": true,
    "imageDigestVerified": true,
    "smokeTestPassed": true
  }
}
```

---

### `POST /api/admin/templates/build`

Build and store the artifact for an approved ingestion record.

**Source:** `backend/api/admin/templates/build/route.ts`

**Request**

```json
{ "ingestionId": "...", "explicitConfirmation": true }
```

**Preconditions** — the review record must be `approved`; provisioning status must be `provisioned`; a verified durable source snapshot must exist and match the approved provenance.

**Responses** — 201 on success; 400 `CONFIRMATION_REQUIRED` / `TEMPLATE_NOT_APPROVED`; 409 `PROVISIONING_REQUIRED` / `SOURCE_SNAPSHOT_REQUIRED` / `SOURCE_SNAPSHOT_INVALID` / `SOURCE_PROVENANCE_MISMATCH` / `ALREADY_CATALOG_ELIGIBLE`; 503 `BUILD_ISOLATION_UNAVAILABLE`.

---

## Public API

### `GET /api/public/templates`

Read-only catalog of approved template releases.

**Source:** `backend/api/public/templates/route.ts`

No auth. Zero database calls. No runtime Git dependency.

**Response**

```json
{
  "success": true,
  "templates": [
    {
      "id": "magicui-portfolio",
      "name": "Magic UI Developer Portfolio",
      "description": "...",
      "releases": [
        {
          "version": "1.0.0",
          "supportedDtoVersions": ["1.0.0"],
          "supportedSections": ["hero", "about", "education", "skills", "projects", "work", "hackathons", "credentials", "contact"],
          "customizationOptions": { "supportsAccentColor": true, "supportsThemeMode": true, "defaultAccentColor": "#3b82f6", "defaultThemeMode": "system", "allowedThemeModes": ["light", "dark", "system"] }
        }
      ]
    }
  ]
}
```

Only `approved` releases are returned. `experimental`, `deprecated`, and `rejected` are excluded. Repository credentials and local filesystem paths are sanitised out of artifact metadata.

---

### `GET /api/public/template-artifact/*`

Serve a versioned artifact file.

**Source:** `backend/api/public/template-artifact/[...path]/route.ts`

Integrity is verified before bytes are served. Path traversal outside the artifact root is rejected.

---

### `GET /api/health`

**Source:** `backend/api/health/route.ts`

---

## Student API

### `GET /api/student/website/config`

Read the student's website configuration, including the selected template and pinned version.

**Source:** `portfolio-visitor/student-selection/route.ts`

**Auth:** student required.

---

### `PUT /api/student/website/config`

Update the website configuration, including template selection.

**Source:** `portfolio-visitor/student-selection/route.ts`

**Request**

```json
{
  "username": "alice",
  "selectedTemplateId": "magicui-portfolio",
  "selectedTemplateVersion": "latest",
  "customization": {
    "accentColor": "#3b82f6",
    "themeMode": "system",
    "visibleSections": ["about", "education", "projects", "skills", "achievements", "contact"]
  }
}
```

**Validation order**

1. `selectedTemplateId` must be a non-empty string → else 400 `TEMPLATE_ID_REQUIRED`.
2. `selectedTemplateVersion` must be a non-empty string → else 400 `VERSION_REQUIRED`.
3. The (id, version) pair is validated against the central registry with `PUBLIC_PROFILE_SCHEMA_VERSION` → else 400 with the registry error code.
4. `latest` is resolved to a concrete version and **that version is persisted**.

**Switching templates** resets the version to `latest` (then re-resolves), because a version from the previous template is meaningless against the new one.

**Responses** — 200 on success; 400 `TEMPLATE_ID_REQUIRED` / `VERSION_REQUIRED` / registry validation failure; 401 unauthenticated; 404 when the profile does not exist.

---

### `POST /api/student/website/publish`

Publish the student's portfolio as an immutable revision.

**Source:** `portfolio-visitor/publishing/publish/route.ts`

**Auth:** student required.

**Behaviour**

Validates the selected template against the central registry (HTTP 400 on failure), builds the immutable DTO + customization snapshot, computes the deterministic SHA-256 checksum, and creates and atomically activates a new `PublishedProfileRevision`.

**Responses** — 200 on success; 400 publication validation failure; 401/404 as above.

---

### `POST /api/student/website/rollback`

Roll back to a previous published revision.

**Source:** `portfolio-visitor/publishing/rollback/route.ts`

**Request**

```json
{ "revisionNumber": 3 }
```

**Behaviour**

Verifies the target revision's snapshot integrity and that its template is still approved and compatible. A revision whose template has since been deapproved **cannot** be restored.

**Responses** — 200 on success; 400 `Rollback validation failed: Target template version is no longer approved or compatible`; 400 if the target snapshot is corrupted.

---

## Shared public API (not extracted)

### `GET /api/public/profile/:username`

**Source:** `backend/app/api/public/profile/[username]/route.ts` — shared platform endpoint, not part of this extraction.

Returns the approved public DTO for a published profile. Verifies the stored checksum against the snapshot; mismatch → HTTP 404. Never falls back to mutable draft configuration.

---

## Admin frontend service surface

**Source:** `admin-frontend/services/template-admin.js`

```js
window.OV.services.templateAdmin.submit(payload)   // POST /admin/templates/submit
window.OV.services.templateAdmin.list(limit = 25)  // GET  /admin/templates/submissions?limit=
window.OV.services.templateAdmin.get(ingestionId)  // GET  /admin/templates/submissions?ingestionId=
```

Base URL resolution: `window.OV_ADMIN_API_BASE` → `window.OV_ENV.API_BASE` → `window.OV_ENV.API_URL` → `http://localhost:3000/api`.

---

## Error code reference

| Code | HTTP | Source | Meaning |
|---|---|---|---|
| `TEMPLATE_ID_REQUIRED` | 400 | student selection | Empty template id |
| `VERSION_REQUIRED` | 400 | student selection | Empty template version |
| `TEMPLATE_NOT_APPROVED` | 400 | build / submit | Review record is not approved |
| `CONFIRMATION_REQUIRED` | 400 | build / submit | Explicit confirmation missing |
| `PROVISIONING_REQUIRED` | 409 | build / submit | Private repo provisioning incomplete |
| `SOURCE_SNAPSHOT_REQUIRED` | 409 | build | No durable source snapshot |
| `SOURCE_SNAPSHOT_INVALID` | 409 | build | Snapshot failed verification |
| `SOURCE_PROVENANCE_MISMATCH` | 409 | build | Snapshot provenance ≠ approved review |
| `ALREADY_CATALOG_ELIGIBLE` | 409 | build | Release already registered |
| `BUILD_ISOLATION_UNAVAILABLE` | 503 | build | No verified isolation runtime |
| `BUILD_BOUNDARY_UNAVAILABLE` | 503 | submit | Build boundary refused execution |
| `ISOLATION_STATUS_ERROR` | 500 | build (GET) | Could not read isolation status |
| `LIFECYCLE_FAILED` | 400 | build | Lifecycle orchestration failed |
| `LIFECYCLE_ERROR` | 500 | build | Lifecycle threw |

Registry-level codes (`TEMPLATE_ID_REQUIRED`, `VERSION_REQUIRED`, and the eligibility codes returned by `validateEligibleTemplateSelection`) are surfaced verbatim by the student selection, publish, and rollback routes.
