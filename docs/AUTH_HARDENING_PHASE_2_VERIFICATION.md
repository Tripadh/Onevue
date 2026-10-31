# OneVue Authentication Hardening Phase 2 Verification

**Verification date:** 2026-10-31  
**Scope:** Read-only verification of the MongoDB-backed authentication session migration in
`backend/`, `llm/backend/`, and the frontend authentication services.

No source code, configuration, database, account, or environment file was modified during
this verification.

## Executive summary

The Phase 2 migration is **PARTIAL**.

The core session controls are present in both backend copies: refresh tokens are generated
with cryptographically secure randomness, only SHA-256 token hashes are persisted, access
tokens are short-lived and linked to persistent sessions, logout/password-change revocation
is implemented, and the two backend copies are byte-for-byte equivalent for the reviewed
session and JWT files.

The migration is not production-ready because:

1. Cookie-authenticated refresh and logout accept requests with no `Origin` header. The
   current CSRF check treats a missing origin as trusted.
2. Concurrent refresh requests are not safely coalesced. The first request rotates the
   token; the second request sees the previous hash and revokes the entire token family,
   including the newly rotated session. This causes a denial of service for legitimate
   concurrent requests and is not the documented “exactly one winner without invalidating
   the winner” behavior.
3. There are no dedicated isolated tests for refresh rotation, reuse, concurrency, revoked
   sessions, logout, expiry, invalid cookies, or password-change invalidation.
4. No account suspension or deletion workflow calls `revokeAllSessions`.
5. The frontend OAuth/session-hydration helper functions are nested inside `signIn`
   (`frontend/services/auth.js:97-126`) but are referenced from the outer exported object
   (`frontend/services/auth.js:368-388`). This is a confirmed integration defect.
6. The existing CORS test suite has six failures because it expects
   `Access-Control-Allow-Credentials` to be absent, while the implementation correctly
   emits it for credentialed allowed origins. The test contract must be updated before the
   CORS change can be considered verified.

## Requirement results

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Cryptographically secure refresh randomness | **PASS** | `backend/lib/session.ts:1,75,118` uses `randomBytes(48)`; the mirrored file has the same hash. |
| 2 | Only hashed refresh tokens stored | **PASS** | `backend/lib/session.ts:31,82,86` hashes before persistence; `backend/models/AuthSession.ts:15-17,31-33` stores hashes and previous hashes, not raw tokens. |
| 3 | Atomic rotation and concurrent safety | **PARTIAL** | `backend/lib/session.ts:119-123` uses an atomic conditional update, but a legitimate second concurrent request is classified as reuse and revokes the family at `:110-112` or `:124-126`. |
| 4 | Reuse revokes correct token family | **PASS** | `backend/lib/session.ts:110-112,114-116,124-126` updates active sessions by `familyId`. |
| 5 | Revoked sessions cannot obtain new access tokens | **PASS** | Refresh rejects revoked sessions at `backend/lib/session.ts:114-116`; access authentication rejects `revokedAt` sessions at `backend/lib/session.ts:97-100` and `backend/lib/auth.ts:93-100`. |
| 6 | Already-issued access tokens after revocation | **PASS** | Every protected token is checked against the persistent session record by `backend/lib/auth.ts:93-100,130-137`; revocation therefore invalidates the token before its JWT expiry. |
| 7 | Logout invalidates server session | **PASS** | `backend/app/api/auth/logout/route.ts:18-25` verifies the token and calls `revokeSession`; `backend/lib/session.ts:138-141` persists revocation and the route clears the cookie. |
| 8 | Password changes revoke sessions | **PASS** | `backend/app/api/profile/change-password/route.ts:86` calls `revokeAllSessions` with `password-changed`; the service updates active sessions at `backend/lib/session.ts:143-146`. |
| 9 | Suspension/deletion invalidate sessions | **FAIL** | The only production call site for `revokeAllSessions` is password change (`backend/app/api/profile/change-password/route.ts:86`). No suspension or account-deletion workflow was found. |
| 10 | Cookie security attributes | **PASS** | `backend/lib/session.ts:39-46` sets HttpOnly, production Secure, SameSite=Lax, `/api/auth` path, and a 30-day max-age. Clearing uses the same path and `maxAge: 0` at `:49-56`. |
| 11 | CORS and CSRF enforcement | **PARTIAL** | Exact-origin CORS is implemented at `backend/lib/cors.ts:7-18,24-40`; refresh/logout check it at their route `:14`. However `backend/lib/cors.ts:21-23` returns trusted for `origin === null`, allowing state-changing cookie requests without Origin. No synchronizer CSRF token or Referer fallback is implemented. |
| 12 | Single-flight frontend refresh | **PASS** | `frontend/services/_core.js:7,72-83` shares `refreshInFlight` and clears it in `finally`. |
| 13 | No persistent live access/refresh tokens in localStorage | **PARTIAL** | Live session state is held in `liveSession` at `frontend/services/_core.js:7,17-27`; refresh is cookie-based at `:72-80`. However the same file still probes and uses localStorage for mock/non-live data at `:9-11,28-29`, so this is not a repository-wide absence of token-capable localStorage. The reviewed live auth path does not persist its session there. |
| 14 | Equivalent backend policies | **PASS** | SHA-256 hashes for `backend/lib/session.ts`, `AuthSession.ts`, `lib/auth.ts`, refresh route, and logout route match the corresponding `llm/backend/` files exactly. |
| 15 | Identity/resource ownership preserved | **PASS (code review); tests incomplete** | Identity checks remain in `backend/lib/domain-profile/handler.ts:77-117,184-217`, dashboard identity checks in `backend/app/api/dashboard/[role]/route.ts:67-74`, and owner-scoped queries remain in routes such as `backend/app/api/assets/route.ts:52` and `backend/app/api/student/card/route.ts:48,303,456`. Dedicated Phase 2 cross-user/cross-identity session tests are absent. |

## Session lifecycle verification

### Creation and token storage

`createSession` connects to MongoDB, creates a 48-byte random refresh token, generates
independent session and family identifiers, and stores only `hashToken(refreshToken)`.
The raw refresh token is returned only to the caller so it can be placed in the response
cookie: `backend/lib/session.ts:72-91`.

The schema requires a user, session ID, family ID, token hash, last-used timestamp, and
expiry. It has unique indexes on session ID and current token hash, indexes for family,
revocation, expiry, and user/revocation lookup, plus a TTL index on expiry:
`backend/models/AuthSession.ts:24-46`.

### Rotation and reuse

The current hash and previous hash are looked up at
`backend/lib/session.ts:107-108`. A previous hash, revoked session, or expired session
causes all active sessions in the family to be revoked with `reuse-detected`:
`backend/lib/session.ts:110-116`.

The rotation update is conditional on the original document ID, current token hash,
non-revoked state, and future expiry, which prevents two updates from both succeeding:
`backend/lib/session.ts:119-123`.

However, the loser of a legitimate concurrent request is indistinguishable from a stolen
old token. It matches `previousTokenHash` after the winner commits and revokes the family.
This means the winner's newly issued token is also invalidated. The implementation is
atomic, but its concurrency behavior is not safe for browser retries or duplicate network
requests.

### Access-token revocation

Access tokens contain `sid` and expire after 15 minutes:
`backend/lib/session.ts:6,65-70,89`; JWT verification requires HS256, issuer, and audience:
`backend/lib/auth.ts:80-90`.

Persistent session verification requires matching session ID and user ID, `revokedAt: null`,
and an unexpired session:
`backend/lib/auth.ts:93-100`. Therefore logout, password change, or family revocation
invalidates already-issued access tokens on the next protected request. This is stronger
than JWT-only expiration.

### Logout and password changes

Current-device logout derives the session ID from the bearer token and revokes it:
`backend/app/api/auth/logout/route.ts:18-25`. It then clears the refresh cookie.
Password changes call `revokeAllSessions` after a successful password update:
`backend/app/api/profile/change-password/route.ts:78-87`.

No `GET /sessions`, individual session delete endpoint, or logout-all endpoint was found.
The service function exists (`backend/lib/session.ts:143-146`) but has no route integration
for user-triggered global logout.

### Suspension and deletion

The session service supports `"suspended"` and `"account-deleted"` reasons in its type
signatures, but those reasons are not wired to account lifecycle handlers. The verification
therefore fails this requirement: a future suspension/deletion path must revoke all sessions
before or as part of disabling/removing the account.

## Cookie, CORS, and CSRF assessment

The refresh cookie is HttpOnly, Secure in production, SameSite=Lax, scoped to
`/api/auth`, and expires after 30 days. The clear operation uses the same path, which is
required for reliable deletion: `backend/lib/session.ts:39-56`.

Allowed origins are exact string matches from `CORS_ALLOWED_ORIGINS` with localhost
development defaults: `backend/lib/cors.ts:7-18`. Credentialed responses are emitted only
for allowed origins at `backend/lib/cors.ts:24-40`.

The defect is the trusted-origin predicate:

```text
backend/lib/cors.ts:21-23
return origin === null || isAllowedOrigin(origin);
```

Both cookie-authenticated state-changing endpoints call this predicate:

- `backend/app/api/auth/refresh/route.ts:14`
- `backend/app/api/auth/logout/route.ts:14`

A browser normally sends `Origin` on these cross-origin POST requests, but non-browser
clients, same-origin contexts, privacy tooling, and some proxy paths can omit it. Treating
absence as trusted is not a complete CSRF policy for cookie-authenticated state changes.

## Frontend assessment

The shared live HTTP client attaches the in-memory access token and sends cookies:
`frontend/services/_core.js:47-55`. It retries a 401 through the single-flight refresh
promise at `:57-69` and `:72-83`.

Live session state is not written to localStorage because `db.get/set/remove` special-case
the `session` key at `frontend/services/_core.js:17-29`. Refresh cookies are not directly
read by JavaScript.

A confirmed JavaScript integration defect remains in `frontend/services/auth.js`:

- `signInWithGoogle`, `linkGoogleAccount`, and `restoreLiveSession` are declared inside
  `signIn` at lines `97-126`.
- They are referenced as outer-scope exports at lines `373-374,388`.

This will cause the auth service initialization to fail with an unresolved identifier
when the file is evaluated, or otherwise prevent the intended Google/session hydration
behavior. It must be corrected before frontend OAuth readiness can be marked PASS.

Other non-session localStorage uses, such as editor drafts, remain outside the live
authentication session path. They should not be confused with refresh-token storage.

## Backend-copy parity

The following pairs have identical SHA-256 hashes:

- `backend/lib/session.ts` / `llm/backend/lib/session.ts`
- `backend/models/AuthSession.ts` / `llm/backend/models/AuthSession.ts`
- `backend/lib/auth.ts` / `llm/backend/lib/auth.ts`
- `backend/app/api/auth/refresh/route.ts` / `llm/backend/app/api/auth/refresh/route.ts`
- `backend/app/api/auth/logout/route.ts` / `llm/backend/app/api/auth/logout/route.ts`

Both copies therefore currently enforce the same reviewed session and JWT policy. This does
not remove the need to add tests to both build/test workflows.

## Test execution

All commands were run without connecting to a production or shared database.

| Command | Result |
|---|---|
| `node --test backend/tests/jwt_secret.test.js` | **PASS — 5/5** |
| `node --test backend/tests/google_oauth.test.js` | **PASS — 3/3**, from the existing OAuth work |
| `node --test backend/tests/jwt_secret.test.js backend/tests/cors.test.js` | **FAIL — 11 passed, 6 failed** |
| `npm test` from `frontend/` | **PASS — 21/21** |
| `npm run build` from `backend/` | **PASS** |
| `npm run build` from `llm/backend/` | **PASS** |
| `git diff --check` | **PASS** |

The six CORS failures are assertion failures in the existing test expectations
(`backend/tests/cors.test.js:77` and callers at `:112,131,146,170,221,240`). They expect
`Access-Control-Allow-Credentials` to be null, while the implementation emits
`true` for allowed credentialed origins. This test suite does not verify the refresh/logout
CSRF predicate and does not provide session lifecycle coverage.

### Missing required isolated tests

No dedicated tests were found for:

- Refresh rotation.
- Refresh-token reuse.
- Concurrent refresh requests.
- Revoked-session access.
- Logout invalidation.
- Logout-all.
- Password-change session invalidation.
- Expired sessions.
- Invalid refresh cookies.
- CSRF rejection on refresh/logout.
- Cross-user access after session migration.
- Cross-identity access after session migration.

The absence of these tests is a verification gap, not evidence that the behaviors pass.

## Confirmed findings and remaining blockers

### AUTH-P2-001 — HIGH — Missing-origin CSRF trust

**Evidence:** `backend/lib/cors.ts:21-23`; consumed by
`backend/app/api/auth/refresh/route.ts:14` and
`backend/app/api/auth/logout/route.ts:14`.

**Impact:** A cookie-authenticated state-changing request with no Origin header is accepted.
This weakens the intended CSRF boundary around refresh and logout.

**Remediation:** Require an explicit trusted origin for browser cookie operations, or add a
deliberate CSRF token mechanism with tests for absent, invalid, and valid tokens. Preserve
exact-origin CORS and credential restrictions.

### AUTH-P2-002 — HIGH — Concurrent refresh revokes the winning session family

**Evidence:** `backend/lib/session.ts:108-126`.

**Impact:** Two legitimate simultaneous refreshes can cause the second request to trigger
reuse detection and revoke the entire family, invalidating the first request's newly-issued
access and refresh tokens. This creates a session denial-of-service condition and can cause
frequent logout under retry/race conditions.

**Remediation:** Define a concurrency policy that distinguishes a bounded duplicate retry
from token theft, for example an atomic rotation record/idempotency mechanism that safely
returns the already-issued successor for the same rotation event, while still revoking the
family for a later replay outside the permitted retry window.

### AUTH-P2-003 — HIGH — Account lifecycle invalidation is unwired

**Evidence:** `revokeAllSessions` exists at `backend/lib/session.ts:143-146`, but the only
application call found is password change at
`backend/app/api/profile/change-password/route.ts:86`. No suspension or deletion handler
calls it.

**Impact:** If suspension or deletion is added or performed through an existing administrative
or data lifecycle path, active sessions may remain usable unless another control removes the
user record. The required invariant is not enforced centrally.

**Remediation:** Wire suspension and deletion transitions to revoke all sessions and add
tests that verify both access-token and refresh-token rejection afterward.

### AUTH-P2-004 — HIGH — Frontend auth service export defect

**Evidence:** `frontend/services/auth.js:97-126,368-388`.

**Impact:** Google sign-in/linking and startup session hydration are not reliably available
from the exported service. This breaks the intended common OAuth/session user experience.

**Remediation:** Move these functions to the IIFE scope before the export object, then add a
browser/service test that evaluates the file and invokes the exported methods.

### AUTH-P2-005 — MEDIUM — Session regression coverage missing

**Evidence:** No `*session*.test.js` files were found; `backend/tests` contains JWT/CORS
tests but no rotation/reuse/concurrency/session-revocation suite.

**Impact:** The most security-sensitive state transitions are not regression-protected.
Atomic database behavior, cookie clearing, revocation, and family reuse behavior could
regress unnoticed.

**Remediation:** Add isolated MongoDB tests for each required lifecycle and run them against
both backend copies or a shared parity test matrix.

### AUTH-P2-006 — MEDIUM — CORS test contract is stale

**Evidence:** `backend/tests/cors.test.js:77` asserts credentials are null, while
`backend/lib/cors.ts:32` sets `Access-Control-Allow-Credentials: true`.

**Impact:** CI cannot verify the intended credentialed-cookie policy and currently reports
false failures for allowed-origin behavior.

**Remediation:** Update the test expectation to require `true` for allowed origins and add
explicit refresh/logout tests for disallowed and missing origins.

## Google OAuth readiness

**Status: PARTIAL.**

The backend OAuth flow is compatible with the common session service and has the required
provider-side checks from the prior implementation. The backend builds successfully and
the existing OAuth helper tests pass.

It is not ready for production sign-in until the frontend export defect is fixed and
end-to-end callback hydration is tested. The common backend session path itself is suitable:
Google callback sessions use the same persistent session model and access-token policy,
rather than treating a Google ID token as a OneVue API token.

## Recommended implementation order

1. Fix and test the missing-origin CSRF policy for refresh/logout.
2. Resolve concurrent refresh semantics without invalidating the successful rotation.
3. Wire suspension and deletion to `revokeAllSessions`.
4. Move and test the frontend Google/session-hydration helpers.
5. Add isolated session lifecycle tests, including both backend copies.
6. Align the CORS test contract with credentialed cookies.
7. Re-run backend builds, frontend tests, identity/ownership regressions, and the complete
   session/security suite before production approval.

## Final verdict

**Phase 2 verification: PARTIAL — do not approve for production yet.**

The cryptographic storage, JWT/session binding, logout, password-change revocation, cookie
attributes, single-flight client refresh, backend parity, and reviewed ownership boundaries
are present. The missing-origin CSRF acceptance, unsafe concurrent-refresh behavior,
unwired account lifecycle invalidation, frontend auth export defect, and absent dedicated
session tests are release blockers.
