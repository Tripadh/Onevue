# OneVue Portfolio Template Feature — Manifest

Every file listed here is a **byte-identical copy** of its source in the OneVue monorepo.
Originals were **not** moved, renamed, or modified. Verification method: `cmp` (byte comparison).

- **Source:** `~/Desktop/Onevue` @ `03cc12ef` (branch `portfolio-templates`)
- **Destination:** `~/Desktop/Onevue/portfolio-template`
- **Generated:** 2026-10-31

---

## Index

| # | Section | Files |
|---|---------|-------|
| 1 | [backend/github-ingestion](#1-backendgithub-ingestion) | 2 |
| 2 | [backend/adaptation](#2-backendadaptation) | 3 |
| 3 | [backend/build-runtime](#3-backendbuild-runtime) | 4 |
| 4 | [backend/artifact-storage](#4-backendartifact-storage) | 4 |
| 5 | [backend/registry](#5-backendregistry) | 3 |
| 6 | [backend/lifecycle](#6-backendlifecycle) | 3 |
| 7 | [backend/provisioning](#7-backendprovisioning) | 1 |
| 8 | [backend/api](#8-backendapi) | 9 |
| 9 | [backend/models](#9-backendmodels) | 1 |
| 10 | [backend/tests](#10-backendtests) | 31 |
| 11 | [backend (docs)](#11-backend-docs) | 2 |
| 12 | [admin-frontend](#12-admin-frontend) | 2 |
| 13 | [portfolio-visitor/student-selection](#13-portfolio-visitorstudent-selection) | 1 |
| 14 | [portfolio-visitor/publishing](#14-portfolio-visitorpublishing) | 2 |
| 15 | [portfolio-visitor/rendering](#15-portfolio-visitorrendering) | 8 |
| 16 | [portfolio-visitor/artifact-delivery](#16-portfolio-visitorartifact-delivery) | 4 |
| 17 | [portfolio-visitor/tests](#17-portfolio-visitortests) | 4 |
| 18 | [docs/](#18-docs) | 5 |

**Total copied files: 91** (83 source copies + 8 new documents)

---

## 1. backend/github-ingestion

| Original | Destination |
|----------|-------------|
| `backend/lib/github-api-client.ts` | `backend/github-ingestion/github-api-client.ts` |
| `backend/lib/github-ingestion.ts` | `backend/github-ingestion/github-ingestion.ts` |

## 2. backend/adaptation

| Original | Destination |
|----------|-------------|
| `backend/lib/template-audit.ts` | `backend/adaptation/template-audit.ts` |
| `backend/lib/template-adaptation.ts` | `backend/adaptation/template-adaptation.ts` |
| `backend/lib/template-adapters/react-vite.ts` | `backend/adaptation/template-adapters/react-vite.ts` |

## 3. backend/build-runtime

| Original | Destination |
|----------|-------------|
| `backend/lib/template-build-isolation.ts` | `backend/build-runtime/template-build-isolation.ts` |
| `backend/lib/template-build-runtime.ts` | `backend/build-runtime/template-build-runtime.ts` |
| `backend/lib/template-build.ts` | `backend/build-runtime/template-build.ts` |
| `backend/BUILD_RUNTIME_ISOLATION.md` | `backend/build-runtime/BUILD_RUNTIME_ISOLATION.md` |

## 4. backend/artifact-storage

| Original | Destination |
|----------|-------------|
| `backend/lib/template-storage.ts` | `backend/artifact-storage/template-storage.ts` |
| `backend/lib/template-artifact-delivery.ts` | `backend/artifact-storage/template-artifact-delivery.ts` |
| `backend/lib/template-local-delivery.ts` | `backend/artifact-storage/template-local-delivery.ts` |
| `backend/lib/template-snapshot.ts` | `backend/artifact-storage/template-snapshot.ts` |

## 5. backend/registry

| Original | Destination |
|----------|-------------|
| `backend/lib/template-registry.js` | `backend/registry/template-registry.js` |
| `backend/lib/template-registry.ts` | `backend/registry/template-registry.ts` |
| `backend/lib/template-registry-extension.ts` | `backend/registry/template-registry-extension.ts` |

## 6. backend/lifecycle

| Original | Destination |
|----------|-------------|
| `backend/lib/template-lifecycle.ts` | `backend/lifecycle/template-lifecycle.ts` |
| `backend/lib/template-reconciliation.ts` | `backend/lifecycle/template-reconciliation.ts` |
| `backend/lib/template-submission.ts` | `backend/lifecycle/template-submission.ts` |

## 7. backend/provisioning

| Original | Destination |
|----------|-------------|
| `backend/lib/template-provisioning.ts` | `backend/provisioning/template-provisioning.ts` |

## 8. backend/api

| Original | Destination |
|----------|-------------|
| `backend/app/api/admin/templates/build/route.ts` | `backend/api/admin/templates/build/route.ts` |
| `backend/app/api/admin/templates/ingest/route.ts` | `backend/api/admin/templates/ingest/route.ts` |
| `backend/app/api/admin/templates/provision/route.ts` | `backend/api/admin/templates/provision/route.ts` |
| `backend/app/api/admin/templates/review/route.ts` | `backend/api/admin/templates/review/route.ts` |
| `backend/app/api/admin/templates/submissions/route.ts` | `backend/api/admin/templates/submissions/route.ts` |
| `backend/app/api/admin/templates/submit/route.ts` | `backend/api/admin/templates/submit/route.ts` |
| `backend/app/api/public/templates/route.ts` | `backend/api/public/templates/route.ts` |
| `backend/app/api/public/template-artifact/[...path]/route.ts` | `backend/api/public/template-artifact/[...path]/route.ts` |
| `backend/app/api/health/route.ts` | `backend/api/health/route.ts` |

## 9. backend/models

| Original | Destination |
|----------|-------------|
| `backend/models/TemplateIngestionReview.ts` | `backend/models/TemplateIngestionReview.ts` |

## 10. backend/tests

| Original | Destination |
|----------|-------------|
| `backend/tests/admin_auth.test.js` | `backend/tests/admin_auth.test.js` |
| `backend/tests/admin_template_provisioning.test.js` | `backend/tests/admin_template_provisioning.test.js` |
| `backend/tests/admin_template_review.test.js` | `backend/tests/admin_template_review.test.js` |
| `backend/tests/build_runtime_adapter.test.js` | `backend/tests/build_runtime_adapter.test.js` |
| `backend/tests/build_runtime_offline_real.test.js` | `backend/tests/build_runtime_offline_real.test.js` |
| `backend/tests/build_runtime_real.test.js` | `backend/tests/build_runtime_real.test.js` |
| `backend/tests/dynamic_template_registry.test.js` | `backend/tests/dynamic_template_registry.test.js` |
| `backend/tests/github_ingestion.test.js` | `backend/tests/github_ingestion.test.js` |
| `backend/tests/github_live_smoke.test.js` | `backend/tests/github_live_smoke.test.js` |
| `backend/tests/live_pipeline.integration.test.js` | `backend/tests/live_pipeline.integration.test.js` |
| `backend/tests/mongo_persistence.integration.test.js` | `backend/tests/mongo_persistence.integration.test.js` |
| `backend/tests/phase3_1_snapshot_integrity.test.js` | `backend/tests/phase3_1_snapshot_integrity.test.js` |
| `backend/tests/phase3_2_integrity_verification.test.js` | `backend/tests/phase3_2_integrity_verification.test.js` |
| `backend/tests/phase5_12_dynamic_delivery.test.js` | `backend/tests/phase5_12_dynamic_delivery.test.js` |
| `backend/tests/public_template_catalog.test.js` | `backend/tests/public_template_catalog.test.js` |
| `backend/tests/template_adaptation.test.js` | `backend/tests/template_adaptation.test.js` |
| `backend/tests/template_adaptation_react_vite.test.js` | `backend/tests/template_adaptation_react_vite.test.js` |
| `backend/tests/template_artifact_delivery.test.js` | `backend/tests/template_artifact_delivery.test.js` |
| `backend/tests/template_audit.test.js` | `backend/tests/template_audit.test.js` |
| `backend/tests/template_build.test.js` | `backend/tests/template_build.test.js` |
| `backend/tests/template_build_isolation.test.js` | `backend/tests/template_build_isolation.test.js` |
| `backend/tests/template_lifecycle.test.js` | `backend/tests/template_lifecycle.test.js` |
| `backend/tests/template_local_delivery.test.js` | `backend/tests/template_local_delivery.test.js` |
| `backend/tests/template_provisioning.test.js` | `backend/tests/template_provisioning.test.js` |
| `backend/tests/template_reconciliation.test.js` | `backend/tests/template_reconciliation.test.js` |
| `backend/tests/template_registry.test.js` | `backend/tests/template_registry.test.js` |
| `backend/tests/template_registry_enforcement.test.js` | `backend/tests/template_registry_enforcement.test.js` |
| `backend/tests/template_snapshot.test.js` | `backend/tests/template_snapshot.test.js` |
| `backend/tests/template_storage.live.test.js` | `backend/tests/template_storage.live.test.js` |
| `backend/tests/template_storage.test.js` | `backend/tests/template_storage.test.js` |
| `backend/tests/template_submission_workflow.test.js` | `backend/tests/template_submission_workflow.test.js` |

## 11. backend (docs)

| Original | Destination |
|----------|-------------|
| `backend/LOCAL_ENVIRONMENT_READINESS.md` | `backend/LOCAL_ENVIRONMENT_READINESS.md` |
| `backend/TEMPLATE_PIPELINE_PRODUCTION_READINESS.md` | `backend/TEMPLATE_PIPELINE_PRODUCTION_READINESS.md` |

## 12. admin-frontend

| Original | Destination |
|----------|-------------|
| `frontend/components/dashboard/admin/TemplateSubmissionPage.jsx` | `admin-frontend/components/TemplateSubmissionPage.jsx` |
| `frontend/services/template-admin.js` | `admin-frontend/services/template-admin.js` |

## 13. portfolio-visitor/student-selection

| Original | Destination |
|----------|-------------|
| `backend/app/api/student/website/config/route.ts` | `portfolio-visitor/student-selection/route.ts` |

## 14. portfolio-visitor/publishing

| Original | Destination |
|----------|-------------|
| `backend/app/api/student/website/publish/route.ts` | `portfolio-visitor/publishing/publish/route.ts` |
| `backend/app/api/student/website/rollback/route.ts` | `portfolio-visitor/publishing/rollback/route.ts` |

## 15. portfolio-visitor/rendering

| Original | Destination |
|----------|-------------|
| `portfolio/src/app/p/[username]/page.tsx` | `portfolio-visitor/rendering/app/p/[username]/page.tsx` |
| `portfolio/src/app/p/[username]/layout.tsx` | `portfolio-visitor/rendering/app/p/[username]/layout.tsx` |
| `portfolio/src/app/p/[username]/loading.tsx` | `portfolio-visitor/rendering/app/p/[username]/loading.tsx` |
| `portfolio/src/app/p/error.tsx` | `portfolio-visitor/rendering/app/p/error.tsx` |
| `portfolio/src/app/p/not-found.tsx` | `portfolio-visitor/rendering/app/p/not-found.tsx` |
| `portfolio/src/lib/template-renderer.js` | `portfolio-visitor/rendering/lib/template-renderer.js` |
| `portfolio/src/lib/template-renderer.ts` | `portfolio-visitor/rendering/lib/template-renderer.ts` |
| `portfolio/src/lib/template-manifest.ts` | `portfolio-visitor/rendering/lib/template-manifest.ts` |

## 16. portfolio-visitor/artifact-delivery

| Original | Destination |
|----------|-------------|
| `portfolio/src/lib/template-artifact-store.ts` | `portfolio-visitor/artifact-delivery/lib/template-artifact-store.ts` |
| `portfolio/src/lib/template-visitor-release.ts` | `portfolio-visitor/artifact-delivery/lib/template-visitor-release.ts` |
| `portfolio/src/lib/onevue-profile-route.ts` | `portfolio-visitor/artifact-delivery/lib/onevue-profile-route.ts` |
| `portfolio/src/app/templates/[...path]/route.ts` | `portfolio-visitor/artifact-delivery/app/templates/[...path]/route.ts` |

## 17. portfolio-visitor/tests

| Original | Destination |
|----------|-------------|
| `portfolio/tests/dynamic_template_delivery.test.js` | `portfolio-visitor/tests/dynamic_template_delivery.test.js` |
| `portfolio/tests/local_template_serving.test.js` | `portfolio-visitor/tests/local_template_serving.test.js` |
| `portfolio/tests/template_artifact_storage_delivery.test.js` | `portfolio-visitor/tests/template_artifact_storage_delivery.test.js` |
| `portfolio/tests/p2_portfolio_template.test.js` | `portfolio-visitor/tests/p2_portfolio_template.test.js` |

## 18. docs/

| Path | Notes |
|------|-------|
| `docs/ARCHITECTURE.md` | New — end-to-end flow, layer map, isolation model, shared dependencies |
| `docs/FEATURE_WORKFLOW.md` | New — stage-by-stage pipeline and visitor rendering |
| `docs/API_REFERENCE.md` | New — every endpoint, request/response, error codes |
| `docs/DEVELOPMENT_SETUP.md` | New — how to work with this workspace, prerequisites |
| `docs/IMPLEMENTATION_STATUS.md` | New — component status, blockers, next steps |

---

## Excluded by instruction

| Path | Reason |
|------|--------|
| `backend/.env.example`, `backend/.env.local`, `portfolio/.env`, `frontend/.env.example` | Environment / secret files |
| `template-sources/react-portfolio/` (8.8 MB) | Sample template source tree — `template-sources/` intentionally left empty |
| `backend/template-builds/` | Build output directory |
| `portfolio/public/templates/` | Generated artifact output |
| `backend/.next/`, `portfolio/.next/` | Build caches |
| `backend.zip` | Archive |
| `Documetation/` | Not modified (and not copied) |
| `OneVue Project/`, `.agent/`, `.agents/`, `.gemini/`, `.gsd/` | Tooling / agent directories |
| `scripts/`, `adapters/` | Unrelated working-tree additions |

## Not extracted (shared platform code)

Referenced by the extracted code, deliberately **not duplicated**:

`backend/lib/auth.ts`, `backend/lib/db.ts`, `backend/lib/cors.ts`, `backend/lib/jwt.js`, `backend/lib/public-profile-dto.ts`, `backend/models/User.ts`, `backend/models/StudentProfile.ts`, `backend/models/UserWebsiteConfig.ts`, `backend/models/PublishedProfileRevision.ts`, `portfolio/src/lib/onevue-api.ts`, `portfolio/src/lib/onevue-profile-adapter.ts`

Admin UI shell (mounts the extracted admin page): `frontend/components/core/app.jsx`, `frontend/index.html`

Shared public endpoint: `backend/app/api/public/profile/[username]/route.ts`

See [`docs/ARCHITECTURE.md` §8](docs/ARCHITECTURE.md#8-shared-dependencies).
