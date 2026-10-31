# OneVue Google OAuth Integration

## Flow

Google sign-in uses the Authorization Code flow with S256 PKCE. The browser starts at
`/api/auth/google/start`; the server stores a signed, HttpOnly state cookie containing
the state, nonce, and verifier. The callback is handled by
`/api/auth/google/callback` on the backend, not by the frontend.

The callback exchanges the code server-side, verifies the Google ID-token signature
against Google's JWKS, issuer, audience, expiration, issued-at time, nonce, subject,
and `email_verified` claim, then creates a normal OneVue session. Google ID tokens
are never returned as OneVue API tokens.

## Account behavior

- A Google provider subject is unique in `AuthAccount`, preventing duplicate provider
  registrations.
- An existing email is not implicitly linked. The user must sign in to OneVue and
  start explicit linking through `/api/auth/google/link/start`.
- Linking does not overwrite the existing OneVue profile or identity.
- New Google users are created without a password and complete the existing identity
  onboarding flow.
- Password login remains available for accounts that have a password.

## Configuration

Set these server-only variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`

For local development, the callback URL is:
`http://localhost:3000/api/auth/google/callback`.

The frontend must not receive `GOOGLE_CLIENT_SECRET`. Production deployments must
register the exact backend callback URL in Google Cloud Console and use HTTPS.
