# Analytics privacy and security

## Identifiers

Visitor and session ids are HMAC-SHA256 hashed with `ANALYTICS_HASH_SECRET`, or `JWT_SECRET` when the dedicated secret is unset. The stored value is 32 hex characters. Invalid ids become null. The raw id, raw IP address, raw user agent, query string, and email are not stored.

`consent: false` still allows a page view to be counted, but visitor and session ids are stored as null and therefore do not become an estimated visitor or session.

## Minimization

- Referrers are reduced to hostnames.
- UTM values are normalized to a short token alphabet.
- Metadata keeps only `action`, `label`, `targetHost`, `targetPath`, `element`, and `side`.
- Geography is read from Vercel or Cloudflare country headers. The client cannot submit a country.
- Logs record stable failure codes such as `analytics_ingest_failed`. They do not record the event body.

## Abuse

- Payload cap: 8192 bytes.
- Default rate limit: 60 accepted attempts per minute per hashed forwarding address and user-agent slice. The map lives in process memory and is not shared across instances.
- Obvious crawler tokens are filtered. An empty user agent is not treated as a bot.
- `purpose`, `sec-purpose`, and `x-purpose` values containing prefetch or preview are dropped.
- Duplicate `eventId` values are idempotent for the same resource.

## Access control

Private queries always include the authenticated `ownerId`. The collector copies `ownerId` from the published resource. A caller cannot attach events to someone else's resource by sending an owner id.

CORS on the API is not authentication. The tracker sends `credentials: "omit"`.

## Retention

`ANALYTICS_RETENTION_DAYS=0`, or an unset value, stores `expiresAt: null` and the TTL index does not delete the event. A positive integer sets `expiresAt` to now plus that many days. Changing the variable does not rewrite old documents. Account deletion does not cascade into analytics events.
