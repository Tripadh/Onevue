# Analytics data model

`AnalyticsEvent` is stored in the `analyticsevents` collection. Portfolio and card documents remain the source of truth for ownership and publication. There is no separate analytics-resource collection.

## Fields

| Field | Meaning |
| --- | --- |
| `eventId` | Client-generated idempotency key, 8–80 URL-safe characters. Unique. |
| `resourceId` | Portfolio or visiting-card id. |
| `ownerId` | User id copied from the published resource on the server. |
| `resourceType` | `portfolio` or `visiting_card`. |
| `eventType` | `page_view`, `link_click`, `download`, `engagement`, or `engagement_time`. |
| `occurredAt` | Server time. Client timestamps are ignored. |
| `path` | Path only, query and fragment removed, max 200 characters. |
| `referrerDomain` | Hostname only. |
| `utmSource` through `utmTerm` | Lowercase tokens matching `[a-z0-9._:-]`, max 80. |
| `deviceCategory`, `browserFamily`, `osFamily` | Coarse families parsed from the user agent. The raw user agent is not stored. |
| `country`, `region` | Trusted edge headers only. |
| `visitorId`, `sessionId` | HMAC-SHA256 of the client id, truncated to 32 hex characters, or null. |
| `metadata` | Allowlist: `action`, `label`, `targetHost`, `targetPath`, `element`, `side`, plus `engagementMs`. |
| `ingestedAt` | Insert time. |
| `expiresAt` | Set only when `ANALYTICS_RETENTION_DAYS` is a positive integer. |

## Indexes

- Unique `eventId`.
- `{ ownerId: 1, occurredAt: -1 }`.
- `{ resourceId: 1, occurredAt: -1 }`.
- `{ resourceId: 1, eventType: 1, occurredAt: -1 }`.
- `{ resourceId: 1, visitorId: 1, occurredAt: -1 }`.
- TTL on `expiresAt` with `expireAfterSeconds: 0`.

Queries always match both `ownerId` and the owned `resourceId` set. Events for a deleted resource drop out of totals because the resource list no longer includes that id. Deleting an account does not currently delete historical events.

## Formulas

Engagement rate uses the intersection of qualifying session ids and page-view session ids. Average engagement seconds rounds `totalMs / timedSessions / 100` to one decimal. A duplicate `eventId` for the same resource returns accepted and does not insert a second document. Reusing an id for a different resource returns 409.
