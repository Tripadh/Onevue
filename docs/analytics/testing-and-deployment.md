# Analytics testing and deployment

## Environment

Set these in backend deployment configuration. Do not commit real secrets.

- `ANALYTICS_HASH_SECRET`: long random HMAC key. Falls back to `JWT_SECRET`.
- `ANALYTICS_RATE_LIMIT_PER_MINUTE`: default `60`.
- `ANALYTICS_RETENTION_DAYS`: `0` keeps events.
- Frontend `API_BASE`: backend `/api` origin, default `http://localhost:3000/api`.
- Portfolio `ONEVUE_PUBLIC_API_BASE_URL` or `NEXT_PUBLIC_ONEVUE_API_BASE_URL`: same API origin. The tracker posts to `{base}/analytics/events`.

## Automated checks

From `backend`:

```text
node --test tests/*.test.js
npx tsc --noEmit
npx eslint lib/analytics app/api/analytics models/AnalyticsEvent.ts --max-warnings 0
```

From `portfolio`:

```text
npx tsc --noEmit
npm test
```

Verified on this rebuild:

- `backend`: `node --test tests/*.test.js` — 145 passed, 0 failed.
- `backend`: `npx tsc --noEmit` — exit 0.
- `backend`: analytics eslint — exit 0.
- `portfolio`: `npx tsc --noEmit` and `npm test` — 16 passed, 0 failed.
- `backend` `npm run build` compiled, then stopped once on the Next.js 16.4.0 security advisory. The retry completed with exit 0. Analytics routes are dynamic.
- `portfolio` `npm run build` completed with exit 0. `/p/[username]` is dynamic.
- The unsigned dashboard shell at `#/app/student/analytics` compiled and redirected to the landing page. Signed-in charts were not exercised in the browser.

The analytics integration tests use the real MongoDB database named by `backend/.env.local`. They create two users, publish a portfolio and a visiting card, insert events, and delete those documents afterward.

## Rollback

Remove the analytics route directory, model, and tracker mounts. Published pages keep working because tracker startup is inside `try/catch` and page rendering does not wait on the collector. Existing `analyticsevents` documents can remain; they are not read by profile or card pages.

## Manual checklist

- Publish a portfolio and confirm `GET /api/public/profile/:username` includes `analytics.resourceId` and no `userId`.
- Open `/p/:username`, then confirm one `page_view` in the owner dashboard.
- Reload and confirm a second view. React Strict Mode should not double-count inside one document load.
- Click the resume link and confirm a download.
- Publish a visiting card, open `#/card/:username`, flip it, and confirm a page view plus an engagement event.
- Sign in as a second user and confirm the first user's resource returns 404 and their overview is zero.
- Call overview without a token and confirm 401.
- Export CSV for one selected resource.
- Confirm an empty range shows zeros and “No analytics events”, not sample numbers.
- Confirm local development shows no country rather than a placeholder country.
