# Analytics API

Public collection and private reporting use different routes. Private routes require `Authorization: Bearer <jwt>` and return `Cache-Control: private, no-store`.

## `POST /api/analytics/events`

No authentication. Body is a JSON object, maximum 8192 bytes.

Required fields: `sdkVersion` (`"1"`), `eventId`, `resourceId`, `resourceType`, `eventType`.

Ignored fields: `ownerId`, `occurredAt`.

| Status | Meaning |
| --- | --- |
| 202 | Accepted, duplicate, or filtered (`bot`, `prefetch`, `insufficient_engagement`). |
| 400 | Invalid JSON, SDK version, event id, or event type. |
| 404 | Unknown or unpublished resource. Another user's private id also returns 404. |
| 409 | `eventId` already belongs to a different resource. |
| 413 | Payload too large. |
| 429 | In-process rate limit. `Retry-After` is set. |
| 503 | Insert failed. |

## Private routes

All private routes accept `from`, `to`, `timezone`, and `compare`. `compare=false` skips the previous period.

| Method and path | Response |
| --- | --- |
| `GET /api/analytics/overview` | Totals, timeseries, audience, sources, engagement, and recent events. Optional `type=all\|portfolio\|visiting_card` and `resourceId`. |
| `GET /api/analytics/resources` | Owned resources with page views, visitors, clicks, and downloads. |
| `GET /api/analytics/resources/:resourceId` | One resource and its totals. |
| `GET .../timeseries` | Zero-filled buckets. |
| `GET .../audience` | Device, browser, operating system, and country. |
| `GET .../sources` | Referrer domains and campaigns. |
| `GET .../events` | Paginated events. `pageSize` max 50. Skip above 1000 is rejected. |
| `GET .../export?format=csv` | CSV attachment. `format=json` returns the report. |

Missing authentication returns 401. A resource the caller does not own returns 404. Invalid dates, timezones, or ranges return 400 with `code: "invalid_query"`. Unexpected query failures return 500 with `code: "query_failed"` and a stable server log code. Responses include `definitions` so the dashboard does not invent metric meanings.
