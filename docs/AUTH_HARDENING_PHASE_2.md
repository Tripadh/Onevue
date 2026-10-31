# OneVue Authentication Hardening - Phase 2

## Scope

Phase 2 introduces server-side sessions without changing the existing identity
or resource ownership model. Both `backend/` and `llm/backend/` use the same
JWT policy and session implementation.

## Implemented controls

- Access tokens are HS256-only, include issuer and audience claims, and expire
  after 15 minutes.
- JWT secrets must be at least 32 characters, must not be `fallback_secret`,
  and must not be a repeated-character placeholder.
- JWT verification no longer accepts a caller-supplied secret.
- `AuthSession` stores only SHA-256 refresh-token hashes, a session ID, token
  family ID, timestamps, bounded device metadata, and revocation metadata.
- Refresh tokens are 48-byte cryptographically random values in an HttpOnly
  cookie scoped to `/api/auth`.
- Successful refreshes atomically replace the current hash and retain the
  immediately previous hash. Reuse of either a revoked token or the previous
  token revokes the whole token family.
- Logout revokes the current session and clears the refresh cookie.
- Password changes revoke every session for the account.
- Protected shared authentication now checks both JWT validity and the
  persistent session record.
- Live frontend sessions are held in memory; refresh is single-flight and
  uses credentialed requests. Persistent localStorage session storage is no
  longer used by the shared live HTTP/auth path.
- Credentialed CORS uses an exact allowlist from `CORS_ALLOWED_ORIGINS`.
  Refresh and logout reject disallowed origins as a CSRF defense.

## Endpoints

| Endpoint | Behavior |
|---|---|
| `POST /api/auth/refresh` | Rotate the HttpOnly refresh cookie and return a short-lived access token |
| `POST /api/auth/logout` | Revoke the current session and clear the refresh cookie |
| login/register | Create an `AuthSession`, return the access token, and set the refresh cookie |

Existing response `token` fields remain for compatibility. They now contain
short-lived access tokens and must not be persisted by clients.

## Remaining production blockers

1. Session listing and explicit individual-session revocation UI/API are not
   yet exposed.
2. Account suspension/deletion workflows need to call `revokeAllSessions`.
3. CSRF protection currently relies on exact Origin validation; a dedicated
   synchronizer token can be added if cross-site deployment requirements
   require requests without an Origin header.
4. Existing direct auth lifecycle routes should be migrated fully to
   `verifyAuth`/`verifySessionToken` in any future route additions.
5. OAuth provider records and Google state/PKCE/nonce validation remain
   intentionally out of scope.

## Verification

- `backend`: `npm run build` passed.
- `llm/backend`: `npm run build` passed.
- No production database, migration, or account operation was executed.
