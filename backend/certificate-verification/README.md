# Certificate Verification

Independent Node.js service for the Onevue certificate verification module. It accepts a Credly badge URL, stores a pending certificate in PostgreSQL, and returns that record. `POST /certificates/:id/verify` runs one verification attempt for that record. Live Credly retrieval is disabled until an official evidence source and a guarded HTTP client are both available. Redis and authentication are not implemented. The API is not production-secure: anyone who can reach the process can submit and read certificates.

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

`.env.example` documents `PORT` and `DATABASE_URL`. `DATABASE_URL` is required. The server exits when it is missing and does not fall back to in-memory storage. Do not commit a real `.env` file.

Create the database, apply the migration, and generate the Prisma client:

```bash
npx prisma generate
npx prisma migrate dev
```

`prisma migrate dev` uses `DATABASE_URL`. For a dedicated test database, apply the same migration without using the development database:

```bash
DATABASE_URL="$CERTIFICATE_TEST_DATABASE_URL" npx prisma migrate deploy
```

`CERTIFICATE_TEST_DATABASE_URL` is read only by the PostgreSQL integration tests. Its database name must contain `test`. Those tests delete certificate rows in that database.

## Run locally

```bash
npm run dev
```

The server listens on port 3000 unless `PORT` is set. Check it with:

```bash
curl http://localhost:3000/health
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

The Credly adapter checks the existing URL allowlist before any request. A guarded transport can resolve `www.credly.com`, reject non-public addresses, and connect only to an address from that check while TLS still validates `www.credly.com`. It does not follow redirects, and it caps the request time and streamed response size. The default adapter never opens a connection: Credly's official public evidence format is not confirmed, so a response body, HTTP 200, a badge id, or generic JSON cannot verify a credential. Text in an evidence field, including instructions to mark a certificate verified, is not a status decision.

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

The default adapter used by this route is the disabled Credly adapter. It does not resolve DNS names and does not open an outbound connection.

Calls to `verifyPendingCertificate` for one certificate id run one at a time in this process, so one process does not call the issuer adapter twice for the same pending certificate at the same time. PostgreSQL updates lock the certificate row and write only while its status is still `PENDING` and its attempt count is still the count the update observed. A second update with a stale attempt count is rejected and the verification service reads the row again. A final status is not changed. The in-memory repository used by unit tests checks the same attempt count in the process, but it does not provide a cross-process lock.

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

Certificates are stored in PostgreSQL. Restarting the process does not drop them, and another process using the same database can read them. The rate-limit counters and the per-certificate verification queue still live in this process: they reset on restart and are not shared. A conditional database update still prevents a stale verification from overwriting attempts or a final status. The repository can store a `MAX_ATTEMPTS` failure reason, but verification does not close a certificate because of attempt count: timeouts, rate limits, outages, malformed bodies, unsupported evidence, and adapter exceptions stay `PENDING`.

Unit tests use the in-memory repository and do not need PostgreSQL. They do not prove the database constraints. Integration tests run only when `CERTIFICATE_TEST_DATABASE_URL` is set:

```bash
node --import tsx --test tests/*.test.ts
CERTIFICATE_TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/certificate_verification_test \
  node --import tsx --test tests/postgres-certificate-repository.test.ts
```

## Other scripts

```bash
npm run prisma:generate  # generate the Prisma client
npm run prisma:migrate   # create and apply a migration to DATABASE_URL
npm run build            # generate the client and compile TypeScript to dist/
npm start                # run the compiled server
npm run lint             # ESLint
npm run format           # Prettier write
npm run format:check     # Prettier check
```
