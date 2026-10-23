# OneVue analytics architecture

OneVue is three applications that share one MongoDB database:

- `backend` is a Next.js App Router API. It owns authentication, publishing, and analytics.
- `portfolio` is a Next.js renderer for published portfolio sites at `/p/:username`.
- `frontend` is a static React app. The owner dashboard lives at `#/app/student/analytics`. Public visiting cards live at `#/card/:username`.

There is no Redis, queue, or separate analytics service. The collector writes accepted events synchronously to MongoDB. Reports aggregate those events on read with indexed range queries.

## Resource identity

| Surface | Stable id | Owner | Public path | Published when |
| --- | --- | --- | --- | --- |
| Portfolio | `UserWebsiteConfig._id` | `userId` | `/p/:username` | `status === "published"` and `activeRevisionId` is set |
| Visiting card | `VisitingCard._id` | `userId` | `/card/:username` | `publicationStatus === "published"` and `publishedSnapshot` exists |

Usernames are not analytics ids. A user can publish more than one card, and the public card response returns the default or latest published card. The public profile and public card payloads expose `analytics.resourceId` and `analytics.resourceType`. They do not expose `userId`.

## Request path

Published page → first-party collector → `POST /api/analytics/events` → validate the published resource → drop bots, prefetches, and duplicate ids → insert `AnalyticsEvent` → owner calls a JWT route → the server loads the user and filters by `ownerId`.

Public collection and private reporting are separate routes. The collector ignores client `ownerId` and `occurredAt`. Ownership comes only from the published portfolio or card document.

Page views are recorded in the browser after render. Server rendering and metadata generation do not count a view, so a cached or prefetched document is not double-counted.

## What is intentionally not here

- No Kafka, ClickHouse, Elasticsearch, or new microservice.
- No rollup collection. The current volume fits indexed `$facet` aggregation. `$dateToString` is used instead of `$dateTrunc` so older MongoDB servers still bucket correctly.
- The in-process rate limit is per server instance. It is not a global limiter.
- Product events in `frontend/services/analytics.js` `track()` stay in localStorage. They are not owner analytics.
