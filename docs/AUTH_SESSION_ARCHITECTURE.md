# OneVue Secure Session Architecture Proposal

This proposal is intentionally separate from Phase 1 implementation. It describes the server-side session migration required for AUTH-002 without changing the current authentication flow in this change set.

## Persistent session schema

Add a Mongoose `AuthSession` model with:

- `userId`: required indexed ObjectId reference to `User`.
- `tokenHash`: required unique hash of the current refresh-token secret.
- `familyId`: required identifier shared by one refresh-token rotation family.
- `createdAt`, `lastUsedAt`, `expiresAt`, and `revokedAt`.
- `revokeReason`: enum such as `logout`, `reuse-detected`, `password-changed`, `suspended`, or `account-deleted`.
- Optional non-sensitive device metadata: user-agent summary, IP hash, and device label.

Store only a cryptographic hash of the refresh token. Never persist the raw token or place it in logs. Add indexes on `(userId, revokedAt)`, `familyId`, and `expiresAt`.

## Token lifecycle

1. Login creates a session and returns a short-lived access token plus a random refresh token.
2. The refresh token is stored in a `Secure`, `HttpOnly`, `SameSite=Lax` or stricter cookie, scoped to the authentication path.
3. Refresh hashes and looks up the presented token inside a transaction or atomic compare-and-swap operation.
4. A valid refresh rotates the token hash and returns a new access token and refresh token.
5. A previously used refresh token indicates reuse. Revoke the entire family and require reauthentication.
6. Expired, revoked, or unknown tokens return a generic authentication failure.
7. Logout revokes one session. Global logout revokes all active sessions for the user.

## Endpoint changes

Preserve current login and registration response fields during compatibility rollout, but add:

- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/:sessionId`

The access-token verifier remains the only backend authentication boundary. Refresh endpoints must not accept a refresh token in a request body or query string.

## Invalidation rules

- Password change: revoke all sessions, then optionally create one fresh session.
- Account suspension: revoke all sessions and reject active access tokens using a session/version check.
- Account deletion: revoke all sessions and remove session records as part of the account-deletion workflow.
- Refresh reuse: revoke the entire token family and record a non-sensitive security event.

## Concurrency handling

Use an atomic update that matches the current `tokenHash`, `revokedAt: null`, and `expiresAt > now`, then replaces the hash. Only one concurrent request can win. The loser must not receive a new session. If MongoDB transactions are available in the deployment, use a transaction for rotation and related session metadata updates.

## Frontend migration

Replace localStorage token persistence with:

- short-lived access-token memory state;
- HttpOnly refresh cookie;
- one refresh promise shared by concurrent API requests;
- a bounded retry for 401 responses;
- server logout before clearing client state;
- explicit handling for refresh failure and session expiry.

When cookies are used, add CSRF protection for state-changing requests and keep origin checks on the backend. Client route guards remain UX only; every server route continues to authenticate and authorize independently.

## Rollout and compatibility

1. Deploy shared JWT configuration and session storage first.
2. Add refresh/logout endpoints while accepting the existing access-token response field.
3. Shorten access-token lifetime after frontend refresh handling is deployed.
4. Revoke legacy seven-day tokens at a controlled cutover, or use a token-version claim/check to invalidate them.
5. Remove localStorage token persistence after telemetry confirms refresh success.

## Required tests

Cover rotation, old-token rejection, reuse detection, revoked sessions, individual/global logout, password-change invalidation, suspension/deletion invalidation, concurrent refresh races, cookie attributes, CSRF failures, and refresh failure after browser restart.
