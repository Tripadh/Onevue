# OneVue — MongoDB Database Audit (Stage 1, read-only)

- **Audit date:** 2026-10-31
- **Cluster:** MongoDB Atlas (`mongodb+srv`), the cluster referenced by `backend/.env.local`
- **Method:** source inspection plus read-only driver calls (`listDatabases`, `listCollections`, `countDocuments`, `indexes`, `aggregate`/`find` with projections). No insert, update, delete, index or collection operation was issued. Personal data was masked in all output; no credential was printed.
- **Scope:** `backend/` (Next.js API + Mongoose), `backend/certificate-verification/` (native driver), `frontend/`, `portfolio/`, and the tracked `llm/` copy.

---

## 1. Executive summary

| # | Finding | Severity |
|---|---|---|
| F1 | The live `MONGODB_URI` has **no database path**. The driver silently falls back to its default database, which is named **`test`**. Every OneVue API route therefore reads and writes `test`. **`test` is the authoritative application database, not a scratch database.** | Critical |
| F2 | The `onevue` database is **not used by this codebase at all**. Its `auditlogs`, `domainregistries`, `rolepermissions` and its `users` documents belong to a separate admin/RBAC system whose source is not in this repository or any of its remote branches. | High |
| F3 | Eleven backend test suites connect to the **same live `MONGODB_URI`** and create, then delete, data in `test`. Incomplete cleanup has left 13 fixture users and 30 orphaned published revisions in the live database. | Critical |
| F4 | `onevue.users` and `test.users` share a collection name but have **different schemas, different documents, and no overlapping `_id` or email**. They are two different user stores, not duplicates. | High |
| F5 | The certificate-verification service uses `client.db()` (default database from its URI). Its `certificates` collection is in `test`, so it shares the application database and stores `userId` as a **string**, while every Mongoose collection uses `ObjectId`. | Medium |
| F6 | No environment separation exists: development, automated tests, the certificate service and (implicitly) production all point at one database. | Critical |
| F7 | Analytics has a TTL index, but `ANALYTICS_RETENTION_DAYS` is unset, so every event has `expiresAt: null` and nothing expires. | Low |
| F8 | `models/VisitingCard.ts` drops an index at import time (`userId_1` if unique). Any process that imports the model, including tests, can change live indexes. | Medium |
| F9 | `llm/backend/` is a tracked, diverged copy of `backend/` with older models (no domain profiles, no `StoredAsset`, no `AnalyticsEvent`). Running it against the cluster would write with stale schemas. | Medium |

Referential integrity of real user data in `test` is otherwise good: no orphaned profiles, configs, cards, assets, analytics events or certificates.

---

## 2. Connection architecture (as found)

| Component | File | How the database is chosen |
|---|---|---|
| Backend API | `backend/lib/db.ts:22-45` | `mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false })`. Cached on `global.mongooseCache`. No `dbName`, no validation of the database name. Fails only if the variable is empty. |
| Live config | `backend/.env.local` (git-ignored) | `mongodb+srv://…@<atlas-host>/` with **empty path, no query params** → default database `test`. |
| Example config | `backend/.env.example:3` | `mongodb://USER:PASSWORD@localhost:27017/onevue` — documents `onevue`, which is not what runs. |
| Certificate service | `backend/certificate-verification/src/db/mongo-certificate-repository.ts:411-441` | `new MongoClient(uri).db()` → default database from its own `MONGODB_URI`. Creates three unique indexes on startup (`ensureCertificateIndexes`, lines 382-404). Has a guard (`database-config.ts:19-25`) only for the *test* URI. |
| Backend tests | `backend/tests/*.test.js` (11 suites, see §7) | Read `MONGODB_URI` from `.env.local` and `mongoose.connect(uri)` directly → **live `test` database**. Five other suites correctly use `mongodb-memory-server`. |
| One-off scripts | `backend/check_tripadh.js`, `backend/scripts/integrity_and_migration.js` | Parse `.env.local` and connect to the live database. The latter created `test._archived_orphaned_studentprofiles`. |
| Frontend / portfolio | — | No database access. The four frontend matches for “mongo” are ObjectId-shape checks, not connection strings. |

Mongoose `autoIndex` is left at its default (on), so every model's declared indexes are created in whichever database the process connects to. This explains why `onevue.visitingcards` exists with the current model's indexes but zero documents: a process using the `VisitingCard` model connected to `onevue` once.

---

## 3. Database inventory (live counts, 2026-10-31)

### 3.1 `test` — authoritative OneVue application database (≈2.3 MB on disk)

| Collection | Docs | Owner (code) | Purpose | Created range |
|---|---:|---|---|---|
| `users` | 25 | `models/User.ts` | Accounts, credentials (bcrypt hash, `select:false`), identity, onboarding | 2026-10-16 → 10-29 |
| `studentprofiles` | 10 | `models/StudentProfile.ts` | Student identity profile | 10-16 → 10-28 |
| `professionalprofiles` | 4 | `models/ProfessionalProfile.ts` | Professional identity profile | 10-23 → 10-29 |
| `freelancerprofiles` | 2 | `models/FreelancerProfile.ts` | Freelancer identity profile | 10-23 → 10-27 |
| `creatorprofiles` | 4 | `models/CreatorProfile.ts` | Creator identity profile | 10-23 → 10-29 |
| `businessprofiles` | 3 | `models/BusinessProfile.ts` | Business identity profile | 10-23 → 10-29 |
| `userwebsiteconfigs` | 5 | `models/UserWebsiteConfig.ts` | Public username, template, customization, active revision pointer | 10-16 → 10-29 |
| `publishedprofilerevisions` | 59 | `models/PublishedProfileRevision.ts` | Immutable published PublicProfileDTO snapshots | 10-16 → 10-29 |
| `storedassets` | 11 | `models/StoredAsset.ts` | Metadata for files in object storage | 10-27 → 10-28 |
| `visitingcards` | 9 | `models/VisitingCard.ts` | Visiting card designs and published snapshots | 10-18 → 10-29 |
| `analyticsevents` | 47 | `models/AnalyticsEvent.ts` | Portfolio/card view and click events | occurred 10-27 → 10-29 |
| `certificates` | 5 | certificate-verification service (native driver) | Certificate verification records | no `createdAt`; `submittedAt` is a string |
| `_archived_orphaned_studentprofiles` | 0 | `scripts/integrity_and_migration.js` | Archive target of a past cleanup script | empty |

### 3.2 `onevue` — external admin/RBAC system (≈0.9 MB on disk)

| Collection | Docs | Owner (code) | Purpose | Created |
|---|---:|---|---|---|
| `users` | 2 | **not in this repo** | Admin-system accounts; has `role`/`status` fields | 2026-10-22 |
| `rolepermissions` | 3 | **not in this repo** | Roles `super_admin`, `admin`, `moderator` (system roles; 8/8/5 permissions) | 10-22 |
| `domainregistries` | 8 | **not in this repo** | Domain keys `domain.users`, `domain.visiting_card`, `domain.websites`, `domain.credentials`, `domain.storage`, `domain.security_rbac`, `domain.audit_logs`, `domain.platform_health` | 10-22 |
| `auditlogs` | 7 | **not in this repo** | `ADMIN_LOGIN_SUCCESS` ×5, `SYSTEM_ADMIN_INITIALIZED` ×1, `ADMIN_UNAUTHORIZED_ENTRY_ATTEMPT` ×1; all actors resolve to `onevue.users` | 10-22 |
| `visitingcards` | 0 | `models/VisitingCard.ts` (indexes only) | Empty; created by Mongoose auto-indexing | — |

Search performed: working tree, `origin/tripadh`, `origin/rampranai`, `origin/feature/domain-identity-profiles` — no model, route or string for `auditlog`, `domainregistr` or `rolepermission`. The admin system's source must be located before any decision about `onevue`.

---

## 4. Model-to-collection mapping

All Mongoose models rely on default pluralisation; none sets `collection:`. All connect through the single default connection in `lib/db.ts`.

| Model | File | Collection | DB actually used | Route/lib files using it |
|---|---|---|---|---:|
| `User` | `models/User.ts:98-152` | `users` | `test` | 14 |
| `StudentProfile` | `models/StudentProfile.ts:1159` | `studentprofiles` | `test` | 7 |
| `ProfessionalProfile` | `models/ProfessionalProfile.ts:131` | `professionalprofiles` | `test` | 3 |
| `FreelancerProfile` | `models/FreelancerProfile.ts:151` | `freelancerprofiles` | `test` | 3 |
| `CreatorProfile` | `models/CreatorProfile.ts:163` | `creatorprofiles` | `test` | 3 |
| `BusinessProfile` | `models/BusinessProfile.ts:217` | `businessprofiles` | `test` | 3 |
| `UserWebsiteConfig` | `models/UserWebsiteConfig.ts:60-133` | `userwebsiteconfigs` | `test` | 7 |
| `PublishedProfileRevision` | `models/PublishedProfileRevision.ts:30-141` | `publishedprofilerevisions` | `test` | 8 |
| `StoredAsset` | `models/StoredAsset.ts:21-97` | `storedassets` | `test` | 2 |
| `VisitingCard` | `models/VisitingCard.ts:306-382` | `visitingcards` | `test` | 8 |
| `AnalyticsEvent` | `models/AnalyticsEvent.ts:4-47` | `analyticsevents` | `test` | 2 |
| *(native driver)* | `certificate-verification/src/db/mongo-certificate-repository.ts` | `certificates` | `test` (via its URI) | service-internal |

28 backend route/lib files call `connectToDatabase()`.

Collections with **no owner in this codebase**: `onevue.users`, `onevue.rolepermissions`, `onevue.domainregistries`, `onevue.auditlogs`. Unused by any running code: `onevue.visitingcards` (empty), `test._archived_orphaned_studentprofiles` (empty).

---

## 5. Relationships and reference integrity (`test`)

```
users._id ─┬─< studentprofiles.userId            (unique, 1:1)
           ├─< professionalprofiles.userId       (unique, 1:1)
           ├─< freelancerprofiles.userId         (unique, 1:1)
           ├─< creatorprofiles.userId            (unique, 1:1)
           ├─< businessprofiles.userId           (unique, 1:1)
           ├─< userwebsiteconfigs.userId         (unique, 1:1)
           │        └── activeRevisionId ──> publishedprofilerevisions._id
           ├─< publishedprofilerevisions.userId  (+ websiteConfigId ──> userwebsiteconfigs._id)
           │        └── publicAssetIds[] ──> storedassets.assetId
           ├─< storedassets.ownerId
           ├─< visitingcards.userId              (1:N, one isDefault per user)
           ├─< analyticsevents.ownerId           (+ resourceId ──> userwebsiteconfigs._id | visitingcards._id)
           └─< certificates.userId               (STRING copy of ObjectId)
```

| Check | Result |
|---|---|
| Profiles whose `userId` has no user (all five collections) | 0 |
| Profiles whose owner's `identity` differs from the profile type | 0 |
| Users with more than one identity profile | 0 |
| Users with no identity profile | 2 (both `professional`; 1 real, 1 fixture) |
| Website configs with missing owner | 0 |
| `activeRevisionId` pointing to a missing revision | 0 |
| `activeRevisionId` pointing to another user's revision | 0 |
| Revisions whose `websiteConfigId` belongs to a different user | 0 |
| **Revisions whose user and website config no longer exist** | **30 of 59** (see §7) |
| Revision snapshot schema versions | `1.0.0` × 59 |
| Revision `publicAssetIds` references | 21; 0 missing, 0 foreign-owned, 0 private |
| Stored assets with missing owner | 0 (all 11 `public-eligible`, `portfolio-image`, `verified`) |
| Visiting cards with missing owner | 0; no user has more than one default card |
| Analytics events with missing owner or resource | 0 (all `portfolio`) |
| Certificates with missing owner | 0 (matched by string) |
| Duplicate emails inside `test.users` | 0 |

---

## 6. Duplicate collection analysis

Comparison was by `_id`, by case-insensitive email, by field shape and by indexes. Email equality was never treated as identity.

### 6.1 `users`

| Aspect | `test.users` | `onevue.users` |
|---|---|---|
| Documents | 25 | 2 |
| Schema | Matches `models/User.ts` (`email`, `password`, `name`, `identity`, `bio`, `location`, `profilePhotoKey`, `profilePhotoUpdatedAt`, `onboarding`, timestamps) | Same base fields **plus `role` and `status`**, not declared by `models/User.ts` |
| Indexes | `email_1` (unique), `username_1` (sparse) | `email_1` (unique), `username_1` (sparse), **`role_1`, `status_1`** |
| `_id` overlap | — | **0 of 2** |
| Email overlap | — | **0 of 2** |
| Notable | `username` is never a string here (8 null, 17 absent); public usernames live in `userwebsiteconfigs` | One document is the `super_admin` (identity `business`); the other is a `freelancer` with no role |

**Conclusion:** different systems, disjoint data. Merging is neither needed nor safe. The OneVue application has never read `onevue.users`.

### 6.2 `visitingcards`

| Aspect | `test.visitingcards` | `onevue.visitingcards` |
|---|---|---|
| Documents | 9 | 0 |
| Indexes | `userId_1`, `username_1`, `isDefault_1`, `publicationStatus_1`, `userId_1_updatedAt_-1` | identical set |

**Conclusion:** `onevue.visitingcards` is an empty artefact of Mongoose auto-indexing. Nothing to migrate.

### 6.3 Other names

No other collection name exists in both databases. `test._archived_orphaned_studentprofiles` is empty.

---

## 7. Test and fixture residue in the live database

Suites that connect to the live URI (instead of `mongodb-memory-server`) and their `afterAll` cleanup coverage:

| Suite | Deletes users | configs | revisions | events | assets | cards |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `analytics.test.js` | ✓ | ✓ | **✗** | ✓ | ✗ | ✓ |
| `api_route.test.js` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `asset_access.test.js` | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |
| `domain_identity_profiles.test.js` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `identity_website_matrix.test.js` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `identity_workspace.test.js` | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ |
| `portfolio_integration.test.js` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `profile_feature.test.js` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `publishing_workflow.test.js` | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| `student_identity.test.js` | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| `visiting_card_feature.test.js` | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |

(“✗” means no delete call for that model in the file; some suites never create that data.)

Residue observed:

- **30 orphaned revisions** (created 2026-10-23, 10-26, 10-29), snapshot usernames matching `analytics_#` / `an#` — produced by `analytics.test.js`, which deletes users and configs but not revisions.
- **13 fixture users** (`@example.com`), none from the current test suites' `RUN` patterns: `ov-audit-{professional,freelancer,creator,business}-…`, `verify.{student,professional,freelancer,creator,business}.#`, `certcheck#` ×2, `ui-cert-#`, `domain-check-#`. These came from ad-hoc verification scripts. They own 12 profiles, 1 website config, 4 revisions, 2 assets, 4 analytics events and 4 certificates.
- **Real data** (12 non-fixture users: 6 student, 3 professional, 2 creator, 1 business) owns 13 profiles, 4 website configs, 25 revisions, 9 cards, 9 assets, 43 events and 1 certificate.

Classification above uses the `example.com` domain, which the codebase uses only for fixtures. It must be confirmed by the team before any removal.

---

## 8. Index analysis

| Collection | Live indexes | Declared by code | Assessment |
|---|---|---|---|
| `test.users` | `email_1` U, `username_1` sparse | `email` unique | `username_1` is legacy (model no longer indexes `username`). Non-unique and sparse, so harmless. **Keep** until proven unused by every reader, including the admin system. |
| `test.*profiles` (5) | `userId_1` U | `userIdField` / `StudentProfile.userId` unique | Correct. Enforces one profile per user per identity. |
| `test.userwebsiteconfigs` | `userId_1` U, `username_1` U | same | Correct. `username_1` is the authoritative public-username uniqueness constraint. |
| `test.publishedprofilerevisions` | `userId_1`, `websiteConfigId_1`, `publishedAt_1`, `userId_1_revisionNumber_-1` U | same | Correct. `userId_1` is a prefix of the compound index and is redundant, but harmless; not worth dropping. |
| `test.storedassets` | `assetId_1` U, `ownerId_1`, `ownerId_1_purpose_1_createdAt_-1`, `ownerId_1_idempotencyKey_1` U partial | same | Correct. `ownerId_1` is redundant with the compound prefix; harmless. |
| `test.visitingcards` | `userId_1`, `username_1`, `isDefault_1`, `publicationStatus_1`, `userId_1_updatedAt_-1` | same | Legacy unique `userId_1` already replaced. One-default-per-user is enforced in application code only, not by an index. |
| `test.analyticsevents` | `eventId_1` U, four compound query indexes, `expiresAt_1` TTL 0 | same | Correct, but TTL is inert because `expiresAt` is always null (F7). |
| `test.certificates` | `certificates_id_key` U, `certificates_user_id_url_key` U, `certificates_user_credential_key` U partial | `ensureCertificateIndexes` | Correct. |
| `onevue.*` | see §3.2 | external system | Leave untouched. |

No validators (`$jsonSchema`) or capped/time-series collections exist; `listCollections` returned no options for any collection. All schema enforcement is in Mongoose.

---

## 9. Security observations

- `.env.local` and `.env*` are git-ignored at root and in `backend/`; only `.env.example` files are tracked.
- Git history: the initial commit `f6c0936` contained a `mongodb+srv` URI in `backend/.env.example` with **placeholder credentials** and an Atlas host **different from the live cluster**. It was replaced in `a6f10d2`. No live credential is in history.
- No code logs the connection string. Frontend and portfolio have no database access.
- Passwords are stored as hashes with `select: false`.
- Tests, scripts and the running app all share one credential and one database, so a test run has full write access to live user data (F3, F6).
- The certificate service, by design, can run against the same database as the app if given the same URI (F5).

---

## 10. Risks

| Risk | Impact | Likelihood |
|---|---|---|
| A test or script deletes or corrupts real user data (`deleteMany` filters are scoped to fixture ids today, but any bug lands on live data) | Data loss | Medium |
| Someone "cleans up" `test` because of its name | Total data loss | Medium |
| Correcting `.env.local` to `/onevue` without migrating data | App appears empty; users "lose" accounts; new writes collide with the admin system's `users` collection | High if done naively |
| Admin system and OneVue both writing a `users` collection in the same database | Schema conflicts, unique email collisions, privilege confusion | High if merged |
| Orphaned revisions and fixture accounts in live data | Skewed analytics/counts; fixture accounts are valid logins | Low–Medium |
| `VisitingCard.ts` import-time `dropIndex` | Unexpected index change in any connected environment | Low |
| Stale `llm/backend` models run against the cluster | Writes with outdated schema | Low |
| No retention on analytics | Unbounded growth | Low today |

---

## 11. Authoritative sources

| Data | Authoritative location | Notes |
|---|---|---|
| OneVue users and all application collections | **`test`** | Only database the app has ever used |
| Certificates | **`test.certificates`** | Written by the certificate service |
| Admin/RBAC users, roles, domains, audit logs | **`onevue`** | Owned by an external admin system; not part of the OneVue app migration |
| `onevue.visitingcards`, `test._archived_orphaned_studentprofiles` | none | Empty |

---

## 12. Migration recommendations (for approval — nothing executed)

1. **Target layout:** `onevue_dev`, `onevue_test`, `onevue_prod`. Database name supplied explicitly (`MONGODB_DB_NAME` or URI path) and validated at startup; production refuses non-`_prod` names and vice-versa.
2. **Copy, do not move:** copy every application collection from `test` into the target database with identical `_id`s, field values, timestamps and indexes (indexes recreated from the live definitions in §8, then verified against the Mongoose declarations). Source `test` stays intact for rollback.
3. **Exclude residue only after sign-off:** the 30 orphaned revisions and 13 `example.com` fixture users (with their 12 profiles, 1 config, 4 revisions, 2 assets, 4 events, 4 certificates) should be excluded from `onevue_prod` but preserved in `test` and in the backup. The default migration copies everything; exclusion is an explicit flag.
4. **Do not touch `onevue`:** the admin system's data stays where it is until its owner and source are identified. Its `users` must not be merged with OneVue `users` (no `_id` or email overlap, different schema). If the admin system should live with the app, it needs its own collection names (for example `adminusers`) decided by its owner.
5. **Isolate tests:** move the eleven live-DB suites to `mongodb-memory-server` (the pattern already used by five suites) or to a guarded `onevue_test` URI that must contain `_test`. Fix `analytics.test.js` revision cleanup.
6. **Certificate service:** give it an explicit database (same `onevue_<env>` database, `certificates` collection) and keep `userId` as a string for now; changing its type is an API change for that service.
7. **Idempotency and verification:** migration keyed by `_id` with insert-if-absent; conflicting `_id`s with different content are reported, never overwritten. Verification checks counts, index sets, and every reference listed in §5.
8. **Backups first:** an Atlas snapshot (or `mongodump` of `test` and `onevue`) must exist and be verified before any execution step.

### Decisions needed before Stage 3

- Who owns the `onevue` admin/RBAC data, and where is its source?
- Confirm the 13 `example.com` accounts and the 30 orphaned revisions are test residue that should not be carried into production.
- Is the current cluster serving real end users (making `test` the production database), or is it the shared development cluster?
- Will dev/test/prod be separate Atlas projects/clusters or separate databases on one cluster?
