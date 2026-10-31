# OneVue Authentication and Authorization Security Audit

**Assessment date:** 2026-10-31  
**Scope:** Backend authentication and authorization, protected API routes, frontend session handling, identity isolation, resource ownership, and existing security tests.  
**Method:** Read-only source review and execution-path tracing. No source code, schema, environment variable, account, or database changes were made. No destructive tests were run.

## Executive summary

OneVue is **not production-ready for authentication** in its current state.

Two confirmed findings require remediation:

1. **CRITICAL — Conditional JWT authentication bypass:** several routes use the literal `fallback_secret` when `JWT_SECRET` is absent. A deployment with a missing secret therefore permits attacker-signed tokens against those routes.
2. **HIGH — Logout does not revoke tokens:** logout is client-only. Bearer access tokens remain accepted for up to seven days after logout and after password changes.

The reviewed identity and ownership controls are generally well-scoped. In particular, the Student route and domain-profile handlers enforce the authenticated user's database identity, and reviewed website, visiting-card, asset, and published-revision operations scope queries to the authenticated user. The reported Professional-token-to-Student-route issue was **not reproduced in the reviewed implementation**: the Student profile route performs a database identity check before proceeding. However, the direct fallback-secret paths create a deployment-dependent bypass that can defeat those checks by forging the authenticated subject.

## Existing authentication architecture

- Backend entry points reviewed:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/set-identity`
  - `POST /api/auth/submit-survey`
  - `GET /api/auth/me`
  - shared `verifyAuth()` in `backend/lib/auth.ts`
- Frontend session handling reviewed in `frontend/services/auth.js`, `frontend/services/_core.js`, and `frontend/components/core/app.jsx`.
- Tokens are bearer JWTs. The reviewed login and registration routes issue tokens with a seven-day lifetime.
- The frontend stores the session/token in browser `localStorage`.
- No server-side refresh-token/session store or token-revocation mechanism was found.

## Authentication lifecycle analysis

### Registration and account creation

Registration and identity-selection paths were inspected for input handling, identity assignment, and token issuance. No confirmed plaintext-password storage, identity-based privilege escalation, or registration mass-assignment vulnerability was established by the review. The principal authentication defect is the direct fallback JWT secret used by the registration path (`backend/app/api/auth/register/route.ts:86-87`).

Controls and gaps:

- Password hashing and comparison are present in the reviewed authentication flow; preserve the existing hashing implementation.
- Application-level throttling was not evident for registration.
- Email verification is not implemented as an effective control: `backend/app/api/profile/route.ts:39` hardcodes `isEmailVerified: true`.
- Registration and identity selection should be covered by production-like tests with missing and invalid JWT configuration.

### Login

The login flow compares credentials before issuing a JWT. No confirmed user-enumeration or password-comparison bypass was established. However:

- Login throttling/brute-force protection was not evident.
- A seven-day bearer access token increases the impact of token theft.
- `backend/app/api/auth/login/route.ts:60-61` uses `fallback_secret` when `JWT_SECRET` is absent.
- Raw error-message propagation exists in reviewed backend responses; no confirmed sensitive disclosure was established, but responses should be normalized.

### Logout and session management

`frontend/services/auth.js:161-163` removes the local client session only. There is no server logout/revocation endpoint, token version, session record, or refresh-token store. Consequently, a copied access token remains valid until expiry, including after logout and password changes.

No individual-session revocation or account-wide session invalidation mechanism was found. Account suspension/deletion cannot reliably invalidate already-issued access tokens before their seven-day expiry.

## JWT and refresh-token analysis

### Finding AUTH-001 — Conditional JWT authentication bypass

| Field | Detail |
|---|---|
| Severity | **CRITICAL** |
| Confidence | 9/10 |
| Status | Confirmed, conditional on a deployment missing `JWT_SECRET` |
| Affected code | `backend/app/api/auth/login/route.ts:60-61`; `backend/app/api/auth/register/route.ts:86-87`; `backend/app/api/auth/set-identity/route.ts:39,92-93`; `backend/app/api/auth/submit-survey/route.ts:46,137-138`; `backend/app/api/auth/me/route.ts:30`; `backend/app/api/dashboard/[role]/route.ts:51`; `backend/app/api/student/profile/route.ts:117` |

**Description and evidence:** These routes directly fall back to the publicly knowable literal `fallback_secret` when `JWT_SECRET` is absent. The shared `verifyAuth()` helper in `backend/lib/auth.ts:19-30` has fail-closed behavior, but the direct route implementations bypass that safer configuration path.

**Exploitation scenario:** If a production deployment lacks `JWT_SECRET`, an attacker signs a JWT with `fallback_secret`, chooses a victim user ID as the subject, and sends it to a route using the fallback verifier. The route accepts the forged identity and may read or modify authenticated data.

**Impact:** Authentication bypass, account impersonation, unauthorized profile modification, and possible privilege escalation. The risk is especially severe because a configuration omission becomes a universal signing key.

**Recommended remediation:** Centralize secret resolution and verification. Use the fail-closed resolver everywhere for signing and verification, reject startup when a production secret is absent, and remove all production fallbacks. Add route-level tests with production configuration and a missing secret, plus tests for invalid signatures and algorithm restrictions.

**Relevant tests:** Existing `backend/tests/jwt_secret.test.js` covers the shared helper but not the direct route implementations.

### Finding AUTH-002 — Client-only logout and absent token revocation

| Field | Detail |
|---|---|
| Severity | **HIGH** |
| Confidence | 9/10 |
| Status | Confirmed |
| Affected code | `frontend/services/auth.js:161-163`; token issuance in `backend/app/api/auth/login/route.ts:60-61` and `backend/app/api/auth/register/route.ts:86-87` |

**Description and evidence:** `signOut()` removes local state but does not notify the backend or invalidate the bearer token. Access tokens remain valid for seven days. No refresh-token rotation, server-side session record, token version, revocation list, or password-change invalidation was found.

**Exploitation scenario:** An attacker who obtains a bearer token continues calling protected endpoints after the user logs out or changes their password.

**Impact:** Persistent unauthorized access until token expiry; compromised sessions cannot be terminated promptly.

**Recommended remediation:** Use short-lived access tokens and rotating refresh tokens in secure HttpOnly cookies, or implement server-side session/token-version revocation. Invalidate all active sessions on password change, suspension, and account deletion; provide individual-session and global logout.

**Relevant tests:** Add logout-then-refresh, logout-then-protected-request, password-change invalidation, revoked-session, and concurrent-refresh tests.

### Refresh-token lifecycle

No refresh-token lifecycle was found. Specifically, there is no evidence of refresh-token rotation, hashed refresh-token persistence, reuse detection, per-session revocation, or concurrent-refresh locking. This is a missing control and architectural gap rather than a separate confirmed refresh-token vulnerability because the reviewed implementation uses long-lived access bearer tokens instead.

### JWT verification controls

The shared helper has fail-closed secret handling, and the reviewed routes reject normal invalid authentication when that helper is used. However, direct route-level secret handling is inconsistent. Issuer/audience validation, explicit algorithm allowlisting, and a complete revocation strategy were not established across all direct JWT paths and should be made uniform.

## Authorization and identity isolation

### Identity-based authorization

The reviewed Student profile route (`backend/app/api/student/profile/route.ts:105-133`) verifies the authenticated user's database identity and rejects non-student users. The domain-profile handler (`backend/lib/domain-profile/handler.ts:76-137`) enforces the requested identity against the authenticated user's current database identity for identities such as Professional and Creator.

The reported Professional-token-to-Student-route HTTP 200 behavior was **not reproduced from the reviewed source path**; the route contains an explicit database identity check. This conclusion is limited by the conditional fallback-secret issue: forged authentication can defeat the trust boundary before identity authorization runs.

### Resource ownership

No confirmed IDOR was found in the reviewed resource-update paths. Evidence of ownership enforcement includes:

- Website configuration, preview, publish, history, and rollback queries scoped to `auth.user._id`.
- Visiting-card routes querying by both card ID and authenticated `userId`.
- Asset routes using `readOwnedAsset`, `getOwnedAsset`, and `deleteOwnedAsset`.
- Published website revisions checking both `userId` and `websiteConfigId`.
- Student profile updates rejecting mismatched client-supplied `userId` values.

The reviewed protected route families included `/api/profile`, `/api/profile/change-password`, `/api/profile/photo`, `/api/dashboard/:role`, `/api/student/profile`, `/api/student/card/**`, `/api/student/website/**`, `/api/student/resume/**`, `/api/student/certificates/**`, `/api/assets/**`, `/api/analytics/**`, and `/api/:identity/profile`.

### Mass assignment and privilege escalation

Domain-profile updates use allowlisted schema contracts and reject Mongo operators/prototype-pollution keys in `backend/lib/domain-profile/validate.ts`. No confirmed ability to set `userId`, role, identity, permissions, account status, admin flags, or ownership identifiers through arbitrary request bodies was found in the reviewed paths.

## API security findings and gaps

### Confirmed findings

- **AUTH-001:** inconsistent JWT secret resolution can bypass authentication under missing-secret deployment configuration.
- **AUTH-002:** logout does not invalidate server-side sessions or tokens.

### Potential or unverified risks

- Login, registration, and password-change endpoints do not show application-level throttling. Treat this as a missing control requiring load-safe verification and remediation.
- Backend responses frequently expose raw `error.message`; a sensitive disclosure path was not confirmed.
- The API proxy primarily applies CORS behavior and does not establish a comprehensive security-header policy. A direct authentication bypass was not demonstrated.
- CSRF exposure depends on the eventual cookie-based design; the current localStorage bearer design has a different threat profile. Reassess CSRF when migrating tokens to cookies.
- No confirmed NoSQL injection was found in the reviewed protected update paths; retain the existing operator/prototype-pollution rejection.

## Frontend authentication audit

### Finding AUTH-003 — Browser localStorage token exposure (hardening / elevated impact)

| Field | Detail |
|---|---|
| Severity | **MEDIUM potential risk** |
| Confidence | 9/10 for storage behavior; exploitability depends on an XSS source not confirmed in this review |
| Affected code | `frontend/services/_core.js:8-13` |

Tokens are stored in `localStorage`, making them readable by JavaScript executing in the origin. No confirmed exploitable XSS source was established, so this is not classified as a confirmed account-takeover finding. It materially increases the impact of any future XSS or compromised third-party script.

**Recommendation:** Prefer short-lived access tokens and rotating refresh tokens in Secure, HttpOnly, SameSite cookies, with appropriate CSRF protection. Maintain server-side authorization checks; client route protection must never be treated as sufficient.

Frontend route protection in `frontend/components/core/app.jsx` was reviewed as a UX/session gate, not a security boundary. Server-side checks remain authoritative.

## Password recovery and email verification

No password-recovery/reset endpoints were found in the reviewed backend entry points. No reset-token generation, expiration, single-use enforcement, or reset rate limiting can therefore be confirmed. Email verification is not an effective enforcement control because `backend/app/api/profile/route.ts:39` hardcodes `isEmailVerified: true`.

These are missing capabilities and controls requiring implementation and dedicated tests before production authentication claims are made.

## Vulnerability register

| ID | Severity | Confidence | Status | Summary |
|---|---|---:|---|---|
| AUTH-001 | CRITICAL | 9/10 | Confirmed conditional | Public `fallback_secret` permits attacker-signed JWTs when `JWT_SECRET` is absent |
| AUTH-002 | HIGH | 9/10 | Confirmed | Client-only logout leaves seven-day bearer tokens valid |
| AUTH-003 | MEDIUM potential risk | 9/10 | Confirmed storage behavior; exploit not confirmed | JWT/session material in `localStorage` increases XSS token-theft impact |

## Existing security controls to preserve

- Shared fail-closed JWT configuration behavior in `backend/lib/auth.ts:19-30`.
- Database identity enforcement for Student routes.
- Domain identity matching in `backend/lib/domain-profile/handler.ts`.
- Ownership-scoped website, published-revision, visiting-card, and asset queries.
- Allowlisted domain-profile update contracts.
- Rejection of Mongo operators and prototype-pollution keys.
- Student profile protection against mismatched client `userId`.
- Existing tests for JWT secret behavior, Student identity enforcement, domain identity profiles, workspace isolation, asset access, publishing workflow, and CORS.

## Missing security controls

1. Uniform fail-closed JWT secret resolution and production startup validation.
2. Short-lived access tokens with rotating, hashed refresh tokens and reuse detection.
3. Server-side logout and session revocation, including password-change and suspension invalidation.
4. Login, registration, password-reset, and verification throttling.
5. Effective email verification and a complete password recovery workflow.
6. Explicit JWT issuer, audience, and algorithm policy across every verifier.
7. Centralized security headers and normalized error responses.
8. Comprehensive negative authorization and concurrent-session tests.

## Prioritized remediation roadmap

### Immediate: before any production deployment

1. Remove `fallback_secret` from every signing and verification path; fail closed when production configuration is incomplete.
2. Audit all JWT consumers to ensure one verified helper and an explicit algorithm policy.
3. Rotate any credentials or tokens that may have been exposed by a deployment using the fallback.
4. Add regression tests for missing secrets, forged signatures, malformed tokens, expired tokens, and cross-identity access.

### Next: session security

1. Introduce short-lived access tokens.
2. Add per-device server-side sessions with hashed, rotating refresh tokens and reuse detection.
3. Implement logout, global logout, individual-session revocation, password-change invalidation, suspension invalidation, and account-deletion invalidation.
4. Add safe concurrency handling for refresh requests.

### Then: abuse resistance and recovery

1. Add rate limits and account-safe responses for login, registration, password reset, and email verification.
2. Implement single-use, expiring, cryptographically random reset and verification tokens.
3. Replace effective localStorage token storage with an HttpOnly-cookie design where compatible, plus CSRF protection.
4. Add a centralized security-header policy and error redaction.

## Regression test plan

Run only against an isolated test database and non-production configuration:

1. Missing authentication token.
2. Invalid JWT signature.
3. Expired access token.
4. Malformed JWT.
5. Refresh-token reuse.
6. Revoked refresh token.
7. Unauthorized identity access, including Professional token against Student route.
8. Cross-user profile access.
9. Cross-user resource modification.
10. User privilege escalation through `userId`, role, identity, permissions, status, and admin fields.
11. Mass assignment and Mongo operator/prototype-pollution payloads.
12. Brute-force login attempts and rate-limit behavior.
13. Password-reset token reuse.
14. Logout followed by refresh and protected-request attempts.
15. Concurrent refresh requests using the same token.
16. Protected API access after account suspension.
17. Production-mode startup or route behavior with missing `JWT_SECRET`.
18. Issuer, audience, and algorithm-confusion rejection.

## Production-readiness assessment

**Assessment: Not production-ready for authentication.**

The conditional critical JWT bypass must be fixed and validated first. The absence of server-side logout/revocation is a high-severity session-control gap. Authorization and ownership controls in the reviewed paths are comparatively strong, but they cannot compensate for a forged authentication boundary or long-lived unrevokeable bearer tokens. The missing recovery, email verification, throttling, and comprehensive negative-test controls should be addressed before declaring the system production-ready.

