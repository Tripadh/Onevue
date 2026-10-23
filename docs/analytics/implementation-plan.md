# Analytics implementation plan

## Flow

1. A published portfolio or visiting card reads `analytics.resourceId` from the public API.
2. The page creates a first-party tracker. The portfolio uses `portfolio/src/lib/onevue-analytics.ts`. The visiting card uses `frontend/services/onevue-analytics.js`.
3. The tracker sends `POST /api/analytics/events` with `credentials: "omit"`. `sendBeacon` uses `text/plain` so the cross-origin request does not require a JSON preflight. `fetch` with `keepalive` is the fallback.
4. The API checks payload size, the in-process rate limit, prefetch headers, and obvious bot user agents.
5. It resolves a published resource, hashes visitor and session ids, and inserts one `AnalyticsEvent`.
6. Owner routes call `verifyAuth`, then aggregate only documents whose `ownerId` and `resourceId` belong to that user.

## Metric contract

- Page views: accepted `page_view` events.
- Visitors: distinct hashed visitor ids on page views. Missing ids are not counted as people.
- Sessions: distinct hashed session ids on page views. The browser starts a new session after 30 minutes of inactivity.
- Link clicks and downloads: those event types.
- Engagement rate: page-view sessions that also have a link click, download, engagement event, or engagement time of at least 1000 ms, divided by page-view sessions. The value is null when there are no sessions.
- Average engagement time: foreground milliseconds divided by sessions that reported a sample. It is null when no sample exists. Samples under 1000 ms are discarded.

Relative change is null when the previous period is zero. The dashboard shows that as “No prior data”.

## Dates

Ranges use inclusive `YYYY-MM-DD` dates in an IANA timezone, default UTC, maximum 366 days, default 30 days. The previous period is the immediately preceding window of the same length. Buckets are hourly for ranges of two days or less and daily otherwise. Empty buckets are filled with zeros.

## Assumptions

- Tracking is on unless `window.OV_ANALYTICS_CONSENT === false` or the event sets `consent: false`. There is no consent-management platform.
- Country and region come only from `x-vercel-ip-country`, `cf-ipcountry`, and `x-vercel-ip-country-region`. Local development correctly shows no country.
- The collector rate limit defaults to 60 events per minute per hashed IP and user-agent pair, in memory.
- A public card URL identifies a username, not one permanent card. The response includes the card id that was actually served.
