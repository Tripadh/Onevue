# Certificate Verification

Independent Node.js service for the Onevue certificate verification module. It accepts a Credly badge URL, stores a pending certificate in MongoDB, and returns that record. `POST /certificates/:id/verify` runs one verification attempt for that record. The server process retrieves a public Open Badges assertion from Credly. Redis is not used. When `CERTIFICATE_SERVICE_TOKEN` is set, certificate routes require that bearer token and an `X-Onevue-User-Id` header, and one user cannot read or verify another user's certificate. When the token is unset, submissions are stored for the local development user so the service's own tests can run.

## Requirements

- Node.js 22 or newer
- npm 9 or newer

## Setup

From this directory:

```bash
cd ~/Desktop/Onevue/backend/certificate-verification
npm install
cp .env.example .env
```

`.env.example` documents `PORT`, `MONGODB_URI`, and `CERTIFICATE_SERVICE_TOKEN`. `MONGODB_URI` is required. The server exits when it is missing and does not fall back to in-memory storage. Do not commit a real `.env` file.

The Prisma schema that previously targeted PostgreSQL is not used. Prisma enums, SQL `FOR UPDATE` locks, and PostgreSQL's treatment of nulls in unique constraints are not compatible with MongoDB. Certificates are stored with the official MongoDB driver in the `certificates` collection. On startup the service creates three indexes if they are absent: a unique `id`, a unique `(userId, url)`, and a unique `(userId, issuer, credentialId)` that applies only when both issuer and credential id are strings. It does not drop collections, delete existing documents, or rewrite data.

Use the same MongoDB deployment as the Onevue platform, normally the `onevue` database. Set `PORT=3001` when the Next.js backend is already using port 3000.

## Run locally

```bash
npm run dev
```

The server listens on port 3000 unless `PORT` is set. `.env.example` sets `PORT=3001` so it can run beside the Next.js backend. Check it with:

```bash
curl http://127.0.0.1:3001/health
```

Expected response:

```json
{ "status": "ok" }
```

## Certificate API

Submit a certificate URL:

```bash
curl -sS -D - http://localhost:3000/certificates \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.credly.com/badges/84e32d3a-b841-4e53-a172-e3e14ffe2bc1"}'
```

The only accepted link is `https://www.credly.com/badges/{uuid}`. The UUID is stored in lowercase. Query strings and fragments are kept on the submitted `url` and omitted from `canonicalUrl`. Links that use HTTP, another host, a trailing-dot host, a port, or `/public_url` are rejected. `/public_url` is not accepted until Credly confirms that production public-link format.

A new submission returns HTTP 202 and `"created": true`. The certificate status is `PENDING`. Matching the allowlist does not mark the certificate `VERIFIED` and does not contact Credly. Submitting the same URL, or another accepted URL with the same badge UUID, returns HTTP 200 and `"created": false` with the original record.

## Issuer verification

`verifyPendingCertificate` runs one verification attempt for a pending record. It does not run on submit, and there is no background worker.

`VERIFIED` is stored only when the adapter returns authoritative evidence and the issuer, credential id, canonical URL, holder, course, and issued date all satisfy the matching rules. `UNVERIFIED` is stored only when that evidence says this credential does not exist, or when consistent evidence identifies a different issuer, credential id, or canonical URL. Timeouts, rate limits, issuer outages, malformed bodies, and unsupported responses stay `PENDING`, increment `attempts`, and do not set `failureReason`.

The Credly adapter checks the existing badge URL allowlist before any request. When outbound retrieval is enabled, a guarded transport resolves only `api.credly.com`, rejects non-public addresses, and connects only to an address from that check while TLS still validates `api.credly.com`. It requests `GET /v1/obi/v2/badge_assertions/{badge_id}` and then the assertion's hosted badge class. Both URLs must be HTTPS on `api.credly.com` with no credentials, port, query, or fragment. Redirects are not followed. Each request has a 5 second timeout and a 1 MiB response cap. No `Authorization` header is sent.

That assertion endpoint is Credly's public Open Badges 2.0 hosted-verification API (`GET /obi/v2/badge_assertions/<badge_id>`). Credly's older OBI reference described this path without an organization id or an authorization header. The current docs site at `docs.credly.com` instead documents the organization API, which is a different interface. A public badge returns assertion JSON from `api.credly.com` without an API token. The authenticated organization API (`GET /v1/organizations/{organization_id}/badges/{badge_id}`) is not used: it requires the issuing organization's authorization token or an OAuth `issued_badges` token, plus that organization's id. Onevue does not have those credentials, and they would not verify a badge issued by someone else's organization. No Credly API secret is required for the public path, and none should be added to the environment for it.

`VERIFIED` requires an Open Badges 2.0 assertion whose id is the requested badge, `verification.type` of `hosted`, a badge class on the same host whose id matches the assertion, and an issuer `Profile` whose id is the organization in that badge class. The course name and issued date come from that evidence. Expiration is taken from `expires` when Credly sends it. Revocation is taken from `revoked`, `revocationReason`, or HTTP 410 on the assertion URL. A hashed recipient email is checked only when the verify request includes `earnerEmail`. Open Badges 2.0 hashes the exact trimmed email with SHA-256. When the assertion includes `salt`, the hash is SHA-256 of the email immediately followed by that salt. The email is not lowercased, and neither the email nor the hash is stored or logged. A match sets `recipientMatch` to `matched`. A different email sets `mismatched` without changing an already matched result. Omitting the email leaves `recipientMatch` as `unchecked`. Issuer `VERIFIED` means the badge evidence is valid. The student profile is marked verified only when `recipientMatch` is `matched`. HTTP 200, the badge page, a badge id, or generic JSON is not enough. A missing or private badge, HTTP 401 or 403, and an ambiguous body stay `PENDING`.

The adapter constructed by `createApp` without options does not open a connection, so unit tests do not call Credly. The process started from `src/index.ts` enables the guarded client. Text in an evidence field, including instructions to mark a certificate verified, is not a status decision. Logs for a live attempt are one JSON line with `event`, `outcome`, and `credentialId`. They omit response bodies, recipient hashes, emails, tokens, and database URIs.

Request verification for a stored certificate:

```bash
curl -sS -D - -X POST \
  http://localhost:3000/certificates/CERTIFICATE_ID/verify \
  -H 'content-type: application/json' \
  -d '{}'
```

The id uses the same UUID rule as `GET /certificates/:id`. An unknown UUID returns HTTP 404 with `NOT_FOUND`. A non-JSON `Content-Type` returns HTTP 415. `{}`, or a POST with no body, is a valid request. Any JSON field is HTTP 400 `VALIDATION_ERROR` and is not stored. The route rejects `status`, `evidence`, `issuer`, `credentialId`, `canonicalUrl`, `verifiedAt`, `attempts`, and `failureReason` from the body, and it does not copy a caller-supplied status onto the record.

A completed attempt returns HTTP 200 and the same certificate object as GET:

```json
{ "certificate": { "status": "PENDING", "attempts": 1, "failureReason": null } }
```

`VERIFIED` is returned only after the decision engine and the repository have stored `VERIFIED`. `UNVERIFIED` is returned only after they have stored `NOT_FOUND` or `FIELD_MISMATCH`. An unsupported result or a temporary issuer failure stays `PENDING`, increments `attempts`, and leaves `failureReason` empty. A record that is already `VERIFIED` or `UNVERIFIED` is returned unchanged; the adapter is not called. Validation failures and unexpected errors use the existing error envelope. HTTP 500 is `INTERNAL_ERROR` with `An unexpected error occurred.` and includes no stack trace, network detail, or raw issuer body.

The server process uses the guarded Credly adapter. `createApp` without an adapter still uses the disabled adapter and does not open an outbound connection.

Calls to `verifyPendingCertificate` for one certificate id run one at a time in this process, so one process does not call the issuer adapter twice for the same pending certificate at the same time. MongoDB updates write only while the certificate status is still `PENDING` and its attempt count is still the count the update observed. A second update with a stale attempt count is rejected and the verification service reads the document again. A final status is not changed. The unique indexes reject a concurrent duplicate submission. The in-memory repository used by unit tests checks the same attempt count in the process, but it does not provide a cross-process lock.

Read a certificate by its id:

```bash
curl -sS http://localhost:3000/certificates/CERTIFICATE_ID
```

A known id returns HTTP 200. An unknown UUID returns HTTP 404. Validation errors use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [{ "path": "url", "message": "url is required." }]
  }
}
```

## Safeguards and limitations

JSON bodies are limited to 16 KiB. Certificate routes accept `application/json` only when a `Content-Type` is present. Malformed JSON, an unknown field, an invalid UUID, and a query string are HTTP 400. An unknown path is HTTP 404. Unexpected failures are HTTP 500 with `INTERNAL_ERROR` and `An unexpected error occurred.` Responses do not include stack traces, raw issuer bodies, or internal exception text. `X-Powered-By` is disabled. Responses send `nosniff`, `no-store`, and a restrictive content security policy. This process does not terminate TLS, so it does not send HSTS. Cross-origin browser access is not enabled.

`POST /certificates` allows 30 requests per minute for each direct TCP peer. `POST /certificates/:id/verify` allows 20 requests per minute for each direct peer. A limited request is HTTP 429 `RATE_LIMITED` with `Retry-After`. The counters are in memory, apply only inside this process, reset on restart, and ignore `X-Forwarded-For`. Behind a reverse proxy every client shares the proxy's address. Denied requests do not extend the window. This is not a distributed rate limiter and it is not authentication.

Certificates are stored in MongoDB. Restarting the process does not drop them, and another process using the same database can read them. The rate-limit counters and the per-certificate verification queue still live in this process: they reset on restart and are not shared. A conditional database update still prevents a stale verification from overwriting attempts or a final status. The repository can store a `MAX_ATTEMPTS` failure reason, but verification does not close a certificate because of attempt count: timeouts, rate limits, outages, malformed bodies, unsupported evidence, and adapter exceptions stay `PENDING`.

Verification decisions come from the issuer adapter and the decision engine. Text extracted by the LLM service, including a claim that a certificate is verified, is not evidence and cannot set `VERIFIED`.

Unit tests use the in-memory repository. MongoDB persistence tests start an ephemeral MongoDB process through `mongodb-memory-server` and delete documents only in that temporary `certificate_verification_test` database. They do not use `MONGODB_URI` from the environment.

```bash
npm test
```

## Other scripts

```bash
npm run build            # compile TypeScript to dist/
npm start                # run the compiled server
npm test                 # unit tests and ephemeral MongoDB persistence tests
npm run lint             # ESLint
npm run format           # Prettier write
npm run format:check     # Prettier check
```
