# OneVue Authentication Hardening Verification and Phase 2 Plan

**Assessment date:** 2026-10-31  
**Mode:** Read-only verification and architecture planning  
**Scope:** `backend/`, `llm/backend/`, frontend authentication services, JWT usage, authorization boundaries, and session architecture.

No source code, configuration, schema, database, environment variable, account, or production resource was modified. No production request or destructive test was performed.

## Executive summary

Phase 1 is **PASS with residual hardening gaps**.

The critical `fallback_secret` route-level bypass has been removed from both backend copies. Production signing and verification now route through shared utilities, restrict verification to HS256, add issuer/audience claims, and fail closed when the JWT secret is absent or equals the rejected placeholder. Both backend TypeScript checks and the focused JWT regression suite were previously reported as passing; the source was independently inspected here.

Phase 1 does not make the authentication system production-ready. Confirmed remaining weaknesses are:

1. **HIGH — Unrevocable bearer sessions:** seven-day access tokens survive logout, password changes, suspension, and deletion because no server-side session or revocation mechanism exists.
2. **MEDIUM — LocalStorage token exposure:** frontend tokens are persisted in localStorage, making them readable by JavaScript running in the origin.
3. **MEDIUM hardening gap — Weak secret acceptance:** any non-empty secret other than the literal `fallback_secret` is accepted; minimum length and entropy are not enforced.
4. **MEDIUM hardening gap — Environment-dependent claim validation:** issuer and audience are enforced only when `NODE_ENV === "production"`.
5. **LOW hardening gap — Verification override:** `verifyJwtToken(token, secret?)` permits a caller-provided secret, weakening the single-invariant design even though no current external bypass was found.

The Phase 2 recommendation is to add a common session service and MongoDB-backed rotating refresh-token sessions before shortening access-token lifetimes. Google OAuth should authenticate the provider account only, then call that same session service; Google tokens must never become OneVue API tokens.

## Phase 1 verification results

| Claim | Result | Evidence |
|---|---|---|
| Route-level fallback signing/verifying removed | **PASS** | No `process.env.JWT_SECRET || ...` or direct `jwt.sign`/`jwt.verify` remains in backend application routes |
| Centralized signing/verifying | **PASS** | `backend/lib/auth.ts:47-68,71-94`; `llm/backend/lib/auth.ts:30-47,50-70` |
| HS256 allowlist | **PASS** | `backend/lib/auth.ts:85-88`; `llm/backend/lib/auth.ts:64-66` |
| Issuer/audience on issued tokens | **PASS** | `backend/lib/auth.ts:60-68`; `llm/backend/lib/auth.ts:37-47` |
| Production issuer/audience validation | **PASS** | `backend/lib/auth.ts:87-90`; `llm/backend/lib/auth.ts:66-69` |
| Fail-closed secret resolution | **PASS, with weak-secret gap** | `backend/lib/auth.ts:38-44`; `llm/backend/lib/auth.ts:21-27` |
| Production startup validation | **PASS** | `backend/instrumentation.ts:1-7`; `llm/backend/instrumentation.ts:1-7` |
| Focused JWT regression tests | **PASS per recorded Phase 1 evidence** | `backend/tests/jwt_secret.test.js` |
| TypeScript checks/build | **PASS per recorded Phase 1 evidence** | `backend` and `llm/backend` checks; `backend` production build |
| Full lint | **PARTIAL** | Existing repository-wide lint violations remain; this is not a Phase 1 JWT failure |

The previous `docs/AUTH_SECURITY_AUDIT.md` statements describing direct route-level fallback verification are historical findings. They should not be read as current implementation evidence after Phase 1.

## Repository-wide JWT occurrence inventory

### Production implementation

| Location | Operation | Assessment |
|---|---|---|
| `backend/lib/auth.ts:1-2` | `jsonwebtoken` import | Legitimate centralized implementation |
| `backend/lib/auth.ts:47-68` | JWT signing | Uses resolved secret, HS256, issuer, audience |
| `backend/lib/auth.ts:71-94` | JWT verification | HS256 allowlist; issuer/audience in production |
| `backend/lib/auth.ts:105-137` | Shared request authentication | Secret resolution, token verification, database subject lookup |
| `backend/instrumentation.ts:1-7` | Startup validation | Production-only `validateJwtConfiguration()` |
| `llm/backend/lib/auth.ts:1-2` | `jsonwebtoken` import | Mirrored centralized implementation |
| `llm/backend/lib/auth.ts:30-47` | JWT signing | Uses resolved secret, HS256, issuer, audience |
| `llm/backend/lib/auth.ts:50-70` | JWT verification | HS256 allowlist; issuer/audience in production |
| `llm/backend/lib/auth.ts:82-107` | Shared request authentication | Secret resolution, token verification, database subject lookup |
| `llm/backend/instrumentation.ts:1-7` | Startup validation | Production-only secret validation |

Application routes in both copies import the shared utility for auth token operations. No alternative JWT library was found. Test files legitimately call `jsonwebtoken` directly to construct fixtures.

### Remaining `fallback_secret` occurrences

Current production occurrences are rejection checks only:

- `backend/lib/auth.ts:40`
- `llm/backend/lib/auth.ts:23`

Other occurrences are test fixtures and test setup. They should be replaced over time with explicit isolated test secrets to prevent accidental propagation of the rejected placeholder, but they are not production authentication paths.

### Non-JWT secret fallback

`backend/lib/analytics/privacy.ts:21` uses `ANALYTICS_HASH_SECRET || JWT_SECRET || "onevue-analytics-development"`. This is an analytics hashing fallback, not JWT signing or verification. It is not AUTH-001, but production analytics privacy should use a separately required secret and fail closed rather than falling back to the authentication secret.

## Authentication flow verification

| Flow | Current path | Result |
|---|---|---|
| Registration | `backend/app/api/auth/register/route.ts:5,79-86` | Shared signer; seven-day token; password account creation |
| Login | `backend/app/api/auth/login/route.ts:5,53-60` | Shared signer after password comparison; seven-day token |
| Identity selection | `backend/app/api/auth/set-identity/route.ts:6,37,82-89` | Shared verifier and signer; database identity update |
| Survey submission | `backend/app/api/auth/submit-survey/route.ts:5,44,127-134` | Shared verifier and signer; database update |
| Authenticated user retrieval | `backend/app/api/auth/me/route.ts:5,28` | Shared verifier and database subject lookup |
| Dashboard | `backend/app/api/dashboard/[role]/route.ts:5,49,62-72` | Shared verifier and current database identity comparison |
| Student APIs | `backend/app/api/student/**` | Reviewed routes use `verifyAuth()` or Student-specific identity enforcement |
| Professional/freelancer/creator/business profiles | `backend/lib/domain-profile/handler.ts:77-137` | Shared verification plus database identity comparison |
| Analytics | `backend/app/api/analytics/**` | Reviewed route family uses authenticated-user context |
| Website publishing | `backend/app/api/student/website/**` | Uses `verifyAuth()` and ownership-scoped queries |
| Assets | `backend/app/api/assets/**` | Uses `verifyAuth()` and ownership helpers |
| Public profile/card | `backend/app/api/public/**` | Public by design; uses public projections rather than authenticated data |

The mirrored `llm/backend` routes follow the same centralized pattern. The source review did not identify a current route-level JWT bypass.

## Authorization regression assessment

**No confirmed Phase 1 authorization regression was found.**

Existing protections remain visible:

- Student identity enforcement: `backend/app/api/student/profile/route.ts:114-133`.
- Dashboard role comparison against the database user identity: `backend/app/api/dashboard/[role]/route.ts:62-72`.
- Domain identity comparison: `backend/lib/domain-profile/handler.ts:77-137`.
- Website and revision ownership scoped to the authenticated user.
- Visiting-card queries scoped by card and authenticated user.
- Asset ownership through `readOwnedAsset`, `getOwnedAsset`, and `deleteOwnedAsset`.
- Student profile protection against mismatched client `userId`.
- Domain update allowlists and Mongo operator/prototype-pollution rejection.

The following should remain mandatory Phase 2 regression cases: Student token to Student route, Professional token to Student route, Freelancer token to Professional route, cross-user profile/resource reads and writes, user ID manipulation, identity/role/admin field manipulation, website ownership, asset ownership, visiting-card ownership, and analytics ownership.

## Current session architecture

### Backend

- Access tokens are JWT bearer tokens with `expiresIn: "7d"` at:
  - `backend/app/api/auth/login/route.ts:53-60`
  - `backend/app/api/auth/register/route.ts:79-86`
  - identity/survey token refresh paths in the corresponding routes.
- No refresh endpoint, refresh-token model, rotation, reuse detection, or session persistence was found.
- No server logout/revocation endpoint was found.
- Password change updates the password but does not invalidate existing tokens: `backend/app/api/profile/change-password/route.ts:12-80`.
- `User` has no session/version/status fields for authentication invalidation: `backend/models/User.ts:22-44,86-137`.
- No suspension or account-deletion invalidation mechanism was found.

### Frontend

- Session data, including the bearer token, is persisted through the localStorage-backed `db`: `frontend/services/_core.js:4-31`.
- Requests attach the bearer token from stored session state: `frontend/services/_core.js:38-48`.
- Login and registration persist the returned token: `frontend/services/auth.js:41-80`.
- Logout clears local state and optionally calls a live-mode signout path, but no corresponding backend session-revocation route was found: `frontend/services/auth.js:161-164`.
- There is no refresh-token flow or multi-device session management.
- Client route guards are not a server authorization boundary.

## Remaining vulnerabilities and gaps

### AUTH-002 — Unrevocable seven-day bearer sessions

**Severity:** HIGH  
**Status:** Confirmed  
**Evidence:** `frontend/services/auth.js:161-164`; token issuance in `backend/app/api/auth/login/route.ts:53-60` and `backend/app/api/auth/register/route.ts:79-86`; password change in `backend/app/api/profile/change-password/route.ts:12-80`.

Logout, password change, suspension, and deletion do not revoke already-issued bearer tokens. A copied token remains usable until expiration.

**Recommendation:** Implement short-lived access tokens, server-side per-device sessions, rotating refresh tokens, reuse detection, and explicit revocation.

### AUTH-003 — LocalStorage bearer-token exposure

**Severity:** MEDIUM  
**Status:** Confirmed storage behavior; exploitability dependent on an unconfirmed XSS source  
**Evidence:** `frontend/services/_core.js:4-31,38-48`; `frontend/services/auth.js:41-80`.

Any JavaScript executing in the origin can read the stored token. Migrate refresh state to Secure, HttpOnly cookies and keep access tokens in memory.

### AUTH-004 — Weak JWT secret acceptance

**Severity:** MEDIUM  
**Status:** Confirmed hardening gap  
**Evidence:** `backend/lib/auth.ts:38-44`; `llm/backend/lib/auth.ts:21-27`.

Any non-empty secret except the literal `fallback_secret` is accepted. A short or predictable production secret remains possible.

**Recommendation:** Require a minimum cryptographic length/entropy, reject known placeholders, validate all required JWT configuration at startup, and use a managed secret store in deployment.

### AUTH-005 — Issuer/audience validation depends on `NODE_ENV`

**Severity:** LOW/MEDIUM  
**Status:** Confirmed design gap; exploitability depends on exposed non-production deployment  
**Evidence:** `backend/lib/auth.ts:85-90`; `llm/backend/lib/auth.ts:64-69`.

Issuer and audience are only enforced in production. Require them in every deployed environment; use explicit test configuration for isolated tests.

### AUTH-006 — Optional verifier secret override

**Severity:** LOW  
**Status:** Confirmed hardening gap; no current exploit identified  
**Evidence:** `backend/lib/auth.ts:71`; `llm/backend/lib/auth.ts:50`.

The optional `secret` parameter permits future callers to bypass the canonical resolver. Remove the override and have every verifier resolve one immutable configuration.

### Analytics secret fallback

**Severity:** LOW  
**Status:** Missing control, not a JWT vulnerability  
**Evidence:** `backend/lib/analytics/privacy.ts:21`.

Use a dedicated required analytics hash secret rather than falling back to `JWT_SECRET` or a development literal.

## Phase 2 unified session architecture

### Design principles

1. Password, Google, and future providers authenticate through provider-specific adapters.
2. Every successful adapter returns a canonical internal account identity.
3. A single session service creates and manages OneVue sessions.
4. Provider tokens are never accepted as OneVue API tokens.
5. Identity selection remains a separate application concern and cannot be granted by an OAuth claim.

### Access tokens

- Lifetime: 10–15 minutes.
- Claims: `sub`, `sid`, `iss`, `aud`, `iat`, `exp`, `jti`, and an account/session version.
- Explicit HS256 allowlist, issuer, and audience in every environment.
- Verification loads the user/session status needed to reject revoked or suspended accounts.

### Refresh tokens

- Generate at least 32 cryptographically secure random bytes.
- Store only a one-way hash.
- Rotate on every successful refresh.
- Reject the previous token after rotation.
- Revoke the complete token family on reuse detection.
- Never accept refresh tokens in URLs, query strings, or JSON request bodies.

### Mongoose schema

Create `AuthSession` with:

```ts
{
  userId: ObjectId,
  sessionId: string,
  familyId: string,
  tokenHash: string,
  createdAt: Date,
  lastUsedAt: Date,
  expiresAt: Date,
  revokedAt: Date | null,
  revokeReason: "logout" | "logout-all" | "reuse-detected" |
    "password-changed" | "suspended" | "account-deleted",
  userAgentSummary?: string,
  ipHash?: string,
  deviceLabel?: string
}
```

Use unique indexes on `tokenHash` and `sessionId`, indexes on `(userId, revokedAt)`, `familyId`, and a TTL index on `expiresAt`. Avoid invasive device fingerprinting; store only bounded, non-sensitive summaries.

For OAuth compatibility, add an `AuthAccount` model:

```ts
{
  userId: ObjectId,
  provider: "password" | "google",
  providerSubject: string,
  providerEmail?: string,
  emailVerified?: boolean,
  linkedAt: Date
}
```

Use a unique `(provider, providerSubject)` index. Do not link accounts solely because email strings match; require an authenticated explicit linking flow and verified provider identity.

The `User.password` field must become optional for Google-only accounts without weakening password-account requirements. Preserve all five existing identity types and profile references.

### Cookie and CSRF strategy

- Refresh cookie: `Secure`, `HttpOnly`, `SameSite=Lax` or stricter, narrow authentication path.
- Exact-origin CORS only; enable credentials only for approved origins.
- For state-changing cookie-authenticated requests, validate Origin/Referer and use CSRF tokens.
- Do not log cookie values, refresh tokens, or JWTs.
- Keep access tokens in memory on the frontend.

### Endpoint changes

Add:

- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`

Preserve current login/register response compatibility during rollout, but have both call the common session service. Add future OAuth endpoints:

- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- authenticated account-link/unlink endpoints.

### Safe concurrent refresh

Atomically match the presented `tokenHash`, `revokedAt: null`, and unexpired `expiresAt`, then replace the hash. Exactly one concurrent request wins. A losing request receives no new token. Reuse of a previously rotated token revokes the family and requires reauthentication.

### Invalidation

- Current-device logout revokes one session and clears its cookie.
- Logout-all revokes all active sessions.
- Password change revokes all sessions and increments an account/session version.
- Suspension and deletion revoke all sessions and invalidate access-token checks.

## Google OAuth compatibility

Google integration should:

1. Validate OAuth state, PKCE, nonce, issuer, signature, redirect URI, and provider subject.
2. Resolve or create an `AuthAccount` linked to a `User`.
3. Require verified email and an explicit authenticated linking flow for account association.
4. Preserve the existing User identity and all five identity profiles.
5. Call the same session service as password login.
6. Never issue Google access or ID tokens as OneVue API bearer tokens.

Google OAuth is not implemented in this verification task.

## Detailed implementation order

1. Strengthen JWT configuration: minimum secret entropy, reject placeholders, require issuer/audience in all deployed environments, and remove the verifier secret override.
2. Add `AuthSession` model, indexes, hashing utilities, and a session service with atomic rotation.
3. Add short-lived access tokens containing session ID/version claims.
4. Add refresh, current logout, logout-all, session listing, and individual revocation endpoints.
5. Integrate session creation into password login, registration, identity update, and survey token refresh paths.
6. Revoke sessions on password changes, suspension, and deletion.
7. Migrate frontend auth to in-memory access tokens plus HttpOnly refresh cookies and a single-flight refresh promise.
8. Add CSRF protection and exact-origin credentialed CORS.
9. Add provider adapter interfaces and `AuthAccount` without implementing Google yet.
10. Implement Google OAuth separately through the provider adapter and common session service.
11. Remove legacy localStorage token persistence after rollout validation.
12. Re-run identity, ownership, authentication, and session regression suites in isolated databases.

## Regression test strategy

Use a dedicated test MongoDB database/collection per test run and deterministic test secrets that are never accepted in production. No production or shared database may be used.

Required cases:

- Missing and weak JWT configuration.
- Invalid signature, expired token, malformed token, unsupported algorithm, issuer, and audience.
- Registration/login session creation.
- Student-to-Student success.
- Professional-to-Student and Freelancer-to-Professional denial.
- Cross-user profile/resource read and modification denial.
- User ID, identity, role, permissions, and admin-field manipulation.
- Refresh rotation and old-token rejection.
- Refresh reuse and family revocation.
- Revoked session rejection.
- Concurrent refresh race with exactly one winner.
- Current-device logout and logout-all.
- Password-change invalidation.
- Suspension and deletion invalidation.
- Cookie attributes, credentialed CORS, and CSRF rejection.
- Future Google state/PKCE/nonce validation, account collision, explicit linking, and unlink behavior.

## Final recommendation

Phase 1 should be accepted as a successful AUTH-001 remediation with the residual findings above. Phase 2 should begin with session persistence and common session creation, not with Google OAuth. Do not claim OneVue is production-ready until unrevocable seven-day tokens, localStorage token persistence, weak secret acceptance, and the missing abuse/recovery controls are addressed and verified by isolated regression tests.

