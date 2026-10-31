# OneVue Authentication Hardening — Phase 1

**Date:** 2026-10-31  
**Scope:** AUTH-001 remediation and JWT regression coverage.  
**Out of scope:** Full server-side session migration (documented in [AUTH_SESSION_ARCHITECTURE.md](./AUTH_SESSION_ARCHITECTURE.md)).

## Implemented

- Removed route-level use of `process.env.JWT_SECRET || "fallback_secret"`.
- Centralized JWT signing and verification in `backend/lib/auth.ts`.
- Removed the local duplicate JWT verifier from the Student profile route.
- Added an explicit HS256 verification allowlist.
- Added consistent issuer and audience claims for tokens issued by the application.
- Enforced issuer and audience validation in production.
- Made JWT secret resolution fail closed in every environment; the insecure default is no longer accepted.
- Added production startup validation through `backend/instrumentation.ts`.
- Preserved existing token response fields and existing identity/ownership authorization logic.

## Regression coverage

`backend/tests/jwt_secret.test.js` now covers:

- missing and insecure JWT secrets;
- invalid signatures;
- malformed tokens;
- unsupported algorithms;
- incorrect issuer;
- incorrect audience;
- application-issued token verification;
- production fail-closed behavior.

The wider Phase 2 session requirements (refresh rotation, hashed persistence, reuse detection, logout invalidation, and concurrent refresh handling) are not implemented in this change set.

## Verification

The following commands are the required verification set for this phase:

```text
npm test -- --test-name-pattern "JWT secret fail-closed"
npm run build
npm run lint
```

Results:

- `node --test tests/jwt_secret.test.js`: **passed** (5/5).
- `npx tsc --noEmit` in `backend`: **passed**.
- `npx tsc --noEmit` in `llm/backend`: **passed**.
- `npm run build` in `backend`: **passed**.
- `npm run lint` in `backend`: **failed on pre-existing lint violations** across the repository, including existing `any` and `require()` findings; no new lint-only cleanup was made outside this security change.
- `git diff --check`: **passed** for the hardening changes.

No destructive tests or database migrations are part of this phase.

## Remaining vulnerabilities and gaps

- AUTH-002 remains: logout is client-only and existing access tokens remain valid until expiry.
- Token storage remains in frontend localStorage and should be migrated with the Phase 2 session design.
- Rate limiting, effective email verification, password recovery, and comprehensive session invalidation remain outstanding.
