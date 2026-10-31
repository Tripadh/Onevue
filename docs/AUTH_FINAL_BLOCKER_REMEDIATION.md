# Authentication Final Blocker Remediation

## Status

The confirmed CSRF, refresh-rotation, frontend auth-scope, and stale CORS-test blockers were remediated. The implementation is **not declared production-ready** because the repository does not currently contain account suspension/deletion workflows or an isolated MongoDB integration-test harness for the complete lifecycle matrix.

## Blockers and root causes

### CSRF protection — remediated

**Root cause:** refresh and logout accepted a missing `Origin`, and there was no synchronizer token.

**Changes:**

- `backend/lib/cors.ts:13-24` now allows `X-CSRF-Token` and rejects missing or untrusted origins for state-changing requests.
- `backend/models/AuthSession.ts` stores only `csrfTokenHash`.
- `backend/lib/session.ts:39-91` generates a cryptographically random CSRF token, issues it in a readable `onevue_csrf` cookie, and keeps the refresh cookie HttpOnly.
- `backend/lib/session.ts:178-198` validates the request header against the server-side session hash using a timing-safe comparison.
- `backend/app/api/auth/refresh/route.ts:12-19` and `backend/app/api/auth/logout/route.ts:13-20` require both exact origin and CSRF validation.
- The same implementation is mirrored under `llm/backend/`.

The CSRF cookie uses `SameSite=Lax`, is readable by the frontend, and is not accepted as a substitute for the header. Its path is `/` so a frontend served at the site root can read it before calling `/api/auth/refresh` or `/api/auth/logout`. In local development/test it is explicitly scoped to `localhost` so separate frontend/backend ports share the cookie; production requires the optional `AUTH_COOKIE_DOMAIN` to be configured when subdomains need to share it. The refresh cookie remains HttpOnly and scoped to `/api/auth`. Login, registration, identity selection, survey completion, and Google callback issue the CSRF cookie through the common session-cookie helper. Logout clears both the new root-scoped cookie and the legacy `/api/auth` cookie path.

### Concurrent refresh rotation — remediated

**Root cause:** a losing concurrent request treated the already-consumed token as confirmed replay and revoked the entire family, including the winning rotation.

**Security decision:** `AuthSession.findOneAndUpdate` conditionally consumes `{ tokenHash, revokedAt: null, expiresAt: {$gt: now} }`. Only one request can transition the token. A losing request that observes `previousTokenHash` within the five-second race window returns an error without revoking the family. Reuse after the race window revokes every active session in the token family.

This preserves one-consumer semantics and keeps the winner valid. It intentionally does not return the successor refresh token to the losing request; clients must use the winner's response or re-authenticate.

### Account lifecycle — not implementable without inventing a workflow

The inspected `User` model (`backend/models/User.ts:29-48`) has no suspension, deletion, or account-status field. Repository searches found no account suspension or user-deletion route/service. The existing session service already exposes:

- `revokeAllSessions(userId, "suspended")`
- `revokeAllSessions(userId, "account-deleted")`

Those hooks are ready for the real lifecycle owner, but no new lifecycle behavior was invented. Until those workflows exist, account suspension/deletion invalidation remains a production blocker.

### Frontend auth scope — remediated

`frontend/services/auth.js:95-137` now defines Google sign-in, Google linking, and live-session restoration at service scope instead of nesting them inside `signIn`. `frontend/services/_core.js:8-12` and `frontend/services/_core.js:55-108` read only the readable CSRF cookie, attach `X-CSRF-Token`, and retain single-flight refresh behavior. Live access tokens remain memory-only; no refresh or access token is written to localStorage.

### CORS tests — remediated

`backend/tests/cors.test.js:74-82` now asserts credentialed CORS for trusted origins, includes the CSRF header in preflight expectations, and verifies that missing origins are rejected for state-changing requests.

## Files changed for this remediation

- `backend/lib/session.ts`
- `backend/models/AuthSession.ts`
- `backend/lib/cors.ts`
- `backend/app/api/auth/refresh/route.ts`
- `backend/app/api/auth/logout/route.ts`
- `backend/app/api/auth/login/route.ts`
- `backend/app/api/auth/register/route.ts`
- `backend/app/api/auth/set-identity/route.ts`
- `backend/app/api/auth/submit-survey/route.ts`
- `backend/app/api/auth/google/callback/route.ts`
- `backend/tests/cors.test.js`
- `backend/tests/session_lifecycle.test.js`
- `backend/.env.example`
- `frontend/services/_core.js`
- `frontend/services/auth.js`
- Corresponding authentication/session files under `llm/backend/`.
- `llm/backend/.env.example`

## Verification

Passed:

- Focused backend tests: **23/23**
  - JWT secret and algorithm/issuer/audience tests
  - Google OAuth protocol tests
  - CORS and preflight tests
  - CSRF-origin policy tests
  - Cookie security policy tests
- Frontend tests: **21/21**
- Primary backend build: passed
- Mirrored backend build: passed
- `git diff --check`: passed
- Session lifecycle cookie tests: **3/3**
- Primary and mirrored backend builds after the cookie-scope fix: passed

Not run:

- MongoDB-backed session lifecycle tests for rotation races, revocation, password changes, and expiration. No isolated MongoDB test harness is configured in the repository.
- Suspension/deletion integration tests. No corresponding production workflows exist.

## Remaining production blockers

1. Define the existing account suspension/deletion owner and add its transaction-safe session revocation integration.
2. Add isolated MongoDB integration tests covering session creation, successful rotation, concurrent rotation, replay-family revocation, logout, logout-all, expiration, revoked sessions, and password-change invalidation.
3. Configure `CORS_ALLOWED_ORIGINS` with the deployed frontend origins; the checked-in defaults are local development origins only.
4. Configure `AUTH_COOKIE_DOMAIN` explicitly in production when the frontend and API are on different subdomains; never rely on the local `localhost` default in production.

Google OAuth remains compatible with the common session service: the callback creates a normal OneVue session and does not issue Google ID tokens as API tokens.
